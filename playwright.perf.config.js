import { defineConfig } from '@playwright/test';

// The speed recorder (e2e-perf/). One worker and no retries, so the numbers
// come from one quiet browser. It records; it never gates (see the spec).
// Set PORT (or PERF_PORT) to run it beside another worktree's tests.
const PORT = Number(process.env.PORT || process.env.PERF_PORT) || 8349;

export default defineConfig({
  testDir: './e2e-perf',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/perf/report.json' }]],
  use: { baseURL: 'http://localhost:' + PORT, headless: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build:e2e && node scripts/e2e-server.mjs',
    env: { ...process.env, PORT: String(PORT) },
    port: PORT,
    // Always start its own server, so it never measures another worktree's dist/.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
