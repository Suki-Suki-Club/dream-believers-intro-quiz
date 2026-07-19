import { defineConfig, defaultExclude } from 'vitest/config';
import viteConfig from './vite.config';

export default defineConfig({
  ...viteConfig,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setupTests.ts'],
    include: [
      'tests/client/**/*.{test,spec}.{ts,tsx}',
      'tests/domain/**/*.test.ts',
    ],
    exclude: [...defaultExclude, '**/.omc/**', 'tests/worker/**'],
  },
});
