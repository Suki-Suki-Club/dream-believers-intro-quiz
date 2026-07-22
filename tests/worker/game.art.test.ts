/// <reference types="@cloudflare/vitest-pool-workers" />

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from './helpers/applyMigrations';
import { seedGameData, setTrackMedia } from './helpers/seed';

interface StartResponse {
  sessionId: string;
}

interface TestSessionState {
  current: number;
  questions: Array<{
    trackId: number;
    choices: number[];
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

function correctChoice(state: TestSessionState, question: number): number {
  return state.questions[question].choices.indexOf(
    state.questions[question].trackId,
  );
}

async function answerCorrectly(
  sessionId: string,
  state: TestSessionState,
  question: number,
): Promise<Response> {
  return SELF.fetch(`http://x/api/game/${sessionId}/q/${question}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice: correctChoice(state, question) }),
  });
}

describe('GET /api/game/:sid/q/:n/art', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedGameData();
  });

  it('serves album art only after the question is answered correctly', async () => {
    const sessionId = await startGame();
    const state = await getSessionState(sessionId);
    await setTrackMedia(state.questions[0].trackId, {
      artKey: 'art-key-1',
    });

    const beforeAnswer = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/art`,
    );
    expect(beforeAnswer.status).toBe(404);

    const answer = await answerCorrectly(sessionId, state, 0);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ correct: true });

    const art = await SELF.fetch(`http://x/api/game/${sessionId}/q/0/art`);
    expect(art.status).toBe(200);
    expect(art.headers.get('Content-Type')).toBe('image/jpeg');
    expect(art.headers.get('Cache-Control')).toContain('no-store');
    expect(Array.from(new Uint8Array(await art.arrayBuffer()))).toEqual([
      0xff,
      0xd8,
      0xff,
    ]);
  });

  it('returns 404 for an answered question without album art', async () => {
    const sessionId = await startGame();
    const state = await getSessionState(sessionId);
    await setTrackMedia(state.questions[0].trackId, { artKey: null });

    const answer = await answerCorrectly(sessionId, state, 0);
    expect(answer.status).toBe(200);

    const art = await SELF.fetch(`http://x/api/game/${sessionId}/q/0/art`);
    expect(art.status).toBe(404);
  });
});
