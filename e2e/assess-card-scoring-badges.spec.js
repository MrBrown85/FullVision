import { test, expect } from '@playwright/test';

/* Nov 3 sweep (step 4 group 3 #23): cards showed the category, rubric and
   dates, but not how the work is scored or its Factor; Lab 1's 2x showed
   only in the gradebook. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

test('a card names its scoring and a Factor other than 1x', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const ids = await page.evaluate(() => {
    const list = getAssessments('sci8');
    const pts = list.find(a => a.scoreMode === 'points');
    const rub = list.find(a => (a.scoreMode || 'proficiency') === 'proficiency' && a.rubricId);
    const next = list.map(a =>
      a.id === pts.id ? { ...a, maxPoints: 20, weight: 2 } : a.id === rub.id ? { ...a, weight: 1 } : a,
    );
    saveAssessments('sci8', next);
    return { pts: pts.id, rub: rub.id };
  });
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  const ptsMeta = page.locator(`#ac-${ids.pts} .assess-meta .score-badge`);
  await expect(ptsMeta).toHaveText(['20 Points', 'Factor 2x']);
  // A rubric card's rubric chip already says how it is scored.
  await expect(page.locator(`#ac-${ids.rub} .assess-meta .score-badge`)).toHaveCount(0);
  await expect(page.locator(`#ac-${ids.rub} .assess-meta .rubric-badge`)).toHaveCount(1);
});
