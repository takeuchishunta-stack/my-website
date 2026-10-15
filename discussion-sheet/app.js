/* ==========================================================================
   UI 制御・描画ロジック（DOM 操作はすべてここに集約）
   ========================================================================== */

let STATE = { raw: null, view: null, stockEval: null, scoring: null, coverage: null };
const TOTAL_PAGES = 7;

// ---- 章アイコン（装飾用。識別は常にアイコン形状＋テキストラベルで行い、色だけに頼らない） ---
const ICONS = {
  financial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/></svg>',
  cashflow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h12l-3-3"/><path d="M15 7l-3 3"/><path d="M21 17H9l3 3"/><path d="M9 17l3-3"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M4 19h16"/></svg>',
  coverage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c4 2 8 2 8 2v7c0 5-4 7-8 9-4-2-8-4-8-9V5s4 0 8-2z"/></svg>',
  scoring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6 6.6.6-5 4.4 1.5 6.5L12 16l-5.9 3.5L7.6 13l-5-4.4 6.6-.6z"/></svg>',
  statements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 13h6M9 17h6M9 9h2"/></svg>',
};

function sheetHead(iconKey, colorVar, title, pageNo) {
  return `<div class="sheet-head" style="background:var(${colorVar});">
    <span class="icon-badge">${ICONS[iconKey]}</span>
    <h2>${title}</h2>
    <span class="page-no">${pageNo}/${TOTAL_PAGES}</span>
  </div>`;
}
function panel(title, body, { span2 = false, tag = '' } = {}) {
  return `<div class="panel${span2 ? ' grid-span-2' : ''}">
    <h3>${title}${tag ? `<span class="tag">${tag}</span>` : ''}</h3>
    ${body}
  </div>`;
}
function takeaway(text) { return `<div class="takeaway">${text}</div>`; }
function formulaLine(html) { return `<div class="formula">${html}</div>`; }
function stripHtml(s) { return String(s).replace(/<[^>]+>/g, ''); }

// ---- フォーマッタ ----------------------------------------------------------
const fmt = (n, digits = 0) => (n === null || n === undefined || Number.isNaN(n))
  ? '<span class="na">ー</span>'
  : Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits) < 0
    ? `<span class="neg">${(-n).toLocaleString('ja-JP', { maximumFractionDigits: digits })}減</span>`
    : n.toLocaleString('ja-JP', { maximumFractionDigits: digits });
const fmtYen = (n) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">ー</span>'
  : `${Math.round(n).toLocaleString('ja-JP')}円`;
const fmtPct = (n) => (n === null || n === undefined || Number.isNaN(n)) ? '<span class="na">ー</span>'
  : `${n.toFixed(2)}%`;
const cls = (n) => (n === null || n === undefined) ? 'na' : (n < 0 ? 'neg' : '');

function periodHeaderRow(periods) {
  return `<tr><th>項目</th>${periods.map(p => `<th>${p.label}${p.synthetic ? '<span class="disclaimer-badge">複製/推定</span>' : ''}</th>`).join('')}</tr>`;
}

function dataRow(label, values, { fmtFn = fmt, digits = 0, total = false } = {}) {
  const tds = values.map(v => `<td class="${cls(v)}">${fmtFn === fmt ? fmt(v, digits) : fmtFn(v)}</td>`).join('');
  return `<tr class="${total ? 'total' : ''}"><td>${label}</td>${tds}</tr>`;
}

// ---- データ読込 -------------------------------------------------------------
async function loadSample(name) {
  const res = await fetch(`sample-data/sample-${name}.json`);
  const json = await res.json();
  document.getElementById('json-input').value = JSON.stringify(json, null, 2);
  applyData(json);
}

function applyFromTextarea() {
  try {
    const json = JSON.parse(document.getElementById('json-input').value);
    applyData(json);
    document.getElementById('load-error').textContent = '';
  } catch (e) {
    document.getElementById('load-error').textContent = '⚠ JSONの読み込みに失敗しました: ' + e.message;
  }
}

function applyData(data) {
  STATE.raw = data;
  STATE.view = DiscussionEngine.buildThreePeriodView(data.periods);
  const latest = STATE.view.periods[STATE.view.periods.length - 1];
  const prevForGrowth = STATE.view.periods[STATE.view.periods.length - 2];

  // 自社株評価（直近期ベース）
  // 医療法人の出資持分など、本ツールの評価方式が適用できないエンティティは
  // データ側で skipStockValuation:true を指定することでスキップできる。
  STATE.stockEval = null;
  if (data.skipStockValuation) {
    STATE.stockEvalSkipReason = data.skipStockValuationReason || 'このエンティティ種別には現在の自社株評価ロジックは対応していません。';
  } else try {
    STATE.stockEval = StockValuation.evaluate({
      industryCategory: data.industryCategory || 'その他',
      totalAssetsBookValue: latest.bsSum.totalAssets,
      employeeCount: (data.employees && data.employees.length) || 0,
      annualSales: latest.pl.netSales,
      netAssetsBookValue: latest.bsSum.netAssets,
      // 含み益調整：土地・有価証券等の時価が帳簿価額と大きく異なる場合は、
      // 入力JSONの該当期に "netAssetsTaxValueOverride"（相続税評価ベースの純資産額）を
      // 追加すると、含み益に対する法人税相当額(37%)控除を反映した評価になる。
      netAssetsTaxValue: latest.netAssetsTaxValueOverride != null ? latest.netAssetsTaxValueOverride : latest.bsSum.netAssets,
      capitalAmount: data.capitalAmount,
      totalShares: data.totalShares,
      treasuryShares: data.treasuryShares || 0,
      annualProfit: latest.plSum.incomeBeforeTax,
      annualProfitPrevAvg: prevForGrowth ? (latest.plSum.incomeBeforeTax + prevForGrowth.plSum.incomeBeforeTax) / 2 : null,
      dividendPaid2YrAvg: latest.dividendsPaid || 0,
      similarIndustry: data.similarIndustry || {},
      effectiveTaxRate: 0.37,
    });
  } catch (e) { STATE.stockEval = null; console.error(e); }

  // スコアリング（直近期ベース）
  const r = latest.ratios;
  STATE.scoring = Scoring.scoreAll({
    selfCapitalRatio: r.selfCapitalRatio, gearingRatio: r.gearingRatio,
    fixedLongTermConformityRatio: r.fixedLongTermConformityRatio, currentRatio: r.currentRatio,
    ordinaryMargin: r.ordinaryMargin, roa: r.roa, cashFlowScore: r.cashFlowAmount,
    ordinaryIncomeGrowth: latest.yoy ? latest.yoy.ordinaryIncomeGrowth : null,
    debtServiceYears: r.debtServiceYears, interestCoverageRatio: r.interestCoverageRatio,
    cashFlowAmount: r.cashFlowAmount,
  });

  // 必要保障額
  const sharesHeldByFamily = (data.shareholders || []).reduce((a, s) => a + (s.shares || 0), 0);
  STATE.coverage = Scoring.necessaryCoverage(
    latest,
    STATE.stockEval ? STATE.stockEval.corporateTaxValue : 0,
    sharesHeldByFamily,
    data.officers && data.officers[0],
    (data.preparedAssets || 0),
    {}
  );

  renderAll();
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('report-root').style.display = 'block';
  document.getElementById('company-name-title').textContent = data.companyName || '(会社名未設定)';
}

