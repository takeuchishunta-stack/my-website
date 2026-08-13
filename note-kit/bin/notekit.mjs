#!/usr/bin/env node
import { loadEnv, requireApiKey } from "../src/lib/env.mjs";
import { parseArgs } from "../src/lib/args.mjs";

loadEnv();

const COMMANDS = {
  research: () => import("../src/commands/research.mjs"),
  niche: () => import("../src/commands/niche.mjs"),
  ideas: () => import("../src/commands/ideas.mjs"),
  write: () => import("../src/commands/write.mjs"),
  review: () => import("../src/commands/review.mjs"),
  x: () => import("../src/commands/xposts.mjs"),
  plan: () => import("../src/commands/plan.mjs"),
  status: () => import("../src/commands/status.mjs"),
};

// APIキーが不要なコマンド
const NO_API_KEY = new Set(["research", "plan", "status"]);

function usage() {
  console.log(`
note-kit — note有料記事の量産とX運用のためのCLI

  node bin/notekit.mjs <command> [options]

コマンド:
  research   noteの公開検索から売れ筋データを集める
  niche      リサーチ結果からジャンルを採点し主戦場を決める
  ideas      売れる理由のある記事ネタを台帳に追加する
  write      ネタから記事本文とメタ情報を生成する
  review     機械チェック＋AI採点で公開可否を判定する
  x          X向けの告知・スレッド・日常ポストを生成する
  plan       記事とX投稿の投稿カレンダーを作る
  status     台帳・進捗・API利用量を表示する

各コマンドの詳細:
  node bin/notekit.mjs <command> --help

はじめての流れ:
  1. cp .env.example .env  してAPIキーを設定
  2. config/persona.md を自分の情報で埋める（ここが一番重要）
  3. node bin/notekit.mjs research
  4. node bin/notekit.mjs niche
  5. node bin/notekit.mjs ideas
  6. node bin/notekit.mjs write --id <id> --facts my-facts.md
  7. node bin/notekit.mjs review --id <id>
  8. node bin/notekit.mjs x --id <id>
  9. node bin/notekit.mjs plan
`);
}

async function main() {
  const [, , commandName, ...rest] = process.argv;

  if (!commandName || commandName === "help" || commandName === "--help") {
    usage();
    return;
  }

  const loader = COMMANDS[commandName];
  if (!loader) {
    console.error(`不明なコマンド: ${commandName}\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  const mod = await loader();
  const args = parseArgs(rest);

  if (args.help) {
    console.log(mod.help ?? "（ヘルプ未定義）");
    return;
  }

  if (!NO_API_KEY.has(commandName)) requireApiKey();

  await mod.run(args);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  if (process.env.NOTEKIT_DEBUG) console.error(err.stack);
  process.exitCode = 1;
});
