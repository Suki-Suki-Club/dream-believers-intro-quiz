import { useEffect, useState } from 'react';
import { Button } from '@suki-suki-club/link-like-ui/System/Button';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from '@suki-suki-club/link-like-ui/System/Card';
import type { AnswerResponse, Question } from '../api/types';
import type { SegmentPlayer } from '../audio/segmentPlayer';
import { ChoiceGrid } from '../components/ChoiceGrid';
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

  const handleAnswer = async (choiceIndex: number) => {
    const response = await onAnswer(choiceIndex);
    if (response?.correct === false) {
      setFeedback('wrong');
    } else if (response?.correct) {
      setFeedback('correct');
    }
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
  const questionLabel = `問題 ${Math.min(questionIndex + 1, totalQuestions)} / ${totalQuestions}`;

  return (
    <section
      aria-labelledby="quiz-title"
      className={`screen quiz-screen ${feedback === 'wrong' ? 'is-wrong shake' : ''} ${feedback === 'correct' ? 'is-correct' : ''}`.trim()}
      data-feedback={feedback ?? undefined}
    >
      <Card className="quiz-card">
        <CardHeader className="quiz-card__header">
          <div className="quiz-card__topline">
            <span className="screen__eyebrow">INTRO QUIZ</span>
            <span aria-label="問題番号" className="question-count">
              {questionLabel}
            </span>
          </div>
          <CardTitle className="quiz-card__title" id="quiz-title">
            曲を聴いて答えよう
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="audio-player" aria-label="音声プレイヤー">
            <div className="audio-player__controls">
              <Button
                aria-label={isPlaying ? '一時停止' : '再生'}
                className="play-button"
                disabled={!player || fetchedMs === 0}
                onClick={() => void handlePlayPause()}
                type="button"
              >
                {isPlaying ? '一時停止' : '再生'}
              </Button>
              <span className="audio-player__hint">
                取得済みの範囲だけシークできます
              </span>
            </div>
            <SeekBar
              fetchedMs={fetchedMs}
              onSeek={handleSeek}
              player={player}
              positionMs={positionMs}
            />
          </div>

          <div aria-live="polite" className="quiz-stats">
            <div className="quiz-stat quiz-stat--primary">
              <span>経過タイム</span>
              <strong>{formatTime(elapsedMs)}</strong>
            </div>
            <div className="quiz-stat">
              <span>誤答</span>
              <strong>{wrongCount}回</strong>
            </div>
            <div className="quiz-stat">
              <span>先送り</span>
              <strong>{skipCount}回</strong>
            </div>
          </div>

          {error ? (
            <p aria-live="assertive" className="form-message form-message--error">
              {error.message || '通信に失敗しました。もう一度お試しください。'}
            </p>
          ) : null}

          <ChoiceGrid
            choices={choices}
            disabled={isSubmitting || choices.length === 0}
            onChoice={(choiceIndex) => void handleAnswer(choiceIndex)}
          />

          <div className="quiz-card__footer">
            <p className="penalty-note">誤答・先送りごとに +5秒</p>
            <Button
              className="skip-button"
              disabled={isSubmitting}
              onClick={() => void onSkip()}
              type="button"
              variant="secondary"
            >
              先送り
            </Button>
          </div>
        </CardBody>
      </Card>
    </section>
  );
}

export { formatTime };
