# Dream Believers イントロクイズ — 音声UX改善・アートリビール 追加計画

日付: 2026-07-22
対象リポジトリ: `/home/server/github/dream-believers-intro-quiz`(本番稼働中、`dream-believers-quiz.sukisuki.club`)
先行ドキュメント(必ず参照): `docs/plans/2026-07-19-dream-believers-intro-quiz-design.md`(唯一の原設計)、
`docs/plans/2026-07-19-dream-believers-intro-quiz-plan.md`(原実装計画、TASK-1〜14 は完了・本番反映済み)

本ドキュメントは原設計に対する **アドオン(追記)** であり、原設計・原計画の再設計はしない。
番号は原計画の続き(TASK-15〜)とし、原計画の TASK-1〜14 とは重複させない。
各タスクは会話コンテキストを持たない外部ワーカーが単独実行する前提で、既存コードの正確な
シグネチャ・行番号相当の情報をタスクごとに明記する。

## Goal

1. 「スタート」タップの1クリック内でオーディオ解錠を行い、以後ノータッチで全問イントロが
   自動再生されるようにする(現状のバグ修正)。
2. 各問題の開始前に「デデン」アナウンス演出、正解時に「正解!」演出+タイマーホールド、
   誤答時に不正解音、をそれぞれ SFX 付きで挿入する。
3. 正解時の「ご褒美(コーラス試聴 / アルバムアート表示)」のプラミングを追加する
   (実データはコーラスクリップのみ未投入。アートは本番投入まで行う)。

## Non-goals

- ドメイン移行(`dream-believers-quiz.sukisuki.club` への切替)— 既に完了・スコープ外。
- 原計画 TASK-1〜14 の再実装 — 完了・デプロイ済みにつき対象外。
- 認証付きランキング・他楽曲展開・難易度モード(原設計 §12 のまま)。
- コーラス試聴クリップの実ファイル生成・投入(スキーマとエンドポイントのみ用意。ファイルは
  後日投入)。
- `wrangler d1 migrations apply --remote` の実行そのもの(TASK-22 で手順を明記するのみ。
  実行はオーケストレータの責務)。

## Design notes(実装上の確定事項・却下案)

- **オーディオ解錠は「共有 AudioContext を1個だけ」resume する方式。** 現状
  `src/audio/segmentPlayer.ts` の `createSegmentPlayer` は `audioContext` オプション未指定だと
  各プレイヤーが独自に `AudioContext` を遅延生成する(`useGame.ts` の `start()` は現状どのプレイ
  ヤーにも `audioContext` を渡していない)。10 個別々のコンテキストをクリック時点で解錠するのは
  不可能(まだ生成されていないため)なので、新設する `src/audio/audioContext.ts` の
  `getSharedAudioContext()` が返す **単一の** `AudioContext` を全 10 プレイヤーと SFX 再生・
  ご褒美クリップ再生の全てで共有する。`useGame.ts` の `start()` の **最初の同期文**(いかなる
  `await` より前)で `unlockSharedAudioContext()` を呼び、ユーザーのクリックのコールスタック内で
  `resume()` を発火させる(Promise は待たない)。一度 resume した `AudioContext` は以後ジェス
  チャー無しでスケジューリングし続けられる(Web Audio の標準的な解錠パターンで、既存の
  `SegmentPlayer.play()` の `resume-on-play` もこれを利用している)。却下案: `HTMLAudioElement`
  プールでの解錠 → Safari 等では要素ごと・呼び出しごとにジェスチャー起点が必要になりやすく、
  「1回解錠すれば以後ノータッチ」という要件を満たすのに既存パターンより不利なため却下。
- **出題フェーズの状態機械は `useGame.ts` 内に閉じる。** 新しい型
  `QuestionPhase = 'announcing' | 'playing' | 'correct-reveal' | 'wrong-feedback'` を
  `useGame.ts` に追加し、SFX 再生・タイマーホールド・正解時のご褒美(reward/art)取得は全て
  フック側の責務とする。`QuizScreen.tsx` は新しい `questionPhase` / `revealArtUrl` prop を
  **追加**で受け取り、既存の `feedback`(誤答シェイク+ペナルティポップ、650ms 自動クリア)の
  ローカル状態・ロジックには一切手を入れず、そのまま残す(既存テストへの影響を最小化)。
- **定数はエクスポートしてテストから参照可能にする**: `ANNOUNCE_MS = 1700`(`クイズ出題.mp3`
  の長さ ≈1.70s に合わせる)、`CORRECT_HOLD_MS = 1300`(要求範囲 800–1500ms の中央寄り。
  `クイズ正解.mp3` ≈1.75s よりわずかに短いが、SFX 自体は途中で強制停止しないため「途切れた」
  感は出ない)、`WRONG_FEEDBACK_MS = 650`(既存の `QuizScreen` のシェイク/ペナルティポップの
  自動クリア時間と揃え、視覚と音を同期させる)。
- **SFX は静的アセット。** ユーザーが `scripts/audio/` に置いた3つの mp3
  (`クイズ出題.mp3` / `クイズ正解.mp3` / `クイズ不正解.mp3`)はスポイラー性がなく anti-cheat
  対象外なので、`public/sfx/{announce,correct,wrong}.mp3` にコピーして Vite の通常の静的アセット
  として配信する(D1/R2/Worker 経由にしない)。`scripts/` は `.gitignore` 済みだが `public/` は
  対象外であり、コピー後の3ファイルは通常どおりコミットされる。
- **リワード/アート配信は既存のセグメント配信プロキシと同じ「不透明キー + 時計非依存の
  answered ガード」パターン。** 新エンドポイント `GET /api/game/:sid/q/:n/reward`
  (`audio/mp4`)・`GET /api/game/:sid/q/:n/art`(`image/jpeg`)は、いずれも
  `state.questions[n].answeredAt !== null` かつ対応する `tracks.reward_key` /
  `tracks.art_key` が非 NULL のときのみ 200、それ以外は 404(理由を問わず 404 に統一し、
  「あるが未解禁」と「そもそも無い」を外部から区別させない)。クロックゲート(原設計 §4.2)は
  適用不要(その問題は既に確定しているため)。
- **D1 スキーマは `ALTER TABLE ... ADD COLUMN`(nullable, デフォルト不要)の追加専用
  migration。** 本番 D1 には原計画 TASK-2/5 で作成済みの `tracks` に既に 13 行が入っている
  (原計画の音源投入で確認済み)ため、非破壊な追加のみ許可する。
- **フロント API クライアントは 404 を例外にしない。** `fetchReward` / `fetchArt` は
  404 のとき `null` を返す(既存の `fetchSegment` が 403 を `SegmentUnavailableError` にする
  のとは異なる設計。reward/art の 404 は「まだ無い」という正常系であり、呼び出し側
  (`useGame.ts`)がベストエフォートで無視できるようにする)。
