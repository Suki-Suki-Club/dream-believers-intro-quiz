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

CREATE INDEX idx_ranking_time ON ranking(time_ms ASC, created_at ASC);
CREATE INDEX idx_sessions_created ON sessions(created_at);
