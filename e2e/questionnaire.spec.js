import { test, expect } from '@playwright/test';

/* The Term Questionnaire's review screen (fullvision-generate-plan PR 11a,
   the "Review screen" mockup), in Demo Mode on Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
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
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(cs.overflowX)) {
        out.push((el.id || el.className || el.tagName) + ': ' + (el.textContent || '').trim().slice(0, 30));
      }
    });
    const tb = document.querySelector('.report-toolbar');
    if (tb.scrollWidth > tb.clientWidth + 1) out.push('toolbar');
    return out;
  });
}

test('the toolbar: Approve and Next, the two icons; no Questions, no Save and Next', async ({ page }) => {
  await open(page);
  await expect(page.locator('#tq-approve-next')).toHaveText('Approve and Next ›');
  await expect(page.locator('#tq-edit-student-btn')).toBeVisible();
  await expect(page.locator('#tq-info-btn')).toBeVisible();
  await expect(page.locator('#tq-questions-btn, #tq-save-next, #tq-approve, .qn-bottom')).toHaveCount(0);
  await expect(page.locator('#tq-bank, .qn-ev-tabs, [data-tq-card]')).toHaveCount(0);
});

test('the header: name, pronouns, the Student Dashboard link there and back, the grade and the count', async ({
  page,
}) => {
  await open(page);
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
  await expect(page.locator('#tq-ready')).toHaveText('2 of 27 Ready');
  // Leaving the questionnaire gives the grades back.
  await page.locator('[data-action="tqRosterFilter"][data-filter="all"]').click();
  await page.locator('.report-seg-btn[data-tab="progress"]').click();
  await expect(page.locator('#gb-sidebar .student-row-note')).toHaveCount(0);
  await expect(page.locator('#gb-sidebar-extra')).toHaveCount(0);
  await expect(cece.locator('.student-row-prof').first()).toBeVisible();
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
  // Every student in the class gets a draft with no slot left unfilled. The
  // Demo class has no closing sentence or support lines set (plan PR 8).
  const bad = await page.evaluate(() =>
    ReportQuestionnaire.getTqStudents()
      .map(st => {
        const ctx = CommentBank.context(CommentBank.facts('sci8', st, 'term-2'), {});
        const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id) });
        return d.ids.length < 5 || /[{}[\]]/.test(d.text) ? st.firstName : null;
      })
      .filter(Boolean),
  );
  expect(bad).toEqual([]);
});

test('Copy puts the comment on the clipboard and says Copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const text = await page.locator('#tq-narrative').inputValue();
  await page.locator('#tq-copy-btn').click();
  await expect(page.locator('#tq-copy-btn .qn-copy-label')).toHaveText('Copied');
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

test('earlier reports are read only', async ({ page }) => {
  await open(page);
  await page.locator('[data-action="tqCommentTab"]').nth(1).click();
  await expect(page.locator('.qn-comment .qn-hint')).toContainText('Went home in');
  await expect(page.locator('#tq-narrative')).toHaveCount(0);
  await expect(page.locator('.qn-earlier')).toContainText('consistent, dependable student');
});

test('Work Habits: a rating saves in place and the count follows; nothing redraws', async ({ page }) => {
  await open(page);
  await expect(page.locator('#tq-rated')).toHaveText('0 of 6 rated');
  const grid = page.locator('.qn-habits');
  await grid.evaluate(el => (el.__mark = 'same'));
  const part = page.locator('[data-action="tqRate"][data-habit="part"][data-value="4"]');
  await part.click();
  await expect(part).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#tq-rated')).toHaveText('1 of 6 rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({ part: 4 });
  expect(await grid.evaluate(el => el.__mark)).toBe('same');
  await expect(page.locator('.qn-habit-name').nth(1)).toHaveText('Comes Ready, Uses Class Time');
});

test('At a Glance: the best piece and the skills with Strongest and Next step', async ({ page }) => {
  await open(page);
  const expected = await page.evaluate(() => {
    const st = getStudents('sci8').find(s => s.id === 'st1');
    const f = CommentBank.facts('sci8', st, 'term-2');
    const best = ReportQuestionnaire.bestPiece(f.work);
    const tags = ReportQuestionnaire.skillTags(f.comps);
    return {
      best: best.title,
      comps: f.comps.length,
      strongest: Object.values(tags).filter(t => t === 'Strongest').length,
    };
  });
  await expect(page.locator('.qn-best .qn-fact-body')).toContainText(expected.best);
  await expect(page.locator('.qn-skill')).toHaveCount(expected.comps);
  await expect(page.locator('.qn-tag.strongest')).toHaveCount(expected.strongest);
  await expect(page.locator('.qn-tag:not(.strongest)')).toHaveText(['Next step']);
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

test('Jasper: nothing from his phone yet, so Goal · Not set yet only', async ({ page }) => {
  await open(page, 'st7');
  await expect(page.locator('.qn-voice-row')).toHaveCount(1);
  await expect(page.locator('.qn-voice-row .qn-voice-text')).toHaveText('Not set yet');
  await expect(page.locator('.qn-head-sub')).toHaveText('he/him · Student Dashboard ›');
});

test('the Edit Student icon opens the dialog; a save redraws the name', async ({ page }) => {
  await open(page);
  await page.locator('#tq-edit-student-btn').click();
  const dialog = page.getByRole('dialog', { name: 'Edit Student' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#edit-first').fill('Cecilia');
  await dialog.locator('[data-action="saveEditStudent"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.qn-name')).toHaveText('Cecilia Adeyemi');
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st1"] .student-row-name')).toHaveText(
    'Cecilia Adeyemi',
  );
});

test('the circled question mark opens Where This Information Comes From', async ({ page }) => {
  await open(page);
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
  const blocks = await page.evaluate(() =>
    ReportSheets.onForm(ReportSheets.formFor(getReportConfig('sci8') || {})).map(id => ReportSheets.BLOCKS[id].label),
  );
  await expect(cards.nth(1).locator('.qn-info-row .qn-info-part')).toHaveText(blocks);
  await expect(cards.nth(1).locator('.qn-info-off')).toContainText('Add them in Progress Reports.');
  await expect(sheet).toContainText('Student Voice answers marked Private.');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
});

test('no overflow at 1440 × 900', async ({ page }) => {
  await open(page);
  expect(await overflow(page)).toEqual([]);
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
  await page.locator('[data-action="tqRate"][data-habit="part"][data-value="4"]').click();
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
