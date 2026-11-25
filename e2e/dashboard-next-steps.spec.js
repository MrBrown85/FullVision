import { test, expect } from '@playwright/test';

/* The dashboard's next steps (Nov 2 mockup): a level's students on a
   competency come with the band's shared next step. In the Competencies
   tile a student's tick opens the students at that level on the competency,
   and the list keeps the shared next step the old Level Mix list gave its
   band. Demo Mode, Science 8, counted over the year so every competency has
   work in it. The test takes the folders away, so each competency is its own
   column. Local Environment (PA1) has its bank id taken away to show a
   competency with none. Drawing Conclusions (PA5) keeps its bank id. */
test.use({ viewport: { width: 1440, height: 900 } });

const row = (page, name) =>
  page.locator('#dash-comp-page-curricular .dash-comp-it').filter({
    has: page.locator('.dash-comp-it-name', { hasText: new RegExp('^' + name + '$') }),
  });

async function open(page) {
  await page.addInitScript(() => localStorage.setItem('fv-dash-comp-span:sci8', 'year'));
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
  await page.locator('#dash-comp-page-curricular .dash-comp-it').first().waitFor();
  return step;
}

test("a tick's list gives the band its shared next step", async ({ page }) => {
  const step = await open(page);
  expect(step).toBeTruthy();
  await row(page, 'Drawing Conclusions').locator('[data-comp-level="2"]').first().click();
  await expect(page.locator('#dash-comp-pop')).toBeVisible();
  await expect(page.locator('#dash-comp-pop .dash-mix-pop-head')).toContainText('Developing');
  await expect(page.locator('#dash-comp-pop .dash-mix-pop-next')).toHaveText('Shared next step: ' + step);
  // A competency with no bank id has none.
  await page.locator('#dash-comp-pop [data-comp-close]').click();
  await expect(page.locator('#dash-comp-pop')).toBeHidden();
  await row(page, 'Local Environment').locator('[data-comp-level="2"]').first().click();
  await expect(page.locator('#dash-comp-pop .dash-mix-pop-head')).toBeVisible();
  await expect(page.locator('#dash-comp-pop .dash-mix-pop-next')).toHaveCount(0);
});
