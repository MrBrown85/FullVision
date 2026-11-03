import { test, expect } from '@playwright/test';
import { serverRekeysRubrics } from './helpers.js';

/* Blank Rubric, the compact editor in place (rubric starts PR 5,
   2026-11-02): open on a new assessment; a row per criterion with its level
   cells typed into; + Competency, ··· (weight, points, remove), + Add
   Criterion, + From Competency; Standard / Advanced / Single-Point; Save
   Rubric holds it, Create keeps a touched blank, an untouched one is never
   saved; Edit Rubric on a held rubric opens it here. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 1000 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.fill('#af-title', 'Density Lab');
  await page.selectOption('#af-category', 'sci8-cat-labs');
}
const editor = page => page.locator('#af-rubric-view .af-ge-card');
const savedRubric = page =>
  page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.title === 'Density Lab');
    const r = a && a.rubricId && getRubricById('sci8', a.rubricId);
    return a ? (r ? JSON.parse(JSON.stringify(r)) : 'none') : null;
  });

test('open on a new assessment; an untouched blank is never saved', async ({ page }) => {
  await openForm(page);
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('.af-rubric-start[data-start="blank"]')).toHaveClass(/is-open/);
  // The title keeps focus; the editor doesn't take it.
  await expect(page.locator('#af-title')).toBeFocused();
  const n = await page.evaluate(() => getRubrics('sci8').length);
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect.poll(() => savedRubric(page)).toBe('none');
  expect(await page.evaluate(() => getRubrics('sci8').length)).toBe(n);
});

test('write a rubric in the grid; Save Rubric holds it; Create saves it', async ({ page }) => {
  await openForm(page);
  const ed = editor(page);
  await page.fill('#af-ge-name', 'Density Lab Report');
  await ed.locator('[data-ge="name"][data-i="0"]').fill('Organization');
  await ed.locator('[data-ge="level"][data-i="0"][data-level="3"]').fill('Flows in a clear order.');
  await ed.locator('[data-action="geAddCrit"]').click();
  await expect(ed.locator('[data-ge="name"][data-i="1"]')).toBeFocused();
  await ed.locator('[data-ge="name"][data-i="1"]').fill('Use of Evidence');
  // + Competency on the second criterion.
  await ed.locator('[data-action="gePicker"][data-i="1"]').click();
  await expect(page.locator('#af-ge-pick-search')).toBeFocused();
  await page.fill('#af-ge-pick-search', 'pa4');
  await ed.locator('[data-action="gePick"][data-tag="PA4"]').click();
  await expect(ed.locator('.af-ge-chip')).toContainText('PA4');
  // ··· sets the weight.
  await ed.locator('[data-action="geMenu"][data-i="0"]').click();
  await ed.locator('[data-ge="weight"][data-i="0"]').fill('2');
  await ed.locator('[data-action="geSave"]').click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('#af-rubric-view .af-rubric-card-name')).toHaveText('Density Lab Report');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(async () => {
      const r = await savedRubric(page);
      return r && r !== 'none'
        ? r.criteria.map(c => [c.name, c.levels[3] || '', c.tagIds.join(','), Number(c.weight)])
        : null;
    })
    .toEqual([
      ['Organization', 'Flows in a clear order.', '', 2],
      ['Use of Evidence', '', 'PA4', 1],
    ]);
});

test('Create keeps a touched blank without Save Rubric, named after the assessment', async ({ page }) => {
  await openForm(page);
  await editor(page).locator('[data-ge="level"][data-i="0"][data-level="4"]').fill('Goes beyond.');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect.poll(async () => ((await savedRubric(page)) || {}).name).toBe('Density Lab Rubric');
});

test('signed in, Create keeps the rubric on the new assessment', async ({ page }) => {
  await openForm(page);
  await page.evaluate(serverRekeysRubrics);
  await editor(page).locator('[data-ge="level"][data-i="0"][data-level="4"]').fill('Goes beyond.');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect.poll(async () => ((await savedRubric(page)) || {}).name).toBe('Density Lab Rubric');
});

test('+ From Competency starts a row with its wording; Advanced shows checkboxes; Esc keeps the work', async ({
  page,
}) => {
  await openForm(page);
  const ed = editor(page);
  await ed.locator('[data-action="gePicker"][data-i="-1"]').click();
  await ed.locator('[data-action="gePick"][data-tag="QP3"]').click();
  const want = await page.evaluate(async () => {
    await CompetencyWording.loadBank();
    return CompetencyWording.levelWording(getTagById('sci8', 'QP3'), 3).text;
  });
  await expect(ed.locator('[data-ge="level"][data-i="0"][data-level="3"]')).toHaveValue(want);
  await expect(ed.locator('[data-ge="name"]')).toHaveCount(1);
  await ed.locator('[data-action="geStyle"][data-style="advanced"]').click();
  await ed.locator('[data-action="geAddCheck"][data-i="0"][data-level="3"]').click();
  await expect(ed.locator('[data-ge="check"][data-i="0"][data-level="3"][data-k="0"]')).toBeFocused();
  await page.keyboard.type('Writes a testable question');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeVisible();
  await expect(ed.locator('[data-ge="check"][data-i="0"][data-level="3"][data-k="0"]')).toHaveValue(
    'Writes a testable question',
  );
});

test('Edit Rubric on a held rubric opens it here; Cancel puts the card back', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-ge-name', 'Held Here');
  await page.locator('[data-action="geSave"]').click();
  await page.locator('[data-action="editRubricFromForm"]').click();
  await expect(page.locator('.af-ge-card[data-in-place="true"]')).toBeVisible();
  await expect(page.locator('#af-ge-name')).toHaveValue('Held Here');
  await page.locator('.af-ge-card [data-action="closeStart"]').click();
  await expect(page.locator('#af-rubric-view .af-rubric-card-name')).toHaveText('Held Here');
});
