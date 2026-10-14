/*
 * 画面（SPEC 1章）
 *   #/notes        ノート一覧
 *   #/notes/new    新しいノート
 *   #/notes/<id>   ノート編集
 *   #/library      試薬・化合物ライブラリ
 *
 * データの読み書きは必ず Repository（js/repository.js）を通す。
 */
(function () {
  'use strict';

  var repo; // RepositoryReady の解決後に入る
  var view = document.getElementById('view');

  /* ---------- 小さなヘルパー ---------- */

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

  function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  var toastTimer;
  function toast(message, kind) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2200);
  }

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
    if (leaveGuard && leaveGuard() && !confirm('保存していない変更があります。破棄して移動しますか？')) {
      ignoreNextHash = true;
      location.hash = currentHash;
      return;
    }
    leaveGuard = null;
    currentHash = location.hash;

    var parts = (location.hash.replace(/^#\/?/, '') || 'notes').split('/');
    if (parts[0] === 'library') {
      renderLibrary();
    } else if (parts[0] === 'notes' && parts[1]) {
      renderEditor(parts[1] === 'new' ? null : decodeURIComponent(parts[1]));
    } else {
      renderNoteList();
    }
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

  /* ---------- 画面1: ノート一覧 ---------- */

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

      var rows = notes.map(function (n) {
        var open = function () { location.hash = '#/notes/' + encodeURIComponent(n.id); };
        return h('tr', { class: 'clickable', onclick: open, tabindex: '0',
          onkeydown: function (e) { if (e.key === 'Enter') open(); } },
          h('td', { class: 'mono' }, n.date || '—'),
          h('td', null, n.experimenter || h('span', { class: 'faint' }, '（未入力）')),
          h('td', null, schemeThumb(n)),
          h('td', { class: 'num' }, String((n.steps || []).length)),
          h('td', { class: 'mono faint' }, formatDateTime(n.updated_at)));
      });

      view.replaceChildren(head, h('div', { class: 'card' },
        h('table', { class: 'table' },
          h('thead', null, h('tr', null,
            h('th', { style: 'width:9em' }, '日付'),
            h('th', { style: 'width:12em' }, '実験者'),
            h('th', null, '反応式'),
            h('th', { class: 'num', style: 'width:6em' }, '手順数'),
            h('th', { style: 'width:11em' }, '更新日時'))),
          h('tbody', null, rows))));
    });
  }

  // 反応式の縮小図。構造式の取り込みはステップ5で実装するので、今は有無だけ表示する
  function schemeThumb(note) {
    var s = note.scheme || {};
    var has = s.cdxml_original || s.mol || s.smiles;
    return h('div', { class: 'scheme-thumb' + (has ? '' : ' none') }, has ? '反応式あり' : '反応式なし');
  }

  /* ---------- 画面2: ノート編集 ---------- */

  // 操作ボタンのグループ（SPEC 3章）。入力欄と文章生成はステップ4で実装する
  var OPERATION_GROUPS = [
    { title: '① 仕込み', ops: ['器具・雰囲気', '試薬を仕込む', '溶媒を加える', '滴下', '冷却'] },
    { title: '② 反応', ops: ['撹拌', '加熱還流', '加熱', '昇温・降温', 'TLCで追跡', '色・状態の変化'] },
    { title: '③ 後処理', ops: ['クエンチ', '抽出', '洗浄', '乾燥', 'ろ過', '濃縮'] },
    { title: '④ 精製', ops: ['カラムクロマト', '再結晶', '蒸留', '生成物・収率'] }
  ];

  var ROLE_LABELS = { limiting: '基準試薬', reagent: '試薬', solvent: '溶媒', product: '生成物' };

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
      buildEditor(note);
    });
  }

  function buildEditor(note) {
    var dirty = false;
    var saving = false;
    leaveGuard = function () { return dirty; };

    var status = h('span', { class: 'save-status' });
    function setDirty(value) {
      dirty = value;
      status.textContent = dirty ? '未保存の変更があります' : (note.updated_at ? '保存済み ' + formatDateTime(note.updated_at) : '');
      status.classList.toggle('dirty', dirty);
    }

    // 入力欄 ⇔ note のフィールドを結ぶ
    function bind(el, field, onChange) {
      el.value = note[field] || '';
      el.addEventListener('input', function () {
        note[field] = el.value;
        if (onChange) onChange();
        setDirty(true);
      });
      return el;
    }

    function save() {
      if (saving) return;
      saving = true;
      repo.notes.save(note).then(function (saved) {
        note = saved;
        setDirty(false);
        replaceHashSilently('#/notes/' + encodeURIComponent(saved.id));
        deleteBtn.disabled = false;
        title.textContent = 'ノート編集';
        toast('保存しました', 'success');
      }).catch(function (err) {
        console.error(err);
        toast('保存に失敗しました', 'danger');
      }).then(function () { saving = false; });
    }

    function remove() {
      if (!note.id) return;
      if (!confirm('このノートを削除しますか？この操作は取り消せません。')) return;
      repo.notes.delete(note.id).then(function () {
        dirty = false;
        toast('削除しました');
        location.hash = '#/notes';
      });
    }

    var title = h('h1', null, note.id ? 'ノート編集' : '新しいノート');
    var deleteBtn = h('button', { class: 'btn danger-ghost', onclick: remove, disabled: !note.id }, '削除');

    var toolbar = h('div', { class: 'page-head sticky' },
      h('div', { class: 'page-head-left' },
        h('a', { class: 'btn ghost', href: '#/notes' }, '← 一覧'),
        title),
      h('div', { class: 'page-head-right' },
        status, deleteBtn,
        h('button', { class: 'btn primary', onclick: save, title: 'Ctrl+S' }, '保存')));

    // 基本情報
    var basics = section('基本情報', h('div', { class: 'basics' },
      h('label', { class: 'field' }, h('span', null, '日付'),
        bind(h('input', { type: 'date' }), 'date')),
      h('label', { class: 'field grow' }, h('span', null, '実験者'),
        bind(h('input', { type: 'text', placeholder: '氏名' }), 'experimenter'))));

    // 反応式（ステップ5）
    var scheme = section('反応式', h('div', { class: 'dropzone' },
      h('p', null, 'CDXML をドロップ / MOL・SMILES を貼り付け'),
      h('p', { class: 'faint small' }, '構造式の取り込みはステップ5で実装予定です')));

    // 試薬表（ステップ2・3）
    var reagentRows = (note.reagents || []).map(function (r) {
      return h('tr', null,
        h('td', null, r.name || ''), h('td', null, ROLE_LABELS[r.role] || ''),
        h('td', { class: 'num' }, r.mw != null ? r.mw : '─'),
        h('td', { class: 'num' }, r.equiv != null ? r.equiv : '─'),
        h('td', { class: 'num' }, r.mmol != null ? r.mmol : '─'),
        h('td', { class: 'num' }, r.mass_mg != null ? r.mass_mg : '─'),
        h('td', { class: 'num' }, r.volume_mL != null ? r.volume_mL : '─'));
    });
    if (!reagentRows.length) {
      reagentRows = [h('tr', null, h('td', { colspan: '7', class: 'empty-row' }, 'まだ試薬はありません'))];
    }
    var reagents = section('試薬表',
      h('table', { class: 'table compact' },
        h('thead', null, h('tr', null,
          h('th', null, '名前'), h('th', null, '役割'),
          h('th', { class: 'num' }, '分子量'), h('th', { class: 'num' }, '当量'),
          h('th', { class: 'num' }, 'mmol'), h('th', { class: 'num' }, '質量 (mg)'),
          h('th', { class: 'num' }, '体積 (mL)'))),
        h('tbody', null, reagentRows)),
      h('button', { class: 'btn', disabled: true, title: 'ステップ2で実装予定' }, '＋ 試薬を追加'));

    // 操作ボタン ＋ 手順リスト（ステップ4）
    var opPanel = h('div', { class: 'ops' }, OPERATION_GROUPS.map(function (g) {
      return h('div', { class: 'op-group' },
        h('h3', null, g.title),
        h('div', { class: 'op-buttons' }, g.ops.map(function (label) {
          return h('button', { class: 'btn op', disabled: true, title: 'ステップ4で実装予定' }, label);
        })));
    }));
    var stepItems = (note.steps || []).slice().sort(function (a, b) { return a.order - b.order; })
      .map(function (s, i) { return h('li', null, (i + 1) + '. ' + s.op_type); });
    var stepList = h('div', { class: 'steps' },
      h('h3', null, '手順リスト'),
      stepItems.length ? h('ol', null, stepItems) : h('p', { class: 'faint' }, 'まだ手順はありません。左の操作ボタンから追加します（ステップ4で実装予定）。'));
    var procedure = section('手順', h('div', { class: 'split' }, opPanel, stepList));

    // 日本語文・英語文（手で修正したら text_edited を立てる）
    var markEdited = function () { note.text_edited = true; };
    var texts = section('文章', h('div', { class: 'split' },
      h('label', { class: 'field' }, h('span', null, '日本語文'),
        bind(h('textarea', { rows: '7', placeholder: '手順から自動生成されます（ステップ4）。手で修正もできます。' }), 'text_ja', markEdited)),
      h('label', { class: 'field' }, h('span', null, '英語文'),
        bind(h('textarea', { rows: '7', lang: 'en', placeholder: 'Generated from the procedure (step 4). Editable.' }), 'text_en', markEdited))));

    var memo = section('メモ',
      bind(h('textarea', { rows: '5', placeholder: '自由記述' }), 'memo'));

    view.replaceChildren(toolbar, h('div', { class: 'editor' }, basics, scheme, reagents, procedure, texts, memo));
    setDirty(false);

    // Ctrl+S / ⌘S で保存（この画面にいる間だけ）
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    }
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', function off() {
      if (!document.body.contains(toolbar)) {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('hashchange', off);
      }
    });
  }

  function section(title) {
    var body = Array.prototype.slice.call(arguments, 1);
    return h('section', { class: 'card section' }, h('h2', null, title), body);
  }

  /* ---------- 画面3: 試薬・化合物ライブラリ ---------- */

  var KIND_TABS = [
    { key: 'all', label: 'すべて' },
    { key: 'reagent', label: '試薬' },
    { key: 'solvent', label: '溶媒' },
    { key: 'compound', label: '合成した化合物' }
  ];
  var libraryTab = 'all';

  function renderLibrary() {
    setActiveNav('library');
    view.replaceChildren(h('p', { class: 'loading' }, '読み込み中…'));

    repo.library.list().then(function (items) {
      var tabs = h('div', { class: 'tabs' }, KIND_TABS.map(function (t) {
        return h('button', { class: 'tab' + (t.key === libraryTab ? ' active' : ''),
          onclick: function () { libraryTab = t.key; renderLibrary(); } }, t.label);
      }));

      var shown = items.filter(function (it) { return libraryTab === 'all' || it.kind === libraryTab; });
      var body;
      if (!shown.length) {
        body = h('div', { class: 'empty' },
          h('p', null, '登録された試薬・化合物はまだありません。'),
          h('p', { class: 'faint small' }, '登録・編集・検索はステップ2で実装予定です。'));
      } else {
        body = h('table', { class: 'table' },
          h('thead', null, h('tr', null,
            h('th', null, '★'), h('th', null, '略称'), h('th', null, '日本語名'), h('th', null, '英語名'),
            h('th', { class: 'num' }, '分子量'), h('th', null, 'CAS'), h('th', null, '化合物番号'))),
          h('tbody', null, shown.map(function (it) {
            return h('tr', null,
              h('td', null, it.favorite ? '★' : ''), h('td', null, it.abbreviation || ''),
              h('td', null, it.name_ja || ''), h('td', null, it.name_en || ''),
              h('td', { class: 'num' }, it.mw != null ? it.mw : ''),
              h('td', { class: 'mono' }, it.cas || ''), h('td', null, it.compound_no ? h('b', null, it.compound_no) : ''));
          })));
      }

      view.replaceChildren(
        h('div', { class: 'page-head' },
          h('h1', null, '試薬・化合物ライブラリ'),
          h('div', { class: 'page-head-right' },
            h('input', { type: 'search', class: 'search', placeholder: '名前・略称・CAS・化合物番号で検索', disabled: true, title: 'ステップ2で実装予定' }),
            h('button', { class: 'btn primary', disabled: true, title: 'ステップ2で実装予定' }, '＋ 新規登録'))),
        h('div', { class: 'card' }, tabs, body));
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
