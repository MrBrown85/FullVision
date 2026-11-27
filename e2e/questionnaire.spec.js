import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The Term Questionnaire's review screen (fullvision-generate-plan PR 11a,
   the "Review screen" mockup), in Demo Mode on Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // Reports' scripts load when Reports first opens: open it, then go back to the Dashboard.
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  // Drawn in full (its sentence bank loaded too) before it is left.
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  // On the Report Card: a new report has no Teacher Comment block.
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
}

/* A comment's sentences, as ReportQuestionnaire.sentencesOf splits them. */
function ReportQuestionnaireSentences(text) {
  const out = [];
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const re = /[.!?…]+["”]?\s+(?=["“]?[A-Z0-9])/g;
  let from = 0;
  let m;
  while ((m = re.exec(t))) {
    out.push(t.slice(from, m.index + m[0].length).trim());
    from = m.index + m[0].length;
  }
  if (from < t.length) out.push(t.slice(from).trim());
  return out.filter(Boolean);
}

/* The seeded comment cleared, for a draft with no typed sentences kept in
   it (a typed sentence stays through Generate; a fresh start is clearing
   the box). */
async function clearComment(page) {
  await page.locator('#tq-narrative').evaluate(el => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#tq-sentences .qn-srow')).toHaveCount(0);
}

/* The cursor at the end of the comment (End only reaches the end of a
   wrapped line). */
async function toEnd(page) {
  const box = page.locator('#tq-narrative');
  // The comment reads as its sentences; a click makes it the box to type in.
  if (await page.locator('#tq-read').isVisible()) await page.locator('#tq-read').click();
  await box.click();
  await box.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
}

/* Elements whose content is wider than their box and not scrolled, and
   buttons whose label is cut off. */
async function overflow(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.qn *, #gb-sidebar *, .report-toolbar *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.offsetParent === null) return;
      // Text for screen readers only, clipped to nothing on purpose.
      if (cs.position === 'absolute' && cs.clip === 'rect(0px, 0px, 0px, 0px)') return;
      // A line cut on purpose (a Work Habits name) ends in an ellipsis.
      if (cs.textOverflow === 'ellipsis' && cs.overflowX === 'hidden' && el.title === el.textContent) return;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(cs.overflowX)) {
        out.push((el.id || el.className || el.tagName) + ': ' + (el.textContent || '').trim().slice(0, 30));
      }
    });
    const tb = document.querySelector('.report-toolbar');
    if (tb.scrollWidth > tb.clientWidth + 1) out.push('toolbar');
    return out;
  });
}

/* The screen read once after one login and Report 2 setup; none of these
   steps keeps a change. */
test('the screen: toolbar, hover titles, no overflow, shared next step, sources sheet, earlier reports, header', async ({
  page,
}) => {
  // Many reads in one open: give the CI runner room.
  test.setTimeout(90_000);
  await open(page);
  // The toolbar: Approve and Next and ⋯ (Edit Student, Where This Information Comes From); no Questions, no Save and Next.
  await expect(page.locator('#tq-approve-next')).toHaveText('Approve and Next ›');
  await expect(page.locator('#tq-more-btn')).toBeVisible();
  await expect(page.locator('#tq-questions-btn, #tq-save-next, #tq-approve, .qn-bottom')).toHaveCount(0);
  await expect(page.locator('#tq-bank, .qn-ev-tabs, [data-tq-card]')).toHaveCount(0);

  // The report tabs, the picker, This Report and the comment box explain themselves on hover.
  await expect(page.locator('.report-seg-btn[data-tab="questionnaire"]')).toHaveAttribute(
    'title',
    'Write and approve each student’s report comment.',
  );
  await expect(page.locator('.report-seg-btn[data-tab="progress"]')).toHaveAttribute(
    'title',
    'Build and print the class’s report cards.',
  );
  await expect(page.locator('#report-period')).toHaveAttribute('title', /^The report you are working on\./);
  await expect(page.locator('.qn-comment-tabs .seg-btn[data-tab="this"]')).toHaveAttribute(
    'title',
    'The comment for this report.',
  );
  await expect(page.locator('.qn-comment-tabs .seg-btn:not([data-tab="this"])').first()).toHaveAttribute(
    'title',
    /^The comment that went home in .+\. Read only\.$/,
  );

  // No overflow at 1440 × 900.
  expect(await overflow(page)).toEqual([]);

  // ⋯'s Where This Information Comes From opens its sheet; Tab and Shift-Tab stay inside it.
  await page.locator('#tq-more-btn').click();
  await page.locator('[data-action="tqInfo"]').click();
  const sheet = page.getByRole('dialog', { name: 'Where This Information Comes From' });
  await expect(sheet).toBeVisible();
  const cards = sheet.locator('.qn-info-card');
  await expect(cards.nth(0).locator('.qn-info-row .qn-info-part')).toHaveText([
    'Grade',
    'Work Habits',
    'Best Piece',
    'Missing Work',
    'Skills',
    'Goal and Voice',
    'Attendance',
    'Teacher Comment',
  ]);
  await expect(cards.nth(0).locator('.qn-info-row').nth(2)).toContainText(
    'The highest-marked assignment so far this year, and your note for the report on it.',
  );
  // The class's One Report parts in print order, then the Feedback Pages that are on.
  const blocks = await page.evaluate(() => {
    const m = ReportOne.modelFor(getReportConfig('sci8') || {});
    const on = ReportOne.order(m)
      .filter(k => ReportOne.available(k, 'sci8'))
      .concat(ReportOne.FEEDBACK.map(f => f.key).filter(k => ReportOne.isOn(m, k)));
    return on.map(k => m.titles[k] || ReportOne.label(k, 'sci8'));
  });
  expect(blocks[0]).toBe('Letterhead');
  expect(blocks.length).toBeGreaterThan(3);
  await expect(cards.nth(1).locator('.qn-info-row .qn-info-part')).toHaveText(blocks);
  await expect(cards.nth(1).locator('.qn-info-off')).toContainText('Add them in Print Reports.');
  await expect(sheet).toContainText('Student Voice answers marked Private.');
  const inside = () => page.evaluate(() => !!document.activeElement.closest('#tq-info-overlay'));
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('#tq-more-btn')).toBeFocused();

  // Earlier reports are read only.
  await page.locator('[data-action="tqCommentTab"]').nth(1).click();
  await expect(page.locator('.qn-comment .qn-hint')).toContainText('Went home in');
  await expect(page.locator('#tq-narrative')).toHaveCount(0);
  await expect(page.locator('.qn-earlier')).toContainText('consistent, dependable student');
  // Back to this report for the rest.
  await page.locator('[data-action="tqCommentTab"]').nth(0).click();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });

  // The header: name, pronouns, the Student Dashboard link there and back, the grade and the count.
  await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');
  await expect(page.locator('.qn-head-sub')).toHaveText('she/her · Student Dashboard ›');
  await page.locator('.qn-head-link').click();
  await page.waitForURL(/\/student\?id=st1/);
  await page.getByRole('link', { name: 'Term Questionnaire' }).click();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');

  // The class's shared next step shows inside the Closing editor, not on the closed row (last: it opens the line editor).
  const r = await page.evaluate(() =>
    CommentBank.sharedNextStep('sci8', { termId: ReportBlocks.getTermId(), students: getStudents('sci8') }),
  );
  await page.locator('#wc-head-cls').click();
  await expect(page.locator('.wc-box[data-part="cls"] .qn-shared-step')).toHaveCount(0);
  await page.locator('.wc-box[data-part="cls"] [data-do="editClosing"]').click();
  await expect(page.locator('#tq-line-closing')).toBeVisible();
  await expect(page.locator('.wc-box[data-part="cls"] .qn-shared-step')).toContainText('Shared next step:');
  await expect(page.locator('.wc-box[data-part="cls"] .qn-shared-step')).toContainText(
    r.count + ' of ' + r.total + ' students',
  );
});

