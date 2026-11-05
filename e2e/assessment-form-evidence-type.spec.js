import { test, expect } from '@playwright/test';

/* Evidence chips (plan item 8, Nov 4 2026): the kind of work is a row of
   chips under the Category row, no longer a select in More Options. A new
   assessment's kind follows its title until a chip is tapped; Edit shows
   the saved kind; Start From a Past Assessment and copies to other classes
   carry it; the card names it only when it isn't Written. Demo Mode,
   Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openAssignments(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
}
async function openForm(page) {
  await openAssignments(page);
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}
const chip = (page, v) => page.locator(`.af-evidence-chip[data-evidence="${v}"]`);
const checked = page => page.locator('.af-evidence-chip[aria-checked="true"]');

test('the chips sit under the Category row; More Options is gone', async ({ page }) => {
  await openForm(page);
  const group = page.locator('.af-card-what [role="radiogroup"][aria-labelledby="af-evidence-label"]');
  await expect(group).toBeVisible();
  await expect(page.locator('#af-evidence-label')).toHaveText('Evidence');
  await expect(group.locator('.af-evidence-chip')).toHaveText([
    'Lab',
    'Test',
    'Quiz',
    'Project',
    'Presentation',
    'Written',
    'Other',
  ]);
  await expect(checked(page)).toHaveText('Written');
  await expect(page.locator('.af-more-toggle')).toHaveCount(0);
  // Right under the Category row (its hint may sit between).
  const [row, chips] = await Promise.all([page.locator('.af-row-what').boundingBox(), group.boundingBox()]);
  expect(chips.y).toBeGreaterThan(row.y + row.height);
  expect(chips.y - (row.y + row.height)).toBeLessThan(50);
});

test('a new assessment guesses its kind from the title', async ({ page }) => {
  await openForm(page);
  const title = page.locator('#af-title');
  for (const [text, kind] of [
    ['Density Lab', 'lab'],
    ['Periodic Table Quiz', 'quiz'],
    ['Unit 2 Test', 'test'],
    ['Research Proposal', 'project'],
    ['Biodiversity Project', 'project'],
    ['Plate Tectonics Presentation', 'presentation'],
    ['Persuasive Essay', 'written'],
  ]) {
    await title.fill(text);
    await expect(checked(page)).toHaveAttribute('data-evidence', kind);
    await expect(page.locator('#af-evidence')).toHaveValue(kind);
  }
  // Complete/Incomplete work is Written whatever the title says.
  await title.fill('Density Lab');
  await page.locator('.af-scoremode-btn[data-mode="complete"]').click();
  await expect(page.locator('#af-evidence')).toHaveValue('written');
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await expect(page.locator('#af-evidence')).toHaveValue('lab');
});

test('a tapped chip stays put while the title changes, and saves', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Density Lab');
  await expect(page.locator('#af-evidence')).toHaveValue('lab');
  await chip(page, 'presentation').click();
  await expect(checked(page)).toHaveText('Presentation');
  await page.fill('#af-title', 'Density Lab Quiz');
  await expect(page.locator('#af-evidence')).toHaveValue('presentation');
  // Arrow keys move the choice, as radios do.
  await chip(page, 'presentation').focus();
  await page.keyboard.press('ArrowRight');
  await expect(chip(page, 'written')).toBeFocused();
  await expect(chip(page, 'written')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(chip(page, 'presentation')).toHaveAttribute('aria-checked', 'true');
  await expect(chip(page, 'presentation')).toHaveAttribute('tabindex', '0');
  await expect(chip(page, 'lab')).toHaveAttribute('tabindex', '-1');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Density Lab Quiz'));
  expect(saved.evidenceType).toBe('presentation');
});

test('Edit shows the saved kind, and Save Changes keeps it', async ({ page }) => {
  await openAssignments(page);
  const a = await page.evaluate(() => {
    const list = getAssessments('sci8');
    const x = list.find(y => y.evidenceType === 'lab');
    return { id: x.id, title: x.title };
  });
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), a.id);
  await expect(page.locator('#af-title')).toHaveValue(a.title);
  await expect(checked(page)).toHaveAttribute('data-evidence', 'lab');
  // Editing the title doesn't move the kind of existing work.
  await page.fill('#af-title', a.title + ' Quiz');
  await expect(page.locator('#af-evidence')).toHaveValue('lab');
  await chip(page, 'project').click();
  await page.locator('[data-action="saveEditAssess"]').click();
  const kind = await page.evaluate(id => getAssessments('sci8').find(x => x.id === id).evidenceType, a.id);
  expect(kind).toBe('project');
});

test('a kind from before the chips keeps its own chip on Edit', async ({ page }) => {
  await openAssignments(page);
  const id = await page.evaluate(() => getAssessments('sci8').find(y => y.evidenceType === 'observation').id);
  await page.evaluate(i => document.querySelector(`[data-action="editAssess"][data-aid="${i}"]`).click(), id);
  await expect(checked(page)).toHaveText('Observation');
  await page.fill('#af-title', 'Retitled Observation Lab');
  await page.locator('[data-action="saveEditAssess"]').click();
  const kind = await page.evaluate(i => getAssessments('sci8').find(x => x.id === i).evidenceType, id);
  expect(kind).toBe('observation');
});

test('Start From a Past Assessment carries its kind', async ({ page }) => {
  await openForm(page);
  const src = await page.evaluate(() => {
    const list = getAssessments('sci8');
    // A title that would guess differently, so the carry is what shows.
    const x = list.find(y => y.evidenceType === 'project') || list.find(y => y.evidenceType === 'quiz');
    return { title: x.title, kind: x.evidenceType };
  });
  await page.locator('[data-action="startFromPast"]').click();
  await page.fill('#af-past-find', src.title);
  await page.locator('.af-past-row', { hasText: src.title }).first().click();
  await expect(page.locator('#af-title')).toHaveValue(src.title);
  await expect(page.locator('#af-evidence')).toHaveValue(src.kind);
  // Carried, so the title no longer moves it.
  await page.fill('#af-title', 'Unit 2 Test');
  await expect(page.locator('#af-evidence')).toHaveValue(src.kind);
});

test('a copy to another class carries its kind', async ({ page }) => {
  await openAssignments(page);
  const kind = await page.evaluate(() => {
    const a = getAssessments('sci8').find(y => y.evidenceType === 'lab');
    const plan = { rubric: { mode: 'none' }, tagIds: [], category: {}, moduleId: '' };
    return AssessmentCopy.buildCopy(a, plan, null, 'g1').assessment.evidenceType;
  });
  expect(kind).toBe('lab');
});

test('the card shows the kind only when it is not Written', async ({ page }) => {
  await openAssignments(page);
  const ids = await page.evaluate(() => {
    const list = getAssessments('sci8');
    const lab = list.find(y => y.evidenceType === 'lab');
    const other = list.find(y => y.id !== lab.id);
    saveAssessments(
      'sci8',
      list.map(y => (y.id === other.id ? { ...y, evidenceType: 'written' } : y)),
    );
    return { lab: lab.id, written: other.id };
  });
  await page.evaluate(() => window.Router.navigate('/dashboard'));
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await expect(page.locator(`#ac-${ids.lab} .assess-meta .evidence-badge`)).toHaveText('Lab');
  await expect(page.locator(`#ac-${ids.written} .assess-meta .evidence-badge`)).toHaveCount(0);
});
