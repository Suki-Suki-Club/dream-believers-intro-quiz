import type {
  AnswerResponse,
  PostRankingResponse,
  RankingEntry,
  StartResponse,
} from './types';

const API_BASE = '/api';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message = `API request failed (${status})`) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class SegmentUnavailableError extends ApiError {
  constructor() {
    super(403, 'The requested audio segment is not available yet.');
    this.name = 'SegmentUnavailableError';
  }
}

function gamePath(sessionId: string, question: number, segment: number): string {
  return `${API_BASE}/game/${encodeURIComponent(sessionId)}/q/${question}/seg/${segment}`;
}

function jsonRequest(body: unknown): RequestInit {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function throwForStatus(response: Response): void {
  if (!response.ok) {
    throw new ApiError(response.status);
  }
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = init === undefined ? await fetch(input) : await fetch(input, init);
  throwForStatus(response);
  return (await response.json()) as T;
}

export function startGame(): Promise<StartResponse> {
  return requestJson<StartResponse>(`${API_BASE}/game/start`, {
    method: 'POST',
  });
}

export async function fetchSegment(
  sessionId: string,
  question: number,
  segment: number,
): Promise<ArrayBuffer> {
  const response = await fetch(gamePath(sessionId, question, segment));

  if (response.status === 403) {
    throw new SegmentUnavailableError();
  }
  throwForStatus(response);

  return response.arrayBuffer();
}

export async function fetchReward(
  sessionId: string,
  question: number,
): Promise<ArrayBuffer | null> {
  const response = await fetch(
    `${API_BASE}/game/${encodeURIComponent(sessionId)}/q/${question}/reward`,
  );
  if (response.status === 404) return null;
  throwForStatus(response);
  return response.arrayBuffer();
}

export async function fetchArt(
  sessionId: string,
  question: number,
): Promise<Blob | null> {
  const response = await fetch(
    `${API_BASE}/game/${encodeURIComponent(sessionId)}/q/${question}/art`,
  );
  if (response.status === 404) return null;
  throwForStatus(response);
  return response.blob();
}

export function answer(
  sessionId: string,
  question: number,
  choice: number,
): Promise<AnswerResponse> {
  return requestJson<AnswerResponse>(
    `${API_BASE}/game/${encodeURIComponent(sessionId)}/q/${question}/answer`,
    { method: 'POST', ...jsonRequest({ choice }) },
  );
}

export async function skip(sessionId: string, question: number): Promise<void> {
  const response = await fetch(
    `${API_BASE}/game/${encodeURIComponent(sessionId)}/q/${question}/skip`,
    { method: 'POST' },
  );
  throwForStatus(response);
}

export function postRanking(
  sessionId: string,
  name: string,
): Promise<PostRankingResponse> {
  return requestJson<PostRankingResponse>(
    `${API_BASE}/ranking`,
    { method: 'POST', ...jsonRequest({ sessionId, name }) },
  );
}

export function getRanking(): Promise<RankingEntry[]> {
  return requestJson<RankingEntry[]>(`${API_BASE}/ranking`);
}
