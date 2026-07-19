import type { D1Database } from '@cloudflare/workers-types';
import type { SessionState } from './domain/session';

const SESSION_EXPIRY_MS = 2 * 60 * 60 * 1000;

export interface Track {
  id: number;
  title: string;
  clipMs: number;
  segCount: number;
}

export interface Session {
  id: string;
  startedAt: number;
  state: SessionState;
  finishedAt: number | null;
  finalMs: number | null;
  ranked: number;
  createdAt: number;
}

export interface NewSession {
  id: string;
  startedAt: number;
  state: SessionState;
  createdAt: number;
}

export interface NewRanking {
  sessionId: string;
  name: string;
  timeMs: number;
  createdAt: number;
}

export interface RankingEntry {
  name: string;
  timeMs: number;
  createdAt: number;
}

interface TrackRow {
  id: number;
  title: string;
  clip_ms: number;
  seg_count: number;
}

interface SegmentRow {
  r2_key: string;
}

interface SessionRow {
  id: string;
  started_at: number;
  state: string;
  finished_at: number | null;
  final_ms: number | null;
  ranked: number;
  created_at: number;
}

interface RankingRow {
  name: string;
  time_ms: number;
  created_at: number;
}

export async function getAllTrackIds(db: D1Database): Promise<number[]> {
  const result = await db
    .prepare('SELECT id FROM tracks ORDER BY id ASC')
    .all<{ id: number }>();

  return result.results.map((row) => row.id);
}

export async function getTrack(
  db: D1Database,
  id: number,
): Promise<Track | null> {
  const row = await db
    .prepare(
      'SELECT id, title, clip_ms, seg_count FROM tracks WHERE id = ?1',
    )
    .bind(id)
    .first<TrackRow>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    clipMs: row.clip_ms,
    segCount: row.seg_count,
  };
}

export async function getSegmentKey(
  db: D1Database,
  trackId: number,
  idx: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      'SELECT r2_key FROM segments WHERE track_id = ?1 AND idx = ?2',
    )
    .bind(trackId, idx)
    .first<SegmentRow>();

  return row?.r2_key ?? null;
}

export async function insertSession(
  db: D1Database,
  row: NewSession,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id, started_at, state, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(row.id, row.startedAt, JSON.stringify(row.state), row.createdAt)
    .run();
}

export async function getSession(
  db: D1Database,
  sid: string,
): Promise<Session | null> {
  const row = await db
    .prepare(
      `SELECT id, started_at, state, finished_at, final_ms, ranked, created_at
       FROM sessions
       WHERE id = ?1`,
    )
    .bind(sid)
    .first<SessionRow>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    startedAt: row.started_at,
    state: JSON.parse(row.state) as SessionState,
    finishedAt: row.finished_at,
    finalMs: row.final_ms,
    ranked: row.ranked,
    createdAt: row.created_at,
  };
}

export async function updateSessionState(
  db: D1Database,
  sid: string,
  state: SessionState,
): Promise<void> {
  await db
    .prepare('UPDATE sessions SET state = ?1 WHERE id = ?2')
    .bind(JSON.stringify(state), sid)
    .run();
}

export async function sweepExpiredSessions(
  db: D1Database,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM sessions
       WHERE finished_at IS NULL
         AND created_at < ?1`,
    )
    .bind(now - SESSION_EXPIRY_MS)
    .run();

  return result.meta.changes;
}

export async function insertRanking(
  db: D1Database,
  row: NewRanking,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ranking (session_id, name, time_ms, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .bind(row.sessionId, row.name, row.timeMs, row.createdAt)
    .run();
}

export async function getRankingTop(
  db: D1Database,
): Promise<RankingEntry[]> {
  const result = await db
    .prepare(
      `SELECT name, time_ms, created_at
       FROM ranking
       ORDER BY time_ms ASC, created_at ASC
       LIMIT 50`,
    )
    .all<RankingRow>();

  return result.results.map((row) => ({
    name: row.name,
    timeMs: row.time_ms,
    createdAt: row.created_at,
  }));
}

export async function getRankByTime(
  db: D1Database,
  timeMs: number,
  createdAt: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM ranking
       WHERE time_ms < ?1
          OR (time_ms = ?1 AND created_at < ?2)`,
    )
    .bind(timeMs, createdAt)
    .first<{ count: number }>();

  return Number(row?.count ?? 0) + 1;
}
