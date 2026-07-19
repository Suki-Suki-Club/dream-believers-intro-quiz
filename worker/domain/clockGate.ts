import type { QuestionState } from './session';

/**
 * Returns the furthest clip position that may be delivered for the current
 * question at the supplied server time.
 */
export function deliverablePosition(
  question: Pick<QuestionState, 'startedAt' | 'wrong' | 'skips'>,
  now: number,
  clipMs: number,
): number {
  return Math.min(
    now - question.startedAt + 5000 * (question.wrong + question.skips) + 2000,
    clipMs,
  );
}

/**
 * Segment zero is always available. Later segments are available only when
 * their start position is strictly before the clock-gated position.
 */
export function canServeSegment(
  k: number,
  question: Pick<QuestionState, 'startedAt' | 'wrong' | 'skips'>,
  now: number,
  clipMs: number,
): boolean {
  return k === 0 || k * 5000 < deliverablePosition(question, now, clipMs);
}
