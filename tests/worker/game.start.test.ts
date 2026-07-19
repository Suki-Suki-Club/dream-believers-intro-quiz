/// <reference types="@cloudflare/vitest-pool-workers" />

import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from './helpers/applyMigrations';
import { seedGameData } from './helpers/seed';

interface StartResponse {
  sessionId: string;
  questions: Array<{ choices: string[] }>;
}

describe('POST /api/game/start', () => {
  beforeAll(async () => {
    await applyMigrations();
    await seedGameData();
  });

  it('creates a session and returns title-only six-choice questions', async () => {
    const response = await SELF.fetch('http://x/api/game/start', {
      method: 'POST',
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as StartResponse;
    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.questions).toHaveLength(10);

    for (const question of body.questions) {
      expect(Object.keys(question)).toEqual(['choices']);
      expect(question.choices).toHaveLength(6);
      expect(question.choices.every((choice) => typeof choice === 'string')).toBe(true);
      expect(new Set(question.choices).size).toBe(6);
    }

    const serializedResponse = JSON.stringify(body);
    expect(serializedResponse).not.toContain('trackId');
    expect(serializedResponse).not.toContain('correct');
    expect(serializedResponse).not.toContain('answer');
  });

  it('persists the initial state with current question zero', async () => {
    const response = await SELF.fetch('http://x/api/game/start', {
      method: 'POST',
    });
    const body = (await response.json()) as StartResponse;
    const session = await env.DB.prepare(
      'SELECT state FROM sessions WHERE id = ?1',
    )
      .bind(body.sessionId)
      .first<{ state: string }>();

    expect(session).not.toBeNull();
    const state = JSON.parse(session!.state) as {
      current: number;
      questions: Array<{
        trackId: number;
        choices: number[];
        startedAt: number;
        wrong: number;
        skips: number;
        answeredAt: number | null;
      }>;
    };

    expect(state.current).toBe(0);
    expect(state.questions).toHaveLength(10);
    expect(state.questions.every((question) => question.wrong === 0)).toBe(true);
    expect(state.questions.every((question) => question.skips === 0)).toBe(true);
    expect(state.questions.every((question) => question.answeredAt === null)).toBe(true);
  });
});
