import { test, expect } from '@playwright/test';

/* Form data fixes (audit, 2026-11-02): a Blank rubric keeps the ticked
   competencies; a stopped Save Changes leaves the stored assessment alone;
   Save Changes with no edits writes nothing; Max Points keeps decimals and
   its quick picks follow the box. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openList(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await expect(page.locator('button', { hasText: 'New Assessment' }).first()).toBeVisible();
}
async function openNew(page) {
  await openList(page);
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}
async function openEdit(page, aid) {
  await expect(page.locator(`[data-action="editAssess"][data-aid="${aid}"]`)).toBeAttached();
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
}
const stored = (page, aid) =>
  page.evaluate(id => JSON.parse(JSON.stringify(getAssessments('sci8').find(a => a.id === id))), aid);
const ticked = page =>
  page.evaluate(() => Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(cb => cb.value));
async function tick(page, n) {
  await page.evaluate(i => document.querySelectorAll('.af-tag-cb')[i].click(), n);
}

test('Save Rubric on a Blank rubric keeps the ticked competencies', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-title', 'Blank Keeps Ticks');
  await page.selectOption('#af-category', { index: 1 });
  await tick(page, 0);
  await tick(page, 5);
  const before = await ticked(page);
  expect(before.length).toBe(2);
  await page.fill('#af-ge-name', 'My Blank');
  await page.locator('[data-ge="level"][data-i="0"][data-level="3"]').fill('Does the thing');
  await page.locator('[data-action="geSave"]').click();
  await expect(page.locator('.af-rubric-card-name').first()).toHaveText('My Blank');
  expect(await ticked(page)).toEqual(before);
  await expect(page.locator('.af-card-competencies')).not.toHaveClass(/is-rubric/);
  expect(await page.evaluate(() => document.querySelector('.af-tag-cb').disabled)).toBe(false);
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Blank Keeps Ticks'));
  expect(saved.tagIds.sort()).toEqual(before.sort());
  expect(saved.rubricId).toBeTruthy();
});

test('Create with a written Blank rubric keeps the ticked competencies', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-title', 'Blank Ticks On Create');
  await page.selectOption('#af-category', { index: 1 });
  await tick(page, 1);
  const before = await ticked(page);
  await page.locator('[data-ge="level"][data-i="0"][data-level="2"]').fill('Some words');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => (getAssessments('sci8').find(a => a.title === 'Blank Ticks On Create') || {}).tagIds),
    )
    .toEqual(before);
});

test('a rubric that scores competencies still ticks exactly its own', async ({ page }) => {
  await openNew(page);
  await tick(page, 0);
  const rid = await page.evaluate(() => getRubrics('sci8').find(r => r.criteria.some(c => (c.tagIds || []).length)).id);
  const want = await page.evaluate(
    id => [...new Set(getRubricById('sci8', id).criteria.flatMap(c => c.tagIds || []))].sort(),
    rid,
  );
  await page.locator('[data-action="chooseRubric"]').first().click();
  await page.locator(`#af-rubric-view .af-start-row[data-rid="${rid}"]`).click();
  await page.locator('#af-rubric-view [data-action="startPickUse"]').click();
  expect((await ticked(page)).sort()).toEqual(want);
  await expect(page.locator('.af-card-competencies')).toHaveClass(/is-rubric/);
});

test('a Save Changes stopped by Max Points leaves the stored assessment alone', async ({ page }) => {
  await openList(page);
  const before = await stored(page, 'sci8q12');
  await openEdit(page, 'sci8q12');
  await page.fill('#af-title', 'CHANGED TITLE');
  await page.fill('#af-maxpoints', '0');
  await page.locator('[data-action="saveEditAssess"]').click();
  await expect(page.locator('#af-maxpoints')).toBeFocused();
  await expect(page.locator('#af-maxpoints')).toHaveAttribute('aria-invalid', 'true');
  expect(await stored(page, 'sci8q12')).toEqual(before);
});

for (const aid of ['sci8q12', 'sci8a20']) {
  test(`Save Changes with no edits writes nothing (${aid})`, async ({ page }) => {
    await openList(page);
    const before = await stored(page, aid);
    await openEdit(page, aid);
    await expect(page.locator('#af-due')).toHaveValue(before.dueDate || '');
    await expect(page.locator('#af-evidence')).toHaveValue(before.evidenceType || 'written');
    await page.locator('[data-action="saveEditAssess"]').click();
    await expect(page.locator('#af-title')).toBeHidden();
    expect(await stored(page, aid)).toEqual(before);
  });
}

test('an edit changes only the field edited', async ({ page }) => {
  await openList(page);
  const before = await stored(page, 'sci8a20');
  await openEdit(page, 'sci8a20');
  await page.fill('#af-title', 'Science Fair Proposal (Edited)');
  await page.locator('[data-action="saveEditAssess"]').click();
  await expect(page.locator('#af-title')).toBeHidden();
  const after = await stored(page, 'sci8a20');
  expect(after.title).toBe('Science Fair Proposal (Edited)');
  delete after.title;
  delete after.successCriteria;
  const want = { ...before };
  delete want.title;
  expect(after).toEqual(want);
});

test('Max Points keeps a decimal and the quick picks follow the box', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-title', 'Decimal Points');
  await page.selectOption('#af-category', { index: 1 });
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  const pick = v => page.locator(`#af-maxpoints-picks [data-value="${v}"]`);
  await expect(pick(100)).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#af-maxpoints', '25');
  await expect(pick(25)).toHaveAttribute('aria-pressed', 'true');
  await expect(pick(100)).toHaveAttribute('aria-pressed', 'false');
  await page.fill('#af-maxpoints', '12.5');
  await expect(page.locator('#af-maxpoints-picks [aria-pressed="true"]')).toHaveCount(0);
  await pick(50).click();
  await expect(page.locator('#af-maxpoints')).toHaveValue('50');
  await expect(pick(50)).toHaveAttribute('aria-pressed', 'true');
  await page.fill('#af-maxpoints', '12.5');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(() => page.evaluate(() => (getAssessments('sci8').find(a => a.title === 'Decimal Points') || {}).maxPoints))
    .toBe(12.5);
});
