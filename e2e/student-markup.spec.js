import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* See Your Work, with Show Marks (S9-F3), in Demo Mode with Send Work on
   (#demo-card-send), against the built site with the live site's CSP: the
   sample page loads, the marks Ms. Rivera gave sit over it, Show Marks
   takes them off and puts them back, and Back returns to Your Feedback.
   Nothing leaves the browser. */

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/s/#demo-card-send');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  return { posts, errors };
}

async function openLab(page) {
  await page.getByRole('button', { name: /^Back \d+$/ }).click();
  const lab = page.locator('.sp-piece', { hasText: 'Cell Microscope Lab' });
  if (await page.locator('.sp-side').isVisible()) {
    await page.locator('.sp-side-row', { hasText: 'Cell Microscope Lab' }).click();
  } else {
    await page.locator('.sp-deck').evaluate((d, title) => {
      const card = [...d.querySelectorAll('.sp-piece')].find(c => c.textContent.includes(title));
      d.scrollTo({ left: card.offsetLeft - d.offsetLeft, behavior: 'auto' });
    }, 'Cell Microscope Lab');
  }
  await lab.getByRole('button', { name: 'See Your Feedback' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cell Microscope Lab' })).toBeFocused();
}

for (const [where, device] of [
  ['on a phone', PHONE],
  ['on a Chromebook', CHROMEBOOK],
]) {
  test.describe(where, () => {
    test.use(device);

    test('See Your Work: the page with the marks given, Show Marks off and on, Back to Your Feedback', async ({
      page,
    }) => {
      const { posts, errors } = await demo(page);
      await openLab(page);
      const see = page.getByRole('button', { name: /See Your Work/ });
      await expect(see).toContainText('1 page · 3 notes on your work');
      await see.click();
      await expect(page.getByRole('heading', { level: 1, name: 'Cell Microscope Lab' })).toBeFocused();
      const img = page.getByRole('img', { name: 'Your page 1 with Ms. Rivera’s marks' });
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
      await expect(page.locator('.sp-work-over .sp-work-pin')).toHaveCount(3);
      await expect(page.getByRole('list', { name: 'Notes on This Page' }).getByRole('listitem')).toHaveCount(3);
      // The marks sit on the page, not off it.
      const box = await page.locator('.sp-work-page').boundingBox();
      for (const pin of await page.locator('.sp-work-over .sp-work-pin').all()) {
        const b = await pin.boundingBox();
        expect(b.x + b.width / 2).toBeGreaterThan(box.x);
        expect(b.x + b.width / 2).toBeLessThan(box.x + box.width);
        expect(b.y + b.height / 2).toBeLessThan(box.y + box.height);
      }
      await fits(page);
      await named(page);
      await contrast(page);
      const sw = page.getByRole('switch', { name: 'Show Marks' });
      await expect(sw).toHaveAttribute('aria-checked', 'true');
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await expect(sw).toBeFocused();
      await expect(page.getByRole('img', { name: 'Your page 1', exact: true })).toBeVisible();
      await expect(page.locator('.sp-work-over .sp-work-pin')).toHaveCount(0);
      await sw.click();
      await expect(page.locator('.sp-work-over .sp-work-pin')).toHaveCount(3);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(see).toBeFocused();
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('Send Work off', () => {
  test.use(PHONE);

  test('#demo-card shows no See Your Work', async ({ page }) => {
    await page.goto('/s/#demo-card');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Student Number').fill('1234567');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
    await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
    await openLab(page);
    await expect(page.getByRole('button', { name: /See Your Work/ })).toHaveCount(0);
  });
});
