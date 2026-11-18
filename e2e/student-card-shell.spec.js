import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast, shot } from './student-card-fake.js';

/* The student page's shell (S4-F1; redesigned 2026-11-14), in Demo Mode,
   against the built site with the live site's CSP: the three tabs (along
   the bottom on a phone, in the header on a Chromebook), Outstanding and
   Upcoming with their counts, My Learning's list of work, Reflect, and
   Log Out with the sheet that asks first. Nothing is sent anywhere. */

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  // The sample class has bulletins, so the page opens on them (B1g); Assignments is the next tab.
  await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
  await expect(page.getByRole('button', { name: 'Outstanding 2' })).toBeVisible();
  return posts;
}

for (const size of [
  { tag: 'phone', use: PHONE },
  { tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('the shell on a ' + size.tag, () => {
    test.use(size.use);

    test('the tabs, Outstanding and Upcoming, My Learning, Reflect and Log Out', async ({ page }) => {
      const posts = await demo(page);
      const nav = page.getByRole('navigation', { name: 'Your Page' }).locator('visible=true');
      await expect(nav.locator('.sp-tab-label')).toHaveText(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
      await expect(nav.getByRole('button', { name: 'Assignments' })).toHaveAttribute('aria-current', 'page');
      // What came back is new on My Learning: its badge says how many.
      await expect(nav.locator('[data-tab="learning"] .sp-tab-badge')).toHaveText('6');
      // On a phone the tabs sit along the bottom; on a Chromebook in the header.
      const box = await nav.boundingBox();
      const vh = page.viewportSize().height;
      if (size.tag === 'phone') expect(box.y + box.height).toBeGreaterThan(vh - 4);
      else expect(box.y).toBeLessThan(60);

      await expect(page.locator('.sp-segment')).toHaveText(['Outstanding 2', 'Upcoming 1']);
      await expect(page.getByRole('button', { name: 'Outstanding 2' })).toHaveAttribute('aria-pressed', 'true');
      // The oldest due date first; work past its day, not Missing, is Not Assessed Yet (Colin, 2026-11-17).
      await expect(page.locator('.sp-deck .sp-piece-title')).toHaveText([
        'Immune System Quick Check',
        'Disease Research Poster',
      ]);
      await expect(
        page.locator('.sp-piece', { hasText: 'Disease Research Poster' }).locator('.sp-band .sp-flag-waiting'),
      ).toHaveText('Not Assessed Yet');
      // A draft is Outstanding with no result, as work never graded is.
      await expect(page.locator('.sp-deck .sp-level')).toHaveCount(0);
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s4f1-outstanding');

      // The last card is not hidden behind the tabs.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const last = await page.locator('.sp-deck .sp-piece-card').locator('visible=true').last().boundingBox();
      const tabs = await nav.boundingBox();
      if (size.tag === 'phone') expect(last.y + last.height).toBeLessThanOrEqual(tabs.y);

      await page.getByRole('button', { name: 'Upcoming 1' }).click();
      await expect(page.locator('.sp-deck .sp-piece-title')).toHaveText(['Science Fair Proposal']);
      await expect(
        page.locator('.sp-piece', { hasText: 'Science Fair Proposal' }).locator('.sp-flag-later'),
      ).toHaveText('In 4 Days');
      await fits(page);
      await contrast(page);
      await shot(page, size.tag + '-s4f1-upcoming');

      // My Learning: the grade, then Your Work with each result.
      await nav.getByRole('button', { name: 'My Learning' }).click();
      await expect(nav.getByRole('button', { name: 'My Learning' })).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.sp-ml-overall .sp-ml-period')).toHaveText('This Year So Far');
      await expect(page.locator('.sp-ml-overall .sp-ml-at-word')).toHaveText('Proficient');
      await expect(page.locator('.sp-ml-work .sp-ml-card-title')).toHaveText('Your Work');
      await expect(page.locator('.sp-ml-work .sp-ml-row')).toHaveCount(7);
      await expect(page.locator('.sp-ml-row', { hasText: 'Cell Structure Quiz' }).locator('.sp-level')).toHaveText(
        '8 / 10',
      );
      await expect(
        page.locator('.sp-ml-row', { hasText: 'Immune System Quick Check' }).locator('.sp-level'),
      ).toHaveText('Missing');
      await expect(page.locator('.sp-ml-work .sp-ml-new-on')).toHaveCount(6);
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s4f1-my-learning');

      // Reflect: Demo Mode's sample reflections (S4-F4), two of them open and not yet answered.
      await expect(nav.locator('[data-tab="questionnaires"] .sp-tab-badge')).toHaveText('2');
      await nav.getByRole('button', { name: 'Reflect' }).click();
      await expect(nav.getByRole('button', { name: 'Reflect' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { level: 1, name: 'Reflect', exact: true })).toBeVisible();
      await expect(
        page.getByText('November Reflection', { exact: true }).locator('visible=true').first(),
      ).toBeVisible();
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s4f1-reflections');

      // Log Out asks first; Cancel leaves the page as it was.
      await page.locator('.sp-head [data-act="settings-open"]').click();
      await page.locator('.sp-set [data-act="logout-ask"]').click();
      const sheet = page.getByRole('alertdialog', { name: 'Log Out?' });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('You’ll need your card to open your page again.');
      await expect(page.locator('#sp-logout-title')).toBeFocused();
      await contrast(page);
      await shot(page, size.tag + '-s4f1-log-out');
      await page.waitForTimeout(450); // Log Out? takes a press once it has been up a moment.
      await sheet.getByRole('button', { name: 'Cancel' }).click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Reflect', exact: true })).toBeVisible();
      expect(posts).toEqual([]);
    });
  });
}

/* With the Bulletins switch on (docs/plans/bulletins-plan.md B1d), four tabs, Bulletins first, in
   the same bar on a phone and on a Chromebook; with it off, the three above. */
for (const size of [
  { tag: 'phone', use: PHONE },
  { tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('the shell opening on Bulletins, on a ' + size.tag, () => {
    test.use(size.use);

    test('four tabs, Bulletins first and open (on since B1g); the others as they were', async ({ page }) => {
      const posts = [];
      page.on('request', req => {
        if (/functions\/v1\//.test(req.url())) posts.push(req.url());
      });
      await page.goto('/s/#demo-card');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByLabel('Student Number').fill('1234567');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
      const nav = page.getByRole('navigation', { name: 'Your Page' }).locator('visible=true');
      await expect(nav.locator('.sp-tab-label')).toHaveText(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
      await expect(nav.locator('[data-tab="bulletins"]')).toHaveAttribute('aria-current', 'page');
      await expect(nav.locator('[data-tab="learning"] .sp-tab-badge')).toHaveText('6');
      await expect(nav.locator('[data-tab="questionnaires"] .sp-tab-badge')).toHaveText('2');
      await fits(page);
      await named(page);
      await nav.getByRole('button', { name: 'Assignments' }).click();
      await expect(page.locator('.sp-segment')).toHaveText(['Outstanding 2', 'Upcoming 1']);
      await fits(page);
      expect(posts).toEqual([]);
    });
  });
}
