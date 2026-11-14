import { test, expect } from '@playwright/test';

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
  await page.locator('#tq-narrative').waitFor();
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  // On the Report Card: a new report has no Teacher Comment block.
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
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
  // The toolbar: Approve and Next, the two icons; no Questions, no Save and Next.
  await expect(page.locator('#tq-approve-next')).toHaveText('Approve and Next ›');
  await expect(page.locator('#tq-edit-student-btn')).toBeVisible();
  await expect(page.locator('#tq-info-btn')).toBeVisible();
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
  await expect(page.locator('#tq-narrative')).toHaveAttribute('title', /^The student’s report comment\./);
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

  // The circled question mark opens Where This Information Comes From; Tab and Shift-Tab stay inside it.
  await page.locator('#tq-info-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Where This Information Comes From' });
  await expect(sheet).toBeVisible();
  const cards = sheet.locator('.qn-info-card');
  await expect(cards.nth(0).locator('.qn-info-row .qn-info-part')).toHaveText([
    'Grade',
    'Work Habits',
    'Best Piece',
    'Not Handed In',
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
  await expect(page.locator('#tq-info-btn')).toBeFocused();

  // Earlier reports are read only.
  await page.locator('[data-action="tqCommentTab"]').nth(1).click();
  await expect(page.locator('.qn-comment .qn-hint')).toContainText('Went home in');
  await expect(page.locator('#tq-narrative')).toHaveCount(0);
  await expect(page.locator('.qn-earlier')).toContainText('consistent, dependable student');
  // Back to this report for the rest.
  await page.locator('[data-action="tqCommentTab"]').nth(0).click();
  await page.locator('#tq-narrative').waitFor();

  // The header: name, pronouns, the Student Dashboard link there and back, the grade and the count.
  await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');
  await expect(page.locator('.qn-head-sub')).toHaveText('she/her · Student Dashboard ›');
  await expect(page.locator('.qn-grade-big')).toHaveText(/^\d\.\d$/);
  await expect(page.locator('.qn-grade-sub')).toHaveText(
    /^(Emerging|Developing|Proficient|Extending) · \d+ of \d+ assignments$/,
  );
  await page.locator('.qn-head-link').click();
  await page.waitForURL(/\/student\?id=st1/);
  await page.getByRole('link', { name: 'Term Questionnaire' }).click();
  await page.locator('#tq-narrative').waitFor();
  await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');

  // The Closing row shows the class's shared next step, while it is edited too (last: it opens the line editor).
  const r = await page.evaluate(() =>
    CommentBank.sharedNextStep('sci8', { termId: ReportBlocks.getTermId(), students: getStudents('sci8') }),
  );
  const closing = page.locator('#tq-row-closing');
  await expect(closing.locator('.qn-shared-step')).toContainText('Shared next step:');
  await expect(closing.locator('.qn-shared-step')).toContainText(r.count + ' of ' + r.total + ' students');
  await closing.locator('[data-do="editClosing"]').click();
  await expect(page.locator('#tq-row-closing .qn-line-input')).toBeVisible();
  await expect(page.locator('#tq-row-closing .qn-shared-step')).toContainText('Shared next step:');
});

test('Approve and Next sets Ready and the roster tick and opens the next student; an edit clears it', async ({
  page,
}) => {
  await open(page);
  const cece = page.locator('#gb-sidebar .student-row[data-sid="st1"]');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await expect(cece.locator('.student-row-note')).toHaveText('Needs Approval');

  await page.locator('#tq-approve-next').click();
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
  await expect(cece.locator('.student-row-mark')).toHaveText('✓');
  await expect(cece.locator('.student-row-note')).toHaveCount(0);

  // Not Ready leaves Cece out while another student is on screen.
  await page.locator('[data-action="tqRosterFilter"][data-filter="not-ready"]').click();
  await expect(page.locator('[data-filter="not-ready"]')).toHaveText('Not Ready 26');
  await expect(cece).toBeHidden();
  await page.locator('[data-action="tqRosterFilter"][data-filter="all"]').click();
  await cece.click();

  // An edit after approval clears it.
  await toEnd(page);
  await page.keyboard.type(' One more sentence.');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await expect(cece.locator('.student-row-note')).toHaveText('Needs Approval');

  // The text is kept, and is plain text.
  await page.reload();
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('#tq-narrative')).toHaveValue(/One more sentence\.$/);
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

test('the roster marks survive a sidebar redraw; arrows move without approving and skip students Not Ready hides', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tq-approve-next').click();
  await page.evaluate(() => refreshSidebar());
  const cece = page.locator('#gb-sidebar .student-row[data-sid="st1"]');
  await expect(cece.locator('.student-row-mark')).toHaveText('✓');
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st7"] .student-row-note')).toHaveText('Needs Approval');
  await expect(page.locator('#gb-sidebar-extra [data-filter="not-ready"]')).toHaveText('Not Ready 26');
  // Approve Hannah; with Not Ready on, ↓ from Noor (just above her) skips her.
  const row = sid => page.locator(`#gb-sidebar .student-row[data-sid="${sid}"]`);
  const ids = await page.evaluate(() => ReportQuestionnaire.getTqStudents().map(s => s.id));
  const [noor, hannah, sam] = [ids[1], ids[2], ids[3]];
  await row(hannah).click();
  await page.locator('#tq-approve-next').click();
  await row(noor).click();
  await page.locator('[data-action="tqRosterFilter"][data-filter="not-ready"]').click();
  await expect(row(hannah)).toBeHidden();
  await row(noor).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#gb-sidebar .student-row.selected')).toHaveAttribute('data-sid', sam);
  await expect(page.locator('.qn-name')).toHaveText('Sam Blackwood');
  // Sam's Demo comment has a sentence over 20 words: the count says so,
  // and Approve and Next stays on (Colin, 2026-11-02: "don't restrict
  // users").
  await expect(page.locator('#tq-ready')).toHaveText('2 of 27 Ready');
  await expect(page.locator('#tq-limit-text')).toHaveText(' · one sentence is over 20 words');
  await expect(page.locator('#tq-count-btn')).toHaveClass(/over/);
  await expect(page.locator('#tq-approve-next')).toBeEnabled();
  await row(noor).click();
  await expect(page.locator('#tq-ready')).toHaveText('2 of 27 Ready');
  // Leaving the questionnaire gives the grades back.
  await page.locator('[data-action="tqRosterFilter"][data-filter="all"]').click();
  await page.locator('.report-seg-btn[data-tab="progress"]').click();
  await expect(page.locator('#gb-sidebar .student-row-note')).toHaveCount(0);
  await expect(page.locator('#gb-sidebar-extra')).toHaveCount(0);
  // A row names its sheets only when the report runs past one (step 4
  // group 2 #9). Noor's Report Card fits one sheet since Nov 13 (no
  // boxes, Missing Work in the Assessments list): her row keeps its grade.
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await expect(row(noor).locator('.student-row-sheets')).toHaveCount(0);
  await expect(row(noor).locator('.student-row-grades')).not.toBeEmpty();
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
  // Again: a different mix. Undo: the previous draft, then the original.
  await page.locator('#tq-generate').click();
  const second = await box.inputValue();
  expect(second).not.toBe(first);
  await box.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(box).toHaveValue(first);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(box).toHaveValue(before);
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
  // The rows follow the comment that came back.
  const shown = await page.locator('#tq-sentences .qn-req-row[data-row] .qn-req-text').allTextContents();
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
  await page.locator('.qn-glance .qn-band').first().click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await page.locator('#tq-narrative').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.qn-name')).toHaveText('Hannah Berg');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
});

