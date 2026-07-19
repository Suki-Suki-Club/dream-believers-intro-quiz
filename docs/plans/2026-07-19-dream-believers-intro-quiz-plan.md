# Dream Believers イントロクイズ 実装計画

日付: 2026-07-19
対象リポジトリ: `/home/server/github/dream-believers-intro-quiz`
設計ドキュメント(唯一の正): `docs/plans/2026-07-19-dream-believers-intro-quiz-design.md`

この計画は上記設計ドキュメントを**そのまま実装する**ためのタスク分解である。再設計はしない。
各タスクは会話コンテキストを持たない外部ワーカーが単独で実行する前提で、参照すべき設計セクション番号を明記している。

## Goal

設計ドキュメントの仕様どおりに、Cloudflare Workers(Hono)+ D1 + R2 +
React 19 SPA からなるイントロクイズを実装する。時計ゲート配信・サーバー側計時・
匿名ランキングを含む。音源・正解マッピング・生成スクリプトはリポジトリに含めない。

## Non-goals

- 認証付きランキング/なりすまし防止(設計 §12)
- 他楽曲展開・難易度モード(設計 §12)
- 実際の音源投入・R2/D1 への本番データ投入(スクリプトは用意するが実行はしない)
- CI 構築(設計に無し)

## Design notes(実装上の確定事項・却下案)

- **リポジトリ構成**: フロントエンド SPA は `src/`(参照プロジェクト
  `link-like-essentials-mypick` 準拠)、Worker/API は `worker/`、純粋ドメインロジックは
  `worker/domain/`(CF ランタイム API に依存しない純関数)に置く。
- **テスト二層構成**: `vitest.workspace.ts` で 2 プロジェクトを分ける。
  1. jsdom プロジェクト(`vitest.config.ts`): フロント + `worker/domain/` の純関数ユニットテスト。
  2. workers プロジェクト(`vitest.workers.config.ts`, `@cloudflare/vitest-pool-workers`):
     D1/R2 バインディングを使う API 統合テスト。
  ドメインロジックを純関数に切り出すことで、境界値テスト(時計ゲート・計時・状態遷移)を
  バインディング無しで高速に回せる。却下案: 全テストを pool-workers に載せる →
  実行が重く TDD が遅くなるため却下。
- **静的アセット + API 同居**: `wrangler.jsonc` で `assets.directory: ./dist`、
  `assets.binding: ASSETS`、`not_found_handling: single-page-application` とし、
  Worker が `/api/*` を処理、それ以外は `env.ASSETS.fetch(request)` に委譲。
  `/api/*` が確実に Worker に到達するよう `run_worker_first` を設定する
  (wrangler assets の該当機能。詳細は該当タスクで確認)。
- **セッション ID / R2 キー**: `crypto.randomUUID()` / `crypto.getRandomValues` を使用
  (Workers 標準)。KV は使わない(設計 §3, §10)。
- **音声コーデック**: AAC-LC `.m4a`、`Content-Type: audio/mp4`(設計 §6, §7)。
- **依存の追加**は原則 TASK-1 の `package.json` に集約する(サンドボックスは無ネットワークのため、
  オーケストレータが事前インストールする)。以降のタスクは原則 `New dependencies: none`。
- **秘匿ファイル**: `scripts/`・`seed.sql`・`*.flac`・`*.m4a`・`*.wav`・`tracks.yaml` は
  既存 `.gitignore` 済み。ワーカーは `.git` を書けない(コミットはオーケストレータ)。

## Open questions(設計に明示が無く、実装時に既定値を採用する点)

- `run_worker_first` 未対応 wrangler バージョンの場合の代替(routes 分割)は該当タスクで判断。
- ランキング同着(`time_ms` 同値)の順位付け規則 → `time_ms ASC, created_at ASC` を既定とする。
- 期限切れセッション削除の確率 → 設計 §5「start 時に確率的」に従い 1/20 を既定とする。

---

## 共有 verify コマンド

```
npm test
```

(`vitest run`。workers プロジェクトは `@cloudflare/vitest-pool-workers` で D1/R2 バインディングを検証する)

---

### Task 1: プロジェクト雛形とテスト二層構成のスキャフォールド

