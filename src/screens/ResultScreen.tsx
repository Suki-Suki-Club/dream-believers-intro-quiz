import { FormInputField } from '@suki-suki-club/link-like-ui/System/Form';
import { Button } from '@suki-suki-club/link-like-ui/System/Button';
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@suki-suki-club/link-like-ui/System/Card';
import { useState } from 'react';
import { postRanking } from '../api/client';

export interface ResultScreenProps {
  sessionId: string | null;
  finalMs: number | null;
  elapsedMs?: number;
  wrongCount: number;
  skipCount: number;
  onShowRanking?: (rank?: number, name?: string) => void;
}

function formatResultTime(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safeMilliseconds / 60_000);
  const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
  const millis = safeMilliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function ResultScreen({
  sessionId,
  finalMs,
  elapsedMs = 0,
  wrongCount,
  skipCount,
  onShowRanking,
}: ResultScreenProps) {
  const [name, setName] = useState('');
  const [rank, setRank] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const scoreMs = finalMs ?? elapsedMs;
  const penaltyMs = (wrongCount + skipCount) * 5_000;
  const baseMs = Math.max(0, scoreMs - penaltyMs);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionId || !name.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await postRanking(sessionId, name.trim());
      setRank(response.rank);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="result-title" className="screen result-screen">
      <Card className="result-card">
        <CardHeader>
          <div className="screen__eyebrow">FINISH</div>
          <CardTitle id="result-title">
            クリアおめでとう！
          </CardTitle>
          <CardDescription>あなたの結果</CardDescription>
        </CardHeader>
        <CardBody>
          <div aria-label="確定タイム" className="result-time">
            <span>確定タイム</span>
            <strong>{formatResultTime(scoreMs)}</strong>
          </div>

          <dl aria-label="タイムの内訳" className="result-breakdown">
            <div>
              <dt>実時間</dt>
              <dd>{formatResultTime(baseMs)}</dd>
            </div>
            <div>
              <dt>誤答ペナルティ</dt>
              <dd>+{wrongCount * 5}秒（{wrongCount}回）</dd>
            </div>
            <div>
              <dt>先送りペナルティ</dt>
              <dd>+{skipCount * 5}秒（{skipCount}回）</dd>
            </div>
          </dl>

          {rank !== null ? (
            <div aria-live="polite" className="rank-result">
              <span>ランキング登録完了</span>
              <strong>{rank}位</strong>
            </div>
          ) : (
            <form className="ranking-form" onSubmit={handleSubmit}>
              <FormInputField
                aria-label="ランキングに表示する名前"
                autoComplete="nickname"
                label="ランキングに表示する名前"
                maxLength={20}
                onChange={(event) => setName(event.target.value)}
                placeholder="なまえ"
                value={name}
              />
              {error ? (
                <p aria-live="assertive" className="form-message form-message--error">
                  {error.message || 'ランキングに登録できませんでした。'}
                </p>
              ) : null}
              <Button
                className="ranking-submit"
                disabled={!sessionId || !name.trim() || isSubmitting}
                type="submit"
              >
                {isSubmitting ? '登録中…' : 'ランキングに登録'}
              </Button>
            </form>
          )}

          <div className="result-card__actions">
            {rank !== null && onShowRanking ? (
              <Button
                onClick={() => onShowRanking(rank, name.trim())}
                type="button"
                variant="gradient"
              >
                ランキングを見る
              </Button>
            ) : null}
            {rank === null && onShowRanking ? (
              <Button
                onClick={() => onShowRanking()}
                type="button"
                variant="secondary"
              >
                ランキングを見る
              </Button>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </section>
  );
}

export { formatResultTime };
