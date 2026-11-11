/**
 * The phone's Draft and Returned (S1-F3): Return and Next on the grading
 * screen, the Grade tab's To Return list with Return N, and the student
 * card's To Return list. Demo Mode, Science 8, at 375 x 812.
 *
 * The build switch has no control yet, so it is turned on from the page as
 * the console would (setStudentPageSwitch). The logic (switch off, nothing in,
 * comments, pairs, the list's follow-through) is pinned in
 * tests/phone-return.test.js; these keep the keyboard, double-tap, finger-size
 * and contrast checks that need a real page.
 */
import { test, expect } from '@playwright/test';
import { findLowContrastText } from './contrast-check.js';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const QUIZ = 'sci8q12'; // Data Reading Quiz: points
const CHECK = 'sci8a10'; // Mid-Year Lab Skills Check: two competencies

/* Demo Mode on the phone. `before` changes the class while it is as it is
   today; `on` then turns the build switch on (When I Return Them, or `on`
   itself when it names a choice); `drafts` then makes some: the first three
   students on the quiz and the first on the check. `after` runs last. Both
   are given { cid, ids }, the students A to Z. */
async function openPhone(page, { on = false, drafts = false, before = null, after = null, motion = false } = {}) {
  if (!motion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const info = await page.evaluate(() => {
    const cid = getActiveCourse();
    const ids = sortStudents(getStudents(cid), 'alpha').map(s => s.id);
    const names = ids.map(sid => displayNameFirst(getStudents(cid).find(s => s.id === sid)));
    return { cid, ids, names };
  });
  if (before) await page.evaluate(before, info);
  await page.evaluate(
    ({ on, drafts, ids, QUIZ, CHECK }) => {
      const cid = getActiveCourse();
      if (on) setStudentPageSwitch(cid, true, on === true ? undefined : on);
      if (drafts) {
        ids.slice(0, 3).forEach(sid => Grader.setPoints(cid, sid, QUIZ, (getPointsScore(cid, sid, QUIZ) || 0) + 1));
        const check = getAssessments(cid).find(a => a.id === CHECK);
        const tid = check.tagIds[0];
        const now = (getScores(cid)[ids[0]] || []).find(e => e.assessmentId === CHECK && e.tagId === tid);
        Grader.setLevel(cid, ids[0], CHECK, tid, now && now.score === 4 ? 3 : 4, 0);
      }
    },
    { on, drafts, ids: info.ids, QUIZ, CHECK },
  );
  if (after) await page.evaluate(after, info);
  // The phone is drawn again from the class as it now is.
  await page.reload();
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
  return info;
}

const stateOf = (page, sid, aid) =>
  page.evaluate(([sid, aid]) => GradeState.stateOf(getActiveCourse(), sid, aid), [sid, aid]);
const waiting = page => page.evaluate(() => GradeState.draftsWaiting(getActiveCourse()));

async function openGradeTab(page) {
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
}
async function openGrading(page, aid) {
  await openGradeTab(page);
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + aid + '"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  // The grading screen slides in and wires its fields.
  await page.waitForTimeout(500);
}
// The next card is on screen: Return and Next takes a tap again.
const slideDone = page => page.waitForTimeout(700);

const bar = page => page.locator('#m-grade-return');
const returnNext = page => page.locator('[data-action="m-grade-return-next"]');
const segment = page => page.locator('.m-seg-btn[data-val="toreturn"]');
const sheet = page => page.locator('#m-sheet-container .m-confirm-sheet');

// Controls a finger can reach that are under 44 px high (e2e/mobile-step4-phone.spec.js).
const small = () =>
  [...document.querySelectorAll('button, [role=button], select, input, [data-action]')]
    .filter(e => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
      // The sheet's handle is every sheet's, and not this change's.
      if (e.closest('#m-auth, .m-skip-nav, .m-obs-chev, .m-sheet-handle')) return false;
      if (getComputedStyle(e).pointerEvents === 'none') return false;
      return r.height < 43.5;
    })
    .map(e => e.outerHTML.slice(0, 80) + ' ' + Math.round(e.getBoundingClientRect().height));

