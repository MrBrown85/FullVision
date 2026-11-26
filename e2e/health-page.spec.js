/**
 * The owner's page, fullvision.ca/health (health.html, shared/health.js).
 * GitHub's answers are stubbed: a release, three pull requests merged to
 * main since it, and runs on main whose browser tests passed, were cut short
 * or failed. Not signed in, the page asks for a sign-in for the usage counts
 * and still shows release and test results. Only this page may reach
 * api.github.com (netlify/edge-functions/inject-env.js).
 */
import { test, expect } from '@playwright/test';

const API = 'https://api.github.com/repos/MrBrown85/FullVision';
const commit = (message, date) => ({ commit: { message, committer: { date } } });
const run = (id, sha, title, status = 'completed') => ({
  id,
  head_sha: sha.padEnd(40, '0'),
  display_title: title,
  status,
  html_url: 'https://github.com/MrBrown85/FullVision/actions/runs/' + id,
});
const jobs = conclusions => ({ jobs: conclusions.map((c, i) => ({ name: 'e2e (' + (i + 1) + ')', conclusion: c })) });

/* Stubs GitHub. `newest` is the newest run's four browser-test results. */
async function stubGitHub(page, newest) {
  const answers = {
    '/pulls': [
      { number: 1848, merged_at: '2026-11-26T13:43:55Z' },
      { number: 1800, merged_at: null },
    ],
    '/compare/production...main': {
      commits: [
        commit(
          'Merge pull request #1849 from MrBrown85/docs/x\n\nCLAUDE.md: the release line after #1848',
          '2026-11-26T14:04:28Z',
        ),
        commit('Work in progress on the size lint', '2026-11-26T14:10:00Z'),
        commit('Size limits for new code: a file 400 lines (#1850)', '2026-11-26T14:18:09Z'),
        commit('Merge branch main into claude/size-lint', '2026-11-26T14:12:00Z'),
        commit(
          'Merge pull request #1851 from MrBrown85/fix/y\n\n<img src=x onerror=alert(1)> stays text',
          '2026-11-26T14:30:00Z',
        ),
      ],
    },
    '/actions/workflows/ci.yml/runs': {
      workflow_runs: [
        run(3, 'ccc', 'Merge pull request #1851'),
        run(2, 'bbb', 'Size limits (#1850)'),
        run(1, 'aaa', 'Merge pull request #1849'),
      ],
    },
    '/actions/runs/3/jobs': jobs(newest),
    '/actions/runs/2/jobs': jobs(['success', 'cancelled', 'success', 'success']),
    '/actions/runs/1/jobs': jobs(['success', 'success', 'success', 'success']),
  };
  await page.route(API + '/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/repos/MrBrown85/FullVision', '');
    const body = answers[path];
    return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, json: {} });
  });
}

test('signed out, the page shows release and test results and asks a sign-in for usage', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await stubGitHub(page, ['success', 'success', 'success', 'success']);
  await page.goto('/health');
  await expect(page.locator('#hl-ready')).toHaveText('Yes');
  await expect(page.locator('#hl-last')).toHaveText('PR 1848');
  await expect(page.locator('#hl-waiting')).toHaveText('3');
  const rows = page.locator('#hl-unreleased tr');
  await expect(rows).toHaveCount(3);
  // Newest first, each pull request once, with its title; text from GitHub stays text.
  await expect(rows.nth(0)).toContainText('#1851');
  await expect(rows.nth(0)).toContainText('<img src=x onerror=alert(1)> stays text');
  await expect(rows.nth(1)).toContainText('Size limits for new code: a file 400 lines');
  await expect(rows.nth(2)).toContainText('CLAUDE.md: the release line after #1848');
  // The list stops at the newest run whose browser tests all finished.
  await expect(page.locator('#hl-runs tr')).toHaveCount(1);
  await expect(page.locator('#hl-runs tr').first()).toContainText('Passed');
  await expect(page.locator('#hl-gate')).toBeVisible();
  await expect(page.locator('#hl-gate-text')).toContainText('Sign in');
  await expect(page.locator('#hl-lede')).toHaveText('3 changes wait on main.');
  expect(errors).toEqual([]);
});

