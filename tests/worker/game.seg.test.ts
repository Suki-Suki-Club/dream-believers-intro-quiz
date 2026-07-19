/// <reference types="@cloudflare/vitest-pool-workers" />

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from './helpers/applyMigrations';
import { seedGameData } from './helpers/seed';

interface StartResponse {
  sessionId: string;
  questions: Array<{ choices: string[] }>;
}

interface TestSessionState {
  current: number;
  questions: Array<{
    trackId: number;
    choices: number[];
    startedAt: number;
    wrong: number;
    skips: number;
    answeredAt: number | null;
  }>;
}

async function startGame(): Promise<string> {
  const response = await SELF.fetch('http://x/api/game/start', {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as StartResponse).sessionId;
}

async function getSessionState(sessionId: string): Promise<TestSessionState> {
  const row = await env.DB.prepare('SELECT state FROM sessions WHERE id = ?1')
    .bind(sessionId)
    .first<{ state: string }>();
  expect(row).not.toBeNull();
  return JSON.parse(row!.state) as TestSessionState;
}

describe('GET /api/game/:sid/q/:n/seg/:k', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedGameData();
  });

  it('returns segment zero for every question immediately after start', async () => {
    const sessionId = await startGame();

    for (let question = 0; question < 10; question += 1) {
      const response = await SELF.fetch(
        `http://x/api/game/${sessionId}/q/${question}/seg/0`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('audio/mp4');
      expect(response.headers.get('Cache-Control')).toContain('no-store');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.length).toBe(5);
      expect(Array.from(bytes.slice(0, 3))).toEqual([0x44, 0x42, 0x53]);
      expect(bytes[4]).toBe(0);
    }
  });

  it('gates later segments by the current question clock', async () => {
    const sessionId = await startGame();

    const blocked = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/seg/1`,
    );
    expect(blocked.status).toBe(403);

    const state = await getSessionState(sessionId);
    state.questions[0].wrong = 1;
    await env.DB.prepare('UPDATE sessions SET state = ?1 WHERE id = ?2')
      .bind(JSON.stringify(state), sessionId)
      .run();

    const allowed = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/seg/1`,
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('Content-Type')).toBe('audio/mp4');
    await allowed.arrayBuffer();
  });

  it('rejects gated segments for a non-current question', async () => {
    const sessionId = await startGame();
    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/1/seg/1`,
    );

    expect(response.status).toBe(403);
  });

  it('does not expose the opaque R2 key in the returned bytes', async () => {
    const sessionId = await startGame();
    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/seg/0`,
    );
    const body = new TextDecoder().decode(await response.arrayBuffer());

    expect(body).not.toContain('seed-track-');
  });

  it('returns 404 for unknown sessions and 403 for out-of-range segments', async () => {
    const unknownSession = await SELF.fetch(
      'http://x/api/game/not-a-session/q/0/seg/0',
    );
    expect(unknownSession.status).toBe(404);

    // ゲート判定が存在チェックより先: seg_count を推測させない
    const sessionId = await startGame();
    const missingSegment = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/seg/99`,
    );
    expect(missingSegment.status).toBe(403);
  });
});
