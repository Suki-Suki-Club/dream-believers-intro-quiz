import { useEffect, useState } from 'react';
import { Button } from '@suki-suki-club/link-like-ui/System/Button';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from '@suki-suki-club/link-like-ui/System/Card';
import type { RankingEntry } from '../api/types';
import { getRanking } from '../api/client';

export interface RankingScreenProps {
  entries?: RankingEntry[];
  highlightedRank?: number | null;
  highlightName?: string | null;
  onBack?: () => void;
}

function formatRankingTime(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safeMilliseconds / 60_000);
  const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
  const millis = safeMilliseconds % 1_000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function RankingScreen({
  entries: providedEntries,
  highlightedRank = null,
  highlightName = null,
  onBack,
}: RankingScreenProps) {
  const [entries, setEntries] = useState<RankingEntry[]>(providedEntries ?? []);
  const [isLoading, setIsLoading] = useState(providedEntries === undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (providedEntries !== undefined) {
      setEntries(providedEntries.slice(0, 50));
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void getRanking()
      .then((nextEntries) => {
        if (!cancelled) setEntries(nextEntries.slice(0, 50));
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providedEntries]);

  return (
    <section aria-labelledby="ranking-title" className="screen ranking-screen">
      <Card className="ranking-card">
        <CardHeader className="ranking-card__header">
          <div className="screen__eyebrow">LEADERBOARD</div>
          <CardTitle id="ranking-title">
            ランキング
          </CardTitle>
          <p className="ranking-card__subtitle">上位50名</p>
        </CardHeader>
        <CardBody>
          {isLoading ? <p className="loading-message">ランキングを読み込み中…</p> : null}
          {error ? (
            <p aria-live="assertive" className="form-message form-message--error">
              {error.message || 'ランキングを読み込めませんでした。'}
            </p>
          ) : null}
          {!isLoading && !error && entries.length === 0 ? (
            <p className="empty-message">まだランキングに登録されていません。</p>
          ) : null}
          {entries.length > 0 ? (
            <ol aria-label="ランキング順位" className="ranking-list">
              {entries.map((entry, index) => {
                const rank = index + 1;
                const isHighlighted =
                  (highlightedRank !== null && rank === highlightedRank) ||
                  (highlightName !== null && entry.name === highlightName);
                return (
                  <li
                    className={`ranking-list__item ${isHighlighted ? 'ranking-highlight' : ''}`.trim()}
                    data-rank={rank}
                    key={`${entry.createdAt}-${entry.name}-${rank}`}
                  >
                    <span aria-label={`${rank}位`} className="ranking-list__rank">
                      {rank}
                    </span>
                    <span className="ranking-list__name">{entry.name}</span>
                    <strong className="ranking-list__time">
                      {formatRankingTime(entry.timeMs)}
                    </strong>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {onBack ? (
            <Button
              className="ranking-back"
              onClick={onBack}
              type="button"
              variant="secondary"
            >
              戻る
            </Button>
          ) : null}
        </CardBody>
      </Card>
    </section>
  );
}

export { formatRankingTime };
