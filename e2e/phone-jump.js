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
          sid => [...document.querySelectorAll('#m-grade-progress .m-prog-seg')].findIndex(t => t.dataset.sid === sid),
          which,
        );
  expect(idx).toBeGreaterThanOrEqual(0);
  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  await page.locator('#m-sheet-container .m-roster-row[data-idx="' + idx + '"]').click();
  await expect(page.locator('#m-sheet-container .m-roster')).toHaveCount(0);
  expect(await settled(page)).toBe(idx);
}

/* Competencies or Rubric, from ⋯: the sheet offers the other view, as one
   button ("Grade by Competencies" on the Rubric view, "Grade by Rubric" on the
   Competencies view). Asked for the view already on, it does nothing. */
export async function scoreBy(page, label) {
  const view = /^Competenc/.test(label) ? 'tags' : 'rubric';
  await page.locator('#m-nav-bar-grade-swiper .m-grade-more').click();
  const sheet = page.locator('#m-sheet-container .m-more-sheet');
  const button = sheet.locator('[data-action="m-grade-view"][data-view="' + view + '"]');
  if (await button.count()) {
    await button.click();
  } else {
    await page.evaluate(() => MComponents.dismissSheet());
  }
  await expect(sheet).toHaveCount(0);
}
