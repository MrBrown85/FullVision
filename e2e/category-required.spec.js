import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  gotoApp,
  TEST_COURSE,
  TEST_ASSESSMENT,
} from './helpers.js';

// A category on every assessment (docs/DECISIONS.md, 2026-11-01): in a
// class with categories, scored work can't be saved without one, as in
// Teams, and the form picks nothing for the teacher. Work saved before the
// rule shows "Needs a Category" on its card, its gradebook header and in
// the grader. A class with no categories is unchanged.
const CATEGORIES = [
  { id: 'k-tests', name: 'Tests', weight: 60, displayOrder: 0 },
  { id: 'k-hw', name: 'Homework', weight: 40, displayOrder: 1 },
];
const HINT = 'This class has categories, so each assignment needs one to count toward the grade.';

async function seedCategories(page, categories) {
  await page.addInitScript(
    data => {
      localStorage.setItem('gb-categories-' + data.cid, JSON.stringify(data.categories));
    },
    { cid: TEST_COURSE.id, categories },
  );
}

async function openNewForm(page) {
  await page.locator('[data-action="showNewForm"]').first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

const savedAssessments = page =>
  page.evaluate(
    cid => getAssessments(cid).map(a => ({ title: a.title, categoryId: a.categoryId || null })),
    TEST_COURSE.id,
  );

test.describe('A category on every assessment', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('a new assessment waits for the teacher to choose a category', async ({ page }) => {
    await seedCategories(page, CATEGORIES);
    await gotoApp(page, '/assignments');
    await openNewForm(page);

    const category = page.locator('#af-category');
    const hint = page.locator('#af-category-hint');
    await expect(category).toHaveValue('');
    await expect(category.locator('option').first()).toHaveText('Choose a Category');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(HINT);

    await page.locator('#af-title').fill('Chapter 3 Quiz');
    await page.locator('[data-action="saveNewAssess"]').click();
    // Not saved: the form stays open on the Category field.
    await expect(page.locator('#af-title')).toBeVisible();
    await expect(category).toHaveAttribute('aria-invalid', 'true');
    await expect(category).toBeFocused();
    expect(await savedAssessments(page)).toEqual([]);

    await category.selectOption('k-hw');
    await expect(hint).toBeHidden();
    await expect(category).not.toHaveAttribute('aria-invalid', 'true');
    await page.locator('[data-action="saveNewAssess"]').click();
    await expect(page.locator('#af-title')).toBeHidden();
    expect(await savedAssessments(page)).toEqual([{ title: 'Chapter 3 Quiz', categoryId: 'k-hw' }]);
    await expect(page.locator('.assess-card .type-badge').first()).toHaveText('Homework');
  });

  test('DIBELS work needs no category', async ({ page }) => {
    await seedCategories(page, CATEGORIES);
    // DIBELS is offered only in ELA and Social Studies 8 classes.
    await page.addInitScript(cid => {
      const courses = JSON.parse(localStorage.getItem('gb-courses'));
      courses[cid].curriculumTags = ['ELA8', 'SS8'];
      localStorage.setItem('gb-courses', JSON.stringify(courses));
    }, TEST_COURSE.id);
    await gotoApp(page, '/assignments');
    await openNewForm(page);
    await page.locator('[data-action="setScoreMode"][data-mode="dibels"]').click();
    await expect(page.locator('#af-category-hint')).toBeHidden();
    await page.locator('#af-title').fill('Fall DIBELS');
    await page.locator('[data-action="saveNewAssess"]').click();
    await expect(page.locator('#af-title')).toBeHidden();
    expect(await savedAssessments(page)).toEqual([{ title: 'Fall DIBELS', categoryId: null }]);
  });

  test('work with no category is marked and the edit form picks nothing for it', async ({ page }) => {
    await seedCategories(page, CATEGORIES);
    await seedAssessments(page, [{ ...TEST_ASSESSMENT, categoryId: undefined, category_id: undefined }]);
    await gotoApp(page, '/assignments');

    const chip = page.locator('#ac-assess-001 .type-badge');
    await expect(chip).toHaveText('Needs a Category');
    await expect(chip).toHaveClass(/type-badge-needs/);

    // A closed card shows its buttons on hover.
    await page.locator('#ac-assess-001 .assess-header').hover();
    await page.locator('#ac-assess-001 [data-action="editAssess"]').click();
    const category = page.locator('#af-category');
    await expect(category).toHaveValue('');
    await expect(page.locator('#af-category-hint')).toBeVisible();
    await page.locator('[data-action="saveEditAssess"]').click();
    await expect(category).toHaveAttribute('aria-invalid', 'true');
    expect((await savedAssessments(page))[0].categoryId).toBe(null);

    await category.selectOption('k-tests');
    await page.locator('[data-action="saveEditAssess"]').click();
    await expect(page.locator('#af-title')).toBeHidden();
    expect((await savedAssessments(page))[0].categoryId).toBe('k-tests');
    await expect(chip).toHaveText('Tests');
  });

  test('the gradebook header and the grader mark work with no category', async ({ page }) => {
    await seedCategories(page, CATEGORIES);
    await seedAssessments(page, [{ ...TEST_ASSESSMENT, categoryId: undefined, category_id: undefined }]);
    await gotoApp(page, '/gradebook');

    await expect(page.locator('.gb-grid-colhead[data-aid="assess-001"] .gb-needs-category')).toHaveText(
      'Needs a Category',
    );
    await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').click();
    const mark = page.locator('#grader-overlay .grader-needs-category');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveText('Needs a Category');
  });

  test('categorized work is not marked', async ({ page }) => {
    await seedCategories(page, CATEGORIES);
    await seedAssessments(page, [{ ...TEST_ASSESSMENT, categoryId: 'k-tests' }]);
    await gotoApp(page, '/gradebook');
    await expect(page.locator('.gb-grid-colhead[data-aid="assess-001"]')).toBeVisible();
    await expect(page.locator('.gb-needs-category')).toHaveCount(0);
    await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]').click();
    await expect(page.locator('#grader-overlay .grader-dialog')).toBeVisible();
    await expect(page.locator('#grader-overlay .grader-needs-category')).toBeHidden();
  });

  test('a class with no categories saves work with none, as before', async ({ page }) => {
    await seedCategories(page, []);
    await gotoApp(page, '/assignments');
    await openNewForm(page);
    await expect(page.locator('#af-category option')).toHaveText(['No Category']);
    await expect(page.locator('#af-category-hint')).toHaveCount(0);
    await page.locator('#af-title').fill('Exit Ticket');
    await page.locator('[data-action="saveNewAssess"]').click();
    await expect(page.locator('#af-title')).toBeHidden();
    expect(await savedAssessments(page)).toEqual([{ title: 'Exit Ticket', categoryId: null }]);
    await expect(page.locator('.type-badge-needs')).toHaveCount(0);
  });
});

