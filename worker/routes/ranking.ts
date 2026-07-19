import { Hono } from 'hono';
import { getRankByTime, getRankingTop, getSession, insertRanking } from '../db';
import { sanitizeName } from '../domain/sanitize';
import type { Env } from '../types';

const rankingRoutes = new Hono<{ Bindings: Env }>();

rankingRoutes.post('/api/ranking', async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request body' }, 400);
  }

  const sessionId =
    typeof payload === 'object' && payload !== null &&
    typeof (payload as { sessionId?: unknown }).sessionId === 'string'
      ? (payload as { sessionId: string }).sessionId
      : null;
  const name = sanitizeName(
    typeof payload === 'object' && payload !== null
      ? (payload as { name?: unknown }).name
      : undefined,
  );

  if (!sessionId || !name) {
    return c.json({ error: 'sessionId and a valid name are required' }, 400);
  }

  const session = await getSession(c.env.DB, sessionId);
  if (
    !session ||
    session.finishedAt === null ||
    session.finalMs === null ||
    session.ranked !== 0
  ) {
    return c.json({ error: 'Session is not eligible for ranking' }, 409);
  }

  const createdAt = Date.now();
  try {
    await insertRanking(c.env.DB, {
      sessionId,
      name,
      timeMs: session.finalMs,
      createdAt,
    });
  } catch {
    // The UNIQUE(session_id) constraint also covers two concurrent requests.
    return c.json({ error: 'Session is already ranked' }, 409);
  }

  const update = await c.env.DB
    .prepare(
      `UPDATE sessions
       SET ranked = 1
       WHERE id = ?1 AND finished_at IS NOT NULL AND ranked = 0`,
    )
    .bind(sessionId)
    .run();

  if (update.meta.changes !== 1) {
    return c.json({ error: 'Session is already ranked' }, 409);
  }

  const rank = await getRankByTime(c.env.DB, session.finalMs, createdAt);
  return c.json({ rank });
});

rankingRoutes.get('/api/ranking', async (c) => {
  const entries = await getRankingTop(c.env.DB);
  return c.json(entries);
});

export { rankingRoutes };
