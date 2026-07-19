export interface StartScreenProps {
  onStart: () => void | Promise<void>;
  onShowRanking?: () => void;
  isStarting?: boolean;
  error?: Error | null;
}

const PETALS = [
  { left: '6%', delay: '0s', duration: '8s', size: '1.1rem' },
  { left: '22%', delay: '2.1s', duration: '10s', size: '0.9rem' },
  { left: '42%', delay: '0.8s', duration: '9s', size: '1.3rem' },
  { left: '64%', delay: '3.4s', duration: '8.5s', size: '1rem' },
  { left: '80%', delay: '1.3s', duration: '11s', size: '1.15rem' },
  { left: '92%', delay: '4s', duration: '9.5s', size: '0.85rem' },
];

export function StartScreen({
  onStart,
  onShowRanking,
  isStarting = false,
  error = null,
}: StartScreenProps) {
  return (
    <section aria-labelledby="start-title" className="screen start-screen">
      <div aria-hidden="true" className="petals">
        {PETALS.map((petal, index) => (
          <span
            className="petal"
            key={index}
            style={{
              left: petal.left,
              animationDelay: petal.delay,
              animationDuration: petal.duration,
              fontSize: petal.size,
            }}
          >
            ❁
          </span>
        ))}
      </div>

      <h1 className="wordmark" id="start-title">
        <span className="wordmark__mark">Dream</span> Believers
        <span className="wordmark--sub">イントロクイズ</span>
      </h1>

      <p className="start-tagline">
        ぜんぶ同じ曲。ぜんぶ違う。
        <br />
        イントロだけで聴き分けろ。
      </p>

      <ul aria-label="ゲームルール" className="start-rules">
        <li>
          <span aria-hidden="true" className="rule-dot" />
          <b>全10問・6択</b>、全問正解までのタイムを競う
        </li>
        <li>
          <span aria-hidden="true" className="rule-dot rule-dot--red" />
          誤答と先送りは<b>+5秒</b>
        </li>
        <li>
          <span aria-hidden="true" className="rule-dot rule-dot--gold" />
          タイムは<b>全国ランキング</b>へ
        </li>
      </ul>

      {error ? (
        <p aria-live="assertive" className="form-message form-message--error">
          {error.message || 'ゲームを開始できませんでした。'}
        </p>
      ) : null}

      <div className="start-actions">
        <button
          aria-busy={isStarting}
          className="btn btn--cta"
          disabled={isStarting}
          onClick={() => void onStart()}
          type="button"
        >
          {isStarting ? '準備中…' : 'スタート'}
        </button>
        {onShowRanking ? (
          <button
            className="btn btn--ghost"
            onClick={onShowRanking}
            type="button"
          >
            ランキングを見る
          </button>
        ) : null}
      </div>
    </section>
  );
}
