import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, "config"),
  policy: path.join(ROOT, "config", "policy.json"),
  niches: path.join(ROOT, "config", "niches.json"),
  persona: path.join(ROOT, "config", "persona.md"),
  data: path.join(ROOT, "data"),
  research: path.join(ROOT, "data", "research"),
  researchRaw: path.join(ROOT, "data", "research", "raw"),
  market: path.join(ROOT, "data", "market.json"),
  nicheScores: path.join(ROOT, "data", "niches-scored.json"),
  nicheReport: path.join(ROOT, "data", "niche-report.md"),
  ideas: path.join(ROOT, "data", "ideas.json"),
  articles: path.join(ROOT, "data", "articles"),
  x: path.join(ROOT, "data", "x"),
  calendar: path.join(ROOT, "data", "calendar.md"),
  usage: path.join(ROOT, "data", "usage.json"),
  env: path.join(ROOT, ".env"),
};

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function articleDir(id) {
  return path.join(PATHS.articles, id);
}
