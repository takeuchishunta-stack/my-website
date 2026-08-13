import path from "node:path";
import { searchNotesPaged, summarize } from "../lib/note.mjs";
import { PATHS, ensureDir } from "../lib/paths.mjs";
import { loadNiches, readJson, writeJson, slugify } from "../lib/store.mjs";

export const help = `
notekit research — noteの公開検索から「何が有料で売れているか」を集める

  --niche <id>       config/niches.json の候補IDに絞る（省略時は全候補）
  --keyword <kw>     キーワードを直接指定（カンマ区切りで複数可）
  --pages <n>        1キーワードあたりの取得ページ数（既定 2 = 最大40件）
  --sort <popular|new>  既定 popular
  --keep-raw         生レスポンスを data/research/raw/ に保存

例: node bin/notekit.mjs research --niche athlete-career --pages 3
`;

export async function run(args) {
  const niches = loadNiches();
  const pages = Number(args.pages ?? 2);
  const sort = args.sort ?? "popular";

  let keywords = [];
  if (args.keyword) {
    keywords = String(args.keyword)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  } else {
    const targets = args.niche
      ? niches.candidates.filter((c) => c.id === args.niche)
      : niches.candidates;
    if (targets.length === 0) {
      throw new Error(`候補ジャンル '${args.niche}' が config/niches.json にありません。`);
    }
    keywords = targets.flatMap((c) => c.keywords.map((k) => ({ keyword: k, nicheId: c.id })));
  }

  const normalized = keywords.map((k) =>
    typeof k === "string" ? { keyword: k, nicheId: args.niche ?? "adhoc" } : k,
  );

  ensureDir(PATHS.research);
  if (args["keep-raw"]) ensureDir(PATHS.researchRaw);

  const intervalMs = Number(process.env.NOTEKIT_RATE_LIMIT_MS || 1500);
  console.log(`🔎 ${normalized.length}キーワードを調査します（${pages}ページ / sort=${sort}）`);
  console.log(
    `   note側に負荷をかけないよう${intervalMs}ms間隔で取得します。少し時間がかかります。\n`,
  );

  const summaries = [];
  const failures = [];

  for (const [index, { keyword, nicheId }] of normalized.entries()) {
    process.stdout.write(`  [${index + 1}/${normalized.length}] ${keyword} ... `);
    try {
      const result = await searchNotesPaged(keyword, { pages, sort });
      const summary = { nicheId, ...summarize(result) };
      summaries.push(summary);
      writeJson(path.join(PATHS.research, `${slugify(keyword)}.json`), summary);
      if (args["keep-raw"]) {
        writeJson(path.join(PATHS.researchRaw, `${slugify(keyword)}.json`), result.raw);
      }
      console.log(
        `${summary.sampled}件 / 有料${summary.paidCount}件 (${Math.round(summary.paidRatio * 100)}%) / 中央値${summary.priceMedian}円`,
      );
    } catch (err) {
      failures.push({ keyword, error: err.message });
      console.log(`失敗: ${err.message}`);
    }
  }

  if (summaries.length === 0) {
    throw new Error(
      [
        "1件も取得できませんでした。考えられる原因:",
        "  1. ネットワーク（社内プロキシ・VPN・オフライン）",
        "  2. note側のレスポンス構造の変更 → --keep-raw を付けて data/research/raw/ を確認",
        "  3. アクセス制限 → 時間を置いて再実行",
        failures.length ? `\n最初のエラー: ${failures[0].error}` : "",
      ].join("\n"),
    );
  }

  const previous = readJson(PATHS.market, { history: [] });
  const market = {
    updatedAt: new Date().toISOString(),
    sort,
    pages,
    keywordCount: summaries.length,
    summaries,
    failures,
    history: [
      ...(previous.history ?? []).slice(-9),
      { at: new Date().toISOString(), keywordCount: summaries.length },
    ],
  };
  writeJson(PATHS.market, market);

  console.log(`\n✅ ${summaries.length}件を集計 → ${path.relative(PATHS.root, PATHS.market)}`);
  if (failures.length) console.log(`⚠️  ${failures.length}キーワードが失敗しました。`);
  console.log("\n次: node bin/notekit.mjs niche");
}
