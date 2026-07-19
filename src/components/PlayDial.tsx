export interface PlayDialProps {
  isPlaying: boolean;
  positionMs: number;
  fetchedMs: number;
  disabled?: boolean;
  onToggle: () => void;
}

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatSeconds(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * 再生の中心にあるリスニングダイヤル。リングは取得済み音声の中での
 * 現在位置を表す(クリップ全長は答えのヒントになるため出さない)。
 */
export function PlayDial({
  isPlaying,
  positionMs,
  fetchedMs,
  disabled = false,
  onToggle,
}: PlayDialProps) {
  const ratio = fetchedMs > 0 ? Math.min(1, Math.max(0, positionMs / fetchedMs)) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - ratio);

  return (
    <div className="dial">
      <svg aria-hidden="true" viewBox="0 0 120 120">
        <defs>
          <linearGradient id="dial-dawn" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#7ed3ff" />
            <stop offset="55%" stopColor="#a9c4ff" />
            <stop offset="100%" stopColor="#ffb7d2" />
          </linearGradient>
        </defs>
        <circle
          className="dial__track"
          cx="60"
          cy="60"
          fill="none"
          r={RADIUS}
          strokeWidth="5"
        />
        <circle
          className="dial__progress"
          cx="60"
          cy="60"
          fill="none"
          r={RADIUS}
          stroke="url(#dial-dawn)"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth="5"
        />
      </svg>
      <button
        aria-label={isPlaying ? '一時停止' : '再生'}
        className="dial__button"
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        {isPlaying ? (
          <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
            <path d="M7 4h4v16H7zM13 4h4v16h-4z" />
          </svg>
        ) : (
          <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 4.5v15l13-7.5z" />
          </svg>
        )}
      </button>
      <p aria-live="off" className="dial__time">
        <b>{formatSeconds(positionMs)}</b>
        {' / '}
        {formatSeconds(fetchedMs)}
      </p>
    </div>
  );
}