- Files to touch:
  - `package.json`(新規)
  - `tsconfig.json`(新規, フロント/共通)
  - `tsconfig.worker.json`(新規, Worker 用)
  - `.npmrc`(新規, `@suki-suki-club:registry=https://npm.pkg.github.com`)
  - `wrangler.jsonc`(新規)
  - `vite.config.ts`(新規)
  - `vitest.config.ts`(新規, jsdom プロジェクト)
  - `vitest.workers.config.ts`(新規, pool-workers プロジェクト)
  - `vitest.workspace.ts`(新規, 上記 2 つを束ねる)
  - `index.html`(新規)
  - `src/main.tsx` / `src/App.tsx` / `src/index.css` / `src/vite-env.d.ts`(新規)
  - `worker/index.ts`(新規, Hono アプリの雛形)
  - `worker/types.ts`(新規, `Env` バインディング型)
  - `tests/setupTests.ts`(新規, `@testing-library/jest-dom` 読み込み)
  - `tests/client/smoke.test.tsx`(新規)
  - `tests/worker/health.test.ts`(新規)
  - `worker-configuration.d.ts` は `wrangler types` 生成物のため作らず、`Env` は手書き
- Files NOT to touch: `docs/**`, `.gitignore`, `README.md`, `scripts/**`
- New dependencies(オーケストレータが全タスク分をここでまとめて導入):
  - dependencies: `hono@^4`, `react@^19.2.0`, `react-dom@^19.2.0`,
    `@suki-suki-club/link-like-ui@^0.4.0`
  - devDependencies: `wrangler@^4.105.0`, `@cloudflare/vitest-pool-workers@^0.8`,
    `@cloudflare/workers-types@^4`, `vite@^5.4.21`, `vitest@^2.1.9`,
    `@vitejs/plugin-react@^4.7.0`, `@tailwindcss/vite@^4.3.2`, `tailwindcss@^4.3.2`,
    `typescript@^5.9.3`, `@types/react@^19.2.3`, `@types/react-dom@^19.2.3`,
    `@testing-library/react@^16.3.2`, `@testing-library/jest-dom@^6.9.1`,
    `@testing-library/user-event@^14.6.1`, `jsdom@^25.0.1`
- Steps:
  1. `package.json`: `"type": "module"`。scripts に `dev`(`vite --host 0.0.0.0`)、
     `build`(`tsc -p tsconfig.json && vite build`)、`test`(`vitest run`)、
     `test:watch`(`vitest`)、`typecheck`(`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.worker.json --noEmit`)、
     `deploy`(`npm run build && wrangler deploy`)を定義。上記依存を記載。
  2. `wrangler.jsonc`: `name: "dream-believers-intro-quiz"`、`main: "worker/index.ts"`、
     `compatibility_date: "2025-06-29"`、
     `assets: { directory: "./dist", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }`、
     `routes: [{ pattern: "intro-quiz.sukisuki.club", custom_domain: true }]`。
     D1/R2 バインディングは後続タスクで追記する旨のコメントを残す(設計 §3)。
  3. `worker/types.ts`: `export interface Env { ASSETS: Fetcher; DB: D1Database; MEDIA: R2Bucket }`
     (`@cloudflare/workers-types` を参照)。
  4. `worker/index.ts`: Hono を生成、`GET /api/health` が `{ ok: true }` を返す。
     ルート以外は `c.env.ASSETS.fetch(c.req.raw)` に委譲。`export default app`。
  5. `vitest.config.ts`: jsdom 環境、`globals: true`、`setupFiles: ['./tests/setupTests.ts']`、
     `include: ['tests/client/**/*.{test,spec}.{ts,tsx}', 'tests/domain/**/*.test.ts']`、
     `exclude: [...defaultExclude, '**/.omc/**', 'tests/worker/**']`。
  6. `vitest.workers.config.ts`: `@cloudflare/vitest-pool-workers` の `defineWorkersConfig` を使い、
     `poolOptions.workers.wrangler.configPath = './wrangler.jsonc'`、
     `include: ['tests/worker/**/*.test.ts']`。miniflare の D1/R2 は後続タスクで追記。
  7. `vitest.workspace.ts`: `['./vitest.config.ts', './vitest.workers.config.ts']` を export。
  8. `tsconfig.json` は参照プロジェクト準拠(jsx react-jsx, strict, moduleResolution Bundler,
     `types: ["vitest/globals", "@testing-library/jest-dom"]`, `include: ["src", "tests"]`)。
     `tsconfig.worker.json` は `worker` を対象に `types: ["@cloudflare/workers-types"]`。
  9. `index.html`・`src/main.tsx`・`src/App.tsx`(タイトル表示のみ)・`src/index.css`
     (`@import "tailwindcss";`)を作成。`App` は「Dream Believers イントロクイズ」を表示。
  10. `tests/client/smoke.test.tsx`: `App` をレンダリングしタイトル文字列の存在を assert。
  11. `tests/worker/health.test.ts`: `cloudflare:test` の `SELF.fetch('http://x/api/health')`
      が 200 かつ `{ ok: true }` を返すことを assert。
