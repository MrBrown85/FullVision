import { test, expect } from '@playwright/test';
import { findLowContrastText } from './contrast-check.js';

// S1-F2: in a class whose student page is on (the hidden build switch) and
// that returns grades When I Return Them, the Assignments page shows what
// is waiting to return: "N to return" on the toolbar (which is also a
// filter), "N to return" and "N returned" on a card with Return N Graded
// (which asks first), the Draft or Returned mark on each student's row, and
// Return beside the Draft mark under one student's grader. The grader
// dialog gets Show (To Return, Returned, All) and Return N Graded. Demo
// Mode only: no server knows the rule yet. With the switch off the page
// has none of it.

const AID = 'e2e-draft';

// A piece nobody is graded on yet, added to the Demo class.
async function demoWithNewPiece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The sample class is seeded a moment after the dashboard opens.
  await page.waitForFunction(
    () => {
      var cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0 && getAllTags(cid).length > 0;
    },
    null,
    { timeout: 15000 },
  );
  return page.evaluate(aid => {
    var cid = getActiveCourse();
    var students = sortStudents(getStudents(cid), 'lastName');
    var tag = getAllTags(cid)[0];
    saveAssessments(
      cid,
      getAssessments(cid).concat([
        { id: aid, title: 'Tide Pool Notes', date: courseToday(cid), type: 'summative', tagIds: [tag.id] },
      ]),
    );
    return {
      cid: cid,
      tag: tag.id,
      sids: students.slice(0, 3).map(s => s.id),
      names: students.slice(0, 3).map(s => s.preferred || s.firstName),
      roster: students.length,
      pieces: getAssessments(cid).length,
    };
  }, AID);
}

async function openAssignments(page) {
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  await page.waitForSelector('#ac-' + AID);
}

const card = page => page.locator('#ac-' + AID);
const pill = page => page.locator('.assess-to-return-btn');
const row = (page, sid) => card(page).locator('.rsg-student[data-status-student="' + sid + '"]');
const level = (page, at, sid, n) =>
  row(page, sid).locator('.rsg-criterion-row.is-tag[data-tag="' + at.tag + '"] .rsg-level.l' + n);
const mark = (page, sid) => row(page, sid).locator('.ret-mark');
const states = (page, at) => page.evaluate(a => a.sids.map(sid => GradeState.stateOf(a.cid, sid, 'e2e-draft')), at);
const sentence = names => {
  const sorted = names.slice().sort((a, b) => a.localeCompare(b));
  if (sorted.length === 1) return '1 draft: ' + sorted[0] + ' can’t see it yet.';
  return (
    sorted.length +
    ' drafts: ' +
    sorted.slice(0, -1).join(', ') +
    ' and ' +
    sorted[sorted.length - 1] +
    ' can’t see them yet.'
  );
};

