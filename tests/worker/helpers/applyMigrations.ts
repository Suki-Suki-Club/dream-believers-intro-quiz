import { applyD1Migrations, env } from 'cloudflare:test';
import type { Env } from '../../../worker/types';
import migrationSql from '../../../migrations/0001_init.sql?raw';
import migrationSql0002 from '../../../migrations/0002_add_reward_art_keys.sql?raw';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

function toQueries(sql: string): string[] {
  return sql
    .split(';')
    .map((query) => query.trim())
    .filter((query) => query.length > 0)
    .map((query) => `${query};`);
}

const migrations = [
  {
    name: '0001_init.sql',
    queries: toQueries(migrationSql),
  },
  {
    name: '0002_add_reward_art_keys.sql',
    queries: toQueries(migrationSql0002),
  },
];

export async function applyMigrations(): Promise<void> {
  await applyD1Migrations(env.DB, migrations);
}
