import path from "node:path";
import fs from "node:fs";
import { ask, askJson } from "../lib/claude.mjs";
import { PATHS, articleDir, ensureDir } from "../lib/paths.mjs";
import { loadIdeas, loadPersona, loadPolicy, saveIdeas, writeJson, writeText } from "../lib/store.mjs";

export const help = `
notekit write — ネタ台帳から記事本文を生成する

  --id <ideaId>      台帳のID（必須）
  --facts <file>     自分の一次情報を書いたテキスト/Markdown（強く推奨）
  --max-tokens <n>   本文生成の出力上限（既定 32000）

出力: data/articles/<id>/article.md, meta.json

--facts を渡さないと、AIは一般論しか書けません。売れる記事にはなりません。
`;

export const PAID_MARKER = "<!-- ここから有料エリア -->";

const META_SCHEMA = {
  type: "object",
  properties: {
    titleCandidates: { type: "array", items: { type: "string" } },
    leadText: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    priceYen: { type: "integer" },
    eyecatchPrompt: { type: "string" },
    salesPitch: { type: "string" },
    xTeaser: { type: "string" },
    missingFacts: { type: "array", items: { type: "string" } },
  },
  required: [
    "titleCandidates",
    "leadText",
    "tags",
    "priceYen",
    "eyecatchPrompt",
    "salesPitch",
    "xTeaser",
    "missingFacts",
  ],
  additionalProperties: false,
};

const SYSTEM_BODY = `あなたは日本語の有料note記事を書くライターです。書き手本人の代筆をします。

絶対のルール:
1. 「一次情報」として与えられていない体験・数字・固有名詞を、あたかも書き手の実体験のように書かない。
   足りない箇所は「【要追記: 〜】」というプレースホルダを本文中に残す。埋めた気になって捏造しない。
2. 効果を保証する表現（必ず・絶対に・確実に・誰でも）を使わない。
3. 統計・調査結果を出すときは出典を明記する。出典が無いなら書かない。
4. 見出し(##)と本文で構成する。冒頭にタイトルのH1は入れない（noteはタイトル欄が別）。
5. 有料ラインの位置に、必ず単独行で次のマーカーを1つだけ入れる: ${PAID_MARKER}
6. 無料部分（マーカーより前）だけを読んでも1本の無料記事として成立する完成度にする。
   ただし「具体的な手順・型・判断基準」は有料部分に置く。
7. 有料部分の最初に、買った人が最初に得る結論を置く。もったいぶらない。
8. 文体ガイドを厳守する。禁止表現は使わない。`;

const SYSTEM_META = `あなたは有料noteの編集者です。記事本文を読んで、販売に必要なメタ情報を作ります。
タイトルは煽らず、読者の検索語と悩みの言葉を使います。missingFacts には、本文に残っている
【要追記】プレースホルダと、書き手が埋めるべき情報を具体的に列挙します。`;

function countChars(text) {
  return text.replace(/\s/g, "").length;
}

