import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // core/ is testable with plain Node against fixtures — no Electron (§3, §10).
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
