import { test, expect } from '@playwright/test';

/* The dashboard's next steps (Nov 2 mockup): a level's students on a
   competency come with the band's shared next step (the Needs Attention
   card that gave each student's went with the card, plan F.8). Since D9 the
   band's students are in a Level Mix row's list in the Competencies tile,
   one group each for Emerging and Developing, and each group keeps the
   shared next step today's Level Mix list gave it. Demo Mode, Science 8.
   The first tests take the folders away, so each competency is its own
   column; the last ones keep Demo Mode's folders (Folders Count as One).
   Local Environment (PA1) has its bank id taken away to show a competency
   with none. Drawing Conclusions (PA5) keeps its bank id. */
test.use({ viewport: { width: 1440, height: 900 } });

const row = (page, name) =>
  page.locator('#dash-comp-page-curricular .dash-comp-ln').filter({
    has: page.locator('.dash-comp-ln-name', { hasText: new RegExp('^' + name + '$') }),
  });
// The Developing group in the open list.
const developing = page =>
  page
    .locator('#dash-comp-pop .dash-comp-pop-level')
    .filter({ has: page.locator('> span', { hasText: /^Developing · / }) });

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
  await page.locator('#dash-comp-page-curricular .dash-comp-ln').first().waitFor();
  return step;
}

test("a row's list gives the band its shared next step", async ({ page }) => {
  const step = await open(page);
  expect(step).toBeTruthy();
  await row(page, 'Drawing Conclusions').click();
  await expect(page.locator('#dash-comp-pop')).toBeVisible();
  await expect(developing(page).locator('.dash-mix-pop-next')).toHaveText('Shared next step: ' + step);
  // A competency with no bank id has none.
  await page.locator('#dash-comp-pop [data-comp-close]').click();
  await expect(page.locator('#dash-comp-pop')).toBeHidden();
  await row(page, 'Local Environment').click();
  await expect(page.locator('#dash-comp-pop .dash-mix-pop-head')).toBeVisible();
  await expect(developing(page)).toHaveCount(1);
  await expect(page.locator('#dash-comp-pop .dash-mix-pop-next')).toHaveCount(0);
});

/* Folder columns (Colin, 2026-11-02): a band gives the competency lowest
   for the most students in it, at the band's level. */
test("in a folder, a row's list gives the step most of the band shares, named", async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/dashboard?course=sci8'));
  await page.locator('#dash-comp-page-curricular .dash-comp-ln').first().waitFor();
  const folder = await page.evaluate(() => getLearningMap('sci8').competencyGroups[0].name);
  await row(page, folder).click();
  await expect(developing(page).locator('.dash-mix-pop-next')).toHaveText(/^Shared next step \(.+\): .+/);
});