// ---- 表紙 -------------------------------------------------------------------
function renderCover() {
  const data = STATE.raw;
  const periods = STATE.view.periods;
  const first = periods[0], last = periods[periods.length - 1];
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const idx = [
    ['financial', '--sec-financial', '財務の観点', '借入金の状況や返済に要する年数など、資金調達の安定度を確認します。', 1],
    ['cashflow', '--sec-cashflow', 'キャッシュフローの観点', '営業・投資・財務の3区分で、お金の流れの実態を把握します。', 2],
    ['stock', '--sec-stock', '自社株の観点', '相続税評価額等、自社株の評価額を複数方式で試算します。', 3],
    ['coverage', '--sec-coverage', '必要保障の観点', '不測の事態に備え、事業継続に必要な資金を試算します。', 4],
    ['scoring', '--sec-scoring', '4つの観点まとめ', '各観点の要点を1枚に整理し、全体像を確認します。', 5],
    ['statements', '--sec-statements', '決算情報・スコアリング', '決算書の詳細と、定量データに基づく財務判定の根拠です。', 6],
  ].map(([key, color, title, desc, page]) => `
    <div class="idx-row">
      <span class="icon-badge" style="background:${color.startsWith('--') ? `var(${color})` : color};">${ICONS[key]}</span>
      <div style="flex:1;">
        <div class="idx-title">${title}</div>
        <div class="idx-desc">${desc}</div>
      </div>
      <div class="idx-page">P.${page}</div>
    </div>`).join('');
  document.getElementById('report-cover').innerHTML = `
    <div class="cover-left">
      <div>
        <div class="eyebrow">財務分析資料 / DISCUSSION SHEET</div>
        <h1>${data.companyName || '(会社名未設定)'}<br>ディスカッションシート</h1>
      </div>
      <div class="meta">
        <div>対象期間：${first.label} 〜 ${last.label}</div>
        <div>作成日：${today}</div>
        <div style="margin-top:14px; opacity:0.75;">本資料は、お預かりした決算書等の情報をもとに、社内の分析基準に基づき作成した参考資料です。各試算値は将来の成果を保証するものではありません。実際のご提案にあたっては、別途、原本資料・顧問税理士等にご確認のうえご活用ください。</div>
      </div>
    </div>
    <div class="cover-right">${idx}</div>`;
}

function renderAll() {
  renderCover();
  renderFinancial();
  renderCashFlow();
  renderStock();
  renderCoverage();
  renderOverview();
  renderStatements();
  renderScoring();
}

