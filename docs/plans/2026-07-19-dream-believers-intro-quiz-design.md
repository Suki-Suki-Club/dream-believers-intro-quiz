# Dream Believers イントロクイズ 設計ドキュメント

日付: 2026-07-19
リポジトリ: `Suki-Suki-Club/dream-believers-intro-quiz`(PUBLIC)

## 1. 概要

Dream Believers の多数あるバージョン違いをイントロ(〜1サビ終わり)で聴き当てる Web クイズ。
計 10 問・重複なしで、全問正解までの所要時間を競い、グローバルランキングに登録できる。
開発者ツール(ネットワークタブ等)を使っても実時間より先の音声が入手できない「時計ゲート配信」を核とするチート耐性設計。

## 2. 確定仕様(ゲームルール)

- 出題プール: Dream Believers の各バージョン 10〜15 種(リストは音源投入時に確定)
- 毎ゲーム 10 問をランダム抽選、重複なし。出題順・選択肢順もセッションごとにシャッフル
- 回答形式: 6 択(正解 + プールからランダム 5、バージョン名を表示)
- スコア = 実時間(1 問目開始〜10 問目正解) + ペナルティ合計。小さいほど上位
- 誤答: +5s ペナルティ、再生位置が現在位置から +5s 強制ジャンプ。同じ問題を正解するまで継続
- 先送りボタン(能動): +5s ペナルティ、再生位置が現在位置から +5s ジャンプ
- 再生: クリップ(曲頭〜1サビ終わり)を頭から連続再生。取得済み範囲内のシーク・再聴は自由
- クリップ終端に達したら停止。取得済み範囲の再聴は引き続き可能
- ランキング: 匿名 + 名前入力(完走セッションにつき 1 回のみ登録)

### タイム計算(すべてサーバー側)

```
確定タイム = (最終問正解時刻 - ゲーム開始時刻) + 5000ms × (誤答回数 + 先送り回数)
```

クライアント表示のタイマーは目安であり、確定値はサーバーのタイムスタンプのみから算出する。

## 3. アーキテクチャ

```
React SPA (Workers 静的アセット・課金対象外)
   │  /api/*
   ▼
Cloudflare Workers + Hono
   ├─ D1: tracks / segments / sessions / ranking
   └─ R2: 音声セグメント(不透明キー、Worker 経由でのみ配信)
```

- KV は使わない。KV 無料枠(書込 1,000/日)はセッション更新で即枯渇するため、セッションも D1 に置く
- 音声は必ず Worker をプロキシして配信し、R2 キー・署名 URL をクライアントに出さない

### 技術スタック(既存 org 踏襲)

- バックエンド: Cloudflare Workers + Hono + TypeScript
- フロントエンド: React 19 + Vite + Tailwind CSS 4 + `@suki-suki-club/link-like-ui`
- wrangler.jsonc: `assets.directory: ./dist`、カスタムドメイン `intro-quiz.sukisuki.club`
- テスト: vitest

## 4. 音声配信とチート耐性(本設計の核)

### 4.1 セグメント分割(プレイヤーには不可視)

- 各バージョンのクリップを 5 秒単位のセグメントに分割して R2 に格納
- ファイル名はランダム hex の不透明キー。メタデータ・タグは全除去
- セグメント境界は 25ms オーバーラップ付きで切り出し、クライアントでクロスフェード結合してギャップレス再生

### 4.2 時計ゲート配信

セグメント k(開始位置 k×5000ms)の配信可否をサーバー時計で判定する:

```
配信可能位置(ms) = min( 現在問題の開始からのサーバー経過時間
                        + 5000 × 現在問題のジャンプ回数(誤答+先送り)
                        + 2000 (先読みバッファ),
                        クリップ終端 )

配信条件: k × 5000 < 配信可能位置
```

- 実時間で聴ける範囲 + ジャンプで支払った範囲しかブラウザに届かない
- blob を抽出しても「その時点までに正規に聴ける音声」しか含まれない
- 倍速再生しても続きのセグメントが来ないため無意味
- ジャンプ時は配信可能位置も +5s 進むため、ジャンプ直後のセグメントは即配信され再生が途切れない

### 4.3 プリフェッチ

- ゲーム開始直後に全 10 問の第 1 セグメント(k=0)を並列取得
- ネットワークタブに見えるのは無情報の blob 10 個のみ。出題切り替えは待機ゼロ
- k=0 は常に配信可、k≥1 は「現在の問題」のみ時計ゲート判定

### 4.4 その他の対策

- 正解判定・計時・ペナルティ記録はすべてサーバー側。クライアントは表示のみ
- 音声 URL は位置ベース(`/q/:n/seg/:k`)で R2 キーと無関係 → リピーターが URL⇔正解対応を暗記できない
- 総当たり抑止: 誤答 +5s(6 択の総当たり期待値 +12.5s/問)により普通に聴くほうが速い
- 正解マッピング(seed SQL)・音源・生成スクリプトはリポジトリに含めない(PUBLIC リポのため必須)

## 5. データモデル(D1)

```sql
CREATE TABLE tracks (
  id         INTEGER PRIMARY KEY,
  title      TEXT NOT NULL UNIQUE,   -- バージョン名(選択肢表示用)
  clip_ms    INTEGER NOT NULL,       -- クリップ総尺
  seg_count  INTEGER NOT NULL
);

CREATE TABLE segments (
  track_id   INTEGER NOT NULL REFERENCES tracks(id),
  idx        INTEGER NOT NULL,       -- 0 始まり
  r2_key     TEXT NOT NULL,          -- 不透明ランダム hex
  PRIMARY KEY (track_id, idx)
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,     -- UUID
  started_at   INTEGER NOT NULL,     -- epoch ms(サーバー時刻)
  state        TEXT NOT NULL,        -- JSON(下記)
  finished_at  INTEGER,
  final_ms     INTEGER,              -- 確定タイム
  ranked       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE ranking (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL UNIQUE REFERENCES sessions(id),
  name        TEXT NOT NULL,         -- 最大 20 文字、サニタイズ
  time_ms     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
```

