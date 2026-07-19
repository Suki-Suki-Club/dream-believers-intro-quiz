import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['tests/worker/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          d1Databases: ['DB'],
          r2Buckets: ['MEDIA'],
        },
      },
    },
  },
});