test('Work Habits: a rating saves in place and the count follows; nothing redraws', async ({ page }) => {
  await open(page);
  await expect(page.locator('#tq-rated')).toHaveText('0 of 6 rated');
  const grid = page.locator('.qn-habits');
  await grid.evaluate(el => (el.__mark = 'same'));
  const slider = page.locator('.qn-hs[data-habit="part"]');
  await page.locator('.qn-hs-stop[data-habit="part"][data-value="4"]').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Consistently');
  await expect(page.locator('#tq-rated')).toHaveText('1 of 6 rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({ part: 4 });
  expect(await grid.evaluate(el => el.__mark)).toBe('same');
  await expect(page.locator('.qn-habit-name').nth(1)).toHaveText('Comes Ready, Uses Class Time');
  // The compact grid: the scale's words head four columns, each stop under
  // its word; the rating area is 236 px.
  const fit = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.qn-habit-scale span')].map(e => e.getBoundingClientRect());
    const dots = [...document.querySelectorAll('.qn-hs[data-habit="part"] .qn-hs-dot')].map(e =>
      e.getBoundingClientRect(),
    );
    return {
      width: Math.round(document.querySelector('.qn-hs').getBoundingClientRect().width),
      off: heads.map((h, i) => Math.abs(h.x + h.width / 2 - (dots[i].x + dots[i].width / 2))),
    };
  });
  expect(fit.width).toBe(236);
  fit.off.forEach(d => expect(d).toBeLessThan(1));
  await expect(page.locator('.qn-habit-desc').nth(5)).toHaveText(
    'Phone away when asked; devices for learning, not distraction.',
  );
  // Each description is one line and, in the 470 px column, whole (no
  // ellipsis); a name is one line, cut with its full text in its title.
  const lines = await page.evaluate(() => ({
    cut: [...document.querySelectorAll('.qn-habit-desc')]
      .filter(el => el.scrollWidth > el.clientWidth)
      .map(el => el.textContent),
    tall: [...document.querySelectorAll('.qn-habit-name, .qn-habit-desc')].filter(
      el => el.getBoundingClientRect().height > 20,
    ).length,
    titled: [...document.querySelectorAll('.qn-habit-name')].every(el => el.title === el.textContent),
  }));
  expect(lines).toEqual({ cut: [], tall: 0, titled: true });
  // The chosen stop clicked again clears the habit.
  await page.locator('.qn-hs-stop[data-habit="part"][data-value="4"]').click();
  await expect(slider).not.toHaveAttribute('aria-valuenow', /./);
  await expect(page.locator('#tq-rated')).toHaveText('0 of 6 rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({});
});

