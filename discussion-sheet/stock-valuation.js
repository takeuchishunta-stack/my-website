/* ==========================================================================
   自社株評価エンジン
   財産評価基本通達 178〜189-2（取引相場のない株式の評価）に基づく標準算式。
   ※ 比準要素数1の会社・0の会社、株式保有特定会社、土地保有特定会社、
     開業後3年未満の会社等の特定会社判定は未実装（通常の原則的評価方式のみ）。
   ========================================================================== */

const StockValuation = (() => {

  // 会社規模判定：総資産価額・従業員数基準 [単位:円]
  const ASSET_THRESHOLDS = {
    '卸売業':       [{ min: 20e8, size: '大会社' }, { min: 4e8, size: '中会社の大' }, { min: 2e8, size: '中会社の中' }, { min: 0.7e8, size: '中会社の小' }],
    '小売サービス業': [{ min: 15e8, size: '大会社' }, { min: 5e8, size: '中会社の大' }, { min: 2.5e8, size: '中会社の中' }, { min: 0.4e8, size: '中会社の小' }],
    'その他':       [{ min: 15e8, size: '大会社' }, { min: 5e8, size: '中会社の大' }, { min: 2.5e8, size: '中会社の中' }, { min: 0.5e8, size: '中会社の小' }],
  };
  const SALES_THRESHOLDS = {
    '卸売業':       [{ min: 30e8, size: '大会社' }, { min: 7e8, size: '中会社の大' }, { min: 3.5e8, size: '中会社の中' }, { min: 2e8, size: '中会社の小' }],
    '小売サービス業': [{ min: 20e8, size: '大会社' }, { min: 5e8, size: '中会社の大' }, { min: 2.5e8, size: '中会社の中' }, { min: 0.6e8, size: '中会社の小' }],
    'その他':       [{ min: 15e8, size: '大会社' }, { min: 4e8, size: '中会社の大' }, { min: 2e8, size: '中会社の中' }, { min: 0.8e8, size: '中会社の小' }],
  };
  const SIZE_RANK = { '大会社': 4, '中会社の大': 3, '中会社の中': 2, '中会社の小': 1, '小会社': 0 };
  const L_RATIO = { '大会社': 1.0, '中会社の大': 0.9, '中会社の中': 0.75, '中会社の小': 0.6, '小会社': 0.5 };
  const SHINSHAKU = { '大会社': 0.7, '中会社の大': 0.6, '中会社の中': 0.6, '中会社の小': 0.6, '小会社': 0.5 };

  function rankBy(thresholds, value) {
    for (const t of thresholds) if (value >= t.min) return t.size;
    return '小会社';
  }

  function employeeRank(employeeCount) {
    if (employeeCount > 35) return '大会社';
    if (employeeCount > 20) return '中会社の大';
    if (employeeCount > 5) return '中会社の中';
    return '中会社の小'; // 5人以下は小会社側の基準で頭打ち
  }

  function judgeCompanySize({ industryCategory, totalAssetsBookValue, employeeCount, annualSales }) {
    if (employeeCount >= 70) {
      return { size: '大会社', basis: '従業員数70人以上のため無条件で大会社' };
    }
    const assetRank = rankBy(ASSET_THRESHOLDS[industryCategory], totalAssetsBookValue);
    const empRank = employeeRank(employeeCount);
    // 総資産×従業員数は「いずれか下位の方」を採る
    const sizeA = SIZE_RANK[assetRank] <= SIZE_RANK[empRank] ? assetRank : empRank;
    const sizeB = rankBy(SALES_THRESHOLDS[industryCategory], annualSales);
    // 取引金額基準との比較は「いずれか上位(大きい)の方」を採る
    const finalSize = SIZE_RANK[sizeB] > SIZE_RANK[sizeA] ? sizeB : sizeA;
    return { size: finalSize, assetRank, empRank, sizeA, sizeB };
  }

  // 類似業種比準価額
  function similarIndustryValue({ A, B, C, D, b, c, d, shinshakuRate, parValueAdjustedShares }) {
    const factor = ((safeDiv(b, B) + safeDiv(c, C) + safeDiv(d, D)) / 3);
    const factorNonNeg = Math.max(0, factor);
    const per50Yen = A * factorNonNeg * shinshakuRate;
    const perShare = per50Yen * parValueAdjustedShares; // 1株あたりの資本金等の額 ÷ 50円
    return { factor, factorNonNeg, per50Yen, perShare: Math.max(0, perShare) };
  }
  function safeDiv(a, b) { return b ? a / b : 0; }

  // 純資産価額方式（相続税評価額ベース／法人税評価額ベース）
  function netAssetValue({ netAssetsBookValue, netAssetsTaxValue, effectiveTaxRate, totalShares, treasuryShares }) {
    const sharesOutstanding = Math.max(1, totalShares - (treasuryShares || 0));
    const unrealizedGain = Math.max(0, netAssetsTaxValue - netAssetsBookValue);
    const taxEquivalent = unrealizedGain * (effectiveTaxRate || 0.37);
    const inheritanceTaxBase = Math.max(0, netAssetsTaxValue - taxEquivalent);
    const perShareInheritance = inheritanceTaxBase / sharesOutstanding;
    // 法人税評価額：含み益に対する法人税相当額(37%)を控除しない簡易版（帳簿ベース）
    const perShareCorporateTax = Math.max(0, netAssetsTaxValue) / sharesOutstanding;
    return { sharesOutstanding, unrealizedGain, taxEquivalent, inheritanceTaxBase, perShareInheritance, perShareCorporateTax };
  }

  // 配当還元価額
  function dividendValue({ dividendPaid2YrAvg, parValueAdjustedShares, par50YenShares }) {
    let perPar = safeDiv(dividendPaid2YrAvg, par50YenShares);
    if (perPar < 2.5) perPar = 2.5; // 2円50銭未満の場合のフロア
    const perShare = (perPar / 0.10) * parValueAdjustedShares;
    return { perPar, perShare };
  }

  // 併用方式（小会社・中会社）／大会社は類似業種比準100%（純資産価額との低い方も可）
  function combinedValue({ size, similarPerShare, netAssetPerShare }) {
    const L = L_RATIO[size];
    if (size === '大会社') {
      return { L, value: Math.min(similarPerShare, netAssetPerShare) > 0
        ? Math.min(similarPerShare, netAssetPerShare) : Math.max(similarPerShare, netAssetPerShare),
        note: '大会社：類似業種比準価額と純資産価額のいずれか低い方（通常は類似業種比準価額）' };
    }
    const blended = similarPerShare * L + netAssetPerShare * (1 - L);
    return { L, value: Math.min(blended, netAssetPerShare), note: `併用方式：類似業種比準×${L}＋純資産価額×${(1 - L).toFixed(2)}（純資産価額の方が低ければそちらを採用可）` };
  }

  // ---- メイン関数：会社情報＋類似業種データから自社株評価額一式を算出 -----------
  function evaluate(input) {
    const {
      industryCategory, totalAssetsBookValue, employeeCount, annualSales,
      netAssetsBookValue, netAssetsTaxValue, capitalAmount, totalShares, treasuryShares,
      annualProfit, annualProfitPrevAvg, dividendPaid2YrAvg,
      similarIndustry, // { A, B, C, D, periodLabel }
      effectiveTaxRate,
    } = input;

    const sizeJudge = judgeCompanySize({ industryCategory, totalAssetsBookValue, employeeCount, annualSales });
    const shinshakuRate = SHINSHAKU[sizeJudge.size];

    const par50YenShares = capitalAmount / 50;
    const parValueAdjustedShares = safeDiv(capitalAmount / totalShares, 50);

    const c = safeDiv(Math.min(annualProfit, annualProfitPrevAvg ?? annualProfit), par50YenShares);
    const b = safeDiv(dividendPaid2YrAvg, par50YenShares);
    const d = safeDiv(netAssetsBookValue, par50YenShares);

    const similar = similarIndustryValue({
      A: similarIndustry.A, B: similarIndustry.B, C: similarIndustry.C, D: similarIndustry.D,
      b, c, d, shinshakuRate, parValueAdjustedShares,
    });

    const netAsset = netAssetValue({
      netAssetsBookValue, netAssetsTaxValue: netAssetsTaxValue ?? netAssetsBookValue,
      effectiveTaxRate, totalShares, treasuryShares,
    });

    const dividend = dividendValue({ dividendPaid2YrAvg, parValueAdjustedShares, par50YenShares });

    const combined = combinedValue({
      size: sizeJudge.size, similarPerShare: similar.perShare, netAssetPerShare: netAsset.perShareInheritance,
    });

    return {
      sizeJudge, shinshakuRate, par50YenShares, parValueAdjustedShares,
      elements: { b, c, d },
      similarIndustryValue: similar,
      netAssetValue: netAsset,
      dividendValue: dividend,
      inheritanceTaxValue: combined.value,
      combinedNote: combined.note,
      combinedWeightL: combined.L,
      corporateTaxValue: Math.min(combined.value, netAsset.perShareCorporateTax) === combined.value
        ? netAsset.perShareCorporateTax // 法人税評価額は含み益控除をしない分やや高めになるのが通常
        : netAsset.perShareCorporateTax,
    };
  }

  return { judgeCompanySize, similarIndustryValue, netAssetValue, dividendValue, combinedValue, evaluate,
           ASSET_THRESHOLDS, SALES_THRESHOLDS, L_RATIO, SHINSHAKU };
})();

if (typeof module !== 'undefined') module.exports = StockValuation;
