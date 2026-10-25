import { test, expect } from '@playwright/test';
import { findLowContrastText } from './contrast-check.js';

/* Small text is readable: every visible text element under 18 px has at
   least 4.5:1 contrast against its background, in light and dark mode, on
   the main Demo Mode pages (design fixes PR A, 2026-10-19). Blue text uses
   --link; --active is for fills, focus rings, selected states and icons.
   Section and competency colours drawn as text go through tintText().

   Left out on purpose:
   - Level colours (--score-*), as text or as a fill under white text: the
     gradebook and level colours stay as they are (Colin, 2026-10-19).
   - White text on a solid --active fill (primary buttons, selected pills):
     the plan keeps --active for fills.
   - The gradebook table (.gb-grid): its tiles keep their colours, as above. */

const LEVEL_TOKENS = [0, 1, 2, 3, 4].flatMap(n => [
  `--score-${n}`,
  `--score-${n}-bg`,
  `--score-${n}-text`,
  `--score-${n}-dark`,
]);

const OPTIONS = {
  skip: ['.gb-grid'],
  textTokens: LEVEL_TOKENS,
  fillTokens: [...LEVEL_TOKENS, '--active'],
};

async function enterDemo(page, { phone = false } = {}) {
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(phone ? /teacher-mobile\// : /teacher\/app\.html/);
}

async function expectReadable(page) {
  // Let fades and other finite transitions settle first.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})),
    ),
  );
  const failures = await findLowContrastText(page, OPTIONS);
  expect(failures, JSON.stringify(failures, null, 1)).toEqual([]);
}

const DESKTOP = [
  { name: 'dashboard', hash: '#/dashboard', ready: '.dash-card' },
  {
    name: 'assignments with a rubric open',
    hash: '#/assignments',
    ready: '#ac-sci8a1',
    open: async page => {
      await page.locator('#ac-sci8a1 .assess-header').click();
      const row = page.locator('#ac-sci8a1 .rsg-criterion-row').first();
      await expect(row).toBeVisible();
      // A chosen + or − shows the pressed state.
      await row.locator('.rsg-mod:not(:disabled)').first().click();
      await expect(row.locator('.rsg-mod.active')).toHaveCount(1);
    },
  },
  { name: 'gradebook', hash: '#/gradebook', ready: '.gb-grid' },
  // The student page, one tab at a time.
  ...['comps', 'assess', 'evidence', 'profile'].map(tab => ({
    name: 'student ' + tab,
    hash: '#/student?id=st23&course=sci8',
    ready: '.stu-tabs',
    async open(page) {
      await page.locator('#stu-tab-' + tab).click();
      await expect(page.locator('#stu-tab-' + tab)).toHaveAttribute('aria-selected', 'true');
    },
  })),
  { name: 'reports', hash: '#/reports', ready: '.student-row' },
];

for (const colorScheme of ['light', 'dark']) {
  test.describe(`Text contrast, ${colorScheme} mode`, () => {
    test.use({ colorScheme });

    for (const p of DESKTOP) {
      test(`${p.name}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await enterDemo(page);
        await page.goto('/teacher/app.html' + p.hash);
        await expect(page.locator(p.ready).first()).toBeVisible();
        if (p.open) await p.open(page);
        await expectReadable(page);
      });
    }

    test('phone Observe', async ({ page }) => {
      await enterDemo(page, { phone: true });
      await page.locator('.m-tab-item[data-tab="observe"]').click();
      await expect(page.locator('.m-obs-card').first()).toBeVisible();
      await expectReadable(page);
    });
  });
}
