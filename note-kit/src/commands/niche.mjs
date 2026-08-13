import path from "node:path";
import { askJson } from "../lib/claude.mjs";
import { PATHS } from "../lib/paths.mjs";
import { loadNiches, loadPersona, readJson, writeJson, writeText } from "../lib/store.mjs";

export const help = `
notekit niche — リサーチ結果からジャンル（主戦場）を採点して提案する

  --top <n>   詳細に分析する上位件数（既定 3）

出力: data/niches-scored.json, data/niche-report.md
`;

const SCHEMA = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nicheId: { type: "string" },
          label: { type: "string" },
          totalScore: { type: "integer" },
          scores: {
            type: "object",
            properties: {
              demand: { type: "integer" },
              competition: { type: "integer" },
              monetizability: { type: "integer" },
              authorFit: { type: "integer" },
              xSynergy: { type: "integer" },
            },
            required: ["demand", "competition", "monetizability", "authorFit", "xSynergy"],
            additionalProperties: false,
          },
          evidence: { type: "string" },
          risk: { type: "string" },
          recommendedPriceYen: { type: "integer" },
        },
        required: [
          "nicheId",
          "label",
          "totalScore",
          "scores",
          "evidence",
          "risk",
          "recommendedPriceYen",
        ],
        additionalProperties: false,
      },
    },
    recommendation: {
      type: "object",
      properties: {
        nicheId: { type: "string" },
        reason: { type: "string" },
        positioning: { type: "string" },
        firstThreeArticles: { type: "array", items: { type: "string" } },
        xAccountConcept: { type: "string" },
        whatWouldChangeMyMind: { type: "string" },
      },
      required: [
        "nicheId",
        "reason",
        "positioning",
        "firstThreeArticles",
        "xAccountConcept",
        "whatWouldChangeMyMind",
      ],
      additionalProperties: false,
    },
  },
  required: ["ranked", "recommendation"],
  additionalProperties: false,
};

const SYSTEM = `あなたは日本語のコンテンツ市場に詳しい編集者兼マーケターです。
noteの検索結果の実データだけを根拠に、どのジャンルを主戦場にすべきかを冷静に判定します。

判定の原則:
- 有料記事の件数と価格帯は「その市場で人がお金を払う習慣があるか」の指標。有料率が低い市場は500円が売れにくい。
- スキの中央値が高いのに有料記事が少ない市場は、需要はあるが誰も有料化していない=狙い目の可能性。
- 上位に強いアカウントが並ぶ市場は、無名の新規参入では埋もれる。競合スコアは低くつける。
- 書き手の一次情報が無いジャンルは、どれだけ市場が良くても authorFit を低くする。中身が薄い記事は返金・低評価につながり、長期的に損。
- 各スコアは0-20点、totalScoreは5項目の合計(0-100)。competitionは「参入しやすいほど高得点」。
- 根拠(evidence)には必ず具体的な数値を引用する。数値が無い推測は書かない。`;

export async function run(args) {
  const market = readJson(PATHS.market);
  if (!market) {
    throw new Error("data/market.json がありません。先に `notekit research` を実行してください。");
  }
  const niches = loadNiches();
  const persona = loadPersona();
  const top = Number(args.top ?? 3);

  const compact = market.summaries.map((s) => ({
    nicheId: s.nicheId,
    query: s.query,
    totalHits: s.totalHits,
    sampled: s.sampled,
    paidCount: s.paidCount,
    paidRatio: s.paidRatio,
    priceMedian: s.priceMedian,
    priceBuckets: s.priceBuckets,
    likeMedian: s.likeMedian,
    topPaidNotes: s.topPaidNotes.slice(0, 5),
    topFreeNotes: s.topFreeNotes.slice(0, 5),
    topAuthors: s.topAuthors.slice(0, 3).map((a) => ({
      author: a.author,
      followerCount: a.followerCount,
      likeSum: a.likeSum,
    })),
  }));

  const prompt = `# 書き手のプロフィールと文体ガイド
${persona}

# ジャンル候補（config/niches.json）
${JSON.stringify(niches.candidates, null, 2)}

# noteの実測データ（キーワード単位）
${JSON.stringify(compact, null, 2)}

# 依頼
1. 候補ジャンルごとに5項目を採点し、totalScore降順で ranked に並べる。
2. 最も推奨する1つを recommendation にまとめる。
   - positioning は「誰の、どんな場面の、何を解決する発信か」を1文で。
   - firstThreeArticles は最初に書くべき記事タイトル3本（1本目は無料想定、2〜3本目は有料想定）。
   - xAccountConcept はXのプロフィール文の骨子（140字以内の日本語）。
   - whatWouldChangeMyMind は「この判断が覆るとしたらどんな観測をしたときか」を具体的に。
3. データが不足していて判断できない項目があれば、evidence の中で正直にそう書く。`;

  console.log("🧭 ジャンルを採点しています...");
  const { data } = await askJson({
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    maxTokens: 16000,
    command: "niche",
  });

  writeJson(PATHS.nicheScores, { updatedAt: new Date().toISOString(), ...data });

  const lines = [
    "# ジャンル診断レポート",
    "",
    `生成日時: ${new Date().toLocaleString("ja-JP")}`,
    `データ元: ${market.keywordCount}キーワード / 取得日時 ${market.updatedAt}`,
    "",
    "## 総合ランキング",
    "",
    "| 順位 | ジャンル | 合計 | 需要 | 参入しやすさ | 収益化 | 自分との相性 | X相性 | 推奨価格 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...data.ranked.map(
      (r, i) =>
        `| ${i + 1} | ${r.label} | **${r.totalScore}** | ${r.scores.demand} | ${r.scores.competition} | ${r.scores.monetizability} | ${r.scores.authorFit} | ${r.scores.xSynergy} | ${r.recommendedPriceYen}円 |`,
    ),
    "",
    "## 各ジャンルの根拠",
    "",
    ...data.ranked.slice(0, top).flatMap((r) => [
      `### ${r.label}（${r.totalScore}点）`,
      "",
      `**根拠**: ${r.evidence}`,
      "",
      `**リスク**: ${r.risk}`,
      "",
    ]),
    "## 推奨",
    "",
    `**主戦場: ${data.recommendation.nicheId}**`,
    "",
    `${data.recommendation.reason}`,
    "",
    `### ポジショニング`,
    "",
    data.recommendation.positioning,
    "",
    "### 最初の3本",
    "",
    ...data.recommendation.firstThreeArticles.map((t, i) => `${i + 1}. ${t}`),
    "",
    "### Xアカウントのコンセプト",
    "",
    data.recommendation.xAccountConcept,
    "",
    "### この判断が覆る条件",
    "",
    data.recommendation.whatWouldChangeMyMind,
    "",
  ];

  writeText(PATHS.nicheReport, lines.join("\n"));

  console.log(`\n✅ ${path.relative(PATHS.root, PATHS.nicheReport)} を出力しました`);
  console.log(`\n推奨ジャンル: ${data.recommendation.nicheId}`);
  console.log(`ポジショニング: ${data.recommendation.positioning}`);
  console.log(`\n次: node bin/notekit.mjs ideas --niche ${data.recommendation.nicheId}`);
}
