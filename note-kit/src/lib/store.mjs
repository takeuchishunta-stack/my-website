import fs from "node:fs";
import path from "node:path";
import { PATHS, ensureDir } from "./paths.mjs";

export function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`JSONの読み込みに失敗しました: ${file}\n${err.message}`);
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return file;
}

export function readText(file, fallback = "") {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback;
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return file;
}

export function loadPolicy() {
  const policy = readJson(PATHS.policy);
  if (!policy) throw new Error("config/policy.json が見つかりません。");
  return policy;
}

export function loadNiches() {
  const niches = readJson(PATHS.niches);
  if (!niches) throw new Error("config/niches.json が見つかりません。");
  return niches;
}

export function loadPersona() {
  const persona = readText(PATHS.persona);
  if (!persona.trim()) throw new Error("config/persona.md が空です。先に埋めてください。");
  return persona;
}

export function loadIdeas() {
  return readJson(PATHS.ideas, { updatedAt: null, ideas: [] });
}

export function saveIdeas(store) {
  store.updatedAt = new Date().toISOString();
  return writeJson(PATHS.ideas, store);
}

/** 使用トークンとおおよそのコストを追記する */
export function recordUsage(command, usage, model) {
  const log = readJson(PATHS.usage, { entries: [] });
  log.entries.push({
    at: new Date().toISOString(),
    command,
    model,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
  });
  writeJson(PATHS.usage, log);
}

export function slugify(text, max = 40) {
  const base = String(text)
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, max) || "untitled";
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export { PATHS, path, fs };