test('typing just before leaving is saved: Progress Reports, another report, another class', async ({ page }) => {
  await open(page);
  // Within the 0.6 s pause the box waits before saving.
  await toEnd(page);
  await page.keyboard.type(' Saved on the way out.');
  await page.locator('.report-seg-btn[data-tab="progress"]').click();
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative)).toMatch(
    /Saved on the way out\.$/,
  );
  await page.locator('.report-seg-btn[data-tab="questionnaire"]').click();
  await toEnd(page);
  await page.keyboard.type(' Kept with Report 2.');
  await page.locator('#report-period').selectOption('Report 1');
  const saved = await page.evaluate(() => [
    getStudentTermRating('sci8', 'st1', 'term-2').narrative,
    (getStudentTermRating('sci8', 'st1', 'term-1') || {}).narrative || '',
  ]);
  expect(saved[0]).toMatch(/Kept with Report 2\.$/);
  expect(saved[1]).not.toContain('Kept with Report 2');
});

test('Generate Comment drafts from the bank; the box grows, the count follows, ⌘Z brings the old text back', async ({
  page,
}) => {
  await open(page);
  const box = page.locator('#tq-narrative');
  const before = await box.inputValue();
  await page.locator('#tq-generate').click();
  const first = await box.inputValue();
  expect(first).not.toBe(before);
  expect(first).toContain('Cece');
  expect(first).not.toMatch(/[{}[\]]/);
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative)).toBe(first);
  await expect(page.locator('#tq-count')).toHaveText(first.length + ' characters');
  // The comment grows with its text: nothing scrolls inside the box.
  expect(await box.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  // Again: a different mix.
  await page.locator('#tq-generate').click();
  const second = await box.inputValue();
  expect(second).not.toBe(first);
  // Generate again offers Undo, which brings the last version back (the
  // draft for every student is pinned in comment-bank.test.js).
  await page.locator('#tq-generate').click();
  const third = await box.inputValue();
  await page.locator('#tq-generate').click();
  const toast = page.locator('#undo-toast');
  await expect(toast).toContainText('Replaced with a new version.');
  await toast.locator('button', { hasText: 'Undo' }).click();
  await expect(box).toHaveValue(third);
  await expect.poll(() => page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative)).toBe(third);
  // The sentences in the boxes follow the comment that came back.
  await page.locator('#wc-head-grade').click();
  const shown = await page.locator('.wc-line .wc-text').allTextContents();
  for (const t of shown) expect(third).toContain(t.trim().slice(0, 20));
});

test('Copy puts the comment on the clipboard and says Copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const text = await page.locator('#tq-narrative').inputValue();
  await page.locator('#tq-copy-btn').click();
  await expect(page.locator('#tq-copy-btn .qn-copy-label')).toHaveText('Copied');
  await expect(page.locator('#tq-copy-btn')).toHaveClass(/copied/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
});

test('a comment saved as HTML reads as text', async ({ page }) => {
  await open(page);
  await page.evaluate(() =>
    upsertTermRating('sci8', 'st7', 'term-2', {
      narrative: '<p>Jas drew <b>careful</b> diagrams.</p><p>Next: labels.</p>',
    }),
  );
  await page.locator('#gb-sidebar .student-row[data-sid="st7"]').click();
  await expect(page.locator('#tq-narrative')).toHaveValue('Jas drew careful diagrams.\nNext: labels.');
});

test('↑ ↓ change the student only outside a text field; ⌘ Return approves and moves on', async ({ page }) => {
  await open(page);
  await page.locator('.qn-name').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await page.locator('#tq-read').click();
  await page.locator('#tq-narrative').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.qn-name')).toHaveText('Hannah Berg');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
});

test('Work Habits: a rating saves in place and the count follows', async ({ page }) => {
  await open(page);
  await expect(page.locator('#wc-head-habits')).toContainText('0 of 6 Rated');
  const slider = page.locator('.qn-hs[data-habit="part"]');
  await page.locator('.qn-hs-stop[data-habit="part"][data-value="4"]').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Consistently');
  await expect(page.locator('#wc-head-habits')).toContainText('1 of 6 Rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({ part: 4 });
  // Each habit's name says what it means as its tooltip.
  await expect(page.locator('.wc-box[data-part="habits"] .wc-fact-name').nth(1)).toHaveText(
    'Comes Ready, Uses Class Time',
  );
  await expect(page.locator('.wc-box[data-part="habits"] .wc-fact-name').nth(5)).toHaveAttribute(
    'title',
    'Phone away when asked; devices for learning, not distraction.',
  );
  // The chosen stop clicked again clears the habit.
  await page.locator('.qn-hs-stop[data-habit="part"][data-value="4"]').click();
  await expect(slider).not.toHaveAttribute('aria-valuenow', /./);
  await expect(page.locator('#wc-head-habits')).toContainText('0 of 6 Rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({});
});

test('⋯ Edit Student opens the dialog; a save redraws the name', async ({ page }) => {
  await open(page);
  await page.locator('#tq-more-btn').click();
  await page.locator('[data-action="tqEditStudent"]').click();
  const dialog = page.getByRole('dialog', { name: 'Edit Student' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#edit-pref').fill('Cecilia');
  await dialog.locator('[data-action="saveEditStudent"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.qn-name')).toHaveText('Cecilia Adeyemi');
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st1"] .student-row-name')).toHaveText(
    'Cecilia Adeyemi',
  );
});

/* Checks and approval (fullvision-generate-plan PR 11c, the "Review-screen
   states" mockup). */
test.describe('checks and approval', () => {});

test.describe('on a 1366 × 768 laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('no overflow; the page scrolls as one', async ({ page }) => {
    await open(page);
    expect(await overflow(page)).toEqual([]);
    await expect(page.locator('#tq-approve-next')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.qn')).overflowY)).toBe('auto');
  });
});