- Acceptance:
  - `npm test` で jsdom / workers 両プロジェクトが起動し、smoke と health が緑。
  - `npm run build` が成功し `dist/` が生成される。
  - `npm run typecheck` が成功。
- Verify:
  - `npm test && npm run build && npm run typecheck`

### Task 2: D1 マイグレーションとスキーマ

- Files to touch:
  - `migrations/0001_init.sql`(新規)
  - `wrangler.jsonc`(D1/R2 バインディングと `migrations_dir` を追記)
  - `vitest.workers.config.ts`(miniflare の D1/R2 バインディングとマイグレーション適用を追記)
  - `tests/worker/helpers/applyMigrations.ts`(新規, テスト用マイグレーション適用)
  - `tests/worker/schema.test.ts`(新規)
- Files NOT to touch: `worker/index.ts`, `src/**`, `scripts/**`
- New dependencies: none
- Steps:
  1. `migrations/0001_init.sql`: 設計 §5 の DDL を**そのまま**作成
     (`tracks` / `segments` / `sessions` / `ranking`)。加えて検索用に
     `CREATE INDEX idx_ranking_time ON ranking(time_ms ASC, created_at ASC);`
     と `CREATE INDEX idx_sessions_created ON sessions(created_at);` を追加。
  2. `wrangler.jsonc`: `d1_databases: [{ binding: "DB", database_name: "dream-believers-quiz", database_id: "PLACEHOLDER", migrations_dir: "migrations" }]`、
     `r2_buckets: [{ binding: "MEDIA", bucket_name: "dream-believers-media" }]` を追記
     (`database_id` はデプロイ時に差し替えるプレースホルダ、コメントで明記)。
  3. `vitest.workers.config.ts`: pool-workers はバインディングを `wrangler.jsonc` から継承する。
     テスト用に `cloudflare:test` の `applyD1Migrations` を使うためのマイグレーション読み込みを
     `miniflare.d1Databases` 前提で構成(D1 が isolated storage で立ち上がることを確認)。
  4. `tests/worker/helpers/applyMigrations.ts`: `cloudflare:test` の `env`, `applyD1Migrations`,
     `readD1Migrations`(または明示 SQL 実行)で `env.DB` にマイグレーションを適用する
     ヘルパを export。
  5. `tests/worker/schema.test.ts`: マイグレーション適用後、`sqlite_master` を参照して
     4 テーブルが存在すること、`ranking.session_id` に UNIQUE 制約があること、
     `sessions.ranked` の DEFAULT が 0 であることを assert。
- Acceptance:
  - workers プロジェクトのテストで 4 テーブルとインデックスが検証される。
  - 既存の health テストが引き続き緑。
- Verify:
  - `npm test`

### Task 3: 出題抽選ロジック(純関数)

- Files to touch:
  - `worker/domain/draw.ts`(新規)
  - `tests/domain/draw.test.ts`(新規)
- Files NOT to touch: `worker/index.ts`, `worker/routes/**`, `src/**`
- New dependencies: none
- Steps(設計 §2「ゲームルール」・§5 `state` 形状に準拠):
  1. `worker/domain/draw.ts` に純関数を実装:
     - `drawQuestions(trackIds: number[], rng: () => number): DrawnQuestion[]`
       10 問を重複なしで抽選(トラックが 10 未満ならエラー)、各問 `choices` は
       正解 + 残りからランダム 5、計 6、順序シャッフル。出題順もシャッフル。
       戻り値は `{ trackId: number; choices: number[] }[]`(長さ 10, 各 choices 長さ 6,
       choices は正解 trackId を必ず含む)。
     - `rng` は `() => number`(0..1)を注入可能にしてテスト決定化する。
  2. `tests/domain/draw.test.ts`: 固定 `rng`(シード列)で
     (a) 10 問が全て異なる trackId、(b) 各 choices が 6 個・重複なし・正解を含む、
     (c) trackIds が 10 未満なら throw、(d) trackIds がちょうど 10 でも choices が
     プール全体から 6 選べること、を assert。
- Acceptance:
  - 抽選不変条件(重複なし・選択肢に正解を含む・6 択)がテストで保証される。
- Verify:
  - `npm test`

### Task 4: 時計ゲート・計時・状態遷移ロジック(純関数)

- Files to touch:
  - `worker/domain/clockGate.ts`(新規)
  - `worker/domain/timing.ts`(新規)
  - `worker/domain/session.ts`(新規, `state` 型定義 + 状態遷移)
  - `tests/domain/clockGate.test.ts`(新規)
  - `tests/domain/timing.test.ts`(新規)
  - `tests/domain/session.test.ts`(新規)