// Sweep Nov 3: once categories were saved, the row offering to move work
// with no category took Save Categories' place with the first category
// already chosen, so a second click on Save moved older work into it
// without a word. Demo Mode, Science 8, with its categories cleared.
test('adding categories leaves older work with no category until the teacher picks one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    saveCategories('sci8', []);
    saveAssessments(
      'sci8',
      getAssessments('sci8').map(a => {
        const b = { ...a };
        delete b.categoryId;
        delete b.category_id;
        return b;
      }),
    );
  });
  await page.locator('button', { hasText: 'Class Management' }).first().click();
  await page
    .locator('button', { hasText: /^Grading/ })
    .first()
    .click();
  for (const [name, weight] of [
    ['Assignments', 50],
    ['Quizzes', 30],
    ['Projects', 20],
  ]) {
    await page.locator('[data-action="cmCatAdd"]').click();
    await page.locator('.cm-cat-name').last().fill(name);
    await page.locator('.cm-cat-weight').last().fill(String(weight));
  }
  const save = page.locator('[data-action="cmCatSave"]');
  const at = await save.boundingBox();
  await save.click();
  const target = page.locator('#cm-cat-uncat-target');
  await expect(target).toHaveValue('');
  await expect(target.locator('option').first()).toHaveText('Choose a Category');

  const uncategorized = () => page.evaluate(() => getAssessments('sci8').filter(a => !a.categoryId).length);
  const before = await uncategorized();
  expect(before).toBeGreaterThan(0);
  // A second click where Save was lands on Move, which now waits for a choice.
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  expect(await uncategorized()).toBe(before);
  await expect(target).toBeFocused();

  await target.selectOption({ label: 'Quizzes' });
  await page.locator('[data-action="cmCatAssignUncategorized"]').click();
  expect(await uncategorized()).toBe(0);
});
