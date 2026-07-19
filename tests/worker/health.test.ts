/// <reference types="@cloudflare/vitest-pool-workers" />

import { SELF } from 'cloudflare:test';

describe('GET /api/health', () => {
  it('returns a healthy response', async () => {
    const response = await SELF.fetch('http://x/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