test('end to end: rate, generate, approve, move on, and the report prints it', async ({ page }) => {
  await open(page);
  await page.locator('.qn-hs-stop[data-habit="part"][data-value="4"]').click();
  await page.locator('#tq-generate').click();
  const draft = await page.locator('#tq-narrative').inputValue();
  await page.locator('#tq-approve-next').click();
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st1"] .student-row-mark')).toHaveText('✓');

  await page.locator('.report-seg-btn[data-tab="progress"]').click();
  await page.locator('#gb-sidebar .student-row[data-sid="st1"]').click();
  await expect(page.locator('#picker-label')).toHaveText('Cece Adeyemi');
  const comment = page.locator('.report-sheet').first().locator('.report-comment-text');
  await expect(comment).toContainText(draft.split('. ')[0]);
});

/* The Sentences card and Browse Sentences (fullvision-generate-plan PR 11b,
   the "Review screen" and "Browse Sentences" mockups). */
test.describe('the Sentences card', () => {
  const rows = page => page.locator('#tq-sentences .qn-srow');
  const rowByLabel = (page, label) =>
    page.locator('#tq-sentences .qn-srow', { has: page.locator(`.qn-req-label:text-is("${label}")`) });

  test('one row per sentence with its part, source and handle; ⌥↑ moves a row, the comment follows with the name first; Reset Order', async ({
    page,
  }) => {
    await open(page);
    // A Note for the Report on Cece's best piece, so Generate uses the
    // best-piece sentence (plan PR 7) and At a Glance shows the note.
    await page.evaluate(() => {
      const best = ReportQuestionnaire.bestPiece(
        CommentBank.facts(
          'sci8',
          getStudents('sci8').find(s => s.id === 'st1'),
          'term-2',
        ),
      );
      saveScoreReportNote('sci8', 'st1', best.id, 'kept a field journal with dated sketches');
    });
    await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st2');
    await page.locator('#tq-narrative').waitFor({ state: 'attached' });
    await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
    await page.locator('#tq-narrative').waitFor({ state: 'attached' });
    await expect(page.locator('.qn-glance .qn-note-line')).toHaveText(
      'Note for the report: “kept a field journal with dated sketches”',
    );
    await clearComment(page);
    await page.locator('#tq-generate').click();
    const box = page.locator('#tq-narrative');
    const draft = await box.inputValue();
    const n = await page.evaluate(
      () => ReportQuestionnaire.sentencesOf(document.getElementById('tq-narrative').value).length,
    );
    // Every sentence is in exactly one row; the next-step sentences share
    // one Next Step row, with one source line (the LayoutE mockup).
    const perRow = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tq-sentences .qn-srow .qn-req-text')).map(
        el => ReportQuestionnaire.sentencesOf(el.textContent).length,
      ),
    );
    expect(perRow.reduce((a, b) => a + b, 0)).toBe(n);
    expect(perRow.some(k => k > 1)).toBe(true);
    await expect(rowByLabel(page, 'Next Step')).toHaveCount(1);
    await expect(page.locator('#tq-sentences .qn-srow-facts, #tq-sentences .qn-srow .qn-req-source')).toHaveCount(0);
    const rowCount = perRow.length;
    await expect(rows(page)).toHaveCount(rowCount);
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    await expect(rows(page).first().locator('.qn-req-text')).toHaveAttribute(
      'title',
      /from the year’s scores to this report/,
    );
    await expect(rows(page).first().locator('[data-do="wording"]')).toHaveText('Options ▾');
    await expect(page.locator('#tq-sentences .qn-sub')).toHaveCount(0);
    await expect(page.locator('#tq-sentences .qn-srow-handle:not(.qn-srow-spacer)')).toHaveCount(rowCount);
    await expect(page.locator('[data-do="reset"]')).toHaveCount(0);
    // The best piece's row, moved first, names Cece; the grade sentence now
    // uses her pronoun.
    const best = rowByLabel(page, 'Best Piece');
    const bestText = await best.locator('.qn-req-text').textContent();
    // Only the best-piece sentence is labelled Best Piece and tinted, on
    // the card and inside the comment; its source names the note.
    await expect(best).toHaveCount(1);
    await expect(best).toHaveClass(/\bbest\b/);
    await expect(page.locator('#tq-sentences .qn-srow.best')).toHaveCount(1);
    expect(bestText).toContain('she kept a field journal with dated sketches');
    await expect(best.locator('.qn-req-text')).toHaveAttribute('title', /· your note for the report/);
    await expect(page.locator('#tq-marks .qn-mark.best')).toHaveText(bestText);
    await expect(page.locator('#tq-marks .qn-mark')).toHaveCount(1);
    await best.locator('.qn-srow-handle').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Best Piece');
    await expect(rows(page).first().locator('.qn-req-text')).toContainText('Cece');
    // The grade sentence, in whichever of its frames (the grade step mixes
    // them by seed): the proficiency word, and her pronoun, not her name.
    await expect(rows(page).nth(1).locator('.qn-req-label')).toHaveText('Grade');
    const gradeText = await rows(page).nth(1).locator('.qn-req-text').textContent();
    expect(gradeText).toMatch(/\b(Emerging|Developing|Proficient|Extending)\b/);
    expect(gradeText).toMatch(/\b(She|she|Her|her)\b/);
    expect(gradeText).not.toContain('Cece');
    const moved = await box.inputValue();
    expect(moved).not.toBe(draft);
    expect(moved.startsWith(await rows(page).first().locator('.qn-req-text').textContent())).toBe(true);
    expect(bestText).not.toBe(await rows(page).first().locator('.qn-req-text').textContent());
    await expect(page.locator('[data-do="reset"]')).toHaveAttribute(
      'title',
      /Your order is kept when you generate again\./,
    );
    expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative)).toBe(moved);
    // The focus stays on the moved row's handle.
    await expect(rows(page).first().locator('.qn-srow-handle')).toBeFocused();
    // Generate again keeps the order; Reset Order puts the draft's back.
    await page.locator('#tq-generate').click();
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Best Piece');
    await page.locator('[data-do="reset"]').click();
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    await expect(page.locator('[data-do="reset"]')).toHaveCount(0);
    // The grade sentence first, naming her (in whichever of its frames).
    await expect(box).toHaveValue(/^(In Science 8, )?Cece(’s)? /);
  });

  test('Other Wording: up to three with the one in use ticked and its uses; a pick changes the comment; All N… opens Browse', async ({
    page,
  }) => {
    await open(page);
    // Six habits rated, so the comment has a habits part with alternatives
    // (two sentences, each its own Habits row; the first is used here).
    for (const key of await page.evaluate(() => CommentBank.HABITS.map(h => h.key))) {
      await page.locator(`.qn-hs-stop[data-habit="${key}"][data-value="4"]`).click();
    }
    await page.locator('#tq-generate').click();
    const home = rowByLabel(page, 'Work Habits').first();
    await home.locator('[data-do="wording"]').click();
    const menu = page.locator('#tq-wording-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.qn-menu-head')).toHaveText('Other ways to say this');
    const items = menu.locator('[role="menuitemradio"]');
    expect(await items.count()).toBeGreaterThan(1);
    expect(await items.count()).toBeLessThanOrEqual(3);
    await expect(items.first()).toHaveAttribute('aria-checked', 'true');
    await expect(items.first().locator('.qn-menu-meta')).toHaveText(/^In use/);
    await expect(items.nth(1)).toHaveAttribute('aria-checked', 'false');
    await expect(items.nth(1).locator('.qn-menu-meta')).toHaveText(
      /^(Not used yet in this class|Used for \d+ classmates?)$/,
    );
    await expect(menu.locator('.qn-menu-all')).toHaveText(/^All \d+ work habits sentences…$/);
    const alt = await items.nth(1).locator('.qn-menu-text').textContent();
    await items.nth(1).click();
    await expect(menu).toHaveCount(0);
    await expect(home.locator('.qn-req-text')).toHaveText(alt);
    await expect(page.locator('#tq-narrative')).toHaveValue(new RegExp(alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // All N… opens the sheet on that part.
    await home.locator('[data-do="wording"]').click();
    await menu.locator('.qn-menu-all').click();
    const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Work Habits');
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-sentence', { hasText: alt })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('an edited sentence is marked Edited, its source says so, and Generate Comment keeps it', async ({ page }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    const first = rows(page).first();
    const was = await first.locator('.qn-req-text').textContent();
    await page.evaluate(old => {
      const el = document.getElementById('tq-narrative');
      el.value = el.value.replace(old, 'Cece had a steady term in Science 8.');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, was);
    await expect(first.locator('.qn-edited')).toHaveText('Edited');
    await expect(first.locator('.qn-req-text')).toHaveText('Cece had a steady term in Science 8.');
    await expect(first.locator('.qn-req-text')).toHaveAttribute('title', 'Edited by you · kept when you regenerate');
    // Other Wording stays, so the sentence can go back to a bank wording.
    await expect(first.locator('[data-do="wording"]')).toHaveCount(1);
    await page.locator('#tq-generate').click();
    await expect(page.locator('#tq-narrative')).toHaveValue(/^Cece had a steady term in Science 8\. /);
    await expect(first.locator('.qn-edited')).toHaveText('Edited');
    // A sentence of the teacher's own, added at the end, gets a Your
    // Sentence row with Options (the InsertRows mockup).
    await toEnd(page);
    await page.keyboard.type(' She asks good questions.');
    const last = rows(page).last();
    await expect(last.locator('.qn-req-text')).toHaveText('She asks good questions.');
    await expect(last.locator('.qn-req-label')).toHaveText('Your Sentence');
    await expect(last.locator('.qn-req-text')).toHaveAttribute('title', 'Typed by you · kept when you regenerate');
    await expect(last.locator('[data-do="options"]')).toHaveText('Options ▾');
    await expect(last.locator('.qn-edited')).toHaveCount(0);
  });

  test('a typed sentence: its row, kept at its place by Generate Comment, Options with Add to My Bank and Remove From Comment', async ({
    page,
  }) => {
    await open(page);
    const seeded = ReportQuestionnaireSentences(await page.locator('#tq-narrative').inputValue());
    expect(seeded.length).toBe(2);
    await page.locator('#tq-generate').click();
    const box = page.locator('#tq-narrative');
    // The hand-written comment is not replaced: its sentences are Your
    // Sentence rows after the grade sentence, in their order, with the
    // bank's parts around them.
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    await expect(rows(page).nth(1).locator('.qn-req-text')).toHaveText(seeded[0]);
    await expect(rows(page).nth(2).locator('.qn-req-text')).toHaveText(seeded[1]);
    await expect(rows(page).nth(1).locator('.qn-req-label')).toHaveText('Your Sentence');
    expect(await rows(page).count()).toBeGreaterThan(3);
    // ⌘Z brings the hand-written comment back.
    await box.focus();
    await page.keyboard.press('ControlOrMeta+z');
    expect(ReportQuestionnaireSentences(await box.inputValue())).toEqual(seeded);
    await expect(rows(page)).toHaveCount(2);
    await page.locator('#tq-generate').click();
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    // Typed after the first sentence.
    const first = await rows(page).first().locator('.qn-req-text').textContent();
    await box.evaluate((el, t) => {
      const i = el.value.indexOf(t) + t.length;
      el.focus();
      el.setSelectionRange(i, i);
    }, first);
    await page.keyboard.type(' Cece explained her lab results clearly to the class.');
    const typed = rows(page).filter({ hasText: 'explained her lab results' });
    await expect(typed).toHaveCount(1);
    await expect(typed.locator('.qn-req-label')).toHaveText('Your Sentence');
    await expect(typed.locator('.qn-req-text')).toHaveAttribute('title', 'Typed by you · kept when you regenerate');
    await expect(typed.locator('.qn-srow-handle:not(.qn-srow-spacer)')).toHaveCount(1);
    await expect(rows(page).nth(1).locator('.qn-req-label')).toHaveText('Your Sentence');
    // Generate again: still there, second, with the bank's parts around it.
    await page.locator('#tq-generate').click();
    await expect(rows(page).nth(1).locator('.qn-req-label')).toHaveText('Your Sentence');
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    const text = await box.inputValue();
    expect(ReportQuestionnaireSentences(text)[1]).toBe('Cece explained her lab results clearly to the class.');
    expect(text.split('explained her lab results').length).toBe(2);
    // Kept too for a comment Generate did not write this visit: after a
    // reload the rows are recovered from the saved comment. (Cece's seeded
    // comment, typed by hand, is kept the same way: its two sentences follow
    // the grade sentence, in their order, with the bank's parts around.)
    await page.reload();
    await page.locator('#tq-narrative').waitFor({ state: 'attached' });
    await expect(rows(page).nth(1).locator('.qn-req-label')).toHaveText('Your Sentence');
    await page.locator('#tq-generate').click();
    await expect(rows(page).nth(1).locator('.qn-req-label')).toHaveText('Your Sentence');
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    // Options: Add to My Bank (the own-sentence box under the row) and
    // Remove From Comment; ⌘Z brings the sentence back.
    await typed.locator('[data-do="options"]').click();
    const menu = page.locator('#tq-options-menu');
    await expect(menu.locator('.qn-menu-head')).toHaveText('Your Sentence');
    await expect(menu.locator('[role="menuitem"] .qn-menu-text')).toHaveText(['Add to My Bank', 'Remove From Comment']);
    await expect(menu.locator('[role="menuitem"]').first().locator('.qn-menu-meta')).toHaveText(
      'For other students it fits',
    );
    await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
    await menu.locator('[data-do="ownAdd"]').click();
    const own = typed.locator('#tq-own');
    await expect(own.locator('#tq-own-input')).toHaveValue('Cece explained her lab results clearly to the class.');
    await page.keyboard.press('Escape');
    await expect(own).toHaveCount(0);
    await typed.locator('[data-do="options"]').click();
    await menu.locator('[data-do="remove"]').click();
    await expect(rows(page).filter({ hasText: 'explained her lab results' })).toHaveCount(0);
    await expect(box).not.toHaveValue(/explained her lab results/);
    await box.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(box).toHaveValue(/explained her lab results/);
    await expect(rows(page).filter({ hasText: 'explained her lab results' })).toHaveCount(1);
    // Removed again, the toast's Undo puts it back in its place.
    const withIt = await box.inputValue();
    await typed.locator('[data-do="options"]').click();
    await menu.locator('[data-do="remove"]').click();
    await expect(box).not.toHaveValue(/explained her lab results/);
    const toast = page.locator('#undo-toast');
    await expect(toast).toContainText('Removed from the comment.');
    await toast.locator('button', { hasText: 'Undo' }).click();
    await expect(box).toHaveValue(withIt);
    await expect(rows(page).filter({ hasText: 'explained her lab results' })).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative)).toBe(withIt);
  });

  /* The rows' boxes, to check nothing moves. */

  test('Browse Sentences… from a gap: opens on a part that can go in; Use adds at the gap, never in another row’s place; ⌘A Delete then Generate at once', async ({
    page,
  }) => {
    await open(page);
    await clearComment(page);
    await page.locator('#tq-generate').click();
    const box = page.locator('#tq-narrative');
    const gaps = page.locator('#tq-sentences .qn-gap');
    const n = await rows(page).count();
    const gradeWas = await rows(page).first().locator('.qn-req-text').textContent();
    // Every drafted part is in: Browse opens on Habits (nothing rated, so no
    // habits sentence fits), not on a part already there.
    await gaps.last().locator('.qn-gap-add').click();
    await page.locator('#tq-own [data-do="browseAt"]').click();
    const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
    await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Work Habits');
    // Use adds, even a second grade sentence (Colin, 2026-11-02: "i should
    // be able to add ones i like, and make the comment longer"): it goes
    // in at the gap and the first Grade row stays as it was.
    await sheet.locator('[role="tab"]', { hasText: 'Grade' }).click();
    const use = sheet.locator('.qn-browse-use:enabled').first();
    await expect(use).toHaveAttribute('title', /^Puts this sentence in Cece’s comment/);
    await use.click();
    await expect(rows(page)).toHaveCount(n + 1);
    await expect(rowByLabel(page, 'Grade')).toHaveCount(2);
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    expect(await rows(page).first().locator('.qn-req-text').textContent()).toBe(gradeWas);
    await expect(rowByLabel(page, 'Next Step')).toHaveCount(1);
    // A Best Piece sentence from the same sheet, with the best-piece row
    // gone, goes in at the gap: its Use says so.
    await page.keyboard.press('Escape');
    const gone = await rowByLabel(page, 'Best Piece').locator('.qn-req-text').textContent();
    await box.evaluate((el, t) => {
      el.value = el.value.replace(' ' + t, '').replace(t, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, gone);
    await expect(rowByLabel(page, 'Best Piece')).toHaveCount(0);
    await gaps.last().locator('.qn-gap-add').click();
    await page.locator('#tq-own [data-do="browseAt"]').click();
    await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Best Piece');
    await expect(sheet.locator('.qn-browse-use:enabled').first()).toHaveAttribute(
      'title',
      'Puts this sentence in Cece’s comment, at the place you chose.',
    );
    await sheet.locator('.qn-browse-use:enabled').first().click();
    await expect(rows(page).last().locator('.qn-req-label')).toHaveText('Best Piece');
    await expect(rows(page)).toHaveCount(n + 1);
    await page.keyboard.press('Escape');
    // A typed sentence, then ⌘A, Delete and Generate at once: nothing
    // deleted comes back.
    await toEnd(page);
    await page.keyboard.type(' Cece explained her lab results clearly to the class.');
    await expect(rowByLabel(page, 'Your Sentence')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.locator('#tq-generate').click();
    await expect(rowByLabel(page, 'Your Sentence')).toHaveCount(0);
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    expect(await box.inputValue()).not.toContain('explained her lab results');
    await expect(rowByLabel(page, 'Best Piece')).toHaveCount(1);
  });

  test('Write Your Own… at a gap puts a typed row there; Browse Sentences… from a gap inserts with Use; the keyboard path', async ({
    page,
  }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    const box = page.locator('#tq-narrative');
    const gaps = page.locator('#tq-sentences .qn-gap');
    // Keyboard: the pill is focusable in order with the rows; Enter opens
    // the writing box; ⌥↓ on a row's handle still moves a row.
    await rows(page).first().locator('.qn-srow-handle').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(gaps.first().locator('.qn-gap-add')).toBeFocused();
    await expect(gaps.first().locator('.qn-gap-add')).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    const own = page.locator('#tq-sentences .qn-own-row #tq-own');
    await expect(own.locator('#tq-own-input')).toBeFocused();
    await expect(page.locator('#tq-sentences .qn-own-row .qn-req-label')).toHaveText('Your Sentence');
    await expect(own.locator('#tq-own-save')).toHaveText('Add Here');
    await expect(own.locator('#tq-own-save')).toBeDisabled();
    await own.locator('#tq-own-input').fill('Cece explained her lab results clearly to the class');
    await expect(own.locator('#tq-own-save')).toBeEnabled();
    await own.locator('#tq-own-input').press('Enter');
    await expect(own).toHaveCount(0);
    const typed = rows(page).nth(1);
    await expect(typed.locator('.qn-req-label')).toHaveText('Your Sentence');
    await expect(typed.locator('.qn-req-text')).toHaveText('Cece explained her lab results clearly to the class.');
    await expect(typed).toHaveClass(/\badded\b/);
    await expect(typed.locator('[data-do="options"]')).toBeFocused();
    expect(ReportQuestionnaireSentences(await box.inputValue())[1]).toBe(
      'Cece explained her lab results clearly to the class.',
    );
    // ⌥↓ on its handle moves it down; the comment follows.
    await typed.locator('.qn-srow-handle').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(rows(page).nth(2).locator('.qn-req-label')).toHaveText('Your Sentence');
    expect(ReportQuestionnaireSentences(await box.inputValue())[2]).toBe(
      'Cece explained her lab results clearly to the class.',
    );
    // Browse Sentences… from the last gap: a second Best Piece sentence is
    // added there; the first stays.
    const n = await rows(page).count();
    await gaps.last().locator('.qn-gap-add').click();
    await page.locator('#tq-own [data-do="browseAt"]').click();
    const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
    await expect(sheet).toBeVisible();
    await sheet.locator('[role="tab"]', { hasText: 'Best Piece' }).click();
    const use = sheet.locator('.qn-browse-use:enabled').first();
    const pick = await use.locator('..').locator('.qn-browse-sentence').textContent();
    await use.click();
    await expect(rows(page)).toHaveCount(n + 1);
    await expect(rowByLabel(page, 'Best Piece')).toHaveCount(2);
    expect((await rowByLabel(page, 'Best Piece').last().locator('.qn-req-text').textContent()).slice(4)).toBe(
      pick.slice(4),
    );
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(gaps.last().locator('.qn-gap-add')).toBeFocused();
  });

  test('Tab and Shift-Tab stay inside Browse Sentences (step 4 group 3 #64)', async ({ page }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    await page.locator('#tq-browse-btn').click();
    const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
    await expect(sheet).toBeVisible();
    const inside = () => sheet.evaluate(d => d.contains(document.activeElement));
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside()).toBe(true);
    }
  });

  test('Browse Sentences: a sentence that does not fit, used for a classmate, goes in as written and Approve stays on', async ({
    page,
  }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    const box = page.locator('#tq-narrative');
    // A classmate's comment holds a Grade sentence for another case.
    await page.locator('#tq-browse-btn').click();
    const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
    await sheet.locator('#tq-browse-all').click();
    const emerging = sheet.locator('.qn-browse-group[data-case="p:Emerging"]');
    await emerging.locator('.qn-browse-head').click();
    const pick = await emerging.locator('.qn-browse-sentence').first().textContent();
    await page.evaluate(t => {
      const st = getStudents('sci8').find(s => s.id !== 'st1' && s.pronouns === 'she/her');
      const text = t.replace(/Cece/g, st.preferredName || st.firstName);
      upsertTermRating('sci8', st.id, ReportBlocks.getTermId(), { narrative: text });
    }, pick);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    const n = await rows(page).count();
    const before = await box.inputValue();
    await page.locator('#tq-browse-btn').click();
    await sheet.locator('#tq-browse-all').click();
    await emerging.locator('.qn-browse-head').click();
    // Least used first: the classmate's sentence is now further down.
    const row = emerging.locator('.qn-browse-row').filter({ hasText: pick });
    await expect(row.locator('.qn-browse-shared')).toHaveText('1');
    await expect(row.locator('.qn-browse-shared')).toHaveAttribute('title', 'Used for 1 other student in this class');
    await row.locator('.qn-browse-use').click();
    await page.keyboard.press('Escape');
    // Added, never in another row's place: the Grade row is still Cece's.
    await expect(rows(page)).toHaveCount(n + 1);
    await expect(rowByLabel(page, 'Grade')).toHaveCount(1);
    await expect(rowByLabel(page, 'Your Sentence').filter({ hasText: pick })).toHaveCount(1);
    expect(await box.inputValue()).toContain(pick);
    expect((await box.inputValue()).length).toBeGreaterThan(before.length);
    await expect(page.locator('#tq-approve-next')).toBeEnabled();
  });

  test('Browse Sentences: the parts, Fits, least used first, Use and In Use, search; the height is remembered', async ({
    page,
  }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    // Cece's habits: five Consistently, Uses Feedback Sometimes, so the
    // Habits part has her own cases.
    for (const k of ['completes', 'ready', 'others', 'part', 'devices']) {
      await page.locator(`.qn-hs-stop[data-habit="${k}"][data-value="4"]`).click();
    }
    await page.locator('.qn-hs-stop[data-habit="feedback"][data-value="2"]').click();
    await page.locator('#tq-browse-btn').click();
    const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[role="tab"]')).toHaveText([
      'Grade',
      'Best Piece',
      'Strength',
      'Work Habits',
      'Missing Work',
      'Next Step',
      'Support',
      'Closing',
    ]);
    await expect(sheet.locator('#tq-browse-search')).toBeFocused();
    // No "Least used first" label, no hint, no grey line under a sentence.
    await expect(sheet.locator('.qn-browse-order, .qn-browse-hint, .qn-browse-meta')).toHaveCount(0);
    await expect(sheet.locator('.qn-browse-bar .btn')).toHaveText('+ Write Your Own');
    // Grade: the one in use, In Use, and the count. The sentences sit
    // under headings that name the case; Cece's own case is first, marked
    // with her name and open.
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Fits Cece · \d+$/);
    await expect(sheet.locator('#tq-browse-all')).toHaveText(/^All · \d+$/);
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-inuse')).toHaveText('In the Comment');
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-unuse')).toHaveAccessibleName('Remove From Comment');
    const heads = sheet.locator('.qn-browse-head');
    await expect(heads.first().locator('.qn-browse-head-label')).toHaveText('Proficient');
    await expect(sheet.locator('.qn-chip-own')).toHaveCount(0);
    await expect(heads.first()).toHaveAttribute('aria-expanded', 'true');
    // Every sentence: a frame with the word as a slot sits under every
    // proficiency word, previewed for that word; only Cece's own fits.
    await sheet.locator('#tq-browse-all').click();
    await expect(heads.locator('.qn-browse-head-label')).toContainText([
      'Proficient',
      'Excellent',
      'Very Good',
      'Good',
      'Satisfactory',
      'Minimally Acceptable',
      'Extending',
      'Developing',
      'Emerging',
    ]);
    const emerging = sheet.locator('.qn-browse-group[data-case="p:Emerging"]');
    await emerging.locator('.qn-browse-head').click();
    await expect(emerging.locator('.qn-browse-sentence').first()).toHaveText(/Emerging/);
    // Another case's sentence still has Use (Colin, 2026-11-02: "don't
    // block users from custom actions"): it goes in as written.
    await expect(emerging.locator('.qn-browse-use').first()).toBeEnabled();
    await expect(emerging.locator('.qn-browse-use').first()).toHaveAttribute(
      'title',
      'Puts this sentence in Cece’s comment as written, as your own sentence. It may not match Cece’s marks, so check it.',
    );
    const satisfactory = sheet.locator('.qn-browse-group[data-case="w:C"]');
    await satisfactory.locator('.qn-browse-head').click();
    await expect(satisfactory.locator('.qn-browse-sentence').first()).toHaveText(
      /a C\b.*satisfactory|satisfactory.*a C\b/,
    );
    // Habits: every habit at every rating is its own case, all 24 shown with
    // Every sentence, each with its frames (hl001–hl120, four or more a
    // cell); Cece's rated cells come first and open, the rest closed; a
    // closed case opens on a click.
    await sheet.locator('[role="tab"]', { hasText: 'Work Habits' }).click();
    await expect(sheet.locator('#tq-browse-all')).toHaveAttribute('aria-pressed', 'true');
    const labels = await heads.locator('.qn-browse-head-label').allTextContents();
    const cells = labels.filter(l => / · (Consistently|Usually|Sometimes|Rarely)$/.test(l));
    expect(cells.length).toBe(24);
    expect(cells).toContain('Uses Feedback · Sometimes');
    const cellGroups = sheet.locator('.qn-browse-group[data-case^="cell:"]');
    await expect(cellGroups).toHaveCount(24);
    for (const g of await cellGroups.all()) {
      expect(await g.locator('.qn-browse-row').count()).toBeGreaterThanOrEqual(4);
      await expect(g.locator('.qn-browse-none')).toHaveCount(0);
      expect(Number(await g.locator('.qn-browse-head-n').textContent())).toBeGreaterThanOrEqual(4);
    }
    const ownHeads = sheet.locator('.qn-browse-group.own .qn-browse-head');
    // After Cece's own cases (the habits part for families among them, under
    // Summary): the other cells, then the IE comment's Strong Habits.
    const rest = labels.slice(await ownHeads.count());
    expect(rest.slice(0, 18).every(l => / · (Consistently|Usually|Sometimes|Rarely)$/.test(l))).toBe(true);
    expect(rest[18]).toMatch(/^Strong Habits/);
    await expect(ownHeads.first().locator('.qn-browse-head-label')).toHaveText('Completes Work · Consistently');
    await expect(ownHeads.nth(4).locator('.qn-browse-head-label')).toHaveText('Uses Feedback · Sometimes');
    for (const h of await ownHeads.all()) await expect(h).toHaveAttribute('aria-expanded', 'true');
    const feedback = sheet.locator('.qn-browse-group[data-case="cell:feedback:2"]');
    await expect(feedback.locator('.qn-browse-row').first()).toBeVisible();
    await expect(feedback.locator('.qn-browse-use:not([disabled])').first()).toBeVisible();
    const closed = sheet.locator('.qn-browse-group:not(.own)').first();
    await expect(closed.locator('.qn-browse-head')).toHaveAttribute('aria-expanded', 'false');
    await expect(closed.locator('.qn-browse-group-rows')).toBeHidden();
    await closed.locator('.qn-browse-head').click();
    await expect(closed.locator('.qn-browse-head')).toHaveAttribute('aria-expanded', 'true');
    await expect(closed.locator('.qn-browse-group-rows')).toBeVisible();
    await expect(closed.locator('.qn-browse-head')).toBeFocused();
    // Next Step: Use from inside a group puts a sentence in the comment and the row says In Use.
    await sheet.locator('[role="tab"]', { hasText: 'Next Step' }).click();
    await sheet.locator('#tq-browse-fits').click();
    await expect(sheet.locator('#tq-browse-fits')).toHaveAttribute('aria-pressed', 'true');
    const rowsList = sheet.locator('.qn-browse-row');
    const fitCount = Number((await sheet.locator('#tq-browse-fits').textContent()).split(' · ')[1]);
    await expect(rowsList).toHaveCount(fitCount);
    const ownGroup = sheet.locator('.qn-browse-group.own').first();
    // Her own competencies' course-set sentences come first (Nov 4), each
    // group under the competency's name; else the Science groups.
    const names = await page.evaluate(() =>
      CommentBank.facts(
        'sci8',
        getStudents('sci8').find(s => s.id === 'st1'),
        'term-2',
      ).comps.map(c => c.name),
    );
    const ownLabel = (await ownGroup.locator('.qn-browse-head-label').textContent()).trim();
    expect(names.indexOf(ownLabel) >= 0 || /^Science/.test(ownLabel)).toBe(true);
    const use = ownGroup
      .locator('.qn-browse-row')
      .filter({ has: page.locator('.qn-browse-use:not([disabled])') })
      .first();
    const text = await use.locator('.qn-browse-sentence').textContent();
    await use.locator('.qn-browse-use').click();
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-sentence').filter({ hasText: text })).toHaveCount(1);
    await expect(page.locator('#tq-narrative')).toHaveValue(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // Every sentence: more rows and more cases, Use on every one.
    await sheet.locator('#tq-browse-all').click();
    await expect(sheet.locator('#tq-browse-all')).toHaveAttribute('aria-pressed', 'true');
    expect(await rowsList.count()).toBeGreaterThan(fitCount);
    await expect(heads.locator('.qn-browse-head-label', { hasText: /^Social Studies · Evidence$/ })).toHaveCount(1);
    await expect(sheet.locator('.qn-browse-use[disabled]')).toHaveCount(0);
    // Search filters across the groups and opens the ones with a match.
    await sheet.locator('#tq-browse-search').fill('At home');
    // The list follows the box once typing pauses (120 ms).
    await expect
      .poll(async () => (await sheet.locator('.qn-browse-sentence').allTextContents()).every(t => /at home/i.test(t)))
      .toBe(true);
    const matched = sheet.locator('.qn-browse-group');
    expect(await matched.count()).toBeGreaterThan(1);
    for (const g of await matched.all()) {
      await expect(g.locator('.qn-browse-head')).toHaveAttribute('aria-expanded', 'true');
      await expect(g.locator('.qn-browse-head-label')).toHaveText(/For the Family$/);
    }
    for (const r of await sheet.locator('.qn-browse-sentence').all()) await expect(r).toHaveText(/at home/i);
    await sheet.locator('#tq-browse-search').fill('zzzz');
    await expect(sheet.locator('.qn-browse-empty')).toContainText('match “zzzz”.');
    await expect(sheet.locator('.qn-browse-elsewhere')).toHaveText('No sentence in the bank matches “zzzz”.');
    await sheet.locator('#tq-browse-search').fill('');
    // The bottom edge: ↓ makes the list taller; the height comes back next time.
    const list = sheet.locator('#tq-browse-list');
    await expect(list).toHaveCSS('max-height', '420px');
    await sheet.locator('#tq-browse-handle').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(list).toHaveCSS('max-height', '468px');
    await sheet.locator('.qn-browse-done').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('#tq-browse-btn')).toBeFocused();
    await page.locator('#tq-browse-btn').click();
    await expect(sheet.locator('#tq-browse-list')).toHaveCSS('max-height', '468px');
    expect(await page.evaluate(() => localStorage.getItem('fv-browse-sentences-height'))).toBe('468');
  });

  test('no overflow with the rows drawn, at 1440 and 1366', async ({ page }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    await expect(rows(page).first()).toBeVisible();
    expect(await overflow(page)).toEqual([]);
    await page.setViewportSize({ width: 1366, height: 768 });
    expect(await overflow(page)).toEqual([]);
  });
});