- **アルバムアート抽出パイプラインは `build-segments.mjs` の既存パーサを再利用する。**
  `scripts/build-segments.mjs` は `parseTracksDocument` / `normalizeTracks` を既に
  `export` しているため、新設する `scripts/extract-art.mjs` はこれを import して
  `tracks.yaml` から FLAC パスを取得する(YAML パーサの重複実装をしない)。
  `ffprobe` で `mjpeg` の attached-pic ストリームの有無を確認し、無ければそのトラックを
  スキップしてログに警告を出す(パイプライン全体は失敗させない)。
- **リワードクリップは今回はプラミングのみ。** `scripts/gen-seed.mjs` に `--mode insert|update`
  を追加し、`update` モードでは既に本番に入っている行に対して
  `UPDATE tracks SET art_key = ?, reward_key = ? WHERE id = ?;` を生成できるようにする
  (新規 `INSERT` は主キー/UNIQUE 制約で失敗するため、本番の既存行を更新する経路を用意する)。

---

## 共有 verify コマンド

```
npm test
```

(`vitest run`。ビルドに影響するタスクは `npm run build && npm run typecheck` を追加で要求する)

---

### Task 15: SFX 静的アセット化と共有 AudioContext・SFX 再生モジュール

- Files to touch:
  - `public/sfx/announce.mp3`(新規, バイナリコピー)
  - `public/sfx/correct.mp3`(新規, バイナリコピー)
  - `public/sfx/wrong.mp3`(新規, バイナリコピー)
  - `src/audio/audioContext.ts`(新規)
  - `src/audio/sfx.ts`(新規)
  - `tests/client/sfx.test.ts`(新規)
- Files NOT to touch: `worker/**`, `migrations/**`, `src/hooks/useGame.ts`, `src/screens/**`,
  `scripts/audio/**`(コピー元。リネーム・削除しない)
- New dependencies: none
- Steps:
  1. 既存のローカル SFX ファイルを ASCII ファイル名で `public/sfx/` にコピーする(コピー元は
     削除しない、`scripts/audio/` はそのまま):
     ```sh
     mkdir -p public/sfx
     cp "scripts/audio/クイズ出題.mp3" public/sfx/announce.mp3
     cp "scripts/audio/クイズ正解.mp3" public/sfx/correct.mp3
     cp "scripts/audio/クイズ不正解.mp3" public/sfx/wrong.mp3
     ```
     これらは Vite のビルドでそのまま `dist/sfx/*.mp3` にコピーされる通常の静的アセットになる
     (D1/R2/Worker を経由しない)。
  2. `src/audio/audioContext.ts` を新規作成する:
     ```ts
     export function getSharedAudioContext(): AudioContext
     export function unlockSharedAudioContext(context?: AudioContext): void
     ```
     - `getSharedAudioContext()`: モジュールスコープの単一インスタンスを遅延生成してキャッシュ
       する(`globalThis.AudioContext ?? (globalThis as any).webkitAudioContext` にフォール
       バックする既存の `src/audio/segmentPlayer.ts` の `getDefaultAudioContext` と同じパターン
       を用いる)。未対応環境では `Error('Web Audio is not supported in this browser.')` を
       throw する。
     - `unlockSharedAudioContext(context = getSharedAudioContext())`: `context.state ===
       'suspended'` のときのみ `context.resume()` を呼び、返る Promise は `await` せず
       `.catch(() => {})` で握りつぶす(同期的にクリックのコールスタック内で呼べることが
       最重要。関数自体は戻り値なし `void`)。
  3. `src/audio/sfx.ts` を新規作成する:
     ```ts
     export type SfxName = 'announce' | 'correct' | 'wrong';
     export interface SfxPlayer {
       preload(): Promise<void>;
       play(name: SfxName): void;
     }
     export function createSfxPlayer(options?: {
       fetchClip?: (name: SfxName) => Promise<ArrayBuffer>;
       decode?: (buffer: ArrayBuffer) => Promise<AudioBuffer>;
       audioContext?: AudioContext;
     }): SfxPlayer
     export const sfx: SfxPlayer;
     ```
     - 既定の `fetchClip`: `fetch(\`/sfx/${name}.mp3\`).then((r) => r.arrayBuffer())`。
     - 既定の `decode`: `(buffer) => getContext().decodeAudioData(buffer)`
       (`getContext()` は `options.audioContext ?? getSharedAudioContext()`)。
     - 内部に `Map<SfxName, AudioBuffer>` のキャッシュと `Map<SfxName, Promise<void>>` の
       進行中ロードを持ち、`preload()` は3クリップを並列にロードし、同時に複数回呼ばれても
       fetch/decode が1回ずつしか走らないようにする(`loadSegment` の
       `pendingLoads` パターンを踏襲)。
     - `play(name)`: キャッシュ済みならその場で `AudioBufferSourceNode` を生成・
       `connect(context.destination)`・`start(0)` する。未ロードなら遅延ロードを開始し
       (待たずに `void load().then(...)` で完了後に再生)、**同期的には決して throw しない**
       (`try/catch` で全エラーを握りつぶす。SFX の失敗でゲームを止めない)。
     - `export const sfx = createSfxPlayer();` で実運用用の既定インスタンスを公開する。
  4. `tests/client/sfx.test.ts` を新規作成し、モックの `fetchClip`(名前ごとに異なる
     `ArrayBuffer` を返す)・モックの `decode`(呼び出し回数を記録し、フェイクの
     `AudioBuffer`(空オブジェクトで可)を返す)・フェイクの `audioContext`
     (`createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn() }))`,
     `destination: {}`, `state: 'running'`)を注入して以下を assert する:
     - `preload()` を2回並列に呼んでも `fetchClip`/`decode` は名前ごとに1回しか呼ばれない。
     - `preload()` を呼ばずに `play('correct')` を呼んでも(遅延ロード経由で)最終的に
       `audioContext.createBufferSource` が呼ばれる(`await Promise.resolve()` を挟んで
       マイクロタスクを進めるか `vi.waitFor` で待つ)。
     - `decode` が reject するとき `play()` を呼んでも例外が投げられない(呼び出し自体は
       同期的に完了する)。
     - オプション無しで `createSfxPlayer()` を呼んでもコンストラクト自体は例外を投げない
       (`play`/`preload` は呼ばない — jsdom には実 `AudioContext`/`fetch` が無いため)。
- Acceptance:
  - `public/sfx/announce.mp3` / `correct.mp3` / `wrong.mp3` が存在し、`scripts/audio/` の
    元ファイルとバイト列が一致する(`cmp` で差分無し)。
  - `sfx.ts` / `audioContext.ts` が注入可能な形で単体テスト済み。
  - `npm run build` で `dist/sfx/*.mp3` が生成される。
