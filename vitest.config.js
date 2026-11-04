import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
    globals: true,
    include: ['tests/**/*.test.js'],
    // Generate builds several candidate comments a press and scores them
    // against the class, so the comment-bank tests take 4–7 s on a Mac and
    // longer on CI's machines (Nov 4 2026: ten timed out at 5 s).
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
