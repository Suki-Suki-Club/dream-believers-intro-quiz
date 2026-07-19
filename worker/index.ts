import { Hono } from 'hono';
import { gameRoutes } from './routes/game';
import { rankingRoutes } from './routes/ranking';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/', gameRoutes);
app.route('/', rankingRoutes);

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