- Files NOT to touch: `worker/index.ts`, `worker/routes/**`, `src/**`
- New dependencies: none
- Steps(設計 §2 タイム計算・§4.2 時計ゲート・§5 state・§6 遷移に準拠):
  1. `worker/domain/session.ts`: 型 `QuestionState { trackId; choices: number[]; startedAt: number;
     wrong: number; skips: number; answeredAt: number | null }`、
     `SessionState { current: number; questions: QuestionState[] }` を定義。
     純関数 `applyAnswer(state, n, choice, correctTrackId, now)` を実装:
     - `n !== current` なら `{ ok: false, reason: 'conflict' }`。
     - 誤答なら `wrong++` し `{ ok: false, correct: false, state }`。
     - 正解なら当該問 `answeredAt = now`、`current < 9` なら次問 `startedAt = now` にして
       `current++`、`{ ok: true, correct: true, finished: false }`。
     - 10 問目正解なら `{ ok: true, correct: true, finished: true }`。
     `applySkip(state, n, now)`: `n !== current` なら conflict、そうでなければ `skips++`。
     いずれも state を破壊的変更せず新オブジェクトを返す。
  2. `worker/domain/clockGate.ts`: `deliverablePosition(question, now, clipMs)` と
     `canServeSegment(k, question, now, clipMs)` を実装。設計 §4.2 の式に厳密準拠:
     `配信可能位置 = min((now - question.startedAt) + 5000 * (wrong + skips) + 2000, clipMs)`、
     `canServe = (k === 0) || (k * 5000 < 配信可能位置)`。
  3. `worker/domain/timing.ts`: `computeFinalMs(state, finishedAt)` を実装。設計 §2:
     `(finishedAt - state.questions[0].startedAt) + 5000 * Σ(wrong + skips)`。
  4. テスト:
     - `clockGate.test.ts`: 境界値(k×5000 がちょうど配信可能位置に等しい時は不許可、
       未満で許可)、ジャンプ加算(wrong/skips 増で配信可能位置が +5000 ずつ前進)、
       クリップ終端でのクランプ、k=0 常時許可。
     - `timing.test.ts`: 誤答・先送りゼロ時は素の経過時間、ペナルティ加算の合算。
     - `session.test.ts`: current 不一致で conflict、誤答で wrong 増加のみ、
       正解で次問 startedAt 更新、10 問目正解で finished=true。
- Acceptance:
  - 設計 §4.2 の式・§2 の計算・§5/§6 の遷移が境界値込みでテスト保証される。
- Verify:
  - `npm test`

### Task 5: `POST /api/game/start` とセッション永続化

- Files to touch:
  - `worker/db.ts`(新規, D1 アクセスヘルパ)
  - `worker/routes/game.ts`(新規, start ハンドラのみ)
  - `worker/index.ts`(game ルートをマウント)
  - `tests/worker/helpers/seed.ts`(新規, テスト用トラック/セグメント投入)
  - `tests/worker/game.start.test.ts`(新規)
- Files NOT to touch: `worker/domain/**`(既存を import のみ), `src/**`, `migrations/**`
- New dependencies: none
- Steps(設計 §6 start 行・§5 永続化・§5 期限切れ削除に準拠):
  1. `worker/db.ts`: `getAllTrackIds(db)`, `getTrack(db, id)`, `insertSession(db, row)`,
     `getSession(db, sid)`, `updateSessionState(db, sid, state)`,
     `sweepExpiredSessions(db, now)`(created_at が 2h 超・未完走を削除)を実装。
  2. `worker/routes/game.ts`: `POST /api/game/start`:
     - 確率 1/20 で `sweepExpiredSessions` を呼ぶ(cron 不要, 設計 §5)。
     - `drawQuestions`(TASK-3)で 10 問抽選、`now = Date.now()`。
       1 問目のみ `startedAt = now`、他は `startedAt = now`(current=0 基準)にし
       `SessionState` を構築。sessions に INSERT(`state` は JSON 文字列)。
     - 応答: `{ sessionId, questions: [{ choices: string[] }] }`。choices は trackId を
       `getTrack().title` に解決した**バージョン名配列**。正解 index は返さない。
  3. `worker/index.ts`: `app.route('/', gameRoutes)` 等でマウント。
  4. `tests/worker/helpers/seed.ts`: マイグレーション適用後に tracks 12 件・各 segments 数件を
     INSERT するヘルパ。
  5. `tests/worker/game.start.test.ts`: start を叩き、(a) sessionId が返る、
     (b) questions が 10 件で各 choices が 6 個の**文字列**、(c) レスポンスに正解 index/ trackId が
     含まれない、(d) D1 の sessions に 1 行入り state.current=0、を assert。