test.describe('the grading screen', () => {
  test('a level makes a draft, and Return and Next returns it and moves on', async ({ page }) => {
    const info = await openPhone(page, { on: true });
    await openGrading(page, CHECK);
    // A grade from before the switch came on is Returned.
    await expect(bar(page)).toHaveText('Returned');
    await expect(returnNext(page)).toHaveCount(0);

    await page.locator('.m-swiper-card').first().locator('.m-score-btn:not(.m-score-active)').first().click();
    await expect(bar(page).locator('.m-draft-mark')).toHaveText('Draft');
    await expect(bar(page)).toContainText('Saved. Not returned yet.');
    await expect(bar(page)).toContainText(info.names[0] + ' still sees the grade you returned.');
    await expect(returnNext(page)).toHaveText('Return and Next');
    await expect(returnNext(page)).toBeEnabled();
    expect(await stateOf(page, info.ids[0], CHECK)).toBe('draft');

    // The bar sits above the tab bar, whole, and the card ends above it.
    const box = async sel => page.locator(sel).first().boundingBox();
    const button = await box('[data-action="m-grade-return-next"]');
    const tabs = await box('#m-tab-bar');
    const cards = await box('#m-swiper');
    const whole = await box('#m-grade-return-state');
    expect(button.y + button.height).toBeLessThanOrEqual(tabs.y);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(cards.y + cards.height).toBeLessThanOrEqual(whole.y + 1);
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(375);
    // The card's last field scrolls clear of the bar.
    const comment = page.locator('.m-swiper-card').first().locator('.m-overall-comment');
    await comment.scrollIntoViewIfNeeded();
    const field = await comment.boundingBox();
    expect(field.y + field.height).toBeLessThanOrEqual(whole.y);
    expect(await page.evaluate(small)).toEqual([]);

    await returnNext(page).click();
    await expect(page.locator('#m-nav-bar-grade-swiper')).toContainText('2 of ');
    expect(await stateOf(page, info.ids[0], CHECK)).toBe('returned');
    expect(await waiting(page)).toBe(0);
    await expect(bar(page)).toHaveText('Returned');
    // Back on the first card: Returned, with today's date.
    await slideDone(page);
    await page.locator('#m-thumb-strip .m-thumb').first().click();
    await expect(bar(page)).toHaveText(/^Returned [A-Z][a-z]{2} \d{1,2}$/);
  });

  test('two quick taps return one grade: the next card has to be on screen first', async ({ page }) => {
    const info = await openPhone(page, { on: true, drafts: true });
    await openGrading(page, QUIZ);
    await expect(returnNext(page)).toBeEnabled();
    await returnNext(page).dblclick();
    expect(await stateOf(page, info.ids[0], QUIZ)).toBe('returned');
    expect(await stateOf(page, info.ids[1], QUIZ)).toBe('draft');
    await expect(page.locator('#m-nav-bar-grade-swiper')).toContainText('2 of ');
    await slideDone(page);
    await returnNext(page).click();
    expect(await stateOf(page, info.ids[1], QUIZ)).toBe('returned');
    await expect(page.locator('#m-nav-bar-grade-swiper')).toContainText('3 of ');
  });

  test('Return and Next is reached and pressed from the keyboard', async ({ page }) => {
    const info = await openPhone(page, { on: true, drafts: true });
    await openGrading(page, QUIZ);
    // The bar is the last thing on the screen before the tab bar.
    await page.locator('.m-tab-item[data-tab="students"]').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(returnNext(page)).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await stateOf(page, info.ids[0], QUIZ)).toBe('returned');
    // The second student's draft is up, and its button keeps the focus.
    await expect(page.locator('#m-nav-bar-grade-swiper')).toContainText('2 of ');
    await expect(returnNext(page)).toBeFocused();
    await slideDone(page);
    await page.keyboard.press('Enter');
    await slideDone(page);
    await page.keyboard.press('Enter');
    expect(await stateOf(page, info.ids[2], QUIZ)).toBe('returned');
    // The fourth student has nothing to return: the bar itself has the focus.
    await expect(returnNext(page)).toHaveCount(0);
    await expect(bar(page)).toBeFocused();
    // The line that says where the grade stands is a live region.
    await expect(page.locator('#m-grade-return-state')).toHaveAttribute('role', 'status');
  });
});

