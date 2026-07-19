import {
  canServeSegment,
  deliverablePosition,
} from '../../worker/domain/clockGate';
import type { QuestionState } from '../../worker/domain/session';

function question(overrides: Partial<QuestionState> = {}): QuestionState {
  return {
    trackId: 1,
    choices: [1, 2, 3, 4, 5, 6],
    startedAt: 1_000,
    wrong: 0,
    skips: 0,
    answeredAt: null,
    ...overrides,
  };
}

describe('clock gate', () => {
  it('uses server elapsed time, jump penalties, and the look-ahead buffer', () => {
    expect(deliverablePosition(question(), 6_000, 60_000)).toBe(7_000);
  });

  it('rejects the exact segment boundary and allows positions before it', () => {
    const currentQuestion = question({ startedAt: 0 });

    expect(canServeSegment(2, currentQuestion, 8_000, 60_000)).toBe(false);
    expect(canServeSegment(1, currentQuestion, 8_000, 60_000)).toBe(true);
  });

  it('advances the deliverable position by five seconds per jump', () => {
    const currentQuestion = question({ startedAt: 1_000, wrong: 1, skips: 2 });

    expect(deliverablePosition(currentQuestion, 1_000, 60_000)).toBe(17_000);
  });

  it('clamps the deliverable position at the clip end', () => {
    expect(deliverablePosition(question(), 100_000, 12_345)).toBe(12_345);
  });

  it('always allows segment zero', () => {
    expect(canServeSegment(0, question({ startedAt: 100_000 }), 0, 1)).toBe(true);
  });
});