export async function run(args) {
  const id = args.id;
  if (!id) throw new Error("--id が必要です。`notekit status` でIDを確認してください。");

  const policy = loadPolicy();
  const persona = loadPersona();
  const store = loadIdeas();
  const idea = store.ideas.find((item) => item.id === id);
  if (!idea) throw new Error(`ID '${id}' が data/ideas.json にありません。`);

  let facts = "";
  if (args.facts) {
    const factsPath = path.resolve(process.cwd(), args.facts);
    if (!fs.existsSync(factsPath)) throw new Error(`--facts のファイルが見つかりません: ${factsPath}`);
    facts = fs.readFileSync(factsPath, "utf8");
  } else {
    console.log(
      "⚠️  --facts が未指定です。一次情報が無いと一般論の記事になり、有料では売れません。",
    );
    console.log("   本文には【要追記】プレースホルダが多く残ります。\n");
  }

  const isPaid = idea.kind !== "free";
  const targetChars = Math.round(
    (policy.article.totalCharsMin + policy.article.totalCharsMax) / 2,
  );

  const bodyPrompt = `# 書き手のプロフィールと文体ガイド
${persona}

# 書き手の一次情報（この範囲の事実だけを実体験として書いてよい）
${facts.trim() || "（提供なし。実体験の記述は一切せず、必要な箇所はすべて【要追記: 〜】にすること）"}

# 記事の企画
${JSON.stringify(
  {
    title: idea.title,
    hook: idea.hook,
    reader: idea.reader,
    pain: idea.pain,
    promise: idea.promise,
    whyPaid: idea.whyPaid,
    outline: idea.outline,
    paidLineAt: idea.paidLineAt,
    priceYen: idea.priceYen,
  },
  null,
  2,
)}

# 依頼
上記の企画で、note公開用の本文をMarkdownで書いてください。

- 目標文字数: ${targetChars}字前後（${policy.article.totalCharsMin}〜${policy.article.totalCharsMax}字）
- 見出しは ${policy.article.headingsMin} 個以上
- 具体例・具体的な手順を最低 ${policy.article.concreteExamplesMin} 箇所
${
  isPaid
    ? `- 有料ラインは「${idea.paidLineAt}」の直前。無料部分は全体の約${Math.round(policy.article.freeSectionRatio * 100)}%。`
    : "- 無料記事です。マーカーは本文末尾の直前に置き、有料エリアには次に読むべき有料記事への自然な導線だけを短く書いてください。"
}
- 出力はMarkdown本文のみ。前置きや説明文は不要。`;

  console.log(`✍️  「${idea.title}」を執筆中...（数分かかります）`);
  const { text: body } = await ask({
    system: SYSTEM_BODY,
    prompt: bodyPrompt,
    maxTokens: Number(args["max-tokens"] ?? 32000),
    command: "write",
  });

  if (!body.includes(PAID_MARKER)) {
    console.log("⚠️  有料マーカーが本文に見つかりません。手動で位置を決める必要があります。");
  }

  console.log("🏷  メタ情報を生成中...");
  const { data: meta } = await askJson({
    system: SYSTEM_META,
    prompt: `# 文体ガイド
${persona}

# 企画
${JSON.stringify({ title: idea.title, reader: idea.reader, priceYen: idea.priceYen }, null, 2)}

# 本文
${body}

# 依頼
- titleCandidates: タイトル案3本（32字以内、読者の検索語を含む）
- leadText: note冒頭に置く導入2〜3文
- tags: noteのハッシュタグ5個（#は付けない）
- priceYen: 本文の情報量から見た妥当な価格（${policy.price.min}〜${policy.price.max}円、無料記事なら0）
- eyecatchPrompt: 見出し画像を作るための指示文（日本語。Canva/画像生成AIにそのまま渡せる粒度）
- salesPitch: 有料部分の価値を説明する3〜4文（誇張禁止）
- xTeaser: Xで告知するときの1投稿（130字以内、ハッシュタグ・URLは含めない）
- missingFacts: 本文に残る【要追記】と、書き手が埋めるべき情報の一覧`,
    schema: META_SCHEMA,
    maxTokens: 8000,
    command: "write:meta",
  });

  const dir = ensureDir(articleDir(id));
  const bodyPath = path.join(dir, "article.md");
  writeText(bodyPath, body);

  const [free, paid] = body.split(PAID_MARKER);
  const stats = {
    totalChars: countChars(body),
    freeChars: countChars(free ?? ""),
    paidChars: countChars(paid ?? ""),
    headings: (body.match(/^##\s/gm) ?? []).length,
    placeholders: (body.match(/【要追記/g) ?? []).length,
    hasPaidMarker: body.includes(PAID_MARKER),
  };
  stats.freeRatio = stats.totalChars ? Number((stats.freeChars / stats.totalChars).toFixed(3)) : 0;

  writeJson(path.join(dir, "meta.json"), {
    id,
    ideaTitle: idea.title,
    kind: idea.kind,
    generatedAt: new Date().toISOString(),
    factsFile: args.facts ?? null,
    stats,
    ...meta,
  });

  idea.status = "drafted";
  idea.draftedAt = new Date().toISOString();
  saveIdeas(store);

  console.log(`\n✅ ${path.relative(PATHS.root, bodyPath)}`);
  console.log(
    `   ${stats.totalChars}字（無料 ${stats.freeChars}字 / ${Math.round(stats.freeRatio * 100)}%）・見出し${stats.headings}個`,
  );
  if (stats.placeholders > 0) {
    console.log(`\n⚠️  【要追記】が ${stats.placeholders} 箇所あります。ここは必ず自分で埋めてください:`);
    for (const item of meta.missingFacts.slice(0, 8)) console.log(`   - ${item}`);
  }
  console.log(`\n次: node bin/notekit.mjs review --id ${id}`);
}