test('Work Habits: the track snaps to the nearest stop, past the ends too, and a drag moves between stops', async ({
  page,
}) => {
  await open(page);
  const slider = page.locator('.qn-hs[data-habit="others"]');
  const track = await slider.locator('.qn-hs-track').boundingBox();
  const y = track.y + track.height / 2;
  // Each stop is under its column of the scale, half a column in.
  const col = track.width / 4;
  // Past the left end stop: Rarely.
  await page.mouse.click(track.x + 3, y);
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  // Past the right end stop: Consistently.
  await page.mouse.click(track.x + track.width - 3, y);
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  // A little right of the second stop: Sometimes.
  await page.mouse.click(track.x + col * 1.5 + 8, y);
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  // Dragged from Sometimes to the third stop: Usually, saved once let go.
  await page.mouse.move(track.x + col * 1.5, y);
  await page.mouse.down();
  await page.mouse.move(track.x + col * 2, y, { steps: 4 });
  await page.mouse.move(track.x + col * 2.5, y, { steps: 4 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({ others: 3 });
});

test('At a Glance: the year so far, the best piece and View All Skills', async ({ page }) => {
  await open(page);
  const expected = await page.evaluate(() => {
    const st = getStudents('sci8').find(s => s.id === 'st1');
    const f = CommentBank.facts('sci8', st, 'term-2');
    const rows = ReportQuestionnaire.glanceRows(f);
    return {
      best: ReportQuestionnaire.bestPiece(f).title,
      strongest: rows.strongest.name,
      next: rows.next.name,
      change: rows.change ? rows.change.name : null,
      comps: rows.comps.length,
      pieces: rows.strongest.scores.length,
    };
  });
  const labels = ['Strongest', 'Next Step'].concat(expected.change ? ['Biggest Change'] : []);
  await expect(page.locator('.qno-glance .qn-fact-label')).toHaveText(
    labels.concat(['Best Piece', 'Missing and Late']),
  );
  await expect(page.locator('.qno-glance .qn-fact').nth(0)).toContainText(expected.strongest);
  await expect(page.locator('.qno-glance .qn-fact').nth(1)).toContainText(expected.next);
  await expect(page.locator('.qn-best .qn-fact-body')).toContainText(expected.best);
  await expect(page.locator('.qno-glance .qn-sub')).toHaveText('So far this year · change since the Term 1 report');
  await expect(page.locator('.qno-glance [data-action="tqOpenSkills"]')).toHaveText(
    'View All ' + expected.comps + ' Skills ›',
  );
  // Strongest opens in place to the pieces behind its figure; a title opens
  // the grader on that piece.
  const toggle = page.locator('.qn-glance-toggle[data-row="strongest"]');
  const list = page.locator('#tq-glance-strongest');
  await expect(list).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(list.locator('li')).toHaveCount(expected.pieces);
  await toggle.click();
  await expect(list).toBeHidden();
  await toggle.click();
  await list.locator('.qn-glance-piece').first().click();
  await expect(page.locator('#grader-overlay')).toBeVisible();
});

test('Cece’s Voice: the answers, the private one marked, a quoted answer says In the comment', async ({ page }) => {
  await open(page);
  await expect(page.locator('.qn-voice .qn-card-title')).toHaveText('Cece’s Voice');
  const priv = page.locator('.qn-voice-row', { has: page.locator('.qn-chip-private') });
  await expect(priv.locator('.qn-fact-label')).toHaveText('To you only');
  await expect(priv).toContainText('grandma');
  const good = page.locator('.qn-voice-row', { hasText: 'Good at' });
  await expect(good.locator('.qn-chip-quoted')).toBeHidden();
  const text = await good.locator('.qn-voice-text').textContent();
  await toEnd(page);
  await page.keyboard.type(' She says: “' + text.trim() + '”');
  await expect(good.locator('.qn-chip-quoted')).toHaveText('In the comment');
});

test('the Edit Student icon opens the dialog; a save redraws the name', async ({ page }) => {
  await open(page);
  await page.locator('#tq-edit-student-btn').click();
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
test.describe('checks and approval', () => {
  test('before Generate: No comment yet with the habits rated; it goes once there is text', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const el = document.getElementById('tq-narrative');
      el.value = '';
      ReportQuestionnaire.tqNarrativeInput();
      ReportQuestionnaire.tqSaveNarrative();
    });
    await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
    await page.locator('#tq-empty').waitFor();
    await expect(page.locator('#tq-empty')).toContainText('No comment yet');
    await expect(page.locator('#tq-empty')).toContainText(
      'Rate the six work habits, then press Generate Comment. You can also type here.',
    );
    await expect(page.locator('#tq-empty-rated')).toHaveText('0 of 6 habits rated');
    // No count or Copy under it.
    await expect(page.locator('#tq-comment-foot')).toBeHidden();
    await page.locator('.qn-hs-stop[data-habit="part"][data-value="4"]').click();
    await expect(page.locator('#tq-empty-rated')).toHaveText('1 of 6 habits rated');
    // Clicking it puts the cursor in the box; typing hides it.
    await page.locator('#tq-empty').click();
    await expect(page.locator('#tq-narrative')).toBeFocused();
    await page.keyboard.type('Cece had a good term.');
    await expect(page.locator('#tq-empty')).toBeHidden();
    await expect(page.locator('#tq-comment-foot')).toBeVisible();
    await expect(page.locator('#tq-approve-next')).toBeEnabled();
  });

  test('the missing-work row waits for I checked this; a sentence over 20 words or past the limit leaves Approve on', async ({
    page,
  }) => {
    await open(page);
    // One assignment labelled Missing for Cece.
    const title = await page.evaluate(() => {
      const dated = getAssessments('sci8')
        .filter(x => x.date)
        .sort((x, y) => x.date.localeCompare(y.date));
      const a = dated[dated.length - 1];
      _cache.scores['sci8']['st1'] = (_cache.scores['sci8']['st1'] || []).filter(e => e.assessmentId !== a.id);
      clearProfCache();
      setAssignmentStatus('sci8', 'st1', a.id, 'NS');
      return a.title;
    });
    await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st2');
    await page.locator('#tq-narrative').waitFor();
    await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
    await page.locator('#tq-narrative').waitFor();
    await page.locator('#tq-generate').click();
    const row = page.locator('#tq-row-missing');
    await expect(row).toHaveClass(/flag/);
    await expect(row.locator('.qn-req-text')).toContainText(title);
    // The missing-work sentence is ringed inside the comment (the LayoutE mockup).
    await expect(page.locator('#tq-marks .qn-mark.missing')).toContainText(title);
    await expect(row.locator('.qn-req-source').last()).toHaveText(
      // Of the year's work to Report 2's end (Colin, 2026-11-03), not Term 2's alone.
      '1 of 37 · check that it is really missing before you approve',
    );
    const approve = page.locator('#tq-approve-next');
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAttribute(
      'title',
      'Saves this comment to the report card and opens the next student. Tick “I checked this” on the highlighted sentence first.',
    );
    await row.locator('[data-tq-check="missing"]').check();
    await expect(row).not.toHaveClass(/flag/);
    await expect(row.locator('.qn-req-ctrl')).toHaveClass(/on/);
    await expect(row.locator('.qn-req-source').last()).toHaveText('1 of 37 · checked');
    await expect(approve).toBeEnabled();
    // A sentence over 20 words: the count turns orange and says so;
    // Approve and Next stays on.
    await toEnd(page);
    await page.keyboard.type(' She ' + 'really '.repeat(19) + 'tries.');
    await expect(page.locator('#tq-count-btn')).toHaveClass(/over/);
    await expect(page.locator('#tq-limit-text')).toHaveText(' · one sentence is over 20 words');
    await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
    await expect(approve).toBeEnabled();
    // Over the class's limit, the count says so instead; Approve stays on.
    await page.evaluate(() => ReportQuestionnaire.tqLineChange({ dataset: { tqLimit: '1' }, value: '200' }));
    await expect(page.locator('#tq-count')).toHaveText(/^\d{3} of 200 characters$/);
    await expect(page.locator('#tq-limit-text')).toHaveText(' · over the limit');
    await expect(approve).toBeEnabled();
    await page.evaluate(() => ReportQuestionnaire.tqLineChange({ dataset: { tqLimit: '1' }, value: '' }));
    // Shortened: Approve and Next is back, and approving ticks the roster.
    await page.evaluate(() => {
      const el = document.getElementById('tq-narrative');
      el.value = el.value.replace(/ She really.*$/, '');
      ReportQuestionnaire.tqNarrativeInput();
    });
    await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
    await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
    await expect(page.locator('#gb-sidebar .student-row[data-sid="st1"] .student-row-mark')).toHaveText('✓');
  });

  test('a near-identical comment shows the class warning with Show Both', async ({ page }) => {
    await open(page);
    // Six habits rated and attendance entered, so Cece's draft has at least
    // five sentences beyond the grade sentence (which never counts as
    // shared). Noor's comment is then a copy of its first six sentences,
    // so the two share exactly five whatever the bank drafts.
    for (const key of await page.evaluate(() => CommentBank.HABITS.map(h => h.key))) {
      await page.locator(`.qn-hs-stop[data-habit="${key}"][data-value="4"]`).click();
    }
    await page.locator('#tq-att-absences').fill('3');
    await page.locator('#tq-att-absences').press('Tab');
    await page.locator('#tq-att-lates').fill('1');
    await page.locator('#tq-att-lates').press('Tab');
    await page.locator('#tq-generate').click();
    const cece = await page.locator('#tq-narrative').inputValue();
    expect(await page.evaluate(t => ReportQuestionnaire.sentencesOf(t).length, cece)).toBeGreaterThanOrEqual(6);
    await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st2');
    await page.locator('#tq-narrative').waitFor();
    await expect(page.locator('#tq-warn')).toHaveCount(0);
    await page.evaluate(
      t => {
        const el = document.getElementById('tq-narrative');
        el.value = ReportQuestionnaire.sentencesOf(t).slice(0, 6).join(' ');
        ReportQuestionnaire.tqNarrativeInput();
      },
      cece.replace(/Cece/g, 'Noor'),
    );
    await expect(page.locator('#tq-warn')).toContainText(
      /Five of these sentences are also in Cece Adeyemi’s comment\. Press Generate Comment for another version, or change a sentence\./,
    );
    // Show Both takes the warning's amber (the States mockup).
    const colours = await page
      .locator('#tq-warn')
      .evaluate(w => [
        getComputedStyle(w).color,
        getComputedStyle(w.querySelector('[data-action="tqShowBoth"]')).color,
      ]);
    expect(colours[1]).toBe(colours[0]);
    await page.locator('[data-action="tqShowBoth"]').click();
    const both = page.locator('#tq-both-overlay');
    await expect(both.locator('#tq-both-title')).toHaveText('Both Comments');
    await expect(both.locator('.qn-both-name').nth(0)).toHaveText('Noor Al-Rashid');
    await expect(both.locator('.qn-both-name').nth(1)).toHaveText('Cece Adeyemi');
    expect(await both.locator('.qn-both-s.shared').count()).toBeGreaterThanOrEqual(10);
    await page.keyboard.press('Escape');
    await expect(both).toHaveCount(0);
    await expect(page.locator('[data-action="tqShowBoth"]')).toBeFocused();
  });
});

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
    await page.locator('#tq-narrative').waitFor();
    await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
    await page.locator('#tq-narrative').waitFor();
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
    await expect(rowByLabel(page, 'Next Step').locator('.qn-req-source')).toHaveCount(1);
    const rowCount = perRow.length;
    await expect(rows(page)).toHaveCount(rowCount);
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    await expect(rows(page).first().locator('.qn-req-source')).toContainText('from the year’s scores to this report');
    await expect(rows(page).first().locator('[data-do="wording"]')).toHaveText('Options ▾');
    await expect(page.locator('#tq-sentences .qn-sub')).toHaveText(
      'Reword, edit or drag to reorder. The comment above follows.',
    );
    await expect(page.locator('#tq-sentences .qn-srow-handle[draggable="true"]')).toHaveCount(rowCount);
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
    await expect(best.locator('.qn-req-source')).toContainText('· your note for the report');
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
    await expect(page.locator('#tq-sentences .qn-sub')).toHaveText('Your order is kept when you generate again.');
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
    const home = rowByLabel(page, 'Habits').first();
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
    await expect(menu.locator('.qn-menu-all')).toHaveText(/^All \d+ habits sentences…$/);
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
    await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Habits');
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
    await expect(first.locator('.qn-req-source')).toHaveText('Edited by you · kept when you regenerate');
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
    await expect(last.locator('.qn-req-source')).toHaveText('Typed by you · kept when you regenerate');
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
    await expect(typed.locator('.qn-req-source')).toHaveText('Typed by you · kept when you regenerate');
    await expect(typed.locator('.qn-srow-handle[draggable="true"]')).toHaveCount(1);
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
    await page.locator('#tq-narrative').waitFor();
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
  const boxes = page =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('#tq-sentences .qn-req-row')).map(el => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.top), Math.round(r.height)];
      }),
    );

  test('the gap between rows: a line and + on hover with nothing moving; the + menu offers only the missing parts; one click puts the sentence there', async ({
    page,
  }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    const box = page.locator('#tq-narrative');
    const strengths = rowByLabel(page, 'Best Piece');
    await expect(strengths).toHaveCount(1);
    const gone = await strengths.locator('.qn-req-text').textContent();
    // The best-piece sentence deleted from the comment: its row goes (the
    // sample voice, Nov 4: Cece's strength is said in it).
    await box.evaluate((el, t) => {
      el.value = el.value.replace(' ' + t, '').replace(t, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, gone);
    await expect(strengths).toHaveCount(0);
    const n = await rows(page).count();
    // A gap after every row of the comment, none before the first; hidden
    // until hovered.
    const gaps = page.locator('#tq-sentences .qn-gap');
    await expect(gaps).toHaveCount(n);
    await expect(gaps.first()).toHaveAttribute('data-gap', '1');
    const plus = gaps.nth(1).locator('.qn-gap-add');
    await expect(plus).toHaveCSS('opacity', '0');
    const before = await boxes(page);
    const g = await gaps.nth(1).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y);
    await expect(plus).toHaveCSS('opacity', '1');
    await expect(gaps.nth(1).locator('.qn-gap-line')).toHaveCSS('opacity', '1');
    await expect(gaps.nth(1).locator('[role="tooltip"]')).toHaveText('Add a sentence here');
    await expect(gaps.nth(1).locator('[role="tooltip"]')).toHaveCSS('opacity', '1');
    expect(await boxes(page)).toEqual(before);
    // The + at the line's left edge, on the hairline between the rows.
    const p = await plus.boundingBox();
    expect(Math.abs(p.y + p.height / 2 - g.y)).toBeLessThan(2);
    expect(await boxes(page)).toEqual(before);
    // The menu: Add Here; Cece's own words first, as a Next Step sentence
    // (S18-F1: the sample Cece has answered the questionnaire); then the
    // Best Piece part (the only bank part missing that fits); Write Your
    // Own… and Browse Sentences…
    await plus.click();
    const menu = page.locator('#tq-add-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.qn-menu-head')).toHaveText(['Add Here', 'In Their Words', 'Sentence Bank']);
    const items = menu.locator('.qn-add-item');
    await expect(items).toHaveCount(2);
    await expect(items.first().locator('.qn-add-part')).toHaveText('Next Step');
    await expect(items.first().locator('.qn-menu-text')).toHaveText(
      /^Asked what she wants to get better at, Cece wrote: “/,
    );
    await expect(items.first().locator('.qn-menu-meta')).toHaveText('Her words, from her questionnaire');
    await expect(items.first()).toBeFocused();
    const bank = items.nth(1);
    await expect(bank.locator('.qn-add-part')).toHaveText('Best Piece');
    await expect(bank.locator('.qn-menu-text')).not.toHaveText('');
    await expect(bank.locator('.qn-menu-meta')).not.toHaveText('');
    await expect(menu.locator('.qn-menu-add')).toHaveText(['Write Your Own…', 'Browse Sentences…']);
    expect(await boxes(page)).toEqual(before);
    const sentence = await bank.locator('.qn-menu-text').textContent();
    const countWas = await page.locator('#tq-count').textContent();
    await bank.click();
    await expect(menu).toHaveCount(0);
    // The row at that gap, tinted, "added just now"; the comment has the
    // sentence at the same place; the count moved.
    const added = rows(page).nth(2);
    await expect(added.locator('.qn-req-label')).toHaveText('Best Piece');
    await expect(added).toHaveClass(/\badded\b/);
    await expect(added.locator('.qn-req-source')).toHaveText(/ · added just now$/);
    // The sentence is tinted in the comment too, like the best piece.
    await expect(page.locator('#tq-marks .qn-mark.added')).toHaveText(
      await added.locator('.qn-req-text').textContent(),
    );
    await expect(rows(page)).toHaveCount(n + 1);
    const text = await box.inputValue();
    const sentences = ReportQuestionnaireSentences(text);
    expect(sentences[2]).toBe(await added.locator('.qn-req-text').textContent());
    expect(sentences[2].replace(/^(She|Her)\b/, '')).toBe(sentence.replace(/^(She|Her|Cece’s|Cece)\b/, ''));
    await expect(page.locator('#tq-count')).toHaveText(text.length + ' characters');
    expect(await page.locator('#tq-count').textContent()).not.toBe(countWas);
    expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative)).toBe(text);
    await expect(added.locator('.qn-line-menu')).toBeFocused();
    // Now every bank part is in: only Cece's own words are offered (S18-F1,
    // the board: "With her answer on file, it offers this one first").
    await gaps.nth(1).locator('.qn-gap-add').click();
    await expect(menu.locator('.qn-add-item')).toHaveCount(1);
    await expect(menu.locator('.qn-add-item .qn-add-part')).toHaveText('Next Step');
    await expect(menu.locator('.qn-add-none')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(gaps.nth(1).locator('.qn-gap-add')).toBeFocused();
    // When the fade ends the tint, the mark and "added just now" go, in place.
    await expect(added).not.toHaveClass(/\badded\b/, { timeout: 7000 });
    await expect(added.locator('.qn-req-source')).not.toHaveText(/added just now/);
    await expect(page.locator('#tq-marks .qn-mark.added')).toHaveCount(0);
    // With her words in too, every part is in: the menu says so.
    const last = gaps.nth((await gaps.count()) - 1);
    await last.locator('.qn-gap-add').click();
    await menu.locator('.qn-add-item').first().click();
    await expect(menu).toHaveCount(0);
    await expect(rows(page).last().locator('.qn-req-source')).toHaveText(/^Her words, from her questionnaire/);
    await gaps.nth(1).locator('.qn-gap-add').click();
    await expect(menu.locator('.qn-add-item')).toHaveCount(0);
    await expect(menu.locator('.qn-add-none')).toHaveText(
      'Every part with a sentence that fits Cece is in the comment.',
    );
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

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
    await page.locator('#tq-add-menu [data-do="browseAt"]').click();
    const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
    await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Habits');
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
    await page.locator('#tq-add-menu [data-do="browseAt"]').click();
    await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Best Piece');
    await expect(sheet.locator('.qn-browse-use:enabled').first()).toHaveAttribute(
      'title',
      'Puts this sentence in Cece’s comment, at the place you chose.',
    );
    await sheet.locator('.qn-browse-use:enabled').first().click();
    await expect(rows(page).last().locator('.qn-req-label')).toHaveText('Best Piece');
    await expect(rows(page)).toHaveCount(n + 1);
    await page.keyboard.press('Escape');
    // The keyboard focus on a menu item is filled like a hover.
    await gaps.last().locator('.qn-gap-add').click();
    const item = page.locator('#tq-add-menu [role="menuitem"]').first();
    await expect(item).toBeFocused();
    expect(await item.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await item.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
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
    // Keyboard: the + is focusable in order with the rows; Enter opens the
    // menu; ⌥↓ on a row's handle still moves it.
    await rows(page).first().locator('.qn-srow-handle').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(gaps.first().locator('.qn-gap-add')).toBeFocused();
    await expect(gaps.first().locator('.qn-gap-add')).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    const menu = page.locator('#tq-add-menu');
    await expect(menu).toBeVisible();
    await menu.locator('[data-do="ownOpen"]').click();
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
    await menu.locator('[data-do="browseAt"]').click();
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
    await sheet.locator('#tq-browse-fits').click();
    await sheet.locator('#tq-fits-menu [data-fits="0"]').click();
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
    await sheet.locator('#tq-browse-fits').click();
    await sheet.locator('#tq-fits-menu [data-fits="0"]').click();
    await emerging.locator('.qn-browse-head').click();
    // Least used first: the classmate's sentence is now further down.
    const row = emerging.locator('.qn-browse-row').filter({ hasText: pick });
    await expect(row.locator('.qn-browse-meta')).toHaveText('Used for 1 classmate');
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
      'Strengths',
      'Habits',
      'Not Handed In',
      'Next Step',
      'Support',
      'Closing',
    ]);
    await expect(sheet.locator('#tq-browse-search')).toBeFocused();
    await expect(sheet.locator('.qn-browse-order')).toHaveText('Least used first');
    await expect(sheet.locator('.qn-browse-hint')).toHaveText(
      'The list scrolls. Drag the bottom edge to show more at once.',
    );
    // Grade: the one in use, In Use, and the count. The sentences sit
    // under headings that name the case; Cece's own case is first, marked
    // with her name and open.
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Fits Cece \d+ of \d+/);
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-inuse')).toHaveText('In Use');
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-meta')).toHaveText(/^In use/);
    const heads = sheet.locator('.qn-browse-head');
    await expect(heads.first().locator('.qn-browse-head-label')).toHaveText('Proficient');
    await expect(heads.first().locator('.qn-chip-own')).toHaveText('Cece');
    await expect(heads.first()).toHaveAttribute('aria-expanded', 'true');
    // Every sentence: a frame with the word as a slot sits under every
    // proficiency word, previewed for that word; only Cece's own fits.
    await sheet.locator('#tq-browse-fits').click();
    await sheet.locator('#tq-fits-menu [data-fits="0"]').click();
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
    await sheet.locator('[role="tab"]', { hasText: 'Habits' }).click();
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Every sentence \d+/);
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
    await sheet.locator('#tq-fits-menu [data-fits="1"]').click();
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Fits Cece \d+ of \d+/);
    const rowsList = sheet.locator('.qn-browse-row');
    const fitCount = Number((await sheet.locator('#tq-browse-n').textContent()).split(' of ')[0]);
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
    await sheet.locator('#tq-browse-fits').click();
    await expect(sheet.locator('#tq-fits-menu [role="option"]')).toHaveText([
      /Fits Cece\d+$/,
      /Every sentence for this part\d+$/,
    ]);
    await sheet.locator('#tq-fits-menu [data-fits="0"]').click();
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Every sentence \d+/);
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
test('a rating adds the Habits row and attendance adds and removes its row, without Generate', async ({ page }) => {
  await open(page);
  const rowByLabel = label =>
    page.locator('#tq-sentences .qn-srow', { has: page.locator('.qn-req-label:text-is("' + label + '")') });
  await page.locator('#tq-generate').click();
  await expect(rowByLabel('Habits')).toHaveCount(0);
  for (const k of ['completes', 'ready', 'others', 'part', 'feedback', 'devices']) {
    await page.locator(`.qn-hs-stop[data-habit="${k}"][data-value="4"]`).click();
  }
  // All six rated Consistently: the habits part for families, what Cece
  // does in two sentences, whichever frames the seed picks (Nov 4).
  const excellent = /hands in her work on time and comes to class ready to start\./;
  await expect(page.locator('#tq-narrative')).toHaveValue(excellent);
  await expect(page.locator('#tq-narrative')).toHaveValue(
    /listens to others, joins in class discussions, and uses feedback/,
  );
  await expect(rowByLabel('Habits')).toHaveCount(2);
  await expect(rowByLabel('Habits').first().locator('.qn-req-text')).toHaveText(excellent);

  await page.locator('#tq-att-absences').fill('3');
  await page.locator('#tq-att-absences').press('Tab');
  await page.locator('#tq-att-lates').fill('1');
  await page.locator('#tq-att-lates').press('Tab');
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');
  // One attendance sentence with both counts in the plan's number forms
  // ("three classes", "once"); the frame rotates (h60, h74-h78).
  const attendance = /[^.]*\bthree classes\b[^.]*\bonce\b[^.]*\.|[^.]*\bonce\b[^.]*\bthree classes\b[^.]*\./;
  await expect(page.locator('#tq-narrative')).toHaveValue(attendance);
  await expect(rowByLabel('Attendance')).toHaveCount(1);
  await expect(rowByLabel('Attendance')).toHaveClass(/\battendance\b/);
  await expect(rowByLabel('Attendance').locator('.qn-req-text')).toHaveText(attendance);
  await expect(rowByLabel('Attendance').locator('.qn-req-source')).toHaveText('From Attendance above · new');

  // Cleared: the sentence and its row go.
  await page.locator('#tq-att-absences').fill('');
  await page.locator('#tq-att-absences').press('Tab');
  await page.locator('#tq-att-lates').fill('');
  await page.locator('#tq-att-lates').press('Tab');
  await expect(page.locator('#tq-att-note')).toHaveText('Optional. Left out until entered.');
  await expect(page.locator('#tq-narrative')).not.toHaveValue(/three classes/);
  await expect(rowByLabel('Attendance')).toHaveCount(0);
  await expect(rowByLabel('Habits')).toHaveCount(2);
});