test('a failed newest run says not yet', async ({ page }) => {
  await stubGitHub(page, ['success', 'failure', 'success', 'success']);
  await page.goto('/health');
  await expect(page.locator('#hl-ready')).toHaveText('Not Yet');
  await expect(page.locator('#hl-runs tr').first()).toContainText('Failed');
});

test('newer runs cut short: wait for the tests, and the list goes back to the last complete run', async ({ page }) => {
  await stubGitHub(page, ['success', 'cancelled', 'cancelled', 'success']);
  await page.goto('/health');
  await expect(page.locator('#hl-ready')).toHaveText('Wait for Tests');
  await expect(page.locator('#hl-runs tr')).toHaveCount(3);
  await expect(page.locator('#hl-runs tr').nth(0)).toContainText('Cut short');
  await expect(page.locator('#hl-runs tr').nth(2)).toContainText('Passed');
});

test('when GitHub refuses, the page says why and keeps the rest', async ({ page }) => {
  await page.route(API + '/**', route =>
    route.fulfill({
      status: 403,
      headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) },
      json: {},
    }),
  );
  await page.goto('/health');
  await expect(page.locator('#hl-ready')).toHaveText('Unknown');
  await expect(page.locator('#hl-ready-why')).toContainText('limit for this hour');
  await expect(page.locator('#hl-gate')).toBeVisible();
});

test('only the health page may reach GitHub', async ({ request }) => {
  const policy = async path => (await request.get(path)).headers()['content-security-policy'] || '';
  expect(await policy('/health')).toContain('https://api.github.com');
  expect(await policy('/login.html')).not.toContain('api.github.com');
  expect(await policy('/dashboard')).not.toContain('api.github.com');
});

/* A signed-in page: a stand-in Supabase client whose fv_owner_health answers
   with counts, or refuses as it does for anyone not on the owner list. */
async function signIn(page, answer) {
  await page.addInitScript(a => {
    const session = { access_token: 't', user: { id: '00000000-0000-4000-8000-00000000000b' } };
    window._supabase = {
      auth: { getSession: async () => ({ data: { session }, error: null }) },
      rpc: async name =>
        name === 'fv_owner_health' ? a : { data: null, error: { code: '42883', message: 'no such function' } },
    };
  }, answer);
}

test('the owner sees who uses FullVision, ten weeks of work assessed', async ({ page }) => {
  await stubGitHub(page, ['success', 'success', 'success', 'success']);
  const weekly = Array.from({ length: 10 }, (_, i) => ({
    week: new Date(Date.UTC(2026, 8, 21 + 7 * i)).toISOString().slice(0, 10),
    pieces: i * 100,
    teachers: i > 5 ? 4 : 2,
  }));
  await signIn(page, {
    data: {
      teachers: 10,
      teachers_with_classes: 8,
      teachers_with_students: 7,
      classes: 13,
      students: 287,
      teachers_opened_7d: 5,
      classes_opened_7d: 10,
      weekly,
    },
    error: null,
  });
  await page.goto('/health');
  await expect(page.locator('#hl-teachers')).toHaveText('7');
  await expect(page.locator('#hl-accounts')).toHaveText('10 accounts in all');
  await expect(page.locator('#hl-opened')).toHaveText('5');
  await expect(page.locator('#hl-students')).toHaveText('287');
  await expect(page.locator('#hl-weekly .hl-bar')).toHaveCount(10);
  await expect(page.locator('#hl-gate')).toBeHidden();
  await expect(page.locator('#hl-lede')).toHaveText(
    '3 changes wait on main; 5 of 7 teachers with students opened a class this week.',
  );
});

test('another teacher signed in is told the counts are the owner’s', async ({ page }) => {
  await stubGitHub(page, ['success', 'success', 'success', 'success']);
  await signIn(page, { data: null, error: { code: '42501', message: 'owner only' } });
  await page.goto('/health');
  await expect(page.locator('#hl-gate-text')).toHaveText('Usage counts are for the site owner’s account.');
  await expect(page.locator('#hl-teachers')).toHaveText('—');
  await expect(page.locator('#hl-ready')).toHaveText('Yes');
});
