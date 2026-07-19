export interface QuestionState {
  trackId: number;
  choices: number[];
  startedAt: number;
  wrong: number;
  skips: number;
  answeredAt: number | null;
}

export interface SessionState {
  current: number;
  questions: QuestionState[];
}

export type AnswerResult =
  | { ok: false; reason: 'conflict' }
  | { ok: false; correct: false; state: SessionState }
  | {
      ok: true;
      correct: true;
      finished: false;
      state: SessionState;
    }
  | {
      ok: true;
      correct: true;
      finished: true;
      state: SessionState;
    };

export type SkipResult =
  | { ok: false; reason: 'conflict' }
  | { ok: true; state: SessionState };

function cloneState(state: SessionState): SessionState {
  return {
    current: state.current,
    questions: state.questions.map((question) => ({
      ...question,
      choices: [...question.choices],
    })),
  };
}

export function applyAnswer(
  state: SessionState,
  n: number,
  choice: number,
  correctTrackId: number,
  now: number,
): AnswerResult {
  if (n !== state.current) {
    return { ok: false, reason: 'conflict' };
  }

  const nextState = cloneState(state);
  const question = nextState.questions[n];

  if (choice !== correctTrackId) {
    question.wrong += 1;
    return { ok: false, correct: false, state: nextState };
  }

  question.answeredAt = now;

  if (n < 9) {
    nextState.current = n + 1;
    nextState.questions[nextState.current].startedAt = now;
    return {
      ok: true,
      correct: true,
      finished: false,
      state: nextState,
    };
  }

  return {
    ok: true,
    correct: true,
    finished: true,
    state: nextState,
  };
}

export function applySkip(
  state: SessionState,
  n: number,
  now: number,
): SkipResult {
  if (n !== state.current) {
    return { ok: false, reason: 'conflict' };
  }

  const nextState = cloneState(state);
  const question = nextState.questions[n];
  question.skips += 1;

  // Keep the timestamp argument in the transition signature for parity with
  // answer events and future callers. A skip does not start a new question.
  void now;

  return { ok: true, state: nextState };
}