`sessions.state`(JSON):

```jsonc
{
  "current": 3,                  // 現在の問題 index
  "questions": [
    {
      "trackId": 7,
      "choices": [7, 2, 11, 5, 1, 9],  // track id、表示はサーバーが title に解決
      "startedAt": 1752900000000,      // この問題の開始 epoch ms
      "wrong": 1,                       // 誤答回数
      "skips": 0,                       // 先送り回数
      "answeredAt": null                // 正解時刻
    }
    // × 10
  ]
}
```

- セッション更新は 1 イベント 1 UPDATE(answer / skip)。約 15〜20 行書込/ゲーム
- 期限切れセッション(created_at から 2h 超・未完走)は start 時に確率的に削除(cron 不要)

## 6. API(Hono)

| メソッド/パス | 内容 |
| --- | --- |
| `POST /api/game/start` | 10 問抽選・セッション作成。→ `{ sessionId, questions: [{ choices: [6 バージョン名] }] }`(正解 index は返さない) |
| `GET /api/game/:sid/q/:n/seg/:k` | 音声セグメント(`audio/mp4`)。k=0 は常時可、k≥1 は現在問題のみ時計ゲート判定。不許可は 403 |
| `POST /api/game/:sid/q/:n/answer` | body `{ choice: 0-5 }`。誤答: wrong++、`{ correct: false }`。正解: 次問へ遷移(次問 startedAt=now)。10 問目なら finished_at/final_ms 確定し `{ correct: true, finalMs }` |
| `POST /api/game/:sid/q/:n/skip` | skips++(+5s)。→ 204 |
| `POST /api/ranking` | body `{ sessionId, name }`。完走済み・未登録セッションのみ受理。→ 登録順位 |
| `GET /api/ranking` | 上位 50 件 `{ name, timeMs, createdAt }` |

- `:n` が current と不一致の answer/skip/seg(k≥1) は 409/403
- name は trim・20 文字制限・制御文字除去

## 7. クライアント再生(Web Audio)

- セグメントを `fetch` → `decodeAudioData` → PCM を単一の成長バッファに連結
- 境界は 25ms 等パワークロスフェードで結合しギャップレス化(AAC エンコーダディレイ対策)
- 再生は `AudioBufferSourceNode` を位置指定で張り直し。シークバーは取得済み範囲のみ操作可
- 再生追従で次セグメントを先読み(配信可能位置はバッファ 2s 込みで前進し続けるため途切れない)
- 誤答/先送り時: API 応答後に位置 = 現在位置 + 5s へジャンプして再生継続
- コーデック: AAC-LC 96kbps `.m4a`。`decodeAudioData` が全主要ブラウザ(Safari 含む)で対応

## 8. 音源パイプライン(ローカル専用・非コミット)

`scripts/`(.gitignore 対象)に配置。手元の FLAC から:

1. `tracks.yaml` を手書き: バージョン名・FLAC パス・クリップ開始秒・1サビ終了秒
2. スクリプト(ffmpeg)実行:
   - FLAC → クリップ切り出し → 5s+25ms オーバーラップでセグメント化 → AAC-LC 96kbps m4a(メタデータ除去)
   - セグメントごとにランダム hex キー生成
   - `wrangler r2 object put` で R2 アップロード
   - `seed.sql`(tracks/segments INSERT)生成 → `wrangler d1 execute` で投入
3. `scripts/`・`*.flac`・`seed.sql`・生成物はすべて .gitignore(PUBLIC リポに正解対応を漏らさない)

## 9. UI 画面フロー

1. **スタート画面**: タイトル、ルール説明、スタートボタン(押下で start API + プリフェッチ)
2. **クイズ画面**: 問題番号(n/10)、再生・シークバー(取得済み範囲)、6 択グリッド、先送りボタン、経過タイム + ペナルティ表示。誤答時はシェイク等のフィードバック
3. **結果画面**: 確定タイム、内訳(実時間 / 誤答ペナルティ / 先送りペナルティ)、名前入力 → ランキング登録
4. **ランキング画面**: 上位 50 件、自分の順位ハイライト

## 10. 無料枠試算

| リソース | 消費/ゲーム | 無料枠 | 目安上限 |
| --- | --- | --- | --- |
| Workers リクエスト | 約 50(API のみ、アセットは対象外) | 100k/日 | 約 2,000 ゲーム/日 |
| D1 行書込 | 約 20 | 100k/日 | 約 5,000 ゲーム/日 |
| D1 行読取 | 数百 | 5M/日 | 無視できる |
| R2 Class B 読取 | 約 30 | 10M/月 | 無視できる |
| R2 ストレージ | — | 10GB | 全音源 ~20MB |

KV は書込 1,000/日で成立しないため不採用(前述)。

## 11. テスト方針

- vitest。verify コマンド: `npm test`
- 重点: 時計ゲート判定(境界値・ジャンプ加算)、タイム確定計算、answer/skip の状態遷移、ランキング登録ガード(未完走・二重登録)、出題抽選(重複なし・選択肢に正解含む)
- Workers 実行系は `@cloudflare/vitest-pool-workers` で D1/R2 バインディングをテスト

## 12. スコープ外(将来拡張)

- 認証付きランキング(なりすまし防止)
- 他楽曲への展開(データモデルは tracks 追加で対応可能)
- 難易度モード(基本秒数・ペナルティ調整)
