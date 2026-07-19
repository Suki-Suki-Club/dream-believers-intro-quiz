export interface Question {
  choices: string[];
}

export interface StartResponse {
  sessionId: string;
  questions: Question[];
}

export interface AnswerResponse {
  correct: boolean;
  finalMs?: number;
}

export interface RankingEntry {
  name: string;
  timeMs: number;
  createdAt: number;
}

export interface PostRankingResponse {
  rank: number;
}
