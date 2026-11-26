import { test, expect } from '@playwright/test';

/* The New Class wizard in two steps (Colin, 2026-11-25), Demo Mode:
   Choose Courses lists every course of the grade beside Your Class, and
   Name Your Class keeps what Create Class sets under Already Set for You. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openWizard(page) {
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.locator('[data-action="cmStartCreate"]').first().click();
  await expect(page.getByRole('radio', { name: 'Grade 9' })).toBeVisible();
}

const course = (page, name) => page.getByRole('checkbox', { name: new RegExp('^' + name + '\\b') });

async function toNameYourClass(page, grade, name) {
  await page.getByRole('radio', { name: 'Grade ' + grade }).click();
  await course(page, name).click();
  await page.locator('[data-action="cwGoToStep2"]').click();
  await expect(page.locator('#cm-new-name')).toBeVisible();
}

test('Choose Courses: a keyboard user Tabs to a course and ticks it with Space', async ({ page }) => {
  await enterDemo(page);
  await openWizard(page);
  const grade = page.getByRole('radio', { name: 'Grade 9' });
  await grade.click();
  await page.getByRole('radio', { name: 'Grade 9' }).focus();
  // Tab on from the grades until a course row has the focus.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement.classList.contains('cw-course-item'))) break;
  }
  const row = page.locator('.cw-course-item').first();
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute('role', 'checkbox');
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Space');
  await expect(page.locator('.cw-course-item').first()).toBeFocused();
  await expect(page.locator('.cw-course-item').first()).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-action="cwGoToStep2"]')).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cw-course-item').first()).toHaveAttribute('aria-checked', 'false');
});

test('Choose Courses: every course of the grade in one list, a find box for a long grade, Your Class beside it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await openWizard(page);
  const rail = page.getByRole('complementary', { name: 'Your Class' });
  await expect(rail).toContainText('Tick a course and it shows here.');
  await page.getByRole('radio', { name: 'Grade 8' }).click();
  await expect(page.getByLabel('Find a course')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /^Humanities 8/ }).click();
  await expect(course(page, 'English Language Arts 8')).toHaveAttribute('aria-checked', 'true');
  await expect(course(page, 'Social Studies 8')).toHaveAttribute('aria-checked', 'true');
  await expect(rail).toContainText('Humanities 8');
  await expect(rail).toContainText('English Language Arts 8 and Social Studies 8 each make up half of the overall.');
  await rail.getByRole('button', { name: 'Take Out Social Studies 8' }).click();
  await expect(course(page, 'Social Studies 8')).toHaveAttribute('aria-checked', 'false');
  await expect(rail.locator('#cw-rail-name')).toHaveText('English Language Arts 8');
  // Grade 12 holds 96 courses: a heading a subject, and a find box.
  await page.getByRole('radio', { name: 'Grade 12' }).click();
  await expect(page.getByRole('group', { name: 'Social Studies' })).toBeVisible();
  await page.getByLabel('Find a course').fill('philo');
  await expect(page.locator('.cw-course-item:visible')).toHaveCount(1);
  await course(page, 'Philosophy 12').click();
  // Ticking keeps what was typed and what it found.
  await expect(page.getByLabel('Find a course')).toHaveValue('philo');
  await expect(page.locator('.cw-course-item:visible')).toHaveCount(1);
  await page.getByLabel('Find a course').fill('zzz');
  await expect(page.getByText('No course by that name in this grade.')).toBeVisible();
  // Ticking never moves Next.
  const next = page.locator('[data-action="cwGoToStep2"]');
  const at = await next.evaluate(el => el.getBoundingClientRect().toJSON());
  await page.getByLabel('Find a course').fill('');
  await course(page, 'Comparative Cultures 12').click();
  expect(await next.evaluate(el => el.getBoundingClientRect().toJSON())).toEqual(at);
});

test('Name Your Class: the Letter description, Reporting Terms and Counts As for a Grade 11 class', async ({
  page,
}) => {
  await enterDemo(page);
  await openWizard(page);
  await toNameYourClass(page, 11, 'Explorations in Social Studies 11');
  await expect(page.locator('#cm-cg-grading [aria-checked="true"]')).toHaveText('Letter');
  await expect(page.locator('#cm-cg-grading-desc')).toHaveText(
    'A letter grade and % on the BC scale: A, B, C+, C and C–. Under 50% shows IE (Insufficient Evidence) until the course ends, then F.',
  );
  await expect(page.locator('.cw-set-row', { hasText: 'Reporting Terms' })).toContainText(
    'Grandview Heights Secondary, 4 terms',
  );
  await page.getByRole('button', { name: 'Show Reporting Terms' }).click();
  await expect(page.locator('.cw-set-panel')).toContainText('Term 1 Sep 8 – Nov 27');
  await expect(page.locator('.cw-set-panel')).toContainText('Change them in Reporting Terms once the class is made.');
  await expect(page.locator('.cw-set-row', { hasText: 'Counts As' })).toContainText('BC Letter Bands');
});

test('Name Your Class leaves out Counts As for a Grade 9 Proficiency class', async ({ page }) => {
  await enterDemo(page);
  await openWizard(page);
  await toNameYourClass(page, 9, 'Science 9');
  await expect(page.locator('#cm-cg-grading [aria-checked="true"]')).toHaveText('Proficiency');
  await expect(page.locator('.cw-set-row', { hasText: 'Reporting Terms' })).toBeVisible();
  await expect(page.getByText('BC Letter Bands')).toHaveCount(0);
});

test('Change opens a setting in place and keeps what was typed; each step opens at its top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await openWizard(page);
  await toNameYourClass(page, 9, 'Science 9');
  await page.locator('#cm-new-name').fill('Science 9 Block C');
  await page.locator('#cm-new-block [data-val="C"]').click();
  await expect(page.locator('#cw-rail-sub')).toHaveText('Grade 9 · Block C · Full Year');
  await page.getByRole('button', { name: 'Change Competencies' }).click();
  // The competencies are far taller than the window; Create Class stays in view.
  expect(await page.evaluate(() => document.querySelector('.cm-detail').scrollHeight)).toBeGreaterThan(1800);
  await expect(page.locator('[data-action="cwFinishCreate"]')).toBeInViewport();
  await expect(page.locator('#cm-new-name')).toHaveValue('Science 9 Block C');
  await expect(page.locator('#cm-new-block [data-val="C"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.cw-cc-check').first().uncheck();
  await expect(page.locator('.cw-set-row', { hasText: 'Competencies' }).locator('.cw-set-value')).toHaveText(
    /^\d+ of \d+ from the BC curriculum$/,
  );
  await page.getByRole('button', { name: 'Done With Competencies' }).click();
  await page.getByRole('button', { name: 'Change Calculation' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Calculation Method' })).toBeVisible();
  await page.evaluate(() => (document.querySelector('.cm-detail').scrollTop = 99999));
  await page.locator('[data-action="cwGoBack"]').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('.cm-detail').scrollTop)).toBe(0);
  await expect(page.locator('#cw-rail-name')).toHaveText('Science 9 Block C');
  await expect(page.locator('.cw-footer [data-action="cmCancelCreate"]')).toBeVisible();
  await page.locator('.cw-footer [data-action="cmCancelCreate"]').click();
  await expect(page.locator('.cw-steps')).toHaveCount(0);
});

test('Screen readers hear each wizard field by its label, and which Grade is chosen', async ({ page }) => {
  await enterDemo(page);
  await openWizard(page);
  const grade = page.getByRole('radio', { name: 'Grade 9' });
  await expect(grade).toHaveAttribute('aria-checked', 'false');
  await grade.click();
  await expect(page.getByRole('radio', { name: 'Grade 9' })).toHaveAttribute('aria-checked', 'true');
  await toNameYourClass(page, 9, 'Science 9');
  await expect(page.getByRole('textbox', { name: 'Class Name' })).toHaveAttribute('id', 'cm-new-name');
  await expect(page.getByRole('radiogroup', { name: 'Grades Show As' })).toHaveAttribute('id', 'cm-cg-grading');
  await expect(page.getByRole('radiogroup', { name: 'This Class Runs' })).toHaveAttribute('id', 'cm-cg-span');
  await expect(page.getByRole('radiogroup', { name: 'Block' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Description' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change Calculation' })).toHaveAttribute('aria-expanded', 'false');
});
