import { useEffect, useState } from 'react';
import type { AnswerResponse, Question } from '../api/types';
import type { SegmentPlayer } from '../audio/segmentPlayer';
import { ChoiceGrid } from '../components/ChoiceGrid';
import { PlayDial } from '../components/PlayDial';
import { SeekBar } from '../components/SeekBar';

export interface QuizScreenProps {
  question?: Question;
  questionIndex: number;
  totalQuestions?: number;
  player?: SegmentPlayer | null;
  elapsedMs: number;
  wrongCount: number;
  skipCount: number;
  onAnswer: (choiceIndex: number) => Promise<AnswerResponse | null> | void;
  onSkip: () => Promise<boolean> | void;
  isSubmitting?: boolean;
  error?: Error | null;
}

function formatTime(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safeMilliseconds / 60_000);
  const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
  const millis = safeMilliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function QuizScreen({
  question,
  questionIndex,
  totalQuestions = 10,
  player = null,
  elapsedMs,
  wrongCount,
  skipCount,
  onAnswer,
  onSkip,
  isSubmitting = false,
  error = null,
}: QuizScreenProps) {
  const [feedback, setFeedback] = useState<'wrong' | 'correct' | null>(null);
  const [penaltyPopKey, setPenaltyPopKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [fetchedMs, setFetchedMs] = useState(0);

  useEffect(() => {
    if (!player) {
      setIsPlaying(false);
      setPositionMs(0);
      setFetchedMs(0);
      return;
    }

    const updateAudioState = () => {
      setPositionMs(player.getPositionMs());
      setFetchedMs(player.getFetchedMs());
    };
    updateAudioState();
    const timer = window.setInterval(updateAudioState, 100);
    return () => window.clearInterval(timer);
  }, [player]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 650);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const showPenaltyPop = () => setPenaltyPopKey((key) => key + 1);

  const handleAnswer = async (choiceIndex: number) => {
    const response = await onAnswer(choiceIndex);
    if (response?.correct === false) {
      setFeedback('wrong');
      showPenaltyPop();
    } else if (response?.correct) {
      setFeedback('correct');
    }
  };

  const handleSkip = async () => {
    const skipped = await onSkip();
    if (skipped !== false) showPenaltyPop();
  };

  const handlePlayPause = async () => {
    if (!player) return;
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      return;
    }

    await player.play();
    setIsPlaying(true);
  };

  const handleSeek = (milliseconds: number) => {
    player?.seek(milliseconds);
    setPositionMs(milliseconds);
  };

  const choices = question?.choices ?? [];
  const questionNumber = Math.min(questionIndex + 1, totalQuestions);

  return (
    <>
      <header className="hud">
        <span
          aria-label={`問題 ${questionNumber} / ${totalQuestions}`}
          className="hud__q"
        >
          Q{String(questionNumber).padStart(2, '0')}
          <small> /{totalQuestions}</small>
        </span>
        <span aria-label="経過タイム" className="hud__timer">
          {formatTime(elapsedMs)}
          {penaltyPopKey > 0 ? (
            <span aria-hidden="true" className="penalty-pop" key={penaltyPopKey}>
              +5s
            </span>
          ) : null}
        </span>
      </header>
      <p aria-live="polite" className="hud__penalty">
        <span>
          誤答 <b>{wrongCount}</b>
        </span>
        <span>
          先送り <b>{skipCount}</b>
        </span>
      </p>

      <section
        aria-label={`問題 ${questionNumber}`}
        className={`screen quiz-screen ${feedback === 'wrong' ? 'shake' : ''}`.trim()}
        data-feedback={feedback ?? undefined}
      >
        <PlayDial
          disabled={!player || fetchedMs === 0}
          fetchedMs={fetchedMs}
          isPlaying={isPlaying}
          onToggle={() => void handlePlayPause()}
          positionMs={positionMs}
        />

        <SeekBar
          fetchedMs={fetchedMs}
          onSeek={handleSeek}
          player={player}
          positionMs={positionMs}
        />

        {error ? (
          <p aria-live="assertive" className="form-message form-message--error">
            {error.message || '通信に失敗しました。もう一度お試しください。'}
          </p>
        ) : null}

        <ChoiceGrid
          choices={choices}
          disabled={isSubmitting || choices.length === 0}
          onChoice={(choiceIndex) => void handleAnswer(choiceIndex)}
          wrongFlash={feedback === 'wrong'}
        />

        <button
          className="skip-button"
          disabled={isSubmitting}
          onClick={() => void handleSkip()}
          type="button"
        >
          +5秒払って先を聴く
        </button>
      </section>
    </>
  );
}

export { formatTime };
