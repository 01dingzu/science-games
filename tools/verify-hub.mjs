// 验证 hub.js：每个游戏的返回条 + 通关面板 + 跳回聚合页 + 通关记录
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let done = false, proc = null, server = null, profile = '';

function finish(errMsg) {
  if (done) return;
  done = true;
  if (errMsg) results.push({ name: 'HARNESS', status: 'CRASH', logs: [errMsg] });
  let pass = 0, fail = 0, out = '';
  for (const r of results) {
    if (r.status === 'PASS') pass++; else fail++;
    out += `\n[${r.status}] ${r.name}\n`;
    for (const l of r.logs) out += '  - ' + l + '\n';
  }
  out += `\nSUMMARY: ${pass} pass / ${fail} fail\n`;
  const f = join(DIR, 'hub-verify-report.txt');
  try { writeFileSync(f, out, 'utf8'); } catch { }
  console.log(out);
  try { rmSync(profile, { recursive: true, force: true }); } catch { }
  try { proc && proc.kill(); } catch { }
  try { server && server.close(); } catch { }
  process.exit(fail ? 1 : 0);
}
process.on('uncaughtException', e => finish('UNCAUGHT: ' + (e?.stack || e)));
process.on('unhandledRejection', e => finish('REJECTION: ' + String(e?.stack || e)));
setTimeout(() => finish('WATCHDOG timeout'), 150000);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
server = http.createServer((req, res) => {
  const p = join(DIR, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  let data = null, ok = false;
  try { data = readFileSync(p); ok = true; } catch { }
  try {
    if (!res.headersSent) res.writeHead(ok ? 200 : 404, { 'Content-Type': ok ? (MIME[extname(p)] || 'application/octet-stream') : 'text/plain' });
    if (!res.writableEnded) res.end(ok ? data : 'nf');
  } catch { }
});
await new Promise((r, j) => { server.on('error', j); server.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${server.address().port}/`;

const EXE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!EXE) finish('no browser found');
profile = mkdtempSync(join(tmpdir(), 'hub-verify-'));
proc = spawn(EXE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--window-size=900,900', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getWsUrl() {
  const f = join(profile, 'DevToolsActivePort');
  let port = '';
  for (let i = 0; i < 40; i++) { try { port = readFileSync(f, 'utf8').split('\n')[0].trim(); if (port) break; } catch { } await sleep(250); }
  if (!port) throw new Error('DevToolsActivePort not found');
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { }
    await sleep(300);
  }
  throw new Error('CDP not reachable');
}
const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
function send(method, params = {}) {
  return new Promise(resolve => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.error) return '__ERR__ ' + r.error.message;
  if (r.result?.exceptionDetails) return '__ERR__ ' + (r.result.exceptionDetails.exception?.description || 'exception').replace(/\n/g, ' | ').slice(0, 200);
  return r.result?.result?.value;
}
await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

async function nav(file) {
  await send('Page.navigate', { url: BASE + file + '.html' });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const href = await evaluate('location.href');
    const rs = await evaluate('document.readyState');
    if (typeof href === 'string' && href.includes(file) && rs === 'complete') { await sleep(350); return; }
  }
  throw new Error('加载失败: ' + file);
}

const GAMES = [
  ['1-fusion', '元素炼金塔'], ['2-valence', '化学反应连连杀'], ['3-bacteria', '细菌帝国'],
  ['4-mito', '线粒体经理'], ['5-bridge', '桥梁工程师'], ['6-factory', '万物工厂'],
  ['7-optics', '光的迷宫'], ['8-vaccine', '疫苗工厂'], ['9-fission', '分子弹球'], ['10-chip', '半导体小镇'],
  ['11-needle', '蒲丰投针'], ['12-bridges', '七桥一笔画'], ['13-sieve', '素数筛'],
  ['14-circuit', '电路迷宫'], ['15-steam', '蒸汽机调度'],
];

// 先清空通关记录
await nav('index');
await evaluate("try{localStorage.removeItem('sciGamesCleared')}catch(e){}");

for (const [file, name] of GAMES) {
  const logs = [];
  let status = 'PASS';
  try {
    await nav(file);
    const t = await evaluate(`(function(){
      var hasHub = typeof window.hub === 'object' && window.hub;
      var bar = document.querySelector('.hub-back');
      return JSON.stringify({
        hub: !!hasHub,
        id: hasHub ? hasHub.id : null,
        bar: !!bar,
        href: bar ? bar.getAttribute('href') : null
      });
    })()`);
    const info = JSON.parse(t);
    if (!info.hub) throw new Error('hub.js 未加载（window.hub 不存在）');
    if (!info.bar) throw new Error('返回条 .hub-back 未注入');
    if (!/index\.html/.test(info.href || '')) throw new Error('返回条 href 不对: ' + info.href);
    logs.push('hub 已加载 id=' + info.id + '，返回条 href=' + info.href);

    // 弹通关面板
    await evaluate(`hub.finish({win:true,title:'T',text:'X',stat:'S'})`);
    await sleep(150);
    const panel = await evaluate(`JSON.stringify({
      disp: getComputedStyle(document.getElementById('hubEnd')).display,
      title: document.getElementById('hubTitle').textContent,
      home: !!document.getElementById('hubHome')
    })`);
    const p = JSON.parse(panel);
    if (p.disp !== 'flex') throw new Error('面板没显示 display=' + p.disp);
    if (p.title !== 'T') throw new Error('面板标题不对: ' + p.title);
    logs.push('通关面板弹出 OK');

    // 点返回聚合页
    await evaluate(`document.getElementById('hubHome').click()`);
    let ok = false;
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const href = await evaluate('location.href');
      if (typeof href === 'string' && /index\.html/.test(href)) { ok = true; break; }
    }
    if (!ok) throw new Error('点击返回后没跳到 index.html，当前 ' + await evaluate('location.href'));
    // 轮询等聚合页渲染完（首次加载 index.html 可能要几百毫秒）
    let badgeRaw = null;
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      badgeRaw = await evaluate(`JSON.stringify({
        cleared: document.querySelectorAll('a.card.cleared').length,
        txt: document.getElementById('progtxt').textContent
      })`);
      if (JSON.parse(badgeRaw).cleared >= 1) break;
    }
    const b = JSON.parse(badgeRaw);
    if (b.cleared < 1) throw new Error('聚合页没显示已通关徽章');
    logs.push('跳回聚合页 OK，' + b.txt + '，徽章 ' + b.cleared + ' 个');
  } catch (e) {
    status = 'FAIL';
    logs.push('断言失败: ' + e.message);
  }
  results.push({ name: file + ' ' + name, status, logs });
}

// 收尾：验证清除记录
await nav('index');
await evaluate(`document.getElementById('reset').click()`);
const after = await evaluate(`document.getElementById('progtxt').textContent`);
results.push({ name: 'index 清除记录', status: /0\/\d+/.test(String(after)) ? 'PASS' : 'FAIL', logs: ['清除后: ' + after] });

finish();
