import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { UseGameResult } from '../../src/hooks/useGame';
import App from '../../src/App';
import { QuizScreen } from '../../src/screens/QuizScreen';
import { ResultScreen } from '../../src/screens/ResultScreen';
import { RankingScreen } from '../../src/screens/RankingScreen';
import { StartScreen } from '../../src/screens/StartScreen';
import { getRanking, postRanking } from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  getRanking: vi.fn(),
  postRanking: vi.fn(),
}));

vi.mock('../../src/hooks/useGame', () => ({
  useGame: vi.fn(),
}));

const getRankingMock = vi.mocked(getRanking);
const postRankingMock = vi.mocked(postRanking);

function gameState(overrides: Partial<UseGameResult> = {}): UseGameResult {
  return {
    state: 'start',
    phase: 'start',
    status: 'start',
    sessionId: null,
    questions: [],
    currentQuestion: 0,
    currentQuestionIndex: 0,
    player: null,
    elapsedMs: 0,
    finalMs: null,
    wrongCount: 0,
    skipCount: 0,
    wrong: 0,
    skips: 0,
    penalties: { wrong: 0, skips: 0 },
    isStarting: false,
    isSubmitting: false,
    error: null,
    start: vi.fn(async () => undefined),
    submitAnswer: vi.fn(async () => null),
    doSkip: vi.fn(async () => true),
    ...overrides,
  };
}

describe('game screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRankingMock.mockResolvedValue([]);
    postRankingMock.mockResolvedValue({ rank: 3 });
  });

  it('renders the start rules and invokes start', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();

    render(<StartScreen onStart={onStart} />);

    expect(screen.getByText('Dream Believers イントロクイズ')).toBeInTheDocument();
    expect(screen.getByText(/全10問/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ゲームをスタート/ }));

    expect(onStart).toHaveBeenCalledOnce();
  });

  it('renders six choices and applies wrong-answer feedback', async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn(async () => ({ correct: false }));

    const { container } = render(
      <QuizScreen
        elapsedMs={1_234}
        onAnswer={onAnswer}
        onSkip={vi.fn(async () => true)}
        question={{ choices: ['A', 'B', 'C', 'D', 'E', 'F'] }}
        questionIndex={0}
        skipCount={0}
        wrongCount={0}
      />,
    );

    expect(screen.getAllByRole('button', { name: /^[1-6] / })).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: /3 C/ }));

    expect(onAnswer).toHaveBeenCalledWith(2);
    expect(container.querySelector('.quiz-screen.shake')).toBeInTheDocument();
  });

  it('registers the result and shows the returned rank', async () => {
    const user = userEvent.setup();

    render(
      <ResultScreen
        finalMs={12_345}
        onShowRanking={vi.fn()}
        sessionId="session-1"
        skipCount={1}
        wrongCount={2}
      />,
    );

    await user.type(screen.getByLabelText('ランキングに表示する名前'), 'Dreamer');
    await user.click(screen.getByRole('button', { name: 'ランキングに登録' }));

    await waitFor(() => expect(screen.getByText('3位')).toBeInTheDocument());
    expect(postRankingMock).toHaveBeenCalledWith('session-1', 'Dreamer');
  });

  it('renders ranking entries and highlights the current player', () => {
    render(
      <RankingScreen
        entries={[
          { name: 'Dreamer', timeMs: 12_345, createdAt: 1 },
          { name: 'Another', timeMs: 15_000, createdAt: 2 },
        ]}
        highlightedRank={1}
      />,
    );

    expect(screen.getByRole('heading', { name: 'ランキング' })).toBeInTheDocument();
    expect(screen.getByText('Dreamer')).toBeInTheDocument();
    expect(screen.getByText('Another')).toBeInTheDocument();
    expect(screen.getByText('Dreamer').closest('li')).toHaveClass('ranking-highlight');
  });

  it('switches the App from the start screen to the quiz screen', async () => {
    const { useGame } = await import('../../src/hooks/useGame');
    const start = vi.fn(async () => undefined);
    vi.mocked(useGame).mockReturnValue(
      gameState({
        start,
        state: 'quiz',
        phase: 'quiz',
        status: 'quiz',
        questions: [{ choices: ['A', 'B', 'C', 'D', 'E', 'F'] }],
      }),
    );

    render(<App />);

    expect(screen.getByRole('button', { name: /1 A/ })).toBeInTheDocument();
  });
});
