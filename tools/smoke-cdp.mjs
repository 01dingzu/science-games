// 零依赖 CDP 渲染冒烟 v2：全程进度落盘 + 看门狗 + 必写报告
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROG = m => { try { appendFileSync(join(DIR, '_progress.txt'), new Date().toISOString().slice(11, 19) + ' ' + m + '\n'); } catch { } };
const results = [];
let done = false;

process.on('uncaughtException', e => finish('UNCAUGHT: ' + (e?.stack || e)));
process.on('unhandledRejection', e => finish('REJECTION: ' + String(e?.stack || e)));
// 看门狗：150s 内没跑完也强制出报告
setTimeout(() => finish('WATCHDOG timeout'), 150000);

function finish(errMsg) {
  if (done) return;
  done = true;
  if (errMsg) results.push({ name: 'HARNESS', status: 'CRASH', logs: [errMsg] });
  let pass = 0, fail = 0, report = '';
  for (const r of results) {
    if (r.status === 'PASS') pass++; else fail++;
    report += `\n[${r.status}] ${r.name}\n`;
    for (const l of r.logs) report += '  - ' + l + '\n';
  }
  report += `\nSUMMARY: ${pass} pass / ${fail} fail\n`;
  const outFile = join(DIR, 'smoke-report-' + Date.now() + '.txt');
  try { writeFileSync(outFile, report, 'utf8'); } catch { }
  try { writeFileSync(join(DIR, '_last-report-name.txt'), outFile, 'utf8'); } catch { }
  try { rmSync(profile, { recursive: true, force: true }); } catch { }
  try { proc && proc.kill(); } catch { }
  try { server.close(); } catch { }
  process.exit(fail ? 1 : 0);
}

PROG('boot');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = join(DIR, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  let data = null, ok = false;
  try { data = readFileSync(p); ok = true; } catch { }
  try {
    if (!res.headersSent) res.writeHead(ok ? 200 : 404, { 'Content-Type': ok ? (MIME[extname(p)] || 'application/octet-stream') : 'text/plain' });
    if (!res.writableEnded) res.end(ok ? data : 'nf');
  } catch { }
});
await new Promise((r, j) => { server.on('error', j); server.listen(0, '127.0.0.1', r); });
const HTTP_PORT = server.address().port;
const BASE = `http://127.0.0.1:${HTTP_PORT}/`;
PROG('http on ' + HTTP_PORT);

const EXE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const EXE = EXE_CANDIDATES.find(p => existsSync(p));
if (!EXE) finish('no chrome/edge found');
const profile = mkdtempSync(join(tmpdir(), 'smoke-games-'));
const proc = spawn(EXE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=900,900', 'about:blank'], { stdio: 'ignore' });
PROG('browser spawned');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getWsUrl() {
  const f = join(profile, 'DevToolsActivePort');
  let dport = '';
  for (let i = 0; i < 40; i++) { try { dport = readFileSync(f, 'utf8').split('\n')[0].trim(); if (dport) break; } catch { } await sleep(250); }
  if (!dport) throw new Error('DevToolsActivePort not found');
  PROG('devtools port ' + dport);
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { }
    await sleep(300);
  }
  throw new Error('CDP not reachable');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
PROG('ws open');

let msgId = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = ev => {
  const d = JSON.parse(ev.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') {
    const e = d.params.exceptionDetails;
    pageErrors.push((e.exception?.description || e.text || 'exception').replace(/\n/g, ' | ').slice(0, 300));
  }
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') {
    const url = d.params.entry.url || '';
    if (url.includes('favicon')) return; // favicon 404 噪音忽略
    pageErrors.push('LOG: ' + d.params.entry.text.slice(0, 300));
  }
};
function send(method, params = {}) {
  return new Promise(resolve => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.error) return '__ERR__ CDP: ' + r.error.message;
  if (r.result?.exceptionDetails) return '__ERR__ ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || 'eval-exception').replace(/\n/g, ' | ').slice(0, 200);
  return r.result?.result?.value;
}

let pageErrorsMark = 0;
const drainErrors = () => { const e = pageErrors.slice(pageErrorsMark); pageErrorsMark = pageErrors.length; return e; };

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

async function nav(file) {
  PROG('nav ' + file);
  await send('Page.navigate', { url: BASE + file + '.html' });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const href = await evaluate('location.href');
    const rs = await evaluate('document.readyState');
    if (typeof href === 'string' && href.includes(file) && rs === 'complete') { await sleep(300); PROG('nav ok ' + file); return; }
  }
  throw new Error('页面加载失败: ' + file + ' @ ' + await evaluate('location.href'));
}

