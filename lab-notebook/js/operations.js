/*
 * 操作ボタンと文章生成（SPEC 3章・7章）
 *
 * 各操作は
 *   fields : 入力欄の定義（buildForm が入力フォームにする）
 *   text   : (params, ctx) → { ja, en }  1手順＝1文の HTML（化合物番号は <b>）
 *   apply  : 確定時に試薬表へ反映するもの（任意）
 * を持つ。手順（Step）は { id, order, op_type, params } として保存する。
 */
(function (global) {
  'use strict';

  var LN = global.LN;
  var h = LN.h, fmt = LN.fmt, isNum = LN.isNum, esc = LN.escapeHtml;

  /* ---------- 選択肢 ---------- */

  function opt(v, ja, en) { return { v: v, ja: ja, en: en == null ? ja : en }; }

  var SOLVENTS = [
    opt('EtOAc', '酢酸エチル', 'EtOAc'), opt('CH2Cl2', 'ジクロロメタン', 'CH₂Cl₂'), opt('Et2O', 'ジエチルエーテル', 'Et₂O'),
    opt('CHCl3', 'クロロホルム', 'CHCl₃'), opt('hexane', 'ヘキサン', 'hexane'), opt('toluene', 'トルエン', 'toluene'),
    opt('EtOH', 'エタノール', 'EtOH'), opt('MeOH', 'メタノール', 'MeOH'), opt('iPrOH', '2-プロパノール', 'i-PrOH'),
    opt('acetone', 'アセトン', 'acetone'), opt('MeCN', 'アセトニトリル', 'MeCN'), opt('H2O', '水', 'H₂O'),
    opt('other', 'その他（手入力）')
  ];
  var ELUENT_SOLVENTS = ['hexane', 'EtOAc', 'CH₂Cl₂', 'MeOH', 'Et₂O', 'toluene', 'CHCl₃', 'acetone', 'pentane', 'Et₃N'];

  var TIME_UNITS = [opt('min', '分', 'min'), opt('h', '時間', 'h'), opt('overnight', '終夜', 'overnight')];

  var SOLUTIONS = {
    nh4cl: opt('nh4cl', '飽和塩化アンモニウム水溶液', 'sat. aq. NH₄Cl'),
    water: opt('water', '水', 'H₂O'),
    brine: opt('brine', '飽和食塩水', 'brine'),
    nahco3: opt('nahco3', '飽和炭酸水素ナトリウム水溶液', 'sat. aq. NaHCO₃'),
    hcl: opt('hcl', '1 M 塩酸', '1 M aq. HCl'),
    na2s2o3: opt('na2s2o3', '飽和チオ硫酸ナトリウム水溶液', 'sat. aq. Na₂S₂O₃')
  };

  var COLORS = [
    opt('colorless', '無色', 'colorless'), opt('white', '白色', 'white'), opt('paleyellow', '淡黄色', 'pale yellow'),
    opt('yellow', '黄色', 'yellow'), opt('orange', '橙色', 'orange'), opt('red', '赤色', 'red'),
    opt('reddishbrown', '赤褐色', 'reddish brown'), opt('brown', '褐色', 'brown'), opt('black', '黒色', 'black'),
    opt('green', '緑色', 'green'), opt('blue', '青色', 'blue'), opt('purple', '紫色', 'purple')
  ];

  var APPEARANCES = [
    opt('white_solid', '白色固体', 'white solid'), opt('colorless_solid', '無色固体', 'colorless solid'),
    opt('paleyellow_solid', '淡黄色固体', 'pale yellow solid'), opt('yellow_solid', '黄色固体', 'yellow solid'),
    opt('orange_solid', '橙色固体', 'orange solid'), opt('brown_solid', '褐色固体', 'brown solid'),
    opt('colorless_oil', '無色油状物', 'colorless oil'), opt('paleyellow_oil', '淡黄色油状物', 'pale yellow oil'),
    opt('yellow_oil', '黄色油状物', 'yellow oil'), opt('brown_oil', '褐色油状物', 'brown oil'),
    opt('colorless_liquid', '無色液体', 'colorless liquid'), opt('other', 'その他（手入力）')
  ];

  // カラムの固定相（SPEC 3章: シリカとアルミナを区別して記録・検索）
  var PHASES = [
    { v: 'silica', group: 'シリカゲル', label: '通常', ja: 'シリカゲル', en: 'SiO₂' },
    { v: 'silica_neutral', group: 'シリカゲル', label: '中性', ja: '中性シリカゲル', en: 'neutral SiO₂' },
    { v: 'silica_nh', group: 'シリカゲル', label: 'NH修飾', ja: 'NHシリカゲル', en: 'NH-silica' },
    { v: 'alumina_neutral', group: 'アルミナ', label: '中性', ja: '中性アルミナ', en: 'Al₂O₃ (neutral)' },
    { v: 'alumina_basic', group: 'アルミナ', label: '塩基性', ja: '塩基性アルミナ', en: 'Al₂O₃ (basic)' },
    { v: 'alumina_acidic', group: 'アルミナ', label: '酸性', ja: '酸性アルミナ', en: 'Al₂O₃ (acidic)' },
    { v: 'other', group: 'その他', label: '手入力', ja: '', en: '' }
  ];
  function phaseOf(v) { return PHASES.filter(function (p) { return p.v === v; })[0] || PHASES[0]; }
  function phaseCategory(v) {
    if (!v) return null;
    return /^silica/.test(v) ? 'silica' : /^alumina/.test(v) ? 'alumina' : 'other';
  }

  function find(list, v) { return list.filter(function (o) { return o.v === v; })[0] || null; }

  // select + その他（手入力）の値を {ja, en} にする
  function pick(list, p, key) {
    var v = p[key];
    if (v === 'other') {
      var ja = (p[key + '_ja'] || '').trim(), en = (p[key + '_en'] || '').trim();
      return { ja: esc(ja || en), en: esc(en || ja) };
    }
    var o = find(list, v);
    return o ? { ja: esc(o.ja), en: esc(o.en) } : { ja: '', en: '' };
  }

  /* ---------- 文章の部品 ---------- */

  function tempJa(t) { return isNum(t) ? fmt.temp(t) + ' °C' : '室温'; }
  function tempEn(t) { return isNum(t) ? fmt.temp(t) + ' °C' : 'rt'; }

  function timeText(p, key) {
    var unit = p[key + '_unit'] || 'h';
    if (unit === 'overnight') return { ja: '終夜', en: 'overnight', has: true };
    var t = p[key];
    if (!isNum(t)) return { ja: '', en: '', has: false };
    var u = find(TIME_UNITS, unit);
    return { ja: fmt.num(t) + ' ' + u.ja, en: fmt.num(t) + ' ' + u.en, has: true };
  }

  function article(phrase) {
    var s = LN.htmlToText(phrase).trim();
    return /^(8|11|18|[aeiou])/i.test(s) && !/^(one|uni|eu)/i.test(s) ? 'An' : 'A';
  }
  function lowerArticle(phrase) { return article(phrase).toLowerCase(); }

  function joinEn(list) {
    if (list.length <= 1) return list.join('');
    if (list.length === 2) return list[0] + ' and ' + list[1];
    return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
  }

  function eluentText(e) {
    e = e || {};
    var a = esc((e.a || '').trim()), b = esc((e.b || '').trim());
    if (!a && !b) return { ja: '', en: '' };
    if (!b || !e.r1) {
      var single = a || b;
      return { ja: single, en: single };
    }
    var r1 = esc(e.r1.trim()), r2 = esc((e.r2 || '').trim());
    return {
      ja: a + '/' + b + ' = ' + r1 + (r2 ? ' → ' + r2 : ''),
      en: a + '/' + b + ' ' + r1 + (r2 ? ' to ' + r2 : '')
    };
  }

  function capitalize(html) {
    return html.replace(/^([a-z])/, function (c) { return c.toUpperCase(); });
  }

  /* ---------- 操作の定義 ---------- */

  var OPS = [
    // ① 仕込み
    { id: 'setup', group: 0, label: '器具・雰囲気',
      fields: [
        { key: 'flask', type: 'number', label: '容量', unit: 'mL', def: 50 },
        { key: 'vessel', type: 'select', label: '器具', def: 'rbf', options: [
          opt('rbf', '丸底フラスコ', 'round-bottom flask'), opt('two', '二口フラスコ', 'two-necked flask'),
          opt('three', '三口フラスコ', 'three-necked flask'), opt('schlenk', 'シュレンク管', 'Schlenk tube'),
          opt('vial', 'ねじ口試験管', 'screw-cap vial')] },
        { key: 'dry', type: 'select', label: '乾燥方法', def: 'flame', options: [
          opt('flame', '加熱乾燥', 'flame-dried'), opt('oven', 'オーブン乾燥', 'oven-dried'), opt('none', 'なし', '')] },
        { key: 'atm', type: 'select', label: '雰囲気', def: 'Ar', options: [opt('Ar', 'Ar'), opt('N2', 'N₂'), opt('air', '空気')] }
      ],
      text: function (p) {
        var vessel = find(this.fields[1].options, p.vessel) || this.fields[1].options[0];
        var dry = find(this.fields[2].options, p.dry);
        var atm = find(this.fields[3].options, p.atm) || this.fields[3].options[0];
        var size = isNum(p.flask) ? fmt.num(p.flask) + ' mL ' : '';
        var jaHead = (dry && dry.v !== 'none' ? dry.ja + 'した ' : '') + size + vessel.ja;
        var enHead = (dry && dry.en ? dry.en + ' ' : '') + size + vessel.en;
        var ja = atm.v === 'air' ? jaHead + 'を用いた。' : jaHead + 'を' + atm.ja + '置換した。';
        var en = article(enHead) + ' ' + enHead + (atm.v === 'air' ? ' was used.' : ' was purged with ' + atm.en + '.');
        return { ja: ja, en: en };
      } },

    { id: 'add', group: 0, label: '試薬を仕込む',
      fields: [{ key: 'reagent', type: 'reagent', label: '試薬', roles: ['limiting', 'reagent'], required: true }],
      text: function (p, ctx) {
        var r = ctx.reagent(p.reagent);
        var amt = ctx.amount(r);
        return {
          ja: ctx.nameJa(r) + (amt.ja ? ' (' + amt.ja + ')' : '') + ' を加えた。',
          en: capitalize(ctx.nameEn(r)) + (amt.en ? ' (' + amt.en + ')' : '') + ' was added.'
        };
      } },

    { id: 'solvent', group: 0, label: '溶媒を加える',
      fields: [
        { key: 'reagent', type: 'reagent', label: '溶媒', roles: ['solvent'], required: true },
        { key: 'volume', type: 'number', label: '体積', unit: 'mL', fromReagent: 'volume_mL' },
        { key: 'style', type: 'select', label: '表現', def: 'dissolve', options: [opt('dissolve', '溶解した'), opt('add', '加えた')] }
      ],
      apply: function (p, ctx) {
        var r = ctx.reagent(p.reagent);
        if (r && isNum(p.volume) && !isNum(r.volume_mL)) r.volume_mL = p.volume;
      },
      text: function (p, ctx) {
        var r = ctx.reagent(p.reagent);
        var parts = [];
        if (isNum(p.volume)) parts.push(fmt.volume(p.volume) + ' mL');
        var lim = ctx.limiting();
        if (p.style !== 'add' && lim && isNum(lim.mmol) && isNum(p.volume) && p.volume > 0) parts.push(fmt.conc(lim.mmol / p.volume) + ' M');
        var paren = parts.length ? ' (' + parts.join(', ') + ')' : '';
        if (p.style === 'add') {
          return { ja: ctx.nameJa(r) + paren + ' を加えた。', en: capitalize(ctx.nameEn(r)) + paren + ' was added.' };
        }
        var prev = ctx.prevStep();
        var subject = prev && prev.op_type === 'add' && ctx.reagent(prev.params.reagent) ? capitalize(ctx.nameEn(ctx.reagent(prev.params.reagent))) : 'The mixture';
        return { ja: ctx.nameJa(r) + paren + ' に溶解した。', en: subject + ' was dissolved in ' + ctx.nameEn(r) + paren + '.' };
      } },

    { id: 'dropwise', group: 0, label: '滴下',
      fields: [
        { key: 'reagent', type: 'reagent', label: '試薬', roles: ['limiting', 'reagent'], required: true },
        { key: 'method', type: 'select', label: '添加方法', def: 'syringe', options: [
          opt('syringe', 'シリンジ', ' via syringe'), opt('funnel', '滴下ロート', ' from a dropping funnel'),
          opt('pump', 'シリンジポンプ', ' via syringe pump'), opt('cannula', 'カニューラ', ' via cannula'), opt('none', '指定なし', '')] },
        { key: 'time', type: 'time', label: '時間', unitDef: 'min' }
      ],
      text: function (p, ctx) {
        var r = ctx.reagent(p.reagent);
        var amt = ctx.amount(r);
        var m = find(this.fields[1].options, p.method);
        var mJa = { syringe: 'シリンジで', funnel: '滴下ロートを用いて', pump: 'シリンジポンプで', cannula: 'カニューラで' }[p.method] || '';
        var t = timeText(p, 'time');
        var jaTime = t.has ? (t.ja === '終夜' ? '終夜かけて' : ' ' + t.ja + 'かけて') : '';
        return {
          ja: ctx.nameJa(r) + (amt.ja ? ' (' + amt.ja + ')' : '') + ' を' + mJa + jaTime + '滴下した。',
          en: capitalize(ctx.nameEn(r)) + (amt.en ? ' (' + amt.en + ')' : '') + ' was added dropwise' + (m ? m.en : '') +
            (t.has ? (t.en === 'overnight' ? ' overnight' : ' over ' + t.en) : '') + '.'
        };
      } },

    { id: 'cool', group: 0, label: '冷却',
      fields: [
        { key: 'temp', type: 'number', label: '温度', unit: '°C', def: 0 },
        { key: 'bath', type: 'select', label: '浴', def: 'ice', options: [
          opt('ice', '氷浴', 'an ice bath'), opt('icesalt', '氷–食塩浴', 'an ice–salt bath'),
          opt('dryice', 'ドライアイス–アセトン浴', 'a dry ice–acetone bath'), opt('none', '指定なし', '')] }
      ],
      text: function (p) {
        var bath = find(this.fields[1].options, p.bath);
        var t = isNum(p.temp) ? fmt.temp(p.temp) + ' °C' : '';
        var hasBath = bath && bath.v !== 'none';
        return {
          ja: (hasBath ? bath.ja + 'で ' : '') + (t ? t + ' に' : '') + '冷却した。',
          en: 'The mixture was cooled' + (t ? ' to ' + t : '') + (hasBath ? ' in ' + bath.en : '') + '.'
        };
      } },

    // ② 反応
    { id: 'stir', group: 1, label: '撹拌',
      fields: [
        { key: 'temp', type: 'temp', label: '温度' },
        { key: 'time', type: 'time', label: '時間', unitDef: 'h' }
      ],
      text: function (p) {
        var t = timeText(p, 'time');
        return {
          ja: tempJa(p.temp) + (isNum(p.temp) ? ' ' : '') + 'で' + (t.has ? (t.ja === '終夜' ? '終夜' : ' ' + t.ja) : '') + '撹拌した。',
          en: 'The mixture was stirred at ' + tempEn(p.temp) + (t.has ? (t.en === 'overnight' ? ' overnight' : ' for ' + t.en) : '') + '.'
        };
      } },

    { id: 'reflux', group: 1, label: '加熱還流',
      fields: [{ key: 'time', type: 'time', label: '時間', unitDef: 'h' }],
      text: function (p) {
        var t = timeText(p, 'time');
        return {
          ja: (t.has ? (t.ja === '終夜' ? '終夜' : t.ja) : '') + '加熱還流した。',
          en: 'The mixture was heated at reflux' + (t.has ? (t.en === 'overnight' ? ' overnight' : ' for ' + t.en) : '') + '.'
        };
      } },

    { id: 'heat', group: 1, label: '加熱',
      fields: [
        { key: 'temp', type: 'number', label: '温度', unit: '°C', def: 80 },
        { key: 'time', type: 'time', label: '時間', unitDef: 'h' }
      ],
      text: function (p) {
        var t = timeText(p, 'time');
        var temp = isNum(p.temp) ? fmt.temp(p.temp) + ' °C' : '';
        return {
          ja: (temp ? temp + ' で' : '') + (t.has ? (t.ja === '終夜' ? '終夜' : ' ' + t.ja) : '') + '加熱した。',
          en: 'The mixture was heated' + (temp ? ' at ' + temp : '') + (t.has ? (t.en === 'overnight' ? ' overnight' : ' for ' + t.en) : '') + '.'
        };
      } },

    { id: 'warm', group: 1, label: '昇温・降温',
      fields: [
        { key: 'dir', type: 'select', label: '変化', def: 'warm', options: [opt('warm', '昇温'), opt('cool', '降温')] },
        { key: 'temp', type: 'temp', label: '到達温度' }
      ],
      text: function (p) {
        var to = tempJa(p.temp);
        var ja = to + (isNum(p.temp) ? ' ' : '') + 'まで' + (p.dir === 'cool' ? '降温' : '昇温') + 'した。';
        var en;
        if (p.dir === 'cool') en = 'The mixture was cooled to ' + tempEn(p.temp) + '.';
        else en = isNum(p.temp) ? 'The mixture was warmed to ' + tempEn(p.temp) + '.' : 'The mixture was allowed to warm to rt.';
        return { ja: ja, en: en };
      } },

    { id: 'tlc', group: 1, label: 'TLCで追跡',
      fields: [
        { key: 'plate', type: 'select', label: 'プレート', def: 'SiO2', options: [opt('SiO2', 'SiO₂'), opt('NH', 'NH-SiO₂'), opt('Al2O3', 'Al₂O₃')] },
        { key: 'eluent', type: 'eluent', label: '展開溶媒' },
        { key: 'stain', type: 'select', label: '発色剤', def: 'UV', options: [
          opt('UV', 'UV'), opt('anis', 'p-アニスアルデヒド', 'p-anisaldehyde'), opt('pma', 'リンモリブデン酸', 'phosphomolybdic acid'),
          opt('kmno4', 'KMnO₄'), opt('ninhydrin', 'ニンヒドリン', 'ninhydrin'), opt('cam', 'CAM'), opt('iodine', 'ヨウ素', 'I₂')] },
        { key: 'rf', type: 'number', label: 'Rf', step: '0.01' },
        { key: 'result', type: 'select', label: '結果', def: 'consumed', options: [
          opt('consumed', '原料の消失'), opt('formed', '生成物の生成'), opt('remain', '原料の残存'), opt('none', '記載しない')] }
      ],
      text: function (p) {
        var plate = find(this.fields[0].options, p.plate) || this.fields[0].options[0];
        var el = eluentText(p.eluent);
        var stain = find(this.fields[2].options, p.stain);
        var inner = [plate.en];
        var innerJa = [plate.ja];
        if (el.ja) { innerJa.push(el.ja); inner.push(el.en); }
        if (isNum(p.rf)) { innerJa.push('R<i>f</i> = ' + p.rf.toFixed(2)); inner.push('R<i>f</i> = ' + p.rf.toFixed(2)); }
        if (stain && stain.v !== 'UV') { innerJa.push(stain.ja); inner.push(stain.en); }
        var tlcJa = 'TLC (' + innerJa.join(', ') + ')', tlcEn = 'TLC (' + inner.join(', ') + ')';
        var res = p.result || 'consumed';
        var ja = res === 'none' ? tlcJa + ' で反応を追跡した。' : tlcJa + ' で' + { consumed: '原料の消失', formed: '生成物の生成', remain: '原料の残存' }[res] + 'を確認した。';
        var en = {
          consumed: 'The reaction was monitored by ' + tlcEn + ' until complete consumption of the starting material.',
          formed: 'The formation of the product was confirmed by ' + tlcEn + '.',
          remain: tlcEn + ' showed that the starting material remained.',
          none: 'The reaction was monitored by ' + tlcEn + '.'
        }[res];
        return { ja: ja, en: en };
      } },

    { id: 'color', group: 1, label: '色・状態の変化',
      fields: [
        { key: 'color', type: 'select', label: '色', def: 'yellow', options: [opt('', '変化なし／記載しない', '')].concat(COLORS) },
        { key: 'state', type: 'select', label: '状態', def: 'none', options: [
          opt('none', 'なし'), opt('precipitate', '析出'), opt('suspension', '懸濁'), opt('homogeneous', '均一になった')] }
      ],
      text: function (p) {
        var c = find(COLORS, p.color);
        var s = p.state || 'none';
        if (s === 'precipitate') {
          return c ? { ja: '溶液は' + c.ja + 'に変化し、沈殿が析出した。', en: 'The solution turned ' + c.en + ', and a precipitate formed.' }
            : { ja: '沈殿が析出した。', en: 'A precipitate formed.' };
        }
        if (s === 'suspension') {
          return c ? { ja: '反応混合物は' + c.ja + 'の懸濁液となった。', en: 'The mixture became ' + lowerArticle(c.en) + ' ' + c.en + ' suspension.' }
            : { ja: '反応混合物は懸濁液となった。', en: 'The mixture became a suspension.' };
        }
        if (s === 'homogeneous') {
          return c ? { ja: '反応混合物は' + c.ja + 'の均一な溶液となった。', en: 'The mixture became a homogeneous ' + c.en + ' solution.' }
            : { ja: '反応混合物は均一な溶液となった。', en: 'The mixture became homogeneous.' };
        }
        return c ? { ja: '溶液は' + c.ja + 'に変化した。', en: 'The solution turned ' + c.en + '.' } : { ja: '', en: '' };
      } },

    // ③ 後処理
    { id: 'quench', group: 2, label: 'クエンチ',
      fields: [
        { key: 'agent', type: 'select', label: '試薬', def: 'nh4cl', other: true, options: [
          SOLUTIONS.nh4cl, SOLUTIONS.water, SOLUTIONS.nahco3, SOLUTIONS.hcl, SOLUTIONS.na2s2o3, opt('other', 'その他（手入力）')] },
        { key: 'volume', type: 'number', label: '量', unit: 'mL' }
      ],
      text: function (p) {
        var a = pick(this.fields[0].options, p, 'agent');
        var v = isNum(p.volume) ? ' (' + fmt.volume(p.volume) + ' mL)' : '';
        return { ja: a.ja + v + ' を加えて反応を停止した。', en: 'The reaction was quenched with ' + a.en + v + '.' };
      } },

    { id: 'extract', group: 2, label: '抽出',
      fields: [
        { key: 'solvent', type: 'select', label: '溶媒', def: 'EtOAc', other: true, options: SOLVENTS },
        { key: 'count', type: 'number', label: '回数', unit: '回', def: 3 },
        { key: 'volume', type: 'number', label: '1回あたり', unit: 'mL' }
      ],
      text: function (p) {
        var s = pick(SOLVENTS, p, 'solvent');
        var n = isNum(p.count) ? p.count : 1;
        if (isNum(p.volume)) {
          var v = fmt.volume(p.volume);
          return {
            ja: '水層を' + s.ja + ' (' + v + ' mL' + (n > 1 ? ' × ' + n : '') + ') で抽出した。',
            en: 'The aqueous layer was extracted with ' + s.en + ' (' + (n > 1 ? n + ' × ' : '') + v + ' mL).'
          };
        }
        var times = { 1: '', 2: ' twice', 3: ' three times', 4: ' four times', 5: ' five times' }[n];
        return {
          ja: '水層を' + s.ja + 'で' + (n > 1 ? n + '回' : '') + '抽出した。',
          en: 'The aqueous layer was extracted with ' + s.en + (times != null ? times : ' (' + n + '×)') + '.'
        };
      } },

    { id: 'wash', group: 2, label: '洗浄',
      fields: [
        { key: 'solutions', type: 'multi', label: '洗浄液', def: ['brine'], options: [
          SOLUTIONS.water, SOLUTIONS.brine, SOLUTIONS.nahco3, SOLUTIONS.hcl, SOLUTIONS.nh4cl, SOLUTIONS.na2s2o3] },
        { key: 'volume', type: 'number', label: '量（各）', unit: 'mL' }
      ],
      text: function (p, ctx) {
        var opts = this.fields[0].options;
        var sel = (p.solutions || []).map(function (v) { return find(opts, v); }).filter(Boolean);
        if (!sel.length) sel = [SOLUTIONS.brine];
        var v = isNum(p.volume) ? fmt.volume(p.volume) : '';
        var combined = ctx.combinedLayers();
        var listJa = sel.map(function (o) { return o.ja; }).join('、');
        var volJa = v ? ' (' + (sel.length > 1 ? '各 ' : '') + v + ' mL)' : '';
        var volEn = v ? ' (' + v + ' mL' + (sel.length > 1 ? ' each' : '') + ')' : '';
        return {
          ja: (combined ? '有機層を合わせて' : '有機層を') + listJa + volJa + 'で洗浄した。',
          en: (combined ? 'The combined organic layers were' : 'The organic layer was') + ' washed with ' +
            joinEn(sel.map(function (o) { return o.en; })) + volEn + '.'
        };
      } },

    { id: 'dry', group: 2, label: '乾燥',
      fields: [{ key: 'agent', type: 'select', label: '乾燥剤', def: 'Na2SO4', options: [
        opt('Na2SO4', '硫酸ナトリウム', 'Na₂SO₄'), opt('MgSO4', '硫酸マグネシウム', 'MgSO₄')] }],
      text: function (p, ctx) {
        var a = find(this.fields[0].options, p.agent) || this.fields[0].options[0];
        var combined = ctx.combinedLayers() && !ctx.since('extract', 'wash');
        return {
          ja: (combined ? '有機層を合わせて' : '有機層を') + a.ja + 'で乾燥した。',
          en: (combined ? 'The combined organic layers were' : 'The organic layer was') + ' dried over ' + a.en + '.'
        };
      } },

    { id: 'filter', group: 2, label: 'ろ過',
      fields: [{ key: 'method', type: 'select', label: '方法', def: 'gravity', options: [
        opt('gravity', '自然ろ過'), opt('celite', 'セライトろ過'), opt('silica', 'シリカゲルショートパッド')] }],
      text: function (p, ctx) {
        var prev = ctx.prevStep();
        if ((p.method || 'gravity') === 'gravity') {
          if (prev && prev.op_type === 'dry') return { ja: '乾燥剤をろ別した。', en: 'The drying agent was removed by filtration.' };
          return { ja: 'ろ過した。', en: 'The mixture was filtered.' };
        }
        if (p.method === 'celite') return { ja: 'セライトろ過した。', en: 'The mixture was filtered through a pad of Celite.' };
        return { ja: 'シリカゲルショートパッドでろ過した。', en: 'The mixture was filtered through a short pad of silica gel.' };
      } },

    { id: 'concentrate', group: 2, label: '濃縮', fields: [],
      text: function (p, ctx) {
        var prev = ctx.prevStep();
        var subject = prev && prev.op_type === 'filter' ? 'The filtrate' : 'The mixture';
        return { ja: '減圧下で溶媒を留去した。', en: subject + ' was concentrated under reduced pressure.' };
      } },

    // ④ 精製
    { id: 'column', group: 3, label: 'カラムクロマト',
      fields: [
        { key: 'phase', type: 'phase', label: '固定相', def: 'silica' },
        { key: 'eluent', type: 'eluent', label: '展開溶媒', gradient: true }
      ],
      text: function (p) {
        var ph = phaseOf(p.phase);
        var phJa = ph.v === 'other' ? esc(p.phase_ja || p.phase_en || '') : ph.ja;
        var phEn = ph.v === 'other' ? esc(p.phase_en || p.phase_ja || '') : ph.en;
        var el = eluentText(p.eluent);
        var alumina = phaseCategory(ph.v) === 'alumina';
        return {
          ja: '残渣を' + phJa + 'カラムクロマトグラフィー' + (el.ja ? ' (' + el.ja + ')' : '') + ' で精製した。',
          en: 'The residue was purified by ' + (alumina ? '' : 'flash ') + 'column chromatography (' + [phEn, el.en].filter(Boolean).join(', ') + ').'
        };
      } },

    { id: 'recryst', group: 3, label: '再結晶',
      fields: [{ key: 'solvent', type: 'select', label: '溶媒', def: 'EtOH', other: true, options: SOLVENTS }],
      text: function (p) {
        var s = pick(SOLVENTS, p, 'solvent');
        return { ja: s.ja + 'から再結晶した。', en: 'The residue was recrystallized from ' + s.en + '.' };
      } },

    { id: 'distill', group: 3, label: '蒸留',
      fields: [
        { key: 'apparatus', type: 'select', label: '装置', def: 'normal', options: [opt('normal', '通常'), opt('kugelrohr', 'クーゲルロール', 'Kugelrohr')] },
        { key: 'pressure', type: 'number', label: '圧力（空欄＝常圧）' },
        { key: 'pressure_unit', type: 'select', label: '単位', def: 'mmHg', options: [opt('mmHg', 'mmHg'), opt('Pa', 'Pa'), opt('kPa', 'kPa')] },
        { key: 'bp', type: 'text', label: '沸点範囲', unit: '°C', placeholder: '例: 80–85' }
      ],
      text: function (p) {
        var bp = (p.bp || '').trim().replace(/-/g, '–');
        var cond = [];
        if (bp) cond.push('bp ' + esc(bp) + ' °C' + (isNum(p.pressure) ? '/' + fmt.num(p.pressure) + ' ' + esc(p.pressure_unit || 'mmHg') : ''));
        else if (isNum(p.pressure)) cond.push(fmt.num(p.pressure) + ' ' + esc(p.pressure_unit || 'mmHg'));
        var c = cond.length ? ' (' + cond.join(', ') + ')' : '';
        if (p.apparatus === 'kugelrohr') {
          return { ja: 'クーゲルロール蒸留' + c + ' により精製した。', en: 'The residue was purified by Kugelrohr distillation' + c + '.' };
        }
        if (isNum(p.pressure)) return { ja: '減圧蒸留' + c + ' により精製した。', en: 'The residue was distilled under reduced pressure' + c + '.' };
        return { ja: '常圧蒸留' + c + ' により精製した。', en: 'The residue was distilled' + c + '.' };
      } },

    { id: 'product', group: 3, label: '生成物・収率',
      fields: [
        { key: 'reagent', type: 'reagent', label: '化合物', roles: ['product'], required: true },
        { key: 'mass', type: 'number', label: '質量', unit: 'mg', fromReagent: 'mass_mg' },
        { key: 'appearance', type: 'select', label: '性状', def: 'white_solid', other: true, options: APPEARANCES }
      ],
      apply: function (p, ctx) {
        var r = ctx.reagent(p.reagent);
        if (r && isNum(p.mass)) { r.mass_mg = p.mass; r.last_edited_field = 'mass'; }
      },
      text: function (p, ctx) {
        var r = ctx.reagent(p.reagent);
        var amt = ctx.amount(r);
        var a = pick(APPEARANCES, p, 'appearance');
        var paren = amt.ja ? ' (' + amt.ja + ')' : '';
        var parenEn = amt.en ? ' (' + amt.en + ')' : '';
        return {
          ja: ctx.nameJa(r) + paren + ' を' + (a.ja || '生成物') + 'として得た。',
          en: capitalize(ctx.nameEn(r)) + parenEn + ' was obtained' + (a.en ? ' as ' + lowerArticle(a.en) + ' ' + a.en : '') + '.'
        };
      } }
  ];

  var GROUPS = ['① 仕込み', '② 反応', '③ 後処理', '④ 精製'];
  var BY_ID = {};
  OPS.forEach(function (o) { BY_ID[o.id] = o; });

  /* ---------- 文章生成 ---------- */

  function nameOf(r, lang) {
    if (!r) return '（試薬未選択）';
    if (r.compound_no) return '<b>' + esc(r.compound_no) + '</b>';
    var n = lang === 'ja' ? (r.abbreviation || r.name_ja || r.name || r.name_en)
      : (r.abbreviation || r.name_en || r.name || r.name_ja);
    return esc(n || '（名称未入力）');
  }

  function amountOf(r) {
    if (!r) return { ja: '', en: '' };
    var parts = [];
    if (r.role !== 'product') {
      if (isNum(r.concentration_M)) parts.push(fmt.conc(r.concentration_M) + ' M' + (r.conc_solvent ? ' in ' + esc(r.conc_solvent) : ''));
      else if (isNum(r.purity) && r.purity < 1) parts.push(fmt.yield(r.purity * 100) + '%' + (r.conc_solvent ? ' in ' + esc(r.conc_solvent) : ''));
    }
    var measure = LN.calc.measureOf(r);
    if (measure === 'volume' && isNum(r.volume_mL)) parts.push(fmt.volume(r.volume_mL) + ' mL');
    else if (isNum(r.mass_mg)) parts.push(r.mass_mg >= 1000 ? fmt.mass(r.mass_mg / 1000) + ' g' : fmt.mass(r.mass_mg) + ' mg');
    if (isNum(r.mmol)) parts.push(fmt.mmol(r.mmol) + ' mmol');
    if (r.role === 'product') { if (isNum(r.yield)) parts.push(fmt.yield(r.yield) + '%'); }
    else if (isNum(r.equiv)) parts.push(fmt.equiv(r.equiv) + ' equiv');
    var s = parts.join(', ');
    return { ja: s, en: s };
  }

  function makeCtx(note, steps, index) {
    var byId = {};
    (note.reagents || []).forEach(function (r) { byId[r.id] = r; });
    return {
      reagent: function (id) { return byId[id] || null; },
      nameJa: function (r) { return nameOf(r, 'ja'); },
      nameEn: function (r) { return nameOf(r, 'en'); },
      amount: amountOf,
      limiting: function () { return LN.calc.limitingOf(note); },
      prevStep: function () { return index > 0 ? steps[index - 1] : null; },
      // 直前の抽出が複数回なら「合わせた有機層」
      combinedLayers: function () {
        for (var i = index - 1; i >= 0; i--) {
          if (steps[i].op_type === 'extract') return (isNum(steps[i].params.count) ? steps[i].params.count : 1) > 1;
        }
        return false;
      },
      // 直近の opA より後に opB があるか
      since: function (opA, opB) {
        for (var i = index - 1; i >= 0; i--) {
          if (steps[i].op_type === opB) return true;
          if (steps[i].op_type === opA) return false;
        }
        return false;
      }
    };
  }

  function sortedSteps(note) {
    return (note.steps || []).slice().sort(function (a, b) { return a.order - b.order; });
  }

  function stepText(note, steps, index) {
    var step = steps[index];
    var op = BY_ID[step.op_type];
    if (!op) return { ja: '', en: '' };
    try {
      return op.text(step.params || {}, makeCtx(note, steps, index));
    } catch (e) {
      console.error(e);
      return { ja: '（文章を生成できませんでした）', en: '(could not generate text)' };
    }
  }

  function generate(note) {
    var steps = sortedSteps(note);
    var ja = [], en = [];
    steps.forEach(function (s, i) {
      var t = stepText(note, steps, i);
      if (t.ja) ja.push(t.ja);
      if (t.en) en.push(t.en);
    });
    return { ja: ja.join(''), en: en.join(' ') };
  }

  /* ---------- 入力フォーム ---------- */

  // buildForm(op, params, note) → { el, read() → params | null（入力エラー） }
  function buildForm(op, params, note) {
    var p = JSON.parse(JSON.stringify(params || {}));
    var isNew = !params;
    var readers = [];
    var el = h('div', { class: 'op-form' });

    function numInput(key, placeholder, step) {
      var input = h('input', { type: 'text', inputmode: 'decimal', class: 'num-input', placeholder: placeholder || '',
        value: isNum(p[key]) ? String(p[key]) : '' });
      if (step) input.setAttribute('data-step', step);
      readers.push(function (out) { out[key] = LN.parseNum(input.value); });
      return input;
    }

    function selectInput(key, options, def, onChange) {
      var sel = h('select', null, options.map(function (o) {
        return h('option', { value: o.v }, o.label || o.ja);
      }));
      sel.value = p[key] != null ? p[key] : (def != null ? def : options[0].v);
      if (sel.selectedIndex < 0) sel.selectedIndex = 0;
      if (onChange) sel.addEventListener('change', onChange);
      readers.push(function (out) { out[key] = sel.value; });
      return sel;
    }

    function otherInputs(key, sel) {
      var ja = h('input', { type: 'text', placeholder: '日本語', value: p[key + '_ja'] || '' });
      var en = h('input', { type: 'text', placeholder: 'English', value: p[key + '_en'] || '' });
      var box = h('div', { class: 'other-row' }, ja, en);
      function sync() { box.hidden = sel.value !== 'other'; }
      sel.addEventListener('change', sync);
      sync();
      readers.push(function (out) { out[key + '_ja'] = ja.value; out[key + '_en'] = en.value; });
      return box;
    }

    if (isNew) op.fields.forEach(function (f) {
      if (f.def !== undefined && p[f.key] === undefined) p[f.key] = Array.isArray(f.def) ? f.def.slice() : f.def;
      if (f.type === 'time' && !p[f.key + '_unit']) p[f.key + '_unit'] = f.unitDef || 'h';
    });

    op.fields.forEach(function (f) {
      var control;
      if (f.type === 'number') {
        control = h('div', { class: 'with-unit' }, numInput(f.key, f.placeholder), f.unit ? h('span', { class: 'unit' }, f.unit) : null);
        if (f.fromReagent) control.dataset.fromReagent = f.fromReagent;
      } else if (f.type === 'temp') {
        control = h('div', { class: 'with-unit' }, numInput(f.key, '室温'), h('span', { class: 'unit' }, '°C'));
      } else if (f.type === 'time') {
        control = h('div', { class: 'with-unit' }, numInput(f.key),
          selectInput(f.key + '_unit', TIME_UNITS, f.unitDef || 'h'));
      } else if (f.type === 'text') {
        var t = h('input', { type: 'text', placeholder: f.placeholder || '', value: p[f.key] || '' });
        readers.push(function (out) { out[f.key] = t.value; });
        control = h('div', { class: 'with-unit' }, t, f.unit ? h('span', { class: 'unit' }, f.unit) : null);
      } else if (f.type === 'select') {
        var sel = selectInput(f.key, f.options, f.def);
        control = f.other ? h('div', null, sel, otherInputs(f.key, sel)) : sel;
      } else if (f.type === 'multi') {
        var chosen = p[f.key] || [];
        var boxes = f.options.map(function (o) {
          var cb = h('input', { type: 'checkbox', value: o.v, checked: chosen.indexOf(o.v) !== -1 });
          return { cb: cb, el: h('label', { class: 'check' }, cb, o.ja) };
        });
        readers.push(function (out) { out[f.key] = boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.cb.value; }); });
        control = h('div', { class: 'checks' }, boxes.map(function (b) { return b.el; }));
      } else if (f.type === 'phase') {
        var phSel = h('select', null, ['シリカゲル', 'アルミナ', 'その他'].map(function (g) {
          return h('optgroup', { label: g }, PHASES.filter(function (x) { return x.group === g; }).map(function (x) {
            return h('option', { value: x.v }, g === 'その他' ? '手入力' : g + '（' + x.label + '）');
          }));
        }));
        phSel.value = p[f.key] || f.def;
        readers.push(function (out) { out[f.key] = phSel.value; });
        control = h('div', null, phSel, otherInputs(f.key, phSel));
      } else if (f.type === 'eluent') {
        var e = p[f.key] || { a: 'hexane', b: 'EtOAc', r1: '', r2: '' };
        var listId = 'eluent-list';
        var a = h('input', { type: 'text', list: listId, value: e.a || '', placeholder: '溶媒A', class: 'short' });
        var b = h('input', { type: 'text', list: listId, value: e.b || '', placeholder: '溶媒B', class: 'short' });
        var r1 = h('input', { type: 'text', value: e.r1 || '', placeholder: f.gradient ? '開始 例 10/1' : '比率 例 4/1', class: 'short' });
        var r2 = f.gradient ? h('input', { type: 'text', value: e.r2 || '', placeholder: '終了 例 4/1（任意）', class: 'short' }) : null;
        readers.push(function (out) { out[f.key] = { a: a.value, b: b.value, r1: r1.value, r2: r2 ? r2.value : '' }; });
        control = h('div', { class: 'eluent' }, a, h('span', null, '/'), b, h('span', null, '='), r1,
          r2 ? [h('span', null, '→'), r2] : null,
          h('datalist', { id: listId }, ELUENT_SOLVENTS.map(function (s) { return h('option', { value: s }); })));
      } else if (f.type === 'reagent') {
        var rows = (note.reagents || []).filter(function (r) { return f.roles.indexOf(r.role) !== -1; });
        var rsel = h('select', { class: 'reagent-select' },
          h('option', { value: '' }, rows.length ? '（試薬表から選択）' : '（試薬表に該当する行がありません）'),
          rows.map(function (r) {
            var sub = r.compound_no ? (r.name_ja || r.name_en) : (r.abbreviation ? r.name_ja : '');
            return h('option', { value: r.id }, LN.htmlToText(nameOf(r, 'ja')) + (sub ? '（' + sub + '）' : ''));
          }));
        rsel.value = p[f.key] || (rows.length === 1 ? rows[0].id : '');
        // 試薬を選んだら、体積・質量の初期値を試薬表から入れる
        rsel.addEventListener('change', function () {
          var r = rows.filter(function (x) { return x.id === rsel.value; })[0];
          el.querySelectorAll('[data-from-reagent]').forEach(function (box) {
            var input = box.querySelector('input');
            var v = r ? r[box.dataset.fromReagent] : null;
            if (input && !input.value && isNum(v)) input.value = String(Math.round(v * 1000) / 1000);
          });
        });
        readers.push(function (out) { out[f.key] = rsel.value || null; });
        control = rsel;
        if (!rows.length) control = h('div', null, rsel, h('p', { class: 'hint' }, roleHint(f.roles)));
      }
      el.append(h('label', { class: 'op-field' }, h('span', null, f.label), control));
    });

    // 既定の試薬が選ばれている場合に初期値を入れる
    setTimeout(function () {
      var rs = el.querySelector('.reagent-select');
      if (rs && rs.value) rs.dispatchEvent(new Event('change'));
    }, 0);

    if (!op.fields.length) el.append(h('p', { class: 'faint' }, '入力項目はありません。'));
    var preview = h('div', { class: 'op-preview' });
    el.append(preview);

    function read() {
      var out = {};
      readers.forEach(function (fn) { fn(out); });
      return out;
    }
    function missing(out) {
      return op.fields.filter(function (f) { return f.required && !out[f.key]; }).map(function (f) { return f.label; });
    }
    // 入力中に文章をプレビューする
    function updatePreview() {
      var out = read();
      var tmp = JSON.parse(JSON.stringify(note));
      var steps = sortedSteps(tmp);
      var step = { id: '_preview', order: Infinity, op_type: op.id, params: out };
      var ctxNote = tmp;
      if (op.apply) op.apply(out, makeCtx(ctxNote, steps, steps.length));
      LN.calc.recalc(ctxNote);
      steps.push(step);
      var t = stepText(ctxNote, steps, steps.length - 1);
      preview.innerHTML = '<span class="label">日本語</span><div>' + (t.ja || '—') + '</div><span class="label">English</span><div>' + (t.en || '—') + '</div>';
    }
    el.addEventListener('input', updatePreview);
    el.addEventListener('change', updatePreview);
    setTimeout(updatePreview, 0);

    return {
      el: el,
      read: function () {
        var out = read();
        var miss = missing(out);
        if (miss.length) { LN.toast(miss.join('・') + 'を選んでください', 'danger'); return null; }
        return out;
      }
    };
  }

  function roleHint(roles) {
    if (roles.indexOf('solvent') !== -1) return '試薬表に役割「溶媒」の行を追加してください。';
    if (roles.indexOf('product') !== -1) return '試薬表に役割「生成物」の行を追加してください。';
    return '先に試薬表へ試薬を追加してください。';
  }

  LN.ops = {
    OPS: OPS,
    GROUPS: GROUPS,
    byId: BY_ID,
    PHASES: PHASES,
    phaseCategory: phaseCategory,
    generate: generate,
    stepText: stepText,
    sortedSteps: sortedSteps,
    makeCtx: makeCtx,
    buildForm: buildForm,
    nameOf: nameOf
  };
})(window);
