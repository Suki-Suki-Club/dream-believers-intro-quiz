import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answer as answerQuestion,
  ApiError,
  fetchSegment as fetchAudioSegment,
  skip as skipQuestion,
  startGame,
} from '../api/client';
import type { AnswerResponse, Question } from '../api/types';
import {
  createSegmentPlayer,
  type SegmentPlayer,
} from '../audio/segmentPlayer';

export type GamePhase = 'start' | 'quiz' | 'result';

export interface GamePenalties {
  wrong: number;
  skips: number;
}

export interface UseGameResult {
  state: GamePhase;
  phase: GamePhase;
  status: GamePhase;
  sessionId: string | null;
  questions: Question[];
  currentQuestion: number;
  currentQuestionIndex: number;
  player: SegmentPlayer | null;
  elapsedMs: number;
  finalMs: number | null;
  wrongCount: number;
  skipCount: number;
  wrong: number;
  skips: number;
  penalties: GamePenalties;
  isStarting: boolean;
  isSubmitting: boolean;
  error: Error | null;
  start: () => Promise<void>;
  submitAnswer: (choice: number) => Promise<AnswerResponse | null>;
  doSkip: () => Promise<boolean>;
}

const SEGMENT_LENGTH_MS = 5_000;
const PREFETCH_BUFFER_MS = 2_000;
const RETRY_DELAY_MS = 1_000;
const POLL_INTERVAL_MS = 250;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isSegmentUnavailable(error: unknown): boolean {
  return (
    (error instanceof ApiError || typeof error === 'object') &&
    error !== null &&
    'status' in error &&
    error.status === 403
  );
}

function isMissingSegment(error: unknown): boolean {
  return (
    (error instanceof ApiError || typeof error === 'object') &&
    error !== null &&
    'status' in error &&
    error.status === 404
  );
}

/**
 * Owns the client-side game state and coordinates API calls with audio
 * players. Each question has its own player so prefetching question zero does
 * not concatenate unrelated clips into the current question's audio.
 */
