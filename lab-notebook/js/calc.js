/*
 * 試薬表の計算（SPEC 4章）
 *
 * 行（NoteReagent）の「最後に編集した欄」(last_edited_field) を基準にして、残りの欄を計算する。
 *   mass / volume を入れた → mmol と当量を計算
 *   mmol を入れた          → 質量（または体積）と当量を計算
 *   equiv を入れた         → mmol と質量（または体積）を計算
 * 分子量などが足りない欄は null（画面では空欄）にする。
 */
(function (global) {
  'use strict';

  var LN = global.LN;
  var isNum = LN.isNum;

  function purityOf(r) { return isNum(r.purity) && r.purity > 0 ? r.purity : 1; }

  // 質量で量るか体積で量るか
  function measureOf(r) {
    if (r.role === 'solvent') return 'volume';
    if (r.measure === 'mass' || r.measure === 'volume') return r.measure;
    return (isNum(r.concentration_M) || isNum(r.density)) ? 'volume' : 'mass';
  }

  // 量（質量・体積）→ mmol
  function mmolFromAmount(r) {
    if (measureOf(r) === 'volume') {
      if (!isNum(r.volume_mL)) { r.mass_mg = null; return null; }
      if (isNum(r.concentration_M)) {               // 溶液試薬: 体積 × 濃度
        r.mass_mg = isNum(r.density) ? r.volume_mL * r.density * 1000 : null;
        return r.volume_mL * r.concentration_M;
      }
      if (isNum(r.density)) {                         // 液体: 体積 × 密度 × 1000
        r.mass_mg = r.volume_mL * r.density * 1000;
        return isNum(r.mw) && r.mw > 0 ? r.mass_mg * purityOf(r) / r.mw : null;
      }
      r.mass_mg = null;
      return null;
    }
    if (!isNum(r.mass_mg) || !isNum(r.mw) || r.mw <= 0) return null;  // 固体: 質量 × 純度 ÷ 分子量
    return r.mass_mg * purityOf(r) / r.mw;
  }

  // mmol → 量（質量・体積）
  function amountFromMmol(r) {
    var mmol = r.mmol;
    if (!isNum(mmol)) { return; }
    if (measureOf(r) === 'volume') {
      if (isNum(r.concentration_M) && r.concentration_M > 0) {
        r.volume_mL = mmol / r.concentration_M;
        r.mass_mg = isNum(r.density) ? r.volume_mL * r.density * 1000 : null;
      } else if (isNum(r.density) && r.density > 0 && isNum(r.mw)) {
        r.mass_mg = mmol * r.mw / purityOf(r);
        r.volume_mL = r.mass_mg / (r.density * 1000);
      } else {
        r.volume_mL = null;
        r.mass_mg = isNum(r.mw) ? mmol * r.mw / purityOf(r) : null;
      }
    } else {
      r.mass_mg = isNum(r.mw) ? mmol * r.mw / purityOf(r) : null;
      if (!isNum(r.density)) r.volume_mL = null;
      else if (isNum(r.mass_mg)) r.volume_mL = r.mass_mg / (r.density * 1000);
    }
  }

  function limitingOf(note) {
    return (note.reagents || []).filter(function (r) { return r.role === 'limiting'; })[0] || null;
  }

  function recalc(note) {
    var rows = note.reagents || [];
    var lim = limitingOf(note);

    // 1) 基準試薬
    if (lim) {
      if (lim.last_edited_field === 'mmol') amountFromMmol(lim);
      else lim.mmol = mmolFromAmount(lim);
      lim.equiv = 1;
      lim.yield = null;
    }
    var limMmol = lim && isNum(lim.mmol) && lim.mmol > 0 ? lim.mmol : null;

    // 2) その他の行
    rows.forEach(function (r) {
      if (r === lim) return;
      r.yield = null;
      if (r.role === 'solvent') {
        r.mmol = null; r.equiv = null; r.mass_mg = null;
        return;
      }
      if (r.role === 'product') {
        r.equiv = null;
        r.mmol = isNum(r.mass_mg) && isNum(r.mw) && r.mw > 0 ? r.mass_mg / r.mw : null;
        r.yield = limMmol && isNum(r.mmol) ? r.mmol / limMmol * 100 : null;
        return;
      }
      var f = r.last_edited_field;
      if (f === 'equiv') {
        r.mmol = limMmol && isNum(r.equiv) ? r.equiv * limMmol : null;
        if (isNum(r.mmol)) amountFromMmol(r);
      } else if (f === 'mmol') {
        amountFromMmol(r);
        r.equiv = limMmol && isNum(r.mmol) ? r.mmol / limMmol : null;
      } else {
        r.mmol = mmolFromAmount(r);
        r.equiv = limMmol && isNum(r.mmol) ? r.mmol / limMmol : null;
      }
    });
    return note;
  }

  // 反応濃度(M) = 基準試薬の mmol ÷ 溶媒の合計体積(mL)
  function reactionConcentration(note) {
    var lim = limitingOf(note);
    var vol = (note.reagents || []).reduce(function (sum, r) {
      return r.role === 'solvent' && isNum(r.volume_mL) ? sum + r.volume_mL : sum;
    }, 0);
    if (!lim || !isNum(lim.mmol) || vol <= 0) return null;
    return { M: lim.mmol / vol, mmol: lim.mmol, volume: vol };
  }

  LN.calc = {
    recalc: recalc,
    measureOf: measureOf,
    limitingOf: limitingOf,
    reactionConcentration: reactionConcentration
  };
})(window);