/* The Sentences card follows the comment without another Generate Comment
   (plan PR 11a: a rating redraws only the habits sentence; the States
   mockup's "Attendance entered" board shows the Attendance row). */

/* A sentence of the teacher's own (Colin, Nov 1): "+ Write Your Own" in
   Browse Sentences and in Other Wording, "+ Add to My Bank" at the top of
   the sheet, Add to My Bank on a typed sentence, Yours with ×. */

test('the character limit with the keyboard: Escape cancels; Return, Tab and a click outside save', async ({
  page,
}) => {
  await open(page);
  const saved = () => page.evaluate(() => CommentBank.classSettings('sci8').charLimit);
  const input = page.locator('#tq-limit-input');
  const btn = page.locator('#tq-count-btn');
  const openBox = async () => {
    await btn.click();
    await expect(input).toBeFocused();
  };
  const typeIn = async v => {
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(v);
  };
  // Return saves.
  await openBox();
  await typeIn('350');
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
  expect(await saved()).toBe(350);
  await expect(page.locator('#tq-limit-text')).toHaveText(/ · limit 350| · over the limit/);
  // Escape cancels: the blur as the box closes saves nothing.
  await openBox();
  await typeIn('600');
  await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(btn).toBeFocused();
  expect(await saved()).toBe(350);
  await expect(page.locator('#tq-limit-text')).not.toContainText('600');
  await expect(page.locator('#tq-count')).not.toContainText('600');
  await openBox();
  await expect(input).toHaveValue('350');
  // Tab out of the box saves.
  await typeIn('450');
  await page.keyboard.press('Tab');
  await expect.poll(saved).toBe(450);
  // The box stays open after Tab; a click outside saves and closes it.
  await expect(input).toHaveCount(1);
  await input.focus();
  await typeIn('500');
  await page.locator('.qn-name').click();
  await expect(input).toHaveCount(0);
  expect(await saved()).toBe(500);
  await expect(page.locator('#tq-limit-text')).toHaveText(/ · limit 500| · over the limit/);
});

