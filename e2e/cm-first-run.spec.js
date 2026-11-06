import { test, expect } from '@playwright/test';
import { mockAuth, gotoApp } from './helpers.js';

/* A teacher's first run of Class Settings: the zero-class screen, the New
   Class wizard's Next button, a required Class Name, and landing on Students
   after Create Class. */

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

test('A signed-in teacher with no classes can create one or open Demo Mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuth(page);
  // An account with no classes. Without this key the static build falls back
  // to a built-in Science 8 class (data.js loadCourses).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-no-classes')) {
      sessionStorage.setItem('e2e-no-classes', '1');
      localStorage.setItem('gb-courses', '{}');
    }
  });
  await gotoApp(page, '/dashboard');
  const empty = page.locator('.cm-first-run');
  await expect(empty.getByRole('heading', { name: 'No classes yet' })).toBeVisible();
  const cards = empty.locator('.cm-empty-card');
  await expect(cards).toHaveCount(2);
  const [a, b] = await cards.evaluateAll(els => els.map(e => e.getBoundingClientRect().toJSON()));
  expect(a.width).toBe(360);
  expect(b.width).toBe(360);
  expect(b.left - a.right).toBe(12);
  expect(a.top).toBe(b.top);
  await expect(empty.getByRole('link', { name: 'Getting Started Guide' })).toHaveAttribute(
    'href',
    '/help/create-a-class',
  );
  // Open Demo Mode asks first; Cancel leaves the teacher where they were.
  await empty.getByRole('button', { name: 'Open Demo Mode' }).click();
  await expect(page.locator('.confirm-card')).toContainText('Classes saved to your account are not changed.');
  await page.locator('#confirm-cancel-btn').click();
  await expect(page).toHaveURL(/\/dashboard/);
  await empty.getByRole('button', { name: 'Create a Class' }).click();
  await expect(page.locator('.cw-grade-btn').first()).toBeVisible();
});

test('Open Demo Mode, confirmed, takes a signed-in teacher into Demo Mode', async ({ page }) => {
  await mockAuth(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-no-classes')) {
      sessionStorage.setItem('e2e-no-classes', '1');
      localStorage.setItem('gb-courses', '{}');
    }
  });
  await gotoApp(page, '/dashboard');
  await page.locator('.cm-first-run').getByRole('button', { name: 'Open Demo Mode' }).click();
  const toDemo = page.waitForRequest(req => /\/login\.html\?demo=1$/.test(req.url()));
  await page.locator('#confirm-ok-btn').click();
  await toDemo;
  // mockAuth's init script blocks the sample-class seed on every page, so
  // this checks the hand-off: Demo Mode is on, the teacher back on the app.
  await page.waitForFunction(() => location.pathname === '/dashboard' && isDemoMode());
});

test('Choose Courses: ticking a course never moves Next', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await openWizard(page);
  const next = page.locator('[data-action="cwGoToStep2"]');
  const rect = () => next.evaluate(el => el.getBoundingClientRect().toJSON());
  const start = await rect();
  await page.locator('.cw-grade-btn', { hasText: 'Grade 9' }).click();
  expect(await rect()).toEqual(start);
  await page.locator('.cw-subject-btn', { hasText: 'Science' }).first().click();
  const shown = await rect();
  await page.locator('.cw-course-item').first().click();
  await expect(page.locator('.cw-selection-summary')).toBeVisible();
  await expect(next).toBeEnabled();
  expect(await rect()).toEqual(shown);
  expect(shown).toEqual(start);
  // The custom-class bar stays above the footer, clear of Next.
  const custom = await page.locator('.cw-custom-btn').evaluate(el => el.getBoundingClientRect().toJSON());
  expect(custom.bottom).toBeLessThanOrEqual(shown.top);
});

test('Class Details: Next waits for a Class Name, and Create Class opens the Students tab', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await enterDemo(page);
  await openWizard(page);
  await page.locator('.cw-grade-btn', { hasText: 'Grade 9' }).click();
  await page.locator('.cw-subject-btn', { hasText: 'Science' }).first().click();
  await page.locator('.cw-course-item').first().click();
  await page.locator('[data-action="cwGoToStep2"]').click();
  await page.locator('[data-action="cwCompsNext"]').click();
  const name = page.locator('#cm-new-name');
  const next = page.locator('[data-action="cwGoToStep3"]');
  await expect(next).toBeEnabled();
  await name.fill('');
  await expect(next).toBeDisabled();
  await expect(page.locator('#cm-new-name-hint')).toHaveText('Enter a Class Name to continue.');
  await name.fill('Science 9 Block C');
  await expect(next).toBeEnabled();
  await expect(page.locator('#cm-new-name-hint')).toBeHidden();
  await next.click();
  await page.locator('[data-action="cwFinishCreate"]').click();
  await expect(page.getByRole('tab', { name: /^Students/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.cm-roster-add')).toBeVisible();
  await expect(page).toHaveURL(/manage=students/);
});
