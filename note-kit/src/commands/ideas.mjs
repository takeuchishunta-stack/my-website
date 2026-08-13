import { askJson } from "../lib/claude.mjs";
import { PATHS } from "../lib/paths.mjs";
import {
  loadIdeas,
  loadNiches,
  loadPersona,
  loadPolicy,
  readJson,
  saveIdeas,
  slugify,
  todayStamp,
} from "../lib/store.mjs";

export const help = `
notekit ideas — 読者が金を払う理由がある記事ネタを台帳に追加する

  --niche <id>    ジャンルID（省略時は data/niches-scored.json の推奨を使用）
  --count <n>     生成数（既定 12）
  --free          無料記事（集客用）のネタとして生成する

出力: data/ideas.json
`;

const SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          hook: { type: "string" },
          reader: { type: "string" },
          pain: { type: "string" },
          promise: { type: "string" },
          whyPaid: { type: "string" },
          outline: { type: "array", items: { type: "string" } },
          paidLineAt: { type: "string" },
          priceYen: { type: "integer" },
          keywords: { type: "array", items: { type: "string" } },
          requiredFacts: { type: "array", items: { type: "string" } },
          demandScore: { type: "integer" },
          differentiationScore: { type: "integer" },
        },
        required: [
          "title",
          "hook",
          "reader",
          "pain",
          "promise",
          "whyPaid",
          "outline",
          "paidLineAt",
          "priceYen",
          "keywords",
          "requiredFacts",
          "demandScore",
          "differentiationScore",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};

const SYSTEM = `あなたは有料note専門の編集者です。「読者が財布を開く理由がある企画」だけを出します。

必ず守る基準:
- 検索で無料で手に入る一般論は企画にしない。有料の価値は「手順・型・判断基準・失敗の回避」にある。
- 1企画=1つの具体的な場面。「〇〇のすべて」のような総覧型は売れないので出さない。
- タイトルは読者の言葉で書く。煽り・釣り（「衝撃の」「9割が知らない」）は禁止。
- whyPaid には「なぜ無料部分だけでは足りないのか」を書く。ここが弱い企画は出さない。
- requiredFacts には「この記事を書くために書き手が持っている必要がある一次情報」を列挙する。
  書き手が持っていなさそうなら、その企画は出さない。捏造で埋められる企画を作らないこと。
- demandScore / differentiationScore は各0-10。`;

export async function run(args) {
  const policy = loadPolicy();
  const niches = loadNiches();
  const persona = loadPersona();
  const store = loadIdeas();
  const count = Number(args.count ?? 12);
  const isFree = Boolean(args.free);

  const scored = readJson(PATHS.nicheScores);
  const nicheId = args.niche ?? scored?.recommendation?.nicheId;
  if (!nicheId) {
    throw new Error(
      "ジャンルが決まっていません。--niche <id> を指定するか、先に `notekit niche` を実行してください。",
    );
  }
  const niche = niches.candidates.find((c) => c.id === nicheId) ?? {
    id: nicheId,
    label: nicheId,
    keywords: [],
  };

  const market = readJson(PATHS.market, { summaries: [] });
  const relevant = market.summaries
    .filter((s) => s.nicheId === nicheId || niche.keywords.includes(s.query))
    .map((s) => ({
      query: s.query,
      paidRatio: s.paidRatio,
      priceMedian: s.priceMedian,
      likeMedian: s.likeMedian,
      topPaidNotes: s.topPaidNotes.slice(0, 6),
      topFreeNotes: s.topFreeNotes.slice(0, 6),
    }));

  const existingTitles = store.ideas.map((idea) => idea.title);

  const prompt = `# 書き手のプロフィールと文体ガイド
${persona}

# 対象ジャンル
${JSON.stringify(niche, null, 2)}

# noteの実測データ（このジャンル）
${relevant.length ? JSON.stringify(relevant, null, 2) : "（データなし。一般的な判断で補うこと。その旨を hook に書かない）"}

# 既存の企画（重複させないこと）
${existingTitles.length ? existingTitles.map((t) => `- ${t}`).join("\n") : "（まだ無し）"}

# 依頼
${isFree ? "**無料記事（集客用）**" : "**有料記事（販売用）**"}の企画を${count}本出してください。

制約:
- 価格は ${policy.price.min}〜${policy.price.max}円の範囲。基本は ${policy.price.default}円。${isFree ? "無料記事の場合 priceYen は 0 にする。" : ""}
- outline は 6〜10 個の見出し。paidLineAt には「どの見出しの直前で有料ラインを引くか」を見出し名で書く。${isFree ? "無料記事なので paidLineAt は '（無料記事）' とする。" : ""}
- 上位記事と同じ切り口をなぞらない。データにある上位記事が扱っていない角度を意図的に探す。
- ${isFree ? "無料記事は「有料記事への導線」になる設計にする。ただし宣伝臭を出さない。" : ""}`;

  console.log(`💡 ${niche.label} のネタを${count}本生成しています...`);
  const { data } = await askJson({
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    maxTokens: 20000,
    command: "ideas",
  });

  const stamp = todayStamp();
  let added = 0;
  const normalizedExisting = new Set(
    existingTitles.map((t) => t.replace(/\s+/g, "").toLowerCase()),
  );

  for (const idea of data.ideas) {
    const normalized = idea.title.replace(/\s+/g, "").toLowerCase();
    if (normalizedExisting.has(normalized)) continue;
    normalizedExisting.add(normalized);
    store.ideas.push({
      id: `${stamp}-${slugify(idea.title, 28)}`,
      nicheId,
      kind: isFree ? "free" : "paid",
      status: "idea",
      createdAt: new Date().toISOString(),
      ...idea,
      priceYen: isFree ? 0 : idea.priceYen,
    });
    added += 1;
  }

  saveIdeas(store);

  const ranked = [...store.ideas]
    .filter((idea) => idea.status === "idea")
    .sort(
      (a, b) =>
        b.demandScore + b.differentiationScore - (a.demandScore + a.differentiationScore),
    )
    .slice(0, 10);

  console.log(`\n✅ ${added}本を追加（台帳合計 ${store.ideas.length}本）`);
  console.log("\n書く価値が高い順:");
  for (const idea of ranked) {
    console.log(
      `  [${idea.demandScore + idea.differentiationScore}/20] ${idea.title}\n        id: ${idea.id}`,
    );
  }
  console.log(`\n次: node bin/notekit.mjs write --id ${ranked[0]?.id ?? "<id>"} --facts my-facts.md`);
}
