import { test, expect } from '@playwright/test';

/* The dashboard's next steps (Nov 2 mockup): the proficiency-mix popover
   gives the band's shared next step, and each Needs Attention row the
   student's next step in the competency it names. Demo Mode, Science 8.
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
  await page.locator('.dash-na-row').first().waitFor();
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

test('a Needs Attention row gives the next step in the competency it names', async ({ page }) => {
  await open(page);
  // Observation (QP2) keeps its bank id and is several students' lowest.
  const step = await page.evaluate(() => CompetencyWording.nextStep(getTagById('sci8', 'QP2'), 2));
  expect(step).toBeTruthy();
  const rows = page.locator('.dash-na-row[data-sid]');
  const observation = rows.filter({ hasText: /Lowest\s*.?\s*Observation/ }).first();
  await expect(observation.locator('.dash-na-next')).toContainText('Next step: ');
  const local = rows.filter({ hasText: /Lowest\s*.?\s*Local Environment/ }).first();
  await expect(local).toBeVisible();
  await expect(local.locator('.dash-na-next')).toHaveCount(0);
  // Below Proficient at Developing: the Developing step.
  const dev = rows
    .filter({ hasText: /Observation\s*2\.\d/ })
    .filter({ hasText: 'Developing' })
    .first();
  await expect(dev.locator('.dash-na-next')).toHaveText('Next step: ' + step);
});

/* Folder columns (Colin, 2026-11-02): a row gives the student's lowest
   competency in the folder, named, at their level on it; a band gives the
   competency lowest for the most students in it, at the band's level. */
async function openFolders(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/dashboard?course=sci8'));
  await page.locator('.dash-na-row').first().waitFor();
}

test('in a folder, a Needs Attention row names the student’s lowest competency there and gives its step', async ({
  page,
}) => {
  await openFolders(page);
  const next = page.locator('.dash-na-row[data-sid] .dash-na-next').first();
  const text = await next.textContent();
  const m = /^Next step \((.+)\): (.+)$/.exec(text);
  expect(m, text).toBeTruthy();
  const sid = await next.evaluate(el => el.closest('.dash-na-row').dataset.sid);
  const want = await page.evaluate(
    ([sid, label]) => {
      const secs = getSections('sci8');
      const sec = secs.find(x => x.shortName === label || x.name === label);
      const v = getSectionProficiency('sci8', sid, sec.id);
      const sibs = secs.filter(x => x.groupId && x.groupId === sec.groupId);
      const lowest = sibs.every(
        x => !(getSectionProficiency('sci8', sid, x.id) > 0) || getSectionProficiency('sci8', sid, x.id) >= v,
      );
      return {
        step: CompetencyWording.nextStep(sec.tags[0], Math.max(1, Math.min(4, Math.round(v)))),
        lowest,
        n: sibs.length,
      };
    },
    [sid, m[1]],
  );
  expect(want.n).toBeGreaterThan(1);
  expect(want.lowest).toBe(true);
  expect(m[2]).toBe(want.step);
});

test('in a folder, the mix popover gives the step most of the band shares, named', async ({ page }) => {
  await openFolders(page);
  const folder = await page.evaluate(() => getLearningMap('sci8').competencyGroups[0].name);
  const seg = page.locator(`[data-action="mixSeg"][aria-label^="${folder}:"]`).first();
  await seg.click();
  await expect(page.locator('.dash-mix-pop-next')).toHaveText(/^Shared next step \(.+\): .+/);
});
