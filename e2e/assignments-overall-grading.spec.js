import { test, expect } from '@playwright/test';

/* Grading an assessment in Assignments (Demo Mode, Science 8). An
   assessment linked to no competency is scored on one Overall row, and it
   takes + and − like a competency row (migrations/20261022_score_modifier.sql).
   Fill row (the ▼ beside a student) and fill column (the level headers) show
   the new levels at once, not after a click elsewhere. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher\/app\.html/);
}

const AID = 'e2e-overall';

async function openGrading(page) {
  await page.evaluate(aid => {
    saveAssessments(
      'sci8',
      getAssessments('sci8').concat([
        { id: aid, title: 'Overall Only', scoreMode: 'proficiency', tagIds: [], type: 'summative', date: '2026-10-22' },
      ]),
    );
  }, AID);
  await page.goto('/teacher/app.html#/assignments?course=sci8');
  await page.locator(`[data-action="toggleAssess"][data-aid="${AID}"]`).click();
  await expect(page.locator(`.rsg-criterion-row[data-assess="${AID}"]`).first()).toBeVisible();
}

test('the Overall row takes + and −', async ({ page }) => {
  await enterDemo(page);
  await openGrading(page);
  const row = page.locator(`.rsg-criterion-row[data-assess="${AID}"]`).first();
  await row.locator('.rsg-level.l3').click();
  await row.locator('[data-action="setScoreMod"][data-mod="1"]').click();
  await expect(row.locator('[data-action="setScoreMod"][data-mod="1"]')).toHaveClass(/active/);
  const saved = await page.evaluate(aid => {
    const sid = document.querySelector(`.rsg-criterion-row[data-assess="${aid}"]`).dataset.student;
    return (getScores('sci8')[sid] || []).find(e => e.assessmentId === aid);
  }, AID);
  expect(saved).toMatchObject({ score: 3, mod: 1 });
});

test('Fill row and fill column show the new levels at once', async ({ page }) => {
  await enterDemo(page);
  await openGrading(page);
  const rows = page.locator(`.rsg-criterion-row[data-assess="${AID}"]`);
  const menu = page
    .locator(`.rsg-student[data-status-assess="${AID}"]`)
    .nth(1)
    .locator('[data-action="toggleScoreMenu"]');
  await menu.click();
  await menu.locator('[data-action="fillScoresAndClose"][data-score="2"]').click();
  await expect(rows.nth(1).locator('.rsg-level.active')).toHaveText('Developing');

  await page.locator(`.rsg-header-level.hl4[data-aid="${AID}"]`).click();
  await page.locator('#confirm-ok-btn').click();
  await expect(rows.first().locator('.rsg-level.active')).toHaveText('Extending');
  await expect(rows.last().locator('.rsg-level.active')).toHaveText('Extending');
});