- Acceptance:
  - start が仕様どおりのレスポンスを返し、セッションが D1 に永続化される。
- Verify:
  - `npm test`

### Task 6: セグメント配信プロキシ `GET /api/game/:sid/q/:n/seg/:k`

- Files to touch:
  - `worker/routes/game.ts`(seg ハンドラを追加)
  - `worker/db.ts`(`getSegmentKey(db, trackId, idx)` を追加)
  - `tests/worker/game.seg.test.ts`(新規)
  - `tests/worker/helpers/seed.ts`(R2 にダミーセグメントを put する処理を追加)
- Files NOT to touch: `worker/domain/**`(import のみ), `src/**`, `migrations/**`
- New dependencies: none
- Steps(設計 §4.2/§4.3/§6 seg 行に準拠):
  1. `worker/routes/game.ts`: `GET /api/game/:sid/q/:n/seg/:k`:
     - セッション取得、無ければ 404。
     - `k=0` は常時許可。`k≥1` は `n === state.current` でなければ 403、
       かつ `canServeSegment`(TASK-4)が false なら 403(設計 §4.2, §6 の 403 規定)。
     - 許可時は当該問 trackId の segment idx=k の `r2_key` を引き、`MEDIA.get(key)`。
       無ければ 404。`Content-Type: audio/mp4`、キャッシュ抑止ヘッダ付きで body を返す。
     - R2 キー・trackId をレスポンスに露出しない。
  2. `getSegmentKey` を `worker/db.ts` に追加。
  3. `seed.ts`: 各 segment に対応する R2 オブジェクト(数百バイトのダミー bytes)を put。
  4. `tests/worker/game.seg.test.ts`:
     - `k=0` は開始直後でも 200(全 10 問, 設計 §4.3 プリフェッチ相当)。
     - 現在問題(n=0)で `k=1` は、経過時間が浅い間は 403、時間経過(または wrong/skip 加算後の
       state を直接更新)で 200 になる境界を検証。
     - 非現在問題の `k≥1` は 403。
     - 返却の `Content-Type` が `audio/mp4`、body に R2 キー文字列が含まれない。
- Acceptance:
  - 時計ゲートが配信可否を正しく制御し、不許可は 403、許可は音声 bytes を返す。
- Verify:
  - `npm test`

### Task 7: 回答・先送りエンドポイント

- Files to touch:
  - `worker/routes/game.ts`(answer / skip ハンドラを追加)
  - `tests/worker/game.answer.test.ts`(新規)
  - `tests/worker/game.skip.test.ts`(新規)
- Files NOT to touch: `worker/domain/**`(import のみ), `src/**`, `migrations/**`
- New dependencies: none
- Steps(設計 §2 計時・§6 answer/skip 行に準拠):
  1. `POST /api/game/:sid/q/:n/answer`(body `{ choice: 0-5 }`):
     - セッション取得、`n !== current` なら 409。`choice` 範囲外は 400。
     - `applyAnswer`(TASK-4)を `now=Date.now()` で適用。誤答なら state を UPDATE し
       `{ correct: false }`。正解かつ未完なら state UPDATE し `{ correct: true }`。
     - 10 問目正解なら `finished_at=now`、`final_ms=computeFinalMs(state, now)` を確定して
       UPDATE、`{ correct: true, finalMs }` を返す。
     - 1 イベント 1 UPDATE(設計 §5)。
  2. `POST /api/game/:sid/q/:n/skip`:
     - `n !== current` なら 409。`applySkip` で `skips++`、state UPDATE、204 を返す。
  3. テスト:
     - `game.answer.test.ts`: 誤答で `{correct:false}` かつ D1 の wrong が増える、
       `n` 不一致で 409、正解で current が進む、10 問目正解で `finalMs` が返り
       `sessions.finished_at/final_ms` が設定される。`finalMs` が
       `computeFinalMs` と一致(誤答/先送りペナルティ込み)。
     - `game.skip.test.ts`: skip で 204・skips 増加、`n` 不一致で 409。
- Acceptance:
  - answer/skip の状態遷移・計時確定・競合ガードが仕様どおり。
- Verify:
  - `npm test`

### Task 8: ランキングエンドポイント

- Files to touch:
  - `worker/routes/ranking.ts`(新規)
  - `worker/domain/sanitize.ts`(新規, 名前サニタイズ純関数)
  - `worker/index.ts`(ranking ルートをマウント)
  - `worker/db.ts`(`insertRanking`, `getRankingTop`, `getRankByTime` を追加)
  - `tests/domain/sanitize.test.ts`(新規)
  - `tests/worker/ranking.test.ts`(新規)