- Verify:
  - `npm test && npm run build && npm run typecheck`

### Task 16: D1 マイグレーション 0002(`art_key` / `reward_key` 追加)

- Files to touch:
  - `migrations/0002_add_reward_art_keys.sql`(新規)
  - `worker/db.ts`(`Track` / `TrackRow` に列追加、`getTrack` の SELECT 拡張)
  - `tests/worker/helpers/applyMigrations.ts`(0002 を migrations 配列に追加)
  - `tests/worker/schema.test.ts`(新しい列の nullable 検証を追加)
- Files NOT to touch: `worker/routes/**`, `src/**`, `scripts/**`
- New dependencies: none
- Steps:
  1. `migrations/0002_add_reward_art_keys.sql` を新規作成する(既存 `tracks` への追加のみ、
     デフォルト値・バックフィル不要):
     ```sql
     ALTER TABLE tracks ADD COLUMN art_key TEXT;
     ALTER TABLE tracks ADD COLUMN reward_key TEXT;
     ```
  2. `worker/db.ts` を更新する:
     - `Track` インターフェースに `artKey: string | null; rewardKey: string | null;` を追加。
     - `TrackRow` インターフェースに `art_key: string | null; reward_key: string | null;` を
       追加。
     - `getTrack()` の SELECT 文を
       `'SELECT id, title, clip_ms, seg_count, art_key, reward_key FROM tracks WHERE id = ?1'`
       に変更し、戻り値のマッピングに `artKey: row.art_key, rewardKey: row.reward_key` を追加
       する。
  3. `tests/worker/helpers/applyMigrations.ts` を更新する: 既存の `migrationSql`
     import に加えて `import migrationSql0002 from '../../../migrations/0002_add_reward_art_keys.sql?raw';`
     を追加し、SQL 文字列を `;` 区切りのクエリ配列へ変換する処理を小さな共通関数
     `toQueries(sql: string): string[]` として切り出して両方の migration に使い回す。
     `migrations` 配列に `{ name: '0002_add_reward_art_keys.sql', queries: toQueries(migrationSql0002) }`
     を追加する(`applyD1Migrations` は配列の順序どおりに適用するため、0001 の後に置く)。
  4. `tests/worker/schema.test.ts` の既存 `describe('D1 schema', ...)` 内に新しい `it` を追加する:
     `PRAGMA table_info('tracks')` を取得し、`art_key` / `reward_key` 列がそれぞれ存在すること、
     `notnull === 0`(NOT NULL 制約が無い)こと、`dflt_value === null`(デフォルト値が無い)
     ことを assert する。
- Acceptance:
  - `npm test` で 0001→0002 の順に migration が適用され、`tracks` に nullable な
    `art_key` / `reward_key` が追加されたことが検証される。
  - `getTrack()` は既存の呼び出し元(`worker/routes/game.ts` のセグメント配信・start)に対して
    後方互換(追加列を返すだけで既存フィールドは変更なし)。
  - 既存の全テスト(start/seg/answer/skip/ranking/schema/health)が引き続き緑。
- Verify:
  - `npm test`

### Task 17: リワード/アート配信プロキシエンドポイント

- Files to touch:
  - `worker/routes/game.ts`(`GET /api/game/:sid/q/:n/reward`・`GET /api/game/:sid/q/:n/art`
    を追加)
  - `tests/worker/helpers/seed.ts`(新しい追加専用ヘルパー関数を1つ追記)
  - `tests/worker/game.reward.test.ts`(新規)
  - `tests/worker/game.art.test.ts`(新規)
- Files NOT to touch: `worker/domain/**`(import のみ), `src/**`, `migrations/**`,
  既存の `seedGameData()` のシグネチャ・挙動(変更しない、追記のみ)
- New dependencies: none
- Steps(TASK-16 の `art_key`/`reward_key` に依存する。設計アドオンの「リワード/アート配信」
  節に準拠):
  1. `worker/routes/game.ts` に以下を追加する(`getTrack` は既存 import を再利用):
     ```ts
     gameRoutes.get('/api/game/:sid/q/:n/reward', async (c) => {
       const session = await getSession(c.env.DB, c.req.param('sid'));
       if (!session) return c.json({ error: 'Session not found' }, 404);

       const n = parseNonNegativeInteger(c.req.param('n'));
       if (n === null) return c.json({ error: 'Invalid question number' }, 400);

       const question = session.state.questions[n];
       if (!question || question.answeredAt === null) {
         return c.json({ error: 'Reward not available' }, 404);
       }

       const track = await getTrack(c.env.DB, question.trackId);
       if (!track || !track.rewardKey) {
         return c.json({ error: 'Reward not available' }, 404);
       }

       const object = await c.env.MEDIA.get(track.rewardKey);
       if (!object) return c.json({ error: 'Reward not available' }, 404);

       return new Response(object.body, {
         status: 200,
         headers: {
           'Content-Type': 'audio/mp4',
           'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
           Pragma: 'no-cache',
           Expires: '0',
         },
       });
     });
     ```
  2. 同じ形で `GET /api/game/:sid/q/:n/art` を追加する。差分は `track.artKey` を使うこと、
     `Content-Type: image/jpeg` にすること、404 メッセージを `'Art not available'` にすること
     のみ。
  3. `tests/worker/helpers/seed.ts` に新しいエクスポート関数を **追記**する(既存の
     `seedGameData()` は一切変更しない):
     ```ts
     export async function setTrackMedia(
       trackId: number,
       media: { artKey?: string | null; rewardKey?: string | null },
     ): Promise<void> {
       await env.DB.prepare(
         'UPDATE tracks SET art_key = ?1, reward_key = ?2 WHERE id = ?3',
       )
         .bind(media.artKey ?? null, media.rewardKey ?? null, trackId)
         .run();
       if (media.artKey) {
         await env.MEDIA.put(media.artKey, new Uint8Array([0xff, 0xd8, 0xff]));
       }
       if (media.rewardKey) {
         await env.MEDIA.put(media.rewardKey, new Uint8Array([0x00, 0x01, 0x02, 0x03]));
       }
     }
     ```
  4. `tests/worker/game.reward.test.ts`(`tests/worker/game.seg.test.ts` の
     `startGame`/`getSessionState` ヘルパー相当を同ファイル内に再実装するか、同じパターンで
     書く): `applyMigrations()` → `seedGameData()` → `setTrackMedia(<正解 trackId>, { rewardKey: 'reward-key-1' })`
     → セッション開始 → 正解する前は `/reward` が 404(たとえ `rewardKey` を設定していても)
     → 正解の trackId を DB の `state.questions[0].choices` から特定して
     `POST /api/game/:sid/q/0/answer` に正しい choice を送って 200 を得る →
     その後 `/reward` が 200 かつ `Content-Type: audio/mp4` を返す → 別の問題(`rewardKey`
     未設定のトラック)を正解しても `/reward` は 404 のままであることを assert する。
  5. `tests/worker/game.art.test.ts` も同様に、`Content-Type: image/jpeg` であることと
     `art_key` が NULL のトラックでは正解後も 404 のままであることを assert する。
