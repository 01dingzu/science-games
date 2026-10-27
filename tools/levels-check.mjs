// 关卡设计验证：① 光的迷宫 8 关的设计解是否真能通关 ② 各游戏关卡表是否健全
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
  for (const r of results) { if (r.status === 'PASS') pass++; else fail++; out += `\n[${r.status}] ${r.name}\n`; for (const l of r.logs) out += '  - ' + l + '\n'; }
  out += `\nSUMMARY: ${pass} pass / ${fail} fail\n`;
  try { writeFileSync(join(DIR, 'levels-check-report.txt'), out, 'utf8'); } catch { }
  console.log(out);
  try { rmSync(profile, { recursive: true, force: true }); } catch { }
  try { proc && proc.kill(); } catch { }
  try { server && server.close(); } catch { }
  process.exit(fail ? 1 : 0);
}
process.on('uncaughtException', e => finish('UNCAUGHT: ' + (e?.stack || e)));
setTimeout(() => finish('WATCHDOG'), 120000);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
server = http.createServer((req, res) => {
  const p = join(DIR, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  let data = null, ok = false;
  try { data = readFileSync(p); ok = true; } catch { }
  try { if (!res.headersSent) res.writeHead(ok ? 200 : 404, { 'Content-Type': ok ? (MIME[extname(p)] || 'application/octet-stream') : 'text/plain' }); if (!res.writableEnded) res.end(ok ? data : 'nf'); } catch { }
});
await new Promise((r, j) => { server.on('error', j); server.listen(0, '127.0.0.1', r); });
const BASE = `http://127.0.0.1:${server.address().port}/`;

const EXE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
if (!EXE) finish('no browser');
profile = mkdtempSync(join(tmpdir(), 'levels-'));
proc = spawn(EXE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getWsUrl() {
  const f = join(profile, 'DevToolsActivePort');
  let port = '';
  for (let i = 0; i < 40; i++) { try { port = readFileSync(f, 'utf8').split('\n')[0].trim(); if (port) break; } catch { } await sleep(250); }
  for (let i = 0; i < 30; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const pg = list.find(t => t.type === 'page'); if (pg) return pg.webSocketDebuggerUrl; } catch { }
    await sleep(300);
  }
  throw new Error('cdp fail');
}
const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.result?.exceptionDetails) return '__ERR__ ' + String(r.result.exceptionDetails.text).slice(0, 160);
  return r.result?.result?.value;
};
await send('Runtime.enable');
async function nav(file) {
  await send('Page.navigate', { url: BASE + file + '.html' });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const h = await evaluate('location.href'); const rs = await evaluate('document.readyState');
    if (typeof h === 'string' && h.includes(file) && rs === 'complete') { await sleep(300); return; }
  }
  throw new Error('加载失败 ' + file);
}
async function check(name, fn) {
  const logs = []; let status = 'PASS';
  try { await fn(logs); } catch (e) { status = 'FAIL'; logs.push('失败: ' + e.message); }
  results.push({ name, status, logs });
}

// ---- 光的迷宫：8 关设计解 ----
// 每关的解：[x, y, 镜型(3=╱,4=╲)]
const OPTICS_SOL = [
  [[7,1,4]],
  [[3,0,4],[3,6,4]],
  [[6,4,4]],
  [[9,0,4],[9,7,3],[0,7,4]],
  [[2,4,3],[2,0,3]],
  [[2,6,3],[7,2,4]],
  [[3,0,4],[3,6,4]],
  [[6,7,3],[0,2,3],[0,5,4]],
];
await nav('7-optics');
const lvCount = await evaluate('LEVELS.length');
await check('光的迷宫：关卡数 = 8 且设计解全部可通', async logs => {
  if (lvCount !== 8) throw new Error('关卡数 = ' + lvCount);
  for (let i = 0; i < OPTICS_SOL.length; i++) {
    const sol = JSON.stringify(OPTICS_SOL[i]);
    const r = await evaluate(`(() => {
      loadLevel(${i});
      ${JSON.stringify(OPTICS_SOL[i])}.forEach(([x,y,t]) => { grid[y][x] = t; });
      trace();
      const used = ${JSON.stringify(OPTICS_SOL[i])}.length;
      return JSON.stringify({won, used, mir: LEVELS[${i}].mir});
    })()`);
    const j = JSON.parse(r);
    if (!j.won) throw new Error('第 ' + (i+1) + ' 关设计解不通');
    if (j.used > j.mir) throw new Error('第 ' + (i+1) + ' 关镜子额度不足：需 ' + j.used + ' > 给 ' + j.mir);
    logs.push('第 ' + (i+1) + ' 关 ✓ 需 ' + j.used + ' 面镜 / 额度 ' + j.mir);
  }
});

