import { test, expect } from '@playwright/test';

// S1-F1: in a class whose student page is on (the hidden build switch) and
// that returns grades When I Return Them, the gradebook marks each draft
// with a dashed outline, explains the mark in its key, counts the drafts on
// "N to return" (which is also a filter), and returns a column's drafts with
// Return N Graded: in the Scores column's menu (one click, under the line
// that names who) and under a Competencies header (which asks first, in the
// app's confirm dialog). Demo Mode only: no server knows the rule yet. With
// the switch off the gradebook has none of it.

// A piece nobody is graded on yet, added to the Demo class. It is dated
// today, so with Newest First it is the first column.
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
  return page.evaluate(() => {
    var cid = getActiveCourse();
    var students = sortStudents(getStudents(cid), 'lastName');
    var tag = getAllTags(cid)[0];
    saveAssessments(
      cid,
      getAssessments(cid).concat([
        { id: 'e2e-draft', title: 'Tide Pool Notes', date: courseToday(cid), type: 'summative', tagIds: [tag.id] },
      ]),
    );
    return {
      cid: cid,
      tag: tag.id,
      sids: students.slice(0, 3).map(s => s.id),
      names: students.slice(0, 3).map(s => s.preferred || s.firstName),
      roster: students.length,
    };
  });
}

async function openGradebook(page) {
  await page.goto('/gradebook');
  await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
  await page.waitForSelector('#gb-data td[data-aid="e2e-draft"]');
}

const cell = (page, sid) => page.locator('.gb-scores-cell[data-sid="' + sid + '"][data-aid="e2e-draft"]');

// Grade one student on the new piece in the grader dialog, as a click on the
// cell does.
async function grade(page, at, sid, n) {
  await cell(page, sid).click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="' + n + '"]').click();
  await expect(dialog.locator('.grader-draft-mark')).toHaveText('Draft');
  await dialog.locator('.grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
}

// The column's menu, from its title with the keyboard.
async function openColumnMenu(page) {
  const title = page.locator('#gb-colheads .gb-grid-colhead[data-aid="e2e-draft"] .gb-grid-colhead-label');
  await title.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('.gb-ctx-menu');
  await expect(menu).toBeVisible();
  return menu;
}

// The dashed outline is drawn by the cell's ::before.
const outline = locator => locator.evaluate(el => getComputedStyle(el, '::before').borderTopStyle);

