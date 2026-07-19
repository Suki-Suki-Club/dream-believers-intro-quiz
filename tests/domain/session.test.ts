import {
  applyAnswer,
  applySkip,
  type SessionState,
} from '../../worker/domain/session';

function session(): SessionState {
  return {
    current: 0,
    questions: Array.from({ length: 10 }, (_, index) => ({
      trackId: index + 1,
      choices: [index + 1, 11, 12, 13, 14, 15],
      startedAt: 1_000,
      wrong: 0,
      skips: 0,
      answeredAt: null,
    })),
  };
}

describe('session transitions', () => {
  it('returns a conflict without changing state when the question is stale', () => {
    const state = session();

    expect(applyAnswer(state, 1, 1, 1, 2_000)).toEqual({
      ok: false,
      reason: 'conflict',
    });
    expect(state.current).toBe(0);
    expect(state.questions[0].wrong).toBe(0);
  });

  it('increments only wrong answers and returns a new state', () => {
    const state = session();
    const result = applyAnswer(state, 0, 99, 1, 2_000);

    expect(result).toMatchObject({ ok: false, correct: false });
    if (result.ok || !('state' in result)) return;

    expect(result.state.current).toBe(0);
    expect(result.state.questions[0].wrong).toBe(1);
    expect(result.state.questions[0].answeredAt).toBeNull();
    expect(state.questions[0].wrong).toBe(0);
    expect(result.state).not.toBe(state);
  });

  it('starts the next question when the current answer is correct', () => {
    const state = session();
    const result = applyAnswer(state, 0, 1, 1, 2_000);

    expect(result).toMatchObject({
      ok: true,
      correct: true,
      finished: false,
    });
    if (!result.ok || result.finished) return;

    expect(result.state.current).toBe(1);
    expect(result.state.questions[0].answeredAt).toBe(2_000);
    expect(result.state.questions[1].startedAt).toBe(2_000);
    expect(state.current).toBe(0);
    expect(state.questions[0].answeredAt).toBeNull();
  });

  it('increments skips without changing the current question', () => {
    const state = session();
    const result = applySkip(state, 0, 2_000);

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    expect(result.state.current).toBe(0);
    expect(result.state.questions[0].skips).toBe(1);
    expect(result.state.questions[0].startedAt).toBe(1_000);
    expect(state.questions[0].skips).toBe(0);
  });

  it('returns finished after the tenth question is answered correctly', () => {
    const state = session();
    state.current = 9;

    const result = applyAnswer(state, 9, 10, 10, 12_000);

    expect(result).toMatchObject({
      ok: true,
      correct: true,
      finished: true,
    });
    if (!result.ok) return;

    expect(result.state.current).toBe(9);
    expect(result.state.questions[9].answeredAt).toBe(12_000);
  });
});
