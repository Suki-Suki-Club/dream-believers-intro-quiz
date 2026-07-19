import { Button } from '@suki-suki-club/link-like-ui/System/Button';
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@suki-suki-club/link-like-ui/System/Card';

export interface StartScreenProps {
  onStart: () => void | Promise<void>;
  onShowRanking?: () => void;
  isStarting?: boolean;
  error?: Error | null;
}

export function StartScreen({
  onStart,
  onShowRanking,
  isStarting = false,
  error = null,
}: StartScreenProps) {
  return (
    <section aria-labelledby="start-title" className="screen start-screen">
      <div className="screen__eyebrow">DREAM BELIEVERS</div>
      <Card className="start-card">
        <CardHeader className="start-card__header">
          <CardTitle className="start-card__title" id="start-title">
            Dream Believers イントロクイズ
          </CardTitle>
          <CardDescription>
            音の記憶を頼りに、10問のイントロを駆け抜けよう。
          </CardDescription>
        </CardHeader>
        <CardBody>
          <div className="rules" aria-label="ゲームルール">
            <h2>ルール</h2>
            <ul>
              <li>全10問、6つの候補から曲を選びます。</li>
              <li>全問正解までの時間が短いほど上位になります。</li>
              <li>誤答と先送りには、それぞれ5秒のペナルティが加算されます。</li>
            </ul>
          </div>

          {error ? (
            <p aria-live="assertive" className="form-message form-message--error">
              {error.message || 'ゲームを開始できませんでした。'}
            </p>
          ) : null}

          <div className="start-card__actions">
            <Button
              aria-busy={isStarting}
              className="start-button"
              disabled={isStarting}
              onClick={() => void onStart()}
              size="lg"
              type="button"
            >
              {isStarting ? '準備中…' : 'ゲームをスタート'}
            </Button>
            {onShowRanking ? (
              <Button
                className="ranking-link"
                onClick={onShowRanking}
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
