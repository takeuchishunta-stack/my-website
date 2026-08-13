import path from "node:path";
import fs from "node:fs";
import { askJson } from "../lib/claude.mjs";
import { PATHS, articleDir, ensureDir } from "../lib/paths.mjs";
import { loadPersona, readJson, readText, writeJson, writeText } from "../lib/store.mjs";

export const help = `
notekit x — X（旧Twitter）の投稿文を生成する

  --id <ideaId>   記事に紐づく告知セット（記事1本分の一式）
  --daily <n>     記事に紐づかない日常運用ポストを n 本生成（既定 10）
  --profile       プロフィール文・固定ポスト案を生成

出力: data/x/<id>.md, data/x/daily-<日付>.md, data/x/profile.md

Xは投稿の自動化に規約上の制限があります。本ツールは文面の生成までを行い、
投稿は手動（またはX公式の予約投稿機能）で行う前提です。
`;

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    announcePosts: { type: "array", items: { type: "string" } },
    thread: { type: "array", items: { type: "string" } },
    threadClosing: { type: "string" },
    quotePost: { type: "string" },
    replyBait: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    repostVariations: { type: "array", items: { type: "string" } },
  },
  required: [
    "announcePosts",
    "thread",
    "threadClosing",
    "quotePost",
    "replyBait",
    "hashtags",
    "repostVariations",
  ],
  additionalProperties: false,
};

const DAILY_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["気づき", "失敗談", "手順", "問いかけ", "反論", "数字", "観察"],
          },
          text: { type: "string" },
          why: { type: "string" },
        },
        required: ["type", "text", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
};

const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    displayName: { type: "string" },
    bio: { type: "string" },
    pinnedPost: { type: "string" },
    firstWeekPlan: { type: "array", items: { type: "string" } },
    accountsToEngage: { type: "array", items: { type: "string" } },
  },
  required: ["displayName", "bio", "pinnedPost", "firstWeekPlan", "accountsToEngage"],
  additionalProperties: false,
};

const SYSTEM = `あなたは日本語のX運用に長けた編集者です。読まれて、信頼されて、結果としてnoteが売れる投稿を書きます。

守るルール:
- 1投稿は140字以内（全角換算）。URLは含めない（投稿時に人が付ける）。
- 1行目で止まる。「読んでください」ではなく、読者が自分ごとに感じる具体を1行目に置く。
- 煽らない。「9割が知らない」「衝撃の事実」「知らないと損」は禁止。
- 絵文字は最大1つ。多用しない。
- 記事に書いていないことを投稿に書かない。誇張しない。
- 「有益な情報を発信しています」のような自己言及をしない。
- スレッドは1投稿1論点。前の投稿を要約し直さない。`;

async function articleSet(args) {
  const id = args.id;
  const dir = articleDir(id);
  const bodyPath = path.join(dir, "article.md");
  if (!fs.existsSync(bodyPath)) throw new Error(`${bodyPath} がありません。`);

  const persona = loadPersona();
  const body = readText(bodyPath);
  const meta = readJson(path.join(dir, "meta.json"), {});

  console.log("🐦 記事の告知セットを生成中...");
  const { data } = await askJson({
    system: SYSTEM,
    prompt: `# 文体ガイド
${persona}

# 記事
タイトル案: ${JSON.stringify(meta.titleCandidates ?? [])}
価格: ${meta.priceYen ?? 0}円

# 本文
${body}

# 依頼
1. announcePosts: 告知ポスト2案（切り口を変える。片方は読者の悩みから、片方は書き手の失敗から入る）
2. thread: 記事の中身を無料で出す8投稿のスレッド。最後の1つ手前まで完全に無料で価値を出しきる
3. threadClosing: スレッド最後の投稿。記事への導線。押し付けない
4. quotePost: 数日後に自分の告知ポストを引用リポストするときの文
5. replyBait: リプライで会話が生まれる問いかけ1つ
6. hashtags: 使うべきハッシュタグ3つ（#なし）
7. repostVariations: 1〜2週間後に同じ記事を再告知する文3案（使い回し感を出さない）`,
    schema: ARTICLE_SCHEMA,
    maxTokens: 12000,
    command: "x:article",
  });

  const lines = [
    `# X投稿セット: ${meta.ideaTitle ?? id}`,
    "",
    `生成: ${new Date().toLocaleString("ja-JP")}`,
    "",
    "## 告知ポスト（記事公開と同時）",
    "",
    ...data.announcePosts.flatMap((post, i) => [
      `### 案${i + 1}（${[...post].length}字）`,
      "",
      "```",
      post,
      "```",
      "",
    ]),
    "## スレッド（公開翌日 or 同日夜）",
    "",
    ...data.thread.flatMap((post, i) => [`**${i + 1}/${data.thread.length + 1}**`, "", "```", post, "```", ""]),
    `**${data.thread.length + 1}/${data.thread.length + 1}（導線）**`,
    "",
    "```",
    data.threadClosing,
    "```",
    "",
    "## 引用リポスト（3〜5日後）",
    "",
    "```",
    data.quotePost,
    "```",
    "",
    "## 会話を作る問いかけ",
    "",
    "```",
    data.replyBait,
    "```",
    "",
    "## 再告知（1〜2週間後、順に使う）",
    "",
    ...data.repostVariations.flatMap((post, i) => [`### 再告知${i + 1}`, "", "```", post, "```", ""]),
    "## ハッシュタグ",
    "",
    data.hashtags.map((tag) => `#${tag}`).join(" "),
    "",
  ];

  ensureDir(PATHS.x);
  const out = path.join(PATHS.x, `${id}.md`);
  writeText(out, lines.join("\n"));
  writeJson(path.join(dir, "x-posts.json"), data);
  console.log(`\n✅ ${path.relative(PATHS.root, out)}`);
}

