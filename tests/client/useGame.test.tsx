import { act, renderHook } from '@testing-library/react';
import type { AnswerResponse, StartResponse } from '../../src/api/types';
import { useGame } from '../../src/hooks/useGame';
import type { SegmentPlayer } from '../../src/audio/segmentPlayer';
import {
  answer,
  fetchSegment,
  skip,
  startGame,
} from '../../src/api/client';
import { createSegmentPlayer } from '../../src/audio/segmentPlayer';

vi.mock('../../src/api/client', () => ({
  answer: vi.fn(),
  fetchSegment: vi.fn(),
  skip: vi.fn(),
  startGame: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number) {
      super(`API request failed (${status})`);
      this.status = status;
    }
  },
}));

interface FakePlayer extends SegmentPlayer {
  loadSegment: ReturnType<typeof vi.fn>;
  jumpBy: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

const players: FakePlayer[] = [];

vi.mock('../../src/audio/segmentPlayer', () => ({
  createSegmentPlayer: vi.fn(() => {
    const fakePlayer = {
      appendSegment: vi.fn(async () => undefined),
      loadSegment: vi.fn(async () => undefined),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      seek: vi.fn(),
      jumpBy: vi.fn(),
      getFetchedMs: vi.fn(() => 5_000),
      getPositionMs: vi.fn(() => 0),
      getDurationMs: vi.fn(() => 5_000),
    } as unknown as FakePlayer;
    players.push(fakePlayer);
    return fakePlayer;
  }),
}));

const startGameMock = vi.mocked(startGame);
const answerMock = vi.mocked(answer);
const fetchSegmentMock = vi.mocked(fetchSegment);
const skipMock = vi.mocked(skip);

function startResponse(): StartResponse {
  return {
    sessionId: 'session-1',
    questions: Array.from({ length: 10 }, (_, question) => ({
      choices: [
        `Track ${question}`,
        'Track A',
        'Track B',
        'Track C',
        'Track D',
        'Track E',
      ],
    })),
  };
}

describe('useGame', () => {
  beforeEach(() => {
    players.length = 0;
    vi.clearAllMocks();
    startGameMock.mockResolvedValue(startResponse());
    answerMock.mockResolvedValue({ correct: true });
    skipMock.mockResolvedValue(undefined);
  });

  it('prefetches segment zero for all ten questions in parallel', async () => {
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe('quiz');
    expect(result.current.sessionId).toBe('session-1');
    expect(players).toHaveLength(10);
    for (const player of players) {
      expect(player.loadSegment).toHaveBeenCalledWith(0);
    }
    expect(fetchSegmentMock).not.toHaveBeenCalled();
    expect(vi.mocked(createSegmentPlayer)).toHaveBeenCalledTimes(10);
  });

  it('jumps five seconds and increments penalties after a wrong answer', async () => {
    answerMock.mockResolvedValueOnce({ correct: false });
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.submitAnswer(3);
    });

    expect(answerMock).toHaveBeenCalledWith('session-1', 0, 3);
    expect(players[0].jumpBy).toHaveBeenCalledWith(5_000);
    expect(result.current.wrongCount).toBe(1);
    expect(result.current.penalties).toEqual({ wrong: 1, skips: 0 });
  });

  it('moves to result and keeps the server final time after question ten', async () => {
    const responses: AnswerResponse[] = Array.from(
      { length: 9 },
      () => ({ correct: true }),
    );
    responses.push({ correct: true, finalMs: 12_345 });
    for (const response of responses) answerMock.mockResolvedValueOnce(response);

    const { result } = renderHook(() => useGame());
    await act(async () => {
      await result.current.start();
    });

    for (let question = 0; question < 10; question += 1) {
      await act(async () => {
        await result.current.submitAnswer(0);
      });
    }

    expect(answerMock).toHaveBeenLastCalledWith('session-1', 9, 0);
    expect(result.current.state).toBe('result');
    expect(result.current.currentQuestion).toBe(9);
    expect(result.current.finalMs).toBe(12_345);
    expect(result.current.elapsedMs).toBe(12_345);
  });

  it('jumps five seconds after a successful skip', async () => {
    const { result } = renderHook(() => useGame());
    await act(async () => {
      await result.current.start();
      await result.current.doSkip();
    });

    expect(skipMock).toHaveBeenCalledWith('session-1', 0);
    expect(players[0].jumpBy).toHaveBeenCalledWith(5_000);
    expect(result.current.skipCount).toBe(1);
  });
});