/* A sentence of the teacher's own (Colin, Nov 1): "+ Write Your Own" in
   Browse Sentences and in Other Wording, "+ Add to My Bank" at the top of
   the sheet, Add to My Bank on a typed sentence, Yours with ×. */
test('Write Your Own: saved from Browse Sentences, shown as Yours, used, and still there after a reload', async ({
  page,
}) => {
  await open(page);
  // Completes Work rated, so the Habits part has cases for Cece (nothing
  // comes from the assignment record, Nov 4).
  await page.locator('.qn-hs-stop[data-habit="completes"][data-value="4"]').click();
  await page.locator('#tq-generate').click();
  await page.locator('#tq-browse-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
  await sheet.locator('[role="tab"]', { hasText: 'Habits' }).click();
  // Under a case heading: "+ Write Your Own", bound to that case (no picker).
  const inCase = sheet.locator('.qn-browse-group-rows:not([hidden]) .qn-browse-add').first();
  await expect(inCase).toHaveText('+ Write Your Own');
  await inCase.click();
  const box = sheet.locator('#tq-own');
  await expect(box.locator('#tq-own-input')).toBeFocused();
  await expect(box.locator('#tq-own-part')).toHaveCount(0);
  await box.locator('.qn-line-cancel').click();
  await expect(box).toHaveCount(0);
  // At the top: "+ Add to My Bank" with Belongs Under.
  await expect(sheet.locator('.qn-browse-add-top')).toHaveText('+ Add to My Bank');
  await sheet.locator('.qn-browse-add-top').click();
  await expect(box.locator('#tq-own-input')).toBeFocused();
  await expect(box.locator('.qn-own-hint')).toHaveText(
    'Write it for this student. In the saved sentence, the words in brackets change for each student.',
  );
  await expect(box.locator('#tq-own-part')).toHaveValue('habits');
  await expect(box.locator('#tq-own-case')).toHaveValue('');
  await expect(box.getByLabel('Used For')).toHaveValue('');
  await expect(box.locator('label.qn-own-label', { hasText: 'Used For' })).toBeVisible();
  await expect(box.locator('#tq-own-case option').first()).toHaveText('Any Student');
  await expect(box).not.toContainText('slots');
  await expect(box.locator('#tq-own-save')).toBeDisabled();
  await box.locator('#tq-own-input').fill('Cece brings her notebook and starts the warm-up to keep up her pace.');
  await expect(box.locator('.qn-own-saved')).toHaveText(
    'Saved as: [Name] brings [his/her/their] notebook and starts the warm-up to keep up [his/her/their] pace.',
  );
  await expect(box.locator('.qn-own-why')).toHaveText(['“keep up” is a phrase families may not know; try “continue”.']);
  await expect(box.locator('#tq-own-save')).toBeEnabled();
  await box.locator('#tq-own-input').fill('Cece brings her notebook and starts the warm-up without a reminder.');
  await expect(box.locator('.qn-own-why')).toHaveCount(0);
  await box.locator('#tq-own-save').click();
  const mine = sheet.locator('.qn-browse-row', { has: page.locator('.qn-chip-yours') });
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.qn-chip-yours')).toHaveText('Yours · Any Student');
  await expect(mine.locator('.qn-browse-sentence')).toHaveText(
    'She brings her notebook and starts the warm-up without a reminder.',
  );
  await expect(mine.locator('.qn-browse-del')).toBeVisible();
  await expect(mine.locator('.qn-browse-use')).toBeFocused();
  await mine.locator('.qn-browse-use').click();
  await expect(mine.locator('.qn-browse-inuse')).toHaveText('In Use');
  await expect(page.locator('#tq-narrative')).toHaveValue(
    /She brings her notebook and starts the warm-up without a reminder\./,
  );
  await sheet.locator('.qn-browse-done').click();
  await page.reload();
  await page.locator('#tq-narrative').waitFor();
  await expect(page.locator('#tq-narrative')).toHaveValue(/She brings her notebook/);
  await page.locator('#tq-browse-btn').click();
  await sheet.locator('[role="tab"]', { hasText: 'Habits' }).click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveText(['Yours · Any Student']);
  // × removes it, Undo brings it back.
  await sheet.locator('.qn-browse-del').click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveCount(0);
  await expect(page.locator('#undo-toast')).toContainText('Removed from your bank.');
  await page.locator('#undo-toast .undo-toast-btn').click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveText(['Yours · Any Student']);
});

test('Write Your Own from Other Wording goes into the row; Add to My Bank on a typed sentence takes a part', async ({
  page,
}) => {
  await open(page);
  await clearComment(page);
  await page.locator('#tq-generate').click();
  const rows = p => p.locator('#tq-sentences .qn-srow');
  const row = rows(page).nth(1);
  await row.locator('[data-do="wording"]').click();
  const menu = page.locator('#tq-wording-menu');
  await expect(menu.locator('[role="menuitem"]').last()).toHaveText('+ Write Your Own');
  await menu.locator('[data-do="ownOpen"]').click();
  const box = page.locator('#tq-sentences #tq-own');
  await expect(box.locator('#tq-own-input')).toBeFocused();
  await expect(box.locator('#tq-own-part')).toHaveCount(0);
  await box.locator('#tq-own-input').fill('Cece used feedback on Biodiversity Field Journal to improve her draft.');
  await expect(box.locator('.qn-own-saved')).toHaveText(
    'Saved as: [Name] used feedback on [best piece] to improve [his/her/their] draft.',
  );
  await box.locator('#tq-own-input').press('Enter');
  await expect(box).toHaveCount(0);
  await expect(rows(page).nth(1).locator('.qn-req-text')).toHaveText(
    'She used feedback on “Biodiversity Field Journal” to improve her draft.',
  );
  await expect(page.locator('#tq-narrative')).toHaveValue(
    /She used feedback on “Biodiversity Field Journal” to improve her draft\./,
  );
  // A sentence typed into the box: Add to My Bank on its row, with Belongs Under.
  await toEnd(page);
  await page.keyboard.type(' Cece asks a question when a step is unclear.');
  const typed = rows(page).filter({ hasText: 'Cece asks a question' });
  await typed.locator('[data-do="options"]').click();
  await page.locator('#tq-options-menu [data-do="ownAdd"]').click();
  await expect(box.locator('#tq-own-input')).toHaveValue('Cece asks a question when a step is unclear.');
  await expect(box.locator('#tq-own-part option')).toHaveText([
    'Best Piece',
    'Strengths',
    'Habits',
    'Not Handed In',
    'Next Step',
  ]);
  await box.locator('#tq-own-part').selectOption('habits');
  await expect(box.locator('#tq-own-case option').first()).toHaveText('Any Student');
  await box.locator('#tq-own-save').click();
  await expect(box).toHaveCount(0);
  expect(
    await page.evaluate(() => PersonalBank.list().map(t => [t.text, t.condition.step, !!t.condition.general])),
  ).toEqual([
    ['{He} [asks|ask] a question when a step is unclear.', 'habits', true],
    ['{He} used feedback on {assignment} to improve {his} draft.', 'example', false],
  ]);
});

test('Add to My Bank from the comment box: the pill shows only on a typed sentence and opens the box under its row; × purges after the toast', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tq-generate').click();
  const box = page.locator('#tq-narrative');
  const pill = page.locator('#tq-sel-add');
  // A bank sentence selected: no pill.
  await box.evaluate(el => {
    el.focus();
    el.setSelectionRange(0, 12);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect(pill).toBeHidden();
  // A typed sentence selected: the pill, in the foot, clear of the text.
  await toEnd(page);
  await page.keyboard.type(' Cece asks a question when a step is unclear.');
  await expect(page.locator('#tq-sentences .qn-srow', { hasText: 'Cece asks a question' })).toHaveCount(1);
  await box.evaluate(el => {
    const i = el.value.indexOf('Cece asks');
    el.focus();
    el.setSelectionRange(i, i + 9);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('Add to My Bank');
  const foot = await page.locator('#tq-comment-foot').boundingBox();
  const text = await box.boundingBox();
  expect(foot.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
  await pill.click();
  const own = page.locator('#tq-sentences .qn-srow', { hasText: 'Cece asks a question' }).locator('#tq-own');
  await expect(own.locator('#tq-own-input')).toHaveValue('Cece asks a question when a step is unclear.');
  await expect(own.locator('#tq-own-input')).toBeFocused();
  await own.locator('#tq-own-part').selectOption('strengths');
  await own.locator('#tq-own-save').click();
  await expect(own).toHaveCount(0);
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(1);
  // × then no Undo: when the toast closes (its timer calls dismissUndoToast;
  // called here so the test does not wait on a timer) the sentence is purged.
  await page.locator('#tq-browse-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
  await sheet.locator('[role="tab"]', { hasText: 'Strengths' }).click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveText(['Yours · Any Student']);
  await sheet.locator('.qn-browse-del').click();
  await expect(page.locator('#undo-toast')).toBeVisible();
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(0);
  await page.evaluate(() => dismissUndoToast());
  await expect(page.locator('#undo-toast')).toHaveCount(0);
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(0);
  await page.reload();
  await page.locator('#tq-narrative').waitFor();
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(0);
  await page.locator('#tq-browse-btn').click();
  await sheet.locator('[role="tab"]', { hasText: 'Strengths' }).click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveCount(0);
});

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
test('attendance totals to date give this term without any math; a lower total warns', async ({ page }) => {
  await open(page);
  const pickReport = async n => {
    await page.locator('#report-period').selectOption('Report ' + n);
    await page.locator('#tq-att-absences').waitFor();
  };
  const enter = async (absences, lates) => {
    await page.locator('#tq-att-absences').fill(String(absences));
    await page.locator('#tq-att-absences').press('Tab');
    await page.locator('#tq-att-lates').fill(String(lates));
    await page.locator('#tq-att-lates').press('Tab');
  };
  await pickReport(1);
  await enter(4, 3);
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');

  await pickReport(2);
  await expect(page.locator('#tq-att-note')).toHaveText('Optional. Left out until entered.');
  await enter(10, 5);
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');

  // Back to Report 2 after a reload: the totals stay.
  await page.reload();
  await pickReport(2);
  await expect(page.locator('#tq-att-absences')).toHaveValue('10');
  await expect(page.locator('#tq-att-lates')).toHaveValue('5');

  // Lower than the last report: a warning, not a block.
  await page.locator('#tq-att-absences').fill('3');
  await page.locator('#tq-att-absences').press('Tab');
  await expect(page.locator('#tq-att-note')).toContainText('Lower than the 4 absences');
  await expect(page.locator('#tq-att-absences')).toHaveClass(/warn/);
});

/* The IE deadline is withheld until a date is picked (Colin, Nov 2): Science 8
   as a Letter class (grade 10, so IE is on offer) and Cece on IE for Report
   2. The rest is pinned in tests/questionnaire-ie-deadline.test.js. */
test('the IE deadline calendar keeps the focus: ‹ and › with clicks and keys, then ↓ ↑ never move to another student', async ({
  page,
}) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    COURSES.sci8.gradingSystem = 'letter';
    COURSES.sci8.gradeLevel = '10';
    clearProfCache();
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  await page.evaluate(() => {
    upsertTermRating('sci8', 'st1', 'term-2', { reportingBasis: 'ie', ieDeadline: null, narrative: '' });
    clearProfCache();
  });
  // Redraw on IE: the period picked again.
  await page.locator('#report-period').selectOption('Report 1');
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('.qn-grade-big')).toHaveText('IE');

  const name = page.locator('.qn-name');
  const who = await name.textContent();
  const url = page.url();
  await page.locator('#tq-deadline-btn').click();
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  const inCal = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#tq-cal'));
  const title = () => page.locator('#tq-cal .qn-cal-title').textContent();
  const first = await title();

  // A real click on ›: the month moves, the focus stays in the calendar,
  // and ↓ ↑ stay with this student.
  await page.locator('#tq-cal [data-dir="1"]').click();
  expect(await title()).not.toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(name).toHaveText(who);
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  expect(page.url()).toBe(url);

  // ‹ by click, then › by Enter on the focused button.
  await page.locator('#tq-cal [data-dir="-1"]').click();
  expect(await title()).toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);
  await page.locator('#tq-cal [data-dir="1"]').focus();
  await page.keyboard.press('Enter');
  expect(await title()).not.toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);

  // A click on the calendar's title (no control) keeps the focus there too.
  await page.locator('#tq-cal .qn-cal-title').click();
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);

  // Escape closes it and gives the focus back to Pick a Date.
  await page.keyboard.press('Escape');
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  await expect(page.locator('#tq-deadline-btn')).toBeFocused();
});

/* The arrow keys (Nov 3 sweep, step 4 group 2 #53 and group 3 #68): on a Work
   Habits slider they step, set and clear a rating; in a menu they move
   between its items; neither opens another student. Menus stay inside a
   short window: Other Wording and Support on a low row open upward or scroll
   inside a box that ends at the window's foot. */
test('slider keys and menu keys never change the student; menus open inside a short window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await open(page);
  const shown = () => page.locator('.qn').getAttribute('data-sid');
  const inWindow = loc =>
    loc.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
  const sid = await shown();

  const slider = page.locator('.qn-hs[data-habit="ready"]');
  await expect(slider).toHaveAttribute('role', 'slider');
  await expect(slider).toHaveAttribute('tabindex', '0');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await page.keyboard.press('4');
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Consistently');
  await page.keyboard.press('Backspace');
  await expect(slider).not.toHaveAttribute('aria-valuenow', /./);
  await page.keyboard.press('3');
  await page.keyboard.press('Delete');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({});
  expect(await shown()).toBe(sid);

  // Down in the Other Wording menu moves to the next wording, not the next student.
  await page.locator('#tq-generate').click();
  await page.locator('#tq-sentences [data-do="wording"]').first().click();
  await expect(page.locator('#tq-wording-menu button').first()).toBeVisible();
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.textContent);
  const firstItem = await focused();
  await page.keyboard.press('ArrowDown');
  expect(await focused()).not.toBe(firstItem);
  expect(await page.evaluate(() => !!document.activeElement.closest('#tq-wording-menu'))).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await focused()).toBe(firstItem);
  expect(await shown()).toBe(sid);
  await page.keyboard.press('Escape');

  // Other Wording and Support on low rows open inside the window.
  const last = page.locator('#tq-sentences [data-do="wording"]').last();
  await last.evaluate(el => el.scrollIntoView({ block: 'end' }));
  await last.click();
  const menu = page.locator('#tq-wording-menu');
  await expect(menu).toBeVisible();
  expect(await inWindow(menu)).toBe(true);
  await page.keyboard.press('Escape');
  const support = page.locator('#tq-row-support [data-do="supportMenu"]');
  await support.evaluate(el => el.scrollIntoView({ block: 'end' }));
  await support.click();
  const sm = page.locator('#tq-support-menu');
  await expect(sm).toBeVisible();
  expect(await inWindow(sm)).toBe(true);
});

