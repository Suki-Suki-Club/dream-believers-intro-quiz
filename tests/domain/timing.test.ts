import { computeFinalMs } from '../../worker/domain/timing';
import type { SessionState } from '../../worker/domain/session';

function session(overrides: Partial<SessionState> = {}): SessionState {
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
    ...overrides,
  };
}

describe('computeFinalMs', () => {
  it('returns elapsed time when there are no penalties', () => {
    expect(computeFinalMs(session(), 11_500)).toBe(10_500);
  });

  it('adds five seconds for every wrong answer and skip', () => {
    const state = session();
    state.questions[0].wrong = 2;
    state.questions[3].skips = 1;
    state.questions[9].wrong = 1;

    expect(computeFinalMs(state, 11_500)).toBe(30_500);
  });
});