- Acceptance:
  - reward/art エンドポイントは「そのセッションでその問題が正解済み」かつ「対応する
    キーが非 NULL」のときのみ 200、それ以外は理由を問わず 404 を返す。
  - 既存の start/seg/answer/skip/ranking/schema/health テストは無変更のまま引き続き緑。
- Verify:
  - `npm test`

### Task 18: アルバムアート抽出パイプラインとリワードクリップ投入手順の整備

- Files to touch(すべて `.gitignore` 済み・**絶対にコミットしない**):
  - `scripts/extract-art.mjs`(新規)
  - `scripts/gen-seed.mjs`(`--mode insert|update` を追加、`art_key`/`reward_key` 対応)
  - `scripts/upload-r2.mjs`(マニフェストの `artKey`/`artFile` を検出してアート画像も
    アップロードできるようにする)
  - `scripts/README.md`(パイプライン手順の更新、リワードクリップの将来投入手順の追記)
- Files NOT to touch: `worker/**`, `src/**`, `wrangler.jsonc`, `migrations/**`, `.gitignore`
- New dependencies: none(Node 標準 + 既存の `ffmpeg`/`ffprobe`/`wrangler` 子プロセス呼び出しの
  み。npm 依存は追加しない)
- Steps(原計画 TASK-13 のパイプラインに追記する。**このタスクの成果物は gitignore 対象で
  ありコミットされない**):
  1. `scripts/extract-art.mjs` を新規作成する。`scripts/build-segments.mjs` が既に
     `export { parseTracksDocument, normalizeTracks }` しているのでそれを import して
     YAML パーサを再実装しない:
     ```js
     import { normalizeTracks, parseTracksDocument } from './build-segments.mjs';
     export async function extractArt({
       configPath = 'tracks.yaml',
       outputDirectory = '.audio/art',
       manifestPath = '.audio/manifest.json',
       ffmpeg = 'ffmpeg',
       ffprobe = 'ffprobe',
     } = {}) { /* ... */ }
     ```
     - `tracks.yaml` を読んで `normalizeTracks(parseTracksDocument(source), configPath)` で
       各トラックの `trackId` / `sourcePath`(FLAC への絶対パス)を得る。
     - トラックごとに `ffprobe -v error -select_streams v -show_entries stream=codec_name
       -of csv=p=0 <sourcePath>` を子プロセスで実行し、出力に `mjpeg` が含まれるかで
       埋め込みアートの有無を判定する。無ければそのトラックの `title` を `skipped` 配列に
       積んで **次のトラックへ継続**する(パイプライン全体を失敗させない)。
     - 埋め込みアートが有るトラックには `randomBytes(16).toString('hex')` で不透明キーを
       生成し(`build-segments.mjs` と同じ命名慣習。ファイル名からタイトルが推測できない
       ようにする)、`ffmpeg -hide_banner -loglevel error -y -i <sourcePath> -an -vcodec copy
       -map_metadata -1 <outputDirectory>/<key>.jpg` で抽出する。
     - 既存の `.audio/manifest.json`(`build-segments.mjs` の出力)を読み込み、
       `manifest.tracks` の各要素に `trackId` が一致するものへ `artKey` / `artFile` を
       マージして書き戻す(セグメント情報は変更しない)。
     - 最後に `skipped.length > 0` なら
       `console.warn('No embedded art found for: ' + skipped.join(', ') + ' (art_key will stay NULL for these tracks)')`
       を出す。CLI 実行時は `--config` / `--manifest` / `--output` / `--ffmpeg` / `--ffprobe`
       オプションを受け付ける(既存スクリプトと同じ `parseArgs` の形)。
  2. `scripts/gen-seed.mjs` を拡張する:
     - `normalizeManifest` に `artKey` / `rewardKey` の読み取りを追加する(いずれも
       任意の文字列。無ければ `null`。`typeof track.artKey === 'string' && track.artKey.trim()
       ? track.artKey.trim() : null` の形でトリム・空文字は null 化する)。
     - `sqlStringOrNull(value)` ヘルパーを追加(`null` なら `'NULL'`、それ以外は既存の
       `sqlString` を使う)。
     - `manifestToSql(manifest, mode = 'insert')` を拡張する。
       - `mode === 'insert'`(既定, 後方互換)のときは、`tracks` の INSERT 文に
         `art_key, reward_key` の2列を追加する:
         `INSERT INTO tracks (id, title, clip_ms, seg_count, art_key, reward_key) VALUES (...,
         ${sqlStringOrNull(track.artKey)}, ${sqlStringOrNull(track.rewardKey)});`
         (segments の INSERT 文は変更しない)。
       - `mode === 'update'` のときは INSERT を一切出力せず、`artKey` か `rewardKey` の
         少なくとも一方が非 null のトラックについてのみ
         `UPDATE tracks SET art_key = ${sqlStringOrNull(track.artKey)}, reward_key =
         ${sqlStringOrNull(track.rewardKey)} WHERE id = ${track.trackId};` を出力する
         (両方 null のトラックは何も出力しない、無意味な UPDATE を避ける)。
     - `generateSeed({ manifestPath, outputPath, mode })` と `parseArgs` に `--mode` オプション
       (`insert` または `update`、既定 `insert`、それ以外の値は throw)を追加する。
  3. `scripts/upload-r2.mjs` を拡張する:
     - `parseArgs` に `--art <dir>`(既定 `.audio/art`)オプションを追加する。
     - `readManifestEntries` とは別に `readArtEntries(manifest)` を追加し、
       `manifest.tracks` の中で `track.artKey` が truthy なものだけを
       `{ trackId, key: track.artKey, file: track.artFile ?? \`${track.artKey}.jpg\` }`
       の形で集める(`artKey` の hex 形式チェックは既存の segment 用正規表現
       `/^[0-9a-f]+$/i` を再利用する)。
     - `uploadR2()` の本体で、既存のセグメントアップロードループの後に art エントリの
       ループを追加し、`--content-type image/jpeg` で `wrangler r2 object put
       <bucket>/<key> --file <artDirectory>/<file> --remote` を実行する
       (`--dry-run` は両方のループに効くようにする)。`readArtEntries` が空配列を返す
       (=アート未生成のマニフェスト)場合は何もアップロードしない、既存の呼び出しは
       完全後方互換。
  4. `scripts/README.md` のパイプライン手順を更新する:
     - ステップ2として「`node scripts/extract-art.mjs --config tracks.yaml --output
       .audio/art --manifest .audio/manifest.json`(build-segments の後、upload-r2 の前に
       実行し、`.audio/manifest.json` に `artKey` をマージする。埋め込みアートが無い
       トラックはスキップされ、`art_key` は NULL のままになる旨)」を追記する。
     - upload-r2 の説明に `--art .audio/art` オプションと `image/jpeg` アップロードの説明を
       追記する。
     - gen-seed の説明に `--mode update` の説明と、**「本番に既に投入済みのトラックへ
       art_key/reward_key を後から追加する手順」**を明記する:
       1. `.audio/manifest.json` の該当トラックへ `artKey`(および将来的な `rewardKey`)を
          追記する(`extract-art.mjs` が自動でやる。`rewardKey` は現状専用スクリプトが
          無いため手動でマニフェストに追記する)。
       2. `node scripts/gen-seed.mjs --manifest .audio/manifest.json --output
          reward-art-update.sql --mode update` で UPDATE 文のみの SQL を生成する。
       3. `npx wrangler d1 execute dream-believers-quiz --remote --file
          reward-art-update.sql` で本番に適用する(対象データベースを実行前に必ず確認する)。
     - リワードクリップ(コーラスのみの `.m4a`)は、専用の抽出スクリプトがまだ無いため、
       `ffmpeg` で手動生成し `wrangler r2 object put dream-believers-media/<random-hex-key>
       --file chorus.m4a --content-type audio/mp4 --remote` で投入したのち、上記の
       `--mode update` の手順でその `rewardKey` を該当トラックへ紐付ける、という当面の
       運用手順を明記する。
  5. 3つのスクリプトが構文エラーなく実行できることのみ確認する(実際の ffmpeg/wrangler 呼び
     出しは行わない)。