export function useGame(): UseGameResult {
  const [phase, setPhase] = useState<GamePhase>('start');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [player, setPlayer] = useState<SegmentPlayer | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finalMs, setFinalMs] = useState<number | null>(null);
  const [wrongCount, setWrongCount] = useState(0);
  const [skipCount, setSkipCount] = useState(0);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const phaseRef = useRef<GamePhase>('start');
  const sessionIdRef = useRef<string | null>(null);
  const currentQuestionRef = useRef(0);
  const playersRef = useRef<SegmentPlayer[]>([]);
  const loadedSegmentsRef = useRef<Set<number>[]>([]);
  const exhaustedSegmentsRef = useRef<Set<number>[]>([]);
  const startInFlightRef = useRef(false);
  const runIdRef = useRef(0);
  const wrongCountRef = useRef(0);
  const skipCountRef = useRef(0);

  const changePhase = useCallback((nextPhase: GamePhase): void => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const start = useCallback(async (): Promise<void> => {
    if (startInFlightRef.current || phaseRef.current !== 'start') return;

    startInFlightRef.current = true;
    const runId = ++runIdRef.current;
    setIsStarting(true);
    setError(null);

    try {
      const response = await startGame();
      if (runId !== runIdRef.current) return;

      const nextPlayers = response.questions.map((_, questionIndex) =>
        createSegmentPlayer({
          fetchSegment: (segment) =>
            fetchAudioSegment(response.sessionId, questionIndex, segment),
        }),
      );
      const nextLoadedSegments = response.questions.map(() => new Set<number>());
      const nextExhaustedSegments = response.questions.map(
        () => new Set<number>(),
      );

      playersRef.current = nextPlayers;
      loadedSegmentsRef.current = nextLoadedSegments;
      exhaustedSegmentsRef.current = nextExhaustedSegments;
      sessionIdRef.current = response.sessionId;

      // Start every request before awaiting the first one. This is the
      // intentional parallel prefetch of the ten question-zero segments.
      await Promise.all(
        nextPlayers.map(async (nextPlayer, questionIndex) => {
          await nextPlayer.loadSegment(0);
          nextLoadedSegments[questionIndex].add(0);
        }),
      );

      if (runId !== runIdRef.current) return;

      const now = Date.now();
      setSessionId(response.sessionId);
      setQuestions(response.questions);
      currentQuestionRef.current = 0;
      setCurrentQuestion(0);
      setPlayer(nextPlayers[0] ?? null);
      setStartedAt(now);
      setElapsedMs(0);
      wrongCountRef.current = 0;
      skipCountRef.current = 0;
      setWrongCount(0);
      setSkipCount(0);
      setFinalMs(null);
      changePhase('quiz');
    } catch (cause) {
      if (runId === runIdRef.current) {
        setError(toError(cause));
      }
    } finally {
      if (runId === runIdRef.current) {
        startInFlightRef.current = false;
        setIsStarting(false);
      }
    }
  }, [changePhase]);

  useEffect(() => {
    if (phase !== 'quiz' || startedAt === null) return;

    const updateElapsed = (): void => {
      const penaltyMs =
        (wrongCountRef.current + skipCountRef.current) * SEGMENT_LENGTH_MS;
      setElapsedMs(Math.max(0, Date.now() - startedAt + penaltyMs));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [phase, startedAt, wrongCount, skipCount]);

  useEffect(() => {
    if (phase !== 'quiz' || !player) return;

    let cancelled = false;
    let retryTimer: number | undefined;
    const questionIndex = currentQuestion;
    const currentPlayer = player;
    const loadedSegments = loadedSegmentsRef.current[questionIndex];
    const exhaustedSegments = exhaustedSegmentsRef.current[questionIndex];
    let loadingSegment: number | null = null;

    if (!loadedSegments || !exhaustedSegments) return;

    const nextSegment = (): number => {
      let segment = 1;
      while (loadedSegments.has(segment)) segment += 1;
      return segment;
    };

    const scheduleRetry = (): void => {
      if (cancelled || retryTimer !== undefined) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void tryLoadNext();
      }, RETRY_DELAY_MS);
    };

    const tryLoadNext = async (): Promise<void> => {
      if (cancelled) return;

      const segment = nextSegment();
      if (exhaustedSegments.has(segment)) return;
      if (loadingSegment !== null) return;

      const fetchedMs = currentPlayer.getFetchedMs();
      const positionMs = currentPlayer.getPositionMs();
      if (positionMs + PREFETCH_BUFFER_MS < fetchedMs) return;

      loadingSegment = segment;
      try {
        await currentPlayer.loadSegment(segment);
        if (!cancelled) loadedSegments.add(segment);
      } catch (cause) {
        if (cancelled) return;
        if (isMissingSegment(cause)) {
          exhaustedSegments.add(segment);
        } else if (isSegmentUnavailable(cause)) {
          // The server clock gate advances while the player approaches the
          // end of the fetched range. Retry rather than surfacing a transient
          // 403 to the game UI.
          scheduleRetry();
        } else {
          setError(toError(cause));
        }
      } finally {
        loadingSegment = null;
      }
    };

    void tryLoadNext();
    const poller = window.setInterval(() => {
      void tryLoadNext();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poller);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [currentQuestion, phase, player]);

  const submitAnswer = useCallback(
    async (choice: number): Promise<AnswerResponse | null> => {
      const activeSessionId = sessionIdRef.current;
      const questionIndex = currentQuestionRef.current;
      if (!activeSessionId || phaseRef.current !== 'quiz') return null;

      setIsSubmitting(true);
      setError(null);
      try {
        const response = await answerQuestion(
          activeSessionId,
          questionIndex,
          choice,
        );

        if (!response.correct) {
          playersRef.current[questionIndex]?.jumpBy(SEGMENT_LENGTH_MS);
          wrongCountRef.current += 1;
          setWrongCount(wrongCountRef.current);
          return response;
        }

        if (response.finalMs !== undefined) {
          setFinalMs(response.finalMs);
          setElapsedMs(response.finalMs);
          changePhase('result');
          return response;
        }

        const nextQuestion = questionIndex + 1;
        playersRef.current[questionIndex]?.pause();
        currentQuestionRef.current = nextQuestion;
        setCurrentQuestion(nextQuestion);
        setPlayer(playersRef.current[nextQuestion] ?? null);
        return response;
      } catch (cause) {
        const nextError = toError(cause);
        setError(nextError);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [changePhase],
  );

  const doSkip = useCallback(async (): Promise<boolean> => {
    const activeSessionId = sessionIdRef.current;
    const questionIndex = currentQuestionRef.current;
    if (!activeSessionId || phaseRef.current !== 'quiz') return false;

    setIsSubmitting(true);
    setError(null);
    try {
      await skipQuestion(activeSessionId, questionIndex);
      playersRef.current[questionIndex]?.jumpBy(SEGMENT_LENGTH_MS);
      skipCountRef.current += 1;
      setSkipCount(skipCountRef.current);
      return true;
    } catch (cause) {
      setError(toError(cause));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  return {
    state: phase,
    phase,
    status: phase,
    sessionId,
    questions,
    currentQuestion,
    currentQuestionIndex: currentQuestion,
    player,
    elapsedMs,
    finalMs,
    wrongCount,
    skipCount,
    wrong: wrongCount,
    skips: skipCount,
    penalties: { wrong: wrongCount, skips: skipCount },
    isStarting,
    isSubmitting,
    error,
    start,
    submitAnswer,
    doSkip,
  };
}
