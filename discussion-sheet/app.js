/* ==========================================================================
   UI 制御・描画ロジック（DOM 操作はすべてここに集約）
   ========================================================================== */

let STATE = { raw: null, view: null, stockEval: null, scoring: null, coverage: null };

// ---- 章アイコン（装飾用。識別は常にアイコン形状＋テキストラベルで行い、色だけに頼らない） ---
const ICONS = {
  financial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/></svg>',
  cashflow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h12l-3-3"/><path d="M15 7l-3 3"/><path d="M21 17H9l3 3"/><path d="M9 17l3-3"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M4 19h16"/></svg>',
  coverage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c4 2 8 2 8 2v7c0 5-4 7-8 9-4-2-8-4-8-9V5s4 0 8-2z"/></svg>',
  scoring: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.9 6 6.6.6-5 4.4 1.5 6.5L12 16l-5.9 3.5L7.6 13l-5-4.4 6.6-.6z"/></svg>',
  statements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 13h6M9 17h6M9 9h2"/></svg>',
};
function sectionHero(iconKey, colorVar, title, desc) {
  return `<div class="section-hero">
    <span class="icon-badge" style="background:var(${colorVar});">${ICONS[iconKey]}</span>
    <div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}</div>
  </div>`;
}
function h3Icon(iconKey, colorVar, text) {
  return `<h3><span class="icon-badge" style="background:var(${colorVar});">${ICONS[iconKey]}</span>${text}</h3>`;
}

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

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'html') e.innerHTML = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (typeof c === 'string') e.appendChild(document.createTextNode(c)); else if (c) e.appendChild(c);
  });
  return e;
}

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

// ---- 各タブの描画 ------------------------------------------------------------
function renderCover() {
  const data = STATE.raw;
  const periods = STATE.view.periods;
  const first = periods[0], last = periods[periods.length - 1];
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const legend = [
    ['financial', '--sec-financial', '財務'],
    ['cashflow', '--sec-cashflow', 'キャッシュフロー'],
    ['stock', '--sec-stock', '自社株'],
    ['coverage', '--sec-coverage', '必要保障'],
    ['scoring', '--sec-scoring', 'スコアリング'],
    ['statements', '--sec-statements', '決算情報'],
  ].map(([key, color, label]) => `
    <div class="legend-item">
      <span class="icon-badge" style="background:var(${color});">${ICONS[key]}</span>
      <span class="label">${label}</span>
    </div>`).join('');
  document.getElementById('report-cover').innerHTML = `
    <div class="eyebrow">DISCUSSION SHEET</div>
    <h1>${data.companyName || '(会社名未設定)'} ディスカッションシート</h1>
    <div class="meta">対象期間：${first.label} 〜 ${last.label}　／　作成日：${today}</div>
    <div class="legend-grid">${legend}</div>`;
}

function renderAll() {
  renderCover();
  renderOverview();
  renderFinancial();
  renderCashFlow();
  renderStock();
  renderCoverage();
  renderScoring();
  renderStatements();
}

