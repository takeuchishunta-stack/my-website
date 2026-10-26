/* ==========================================================================
   UI 制御・描画ロジック（DOM 操作はすべてここに集約）
   ========================================================================== */

let STATE = { raw: null, view: null, stockEval: null, scoring: null, coverage: null, outputMode: 'customer', totalPages: 7 };

// ---- 出力モード切替ヘルパー ---------------------------------------------------
// internalNotice/internalOnly は「お客様向け」モードでは中身を一切出力しない
// （CSSで隠すのではなくDOMに入れないため、PDF本文やHTMLソースを検索しても
// 社内向けの注記・用語が一切見つからない状態になる）。
function internalNotice(html, cls = 'notice') {
  if (STATE.outputMode !== 'internal') return '';
  return `<div class="${cls} internal-only">🔒${html}</div>`;
}
function internalOnly(html) {
  return STATE.outputMode === 'internal' ? html : '';
}

// ---- 章アイコン（装飾用。識別は常にアイコン形状＋テキストラベルで行い、色だけに頼らない） ---
const ICONS = {
  financial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/></svg>',
  cashflow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h12l-3-3"/><path d="M15 7l-3 3"/><path d="M21 17H9l3 3"/><path d="M9 17l3-3"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M4 19h16"/></svg>',
  coverage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c4 2 8 2 8 2v7c0 5-4 7-8 9-4-2-8-4-8-9V5s4 0 8-2z"/></svg>',
  scoring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6 6.6.6-5 4.4 1.5 6.5L12 16l-5.9 3.5L7.6 13l-5-4.4 6.6-.6z"/></svg>',
  statements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 13h6M9 17h6M9 9h2"/></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
  findings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6.5"/><path d="M15 15l5.5 5.5"/><path d="M7.5 10h5M10 7.5v5"/></svg>',
};

