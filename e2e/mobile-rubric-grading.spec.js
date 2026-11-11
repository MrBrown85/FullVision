import { test, expect } from '@playwright/test';

/* Phone grading by rubric criterion (Rubric Bank plan §5, PR 10). An
   assessment with a rubric of its own opens in Rubric view: one row per
   criterion, saved under each of its competencies, as on the desktop.
   Competencies | Rubric switches back to competency rows. An Advanced Rubric's
   criterion has a Checks button that opens its checkboxes; ticking every
   box of a level writes that level. Runs in Demo Mode on Science 8: the
   Science Fair Proposal uses the Experimental Design Rubric (Standard), the
   Chemical Reactions Lab the Lab Investigation Rubric (Advanced). */

async function openLab(page, makeAdvanced, title = 'Chemical Reactions Lab') {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
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
  await page
    .locator('text=' + title)
    .first()
    .click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
}

const firstCard = page => page.locator('.m-swiper-card').first();

test.describe('Phone grading by rubric criterion', () => {
  test('a rubric assessment opens by criterion; Competencies switches back', async ({ page }) => {
    await openLab(page, false, 'Science Fair Proposal');
    const card = firstCard(page);
    await expect(page.getByRole('button', { name: 'Rubric', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.m-crit-group')).toHaveCount(3);
    await expect(card.locator('.m-crit-name').first()).toHaveText('Variable Identification');
    await expect(card.locator('.m-checks-btn')).toHaveCount(0);

    // A level saves under every competency of the criterion.
    const group = card.locator('.m-crit-group').first();
    const target = (await group.locator('.m-score-btn.m-score-active').count()) ? '1' : '4';
    await group.locator(`.m-score-btn[data-score="${target}"]`).click();
    await expect(card.locator('.m-crit-group').first().locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText(
      target,
    );
    const saved = await page.evaluate(() => {
      const cid = Object.keys(COURSES)[0];
      const a = getAssessments(cid).find(x => x.title === 'Science Fair Proposal');
      const crit = getRubricById(cid, a.rubricId).criteria[0];
      const sid = document.querySelector('.m-swiper-card').dataset.sid;
      return rubricCriterionScoreKeys(crit).map(
        tid => (getScores(cid)[sid] || []).find(e => e.assessmentId === a.id && e.tagId === tid).score,
      );
    });
    expect(new Set(saved).size).toBe(1);
    expect(saved[0]).toBe(Number(target));

    await page.getByRole('button', { name: 'Competencies', exact: true }).click();
    await expect(firstCard(page).locator('.m-crit-group')).toHaveCount(0);
    await expect(firstCard(page).locator('.m-score-group').first()).toBeVisible();
  });

  /* Competencies view on rubric work matches the desktop's (Nov 5): one row
     per competency the criteria feed, showing their level, and a level set
     on a competency goes to every criterion behind it. It used to list the
     criteria again. */
  test("Competencies view lists the criteria's competencies and scores through them", async ({ page }) => {
    await openLab(page, false, 'Science Fair Proposal');
    await page.getByRole('button', { name: 'Competencies', exact: true }).click();
    const card = firstCard(page);
    const expected = await page.evaluate(() => {
      const cid = Object.keys(COURSES)[0];
      const a = getAssessments(cid).find(x => x.title === 'Science Fair Proposal');
      const r = getRubricById(cid, a.rubricId);
      return {
        rows: rubricCompetencyRowKeys(cid, a),
        criteria: r.criteria.map(c => c.id),
        names: rubricCompetencyRowKeys(cid, a).map(id => getTagById(cid, id).label),
      };
    });
    const rows = await card.locator('.m-score-mods').evaluateAll(els => els.map(e => e.dataset.tid));
    expect(rows).toEqual(expected.rows);
    expect(rows.some(id => expected.criteria.includes(id))).toBe(false);
    await expect(card.locator('.m-score-tag-label')).toHaveText(expected.names);

    // Set the first competency to a level it doesn't have; each criterion
    // behind it takes that level.
    const row = card.locator('.m-score-group').first();
    const target =
      (await row
        .locator('.m-score-btn.m-score-active .m-level-fig')
        .textContent()
        .catch(() => '')) === '4'
        ? '1'
        : '4';
    await row.locator(`.m-score-btn[data-score="${target}"]`).click();
    await expect(
      firstCard(page).locator('.m-score-group').first().locator('.m-score-btn.m-score-active .m-level-fig'),
    ).toHaveText(target);
    const behind = await page.evaluate(tid => {
      const cid = Object.keys(COURSES)[0];
      const a = getAssessments(cid).find(x => x.title === 'Science Fair Proposal');
      const sid = document.querySelector('.m-swiper-card').dataset.sid;
      return rubricRowScoreKeys(cid, a, tid).map(k => {
        const e = (getScores(cid)[sid] || []).find(x => x.assessmentId === a.id && x.tagId === k);
        return e ? e.score : 0;
      });
    }, expected.rows[0]);
    expect(behind.length).toBeGreaterThan(0);
    expect(new Set(behind)).toEqual(new Set([Number(target)]));
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
    await expect(group().locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('4');
    await expect(group().locator('.m-checklist-head')).toHaveText('Suggested: Extending');
    await expect(group().locator('.m-checks-btn')).toHaveText('2');

    // A level picked by hand stays.
    await group().locator('.m-score-btn[data-score="2"]').click();
    await group().getByLabel('Records units').check();
    await expect(group().locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('2');
  });
});
