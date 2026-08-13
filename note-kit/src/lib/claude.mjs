import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "./store.mjs";

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export const MODEL = () => process.env.NOTEKIT_MODEL || "claude-opus-5";
export const EFFORT = () => process.env.NOTEKIT_EFFORT || "high";

/**
 * Claude に問い合わせる。長い出力でHTTPタイムアウトしないよう常にストリーミングを使う。
 *
 * @param {object} opts
 * @param {string} opts.system      システムプロンプト
 * @param {string} opts.prompt      ユーザープロンプト
 * @param {number} [opts.maxTokens] 出力上限（思考+本文の合計上限でもある）
 * @param {object} [opts.schema]    JSON Schema。渡すと構造化出力になる
 * @param {string} [opts.effort]    low | medium | high | xhigh | max
 * @param {string} [opts.command]   使用量ログ用のコマンド名
 */
export async function ask({
  system,
  prompt,
  maxTokens = 16000,
  schema = null,
  effort = EFFORT(),
  command = "unknown",
}) {
  const model = MODEL();
  const outputConfig = { effort };
  if (schema) outputConfig.format = { type: "json_schema", schema };

  const stream = getClient().messages.stream({
    model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: outputConfig,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(
      `モデルが応答を拒否しました（category: ${message.stop_details?.category ?? "不明"}）。プロンプトの内容を見直してください。`,
    );
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `出力が maxTokens(${maxTokens}) で打ち切られました。--max-tokens を増やすか、記事を分割してください。`,
    );
  }

  recordUsage(command, message.usage, model);

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { text, usage: message.usage, model };
}

/** JSON Schema を強制して構造化データを受け取る */
export async function askJson(opts) {
  const { text, usage, model } = await ask(opts);
  try {
    return { data: JSON.parse(text), usage, model };
  } catch (err) {
    throw new Error(
      `モデル出力のJSONパースに失敗しました: ${err.message}\n--- 出力の先頭 ---\n${text.slice(0, 500)}`,
    );
  }
}
