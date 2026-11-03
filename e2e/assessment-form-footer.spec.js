import { test, expect } from '@playwright/test';

/* The assessment form's footer (redesign PR 3, 2026-11-02): it stays at the
   bottom of the window while the form is in view, says what the work counts
   toward, and Ctrl/⌘+Enter creates. Demo Mode, Science 8. */
test.use({ viewport: { width: 1366, height: 640 } });

// These tests use the Codes chips; List is the default since Nov 2.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fv-assess-comp-view', 'codes'));
});

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('Create Assessment stays in view at the top of a long form', async ({ page }) => {
  await openForm(page);
  const create = page.locator('[data-action="saveNewAssess"]');
  await expect(create).toBeInViewport();
});

test('the footer says what the work counts toward, as the form changes', async ({ page }) => {
  await openForm(page);
  const line = page.locator('#af-counts-toward');
  await expect(line).toHaveText('Needs a category to count toward the grade.');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await expect(line).toContainText('No competency is chosen, so it counts toward no proficiency.');
  await page.locator('.af-code[data-tag=\"QP3\"]').click();
  await page.locator('.af-code[data-tag=\"PA4\"]').click();
  const term = await page.evaluate(() => {
    const d = document.getElementById('af-date-assigned').value;
    const t = getReportingTerms('sci8').find(x => d >= x.starts_on && d <= x.ends_on);
    return t ? t.label : 'In no reporting term';
  });
  await expect(line).toHaveText('Counts toward Labs & Investigations (40%) · QP3, PA4 · ' + term);
});

test('DIBELS counts toward no grade', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    COURSES.sci8.curriculumTags = ['SCI8', 'ELA8'];
    saveCourses(COURSES);
    window.Router.navigate('/assignments?course=sci8');
  });
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.locator('.af-scoremode-btn[data-mode="dibels"]').click();
  await expect(page.locator('#af-counts-toward')).toHaveText('Counts toward no grade.');
});

test('Ctrl/⌘+Enter creates the assessment', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Made From the Keyboard');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('#af-title').focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect
    .poll(() => page.evaluate(() => getAssessments('sci8').some(a => a.title === 'Made From the Keyboard')))
    .toBe(true);
});
