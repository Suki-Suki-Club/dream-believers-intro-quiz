/// <reference types="@cloudflare/vitest-pool-workers" />

import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from './helpers/applyMigrations';
import { seedGameData } from './helpers/seed';

interface StartResponse {
  sessionId: string;
}

async function startGame(): Promise<string> {
  const response = await SELF.fetch('http://x/api/game/start', {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as StartResponse).sessionId;
}

async function finishGame(
  finalMs = 1234,
  finishedAt = Date.now(),
): Promise<string> {
  const sessionId = await startGame();
  await env.DB.prepare(
    `UPDATE sessions
     SET finished_at = ?1, final_ms = ?2, ranked = 0
     WHERE id = ?3`,
  )
    .bind(finishedAt, finalMs, sessionId)
    .run();
  return sessionId;
}

async function postRanking(sessionId: string, name: unknown): Promise<Response> {
  return SELF.fetch('http://x/api/ranking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, name }),
  });
}

describe('ranking endpoints', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedGameData();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM ranking').run();
    await env.DB.prepare('DELETE FROM sessions').run();
  });

  it('registers a completed session, sanitizes the name, and returns its rank', async () => {
    const earlierSessionId = await finishGame(1000, 100);
    await postRanking(earlierSessionId, 'Earlier');

    const sessionId = await finishGame(2000, 200);
    const response = await postRanking(sessionId, '  Alice\u0000\n');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rank: 2 });

    const row = await env.DB.prepare(
      'SELECT name, time_ms FROM ranking WHERE session_id = ?1',
    )
      .bind(sessionId)
      .first<{ name: string; time_ms: number }>();
    expect(row).toEqual({ name: 'Alice', time_ms: 2000 });

    const session = await env.DB.prepare(
      'SELECT ranked FROM sessions WHERE id = ?1',
    )
      .bind(sessionId)
      .first<{ ranked: number }>();
    expect(session?.ranked).toBe(1);
  });

  it('rejects duplicate and unfinished registrations', async () => {
    const completedSessionId = await finishGame();
    expect((await postRanking(completedSessionId, 'Alice')).status).toBe(200);
    expect((await postRanking(completedSessionId, 'Bob')).status).toBe(409);

    const unfinishedSessionId = await startGame();
    expect((await postRanking(unfinishedSessionId, 'Alice')).status).toBe(409);
  });

  it('returns at most 50 entries ordered by time and creation time', async () => {
    const statements = [];
    for (let index = 0; index < 55; index += 1) {
      const sessionId = `ranking-test-${index}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO sessions
             (id, started_at, state, finished_at, final_ms, ranked, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
        ).bind(
          sessionId,
          index,
          JSON.stringify({ current: 9, questions: [] }),
          index + 1,
          1000 + index,
          index,
        ),
      );
      statements.push(
        env.DB.prepare(
          `INSERT INTO ranking (session_id, name, time_ms, created_at)
           VALUES (?1, ?2, ?3, ?4)`,
        ).bind(sessionId, `Name ${index}`, 1000 + index, index),
      );
    }
    await env.DB.batch(statements);

    const response = await SELF.fetch('http://x/api/ranking');
    expect(response.status).toBe(200);

    const entries = (await response.json()) as Array<{
      name: string;
      timeMs: number;
      createdAt: number;
    }>;
    expect(entries).toHaveLength(50);
    expect(entries[0]).toEqual({
      name: 'Name 0',
      timeMs: 1000,
      createdAt: 0,
    });
    expect(entries[49]).toEqual({
      name: 'Name 49',
      timeMs: 1049,
      createdAt: 49,
    });
    expect(entries.every((entry, index) => entry.timeMs === 1000 + index)).toBe(
      true,
    );
  });
});
