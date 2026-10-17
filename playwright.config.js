import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8347',
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
    port: 8347,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