function renderOverview() {
  const periods = STATE.view.periods;
  const latest = periods[periods.length - 1];
  const g = STATE.scoring;
  const sv = STATE.stockEval;
  const cov = STATE.coverage;
  const prev = periods[periods.length - 2];
  const statTile = (label, curr, prevV, { fmtFn = fmtYen, upIsGood = true, deltaMode = 'pct' } = {}) => {
    let delta = '';
    if (prevV != null && curr != null) {
      const diff = curr - prevV;
      const isUp = diff > 0;
      const cls = diff === 0 ? 'flat' : (isUp === upIsGood ? 'up-good' : 'down-bad');
      const arrow = isUp ? '▲' : diff < 0 ? '▼' : '■';
      const text = deltaMode === 'pt'
        ? `前期比 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pt`
        : (prevV !== 0 ? `前期比 ${diff >= 0 ? '+' : ''}${((diff / Math.abs(prevV)) * 100).toFixed(1)}%` : '');
      if (text) delta = `<div class="delta ${cls}">${arrow} ${text}</div>`;
    }
    return `<div class="kv-item"><div class="k">${label}</div><div class="v">${fmtFn(curr)}</div>${delta}</div>`;
  };
  const html = `
    ${sectionHero('scoring', '--sec-scoring', '財務判定', '安全性・収益性・成長性・返済力の4区分を100点換算し、1(最高水準)〜7(リスクが高い)で総合判定')}
    <div class="card">
      <div class="grade-row">
        <div class="grade-badge">${g.grade}</div>
        <div class="grade-label"><strong>${g.gradeLabel}</strong>定量要因合計 ${g.total}/${g.maxTotal}点 → 100点換算 ${g.scaled}点</div>
      </div>
      <div class="grade-meter-wrap">${Viz.gradeMeter(g.grade)}</div>
      <div class="caption">詳細はスコアリングタブを参照。</div>
    </div>
    ${sectionHero('statements', '--sec-statements', `直近期サマリー（${latest.label}）`, '主要指標の前期からの変化を一目で確認')}
    <div class="card">
      <div class="kv-grid">
        ${statTile('売上高', latest.pl.netSales, prev && prev.pl.netSales)}
        ${statTile('経常利益', latest.plSum.ordinaryIncome, prev && prev.plSum.ordinaryIncome)}
        ${statTile('自己資本比率', latest.ratios.selfCapitalRatio, prev && prev.ratios.selfCapitalRatio, { fmtFn: fmtPct, deltaMode: 'pt' })}
        ${statTile('フリーキャッシュフロー', latest.cf && latest.cf.freeCashFlow, prev && prev.cf && prev.cf.freeCashFlow)}
        <div class="kv-item"><div class="k">自社株評価額(相続税評価/1株)</div><div class="v">${sv ? fmtYen(sv.inheritanceTaxValue) : 'ー'}</div></div>
        ${statTile('必要保障額(不足分)', cov.shortfall, null, { upIsGood: false })}
      </div>
    </div>`;
  document.getElementById('tab-overview').innerHTML = html;
}

function renderFinancial() {
  const periods = STATE.view.periods;
  const labels = periods.map(p => p.label);
  let html = `${sectionHero('financial', '--sec-financial', '財務の観点', '資金調達手段の偏りが経営の安定化のカギ。固定費の見直しと財務の現状把握を')}
    <div class="card"><h3>自己資本比率の推移</h3>
    <div class="chart-card-body">${Viz.lineChart(labels, [{ name: '自己資本比率', values: periods.map(p => p.ratios.selfCapitalRatio) }], { unit: '%' })}</div>
    <table class="dsheet"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('自己資本比率[%]', periods.map(p => p.ratios.selfCapitalRatio), { fmtFn: fmtPct })}
    ${dataRow('ギアリング比率[%]', periods.map(p => p.ratios.gearingRatio), { fmtFn: fmtPct })}
    ${dataRow('固定長期適合率[%]', periods.map(p => p.ratios.fixedLongTermConformityRatio), { fmtFn: fmtPct })}
    ${dataRow('流動比率[%]', periods.map(p => p.ratios.currentRatio), { fmtFn: fmtPct })}
    ${dataRow('純資産合計', periods.map(p => p.bsSum.netAssets))}
    ${dataRow('総資産合計', periods.map(p => p.bsSum.totalAssets), { total: true })}
    </tbody></table></div>

    <div class="card"><h3>有利子負債の推移</h3>
    <div class="chart-card-body">${Viz.columnChart(labels, periods.map(p => p.bsSum.interestBearingDebt), { color: Viz.PALETTE.series[0] })}</div>
    <table class="dsheet"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('短期借入金合計', periods.map(p => p.loanSum.shortTermTotal))}
    ${dataRow('長期借入金合計', periods.map(p => p.loanSum.longTermTotal))}
    ${dataRow('有利子負債合計', periods.map(p => p.bsSum.interestBearingDebt), { total: true })}
    ${dataRow('短期・連帯保証額(参考)', periods.map(p => p.loanSum.shortTermGuaranteeTotal))}
    ${dataRow('長期・連帯保証額(参考)', periods.map(p => p.loanSum.longTermGuaranteeTotal))}
    ${dataRow('債務償還年数[年]', periods.map(p => p.ratios.debtServiceYears), { fmtFn: (v) => v === null ? 'ー' : v.toFixed(1) + '年' })}
    </tbody></table>
    <div class="caption">返済に要する年数＝(有利子負債−現金預金)÷(営業利益＋減価償却費)。1年以内が最高評価。</div>
    </div>`;
  document.getElementById('tab-financial').innerHTML = html;
}

