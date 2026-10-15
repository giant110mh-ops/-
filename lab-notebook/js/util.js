/*
 * 共通ヘルパー（DOM 生成・検索用の文字正規化・数値の丸め・ダイアログ・通知）
 * すべて window.LN 名前空間に置く。
 */
(function (global) {
  'use strict';

  var LN = global.LN = global.LN || {};

  /* ---------- DOM ---------- */

  // h('div', {class: 'x', onclick: fn}, child1, 'text', ...)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var v = attrs[key];
        if (v == null || v === false) return;
        if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), v);
        else if (key === 'class') el.className = v;
        else if (key === 'value') el.value = v;
        else if (key === 'checked') el.checked = !!v;
        else if (key === 'html') el.innerHTML = v;
        else el.setAttribute(key, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 生成文・手で修正した文に残してよいタグだけを通す
  var ALLOWED_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', SUB: 'sub', SUP: 'sup', BR: 'br' };
  function sanitizeHtml(html) {
    var box = document.createElement('div');
    box.innerHTML = html || '';
    function walk(node) {
      var out = '';
      node.childNodes.forEach(function (c) {
        if (c.nodeType === 3) { out += escapeHtml(c.nodeValue); return; }
        if (c.nodeType !== 1) return;
        var tag = ALLOWED_TAGS[c.tagName];
        var inner = walk(c);
        if (tag === 'br') out += '<br>';
        else if (tag) out += '<' + tag + '>' + inner + '</' + tag + '>';
        else if (c.tagName === 'DIV' || c.tagName === 'P') out += (out ? '<br>' : '') + inner;
        else out += inner;
      });
      return out;
    }
    return walk(box);
  }

  function htmlToText(html) {
    var box = document.createElement('div');
    box.innerHTML = (html || '').replace(/<br\s*\/?>/gi, '\n');
    return box.textContent;
  }

  /* ---------- 検索用の正規化（SPEC 5章） ---------- */
  // 大文字小文字・全角半角・ひらがなカタカナを区別しない
  function normalizeForSearch(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
      .replace(/[‐-―−]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 空白区切りの語がすべてどれかのフィールドに含まれていれば一致
  function matchesQuery(query, fields) {
    var q = normalizeForSearch(query);
    if (!q) return true;
    var hay = fields.map(normalizeForSearch).join('\n');
    return q.split(' ').every(function (term) { return hay.indexOf(term) !== -1; });
  }

  /* ---------- 数値（SPEC 4章「数値の丸め」） ---------- */

  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  function parseNum(s) {
    if (s == null) return null;
    var t = String(s).normalize('NFKC').replace(/,/g, '').replace(/[−–]/g, '-').trim();
    if (t === '') return null;
    var v = Number(t);
    return isFinite(v) ? v : null;
  }

  // 有効数字 n 桁（末尾の 0 は残す）
  function sig(x, n) {
    if (!isNum(x)) return '';
    if (x === 0) return '0';
    var digits = Math.floor(Math.log10(Math.abs(x))) + 1;
    if (digits >= n) return String(Math.round(x));
    return x.toFixed(Math.min(10, n - digits));
  }
  function stripZeros(s) {
    return s.indexOf('.') === -1 ? s : s.replace(/\.?0+$/, '');
  }

  var fmt = {
    // mmol: 有効数字3桁（2.00）
    mmol: function (x) { return sig(x, 3); },
    // 質量・体積: 有効数字3桁、小数点以下の不要な 0 は落とす（509 / 96 / 0.25）
    mass: function (x) { return isNum(x) ? stripZeros(sig(x, 3)) : ''; },
    volume: function (x) { return isNum(x) ? stripZeros(sig(x, 3)) : ''; },
    // 当量: 量（3桁）を超えない。最低でも小数1桁（1.0 / 1.2 / 1.05 / 10）
    equiv: function (x) {
      if (!isNum(x)) return '';
      var s = stripZeros(sig(x, 3));
      if (x < 10 && s.indexOf('.') === -1) s = Number(s).toFixed(1);
      return s;
    },
    // 収率: 整数の %
    yield: function (x) { return isNum(x) ? String(Math.round(x)) : ''; },
    mw: function (x) { return isNum(x) ? x.toFixed(2) : ''; },
    conc: function (x) { return isNum(x) ? sig(x, 2) : ''; },
    // 温度: 負号は U+2212
    temp: function (x) { return isNum(x) ? (x < 0 ? '−' + String(-x) : String(x)) : ''; },
    num: function (x) { return isNum(x) ? String(x) : ''; }
  };

  function todayString() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- 通知 ---------- */

  var toastTimer;
  function toast(message, kind) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2400);
  }

  /* ---------- ダイアログ ---------- */
  // openModal({title, body, actions: [{label, kind, onClick(close) -> false で閉じない}], size, onClose})
  var modalStack = [];
  function openModal(opts) {
    var backdrop = h('div', { class: 'modal-backdrop' });
    var dialog = h('div', { class: 'modal ' + (opts.size || ''), role: 'dialog', 'aria-modal': 'true' });
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      modalStack.splice(modalStack.indexOf(api), 1);
      if (opts.onClose) opts.onClose();
    }
    var head = h('div', { class: 'modal-head' },
      h('h2', null, opts.title || ''),
      h('button', { class: 'btn ghost icon', 'aria-label': '閉じる', onclick: close }, '✕'));
    var body = h('div', { class: 'modal-body' }, opts.body);
    var foot = null;
    if (opts.actions && opts.actions.length) {
      foot = h('div', { class: 'modal-foot' }, opts.actions.map(function (a) {
        if (a.spacer) return h('span', { class: 'spacer' });
        return h('button', { class: 'btn ' + (a.kind || ''), type: 'button', onclick: function () {
          if (a.onClick && a.onClick(close) === false) return;
          close();
        } }, a.label);
      }));
    }
    dialog.append(head, body);
    if (foot) dialog.append(foot);
    backdrop.append(dialog);
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop && !opts.sticky) close(); });
    document.body.append(backdrop);
    var api = { close: close, el: dialog, body: body };
    modalStack.push(api);
    setTimeout(function () {
      var first = dialog.querySelector('[autofocus], input:not([type=checkbox]):not([disabled]), select, textarea');
      if (first) first.focus();
    }, 0);
    return api;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalStack.length) {
      e.preventDefault();
      modalStack[modalStack.length - 1].close();
    }
  });

  // 確認ダイアログ（window.confirm は埋め込み表示で使えないため、ページ内に出す）
  // ask(message, { ok: 'ボタン名', danger: true }) → Promise<boolean>
  function ask(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var answered = false;
      LN.openModal({
        title: opts.title || '確認',
        body: h('p', { class: 'ask-text' }, message),
        onClose: function () { if (!answered) resolve(false); },
        actions: [
          { spacer: true },
          { label: opts.cancel || 'キャンセル', kind: 'ghost' },
          { label: opts.ok || 'OK', kind: opts.danger ? 'danger-solid' : 'primary', onClick: function () { answered = true; resolve(true); } }
        ]
      });
    });
  }

  // 他のページに埋め込まれて表示されているか（Artifact など。印刷・ダウンロードが使えない）
  var embedded = (function () { try { return global.self !== global.top; } catch (e) { return true; } })();

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // 書式付き（太字の化合物番号など）でコピーする。使えない環境ではテキストのみ
  function copyRich(html) {
    var text = htmlToText(html);
    if (navigator.clipboard && global.ClipboardItem) {
      return navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]).catch(function () { return fallback(); });
    }
    return fallback();
    function fallback() {
      var box = h('div', { contenteditable: 'true', style: 'position:fixed;left:-9999px;top:0', html: html });
      document.body.append(box);
      var range = document.createRange();
      range.selectNodeContents(box);
      var sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      sel.removeAllRanges();
      box.remove();
      return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
    }
  }

  LN.h = h;
  LN.escapeHtml = escapeHtml;
  LN.sanitizeHtml = sanitizeHtml;
  LN.htmlToText = htmlToText;
  LN.normalizeForSearch = normalizeForSearch;
  LN.matchesQuery = matchesQuery;
  LN.isNum = isNum;
  LN.parseNum = parseNum;
  LN.fmt = fmt;
  LN.todayString = todayString;
  LN.formatDateTime = formatDateTime;
  LN.newId = newId;
  LN.toast = toast;
  LN.openModal = openModal;
  LN.download = download;
  LN.ask = ask;
  LN.embedded = embedded;
  LN.copyRich = copyRich;
})(window);
