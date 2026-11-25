/**
 * The phone grader's ways round the class, as a teacher has them with the
 * new look (docs/plans/phone-look-plan.md): the strip of students is a
 * progress line now, not buttons, so a test goes to a student through the
 * class list behind the name in the top bar, and to Competencies or Rubric
 * through ⋯.
 */
import { expect } from '@playwright/test';

// The card index once the cards have stopped sliding.
export async function settled(page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = document.getElementById('m-swiper');
        return !!s && Math.abs(s.scrollLeft - MGrade.getCurrentIndex() * s.clientWidth) < 1;
      }),
    )
    .toBe(true);
  return page.evaluate(() => MGrade.getCurrentIndex());
}

/* Goes to a card through the class list: `which` is a student's id (their
   own card, or their group's) or the card's place in the list. */
export async function jumpTo(page, which) {
  const idx =
    typeof which === 'number'
      ? which
      : await page.evaluate(
          sid => [...document.querySelectorAll('#m-thumb-strip .m-thumb')].findIndex(t => t.dataset.sid === sid),
          which,
        );
  expect(idx).toBeGreaterThanOrEqual(0);
  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  await page.locator('#m-sheet-container .m-roster-row[data-idx="' + idx + '"]').click();
  await expect(page.locator('#m-sheet-container .m-roster')).toHaveCount(0);
  expect(await settled(page)).toBe(idx);
}

// Competencies or Rubric, from ⋯.
export async function scoreBy(page, label) {
  await page.locator('#m-nav-bar-grade-swiper .m-grade-more').click();
  await page.locator('#m-sheet-container .m-more-sheet .m-seg-btn', { hasText: label }).click();
  await expect(page.locator('#m-sheet-container .m-more-sheet')).toHaveCount(0);
}
