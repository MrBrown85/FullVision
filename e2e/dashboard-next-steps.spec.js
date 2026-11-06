import { test, expect } from '@playwright/test';

/* The dashboard's next steps (Nov 2 mockup): the proficiency-mix popover
   gives the band's shared next step (the Needs Attention card that gave
   each student's went with the card, plan F.8). Demo Mode, Science 8.
   The first tests take the folders away, so each competency is its own
   column; the last ones keep Demo Mode's folders (Folders Count as One).
   Local Environment (PA1) has its bank id taken away to show a competency
   with none. Drawing Conclusions (PA5) keeps its bank id. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const step = await page.evaluate(() => {
    const map = getLearningMap('sci8');
    map.sections.forEach(sec => (sec.groupId = null));
    map.competencyGroups = [];
    getTagById('sci8', 'PA1').bank_id = null;
    window.Router.navigate('/dashboard?course=sci8');
    return CompetencyWording.nextStep(getTagById('sci8', 'PA5'), 2);
  });
  await page.locator('.dash-comp-card [data-action="mixSeg"]').first().waitFor();
  return step;
}

test('the mix popover gives the band its shared next step', async ({ page }) => {
  const step = await open(page);
  expect(step).toBeTruthy();
  await page
    .locator('[data-action="mixSeg"][aria-label^="Drawing Conclusions:"][aria-label$="Developing"]')
    .first()
    .click();
  const pop = page.locator('.dash-mix-pop-next');
  await expect(pop).toHaveText('Shared next step: ' + step);
  // A competency with no bank id has none.
  await page.locator('.dash-mix-pop-close').click();
  await page
    .locator('[data-action="mixSeg"][aria-label^="Local Environment:"][aria-label$="Developing"]')
    .first()
    .click();
  await expect(page.locator('.dash-mix-pop-head')).toBeVisible();
  await expect(page.locator('.dash-mix-pop-next')).toHaveCount(0);
});

/* Folder columns (Colin, 2026-11-02): a band gives the competency lowest
   for the most students in it, at the band's level. */
async function openFolders(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/dashboard?course=sci8'));
  await page.locator('.dash-comp-card [data-action="mixSeg"]').first().waitFor();
}

test('in a folder, the mix popover gives the step most of the band shares, named', async ({ page }) => {
  await openFolders(page);
  const folder = await page.evaluate(() => getLearningMap('sci8').competencyGroups[0].name);
  const seg = page.locator(`[data-action="mixSeg"][aria-label^="${folder}:"]`).first();
  await seg.click();
  await expect(page.locator('.dash-mix-pop-next')).toHaveText(/^Shared next step \(.+\): .+/);
});
