/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from './helpers/applyMigrations';

interface SqliteMasterRow {
  name: string;
  sql: string | null;
  type: string;
}

interface TableInfoRow {
  name: string;
  dflt_value: string | number | null;
}

interface IndexListRow {
  name: string;
  unique: number;
}

describe('D1 schema', () => {
  beforeAll(async () => {
    await applyMigrations();
  });

  it('creates the application tables and search indexes', async () => {
    const objects = await env.DB.prepare(
      "SELECT name, sql, type FROM sqlite_master WHERE type IN ('table', 'index')",
    ).all<SqliteMasterRow>();
    const objectNames = new Set(objects.results.map((object) => object.name));

    expect([...objectNames]).toEqual(
      expect.arrayContaining([
        'tracks',
        'segments',
        'sessions',
        'ranking',
        'idx_ranking_time',
        'idx_sessions_created',
      ]),
    );
  });

  it('enforces unique ranking sessions and defaults sessions to unranked', async () => {
    const rankingSchema = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ranking'",
    ).first<{ sql: string }>();
    expect(rankingSchema?.sql).toMatch(/session_id\s+TEXT\s+NOT NULL\s+UNIQUE/);

    const rankingIndexes = await env.DB.prepare("PRAGMA index_list('ranking')").all<IndexListRow>();
    expect(rankingIndexes.results.some((index) => index.unique === 1)).toBe(true);

    const sessionColumns = await env.DB.prepare("PRAGMA table_info('sessions')").all<TableInfoRow>();
    const rankedColumn = sessionColumns.results.find((column) => column.name === 'ranked');
    expect(String(rankedColumn?.dflt_value).replace(/^['"]|['"]$/g, '')).toBe('0');
  });
});
