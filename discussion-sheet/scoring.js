/* ==========================================================================
   財務判定スコアリング・必要保障額エンジン

   【重要な注意】
   スコアリングの「枠組み」（4区分・11指標・配点構成・100点換算・財務判定1〜7の
   バンド）は、見本シート2社分の「定量要因合計(129点満点)」と「財務判定」の
   実際の数値（MYAP: 15→11→判定7／ZOU: 81→62→判定4）から検算し、一致を確認済み。
   一方、各指標ごとの詳細な閾値（何%で何点、という細かいバンド）は見本画像の
   密な配点マトリクスを転記したベストエフォートであり、完全な一致は未検証。
   実際の与信判断・顧客提案に使う前に、必ず原本のスコアリングシートと
   突き合わせて確認すること（UI上にも注記を表示）。
   ========================================================================== */

const Scoring = (() => {

  const CATEGORY_WEIGHTS = { safety: 34, profitability: 15, growth: 25, repayment: 55 }; // 合計129

  // 指標定義：band は [{ min, points }] を points 降順で並べる。value が初めて min 以上になった bandを採用。
  // direction: 'higher' = 値が大きいほど良い／'lower' = 値が小さいほど良い
  const INDICATORS = {
    selfCapitalRatio: {
      category: 'safety', label: '自己資本比率[%]', maxPoints: 10, direction: 'higher',
      bands: [[60, 10], [50, 9], [40, 8], [35, 7], [30, 6], [25, 5], [20, 4], [-Infinity, 0]],
    },
    gearingRatio: {
      category: 'safety', label: 'ギアリング比率[%]', maxPoints: 10, direction: 'lower',
      bands: [[0, 10], [50, 9], [100, 8], [150, 7], [200, 6], [250, 5], [300, 4], [Infinity, 0]],
    },
    fixedLongTermConformityRatio: {
      category: 'safety', label: '固定長期適合率[%]', maxPoints: 7, direction: 'lower',
      bands: [[0, 7], [80, 6], [100, 5], [120, 4], [140, 3], [160, 2], [180, 1], [Infinity, 0]],
    },
    currentRatio: {
      category: 'safety', label: '流動比率[%]', maxPoints: 7, direction: 'higher',
      bands: [[200, 7], [160, 6], [140, 5], [120, 4], [100, 3], [80, 2], [60, 1], [-Infinity, 0]],
    },
    ordinaryMargin: {
      category: 'profitability', label: '売上高経常利益率[%]', maxPoints: 5, direction: 'higher',
      bands: [[10, 5], [7, 4], [5, 3], [3, 2], [1, 1], [-Infinity, 0]],
    },
    roa: {
      category: 'profitability', label: '総資産経常利益率[%]', maxPoints: 5, direction: 'higher',
      bands: [[15, 5], [10, 4], [7, 3], [4, 2], [1, 1], [-Infinity, 0]],
    },
    cashFlowScore: {
      category: 'profitability', label: '収益力（キャッシュフロー額）[円]', maxPoints: 5, direction: 'higher',
      bands: [[50000000, 5], [20000000, 4], [5000000, 3], [1000000, 2], [1, 1], [-Infinity, 0]],
    },
    ordinaryIncomeGrowth: {
      category: 'growth', label: '経常利益増加率[%]', maxPoints: 25, direction: 'higher',
      bands: [[30, 25], [20, 20], [10, 15], [5, 10], [0, 5], [-Infinity, 0]],
    },
    debtServiceYears: {
      category: 'repayment', label: '債務償還年数[年]', maxPoints: 20, direction: 'lower',
      bands: [[0, 20], [5, 15], [7, 10], [10, 7], [15, 4], [20, 2], [Infinity, 0]],
    },
    interestCoverageRatio: {
      category: 'repayment', label: 'インタレスト・カバレッジ・レシオ[倍]', maxPoints: 15, direction: 'higher',
      bands: [[10, 15], [5, 10], [2.5, 7], [1, 4], [0, 2], [-Infinity, 0]],
    },
    cashFlowAmount: {
      category: 'repayment', label: 'キャッシュフロー額[円]', maxPoints: 20, direction: 'higher',
      bands: [[100000000, 20], [50000000, 15], [20000000, 10], [5000000, 5], [1000, 2], [-Infinity, 0]],
    },
  };

  const GRADE_BANDS = [
    [90, 1, '最高水準'], [80, 2, '高水準'], [65, 3, '安定的'], [50, 4, '良好的'],
    [40, 5, '平均的'], [25, 6, 'リスクあり'], [-Infinity, 7, 'リスクが高い'],
  ];

  function scoreIndicator(key, value) {
    const def = INDICATORS[key];
    if (value === null || value === undefined || Number.isNaN(value)) return { points: 0, def };
    for (const [min, points] of def.bands) {
      if (def.direction === 'higher' ? value >= min : value <= min) return { points, def };
    }
    return { points: 0, def };
  }

  // 次の得点バンドに到達するために必要な数値（あといくつで+何点、を出すための補助）。
  // bands は points 降順（＝達成しやすさの厳しい順）に並んでいるため、現在マッチした
  // バンドの1つ手前（配列上はインデックスが1小さい方）がちょうど1段階上のバンド。
  function nextThreshold(key, value) {
    const def = INDICATORS[key];
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    let matchedIdx = -1;
    for (let i = 0; i < def.bands.length; i++) {
      const [min] = def.bands[i];
      if (def.direction === 'higher' ? value >= min : value <= min) { matchedIdx = i; break; }
    }
    if (matchedIdx <= 0) return null; // 既に最高バンド、または該当なし
    const [nextMin, nextPoints] = def.bands[matchedIdx - 1];
    const diff = def.direction === 'higher' ? (nextMin - value) : (value - nextMin);
    return { nextMin, nextPoints, diff: Math.abs(diff), direction: def.direction };
  }

  // metrics: { selfCapitalRatio, gearingRatio, fixedLongTermConformityRatio, currentRatio,
  //            ordinaryMargin, roa, cashFlowScore, ordinaryIncomeGrowth,
  //            debtServiceYears, interestCoverageRatio, cashFlowAmount }
  function scoreAll(metrics) {
    const results = {};
    let total = 0;
    for (const key of Object.keys(INDICATORS)) {
      const r = scoreIndicator(key, metrics[key]);
      results[key] = { value: metrics[key], points: r.points, maxPoints: r.def.maxPoints, label: r.def.label, category: r.def.category };
      total += r.points;
    }
    const maxTotal = Object.values(INDICATORS).reduce((a, d) => a + d.maxPoints, 0); // 129
    const scaled = Math.floor((total / maxTotal) * 100);
    const grade = GRADE_BANDS.find(([min]) => scaled >= min);
    return { results, total, maxTotal, scaled, grade: grade[1], gradeLabel: grade[2] };
  }

  // ---- 必要保障額（事業保障資金）試算 ----------------------------------------
  // 各係数は advisor が自社ポリシーに合わせて編集できる前提の「標準的な考え方」の初期値。
  // ソニー生命の内部係数そのものではない（見本からの完全な数式復元はできていない）。
  const COVERAGE_DEFAULTS = {
    workingCapitalMonths: 6,       // ①運転資金の必要月数
    disabilityMonths: 36,          // 就業不能時の必要月数（参考値として算出のみ行い、本紙には表示しない）
    deathRetirementMultiple: 3.0,  // ⑦死亡退職金の功績倍率
    resignationRetirementMultiple: 2.0, // 勇退退職金の功績倍率
    effectiveTaxRate: 0.3358,      // 実効税率：保険金受取時の益金算入等を見込み、必要保障額を手取りベースから
                                   // 保険金額（グロス）ベースに割り戻すために使用する
    buybackRatio: 1.0,             // ⑨自社株買取資金＝自社株評価額の何%を想定するか
  };

  function necessaryCoverage(period, stockValuationPerShare, sharesHeldByFamily, officerInfo, preparedAssets, assumptions) {
    const a = { ...COVERAGE_DEFAULTS, ...(assumptions || {}) };
    const monthlyFixedCost = (period.fixedCostAnnualTotal || 0) / 12;

    const workingCapital = monthlyFixedCost * a.workingCapitalMonths;
    const shortTermDebtRepayment = (period.bsSum.currentLiabilitiesInterestBearing) ||
      (period.loanSum.shortTermTotal + (period.bs.currentPortionLongTermLoans || 0));
    const shortTermGuarantee = period.loanSum.shortTermGuaranteeTotal || 0;
    const longTermDebtRepayment = period.bs.longTermLoans || 0;
    const longTermGuarantee = period.loanSum.longTermGuaranteeTotal || 0;
    const disabilityCapital = monthlyFixedCost * a.disabilityMonths;

    const finalMonthlyComp = officerInfo?.finalMonthlyCompensation || 0;
    const tenureYears = officerInfo?.tenureYears || 0;
    const deathRetirement = finalMonthlyComp * tenureYears * a.deathRetirementMultiple;
    const resignationRetirement = finalMonthlyComp * tenureYears * a.resignationRetirementMultiple;

    const stockBuyback = (stockValuationPerShare || 0) * (sharesHeldByFamily || 0) * a.buybackRatio;

    // 手取りベースでの必要資金合計。保険金として受け取る際は法人税等が課されるため、
    // 実効税率で割り戻し（グロスアップ）して、実際に備えるべき保険金額ベースの
    // 必要保障額を算出する（総額 ＝ 手取りベース ÷ (1－実効税率)）。
    const totalBeforeTax = sum(workingCapital, shortTermDebtRepayment, longTermDebtRepayment, stockBuyback);
    const taxGrossUpFactor = 1 / (1 - a.effectiveTaxRate);
    const total = totalBeforeTax * taxGrossUpFactor;
    const shortfall = Math.max(0, total - (preparedAssets || 0));

    return {
      workingCapital, shortTermDebtRepayment, shortTermGuarantee, longTermDebtRepayment, longTermGuarantee,
      disabilityCapital, deathRetirement, resignationRetirement, stockBuyback,
      preparedAssets: preparedAssets || 0, totalBeforeTax, taxGrossUpFactor, total, shortfall, assumptions: a,
    };
  }
  function sum(...vals) { return vals.reduce((a, b) => a + (Number(b) || 0), 0); }

  return { INDICATORS, GRADE_BANDS, CATEGORY_WEIGHTS, scoreIndicator, nextThreshold, scoreAll, COVERAGE_DEFAULTS, necessaryCoverage };
})();

if (typeof module !== 'undefined') module.exports = Scoring;
