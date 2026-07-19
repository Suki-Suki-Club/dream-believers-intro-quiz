import { env } from 'cloudflare:test';

const TRACK_COUNT = 12;
const SEGMENT_COUNT = 3;

export async function seedGameData(): Promise<void> {
  const statements = [];

  for (let trackId = 1; trackId <= TRACK_COUNT; trackId += 1) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO tracks (id, title, clip_ms, seg_count)
         VALUES (?1, ?2, ?3, ?4)`,
      ).bind(
        trackId,
        `Dream Believers version ${trackId}`,
        15000,
        SEGMENT_COUNT,
      ),
    );

    for (let index = 0; index < SEGMENT_COUNT; index += 1) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO segments (track_id, idx, r2_key)
           VALUES (?1, ?2, ?3)`,
        ).bind(trackId, index, `seed-track-${trackId}-segment-${index}`),
      );
    }
  }

  await env.DB.batch(statements);
}
