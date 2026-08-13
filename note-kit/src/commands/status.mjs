import fs from "node:fs";
import path from "node:path";
import { PATHS, articleDir } from "../lib/paths.mjs";
import { loadIdeas, readJson } from "../lib/store.mjs";

export const help = `
notekit status — 台帳と進捗、API利用量を表示する

  --all         全件表示（既定は各ステータス上位10件）
`;

// 参考価格（USD / 100万トークン）。実際の請求は console.anthropic.com で確認すること。
const PRICING = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const STATUS_LABEL = {
  idea: "ネタのみ",
  drafted: "下書き済み",
  "needs-fix": "要修正",
  ready: "校了（公開可）",
  published: "公開済み",
};

export async function run(args) {
  const store = loadIdeas();
  const limit = args.all ? Infinity : 10;

  const market = readJson(PATHS.market);
  const scored = readJson(PATHS.nicheScores);

  console.log("── 設定 ──");
  console.log(`  モデル       : ${process.env.NOTEKIT_MODEL || "claude-opus-5"}`);
  console.log(`  APIキー      : ${process.env.ANTHROPIC_API_KEY ? "設定済み" : "❌ 未設定"}`);
  console.log(
    `  リサーチ     : ${market ? `${market.keywordCount}キーワード（${market.updatedAt.slice(0, 10)}）` : "未実施"}`,
  );
  console.log(`  主戦場       : ${scored?.recommendation?.nicheId ?? "未決定"}`);

  console.log("\n── 記事台帳 ──");
  if (store.ideas.length === 0) {
    console.log("  まだネタがありません → node bin/notekit.mjs ideas");
  }

  const byStatus = new Map();
  for (const idea of store.ideas) {
    const list = byStatus.get(idea.status) ?? [];
    list.push(idea);
    byStatus.set(idea.status, list);
  }

  for (const status of ["ready", "needs-fix", "drafted", "idea", "published"]) {
    const list = byStatus.get(status);
    if (!list?.length) continue;
    console.log(`\n  【${STATUS_LABEL[status] ?? status}】${list.length}本`);
    const sorted = [...list].sort(
      (a, b) =>
        (b.demandScore ?? 0) + (b.differentiationScore ?? 0) -
        ((a.demandScore ?? 0) + (a.differentiationScore ?? 0)),
    );
    for (const idea of sorted.slice(0, limit)) {
      const score = idea.reviewScore ? ` 採点${idea.reviewScore}` : "";
      const price = idea.priceYen ? `${idea.priceYen}円` : "無料";
      const hasX = fs.existsSync(path.join(PATHS.x, `${idea.id}.md`)) ? " X✓" : "";
      console.log(`    ${idea.id}`);
      console.log(`      ${idea.title} (${price}${score}${hasX})`);
    }
    if (sorted.length > limit) console.log(`    ... 他 ${sorted.length - limit}本（--all で全表示）`);
  }

  const articleCount = fs.existsSync(PATHS.articles)
    ? fs.readdirSync(PATHS.articles).filter((name) =>
        fs.existsSync(path.join(articleDir(name), "article.md")),
      ).length
    : 0;
  console.log(`\n  生成済み本文: ${articleCount}本`);

  const usage = readJson(PATHS.usage, { entries: [] });
  if (usage.entries.length) {
    let cost = 0;
    let input = 0;
    let output = 0;
    for (const entry of usage.entries) {
      const price = PRICING[entry.model] ?? PRICING["claude-opus-5"];
      input += entry.input_tokens + entry.cache_read_input_tokens;
      output += entry.output_tokens;
      cost +=
        (entry.input_tokens / 1_000_000) * price.input +
        (entry.cache_read_input_tokens / 1_000_000) * price.input * 0.1 +
        (entry.output_tokens / 1_000_000) * price.output;
    }
    console.log("\n── API利用量（累計・概算）──");
    console.log(`  呼び出し   : ${usage.entries.length}回`);
    console.log(`  入力トークン: ${input.toLocaleString()}`);
    console.log(`  出力トークン: ${output.toLocaleString()}`);
    console.log(`  概算コスト  : $${cost.toFixed(2)}（正確な金額は Anthropic Console で確認）`);
  }
}