// ---- 各游戏关卡表健全性 ----
const TABLES = [
  ['1-fusion', 'LEVELS', 6], ['2-valence', 'LEVELS', 6], ['3-bacteria', 'LEVELS', 4],
  ['4-mito', 'STAGES', 5], ['5-bridge', 'LEVELS', 5], ['6-factory', 'ORDERS', 6],
  ['9-fission', 'LEVELS', 5], ['10-chip', 'CHAPTERS', 4],
];
for (const [file, table, n] of TABLES) {
  await nav(file);
  const len = await evaluate(`typeof ${table} !== 'undefined' ? ${table}.length : -1`);
  await check(file + ' 关卡表 ' + table, async logs => {
    if (len !== n) throw new Error(table + '.length = ' + len + '，期望 ' + n);
    logs.push(table + ' 共 ' + len + ' 关/阶段');
  });
}

// ---- 关键梯度：工厂步数递增、裂变目标递增、炼金目标递增 ----
await nav('6-factory');
const steps = await evaluate('ORDERS.map(o => o.steps.length).join(",")');
await check('万物工厂：工序数递增（难度梯度）', async logs => {
  const arr = String(steps).split(',').map(Number);
  if (arr[0] > arr[arr.length-1]) throw new Error('步数没有递增: ' + steps);
  if (arr[0] >= arr[arr.length-1]) throw new Error('首关应最简单: ' + steps);
  logs.push('各单工序数: ' + steps);
});
await nav('9-fission');
const goals = await evaluate('LEVELS.map(l => l.goal).join(",")');
await check('分子弹球：目标能量递增', async logs => {
  const arr = String(goals).split(',').map(Number);
  for (let i = 1; i < arr.length; i++) if (arr[i] <= arr[i-1]) throw new Error('目标未递增: ' + goals);
  logs.push('各关目标: ' + goals);
});
await nav('1-fusion');
const fgoals = await evaluate('LEVELS.map(l => l.goal).join(",")');
await check('元素炼金塔：目标元素递进', async logs => {
  const arr = String(fgoals).split(',').map(Number);
  if (arr[arr.length-1] !== 5) throw new Error('终局应指向铁(5): ' + fgoals);
  if (arr[0] !== 1) throw new Error('首关目标应为氦(1): ' + fgoals);
  logs.push('各关目标: ' + fgoals);
});
await nav('4-mito');
const sgoals = await evaluate('STAGES.map(s => s.goal).join(",")');
await check('线粒体经理：阶段目标递增', async logs => {
  const arr = String(sgoals).split(',').map(Number);
  for (let i = 1; i < arr.length; i++) if (arr[i] <= arr[i-1]) throw new Error('未递增: ' + sgoals);
  logs.push('各阶段目标: ' + sgoals);
});
/* 14-circuit / 15-steam：关卡设计解与预算的静态校验（不用浏览器，直接跑页面里的纯逻辑） */
{
  const seg = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return (i < 0 || j < 0) ? null : s.slice(i, j); };
  const lastScript = f => { const m = [...readFileSync(join(DIR, f), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]; return m[m.length - 1][1]; };

  const code14 = seg(lastScript('14-circuit.html'), 'const ROWS', '/* ---------- 关卡装载');
  await check('电路迷宫：6 关设计解可通 + 短路/断路检出', async logs => {
    if (!code14) throw new Error('代码段提取失败（注释锚点变了？）');
    const api = new Function(code14 + '\nreturn {LEVELS, DIFF, solve, setGrid(g){grid=g;}};')();
    const { LEVELS, DIFF, solve, setGrid } = api;
    if (DIFF.length !== LEVELS.length) throw new Error('DIFF 长度 ' + DIFF.length + ' ≠ 关卡数 ' + LEVELS.length);
    const COLS = 6;
    LEVELS.forEach((L, li) => {
      const g = new Array(36).fill(null);
      g[2 * COLS + 1] = { k: 'src', dir: 0 };
      L.lamps.forEach(([r, c]) => { g[r * COLS + c] = { k: 'lamp', dir: 0, R: 20 }; });
      (L.walls || []).forEach(([r, c]) => { g[r * COLS + c] = { k: 'wall' }; });
      L.sol.forEach(([r, c, k, R, dir]) => { g[r * COLS + c] = k === 'wire' ? { k: 'wire' } : { k, R, dir: dir || 0 }; });
      setGrid(g);
      const r = solve();
      const pmax = r.P && r.P.length ? Math.max.apply(null, r.P) : 0;
      const pmin = r.P && r.P.length ? Math.min.apply(null, r.P) : 0;
      if (r.short) throw new Error('L' + (li + 1) + ' 设计解短路');
      if (r.open || pmax <= 0) throw new Error('L' + (li + 1) + ' 设计解断路');
      if (!(pmax >= L.lo && pmax <= L.hi)) throw new Error('L' + (li + 1) + ' 功率 ' + pmax.toFixed(2) + 'W 不在 [' + L.lo + ',' + L.hi + ']');
      if (pmin < L.lo * 0.85) throw new Error('L' + (li + 1) + ' 有灯泡被旁路 P=' + pmin.toFixed(2) + 'W');
      if (r.I > L.imax + 1e-9) throw new Error('L' + (li + 1) + ' 超保险丝 ' + r.I.toFixed(3) + 'A');
    });
    const g2 = new Array(36).fill(null);
    g2[2 * COLS + 1] = { k: 'src', dir: 0 };
    g2[2 * COLS + 0] = { k: 'wire' }; g2[3 * COLS + 0] = { k: 'wire' };
    g2[3 * COLS + 1] = { k: 'wire' }; g2[3 * COLS + 2] = { k: 'wire' }; g2[2 * COLS + 2] = { k: 'wire' };
    setGrid(g2);
    if (!solve().short) throw new Error('导线直连电池两端 = 短路，未检出');
    const g3 = new Array(36).fill(null);
    g3[2 * COLS + 1] = { k: 'src', dir: 0 }; g3[2 * COLS + 2] = { k: 'lamp', dir: 0, R: 20 };
    setGrid(g3);
    if (!solve().open) throw new Error('回路没闭合 = 断路，未检出');
    logs.push('6 关设计解全部可通 · 短路/断路检出 OK');
  });

  const code15 = seg(lastScript('15-steam.html'), 'const Q = 25;', '/* ---------- 绘制');
  await check('蒸汽机调度：6 关煤/水预算可完成', async logs => {
    if (!code15) throw new Error('代码段提取失败（注释锚点变了？）');
    const api = new Function(code15 + '\nreturn {LEVELS, DIFF, coalFor, etaCarnot, etaReal};')();
    const { LEVELS, DIFF, coalFor } = api;
    if (DIFF.length !== LEVELS.length) throw new Error('DIFF 长度 ' + DIFF.length + ' ≠ 关卡数 ' + LEVELS.length);
    LEVELS.forEach((l, li) => {
      const n = l.rounds.length;
      const cap = l.burst ? l.burst - 20 : 1200;      // 贪心策略：压着安全线升温
      let thv = 600; const ths = [];
      for (let k = 0; k < n; k++) { ths.push(thv); thv = Math.min(cap, thv + l.inertia); }
      const order = l.rounds.map((d, k) => k).sort((a, b) => l.rounds[b] - l.rounds[a]);
      const tcs = new Array(n).fill(300);             // 冷却水优先给尖峰轮
      let w = l.water;
      for (const k of order) {
        while (w >= 0.5 && tcs[k] > 280) { tcs[k] -= 1; w -= 0.5; }
        if (w < 0.5) break;
      }
      let used = 0;
      for (let k = 0; k < n; k++) {
        used += l.rounds[k] / ((0.6 * (1 - tcs[k] / ths[k])) * 25);
      }
      if (used > l.coal) throw new Error('L' + (li + 1) + ' 煤预算不够：最优策略需 ' + used.toFixed(1) + ' > ' + l.coal);
      if (used > l.coal * 0.95) throw new Error('L' + (li + 1) + ' 余量不足 5%，太苛刻');
      logs.push('L' + (li + 1) + ' ' + l.name + '：耗煤 ' + used.toFixed(1) + '/' + l.coal + '（余 ' + ((l.coal - used) / l.coal * 100).toFixed(0) + '%）');
    });
  });
}
finish();