test('draft cells are dashed, counted and returned from their column; the filter; the state is kept', async ({
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
  await openGradebook(page);
  const [first, second, third] = at.sids;
  const pill = page.locator('.gb-to-return');
  const keyLine = page.locator('.gb-key .gb-key-item-draft');

  // Nothing waits yet: the key explains the mark, and there is no count.
  await expect(keyLine).toHaveText('Draft: graded, not returned');
  await expect(pill).toHaveCount(0);
  await expect(page.locator('#gb-data .gb-draft')).toHaveCount(0);

  await grade(page, at, first, 3);
  await grade(page, at, second, 2);

  // Two dashed cells, said in words, and "2 to return".
  for (const sid of [first, second]) {
    await expect(cell(page, sid)).toHaveClass(/gb-draft/);
    await expect(cell(page, sid)).toHaveAttribute('aria-label', /, Draft, not returned yet$/);
    expect(await outline(cell(page, sid))).toBe('dashed');
  }
  await expect(cell(page, third)).not.toHaveClass(/gb-draft/);
  await expect(page.locator('#gb-data .gb-draft')).toHaveCount(2);
  await expect(pill).toHaveText('2 to return');
  await expect(pill).toHaveAttribute('aria-pressed', 'false');

  // Everything is in view at 1280×720 with no scrolling: the count, the
  // key's line, the draft cells, and Return 2 Graded in the column's menu.
  expect(await page.evaluate(() => [window.scrollY, document.getElementById('gb-data').scrollTop])).toEqual([0, 0]);
  await expect(pill).toBeInViewport({ ratio: 1 });
  await expect(keyLine).toBeInViewport({ ratio: 1 });
  await expect(cell(page, first)).toBeInViewport({ ratio: 1 });
  await expect(cell(page, second)).toBeInViewport({ ratio: 1 });
  let menu = await openColumnMenu(page);
  const give = menu.locator('[data-ctx="returnDrafts"]');
  await expect(give).toHaveText('Return 2 Graded');
  await expect(give).toBeInViewport({ ratio: 1 });
  const names = at.names.slice(0, 2).sort((a, b) => a.localeCompare(b));
  await expect(menu.locator('.gb-ctx-note')).toHaveText(
    '2 drafts: ' + names[0] + ' and ' + names[1] + ' can’t see them yet.',
  );
  // The grades count already: no number waits for Return.
  const overallBefore = await page.evaluate(a => getOverallProficiency(a.cid, a.sids[0]), at);

  // One press returns both: the cells are plain and the count is gone.
  await give.click();
  // The menu's item is one click: the line above it named who, so no dialog.
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  await expect(page.locator('.gb-ctx-menu')).toHaveCount(0);
  await expect(page.locator('#gb-data .gb-draft')).toHaveCount(0);
  await expect(cell(page, first)).not.toHaveAttribute('aria-label', /Draft/);
  expect(await outline(cell(page, first))).not.toBe('dashed');
  await expect(pill).toHaveCount(0);
  expect(await page.evaluate(a => a.sids.map(sid => GradeState.stateOf(a.cid, sid, 'e2e-draft')), at)).toEqual([
    'returned',
    'returned',
    null,
  ]);
  expect(await page.evaluate(a => getOverallProficiency(a.cid, a.sids[0]), at)).toBe(overallBefore);
  menu = await openColumnMenu(page);
  await expect(menu.locator('[data-ctx="returnDrafts"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // A third grade, and a change to a returned one: two drafts again.
  await grade(page, at, third, 4);
  await grade(page, at, first, 4);
  await expect(pill).toHaveText('2 to return');
  await expect(cell(page, first)).toHaveClass(/gb-draft/);
  await expect(cell(page, second)).not.toHaveClass(/gb-draft/);

  // The filter: only the students and the assessment with a draft.
  await pill.click();
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await expect(pill).toContainText('2 to return');
  await expect(page.locator('#gb-data tr[data-sid]')).toHaveCount(2);
  await expect(page.locator('#gb-colheads .gb-grid-colhead[data-aid]')).toHaveCount(1);
  await expect(page.locator('#gb-rowheads .gb-grid-rowhead:not(.gb-grid-rowhead-stats)')).toHaveCount(2);
  // The Competencies view keeps it, with Return 2 Graded under the header.
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  await expect(page.locator('#gb-data tr[data-sid]')).toHaveCount(2);
  const headerGive = page.locator('.gb-return-drafts[data-aid="e2e-draft"]');
  await expect(headerGive).toHaveText('Return 2 Graded');
  await expect(headerGive).toBeInViewport({ ratio: 1 });
  // None of its words is cut off, and it sits inside its own header, in
  // this machine's font and in a much wider one (it wraps to a second line).
  const whole = () =>
    headerGive.evaluate(el => {
      const box = el.getBoundingClientRect();
      const head = el.closest('.gb-grid-assess-group').getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        cut: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight,
        clipped: style.overflow !== 'visible' || style.textOverflow === 'ellipsis',
        inside: box.left >= head.left && box.right <= head.right && box.top >= head.top && box.bottom <= head.bottom,
      };
    });
  expect(await whole()).toEqual({ cut: false, clipped: false, inside: true });
  await headerGive.evaluate(el => {
    el.style.letterSpacing = '2px';
  });
  expect(await whole()).toEqual({ cut: false, clipped: false, inside: true });
  await expect(headerGive).toBeInViewport({ ratio: 1 });
  await headerGive.evaluate(el => {
    el.style.letterSpacing = '';
  });
  await expect(page.locator('#gb-data td.gb-score.gb-draft')).toHaveCount(2);
  expect(
    await page
      .locator('#gb-data td.gb-score.gb-draft .gb-score-val')
      .first()
      .evaluate(el => getComputedStyle(el).borderTopStyle),
  ).toBe('dashed');
  // Off again: everyone is back.
  await pill.click();
  await expect(pill).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#gb-data tr[data-sid]')).toHaveCount(at.roster);

  // Reload: the drafts, the returned grade and the count are as they were.
  await openGradebook(page);
  await expect(pill).toHaveText('2 to return');
  await expect(cell(page, first)).toHaveClass(/gb-draft/);
  await expect(cell(page, third)).toHaveClass(/gb-draft/);
  await expect(cell(page, second)).not.toHaveClass(/gb-draft/);
  expect(await page.evaluate(a => a.sids.map(sid => GradeState.stateOf(a.cid, sid, 'e2e-draft')), at)).toEqual([
    'draft',
    'returned',
    'draft',
  ]);
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

  // Returned from the Competencies header this time. Its button shows no
  // names, so it asks first, saying who gets their grade.
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  const headerButton = page.locator('.gb-return-drafts[data-aid="e2e-draft"]');
  const dialog = page.locator('.confirm-overlay');
  await headerButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.confirm-title')).toHaveText('Return 2 Grades Now?');
  const waiting = [at.names[0], at.names[2]].sort((a, b) => a.localeCompare(b));
  await expect(dialog.locator('.confirm-message')).toHaveText(
    '2 drafts: ' + waiting[0] + ' and ' + waiting[1] + ' can\u2019t see them yet.',
  );
  await expect(dialog.locator('.confirm-actions button')).toHaveText(['Cancel', 'Return 2 Graded']);
  await expect(dialog.locator('#confirm-ok-btn')).toHaveClass(/primary/);
  await expect(dialog.locator('.confirm-card')).toBeInViewport({ ratio: 1 });
  // Cancel: nothing is returned, and the button has the focus again.
  await dialog.locator('#confirm-cancel-btn').click();
  await expect(dialog).toHaveCount(0);
  await expect(pill).toHaveText('2 to return');
  await expect(page.locator('#gb-data td.gb-score.gb-draft')).toHaveCount(2);
  expect(await page.evaluate(a => a.sids.map(sid => GradeState.stateOf(a.cid, sid, 'e2e-draft')), at)).toEqual([
    'draft',
    'returned',
    'draft',
  ]);
  await expect(headerButton).toBeFocused();
  // Asked again and confirmed: both are returned.
  await headerButton.click();
  await dialog.locator('#confirm-ok-btn').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.gb-return-drafts')).toHaveCount(0);
  expect(await page.evaluate(a => a.sids.map(sid => GradeState.stateOf(a.cid, sid, 'e2e-draft')), at)).toEqual([
    'returned',
    'returned',
    'returned',
  ]);
  await expect(page.locator('.gb-grid-assess-group .gb-assess-title', { hasText: 'Tide Pool Notes' })).toBeFocused();
  await expect(pill).toHaveCount(0);
  await expect(page.locator('#gb-data .gb-draft')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the marks follow the theme: dashed in dark mode too', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1280, height: 720 });
  const at = await demoWithNewPiece(page);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid);
  await openGradebook(page);
  await grade(page, at, at.sids[0], 3);
  const draft = cell(page, at.sids[0]);
  await expect(draft).toHaveClass(/gb-draft/);
  expect(await outline(draft)).toBe('dashed');
  // The outline is the level's colour, the cell's own text colour.
  expect(
    await draft.evaluate(el => getComputedStyle(el, '::before').borderTopColor === getComputedStyle(el).color),
  ).toBe(true);
  await expect(page.locator('.gb-to-return')).toHaveText('1 to return');

  // One draft, from the Competencies header: the dialog says Grade, not Grades.
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  await page.locator('.gb-return-drafts[data-aid="e2e-draft"]').click();
  const dialog = page.locator('.confirm-overlay');
  await expect(dialog.locator('.confirm-title')).toHaveText('Return 1 Grade Now?');
  await expect(dialog.locator('.confirm-message')).toHaveText('1 draft: ' + at.names[0] + ' can\u2019t see it yet.');
  await expect(dialog.locator('#confirm-ok-btn')).toHaveText('Return 1 Graded');
  await dialog.locator('#confirm-ok-btn').click();
  await expect(page.locator('.gb-to-return')).toHaveCount(0);
  await expect(page.locator('#gb-data .gb-draft')).toHaveCount(0);
});

test('with the switch off, and on As Soon As I Save, the gradebook has no mark, count or Return', async ({ page }) => {
  const at = await demoWithNewPiece(page);
  await openGradebook(page);
  const nothing = async () => {
    await expect(page.locator('#gb-data .gb-draft')).toHaveCount(0);
    await expect(page.locator('.gb-to-return')).toHaveCount(0);
    await expect(page.locator('.gb-key')).not.toContainText('Draft');
    const menu = await openColumnMenu(page);
    await expect(menu).not.toContainText('Return');
    await page.keyboard.press('Escape');
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('.gb-return-drafts')).toHaveCount(0);
    await expect(page.locator('#gb-data .gb-draft')).toHaveCount(0);
  };
  // Switch off: grade in the dialog, which shows no Draft row either.
  await cell(page, at.sids[0]).click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await dialog.locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="3"]').click();
  await dialog.locator('.grader-done').click();
  await nothing();
  expect(await page.evaluate(cid => localStorage.getItem('gb-grade-returns-' + cid), at.cid)).toBeNull();

  // On, but returning each save at once.
  expect(await page.evaluate(cid => setStudentPageSwitch(cid, true, 'on_save'), at.cid)).toBe(true);
  await openGradebook(page);
  await cell(page, at.sids[1]).click();
  await dialog.locator('[data-action="graderTagLevel"][data-tag="' + at.tag + '"][data-level="2"]').click();
  await dialog.locator('.grader-done').click();
  await nothing();
});