test('the page counts the drafts, marks each row and returns a card’s drafts after asking; the filter; the state is kept', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const at = await demoWithNewPiece(page);
  // The hidden build switch, from the console.
  expect(await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid)).toBe(true);
  await openAssignments(page);
  const [first, second, third] = at.sids;

  // Nothing waits yet: no count, no Return, and the new piece has no chips.
  await expect(pill(page)).toHaveCount(0);
  await expect(page.locator('#main .assess-return-btn')).toHaveCount(0);
  await expect(card(page).locator('.assess-to-return, .assess-returned')).toHaveCount(0);
  // The sample class's grades are from before the switch came on: Returned.
  await expect(page.locator('#main .assess-returned').first()).toHaveText(/^\d+ returned$/);

  // Grading in the open card marks the rows and counts them, with no reload.
  await card(page).locator('.assess-title').click();
  await level(page, at, first, 3).click();
  await level(page, at, second, 2).click();
  await expect(mark(page, first)).toHaveText('Draft');
  await expect(mark(page, second)).toHaveText('Draft');
  await expect(mark(page, third)).toHaveText('');
  expect(
    await mark(page, first)
      .locator('.ret-draft')
      .evaluate(el => getComputedStyle(el).borderTopStyle),
  ).toBe('dashed');
  await expect(card(page).locator('.assess-to-return')).toHaveText('2 to return');
  await expect(pill(page)).toHaveText('2 to return');
  await expect(pill(page)).toHaveAttribute('aria-pressed', 'false');
  const give = card(page).locator('.assess-return-btn');
  await expect(give).toHaveText('Return 2 Graded');
  await expect(give).toHaveAttribute('aria-label', 'Return 2 Graded, Tide Pool Notes');
  await expect(give).toHaveAttribute('title', sentence(at.names.slice(0, 2)));
  // In view at 1280×720 with the card open: the count and the button.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(pill(page)).toBeInViewport({ ratio: 1 });
  await expect(give).toBeInViewport({ ratio: 1 });
  // Nothing in the header is pushed out of the card.
  expect(
    await give.evaluate(el => {
      const box = el.getBoundingClientRect();
      const head = el.closest('.assess-card').getBoundingClientRect();
      return box.left >= head.left && box.right <= head.right && el.scrollWidth <= el.clientWidth;
    }),
  ).toBe(true);
  // The grades count already: no number waits for Return.
  const overallBefore = await page.evaluate(a => getOverallProficiency(a.cid, a.sids[0]), at);

  // The keyboard reaches the count from the search box, and the button
  // opens the question with Enter.
  await page.locator('.assess-search-input').focus();
  await page.keyboard.press('Tab');
  await expect(pill(page)).toBeFocused();
  await give.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('.confirm-overlay');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.confirm-title')).toHaveText('Return 2 Grades Now?');
  await expect(dialog.locator('.confirm-message')).toHaveText(sentence(at.names.slice(0, 2)));
  await expect(dialog.locator('.confirm-actions button')).toHaveText(['Cancel', 'Return 2 Graded']);
  await expect(dialog.locator('.confirm-card')).toBeInViewport({ ratio: 1 });
  // The focus starts on Cancel; Escape returns nothing and gives it back.
  await expect(dialog.locator('#confirm-cancel-btn')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(give).toBeFocused();
  expect(await states(page, at)).toEqual(['draft', 'draft', null]);
  await expect(pill(page)).toHaveText('2 to return');

  // Asked again and confirmed: both are returned, with today's date.
  await give.click();
  await dialog.locator('#confirm-ok-btn').click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page).locator('.assess-return-btn')).toHaveCount(0);
  await expect(mark(page, first)).toHaveText(/^Returned \S+ \d+$/);
  await expect(mark(page, second)).toHaveText(/^Returned \S+ \d+$/);
  await expect(card(page).locator('.assess-returned')).toHaveText('2 returned');
  await expect(card(page).locator('.assess-to-return')).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  expect(await states(page, at)).toEqual(['returned', 'returned', null]);
  expect(await page.evaluate(a => getOverallProficiency(a.cid, a.sids[0]), at)).toBe(overallBefore);
  // The button went with the drafts: the card's next button has the focus.
  await expect(card(page).locator('.assess-header-actions button').first()).toBeFocused();

  // A third grade, and a change to a returned one: two drafts again.
  await level(page, at, third, 4).click();
  await level(page, at, first, 4).click();
  await expect(mark(page, first)).toHaveText('Draft');
  await expect(mark(page, second)).toHaveText(/^Returned/);
  await expect(pill(page)).toHaveText('2 to return');
  await expect(card(page).locator('.assess-returned')).toHaveText('1 returned');

  // The filter: only the assessment with a draft.
  await pill(page).click();
  await expect(pill(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(pill(page)).toContainText('2 to return');
  await expect(pill(page)).toBeFocused();
  await expect(page.locator('#main .assess-card')).toHaveCount(1);
  await pill(page).click();
  await expect(pill(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#main .assess-card')).toHaveCount(at.pieces);

  // Reload: the drafts, the returned grade and the count are as they were.
  await openAssignments(page);
  await expect(pill(page)).toHaveText('2 to return');
  await expect(card(page).locator('.assess-to-return')).toHaveText('2 to return');
  expect(await states(page, at)).toEqual(['draft', 'returned', 'draft']);
  // The student still has the grade that was returned to them.
  expect(
    await page.evaluate(
      a =>
        getReturnedScores(a.cid)
          [a.sids[0]].filter(e => e.assessmentId === 'e2e-draft')
          .map(e => e.score),
      at,
    ),
  ).toEqual([3]);
  // The gradebook counts the same two.
  await page.goto('/gradebook');
  await page.waitForSelector('#gb-data td[data-aid="' + AID + '"]');
  await expect(page.locator('.gb-to-return')).toHaveText('2 to return');
  expect(errors).toEqual([]);
});

test('with one student open, Return sits beside the Draft mark and is one click', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 720 });
  const at = await demoWithNewPiece(page);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid);
  await openAssignments(page);
  await page.locator('#gb-roster-list .student-row[data-sid="' + at.sids[0] + '"]').click();
  await expect(page.locator('.focus-banner')).toBeVisible();
  const box = card(page).locator('.grader-return-inline');
  const give = box.locator('[data-action="returnOne"]');
  // Nothing in: Return is there, greyed out.
  await expect(give).toBeDisabled();
  await expect(box.locator('.grader-draft')).toHaveCount(0);

  await card(page)
    .locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="3"]')
    .click();
  await expect(box.locator('.grader-draft-mark')).toHaveText('Draft');
  await expect(box.locator('.grader-draft-text')).toHaveText('Saved. Not returned yet.');
  await expect(give).toBeEnabled();
  await expect(give).toHaveText('Return');
  await expect(give).toHaveAttribute('aria-label', 'Return, Tide Pool Notes');
  // The count is this student's drafts; the card offers no Return N Graded.
  await expect(pill(page)).toHaveText('1 to return');
  await expect(card(page).locator('.assess-to-return')).toHaveText('1 to return');
  await expect(page.locator('#main .assess-return-btn')).toHaveCount(0);

  // One press of Enter returns it: no question.
  await give.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  await expect(box.locator('.grader-returned')).toHaveText(/^Returned \S+ \d+$/);
  await expect(box.locator('[data-action="returnOne"]')).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  expect(await page.evaluate(a => GradeState.stateOf(a.cid, a.sids[0], 'e2e-draft'), at)).toBe('returned');
  // The keys stay in the student's grader.
  expect(await page.evaluate(() => !!document.activeElement.closest('.grader-inline'))).toBe(true);

  // A change after that waits, and says what the student still sees.
  await card(page)
    .locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="4"]')
    .click();
  await expect(box.locator('.grader-draft-mark')).toHaveText('Draft');
  await expect(box.locator('.grader-draft-still')).toHaveText(
    new RegExp('^' + at.names[0] + ' still sees the grade you returned \\S+ \\d+\\.$'),
  );
  // The next student has no row content of their own draft.
  await page.keyboard.press('ArrowRight');
  await expect(card(page).locator('.grader-inline-name')).not.toHaveText(new RegExp('^' + at.names[0]));
  await expect(box.locator('.grader-draft')).toHaveCount(0);
  await expect(pill(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the grader dialog has Show and Return N Graded; To Return is what the arrows step through', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 720 });
  const at = await demoWithNewPiece(page);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid);
  // The first and the third student are graded; the second is not.
  await page.evaluate(a => {
    Grader.setLevel(a.cid, a.sids[0], 'e2e-draft', a.tag, 3, 0);
    Grader.setLevel(a.cid, a.sids[2], 'e2e-draft', a.tag, 2, 0);
  }, at);
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + at.sids[1] + '"][data-aid="' + AID + '"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  const bar = dialog.locator('.grader-show');
  const seg = which => bar.locator('[data-show="' + which + '"]');
  const all = bar.locator('.grader-return-all');
  const name = dialog.locator('.grader-student');
  const fullName = i =>
    page.evaluate(
      a => {
        var s = getStudents(a.at.cid).find(x => x.id === a.at.sids[a.i]);
        return displayNameWithLast(s);
      },
      { at, i },
    );

  // The bar, under the title: the counts are students.
  await expect(bar.locator('.seg')).toHaveAttribute('aria-label', 'Show');
  await expect(seg('toreturn')).toHaveText('To Return 2');
  await expect(seg('returned')).toHaveText('Returned 0');
  await expect(seg('returned')).toBeDisabled();
  await expect(seg('all')).toHaveText('All ' + at.roster);
  await expect(seg('all')).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveText('Return 2 Graded');
  await expect(all).toHaveAttribute('title', sentence([at.names[0], at.names[2]]));
  // Everything the dialog pins is in view at 1280×720.
  await expect(bar).toBeInViewport({ ratio: 1 });
  await expect(all).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator('.grader-foot')).toBeInViewport({ ratio: 1 });
  await expect(dialog.locator('.grader-return [data-grader="return"]')).toBeInViewport({ ratio: 1 });
  // The bar's controls sit on one line and none is cut off.
  expect(
    await bar.evaluate(el =>
      Array.from(el.querySelectorAll('button')).every(
        b => b.scrollWidth <= b.clientWidth && b.getBoundingClientRect().right <= el.getBoundingClientRect().right,
      ),
    ),
  ).toBe(true);

  // The keyboard: Tab goes from Done into the bar, and Enter presses.
  await dialog.locator('.grader-done').focus();
  await page.keyboard.press('Tab');
  await expect(seg('toreturn')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(seg('toreturn')).toHaveAttribute('aria-pressed', 'true');
  await expect(seg('toreturn')).toBeFocused();
  // The student on screen had no draft: the first one that has opens.
  await expect(name).toHaveText(await fullName(0));
  await expect(dialog.locator('[data-grader="prev"]')).toBeDisabled();
  await dialog.locator('[data-grader="next"]').click();
  // The step goes past the ungraded student.
  await expect(name).toHaveText(await fullName(2));
  await expect(dialog.locator('[data-grader="next"]')).toBeDisabled();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');

  // Return N Graded returns more than the grade on screen: it asks first.
  await all.focus();
  await page.keyboard.press('Enter');
  const ask = page.locator('.confirm-overlay');
  await expect(ask.locator('.confirm-title')).toHaveText('Return 2 Grades Now?');
  await expect(ask.locator('.confirm-message')).toHaveText(sentence([at.names[0], at.names[2]]));
  await expect(ask.locator('.confirm-actions button')).toHaveText(['Cancel', 'Return 2 Graded']);
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  // Escape closed the question only, and the button has the focus back.
  await expect(dialog).toBeVisible();
  await expect(all).toBeFocused();
  expect(await page.evaluate(a => GradeState.draftsWaiting(a.cid), at)).toBe(2);

  // The dialog's own Return gives the grade on screen in one click; the
  // student stays, and the counts follow.
  await dialog.locator('.grader-return [data-grader="return"]').click();
  await expect(seg('toreturn')).toHaveText('To Return 1');
  await expect(seg('returned')).toHaveText('Returned 1');
  await expect(all).toHaveText('Return 1 Graded');
  await expect(name).toHaveText(await fullName(2));
  // The one draft left is not the student on screen: it asks, and names them.
  await all.click();
  await expect(ask.locator('.confirm-title')).toHaveText('Return 1 Grade Now?');
  await expect(ask.locator('.confirm-message')).toHaveText(sentence([at.names[0]]));
  await ask.locator('#confirm-ok-btn').click();
  await expect(ask).toHaveCount(0);
  // Nothing is left to return: Show is back on All, with no button.
  await expect(seg('all')).toHaveAttribute('aria-pressed', 'true');
  await expect(seg('toreturn')).toBeDisabled();
  await expect(seg('returned')).toHaveText('Returned 2');
  await expect(all).toHaveCount(0);
  expect(await page.evaluate(a => GradeState.draftsWaiting(a.cid), at)).toBe(0);
  await dialog.locator('.grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await expect(page.locator('.gb-to-return')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a title with an apostrophe: Return N Graded is not swapped out under the mouse, and one click asks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const at = await demoWithNewPiece(page);
  await page.evaluate(a => {
    setStudentPageSwitch(a.cid, true);
    // The browser writes an apostrophe and a < in an attribute its own way.
    saveAssessments(
      a.cid,
      getAssessments(a.cid).map(x =>
        x.id === 'e2e-draft' ? Object.assign({}, x, { title: "Newton’s & Sam's <Laws>" }) : x,
      ),
    );
    Grader.setLevel(a.cid, a.sids[0], 'e2e-draft', a.tag, 3, 0);
  }, at);
  await openAssignments(page);
  await card(page).locator('.assess-title').click();
  const give = card(page).locator('.assess-return-btn');
  await expect(give).toHaveAttribute('aria-label', "Return 1 Graded, Newton’s & Sam's <Laws>");
  await give.evaluate(el => {
    el._same = true;
  });
  // Events that save nothing leave the very same button in place.
  await page.locator('.assess-search-input').focus();
  await page.locator('.assess-search-input').blur();
  await card(page).locator('.rsg-student-name').first().click();
  await page.waitForTimeout(50);
  expect(await give.evaluate(el => el._same === true)).toBe(true);
  // So one real click (press, then release) reaches it.
  await give.click();
  await expect(page.locator('.confirm-overlay .confirm-title')).toHaveText('Return 1 Grade Now?');
  await page.locator('#confirm-ok-btn').click();
  await expect(card(page).locator('.assess-return-btn')).toHaveCount(0);
  // The card is still open: the click did not fall through to its header.
  await expect(card(page)).toHaveClass(/open/);
});