- Acceptance:
  - `scripts/extract-art.mjs` / 変更後の `scripts/gen-seed.mjs` / `scripts/upload-r2.mjs` が
    `node --check` を通過する。
  - `scripts/README.md` にアート抽出・アップロード・`--mode update` での本番既存行更新・
    リワードクリップの当面の投入手順が明記されている。
  - これらのファイルは `git status` に現れない(`scripts/` は gitignore 済み)。
- Verify:
  - `node --check scripts/extract-art.mjs && node --check scripts/gen-seed.mjs && node --check scripts/upload-r2.mjs && npm test`

### Task 19: フロント API クライアントへの reward/art 取得関数の追加

- Files to touch:
  - `src/api/client.ts`(`fetchReward` / `fetchArt` を追加)
  - `tests/client/api.test.ts`(上記の追加分をテスト)
- Files NOT to touch: `worker/**`, `src/hooks/useGame.ts`, `src/screens/**`, `src/api/types.ts`
  (新しい型は不要 — 生の `ArrayBuffer` / `Blob` を返す)
- New dependencies: none
- Steps(TASK-17 のエンドポイント契約に準拠):
  1. `src/api/client.ts` に以下を追加する(既存の `gamePath`/`throwForStatus` は再利用しない
     新規パス関数を用意する。`ApiError`/`API_BASE` は既存のものをそのまま使う):
     ```ts
     export async function fetchReward(
       sessionId: string,
       question: number,
     ): Promise<ArrayBuffer | null> {
       const response = await fetch(
         `${API_BASE}/game/${encodeURIComponent(sessionId)}/q/${question}/reward`,
       );
       if (response.status === 404) return null;
       throwForStatus(response);
       return response.arrayBuffer();
     }

     export async function fetchArt(
       sessionId: string,
       question: number,
     ): Promise<Blob | null> {
       const response = await fetch(
         `${API_BASE}/game/${encodeURIComponent(sessionId)}/q/${question}/art`,
       );
       if (response.status === 404) return null;
       throwForStatus(response);
       return response.blob();
     }
     ```
  2. `tests/client/api.test.ts` に以下のテストを追加する(既存の `global.fetch` モック
     パターンを踏襲): `fetchReward`/`fetchArt` がそれぞれ正しいメソッド(GET)・パス
     (`/api/game/<sid>/q/<n>/reward` および `/art`)を呼ぶこと、404 レスポンスのとき
     例外を投げずに `null` を返すこと、200 レスポンスのとき `arrayBuffer()`/`blob()` の
     戻り値がそのまま返ること、500 など 404 以外の非 2xx では `ApiError` を投げること。
- Acceptance:
  - `fetchReward`/`fetchArt` は 404 を正常系(`null`)として扱い、それ以外の失敗は
    既存の `ApiError` 契約どおりに throw する。
- Verify:
  - `npm test`

### Task 20: `useGame` 出題フェーズ状態機械(アナウンス/自動再生/正解演出/誤答演出)

- Files to touch:
  - `src/hooks/useGame.ts`
  - `tests/client/useGame.test.tsx`
- Files NOT to touch: `worker/**`, `src/screens/**`, `src/App.tsx`, `src/api/client.ts`,
  `src/audio/segmentPlayer.ts`, `src/audio/sfx.ts`, `src/audio/audioContext.ts`(いずれも
  import のみ、変更しない)
- New dependencies: none
- 前提: TASK-15(`src/audio/sfx.ts`, `src/audio/audioContext.ts`)と TASK-19
  (`fetchReward`/`fetchArt`)が完了していること。
