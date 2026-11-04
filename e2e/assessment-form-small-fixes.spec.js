import { test, expect } from '@playwright/test';

/* Small form fixes (audit, 2026-11-02): Date Assigned moves Due Date only
   while it's still the week-later default; Start From a Past Assessment
   brings this class's Category, Module and Description; Create and Add
   Another says what it created until the next edit; a title ending in
   "Rubric" isn't given a second one; the untagged note has room under it;
   Core Competency chips say whether they're on. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openNew(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}
async function setAssigned(page, day) {
  await page.fill('#af-date-assigned', day);
  await page.locator('#af-date-assigned').dispatchEvent('change');
}

test('Date Assigned moves the default due date but not one the teacher set', async ({ page }) => {
  await openNew(page);
  await setAssigned(page, '2026-11-05');
  await expect(page.locator('#af-due')).toHaveValue('2026-11-12');
  await setAssigned(page, '2026-11-06');
  await expect(page.locator('#af-due')).toHaveValue('2026-11-13');
  await page.fill('#af-due', '2026-12-15');
  await setAssigned(page, '2026-11-09');
  await expect(page.locator('#af-due')).toHaveValue('2026-12-15');
  await page.fill('#af-due', '');
  await setAssigned(page, '2026-11-10');
  await expect(page.locator('#af-due')).toHaveValue('2026-11-17');
});

test('Start From a Past Assessment in this class brings Category, Module and Description', async ({ page }) => {
  await openNew(page);
  const src = await page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.scoreMode === 'points');
    const cat = document.querySelector('#af-category option:not([value=""])').value;
    const mod = (document.querySelector('#af-module option:not([value=""])') || {}).value || '';
    a.categoryId = cat;
    a.moduleId = mod || undefined;
    a.description = 'Read the graph and answer.';
    return { title: a.title, cat, mod };
  });
  await page.locator('[data-action="startFromPast"]').click();
  await page.fill('#af-past-find', src.title);
  await page.locator('.af-past-row', { hasText: src.title }).first().click();
  await expect(page.locator('#af-title')).toHaveValue(src.title);
  await expect(page.locator('#af-category')).toHaveValue(src.cat);
  if (src.mod) await expect(page.locator('#af-module')).toHaveValue(src.mod);
  await expect(page.locator('#af-desc')).toHaveValue('Read the graph and answer.');
  await expect(page.locator('#af-category-hint')).toBeHidden();
  const n = await page.evaluate(() => getAssessments('sci8').length);
  await page.fill('#af-title', src.title + ' (Again)');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect.poll(() => page.evaluate(() => getAssessments('sci8').length)).toBe(n + 1);
});

test('Create and Add Another says what it created until the next edit', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-title', 'Batch 1');
  await page.selectOption('#af-category', { index: 1 });
  await page.locator('[data-action="saveAndAddAnother"]').click();
  const note = page.locator('#af-saved-note');
  await expect(note).toHaveText('Created Batch 1.');
  await expect(note).toBeVisible();
  await expect(page.locator('#af-title')).toHaveValue('');
  await page.keyboard.type('B');
  await expect(note).toBeHidden();
});

test('a title ending in Rubric is not given a second one', async ({ page }) => {
  await openNew(page);
  await page.fill('#af-title', 'Comp Rubric');
  await page.locator('.af-ge-card [data-action="closeStart"]').click();
  await page.evaluate(() => document.querySelectorAll('.af-tag-cb')[0].click());
  await page.locator('[data-action="useCompetencyRubric"]').click();
  await expect(page.locator('#af-rubric-view .af-rubric-card-name')).toHaveText('Comp Rubric');
});

test('the untagged note has the form gap under it', async ({ page }) => {
  await openNew(page);
  const gap = await page.evaluate(() => {
    const note = document.getElementById('af-untagged-note');
    const label = Array.from(document.querySelectorAll('.af-card-competencies .af-label')).find(
      l => l.textContent === 'Core Competencies',
    );
    return label.getBoundingClientRect().top - note.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(12);
});

test('Core Competency chips say whether they are on', async ({ page }) => {
  await openNew(page);
  const chip = page.locator('.af-cc-chip').first();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
});

// Nov 3 sweep (step 4 group 2 #18): a due date before the date assigned
// saved with no word ("Nov 3, 2026 → Nov 2, 2026"). The form says so under
// the field; Save still saves (information only).
test('a due date before the date assigned is said under the field', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  const hint = page.locator('#af-due-hint');
  await expect(hint).toBeHidden();
  await page.fill('#af-date-assigned', '2026-11-03');
  await page.fill('#af-due', '2026-11-02');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('The due date is before the date assigned.');
  await expect(page.locator('#af-due')).toHaveAttribute('aria-describedby', 'af-due-hint');
  await page.fill('#af-due', '2026-11-04');
  await expect(hint).toBeHidden();
  await page.fill('#af-due', '');
  await expect(hint).toBeHidden();
});
