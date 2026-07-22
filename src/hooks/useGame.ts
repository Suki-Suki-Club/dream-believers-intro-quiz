import { useCallback, useEffect, useRef, useState } from 'react';
import {
  answer as answerQuestion,
  ApiError,
  fetchArt,
  fetchSegment as fetchAudioSegment,
  fetchReward,
  skip as skipQuestion,
  startGame,
} from '../api/client';
import type { AnswerResponse, Question } from '../api/types';
import {
  createSegmentPlayer,
  type SegmentPlayer,
} from '../audio/segmentPlayer';
import { getSharedAudioContext, unlockSharedAudioContext } from '../audio/audioContext';
import { sfx } from '../audio/sfx';

export type GamePhase = 'start' | 'quiz' | 'result';

export type QuestionPhase =
  | 'announcing'
  | 'playing'
  | 'correct-reveal'
  | 'wrong-feedback';

export const ANNOUNCE_MS = 1_700;
export const CORRECT_HOLD_MS = 1_300;
export const WRONG_FEEDBACK_MS = 650;

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
  questionPhase?: QuestionPhase | null;
  revealArtUrl?: string | null;
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
  const [questionPhase, setQuestionPhase] = useState<QuestionPhase | null>(null);
  const [revealArtUrl, setRevealArtUrl] = useState<string | null>(null);

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
  const questionPhaseRef = useRef<QuestionPhase | null>(null);
  const revealArtUrlRef = useRef<string | null>(null);
  const announceTimerRef = useRef<number | undefined>(undefined);
  const holdTimerRef = useRef<number | undefined>(undefined);
  const wrongTimerRef = useRef<number | undefined>(undefined);

  const changePhase = useCallback((nextPhase: GamePhase): void => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const setQuestionPhaseState = (next: QuestionPhase | null): void => {
    questionPhaseRef.current = next;
    setQuestionPhase(next);
  };

  const clearQuestionTimers = (): void => {
    if (announceTimerRef.current !== undefined) {
      window.clearTimeout(announceTimerRef.current);
      announceTimerRef.current = undefined;
    }
    if (holdTimerRef.current !== undefined) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = undefined;
    }
    if (wrongTimerRef.current !== undefined) {
      window.clearTimeout(wrongTimerRef.current);
      wrongTimerRef.current = undefined;
    }
  };

  const clearRevealArt = (): void => {
    if (revealArtUrlRef.current) {
      URL.revokeObjectURL(revealArtUrlRef.current);
      revealArtUrlRef.current = null;
    }
    setRevealArtUrl(null);
  };

  const beginPlaying = useCallback((questionIndex: number, runId: number): void => {
    if (runId !== runIdRef.current) return;
    setQuestionPhaseState('playing');
    void playersRef.current[questionIndex]?.play();
  }, []);

  const beginAnnounce = useCallback(
    (questionIndex: number, runId: number): void => {
      if (runId !== runIdRef.current) return;
      clearQuestionTimers();
      setQuestionPhaseState('announcing');
      sfx.play('announce');
      announceTimerRef.current = window.setTimeout(() => {
        announceTimerRef.current = undefined;
        beginPlaying(questionIndex, runId);
      }, ANNOUNCE_MS);
    },
    [beginPlaying],
  );

  const loadReveal = useCallback(
    async (sid: string, questionIndex: number, runId: number): Promise<void> => {
      try {
        const artBlob = await fetchArt(sid, questionIndex).catch(() => null);
        if (
          runId !== runIdRef.current ||
          questionPhaseRef.current !== 'correct-reveal'
        ) {
          return;
        }
        if (artBlob) {
          const url = URL.createObjectURL(artBlob);
          revealArtUrlRef.current = url;
          setRevealArtUrl(url);
        }
      } catch {
        // Best effort: art failures must not surface to the player.
      }

      try {
        const rewardBuffer = await fetchReward(sid, questionIndex).catch(() => null);
        if (
          !rewardBuffer ||
          runId !== runIdRef.current ||
          questionPhaseRef.current !== 'correct-reveal'
        ) {
          return;
        }
        const context = getSharedAudioContext();
        const decoded = await context.decodeAudioData(rewardBuffer.slice(0));
        if (
          runId !== runIdRef.current ||
          questionPhaseRef.current !== 'correct-reveal'
        ) {
          return;
        }
        const source = context.createBufferSource();
        source.buffer = decoded;
        source.connect(context.destination);
        source.start(0);
      } catch {
        // Best effort: reward clips are optional and may not be deployed yet.
      }
    },
    [],
  );

  const start = useCallback(async (): Promise<void> => {
    unlockSharedAudioContext();
    void sfx.preload();
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
          audioContext: getSharedAudioContext(),
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
      clearRevealArt();
      beginAnnounce(0, runId);
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
  }, [beginAnnounce, changePhase]);

  useEffect(() => {
    if (phase !== 'quiz' || startedAt === null) return;

    const updateElapsed = (): void => {
      if (questionPhaseRef.current === 'correct-reveal') return;
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
          sfx.play('wrong');
          clearQuestionTimers();
          setQuestionPhaseState('wrong-feedback');
          const activeRunId = runIdRef.current;
          wrongTimerRef.current = window.setTimeout(() => {
            wrongTimerRef.current = undefined;
            if (activeRunId !== runIdRef.current) return;
            setQuestionPhaseState('playing');
          }, WRONG_FEEDBACK_MS);
          return response;
        }

        if (response.finalMs !== undefined) {
          const activeRunId = runIdRef.current;
          sfx.play('correct');
          playersRef.current[questionIndex]?.pause();
          clearQuestionTimers();
          setQuestionPhaseState('correct-reveal');
          void loadReveal(activeSessionId, questionIndex, activeRunId);

          holdTimerRef.current = window.setTimeout(() => {
            holdTimerRef.current = undefined;
            if (activeRunId !== runIdRef.current) return;
            clearRevealArt();
            setFinalMs(response.finalMs!);
            setElapsedMs(response.finalMs!);
            setQuestionPhaseState(null);
            changePhase('result');
          }, CORRECT_HOLD_MS);
          return response;
        }

        const activeRunId = runIdRef.current;
        sfx.play('correct');
        playersRef.current[questionIndex]?.pause();
        clearQuestionTimers();
        setQuestionPhaseState('correct-reveal');
        void loadReveal(activeSessionId, questionIndex, activeRunId);

        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = undefined;
          if (activeRunId !== runIdRef.current) return;
          clearRevealArt();
          const nextQuestion = questionIndex + 1;
          currentQuestionRef.current = nextQuestion;
          setCurrentQuestion(nextQuestion);
          setPlayer(playersRef.current[nextQuestion] ?? null);
          beginAnnounce(nextQuestion, activeRunId);
        }, CORRECT_HOLD_MS);
        return response;
      } catch (cause) {
        const nextError = toError(cause);
        setError(nextError);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [beginAnnounce, changePhase, loadReveal],
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

  useEffect(() => {
    return () => {
      clearQuestionTimers();
      clearRevealArt();
    };
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
    questionPhase,
    revealArtUrl,
    start,
    submitAnswer,
    doSkip,
  };
}
