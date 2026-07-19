import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
}
