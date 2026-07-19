import type { SessionState } from './session';

/** Calculates the server-authoritative final score time in milliseconds. */
export function computeFinalMs(state: SessionState, finishedAt: number): number {
  const penalties = state.questions.reduce(
    (total, question) => total + question.wrong + question.skips,
    0,
  );

  return finishedAt - state.questions[0].startedAt + 5000 * penalties;
}