- Files NOT to touch: `worker/routes/game.ts`, `src/**`, `migrations/**`
- New dependencies: none
- Steps(設計 §2 ランキング・§6 ranking 行に準拠):
  1. `worker/domain/sanitize.ts`: `sanitizeName(raw): string | null` を実装。
     trim、制御文字除去、20 文字上限(超過は切り詰め)。空なら null。
  2. `worker/routes/ranking.ts`:
     - `POST /api/ranking`(body `{ sessionId, name }`): セッションが完走済み
       (`finished_at != null`)かつ `ranked=0` のときのみ受理。名前は `sanitizeName`、
       null なら 400。ranking に INSERT(`time_ms = sessions.final_ms`)、
       `sessions.ranked=1` に UPDATE。応答は `{ rank }`(自分の順位 =
       `time_ms` がより小さい件数 + 1、同着は created_at で決定)。未完走/二重登録は 409。
     - `GET /api/ranking`: 上位 50 件 `{ name, timeMs, createdAt }` を
       `time_ms ASC, created_at ASC` で返す。
  3. `worker/index.ts` にマウント。
  4. テスト:
     - `sanitize.test.ts`: 制御文字除去、21 文字→20 文字、空/空白のみ→null。
     - `ranking.test.ts`: 完走セッションで登録成功し rank が返る、二重登録で 409、
       未完走セッションで 409、`GET` が time 昇順で最大 50 件、名前サニタイズ適用。
- Acceptance:
  - 完走・未登録ガード、二重登録防止、上位 50 取得、サニタイズが仕様どおり。
- Verify:
  - `npm test`

### Task 9: フロント API クライアントと型

- Files to touch:
  - `src/api/types.ts`(新規)
  - `src/api/client.ts`(新規)
  - `tests/client/api.test.ts`(新規)
- Files NOT to touch: `worker/**`, `src/screens/**`, `src/audio/**`
- New dependencies: none
- Steps(設計 §6 の API 契約に準拠):
  1. `src/api/types.ts`: `StartResponse`, `Question`(`choices: string[]`),
     `AnswerResponse`(`{ correct: boolean; finalMs?: number }`),
     `RankingEntry`(`{ name; timeMs; createdAt }`), `PostRankingResponse`(`{ rank }`) を定義。
  2. `src/api/client.ts`: `fetch` ラッパ関数群 —
     `startGame()`, `fetchSegment(sid, n, k): Promise<ArrayBuffer>`(403 は専用エラー),
     `answer(sid, n, choice)`, `skip(sid, n)`, `postRanking(sid, name)`, `getRanking()`。
     ベース URL は同一オリジン `'/api'`。非 2xx はステータス付きエラーを throw。
  3. `tests/client/api.test.ts`: `global.fetch` をモックし、各関数が正しい
     メソッド/パス/ボディで呼ばれ、レスポンスをパースすること、seg の 403 が
     専用エラーになることを assert。
- Acceptance:
  - すべての API 関数がモック fetch で契約どおり動作する。
- Verify:
  - `npm test`

### Task 10: Web Audio セグメントプレイヤー

- Files to touch:
  - `src/audio/segmentPlayer.ts`(新規)
  - `tests/client/segmentPlayer.test.ts`(新規)
  - `tests/setupTests.ts`(AudioContext モックの追加が必要なら)
- Files NOT to touch: `worker/**`, `src/screens/**`
- New dependencies: none
- Steps(設計 §4.1 オーバーラップ・§7 Web Audio に準拠):
  1. `src/audio/segmentPlayer.ts`: `createSegmentPlayer({ decode, fetchSegment })` を実装。
     - `decode(buf): Promise<AudioBuffer>`(既定は `AudioContext.decodeAudioData`)を注入可能にして
       テスト決定化。
     - セグメント PCM を単一の成長バッファに連結。境界は 25ms 等パワークロスフェードで結合
       (AAC エンコーダディレイ対策, 設計 §4.1/§7)。
     - `appendSegment(k, arrayBuffer)`, `play()`, `pause()`, `seek(ms)`(取得済み範囲のみ、
       範囲外はクランプ), `jumpBy(ms)`(現在位置 + ms, 誤答/先送りの +5s ジャンプ用),
       `getFetchedMs()`, `getPositionMs()`, `getDurationMs()` を公開。
     - `AudioBufferSourceNode` を位置指定で張り直して再生継続。
  2. クロスフェード結合と +5s ジャンプはユニットテスト可能なよう、PCM 合成・位置計算を
     `AudioContext` から分離した純関数(`crossfadeConcat`, `resolveSeekMs`)に切り出す。
  3. `tests/client/segmentPlayer.test.ts`: モック `decode`(既知長の Float32 バッファ)で
     (a) 2 セグメント連結後の総尺 ≈ 5000ms×2 − 25ms オーバーラップ、
     (b) 境界サンプルがクロスフェードされている(不連続段差が無い)、
     (c) 未取得範囲への `seek` がクランプされる、
     (d) `jumpBy(5000)` が現在位置 +5000 になる、を assert。