- Steps(本アドオンの「オーディオ解錠」「出題フェーズ」「タイマーホールド」「ご褒美取得」
  の設計に準拠。既存のクライアント側テスト62本を壊さないことが必須):
  1. `src/hooks/useGame.ts` の import に以下を追加する:
     ```ts
     import { fetchArt, fetchReward } from '../api/client';
     import { getSharedAudioContext, unlockSharedAudioContext } from '../audio/audioContext';
     import { sfx } from '../audio/sfx';
     ```
  2. 新しい型と定数を追加してエクスポートする(定数値はテストから import して使う):
     ```ts
     export type QuestionPhase =
       | 'announcing'
       | 'playing'
       | 'correct-reveal'
       | 'wrong-feedback';

     export const ANNOUNCE_MS = 1_700;
     export const CORRECT_HOLD_MS = 1_300;
     export const WRONG_FEEDBACK_MS = 650;
     ```
  3. `UseGameResult` インターフェースに **オプショナル**な2フィールドを追加する(必ず `?`
     を付けること。既存の `tests/client/screens.test.tsx` の `gameState()` ヘルパーが
     これら無しのオブジェクトリテラルを `UseGameResult` として構築しているため、非
     オプショナルにすると型チェックが壊れる):
     ```ts
     questionPhase?: QuestionPhase | null;
     revealArtUrl?: string | null;
     ```
  4. フック内部に新しい state とその ref を追加する(既存の `phaseRef` 等と同じ手register
     パターン):
     ```ts
     const [questionPhase, setQuestionPhase] = useState<QuestionPhase | null>(null);
     const [revealArtUrl, setRevealArtUrl] = useState<string | null>(null);
     const questionPhaseRef = useRef<QuestionPhase | null>(null);
     const revealArtUrlRef = useRef<string | null>(null);
     const announceTimerRef = useRef<number | undefined>(undefined);
     const holdTimerRef = useRef<number | undefined>(undefined);
     const wrongTimerRef = useRef<number | undefined>(undefined);
     ```
  5. 以下のヘルパーを(`start`/`submitAnswer` より前に)`useCallback` 無しの通常関数として
     追加する:
     ```ts
     const setQuestionPhaseState = (next: QuestionPhase | null): void => {
       questionPhaseRef.current = next;
       setQuestionPhase(next);
     };

     const clearQuestionTimers = (): void => {
       if (announceTimerRef.current !== undefined) {
         window.clearTimeout(announceTimerRef.current);
         announceTimerRef.current = undefined;
       }
       if (holdTimerRef.current !== undefined) {
         window.clearTimeout(holdTimerRef.current);
         holdTimerRef.current = undefined;
       }
       if (wrongTimerRef.current !== undefined) {
         window.clearTimeout(wrongTimerRef.current);
         wrongTimerRef.current = undefined;
       }
     };

     const clearRevealArt = (): void => {
       if (revealArtUrlRef.current) {
         URL.revokeObjectURL(revealArtUrlRef.current);
         revealArtUrlRef.current = null;
       }
       setRevealArtUrl(null);
     };
     ```
  6. `beginPlaying` と `beginAnnounce` を `useCallback` で追加する(`beginPlaying` を先に
     定義し、`beginAnnounce` がそれを直接参照する。相互参照は無いので宣言順のみ気を付ける):
     ```ts
     const beginPlaying = useCallback((questionIndex: number, runId: number): void => {
       if (runId !== runIdRef.current) return;
       setQuestionPhaseState('playing');
       void playersRef.current[questionIndex]?.play();
     }, []);

     const beginAnnounce = useCallback((questionIndex: number, runId: number): void => {
       if (runId !== runIdRef.current) return;
       clearQuestionTimers();
       setQuestionPhaseState('announcing');
       sfx.play('announce');
       announceTimerRef.current = window.setTimeout(() => {
         announceTimerRef.current = undefined;
         beginPlaying(questionIndex, runId);
       }, ANNOUNCE_MS);
     }, [beginPlaying]);
     ```
  7. `start()` を変更する:
     - 関数本体の **最初の行**(既存の `if (startInFlightRef.current ...) return;` より前)に
       `unlockSharedAudioContext();` と `void sfx.preload();` を追加する(どちらも待たない。
       再入防止ガードより前に置くことで、`start()` が早期 return する場合でも解錠自体は
       必ずクリックのコールスタック内で発火する)。
     - `createSegmentPlayer({ fetchSegment: ... })` の呼び出しに
       `audioContext: getSharedAudioContext()` を追加し、10 プレイヤー全てが同一の
       共有コンテキストを使うようにする。
     - `changePhase('quiz')` を呼ぶ直前(`setFinalMs(null)` の後)に
       `clearRevealArt(); beginAnnounce(0, runId);` を追加する(質問0のアナウンスを
       開始してから `quiz` フェーズへ入る)。
  8. 経過タイム計測の `useEffect`(`updateElapsed` を含むもの)を変更し、
     `correct-reveal` 中は表示タイムを凍結する:
     ```ts
     const updateElapsed = (): void => {
       if (questionPhaseRef.current === 'correct-reveal') return;
       const penaltyMs = ...; // 既存のまま
       setElapsedMs(...); // 既存のまま
     };
     ```
     (依存配列 `[phase, startedAt, wrongCount, skipCount]` は変更しない。`questionPhaseRef`
     を読むだけなので再登録は不要)。
  9. `loadReveal` を新しい `useCallback` として追加する(正解時のご褒美をベストエフォートで
     取得・再生する。失敗は全て握りつぶし、プレイヤー体験に一切影響させない):
     ```ts
     const loadReveal = useCallback(
       async (sid: string, questionIndex: number, runId: number): Promise<void> => {
         try {
           const artBlob = await fetchArt(sid, questionIndex).catch(() => null);
           if (runId !== runIdRef.current || questionPhaseRef.current !== 'correct-reveal') {
             return;
           }
           if (artBlob) {
             const url = URL.createObjectURL(artBlob);
             revealArtUrlRef.current = url;
             setRevealArtUrl(url);
           }
         } catch {
           // ベストエフォート: アート取得の失敗はプレイヤーに表面化させない
         }

         try {
           const rewardBuffer = await fetchReward(sid, questionIndex).catch(() => null);
           if (
             !rewardBuffer ||
             runId !== runIdRef.current ||
             questionPhaseRef.current !== 'correct-reveal'
           ) {
             return;
           }
           const context = getSharedAudioContext();
           const decoded = await context.decodeAudioData(rewardBuffer.slice(0));
           if (runId !== runIdRef.current || questionPhaseRef.current !== 'correct-reveal') {
             return;
           }
           const source = context.createBufferSource();
           source.buffer = decoded;
           source.connect(context.destination);
           source.start(0);
         } catch {
           // ベストエフォート: リワードクリップは現状未投入であり、404/デコード失敗は
           // プレイヤーに表面化させない
         }
       },
       [],
     );
     ```
  10. `submitAnswer` を変更する。誤答分岐(`if (!response.correct)`)に、既存の
      `jumpBy`/`wrongCount` 更新の後で以下を追加する:
      ```ts
      sfx.play('wrong');
      clearQuestionTimers();
      setQuestionPhaseState('wrong-feedback');
      const activeRunId = runIdRef.current;
      wrongTimerRef.current = window.setTimeout(() => {
        wrongTimerRef.current = undefined;
        if (activeRunId !== runIdRef.current) return;
        setQuestionPhaseState('playing');
      }, WRONG_FEEDBACK_MS);
      ```
      (プレイヤー自体は pause しない。既存の `jumpBy(SEGMENT_LENGTH_MS)` のみで進行を続ける)。
  11. `submitAnswer` の正解・未完了分岐(既存の
      `const nextQuestion = questionIndex + 1; playersRef.current[questionIndex]?.pause(); ...`
      のブロック)を、以下の内容へ置き換える:
      ```ts
      const activeRunId = runIdRef.current;
      sfx.play('correct');
      playersRef.current[questionIndex]?.pause();
      clearQuestionTimers();
      setQuestionPhaseState('correct-reveal');
      void loadReveal(activeSessionId, questionIndex, activeRunId);

      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = undefined;
        if (activeRunId !== runIdRef.current) return;
        clearRevealArt();
        const nextQuestion = questionIndex + 1;
        currentQuestionRef.current = nextQuestion;
        setCurrentQuestion(nextQuestion);
        setPlayer(playersRef.current[nextQuestion] ?? null);
        beginAnnounce(nextQuestion, activeRunId);
      }, CORRECT_HOLD_MS);

      return response;
      ```
  12. 同じく `submitAnswer` の完走分岐(`if (response.finalMs !== undefined)`)を以下へ
      置き換える:
      ```ts
      const activeRunId = runIdRef.current;
      sfx.play('correct');
      playersRef.current[questionIndex]?.pause();
      clearQuestionTimers();
      setQuestionPhaseState('correct-reveal');
      void loadReveal(activeSessionId, questionIndex, activeRunId);

      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = undefined;
        if (activeRunId !== runIdRef.current) return;
        clearRevealArt();
        setFinalMs(response.finalMs!);
        setElapsedMs(response.finalMs!);
        setQuestionPhaseState(null);
        changePhase('result');
      }, CORRECT_HOLD_MS);

      return response;
      ```
  13. マウント解除時のクリーンアップ用に新しい `useEffect` を追加する:
      ```ts
      useEffect(() => {
        return () => {
          clearQuestionTimers();
          clearRevealArt();
        };
      }, []);
      ```
  14. 戻り値オブジェクトに `questionPhase,` と `revealArtUrl,` を追加する。
  15. `tests/client/useGame.test.tsx` を更新する:
      - ファイル冒頭で `import { ANNOUNCE_MS, CORRECT_HOLD_MS, WRONG_FEEDBACK_MS, useGame }
        from '../../src/hooks/useGame';` のように定数を import する。
      - 既存の `vi.mock('../../src/api/client', ...)` ファクトリに
        `fetchReward: vi.fn(async () => null), fetchArt: vi.fn(async () => null),` を追加する。
      - 新しい `vi.mock('../../src/audio/sfx', () => ({ sfx: { preload: vi.fn(async () =>
        undefined), play: vi.fn() } }));` を追加する。
      - 新しい `vi.mock('../../src/audio/audioContext', () => { const context = {
        state: 'running', resume: vi.fn(async () => undefined), decodeAudioData: vi.fn(async
        () => ({})), createBufferSource: vi.fn(() => ({ connect: vi.fn(), start: vi.fn() })),
        destination: {} }; return { getSharedAudioContext: vi.fn(() => context),
        unlockSharedAudioContext: vi.fn() }; });` を追加する。
      - `beforeEach` に `vi.useFakeTimers({ shouldAdvanceTime: true });` を追加し、
        `afterEach` で `vi.useRealTimers();` する。
      - 既存の4テストすべてに対して、`start()` の直後に
        `await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);` を挟んでから
        アサーションを続ける(`start()` 完了時点ではまだ `questionPhase === 'announcing'`
        であり、`players[0].play` は `ANNOUNCE_MS` 経過後にしか呼ばれないため)。
      - 「10問正解して result へ」のテストと「誤答」のテストは、各 `submitAnswer` 呼び出しの
        `act` 内で追加の `await vi.advanceTimersByTimeAsync(...)` を挟む:
        正解(未完走)の場合は `CORRECT_HOLD_MS` 経過後に `currentQuestion` が進み
        `questionPhase` が次問の `'announcing'` になる。さらに次の問題を解答する前に
        `ANNOUNCE_MS` を進めて `'playing'` に戻す必要がある(ループの各反復で
        `CORRECT_HOLD_MS + ANNOUNCE_MS` を進める)。10問目の正解では `CORRECT_HOLD_MS`
        経過後に `state === 'result'` になることを assert する。誤答の場合は
        `WRONG_FEEDBACK_MS` 経過後に `questionPhase` が `'playing'` に戻ることを assert する。
      - 新しいテストを追加する:
        (a) `start()` 呼び出し時、`unlockSharedAudioContext` と `sfx.preload` が
            (`await` する前に)同期的に一度だけ呼ばれていること(`start()` を呼んだ直後、
            `await` する前に mock の呼び出し回数を確認する)。
        (b) `createSegmentPlayer` が10回とも `audioContext: <getSharedAudioContext() の
            戻り値>` を含むオプションで呼ばれていること。
        (c) `start()` 直後は `questionPhase === 'announcing'` かつ `sfx.play` が
            `'announce'` で呼ばれていること。`ANNOUNCE_MS` 進めると `questionPhase ===
            'playing'` になり `players[0].play` が呼ばれていること。
        (d) 誤答時 `sfx.play` が `'wrong'` で呼ばれ `questionPhase === 'wrong-feedback'` に
            なること。プレイヤーは `pause` されないこと(`players[0].pause` が呼ばれない
            ことを assert)。
        (e) 正解(未完走)時 `sfx.play` が `'correct'` で呼ばれ、`players[questionIndex].pause`
            が呼ばれ、`questionPhase === 'correct-reveal'` になること。`CORRECT_HOLD_MS`
            進めるまで `currentQuestion` が進まないこと。
        (f) `fetchArt` が Blob 相当のオブジェクトを返すようにモックし(実体は
            `new Blob()` で可、jsdom で利用可能)、`global.URL.createObjectURL` を
            `vi.fn(() => 'blob:fake')` でモックした上で、正解直後に `revealArtUrl` が
            `'blob:fake'` になることを assert する。
        (g) `fetchReward` が `null`(既定のモック)のとき、`decodeAudioData`/
            `createBufferSource` が呼ばれないことを assert する(404 の実質的なベスト
            エフォート・スキップ)。