/* + Add to My Bank (Nov 3 sweep, step 4). */
test('Add to My Bank: Belongs Under starts on the part it was opened from and says why Grade is not offered; a search with no match offers the parts where it does', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tq-generate').click();
  await page.locator('#tq-browse-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
  const box = sheet.locator('#tq-own');
  // From the Strengths tab: Strengths.
  await sheet.locator('[role="tab"]', { hasText: 'Strengths' }).click();
  await sheet.locator('.qn-browse-add-top').click();
  await expect(box.locator('#tq-own-part')).toHaveValue('strengths');
  await expect(box.locator('.qn-own-hint', { hasText: 'My Bank keeps no' })).toHaveCount(0);
  await box.locator('.qn-line-cancel').click();
  // From the Grade tab: Grade is not a part My Bank keeps, and it says so.
  await sheet.locator('[role="tab"]', { hasText: 'Grade' }).click();
  await sheet.locator('.qn-browse-add-top').click();
  await expect(box.locator('.qn-own-hint', { hasText: 'My Bank keeps no Grade sentences' })).toHaveCount(1);
  // The box is two lines and wraps a long sentence.
  const input = box.locator('#tq-own-input');
  await expect(input).toHaveJSProperty('tagName', 'TEXTAREA');
  await input.fill(
    'Cece reads every lab question twice, plans each step on paper first and then checks her results with a partner.',
  );
  expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await input.evaluate(el => el.clientHeight)).toBeGreaterThan(40);
  await box.locator('.qn-line-cancel').click();

  // A search with no match here offers the parts where it does match.
  await sheet.locator('[role="tab"]', { hasText: 'Closing' }).click();
  await sheet.locator('[role="tab"]', { hasText: 'Grade' }).click();
  // A word only the Next Step sentences use.
  const word = await page.evaluate(() => {
    const words = s =>
      new Set(
        String(s.text)
          .replace(/\{[^}]*\}|\[[^\]]*\]/g, ' ')
          .toLowerCase()
          .match(/[a-z]{6,}/g) || [],
      );
    const next = COMMENT_BANK.sentences.filter(s => s.group === 'Next Step' && !s.mine);
    const grade = new Set(COMMENT_BANK.sentences.filter(s => s.group !== 'Next Step').flatMap(s => [...words(s)]));
    for (const s of next) for (const w of words(s)) if (!grade.has(w)) return w;
    return '';
  });
  expect(word).not.toBe('');
  await sheet.locator('#tq-browse-search').fill(word);
  const empty = sheet.locator('.qn-browse-empty');
  await expect(empty).toContainText('match “' + word + '”');
  const go = empty.locator('.qn-browse-elsewhere-btn', { hasText: 'Next Step' });
  await expect(go).toHaveCount(1);
  await go.click();
  await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Next Step');
  await expect(sheet.locator('.qn-browse-row').first()).toBeVisible();
});

