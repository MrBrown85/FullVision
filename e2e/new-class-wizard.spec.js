import { test, expect } from '@playwright/test';

/* The New Class wizard, Demo Mode. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openWizard(page) {
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.locator('[data-action="cmStartCreate"]').first().click();
  await expect(page.locator('.cw-grade-btn').first()).toBeVisible();
}

test('Choose Courses: a keyboard user Tabs to a course and ticks it with Space', async ({ page }) => {
  await enterDemo(page);
  await openWizard(page);
  await page.locator('.cw-grade-btn', { hasText: 'Grade 9' }).click();
  const subject = page.locator('.cw-subject-btn', { hasText: 'Science' }).first();
  await subject.click();
  await subject.focus();
  // Tab on from the subject chips until a course row has the focus.
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

async function toReview(page, grade, subject) {
  await page.locator('.cw-grade-btn', { hasText: 'Grade ' + grade }).click();
  await page.locator('.cw-subject-btn', { hasText: subject }).first().click();
  await page.locator('.cw-course-item').first().click();
  await page.locator('[data-action="cwGoToStep2"]').click();
  await page.locator('[data-action="cwCompsNext"]').click();
  await page.locator('[data-action="cwGoToStep3"]').click();
  await expect(page.locator('.cm-section-title', { hasText: 'Review' })).toBeVisible();
}

test('Review names the reporting terms and, for a Letter class, the Counts As preset', async ({ page }) => {
  await enterDemo(page);
  await openWizard(page);
  await toReview(page, 11, 'Social Studies');
  const review = page.locator('.cm-section', { has: page.locator('.cm-section-title', { hasText: 'Review' }) });
  await expect(review).toContainText('Reporting Terms');
  await expect(review).toContainText('Grandview Heights Secondary');
  await expect(review).toContainText('Term 1 Sep 8 – Nov 27');
  await expect(review).toContainText('Change the school or the dates later in Reporting Terms');
  await expect(review).toContainText('Counts As');
  await expect(review).toContainText('BC Letter Bands');
});

test('Review leaves out Counts As for a grade 9 Proficiency class', async ({ page }) => {
  await enterDemo(page);
  await openWizard(page);
  await toReview(page, 9, 'Science');
  const review = page.locator('.cm-section', { has: page.locator('.cm-section-title', { hasText: 'Review' }) });
  await expect(review).toContainText('Reporting Terms');
  await expect(review).not.toContainText('BC Letter Bands');
});

test('A long step keeps Next in view, every step has Cancel, and each step opens at its top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await openWizard(page);
  await page.locator('.cw-grade-btn', { hasText: 'Grade 9' }).click();
  await page.locator('.cw-subject-btn', { hasText: 'Science' }).first().click();
  await page.locator('.cw-course-item').first().click();
  await page.locator('[data-action="cwGoToStep2"]').click();
  // Choose Competencies is far taller than the window.
  expect(await page.evaluate(() => document.querySelector('.cm-detail').scrollHeight)).toBeGreaterThan(1800);
  await expect(page.locator('[data-action="cwCompsNext"]')).toBeInViewport();
  await expect(page.locator('.cw-footer [data-action="cmCancelCreate"]')).toBeVisible();
  await page.evaluate(() => (document.querySelector('.cm-detail').scrollTop = 99999));
  await page.locator('[data-action="cwCompsNext"]').click();
  await expect(page.locator('#cm-new-name')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('.cm-detail').scrollTop)).toBe(0);
  await expect(page.locator('.cw-steps')).toBeInViewport();
  await expect(page.locator('.cw-footer [data-action="cmCancelCreate"]')).toBeVisible();
  await page.locator('[data-action="cwGoToStep3"]').click();
  await expect(page.locator('.cw-footer [data-action="cmCancelCreate"]')).toBeVisible();
  await page.locator('.cw-footer [data-action="cmCancelCreate"]').click();
  await expect(page.locator('.cw-steps')).toHaveCount(0);
});

test('Class Details: the Letter description is plain and names IE', async ({ page }) => {
  await enterDemo(page);
  await openWizard(page);
  await page.locator('.cw-grade-btn', { hasText: 'Grade 11' }).click();
  await page.locator('.cw-subject-btn', { hasText: 'Social Studies' }).first().click();
  await page.locator('.cw-course-item').first().click();
  await page.locator('[data-action="cwGoToStep2"]').click();
  await page.locator('[data-action="cwCompsNext"]').click();
  await page.locator('#cm-cg-grading [data-val="letter"]').click();
  const desc = page.locator('#cm-cg-grading-desc');
  await expect(desc).toHaveText(
    'A letter grade and % on the BC scale: A, B, C+, C and C–. Under 50% shows IE (Insufficient Evidence) until the course ends, then F.',
  );
});