- Acceptance:
  - `start()` 呼び出し時に共有 `AudioContext` の解錠がクリックの呼び出しスタック内
    (`await` 前)で発火する。
  - 出題は「アナウンス(SFX)→自動再生→(誤答なら SFX+650ms 演出→再生続行 / 正解なら
    SFX+タイマーホールド→次問アナウンス、または10問目なら結果画面へ)」の状態機械どおりに
    遷移する。
  - `finalMs`/ペナルティ計算など既存のサーバー権威の計時契約は一切変更されていない。
  - 既存4テスト+新規テストすべてが緑。
- Verify:
  - `npm test`

### Task 21: `QuizScreen` へのアナウンス/正解演出オーバーレイ統合と `App` 配線

- Files to touch:
  - `src/screens/QuizScreen.tsx`
  - `src/App.tsx`
  - `tests/client/screens.test.tsx`
- Files NOT to touch: `worker/**`, `src/hooks/useGame.ts`(import のみ), `src/audio/**`
  (QuizScreen は SFX を直接呼ばない。SFX 再生は TASK-20 で `useGame.ts` に閉じている)
- New dependencies: none
- 前提: TASK-20 完了(`useGame` が `questionPhase`/`revealArtUrl` を返す)。
- Steps:
  1. `src/screens/QuizScreen.tsx` の先頭 import に
     `import type { QuestionPhase } from '../hooks/useGame';` を追加する。
  2. `QuizScreenProps` に以下を **追加**する(オプショナル。既存 props は一切変更しない):
     ```ts
     questionPhase?: QuestionPhase | null;
     revealArtUrl?: string | null;
     ```
     関数引数の分割代入にも既定値付きで追加する:
     `questionPhase = null, revealArtUrl = null,`。
  3. 既存の `feedback`(誤答シェイク/ペナルティポップ用ローカル state、650ms 自動クリア)は
     **一切変更しない**。以下は完全に追加のブロックとして実装する。
  4. `<section className="screen quiz-screen ...">` の内部、`<PlayDial .../>` の直前に
     アナウンスオーバーレイを追加する:
     ```tsx
     {questionPhase === 'announcing' ? (
       <div aria-live="polite" className="announce-overlay" role="status">
         <span className="announce-overlay__text">
           Q{String(questionNumber).padStart(2, '0')}
         </span>
       </div>
     ) : null}
     ```
  5. 同じ位置に正解演出オーバーレイを追加する:
     ```tsx
     {questionPhase === 'correct-reveal' ? (
       <div aria-live="polite" className="correct-reveal-overlay" role="status">
         <span className="correct-reveal-overlay__text">正解!</span>
         {revealArtUrl ? (
           <img
             alt=""
             className="correct-reveal-overlay__art"
             src={revealArtUrl}
           />
         ) : null}
       </div>
     ) : null}
     ```
  6. `<ChoiceGrid .../>` の `disabled` 式を拡張し、アナウンス中・正解演出中は選択肢を
     押せないようにする:
     ```tsx
     disabled={
       isSubmitting ||
       choices.length === 0 ||
       questionPhase === 'announcing' ||
       questionPhase === 'correct-reveal'
     }
     ```
  7. `src/App.tsx` の `<QuizScreen .../>` 呼び出しに以下の2 prop を追加する:
     ```tsx
     questionPhase={game.questionPhase ?? null}
     revealArtUrl={game.revealArtUrl ?? null}
     ```
  8. `tests/client/screens.test.tsx` を更新する:
     - `gameState()` ヘルパーの既定オブジェクトに `questionPhase: null, revealArtUrl: null,`
       を追加する(型を明示的に満たすため。実際には optional なので省略しても壊れないが、
       他のテストとの一貫性のため明記する)。
     - 新しい `it` を追加: `questionPhase="announcing"` を渡して `QuizScreen` を描画し、
       `screen.getByRole('status')` にアナウンステキストが含まれること、6つの選択肢ボタンが
       すべて `disabled` であることを assert する。
     - 新しい `it` を追加: `questionPhase="correct-reveal"` かつ `revealArtUrl="blob:fake"`
       を渡して描画し、`正解!` のテキストと `src="blob:fake"` の `<img>` が存在することを
       assert する。
     - 新しい `it` を追加: `questionPhase="correct-reveal"` かつ `revealArtUrl={null}` を
       渡した場合は `<img>` が存在しないことを assert する。
     - 既存の「誤答フィードバック」テスト(`.quiz-screen.shake` を assert するもの)は
       **無変更のまま**残し、それが変わらず緑であることを確認する。
  8. (任意, 必須ではない)`src/index.css` に `.announce-overlay` /
     `.correct-reveal-overlay` / `.correct-reveal-overlay__art` の最低限のレイアウト用
     ルールを追加してよいが、`npm run build`/`npm test` の合否には影響しないため、時間が
     無ければ省略してよい。
