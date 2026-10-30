import { defineConfig } from 'vitest/config';

// Standalone on purpose: merging the base config would concatenate its `include`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/perf/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Timing budgets are only meaningful when nothing else shares the machine.
    fileParallelism: false,
    retry: 0,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
