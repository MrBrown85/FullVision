/**
 * Points work on the phone: the score is a field. A tap selects the number,
 * typing replaces it, and Done or tapping away saves with the desktop points
 * box's rules. + and − stay. The card names every competency the assessment
 * assesses. Runs in Demo Mode on Mid-Year Comprehensive Exam (out of 80).
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

async function openExam(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell', { hasText: 'Mid-Year Comprehensive Exam' }).click();
  // The field's handlers are bound once the screen has slid in.
  await expect(page.locator('#m-swiper')).toBeVisible();
  await page.waitForTimeout(500);
  return page.locator('.m-swiper-card').first();
}

const stored = (page, sid) =>
  page.evaluate(sid => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.title === 'Mid-Year Comprehensive Exam');
    return getPointsScore(cid, sid, a.id);
  }, sid);

test('typed points replace the score, clamp like the desktop, and reach the gradebook', async ({ page }) => {
  const card = await openExam(page);
  const sid = await card.getAttribute('data-sid');
  await expect(card.locator('.m-score-tag-label')).toHaveText([
    'Question and Predict',
    'Identify Patterns',
    'Evaluate Methods',
  ]);

  const field = card.locator('.m-pts-input');
  await expect(field).toHaveAttribute('inputmode', 'decimal');
  await expect(field).toHaveValue('65');

  // Tap, type: the typed number replaces 65. Done (Enter) saves.
  await field.tap();
  await page.keyboard.type('72');
  await page.keyboard.press('Enter');
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue('72');
  expect(await stored(page, sid)).toBe(72);

  // Out of range clamps to 0 and to twice the maximum, as on the desktop.
  await field.tap();
  await page.keyboard.type('999');
  await card.locator('.m-grade-student-name').click();
  await expect(field).toHaveValue('160');
  await field.tap();
  await page.keyboard.type('-5');
  await card.locator('.m-grade-student-name').click();
  await expect(field).toHaveValue('0');
  expect(await stored(page, sid)).toBe(0);

  // + and − stay.
  await field.tap();
  await page.keyboard.type('72');
  await page.keyboard.press('Enter');
  await card.locator('[data-action="m-grade-points-inc"]').click();
  await expect(field).toHaveValue('73');
  await card.locator('[data-action="m-grade-points-dec"]').click();
  await expect(field).toHaveValue('72');

  // The desktop gradebook shows the typed score.
  const desktop = await page.context().newPage();
  await desktop.setViewportSize({ width: 1400, height: 900 });
  await desktop.goto('/gradebook');
  const cell = await desktop.evaluate(async sid => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.title === 'Mid-Year Comprehensive Exam');
    for (let i = 0; i < 50; i++) {
      const td = document.querySelector(`[data-sid="${sid}"][data-aid="${a.id}"]`);
      if (td) return td.innerText.trim();
      await new Promise(f => setTimeout(f, 100));
    }
    return null;
  }, sid);
  expect(cell).toBe('72');
});

test('a blank field clears the score', async ({ page }) => {
  const card = await openExam(page);
  const sid = await card.getAttribute('data-sid');
  const field = card.locator('.m-pts-input');
  await field.tap();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('');
  expect(await stored(page, sid)).toBeNull();
});
