import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* What changed since the student last looked (S4-F5), in Demo Mode,
   against the built site with the live site's CSP: the count on My
   Learning, the New dot on each row of Your Work not yet opened, and
   Updated with what it was on a changed grade. Nothing is sent. Set
   S4_SHOTS to a folder to save pictures (light). */

const SHOTS = process.env.S4_SHOTS || '';
async function picture(page, name) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${SHOTS}/S4-F5-${name}.png`, fullPage: true });
}

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
  await expect(page.getByRole('button', { name: 'Outstanding 3' })).toBeVisible();
  return posts;
}

for (const size of [
  { tag: 'phone', use: PHONE },
  { tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('on a ' + size.tag, () => {
    test.use(size.use);

    test('the count on My Learning, New on each row not opened, and Updated with what it was', async ({ page }) => {
      const posts = await demo(page);
      const tabs = page.locator(size.tag === 'phone' ? '.sp-tabs-bottom' : '.sp-tabs-top');
      await expect(tabs.getByRole('button', { name: 'My Learning 6 new' })).toBeVisible();
      // Bulletins' count (the two sample bulletins not seen, B1g), My Learning's, and Reflect's: two reflections open
      // and not answered.
      await expect(tabs.locator('.sp-tab-badge')).toHaveText(['2', '6', '2']);
      await expect(tabs.getByRole('button', { name: 'Assignments', exact: true })).toBeVisible();
      await tabs.getByRole('button', { name: 'My Learning 6 new' }).click();
      const work = page.locator('.sp-ml-work');
      await expect(work.locator('.sp-ml-new-on')).toHaveCount(6);
      await expect(work.locator('li[data-unseen]')).toHaveCount(6);
      await expect(work.getByRole('button', { name: /Energy Transfer Investigation.*New/ })).toBeVisible();
      const contract = work.locator('.sp-ml-row', { hasText: 'Lab Safety Contract' });
      await expect(contract.locator('.sp-row-sub')).toHaveText(/^Updated \w{3} \d+ · was Incomplete$/);
      await expect(contract.locator('.sp-level')).toHaveText('Complete');
      await fits(page);
      await named(page);
      await contrast(page);
      await picture(page, size.tag + '-my-learning-new');
      await contract.click();
      await expect(page.locator('.sp-fb-title')).toHaveText('Lab Safety Contract');
      await expect(page.locator('.sp-fb-sub')).toHaveText(/^Updated \w{3} \d+$/);
      await fits(page);
      await contrast(page);
      await picture(page, size.tag + '-updated-feedback');
      expect(posts).toEqual([]);
    });
  });
}
