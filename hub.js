/* 聚合页中枢：常驻返回条 + 通关结算面板 + 通关进度记录（零依赖） */
(function () {
  var HUB = 'index.html';
  var KEY = 'sciGamesCleared';

  function gid() {
    var m = location.pathname.match(/([^\/\\]+)\.html$/i);
    return m ? m[1].toLowerCase() : location.pathname;
  }
  var GID = gid();

  function getAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function mark(win) {
    if (!win) return;
    try { var s = getAll(); s[GID] = 1; localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { }
  }

  var css =
    '.hub-back{position:fixed;top:12px;right:12px;z-index:9998;display:inline-flex;align-items:center;gap:4px;' +
    'background:rgba(16,22,38,.8);color:#cfe0ff;border:1px solid rgba(130,170,225,.35);padding:7px 14px;' +
    'border-radius:20px;font:13px/1 "Microsoft YaHei",sans-serif;text-decoration:none;opacity:.75;transition:.15s;cursor:pointer}' +
    '.hub-back:hover{opacity:1;background:#26385f;color:#fff;transform:translateY(-1px)}' +
    '#hubEnd{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;' +
    'background:rgba(5,8,16,.74);padding:20px;font-family:"Microsoft YaHei",sans-serif}' +
    '.hub-card{background:#141c30;border:1px solid #2f4269;border-radius:16px;max-width:420px;width:100%;' +
    'padding:26px 24px;text-align:center;color:#eef2f7;box-shadow:0 18px 50px rgba(0,0,0,.55)}' +
    '.hub-card h2{font-size:21px;margin-bottom:10px;color:#ffd166;line-height:1.4}' +
    '.hub-text{font-size:14px;line-height:1.75;color:#c2d0ea;margin-bottom:4px}' +
    '.hub-stat{font-size:13px;color:#8fa3c8;margin-top:10px}' +
    '.hub-btns{display:flex;gap:10px;justify-content:center;margin-top:20px;flex-wrap:wrap}' +
    '.hub-btn{border:none;padding:10px 18px;border-radius:9px;font-size:14px;cursor:pointer;font-weight:bold;' +
    'font-family:inherit;transition:.15s}' +
    '.hub-btn.again{background:#ffd166;color:#1b1b1b}' +
    '.hub-btn.home{background:#2a3468;color:#fff}' +
    '.hub-btn.more{background:transparent;color:#9db2d0;border:1px solid #3a4c74}' +
    '.hub-btn:hover{filter:brightness(1.12);transform:translateY(-1px)}';

  var st = document.createElement('style');
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  function mountBar() {
    if (document.querySelector('.hub-back')) return;
    var a = document.createElement('a');
    a.className = 'hub-back';
    a.href = HUB;
    a.textContent = '← 聚合页';
    document.body.appendChild(a);
  }

  function mountCard() {
    var d = document.getElementById('hubEnd');
    if (d) return d;
    d = document.createElement('div');
    d.id = 'hubEnd';
    d.innerHTML =
      '<div class="hub-card">' +
      '<h2 id="hubTitle"></h2>' +
      '<div class="hub-text" id="hubText"></div>' +
      '<div class="hub-stat" id="hubStat"></div>' +
      '<div class="hub-btns">' +
      '<button class="hub-btn again" id="hubAgain">🔁 再玩一次</button>' +
      '<button class="hub-btn home" id="hubHome">🏠 返回聚合页</button>' +
      '<button class="hub-btn more" id="hubMore" style="display:none">继续玩</button>' +
      '</div></div>';
    document.body.appendChild(d);
    document.getElementById('hubAgain').onclick = function () { location.reload(); };
    document.getElementById('hubHome').onclick = function () { location.href = HUB; };
    document.getElementById('hubMore').onclick = function () { d.style.display = 'none'; };
    return d;
  }

  window.hub = {
    finish: function (o) {
      o = o || {};
      var d = mountCard();
      document.getElementById('hubTitle').textContent = o.title || (o.win ? '🏆 通关！' : '😵 结束');
      document.getElementById('hubText').textContent = o.text || '';
      document.getElementById('hubStat').textContent = o.stat || '';
      var more = document.getElementById('hubMore');
      more.style.display = o.canContinue ? '' : 'none';
      more.textContent = o.moreText || '继续玩';
      d.style.display = 'flex';
      mark(!!o.win);
    },
    back: function () { location.href = HUB; },
    id: GID
  };

  if (document.body) mountBar();
  else document.addEventListener('DOMContentLoaded', mountBar);
})();