- Acceptance:
  - ギャップレス結合・取得済み範囲シーク・+5s ジャンプの純ロジックがテスト保証される。
- Verify:
  - `npm test`

### Task 11: ゲーム進行フック(useGame)とプリフェッチ

- Files to touch:
  - `src/hooks/useGame.ts`(新規)
  - `tests/client/useGame.test.tsx`(新規)
- Files NOT to touch: `worker/**`, `src/screens/**`
- New dependencies: none
- Steps(設計 §2 進行・§4.3 プリフェッチ・§7 再生追従に準拠):
  1. `src/hooks/useGame.ts`: `useGame()` フックを実装。状態機械
     `'start' | 'quiz' | 'result'` と現在問題 index、経過タイム目安、ペナルティ表示値
     (誤答数・先送り数)を保持。
     - `start()`: `startGame()` 実行後、全 10 問の k=0 セグメントを並列プリフェッチ
       (設計 §4.3)。プレイヤーへ k=0 を投入。
     - 再生追従で現在問題の次セグメント(k≥1)を先読み(403 なら待機してリトライ,
       配信可能位置がバッファ 2s 込みで前進するため最終的に取得, 設計 §4.2/§7)。
     - `submitAnswer(choice)`: API 応答が誤答なら `jumpBy(5000)`(設計 §2/§7)、
       ペナルティ表示更新。正解なら次問へ、10 問目正解で `result` へ遷移し `finalMs` 保持。
     - `doSkip()`: skip API 後 `jumpBy(5000)`。
  2. `tests/client/useGame.test.tsx`: `@testing-library/react` の `renderHook` で、
     API クライアントとプレイヤーをモックし、start で 10 件のプリフェッチが走る、
     誤答で jumpBy(5000) とペナルティ加算、10 問目正解で state が result になり finalMs を保持、
     を assert。
- Acceptance:
  - 進行状態機械・プリフェッチ・ジャンプ連携がテスト保証される。
- Verify:
  - `npm test`

### Task 12: 画面(スタート/クイズ/結果/ランキング)と App 統合

- Files to touch:
  - `src/App.tsx`(画面ルーティングに更新)
  - `src/screens/StartScreen.tsx`(新規)
  - `src/screens/QuizScreen.tsx`(新規)
  - `src/screens/ResultScreen.tsx`(新規)
  - `src/screens/RankingScreen.tsx`(新規)
  - `src/components/`(必要な小コンポーネント: SeekBar, ChoiceGrid など)
  - `tests/client/screens.test.tsx`(新規)
- Files NOT to touch: `worker/**`, `src/hooks/useGame.ts`(import のみ),
  `src/audio/**`(import のみ)
- New dependencies: none
- Steps(設計 §9 画面フローに準拠。`@suki-suki-club/link-like-ui` を活用):
  1. `StartScreen`: タイトル・ルール説明・スタートボタン(押下で `useGame().start`)。
  2. `QuizScreen`: 問題番号(n/10)、再生/シークバー(取得済み範囲のみ操作可)、
     6 択グリッド、先送りボタン、経過タイム + ペナルティ表示。誤答時にシェイク等の
     フィードバック(CSS クラス切替)。
  3. `ResultScreen`: 確定タイムと内訳(実時間 / 誤答ペナルティ / 先送りペナルティ)、
     名前入力 → `postRanking`。登録後に順位表示。
  4. `RankingScreen`: 上位 50 件、自分の順位ハイライト。
  5. `App.tsx`: `useGame()` の state に応じて画面切替、ランキング画面への導線。
  6. `tests/client/screens.test.tsx`: 各画面が主要要素(ボタン・6 択・タイム表示・
     名前入力・順位リスト)をレンダリングし、スタート押下で start が呼ばれ、
     誤答フィードバックのクラスが付くことを assert(API/プレイヤーはモック)。
- Acceptance:
  - 4 画面が設計 §9 の要素を備え、App が状態に応じて切り替わる。
  - `npm run build` が成功する。
