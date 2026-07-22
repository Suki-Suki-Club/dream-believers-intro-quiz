import { Hono } from 'hono';
import { canServeSegment } from '../domain/clockGate';
import { drawQuestions } from '../domain/draw';
import { applyAnswer, applySkip } from '../domain/session';
import { computeFinalMs } from '../domain/timing';
import {
  getAllTrackIds,
  getSegmentKey,
  getSession,
  getTrack,
  insertSession,
  sweepExpiredSessions,
  updateSessionState,
} from '../db';
import type { Env } from '../types';

const gameRoutes = new Hono<{ Bindings: Env }>();

function parseNonNegativeInteger(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

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

gameRoutes.get('/api/game/:sid/q/:n/seg/:k', async (c) => {
  const session = await getSession(c.env.DB, c.req.param('sid'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const n = parseNonNegativeInteger(c.req.param('n'));
  const k = parseNonNegativeInteger(c.req.param('k'));
  if (n === null || k === null) {
    return c.json({ error: 'Invalid segment coordinates' }, 400);
  }

  const question = session.state.questions[n];
  if (!question) {
    return c.json({ error: 'Question not found' }, 404);
  }

  if (
    k >= 1 &&
    (session.state.current !== n ||
      !(await canServeCurrentSegment(c.env.DB, question.trackId, question, k)))
  ) {
    return c.json({ error: 'Segment is not available' }, 403);
  }

  const segmentKey = await getSegmentKey(c.env.DB, question.trackId, k);
  if (!segmentKey) {
    return c.json({ error: 'Segment not found' }, 404);
  }

  const object = await c.env.MEDIA.get(segmentKey);
  if (!object) {
    return c.json({ error: 'Segment not found' }, 404);
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mp4',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
});

gameRoutes.get('/api/game/:sid/q/:n/reward', async (c) => {
  const session = await getSession(c.env.DB, c.req.param('sid'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const n = parseNonNegativeInteger(c.req.param('n'));
  if (n === null) {
    return c.json({ error: 'Invalid question number' }, 400);
  }

  const question = session.state.questions[n];
  if (!question || question.answeredAt === null) {
    return c.json({ error: 'Reward not available' }, 404);
  }

  const track = await getTrack(c.env.DB, question.trackId);
  if (!track || !track.rewardKey) {
    return c.json({ error: 'Reward not available' }, 404);
  }

  const object = await c.env.MEDIA.get(track.rewardKey);
  if (!object) {
    return c.json({ error: 'Reward not available' }, 404);
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mp4',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
});

gameRoutes.get('/api/game/:sid/q/:n/art', async (c) => {
  const session = await getSession(c.env.DB, c.req.param('sid'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const n = parseNonNegativeInteger(c.req.param('n'));
  if (n === null) {
    return c.json({ error: 'Invalid question number' }, 400);
  }

  const question = session.state.questions[n];
  if (!question || question.answeredAt === null) {
    return c.json({ error: 'Art not available' }, 404);
  }

  const track = await getTrack(c.env.DB, question.trackId);
  if (!track || !track.artKey) {
    return c.json({ error: 'Art not available' }, 404);
  }

  const object = await c.env.MEDIA.get(track.artKey);
  if (!object) {
    return c.json({ error: 'Art not available' }, 404);
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
});

gameRoutes.post('/api/game/:sid/q/:n/answer', async (c) => {
  const session = await getSession(c.env.DB, c.req.param('sid'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const n = parseNonNegativeInteger(c.req.param('n'));
  if (n === null) {
    return c.json({ error: 'Invalid question number' }, 400);
  }

  if (session.finishedAt !== null || session.state.current !== n) {
    return c.json({ error: 'Question is no longer current' }, 409);
  }

  const question = session.state.questions[n];
  if (!question) {
    return c.json({ error: 'Question not found' }, 404);
  }

  let payload: unknown;
  try {
    payload = await c.req.json<{ choice?: unknown }>();
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const choice =
    typeof payload === 'object' && payload !== null
      ? (payload as { choice?: unknown }).choice
      : undefined;
  if (
    typeof choice !== 'number' ||
    !Number.isSafeInteger(choice) ||
    choice < 0 ||
    choice > 5
  ) {
    return c.json({ error: 'Choice must be an integer from 0 to 5' }, 400);
  }

  const now = Date.now();
  const result = applyAnswer(
    session.state,
    n,
    question.choices[choice],
    question.trackId,
    now,
  );

  if (!result.ok) {
    if ('reason' in result) {
      return c.json({ error: 'Question is no longer current' }, 409);
    }

    await updateSessionState(c.env.DB, session.id, result.state);
    return c.json({ correct: false });
  }

  if (!result.finished) {
    await updateSessionState(c.env.DB, session.id, result.state);
    return c.json({ correct: true });
  }

  const finalMs = computeFinalMs(result.state, now);
  await c.env.DB.prepare(
    `UPDATE sessions
     SET state = ?1, finished_at = ?2, final_ms = ?3
     WHERE id = ?4`,
  )
    .bind(JSON.stringify(result.state), now, finalMs, session.id)
    .run();

  return c.json({ correct: true, finalMs });
});

gameRoutes.post('/api/game/:sid/q/:n/skip', async (c) => {
  const session = await getSession(c.env.DB, c.req.param('sid'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const n = parseNonNegativeInteger(c.req.param('n'));
  if (n === null) {
    return c.json({ error: 'Invalid question number' }, 400);
  }

  if (session.finishedAt !== null || session.state.current !== n) {
    return c.json({ error: 'Question is no longer current' }, 409);
  }

  const result = applySkip(session.state, n, Date.now());
  if (!result.ok) {
    return c.json({ error: 'Question is no longer current' }, 409);
  }

  await updateSessionState(c.env.DB, session.id, result.state);
  return new Response(null, { status: 204 });
});

async function canServeCurrentSegment(
  db: Env['DB'],
  trackId: number,
  question: Parameters<typeof canServeSegment>[1],
  k: number,
): Promise<boolean> {
  const track = await getTrack(db, trackId);
  if (!track) {
    return false;
  }

  return canServeSegment(k, question, Date.now(), track.clipMs);
}

export { gameRoutes };
