#!/usr/bin/env node
// ATHLETE BRIDGE サイトの静的チェック。
// 公開前に「リンク切れ・参照切れ・必須メタの欠落」を検出する。依存パッケージなし。

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'note-kit', 'scripts', '.github']);

function htmlFiles(dir = ROOT) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith('.html')) out.push(full);
  }
  return out.sort();
}

const errors = [];
const warnings = [];
const pages = htmlFiles();

if (pages.length === 0) errors.push('HTMLファイルが1つも見つかりません');

for (const page of pages) {
  const rel = relative(ROOT, page);
  const html = readFileSync(page, 'utf8');

  // 参照先の存在チェック（href / src の両方）
  for (const m of html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)) {
    const raw = m[1].trim();
    if (!raw) continue;
    if (/^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(raw)) continue;

    const target = raw.split(/[?#]/)[0];
    if (!target) continue;

    const abs = target.startsWith('/')
      ? join(ROOT, target)
      : resolve(dirname(page), target);

    if (!existsSync(abs)) {
      errors.push(`${rel}: 参照先が存在しません -> ${raw}`);
    }
  }

  // 公開に最低限必要なメタ情報
  if (!/<html[^>]*\slang=/i.test(html)) errors.push(`${rel}: <html> に lang 属性がありません`);
  if (!/<title>[^<]{1,}<\/title>/i.test(html)) errors.push(`${rel}: <title> が空、または存在しません`);
  if (!/<meta[^>]+name="description"[^>]+content="[^"]{1,}"/i.test(html)) {
    warnings.push(`${rel}: meta description がありません（検索結果の説明文に影響します）`);
  }
  if (!/<meta[^>]+name="viewport"/i.test(html)) {
    errors.push(`${rel}: viewport の meta がありません（スマホ表示が崩れます）`);
  }

  // 未実装リンク（href="#"）は本番前に潰したいので警告
  const placeholders = [...html.matchAll(/href\s*=\s*"#"/g)].length;
  if (placeholders > 0) {
    warnings.push(`${rel}: リンク先が未設定の href="#" が ${placeholders} 箇所あります`);
  }
}

const label = pages.map((p) => relative(ROOT, p)).join(', ');
console.log(`チェック対象 ${pages.length} ページ: ${label}\n`);

for (const w of warnings) console.log(`  [警告] ${w}`);
for (const e of errors) console.log(`  [エラー] ${e}`);

if (errors.length > 0) {
  console.log(`\n✗ エラー ${errors.length}件。公開を中止します。`);
  process.exit(1);
}
console.log(`\n✓ エラーなし${warnings.length > 0 ? `（警告 ${warnings.length}件）` : ''}。公開できます。`);