// ---- 1. 財務の観点 ----------------------------------------------------------
function renderFinancial() {
  const periods = STATE.view.periods;
  const latest = periods[periods.length - 1];
  const labels = periods.map(p => p.label);

  const safetyBody = `
    <div class="chart-card-body">${Viz.lineChart(labels, [{ name: '自己資本比率', values: periods.map(p => p.ratios.selfCapitalRatio) }], { unit: '%' })}</div>
    ${formulaLine(`自己資本比率 ＝ 純資産合計 ÷ 総資産合計 ＝ <b>${fmt(latest.bsSum.netAssets)}</b> ÷ <b>${fmt(latest.bsSum.totalAssets)}</b> ＝ <b>${fmtPct(latest.ratios.selfCapitalRatio)}</b>`)}
    <table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('自己資本比率[%]', periods.map(p => p.ratios.selfCapitalRatio), { fmtFn: fmtPct })}
    ${dataRow('ギアリング比率[%]', periods.map(p => p.ratios.gearingRatio), { fmtFn: fmtPct })}
    ${dataRow('固定長期適合率[%]', periods.map(p => p.ratios.fixedLongTermConformityRatio), { fmtFn: fmtPct })}
    ${dataRow('流動比率[%]', periods.map(p => p.ratios.currentRatio), { fmtFn: fmtPct })}
    ${dataRow('純資産合計', periods.map(p => p.bsSum.netAssets))}
    ${dataRow('総資産合計', periods.map(p => p.bsSum.totalAssets), { total: true })}
    </tbody></table>`;

  const debtBody = `
    <div class="chart-card-body">${Viz.columnChart(labels, periods.map(p => p.bsSum.interestBearingDebt), { color: Viz.PALETTE.series[0] })}</div>
    ${formulaLine(`返済に要する年数 ＝ (有利子負債－現金預金) ÷ (営業利益＋減価償却費) ＝ <b>${fmt(latest.ratios.debtServiceYears, 1)}</b>年（1年以内が最高評価）`)}
    <table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('短期借入金合計', periods.map(p => p.loanSum.shortTermTotal))}
    ${dataRow('長期借入金合計', periods.map(p => p.loanSum.longTermTotal))}
    ${dataRow('有利子負債合計', periods.map(p => p.bsSum.interestBearingDebt), { total: true })}
    ${dataRow('債務償還年数[年]', periods.map(p => p.ratios.debtServiceYears), { fmtFn: (v) => v === null ? 'ー' : v.toFixed(1) + '年' })}
    </tbody></table>`;

  const loanRowsTable = (loans, cols) => {
    if (!loans || !loans.length) return `<div class="caption">内訳データなし（決算書の勘定科目内訳書等をご確認ください）</div>`;
    return `<table class="dsheet compact"><thead><tr><th>金融機関名</th><th>残高</th><th>金利</th><th>連帯保証額(参考)</th></tr></thead><tbody>
      ${loans.map(l => `<tr><td>${l.lender || 'ー'}</td><td>${fmt(l.balance)}</td><td>${l.rate != null ? l.rate + '%' : 'ー'}</td><td>${fmt(l.guaranteeAmount || 0)}</td></tr>`).join('')}
    </tbody></table>`;
  };

  const netAssetsChange = latest.bsSum.netAssets - periods[0].bsSum.netAssets;
  const balanceBody = `
    <div class="chart-card-body">${Viz.groupedBarChart(labels, [
      { name: '総資産', values: periods.map(p => p.bsSum.totalAssets) },
      { name: '純資産', values: periods.map(p => p.bsSum.netAssets) },
      { name: '有利子負債', values: periods.map(p => p.bsSum.interestBearingDebt) },
    ], { height: 64 })}</div>
    ${formulaLine(`純資産の増減（${periods[0].label}比） ＝ <b>${fmt(latest.bsSum.netAssets)}</b> － <b>${fmt(periods[0].bsSum.netAssets)}</b> ＝ <b>${netAssetsChange >= 0 ? '+' : ''}${fmt(netAssetsChange)}</b>`)}
    <table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('総資産合計', periods.map(p => p.bsSum.totalAssets))}
    ${dataRow('純資産合計', periods.map(p => p.bsSum.netAssets))}
    ${dataRow('有利子負債合計', periods.map(p => p.bsSum.interestBearingDebt))}
    </tbody></table>`;

  const safetyTrend = latest.ratios.selfCapitalRatio - periods[0].ratios.selfCapitalRatio;
  const dynamicTakeaway = safetyTrend >= 0
    ? `自己資本比率は${periods[0].label}の${fmtPct(periods[0].ratios.selfCapitalRatio)}から${latest.label}は${fmtPct(latest.ratios.selfCapitalRatio)}へ${safetyTrend >= 0.05 ? '改善し' : 'ほぼ横ばいで推移し'}、対外的な評価を高める方向にあります。借入条件の見直しや金融機関との対話にこの推移を活用してください。`
    : `自己資本比率は${periods[0].label}の${fmtPct(periods[0].ratios.selfCapitalRatio)}から${latest.label}は${fmtPct(latest.ratios.selfCapitalRatio)}へ低下しています。固定費の見直しと内部留保の積み増しにより、財務の安定度を高めることが優先課題です。`;

  const html = `<div class="sheet">
    ${sheetHead('financial', '--sec-financial', '財務の観点', 1)}
    <div class="sheet-sub">資金調達手段の偏りが経営の安定化のカギ。固定費の見直しと財務の現状把握を行います（直近期：${latest.label}）。</div>
    <div class="grid-2">
      ${panel('自己資本比率・安全性指標の推移', safetyBody)}
      ${panel('借入金・返済年数の推移', debtBody)}
      ${panel('短期借入金の内訳（直近期）', loanRowsTable(latest.loanSum.shortTerm))}
      ${panel('長期借入金の内訳（直近期）', loanRowsTable(latest.loanSum.longTerm))}
      ${panel('総資産・純資産・有利子負債の実数推移', balanceBody, { span2: true })}
    </div>
    ${takeaway(dynamicTakeaway)}
  </div>`;
  document.getElementById('tab-financial').innerHTML = html;
}

// ---- 2. キャッシュフローの観点 ------------------------------------------------
function renderCashFlow() {
  const periods = STATE.view.periods;
  const latest = periods[periods.length - 1];
  const labels = periods.map(p => p.label);
  const hasCf = periods.some(p => p.cf);

  const salesBody = `<div class="chart-card-body">${Viz.columnChart(labels, periods.map(p => p.pl.netSales), { color: Viz.PALETTE.series[0], height: 58 })}</div>
    ${latest.yoy ? formulaLine(`対前年伸び率 ＝ (当期売上－前期売上) ÷ 前期売上 ＝ <b>${fmtPct(latest.yoy.salesGrowth)}</b>`) : ''}`;

  const marginBody = `<div class="chart-card-body">${Viz.lineChart(labels, [
    { name: '営業利益率', values: periods.map(p => p.ratios.operatingMargin) },
    { name: '経常利益率', values: periods.map(p => p.ratios.ordinaryMargin) },
  ], { unit: '%', height: 54 })}</div>
    <table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('対前年伸び率[%]', periods.map(p => p.yoy && p.yoy.salesGrowth), { fmtFn: fmtPct })}
    ${dataRow('粗利率[%]', periods.map(p => p.ratios.grossMargin), { fmtFn: fmtPct })}
    ${dataRow('営業利益率[%]', periods.map(p => p.ratios.operatingMargin), { fmtFn: fmtPct })}
    ${dataRow('経常利益率[%]', periods.map(p => p.ratios.ordinaryMargin), { fmtFn: fmtPct })}
    </tbody></table>`;

  const cfBody = `${hasCf ? `<div class="chart-card-body">${Viz.groupedBarChart(labels, [
      { name: '営業CF', values: periods.map(p => p.cf && p.cf.operatingCF) },
      { name: '投資CF', values: periods.map(p => p.cf && p.cf.investingCF) },
      { name: '財務CF', values: periods.map(p => p.cf && p.cf.financingCF) },
    ], { height: 48 })}</div>` : ''}
    ${latest.cf ? formulaLine(`営業CF ＝ 税引前当期純利益＋減価償却費±運転資本増減－法人税等 ＝ <b>${fmt(latest.cf.operatingCF)}</b>　／　フリーCF(①+②) ＝ <b>${fmt(latest.cf.freeCashFlow)}</b>`) : ''}
    <table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('①営業キャッシュフロー', periods.map(p => p.cf && p.cf.operatingCF))}
    ${dataRow('②投資キャッシュフロー', periods.map(p => p.cf && p.cf.investingCF))}
    ${dataRow('③フリーCF(①+②)', periods.map(p => p.cf && p.cf.freeCashFlow), { total: true })}
    ${dataRow('④財務キャッシュフロー', periods.map(p => p.cf && p.cf.financingCF))}
    ${dataRow('⑤CF計(③+④)', periods.map(p => p.cf && p.cf.netChange))}
    </tbody></table>
    <div class="caption">最も古い期間は前期の貸借対照表が無いため算出できません（「ー」表示）。</div>`;

  const officerList = latest.officerCompensationDetail || [];
  const hasOfficerDetail = officerList.length > 0;
  const officerBody = `<table class="dsheet compact"><thead><tr><th>役員名</th><th>報酬額</th></tr></thead><tbody>
      ${officerList.map(o => `<tr><td>${o.name}</td><td>${fmt(o.amount)}</td></tr>`).join('')}
      </tbody></table>`;
  // 役員報酬の個別データが無い場合、空のパネルを並べると印刷時に行の高さが
  // 噛み合わず不自然な余白が出るため、固定費パネルを単独で全幅表示にする。
  const bottomRow = hasOfficerDetail
    ? `${panel('役員報酬（直近期）', officerBody)}${panel('固定費の内訳（直近期・上位10件）', renderSgaTable(latest))}`
    : panel('固定費の内訳（直近期・上位10件）', renderSgaTable(latest), { span2: true });

  const html = `<div class="sheet">
    ${sheetHead('cashflow', '--sec-cashflow', 'キャッシュフローの観点', 2)}
    <div class="sheet-sub">黒字でも資金が不足することがある。手元のキャッシュフローの実態を見極めます（直近期：${latest.label}）。</div>
    <div class="grid-2">
      ${panel('売上高の推移', salesBody)}
      ${panel('利益率の推移', marginBody)}
      ${panel('キャッシュフローの推移', cfBody, { span2: true })}
      ${bottomRow}
    </div>
    ${takeaway('流出金額の見直しなど、利益確保を意識した費用のコントロールにより、キャッシュフローの最適化を図れます。')}
  </div>`;
  document.getElementById('tab-cashflow').innerHTML = html;
}

