# dream-believers-intro-quiz

Dream Believers のバージョン違いをイントロで聴き当てる Web クイズ。
10 問を答え切るまでの時間を競い、グローバルランキングに登録できる。

- インフラ: Cloudflare Workers (Hono) + D1 (セッション/ランキング) + R2 (音声)
- フロントエンド: React 19 + Vite + Tailwind CSS 4 + `@suki-suki-club/link-like-ui`
- 音声: AAC-LC `.m4a` の 5 秒セグメントを Worker 経由で時計ゲート配信
- 公開 URL: `https://intro-quiz.sukisuki.club`

設計ドキュメント: [docs/plans/2026-07-19-dream-believers-intro-quiz-design.md](docs/plans/2026-07-19-dream-believers-intro-quiz-design.md)

## 必要なもの

- Node.js 20 以降と npm
- テスト・ビルドだけなら追加の Cloudflare アカウントは不要
- デプロイには Cloudflare アカウントと Wrangler のログインが必要
- 音源を投入する場合は `ffmpeg` を PATH に用意する

## 開発とテスト

依存関係をインストールして、フロントエンドを起動する。

```sh
npm install
npm run dev
```

`npm run dev` は Vite の SPA 開発サーバーである。Worker API を含むエンドツーエンドのローカル確認は、ビルド後に Wrangler を使う。

```sh
npm run build
npx wrangler dev
```

実行できる検証コマンド:

```sh
npm test             # jsdom + Workers の全テスト
npm run build        # dist/ を生成
npm run typecheck    # フロントエンド + Worker の型検査
```

ローカルの D1/R2 は Wrangler のローカル状態を使う。本番バケットへ接続する必要がある場合は、対象を確認してから明示的に `--remote` を付ける。ローカル開発用の環境変数テンプレートは [.dev.vars.example](.dev.vars.example) にあるが、現在の実装では必須値はない。

## Cloudflare リソースの初期化

リソース作成、マイグレーション適用、音源投入、本番デプロイの手順は [docs/deploy.md](docs/deploy.md) にまとめている。

最初に Wrangler へログインし、設定に記載された名前で D1 と R2 を作成する。

```sh
npx wrangler login
npx wrangler d1 create dream-believers-quiz
npx wrangler r2 bucket create dream-believers-media
```

D1 作成時に表示された UUID を `wrangler.jsonc` の `d1_databases[0].database_id` に設定する。`PLACEHOLDER` のまま `npm run deploy` を実行してはいけない。R2 バケットは公開せず、Worker の `MEDIA` バインディング経由だけで音声を配信する。

## デプロイ

本番デプロイは次のコマンドで行う。

```sh
npm run deploy
```

このコマンドは `npm run build` の後に `wrangler deploy` を実行する。デプロイ前に D1 マイグレーションを適用し、音源を投入済みであることを確認する。詳細な順序と確認項目は [docs/deploy.md](docs/deploy.md) を参照する。

## 音源・正解マッピングの扱い

音源、正解対応を含むマニフェスト、生成物、`seed.sql`、`scripts/` は PUBLIC リポジトリにコミットしない。これらは `.gitignore` 対象のローカル専用データである。

ローカル音源パイプラインの詳細は、オペレーター環境にだけ置く `scripts/README.md` を読む。`scripts/` は公開リポジトリには含めない。概要は次のとおり。

```sh
cp scripts/tracks.example.yaml tracks.yaml
# tracks.yaml に実データのタイトル、FLAC パス、クリップ範囲を記入
node scripts/build-segments.mjs --config tracks.yaml --output .audio/segments --manifest .audio/manifest.json
node scripts/upload-r2.mjs --manifest .audio/manifest.json --segments .audio/segments --bucket dream-believers-media
node scripts/gen-seed.mjs --manifest .audio/manifest.json --output seed.sql
npx wrangler d1 execute dream-believers-quiz --remote --file seed.sql
```

`upload-r2.mjs` は各セグメントを `audio/mp4` として本番 R2 にアップロードする。`seed.sql` にはタイトルと不透明な R2 キーの対応が含まれるため、内容を確認できる安全な環境でだけ生成・適用する。

## 無料枠の目安

設計時点の概算では、1 ゲームあたり Workers API 約 50 リクエスト、D1 約 20 行書込、R2 Class B 約 30 読取を想定している。目安は Workers 100,000 リクエスト/日で約 2,000 ゲーム/日、D1 100,000 行書込/日で約 5,000 ゲーム/日、R2 は 10,000,000 Class B 操作/月・10 GB-month の無料枠である。実際の使用量とプランは Cloudflare ダッシュボードで確認する。

Workers の静的アセット配信と API の Worker 実行、D1/R2 の現在の制限・料金は公式ドキュメントを参照する。

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [R2 Wrangler commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