/* Undo on Other Wording (Nov 3 sweep, step 4 group 3 #67): a bank sentence's
   row can be removed, and an edited one can go back to the bank's wording. */
test('Other Wording has Remove From Comment, and an edited sentence can go back to the bank wording', async ({
  page,
}) => {
  await open(page);
  const rows = page.locator('#tq-sentences .qn-req-row[data-row]');
  const box = page.locator('#tq-narrative');
  await page.locator('#tq-generate').click();
  // Edit a bank sentence in the box.
  const last = rows.filter({ has: page.locator('[data-do="wording"]') }).nth(1);
  const bankText = (await last.locator('.qn-req-text').textContent()).trim();
  await box.evaluate((el, t) => {
    const i = el.value.indexOf(t) + t.length - 1;
    el.focus();
    el.setSelectionRange(i, i);
  }, bankText);
  await page.keyboard.type(' today');
  const edited = rows.filter({ hasText: 'today.' });
  await expect(edited.locator('.qn-edited')).toHaveText('Edited');
  await edited.locator('[data-do="wording"]').click();
  const menu = page.locator('#tq-wording-menu');
  await menu.locator('.qn-menu-item', { hasText: 'The bank’s wording, before your edit' }).click();
  await expect(box).toHaveValue(new RegExp(bankText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(rows.filter({ hasText: 'today.' })).toHaveCount(0);
  // Remove From Comment on a bank sentence, then Undo.
  const before = await box.inputValue();
  const row = rows.filter({ hasText: bankText });
  await row.locator('[data-do="wording"]').click();
  await menu.locator('[data-do="remove"]').click();
  await expect(box).not.toHaveValue(new RegExp(bankText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await page.locator('#undo-toast button', { hasText: 'Undo' }).click();
  await expect(box).toHaveValue(before);
});

/* The address follows the open student and class (Nov 3 sweep, step 4 group 3
   #70), so a reload reopens the same place. */
test('the address follows the student; a reload reopens that student', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor();
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
  await page.locator('#tq-narrative').waitFor();
  await expect(page.locator('.qn')).toHaveAttribute('data-sid', next);
});
