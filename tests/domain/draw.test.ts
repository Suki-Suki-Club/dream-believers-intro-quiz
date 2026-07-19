import { drawQuestions } from '../../worker/domain/draw';

function seededRng(seed = 0x12345678): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('drawQuestions', () => {
  it('draws ten distinct questions with six unique choices containing the answer', () => {
    const trackIds = Array.from({ length: 12 }, (_, index) => index + 1);
    const questions = drawQuestions(trackIds, seededRng());

    expect(questions).toHaveLength(10);
    expect(new Set(questions.map(({ trackId }) => trackId)).size).toBe(10);

    for (const question of questions) {
      expect(question.choices).toHaveLength(6);
      expect(new Set(question.choices).size).toBe(6);
      expect(question.choices).toContain(question.trackId);
    }
  });

  it('throws when the pool has fewer than ten unique tracks', () => {
    expect(() => drawQuestions(Array.from({ length: 9 }, (_, index) => index), seededRng())).toThrow(
      'At least 10 unique track IDs are required',
    );
  });

  it('draws six choices from the whole pool when there are exactly ten tracks', () => {
    const trackIds = Array.from({ length: 10 }, (_, index) => index + 1);
    const questions = drawQuestions(trackIds, seededRng(0x87654321));
    const pool = new Set(trackIds);

    expect(questions).toHaveLength(10);

    for (const question of questions) {
      expect(question.choices).toHaveLength(6);
      expect(question.choices.every((choice) => pool.has(choice))).toBe(true);
      expect(question.choices).toContain(question.trackId);
    }
  });

  it('does not mutate the input track pool', () => {
    const trackIds = Array.from({ length: 10 }, (_, index) => index + 1);
    const originalTrackIds = [...trackIds];

    drawQuestions(trackIds, seededRng());

    expect(trackIds).toEqual(originalTrackIds);
  });
});
