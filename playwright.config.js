import { defineConfig } from '@playwright/test';

// Set PORT to run a second worktree's browser tests at the same time, e.g. PORT=8348 npx playwright test
const PORT = Number(process.env.PORT) || 8347;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // One retry on CI: a test that fails twice is real breakage and fails the
  // run; one that passes on the retry is reported as flaky.
  retries: process.env.CI ? 1 : 0,
  // A GitHub runner has 4 cores; Playwright's default (half the cores) ran
  // only 2 tests at a time there. Locally the default already uses half
  // the Mac's cores.
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:' + PORT,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // Build dist/ with dummy credentials, then serve it through the
    // production edge function (scripts/e2e-server.mjs) so every page gets
    // the live site's nonce CSP: a handler the CSP blocks in production is
    // blocked here too. Supabase itself is faked by helpers.js `mockAuth`.
    command: 'npm run build:e2e && node scripts/e2e-server.mjs',
    port: PORT,
    env: { ...process.env, PORT: String(PORT) },
    // An explicit PORT always starts its own server, so a second worktree
    // never tests another worktree's dist/.
    reuseExistingServer: !process.env.CI && !process.env.PORT,
    timeout: 60_000,
  },
});
