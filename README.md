# ATHLETE BRIDGE

アスリートのセカンドキャリアを、採用する側の経営者の声から伝えるサイト。
ビルド不要の静的サイトで、GitHub に push すると Netlify が自動でデプロイする。

## 公開の流れ

```
ファイルを編集 → ./scripts/publish.sh "変更内容" → GitHub → Netlify が自動デプロイ
```

手元ですることは実質1コマンドだけ。

```bash
./scripts/publish.sh "インタビュー記事を1本追加"
```

このスクリプトが順に、

1. `scripts/check-site.mjs` でサイトを検証する（**エラーがあれば push せず停止**）
2. 変更をすべてコミットする
3. GitHub に push する（ネットワーク失敗時は最大4回まで自動リトライ）

を行う。push が通れば Netlify 側のデプロイは自動で始まるので、以降の操作は不要。

コミットメッセージを省略すると「サイト更新」になる。

## 検証だけ実行する

公開せずに壊れていないか見たいときは、

```bash
node scripts/check-site.mjs
```

検出するもの:

| 種別 | 内容 |
| --- | --- |
| エラー | リンク・CSS・JS・画像の参照先が存在しない |
| エラー | `<html lang>` / `<title>` / viewport の meta が無い |
| 警告 | meta description が無い（検索結果の説明文に出ない） |
| 警告 | `href="#"` のまま未設定のリンクがある |

エラーが1件でもあれば公開は中止される。警告は公開を止めない。

同じ検証は GitHub Actions（`.github/workflows/check-site.yml`）でも push のたびに走るので、
スクリプトを使わず直接 push した場合も壊れていれば気付ける。

## ファイル構成

```
index.html              トップページ
interviews.html         経営者インタビュー一覧
interview-detail.html   インタビュー記事
companies.html          企業一覧
404.html                ページが見つからないとき
css/style.css           スタイル
js/main.js              スクリプト
netlify.toml            Netlify の公開設定（ダッシュボード設定より優先される）
scripts/publish.sh      検証つき公開スクリプト
scripts/check-site.mjs  サイト検証
note-kit/               note記事・X運用の半自動化ツール（サイトとは別物）
```

HTML は `css/style.css` と `js/main.js` を参照している。
スタイルが効かなくなったときは、まずこの2ファイルの場所がずれていないか確認する。

## Netlify の設定

公開設定は `netlify.toml` に書いてある。ダッシュボードで設定を変えても
このファイルが優先されるため、変更するときは `netlify.toml` を編集して push する。

- 公開ディレクトリ: リポジトリ直下（ビルドコマンドなし）
- `/note-kit/*` と `/scripts/*` は 404 に飛ばし、URL から到達できないようにしている
- CSS / JS は1日キャッシュする

## note-kit

`note-kit/` は note の記事執筆と X 運用を半分自動化するための CLI で、
サイトの表示には一切関わらない。使い方は [`note-kit/README.md`](note-kit/README.md) を参照。

```bash
cd note-kit && npm install && npm test
```
