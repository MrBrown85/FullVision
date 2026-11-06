import { test, expect } from '@playwright/test';

/* Nov 3 sweep (step 4 group 3 #22): the Max Points quick pick stayed on 100
   after Create and Add Another kept 25, and the Counts As line read
   "Counts as 4 points" for a Blank Rubric with two criteria. The line is
   now the share bar (2026-11-06), which follows the rubric the same way.
   Demo Mode, Science 8 switched to a Letter class so the bar shows. */
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
  await page.selectOption('#af-category', 'sci8-cat-labs');
}

const lit = page => page.$$eval('#af-maxpoints-picks .seg-btn[aria-pressed="true"]', bs => bs.map(b => b.textContent));

test('the lit Max Points pick follows what Create and Add Another kept', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.locator('#af-maxpoints-picks .seg-btn', { hasText: '25' }).click();
  expect(await lit(page)).toEqual(['25']);
  await page.fill('#af-title', 'Lab Quiz 1');
  await page.locator('[data-action="saveAndAddAnother"]').click();
  await expect(page.locator('#af-title')).toHaveValue('');
  await expect(page.locator('#af-maxpoints')).toHaveValue('25');
  expect(await lit(page)).toEqual(['25']);
  await page.fill('#af-maxpoints', '30');
  expect(await lit(page)).toEqual([]);
});

// The share a new assessment worth `points` would have in Labs, as the page works it out.
const labsShare = (page, points) =>
  page.evaluate(
    pts =>
      formatShare(
        assessmentCategoryShare('sci8', { scoreMode: 'points', maxPoints: pts, categoryId: 'sci8-cat-labs' }).share,
        true,
      ) + ' of',
    points,
  );

test('the share bar follows the Blank Rubric as criteria are added, and after it is saved', async ({ page }) => {
  await openForm(page);
  const pct = page.locator('#af-counts-as .af-share-pct');
  await expect(page.locator('#af-counts-as .af-share-cat')).toHaveText('Labs & Investigations');
  await expect(pct).toHaveText(await labsShare(page, 4));
  await page.locator('[data-action="geAddCrit"]').click();
  await expect(pct).toHaveText(await labsShare(page, 8));
  await page.fill('#af-ge-name', 'Lab Rubric');
  await page.locator('[data-action="geSave"]').click();
  await expect(page.locator('#af-rubric')).not.toHaveValue('');
  await expect(pct).toHaveText(await labsShare(page, 8));
});
