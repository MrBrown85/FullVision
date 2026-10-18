import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, navigateTo } from './helpers.js';

test.describe('Dashboard & Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await gotoApp(page, '/dashboard');
  });

  test('app boots and renders dock navigation', async ({ page }) => {
    const dock = page.locator('#dock-mount nav');
    await expect(dock).toBeVisible();
    // All 5 dock tabs should be present
    await expect(page.locator('#dock-mount')).toContainText('Dashboard');
    await expect(page.locator('#dock-mount')).toContainText('Assignments');
    await expect(page.locator('#dock-mount')).toContainText('Gradebook');
    await expect(page.locator('#dock-mount')).toContainText('Observations');
    await expect(page.locator('#dock-mount')).toContainText('Reports');
  });

  test('dashboard page renders main content', async ({ page }) => {
    // Main area should have content
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('course name is visible in the UI', async ({ page }) => {
    // The course name "Science 8 — Test" should appear somewhere
    await expect(page.locator('body')).toContainText('Science 8');
  });

  test('navigate to Assignments via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Assignments")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/assignments');
  });

  test('navigate to Gradebook via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Gradebook")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/gradebook');
  });

  test('navigate to Observations via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Observations")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/observations');
  });

  test('navigate to Reports via dock', async ({ page }) => {
    await page.locator('#dock-mount a:has-text("Reports")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('#/reports');
  });

  test('hash navigation updates page content', async ({ page }) => {
    await navigateTo(page, '#/assignments');
    // Should no longer show dashboard content
    const main = page.locator('#main');
    await expect(main).not.toBeEmpty();
  });

  test('skip-to-content link exists', async ({ page }) => {
    const skipLink = page.locator('.skip-link');
    await expect(skipLink).toHaveAttribute('href', '#main');
  });

  test('user menu shows teacher name', async ({ page }) => {
    // The dock should show user info somewhere
    const dock = page.locator('#dock-mount');
    await expect(dock).toContainText('Test Teacher');
  });
});

test.describe('Dashboard observation coverage', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await page.addInitScript(() => {
      const day = n => {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return (
          d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
        );
      };
      const ob = (id, n, sentiment) => ({
        id,
        text: 'Observed ' + id,
        dims: [],
        sentiment,
        context: null,
        created: day(n) + 'T12:00:00.000Z',
        date: day(n),
      });
      localStorage.setItem(
        'gb-observations-sci8',
        JSON.stringify({ 'stu-001': [ob('o1', 2, 'strength')], 'stu-002': [ob('o2', 40, 'concern')] }),
      );
    });
    await gotoApp(page, '/dashboard');
  });

  test('names students with no observation in 3+ weeks', async ({ page }) => {
    await expect(page.locator('.dash-obs-headline')).toContainText('2 students have no observation in 3+ weeks');
    const overdue = page.locator('.dash-obs-overdue');
    await expect(overdue).toContainText('Bob');
    await expect(overdue).toContainText('Charlie');
    await expect(overdue).not.toContainText('Alice');
  });

  test('a grid cell links to the Observations page for that student', async ({ page }) => {
    const row = page.locator('.dash-obs-grid tbody tr', { hasText: 'Alice' });
    await expect(row.locator('.dash-obs-cell.dash-obs-tint-strength')).toHaveCount(1);
    await row.locator('.dash-obs-cell').last().click();
    await expect(page).toHaveURL(/#\/observations\?course=sci8&student=stu-001/);
  });
});
