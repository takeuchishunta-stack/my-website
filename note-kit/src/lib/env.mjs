import fs from "node:fs";
import { PATHS } from "./paths.mjs";

/**
 * .env を読み込む。既に環境変数が設定されている場合はそちらを優先する。
 * 外部依存を増やさないための最小実装（KEY=VALUE / # コメント / 前後空白のみ対応）。
 */
export function loadEnv() {
  if (!fs.existsSync(PATHS.env)) return;
  const text = fs.readFileSync(PATHS.env, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireApiKey() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY が未設定です。note-kit/.env.example を .env にコピーしてキーを入れてください。",
    );
  }
}