async function test(name, file, fn) {
  PROG('test ' + name);
  pageErrorsMark = pageErrors.length;
  const logs = [];
  let status = 'PASS';
  try {
    await nav(file);
    const href = await evaluate('location.href');
    logs.push('页面: ' + String(href).split('/').pop());
    await fn(logs);
    const errs = drainErrors();
    if (errs.length) { status = 'ERROR'; logs.push('运行时异常: ' + errs.join(' ;; ')); }
  } catch (e) {
    status = 'FAIL';
    const errs = drainErrors();
    logs.push('断言失败: ' + e.message);
    if (errs.length) logs.push('页面异常: ' + errs.join(' ;; '));
  }
  results.push({ name, status, logs });
  PROG('test ' + name + ' -> ' + status);
}

const clickAt = async (sel, x, y) => {
  await evaluate(`(() => {
    const c = document.querySelector('${sel}');
    const r = c.getBoundingClientRect();
    const opts = {clientX: r.left + ${x}, clientY: r.top + ${y}, bubbles: true, cancelable: true};
    c.dispatchEvent(new MouseEvent('mousedown', opts));
    c.dispatchEvent(new MouseEvent('click', opts));
  })()`);
};
const btnClick = async text => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('${text}'));
  if (!b) return 'NO_BUTTON';
  b.click(); return 'OK';
})()`);
const runFrames = async n => { await evaluate(`new Promise(r => { let i=0; const t=setInterval(()=>{ if(++i>=${n}){clearInterval(t);r('done');} },16); })`); };

await test('1-fusion 元素炼金塔', '1-fusion', async logs => {
  const t = await evaluate('document.body.innerText.length');
  if (!(t >= 40)) throw new Error('白屏? text=' + t);
  await clickAt('#cv', 210, 300);
  // headless 里 rAF 不跑帧，直接调物理步进
  await evaluate('for (let i = 0; i < 40; i++) step();');
  const n = await evaluate('balls.length');
  if (!(n >= 1)) throw new Error('发射后 balls.length=' + n);
  // 双氢聚变验证
  const merged = await evaluate(`(() => {
    const before = balls.length;
    balls.push({x:200,y:400,vx:0,vy:0,tier:0},{x:206,y:400,vx:0,vy:0,tier:0});
    for (let i = 0; i < 10; i++) step();
    return (before + 2 - balls.length) + '|' + score;
  })()`);
  const mScore = Number(String(merged).split('|')[1]);
  const consumed = Number(String(merged).split('|')[0]);
  if (!(consumed >= 1)) throw new Error('聚变没发生 merged=' + merged);
  if (!(mScore > 0)) throw new Error('聚变没加分 merged=' + merged);
  logs.push('发射+聚变 OK score=' + mScore);
});

await test('2-valence 化合价消除', '2-valence', async logs => {
  await evaluate(`document.querySelectorAll('#grid .tile')[0].click(); document.querySelectorAll('#grid .tile')[1].click();`);
  await sleep(600);
  const s = await evaluate('score');
  if (!(s > 0)) throw new Error('Na+Cl 消除失败 score=' + s);
  logs.push('NaCl 消除成功 score=' + s);
});

await test('3-bacteria 细菌帝国', '3-bacteria', async logs => {
  // 关卡制后 N 随关卡变化（第1关 8×8），按当前 CELL 计算格心
  const cell = await evaluate('CELL');
  await btnClick('定殖');
  await clickAt('#cv', 4.5 * cell, 2.5 * cell);
  const p = await evaluate('grid[2][4]');
  if (p !== 1) throw new Error('定殖失败 grid[2][4]=' + p + ' CELL=' + cell);
  await btnClick('下一回合');
  const t = await evaluate('turn');
  if (t !== 2) throw new Error('回合没推进 turn=' + t);
  logs.push('定殖+回合推进 OK');
});

await test('4-mito 线粒体经理', '4-mito', async logs => {
  const before = await evaluate('atp');
  if (typeof before !== 'number') throw new Error('atp 不可读: ' + JSON.stringify(before));
  await evaluate('glu=10; oxy=20; aerobic();');
  const after = await evaluate('atp');
  if (after - before < 30) throw new Error('有氧呼吸没产能 atp ' + before + '->' + after);
  await btnClick('摄食');
  const glu = await evaluate('glu');
  if (!(glu >= 10)) throw new Error('摄食失败 glu=' + glu);
  logs.push('有氧 +30 ATP OK, glu=' + glu);
});

await test('5-bridge 桥梁工程师', '5-bridge', async logs => {
  // 1) 点击造梁 UI 验证（两点连一根梁）
  await clickAt('#cv', 120, 300);
  await clickAt('#cv', 220, 300);
  const nb = await evaluate('beams.length');
  if (!(nb >= 1)) throw new Error('造梁失败 beams=' + JSON.stringify(nb));
  const b0 = await evaluate('budget');
  if (!(typeof b0 === 'number' && b0 < 1000)) throw new Error('预算没扣 budget=' + b0);
  // 2) 程序化搭一座带三角桁架的正经桥，验证物理与载重
  await evaluate(`(() => {
    beams = [];
    nodes = [{x:70,y:270,px:70,py:270,fixed:true},{x:530,y:270,px:530,py:270,fixed:true}];
    budget = 100000; testing = false; truck = null; pendingNode = null;
    const deck = [], top = [];
    for (let x = 120; x <= 480; x += 60) { nodes.push({x, y:300, px:x, py:300, fixed:false}); deck.push(nodes.length-1); }
    for (let x = 150; x <= 450; x += 60) { nodes.push({x, y:235, px:x, py:235, fixed:false}); top.push(nodes.length-1); }
    const add = (a,b,m) => beams.push({a, b, rest: Math.hypot(nodes[a].x-nodes[b].x, nodes[a].y-nodes[b].y), mat: m, broken:false, stress:0});
    add(0, deck[0], 0);
    for (let i = 0; i < deck.length-1; i++) add(deck[i], deck[i+1], 0);
    add(deck[deck.length-1], 1, 0);
    add(0, top[0], 0);
    for (let i = 0; i < top.length-1; i++) add(top[i], top[i+1], 0);
    add(top[top.length-1], 1, 0);
    for (let i = 0; i < deck.length; i++) {
      if (i < top.length) add(deck[i], top[i], 2);
      if (i > 0) add(deck[i], top[i-1], 0);
    }
  })()`);
  await btnClick('载重');
  await evaluate('if (testing) { for (let i = 0; i < 500; i++) { physStep(); if (!testing) break; } }');
  const logText = await evaluate('document.getElementById("log").textContent');
  if (!String(logText).includes('安全过桥')) throw new Error('卡车没过桥: ' + logText);
  logs.push('UI 造梁 OK（预算 ' + b0 + '），桁架桥载重通过');
});

await test('6-factory 万物工厂', '6-factory', async logs => {
  // 关卡制后每单步数不同（4→8 步），按当前订单的工序数走
  const steps = await evaluate('order.steps.length');
  if (typeof steps !== 'number' || steps < 4) throw new Error('订单工序数异常: ' + steps);
  for (let i = 0; i < steps; i++) {
    await evaluate(`(() => {
      const target = order.steps[${i}][0];
      const chip = [...document.querySelectorAll('.chip')].find(c => c.textContent === target);
      if (chip) chip.click();
    })()`);
    await sleep(80);
  }
  const placed = await evaluate('placed');
  if (placed !== steps) throw new Error('流程未完成 placed=' + placed + '/' + steps);
  logs.push('订单全流程 OK（' + steps + ' 步）');
});

await test('7-optics 光的迷宫', '7-optics', async logs => {
  for (const [cx, cy] of [[5, 1], [5, 5]]) {
    await clickAt('#cv', cx * 44 + 22, cy * 44 + 22);
    await clickAt('#cv', cx * 44 + 22, cy * 44 + 22);
  }
  const won = await evaluate('won');
  if (!won) throw new Error('光路没打通 won=' + won);
  logs.push('第1关通关 OK');
});

await test('8-vaccine 疫苗工厂', '8-vaccine', async logs => {
  await evaluate('act(0); act(0); act(0); act(0);');
  await btnClick('进入下周');
  const w = await evaluate('week');
  if (w !== 2) throw new Error('周没推进 week=' + w);
  logs.push('周结算推进 OK week=' + w);
});

await test('9-fission 分子弹球', '9-fission', async logs => {
  await evaluate(`(function(){
    const u = nuclei[0];
    const ang = Math.atan2(u.y - (H-20), u.x - W/2);
    neutrons.push({x: W/2, y: H-30, vx: Math.cos(ang)*7, vy: Math.sin(ang)*7, life: 300});
    return 'fired';
  })()`);
  // headless 无 rAF，直接跑物理步进让中子飞行、撞击
  // 铀核位置随机，中子可能要飞很久才撞上，多跑几步（会来回反弹）
  await evaluate('for (let i = 0; i < 200 && !over; i++) physStep();');
  const s = await evaluate('score');
  if (!(s > 0)) throw new Error('裂变没发生 score=' + s);
  logs.push('链式裂变 OK score=' + s);
});

await test('10-chip 半导体小镇', '10-chip', async logs => {
  await btnClick('进入下一季度');
  const q = await evaluate('quarter');
  if (q !== 2) throw new Error('季度没推进 quarter=' + q);
  const m = await evaluate('document.getElementById("msg").textContent');
  if (!String(m).includes('季度结算')) throw new Error('无结算信息 msg=' + m);
  logs.push('季度结算 OK: ' + String(m).slice(0, 40));
});

await test('11-needle 蒲丰投针', '11-needle', async logs => {
  await evaluate('toss(50)');
  const n = await evaluate('n'), h = await evaluate('h'), p = await evaluate('piEst()');
  if (!(n > 0)) throw new Error('投掷没生效 n=' + n);
  if (!(h > 0 && h < n)) throw new Error('相交数不合理 n=' + n + ' h=' + h);
  if (!(Math.abs(p - Math.PI) < 1.0)) throw new Error('π 估计离谱 p=' + p);
  logs.push('投 ' + n + ' 根 OK π≈' + p.toFixed(3) + ' 相交 ' + h);
});

await test('12-bridges 七桥一笔画', '12-bridges', async logs => {
  await evaluate(`(() => {
    const r = cv.getBoundingClientRect();
    const fire = (nx, ny) => cv.dispatchEvent(new MouseEvent('click', {
      clientX: r.left + nx * r.width / cv.width,
      clientY: r.top + ny * r.height / cv.height, bubbles: true }));
    fire(220, 70); fire(90, 260); fire(350, 260); fire(220, 70);
  })()`);
  const m = await evaluate('document.getElementById("msg").textContent');
  if (!String(m).includes('一笔画完')) throw new Error('没走完 msg=' + m);
  logs.push('三角形一笔画 OK');
});

await test('13-sieve 素数筛', '13-sieve', async logs => {
  await evaluate('sieve(2); sieve(3); sieve(5);');
  const r = await evaluate('remain()');
  if (r !== 1) throw new Error('筛完 2/3/5 后应只剩 1，实际 remain=' + r);
  await evaluate(`hit(1, document.querySelector('#grid .cell'))`);
  const m = await evaluate('document.getElementById("msg").textContent');
  if (!String(m).includes('筛完了')) throw new Error('没通关 msg=' + m);
  logs.push('1-30 筛完 OK');
});

await test('lore 史实图鉴', 'lore', async logs => {
  const total = await evaluate('document.querySelectorAll("#list .item").length');
  if (total !== 39) throw new Error('图鉴条目数 = ' + total + '，期望 39');
  const txt = await evaluate('document.getElementById("ptxt").textContent');
  logs.push('图鉴 ' + total + ' 条 · ' + txt);
});

await test('stories 史实解锁 + 结算卡', '11-needle', async logs => {
  await evaluate('SCI.unlock("11-needle")');
  const n = await evaluate('Object.keys(JSON.parse(localStorage.getItem("sciStoriesSeen")||"{}")).filter(k=>k.indexOf("11-needle")===0).length');
  if (n !== 3) throw new Error('解锁条数 = ' + n);
  await evaluate('hub.finish({win:true,title:"t",text:"t",stat:"s"})');
  const has = await evaluate('!!document.querySelector("#hubEnd .hub-lore")');
  if (!has) throw new Error('结算面板没有挂上史实卡');
  const t = await evaluate('document.querySelector("#hubEnd .hub-lore-t").textContent');
  logs.push('解锁 3 条 + 史实卡 OK：' + String(t).slice(0, 24));
});

// 静态接线检查：新增游戏时最容易漏掉 hub.js / stories.js / hub.finish
{
  const fsm = await import('node:fs');
  const ids = ['1-fusion','2-valence','3-bacteria','4-mito','5-bridge','6-factory','7-optics',
               '8-vaccine','9-fission','10-chip','11-needle','12-bridges','13-sieve'];
  const bad = ids.filter(f => {
    const s = fsm.readFileSync(DIR + '/' + f + '.html', 'utf8');
    return !(s.includes('hub.js') && s.includes('stories.js') && s.includes('hub.finish') && s.includes('DIFF'));
  });
  results.push({
    name: '接线检查：13 个游戏都接了 hub / stories / 难度曲线',
    status: bad.length ? 'FAIL' : 'PASS',
    logs: bad.length ? ['缺件: ' + bad.join(', ')] : ['13 个游戏全部含 hub.js + stories.js + hub.finish + DIFF']
  });
}

finish();

