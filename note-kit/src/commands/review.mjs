import path from "node:path";
import fs from "node:fs";
import { askJson } from "../lib/claude.mjs";
import { PATHS, articleDir } from "../lib/paths.mjs";
import {
  loadIdeas,
  loadPersona,
  loadPolicy,
  readJson,
  saveIdeas,
  readText,
  writeJson,
} from "../lib/store.mjs";
import { PAID_MARKER } from "./write.mjs";

export const help = `
notekit review — 記事を機械チェック＋AI採点して、公開可否を判定する

  --id <ideaId>   記事ID（必須）

出力: data/articles/<id>/review.json
不合格なら review.json の修正指示を見て自分で直し、再度 review を実行する。
`;

const SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: {
        specificity: { type: "integer" },
        actionability: { type: "integer" },
        readability: { type: "integer" },
        paidValue: { type: "integer" },
        trustworthiness: { type: "integer" },
      },
      required: [
        "specificity",
        "actionability",
        "readability",
        "paidValue",
        "trustworthiness",
      ],
      additionalProperties: false,
    },
    totalScore: { type: "integer" },
    verdict: { type: "string", enum: ["publish", "revise", "scrap"] },
    strengths: { type: "array", items: { type: "string" } },
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          where: { type: "string" },
          issue: { type: "string" },
          fix: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["where", "issue", "fix", "severity"],
        additionalProperties: false,
      },
    },
    refundRisk: { type: "string" },
    paidLineOpinion: { type: "string" },
  },
  required: [
    "scores",
    "totalScore",
    "verdict",
    "strengths",
    "problems",
    "refundRisk",
    "paidLineOpinion",
  ],
  additionalProperties: false,
};

const SYSTEM = `あなたは有料noteを買う側の目線を持つ厳しい編集者です。
「500円払って読み終えた読者が、損をしたと感じないか」だけを基準に採点します。

採点軸（各0-20点、合計100点）:
- specificity: 具体性。固有名詞・数字・実際の場面があるか。一般論だけなら5点以下。
- actionability: 読了直後に手が動くか。手順・型・チェックリストの有無。
- readability: スマホでの読みやすさ。一文の長さ、改行、見出しの機能。
- paidValue: 有料部分が無料部分より明確に価値が高いか。無料部分で完結していたら10点以下。
- trustworthiness: 根拠のない断定、出典のない数字、捏造された体験がないか。1つでもあれば10点以下。

verdict の基準: 80点以上=publish / 50-79=revise / 50未満=scrap。
problems は必ず「どこを」「どう直すか」まで書く。抽象的な指摘は書かない。`;