function renderCashFlow() {
  const periods = STATE.view.periods;
  const labels = periods.map(p => p.label);
  const hasCf = periods.some(p => p.cf);
  let html = `${sectionHero('cashflow', '--sec-cashflow', 'キャッシュフローの観点', '黒字でも資金が不足することがある。手元のキャッシュフローを見極める')}

    <div class="card"><h3>売上高の推移</h3>
    <div class="chart-card-body">${Viz.columnChart(labels, periods.map(p => p.pl.netSales), { color: Viz.PALETTE.series[0] })}</div></div>

    <div class="card"><h3>利益率の推移</h3>
    <div class="chart-card-body">${Viz.lineChart(labels, [
      { name: '営業利益率', values: periods.map(p => p.ratios.operatingMargin) },
      { name: '経常利益率', values: periods.map(p => p.ratios.ordinaryMargin) },
    ], { unit: '%' })}</div>
    <table class="dsheet"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('売上高', periods.map(p => p.pl.netSales))}
    ${dataRow('対前年伸び率[%]', periods.map(p => p.yoy && p.yoy.salesGrowth), { fmtFn: fmtPct })}
    ${dataRow('粗利率[%]', periods.map(p => p.ratios.grossMargin), { fmtFn: fmtPct })}
    ${dataRow('営業利益率[%]', periods.map(p => p.ratios.operatingMargin), { fmtFn: fmtPct })}
    ${dataRow('経常利益率[%]', periods.map(p => p.ratios.ordinaryMargin), { fmtFn: fmtPct })}
    </tbody></table></div>

    <div class="card"><h3>キャッシュフローの推移</h3>
    ${hasCf ? `<div class="chart-card-body">${Viz.groupedBarChart(labels, [
      { name: '営業CF', values: periods.map(p => p.cf && p.cf.operatingCF) },
      { name: '投資CF', values: periods.map(p => p.cf && p.cf.investingCF) },
      { name: '財務CF', values: periods.map(p => p.cf && p.cf.financingCF) },
    ])}</div>` : ''}
    <table class="dsheet"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('①営業キャッシュフロー', periods.map(p => p.cf && p.cf.operatingCF))}
    ${dataRow('②投資キャッシュフロー', periods.map(p => p.cf && p.cf.investingCF))}
    ${dataRow('③フリーキャッシュフロー(①+②)', periods.map(p => p.cf && p.cf.freeCashFlow), { total: true })}
    ${dataRow('④財務キャッシュフロー', periods.map(p => p.cf && p.cf.financingCF))}
    ${dataRow('⑤キャッシュフロー計(③+④)', periods.map(p => p.cf && p.cf.netChange))}
    </tbody></table>
    <div class="caption">最も古い期間はその前期の貸借対照表が無いため算出できません（「ー」表示）。前々期の決算書を追加入力すると算出できます。</div>
    </div>

    <div class="card"><h3>固定費の内訳（直近期）</h3>
    ${renderSgaTable(periods[periods.length - 1])}
    </div>`;
  document.getElementById('tab-cashflow').innerHTML = html;
}

