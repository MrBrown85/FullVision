import { defineConfig } from 'vitest/config';

// Every test runs in BC time (America/Vancouver, UTC-7 year-round since BC's change), on a teacher's Mac and
// on GitHub alike (Colin, Nov 24 2026). Tests ran in the machine's zone: UTC on GitHub, where a "today" taken
// from the UTC date matched the page's local day, so the mistake never showed; BC on the Mac, where it failed
// every evening once UTC was already tomorrow. Set before vitest starts its workers, which inherit it.
// tests/time-zone.test.js checks it holds and that no test takes "today" from the UTC date.
process.env.TZ = 'America/Vancouver';

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
