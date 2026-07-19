/// <reference types="@cloudflare/vitest-pool-workers" />

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from './helpers/applyMigrations';
import { seedGameData } from './helpers/seed';

interface StartResponse {
  sessionId: string;
}

interface TestSessionState {
  current: number;
  questions: Array<{
    skips: number;
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

describe('POST /api/game/:sid/q/:n/skip', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedGameData();
  });

  it('records a skip and returns 204 without advancing', async () => {
    const sessionId = await startGame();

    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/skip`,
      { method: 'POST' },
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');

    const state = await getSessionState(sessionId);
    expect(state.current).toBe(0);
    expect(state.questions[0].skips).toBe(1);
  });

  it('rejects a skip for a non-current question', async () => {
    const sessionId = await startGame();

    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/1/skip`,
      { method: 'POST' },
    );

    expect(response.status).toBe(409);
  });
});
