/*
 * 構造式（SPEC 6章）
 *   - CDXML / MOL(V2000) / RXN / SMILES を読み込み、共通の「分子グラフ」にする
 *   - 分子グラフから分子式・分子量を計算する（暗黙の水素は原子価から補う）
 *   - 反応式を SVG で描く（ChemDraw の清書を置き換えるものではなく、確認用の表示）
 *
 * 分子グラフ: { atoms: [{x, y, el, charge, label, hExplicit}], bonds: [{a, b, order, stereo}] }
 *   x, y は描画用の座標（y は下向き）。order は 1/2/3、芳香族は 1.5。
 */
(function (global) {
  'use strict';

  var LN = global.LN;

  /* ---------- 元素データ ---------- */

  var ELEMENTS = ('H 1.008,He 4.0026,Li 6.94,Be 9.0122,B 10.81,C 12.011,N 14.007,O 15.999,F 18.998,Ne 20.180,' +
    'Na 22.990,Mg 24.305,Al 26.982,Si 28.085,P 30.974,S 32.06,Cl 35.45,Ar 39.948,K 39.098,Ca 40.078,' +
    'Sc 44.956,Ti 47.867,V 50.942,Cr 51.996,Mn 54.938,Fe 55.845,Co 58.933,Ni 58.693,Cu 63.546,Zn 65.38,' +
    'Ga 69.723,Ge 72.630,As 74.922,Se 78.971,Br 79.904,Kr 83.798,Rb 85.468,Sr 87.62,Y 88.906,Zr 91.224,' +
    'Nb 92.906,Mo 95.95,Ru 101.07,Rh 102.91,Pd 106.42,Ag 107.87,Cd 112.41,In 114.82,Sn 118.71,Sb 121.76,' +
    'Te 127.60,I 126.90,Xe 131.29,Cs 132.91,Ba 137.33,La 138.91,Ce 140.12,Pr 140.91,Nd 144.24,Sm 150.36,' +
    'Eu 151.96,Gd 157.25,Tb 158.93,Dy 162.50,Ho 164.93,Er 167.26,Tm 168.93,Yb 173.05,Lu 174.97,Hf 178.49,' +
    'Ta 180.95,W 183.84,Re 186.21,Os 190.23,Ir 192.22,Pt 195.08,Au 196.97,Hg 200.59,Tl 204.38,Pb 207.2,Bi 208.98,' +
    'D 2.014').split(',');
  var MASS = {};
  var SYMBOL_BY_NUMBER = [null];
  ELEMENTS.forEach(function (e) {
    var p = e.split(' ');
    MASS[p[0]] = Number(p[1]);
    if (p[0] !== 'D') SYMBOL_BY_NUMBER.push(p[0]);
  });
  // 原子番号の抜け（Tc 43, Pm 61, Po〜）を補正
  (function fixNumbers() {
    var order = ['H','He','Li','Be','B','C','N','O','F','Ne','Na','Mg','Al','Si','P','S','Cl','Ar','K','Ca','Sc','Ti','V','Cr','Mn','Fe','Co','Ni','Cu','Zn','Ga','Ge','As','Se','Br','Kr','Rb','Sr','Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd','In','Sn','Sb','Te','I','Xe','Cs','Ba','La','Ce','Pr','Nd','Pm','Sm','Eu','Gd','Tb','Dy','Ho','Er','Tm','Yb','Lu','Hf','Ta','W','Re','Os','Ir','Pt','Au','Hg','Tl','Pb','Bi'];
    SYMBOL_BY_NUMBER = [null].concat(order);
  })();

  // 暗黙の水素を補う元素の標準原子価
  var VALENCE = { B: [3], C: [4], N: [3], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1], Si: [4], Se: [2], As: [3], Ge: [4] };

  function implicitH(el, bondSum, charge) {
    var list = VALENCE[el];
    if (!list) return 0;
    charge = charge || 0;
    var adj;
    if (el === 'C' || el === 'Si' || el === 'Ge') adj = -Math.abs(charge);
    else if (el === 'B') adj = -charge;
    else adj = charge; // N+ は4価、O+ は3価、O- は1価
    var used = Math.ceil(bondSum - 1e-6);
    for (var i = 0; i < list.length; i++) {
      var v = list[i] + adj;
      if (v >= used) return v - used;
    }
    return 0;
  }

  function bondSums(graph) {
    var sums = graph.atoms.map(function () { return 0; });
    graph.bonds.forEach(function (b) {
      sums[b.a] += b.order;
      sums[b.b] += b.order;
    });
    return sums;
  }

  // 分子式（Hill 順）と分子量
  function formulaOf(graph) {
    var counts = {};
    var sums = bondSums(graph);
    graph.atoms.forEach(function (at, i) {
      if (at.pseudo) {
        // 略号（OMe など）を展開できなかった原子。分子量に足せないので印を付ける
        counts['?'] = (counts['?'] || 0) + 1;
        return;
      }
      counts[at.el] = (counts[at.el] || 0) + 1;
      var hc = at.hExplicit != null ? at.hExplicit : implicitH(at.el, sums[i], at.charge);
      if (hc) counts.H = (counts.H || 0) + hc;
    });
    var unknown = counts['?'] || 0;
    delete counts['?'];
    var keys = Object.keys(counts);
    var ordered = [];
    if (counts.C) {
      ordered.push('C');
      if (counts.H) ordered.push('H');
      keys.filter(function (k) { return k !== 'C' && k !== 'H'; }).sort().forEach(function (k) { ordered.push(k); });
    } else {
      keys.sort().forEach(function (k) { ordered.push(k); });
    }
    var mw = 0;
    var ok = unknown === 0;
    var text = ordered.map(function (k) {
      if (MASS[k] == null) ok = false;
      else mw += MASS[k] * counts[k];
      return k + (counts[k] > 1 ? counts[k] : '');
    }).join('');
    var charge = graph.atoms.reduce(function (s, a) { return s + (a.charge || 0); }, 0);
    if (charge) text += (Math.abs(charge) > 1 ? Math.abs(charge) : '') + (charge > 0 ? '+' : '−');
    return { formula: text, mw: ok && graph.atoms.length ? mw : null, counts: counts };
  }

  // 連結成分ごとに分ける（MOL に複数分子がある場合など）
  function splitComponents(graph) {
    var n = graph.atoms.length;
    var parent = graph.atoms.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    graph.bonds.forEach(function (b) { parent[find(b.a)] = find(b.b); });
    var groups = {};
    for (var i = 0; i < n; i++) {
      var r = find(i);
      (groups[r] = groups[r] || []).push(i);
    }
    return Object.keys(groups).map(function (k) {
      var idx = groups[k];
      var map = {};
      idx.forEach(function (oldI, newI) { map[oldI] = newI; });
      return {
        atoms: idx.map(function (i) { return graph.atoms[i]; }),
        bonds: graph.bonds.filter(function (b) { return b.a in map && b.b in map; })
          .map(function (b) { return Object.assign({}, b, { a: map[b.a], b: map[b.b] }); })
      };
    });
  }

  /* ---------- MOL (V2000) / RXN ---------- */

  var CHARGE_CODE = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 };

  function parseMolBlock(lines, start) {
    var counts = lines[start + 3] || '';
    if (/V3000/.test(counts)) throw new Error('MOL V3000 形式には未対応です。V2000 形式で保存してください。');
    var nAtoms = parseInt(counts.substr(0, 3), 10);
    var nBonds = parseInt(counts.substr(3, 3), 10);
    if (!(nAtoms >= 0) || !(nBonds >= 0)) throw new Error('MOL の形式を読み取れませんでした');
    var atoms = [], bonds = [];
    var i, line;
    for (i = 0; i < nAtoms; i++) {
      line = lines[start + 4 + i] || '';
      var x = parseFloat(line.substr(0, 10));
      var y = parseFloat(line.substr(10, 10));
      var el = line.substr(31, 3).trim();
      var chg = CHARGE_CODE[parseInt(line.substr(36, 3), 10)] || 0;
      var atom = { x: x, y: -y, el: el, charge: chg };
      if (!MASS[el]) atom.pseudo = true, atom.label = el;
      atoms.push(atom);
    }
    for (i = 0; i < nBonds; i++) {
      line = lines[start + 4 + nAtoms + i] || '';
      var a = parseInt(line.substr(0, 3), 10) - 1;
      var b = parseInt(line.substr(3, 3), 10) - 1;
      var type = parseInt(line.substr(6, 3), 10);
      var st = parseInt(line.substr(9, 3), 10) || 0;
      bonds.push({ a: a, b: b, order: type === 4 ? 1.5 : (type >= 1 && type <= 3 ? type : 1),
        stereo: st === 1 ? 'wedge' : st === 6 ? 'hash' : null });
    }
    var end = start + 4 + nAtoms + nBonds;
    var chargeReset = false;
    for (i = end; i < lines.length; i++) {
      line = lines[i];
      if (/^M {2}END/.test(line)) { end = i; break; }
      if (/^M {2}CHG/.test(line)) {
        if (!chargeReset) { atoms.forEach(function (at) { at.charge = 0; }); chargeReset = true; }
        var parts = line.substr(9).trim().split(/\s+/).map(Number);
        for (var k = 0; k + 1 < parts.length; k += 2) if (atoms[parts[k] - 1]) atoms[parts[k] - 1].charge = parts[k + 1];
      }
    }
    return { graph: { atoms: atoms, bonds: bonds }, end: end };
  }

  function parseMol(text) {
    var lines = text.replace(/\r/g, '').split('\n');
    return parseMolBlock(lines, 0).graph;
  }

  function parseRxn(text) {
    var lines = text.replace(/\r/g, '').split('\n');
    if (!/^\$RXN/.test(lines[0])) throw new Error('RXN 形式ではありません');
    var counts = lines[4] || '';
    var nR = parseInt(counts.substr(0, 3), 10) || 0;
    var nP = parseInt(counts.substr(3, 3), 10) || 0;
    var mols = [];
    var idx = 5;
    for (var m = 0; m < nR + nP; m++) {
      while (idx < lines.length && !/^\$MOL/.test(lines[idx])) idx++;
      idx++;
      var res = parseMolBlock(lines, idx);
      mols.push(res.graph);
      idx = res.end + 1;
    }
    return { reactants: mols.slice(0, nR), products: mols.slice(nR) };
  }

  function toMolfile(graph, title) {
    function pad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
    function padR(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
    var scale = graph.unit === 'pt' ? 1 / 14.4 : 1; // CDXML の結合長 14.4pt ≒ 1 Å とみなす
    var out = [title || '', '  LabNotebook', ''];
    out.push(pad(graph.atoms.length, 3) + pad(graph.bonds.length, 3) + '  0  0  0  0  0  0  0  0999 V2000');
    var chgCodes = { 3: 1, 2: 2, 1: 3, '-1': 5, '-2': 6, '-3': 7 };
    graph.atoms.forEach(function (a) {
      out.push(pad((a.x * scale).toFixed(4), 10) + pad((-a.y * scale).toFixed(4), 10) + pad('0.0000', 10) + ' ' +
        padR(a.pseudo ? 'R' : a.el, 3) + ' 0' + pad(chgCodes[a.charge] || 0, 3) + '  0  0  0  0  0  0  0  0  0  0');
    });
    graph.bonds.forEach(function (b) {
      out.push(pad(b.a + 1, 3) + pad(b.b + 1, 3) + pad(b.order === 1.5 ? 4 : b.order, 3) +
        pad(b.stereo === 'wedge' ? 1 : b.stereo === 'hash' ? 6 : 0, 3));
    });
    out.push('M  END');
    return out.join('\n');
  }

  /* ---------- SMILES（分子式・分子量のみ。座標は持たない） ---------- */

  var ORGANIC = { B: 1, C: 1, N: 1, O: 1, P: 1, S: 1, F: 1, Cl: 1, Br: 1, I: 1 };

  function parseSmiles(smiles) {
    var s = String(smiles).trim().split(/\s+/)[0];
    if (!s) throw new Error('SMILES が空です');
    var atoms = [], bonds = [];
    var stack = [], prev = -1, pendingOrder = null, rings = {};
    var i = 0;
    function addAtom(atom) {
      atoms.push(atom);
      var idx = atoms.length - 1;
      if (prev >= 0) {
        var order = pendingOrder != null ? pendingOrder : (atom.aromatic && atoms[prev].aromatic ? 1.5 : 1);
        bonds.push({ a: prev, b: idx, order: order });
      }
      pendingOrder = null;
      prev = idx;
    }
    while (i < s.length) {
      var c = s[i];
      if (c === '(') { stack.push(prev); i++; continue; }
      if (c === ')') { prev = stack.pop(); i++; continue; }
      if (c === '.') { prev = -1; i++; continue; }
      if (c === '-' ) { pendingOrder = 1; i++; continue; }
      if (c === '=') { pendingOrder = 2; i++; continue; }
      if (c === '#') { pendingOrder = 3; i++; continue; }
      if (c === '$') { pendingOrder = 4; i++; continue; }
      if (c === ':') { pendingOrder = 1.5; i++; continue; }
      if (c === '/' || c === '\\') { i++; continue; }
      if (/[0-9%]/.test(c)) {
        var num;
        if (c === '%') { num = s.substr(i + 1, 2); i += 3; } else { num = c; i++; }
        if (rings[num]) {
          var r = rings[num];
          var order = pendingOrder != null ? pendingOrder : (r.order != null ? r.order :
            (atoms[r.atom].aromatic && atoms[prev].aromatic ? 1.5 : 1));
          bonds.push({ a: r.atom, b: prev, order: order });
          delete rings[num];
        } else {
          rings[num] = { atom: prev, order: pendingOrder };
        }
        pendingOrder = null;
        continue;
      }
      if (c === '[') {
        var end = s.indexOf(']', i);
        if (end < 0) throw new Error('SMILES の [ ] が閉じていません');
        var body = s.slice(i + 1, end);
        var m = /^(\d+)?([A-Z][a-z]?|[a-z][a-z]?|\*)(@*)(?:H(\d*))?([+-]+\d*|\d*)?/.exec(body);
        if (!m) throw new Error('SMILES を読み取れません: [' + body + ']');
        var sym = m[2];
        var aromatic = sym[0] === sym[0].toLowerCase() && sym !== '*';
        if (aromatic) sym = sym[0].toUpperCase() + sym.slice(1);
        var h = m[4] != null ? (m[4] === '' ? 1 : parseInt(m[4], 10)) : 0;
        var charge = 0;
        var signs = /([+-]+)(\d*)$/.exec(body);
        if (signs) {
          charge = (signs[1][0] === '+' ? 1 : -1) * (signs[2] ? parseInt(signs[2], 10) : signs[1].length);
        }
        var atom = { el: sym, aromatic: aromatic, hExplicit: h, charge: charge };
        if (!MASS[sym]) atom.pseudo = true;
        addAtom(atom);
        i = end + 1;
        continue;
      }
      var two = s.substr(i, 2);
      if (two === 'Cl' || two === 'Br') { addAtom({ el: two, charge: 0 }); i += 2; continue; }
      if (ORGANIC[c]) { addAtom({ el: c, charge: 0 }); i++; continue; }
      if (/[bcnops]/.test(c)) { addAtom({ el: c.toUpperCase(), aromatic: true, charge: 0 }); i++; continue; }
      if (c === '*') { addAtom({ el: '*', pseudo: true, charge: 0 }); i++; continue; }
      throw new Error('SMILES を読み取れません（' + (i + 1) + '文字目: ' + c + '）');
    }
    if (Object.keys(rings).length) throw new Error('SMILES の環が閉じていません');
    return { atoms: atoms, bonds: bonds, noCoords: true };
  }

  /* ---------- CDXML ---------- */

  function pt(str) {
    var p = String(str || '').trim().split(/\s+/).map(Number);
    return { x: p[0] || 0, y: p[1] || 0 };
  }

  function textOf(tEl) {
    var parts = [];
    tEl.querySelectorAll(':scope > s').forEach(function (s) {
      // face のビット: 1=太字, 2=斜体, 32=下付き, 64=上付き, 96(32+64)=化学式（数字だけ下付き）
      var face = Number(s.getAttribute('face')) || 0;
      var formula = (face & 96) === 96;
      parts.push({ text: s.textContent, size: Number(s.getAttribute('size')) || 10, bold: (face & 1) === 1, italic: (face & 2) === 2,
        formula: formula, sub: !formula && (face & 32) === 32, sup: !formula && (face & 64) === 64 });
    });
    return parts;
  }

  // t 要素: p は 1 行目のベースライン上の基準点。Justification で左寄せ／中央／右寄せ
  function textInfo(t) {
    var p = pt(t.getAttribute('p'));
    var just = t.getAttribute('Justification') || t.getAttribute('LabelJustification') || 'Left';
    if (just === 'Auto') just = 'Left';
    var bb = String(t.getAttribute('BoundingBox') || '').trim().split(/\s+/).map(Number);
    return {
      x: p.x, y: p.y, runs: textOf(t),
      anchor: just === 'Center' ? 'middle' : just === 'Right' ? 'end' : 'start',
      lineHeight: Number(t.getAttribute('LineHeight')) || null,
      bbox: bb.length === 4 && bb.every(isFinite) ? { x1: Math.min(bb[0], bb[2]), y1: Math.min(bb[1], bb[3]), x2: Math.max(bb[0], bb[2]), y2: Math.max(bb[1], bb[3]) } : null
    };
  }

  // fragment 要素 → 分子グラフ（略号ノードは中の fragment を展開して分子式に入れる）
  function fragmentToGraph(fragEl) {
    var atoms = [], bonds = [];
    var idToIndex = {};
    var drawAtoms = [];

    function addNodes(fEl, isInner, outerNodeId) {
      var ecpId = null;
      fEl.querySelectorAll(':scope > n').forEach(function (n) {
        var id = n.getAttribute('id');
        var type = n.getAttribute('NodeType') || '';
        if (type === 'ExternalConnectionPoint') { ecpId = id; return; }
        var p = pt(n.getAttribute('p'));
        var inner = n.querySelector(':scope > fragment');
        var tEl = n.querySelector(':scope > t');
        var label = tEl ? textOf(tEl).map(function (s) { return s.text; }).join('') : null;
        var labelText = tEl ? textInfo(tEl) : null;
        if ((type === 'Fragment' || type === 'Nickname') && inner) {
          // 略号（OMe, Ph, Boc など）: 表示は略号のまま、分子式は中身で数える
          var innerMap = addNodes(inner, true, id);
          idToIndex[id] = innerMap.attachIndex;
          if (!isInner) drawAtoms.push({ x: p.x, y: p.y, label: label, labelText: labelText, id: id });
          return;
        }
        var elNum = Number(n.getAttribute('Element') || 6);
        var el = SYMBOL_BY_NUMBER[elNum] || 'C';
        var atom = { x: p.x, y: p.y, el: el, charge: Number(n.getAttribute('Charge') || 0) };
        if (n.hasAttribute('NumHydrogens')) atom.hExplicit = Number(n.getAttribute('NumHydrogens'));
        if (type === 'GenericNickname' || type === 'Unspecified' || type === 'Variable' || type === 'AnonymousAlternativeGroup' || type === 'NamedAlternativeGroup') {
          atom.pseudo = true;
        }
        atoms.push(atom);
        idToIndex[id] = atoms.length - 1;
        if (!isInner) drawAtoms.push({ x: p.x, y: p.y, label: label, labelText: labelText, el: el, charge: atom.charge, id: id, index: atoms.length - 1 });
      });
      var attachIndex = null;
      fEl.querySelectorAll(':scope > b').forEach(function (b) {
        var bid = b.getAttribute('B'), eid = b.getAttribute('E');
        if (ecpId && (bid === ecpId || eid === ecpId)) {
          attachIndex = idToIndex[bid === ecpId ? eid : bid];
          return;
        }
        if (!(bid in idToIndex) || !(eid in idToIndex)) return;
        var order = parseFloat(b.getAttribute('Order') || '1');
        if (!(order > 0)) order = 1;
        var display = b.getAttribute('Display') || '';
        var stereo = /^WedgeBegin$/.test(display) ? 'wedge' : /^WedgeEnd$/.test(display) ? 'wedge-rev'
          : /^WedgedHashBegin$/.test(display) ? 'hash' : /^WedgedHashEnd$/.test(display) ? 'hash-rev'
          : /Hash|Dash/.test(display) ? 'dash' : /Bold/.test(display) ? 'bold' : null;
        bonds.push({ a: idToIndex[bid], b: idToIndex[eid], order: order > 3 ? 1 : order, stereo: stereo,
          drawB: bid, drawE: eid, doublePos: b.getAttribute('DoublePosition') || null, inner: isInner });
      });
      if (attachIndex == null) {
        // 接続点が見つからない略号は最初の原子に接続されているとみなす
        var firstId = Object.keys(idToIndex).filter(function (k) { return k !== outerNodeId; })[0];
        attachIndex = firstId != null ? idToIndex[firstId] : null;
      }
      return { attachIndex: attachIndex };
    }

    addNodes(fragEl, false, null);
    return { graph: { atoms: atoms, bonds: bonds, unit: 'pt' }, drawAtoms: drawAtoms };
  }

  function parseCdxml(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('CDXML を読み取れませんでした（XML の形式が不正です）');
    var root = doc.documentElement;
    if (!root || root.nodeName !== 'CDXML') throw new Error('CDXML ファイルではありません');

    var scene = { unit: 'pt', molecules: [], texts: [], arrows: [], pluses: [] };

    // 最上位の fragment（ノードの中の略号用 fragment は除く）
    var frags = Array.prototype.filter.call(doc.getElementsByTagName('fragment'), function (f) {
      return !f.parentNode || f.parentNode.nodeName !== 'n';
    });
    frags.forEach(function (f) {
      var res = fragmentToGraph(f);
      if (!res.graph.atoms.length && !res.drawAtoms.length) return;
      scene.molecules.push({ id: f.getAttribute('id'), graph: res.graph, draw: buildDrawModel(f, res) });
    });

    // 自由テキスト（反応条件・化合物番号）
    Array.prototype.forEach.call(doc.getElementsByTagName('t'), function (t) {
      var parent = t.parentNode && t.parentNode.nodeName;
      if (parent === 'n') return;
      scene.texts.push(textInfo(t));
    });

    // 矢印（新形式 <arrow>、旧形式 <graphic GraphicType="Line" ArrowType=...>）
    Array.prototype.forEach.call(doc.getElementsByTagName('arrow'), function (a) {
      var head = pt(a.getAttribute('Head3D')), tail = pt(a.getAttribute('Tail3D'));
      var type = a.getAttribute('ArrowheadType') || '';
      scene.arrows.push({ head: head, tail: tail, noHead: type === 'None' });
    });
    Array.prototype.forEach.call(doc.getElementsByTagName('graphic'), function (g) {
      if (g.hasAttribute('SupersededBy')) return;
      var type = g.getAttribute('GraphicType');
      var bb = String(g.getAttribute('BoundingBox') || '').trim().split(/\s+/).map(Number);
      if (type === 'Line' && g.getAttribute('ArrowType') && bb.length === 4) {
        scene.arrows.push({ head: { x: bb[0], y: bb[1] }, tail: { x: bb[2], y: bb[3] } });
      } else if (type === 'Symbol' && /Plus/.test(g.getAttribute('SymbolType') || '') && bb.length === 4) {
        scene.pluses.push({ x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2 });
      }
    });

    // ChemDraw が記録した反応ステップ（原料・生成物の fragment id）
    scene.steps = Array.prototype.map.call(doc.getElementsByTagName('step'), function (st) {
      function ids(attr) { return String(st.getAttribute(attr) || '').trim().split(/\s+/).filter(Boolean); }
      return { reactants: ids('ReactionStepReactants'), products: ids('ReactionStepProducts') };
    });

    analyzeScene(scene);
    return scene;
  }

  // 描画用モデル（結合はノード位置で描き、略号は文字のまま）
  function buildDrawModel(fragEl, res) {
    var pos = {};
    res.drawAtoms.forEach(function (d) { pos[d.id] = d; });
    var bonds = res.graph.bonds.filter(function (b) { return !b.inner; });
    // 略号ノードへの結合（展開後の原子ではなく略号の位置へ描く）
    fragEl.querySelectorAll(':scope > b').forEach(function (b) {
      var bid = b.getAttribute('B'), eid = b.getAttribute('E');
      var already = bonds.some(function (x) { return x.drawB === bid && x.drawE === eid; });
      if (!already && pos[bid] && pos[eid]) {
        bonds.push({ drawB: bid, drawE: eid, order: parseFloat(b.getAttribute('Order') || '1') || 1, stereo: null });
      }
    });
    var atoms = res.drawAtoms.map(function (d) {
      var label = d.label;
      if (label == null && d.el && d.el !== 'C') label = d.el;
      return { id: d.id, x: d.x, y: d.y, label: label, labelText: d.labelText, charge: d.charge || 0, el: d.el };
    });
    var idx = {};
    atoms.forEach(function (a, i) { idx[a.id] = i; });
    return {
      atoms: atoms,
      bonds: bonds.filter(function (b) { return b.drawB in idx && b.drawE in idx; }).map(function (b) {
        return { a: idx[b.drawB], b: idx[b.drawE], order: b.order, stereo: b.stereo, doublePos: b.doublePos };
      })
    };
  }

  // 反応ステップから: 最初の原料 / 中間体 / 最終生成物
  function roleFromSteps(steps, id) {
    if (!steps || !steps.length || !id) return null;
    var asR = steps.some(function (s) { return s.reactants.indexOf(id) !== -1; });
    var asP = steps.some(function (s) { return s.products.indexOf(id) !== -1; });
    if (asR && asP) return 'intermediate';
    if (asR) return 'reactant';
    if (asP) return 'product';
    return null; // 矢印の上下の溶媒・試薬など
  }

  // 矢印が複数あるとき: どの矢印より前か後か、矢印の上下か
  function roleFromArrows(arrows, cx, cy) {
    var before = 0, after = 0;
    for (var i = 0; i < arrows.length; i++) {
      var a = arrows[i];
      var dx = a.head.x - a.tail.x, dy = a.head.y - a.tail.y, len2 = dx * dx + dy * dy || 1;
      var t = ((cx - a.tail.x) * dx + (cy - a.tail.y) * dy) / len2;
      if (t >= 0 && t <= 1) return 'reagent';
      if (t < 0) before++; else after++;
    }
    if (after === 0) return 'reactant';
    if (before === 0) return 'product';
    return 'intermediate';
  }

  // 矢印の位置から原料・試薬・生成物を判定し、近くの化合物番号を拾う
  function analyzeScene(scene) {
    var arrow = scene.arrows.length ? scene.arrows.reduce(function (best, a) {
      var len = Math.hypot(a.head.x - a.tail.x, a.head.y - a.tail.y);
      return !best || len > best.len ? { a: a, len: len } : best;
    }, null) : null;

    scene.molecules.forEach(function (m) {
      var xs = m.draw.atoms.map(function (a) { return a.x; });
      var ys = m.draw.atoms.map(function (a) { return a.y; });
      m.box = { x1: Math.min.apply(null, xs), x2: Math.max.apply(null, xs), y1: Math.min.apply(null, ys), y2: Math.max.apply(null, ys) };
      var cx = (m.box.x1 + m.box.x2) / 2, cy = (m.box.y1 + m.box.y2) / 2;
      m.role = 'structure';
      var stepRole = roleFromSteps(scene.steps, m.id);
      if (stepRole) m.role = stepRole;
      else if (scene.arrows.length > 1) m.role = roleFromArrows(scene.arrows, cx, cy);
      else if (arrow) {
        var a = arrow.a;
        var dx = a.head.x - a.tail.x, dy = a.head.y - a.tail.y;
        var t = ((cx - a.tail.x) * dx + (cy - a.tail.y) * dy) / (arrow.len * arrow.len);
        m.role = t < 0 ? 'reactant' : t > 1 ? 'product' : 'reagent';
      }
      var f = formulaOf(m.graph);
      m.formula = f.formula;
      m.mw = f.mw;
      m.molfile = toMolfile(m.graph, '');
      // 構造のすぐ下にある短いテキスト（例: 1, 2a）を化合物番号とみなす
      var best = null;
      scene.texts.forEach(function (t) {
        var s = t.runs.map(function (r) { return r.text; }).join('').trim();
        if (!/^\(?[0-9]+[a-zA-Z]?'?\)?$/.test(s)) return;
        if (t.x < m.box.x1 - 20 || t.x > m.box.x2 + 20 || t.y < m.box.y2 - 5 || t.y > m.box.y2 + 60) return;
        var d = Math.abs(t.x - cx) + (t.y - m.box.y2);
        if (!best || d < best.d) best = { d: d, s: s.replace(/[()]/g, '') };
      });
      m.label = best ? best.s : '';
    });
  }

  /* ---------- MOL / RXN / SMILES → シーン ---------- */

  function graphToDraw(graph) {
    var sums = bondSums(graph);
    return {
      atoms: graph.atoms.map(function (a, i) {
        var label = null;
        if (a.pseudo) label = a.label || a.el;
        else if (a.el !== 'C' || a.charge || graph.bonds.every(function (b) { return b.a !== i && b.b !== i; })) {
          var hc = a.hExplicit != null ? a.hExplicit : implicitH(a.el, sums[i], a.charge);
          label = a.el + (hc ? 'H' + (hc > 1 ? hc : '') : '');
        }
        return { x: a.x, y: a.y, label: label, charge: a.charge || 0, el: a.el };
      }),
      bonds: graph.bonds.map(function (b) { return { a: b.a, b: b.b, order: b.order, stereo: b.stereo }; })
    };
  }

  // MOL/RXN の分子を横に並べて 1 枚の反応式にする
  function sceneFromGraphs(reactants, products) {
    var scene = { unit: 'A', molecules: [], texts: [], arrows: [], pluses: [] };
    var x = 0;
    var GAP = 1.6;
    function place(graph, role) {
      if (!graph.atoms.length) return;
      var xs = graph.atoms.map(function (a) { return a.x; });
      var ys = graph.atoms.map(function (a) { return a.y; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var cy = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
      var moved = { atoms: graph.atoms.map(function (a) { return Object.assign({}, a, { x: a.x - minX + x, y: a.y - cy }); }), bonds: graph.bonds };
      var f = formulaOf(moved);
      scene.molecules.push({ graph: moved, draw: graphToDraw(moved), role: role, formula: f.formula, mw: f.mw,
        molfile: toMolfile(moved, ''), label: '' });
      x += (maxX - minX) + GAP;
    }
    reactants.forEach(function (g, i) {
      if (i > 0) { scene.pluses.push({ x: x - GAP / 2, y: 0 }); }
      place(g, products ? 'reactant' : 'structure');
    });
    if (products) {
      scene.arrows.push({ tail: { x: x - 0.4, y: 0 }, head: { x: x + 2.4, y: 0 } });
      x += 2.4 + GAP;
      products.forEach(function (g, i) {
        if (i > 0) { scene.pluses.push({ x: x - GAP / 2, y: 0 }); }
        place(g, 'product');
      });
    }
    return scene;
  }

  /* ---------- 取り込みの入口 ---------- */

  // 形式を判定して読み込む。戻り値: { format, scene | null, molecules: [{role, formula, mw, label, molfile}] }
  function importText(text, filename) {
    var t = String(text || '').replace(/^﻿/, '');
    var name = (filename || '').toLowerCase();
    var trimmed = t.trim();
    if (/\.cdxml$/.test(name) || /^<\?xml[\s\S]*<CDXML/i.test(trimmed) || /^<CDXML/i.test(trimmed)) {
      return withMolecules('cdxml', parseCdxml(t));
    }
    if (/\.cdx$/.test(name)) throw new Error('CDX（バイナリ）形式には未対応です。ChemDraw で CDXML として保存してください。');
    if (/^\$RXN/.test(trimmed)) {
      var rx = parseRxn(trimmed);
      return withMolecules('rxn', sceneFromGraphs(rx.reactants, rx.products));
    }
    if (/\.mol$|\.sdf$/.test(name) || /M {2}END/.test(t) || /V2000|V3000/.test(t)) {
      var g = parseMol(t.replace(/^\s*\n/, '\n'));
      var comps = splitComponents(g);
      return withMolecules('mol', sceneFromGraphs(comps, null));
    }
    // 1行で空白を含まなければ SMILES とみなす（ChemDraw の Copy As SMILES）
    if (trimmed && !/\n/.test(trimmed)) {
      var parts = trimmed.split(/>>/);
      var mols = parts.map(function (p) {
        return p.split('.').filter(Boolean).map(function (frag) {
          var gr = parseSmiles(frag);
          var f = formulaOf(gr);
          return { role: parts.length > 1 ? null : 'structure', formula: f.formula, mw: f.mw, label: '', smiles: frag };
        });
      });
      var list = [];
      if (parts.length > 1) {
        mols[0].forEach(function (m) { m.role = 'reactant'; list.push(m); });
        mols[mols.length - 1].forEach(function (m) { m.role = 'product'; list.push(m); });
      } else list = mols[0];
      return { format: 'smiles', scene: null, molecules: list };
    }
    throw new Error('形式を判定できませんでした（CDXML・MOL・RXN・SMILES に対応）');
  }

  function withMolecules(format, scene) {
    return {
      format: format,
      scene: scene,
      molecules: scene.molecules.map(function (m) {
        return { role: m.role, formula: m.formula, mw: m.mw, label: m.label, molfile: m.molfile };
      })
    };
  }

  // 構造テキスト（MOL / SMILES / CDXML）から分子量を出す（ライブラリ登録用）
  function mwFromText(text) {
    var res = importText(text);
    var mols = res.molecules.filter(function (m) { return m.role !== 'reagent'; });
    if (!mols.length) throw new Error('構造が見つかりませんでした');
    var target = mols.filter(function (m) { return m.role === 'product'; })[0] || mols[0];
    return target;
  }

  /* ---------- SVG 描画 ---------- */

  function svgEsc(s) { return LN.escapeHtml(s); }

  function labelSvg(label, x, y, size, charge) {
    // 数字は下付き（CH3 → CH₃）。先頭の数字（2H など）はそのまま
    var html = '';
    var re = /(\d+)|([^\d]+)/g, m, first = true;
    while ((m = re.exec(label))) {
      if (m[1] && !first) html += '<tspan baseline-shift="-25%" font-size="' + (size * 0.75).toFixed(1) + '">' + m[1] + '</tspan>';
      else html += svgEsc(m[0]);
      first = false;
    }
    if (charge) {
      var c = (Math.abs(charge) > 1 ? Math.abs(charge) : '') + (charge > 0 ? '+' : '−');
      html += '<tspan baseline-shift="super" font-size="' + (size * 0.7).toFixed(1) + '">' + c + '</tspan>';
    }
    return '<text x="' + x.toFixed(2) + '" y="' + (y + size * 0.36).toFixed(2) + '" font-size="' + size +
      '" text-anchor="middle" stroke="none">' + html + '</text>';
  }

  // 下付き・上付きは dy でずらし、次の文字で元の高さに戻す（baseline-shift は後続の文字の位置が崩れることがある）
  function runsToTspans(runs, baseSize) {
    var segs = [];
    runs.forEach(function (r) {
      var size = r.size || baseSize;
      var style = (r.bold ? ' font-weight="bold"' : '') + (r.italic ? ' font-style="italic"' : '');
      if (r.formula) {
        r.text.split(/(\d+)/).filter(Boolean).forEach(function (seg) {
          segs.push({ text: seg, size: size, style: style, shift: /^\d+$/.test(seg) ? 'sub' : null });
        });
      } else {
        segs.push({ text: r.text, size: size, style: style, shift: r.sub ? 'sub' : r.sup ? 'sup' : null });
      }
    });
    var cur = 0;
    return segs.map(function (g) {
      var want = g.shift === 'sub' ? baseSize * 0.28 : g.shift === 'sup' ? -baseSize * 0.38 : 0;
      var dy = want - cur;
      cur = want;
      var size = g.shift ? g.size * 0.72 : g.size;
      return '<tspan' + g.style + (dy ? ' dy="' + dy.toFixed(2) + '"' : '') + (size !== baseSize ? ' font-size="' + size.toFixed(1) + '"' : '') + '>' + svgEsc(g.text) + '</tspan>';
    }).join('');
  }

  // 改行（\r / \n）で行に分ける
  function splitLines(runs) {
    var lines = [[]];
    runs.forEach(function (r) {
      String(r.text).split(/\r\n|\r|\n/).forEach(function (seg, i) {
        if (i > 0) lines.push([]);
        if (seg) lines[lines.length - 1].push(Object.assign({}, r, { text: seg }));
      });
    });
    return lines;
  }

  function textBlockSvg(t, baseSize) {
    var lines = splitLines(t.runs);
    var lh = t.lineHeight && t.lineHeight > 1 ? t.lineHeight : baseSize * 1.15;
    return lines.map(function (runs, li) {
      return '<text x="' + t.x.toFixed(2) + '" y="' + (t.y + li * lh).toFixed(2) + '" font-size="' + baseSize +
        '" text-anchor="' + t.anchor + '" stroke="none">' + runsToTspans(runs, baseSize) + '</text>';
    }).join('');
  }

  // 原子 P から Q へ向かう線が、P のラベルの枠を出る位置（P→Q の長さに対する割合）
  function labelExit(P, Q, fallback) {
    var bb = P.labelText && P.labelText.bbox;
    if (!bb) return fallback;
    var m = 1.2; // 枠の外側に少し余白
    var x1 = bb.x1 - m, x2 = bb.x2 + m, y1 = bb.y1 - m + 1.5, y2 = bb.y2 + m - 1.5;
    var dx = Q.x - P.x, dy = Q.y - P.y, t = Infinity;
    if (dx > 0) t = Math.min(t, (x2 - P.x) / dx); else if (dx < 0) t = Math.min(t, (x1 - P.x) / dx);
    if (dy > 0) t = Math.min(t, (y2 - P.y) / dy); else if (dy < 0) t = Math.min(t, (y1 - P.y) / dy);
    if (!isFinite(t) || t < 0) return fallback;
    return Math.min(t, 0.45);
  }

  function drawMolecule(draw, bondLen) {
    var out = [];
    var size = bondLen * 0.72;
    var atoms = draw.atoms;
    var neighbors = atoms.map(function () { return []; });
    draw.bonds.forEach(function (b) { neighbors[b.a].push(b.b); neighbors[b.b].push(b.a); });
    var shrink = bondLen * 0.32;

    draw.bonds.forEach(function (b) {
      var A = atoms[b.a], B = atoms[b.b];
      if (!A || !B) return;
      var dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len;
      var tA = A.label ? labelExit(A, B, shrink / len) : 0;
      var tB = B.label ? labelExit(B, A, shrink / len) : 0;
      var x1 = A.x + dx * tA, y1 = A.y + dy * tA;
      var x2 = B.x - dx * tB, y2 = B.y - dy * tB;
      var nx = -uy, ny = ux;
      function line(ax, ay, bx, by) {
        out.push('<line x1="' + ax.toFixed(2) + '" y1="' + ay.toFixed(2) + '" x2="' + bx.toFixed(2) + '" y2="' + by.toFixed(2) + '"/>');
      }
      var stereo = b.stereo;
      if (stereo === 'wedge-rev' || stereo === 'hash-rev') {
        var t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t;
        nx = -nx; ny = -ny; stereo = stereo.replace('-rev', '');
      }
      if (stereo === 'wedge' && b.order === 1) {
        var w = bondLen * 0.14;
        out.push('<polygon class="fill" points="' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' ' + (x2 + nx * w).toFixed(2) + ',' + (y2 + ny * w).toFixed(2) +
          ' ' + (x2 - nx * w).toFixed(2) + ',' + (y2 - ny * w).toFixed(2) + '"/>');
        return;
      }
      if (stereo === 'hash' && b.order === 1) {
        var steps = 6;
        for (var k = 1; k <= steps; k++) {
          var f = k / steps, hw = bondLen * 0.14 * f;
          var px = x1 + (x2 - x1) * f, py = y1 + (y2 - y1) * f;
          line(px + nx * hw, py + ny * hw, px - nx * hw, py - ny * hw);
        }
        return;
      }
      if (b.order === 2 || b.order === 1.5) {
        var off = bondLen * 0.16;
        // 二重線を描く側: 指定があればそれ、なければ隣接原子の多い側（環の内側）
        var side = 0;
        if (b.doublePos === 'Center') side = 0;
        else if (b.doublePos === 'Right') side = -1;
        else if (b.doublePos === 'Left') side = 1;
        else {
          var score = 0;
          neighbors[b.a].concat(neighbors[b.b]).forEach(function (n) {
            if (n === b.a || n === b.b) return;
            var C = atoms[n];
            score += Math.sign((C.x - A.x) * nx + (C.y - A.y) * ny);
          });
          side = score > 0 ? 1 : score < 0 ? -1 : 0;
        }
        if (side === 0) {
          line(x1 + nx * off / 2, y1 + ny * off / 2, x2 + nx * off / 2, y2 + ny * off / 2);
          line(x1 - nx * off / 2, y1 - ny * off / 2, x2 - nx * off / 2, y2 - ny * off / 2);
        } else {
          line(x1, y1, x2, y2);
          var trim = bondLen * 0.12;
          var ix1 = x1 + ux * (A.label ? 0 : trim) + nx * off * side, iy1 = y1 + uy * (A.label ? 0 : trim) + ny * off * side;
          var ix2 = x2 - ux * (B.label ? 0 : trim) + nx * off * side, iy2 = y2 - uy * (B.label ? 0 : trim) + ny * off * side;
          if (b.order === 1.5) out.push('<line class="dash" x1="' + ix1.toFixed(2) + '" y1="' + iy1.toFixed(2) + '" x2="' + ix2.toFixed(2) + '" y2="' + iy2.toFixed(2) + '"/>');
          else line(ix1, iy1, ix2, iy2);
        }
        return;
      }
      if (b.order === 3) {
        var o3 = bondLen * 0.14;
        line(x1, y1, x2, y2);
        line(x1 + nx * o3, y1 + ny * o3, x2 + nx * o3, y2 + ny * o3);
        line(x1 - nx * o3, y1 - ny * o3, x2 - nx * o3, y2 - ny * o3);
        return;
      }
      if (stereo === 'dash') { out.push('<line class="dash" x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '"/>'); return; }
      line(x1, y1, x2, y2);
    });

    atoms.forEach(function (a) {
      if (!a.label) return;
      if (a.labelText && a.labelText.runs.length) {
        out.push(textBlockSvg(a.labelText, (a.labelText.runs[0] && a.labelText.runs[0].size) || size));
        return;
      }
      out.push(labelSvg(a.label, a.x, a.y, size, a.charge));
    });
    return out.join('');
  }

  function medianBondLength(scene) {
    var lens = [];
    scene.molecules.forEach(function (m) {
      m.draw.bonds.forEach(function (b) {
        var A = m.draw.atoms[b.a], B = m.draw.atoms[b.b];
        if (A && B) lens.push(Math.hypot(A.x - B.x, A.y - B.y));
      });
    });
    if (!lens.length) return scene.unit === 'pt' ? 14.4 : 1;
    lens.sort(function (a, b) { return a - b; });
    return lens[Math.floor(lens.length / 2)];
  }

  function sceneToSvg(scene, opts) {
    opts = opts || {};
    if (!scene) return '';
    var bl = medianBondLength(scene);
    var parts = [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function grow(x, y, r) {
      r = r || 0;
      minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
    }
    scene.molecules.forEach(function (m) {
      parts.push('<g class="mol">' + drawMolecule(m.draw, bl) + '</g>');
      m.draw.atoms.forEach(function (a) {
        var bb = a.labelText && a.labelText.bbox;
        if (bb) { grow(bb.x1, bb.y1); grow(bb.x2, bb.y2); }
        else grow(a.x, a.y, a.label ? bl * 0.45 : 0);
      });
    });
    scene.arrows.forEach(function (a) {
      var dx = a.head.x - a.tail.x, dy = a.head.y - a.tail.y, len = Math.hypot(dx, dy) || 1;
      var ux = dx / len, uy = dy / len, hs = bl * 0.45;
      parts.push('<line x1="' + a.tail.x.toFixed(2) + '" y1="' + a.tail.y.toFixed(2) + '" x2="' + (a.head.x - ux * hs * 0.8).toFixed(2) + '" y2="' + (a.head.y - uy * hs * 0.8).toFixed(2) + '"/>');
      if (!a.noHead) {
        parts.push('<polygon class="fill" points="' + a.head.x.toFixed(2) + ',' + a.head.y.toFixed(2) + ' ' +
          (a.head.x - ux * hs - uy * hs * 0.4).toFixed(2) + ',' + (a.head.y - uy * hs + ux * hs * 0.4).toFixed(2) + ' ' +
          (a.head.x - ux * hs + uy * hs * 0.4).toFixed(2) + ',' + (a.head.y - uy * hs - ux * hs * 0.4).toFixed(2) + '"/>');
      }
      grow(a.head.x, a.head.y, hs); grow(a.tail.x, a.tail.y, hs);
    });
    scene.pluses.forEach(function (p) {
      var s = bl * 0.3;
      parts.push('<line x1="' + (p.x - s) + '" y1="' + p.y + '" x2="' + (p.x + s) + '" y2="' + p.y + '"/><line x1="' + p.x + '" y1="' + (p.y - s) + '" x2="' + p.x + '" y2="' + (p.y + s) + '"/>');
      grow(p.x, p.y, s);
    });
    scene.texts.forEach(function (t) {
      var size = (t.runs[0] && t.runs[0].size) || 10;
      if (scene.unit !== 'pt') size = bl * 0.6;
      parts.push(textBlockSvg(t, size));
      if (t.bbox) { grow(t.bbox.x1, t.bbox.y1); grow(t.bbox.x2, t.bbox.y2); return; }
      var lines = splitLines(t.runs);
      var lh = t.lineHeight && t.lineHeight > 1 ? t.lineHeight : size * 1.15;
      lines.forEach(function (runs, li) {
        var y = t.y + li * lh;
        var w = runs.reduce(function (n, r) { return n + r.text.length; }, 0) * size * 0.55;
        var x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
        grow(x0, y - size); grow(x0 + w, y + size * 0.3);
      });
    });
    if (minX === Infinity) return '';
    var pad = bl * 0.6;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var sw = (bl * 0.055).toFixed(3);
    return '<svg xmlns="http://www.w3.org/2000/svg" class="scheme-svg" viewBox="' + [minX, minY, maxX - minX, maxY - minY].map(function (v) { return v.toFixed(2); }).join(' ') +
      '" preserveAspectRatio="xMidYMid meet" font-family="Helvetica, Arial, sans-serif">' +
      '<g stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" fill="currentColor">' +
      parts.join('').replace(/<line /g, '<line fill="none" ').replace(/class="dash"/g, 'stroke-dasharray="' + (bl * 0.08).toFixed(2) + '"') +
      '</g></svg>';
  }

  LN.chem = {
    importText: importText,
    parseSmiles: parseSmiles,
    formulaOf: formulaOf,
    mwFromText: mwFromText,
    sceneToSvg: sceneToSvg,
    MASS: MASS
  };
})(window);
