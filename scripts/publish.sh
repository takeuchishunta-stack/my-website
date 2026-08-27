#!/usr/bin/env bash
# ATHLETE BRIDGE 公開スクリプト。
#   使い方: ./scripts/publish.sh "変更内容のメモ"
# 検証 → コミット → GitHub に push まで一括で行う。
# push が完了すると Netlify が自動でデプロイする。

set -euo pipefail

cd "$(dirname "$0")/.."

MESSAGE="${1:-サイト更新}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "▶ サイトを検証中..."
node scripts/check-site.mjs

if [ -z "$(git status --porcelain)" ]; then
  echo "▶ 変更はありません。公開する内容がないので終了します。"
  exit 0
fi

echo
echo "▶ 変更ファイル:"
git status --short

echo
echo "▶ コミット中... (ブランチ: $BRANCH)"
git add -A
git commit -m "$MESSAGE"

echo
echo "▶ GitHub に push 中..."
delay=2
for attempt in 1 2 3 4 5; do
  if git push -u origin "$BRANCH"; then
    echo
    echo "✓ push 完了。Netlify のデプロイが自動で始まります。"
    exit 0
  fi
  if [ "$attempt" -lt 5 ]; then
    echo "  push に失敗しました。${delay}秒待って再試行します (${attempt}/4)..."
    sleep "$delay"
    delay=$((delay * 2))
  fi
done

echo
echo "✗ push に失敗しました。ネットワーク状況を確認してから再実行してください。" >&2
exit 1
