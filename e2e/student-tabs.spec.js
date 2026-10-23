/**
 * The student page's five tabs: each shows its count for the term, the
 * keyboard moves between them, and each panel keeps the page's tools
 * (evidence drawer, override, goals). Demo Mode, Cece in Science 8.
 */
import { test, expect } from '@playwright/test';

async function openCece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.goto(page.url().replace(/#.*/, '#/student?id=' + sid));
  await page.locator('.stu-tabs').waitFor();
  return sid;
}

test('five tabs, Competencies first, and the arrow keys move between them', async ({ page }) => {
  await openCece(page);
  const tabs = page.getByRole('tab', {
    name: /Competencies|Assessments|Evidence|Goals and Reflections|Learner Profile/,
  });
  await expect(page.locator('.stu-tab .stu-tab-label')).toHaveText([
    'Competencies',
    'Assessments',
    'Evidence',
    'Goals and Reflections',
    'Learner Profile',
  ]);
  await expect(page.locator('#stu-tab-comps')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#stu-tab-comps .stu-tab-stat')).toHaveText('6 of 6 Proficient');
  await expect(tabs).toHaveCount(5);
  await page.locator('#stu-tab-comps').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#stu-tab-assess')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#stu-tab-assess')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#stu-tab-profile')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.stu-profile-group h3')).toHaveText(['Learning Dispositions', 'Relational and Identity']);
});

test('a competency row opens its evidence and the override', async ({ page }) => {
  await openCece(page);
  const comp = page.locator('.stu-comp').first();
  await expect(comp.locator('.stu-comp-override')).toBeHidden();
  await comp.locator('.stu-comp-row').click();
  await expect(comp.locator('.ced')).toBeVisible();
  await comp.getByRole('button', { name: 'Override Proficiency' }).click();
  await expect(comp.locator('.override-panel')).toBeVisible();
});

test('a goal saves from the Goals and Reflections tab', async ({ page }) => {
  const sid = await openCece(page);
  await page.locator('#stu-tab-goals').click();
  const card = page.locator('.stu-goal-card').first();
  await card.getByRole('button', { name: '+ Goal' }).click();
  await card.locator('textarea').first().fill('Write a testable question before each lab');
  await card.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.locator('.stu-goal-card').first()).toContainText('Write a testable question before each lab');
  await expect(page.locator('#stu-tab-goals .stu-tab-stat')).toHaveText('1 of 6 Set');
  const saved = await page.evaluate(id => Object.values(getGoals(getActiveCourse())[id] || {}), sid);
  expect(saved).toContain('Write a testable question before each lab');
});

test('the tab counts follow the reporting term', async ({ page }) => {
  await openCece(page);
  const stat = page.locator('#stu-tab-assess .stu-tab-stat');
  const allTime = await stat.textContent();
  const select = page.locator('select.term-select');
  const terms = await select.locator('option').evaluateAll(os => os.map(o => o.value).filter(v => v !== 'all'));
  test.skip(!terms.length, 'Demo class has no reporting terms');
  await select.selectOption(terms[0]);
  await expect(stat).not.toHaveText(allTime);
  await expect(page.locator('#stu-tab-assess .stu-tab-sub')).not.toContainText('All time');
});

test('a Letter class shows percents, not proficiency words', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  const sid = await page.evaluate(() => {
    const cid = getActiveCourse();
    COURSES[cid].gradingSystem = 'letter';
    clearProfCache();
    return getStudents(cid).find(s => s.firstName === 'Cece').id;
  });
  await page.goto(page.url().replace(/#.*/, '#/student?id=' + sid));
  await page.locator('.stu-tabs').waitFor();
  await expect(page.locator('#stu-tab-comps .stu-tab-stat')).toHaveText('6 of 6 Scored');
  await expect(page.locator('.stu-comp-level .stu-level').first()).toHaveText(/^\d+%$/);
});