/* From the small sibling files, now here. */

/* Attendance: the totals to date at each report; a note says when a total is
   added to the comment and warns when a total goes down. */

/* The IE deadline is withheld until a date is picked (Colin, Nov 2): Science 8
   as a Letter class (grade 10, so IE is on offer) and Cece on IE for Report
   2. The rest is pinned in tests/questionnaire-ie-deadline.test.js. */

/* Approve and Next is always on (Colin, 2026-11-25: "don't grey it out").
   An IE with no deadline picked: pressing it does not approve; it lands on
   the Deadline box, focuses Pick a Date and rings the box. Pick a date and
   the second press approves. */
for (const font of FONTS) {
  test(
    'Approve and Next on an IE with no deadline goes to the deadline box; after a date is picked it approves (' +
      font +
      ' font)',
    async ({ page }) => {
      await page.goto('/login.html?demo=1');
      await page.waitForURL(/\/dashboard/, { timeout: 15000 });
      await page.waitForFunction(() => getAssessments('sci8').length > 0);
      await page.evaluate(() => {
        COURSES.sci8.gradingSystem = 'letter';
        COURSES.sci8.gradeLevel = '10';
        clearProfCache();
      });
      await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
      await page.locator('#tq-narrative').waitFor({ state: 'attached' });
      await page.locator('#report-period').selectOption('Report 2');
      await page.locator('#tq-narrative').waitFor({ state: 'attached' });
      await page.evaluate(() => {
        upsertTermRating('sci8', 'st1', 'term-2', {
          reportingBasis: 'ie',
          ieDeadline: null,
          narrative: '',
          approvedAt: null,
        });
        clearProfCache();
      });
      await page.locator('#report-period').selectOption('Report 1');
      await page.locator('#report-period').selectOption('Report 2');
      await expect(page.locator('.qn-grade-big')).toHaveText('IE');
      await useFont(page, font);
      await expect(page.locator('[data-tq-check]')).toHaveCount(0);

      const approve = page.locator('#tq-approve-next');
      await expect(approve).toBeEnabled();
      const who = await page.locator('.qn-name').textContent();
      await approve.click();
      // Not approved; the Deadline box is focused and ringed once.
      await expect(page.locator('#tq-deadline-btn')).toBeFocused();
      await expect(page.locator('.qn-attn')).toHaveCount(1);
      await expect(page.locator('.qn-name')).toHaveText(who);
      expect(await page.evaluate(() => !!getStudentTermRating('sci8', 'st1', 'term-2').approvedAt)).toBe(false);
      await expect(approve).toBeEnabled();
      // The ring goes by itself.
      await expect(page.locator('.qn-attn')).toHaveCount(0, { timeout: 4000 });

      // Pick a date; the next press approves and opens the next student.
      await page.locator('#tq-deadline-btn').click();
      await page.locator('#tq-cal .qn-cal-day:not([disabled])').last().click();
      await approve.click();
      await expect(page.locator('.qn-name')).not.toHaveText(who);
      expect(await page.evaluate(() => !!getStudentTermRating('sci8', 'st1', 'term-2').approvedAt)).toBe(true);
    },
  );
}

