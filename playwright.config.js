import { defineConfig } from '@playwright/test';

// Set PORT to run a second worktree's browser tests at the same time, e.g. PORT=8348 npx playwright test
const PORT = Number(process.env.PORT) || 8347;
// The test files' own dates (Node) in BC time too, as the browser's below.
process.env.TZ = 'America/Vancouver';

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
    // The browser's clock reads BC time, on the Mac and on GitHub alike (vitest.config.js says why).
    timezoneId: 'America/Vancouver',
    baseURL: 'http://localhost:' + PORT,
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    // Everything but the WebKit-only run below.
    { name: 'chromium', use: { browserName: 'chromium' } },
    /* The student page in WebKit (Safari's engine), shaped like an iPhone:
       most students open it on an iPhone. Only with FV_WEBKIT=1, because CI
       installs Chromium alone (`npx playwright install webkit` first).
       Run: FV_WEBKIT=1 npx playwright test --project=webkit-student
       Playwright's WebKit is not iOS Safari: no address bar that collapses,
       no real safe areas, no iOS text-size setting. */
    ...(process.env.FV_WEBKIT
      ? [
          {
            name: 'webkit-student',
            testMatch:
              /(student-settings|student-home-screen|student-card-[\w-]+|student-carousel|student-handout-out|student-handout-original|student-text-size-sweep|student-see-work|bulletins-student|quiz-student|quiz-returned|student-reflect)\.spec\.js$/,
            use: {
              browserName: 'webkit',
              viewport: { width: 390, height: 844 },
              deviceScaleFactor: 3,
              isMobile: true,
              hasTouch: true,
            },
          },
          /* Teachers use Safari on a Mac: the Bulletins page, its Dashboard
             tile and the Reflect builder in WebKit at a desktop size. Run: FV_WEBKIT=1 npx playwright
             test --project=webkit-teacher */
          {
            name: 'webkit-teacher',
            testMatch: /(bulletins-teacher|dashboard-bulletins-tile|reflect-builder)\.spec\.js$/,
            use: { browserName: 'webkit' },
          },
          /* Teachers' phones are mostly iPhones: the phone's grader, Students
             card, profile, tabs and Bulletins in WebKit (each spec sets the
             phone's size). Run: FV_WEBKIT=1 npx playwright test
             --project=webkit-phone */
          {
            name: 'webkit-phone',
            testMatch:
              /(mobile-bulletins|phone-grader|mobile-students-card|mobile-student-profile|mobile-tabs-fit)\.spec\.js$/,
            use: { browserName: 'webkit' },
          },
        ]
      : []),
  ],
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