test('with the switch off, and on As Soon As I Save, the page and the dialog have none of it', async ({ page }) => {
  const at = await demoWithNewPiece(page);
  await openAssignments(page);
  const nothing = async () => {
    await expect(
      page.locator(
        '.assess-to-return-slot, .assess-to-return-btn, .assess-returns, .assess-return-slot, .ret-mark, .grader-return-inline, .grader-show',
      ),
    ).toHaveCount(0);
    await expect(page.locator('#main')).not.toContainText(/to return|returned|Draft/i);
  };
  // Switch off: grade in the open card.
  await card(page).locator('.assess-title').click();
  await level(page, at, at.sids[0], 3).click();
  await nothing();
  await page.locator('#gb-roster-list .student-row[data-sid="' + at.sids[0] + '"]').click();
  await expect(page.locator('.focus-banner')).toBeVisible();
  await nothing();
  expect(await page.evaluate(cid => localStorage.getItem('gb-grade-returns-' + cid), at.cid)).toBeNull();

  // On, but returning each save at once.
  expect(await page.evaluate(cid => setStudentPageSwitch(cid, true, 'on_save'), at.cid)).toBe(true);
  await openAssignments(page);
  await card(page).locator('.assess-title').click();
  await level(page, at, at.sids[1], 2).click();
  await nothing();
  // The dialog over the gradebook has no bar.
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  const cell = page.locator('.gb-scores-cell[data-sid="' + at.sids[2] + '"][data-aid="' + AID + '"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await dialog.locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="2"]').click();
  await expect(dialog.locator('.grader-show')).toHaveCount(0);
  await expect(dialog).not.toContainText(/To Return|Return \d+ Graded/);
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

    test('the count, the chips, the marks, the question, one student’s row and the dialog’s bar', async ({ page }) => {
      // Fades and other finite transitions settle first, as in e2e/contrast.spec.js.
      const readable = async () => {
        await page.evaluate(() =>
          Promise.all(
            document
              .getAnimations()
              .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
              .map(a => a.finished.catch(() => {})),
          ),
        );
        const failures = await findLowContrastText(page, CONTRAST);
        expect(failures, JSON.stringify(failures, null, 1)).toEqual([]);
      };
      await page.setViewportSize({ width: 1440, height: 900 });
      const at = await demoWithNewPiece(page);
      await page.evaluate(a => {
        setStudentPageSwitch(a.cid, true);
        Grader.setLevel(a.cid, a.sids[0], 'e2e-draft', a.tag, 3, 0);
        Grader.setLevel(a.cid, a.sids[1], 'e2e-draft', a.tag, 2, 0);
        Grader.setLevel(a.cid, a.sids[2], 'e2e-draft', a.tag, 4, 0);
        Grader.returnGrades(a.cid, 'e2e-draft', [a.sids[2]]);
      }, at);
      await openAssignments(page);
      await card(page).locator('.assess-title').click();
      await expect(mark(page, at.sids[0])).toHaveText('Draft');
      await expect(mark(page, at.sids[2])).toHaveText(/^Returned/);
      await expect(pill(page)).toHaveText('2 to return');
      // The marks and the pill take their colours from the theme's tokens.
      expect(
        await page.evaluate(() => {
          const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
          const probe = document.createElement('span');
          document.body.appendChild(probe);
          const rgb = value => {
            probe.style.color = value;
            return getComputedStyle(probe).color;
          };
          const out = {
            draft:
              getComputedStyle(document.querySelector('.ret-draft')).color === rgb(css('--score-3-text')) &&
              getComputedStyle(document.querySelector('.ret-draft')).borderTopColor === rgb(css('--score-3')),
            pill:
              getComputedStyle(document.querySelector('.assess-to-return-btn')).color === rgb(css('--demo-pill-text')),
          };
          probe.remove();
          return out;
        }),
      ).toEqual({ draft: true, pill: true });
      await readable();
      await pill(page).click();
      await expect(pill(page)).toHaveAttribute('aria-pressed', 'true');
      await readable();
      await card(page).locator('.assess-return-btn').click();
      await expect(page.locator('.confirm-overlay')).toBeVisible();
      await readable();
      await page.locator('#confirm-cancel-btn').click();
      // One student: Return beside the Draft mark.
      await page.locator('#gb-roster-list .student-row[data-sid="' + at.sids[0] + '"]').click();
      await expect(card(page).locator('.grader-return-inline .grader-draft-mark')).toBeVisible();
      await readable();
      // The dialog's bar, over the gradebook (whose own grid the rule leaves out).
      await page.goto('/gradebook');
      await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
      const cell = page.locator('.gb-scores-cell[data-sid="' + at.sids[0] + '"][data-aid="' + AID + '"]');
      await cell.scrollIntoViewIfNeeded();
      await cell.click();
      await expect(page.locator('#grader-overlay .grader-show')).toBeVisible();
      await readable();
      await page.locator('.grader-show [data-show="returned"]').click();
      await expect(page.locator('#grader-overlay .grader-returned')).toBeVisible();
      await readable();
    });
  });
}
