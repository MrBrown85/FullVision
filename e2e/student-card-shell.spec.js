import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast, shot } from './student-card-fake.js';

/* The student page's shell (S4-F1), in Demo Mode, against the built site
   with the live site's CSP: the four tabs (along the bottom on a phone, in
   the header on a Chromebook), To Do, Sent and Back with their counts, and
   All Assignments. Nothing is sent anywhere. */

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  return posts;
}

for (const size of [
  { tag: 'phone', use: PHONE },
  { tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('the shell on a ' + size.tag, () => {
    test.use(size.use);

    test('the tabs, To Do, Sent and Back, and All Assignments', async ({ page }) => {
      const posts = await demo(page);
      const nav = page.getByRole('navigation', { name: 'Your Page' });
      await expect(nav.getByRole('button')).toHaveText(['Assignments', 'My Learning', 'Questionnaires', 'Reports']);
      await expect(nav.getByRole('button', { name: 'Assignments' })).toHaveAttribute('aria-current', 'page');
      // On a phone the tabs sit along the bottom; on a Chromebook in the header.
      const box = await nav.boundingBox();
      const vh = page.viewportSize().height;
      if (size.tag === 'phone') expect(box.y + box.height).toBeGreaterThan(vh - 4);
      else expect(box.y).toBeLessThan(60);

      await expect(page.locator('.sp-segment')).toHaveText(['To Do 3', 'Sent 0', 'Back 6']);
      await expect(page.getByRole('button', { name: 'To Do 3' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.sp-deck .sp-piece-title')).toHaveText([
        'Science Fair Proposal',
        'Disease Research Poster',
        'Immune System Quick Check',
      ]);
      // A draft is in To Do with no result, as work never graded is.
      await expect(page.locator('.sp-piece-rows')).toHaveCount(0);
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s4f1-to-do');

      // The card is not hidden behind the tabs.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const last = await page.locator('.sp-piece.sp-picked .sp-piece-card').boundingBox();
      const tabs = await nav.boundingBox();
      if (size.tag === 'phone') expect(last.y + last.height).toBeLessThanOrEqual(tabs.y);

      await page.getByRole('button', { name: 'Back 6' }).click();
      await expect(page.locator('.sp-deck .sp-piece')).toHaveCount(6);
      await expect(page.locator('.sp-piece', { hasText: 'Cell Structure Quiz' }).locator('.sp-level')).toHaveText(
        '8 / 10',
      );
      await fits(page);
      await contrast(page);
      await shot(page, size.tag + '-s4f1-back');

      await page.getByRole('button', { name: 'Sent 0' }).click();
      await expect(page.getByText('Nothing sent yet.')).toBeVisible();

      await page.getByRole('button', { name: 'All assignments' }).click();
      await expect(page.getByRole('heading', { name: 'All Assignments' })).toBeFocused();
      await expect(page.locator('.sp-row')).toHaveCount(9);
      await page.getByRole('button', { name: 'Back to cards' }).click();
      await expect(page.locator('.sp-segment[aria-pressed="true"]')).toHaveText('Sent 0');

      // Demo Mode lists sample questionnaires and reports (S4-F4); My Learning says it is off.
      for (const [tab, heading, line] of [
        ['My Learning', 'My Learning', 'Your teacher hasn’t turned on My Learning for this class.'],
        ['Questionnaires', 'Questionnaires', 'November Reflection'],
        ['Reports', 'My Reports', 'Interim Update'],
      ]) {
        await nav.getByRole('button', { name: tab }).click();
        await expect(nav.getByRole('button', { name: tab })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
        await expect(page.getByText(line, { exact: true }).locator('visible=true').first()).toBeVisible();
        await fits(page);
        await named(page);
        await contrast(page);
      }
      await shot(page, size.tag + '-s4f1-reports');
      expect(posts).toEqual([]);
    });
  });
}