- Verify:
  - `npm test && npm run build`

### Task 13: 音源パイプラインスクリプト(ローカル専用・非コミット)

- Files to touch(すべて `.gitignore` 済み・**絶対にコミットしない**):
  - `scripts/README.md`(新規, 手順書)
  - `scripts/tracks.example.yaml`(新規, `tracks.yaml` の記入例テンプレート)
  - `scripts/build-segments.mjs`(新規)
  - `scripts/upload-r2.mjs`(新規)
  - `scripts/gen-seed.mjs`(新規)
- Files NOT to touch: `worker/**`, `src/**`, `wrangler.jsonc`, `migrations/**`,
  `.gitignore`(既に `scripts/` 等を除外済み)
- New dependencies: none(スクリプトは Node 標準 + 外部 `ffmpeg`/`wrangler` CLI を子プロセス呼び出し。
  npm 依存は追加しない。YAML は簡易パーサを自前 or JSON 併用でよい)
- Steps(設計 §8 に準拠。**このタスクの成果物は gitignore 対象でありコミットされない**):
  1. `scripts/README.md`: 実行手順(tracks.yaml 記入 → build-segments → upload-r2 → gen-seed →
     `wrangler d1 execute` 投入)と、これらのファイルが PUBLIC リポに含まれない理由を明記。
  2. `scripts/tracks.example.yaml`: `title` / `flac` パス / `clipStartSec` / `chorusEndSec` の
     記入例(1〜2 件)。実データの `tracks.yaml` は作らない。
  3. `scripts/build-segments.mjs`: FLAC からクリップ切り出し → 5s + 25ms オーバーラップで
     セグメント化 → AAC-LC 96kbps `.m4a`(メタデータ全除去 `-map_metadata -1`)を `ffmpeg`
     子プロセスで生成。各セグメントにランダム hex キーのファイル名を割当て、
     マニフェスト(trackId/idx/key/clipMs/segCount)を JSON 出力。
  4. `scripts/upload-r2.mjs`: マニフェストを読み、`wrangler r2 object put` で各 `.m4a` を
     アップロード(バケット名は wrangler.jsonc の `MEDIA` と一致)。
  5. `scripts/gen-seed.mjs`: マニフェストから `tracks` / `segments` の INSERT を含む
     `seed.sql` を生成(こちらも非コミット)。
  6. スクリプトはネットワーク/外部 CLI を使うため**このタスクでは実行しない**。
     構文が壊れていないことのみ `node --check` で確認する。
- Acceptance:
  - `scripts/` 一式が存在し、`node --check` で全スクリプトが構文エラー無し。
  - これらのファイルは `git status` に現れない(gitignore 済み)。
- Verify:
  - `node --check scripts/build-segments.mjs && node --check scripts/upload-r2.mjs && node --check scripts/gen-seed.mjs && npm test`

### Task 14: デプロイ設定とドキュメント整備

- Files to touch:
  - `wrangler.jsonc`(最終確認: assets/routes/D1/R2 の整合、`observability` 任意)
  - `.dev.vars.example`(新規, 必要なら空でも可)
  - `README.md`(開発・テスト・デプロイ手順、D1/R2 リソース作成コマンドを追記)
  - `docs/deploy.md`(新規, D1 `database_id` 差し替え・`wrangler d1 migrations apply`・
    R2 バケット作成・音源投入手順の運用メモ)
- Files NOT to touch: `worker/**`, `src/**`, `migrations/**`, `scripts/**`
- New dependencies: none
- Steps(設計 §3/§8/§10 に準拠):
  1. `README.md` に開発コマンド(`npm run dev` / `npm test` / `npm run build` /
     `npm run deploy`)と、D1(`wrangler d1 create`)・R2(`wrangler r2 bucket create`)の
     初期化手順、`wrangler.jsonc` の `database_id` プレースホルダ差し替え手順を追記。
     音源・seed・scripts が非コミットである旨を再掲。
  2. `docs/deploy.md`: マイグレーション適用(`wrangler d1 migrations apply dream-believers-quiz`)、
     R2 バケット作成、`scripts/` パイプラインでの本番投入手順、無料枠上限(設計 §10)を運用メモ化。
  3. `wrangler.jsonc` の最終整合を確認(重複キー無し、`main`/`assets`/`routes`/`d1_databases`/
     `r2_buckets` が揃っている)。
- Acceptance:
  - `README.md` と `docs/deploy.md` で開発〜デプロイ〜音源投入の全手順が追える。
  - `npm test` と `npm run build` が引き続き緑。
- Verify:
  - `npm test && npm run build`
