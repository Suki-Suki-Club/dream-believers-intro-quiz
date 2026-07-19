export interface DrawnQuestion {
  trackId: number;
  choices: number[];
}

function randomIndex(length: number, rng: () => number): number {
  const value = rng();

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('rng must return a number between 0 and 1');
  }

  return Math.min(length - 1, Math.floor(value * length));
}

function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, rng);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

export function drawQuestions(
  trackIds: number[],
  rng: () => number,
): DrawnQuestion[] {
  const pool = [...new Set(trackIds)];

  if (pool.length < 10) {
    throw new Error('At least 10 unique track IDs are required');
  }

  const selectedTrackIds = shuffle(pool, rng).slice(0, 10);

  return selectedTrackIds.map((trackId) => {
    const distractors = pool.filter((candidate) => candidate !== trackId);
    const selectedDistractors = shuffle(distractors, rng).slice(0, 5);

    return {
      trackId,
      choices: shuffle([trackId, ...selectedDistractors], rng),
    };
  });
}
