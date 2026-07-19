/// <reference types="@cloudflare/vitest-pool-workers" />

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeFinalMs } from '../../worker/domain/timing';
import { applyMigrations } from './helpers/applyMigrations';
import { seedGameData } from './helpers/seed';

interface StartResponse {
  sessionId: string;
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

async function getSessionResult(sessionId: string): Promise<{
  finishedAt: number | null;
  finalMs: number | null;
}> {
  const row = await env.DB.prepare(
    'SELECT finished_at, final_ms FROM sessions WHERE id = ?1',
  )
    .bind(sessionId)
    .first<{ finished_at: number | null; final_ms: number | null }>();
  expect(row).not.toBeNull();
  return { finishedAt: row!.finished_at, finalMs: row!.final_ms };
}

function correctChoice(state: TestSessionState, question = state.current): number {
  return state.questions[question].choices.indexOf(
    state.questions[question].trackId,
  );
}

describe('POST /api/game/:sid/q/:n/answer', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedGameData();
  });

  it('records an incorrect answer without advancing the question', async () => {
    const sessionId = await startGame();
    const before = await getSessionState(sessionId);
    const wrongChoice = before.questions[0].choices.findIndex(
      (trackId) => trackId !== before.questions[0].trackId,
    );

    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: wrongChoice }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ correct: false });

    const after = await getSessionState(sessionId);
    expect(after.current).toBe(0);
    expect(after.questions[0].wrong).toBe(1);
    expect(after.questions[0].skips).toBe(0);
  });

  it('rejects an answer for a non-current question', async () => {
    const sessionId = await startGame();

    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/1/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: 0 }),
      },
    );

    expect(response.status).toBe(409);
  });

  it('advances to the next question after a correct answer', async () => {
    const sessionId = await startGame();
    const before = await getSessionState(sessionId);
    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: correctChoice(before, 0) }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ correct: true });

    const after = await getSessionState(sessionId);
    expect(after.current).toBe(1);
    expect(after.questions[0].answeredAt).not.toBeNull();
    expect(after.questions[1].startedAt).toBe(after.questions[0].answeredAt);
  });

  it('validates the public choice index', async () => {
    const sessionId = await startGame();

    const response = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: 6 }),
      },
    );

    expect(response.status).toBe(400);
  });

  it('stores the final time after the tenth correct answer', async () => {
    const sessionId = await startGame();
    let state = await getSessionState(sessionId);

    const wrongChoice = state.questions[0].choices.findIndex(
      (trackId) => trackId !== state.questions[0].trackId,
    );
    const wrongResponse = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/answer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: wrongChoice }),
      },
    );
    expect(wrongResponse.status).toBe(200);

    const skipResponse = await SELF.fetch(
      `http://x/api/game/${sessionId}/q/0/skip`,
      { method: 'POST' },
    );
    expect(skipResponse.status).toBe(204);

    for (let question = 0; question < 10; question += 1) {
      state = await getSessionState(sessionId);
      const response = await SELF.fetch(
        `http://x/api/game/${sessionId}/q/${question}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ choice: correctChoice(state, question) }),
        },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        correct: boolean;
        finalMs?: number;
      };
      expect(body.correct).toBe(true);

      if (question === 9) {
        expect(body.finalMs).toEqual(expect.any(Number));
      }
    }

    const finalState = await getSessionState(sessionId);
    const result = await getSessionResult(sessionId);
    expect(result.finishedAt).toEqual(expect.any(Number));
    expect(result.finalMs).toBe(
      computeFinalMs(finalState, result.finishedAt!),
    );
    expect(finalState.current).toBe(9);
    expect(finalState.questions[0].wrong).toBe(1);
    expect(finalState.questions[0].skips).toBe(1);
  });
});
