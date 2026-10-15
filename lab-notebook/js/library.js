/*
 * 試薬・化合物ライブラリ（SPEC 5章）
 *   LN.library.renderScreen(view)        ライブラリ画面
 *   LN.library.openItemForm(item, opts)  登録・編集フォーム
 *   LN.library.openPicker(opts)          ノートから試薬を選ぶダイアログ
 */
(function (global) {
  'use strict';

  var LN = global.LN;
  var h = LN.h, fmt = LN.fmt, isNum = LN.isNum;

  var KINDS = [
    { key: 'reagent', label: '試薬' },
    { key: 'solvent', label: '溶媒' },
    { key: 'compound', label: '合成した化合物' }
  ];
  var KIND_LABEL = { reagent: '試薬', solvent: '溶媒', compound: '合成した化合物' };

  function repo() { return global.Repository; }

  function searchFields(it) {
    return [it.name_ja, it.name_en, it.abbreviation, it.cas, it.compound_no];
  }

  function displayName(it) {
    if (it.compound_no) return it.compound_no + (it.name_ja || it.name_en ? '（' + (it.name_ja || it.name_en) + '）' : '');
    return it.abbreviation || it.name_ja || it.name_en || '（名称未入力）';
  }

  function concText(it) {
    var parts = [];
    if (isNum(it.concentration_M)) parts.push(fmt.conc(it.concentration_M) + ' M' + (it.conc_solvent ? ' in ' + it.conc_solvent : ''));
    else if (isNum(it.purity) && it.purity < 1) parts.push(fmt.yield(it.purity * 100) + '%' + (it.conc_solvent ? ' in ' + it.conc_solvent : ''));
    if (isNum(it.density)) parts.push('d ' + it.density + ' g/mL');
    return parts.join(' / ');
  }

  // お気に入り → 最近使った順 → 名前順
  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1;
      var la = a.last_used_at || '', lb = b.last_used_at || '';
      if (la !== lb) return lb.localeCompare(la);
      return displayName(a).localeCompare(displayName(b), 'ja');
    });
  }

  function filterItems(items, query, kind) {
    return items.filter(function (it) {
      return (kind === 'all' || it.kind === kind) && LN.matchesQuery(query, searchFields(it));
    });
  }

  function markUsed(item) {
    if (!item || !item.id) return Promise.resolve(item);
    item.last_used_at = new Date().toISOString();
    return repo().library.save(item);
  }

  /* ---------- 画面: ライブラリ一覧 ---------- */

  var state = { kind: 'all', query: '' };

  function renderScreen(view) {
    view.replaceChildren(h('p', { class: 'loading' }, '読み込み中…'));
    repo().library.list().then(function (items) {
      var tbody = h('tbody');
      var countEl = h('span', { class: 'faint small' });
      var search = h('input', { type: 'search', class: 'search', placeholder: '名前・略称・CAS・化合物番号で検索', value: state.query,
        oninput: function () { state.query = search.value; draw(); } });
      var tabs = h('div', { class: 'tabs' });

      function drawTabs() {
        tabs.replaceChildren.apply(tabs, [{ key: 'all', label: 'すべて' }].concat(KINDS).map(function (t) {
          var n = t.key === 'all' ? items.length : items.filter(function (i) { return i.kind === t.key; }).length;
          return h('button', { class: 'tab' + (t.key === state.kind ? ' active' : ''),
            onclick: function () { state.kind = t.key; drawTabs(); draw(); } }, t.label, h('span', { class: 'count' }, String(n)));
        }));
      }

      function draw() {
        var shown = sortItems(filterItems(items, state.query, state.kind));
        countEl.textContent = shown.length + ' 件';
        if (!shown.length) {
          tbody.replaceChildren(h('tr', null, h('td', { colspan: '8', class: 'empty-row' },
            items.length ? '該当する試薬・化合物はありません' : 'まだ登録されていません。「＋ 新規登録」から追加してください。')));
          return;
        }
        tbody.replaceChildren.apply(tbody, shown.map(function (it) {
          var star = h('button', { class: 'star' + (it.favorite ? ' on' : ''), title: 'お気に入り', 'aria-label': 'お気に入り',
            onclick: function (e) {
              e.stopPropagation();
              it.favorite = !it.favorite;
              repo().library.save(it).then(function () { draw(); });
            } }, it.favorite ? '★' : '☆');
          return h('tr', { class: 'clickable', onclick: function () { edit(it); } },
            h('td', null, star),
            h('td', null, h('span', { class: 'kind-chip ' + it.kind }, KIND_LABEL[it.kind] || '')),
            h('td', null, it.compound_no ? h('b', null, it.compound_no) : (it.abbreviation || '')),
            h('td', null, it.name_ja || ''),
            h('td', null, it.name_en || ''),
            h('td', { class: 'num' }, fmt.mw(it.mw)),
            h('td', { class: 'small' }, concText(it)),
            h('td', { class: 'mono small' }, it.cas || ''));
        }));
      }

      function edit(it) {
        openItemForm(it, { onSaved: function () { renderScreen(view); }, onDeleted: function () { renderScreen(view); } });
      }

      view.replaceChildren(
        h('div', { class: 'page-head' },
          h('h1', null, '試薬・化合物ライブラリ'),
          h('div', { class: 'page-head-right' }, search,
            h('button', { class: 'btn primary', onclick: function () {
              openItemForm(null, { kind: state.kind === 'all' ? 'reagent' : state.kind, onSaved: function () { renderScreen(view); } });
            } }, '＋ 新規登録'))),
        h('div', { class: 'card' },
          h('div', { class: 'tabs-row' }, tabs, countEl),
          h('table', { class: 'table' },
            h('thead', null, h('tr', null,
              h('th', { style: 'width:3em' }, '★'), h('th', { style: 'width:9em' }, '種類'), h('th', null, '略称／番号'),
              h('th', null, '日本語名'), h('th', null, '英語名'), h('th', { class: 'num' }, '分子量'),
              h('th', null, '濃度・純度・密度'), h('th', null, 'CAS'))),
            tbody)));
      drawTabs();
      draw();
      search.focus();
    });
  }

  /* ---------- 登録・編集フォーム ---------- */
  // opts: { kind, prefill, onSaved(item), onDeleted(), saveOption: true → 「ライブラリに保存」チェックを出す,
  //         onUse(item, saved) : saveOption 時の確定処理 }
  function openItemForm(item, opts) {
    opts = opts || {};
    var it = Object.assign(repo().newLibraryItem(), item || {}, opts.prefill || {});
    if (!item && opts.kind) it.kind = opts.kind;
    var isEdit = !!(item && item.id);

    function text(key, attrs) {
      var input = h('input', Object.assign({ type: 'text', value: it[key] || '' }, attrs || {}));
      input.addEventListener('input', function () { it[key] = input.value; });
      return input;
    }
    function num(key, scale) {
      scale = scale || 1;
      var input = h('input', { type: 'text', inputmode: 'decimal', class: 'num-input', value: isNum(it[key]) ? String(Math.round(it[key] * scale * 1e6) / 1e6) : '' });
      input.addEventListener('input', function () {
        var v = LN.parseNum(input.value);
        it[key] = v == null ? null : v / scale;
      });
      return input;
    }
    function field(label, control, hint, cls) {
      return h('label', { class: 'field ' + (cls || '') }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
    }

    var kindSel = h('select', null, KINDS.map(function (k) { return h('option', { value: k.key }, k.label); }));
    kindSel.value = it.kind;
    var mwInput = num('mw');
    var compoundRow = field('化合物番号', text('compound_no', { placeholder: '例: 2a' }), '次の反応で原料として呼び出すときに使います');
    function syncKind() { compoundRow.hidden = it.kind !== 'compound'; }
    kindSel.addEventListener('change', function () { it.kind = kindSel.value; syncKind(); });
    syncKind();

    // 構造（MOL / SMILES / CDXML）から分子量を計算
    var structStatus = h('small', { class: 'hint' }, it.structure && (it.structure.mol || it.structure.cdxml) ? '構造が登録されています' : '');
    var structText = h('textarea', { rows: '3', placeholder: 'MOL テキストや SMILES を貼り付け', class: 'mono small' });
    if (it.structure && it.structure.mol) structText.value = it.structure.mol;
    var fileInput = h('input', { type: 'file', accept: '.mol,.cdxml,.rxn,.sdf', hidden: true, onchange: function () {
      var f = fileInput.files[0];
      if (!f) return;
      f.text().then(function (t) { applyStructure(t, f.name); });
    } });
    function applyStructure(t, filename) {
      try {
        var res = LN.chem.mwFromText(t);
        var r = LN.chem.importText(t, filename);
        it.structure = it.structure || {};
        if (r.format === 'cdxml') it.structure.cdxml = t;
        it.structure.mol = res.molfile || (r.format === 'smiles' ? null : t);
        if (r.format === 'smiles') it.structure.smiles = t.trim();
        if (isNum(res.mw)) {
          it.mw = Math.round(res.mw * 100) / 100;
          mwInput.value = it.mw.toFixed(2);
        }
        structStatus.textContent = res.formula + (isNum(res.mw) ? '（分子量 ' + fmt.mw(res.mw) + '）' : '（略号を含むため分子量は計算できません）');
      } catch (e) {
        structStatus.textContent = e.message;
      }
    }
    var structBox = h('div', { class: 'struct-input' }, structText,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: function () { applyStructure(structText.value); } }, '構造から分子量を計算'),
        h('button', { class: 'btn small', type: 'button', onclick: function () { fileInput.click(); } }, 'ファイルを選ぶ'),
        fileInput),
      structStatus);

    var fav = h('input', { type: 'checkbox', checked: !!it.favorite, onchange: function () { it.favorite = fav.checked; } });
    var saveToLib = h('input', { type: 'checkbox', checked: true });

    var body = h('div', { class: 'form-grid' },
      field('種類', kindSel),
      compoundRow,
      field('略称', text('abbreviation', { placeholder: '例: NaH' }), '文中では略称を優先して使います'),
      field('日本語名', text('name_ja', { placeholder: '例: 水素化ナトリウム' })),
      field('英語名', text('name_en', { placeholder: '例: sodium hydride' })),
      field('CAS番号', text('cas', { placeholder: '例: 7646-69-7' })),
      field('分子量', mwInput),
      field('密度 (g/mL)', num('density'), '液体のみ。体積 ⇔ mmol の換算に使います'),
      field('純度 (%)', num('purity', 100), '油分散品など。例: 60（60% in oil）'),
      field('濃度 (M)', num('concentration_M'), '溶液試薬。例: 1.6（1.6 M in hexane）'),
      field('溶媒・分散媒', text('conc_solvent', { placeholder: '例: hexane / oil' })),
      field('構造', structBox, null, 'wide'),
      h('label', { class: 'check wide' }, fav, '★ お気に入りに入れる'),
      opts.saveOption ? h('label', { class: 'check wide' }, saveToLib, 'ライブラリに保存（次から検索で選べるようにする）') : null);

    function valid() {
      if (!(it.name_ja || it.name_en || it.abbreviation || it.compound_no)) {
        LN.toast('名前・略称・化合物番号のどれかを入力してください', 'danger');
        return false;
      }
      return true;
    }

    var actions = [];
    if (isEdit) {
      actions.push({ label: '削除', kind: 'danger-ghost', onClick: function (close) {
        LN.ask('「' + displayName(it) + '」をライブラリから削除しますか？', { ok: '削除', danger: true }).then(function (ok) {
          if (!ok) return;
          repo().library.delete(it.id).then(function () {
            LN.toast('削除しました');
            close();
            if (opts.onDeleted) opts.onDeleted();
          });
        });
        return false;
      } });
    }
    actions.push({ spacer: true });
    actions.push({ label: 'キャンセル', kind: 'ghost' });
    actions.push({ label: opts.saveOption ? '追加' : '保存', kind: 'primary', onClick: function (close) {
      if (!valid()) return false;
      if (opts.saveOption && !saveToLib.checked) {
        close();
        opts.onUse(it, false);
        return false;
      }
      repo().library.save(it).then(function (saved) {
        LN.toast('ライブラリに保存しました', 'success');
        close();
        if (opts.onUse) opts.onUse(saved, true);
        if (opts.onSaved) opts.onSaved(saved);
      });
      return false;
    } });

    LN.openModal({ title: isEdit ? '試薬・化合物の編集' : (opts.title || '試薬・化合物の新規登録'), body: body, actions: actions, size: 'wide' });
  }

  /* ---------- 選択ダイアログ（ノート編集画面の「＋試薬を追加」） ---------- */
  // opts: { onPick(item) }  item.id が null のときはライブラリに保存しなかった試薬
  function openPicker(opts) {
    var kind = 'all';
    var items = [];
    var list = h('div', { class: 'picker-list' });
    var search = h('input', { type: 'search', class: 'picker-search', placeholder: '名前・略称・CAS・化合物番号で検索（ひらがな・カタカナ・全角半角は区別しません）', autofocus: true });
    var tabs = h('div', { class: 'tabs' });
    var modal;

    function choose(it) {
      markUsed(it).then(function (saved) {
        modal.close();
        opts.onPick(saved || it);
      });
    }

    function row(it) {
      return h('button', { class: 'picker-item', type: 'button', onclick: function () { choose(it); } },
        h('span', { class: 'pi-star' }, it.favorite ? '★' : ''),
        h('span', { class: 'pi-name' }, it.compound_no ? h('b', null, it.compound_no) : (it.abbreviation || it.name_ja || it.name_en)),
        h('span', { class: 'pi-sub' }, [it.compound_no ? (it.name_ja || it.name_en) : (it.abbreviation ? it.name_ja || it.name_en : (it.name_ja ? it.name_en : ''))].filter(Boolean).join('')),
        h('span', { class: 'pi-meta' }, [isNum(it.mw) ? 'MW ' + fmt.mw(it.mw) : '', concText(it), it.cas].filter(Boolean).join('　')),
        h('span', { class: 'kind-chip ' + it.kind }, KIND_LABEL[it.kind] || ''));
    }

    function draw() {
      var q = search.value;
      var pool = items.filter(function (it) { return kind === 'all' || it.kind === kind; });
      var children = [];
      if (!LN.normalizeForSearch(q)) {
        var favs = sortItems(pool.filter(function (it) { return it.favorite; }));
        var recent = pool.filter(function (it) { return !it.favorite && it.last_used_at; })
          .sort(function (a, b) { return b.last_used_at.localeCompare(a.last_used_at); }).slice(0, 10);
        if (favs.length) children.push(h('div', { class: 'picker-head' }, '★ お気に入り'), favs.map(row));
        if (recent.length) children.push(h('div', { class: 'picker-head' }, '最近使った試薬'), recent.map(row));
        var rest = sortItems(pool.filter(function (it) { return favs.indexOf(it) === -1 && recent.indexOf(it) === -1; }));
        if (rest.length) children.push(h('div', { class: 'picker-head' }, 'すべて'), rest.map(row));
        if (!pool.length) children.push(h('p', { class: 'faint picker-empty' }, 'ライブラリにまだ登録がありません。'));
      } else {
        var hits = sortItems(filterItems(pool, q, 'all'));
        if (hits.length) children.push(hits.map(row));
        else children.push(h('p', { class: 'faint picker-empty' }, '「' + q + '」に一致する試薬はありません。'));
      }
      children.push(h('button', { class: 'picker-item new', type: 'button', onclick: function () {
        var prefill = {};
        var t = search.value.trim();
        if (t) {
          if (/^\d{2,7}-\d{2}-\d$/.test(t)) prefill.cas = t;
          else if (/^[A-Za-z0-9\-()+,.' ]+$/.test(t)) prefill.abbreviation = t;
          else prefill.name_ja = t;
        }
        modal.close();
        openItemForm(null, { kind: kind === 'all' ? 'reagent' : kind, prefill: prefill, saveOption: true,
          title: '新規登録してノートに追加',
          onUse: function (it) { opts.onPick(it); } });
      } }, '＋ 新規登録（見つからない場合）'));
      list.replaceChildren.apply(list, [].concat.apply([], children.map(function (c) { return Array.isArray(c) ? c : [c]; })));
    }

    function drawTabs() {
      tabs.replaceChildren.apply(tabs, [{ key: 'all', label: 'すべて' }].concat(KINDS).map(function (t) {
        return h('button', { class: 'tab' + (t.key === kind ? ' active' : ''), type: 'button',
          onclick: function () { kind = t.key; drawTabs(); draw(); search.focus(); } }, t.label);
      }));
    }

    search.addEventListener('input', draw);
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = list.querySelector('.picker-item');
        if (first) first.click();
      }
    });

    modal = LN.openModal({ title: '試薬を追加', body: h('div', { class: 'picker' }, search, tabs, list), size: 'wide' });
    repo().library.list().then(function (all) { items = all; drawTabs(); draw(); });
  }

  LN.library = {
    renderScreen: renderScreen,
    openItemForm: openItemForm,
    openPicker: openPicker,
    displayName: displayName,
    concText: concText,
    KIND_LABEL: KIND_LABEL
  };
})(window);
