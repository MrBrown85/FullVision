import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

/* Screenshot comparison for CSS changes (e2e-visual/pages.spec.js). Record
   on main, then compare on the branch:

     PORT=8350 npx playwright test --config=playwright.visual.config.js --update-snapshots   (on main)
     PORT=8350 npx playwright test --config=playwright.visual.config.js                      (on the branch)

   The pictures are kept outside the repo, in VISUAL_DIR or else
   <tmp>/fv-visual/<this folder's name>/, so record on main and compare on
   the branch with the same VISUAL_DIR. See the spec's header for
   VISUAL_SHEET and VISUAL_DEAD. */

const PORT = Number(process.env.PORT) || 8350;
const SNAPSHOTS = process.env.VISUAL_DIR || path.join(os.tmpdir(), 'fv-visual', path.basename(process.cwd()));

export default defineConfig({
  testDir: './e2e-visual',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',
  snapshotPathTemplate: SNAPSHOTS + '/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: 'http://localhost:' + PORT,
    headless: true,
    browserName: 'chromium',
  },
  // Each state in the spec is tagged with the one project it runs in.
  projects: [
    { name: 'desktop', grep: /@desktop/, use: { viewport: { width: 1366, height: 900 } } },
    { name: 'phone', grep: /@phone/, use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    // The same build and server as playwright.config.js: dist/ with dummy
    // credentials, served through the production edge function.
    command: 'npm run build:e2e && node scripts/e2e-server.mjs',
    port: PORT,
    env: { ...process.env, PORT: String(PORT) },
    // Always its own server, so a picture is never of another worktree's dist/.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
