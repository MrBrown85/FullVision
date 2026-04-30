import { defineConfig } from '@playwright/test';

// Load .env into process.env for the test runner. dev-local.mjs does this
// for the webServer process, but the test runner is a separate process and
// needs the vars too (TEST_USER_EMAIL, TEST_USER_PASSWORD, etc). Playwright
// loads this config in a CJS context so we use require() for node builtins.
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

/**
 * Real-Supabase end-to-end config.
 *
 * Distinct from playwright.config.js (which mocks auth and builds dist/ with
 * dummy credentials). This config runs the dev-local server with real
 * Supabase credentials from .env, so tests exercise the production write
 * path including auth, RLS, and RPC behavior.
 *
 * Required env vars (set in .env or shell):
 *   SUPABASE_URL          — gradebook-prod URL
 *   SUPABASE_KEY          — anon publishable key
 *   TEST_USER_EMAIL       — disposable test account email
 *   TEST_USER_PASSWORD    — disposable test account password
 *
 * Run with: npm run test:e2e:real
 */
export default defineConfig({
  // testDir points at the per-entity persistence specs and the smoke spec.
  // The legacy e2e-real/persistence.spec.js has been retired; keeping the
  // glob explicit prevents it from re-running if someone restores the file
  // by accident.
  testDir: './e2e-real',
  testMatch: ['persistence/**/*.spec.js', 'smoke/**/*.spec.js'],
  // Real network round-trips are slower than mocked ones. 90s per test —
  // multi-step persistence tests (e.g. setup-student-then-score-then-cycle)
  // can run a 4-RPC chain plus two sign-in/out cycles.
  timeout: 90_000,
  retries: 0,
  // Force serial execution. Tests share a single test user account, so
  // parallel runs would race on cleanup.
  workers: 1,
  use: {
    baseURL: 'http://localhost:8347',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev:local',
    port: 8347,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
