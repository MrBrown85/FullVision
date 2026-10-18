import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

/* Observations page: Enter sends, Shift+Enter adds a line, delete offers
   Undo for six seconds, and the feed is a card list with a sticky-note
   toggle. docs/DECISIONS.md, "Observations (2026-10-18)". */

async function pickStudent(page, name) {
  await page.locator('#student-btn').click();
  await page.locator('#student-dropdown .obsc-item', { hasText: name }).click();
  await page.locator('#capture-input').click();
}

async function storedObs(page) {
  return page.evaluate(cid => {
    const all = JSON.parse(localStorage.getItem('gb-quick-obs-' + cid) || '{}');
    return Object.values(all).flat();
  }, TEST_COURSE.id);
}

test.describe('Observations — keyboard, undo and views', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await gotoApp(page, '/observations');
    await page.waitForSelector('#capture-input');
  });

  test('Enter sends the observation', async ({ page }) => {
    await pickStudent(page, 'Alice');
    await page.locator('#capture-input').fill('Asked a sharp question about density');
    await page.keyboard.press('Enter');

    const card = page.locator('.obs-card', { hasText: 'Asked a sharp question about density' });
    await expect(card).toBeVisible();
    await expect(page.locator('#capture-input')).toHaveValue('');
    await expect(page.locator('#obs-count')).toHaveText('1 observation');
  });

  test('Shift+Enter adds a line instead of sending', async ({ page }) => {
    await pickStudent(page, 'Alice');
    const input = page.locator('#capture-input');
    await input.pressSequentially('Line one');
    await page.keyboard.press('Shift+Enter');
    await input.pressSequentially('Line two');

    await expect(input).toHaveValue('Line one\nLine two');
    await expect(page.locator('.obs-card')).toHaveCount(0);

    await page.keyboard.press('Enter');
    await expect(page.locator('.obs-card .obs-card-text')).toHaveText('Line one\nLine two');
  });

  test('Undo brings a deleted observation back', async ({ page }) => {
    await pickStudent(page, 'Bob');
    await page.locator('#capture-input').fill('Kept the group on task');
    await page.keyboard.press('Enter');
    const card = page.locator('.obs-card', { hasText: 'Kept the group on task' });
    await expect(card).toBeVisible();

    await card.locator('.obs-card-delete').click();
    await expect(card).toHaveCount(0);
    const toast = page.locator('#undo-toast');
    await expect(toast).toContainText('Observation deleted');

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toBeVisible();
    await expect(toast).toHaveCount(0);

    // Past the undo window it is still there.
    await page.waitForTimeout(6500);
    await expect(card).toBeVisible();
    expect((await storedObs(page)).map(o => o.text)).toContain('Kept the group on task');
  });

  test('without Undo the delete happens when the toast closes', async ({ page }) => {
    await pickStudent(page, 'Bob');
    await page.locator('#capture-input').fill('Left the bench tidy');
    await page.keyboard.press('Enter');
    const card = page.locator('.obs-card', { hasText: 'Left the bench tidy' });
    await card.locator('.obs-card-delete').click();
    await expect(card).toHaveCount(0);

    // Held for the undo window, not deleted yet.
    expect((await storedObs(page)).map(o => o.text)).toContain('Left the bench tidy');

    await expect(page.locator('#undo-toast')).toHaveCount(0, { timeout: 8000 });
    expect((await storedObs(page)).map(o => o.text)).not.toContain('Left the bench tidy');
    await expect(page.locator('#obs-count')).toHaveText('0 observations');
  });

  test('a student link from the dashboard picks and filters to that student', async ({ page }) => {
    await page.goto(`/teacher/app.html#/observations?course=${TEST_COURSE.id}&student=stu-002`);
    await page.waitForSelector('#capture-input');
    await expect(page.locator('#obs-capture .obsc-chip-student')).toContainText('Bob');
    await expect(page.locator('#filter-student-btn')).toHaveClass(/active/);
    await expect(page.locator('#filter-student-btn')).toContainText('Bob');
  });

  test('card list by default; the sticky-note view is remembered', async ({ page }) => {
    await expect(page.locator('#obs-feed')).toHaveClass(/view-list/);
    const toggle = page.getByRole('button', { name: 'Sticky notes' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(page.locator('#obs-feed')).toHaveClass(/view-sticky/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.waitForSelector('#obs-feed');
    await expect(page.locator('#obs-feed')).toHaveClass(/view-sticky/);
  });
});
