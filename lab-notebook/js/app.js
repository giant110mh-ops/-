/*
 * 画面の切り替えとノート一覧（SPEC 1章・9章ステップ6）
 *   #/notes        ノート一覧（検索）
 *   #/notes/new    新しいノート
 *   #/notes/<id>   ノート編集（js/editor.js）
 *   #/library      試薬・化合物ライブラリ（js/library.js）
 *
 * データの読み書きは必ず Repository（js/repository.js）を通す。
 */
(function () {
  'use strict';

  var LN = window.LN;
  var h = LN.h;
  var repo; // RepositoryReady の解決後に入る
  var view = document.getElementById('view');

  function setActiveNav(name) {
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.nav === name);
    });
  }

  /* ---------- ルーティングと「未保存の変更」ガード ---------- */

  var leaveGuard = null;   // 画面が未保存の変更を持つとき true を返す関数
  var currentHash = null;
  var ignoreNextHash = false;

  function route() {
    if (ignoreNextHash) { ignoreNextHash = false; currentHash = location.hash; return; }
    if (leaveGuard && leaveGuard()) {
      var target = location.hash;
      ignoreNextHash = true;
      location.hash = currentHash;
      LN.ask('保存していない変更があります。破棄して移動しますか？', { ok: '破棄して移動', danger: true }).then(function (ok) {
        if (!ok) return;
        leaveGuard = null;
        location.hash = target;
      });
      return;
    }
    leaveGuard = null;
    currentHash = location.hash;
    document.querySelectorAll('.modal-backdrop').forEach(function (m) { m.remove(); });

    var parts = (location.hash.replace(/^#\/?/, '') || 'notes').split('/');
    if (parts[0] === 'library') {
      setActiveNav('library');
      LN.library.renderScreen(view);
    } else if (parts[0] === 'notes' && parts[1]) {
      renderEditor(parts[1] === 'new' ? null : decodeURIComponent(parts[1]));
    } else {
      renderNoteList();
    }
    window.scrollTo(0, 0);
  }

  // 画面を作り直さずに URL だけ変える（新規ノートの初回保存時など）
  function replaceHashSilently(hash) {
    if (location.hash === hash) return;
    ignoreNextHash = true;
    location.replace(hash);
  }

  window.addEventListener('beforeunload', function (e) {
    if (leaveGuard && leaveGuard()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- ノート一覧 ---------- */

  var listState = { query: '', experimenter: '', phase: '' };

  function noteSearchFields(n) {
    var f = [n.date, n.experimenter, n.memo, LN.htmlToText(n.text_ja), LN.htmlToText(n.text_en)];
    (n.reagents || []).forEach(function (r) { f.push(r.name, r.name_ja, r.name_en, r.abbreviation, r.compound_no); });
    ((n.scheme && n.scheme.molecules) || []).forEach(function (m) { f.push(m.label, m.formula); });
    return f;
  }

  function phasesOf(n) {
    var set = {};
    (n.steps || []).forEach(function (s) {
      if (s.op_type === 'column') { var c = LN.ops.phaseCategory(s.params && s.params.phase); if (c) set[c] = 1; }
      if (s.op_type === 'tlc' && s.params && s.params.plate === 'Al2O3') set.alumina = 1;
    });
    return set;
  }

  function productSummary(n) {
    return (n.reagents || []).filter(function (r) { return r.role === 'product'; }).map(function (r) {
      var name = r.compound_no || r.abbreviation || r.name_ja || r.name_en || '生成物';
      return name + (LN.isNum(r.yield) ? ' ' + LN.fmt.yield(r.yield) + '%' : '');
    }).join(', ');
  }

  function renderNoteList() {
    setActiveNav('notes');
    view.replaceChildren(h('p', { class: 'loading' }, '読み込み中…'));

    repo.notes.list().then(function (notes) {
      var head = h('div', { class: 'page-head' },
        h('h1', null, 'ノート一覧'),
        h('a', { class: 'btn primary', href: '#/notes/new' }, '＋ 新しいノート'));

      if (!notes.length) {
        view.replaceChildren(head, h('div', { class: 'empty card' },
          h('p', null, 'ノートはまだありません。'),
          h('a', { class: 'btn primary', href: '#/notes/new' }, '最初のノートを作る')));
        return;
      }

      var experimenters = {};
      notes.forEach(function (n) { if (n.experimenter) experimenters[n.experimenter] = 1; });

      var search = h('input', { type: 'search', class: 'search wide-search', value: listState.query,
        placeholder: '試薬名・化合物番号・実験者・日付・本文・メモで検索' });
      var expSel = h('select', null, h('option', { value: '' }, '実験者: すべて'),
        Object.keys(experimenters).sort().map(function (e) { return h('option', { value: e }, e); }));
      expSel.value = listState.experimenter;
      var phaseSel = h('select', null,
        h('option', { value: '' }, '固定相: すべて'),
        h('option', { value: 'silica' }, 'シリカゲルを使用'),
        h('option', { value: 'alumina' }, 'アルミナを使用'),
        h('option', { value: 'other' }, 'その他の固定相'));
      phaseSel.value = listState.phase;
      var count = h('span', { class: 'faint small' });
      var tbody = h('tbody');

      function draw() {
        listState.query = search.value;
        listState.experimenter = expSel.value;
        listState.phase = phaseSel.value;
        var shown = notes.filter(function (n) {
          if (listState.experimenter && n.experimenter !== listState.experimenter) return false;
          if (listState.phase && !phasesOf(n)[listState.phase]) return false;
          return LN.matchesQuery(listState.query, noteSearchFields(n));
        });
        count.textContent = shown.length + ' / ' + notes.length + ' 件';
        if (!shown.length) {
          tbody.replaceChildren(h('tr', null, h('td', { colspan: '5', class: 'empty-row' }, '条件に一致するノートはありません')));
          return;
        }
        tbody.replaceChildren.apply(tbody, shown.map(function (n) {
          var open = function () { location.hash = '#/notes/' + encodeURIComponent(n.id); };
          var reagents = (n.reagents || []).filter(function (r) { return r.role !== 'product'; })
            .map(function (r) { return r.compound_no || r.abbreviation || r.name_ja || r.name_en; }).filter(Boolean);
          return h('tr', { class: 'clickable', onclick: open, tabindex: '0',
            onkeydown: function (e) { if (e.key === 'Enter') open(); } },
            h('td', { class: 'mono' }, n.date || '—'),
            h('td', null, n.experimenter || h('span', { class: 'faint' }, '（未入力）')),
            h('td', null, schemeThumb(n)),
            h('td', null,
              h('div', { class: 'list-reagents' }, reagents.join('、') || h('span', { class: 'faint' }, '試薬未入力')),
              productSummary(n) ? h('div', { class: 'list-product' }, '→ ' + productSummary(n)) : null),
            h('td', { class: 'mono faint small' }, LN.formatDateTime(n.updated_at)));
        }));
      }
      [search, expSel, phaseSel].forEach(function (el) { el.addEventListener('input', draw); });

      view.replaceChildren(head,
        h('div', { class: 'filters' }, search, expSel, phaseSel, count),
        h('div', { class: 'card' },
          h('table', { class: 'table note-table' },
            h('thead', null, h('tr', null,
              h('th', { style: 'width:8em' }, '日付'),
              h('th', { style: 'width:9em' }, '実験者'),
              h('th', { style: 'width:300px' }, '反応式'),
              h('th', null, '試薬 → 生成物'),
              h('th', { style: 'width:10em' }, '更新日時'))),
            tbody)));
      draw();
    });
  }

  // 反応式の縮小図
  function schemeThumb(note) {
    var s = note.scheme || {};
    var svg = s.show_edited && s.edited_svg ? s.edited_svg : s.svg;
    if (svg) return h('div', { class: 'scheme-thumb', html: svg });
    if (s.smiles) return h('div', { class: 'scheme-thumb none mono small' }, s.smiles.length > 40 ? s.smiles.slice(0, 40) + '…' : s.smiles);
    return h('div', { class: 'scheme-thumb none' }, '反応式なし');
  }

  /* ---------- ノート編集 ---------- */

  function renderEditor(id) {
    setActiveNav('notes');
    view.replaceChildren(h('p', { class: 'loading' }, '読み込み中…'));
    var load = id ? repo.notes.get(id) : Promise.resolve(repo.newNote());
    load.then(function (note) {
      if (!note) {
        view.replaceChildren(h('div', { class: 'empty card' },
          h('p', null, 'ノートが見つかりません。'),
          h('a', { class: 'btn', href: '#/notes' }, 'ノート一覧へ戻る')));
        return;
      }
      LN.editor.render(view, note, {
        setLeaveGuard: function (fn) { leaveGuard = fn; },
        replaceHash: replaceHashSilently
      });
    });
  }

  /* ---------- 起動 ---------- */

  window.RepositoryReady.then(function (r) {
    repo = r;
    document.getElementById('storage-name').textContent = '保存先: ' + repo.storageName;
    window.addEventListener('hashchange', route);
    if (!location.hash) history.replaceState(null, '', '#/notes');
    route();
  });
})();
