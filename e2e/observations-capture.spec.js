import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

/* Observations page: Enter sends, Shift+Enter adds a line, delete offers
   Undo for six seconds, and the feed is one card list (the sticky-note
   view went in the 2026-10-19 card redesign). docs/DECISIONS.md,
   "Observations". */

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
    await page.goto(`/observations?course=${TEST_COURSE.id}&student=stu-002`);
    await page.waitForSelector('#capture-input');
    await expect(page.locator('#obs-capture .obsc-chip-student')).toContainText('Bob');
    await expect(page.locator('#filter-student-btn')).toHaveClass(/active/);
    await expect(page.locator('#filter-student-btn')).toContainText('Bob');
  });

  test('one card list with no sticky-note view; the day header counts its notes', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Sticky notes' })).toHaveCount(0);
    await pickStudent(page, 'Alice');
    await page.locator('#capture-input').fill('Measured the beaker twice');
    await page.keyboard.press('Enter');
    // Add clears the student, so the second note picks her again.
    await pickStudent(page, 'Alice');
    await page.locator('#capture-input').fill('Labelled every sample');
    await page.keyboard.press('Enter');
    const day = page.locator('.obs-feed-date-group').first();
    await expect(day.locator('.obs-feed-date-label')).toContainText('Today');
    await expect(day.locator('.obs-feed-date-count')).toHaveText('2 observations');
    // Time only on the card; the header carries the date.
    await expect(day.locator('.obs-card-time').first()).not.toContainText(',');
  });

  test('a card shows its delete only on hover or focus', async ({ page }) => {
    await pickStudent(page, 'Alice');
    await page.locator('#capture-input').fill('Swept the bench');
    await page.keyboard.press('Enter');
    const card = page.locator('.obs-card', { hasText: 'Swept the bench' });
    const del = card.locator('.obs-card-delete');
    await page.mouse.move(0, 0);
    await expect(del).toHaveCSS('opacity', '0');
    await card.hover();
    await expect(del).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0);
    await expect(del).toHaveCSS('opacity', '0');
    await card.focus();
    await expect(del).toHaveCSS('opacity', '1');
  });
});