async function dailySet(args) {
  const count = Number(args.daily === true ? 10 : args.daily);
  const persona = loadPersona();
  const scored = readJson(PATHS.nicheScores);
  const ideas = readJson(PATHS.ideas, { ideas: [] });

  console.log(`🐦 日常運用ポストを${count}本生成中...`);
  const { data } = await askJson({
    system: SYSTEM,
    prompt: `# 文体ガイド
${persona}

# 発信ジャンル
${scored?.recommendation?.positioning ?? "（未設定）"}

# 今後書く予定の記事（内容が被らないよう、記事の要約は避ける）
${(ideas.ideas ?? [])
  .slice(-15)
  .map((idea) => `- ${idea.title}`)
  .join("\n")}

# 依頼
記事の宣伝ではない、単体で価値がある投稿を${count}本。
type は 気づき / 失敗談 / 手順 / 問いかけ / 反論 / 数字 / 観察 からバランスよく。
why にはその投稿が伸びると考える理由を1文で。
一次情報が無い内容は書かない（書き手が確実に語れる範囲に限る）。`,
    schema: DAILY_SCHEMA,
    maxTokens: 12000,
    command: "x:daily",
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const lines = [
    `# 日常運用ポスト（${stamp}）`,
    "",
    ...data.posts.flatMap((post, i) => [
      `## ${i + 1}. [${post.type}]（${[...post.text].length}字）`,
      "",
      "```",
      post.text,
      "```",
      "",
      `> ${post.why}`,
      "",
    ]),
  ];

  ensureDir(PATHS.x);
  const out = path.join(PATHS.x, `daily-${stamp}.md`);
  writeText(out, lines.join("\n"));
  console.log(`\n✅ ${path.relative(PATHS.root, out)}`);
}

async function profileSet() {
  const persona = loadPersona();
  const scored = readJson(PATHS.nicheScores);

  console.log("🐦 プロフィール・固定ポストを生成中...");
  const { data } = await askJson({
    system: SYSTEM,
    prompt: `# 文体ガイド
${persona}

# ジャンル診断の結果
${JSON.stringify(scored?.recommendation ?? {}, null, 2)}

# 依頼
- displayName: Xの表示名案（肩書きが一目で分かる。20字以内）
- bio: プロフィール文（160字以内。実績を盛らない。誰の何を助けるかを明示）
- pinnedPost: 固定ポスト（自己紹介 + 発信内容。140字以内）
- firstWeekPlan: 最初の1週間で何をするか、日ごとに7つ
- accountsToEngage: 積極的に絡むべきアカウントの「種類」を5つ（具体的な個人名は挙げない）`,
    schema: PROFILE_SCHEMA,
    maxTokens: 8000,
    command: "x:profile",
  });

  const lines = [
    "# Xアカウント設計",
    "",
    "## 表示名",
    "",
    data.displayName,
    "",
    "## プロフィール文",
    "",
    "```",
    data.bio,
    "```",
    "",
    "## 固定ポスト",
    "",
    "```",
    data.pinnedPost,
    "```",
    "",
    "## 最初の1週間",
    "",
    ...data.firstWeekPlan.map((item, i) => `- Day${i + 1}: ${item}`),
    "",
    "## 絡みに行くアカウントの種類",
    "",
    ...data.accountsToEngage.map((item) => `- ${item}`),
    "",
  ];

  ensureDir(PATHS.x);
  const out = path.join(PATHS.x, "profile.md");
  writeText(out, lines.join("\n"));
  console.log(`\n✅ ${path.relative(PATHS.root, out)}`);
}

export async function run(args) {
  if (args.profile) return profileSet();
  if (args.daily) return dailySet(args);
  if (args.id) return articleSet(args);
  throw new Error("--id / --daily <n> / --profile のいずれかを指定してください。");
}