function renderSgaTable(period) {
  const detail = period.pl.sgaDetail || {};
  const entries = Object.entries(detail).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const TOP_N = 10;
  const top = entries.slice(0, TOP_N);
  const restTotal = entries.slice(TOP_N).reduce((a, [, v]) => a + v, 0);
  const restCount = entries.length - top.length;
  const shown = restCount > 0 ? [...top, [`その他（${restCount}科目）`, restTotal]] : top;
  const maxV = Math.max(...shown.map(([, v]) => v), 1);

  const bars = shown.map(([k, v]) => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <div style="width:150px;font-size:0.78rem;color:var(--ink-secondary);flex:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${k}</div>
      <div style="flex:1;">${Viz.meter(v, maxV, { width: 260, height: 14, color: Viz.PALETTE.series[0] })}</div>
      <div style="width:110px;text-align:right;font-size:0.82rem;flex:none;">${fmt(v)}</div>
    </div>`).join('');

  const rows = shown.map(([k, v]) => `<tr><td>${k}</td><td>${fmt(v)}</td></tr>`).join('');
  return `<div class="chart-card-body" style="margin-bottom:12px;">${bars}</div>
    <table class="dsheet"><thead><tr><th>科目（上位${TOP_N}件＋その他）</th><th>${period.label}</th></tr></thead>
    <tbody>${rows}<tr class="total"><td>販管費合計</td><td>${fmt(period.plSum.sgaTotal)}</td></tr></tbody></table>
    <div class="caption">科目数が多い場合は金額の大きい上位${TOP_N}件のみ表示し、残りは「その他」に集計しています。全科目の内訳はExcel出力で確認できます。</div>`;
}

function renderStock() {
  const sv = STATE.stockEval;
  const data = STATE.raw;
  if (!sv) {
    const reason = STATE.stockEvalSkipReason || '自社株評価の算出に失敗しました。入力データ（資本金・発行株式数・業種等）を確認してください。';
    document.getElementById('tab-stock').innerHTML = `<div class="notice">⚠ ${reason}</div>`;
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
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <div style="width:120px;font-size:0.78rem;color:var(--ink-secondary);flex:none;">${m.name}</div>
      <div style="flex:1;">${Viz.meter(m.value, maxMethodValue, { width: 280, height: 16, color: m.color })}</div>
      <div style="width:110px;text-align:right;font-weight:700;font-size:0.85rem;flex:none;">${fmtYen(m.value)}</div>
    </div>`).join('');
  let html = `${sectionHero('stock', '--sec-stock', '自社株の観点', '何かあっても事業を継続できるよう、必要な資金をあらかじめ把握しておく')}
    <div class="card"><h3>会社規模判定</h3>
      <div class="kv-grid">
        <div class="kv-item"><div class="k">会社規模</div><div class="v">${sv.sizeJudge.size}</div></div>
        <div class="kv-item"><div class="k">斟酌率</div><div class="v">${sv.shinshakuRate}</div></div>
        <div class="kv-item"><div class="k">併用割合(類似業種比準価額の重み L)</div><div class="v">${sv.combinedWeightL}</div></div>
      </div>
      <div class="caption">${sv.combinedNote}</div>
    </div>
    ${needsSimilarInput ? `<div class="notice">⚠ 類似業種比準価額の計算には国税庁公表の「類似業種の株価・配当・利益・純資産(A/B/C/D)」が必要ですが、未入力のため比準要素(b,c,d)は計算できていてもA/B/C/Dが0扱いになっています。データ入力タブのJSONの similarIndustry に値を入れてください。入手先：国税庁ホームページ「類似業種比準価額計算上の業種目及び業種目別株価等」</div>` : ''}
    <div class="card"><h3>評価額一覧（1株あたり）</h3>
      <div class="chart-card-body" style="margin-bottom:12px;">${methodBars}</div>
      <table class="dsheet"><thead><tr><th>方式</th><th>評価額</th></tr></thead><tbody>
      ${dataRow('類似業種比準価額', [sv.similarIndustryValue.perShare], { fmtFn: fmtYen })}
      ${dataRow('純資産価額（相続税評価ベース）', [sv.netAssetValue.perShareInheritance], { fmtFn: fmtYen })}
      ${dataRow('併用方式（相続税評価額）', [sv.inheritanceTaxValue], { fmtFn: fmtYen, total: true })}
      ${dataRow('配当還元価額', [sv.dividendValue.perShare], { fmtFn: fmtYen })}
      ${dataRow('法人税評価額（簡易）', [sv.corporateTaxValue], { fmtFn: fmtYen })}
      </tbody></table>
    </div>
    <div class="card"><h3>株主一覧</h3>
      <table class="dsheet"><thead><tr><th>株主名</th><th>株数</th><th>持分割合</th><th>相続税評価額(合計)</th></tr></thead><tbody>
      ${(data.shareholders || []).map(s => `<tr><td>${s.name}</td><td>${fmt(s.shares)}</td><td>${fmtPct(100 * s.shares / data.totalShares)}</td><td>${fmtYen(sv.inheritanceTaxValue * s.shares)}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
  document.getElementById('tab-stock').innerHTML = html;
}

