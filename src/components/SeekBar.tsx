import type { SegmentPlayer } from '../audio/segmentPlayer';

export interface SeekBarProps {
  player: SegmentPlayer | null;
  positionMs: number;
  fetchedMs: number;
  onSeek: (milliseconds: number) => void;
}

function formatSeconds(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A native range control whose upper bound is the audio already fetched. */
export function SeekBar({
  player,
  positionMs,
  fetchedMs,
  onSeek,
}: SeekBarProps) {
  const max = Math.max(0, fetchedMs);
  const value = Math.min(Math.max(0, positionMs), max);

  return (
    <div className="seek-bar">
      <label className="seek-bar__label" htmlFor="audio-seek">
        音声の再生位置
      </label>
      <input
        aria-label="シークバー"
        className="seek-bar__input"
        disabled={!player || max === 0}
        id="audio-seek"
        max={max}
        min={0}
        onChange={(event) => onSeek(Number(event.target.value))}
        step={100}
        type="range"
        value={value}
      />
      <div aria-live="off" className="seek-bar__times">
        <span>{formatSeconds(value)}</span>
        <span>{formatSeconds(max)}</span>
      </div>
    </div>
  );
}
