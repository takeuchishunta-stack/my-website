import path from "node:path";
import fs from "node:fs";
import { PATHS } from "../lib/paths.mjs";
import { loadIdeas, loadPolicy, writeText } from "../lib/store.mjs";

export const help = `
notekit plan — 記事とX投稿を並べた投稿カレンダーを作る

  --days <n>    生成する日数（既定 14）
  --start <YYYY-MM-DD>  開始日（既定 明日）

出力: data/calendar.md
AIは使いません（台帳とポリシーから機械的に組み立てます）。
`;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function fmt(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function run(args) {
  const policy = loadPolicy();
  const store = loadIdeas();
  const days = Number(args.days ?? 14);
  const start = args.start ? new Date(args.start) : addDays(new Date(), 1);

  const ready = store.ideas.filter((idea) => idea.status === "ready");
  const drafted = store.ideas.filter((idea) => idea.status === "drafted");
  const queued = store.ideas
    .filter((idea) => idea.status === "idea")
    .sort(
      (a, b) =>
        b.demandScore + b.differentiationScore - (a.demandScore + a.differentiationScore),
    );

  // 公開候補: 校了済み → 下書き済み → 未着手 の順
  const pipeline = [...ready, ...drafted, ...queued];

  const perWeek = policy.cadence.articlesPerWeek;
  const publishDayIndexes = new Set();
  const interval = Math.max(1, Math.round(7 / perWeek));
  for (let day = 0; day < days; day += interval) publishDayIndexes.add(day);

  const rows = [];
  let pipelineIndex = 0;

  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(start, offset);
    const label = `${fmt(date)}(${WEEKDAYS[date.getDay()]})`;
    const tasks = [];

    if (publishDayIndexes.has(offset) && pipelineIndex < pipeline.length) {
      const idea = pipeline[pipelineIndex];
      pipelineIndex += 1;
      const hasX = fs.existsSync(path.join(PATHS.x, `${idea.id}.md`));
      const statusMark =
        idea.status === "ready" ? "校了" : idea.status === "drafted" ? "要校正" : "未執筆";
      tasks.push(
        `**📕 note公開**: ${idea.title}（${idea.priceYen || "無料"}${idea.priceYen ? "円" : ""} / ${statusMark}）`,
      );
      tasks.push(
        `**🐦 告知ポスト**: ${hasX ? `data/x/${idea.id}.md の告知案` : `未生成 → \`notekit x --id ${idea.id}\``}`,
      );
      rows.push({ label, tasks, articleId: idea.id, kind: "publish" });
      continue;
    }

    // 公開翌日はスレッド、その他は日常運用
    const previous = rows[rows.length - 1];
    if (previous?.kind === "publish") {
      tasks.push(`**🧵 スレッド投稿**: data/x/${previous.articleId}.md のスレッド8連投`);
    }
    tasks.push(`**🐦 日常ポスト × ${policy.cadence.xPostsPerDay}**: data/x/daily-*.md から`);
    tasks.push("**💬 リプライ**: 同ジャンルのアカウントに3件、内容のあるリプ");
    rows.push({ label, tasks, kind: "engage" });
  }

  const lines = [
    "# 投稿カレンダー",
    "",
    `生成: ${new Date().toLocaleString("ja-JP")} / ${fmt(start)} から${days}日間`,
    `方針: 記事 週${perWeek}本 / 無料:有料 = ${policy.cadence.freeToPaidRatio} / X 1日${policy.cadence.xPostsPerDay}投稿`,
    "",
    "## 在庫状況",
    "",
    `- 校了済み（公開できる）: ${ready.length}本`,
    `- 下書き済み（校正待ち）: ${drafted.length}本`,
    `- ネタのみ（未執筆）: ${queued.length}本`,
    "",
    ready.length + drafted.length < Math.ceil((days / 7) * perWeek)
      ? `> ⚠️ この期間に必要な本数に対して在庫が足りません。\`notekit ideas\` と \`notekit write\` を先に回してください。`
      : "> 在庫は足りています。",
    "",
    "## 日程",
    "",
    ...rows.flatMap((row) => [`### ${row.label}`, "", ...row.tasks.map((task) => `- ${task}`), ""]),
    "## 運用メモ",
    "",
    "- noteには外部からの自動投稿APIがありません。公開はブラウザから手動で行ってください。",
    "- Xの自動投稿は規約・レート制限の対象です。ここで生成した文面を予約投稿するか、手動で投稿してください。",
    `- 1日に${policy.cadence.maxPublishPerDay}本を超える公開はしないでください（スパム判定・アカウント評価の低下を避けるため）。`,
    "- 公開後3日は反応（スキ・購入・流入元）を記録し、次のネタ選定にフィードバックしてください。",
    "",
  ];

  writeText(PATHS.calendar, lines.join("\n"));
  console.log(`✅ ${path.relative(PATHS.root, PATHS.calendar)} を出力しました`);
  console.log(
    `   公開予定 ${rows.filter((r) => r.kind === "publish").length}本 / 在庫 ${pipeline.length}本`,
  );
}
