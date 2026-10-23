import { test, expect } from '@playwright/test';

/* Phone grading by rubric criterion (Rubric Bank plan §5, PR 10). An
   assessment with a rubric of its own opens in Rubric view: one row per
   criterion, saved under each of its competencies, as on the desktop.
   Tags | Rubric switches back to competency rows. An Advanced Rubric's
   criterion has a Checks button that opens its checkboxes; ticking every
   box of a level writes that level. Runs in Demo Mode on Science 8, whose
   Chemical Reactions Lab uses the Lab Investigation Rubric. */

async function openLab(page, makeAdvanced) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  if (makeAdvanced) {
    await page.evaluate(() => {
      const cid = Object.keys(COURSES)[0];
      const rubrics = structuredClone(getRubrics(cid));
      const r = rubrics.find(x => x.name === 'Lab Investigation Rubric');
      r.style = 'advanced';
      r.criteria.forEach((c, i) => {
        c.checks = [
          { id: 'e2e-k4a-' + i, level: 4, label: 'Repeats trials', displayOrder: 0 },
          { id: 'e2e-k4b-' + i, level: 4, label: 'Explains an odd result', displayOrder: 1 },
          { id: 'e2e-k3a-' + i, level: 3, label: 'Records units', displayOrder: 0 },
        ];
      });
      saveRubrics(cid, rubrics);
    });
  }
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('text=Chemical Reactions Lab').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
}

const firstCard = page => page.locator('.m-swiper-card').first();

test.describe('Phone grading by rubric criterion', () => {
  test('a rubric assessment opens by criterion; Tags switches to competencies', async ({ page }) => {
    await openLab(page, false);
    const card = firstCard(page);
    await expect(page.getByRole('button', { name: 'Rubric', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.m-crit-group')).toHaveCount(3);
    await expect(card.locator('.m-crit-name').first()).toHaveText('Scientific Inquiry');
    await expect(card.locator('.m-checks-btn')).toHaveCount(0);

    // A level saves under every competency of the criterion.
    const group = card.locator('.m-crit-group').first();
    const target = (await group.locator('.m-score-btn.m-score-active').count()) ? '1' : '4';
    await group.locator(`.m-score-btn[data-score="${target}"]`).click();
    await expect(card.locator('.m-crit-group').first().locator('.m-score-btn.m-score-active')).toHaveText(target);
    const saved = await page.evaluate(() => {
      const cid = Object.keys(COURSES)[0];
      const a = getAssessments(cid).find(x => x.title === 'Chemical Reactions Lab');
      const crit = getRubricById(cid, a.rubricId).criteria[0];
      const sid = document.querySelector('.m-swiper-card').dataset.sid;
      return rubricCriterionScoreKeys(crit).map(
        tid => (getScores(cid)[sid] || []).find(e => e.assessmentId === a.id && e.tagId === tid).score,
      );
    });
    expect(new Set(saved).size).toBe(1);
    expect(saved[0]).toBe(Number(target));

    await page.getByRole('button', { name: 'Tags', exact: true }).click();
    await expect(firstCard(page).locator('.m-crit-group')).toHaveCount(0);
    await expect(firstCard(page).locator('.m-score-group').first()).toBeVisible();
  });

  test('an Advanced Rubric ticks its way to a level', async ({ page }) => {
    await openLab(page, true);
    const group = () => firstCard(page).locator('.m-crit-group').first();
    // Start from no level so the boxes decide it.
    if (await group().locator('.m-score-btn.m-score-active').count())
      await group().locator('.m-score-btn.m-score-active').click();
    await expect(group().locator('.m-score-btn.m-score-active')).toHaveCount(0);

    await group().locator('.m-checks-btn').click();
    await expect(group().locator('.m-checklist-head')).toHaveText('No Level Suggested Yet');
    await group().getByLabel('Repeats trials').check();
    await expect(group().locator('.m-score-btn.m-score-active')).toHaveCount(0);
    await group().getByLabel('Explains an odd result').check();
    await expect(group().locator('.m-score-btn.m-score-active')).toHaveText('4');
    await expect(group().locator('.m-checklist-head')).toHaveText('Suggested: Extending');
    await expect(group().locator('.m-checks-btn')).toContainText('2/3');

    // A level picked by hand stays.
    await group().locator('.m-score-btn[data-score="2"]').click();
    await group().getByLabel('Records units').check();
    await expect(group().locator('.m-score-btn.m-score-active')).toHaveText('2');
  });
});
