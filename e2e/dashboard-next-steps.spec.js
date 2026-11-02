import { test, expect } from '@playwright/test';

/* The dashboard's next steps (Nov 2 mockup): the proficiency-mix popover
   gives the band's shared next step, and each Needs Attention row the
   student's next step in the competency it names. Demo Mode, Science 8,
   with Identify Patterns (Processing) given a curriculum bank id. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  const step = await page.evaluate(() => {
    getTagById('sci8', 'IP').bank_id = 'bc.sci8.cc.14';
    window.Router.navigate('/dashboard?course=sci8');
    return CompetencyWording.nextStep(getTagById('sci8', 'IP'), 2);
  });
  await page.locator('.dash-na-row').first().waitFor();
  return step;
}

test('the mix popover gives the band its shared next step', async ({ page }) => {
  const step = await open(page);
  expect(step).toBeTruthy();
  await page.locator('[data-action="mixSeg"][aria-label^="Processing"][aria-label$="Developing"]').first().click();
  const pop = page.locator('.dash-mix-pop-next');
  await expect(pop).toHaveText('Shared next step: ' + step);
  // A competency with no bank id has none.
  await page.locator('.dash-mix-pop-close').click();
  await page.locator('[data-action="mixSeg"][aria-label^="Questioning"][aria-label$="Developing"]').first().click();
  await expect(page.locator('.dash-mix-pop-head')).toBeVisible();
  await expect(page.locator('.dash-mix-pop-next')).toHaveCount(0);
});

test('a Needs Attention row gives the next step in the competency it names', async ({ page }) => {
  const step = await open(page);
  const rows = page.locator('.dash-na-row[data-sid]');
  const processing = rows.filter({ hasText: /Lowest\s*.?\s*Processing/ }).first();
  await expect(processing.locator('.dash-na-next')).toContainText('Next step: ');
  const questioning = rows.filter({ hasText: /Lowest\s*.?\s*Questioning/ }).first();
  await expect(questioning.locator('.dash-na-next')).toHaveCount(0);
  // Below Proficient at Developing: the Developing step.
  const dev = rows
    .filter({ hasText: /Processing\s*2\.\d/ })
    .filter({ hasText: 'Developing' })
    .first();
  await expect(dev.locator('.dash-na-next')).toHaveText('Next step: ' + step);
});