- Acceptance:
  - アナウンス/正解演出オーバーレイが `questionPhase` に応じて表示・非表示され、既存の
    誤答シェイク演出とは独立に共存する。
  - アナウンス中・正解演出中は選択肢ボタンが操作不能になる。
  - 既存の全 `screens.test.tsx` テスト(App/StartScreen/QuizScreen/ResultScreen/
    RankingScreen)が無変更のまま引き続き緑。
- Verify:
  - `npm test && npm run build && npm run typecheck`

### Task 22: デプロイ手順書の更新(migration 0002・新パイプライン・新エンドポイントの反映)

- Files to touch:
  - `docs/deploy.md`
- Files NOT to touch: `worker/**`, `src/**`, `migrations/**`, `scripts/**`, `wrangler.jsonc`
- New dependencies: none
- Steps:
  1. `docs/deploy.md` の「D1 マイグレーション」節に、`migrations/0002_add_reward_art_keys.sql`
     が `art_key`/`reward_key`(nullable)を `tracks` に追加する追加専用 migration である旨、
     および本アドオンをデプロイする際は
     `npx wrangler d1 migrations apply dream-believers-quiz --remote` を **再実行**する
     必要がある旨を追記する(実行そのものはこのタスクでは行わない)。
  2. 「音源と seed の投入」節に、`extract-art.mjs` の実行位置(build-segments の後、
     upload-r2 の前)と、`gen-seed.mjs --mode update` を使って本番に既に投入済みの
     トラックへ `art_key`/`reward_key` を後付けする手順への参照を1〜2段落で追記する
     (詳細手順は `scripts/README.md` を参照させる形でよく、`docs/deploy.md` 側は概要と
     リンクのみでよい)。
  3. 新しいセクション(または既存の「運用上の注意」節への追記)として、
     `GET /api/game/:sid/q/:n/reward` と `GET /api/game/:sid/q/:n/art` が
     「そのセッションでその問題が正解済み」かつ「対応するキーが非 NULL」のときのみ 200 を
     返し、それ以外は理由を問わず 404 になる仕様であることを明記し、リワードクリップは
     本アドオンの時点では全トラック未投入のため `/reward` は常に 404 になるのが正常である
     旨を明記する。
- Acceptance:
  - `docs/deploy.md` を読むだけで、migration 0002 の再適用が必要なこと、アート/リワードの
    投入・後付け手順、reward/art エンドポイントの 404 仕様(特にリワードは今は必ず 404 で
    正常)が分かる。
  - `npm test` / `npm run build` / `npm run typecheck` が引き続き緑(累積した全タスクの
    最終確認)。
- Verify:
  - `npm test && npm run build && npm run typecheck`
