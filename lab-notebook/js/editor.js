/*
 * ノート編集画面（SPEC 1〜4章・6章）
 *   LN.editor.render(view, note, hooks)
 *   hooks: { setLeaveGuard(fn), replaceHash(hash) }
 */
(function (global) {
  'use strict';

  var LN = global.LN;
  var h = LN.h, fmt = LN.fmt, isNum = LN.isNum;

  var ROLES = [
    { v: 'limiting', label: '基準試薬' },
    { v: 'reagent', label: '試薬' },
    { v: 'solvent', label: '溶媒' },
    { v: 'product', label: '生成物' }
  ];
  var ROLE_LABEL = { limiting: '基準試薬', reagent: '試薬', solvent: '溶媒', product: '生成物' };
  var MOL_ROLE_LABEL = { reactant: '原料', reagent: '試薬・条件', product: '生成物', structure: '構造' };

  function repo() { return global.Repository; }

  function newReagentRow(fields) {
    return Object.assign({
      id: LN.newId(), library_id: null, role: 'reagent',
      name: '', name_ja: '', name_en: '', abbreviation: '', compound_no: '',
      mw: null, density: null, purity: null, concentration_M: null, conc_solvent: '',
      mass_mg: null, volume_mL: null, mmol: null, equiv: null, yield: null,
      measure: null, last_edited_field: null, structure_mol: null
    }, fields || {});
  }

  function rowFromLibraryItem(it, note) {
    var hasLimiting = (note.reagents || []).some(function (r) { return r.role === 'limiting'; });
    var role = it.kind === 'solvent' ? 'solvent' : (hasLimiting ? 'reagent' : 'limiting');
    return newReagentRow({
      library_id: it.id || null, role: role,
      name: it.compound_no || it.abbreviation || it.name_ja || it.name_en,
      name_ja: it.name_ja || '', name_en: it.name_en || '', abbreviation: it.abbreviation || '', compound_no: it.compound_no || '',
      mw: isNum(it.mw) ? it.mw : null, density: isNum(it.density) ? it.density : null,
      purity: isNum(it.purity) ? it.purity : null, concentration_M: isNum(it.concentration_M) ? it.concentration_M : null,
      conc_solvent: it.conc_solvent || '',
      measure: role === 'solvent' || isNum(it.concentration_M) || isNum(it.density) ? 'volume' : 'mass',
      structure_mol: it.structure && it.structure.mol || null
    });
  }

  function rowLabel(r) { return LN.htmlToText(LN.ops.nameOf(r, 'ja')); }

  function section(title, extra) {
    var body = Array.prototype.slice.call(arguments, 2);
    return h('section', { class: 'card section' },
      h('div', { class: 'section-head' }, h('h2', null, title), extra || null), body);
  }

  /* ====================================================================== */

  function render(view, note, hooks) {
    var dirty = false;
    var saving = false;
    hooks.setLeaveGuard(function () { return dirty; });

    var status = h('span', { class: 'save-status' });
    function setDirty(value) {
      dirty = value;
      status.textContent = dirty ? '未保存の変更があります' : (note.updated_at ? '保存済み ' + LN.formatDateTime(note.updated_at) : '');
      status.classList.toggle('dirty', dirty);
    }
    function touch() { setDirty(true); }

    /* ---------- 保存・削除 ---------- */

    function save() {
      if (saving) return;
      saving = true;
      var activeText = document.activeElement && document.activeElement.isContentEditable;
      if (activeText) syncTextFromDom();
      repo().notes.save(note).then(function (saved) {
        note.id = saved.id;
        note.created_at = saved.created_at;
        note.updated_at = saved.updated_at;
        setDirty(false);
        hooks.replaceHash('#/notes/' + encodeURIComponent(saved.id));
        deleteBtn.disabled = false;
        title.textContent = 'ノート編集';
        LN.toast('保存しました', 'success');
      }).catch(function (err) {
        console.error(err);
        LN.toast('保存に失敗しました', 'danger');
      }).then(function () { saving = false; });
    }

    function remove() {
      if (!note.id) return;
      if (!confirm('このノートを削除しますか？この操作は取り消せません。')) return;
      repo().notes.delete(note.id).then(function () {
        dirty = false;
        LN.toast('削除しました');
        location.hash = '#/notes';
      });
    }

    function duplicate() {
      if (dirty && !confirm('保存していない変更があります。現在の内容で複製しますか？（元のノートは保存されません）')) return;
      var copy = JSON.parse(JSON.stringify(note));
      copy.id = null; copy.created_at = null; copy.updated_at = null;
      copy.date = LN.todayString();
      (copy.reagents || []).forEach(function (r) { if (r.role === 'product') { r.mass_mg = null; r.last_edited_field = null; } });
      repo().notes.save(copy).then(function (saved) {
        dirty = false;
        LN.toast('複製しました（日付を今日に変更）', 'success');
        location.hash = '#/notes/' + encodeURIComponent(saved.id);
      });
    }

    var title = h('h1', null, note.id ? 'ノート編集' : '新しいノート');
    var deleteBtn = h('button', { class: 'btn danger-ghost', onclick: remove, disabled: !note.id }, '削除');
    var toolbar = h('div', { class: 'page-head sticky' },
      h('div', { class: 'page-head-left' },
        h('a', { class: 'btn ghost', href: '#/notes' }, '← 一覧'), title),
      h('div', { class: 'page-head-right' },
        status, deleteBtn,
        h('button', { class: 'btn ghost', onclick: duplicate, title: '同じ試薬・手順で新しいノートを作る' }, '複製'),
        h('button', { class: 'btn ghost', onclick: function () { window.print(); } }, '印刷'),
        h('button', { class: 'btn primary', onclick: save, title: 'Ctrl+S' }, '保存')));

    /* ---------- 基本情報 ---------- */

    function bind(el, field) {
      el.value = note[field] || '';
      el.addEventListener('input', function () { note[field] = el.value; touch(); });
      return el;
    }
    var basics = section('基本情報', null, h('div', { class: 'basics' },
      h('label', { class: 'field date' }, h('span', null, '日付'), bind(h('input', { type: 'date' }), 'date')),
      h('label', { class: 'field grow' }, h('span', null, '実験者'),
        bind(h('input', { type: 'text', placeholder: '氏名', list: 'experimenter-list' }), 'experimenter')),
      h('datalist', { id: 'experimenter-list' })));
    repo().notes.list().then(function (all) {
      var names = {};
      all.forEach(function (n) { if (n.experimenter) names[n.experimenter] = 1; });
      var dl = basics.querySelector('#experimenter-list');
      Object.keys(names).forEach(function (n) { dl.append(h('option', { value: n })); });
    });

    /* ---------- 反応式 ---------- */

    var schemeBody = h('div');
    var schemeSection = section('反応式', null, schemeBody);

    function importScheme(text, filename) {
      var res;
      try { res = LN.chem.importText(text, filename); } catch (e) { LN.toast(e.message, 'danger'); return; }
      if (hasScheme() && !confirm('現在の反応式を置き換えますか？')) return;
      var s = {
        source_format: res.format, source_name: filename || '',
        cdxml_original: res.format === 'cdxml' ? text : null,
        mol: res.format === 'mol' || res.format === 'rxn' ? text : null,
        smiles: res.format === 'smiles' ? text.trim() : null,
        svg: res.scene ? LN.chem.sceneToSvg(res.scene) : '',
        molecules: res.molecules,
        edited_mol: null, edited_cdxml: null, edited_svg: null, show_edited: false
      };
      note.scheme = s;
      touch();
      renderScheme();
      var mols = res.molecules.filter(function (m) { return m.role !== 'reagent'; });
      LN.toast('反応式を取り込みました（' + mols.length + ' 構造）', 'success');
    }

    function hasScheme() {
      var s = note.scheme || {};
      return !!(s.cdxml_original || s.mol || s.smiles || s.edited_mol);
    }

    function renderScheme() {
      var s = note.scheme || {};
      if (!hasScheme()) {
        var fileInput = h('input', { type: 'file', accept: '.cdxml,.mol,.rxn,.sdf', hidden: true, onchange: function () {
          var f = fileInput.files[0];
          if (f) f.text().then(function (t) { importScheme(t, f.name); });
        } });
        var paste = h('textarea', { rows: '3', class: 'mono small', placeholder: 'ChemDraw の「Copy As → MOL Text / SMILES」で コピーしたテキストを貼り付け' });
        var drop = h('div', { class: 'dropzone', tabindex: '0' },
          h('p', { class: 'dz-main' }, 'CDXML / MOL ファイルをここにドロップ'),
          h('p', { class: 'faint small' }, 'または ', h('button', { class: 'linklike', type: 'button', onclick: function () { fileInput.click(); } }, 'ファイルを選ぶ'),
            '（ChemDraw の反応式は CDXML で保存すると矢印・条件ごと取り込めます）'),
          fileInput);
        ['dragenter', 'dragover'].forEach(function (ev) {
          drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
          drop.addEventListener(ev, function () { drop.classList.remove('over'); });
        });
        drop.addEventListener('drop', function (e) {
          e.preventDefault();
          var f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) f.text().then(function (t) { importScheme(t, f.name); });
          else {
            var t = e.dataTransfer.getData('text/plain');
            if (t) importScheme(t);
          }
        });
        schemeBody.replaceChildren(drop,
          h('div', { class: 'paste-row' }, paste,
            h('div', { class: 'paste-actions' },
              h('button', { class: 'btn', type: 'button', onclick: function () {
                if (paste.value.trim()) importScheme(paste.value);
              } }, '貼り付けを取り込む'),
              h('button', { class: 'btn ghost', type: 'button', onclick: function () {
                LN.ketcher.open('', function (res) { applyKetcherResult(res); });
              } }, 'Ketcher で描く'))));
        return;
      }

      var showEdited = s.show_edited && s.edited_svg;
      var svg = showEdited ? s.edited_svg : s.svg;
      var preview = h('div', { class: 'scheme-preview' });
      if (svg) preview.innerHTML = svg;
      else preview.append(h('div', { class: 'scheme-smiles' }, h('span', { class: 'faint small' }, 'SMILES'), h('code', null, s.smiles || '')));

      var srcLabel = { cdxml: 'CDXML', mol: 'MOL', rxn: 'RXN', smiles: 'SMILES', ketcher: 'Ketcher' }[s.source_format] || '';
      var info = h('div', { class: 'scheme-info' },
        h('span', { class: 'chip' }, srcLabel + (s.source_name ? '：' + s.source_name : '')),
        s.edited_mol ? h('span', { class: 'chip accent' }, 'Ketcher 修正版あり') : null,
        s.edited_mol ? h('div', { class: 'seg' },
          h('button', { class: 'seg-btn' + (!showEdited ? ' active' : ''), onclick: function () { s.show_edited = false; touch(); renderScheme(); } }, '元の図'),
          h('button', { class: 'seg-btn' + (showEdited ? ' active' : ''), onclick: function () { s.show_edited = true; touch(); renderScheme(); } }, '修正版')) : null);

      var actions = h('div', { class: 'row-actions' },
        s.cdxml_original ? h('button', { class: 'btn small', onclick: function () {
          LN.download(s.source_name || 'scheme.cdxml', s.cdxml_original, 'chemical/x-cdxml');
        }, title: 'ChemDraw でそのまま開けます' }, '元の CDXML をダウンロード') : null,
        s.mol ? h('button', { class: 'btn small', onclick: function () {
          LN.download(s.source_name || (s.source_format === 'rxn' ? 'scheme.rxn' : 'structure.mol'), s.mol, 'chemical/x-mdl-molfile');
        } }, '元の ' + srcLabel + ' をダウンロード') : null,
        s.edited_mol ? h('button', { class: 'btn small', onclick: function () {
          LN.download(/\$RXN/.test(s.edited_mol) ? 'scheme_edited.rxn' : 'scheme_edited.mol', s.edited_mol, 'chemical/x-mdl-molfile');
        } }, '修正版をダウンロード') : null,
        s.edited_cdxml ? h('button', { class: 'btn small', onclick: function () {
          LN.download('scheme_edited.cdxml', s.edited_cdxml, 'chemical/x-cdxml');
        } }, '修正版 CDXML') : null,
        h('button', { class: 'btn small', onclick: function () {
          LN.ketcher.open(s.edited_mol || s.cdxml_original || s.mol || s.smiles || '', function (res) { applyKetcherResult(res); });
        } }, 'Ketcher で修正'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small danger-ghost', onclick: function () {
          if (!confirm('反応式をノートから外しますか？')) return;
          note.scheme = { cdxml_original: null, mol: null, smiles: null };
          touch();
          renderScheme();
        } }, '反応式を外す'));

      var mols = (s.molecules || []).filter(function (m) { return m.role !== 'reagent'; });
      var molTable = mols.length ? h('table', { class: 'table compact mol-table' },
        h('thead', null, h('tr', null, h('th', null, '役割'), h('th', null, '化合物番号'), h('th', null, '分子式'),
          h('th', { class: 'num' }, '分子量'), h('th', null, ''))),
        h('tbody', null, mols.map(function (m) {
          var labelInput = h('input', { type: 'text', class: 'short', value: m.label || '', placeholder: '例: 2a',
            oninput: function () { m.label = labelInput.value; touch(); } });
          return h('tr', null,
            h('td', null, MOL_ROLE_LABEL[m.role] || ''),
            h('td', null, labelInput),
            h('td', { class: 'mono', html: formulaHtml(m.formula) }),
            h('td', { class: 'num' }, isNum(m.mw) ? fmt.mw(m.mw) : h('span', { class: 'faint', title: '略号などを含むため計算できません' }, '—')),
            h('td', { class: 'row-actions end' },
              h('button', { class: 'btn small', onclick: function () { addRowFromMolecule(m); } }, '試薬表に追加'),
              h('button', { class: 'btn small ghost', onclick: function () { saveMoleculeToLibrary(m); } }, 'ライブラリに保存')));
        }))) : null;

      schemeBody.replaceChildren(info, preview, molTable, actions);
    }

    function formulaHtml(f) {
      return LN.escapeHtml(f || '').replace(/([A-Za-z\)])(\d+)/g, '$1<sub>$2</sub>');
    }

    function applyKetcherResult(res) {
      if (!res) return;
      var s = note.scheme && hasScheme() ? note.scheme : null;
      var parsed = null;
      try { parsed = LN.chem.importText(res.mol); } catch (e) { parsed = null; }
      if (!s) {
        note.scheme = {
          source_format: 'ketcher', source_name: '', cdxml_original: null, mol: res.mol, smiles: null,
          svg: parsed && parsed.scene ? LN.chem.sceneToSvg(parsed.scene) : '',
          molecules: parsed ? parsed.molecules : [], edited_mol: null, edited_cdxml: null, edited_svg: null
        };
      } else {
        // 取り込んだ元ファイルは残し、修正版を別に保存する（SPEC 6章）
        s.edited_mol = res.mol;
        s.edited_cdxml = res.cdxml || null;
        s.edited_svg = parsed && parsed.scene ? LN.chem.sceneToSvg(parsed.scene) : '';
        s.show_edited = true;
        if (parsed) s.molecules = mergeLabels(parsed.molecules, s.molecules || []);
      }
      touch();
      renderScheme();
      LN.toast('Ketcher の構造を保存しました', 'success');
    }

    function mergeLabels(next, prev) {
      var byRole = {};
      prev.forEach(function (m) { (byRole[m.role] = byRole[m.role] || []).push(m.label); });
      return next.map(function (m) {
        var list = byRole[m.role] || [];
        if (!m.label && list.length) m.label = list.shift() || '';
        return m;
      });
    }

    function addRowFromMolecule(m) {
      var hasLimiting = note.reagents.some(function (r) { return r.role === 'limiting'; });
      var role = m.role === 'product' ? 'product' : (hasLimiting ? 'reagent' : 'limiting');
      var row = newReagentRow({ role: role, compound_no: m.label || '', name: m.label || m.formula,
        abbreviation: m.label ? '' : m.formula, mw: isNum(m.mw) ? Math.round(m.mw * 100) / 100 : null,
        measure: 'mass', structure_mol: m.molfile || null });
      note.reagents.push(row);
      reagentsChanged(true);
      LN.toast('試薬表に追加しました' + (m.label ? '' : '（化合物番号を入力すると文中で太字になります）'));
    }

    function saveMoleculeToLibrary(m) {
      LN.library.openItemForm(null, {
        kind: 'compound',
        prefill: { compound_no: m.label || '', mw: isNum(m.mw) ? Math.round(m.mw * 100) / 100 : null,
          structure: { mol: m.molfile || null, cdxml: null } },
        title: '化合物リストに保存'
      });
    }

    /* ---------- 試薬表 ---------- */

    var reagentTbody = h('tbody');
    var reagentFoot = h('div', { class: 'reagent-foot' });
    var reagentSection = section('試薬表',
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn', onclick: function () { openRowDetail(null); } }, '行を手入力'),
        h('button', { class: 'btn primary', onclick: function () {
          LN.library.openPicker({ onPick: function (it) {
            note.reagents.push(rowFromLibraryItem(it, note));
            reagentsChanged(true);
          } });
        } }, '＋ 試薬を追加')),
      h('table', { class: 'table compact reagent-table' },
        h('thead', null, h('tr', null,
          h('th', null, '名前'), h('th', { style: 'width:8.5em' }, '役割'),
          h('th', { class: 'num', style: 'width:7em' }, '分子量'), h('th', { class: 'num', style: 'width:6.5em' }, '当量'),
          h('th', { class: 'num', style: 'width:6.5em' }, 'mmol'), h('th', { class: 'num', style: 'width:7.5em' }, '質量 (mg)'),
          h('th', { class: 'num', style: 'width:7em' }, '体積 (mL)'), h('th', { style: 'width:7.5em' }, ''))),
        reagentTbody),
      reagentFoot);

    // 欄ごとの表示値
    function displayValue(r, field) {
      switch (field) {
        case 'mw': return fmt.mw(r.mw);
        case 'equiv': return r.role === 'limiting' ? '1.0' : fmt.equiv(r.equiv);
        case 'mmol': return fmt.mmol(r.mmol);
        case 'mass': return fmt.mass(r.mass_mg);
        case 'volume': return fmt.volume(r.volume_mL);
      }
      return '';
    }
    var FIELD_PROP = { mw: 'mw', equiv: 'equiv', mmol: 'mmol', mass: 'mass_mg', volume: 'volume_mL' };

    function fieldEnabled(r, field) {
      if (r.role === 'solvent') return field === 'volume';
      if (r.role === 'product') return field === 'mw' || field === 'mass';
      if (r.role === 'limiting' && field === 'equiv') return false;
      if (field === 'volume') return isNum(r.density) || isNum(r.concentration_M);
      if (field === 'mass') return !isNum(r.concentration_M) || isNum(r.density);
      return true;
    }

    function renderReagents() {
      LN.calc.recalc(note);
      if (!note.reagents.length) {
        reagentTbody.replaceChildren(h('tr', null, h('td', { colspan: '8', class: 'empty-row' },
          'まだ試薬はありません。「＋ 試薬を追加」でライブラリから選ぶか、「行を手入力」で追加します。')));
      } else {
        reagentTbody.replaceChildren.apply(reagentTbody, note.reagents.map(function (r, idx) {
          var roleSel = h('select', { class: 'role-select ' + r.role, onchange: function () { changeRole(r, roleSel.value); } },
            ROLES.map(function (x) { return h('option', { value: x.v }, x.label); }));
          roleSel.value = r.role;

          var cells = ['mw', 'equiv', 'mmol', 'mass', 'volume'].map(function (field) {
            if (r.role === 'product' && field === 'equiv') {
              return h('td', { class: 'num yield-cell', 'data-yield': r.id }, isNum(r.yield) ? '収率 ' + fmt.yield(r.yield) + '%' : '');
            }
            if (!fieldEnabled(r, field)) {
              var v = displayValue(r, field);
              return h('td', { class: 'num muted', 'data-row': r.id, 'data-field': field, title: disabledReason(r, field) }, v || '─');
            }
            var input = h('input', { type: 'text', inputmode: 'decimal', class: 'cell' + (r.last_edited_field === field ? ' edited' : ''),
              value: displayValue(r, field), 'data-row': r.id, 'data-field': field,
              placeholder: field === 'mw' ? '未登録' : '' });
            input.addEventListener('input', function () { onCellInput(r, field, input); });
            input.addEventListener('blur', function () { if (dirtyCell === input) { dirtyCell = null; updateCells(); } });
            return h('td', { class: 'num' }, input);
          });

          var libBtn = h('button', { class: 'btn icon small ghost', title: r.role === 'product' ? '化合物リストに保存' : 'この行の値をライブラリに保存',
            onclick: function () { saveRowToLibrary(r); } }, r.role === 'product' ? '⤓ 化合物' : '⤓');
          return h('tr', { class: 'role-' + r.role },
            h('td', null, h('button', { class: 'linklike name-btn', onclick: function () { openRowDetail(r); }, title: '名前・密度・濃度などを編集' },
              r.compound_no ? h('b', null, r.compound_no) : (rowLabel(r) || '（名称未入力）')),
              h('div', { class: 'row-sub' }, [r.compound_no ? (r.name_ja || r.name_en) : (r.abbreviation && r.name_ja ? r.name_ja : ''),
                LN.library.concText(r)].filter(Boolean).join('　'))),
            h('td', null, roleSel),
            cells,
            h('td', { class: 'row-actions end' },
              h('button', { class: 'btn icon small ghost', title: '上へ', disabled: idx === 0, onclick: function () { moveRow(idx, -1); } }, '↑'),
              libBtn,
              h('button', { class: 'btn icon small ghost danger', title: '行を削除', onclick: function () { deleteRow(r); } }, '✕')));
        }));
      }
      renderReagentFoot();
    }

    function disabledReason(r, field) {
      if (r.role === 'solvent') return '溶媒は体積のみ入力します';
      if (r.role === 'limiting' && field === 'equiv') return '基準試薬は 1.0 equiv です';
      if (field === 'volume') return '密度か濃度を入力すると体積で計算できます（名前をクリック）';
      if (field === 'mass') return '溶液試薬は体積で入力します';
      return '';
    }

    function renderReagentFoot() {
      var lim = LN.calc.limitingOf(note);
      var conc = LN.calc.reactionConcentration(note);
      var items = [];
      if (note.reagents.length && !lim) items.push(h('span', { class: 'warn' }, '基準試薬（1.0 equiv）を役割で指定してください'));
      if (lim && !isNum(lim.mmol)) items.push(h('span', { class: 'warn' }, '基準試薬の量と分子量を入力すると当量・収率が計算されます'));
      if (conc) items.push(h('span', null, '反応濃度 ', h('b', null, fmt.conc(conc.M) + ' M'), h('span', { class: 'faint' }, '（' + fmt.mmol(conc.mmol) + ' mmol / 溶媒 ' + fmt.volume(conc.volume) + ' mL）')));
      var missingMw = note.reagents.filter(function (r) { return r.role !== 'solvent' && !isNum(r.mw); });
      if (missingMw.length) items.push(h('span', { class: 'faint' }, '分子量が未登録の行は計算欄が空欄になります'));
      reagentFoot.replaceChildren.apply(reagentFoot, items);
    }

    var dirtyCell = null;
    function onCellInput(r, field, input) {
      var v = LN.parseNum(input.value);
      r[FIELD_PROP[field]] = v;
      if (field !== 'mw') {
        r.last_edited_field = field;
        if (field === 'mass') r.measure = 'mass';
        if (field === 'volume') r.measure = 'volume';
      }
      dirtyCell = input;
      LN.calc.recalc(note);
      updateCells(input);
      renderReagentFoot();
      touch();
      contentChanged();
    }

    // 入力中の欄以外を計算結果で更新する
    function updateCells(active) {
      reagentTbody.querySelectorAll('[data-row]').forEach(function (el) {
        if (el === active) return;
        var r = note.reagents.filter(function (x) { return x.id === el.dataset.row; })[0];
        if (!r) return;
        var v = displayValue(r, el.dataset.field);
        if (el.tagName === 'INPUT') {
          el.value = v;
          el.classList.toggle('edited', r.last_edited_field === el.dataset.field);
        } else el.textContent = v || '─';
      });
      reagentTbody.querySelectorAll('[data-yield]').forEach(function (el) {
        var r = note.reagents.filter(function (x) { return x.id === el.dataset.yield; })[0];
        el.textContent = r && isNum(r.yield) ? '収率 ' + fmt.yield(r.yield) + '%' : '';
      });
      if (active) active.classList.add('edited');
    }

    function changeRole(r, role) {
      if (role === 'limiting') {
        note.reagents.forEach(function (x) { if (x !== r && x.role === 'limiting') x.role = 'reagent'; });
        if (r.last_edited_field === 'equiv') r.last_edited_field = isNum(r.mass_mg) ? 'mass' : isNum(r.volume_mL) ? 'volume' : null;
      }
      if (role === 'solvent') r.measure = 'volume';
      r.role = role;
      reagentsChanged(true);
    }

    function moveRow(idx, dir) {
      var j = idx + dir;
      if (j < 0 || j >= note.reagents.length) return;
      var t = note.reagents[idx]; note.reagents[idx] = note.reagents[j]; note.reagents[j] = t;
      reagentsChanged(true);
    }

    function deleteRow(r) {
      var used = (note.steps || []).filter(function (s) { return s.params && s.params.reagent === r.id; });
      var msg = '「' + (rowLabel(r) || '名称未入力') + '」を試薬表から削除しますか？' + (used.length ? '\n（この試薬を使う手順が ' + used.length + ' 件あります）' : '');
      if (!confirm(msg)) return;
      note.reagents = note.reagents.filter(function (x) { return x !== r; });
      reagentsChanged(true);
    }

    function reagentsChanged(rerender) {
      if (rerender) renderReagents();
      touch();
      contentChanged();
    }

    // 行の詳細（名前・密度・濃度など）。r が null なら新しい行
    function openRowDetail(r) {
      var isNew = !r;
      var row = isNew ? newReagentRow({ role: note.reagents.some(function (x) { return x.role === 'limiting'; }) ? 'reagent' : 'limiting' }) : JSON.parse(JSON.stringify(r));
      function text(key, ph) {
        var i = h('input', { type: 'text', value: row[key] || '', placeholder: ph || '' });
        i.addEventListener('input', function () { row[key] = i.value; });
        return i;
      }
      function num(key, scale) {
        scale = scale || 1;
        var i = h('input', { type: 'text', inputmode: 'decimal', class: 'num-input', value: isNum(row[key]) ? String(Math.round(row[key] * scale * 1e6) / 1e6) : '' });
        i.addEventListener('input', function () { var v = LN.parseNum(i.value); row[key] = v == null ? null : v / scale; });
        return i;
      }
      function field(label, control, hint) {
        return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
      }
      var roleSel = h('select', null, ROLES.map(function (x) { return h('option', { value: x.v }, x.label); }));
      roleSel.value = row.role;
      var body = h('div', { class: 'form-grid' },
        field('役割', roleSel),
        field('化合物番号', text('compound_no', '例: 1, 2a'), '入力すると文中では太字の番号で表記します'),
        field('略称', text('abbreviation', '例: NaH'), '文中では略称を優先して使います'),
        field('日本語名', text('name_ja')),
        field('英語名', text('name_en')),
        field('分子量', num('mw')),
        field('密度 (g/mL)', num('density'), '液体を体積で量るとき'),
        field('純度 (%)', num('purity', 100), '例: 60（60% in oil）'),
        field('濃度 (M)', num('concentration_M'), '溶液試薬'),
        field('溶媒・分散媒', text('conc_solvent', '例: hexane / oil')),
        row.library_id ? h('p', { class: 'hint wide' }, 'ライブラリの登録と連動しています。「ライブラリにも保存」で登録内容を更新します。') : null);

      function commit() {
        row.role = roleSel.value;
        row.name = row.compound_no || row.abbreviation || row.name_ja || row.name_en || '';
        if (row.role === 'solvent') row.measure = 'volume';
        else if (!isNum(row.concentration_M) && !isNum(row.density)) row.measure = 'mass';
        if (row.role === 'limiting') note.reagents.forEach(function (x) { if (x.id !== row.id && x.role === 'limiting') x.role = 'reagent'; });
        if (isNew) note.reagents.push(row);
        else Object.assign(r, row);
        reagentsChanged(true);
        return isNew ? row : r;
      }

      LN.openModal({
        title: isNew ? '試薬表に行を追加' : '試薬の詳細',
        body: body, size: 'wide',
        actions: [
          { label: 'ライブラリにも保存', kind: 'ghost', onClick: function () { saveRowToLibrary(commit()); } },
          { spacer: true },
          { label: 'キャンセル', kind: 'ghost' },
          { label: isNew ? '追加' : '反映', kind: 'primary', onClick: function () { commit(); } }
        ]
      });
    }

    function itemFieldsFromRow(r) {
      return {
        name_ja: r.name_ja || '', name_en: r.name_en || '', abbreviation: r.abbreviation || '', compound_no: r.compound_no || '',
        mw: isNum(r.mw) ? r.mw : null, density: isNum(r.density) ? r.density : null, purity: isNum(r.purity) ? r.purity : null,
        concentration_M: isNum(r.concentration_M) ? r.concentration_M : null, conc_solvent: r.conc_solvent || ''
      };
    }

    // ノート上で入力した値をライブラリに保存（SPEC 4章）。生成物は「化合物リストに保存」（SPEC 5章）
    function saveRowToLibrary(r) {
      var kind = r.role === 'solvent' ? 'solvent' : r.role === 'product' ? 'compound' : 'reagent';
      var fields = itemFieldsFromRow(r);
      if (r.role === 'product' && !fields.compound_no && !fields.name_ja && !fields.name_en) {
        LN.toast('化合物番号か名前を入力してください（名前をクリック）', 'danger');
        return;
      }
      var structure = r.structure_mol ? { mol: r.structure_mol, cdxml: null } : null;
      if (r.library_id) {
        repo().library.get(r.library_id).then(function (it) {
          if (!it) { r.library_id = null; return saveRowToLibrary(r); }
          if (!confirm('ライブラリの「' + LN.library.displayName(it) + '」をこの行の内容で更新しますか？')) return;
          Object.assign(it, fields);
          if (structure && !(it.structure && it.structure.mol)) it.structure = structure;
          return repo().library.save(it).then(function () { LN.toast('ライブラリを更新しました', 'success'); });
        });
        return;
      }
      var prefill = Object.assign({}, fields);
      if (structure) prefill.structure = structure;
      LN.library.openItemForm(null, {
        kind: kind, prefill: prefill, title: r.role === 'product' ? '化合物リストに保存' : 'ライブラリに保存',
        onSaved: function (saved) { r.library_id = saved.id; touch(); }
      });
    }

    /* ---------- 操作ボタン ＋ 手順リスト ---------- */

    var opPanel = h('div', { class: 'ops' }, LN.ops.GROUPS.map(function (g, gi) {
      return h('div', { class: 'op-group' },
        h('h3', null, g),
        h('div', { class: 'op-buttons' }, LN.ops.OPS.filter(function (o) { return o.group === gi; }).map(function (op) {
          return h('button', { class: 'btn op g' + gi, onclick: function () { openStepForm(op, null); } }, op.label);
        })));
    }));
    var stepListEl = h('ol', { class: 'step-list' });
    var procedure = section('手順', null, h('div', { class: 'split procedure' },
      opPanel, h('div', { class: 'steps' }, h('h3', null, '手順リスト'), stepListEl)));

    function openStepForm(op, step) {
      var form = LN.ops.buildForm(op, step ? step.params : null, note);
      LN.openModal({
        title: op.label + (step ? '（編集）' : ''),
        body: form.el,
        size: 'wide',
        actions: [
          { spacer: true },
          { label: 'キャンセル', kind: 'ghost' },
          { label: step ? '更新' : '手順に追加', kind: 'primary', onClick: function () {
            var params = form.read();
            if (!params) return false;
            var steps = LN.ops.sortedSteps(note);
            if (step) step.params = params;
            else {
              step = { id: LN.newId(), order: steps.length ? steps[steps.length - 1].order + 1 : 0, op_type: op.id, params: params };
              note.steps.push(step);
            }
            if (op.apply) op.apply(params, LN.ops.makeCtx(note, steps, steps.indexOf(step)));
            renderReagents();
            renderSteps();
            touch();
            contentChanged();
          } }
        ]
      });
    }

    function renderSteps() {
      var steps = LN.ops.sortedSteps(note);
      if (!steps.length) {
        stepListEl.replaceChildren(h('li', { class: 'empty-step' }, '左の操作ボタンを押すと、ここに手順が追加されます。'));
        return;
      }
      stepListEl.replaceChildren.apply(stepListEl, steps.map(function (s, i) {
        var op = LN.ops.byId[s.op_type];
        var t = LN.ops.stepText(note, steps, i);
        return h('li', { class: 'step g' + (op ? op.group : 0) },
          h('span', { class: 'step-no' }, String(i + 1)),
          h('div', { class: 'step-body', onclick: function () { if (op) openStepForm(op, s); }, title: 'クリックで編集' },
            h('span', { class: 'step-op' }, op ? op.label : s.op_type),
            h('span', { class: 'step-text', html: t.ja || '' })),
          h('div', { class: 'step-actions' },
            h('button', { class: 'btn icon small ghost', title: '上へ', disabled: i === 0, onclick: function () { moveStep(steps, i, -1); } }, '↑'),
            h('button', { class: 'btn icon small ghost', title: '下へ', disabled: i === steps.length - 1, onclick: function () { moveStep(steps, i, 1); } }, '↓'),
            h('button', { class: 'btn icon small ghost danger', title: '削除', onclick: function () { deleteStep(s); } }, '✕')));
      }));
    }

    function moveStep(steps, i, dir) {
      var j = i + dir;
      var t = steps[i]; steps[i] = steps[j]; steps[j] = t;
      steps.forEach(function (s, k) { s.order = k; });
      renderSteps();
      touch();
      contentChanged();
    }

    function deleteStep(s) {
      note.steps = note.steps.filter(function (x) { return x !== s; });
      LN.ops.sortedSteps(note).forEach(function (x, k) { x.order = k; });
      renderSteps();
      touch();
      contentChanged();
    }

    /* ---------- 日本語文・英語文 ---------- */

    var jaBox = h('div', { class: 'gen-text', contenteditable: 'true', lang: 'ja', 'data-placeholder': '手順を追加すると自動で生成されます。手で修正もできます。' });
    var enBox = h('div', { class: 'gen-text', contenteditable: 'true', lang: 'en', 'data-placeholder': 'Generated from the procedure. Editable.' });
    var banner = h('div', { class: 'banner', hidden: true },
      h('span', null, '手順が変更されています。再生成しますか？（手で修正した文章は上書きされます）'),
      h('button', { class: 'btn small primary', onclick: function () { regenerate(true); } }, '再生成'),
      h('button', { class: 'btn small ghost', onclick: function () {
        var g = LN.ops.generate(note);
        note.text_generated_ja = g.ja; note.text_generated_en = g.en;
        banner.hidden = true; touch();
      } }, 'このまま'));
    var editedChip = h('span', { class: 'chip', hidden: true }, '手で修正済み');

    function onTextInput() {
      note.text_ja = LN.sanitizeHtml(jaBox.innerHTML);
      note.text_en = LN.sanitizeHtml(enBox.innerHTML);
      note.text_edited = true;
      editedChip.hidden = false;
      touch();
    }
    function syncTextFromDom() {
      if (note.text_edited) {
        note.text_ja = LN.sanitizeHtml(jaBox.innerHTML);
        note.text_en = LN.sanitizeHtml(enBox.innerHTML);
      }
    }
    jaBox.addEventListener('input', onTextInput);
    enBox.addEventListener('input', onTextInput);
    // 貼り付けは書式を落としてテキストのみ
    [jaBox, enBox].forEach(function (box) {
      box.addEventListener('paste', function (e) {
        e.preventDefault();
        var t = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, t);
      });
    });

    function regenerate(force) {
      var g = LN.ops.generate(note);
      if (force || !note.text_edited) {
        note.text_ja = g.ja; note.text_en = g.en;
        note.text_generated_ja = g.ja; note.text_generated_en = g.en;
        note.text_edited = false;
        jaBox.innerHTML = g.ja; enBox.innerHTML = g.en;
        editedChip.hidden = true;
        banner.hidden = true;
        if (force) touch();
      }
    }

    // 試薬・手順が変わったら、手で修正していなければ自動で再生成。修正済みなら確認を出す
    function contentChanged() {
      renderSteps();
      var g = LN.ops.generate(note);
      if (!note.text_edited) {
        if (g.ja !== note.text_ja || g.en !== note.text_en) {
          note.text_ja = g.ja; note.text_en = g.en;
          note.text_generated_ja = g.ja; note.text_generated_en = g.en;
          jaBox.innerHTML = g.ja; enBox.innerHTML = g.en;
        }
        banner.hidden = true;
      } else {
        banner.hidden = g.ja === note.text_generated_ja && g.en === note.text_generated_en;
      }
    }

    function copyBtn(box, label) {
      return h('button', { class: 'btn small ghost', onclick: function () {
        LN.copyRich(LN.sanitizeHtml(box.innerHTML)).then(function () { LN.toast(label + 'をコピーしました（太字の書式付き）', 'success'); },
          function () { LN.toast('コピーできませんでした', 'danger'); });
      } }, 'コピー');
    }

    var texts = section('文章',
      h('div', { class: 'row-actions' }, editedChip,
        h('button', { class: 'btn small', onclick: function () {
          if (note.text_edited && !confirm('手で修正した文章を、手順から生成し直した文章で上書きしますか？')) return;
          regenerate(true);
        } }, '手順から再生成')),
      banner,
      h('div', { class: 'split' },
        h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('span', null, '日本語文'), copyBtn(jaBox, '日本語文')), jaBox),
        h('div', { class: 'field' }, h('div', { class: 'field-head' }, h('span', null, '英語文'), copyBtn(enBox, '英語文')), enBox)));

    /* ---------- メモ ---------- */

    var memo = section('メモ', null, bind(h('textarea', { rows: '5', placeholder: '自由記述（観察、反省点、次回の改善点など）' }), 'memo'));

    /* ---------- 組み立て ---------- */

    view.replaceChildren(toolbar, h('div', { class: 'editor' }, basics, schemeSection, reagentSection, procedure, texts, memo));
    renderScheme();
    renderReagents();
    renderSteps();
    jaBox.innerHTML = note.text_ja || '';
    enBox.innerHTML = note.text_en || '';
    editedChip.hidden = !note.text_edited;
    if (!note.text_edited) regenerate(false);
    else banner.hidden = LN.ops.generate(note).ja === note.text_generated_ja && LN.ops.generate(note).en === note.text_generated_en;
    setDirty(false);

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

  LN.editor = { render: render };
})(window);