/** ルールベースの機械チェック（AIに聞くまでもない項目） */
export function mechanicalChecks(body, meta, policy) {
  const strip = (text) => text.replace(/\s/g, "").length;
  const [free, paid] = body.split(PAID_MARKER);
  const issues = [];

  const totalChars = strip(body);
  if (totalChars < policy.article.totalCharsMin) {
    issues.push({
      level: "error",
      message: `本文が短すぎます（${totalChars}字 / 最低${policy.article.totalCharsMin}字）`,
    });
  }
  if (totalChars > policy.article.totalCharsMax) {
    issues.push({
      level: "warn",
      message: `本文が長すぎます（${totalChars}字 / 上限${policy.article.totalCharsMax}字）。読者は最後まで読みません`,
    });
  }

  const headings = (body.match(/^##\s/gm) ?? []).length;
  if (headings < policy.article.headingsMin) {
    issues.push({
      level: "error",
      message: `見出しが少なすぎます（${headings}個 / 最低${policy.article.headingsMin}個）`,
    });
  }

  if (!body.includes(PAID_MARKER)) {
    issues.push({ level: "error", message: "有料ラインのマーカーがありません" });
  } else if (meta?.priceYen > 0) {
    const freeRatio = totalChars ? strip(free) / totalChars : 0;
    const target = policy.article.freeSectionRatio;
    if (freeRatio < target - 0.15) {
      issues.push({
        level: "warn",
        message: `無料部分が薄すぎます（${Math.round(freeRatio * 100)}% / 目安${Math.round(target * 100)}%）。読者が価値を判断できず買われません`,
      });
    }
    if (freeRatio > target + 0.2) {
      issues.push({
        level: "warn",
        message: `無料部分が多すぎます（${Math.round(freeRatio * 100)}%）。無料で満足されて買われません`,
      });
    }
    if (strip(paid ?? "") < 800) {
      issues.push({ level: "error", message: "有料部分が薄すぎます（800字未満）。返金リスクが高い" });
    }
  }

  const placeholders = body.match(/【要追記[^】]*】/g) ?? [];
  if (placeholders.length) {
    issues.push({
      level: "error",
      message: `【要追記】が${placeholders.length}箇所残っています。公開前に必ず自分で埋めてください`,
    });
  }

  const risky = policy.riskyPhrases.filter((phrase) => body.includes(phrase));
  if (risky.length) {
    issues.push({
      level: policy.qualityGate.blockOnRiskyClaims ? "error" : "warn",
      message: `法令・規約リスクのある断定表現: ${risky.join(" / ")}`,
    });
  }

  const banned = ["いかがでしたか", "ではないでしょうか", "と言えるでしょう"];
  const bannedHits = banned.filter((phrase) => body.includes(phrase));
  if (bannedHits.length) {
    issues.push({ level: "warn", message: `禁止表現: ${bannedHits.join(" / ")}` });
  }

  return {
    totalChars,
    freeChars: strip(free ?? ""),
    paidChars: strip(paid ?? ""),
    headings,
    placeholders: placeholders.length,
    riskyPhrases: risky,
    issues,
  };
}

export async function run(args) {
  const id = args.id;
  if (!id) throw new Error("--id が必要です。");

  const dir = articleDir(id);
  const bodyPath = path.join(dir, "article.md");
  if (!fs.existsSync(bodyPath)) {
    throw new Error(`${bodyPath} がありません。先に \`notekit write --id ${id}\` を実行してください。`);
  }

  const policy = loadPolicy();
  const persona = loadPersona();
  const body = readText(bodyPath);
  const meta = readJson(path.join(dir, "meta.json"), {});

  console.log("🔧 機械チェック中...");
  const mech = mechanicalChecks(body, meta, policy);
  for (const issue of mech.issues) {
    console.log(`   ${issue.level === "error" ? "❌" : "⚠️ "} ${issue.message}`);
  }
  if (mech.issues.length === 0) console.log("   問題なし");

  console.log("\n🧑‍⚖️ AI採点中...");
  const { data: judged } = await askJson({
    system: SYSTEM,
    prompt: `# 文体ガイド
${persona}

# 価格
${meta.priceYen ?? "不明"}円

# 機械チェックの結果
${JSON.stringify(mech.issues, null, 2)}

# 本文
${body}

# 依頼
上の基準で採点し、問題点と具体的な直し方を出してください。
paidLineOpinion には「有料ラインを今の位置から動かすべきか、動かすならどの見出しの前か」を書いてください。
refundRisk には「購入者が返金を求めるとしたらどの部分が理由になるか」を書いてください。`,
    schema: SCHEMA,
    maxTokens: 12000,
    command: "review",
  });

  const hasBlockingError = mech.issues.some((issue) => issue.level === "error");
  const passed = judged.totalScore >= policy.qualityGate.passScore && !hasBlockingError;

  const review = {
    id,
    reviewedAt: new Date().toISOString(),
    mechanical: mech,
    ai: judged,
    passed,
    passScore: policy.qualityGate.passScore,
  };
  writeJson(path.join(dir, "review.json"), review);

  const store = loadIdeas();
  const idea = store.ideas.find((item) => item.id === id);
  if (idea) {
    idea.status = passed ? "ready" : "needs-fix";
    idea.reviewScore = judged.totalScore;
    saveIdeas(store);
  }

  console.log(`\n── 採点結果 ──`);
  for (const [key, value] of Object.entries(judged.scores)) {
    console.log(`   ${key.padEnd(16)} ${value}/20`);
  }
  console.log(`   ${"合計".padEnd(16)} ${judged.totalScore}/100  → ${judged.verdict}`);
  console.log(`\n${passed ? "✅ 公開可（機械チェックも通過）" : "❌ 要修正"}`);

  if (judged.problems.length) {
    console.log("\n直すべき点:");
    for (const problem of judged.problems.filter((p) => p.severity !== "low")) {
      console.log(`  [${problem.severity}] ${problem.where}`);
      console.log(`      問題: ${problem.issue}`);
      console.log(`      修正: ${problem.fix}`);
    }
  }
  console.log(`\n有料ラインについて: ${judged.paidLineOpinion}`);
  console.log(`返金リスク: ${judged.refundRisk}`);
  console.log(`\n詳細: ${path.relative(PATHS.root, path.join(dir, "review.json"))}`);
  if (passed) console.log(`次: node bin/notekit.mjs x --id ${id}`);
}
