import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The Assignments toolbar: category filters and Ungraded Only sit in the
// Filter menu, whose button is inside the search box; each filter that is on
// has a chip in the bar with an × that removes it.
const CATEGORIES = [
  { id: 'cat-labs', name: 'Labs', weight: 50, displayOrder: 0 },
  { id: 'cat-quiz', name: 'Quizzes', weight: 50, displayOrder: 1 },
];
function assessment(id, title, categoryId) {
  return {
    id,
    title,
    date: '2026-03-21',
    type: 'summative',
    tagIds: ['QAP'],
    categoryId,
    rubricId: '',
    scoreMode: '',
    maxPoints: 0,
    weight: 1,
    collaboration: 'individual',
    created: new Date('2026-03-21').toISOString(),
  };
}

test('the Filter menu filters by category and clears', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ categories, list, cid }) => {
      localStorage.setItem('gb-categories-' + cid, JSON.stringify(categories));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(list));
    },
    {
      categories: CATEGORIES,
      list: [assessment('a-lab', 'Density Lab', 'cat-labs'), assessment('a-quiz', 'Unit Quiz', 'cat-quiz')],
      cid: TEST_COURSE.id,
    },
  );
  await gotoApp(page, '/assignments');

  const toolbar = page.locator('.assess-toolbar');
  const button = toolbar.locator('.atb-filter-btn');
  await expect(button).toHaveAccessibleName('Filter');
  await expect(button).toHaveAttribute('title', 'Filter');
  await expect(button).not.toHaveClass(/has-filters/);
  await expect(toolbar.locator('.atb-chip')).toHaveCount(0);
  await expect(page.locator('.assess-card')).toHaveCount(2);

  await button.click();
  const menu = toolbar.locator('.assess-filter-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.assess-filter-item')).toHaveText(['Labs', 'Quizzes', 'Ungraded Only', 'Clear Filters']);

  await menu.locator('[data-catid="cat-labs"]').click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-catid="cat-labs"]')).toHaveAttribute('aria-checked', 'true');
  await expect(button).toHaveClass(/has-filters/);
  await expect(toolbar.locator('.atb-chip')).toHaveText(['Labs']);
  await expect(page.locator('.assess-card')).toHaveCount(1);
  await expect(page.locator('.assess-card')).toContainText('Density Lab');

  // Escape closes the menu and gives the focus back to the Filter button.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // A chip's × removes its filter, and the focus goes to the Filter button.
  await toolbar.locator('.atb-chip').click();
  await expect(toolbar.locator('.atb-chip')).toHaveCount(0);
  await expect(page.locator('.assess-card')).toHaveCount(2);
  await expect(button).not.toHaveClass(/has-filters/);
  await expect(button).toBeFocused();

  await button.click();
  await menu.locator('[data-catid="cat-quiz"]').click();
  await expect(toolbar.locator('.atb-chip')).toHaveText(['Quizzes']);

  await menu.locator('[data-action="clearFilterMenu"]').click();
  await expect(toolbar.locator('.atb-chip')).toHaveCount(0);
  await expect(page.locator('.assess-card')).toHaveCount(2);

  await page.locator('.assess-card').first().locator('.assess-header').click();
  await expect(menu).toBeHidden();
});