function sheetHead(iconKey, colorVar, title, pageNo) {
  return `<div class="sheet-head" style="background:var(${colorVar});">
    <span class="icon-badge">${ICONS[iconKey]}</span>
    <h2>${title}</h2>
    <span class="page-no">${pageNo}/${STATE.totalPages}</span>
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
    ? `<span class="neg">△${(-n).toLocaleString('ja-JP', { maximumFractionDigits: digits })}</span>`
    : n.toLocaleString('ja-JP', { maximumFractionDigits: digits });
// 「算出不可」等、数値の代わりに理由付きの文言を表示するための共通ラッパー
const naText = (reason) => `<span class="na">算出不可（${reason}）</span>`;
const unconfirmedText = (label = '未確認') => `<span class="na">${label}</span>`;
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

// 期ごとに表示内容を変える必要がある行（「算出不可」等の条件分岐を伴う）用。
// cellFn(period) は完成済みのセル中身（HTML文字列）を返す。
function dataRowByPeriod(label, periods, cellFn, { total = false } = {}) {
  const tds = periods.map(p => `<td>${cellFn(p)}</td>`).join('');
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
  // ギアリング比率・債務償還年数は、債務超過／営業赤字で符号が反転すると
  // 「良い数値」に見えてしまうため、無効な期間は null を渡して0点（データなし扱い）にする。
  const r = latest.ratios;
  STATE.scoring = Scoring.scoreAll({
    selfCapitalRatio: r.selfCapitalRatio, gearingRatio: r.gearingRatioValid ? r.gearingRatio : null,
    fixedLongTermConformityRatio: r.fixedLongTermConformityRatio, currentRatio: r.currentRatio,
    ordinaryMargin: r.ordinaryMargin, roa: r.roa, cashFlowScore: r.cashFlowAmount,
    ordinaryIncomeGrowth: latest.yoy ? latest.yoy.ordinaryIncomeGrowth : null,
    debtServiceYears: r.debtServiceYearsValid ? r.debtServiceYears : null, interestCoverageRatio: r.interestCoverageRatio,
    cashFlowAmount: r.cashFlowAmount,
  });

  // 必要保障額
  const sharesHeldByFamily = (data.shareholders || []).reduce((a, s) => a + (s.shares || 0), 0);
  STATE.coverage = Scoring.necessaryCoverage(
    latest,
    STATE.stockEval ? STATE.stockEval.corporateTaxValue : 0,
    sharesHeldByFamily,
    data.officers && data.officers[0],
    data.preparedAssets, // null/undefinedのまま渡す（「0円」と「未確認」を区別するため）
    data.coverageAssumptions || {}
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
    ['overview', '--sec-overview', '4つの観点まとめ', '各観点の要点を1枚に整理し、全体像を確認します。', 5],
    ['statements', '--sec-statements', '決算情報', '貸借対照表・損益計算書の3期推移です。', 6],
    ['scoring', '--sec-scoring', 'スコアリング', '定量データに基づく財務判定の根拠です。', 7],
    ...(data.findingsReport ? [['findings', '--sec-findings', '指摘事項・改善の優先順位', 'ヒアリングを踏まえた所見と、次の一手の優先順位です。', 8]] : []),
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
  STATE.totalPages = STATE.raw.findingsReport ? 9 : 7;
  renderCover();
  renderFinancial();
  renderCashFlow();
  renderStock();
  renderCoverage();
  renderOverview();
  renderStatements();
  renderScoring();
  renderFindings();
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
    ${dataRowByPeriod('ギアリング比率[%]', periods, p => p.ratios.gearingRatioValid ? fmtPct(p.ratios.gearingRatio) : naText('債務超過'))}
    ${dataRow('固定長期適合率[%]', periods.map(p => p.ratios.fixedLongTermConformityRatio), { fmtFn: fmtPct })}
    ${dataRow('流動比率[%]', periods.map(p => p.ratios.currentRatio), { fmtFn: fmtPct })}
    ${dataRow('純資産合計', periods.map(p => p.bsSum.netAssets))}
    ${dataRow('総資産合計', periods.map(p => p.bsSum.totalAssets), { total: true })}
    </tbody></table>`;

  const debtBody = `
    <div class="chart-card-body">${Viz.columnChart(labels, periods.map(p => p.bsSum.interestBearingDebt), { color: Viz.PALETTE.series[0] })}</div>
    ${latest.ratios.debtServiceYearsValid
      ? formulaLine(`返済に要する年数 ＝ (有利子負債－現金預金) ÷ (営業利益＋減価償却費) ＝ <b>${fmt(latest.ratios.debtServiceYears, 1)}</b>年（1年以内が最高評価）${latest.ratios.depreciationMissing ? '　※減価償却費が未入力のため0円として計算しています' : ''}`)
      : formulaLine(`返済に要する年数 ＝ (有利子負債－現金預金) ÷ (営業利益＋減価償却費) ＝ 算出不可（営業利益＋減価償却費が0以下のため）`)}
    <table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('短期借入金合計', periods.map(p => p.loanSum.shortTermTotal))}
    ${dataRow('長期借入金合計', periods.map(p => p.loanSum.longTermTotal))}
    ${dataRow('有利子負債合計', periods.map(p => p.bsSum.interestBearingDebt), { total: true })}
    ${dataRowByPeriod('債務償還年数[年]', periods, p => p.ratios.debtServiceYearsValid ? fmt(p.ratios.debtServiceYears, 1) + '年' : naText('営業赤字'))}
    </tbody></table>
    ${latest.ratios.depreciationMissing ? `<div class="caption">⚠ 減価償却費未入力：損益計算書・販管費・製造原価の「減価償却費」科目の金額を pl.depreciationAnnualTotal に入力してください。未入力のため上記は償却費を0円として計算した暫定値です。</div>` : ''}`;

  const loanRowsTable = (loans, cols) => {
    if (!loans || !loans.length) return `<div class="caption">${unconfirmedText('内訳未確認（決算書の勘定科目内訳書等でご確認ください）')}</div>`;
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
    <div class="sheet-sub">自己資本比率や借入金の返済負担など、財務の安全性と資金調達の余力を確認します（直近期：${latest.label}）。</div>
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

  const salesBody = `<div class="chart-card-body">${Viz.columnChart(labels, periods.map(p => p.pl.netSales), { color: Viz.PALETTE.series[0], height: 250 })}</div>
    ${latest.yoy ? formulaLine(`対前年伸び率 ＝ (当期売上－前期売上) ÷ 前期売上 ＝ <b>${fmtPct(latest.yoy.salesGrowth)}</b>`) : ''}`;

  const marginBody = `<div class="chart-card-body">${Viz.lineChart(labels, [
    { name: '営業利益率', values: periods.map(p => p.ratios.operatingMargin) },
    { name: '経常利益率', values: periods.map(p => p.ratios.ordinaryMargin) },
  ], { unit: '%', height: 70 })}</div>
    <table class="dsheet compact"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('対前年伸び率[%]', periods.map(p => p.yoy && p.yoy.salesGrowth), { fmtFn: fmtPct })}
    ${dataRow('粗利率[%]', periods.map(p => p.ratios.grossMargin), { fmtFn: fmtPct })}
    ${dataRow('営業利益率[%]', periods.map(p => p.ratios.operatingMargin), { fmtFn: fmtPct })}
    ${dataRow('経常利益率[%]', periods.map(p => p.ratios.ordinaryMargin), { fmtFn: fmtPct })}
    </tbody></table>`;

  // 今年度のキャッシュフロー構成（単期間・カテゴリ別の棒グラフ）。
  // 複数期間の推移ではなく、直近期の内訳を一目で読み取れる形で示す。
  const cfReconciliationNote = latest.cf && latest.cf.cashReconciliationDiff != null
    ? (Math.abs(latest.cf.cashReconciliationDiff) > Math.max(1000, Math.abs(latest.cf.cashEnd) * 0.005)
      ? `<div class="caption">⚠ 差異：CF計 ${fmt(latest.cf.netChange)}円に対し、現預金の実際の増減は ${fmt(latest.cf.actualCashChange)}円（差異 ${fmt(latest.cf.cashReconciliationDiff)}円）。本CF計算書は間接法による近似のため、実際の現預金増減と完全には一致しません。</div>`
      : '')
    : '';
  const cfNowBody = latest.cf ? `
    <div class="chart-card-body">${Viz.groupedBarChart(
      ['①営業CF', '②投資CF', '③フリーCF(①+②)', '④財務CF', '⑤CF計(③+④)'],
      [{ name: '金額', values: [latest.cf.operatingCF, latest.cf.investingCF, latest.cf.freeCashFlow, latest.cf.financingCF, latest.cf.netChange] }],
      { height: 120, showValues: true, colorBySign: true }
    )}</div>
    ${formulaLine(`営業CF ＝ 税引前当期純利益＋減価償却費±運転資本増減－法人税等 ＝ <b>${fmt(latest.cf.operatingCF)}</b>　／　フリーCF(①+②) ＝ <b>${fmt(latest.cf.freeCashFlow)}</b>`)}
    <div class="caption">直近期（${latest.label}）のキャッシュフロー構成。緑＝資金の増加、赤＝資金の減少。</div>
    ${latest.cf.depreciationMissing ? `<div class="caption">⚠ 減価償却費未入力のため、営業CF・投資CFは償却費を0円とした暫定値です（CF計・フリーCFへの影響はありません）。</div>` : ''}
    ${cfReconciliationNote}`
    : `<div class="caption">最も古い期間は前期の貸借対照表が無いため、キャッシュフローを算出できません。</div>`;

  const officerList = latest.officerCompensationDetail || [];
  const hasOfficerDetail = officerList.length > 0;
  const officerBody = `<table class="dsheet compact"><thead><tr><th>役員名</th><th>報酬額</th></tr></thead><tbody>
      ${officerList.map(o => `<tr><td>${o.name}</td><td>${fmt(o.amount)}</td></tr>`).join('')}
      </tbody></table>`;

  const html = `<div class="sheet">
    ${sheetHead('cashflow', '--sec-cashflow', 'キャッシュフローの観点', 2)}
    <div class="sheet-sub">黒字でも資金が不足することがある。手元のキャッシュフローの実態を見極めます（直近期：${latest.label}）。</div>
    <div class="grid-2">
      ${panel('売上高の推移', salesBody)}
      ${panel('利益率の推移', marginBody)}
      ${panel('今年度のキャッシュフロー', cfNowBody)}
      ${panel('固定費の内訳（直近期）', renderSgaTable(latest))}
      ${hasOfficerDetail ? panel('役員報酬（直近期）', officerBody, { span2: true }) : ''}
    </div>
    ${takeaway('流出金額の見直しなど、利益確保を意識した費用のコントロールにより、キャッシュフローの最適化を図れます。')}
  </div>`;
  document.getElementById('tab-cashflow').innerHTML = html;
}

// 固定費の内訳：pl.sgaFixedAccounts で「固」区分の科目が指定されていれば、その科目だけを
// 金額の大きい順に表示する（必要保障額の①運転資金＝月額固定費×ヶ月数の算出対象と一致させる）。
// 指定が無い場合は、販管費全体の上位科目を参考表示する（旧データとの後方互換）。
function renderSgaTable(period) {
  const tagged = period.fixedCostBreakdown; // [[科目名, 金額], ...] 金額降順 or null
  const isTagged = !!tagged;
  const entries = tagged || Object.entries(period.pl.sgaDetail || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const TOP_N = 8;
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

  const totalLabel = isTagged
    ? `固定費合計：${fmt(DiscussionEngine.sum(...entries.map(([, v]) => v)))}円`
    : `販管費合計：${fmt(period.plSum.sgaTotal)}円`;

  return `<div class="chart-card-body" style="margin-bottom:6px;">${bars}</div>
    <div class="caption">${totalLabel}</div>
    ${internalNotice(isTagged
      ? '固定費合計は必要保障額「①運転資金」の算出対象。全科目の内訳はExcelダウンロードに収録。'
      : '固定費／変動費の区分（sgaFixedAccounts）が未入力のため、販管費全体の上位科目を参考表示。全科目の内訳はExcelダウンロードに収録。', 'caption')}`;
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
  const preparedConfirmed = c.preparedAssetsStatus === 'confirmed';
  const officerConfirmed = c.officerDataStatus === 'confirmed';
  const covered = preparedConfirmed ? Math.max(0, c.total - c.shortfall) : 0;
  const retirementBasis = officerConfirmed
    ? `最終報酬月額 × 在任年数 × 功績倍率${c.assumptions.deathRetirementMultiple}`
    : '役員情報（最終報酬月額・在任年数）が未確認のため算出不可';
  const rows = [
    ['①運転資金', c.workingCapital, `月額固定費 × ${c.assumptions.workingCapitalMonths}ヶ月`],
    ...(c.hasBorrowingsOverride
      ? [
          ['②③負債等の返済資金（現在の借入金残高）', c.longTermDebtRepayment, c.assumptions.currentBorrowingsNote || 'ヒアリングベースの現在の借入金残高（決算書未掲載分を含む）'],
          ['　参考：直近期決算書に計上されている借入金残高', c.borrowingsAtFiscalYearEnd, '決算書に基づく有利子負債残高（期中の追加借入は未反映）'],
        ]
      : [
          ['②負債等の返済資金（短期）', c.shortTermDebtRepayment, '短期借入金＋1年以内返済長期借入金'],
          ['　内、連帯保証債務（短期）[参考]', c.shortTermGuarantee, '短期の連帯保証額合計'],
          ['③負債等の返済資金（長期）', c.longTermDebtRepayment, '長期借入金残高'],
          ['　内、連帯保証債務（長期）[参考]', c.longTermGuarantee, '長期の連帯保証額合計'],
        ]),
    ['④役員死亡退職金[参考]', c.deathRetirement, retirementBasis],
    ['　役員勇退退職金[参考]', c.resignationRetirement, officerConfirmed ? `最終報酬月額 × 在任年数 × 功績倍率${c.assumptions.resignationRetirementMultiple}` : retirementBasis],
    ['⑤事業承継対策資金（自社株買取資金）', c.stockBuyback, '自社株評価額（法人税評価） × 同族保有株数'],
  ];
  const taxRatePct = (c.assumptions.effectiveTaxRate * 100).toFixed(2);
  const fmtRow = (v) => (v === null || v === undefined) ? unconfirmedText() : fmt(v);

  const tryBody = preparedConfirmed ? `<div class="chart-card-body">${Viz.stackedBarRow('必要保障額 合計 ' + stripHtml(fmtYen(c.total)), [
      { name: `準備済み資産 ${stripHtml(fmtYen(covered))}`, value: covered, color: Viz.PALETTE.good },
      { name: `不足金額 ${stripHtml(fmtYen(c.shortfall))}`, value: c.shortfall, color: Viz.PALETTE.critical },
    ], { width: 520, barHeight: 26 })}</div>
    ${formulaLine(`不足金額 ＝ 必要保障額合計 － 準備済み資産 ＝ <b>${fmt(c.total)}</b> － <b>${fmt(c.preparedAssets)}</b> ＝ <b>${fmt(c.shortfall)}</b>`)}`
    : `<div class="chart-card-body">${Viz.stackedBarRow('必要保障額 合計 ' + stripHtml(fmtYen(c.total)), [
      { name: '必要保障額（全額）', value: c.total, color: Viz.PALETTE.warning },
    ], { width: 520, barHeight: 26 })}</div>
    <div class="notice">準備済み資産（既加入の生命保険の解約返戻金相当額等）が未確認です。ヒアリング・確認後に不足金額を確定してください。</div>`;

  const grossedUpTarget = c.grossUpTargetTotal * c.taxGrossUpFactor;
  const tableBody = `<table class="dsheet compact"><thead><tr><th>項目</th><th>金額</th><th>試算根拠</th></tr></thead><tbody>
    ${rows.map(([l, v, basis]) => `<tr><td>${l}</td><td class="${v == null ? 'na' : cls(v)}">${fmtRow(v)}</td><td style="text-align:left;font-size:0.7rem;color:var(--ink-muted);">${basis}</td></tr>`).join('')}
    <tr class="total"><td>①運転資金（グロスアップ不要）</td><td>${fmt(c.noGrossUpTotal)}</td><td style="text-align:left;font-size:0.7rem;color:var(--ink-muted);">固定費はその年の損金に算入されるため実効税率の調整は不要</td></tr>
    <tr class="total"><td>②③⑤ 小計（借入返済＋自社株買取・実額）</td><td>${fmt(c.grossUpTargetTotal)}</td><td style="text-align:left;font-size:0.7rem;color:var(--ink-muted);">②＋③＋⑤（[参考]科目を除く）</td></tr>
    <tr class="total"><td>②③⑤ グロスアップ後（保険金ベース）</td><td>${fmt(grossedUpTarget)}</td><td style="text-align:left;font-size:0.7rem;color:var(--ink-muted);">小計 ÷ (1－実効税率${taxRatePct}%)</td></tr>
    <tr class="total"><td>必要保障額 合計</td><td>${fmt(c.total)}</td><td style="text-align:left;font-size:0.7rem;color:var(--ink-muted);">①＋②③⑤グロスアップ後</td></tr>
    <tr><td>準備済み資産（既加入の保険等）</td><td class="${preparedConfirmed ? cls(-c.preparedAssets) : 'na'}">${preparedConfirmed ? fmt(-c.preparedAssets) : unconfirmedText('未確認（ヒアリング前）')}</td><td style="text-align:left;font-size:0.7rem;color:var(--ink-muted);">現在加入している生命保険の解約返戻金相当額等</td></tr>
    <tr class="total"><td>不足金額</td><td>${preparedConfirmed ? fmt(c.shortfall) : unconfirmedText('準備済み資産を確認後に確定')}</td><td></td></tr>
    </tbody></table>
    ${formulaLine(`必要保障額 合計 ＝ ①運転資金 ＋ (②③負債等の返済資金＋⑤自社株買取資金) ÷ (1－実効税率) ＝ <b>${fmt(c.noGrossUpTotal)}</b> ＋ <b>${fmt(c.grossUpTargetTotal)}</b> ÷ (1－${taxRatePct}%) ＝ <b>${fmt(c.total)}</b>（借入金の返済・自社株買取は保険金の受取時に益金算入され法人税等が課されるため保険金ベースに割り戻す一方、①運転資金＝固定費はその年の損金に算入されるためグロスアップしません）`)}`;

  const purposeBody = `<table class="dsheet compact"><thead><tr><th>区分</th><th>資金準備の目的</th></tr></thead><tbody>
    <tr><td>会社経営</td><td style="text-align:left;">運転資金 / 負債等の返済資金・移転資金 / 自社株買取資金</td></tr>
    <tr><td>役員・従業員</td><td style="text-align:left;">死亡退職金・弔慰金 / 勇退退職金・見舞金</td></tr>
    <tr><td>社長個人</td><td style="text-align:left;">ご遺族の生活資金 / 老後の資産形成 / 医療・介護資金</td></tr>
    </tbody></table>`;

  const breakdownItems = [
    ['①運転資金', c.workingCapital],
    ['②③負債等の返済資金', c.shortTermDebtRepayment + c.longTermDebtRepayment],
    ['④退職金・弔慰金', officerConfirmed ? (c.deathRetirement + c.resignationRetirement) : null],
    ['⑤自社株買取資金', c.stockBuyback],
  ].filter(([, v]) => v !== null && v !== undefined && v !== 0);
  const maxBreakdown = Math.max(...breakdownItems.map(([, v]) => v), 1);
  const breakdownBody = `<div class="chart-card-body">${breakdownItems.map(([k, v]) => `
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:3px;">
      <div style="width:160px;font-size:0.72rem;color:var(--ink-secondary);flex:none;">${k}</div>
      <div style="flex:1;">${Viz.meter(v, maxBreakdown, { width: 260, height: 11, color: Viz.PALETTE.series[1] })}</div>
      <div style="width:95px;text-align:right;font-size:0.74rem;flex:none;">${fmt(v)}</div>
    </div>`).join('')}</div>
    <div class="caption">必要保障額合計 ${fmt(c.total)}円 のうち、金額の大きい構成要素を比較しています（参考科目を除く）。${officerConfirmed ? '' : '役員情報が未確認のため退職金・弔慰金は含まれていません。'}</div>`;

  const shortfallRatio = preparedConfirmed && c.total ? (c.shortfall / c.total) * 100 : null;
  const dynamicTakeaway = !preparedConfirmed
    ? `必要保障額合計${fmt(c.total)}円を試算しました。準備済み資産（既加入の生命保険の解約返戻金相当額等）が未確認のため、不足金額は確認後に確定します。`
    : c.shortfall > 0
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
    </div>` : `<div class="caption">自社株評価：対象外（詳細はP.3をご覧ください）</div>`;
  const coverageQuadrant = `<div class="kv-grid">
    ${statTile('必要保障額 合計', cov.total, null)}
    ${cov.preparedAssetsStatus === 'confirmed'
      ? statTile('不足金額', cov.shortfall, null, { upIsGood: false })
      : `<div class="kv-item"><div class="k">不足金額</div><div class="v">${unconfirmedText('準備済み資産を確認後に確定')}</div></div>`}
    </div>`;

  const obs = [];
  obs.push(`財務判定は${g.total}/${g.maxTotal}点（100点換算${g.scaled}点）で「${g.gradeLabel}」。自己資本比率${fmtPct(latest.ratios.selfCapitalRatio)}、有利子負債合計${fmt(latest.bsSum.interestBearingDebt)}円が直近の財務体質を示しています。`);
  if (latest.cf) {
    obs.push(`フリーキャッシュフローは${fmt(latest.cf.freeCashFlow)}円${latest.cf.freeCashFlow >= 0 ? 'と資金余力がある状態' : 'とマイナスであり、資金繰りに注意が必要な状態'}です。`);
  }
  obs.push(sv
    ? `自社株評価額（相続税評価・1株）は${fmtYen(sv.inheritanceTaxValue)}、会社規模区分は「${sv.sizeJudge.size}」です。`
    : `自社株（出資持分）評価は対象外のため、別途評価方法の確認が必要です。`);
  obs.push(cov.preparedAssetsStatus !== 'confirmed'
    ? `必要保障額合計${fmt(cov.total)}円を試算。準備済み資産が未確認のため、不足金額は確認後に確定します。`
    : cov.shortfall > 0
      ? `必要保障額合計${fmt(cov.total)}円に対し不足金額は${fmt(cov.shortfall)}円。資金準備の必要額の目安としてご確認ください。`
      : `必要保障額合計${fmt(cov.total)}円に対し、現状の準備済み資産で充足しています。`);
  const obsBody = `<ul style="margin:0;padding-left:18px;font-size:0.76rem;line-height:1.9;color:var(--ink);">
    ${obs.map(o => `<li>${o}</li>`).join('')}
    </ul>`;

  const html = `<div class="sheet">
    ${sheetHead('overview', '--sec-overview', '4つの観点まとめ', 5)}
    <div class="sheet-sub">事業の永続に向けて ～ 各観点の要点を1枚に整理（直近期：${latest.label}）</div>
    <div class="grid-2">
      ${panel('財務判定', `<div class="grade-row"><div class="grade-badge">${g.grade}</div><div class="grade-label"><strong>${g.gradeLabel}</strong>100点換算 ${g.scaled}点</div></div><div class="grade-meter-wrap">${Viz.gradeMeter(g.grade)}</div>`, { span2: true })}
      ${panel('財務の観点', financialQuadrant)}
      ${panel('キャッシュフローの観点', cfQuadrant)}
      ${panel('自社株の観点', stockQuadrant)}
      ${panel('必要保障の観点', coverageQuadrant)}
      ${panel('総括所見', obsBody, { span2: true, tag: internalOnly('自動生成・要確認') })}
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

// スコアリング指標の説明：専門用語に不慣れなお客様向けの一言解説。
// scoring.js の INDICATORS のキーに対応させる。
const INDICATOR_DESC = {
  selfCapitalRatio: '総資産のうち、返済不要の自己資金（純資産）が占める割合。高いほど財務が安定',
  gearingRatio: '自己資本に対する有利子負債（借入金等）の比率。低いほど借入への依存度が低く健全',
  fixedLongTermConformityRatio: '工場・設備等の固定資産を、自己資本と長期の借入金でどれだけ賄えているか。低いほど安定',
  currentRatio: '1年以内に支払う負債に対し、1年以内に現金化できる資産がどれだけあるか。短期の支払余力',
  ordinaryMargin: '売上高に対する経常利益（本業の利益＋財務収支）の割合。本業を含めた総合的な収益力',
  roa: '総資産経常利益率（ROA）。保有する資産全体をどれだけ効率よく利益に変えられているか',
  cashFlowScore: '経常利益に減価償却費を加えた、実際に手元に残る資金を稼ぐ力',
  ordinaryIncomeGrowth: '前期と比べた経常利益の伸び率。事業の成長性を示す',
  debtServiceYears: '今ある借入金を、本業で稼ぐ資金（営業利益＋減価償却費）で返済すると何年かかるかの目安。短いほど良い',
  interestCoverageRatio: '営業利益等が支払利息の何倍あるか。金利負担に対する余力の大きさ',
  cashFlowAmount: '経常利益＋減価償却費。借入金の返済原資となる、実際に生み出した資金の額',
};

// ---- 7. スコアリング ----------------------------------------------------------
function renderScoring() {
  const s = STATE.scoring;
  const latest = STATE.view.periods[STATE.view.periods.length - 1];
  const valueText = (i) => {
    if (i.key === 'gearingRatio' && !latest.ratios.gearingRatioValid) return naText('債務超過');
    if (i.key === 'debtServiceYears' && !latest.ratios.debtServiceYearsValid) return naText('営業赤字');
    if (i.value === null) return 'ー';
    const depCaveat = (i.key === 'cashFlowScore' || i.key === 'cashFlowAmount') && latest.ratios.depreciationMissing ? '※' : '';
    return i.value.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + depCaveat;
  };
  const byCategory = {};
  Object.entries(s.results).forEach(([key, r]) => {
    byCategory[r.category] = byCategory[r.category] || [];
    byCategory[r.category].push({ ...r, key });
  });
  const catLabel = { safety: '1. 安全性項目', profitability: '2. 収益性項目', growth: '3. 成長性項目', repayment: '4. 返済力' };

  // 次の得点バンドまでの距離を「あと何%／何年で＋何点」という形で表示する。
  // 単位は指標ラベル末尾の [%]・[年]・[倍]・[円] 表記から判定する。
  const nextBandText = (i) => {
    if (i.points >= i.maxPoints) return '満点';
    const nt = Scoring.nextThreshold(i.key, i.value);
    if (!nt) return 'ー';
    const unitMatch = i.label.match(/\[(.+?)\]/);
    const unit = unitMatch ? unitMatch[1] : '';
    const fmtVal = (v) => unit === '円' ? fmt(v) : v.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    const cmp = nt.direction === 'higher' ? '以上' : '以下';
    return `${fmtVal(nt.nextMin)}${unit === '円' ? '円' : unit}${cmp}で${nt.nextPoints}点（あと${fmtVal(nt.diff)}${unit === '円' ? '円' : unit}）`;
  };

  const catPanels = Object.entries(catLabel).map(([key, label]) => {
    const items = byCategory[key] || [];
    const catTotal = items.reduce((a, i) => a + i.points, 0);
    const catMax = items.reduce((a, i) => a + i.maxPoints, 0);
    const body = `<div class="chart-card-body" style="margin-bottom:6px;">${Viz.meter(catTotal, catMax, { width: 300, height: 12, color: Viz.PALETTE.series[0] })}</div>
      <table class="dsheet compact"><thead><tr><th>指標</th><th>数値</th><th>点数</th><th>次の基準（加点条件）</th></tr></thead><tbody>
      ${items.map(i => `<tr><td>${i.label}${INDICATOR_DESC[i.key] ? `<div style="font-weight:400;font-size:0.6rem;color:var(--ink-muted);white-space:normal;line-height:1.2;">${INDICATOR_DESC[i.key]}</div>` : ''}</td><td>${valueText(i)}</td><td>${i.points}/${i.maxPoints}</td><td style="text-align:left;font-size:0.68rem;color:var(--ink-secondary);">${nextBandText(i)}</td></tr>`).join('')}
      </tbody></table>`;
    return panel(`${label}（${catTotal}/${catMax}点）`, body);
  }).join('');

  const html = `<div class="sheet">
    ${sheetHead('scoring', '--sec-scoring', 'スコアリング', 7)}
    <div class="sheet-sub">安全性・収益性・成長性・返済力の4区分を100点満点で採点し、財務判定を決定します。</div>
    ${internalNotice('⚠ スコアリングの4区分・配点構成（安全性34点／収益性15点／成長性25点／返済力55点）・100点換算・財務判定1〜7のバンドは見本2社の実際の合計点から検算済みです。一方、各指標の詳細な閾値（％と点数の対応）はベストエフォートでの転記のため、実際の与信判断に使う前に必ず原本と突き合わせてください。')}
    ${latest.ratios.depreciationMissing ? `<div class="caption">※ 減価償却費未入力のため、収益力（キャッシュフロー額）・キャッシュフロー額は償却費を0円とした暫定値です。</div>` : ''}
    <div class="grid-2">
      ${panel('総合判定', `<div class="grade-row"><div class="grade-badge">${s.grade}</div><div class="grade-label"><strong>${s.gradeLabel}</strong>${s.total} / ${s.maxTotal}点 → 100点換算 ${s.scaled}点</div></div><div class="grade-meter-wrap">${Viz.gradeMeter(s.grade)}</div>`, { span2: true })}
      ${catPanels}
    </div>
  </div>`;
  document.getElementById('tab-scoring').innerHTML = html;
}

// ---- 8. 指摘事項（ヒアリング・アドバイザー所見） -------------------------------
// data.findingsReport が無ければ何も描画しない（既存サンプルとの後方互換）。
// 内容は参照元ドキュメントの文言を変更せずそのまま反映する（一言一句まるまる参照）。
function findingsTable(t) {
  if (!t) return '';
  return `<table class="dsheet compact"><thead><tr>${t.headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
    ${t.rows.map(r => `<tr>${r.map(c => `<td style="text-align:left;">${c}</td>`).join('')}</tr>`).join('')}
    </tbody></table>`;
}
function findingsBullets(items) {
  return `<ul style="margin:4px 0 0;padding-left:16px;font-size:0.72rem;line-height:1.65;color:var(--ink);">
    ${items.map(([lead, rest]) => `<li>${lead ? `<b>${lead}</b> ` : ''}${rest}</li>`).join('')}
    </ul>`;
}

function renderFindings() {
  const f = STATE.raw.findingsReport;
  const tabButton = document.querySelector('.tab-btn[data-tab="tab-findings"]');
  const tabPanel = document.getElementById('tab-findings');
  if (!f) {
    if (tabButton) tabButton.style.display = 'none';
    tabPanel.innerHTML = '';
    return;
  }
  if (tabButton) tabButton.style.display = '';

  const improvementsBody = `${findingsBullets(f.improvements)}
    <div class="caption" style="margin-top:6px;">${f.improvementsNote}</div>`;
  const summaryBody = findingsTable(f.summaryTable);

  const medicalSections = (f.medicalCorpSections || []).map(sec => `
    <div class="panel">
      <h3>${sec.title}</h3>
      ${sec.table ? findingsTable(sec.table) : ''}
      ${findingsBullets(sec.bullets)}
    </div>`).join('');

  const pageA = `<div class="sheet">
    ${sheetHead('findings', '--sec-findings', '指摘事項①：医療法人への指摘', 8)}
    <div class="sheet-sub">${f.intro}</div>
    <div class="grid-2">
      ${panel(f.improvementsHeading, improvementsBody, { span2: true })}
      ${panel(f.summaryHeading, summaryBody, { span2: true })}
    </div>
    <div class="sheet-sub" style="margin-top:10px;font-weight:700;color:var(--ink);">${f.medicalCorpHeading}</div>
    <div class="grid-2">
      ${medicalSections}
    </div>
  </div>`;

  const subsidiaryBody = `<div class="caption" style="margin-bottom:4px;">${f.subsidiaryIntro}</div>
    ${findingsTable(f.subsidiaryTable)}
    ${findingsBullets(f.subsidiaryBullets)}`;
  const structureBody = findingsBullets(f.structureBullets);
  const priorityBody = findingsTable(f.priorityTable);
  const closingBody = `<ul style="margin:0;padding-left:16px;font-size:0.76rem;line-height:1.8;color:var(--ink);">
      ${f.closingBullets.map(b => `<li>${b}</li>`).join('')}
    </ul>
    <div class="caption" style="margin-top:8px;font-style:italic;">${f.footnote}</div>`;

  const pageB = `<div class="sheet">
    ${sheetHead('findings', '--sec-findings', '指摘事項②：子会社・体制の観点', 9)}
    <div class="grid-2">
      ${panel(f.subsidiaryHeading, subsidiaryBody, { span2: true })}
      ${panel(f.structureHeading, structureBody, { span2: true })}
      ${panel(f.priorityHeading, priorityBody, { span2: true })}
      ${panel(f.closingHeading, closingBody, { span2: true })}
    </div>
  </div>`;

  tabPanel.innerHTML = pageA + pageB;
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
    ['CF計', ...periods.map(p => p.cf ? p.cf.netChange : '')],
    ['現預金の実際の増減', ...periods.map(p => p.cf ? p.cf.actualCashChange : '')],
    ['差異（CF計－実際の増減）', ...periods.map(p => p.cf ? p.cf.cashReconciliationDiff : '')],
    ['減価償却費', ...periods.map(p => p.plSum.depreciationStatus === 'confirmed' ? p.plSum.depreciation : '未入力')],
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
    ['①運転資金（グロスアップ不要）', c.workingCapital], ['②短期返済資金', c.shortTermDebtRepayment],
    ['③長期返済資金', c.longTermDebtRepayment], ['⑤自社株買取資金', c.stockBuyback],
    ['②③⑤小計（実額）', c.grossUpTargetTotal], ['実効税率', c.assumptions.effectiveTaxRate],
    ['②③⑤グロスアップ後', c.grossUpTargetTotal * c.taxGrossUpFactor],
    ['必要保障額合計（①＋②③⑤グロスアップ後）', c.total], ['準備済み資産', c.preparedAssets], ['不足金額', c.shortfall],
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
  document.getElementById('toggle-mode').addEventListener('click', toggleOutputMode);
});

// ---- 出力モード（お客様向け／内部確認用）の切替 --------------------------------
// お客様向けPDFに社内メモ（検算済みの根拠・ベストエフォートの注記・内部用語等）が
// 混入しないよう、既定は「お客様向け」。内部確認用に切り替えると、各種注記が表示される。
function toggleOutputMode() {
  STATE.outputMode = STATE.outputMode === 'internal' ? 'customer' : 'internal';
  const btn = document.getElementById('toggle-mode');
  btn.dataset.mode = STATE.outputMode;
  btn.textContent = STATE.outputMode === 'internal' ? '🔒 内部確認用表示' : '👤 お客様向け表示';
  if (STATE.view) renderAll();
}
