import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
    globals: true,
    include: ['tests/**/*.test.js'],
    // CI's runners are several times slower than a laptop when busy: the heavy tests (20,000 random levels in
    // calc.test.js, the comment bank read whole) have gone past vitest's five seconds there and failed pull
    // requests that never touched them. No test's checks change.
    testTimeout: 20000,
  },
});
