import { applyD1Migrations, env } from 'cloudflare:test';
import type { Env } from '../../../worker/types';
import migrationSql from '../../../migrations/0001_init.sql?raw';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

const migrations = [
  {
    name: '0001_init.sql',
    queries: migrationSql
      .split(';')
      .map((query) => query.trim())
      .filter((query) => query.length > 0)
      .map((query) => `${query};`),
  },
];

export async function applyMigrations(): Promise<void> {
  await applyD1Migrations(env.DB, migrations);
}
