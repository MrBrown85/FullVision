import { test, expect } from '@playwright/test';
import { findLowContrastText } from './contrast-check.js';

// S1-F2: in a class whose student page is on (the hidden build switch) and
// that returns grades When I Return Them, the Assignments page shows what
// is waiting to return. The counts, marks, filter, Return buttons, dialog
// bar and the switch-off case are pinned in tests/assignments-return.test.js,
// tests/grader-dialog-return.test.js and tests/assignments-return-counts.test.js.
// What stays here needs a real browser: the apostrophe click, the button's
// fit and place on screen, and the text contrast in each state. Demo Mode
// only: no server knows the rule yet.

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
const mark = (page, sid) => row(page, sid).locator('.ret-mark');

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
  // In view at 1280×720 with the card open, and nothing pushed out of the card.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(pill(page)).toBeInViewport({ ratio: 1 });
  await expect(give).toBeInViewport({ ratio: 1 });
  expect(
    await give.evaluate(el => {
      const box = el.getBoundingClientRect();
      const head = el.closest('.assess-card').getBoundingClientRect();
      return box.left >= head.left && box.right <= head.right && el.scrollWidth <= el.clientWidth;
    }),
  ).toBe(true);
  // A draft's mark has a dashed border.
  expect(
    await mark(page, at.sids[0])
      .locator('.ret-draft')
      .evaluate(el => getComputedStyle(el).borderTopStyle),
  ).toBe('dashed');
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
