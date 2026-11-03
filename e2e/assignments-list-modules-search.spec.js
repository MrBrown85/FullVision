import { test, expect } from '@playwright/test';

// Modules, search and empty states on the Assignments list: a closed module
// stays closed, a search shows its matches inside closed modules, an empty
// list says so first, and the Filter button doesn't move the search box.

async function openDemo(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // Unit 1 holds the quizzes; the rest stay ungrouped.
  await page.evaluate(() => {
    saveModules('sci8', [
      { id: 'modA', name: 'Unit 1', color: '#3b82f6', sortOrder: 0, created: new Date().toISOString() },
    ]);
    const list = getAssessments('sci8');
    list.forEach(a => {
      if (/Quiz/.test(a.title)) a.moduleId = 'modA';
    });
    saveAssessments('sci8', list);
  });
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.waitForSelector('.assess-card');
}

const unit1 = page => page.locator('.mod-folder[data-module-id="modA"]');
const header = page => unit1(page).locator('.mod-folder-header');

test('a closed module holding an open card stays closed on the next redraw', async ({ page }) => {
  await openDemo(page);
  await expect(unit1(page)).toHaveClass(/\bopen\b/);
  const quiz = unit1(page).locator('.assess-card').first();
  await quiz.locator('.assess-title').click();
  await expect(quiz).toHaveClass(/open/);

  await header(page).click({ position: { x: 700, y: 15 } });
  await expect(unit1(page)).not.toHaveClass(/\bopen\b/);
  // Open a card elsewhere: the list redraws.
  const other = page.locator('.mod-folder.no-module .assess-card').first();
  await other.locator('.assess-title').click();
  await expect(other).toHaveClass(/open/);
  await expect(unit1(page)).not.toHaveClass(/\bopen\b/);

  // Opened again, the module shows its card closed.
  await header(page).click({ position: { x: 700, y: 15 } });
  await expect(unit1(page)).toHaveClass(/\bopen\b/);
  await expect(unit1(page).locator('.assess-card.open')).toHaveCount(0);
});

test('a search shows matches inside a closed module and keeps it closed after', async ({ page }) => {
  await openDemo(page);
  await header(page).click({ position: { x: 700, y: 15 } });
  await expect(unit1(page)).not.toHaveClass(/\bopen\b/);

  await page.fill('.assess-search-input', 'quiz');
  await expect(unit1(page)).toHaveClass(/\bopen\b/);
  const cards = unit1(page).locator('.assess-card');
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(cards.first()).toBeVisible();
  // No Add Module while searching.
  await expect(page.locator('.add-module-btn')).toHaveCount(0);

  await page.fill('.assess-search-input', '');
  await expect(unit1(page)).not.toHaveClass(/\bopen\b/);
  await expect(page.locator('.add-module-btn')).toHaveCount(1);
});

test('no matches: the message comes first and Add Module is gone', async ({ page }) => {
  await openDemo(page);
  await page.fill('.assess-search-input', 'zzzz no such work');
  const empty = page.locator('.assess-list-empty');
  await expect(empty).toContainText('No matching assessments.');
  await expect(page.locator('.add-module-btn')).toHaveCount(0);
  await expect(page.locator('.mod-folder')).toHaveCount(0);
});

test('an empty class says assessments and offers + New Assessment above Add Module', async ({ page }) => {
  await openDemo(page);
  await page.evaluate(() => {
    saveModules('sci8', []);
    saveAssessments('sci8', []);
    window.Router.navigate('/gradebook?course=sci8');
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  const empty = page.locator('.assess-list-empty');
  await expect(empty.locator('.empty-state-title')).toHaveText('No assessments yet');
  await expect(empty.locator('.empty-state-text')).toHaveText('Create your first assessment to start grading.');
  const create = empty.getByRole('button', { name: '+ New Assessment' });
  await expect(create).toBeVisible();
  const order = await page.evaluate(() => {
    const e = document.querySelector('.assess-list-empty').getBoundingClientRect();
    const add = document.querySelector('.add-module-btn').getBoundingClientRect();
    return e.bottom <= add.top;
  });
  expect(order).toBe(true);
  await create.click();
  await expect(page.locator('#new-assess-form')).toBeVisible();
});

test('turning a filter on keeps the search box where it is', async ({ page }) => {
  await openDemo(page);
  const search = page.locator('.assess-search-input');
  const left = () => search.evaluate(el => Math.round(el.getBoundingClientRect().left));
  const before = await left();
  await page.locator('.assess-filter-btn').click();
  await page.locator('.assess-filter-menu [data-action="toggleUngraded"]').click();
  await expect(page.locator('.assess-filter-btn')).toHaveText('Filter · 1');
  expect(await left()).toBe(before);
  await page.locator('.assess-filter-menu [data-catid]').first().click();
  await expect(page.locator('.assess-filter-btn')).toHaveText('Filter · 2');
  expect(await left()).toBe(before);
});
