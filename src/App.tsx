import { useState } from 'react';
import { useGame } from './hooks/useGame';
import { QuizScreen } from './screens/QuizScreen';
import { RankingScreen } from './screens/RankingScreen';
import { ResultScreen } from './screens/ResultScreen';
import { StartScreen } from './screens/StartScreen';

type AppScreen = 'start' | 'quiz' | 'result' | 'ranking';

export default function App() {
  const game = useGame();
  const [showRanking, setShowRanking] = useState(false);
  const [highlightedRank, setHighlightedRank] = useState<number | null>(null);
  const [highlightName, setHighlightName] = useState<string | null>(null);

  const gamePhase = game.state ?? game.phase;
  const screen: AppScreen = showRanking ? 'ranking' : gamePhase;

  return (
    <main className="app-shell">
      {screen === 'start' ? (
        <StartScreen
          error={game.error}
          isStarting={game.isStarting}
          onShowRanking={() => setShowRanking(true)}
          onStart={game.start}
        />
      ) : null}
      {screen === 'quiz' ? (
        <QuizScreen
          elapsedMs={game.elapsedMs}
          error={game.error}
          isSubmitting={game.isSubmitting}
          onAnswer={game.submitAnswer}
          onSkip={game.doSkip}
          player={game.player}
          question={game.questions[game.currentQuestion]}
          questionIndex={game.currentQuestion}
          skipCount={game.skipCount}
          wrongCount={game.wrongCount}
        />
      ) : null}
      {screen === 'result' ? (
        <ResultScreen
          elapsedMs={game.elapsedMs}
          finalMs={game.finalMs}
          onShowRanking={(rank, name) => {
            setHighlightedRank(rank ?? null);
            setHighlightName(name ?? null);
            setShowRanking(true);
          }}
          sessionId={game.sessionId}
          skipCount={game.skipCount}
          wrongCount={game.wrongCount}
        />
      ) : null}
      {screen === 'ranking' ? (
        <RankingScreen
          highlightName={highlightName}
          highlightedRank={highlightedRank}
          onBack={() => setShowRanking(false)}
        />
      ) : null}
    </main>
  );
}
