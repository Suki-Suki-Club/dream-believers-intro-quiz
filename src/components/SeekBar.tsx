import type { SegmentPlayer } from '../audio/segmentPlayer';

export interface SeekBarProps {
  player: SegmentPlayer | null;
  positionMs: number;
  fetchedMs: number;
  onSeek: (milliseconds: number) => void;
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
    <div className="scrub">
      <label className="visually-hidden" htmlFor="audio-seek">
        音声の再生位置
      </label>
      <input
        aria-label="シークバー"
        className="scrub__input"
        disabled={!player || max === 0}
        id="audio-seek"
        max={max}
        min={0}
        onChange={(event) => onSeek(Number(event.target.value))}
        step={100}
        type="range"
        value={value}
      />
      <p className="scrub__hint">聴けた範囲は何度でも聴き直せる</p>
    </div>
  );
}