test.describe('the Grade tab’s To Return list', () => {
  test('lists the drafts, and Return N asks first', async ({ page }) => {
    const info = await openPhone(page, { on: true, drafts: true });
    await openGradeTab(page);
    await expect(page.locator('#m-screen-grade-picker .m-seg-btn')).toHaveText(['Recent', 'To Return4', 'All']);
    expect(await waiting(page)).toBe(4);
    await expect(segment(page)).toHaveAccessibleName('To Return, 4 drafts');
    // Three segments on one line on a narrow phone.
    const heights = await page
      .locator('#m-screen-grade-picker .m-seg-btn')
      .evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
    expect(heights[1]).toBe(heights[0]);

    await segment(page).click();
    await expect(segment(page)).toHaveAttribute('aria-pressed', 'true');
    const rows = page.locator('#m-grade-to-return .m-to-return-row');
    await expect(rows).toHaveCount(2);
    // Newest first: the check (Nov 2), then the quiz (Oct 30).
    await expect(rows.nth(0)).toHaveAttribute('data-aid', CHECK);
    const quiz = page.locator('.m-to-return-row[data-aid="' + QUIZ + '"]');
    await expect(quiz.locator('.m-draft-mark')).toHaveText('3 drafts');
    await expect(quiz.locator('.m-to-return-names')).toHaveText(info.names.slice(0, 3).sort().join(', '));
    await expect(quiz.locator('[data-action="m-grade-return-all"]')).toHaveText('Return 3');
    await expect(quiz.locator('[data-action="m-grade-return-all"]')).toHaveAccessibleName(
      'Return 3 Graded, Data Reading Quiz',
    );
    await expect(page.locator('.m-to-return-note')).toHaveText(
      'Graded but not returned. Students see these after you return them.',
    );
    expect(await page.evaluate(small)).toEqual([]);
    // Nothing runs off a narrow screen.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    // Return 3 asks, from the keyboard too: the focus starts on Cancel, Tab
    // stays in the sheet, and Escape cancels and gives the focus back.
    const button = quiz.locator('[data-action="m-grade-return-all"]');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toHaveAttribute('role', 'dialog');
    await expect(sheet(page)).toHaveAccessibleName('Return 3 Grades Now?');
    const [a, b, c] = info.names.slice(0, 3).sort();
    await expect(sheet(page).locator('#m-confirm-text')).toHaveText(
      '3 drafts: ' + a + ', ' + b + ' and ' + c + ' can’t see them yet.',
    );
    await expect(sheet(page).locator('button')).toHaveText(['Return 3 Graded', 'Cancel']);
    await expect(sheet(page).locator('[data-action="m-sheet-cancel"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sheet(page).locator('.m-confirm-ok')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(sheet(page).locator('[data-action="m-sheet-cancel"]')).toBeFocused();
    expect(await page.evaluate(small)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(await waiting(page)).toBe(4);

    // Return 3 Graded returns the three and the row goes.
    await button.click();
    await sheet(page).locator('.m-confirm-ok').click();
    await expect(rows).toHaveCount(1);
    await expect(segment(page)).toHaveText('To Return1');
    for (const sid of info.ids.slice(0, 3)) expect(await stateOf(page, sid, QUIZ)).toBe('returned');
    expect(await stateOf(page, info.ids[0], CHECK)).toBe('draft');
    expect(await waiting(page)).toBe(1);
    await expect(sheet(page)).toHaveCount(0);

    // One draft still asks: the button names nobody.
    await page.locator('[data-action="m-grade-return-all"]').click();
    await expect(sheet(page).locator('#m-confirm-title')).toHaveText('Return 1 Grade Now?');
    await expect(sheet(page).locator('#m-confirm-text')).toHaveText('1 draft: ' + info.names[0] + ' can’t see it yet.');
    await sheet(page).locator('.m-confirm-ok').click();
    await expect(page.locator('#m-grade-to-return .m-empty-title')).toHaveText('Nothing to Return');
    await expect(page.locator('#m-grade-to-return .m-empty-subtitle')).toHaveText(
      'No grades are waiting as drafts in Science 8.',
    );
    await expect(segment(page)).toHaveText('To Return');
    expect(await waiting(page)).toBe(0);
    await expect(sheet(page)).toHaveCount(0);
    expect(await page.evaluate(small)).toEqual([]);
    await page.locator('#m-grade-to-return [data-action="m-grade-seg"]').click();
    await expect(page.locator('.m-seg-btn[data-val="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#m-grade-list')).toBeVisible();
  });
});

test.describe('the student card’s To Return list', () => {
  test('lists the student’s drafts, and Return returns one in one tap', async ({ page }) => {
    const info = await openPhone(page, { on: true, drafts: true });
    const card = page.locator('.m-card-stack-item[data-depth="0"]');
    await expect(card.locator('.m-scard-name')).toContainText(info.names[0]);
    await expect(card.locator('.m-scard-return-head')).toHaveText('To Return');
    const rows = card.locator('.m-scard-return-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.m-scard-return-title')).toHaveText('Mid-Year Lab Skills Check');
    await expect(rows.nth(1).locator('.m-scard-return-title')).toHaveText('Data Reading Quiz');
    await expect(rows.nth(0).locator('.m-draft-mark')).toHaveText('Draft');
    // The grade, as the student screen shows it, then who can't see it.
    const shown = await page.evaluate(
      ([sid, aid]) => {
        const cid = getActiveCourse();
        const a = getAssessments(cid).find(x => x.id === aid);
        return MStudentDetail.cellText(assessmentCellValue(cid, sid, a), a);
      },
      [info.ids[0], QUIZ],
    );
    await expect(rows.nth(1).locator('.m-scard-return-text')).toHaveText(
      shown + ' · ' + info.names[0] + ' can’t see it yet',
    );
    await expect(rows.nth(1).locator('[data-action="m-card-return"]')).toHaveAccessibleName(
      'Return, Data Reading Quiz',
    );
    expect(await page.evaluate(small)).toEqual([]);
    // The list sits inside the card.
    const box = await card.locator('.m-scard-return').boundingBox();
    const outer = await card.locator('.m-scard').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(outer.x);
    expect(box.x + box.width).toBeLessThanOrEqual(outer.x + outer.width);

    // From the keyboard: Return on the quiz, one press, no question.
    await rows.nth(1).locator('[data-action="m-card-return"]').focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toHaveCount(0);
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator('.m-scard-return-title')).toHaveText('Mid-Year Lab Skills Check');
    expect(await stateOf(page, info.ids[0], QUIZ)).toBe('returned');
    expect(await stateOf(page, info.ids[1], QUIZ)).toBe('draft');
    expect(await stateOf(page, info.ids[0], CHECK)).toBe('draft');
    await expect(page.locator('#m-student-card-stack')).toBeFocused();

    await rows.nth(0).locator('[data-action="m-card-return"]').click();
    await expect(card.locator('.m-scard-return')).toHaveCount(0);
    expect(await waiting(page)).toBe(2);
  });
});

/* Small text is readable in each new state, in light and dark mode
   (e2e/contrast.spec.js's rule and its exemptions). */
const LEVEL_TOKENS = [0, 1, 2, 3, 4].flatMap(n => [
  `--score-${n}`,
  `--score-${n}-bg`,
  `--score-${n}-text`,
  `--score-${n}-dark`,
]);
const CONTRAST = { skip: ['.gb-grid'], textTokens: LEVEL_TOKENS, fillTokens: [...LEVEL_TOKENS, '--active'] };

for (const colorScheme of ['light', 'dark']) {
  test.describe(`text contrast, ${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test('the bar, the To Return list, the question and the card', async ({ page }) => {
      // Fades and other finite transitions settle first, as in e2e/contrast.spec.js:
      // a colour read mid-fade is neither of its two tokens.
      const readable = async () => {
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
              .map(a => a.finished.catch(() => {})),
          ),
        );
        expect(await findLowContrastText(page, { ...CONTRAST, skip }), 'low contrast').toEqual([]);
      };
      let skip = CONTRAST.skip;
      await openPhone(page, { on: true, drafts: true, motion: true });
      await expect(page.locator('.m-scard-return').first()).toBeVisible();
      await readable();
      await openGradeTab(page);
      await segment(page).click();
      await expect(page.locator('.m-to-return-row').first()).toBeVisible();
      await readable();
      await page.locator('[data-action="m-grade-return-all"]').first().click();
      await expect(sheet(page)).toBeVisible();
      await page.waitForTimeout(400);
      await readable();
      await page.locator('#m-sheet-container [data-action="m-sheet-cancel"]').click();
      await expect(sheet(page)).toHaveCount(0);
      await page.locator('.m-to-return-open').first().click();
      await expect(bar(page).locator('.m-draft-mark')).toBeVisible();
      await page.waitForTimeout(500);
      // On the grading screen only the new bar is checked: the screen's own
      // text is not this change's, and the dimmed initials of graded
      // students in the strip are under 4.5:1 today.
      skip = [...CONTRAST.skip, '.m-nav-bar', '#m-thumb-strip', '.m-grade-view-row', '#m-swiper'];
      await readable();
      await returnNext(page).click();
      await slideDone(page);
      await page.locator('#m-thumb-strip .m-thumb').first().click();
      await expect(bar(page).locator('.m-returned-mark')).toBeVisible();
      await readable();
    });
  });
}