function renderCoverage() {
  const c = STATE.coverage;
  const rows = [
    ['①運転資金（月額固定費×想定月数）', c.workingCapital],
    ['②負債等の返済資金（短期）', c.shortTermDebtRepayment],
    ['　内、連帯保証債務（短期）[参考]', c.shortTermGuarantee],
    ['③負債等の返済資金（長期）', c.longTermDebtRepayment],
    ['　内、連帯保証債務（長期）[参考]', c.longTermGuarantee],
    ['④就業不能時の運転資金（参考）', c.disabilityCapital],
    ['⑤役員死亡退職金（参考）', c.deathRetirement],
    ['　役員勇退退職金（参考）', c.resignationRetirement],
    ['⑥事業承継対策資金（自社株買取資金）', c.stockBuyback],
    ['準備済み資産（既加入の保険等）', -c.preparedAssets],
  ];
  const covered = Math.max(0, c.total - c.shortfall);
  const html = `${sectionHero('coverage', '--sec-coverage', '必要保障の観点', '何かあっても事業を継続できるよう、必要な資金をあらかじめ把握しておく')}
    <div class="notice">この試算は一般的な考え方に基づく初期設定値（運転資金${c.assumptions.workingCapitalMonths}ヶ月分、功績倍率など）を使用しています。実際のご提案時は顧問先の実情に合わせて係数を調整してください。</div>
    <div class="card"><h3>必要保障額に対する充足状況</h3>
    <div class="chart-card-body">${Viz.stackedBarRow('必要保障額 合計 ' + fmtYen(c.total).replace(/<[^>]+>/g, ''), [
      { name: `準備済み資産 ${fmtYen(covered).replace(/<[^>]+>/g, '')}`, value: covered, color: Viz.PALETTE.good },
      { name: `不足金額 ${fmtYen(c.shortfall).replace(/<[^>]+>/g, '')}`, value: c.shortfall, color: Viz.PALETTE.critical },
    ], { width: 640, barHeight: 32 })}</div>
    </div>
    <div class="card"><h3>必要保障額の試算</h3>
    <table class="dsheet"><thead><tr><th>項目</th><th>金額</th></tr></thead><tbody>
    ${rows.map(([l, v]) => dataRow(l, [v], { fmtFn: fmtYen })).join('')}
    ${dataRow('必要保障額 合計', [c.total], { fmtFn: fmtYen, total: true })}
    ${dataRow('不足金額', [c.shortfall], { fmtFn: fmtYen, total: true })}
    </tbody></table>
    </div>`;
  document.getElementById('tab-coverage').innerHTML = html;
}

function renderScoring() {
  const s = STATE.scoring;
  const byCategory = {};
  Object.values(s.results).forEach(r => {
    byCategory[r.category] = byCategory[r.category] || [];
    byCategory[r.category].push(r);
  });
  const catLabel = { safety: '1. 安全性項目', profitability: '2. 収益性項目', growth: '3. 成長性項目', repayment: '4. 返済力' };
  let html = `${sectionHero('scoring', '--sec-scoring', 'スコアリング', '安全性・収益性・成長性・返済力の4区分を100点満点で採点し、財務判定を決定')}
    <div class="notice">⚠ スコアリングの4区分・配点構成（安全性34点／収益性15点／成長性25点／返済力20点）・100点換算・財務判定1〜7のバンドは見本2社の実際の合計点から検算済みです。一方、各指標の詳細な閾値（％と点数の対応）はベストエフォートでの転記のため、実際の与信判断に使う前に必ず原本と突き合わせてください。</div>
    <div class="card"><h3>スコアリング結果</h3>
    <div class="grade-row"><div class="grade-badge">${s.grade}</div><div class="grade-label"><strong>${s.gradeLabel}</strong>${s.total} / ${s.maxTotal}点 → 100点換算 ${s.scaled}点</div></div>
    <div class="grade-meter-wrap">${Viz.gradeMeter(s.grade)}</div>
    </div>`;
  Object.entries(catLabel).forEach(([key, label]) => {
    const items = byCategory[key] || [];
    const catTotal = items.reduce((a, i) => a + i.points, 0);
    const catMax = items.reduce((a, i) => a + i.maxPoints, 0);
    html += `<div class="card"><h3>${label}（${catTotal}/${catMax}点）</h3>
      <div class="chart-card-body" style="margin-bottom:12px;">${Viz.meter(catTotal, catMax, { width: 400, height: 16, color: Viz.PALETTE.series[0] })}</div>
      <table class="dsheet"><thead><tr><th>指標</th><th>数値</th><th>点数</th></tr></thead><tbody>
      ${items.map(i => `<tr><td>${i.label}</td><td>${i.value === null ? 'ー' : i.value.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}</td><td>${i.points}/${i.maxPoints}</td></tr>`).join('')}
      </tbody></table></div>`;
  });
  document.getElementById('tab-scoring').innerHTML = html;
}