function renderSgaTable(period) {
  const detail = period.pl.sgaDetail || {};
  const entries = Object.entries(detail).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const TOP_N = 5;
  const top = entries.slice(0, TOP_N);
  const restTotal = entries.slice(TOP_N).reduce((a, [, v]) => a + v, 0);
  const restCount = entries.length - top.length;
  const shown = restCount > 0 ? [...top, [`その他（${restCount}科目）`, restTotal]] : top;
  const maxV = Math.max(...shown.map(([, v]) => v), 1);

  const bars = shown.map(([k, v]) => `
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:2px;">
      <div style="width:110px;font-size:0.7rem;color:var(--ink-secondary);flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${k}</div>
      <div style="flex:1;">${Viz.meter(v, maxV, { width: 180, height: 9, color: Viz.PALETTE.series[0] })}</div>
      <div style="width:88px;text-align:right;font-size:0.72rem;flex:none;">${fmt(v)}</div>
    </div>`).join('');

  return `<div class="chart-card-body" style="margin-bottom:6px;">${bars}</div>
    <div class="caption">販管費合計：${fmt(period.plSum.sgaTotal)}円。全科目の内訳はExcel出力に収録。</div>`;
}

// ---- 3. 自社株の観点 ---------------------------------------------------------
function renderStock() {
  const sv = STATE.stockEval;
  const data = STATE.raw;
  if (!sv) {
    const reason = STATE.stockEvalSkipReason || '自社株評価の算出に失敗しました。入力データ（資本金・発行株式数・業種等）を確認してください。';
    document.getElementById('tab-stock').innerHTML = `<div class="sheet">
      ${sheetHead('stock', '--sec-stock', '自社株の観点', 3)}
      <div class="notice">⚠ ${reason}</div>
    </div>`;
    return;
  }
  const si = data.similarIndustry || {};
  const needsSimilarInput = si.A == null;
  const methods = [
    { name: '類似業種比準価額', value: sv.similarIndustryValue.perShare, color: Viz.PALETTE.series[0] },
    { name: '純資産価額', value: sv.netAssetValue.perShareInheritance, color: Viz.PALETTE.series[1] },
    { name: '配当還元価額', value: sv.dividendValue.perShare, color: Viz.PALETTE.series[2] },
    { name: '法人税評価額', value: sv.corporateTaxValue, color: '#6250d6' },
  ];
  const maxMethodValue = Math.max(...methods.map(m => m.value), 1);
  const methodBars = methods.map(m => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="width:100px;font-size:0.72rem;color:var(--ink-secondary);flex:none;">${m.name}</div>
      <div style="flex:1;">${Viz.meter(m.value, maxMethodValue, { width: 220, height: 13, color: m.color })}</div>
      <div style="width:95px;text-align:right;font-weight:700;font-size:0.78rem;flex:none;">${fmtYen(m.value)}</div>
    </div>`).join('');

  const latestForSize = STATE.view.periods[STATE.view.periods.length - 1];
  const sizeBody = `<table class="dsheet compact"><tbody>
    <tr><td>業種</td><td>${data.industryDetail || data.industryCategory || 'ー'}</td></tr>
    <tr><td>総資産価額（帳簿）</td><td>${fmt(latestForSize.bsSum.totalAssets)}円</td></tr>
    <tr><td>従業員数</td><td>${(data.employees && data.employees.length) || 0}人</td></tr>
    <tr><td>会社規模</td><td><b>${sv.sizeJudge.size}</b></td></tr>
    <tr><td>斟酌率</td><td>${sv.shinshakuRate}</td></tr>
    <tr><td>併用割合（類似業種比準の重みL）</td><td>${sv.combinedWeightL}</td></tr>
  </tbody></table>
  <div class="caption">${sv.combinedNote}</div>`;

  const elementsBody = `<table class="dsheet compact"><thead><tr><th>比準要素</th><th>値（1株(50円)あたり）</th></tr></thead><tbody>
    <tr><td>b：配当金額</td><td>${sv.elements.b.toFixed(2)}円</td></tr>
    <tr><td>c：利益金額</td><td>${sv.elements.c.toFixed(2)}円</td></tr>
    <tr><td>d：純資産価額（簿価）</td><td>${sv.elements.d.toFixed(2)}円</td></tr>
  </tbody></table>
  ${formulaLine(`類似業種比準価額 ＝ 類似業種株価(A) × [(b/B＋c/C＋d/D)/3] × 斟酌率 × (資本金等の額を50円とした時の株数調整) ＝ <b>${fmtYen(sv.similarIndustryValue.perShare)}</b>`)}
  ${needsSimilarInput ? `<div class="notice">⚠ 類似業種のA（株価）・B（配当）・C（利益）・D（純資産）が未入力のため0扱いです。国税庁公表データをJSONの similarIndustry に入力してください。</div>` : ''}`;

  const combinedBody = `<div class="chart-card-body">${methodBars}</div>
    ${formulaLine(`併用方式 ＝ 類似業種比準価額 × ${sv.combinedWeightL} ＋ 純資産価額 × ${(1 - sv.combinedWeightL).toFixed(2)} ＝ <b>${fmtYen(sv.inheritanceTaxValue)}</b>（1株あたり）`)}
    <table class="dsheet compact"><thead><tr><th>方式</th><th>評価額（1株）</th></tr></thead><tbody>
    ${dataRow('類似業種比準価額', [sv.similarIndustryValue.perShare], { fmtFn: fmtYen })}
    ${dataRow('純資産価額（相続税評価ベース）', [sv.netAssetValue.perShareInheritance], { fmtFn: fmtYen })}
    ${dataRow('併用方式（相続税評価額）', [sv.inheritanceTaxValue], { fmtFn: fmtYen, total: true })}
    ${dataRow('配当還元価額', [sv.dividendValue.perShare], { fmtFn: fmtYen })}
    ${dataRow('法人税評価額（簡易）', [sv.corporateTaxValue], { fmtFn: fmtYen })}
    </tbody></table>`;

  const shareholderBody = (data.shareholders || []).length
    ? `<table class="dsheet compact"><thead><tr><th>株主名</th><th>株数</th><th>持分割合</th><th>相続税評価額(合計)</th></tr></thead><tbody>
      ${data.shareholders.map(s => `<tr><td>${s.name}</td><td>${fmt(s.shares)}</td><td>${fmtPct(100 * s.shares / data.totalShares)}</td><td>${fmtYen(sv.inheritanceTaxValue * s.shares)}</td></tr>`).join('')}
      </tbody></table>`
    : `<div class="caption">株主データなし</div>`;

  const html = `<div class="sheet">
    ${sheetHead('stock', '--sec-stock', '自社株の観点', 3)}
    <div class="sheet-sub">会社の成長・業績向上は、自社株の評価額上昇にもつながる。自社株評価の現状を把握します。</div>
    <div class="grid-2">
      ${panel('会社規模判定', sizeBody)}
      ${panel('類似業種比準の算定要素', elementsBody)}
      ${panel('評価額一覧（1株あたり・併用方式）', combinedBody, { span2: true })}
      ${panel('株主一覧', shareholderBody, { span2: true })}
    </div>
    ${takeaway('計画的な自社株の移転・集中は、事業承継を円滑に進めるための重要な要素となります。')}
  </div>`;
  document.getElementById('tab-stock').innerHTML = html;
}

// ---- 4. 必要保障の観点 --------------------------------------------------------
function renderCoverage() {
  const c = STATE.coverage;
  const covered = Math.max(0, c.total - c.shortfall);
  const rows = [
    ['①運転資金', c.workingCapital, `月額固定費 × ${c.assumptions.workingCapitalMonths}ヶ月`],
    ['②負債等の返済資金（短期）', c.shortTermDebtRepayment, '短期借入金＋1年以内返済長期借入金'],
    ['　内、連帯保証債務（短期）[参考]', c.shortTermGuarantee, '短期の連帯保証額合計'],
    ['③負債等の返済資金（長期）', c.longTermDebtRepayment, '長期借入金残高'],
    ['　内、連帯保証債務（長期）[参考]', c.longTermGuarantee, '長期の連帯保証額合計'],
    ['④就業不能時の運転資金[参考]', c.disabilityCapital, `月額固定費 × ${c.assumptions.disabilityMonths}ヶ月`],
    ['⑤役員死亡退職金[参考]', c.deathRetirement, `最終報酬月額 × 在任年数 × 功績倍率${c.assumptions.deathRetirementMultiple}`],
    ['　役員勇退退職金[参考]', c.resignationRetirement, `最終報酬月額 × 在任年数 × 功績倍率${c.assumptions.resignationRetirementMultiple}`],
    ['⑥事業承継対策資金（自社株買取資金）', c.stockBuyback, '自社株評価額（法人税評価） × 同族保有株数'],
    ['準備済み資産（既加入の保険等）', -c.preparedAssets, '現在加入している生命保険の解約返戻金相当額等'],
  ];

  const tryBody = `<div class="chart-card-body">${Viz.stackedBarRow('必要保障額 合計 ' + stripHtml(fmtYen(c.total)), [
      { name: `準備済み資産 ${stripHtml(fmtYen(covered))}`, value: covered, color: Viz.PALETTE.good },
      { name: `不足金額 ${stripHtml(fmtYen(c.shortfall))}`, value: c.shortfall, color: Viz.PALETTE.critical },
    ], { width: 520, barHeight: 26 })}</div>
    ${formulaLine(`不足金額 ＝ 必要保障額合計 － 準備済み資産 ＝ <b>${fmt(c.total)}</b> － <b>${fmt(c.preparedAssets)}</b> ＝ <b>${fmt(c.shortfall)}</b>`)}`;

  const tableBody = `<table class="dsheet compact"><thead><tr><th>項目</th><th>金額</th><th>試算根拠</th></tr></thead><tbody>
    ${rows.map(([l, v, basis]) => `<tr><td>${l}</td><td class="${cls(v)}">${fmt(v)}</td><td style="text-align:left;font-size:0.7rem;color:var(--ink-muted);">${basis}</td></tr>`).join('')}
    <tr class="total"><td>必要保障額 合計</td><td>${fmt(c.total)}</td><td></td></tr>
    <tr class="total"><td>不足金額</td><td>${fmt(c.shortfall)}</td><td></td></tr>
    </tbody></table>`;

  const purposeBody = `<table class="dsheet compact"><thead><tr><th>区分</th><th>資金準備の目的</th></tr></thead><tbody>
    <tr><td>会社経営</td><td style="text-align:left;">運転資金 / 負債等の返済資金・移転資金 / 自社株買取資金</td></tr>
    <tr><td>役員・従業員</td><td style="text-align:left;">死亡退職金・弔慰金 / 勇退退職金・見舞金 / 就業不能時の補填</td></tr>
    <tr><td>社長個人</td><td style="text-align:left;">ご遺族の生活資金 / 老後の資産形成 / 医療・介護資金</td></tr>
    </tbody></table>`;

  const breakdownItems = [
    ['①運転資金', c.workingCapital],
    ['②③負債等の返済資金', c.shortTermDebtRepayment + c.longTermDebtRepayment],
    ['④就業不能時の運転資金', c.disabilityCapital],
    ['⑤退職金・弔慰金', c.deathRetirement + c.resignationRetirement],
    ['⑥自社株買取資金', c.stockBuyback],
  ].filter(([, v]) => v);
  const maxBreakdown = Math.max(...breakdownItems.map(([, v]) => v), 1);
  const breakdownBody = `<div class="chart-card-body">${breakdownItems.map(([k, v]) => `
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;">
      <div style="width:160px;font-size:0.72rem;color:var(--ink-secondary);flex:none;">${k}</div>
      <div style="flex:1;">${Viz.meter(v, maxBreakdown, { width: 260, height: 11, color: Viz.PALETTE.series[1] })}</div>
      <div style="width:95px;text-align:right;font-size:0.74rem;flex:none;">${fmt(v)}</div>
    </div>`).join('')}</div>
    <div class="caption">必要保障額合計 ${fmt(c.total)}円 のうち、金額の大きい構成要素を比較しています（参考科目を除く）。</div>`;

  const shortfallRatio = c.total ? (c.shortfall / c.total) * 100 : 0;
  const dynamicTakeaway = c.shortfall > 0
    ? `必要保障額合計${fmt(c.total)}円に対し、現状の準備済み資産は${fmt(c.preparedAssets)}円にとどまり、不足金額は${fmt(c.shortfall)}円（必要額の${shortfallRatio.toFixed(0)}%）です。リスクの大きさや変化に応じ、保険等による計画的な資金準備が必要です。`
    : `必要保障額合計${fmt(c.total)}円に対し、準備済み資産${fmt(c.preparedAssets)}円で既に充足しています。今後の事業規模の変化に応じて、定期的に必要保障額を見直してください。`;

  const html = `<div class="sheet">
    ${sheetHead('coverage', '--sec-coverage', '必要保障の観点', 4)}
    <div class="sheet-sub">何かあっても事業を継続できるよう、必要な資金をあらかじめ把握しておきます。</div>
    <div class="notice">この試算は一般的な考え方に基づく初期設定値を使用しています。実際のご提案時は顧問先の実情に合わせて係数を調整してください。</div>
    <div class="grid-2">
      ${panel('必要保障額に対する充足状況', tryBody, { span2: true })}
      ${panel('必要保障額の試算', tableBody, { span2: true })}
      ${panel('必要保障額の内訳比較（主要項目）', breakdownBody)}
      ${panel('資金準備の目的', purposeBody)}
    </div>
    ${takeaway(dynamicTakeaway)}
  </div>`;
  document.getElementById('tab-coverage').innerHTML = html;
}

// ---- 5. 4つの観点まとめ -------------------------------------------------------
function renderOverview() {
  const periods = STATE.view.periods;
  const latest = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const g = STATE.scoring;
  const sv = STATE.stockEval;
  const cov = STATE.coverage;

  const statTile = (label, curr, prevV, { fmtFn = fmtYen, upIsGood = true, deltaMode = 'pct' } = {}) => {
    let delta = '';
    if (prevV != null && curr != null) {
      const diff = curr - prevV;
      const isUp = diff > 0;
      const c = diff === 0 ? 'flat' : (isUp === upIsGood ? 'up-good' : 'down-bad');
      const arrow = isUp ? '▲' : diff < 0 ? '▼' : '■';
      const text = deltaMode === 'pt'
        ? `前期比 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pt`
        : (prevV !== 0 ? `前期比 ${diff >= 0 ? '+' : ''}${((diff / Math.abs(prevV)) * 100).toFixed(1)}%` : '');
      if (text) delta = `<div class="delta ${c}">${arrow} ${text}</div>`;
    }
    return `<div class="kv-item"><div class="k">${label}</div><div class="v">${fmtFn(curr)}</div>${delta}</div>`;
  };

  const financialQuadrant = `<div class="kv-grid">
    ${statTile('自己資本比率', latest.ratios.selfCapitalRatio, prev && prev.ratios.selfCapitalRatio, { fmtFn: fmtPct, deltaMode: 'pt' })}
    ${statTile('有利子負債合計', latest.bsSum.interestBearingDebt, prev && prev.bsSum.interestBearingDebt, { upIsGood: false })}
    </div>`;
  const cfQuadrant = `<div class="kv-grid">
    ${statTile('フリーキャッシュフロー', latest.cf && latest.cf.freeCashFlow, prev && prev.cf && prev.cf.freeCashFlow)}
    ${statTile('売上高', latest.pl.netSales, prev && prev.pl.netSales)}
    ${statTile('経常利益', latest.plSum.ordinaryIncome, prev && prev.plSum.ordinaryIncome)}
    </div>`;
  const stockQuadrant = sv ? `<div class="kv-grid">
    <div class="kv-item"><div class="k">自社株評価額（相続税評価・1株）</div><div class="v">${fmtYen(sv.inheritanceTaxValue)}</div></div>
    <div class="kv-item"><div class="k">会社規模</div><div class="v">${sv.sizeJudge.size}</div></div>
    </div>` : `<div class="caption">自社株評価：対象外（詳細は自社株タブ参照）</div>`;
  const coverageQuadrant = `<div class="kv-grid">
    ${statTile('必要保障額 合計', cov.total, null)}
    ${statTile('不足金額', cov.shortfall, null, { upIsGood: false })}
    </div>`;

  const obs = [];
  obs.push(`財務判定は${g.total}/${g.maxTotal}点（100点換算${g.scaled}点）で「${g.gradeLabel}」。自己資本比率${fmtPct(latest.ratios.selfCapitalRatio)}、有利子負債合計${fmt(latest.bsSum.interestBearingDebt)}円が直近の財務体質を示しています。`);
  if (latest.cf) {
    obs.push(`フリーキャッシュフローは${fmt(latest.cf.freeCashFlow)}円${latest.cf.freeCashFlow >= 0 ? 'と資金余力がある状態' : 'とマイナスであり、資金繰りに注意が必要な状態'}です。`);
  }
  obs.push(sv
    ? `自社株評価額（相続税評価・1株）は${fmtYen(sv.inheritanceTaxValue)}、会社規模区分は「${sv.sizeJudge.size}」です。`
    : `自社株（出資持分）評価は対象外のため、別途評価方法の確認が必要です。`);
  obs.push(cov.shortfall > 0
    ? `必要保障額合計${fmt(cov.total)}円に対し不足金額は${fmt(cov.shortfall)}円。保険等による資金準備の検討余地があります。`
    : `必要保障額合計${fmt(cov.total)}円に対し、現状の準備済み資産で充足しています。`);
  const obsBody = `<ul style="margin:0;padding-left:18px;font-size:0.76rem;line-height:1.9;color:var(--ink);">
    ${obs.map(o => `<li>${o}</li>`).join('')}
    </ul>`;

  const html = `<div class="sheet">
    ${sheetHead('scoring', '--sec-scoring', '4つの観点まとめ', 5)}
    <div class="sheet-sub">事業の永続に向けて ～ 各観点の要点を1枚に整理（直近期：${latest.label}）</div>
    <div class="grid-2">
      ${panel('財務判定', `<div class="grade-row"><div class="grade-badge">${g.grade}</div><div class="grade-label"><strong>${g.gradeLabel}</strong>100点換算 ${g.scaled}点</div></div><div class="grade-meter-wrap">${Viz.gradeMeter(g.grade)}</div>`, { span2: true })}
      ${panel('財務の観点', financialQuadrant)}
      ${panel('キャッシュフローの観点', cfQuadrant)}
      ${panel('自社株の観点', stockQuadrant)}
      ${panel('必要保障の観点', coverageQuadrant)}
      ${panel('総括所見', obsBody, { span2: true, tag: '自動生成・要確認' })}
    </div>
  </div>`;
  document.getElementById('tab-overview').innerHTML = html;
}

// ---- 6. 決算情報 -------------------------------------------------------------
function renderStatements() {
  const periods = STATE.view.periods;
  const assetColors = [Viz.PALETTE.series[0], '#9ec5f4'];
  const liabColors = [Viz.PALETTE.series[1], '#f3b58f', Viz.PALETTE.good];
  const bsChart = periods.map(p => `
    ${Viz.stackedBarRow(`${p.label}｜資産`, [
      { name: '流動資産', value: p.bsSum.currentAssets, color: assetColors[0] },
      { name: '固定資産', value: p.bsSum.fixedAssets, color: assetColors[1] },
    ], { width: 1040, barHeight: 16 })}
    ${Viz.stackedBarRow(`${p.label}｜負債・純資産`, [
      { name: '流動負債', value: p.bsSum.currentLiabilities, color: liabColors[0] },
      { name: '固定負債', value: p.bsSum.fixedLiabilities, color: liabColors[1] },
      { name: '純資産', value: Math.max(0, p.bsSum.netAssets), color: liabColors[2] },
    ], { width: 1040, barHeight: 16 })}`).join('');

  const bsAssetBody = `<table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('現金及び預金', periods.map(p => p.bs.cash))}
    ${dataRow('売掛金', periods.map(p => p.bs.accountsReceivable))}
    ${dataRow('棚卸資産', periods.map(p => p.bs.inventory))}
    ${dataRow('その他流動資産', periods.map(p => p.bs.otherCurrentAssets + p.bs.prepaidExpenses))}
    ${dataRow('流動資産合計', periods.map(p => p.bsSum.currentAssets), { total: true })}
    ${dataRow('有形固定資産', periods.map(p => p.bs.tangibleFixedAssets))}
    ${dataRow('無形固定資産', periods.map(p => p.bs.intangibleFixedAssets))}
    ${dataRow('投資その他資産', periods.map(p => p.bs.investmentsOther))}
    ${dataRow('固定資産合計', periods.map(p => p.bsSum.fixedAssets), { total: true })}
    ${dataRow('資産合計', periods.map(p => p.bsSum.totalAssets), { total: true })}
    </tbody></table>`;

  const bsLiabBody = `<table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('流動負債合計', periods.map(p => p.bsSum.currentLiabilities), { total: true })}
    ${dataRow('固定負債合計', periods.map(p => p.bsSum.fixedLiabilities), { total: true })}
    ${dataRow('負債合計', periods.map(p => p.bsSum.totalLiabilities), { total: true })}
    ${dataRow('純資産合計', periods.map(p => p.bsSum.netAssets), { total: true })}
    </tbody></table>`;

  const plBody = `<table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('売上高', periods.map(p => p.pl.netSales))}
    ${dataRow('売上原価', periods.map(p => p.pl.costOfSales))}
    ${dataRow('売上総利益', periods.map(p => p.plSum.grossProfit), { total: true })}
    ${dataRow('販管費', periods.map(p => p.plSum.sgaTotal))}
    ${dataRow('営業利益', periods.map(p => p.plSum.operatingIncome), { total: true })}
    ${dataRow('経常利益', periods.map(p => p.plSum.ordinaryIncome), { total: true })}
    ${dataRow('当期純利益', periods.map(p => p.plSum.netIncome), { total: true })}
    </tbody></table>`;

  const html = `<div class="sheet">
    ${sheetHead('statements', '--sec-statements', '決算情報', 6)}
    <div class="sheet-sub">貸借対照表・損益計算書の3期推移</div>
    <div class="grid-2">
      ${panel('貸借対照表の構成比の推移', `<div class="chart-card-body">${bsChart}</div><div class="caption">純資産がマイナス（債務超過）の期間はグラフ上0として扱っています。</div>`, { span2: true })}
    </div>
    <div class="grid-3">
      ${panel('貸借対照表（資産の部）', bsAssetBody)}
      ${panel('貸借対照表（負債・純資産の部）', bsLiabBody)}
      ${panel('損益計算書', plBody)}
    </div>
  </div>`;
  document.getElementById('tab-statements').innerHTML = html;
}

// ---- 7. スコアリング ----------------------------------------------------------
function renderScoring() {
  const s = STATE.scoring;
  const byCategory = {};
  Object.values(s.results).forEach(r => {
    byCategory[r.category] = byCategory[r.category] || [];
    byCategory[r.category].push(r);
  });
  const catLabel = { safety: '1. 安全性項目', profitability: '2. 収益性項目', growth: '3. 成長性項目', repayment: '4. 返済力' };
  const catPanels = Object.entries(catLabel).map(([key, label]) => {
    const items = byCategory[key] || [];
    const catTotal = items.reduce((a, i) => a + i.points, 0);
    const catMax = items.reduce((a, i) => a + i.maxPoints, 0);
    const body = `<div class="chart-card-body" style="margin-bottom:6px;">${Viz.meter(catTotal, catMax, { width: 300, height: 12, color: Viz.PALETTE.series[0] })}</div>
      <table class="dsheet compact"><thead><tr><th>指標</th><th>数値</th><th>点数</th></tr></thead><tbody>
      ${items.map(i => `<tr><td>${i.label}</td><td>${i.value === null ? 'ー' : i.value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}</td><td>${i.points}/${i.maxPoints}</td></tr>`).join('')}
      </tbody></table>`;
    return panel(`${label}（${catTotal}/${catMax}点）`, body);
  }).join('');

  const html = `<div class="sheet">
    ${sheetHead('scoring', '--sec-scoring', 'スコアリング', 7)}
    <div class="sheet-sub">安全性・収益性・成長性・返済力の4区分を100点満点で採点し、財務判定を決定します。</div>
    <div class="notice">⚠ スコアリングの4区分・配点構成（安全性34点／収益性15点／成長性25点／返済力55点）・100点換算・財務判定1〜7のバンドは見本2社の実際の合計点から検算済みです。一方、各指標の詳細な閾値（％と点数の対応）はベストエフォートでの転記のため、実際の与信判断に使う前に必ず原本と突き合わせてください。</div>
    <div class="grid-2">
      ${panel('総合判定', `<div class="grade-row"><div class="grade-badge">${s.grade}</div><div class="grade-label"><strong>${s.gradeLabel}</strong>${s.total} / ${s.maxTotal}点 → 100点換算 ${s.scaled}点</div></div><div class="grade-meter-wrap">${Viz.gradeMeter(s.grade)}</div>`, { span2: true })}
      ${catPanels}
    </div>
  </div>`;
  document.getElementById('tab-scoring').innerHTML = html;
}

// ---- Excel エクスポート -----------------------------------------------------
function exportExcel() {
  if (!STATE.view) return;
  if (typeof XLSX === 'undefined') {
    alert('Excel出力ライブラリの読み込みに失敗しました。インターネット接続を確認して再読み込みしてください。');
    return;
  }
  const periods = STATE.view.periods;
  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);

  addSheet('財務', [
    ['項目', ...periods.map(p => p.label)],
    ['自己資本比率[%]', ...periods.map(p => p.ratios.selfCapitalRatio)],
    ['ギアリング比率[%]', ...periods.map(p => p.ratios.gearingRatio)],
    ['固定長期適合率[%]', ...periods.map(p => p.ratios.fixedLongTermConformityRatio)],
    ['流動比率[%]', ...periods.map(p => p.ratios.currentRatio)],
    ['総資産', ...periods.map(p => p.bsSum.totalAssets)],
    ['純資産', ...periods.map(p => p.bsSum.netAssets)],
  ]);
  addSheet('キャッシュフロー', [
    ['項目', ...periods.map(p => p.label)],
    ['営業CF', ...periods.map(p => p.cf ? p.cf.operatingCF : '')],
    ['投資CF', ...periods.map(p => p.cf ? p.cf.investingCF : '')],
    ['フリーCF', ...periods.map(p => p.cf ? p.cf.freeCashFlow : '')],
    ['財務CF', ...periods.map(p => p.cf ? p.cf.financingCF : '')],
    ['売上高', ...periods.map(p => p.pl.netSales)],
    ['経常利益率[%]', ...periods.map(p => p.ratios.ordinaryMargin)],
  ]);
  const sgaKeys = Array.from(new Set(periods.flatMap(p => Object.keys(p.pl.sgaDetail || {}))));
  if (sgaKeys.length) {
    addSheet('固定費内訳(全科目)', [
      ['科目', ...periods.map(p => p.label)],
      ...sgaKeys.map(k => [k, ...periods.map(p => (p.pl.sgaDetail || {})[k] ?? '')]),
      ['販管費合計', ...periods.map(p => p.plSum.sgaTotal)],
    ]);
  }
  if (STATE.stockEval) {
    const sv = STATE.stockEval;
    addSheet('自社株評価', [
      ['項目', '値'],
      ['会社規模', sv.sizeJudge.size],
      ['類似業種比準価額(1株)', sv.similarIndustryValue.perShare],
      ['純資産価額(1株・相続税評価)', sv.netAssetValue.perShareInheritance],
      ['併用方式評価額(1株)', sv.inheritanceTaxValue],
      ['配当還元価額(1株)', sv.dividendValue.perShare],
      ['法人税評価額(1株・簡易)', sv.corporateTaxValue],
    ]);
  }
  const c = STATE.coverage;
  addSheet('必要保障額', [
    ['項目', '金額'],
    ['運転資金', c.workingCapital], ['短期返済資金', c.shortTermDebtRepayment],
    ['長期返済資金', c.longTermDebtRepayment], ['自社株買取資金', c.stockBuyback],
    ['必要保障額合計', c.total], ['準備済み資産', c.preparedAssets], ['不足金額', c.shortfall],
  ]);
  const s = STATE.scoring;
  addSheet('スコアリング', [
    ['指標', '値', '点数', '配点'],
    ...Object.values(s.results).map(r => [r.label, r.value, r.points, r.maxPoints]),
    ['合計', '', s.total, s.maxTotal],
  ]);

  XLSX.writeFile(wb, `${(STATE.raw.companyName || 'company')}_ディスカッションシート.xlsx`);
}

// ---- タブ切替 ---------------------------------------------------------------
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  document.getElementById('load-zou').addEventListener('click', () => loadSample('zou'));
  document.getElementById('load-myap').addEventListener('click', () => loadSample('myap'));
  document.getElementById('load-yotsuba').addEventListener('click', () => loadSample('yotsuba'));
  document.getElementById('apply-json').addEventListener('click', applyFromTextarea);
  document.getElementById('export-pdf').addEventListener('click', () => window.print());
  document.getElementById('export-excel').addEventListener('click', exportExcel);
});
