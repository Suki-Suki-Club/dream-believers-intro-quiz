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
      <p className="eyebrow" id="result-title">
        Finish
      </p>

      <div aria-label="確定タイム" className="final-time">
        <span className="final-time__label">確定タイム</span>
        <strong className="final-time__value">
          {formatResultTime(scoreMs)}
        </strong>
      </div>

      <dl aria-label="タイムの内訳" className="breakdown">
        <div>
          <dt>実時間</dt>
          <dd>{formatResultTime(baseMs)}</dd>
        </div>
        <div className="is-penalty">
          <dt>誤答ペナルティ（{wrongCount}回）</dt>
          <dd>+{wrongCount * 5}秒</dd>
        </div>
        <div className="is-penalty">
          <dt>先送りペナルティ（{skipCount}回）</dt>
          <dd>+{skipCount * 5}秒</dd>
        </div>
      </dl>

      {rank !== null ? (
        <div aria-live="polite" className="rank-result">
          <span>ランキング登録完了</span>
          <strong>{rank}位</strong>
        </div>
      ) : (
        <form className="ranking-form" onSubmit={handleSubmit}>
          <div className="field">
            <label className="field__label" htmlFor="ranking-name">
              ランキングに表示する名前
            </label>
            <input
              aria-label="ランキングに表示する名前"
              autoComplete="nickname"
              className="field__input"
              id="ranking-name"
              maxLength={20}
              onChange={(event) => setName(event.target.value)}
              placeholder="なまえ"
              value={name}
            />
          </div>
          {error ? (
            <p aria-live="assertive" className="form-message form-message--error">
              {error.message || 'ランキングに登録できませんでした。'}
            </p>
          ) : null}
          <button
            className="btn btn--cta"
            disabled={!sessionId || !name.trim() || isSubmitting}
            type="submit"
          >
            {isSubmitting ? '登録中…' : 'ランキングに登録'}
          </button>
        </form>
      )}

      <div className="result-actions">
        {onShowRanking ? (
          <button
            className="btn btn--ghost"
            onClick={() =>
              rank !== null ? onShowRanking(rank, name.trim()) : onShowRanking()
            }
            type="button"
          >
            ランキングを見る
          </button>
        ) : null}
      </div>
    </section>
  );
}

export { formatResultTime };
