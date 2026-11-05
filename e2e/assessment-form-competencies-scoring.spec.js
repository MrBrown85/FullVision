import { test, expect } from '@playwright/test';
import { openCompPicker, closeCompPicker } from './helpers.js';

/* New Assessment > Scoring > Competencies (Step 4 group 3 #24, Colin
   2026-11-03): score each tagged competency Emerging to Extending, with +
   and −, and no rubric. It saves what proficiency work with no rubric always
   saved (no scoreMode, no rubricId, the tags), so its scores and math are
   today's. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openForm(page) {
  await demo(page);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

// A Competencies assessment on QP1 and QP2, dated today, made through the form.
async function createOne(page, title) {
  await openForm(page);
  await page.fill('#af-title', title);
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('.af-scoremode-btn[data-mode="competencies"]').click();
  await openCompPicker(page);
  await page.locator('.af-tag-cb[value="QP1"]').check();
  await page.locator('.af-tag-cb[value="QP2"]').check();
  await closeCompPicker(page);
  await page.locator('[data-action="saveNewAssess"]').click();
  return page.evaluate(t => getAssessments('sci8').find(a => a.title === t), title);
}

// The student's levels as calc.js has them.
function levels(page, sid) {
  return page.evaluate(
    s => ({
      qp1: getSectionProficiency('sci8', s, 'QP1'),
      overall: getOverallProficiency('sci8', s),
    }),
    sid,
  );
}

function tagScore(page, aid, sid, tid) {
  return page.evaluate(
    ([a, s, t]) => {
      const e = (getScores('sci8')[s] || []).find(x => x.assessmentId === a && x.tagId === t);
      return e ? { score: e.score, mod: e.mod || 0 } : null;
    },
    [aid, sid, tid],
  );
}

test('Competencies is a fourth choice, with no hover preview', async ({ page }) => {
  await openForm(page);
  const card = page.locator('.af-scoremode-btn[data-mode="competencies"]');
  await expect(page.locator('.af-scoremode-btn')).toHaveText([
    'Rubric',
    'Points',
    'Complete/Incomplete',
    'Competencies',
  ]);
  // No preview on hover or focus: it covered the rubric editor (Colin, Nov 4).
  await card.hover();
  await page.waitForTimeout(600);
  await expect(page.locator('.af-mode-tip, [role="tooltip"]:visible')).toHaveCount(0);
  await page.locator('.af-scoremode-btn[data-mode="complete"]').focus();
  await page.keyboard.press('Tab');
  await expect(card).toBeFocused();
  await expect(card).not.toHaveAttribute('aria-describedby', /.+/);
  // Four cards and Factor on one row.
  const cardTop = (await card.boundingBox()).y;
  const factor = await page.locator('#af-weight-wrap').boundingBox();
  expect(Math.abs(factor.y + factor.height / 2 - (cardTop + 22))).toBeLessThan(12);
});

test('it needs a tagged competency, says so, and saves no rubric', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Direct Check');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('.af-scoremode-btn[data-mode="competencies"]').click();
  await expect(page.locator('#af-rubric-wrap')).toBeHidden();
  await expect(page.locator('#af-comp-note')).toHaveText(
    'Each competency you tag above is scored Emerging to Extending, with + and −. No rubric is needed.',
  );
  await expect(page.locator('#af-comp-hint')).toHaveText(
    'Tag at least one competency above. Each one you tag is what students are scored on.',
  );
  await page.locator('[data-action="saveNewAssess"]').click();
  expect(await page.evaluate(() => getAssessments('sci8').some(a => a.title === 'Direct Check'))).toBe(false);
  // The save stops at Choose Competencies.
  await expect(page.locator('#af-comp-choose')).toBeFocused();
  await openCompPicker(page);
  await page.locator('.af-tag-cb[value="QP1"]').check();
  await closeCompPicker(page);
  await expect(page.locator('#af-comp-hint')).toBeHidden();
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Direct Check'));
  expect(saved.tagIds).toEqual(['QP1']);
  expect(saved.rubricId).toBeFalsy();
  expect(saved.scoreMode || 'proficiency').toBe('proficiency');
  // Editing opens it on Competencies.
  await page
    .locator('#ac-' + saved.id + ' [data-action="editAssess"]')
    .first()
    .click();
  await expect(page.locator('.af-scoremode-btn[data-mode="competencies"]')).toHaveAttribute('aria-checked', 'true');
});

test('scored on the card, with + and −, the competency and the course grade move', async ({ page }) => {
  const a = await createOne(page, 'Card Competency Check');
  const sid = await page.evaluate(() => getStudents('sci8')[0].id);
  const before = await levels(page, sid);
  const row = page.locator(`#ac-${a.id} .rsg-criterion-row[data-student="${sid}"][data-tag="QP1"]`);
  await row.locator('.rsg-level[data-level="1"]').click();
  await expect.poll(() => tagScore(page, a.id, sid, 'QP1')).toEqual({ score: 1, mod: 0 });
  const after = await levels(page, sid);
  expect(after.qp1).toBeLessThan(before.qp1);
  expect(after.overall).toBeLessThan(before.overall);
  // + on the level: Emerging+, the same modifier rubric criteria carry.
  await row.locator('.rsg-level[data-level="1"]').hover();
  await row.locator('[data-action="setScoreMod"][data-mod="1"]').click();
  await expect.poll(() => tagScore(page, a.id, sid, 'QP1')).toEqual({ score: 1, mod: 1 });
});

test('scored in the gradebook grader, the cell and the levels move', async ({ page }) => {
  const a = await createOne(page, 'Gradebook Competency Check');
  const sid = await page.evaluate(() => getStudents('sci8')[1].id);
  const before = await levels(page, sid);
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  const cell = page.locator(`.gb-scores-cell[data-sid="${sid}"][data-aid="${a.id}"]`);
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  const qp1 = dialog.getByRole('region', { name: 'Sustained Inquiry' });
  const qp2 = dialog.getByRole('region', { name: 'Observation' });
  await qp1.getByRole('button', { name: 'Emerging', exact: true }).click();
  await qp2.getByRole('button', { name: 'Emerging', exact: true }).click();
  await qp2.getByRole('button', { name: 'High Emerging' }).click();
  await dialog.locator('.grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  expect(await tagScore(page, a.id, sid, 'QP1')).toEqual({ score: 1, mod: 0 });
  expect(await tagScore(page, a.id, sid, 'QP2')).toEqual({ score: 1, mod: 1 });
  await expect(cell).not.toHaveText('');
  const after = await levels(page, sid);
  expect(after.qp1).toBeLessThan(before.qp1);
  expect(after.overall).toBeLessThan(before.overall);
});

test('scored on the phone, a competency row per tag', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const aid = await page.evaluate(() => {
    const list = getAssessments('sci8');
    const a = {
      id: 'e2e-competencies',
      title: 'Phone Competency Check',
      date: courseToday('sci8'),
      dateAssigned: courseToday('sci8'),
      type: 'summative',
      tagIds: ['QP1', 'QP2'],
      categoryId: 'sci8-cat-labs',
      created: new Date().toISOString(),
    };
    saveAssessments('sci8', list.concat([a]));
    return a.id;
  });
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('text=Phone Competency Check').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  const card = page.locator('.m-swiper-card').first();
  const sid = await card.getAttribute('data-sid');
  const before = await levels(page, sid);
  await card.locator('.m-score-btn[data-tid="QP1"][data-score="1"]').click();
  await expect.poll(() => tagScore(page, aid, sid, 'QP1')).toEqual({ score: 1, mod: 0 });
  const after = await levels(page, sid);
  expect(after.qp1).toBeLessThan(before.qp1);
  expect(after.overall).toBeLessThan(before.overall);
});
