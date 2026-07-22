import { act, renderHook } from '@testing-library/react';
import type { AnswerResponse, StartResponse } from '../../src/api/types';
import {
  ANNOUNCE_MS,
  CORRECT_HOLD_MS,
  WRONG_FEEDBACK_MS,
  useGame,
} from '../../src/hooks/useGame';
import type { SegmentPlayer } from '../../src/audio/segmentPlayer';
import {
  answer,
  fetchArt,
  fetchSegment,
  fetchReward,
  skip,
  startGame,
} from '../../src/api/client';
import { createSegmentPlayer } from '../../src/audio/segmentPlayer';
import {
  getSharedAudioContext,
  unlockSharedAudioContext,
} from '../../src/audio/audioContext';
import { sfx } from '../../src/audio/sfx';

vi.mock('../../src/api/client', () => ({
  answer: vi.fn(),
  fetchArt: vi.fn(),
  fetchSegment: vi.fn(),
  fetchReward: vi.fn(),
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

vi.mock('../../src/audio/sfx', () => ({
  sfx: {
    preload: vi.fn(async () => undefined),
    play: vi.fn(),
  },
}));

vi.mock('../../src/audio/audioContext', () => {
  const context = {
    state: 'running',
    resume: vi.fn(async () => undefined),
    decodeAudioData: vi.fn(async () => ({})),
    createBufferSource: vi.fn(() => ({
      connect: vi.fn(),
      start: vi.fn(),
    })),
    destination: {},
  };
  return {
    getSharedAudioContext: vi.fn(() => context),
    unlockSharedAudioContext: vi.fn(),
  };
});

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
const fetchArtMock = vi.mocked(fetchArt);
const fetchSegmentMock = vi.mocked(fetchSegment);
const fetchRewardMock = vi.mocked(fetchReward);
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    players.length = 0;
    vi.clearAllMocks();
    startGameMock.mockResolvedValue(startResponse());
    answerMock.mockResolvedValue({ correct: true });
    fetchArtMock.mockResolvedValue(null);
    fetchRewardMock.mockResolvedValue(null);
    skipMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefetches segment zero for all ten questions in parallel', async () => {
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
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
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
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
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
    });

    for (let question = 0; question < 10; question += 1) {
      await act(async () => {
        await result.current.submitAnswer(0);
        if (question < 9) {
          await vi.advanceTimersByTimeAsync(CORRECT_HOLD_MS + ANNOUNCE_MS);
        } else {
          await vi.advanceTimersByTimeAsync(CORRECT_HOLD_MS);
        }
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
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
      await result.current.doSkip();
    });

    expect(skipMock).toHaveBeenCalledWith('session-1', 0);
    expect(players[0].jumpBy).toHaveBeenCalledWith(5_000);
    expect(result.current.skipCount).toBe(1);
  });

  it('unlocks shared audio and starts SFX preload synchronously', async () => {
    const { result } = renderHook(() => useGame());
    let startPromise: Promise<void> | undefined;

    await act(async () => {
      startPromise = result.current.start();
      expect(unlockSharedAudioContext).toHaveBeenCalledTimes(1);
      expect(sfx.preload).toHaveBeenCalledTimes(1);
      await startPromise;
    });
  });

  it('passes one shared audio context to every segment player', async () => {
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
    });

    const context = vi.mocked(getSharedAudioContext).mock.results[0]?.value;
    expect(vi.mocked(createSegmentPlayer)).toHaveBeenCalledTimes(10);
    for (const call of vi.mocked(createSegmentPlayer).mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ audioContext: context }));
    }
  });

  it('announces before automatically playing the first question', async () => {
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.questionPhase).toBe('announcing');
    expect(sfx.play).toHaveBeenCalledWith('announce');
    expect(players[0].play).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
    });

    expect(result.current.questionPhase).toBe('playing');
    expect(players[0].play).toHaveBeenCalledTimes(1);
  });

  it('plays wrong feedback without pausing and resumes the playing phase', async () => {
    answerMock.mockResolvedValueOnce({ correct: false });
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
      await result.current.submitAnswer(2);
    });

    expect(sfx.play).toHaveBeenCalledWith('wrong');
    expect(players[0].pause).not.toHaveBeenCalled();
    expect(result.current.questionPhase).toBe('wrong-feedback');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WRONG_FEEDBACK_MS);
    });
    expect(result.current.questionPhase).toBe('playing');
  });

  it('holds a correct reveal before announcing the next question', async () => {
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
      await result.current.submitAnswer(1);
    });

    expect(sfx.play).toHaveBeenCalledWith('correct');
    expect(players[0].pause).toHaveBeenCalledTimes(1);
    expect(result.current.questionPhase).toBe('correct-reveal');
    expect(result.current.currentQuestion).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CORRECT_HOLD_MS);
    });

    expect(result.current.currentQuestion).toBe(1);
    expect(result.current.questionPhase).toBe('announcing');
  });

  it('shows best-effort album art and skips an unavailable reward clip', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    fetchArtMock.mockResolvedValueOnce(new Blob(['art'], { type: 'image/jpeg' }));
    const { result } = renderHook(() => useGame());

    await act(async () => {
      await result.current.start();
      await vi.advanceTimersByTimeAsync(ANNOUNCE_MS);
      await result.current.submitAnswer(0);
      await Promise.resolve();
    });

    expect(result.current.revealArtUrl).toBe('blob:fake');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getSharedAudioContext)().decodeAudioData).not.toHaveBeenCalled();
    expect(vi.mocked(getSharedAudioContext)().createBufferSource).not.toHaveBeenCalled();
  });
});
