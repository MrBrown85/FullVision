import { test, expect } from '@playwright/test';

/* Any Factor, and what it means as a picture (2026-11-06). A CSL-expert
   teacher asked "can I pick my exact factor? I often use 70% and 30%". The
   Factor is a stepper that takes any value; the share bar under the
   scoring shows this assessment's part of its category as the course %
   counts it, live. Demo Mode, Science 8 switched to a Letter class so the
   bar shows. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    COURSES.sci8.gradingSystem = 'letter';
    window.Router.navigate('/assignments?course=sci8');
  });
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

// The share the page works out for 20-point work at this Factor in Labs.
const expected = (page, weight) =>
  page.evaluate(
    w =>
      formatShare(
        assessmentCategoryShare('sci8', {
          scoreMode: 'points',
          maxPoints: 20,
          weight: w,
          categoryId: 'sci8-cat-labs',
        }).share,
        true,
      ) + ' of',
    weight,
  );

test('a Factor of 2.3 moves the share bar, and is saved as 2.3', async ({ page }) => {
  await openForm(page);
  await expect(page.locator('#af-counts-as')).toHaveText('');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.fill('#af-maxpoints', '20');

  const pct = page.locator('#af-counts-as .af-share-pct');
  await expect(page.locator('#af-counts-as .af-share-cat')).toHaveText('Labs & Investigations');
  const atOne = await expected(page, 1);
  await expect(pct).toHaveText(atOne);

  await page.fill('#af-weight', '2.3');
  const atTwoThree = await expected(page, 2.3);
  expect(atTwoThree).not.toBe(atOne);
  await expect(pct).toHaveText(atTwoThree);

  // This one is blue and first; every other assessment in Labs names itself.
  const segs = page.locator('#af-counts-as .af-share-seg');
  const labs = await page.evaluate(
    () => getAssessments('sci8').filter(a => a.categoryId === 'sci8-cat-labs' && a.scoreMode !== 'dibels').length,
  );
  await expect(segs).toHaveCount(labs + 1);
  await expect(segs.first()).toHaveClass(/af-share-self/);
  await expect(segs.nth(1)).toHaveAttribute('title', /: (\d+%|< 1%)$/);

  // + steps by 0.5.
  await page.getByRole('button', { name: 'Raise the factor' }).click();
  await expect(page.locator('#af-weight')).toHaveValue('2.8');
  await expect(pct).toHaveText(await expected(page, 2.8));
  await page.getByRole('button', { name: 'Lower the factor' }).click();
  await expect(page.locator('#af-weight')).toHaveValue('2.3');

  await page.fill('#af-title', 'Factor Share Lab');
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Factor Share Lab'));
  expect(saved.weight).toBe(2.3);
});

test('a class with no categories shares the whole course %, and a class with no % shows no bar', async ({ page }) => {
  await openForm(page);
  await page.evaluate(() => {
    // A class with no categories: the bar covers the whole course %.
    _cache.categories.sci8 = [];
  });
  await page.fill('#af-weight', '2');
  await expect(page.locator('#af-counts-as .af-share-cat')).toHaveText('the course %');
  await page.evaluate(() => {
    COURSES.sci8.gradingSystem = 'proficiency';
  });
  await page.fill('#af-weight', '3');
  await expect(page.locator('#af-counts-as')).toHaveText('');
});
