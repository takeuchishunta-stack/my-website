/* ==========================================================================
   軽量SVGチャート部品ライブラリ（外部ライブラリ不使用・印刷にも強い）
   dataviz スキルのガイドに沿った実装：
   - 棒/折れ線は細め、データ端は4px角丸・ベースラインは直角
   - 2px以上のサーフェスギャップでセグメントを分離
   - 凡例は2系列以上で必須、ラベルは選択的に（全点に付けない）
   - カテゴリカル配色は検証済みデフォルトパレットの slot1-3（全ペアでCVD安全）
   ========================================================================== */

const Viz = (() => {
  const PALETTE = {
    series: ['#2a78d6', '#eb6834', '#1baf7a'], // slot1 blue / slot2 orange / slot3 aqua
    good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b',
    ink: '#0b0b0b', inkSecondary: '#52514e', inkMuted: '#898781',
    grid: '#e1e0d9', baseline: '#c3c2b7', surface: '#fcfcfb',
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const compact = (n) => {
    if (n === null || n === undefined || Number.isNaN(n)) return 'ー';
    const abs = Math.abs(n);
    if (abs >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '億';
    if (abs >= 1e4) return (n / 1e4).toFixed(0) + '万';
    return Math.round(n).toLocaleString('ja-JP');
  };

  function svgWrap(width, height, inner, viewBoxW, viewBoxH) {
    return `<svg viewBox="0 0 ${viewBoxW || width} ${viewBoxH || height}" width="100%" style="max-width:${width}px; display:block;" role="img">${inner}</svg>`;
  }

  // ---- 棒グラフ（単系列・縦）: 売上高などの推移 --------------------------------
  function columnChart(labels, values, { width = 500, height = 130, color = PALETTE.series[0], unit = '' } = {}) {
    const padL = 56, padR = 56, padT = 18, padB = 26;
    const plotW = width - padL - padR, plotH = height - padT - padB;
    const max = Math.max(...values.filter(v => v != null), 1) * 1.15;
    const n = values.length;
    const slot = plotW / n;
    const barW = Math.min(28, slot * 0.5);
    const baseY = padT + plotH;

    let bars = '';
    values.forEach((v, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = v == null ? 0 : (v / max) * plotH;
      const y = baseY - h;
      bars += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(0, h).toFixed(1)}" rx="4" ry="4" fill="${color}"/>`;
      bars += `<text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="12" fill="${PALETTE.ink}" font-weight="600">${v == null ? 'ー' : compact(v) + unit}</text>`;
      bars += `<text x="${cx.toFixed(1)}" y="${(baseY + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="${PALETTE.inkSecondary}">${esc(labels[i])}</text>`;
    });
    const gridline = `<line x1="${padL}" y1="${baseY}" x2="${width - padR}" y2="${baseY}" stroke="${PALETTE.baseline}" stroke-width="1"/>`;
    return svgWrap(width, height, gridline + bars);
  }

  // ---- グループ化棒グラフ（最大3系列）: キャッシュフローの推移など -----------------
  function groupedBarChart(labels, series, { width = 500, height = 140, unit = '' } = {}) {
    // series: [{name, values:[...]}, ...] 最大3系列
    const padL = 56, padR = 56, padT = 16, padB = 26;
    const plotW = width - padL - padR, plotH = height - padT - padB;
    const n = labels.length;
    const sN = series.length;
    const allValues = series.flatMap(s => s.values).filter(v => v != null);
    const max = Math.max(...allValues.map(Math.abs), 1) * 1.2;
    const slot = plotW / n;
    const groupW = Math.min(slot * 0.78, 24 * sN + 4 * (sN - 1));
    const barW = (groupW - 4 * (sN - 1)) / sN;
    const zeroY = padT + plotH / 2; // 0軸中央（マイナス値がある指標のため）
    const scale = (plotH / 2) / max;

    let bars = '';
    labels.forEach((label, i) => {
      const groupX0 = padL + slot * i + (slot - groupW) / 2;
      series.forEach((s, si) => {
        const v = s.values[i];
        const x = groupX0 + si * (barW + 4);
        const h = v == null ? 0 : Math.abs(v) * scale;
        const y = v == null ? zeroY : (v >= 0 ? zeroY - h : zeroY);
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" ry="3" fill="${PALETTE.series[si]}"/>`;
      });
      bars += `<text x="${(groupX0 + groupW / 2).toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="${PALETTE.inkSecondary}">${esc(label)}</text>`;
    });
    const zeroLine = `<line x1="${padL}" y1="${zeroY}" x2="${width - padR}" y2="${zeroY}" stroke="${PALETTE.baseline}" stroke-width="1"/>`;

    const legend = series.map((s, i) => `
      <span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;">
        <span style="width:10px;height:10px;border-radius:2px;background:${PALETTE.series[i]};display:inline-block;"></span>
        <span style="font-size:12px;color:${PALETTE.inkSecondary};">${esc(s.name)}</span>
      </span>`).join('');

    return `<div>${svgWrap(width, height, zeroLine + bars)}
      <div style="margin-top:4px;">${legend}</div></div>`;
  }

  // ---- 折れ線グラフ（最大2系列・%推移向け） -----------------------------------
  function lineChart(labels, series, { width = 500, height = 130, unit = '%', directLabel = true } = {}) {
    const padL = 56, padR = 56, padT = 14, padB = 26;
    const plotW = width - padL - padR, plotH = height - padT - padB;
    const n = labels.length;
    const allValues = series.flatMap(s => s.values).filter(v => v != null);
    const max = Math.max(...allValues, 0);
    const min = Math.min(...allValues, 0);
    const range = (max - min) || 1;
    const x = (i) => padL + (n === 1 ? 0 : (plotW * i) / (n - 1));
    const y = (v) => padT + plotH - ((v - min) / range) * plotH;

    let grid = '';
    const zeroY = y(0);
    if (min < 0 && max > 0) grid += `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${width - padR}" y2="${zeroY.toFixed(1)}" stroke="${PALETTE.baseline}" stroke-width="1"/>`;
    else grid += `<line x1="${padL}" y1="${(padT + plotH).toFixed(1)}" x2="${width - padR}" y2="${(padT + plotH).toFixed(1)}" stroke="${PALETTE.baseline}" stroke-width="1"/>`;

    // 終点の直接ラベルが近い値で重ならないよう、Y位置の最小間隔を確保する
    const lastIdxAll = n - 1;
    const labelPositions = series.map((s) => {
      const lv = s.values[lastIdxAll];
      return lv == null ? null : y(lv);
    });
    const MIN_GAP = 13;
    const order = labelPositions.map((v, i) => i).filter(i => labelPositions[i] != null).sort((a, b) => labelPositions[a] - labelPositions[b]);
    for (let k = 1; k < order.length; k++) {
      const prev = order[k - 1], cur = order[k];
      if (labelPositions[cur] - labelPositions[prev] < MIN_GAP) {
        labelPositions[cur] = labelPositions[prev] + MIN_GAP;
      }
    }

    let lines = '';
    series.forEach((s, si) => {
      const color = PALETTE.series[si];
      const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      lines += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
      s.values.forEach((v, i) => {
        if (v == null) return;
        lines += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${color}" stroke="${PALETTE.surface}" stroke-width="2"/>`;
      });
      if (directLabel) {
        const lastIdx = s.values.length - 1;
        const lv = s.values[lastIdx];
        if (lv != null) {
          lines += `<text x="${(x(lastIdx) + 8).toFixed(1)}" y="${labelPositions[si].toFixed(1)}" font-size="12" font-weight="600" fill="${PALETTE.ink}" dominant-baseline="middle">${lv.toFixed(1)}${unit}</text>`;
        }
      }
    });

    let xLabels = '';
    labels.forEach((l, i) => {
      xLabels += `<text x="${x(i).toFixed(1)}" y="${(padT + plotH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="${PALETTE.inkSecondary}">${esc(l)}</text>`;
    });

    const legend = series.length > 1 ? series.map((s, i) => `
      <span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;">
        <span style="width:16px;height:2px;background:${PALETTE.series[i]};display:inline-block;"></span>
        <span style="font-size:12px;color:${PALETTE.inkSecondary};">${esc(s.name)}</span>
      </span>`).join('') : '';

    return `<div>${svgWrap(width, height, grid + lines + xLabels)}
      ${legend ? `<div style="margin-top:4px;">${legend}</div>` : ''}</div>`;
  }

  // ---- 積み上げ横棒（構成比）: B/S構成など ------------------------------------
  function stackedBarRow(label, segments, { width = 560, barHeight = 28, gap = 2 } = {}) {
    // segments: [{name, value, color}], valueの合計に対する割合で描画
    const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
    let x = 0;
    const padL = 0;
    let rects = '';
    segments.forEach((s) => {
      const w = (Math.max(0, s.value) / total) * width;
      const segW = Math.max(0, w - gap);
      if (segW > 0.5) {
        rects += `<rect x="${(padL + x).toFixed(1)}" y="0" width="${segW.toFixed(1)}" height="${barHeight}" rx="3" fill="${s.color}"/>`;
        if (segW > 46) {
          rects += `<text x="${(padL + x + segW / 2).toFixed(1)}" y="${barHeight / 2 + 4}" text-anchor="middle" font-size="11" fill="#fff" font-weight="600">${compact(s.value)}</text>`;
        }
      }
      x += w;
    });
    const legend = segments.map(s => `
      <span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;">
        <span style="width:9px;height:9px;border-radius:2px;background:${s.color};display:inline-block;"></span>
        <span style="font-size:11px;color:${PALETTE.inkSecondary};">${esc(s.name)}</span>
      </span>`).join('');
    return `<div style="margin-bottom:10px;">
      <div style="font-size:12px;color:${PALETTE.inkSecondary};margin-bottom:3px;">${esc(label)}</div>
      ${svgWrap(width, barHeight, rects, width, barHeight)}
    </div>`;
  }

  // ---- メーター（割合バー）: 必要保障額の充足率、スコア充足率など -----------------
  function meter(value, max, { width = 400, height = 14, color = PALETTE.series[0], trackColor = null } = {}) {
    const pct = Math.max(0, Math.min(1, max ? value / max : 0));
    const track = trackColor || '#e8f0fa';
    return svgWrap(width, height,
      `<rect x="0" y="0" width="${width}" height="${height}" rx="${height / 2}" fill="${track}"/>` +
      `<rect x="0" y="0" width="${(width * pct).toFixed(1)}" height="${height}" rx="${height / 2}" fill="${color}"/>`,
      width, height);
  }

  // ---- 財務判定メーター（1〜7の序列スケール） ---------------------------------
  function gradeMeter(grade, { width = 420, height = 54 } = {}) {
    const n = 7;
    const cellW = width / n;
    const colorFor = (g) => g <= 2 ? PALETTE.good : g <= 4 ? '#cfcac0' : g <= 5 ? PALETTE.warning : PALETTE.critical;
    let cells = '';
    for (let g = 1; g <= n; g++) {
      const x = cellW * (g - 1);
      const active = g === grade;
      const c = colorFor(g);
      cells += `<rect x="${(x + 1.5).toFixed(1)}" y="${active ? 0 : 10}" width="${(cellW - 3).toFixed(1)}" height="${active ? 28 : 18}" rx="4" fill="${c}" opacity="${active ? 1 : 0.35}"/>`;
      cells += `<text x="${(x + cellW / 2).toFixed(1)}" y="${active ? 18 : 23}" text-anchor="middle" font-size="${active ? 13 : 11}" font-weight="${active ? 800 : 500}" fill="${active ? '#fff' : PALETTE.inkSecondary}">${g}</text>`;
    }
    const labels = `<text x="2" y="48" font-size="10" fill="${PALETTE.inkMuted}">最高水準</text><text x="${width - 2}" y="48" text-anchor="end" font-size="10" fill="${PALETTE.inkMuted}">リスクが高い</text>`;
    return svgWrap(width, height, cells + labels, width, height);
  }

  return { PALETTE, compact, columnChart, groupedBarChart, lineChart, stackedBarRow, meter, gradeMeter };
})();

if (typeof module !== 'undefined') module.exports = Viz;
