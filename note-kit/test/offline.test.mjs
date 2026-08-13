/**
 * ネットワークもAPIキーも使わないテスト。
 *   node --test test/
 *
 * Anthropic API と note API はローカルのモックサーバに差し替えて検証する。
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { parseArgs } from "../src/lib/args.mjs";
import { mechanicalChecks } from "../src/commands/review.mjs";
import { PAID_MARKER } from "../src/commands/write.mjs";
import { loadPolicy } from "../src/lib/store.mjs";

const policy = loadPolicy();

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test("parseArgs: 値つき・フラグ・値なし末尾", () => {
  assert.deepEqual(parseArgs(["--id", "abc", "--all", "--count", "5"]), {
    id: "abc",
    all: true,
    count: "5",
  });
  assert.deepEqual(parseArgs(["--profile"]), { profile: true });
  assert.deepEqual(parseArgs(["--daily", "--id", "x"]), { daily: true, id: "x" });
  assert.deepEqual(parseArgs([]), {});
});

test("note: 検索結果を正規化して集計できる", async (t) => {
  const payload = {
    data: {
      notes: {
        total_count: 1234,
        contents: [
          {
            key: "n1",
            name: "有料記事A",
            price: 500,
            likeCount: 120,
            publishAt: "2026-01-10T00:00:00+09:00",
            user: { urlname: "author1", nickname: "著者1", followerCount: 3000 },
          },
          {
            key: "n2",
            name: "有料記事B",
            price: 980,
            likeCount: 40,
            user: { urlname: "author2", nickname: "著者2", followerCount: 500 },
          },
          {
            key: "n3",
            name: "無料記事C",
            price: 0,
            likeCount: 300,
            user: { urlname: "author1", nickname: "著者1", followerCount: 3000 },
          },
        ],
      },
    },
  };

  const { server, url } = await startServer((req, res) => {
    assert.ok(req.url.startsWith("/v3/searchs?context=note&q="));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  t.after(() => server.close());

  process.env.NOTEKIT_NOTE_API_BASE = url;
  process.env.NOTEKIT_RATE_LIMIT_MS = "0";
  const { searchNotes, summarize } = await import("../src/lib/note.mjs");

  const result = await searchNotes("テスト");
  assert.equal(result.notes.length, 3);
  assert.equal(result.total, 1234);
  assert.equal(result.notes[0].url, "https://note.com/author1/n/n1");
  assert.equal(result.notes[0].isPaid, true);
  assert.equal(result.notes[2].isPaid, false);

  const summary = summarize(result);
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.paidRatio, 0.667);
  assert.equal(summary.priceMedian, 740); // (500+980)/2
  assert.equal(summary.priceBuckets["301-500円"], 1);
  assert.equal(summary.priceBuckets["501-1000円"], 1);
  assert.equal(summary.likeMedian, 120);
  assert.equal(summary.topPaidNotes[0].title, "有料記事A");
  assert.equal(summary.topAuthors[0].author, "author1");
});

test("note: レスポンス構造が変わっても落ちない", async (t) => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { unexpected: true } }));
  });
  t.after(() => server.close());

  process.env.NOTEKIT_NOTE_API_BASE = url;
  const { searchNotes } = await import("../src/lib/note.mjs");
  const result = await searchNotes("テスト");
  assert.deepEqual(result.notes, []);
});

test("review: 良い記事は機械チェックを通る", () => {
  const good = [
    "## 導入",
    "あ".repeat(1500),
    "## 背景",
    "い".repeat(1000),
    PAID_MARKER,
    "## 手順",
    "う".repeat(2000),
    "## チェックリスト",
    "え".repeat(1500),
    "## まとめ",
    "お".repeat(500),
  ].join("\n\n");

  const result = mechanicalChecks(good, { priceYen: 500 }, policy);
  assert.equal(result.hasPaidMarker ?? true, true);
  assert.equal(result.placeholders, 0);
  assert.equal(
    result.issues.filter((issue) => issue.level === "error").length,
    0,
    JSON.stringify(result.issues),
  );
});

test("review: 危険表現・要追記・有料部分不足を検出する", () => {
  const bad = [
    "## 導入",
    "この方法なら必ず稼げます。",
    "【要追記: 自分の実績】",
    "## まとめ",
    "いかがでしたか。",
    PAID_MARKER,
    "短い有料部分。",
  ].join("\n\n");

  const result = mechanicalChecks(bad, { priceYen: 500 }, policy);
  const messages = result.issues.map((issue) => issue.message).join("\n");

  // 語幹マッチなので「必ず稼げます」も拾えること
  assert.match(messages, /法令・規約リスクのある断定表現: 必ず稼げ/);
  assert.match(messages, /要追記/);
  assert.match(messages, /有料部分が薄すぎます/);
  assert.match(messages, /いかがでしたか/);
  assert.ok(result.issues.some((issue) => issue.level === "error"));
});

test("review: 有料マーカーが無ければエラー", () => {
  const result = mechanicalChecks("## 見出し\n本文", { priceYen: 500 }, policy);
  assert.ok(result.issues.some((issue) => issue.message.includes("有料ラインのマーカー")));
});

test("claude: ストリーミング応答からJSONを取り出せる", async (t) => {
  const answer = { ideas: [{ title: "テスト企画" }] };
  let received;

  const { server, url } = await startServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received = JSON.parse(body);
      const json = JSON.stringify(answer);
      const events = [
        {
          type: "message_start",
          message: {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-opus-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: json },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 20 },
        },
        { type: "message_stop" },
      ];
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      for (const event of events) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    });
  });
  t.after(() => server.close());

  process.env.ANTHROPIC_BASE_URL = url;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const { askJson } = await import("../src/lib/claude.mjs");

  const { data } = await askJson({
    system: "テスト",
    prompt: "テスト",
    schema: { type: "object", properties: { ideas: { type: "array" } }, required: ["ideas"] },
    maxTokens: 1000,
    command: "test",
  });

  assert.deepEqual(data, answer);
  // リクエストの形が意図どおりか（構造化出力・適応思考・effort）
  assert.equal(received.model, "claude-opus-5");
  assert.equal(received.thinking.type, "adaptive");
  assert.equal(received.output_config.format.type, "json_schema");
  assert.equal(received.output_config.effort, "high");
  assert.equal(received.stream, true);
});
