import { Hono } from 'hono';
import { drawQuestions } from '../domain/draw';
import {
  getAllTrackIds,
  getTrack,
  insertSession,
  sweepExpiredSessions,
} from '../db';
import type { Env } from '../types';

const gameRoutes = new Hono<{ Bindings: Env }>();

gameRoutes.post('/api/game/start', async (c) => {
  const now = Date.now();

  if (Math.floor(Math.random() * 20) === 0) {
    await sweepExpiredSessions(c.env.DB, now);
  }

  const trackIds = await getAllTrackIds(c.env.DB);
  const questions = drawQuestions(trackIds, Math.random);
  const sessionId = crypto.randomUUID();
  const state = {
    current: 0,
    questions: questions.map((question) => ({
      trackId: question.trackId,
      choices: question.choices,
      startedAt: now,
      wrong: 0,
      skips: 0,
      answeredAt: null,
    })),
  };

  const choiceTrackIds = [
    ...new Set(questions.flatMap((question) => question.choices)),
  ];
  const tracks = await Promise.all(
    choiceTrackIds.map((trackId) => getTrack(c.env.DB, trackId)),
  );

  if (tracks.some((track) => track === null)) {
    return c.json({ error: 'Track data is incomplete' }, 500);
  }

  const trackTitles = new Map(
    tracks.map((track) => [track!.id, track!.title]),
  );
  const responseQuestions = questions.map((question) => ({
    choices: question.choices.map((trackId) => trackTitles.get(trackId)!),
  }));

  await insertSession(c.env.DB, {
    id: sessionId,
    startedAt: now,
    state,
    createdAt: now,
  });

  return c.json({ sessionId, questions: responseQuestions });
});

export { gameRoutes };