/* An IE student with no comment: a Required part with no sentence shows one
   button in its place, never the grey source line. */

/* The arrow keys (Nov 3 sweep, step 4 group 2 #53 and group 3 #68): on a Work
   Habits slider they step, set and clear a rating; in a menu they move
   between its items; neither opens another student. Menus stay inside a
   short window: Other Wording and Support on a low row open upward or scroll
   inside a box that ends at the window's foot. */

/* + Add to My Bank (Nov 3 sweep, step 4). */

/* Undo on Other Wording (Nov 3 sweep, step 4 group 3 #67): a bank sentence's
   row can be removed, and an edited one can go back to the bank's wording. */

/* The address follows the open student and class (Nov 3 sweep, step 4 group 3
   #70), so a reload reopens the same place. */
test('the address follows the student; a reload reopens that student', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await expect(page).toHaveURL(/\/reports\?course=sci8&tab=questionnaire&student=st1$/);
  await page.locator('#gb-sidebar .student-row[data-sid="st2"]').click();
  await expect(page.locator('.qn')).toHaveAttribute('data-sid', 'st2');
  await expect(page).toHaveURL(/student=st2$/);
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn')).not.toHaveAttribute('data-sid', 'st2');
  const next = await page.locator('.qn').getAttribute('data-sid');
  await expect(page).toHaveURL(new RegExp('student=' + next + '$'));
  await page.reload();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await expect(page.locator('.qn')).toHaveAttribute('data-sid', next);
});

/* The sheet's sliders hold their words, in the page font and a wide one. */
for (const font of FONTS) {
  test(
    'Browse Sentences: the part tabs and Fits | All show every word, no sideways scroll (' + font + ' font)',
    async ({ page }) => {
      await open(page);
      await page.locator('#tq-generate').click();
      await page.locator('#tq-browse-btn').click();
      await useFont(page, font);
      const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
      await expect(sheet).toBeVisible();
      const clipped = await sheet.evaluate(
        el =>
          [...el.querySelectorAll('.qn-browse-tab, .qn-browse-fits .seg-btn')].filter(
            b => b.scrollWidth > b.clientWidth + 1,
          ).length,
      );
      expect(clipped).toBe(0);
      expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      // The Fits | All switch is reached by Tab and works from the keyboard.
      await sheet.locator('#tq-browse-fits').focus();
      await page.keyboard.press('Tab');
      await expect(sheet.locator('#tq-browse-all')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(sheet.locator('#tq-browse-all')).toHaveAttribute('aria-pressed', 'true');
      await expect(sheet.locator('#tq-browse-all')).toBeFocused();
    },
  );
}