function renderStatements() {
  const periods = STATE.view.periods;
  const assetColors = [Viz.PALETTE.series[0], '#9ec5f4'];
  const liabColors = [Viz.PALETTE.series[1], '#f3b58f', Viz.PALETTE.good];
  const bsChart = periods.map(p => `
    ${Viz.stackedBarRow(`${p.label}｜資産`, [
      { name: '流動資産', value: p.bsSum.currentAssets, color: assetColors[0] },
      { name: '固定資産', value: p.bsSum.fixedAssets, color: assetColors[1] },
    ])}
    ${Viz.stackedBarRow(`${p.label}｜負債・純資産`, [
      { name: '流動負債', value: p.bsSum.currentLiabilities, color: liabColors[0] },
      { name: '固定負債', value: p.bsSum.fixedLiabilities, color: liabColors[1] },
      { name: '純資産', value: Math.max(0, p.bsSum.netAssets), color: liabColors[2] },
    ])}`).join('<div style="height:10px;"></div>');
  const html = `${sectionHero('statements', '--sec-statements', '決算情報', '貸借対照表・損益計算書の3期推移')}
    <div class="card"><h3>貸借対照表の構成比の推移</h3>
    <div class="chart-card-body">${bsChart}</div>
    <div class="caption">純資産がマイナス（債務超過）の期間は資産・負債の比率表示を優先し、グラフ上は0として扱っています。</div>
    </div>

    <div class="card"><h3>貸借対照表（資産の部）</h3>
    <table class="dsheet"><thead>${periodHeaderRow(periods)}</thead><tbody>
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
    </tbody></table></div>

    <div class="card"><h3>貸借対照表（負債・純資産の部）</h3>
    <table class="dsheet"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('流動負債合計', periods.map(p => p.bsSum.currentLiabilities), { total: true })}
    ${dataRow('固定負債合計', periods.map(p => p.bsSum.fixedLiabilities), { total: true })}
    ${dataRow('負債合計', periods.map(p => p.bsSum.totalLiabilities), { total: true })}
    ${dataRow('純資産合計', periods.map(p => p.bsSum.netAssets), { total: true })}
    </tbody></table></div>

    <div class="card"><h3>損益計算書</h3>
    <table class="dsheet"><thead>${periodHeaderRow(periods)}</thead><tbody>
    ${dataRow('売上高', periods.map(p => p.pl.netSales))}
    ${dataRow('売上原価', periods.map(p => p.pl.costOfSales))}
    ${dataRow('売上総利益', periods.map(p => p.plSum.grossProfit), { total: true })}
    ${dataRow('販管費', periods.map(p => p.plSum.sgaTotal))}
    ${dataRow('営業利益', periods.map(p => p.plSum.operatingIncome), { total: true })}
    ${dataRow('経常利益', periods.map(p => p.plSum.ordinaryIncome), { total: true })}
    ${dataRow('当期純利益', periods.map(p => p.plSum.netIncome), { total: true })}
    </tbody></table></div>`;
  document.getElementById('tab-statements').innerHTML = html;
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
