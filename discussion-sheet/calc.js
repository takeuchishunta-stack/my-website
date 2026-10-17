/* ==========================================================================
   決算書ディスカッションシート分析ツール — 計算エンジン
   入力：period データ（B/S・P/L等）の配列（2〜3期分）
   出力：財務比率・キャッシュフロー・自社株評価・必要保障額・スコアリング
   このファイルは純粋な計算ロジックのみを持ち、DOM には触れない。
   ========================================================================== */

const DiscussionEngine = (() => {

  // ---- 共通ユーティリティ -------------------------------------------------
  const sum = (...vals) => vals.reduce((a, b) => a + (Number(b) || 0), 0);
  const div = (a, b) => (b ? a / b : null); // 0除算は null（"ー"表示用）
  const pct = (a, b) => { const r = div(a, b); return r === null ? null : r * 100; };
  const round0 = (v) => (v === null || v === undefined ? null : Math.round(v));

  // ---- B/S 集計 -------------------------------------------------------------
  function bsSummary(bs) {
    const currentAssets = sum(
      bs.cash, bs.accountsReceivable, bs.inventory, bs.prepaidExpenses,
      bs.otherCurrentAssets, -(bs.allowanceDoubtful || 0)
    );
    const fixedAssets = sum(bs.tangibleFixedAssets, bs.intangibleFixedAssets, bs.investmentsOther);
    const totalAssets = sum(currentAssets, fixedAssets, bs.deferredAssets);

    const currentLiabilities = sum(
      bs.accountsPayable, bs.shortTermLoans, bs.currentPortionLongTermLoans,
      bs.accruedExpenses, bs.accruedTaxes, bs.depositsReceived, bs.otherCurrentLiabilities
    );
    const fixedLiabilities = sum(bs.longTermLoans, bs.otherFixedLiabilities);
    const totalLiabilities = sum(currentLiabilities, fixedLiabilities);

    const netAssets = sum(bs.capitalStock, bs.capitalSurplus, bs.retainedEarnings, -(bs.treasuryStock || 0));
    const interestBearingDebt = sum(bs.shortTermLoans, bs.currentPortionLongTermLoans, bs.longTermLoans, bs.bonds);

    return { currentAssets, fixedAssets, totalAssets, currentLiabilities, fixedLiabilities,
             totalLiabilities, netAssets, interestBearingDebt,
             totalAssetsOrNetAssetsPlusLiabilities: sum(netAssets, totalLiabilities) };
  }

  // ---- P/L 集計 -------------------------------------------------------------
  // 減価償却費は pl.depreciationAnnualTotal（損益計算書・販管費・製造原価の「減価償却費」
  // 科目から取得した実額）を唯一の入力源とする。未入力の場合は 0 として扱わず null にし、
  // depreciationStatus:'missing' を立てる（呼び出し側は "未入力" を明示し、推計値で埋めない）。
  // 以降の計算（債務償還年数・キャッシュフロー額・CF計算書）では、未入力時は暫定的に 0 扱いで
  // 計算を続行しつつ、結果に depreciationMissing を伝播させて UI 側に注記を出させる。
  function plSummary(pl) {
    const sgaTotal = pl.sgaTotal != null ? pl.sgaTotal
      : sum(...Object.values(pl.sgaDetail || {}));
    const grossProfit = sum(pl.netSales, -(pl.costOfSales || 0));
    const operatingIncome = sum(grossProfit, -(sgaTotal || 0));
    const ordinaryIncome = sum(operatingIncome, pl.nonOperatingIncome, -(pl.nonOperatingExpenses || 0));
    const incomeBeforeTax = sum(ordinaryIncome, pl.extraordinaryIncome, -(pl.extraordinaryLoss || 0));
    const netIncome = sum(incomeBeforeTax, -(pl.incomeTaxes || 0));
    const depreciationInput = pl.depreciationAnnualTotal;
    const depreciationStatus = (depreciationInput === null || depreciationInput === undefined) ? 'missing' : 'confirmed';
    const depreciation = depreciationStatus === 'confirmed' ? depreciationInput : 0;
    return { sgaTotal, grossProfit, operatingIncome, ordinaryIncome, incomeBeforeTax, netIncome, depreciation, depreciationStatus };
  }

  // ---- 固定費集計 -------------------------------------------------------------
  // pl.sgaFixedAccounts に「固定費」に該当する sgaDetail のキー名を列挙しておくと、
  // その科目だけを合計して固定費年額とする（必要保障額の①運転資金＝月額固定費×ヶ月数、
  // 等の算出に使用）。未指定の場合は旧来通り period.fixedCostAnnualTotal の手入力値
  // （無ければ販管費合計）にフォールバックする。
  function fixedCostSummary(pl) {
    const accounts = pl.sgaFixedAccounts;
    if (!accounts || !accounts.length) return { total: null, breakdown: null };
    const detail = pl.sgaDetail || {};
    const breakdown = accounts
      .map(k => [k, detail[k] || 0])
      .filter(([, v]) => v)
      .sort((a, b) => b[1] - a[1]);
    const total = sum(...breakdown.map(([, v]) => v));
    return { total, breakdown };
  }

  // ---- 借入金集計 -----------------------------------------------------------
  function loanSummary(period) {
    const shortTerm = (period.loans && period.loans.shortTerm) || [];
    const longTerm = (period.loans && period.loans.longTerm) || [];
    const sumBalance = (arr) => sum(...arr.map(l => l.balance));
    const sumGuarantee = (arr) => sum(...arr.map(l => l.guaranteeAmount));
    return {
      shortTerm, longTerm,
      shortTermTotal: sumBalance(shortTerm),
      longTermTotal: sumBalance(longTerm),
      shortTermGuaranteeTotal: sumGuarantee(shortTerm),
      longTermGuaranteeTotal: sumGuarantee(longTerm),
    };
  }

  // ---- 1期ぶんのフル分析 ------------------------------------------------------
  function analyzePeriod(period) {
    const bs = bsSummary(period.bs);
    const pl = plSummary(period.pl);
    const loans = loanSummary(period);
    const fixedCost = fixedCostSummary(period.pl);
    return {
      ...period, bsSum: bs, plSum: pl, loanSum: loans,
      fixedCostAnnualTotal: fixedCost.total != null ? fixedCost.total : period.fixedCostAnnualTotal,
      fixedCostBreakdown: fixedCost.breakdown, // [[科目名, 金額], ...] 金額降順。sgaFixedAccounts未指定ならnull
    };
  }

  // ---- 財務比率（単期で求まるもの） --------------------------------------------
  function ratiosForPeriod(a) {
    const { bsSum: b, plSum: p } = a;
    // ギアリング比率・債務償還年数は、分母が0以下（債務超過／営業赤字で減価償却費を
    // 加えても赤字）だと符号が反転し、見かけ上「良い数値」に化けてしまう。
    // この状態では比率そのものが意味を持たないため、有効フラグを立てて
    // 画面側で「算出不可（債務超過／営業赤字）」と表示させ、スコアリングにも
    // （nullを渡すことで）反映させる。
    const gearingRatioValid = b.netAssets > 0;
    const debtServiceYearsValid = sum(p.operatingIncome, p.depreciation) > 0;
    return {
      selfCapitalRatio: pct(b.netAssets, b.totalAssets),
      gearingRatio: pct(b.interestBearingDebt, b.netAssets),
      gearingRatioValid,
      currentRatio: pct(b.currentAssets, b.currentLiabilities),
      fixedLongTermConformityRatio: pct(b.fixedAssets, sum(b.netAssets, b.fixedLiabilities)),
      grossMargin: pct(p.grossProfit, a.pl.netSales),
      operatingMargin: pct(p.operatingIncome, a.pl.netSales),
      ordinaryMargin: pct(p.ordinaryIncome, a.pl.netSales),
      roa: pct(p.ordinaryIncome, b.totalAssets),
      cashFlowAmount: sum(p.ordinaryIncome, p.depreciation),
      debtServiceYears: div(sum(b.interestBearingDebt, -(a.bs.cash || 0)), sum(p.operatingIncome, p.depreciation)),
      debtServiceYearsValid,
      interestCoverageRatio: div(sum(p.operatingIncome, a.pl.interestAndDividendIncome || 0), a.pl.interestExpense || 0),
      depreciationMissing: p.depreciationStatus === 'missing',
    };
  }

  function yoyGrowth(curr, prev) {
    if (!prev) return null;
    return {
      salesGrowth: pct(sum(curr.pl.netSales, -(prev.pl.netSales || 0)), prev.pl.netSales),
      ordinaryIncomeGrowth: pct(sum(curr.plSum.ordinaryIncome, -(prev.plSum.ordinaryIncome || 0)), prev.plSum.ordinaryIncome),
    };
  }

  // ---- キャッシュフロー計算書（間接法で前期末B/Sとの差額から逆算） -----------------
  // prevBsSum が無い（直前期の決算書が無い）場合は null を返す
  function cashFlowStatement(curr, prev) {
    if (!prev) return null;
    const b0 = prev.bsSum, b1 = curr.bsSum;
    const p1 = curr.plSum;

    const delta = (key) => (curr.bs[key] || 0) - (prev.bs[key] || 0);

    // I. 営業活動によるキャッシュフロー
    const depreciation = p1.depreciation;
    const allowanceChange = delta('allowanceDoubtful');
    const receivableChange = -delta('accountsReceivable');
    const inventoryChange = -delta('inventory');
    const payableChange = delta('accountsPayable');
    const otherCurrentAssetChange = -delta('otherCurrentAssets') - delta('prepaidExpenses');
    const otherCurrentLiabilityChange = delta('otherCurrentLiabilities') + delta('accruedExpenses') + delta('depositsReceived');
    const interestExpense = curr.pl.interestExpense || 0;
    const interestDividendIncome = curr.pl.interestAndDividendIncome || 0;

    const subtotal = sum(
      p1.incomeBeforeTax, depreciation, allowanceChange,
      -interestDividendIncome, interestExpense,
      receivableChange, inventoryChange, payableChange,
      otherCurrentAssetChange, otherCurrentLiabilityChange
    );
    const taxesPaid = -(curr.pl.incomeTaxes || 0);
    const operatingCF = sum(subtotal, interestDividendIncome, -interestExpense, taxesPaid);

    // II. 投資活動によるキャッシュフロー（固定資産の増減。簿価差＋減価償却費戻しで近似）
    const tangibleChange = -(delta('tangibleFixedAssets') + depreciation);
    const intangibleChange = -delta('intangibleFixedAssets');
    const investmentsChange = -delta('investmentsOther');
    const investingCF = sum(tangibleChange, intangibleChange, investmentsChange);

    // III. 財務活動によるキャッシュフロー
    const shortTermLoanChange = delta('shortTermLoans');
    const longTermLoanChange = delta('longTermLoans') + delta('currentPortionLongTermLoans');
    const officerLoanChange = delta('officerLoansPayable') || 0;
    const dividendsPaid = -(curr.dividendsPaid || 0);
    const financingCF = sum(shortTermLoanChange, longTermLoanChange, officerLoanChange, dividendsPaid);

    const netChange = sum(operatingCF, investingCF, financingCF);
    const cashBegin = b0.netAssets != null ? (prev.bs.cash || 0) : null;
    const cashEnd = curr.bs.cash || 0;
    // 検算：理論上は「CF計＝現預金の実際の増減」と一致するはずだが、間接法での近似
    // （特に投資CFの簿価差からの推定）により差異が生じ得るため、両者を突き合わせて
    // 差異を明示する（原因が分かっている分の調整は未実装。差異行として表示するのみ）。
    const actualCashChange = cashBegin != null ? sum(cashEnd, -cashBegin) : null;
    const cashReconciliationDiff = actualCashChange != null ? sum(netChange, -actualCashChange) : null;

    return {
      depreciation, depreciationMissing: p1.depreciationStatus === 'missing',
      allowanceChange, receivableChange, inventoryChange, payableChange,
      otherCurrentAssetChange, otherCurrentLiabilityChange, subtotal,
      interestDividendIncome, interestExpense, taxesPaid, operatingCF,
      tangibleChange, intangibleChange, investmentsChange, investingCF,
      shortTermLoanChange, longTermLoanChange, officerLoanChange, dividendsPaid, financingCF,
      netChange, cashBegin, cashEnd, actualCashChange, cashReconciliationDiff,
      freeCashFlow: sum(operatingCF, investingCF),
    };
  }

  // ---- 3期(または2期)データ全体の分析 -----------------------------------------
  // periods: 実データの配列（古い→新しい順, 2〜3件）
  // 2件しか無い場合は、先頭に「仮想の最古期」を合成する:
  //   ・ストック/スナップショット系の値は実データ1期目の値を複製（ZOU方式）
  //   ・フロー系（キャッシュフロー・当期の増減額等）は前段が無いため算出しない(null)
  function buildThreePeriodView(rawPeriods) {
    let periods = rawPeriods.slice();
    let padded = false;
    if (periods.length === 2) {
      padded = true;
      const clone = JSON.parse(JSON.stringify(periods[0]));
      clone.label = clone.syntheticLabel || '(前期間なし)';
      clone.synthetic = true;
      periods = [clone, ...periods];
    }
    const analyzed = periods.map(analyzePeriod);

    const withRatios = analyzed.map((a, i) => ({
      ...a,
      ratios: ratiosForPeriod(a),
      yoy: i > 0 ? yoyGrowth(a, analyzed[i - 1]) : null,
      // 合成した最古期(padded && i===0)はフロー計算をしない
      cf: (padded && i === 0) ? null : (i > 0 ? cashFlowStatement(a, analyzed[i - 1]) : null),
    }));

    return { periods: withRatios, padded };
  }

  return {
    sum, div, pct, round0,
    bsSummary, plSummary, loanSummary, fixedCostSummary, analyzePeriod,
    ratiosForPeriod, yoyGrowth, cashFlowStatement, buildThreePeriodView,
  };
})();

if (typeof module !== 'undefined') module.exports = DiscussionEngine;
