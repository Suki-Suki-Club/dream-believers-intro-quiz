# デプロイ・運用手順

この文書は `dream-believers-intro-quiz` の Cloudflare リソース作成、D1 初期化、R2 音源投入、Worker デプロイの手順である。コマンドはリポジトリのルートで実行する。

## 前提

- Node.js 20 以降、npm、`ffmpeg` (音源投入時のみ)
- Cloudflare アカウントと、対象アカウントを選べる Wrangler 認証
- 本番音源の FLAC と、バージョン名・クリップ範囲を管理するオペレーター環境

Wrangler にログインする。

```sh
npx wrangler login
```

## 設定とバインディング

[`wrangler.jsonc`](../wrangler.jsonc) は次のリソースを本番 Worker にバインドする。

| 設定 | 値 | 用途 |
| --- | --- | --- |
| `main` | `worker/index.ts` | Hono Worker |
| `assets.directory` | `./dist` | Vite の SPA 静的アセット |
| `assets.run_worker_first` | `[/api/*]` | API を SPA フォールバックより先に実行 |
| `DB` | `dream-believers-quiz` | D1 のセッション・ランキング・音源メタデータ |
| `MEDIA` | `dream-believers-media` | 非公開 R2 音声セグメント |
| `routes` | `intro-quiz.sukisuki.club` | カスタムドメイン |

`database_id` は公開リポジトリに固定値を置かないため、初期状態では `PLACEHOLDER` になっている。デプロイ担当者は自分の Cloudflare アカウントで作成した D1 の ID に置き換えること。R2 のバケット名と D1 のデータベース名は設定値から変更しない。

`.dev.vars.example` は現在空の設定を表すテンプレートである。実装で秘密値を追加する場合は、`.dev.vars` にだけ保存し、`.gitignore` の除外を維持する。

## D1 と R2 の作成

```sh
npx wrangler d1 create dream-believers-quiz
npx wrangler r2 bucket create dream-believers-media
```

D1 コマンドの出力から database ID をコピーし、`wrangler.jsonc` の `d1_databases[0].database_id` に設定する。R2 はデフォルトで公開されない。公開バケットや `r2.dev` URL は使わず、Worker の `MEDIA` バインディングからのみアクセスさせる。

設定を確認する。

```sh
npx wrangler d1 info dream-believers-quiz
npx wrangler r2 bucket list
```

## D1 マイグレーション

デプロイ前に、対象が本番データベースであることを確認してから、未適用マイグレーションを一覧し、適用する。

```sh
npx wrangler d1 migrations list dream-believers-quiz --remote
npx wrangler d1 migrations apply dream-believers-quiz --remote
```

マイグレーションは [`migrations/0001_init.sql`](../migrations/0001_init.sql) から順番に適用される。既に適用済みのものは再実行されない。スキーマを変更するときは新しい番号の migration を追加し、適用済みの SQL を書き換えない。

ローカル D1 を初期化する場合は `--remote` を付けずに実行する。

```sh
npx wrangler d1 migrations apply dream-believers-quiz --local
```

## 音源と seed の投入

音源パイプラインはローカル専用で、`scripts/` 自体が gitignore 対象である。実データ、`tracks.yaml`、生成された `.m4a`、マニフェスト、`seed.sql` を PUBLIC リポジトリへ追加しない。

### 1. マニフェストを作る

```sh
cp scripts/tracks.example.yaml tracks.yaml
# tracks.yaml を実データで編集
node scripts/build-segments.mjs \
  --config tracks.yaml \
  --output .audio/segments \
  --manifest .audio/manifest.json
```

`tracks.yaml` には各バージョンの表示名、FLAC パス、`clipStartSec`、`chorusEndSec` を記入する。出題プールは設計上 10〜15 バージョン、生成される各セグメントは AAC-LC 96 kbps の `.m4a` である。

### 2. R2 にセグメントをアップロードする

```sh
node scripts/upload-r2.mjs \
  --manifest .audio/manifest.json \
  --segments .audio/segments \
  --bucket dream-believers-media
```

このスクリプトは各セグメントに対して `wrangler r2 object put ... --remote --content-type audio/mp4` を実行する。本番 R2 を変更するため、対象バケットを確認してから実行する。アップロード前の確認には `--dry-run` を使う。

### 3. D1 用 seed を生成・適用する

```sh
node scripts/gen-seed.mjs \
  --manifest .audio/manifest.json \
  --output seed.sql
npx wrangler d1 execute dream-believers-quiz --remote --file seed.sql
```

`seed.sql` には `tracks` と `segments` の登録、すなわち表示タイトルと不透明な R2 キーの対応が含まれる。適用対象とファイル内容を確認し、適用後も `seed.sql` はローカルに留める。空の D1 に対しては必ず migration を先に適用する。

### 4. パイプラインの構文を確認する

```sh
node --check scripts/build-segments.mjs
node --check scripts/upload-r2.mjs
node --check scripts/gen-seed.mjs
```

## Worker のデプロイ

デプロイ前にテストとビルドを実行する。

```sh
npm test
npm run build
npm run deploy
```

`npm run deploy` はビルドを再実行して `wrangler deploy` を呼び出す。`dist/` は `assets.directory` で静的アセットとして公開され、`/api/*` は Worker に先行して渡される。D1 の `database_id` が `PLACEHOLDER` のままの場合はデプロイを開始しない。

カスタムドメインが有効になった後、ヘルスチェックを行う。

```sh
curl --fail-with-body https://intro-quiz.sukisuki.club/api/health
```

`{"ok":true}` が返れば API のルーティングを確認できる。ゲーム開始後に音声セグメントが `audio/mp4` で返ること、R2 のキーがレスポンスに露出していないことも確認する。

## 無料枠の運用目安

設計上の 1 ゲームあたりの概算と無料枠は次のとおり。実際の消費量はゲームの操作回数、ランキング閲覧、Workers のルーティング、Cloudflare の契約プランで変動するため、ダッシュボードの使用量を優先する。

| リソース | 消費/ゲーム | 無料枠 | 概算上限 |
| --- | ---: | ---: | ---: |
| Workers API リクエスト | 約 50 (静的アセットを除く) | 100,000/日 | 約 2,000 ゲーム/日 |
| D1 行書込 | 約 20 | 100,000/日 | 約 5,000 ゲーム/日 |
| D1 行読取 | 数百 | 5,000,000/日 | 通常は無視できる |
| R2 Class B 読取 | 約 30 | 10,000,000/月 | 通常は無視できる |
| R2 Standard ストレージ | — | 10 GB-month/月 | 全音源約 20 MB の想定 |

KV はセッション更新の書込量に適さないため、この構成では使用しない。音声セグメントをキャッシュして時計ゲートを迂回できる構成に変更しない。

## 運用上の注意

- D1 の本番コマンドには常に `--remote` を付け、対象名を実行前に確認する。
- `seed.sql` は公開しない。特にタイトルと R2 キーの対応を issue、ログ、PR に貼らない。
- R2 バケットを公開設定にしない。音声は Worker の位置ベース API からのみ配信する。
- migration 済みのファイルを編集せず、新しい migration を追加する。
- 音源の差し替えでは R2 のキーと D1 の `segments.r2_key` の整合を確認する。
- 無料枠の接近時は投入やゲーム提供を止め、Cloudflare の使用量と料金を確認する。

## 公式ドキュメント

- [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [R2 Wrangler commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/)
- [R2 object uploads](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
