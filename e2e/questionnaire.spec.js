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
  // Sam's Demo comment has a sentence over 20 words, so the Ready count
  // gives way to why Approve and Next is off (PR 11c, the States mockup).
  await expect(page.locator('#tq-ready')).toHaveText('Approve and Next is off until the comment fits.');
  await expect(page.locator('#tq-limit-text')).toHaveText(' · one sentence is over 20 words');
  await expect(page.locator('#tq-count-btn')).toHaveClass(/over/);
  await expect(page.locator('#tq-approve-next')).toBeDisabled();
  await row(noor).click();
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
  // Demo class has no closing sentence or support lines set (plan PR 8), no
  // habit ratings and nothing labelled Missing, and no student passes the
  // strongest gate (PR 6), so a draft can be four sentences: grade, best
  // piece, next step and the family line.
  const bad = await page.evaluate(() =>
    ReportQuestionnaire.getTqStudents()
      .map(st => {
        const ctx = CommentBank.context(CommentBank.facts('sci8', st, 'term-2'), {});
        const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id) });
        return d.ids.length < 4 || /[{}[\]]/.test(d.text) ? st.firstName : null;
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
  await expect(cards.nth(0).locator('.qn-info-row').nth(2)).toContainText(
    'The highest-marked assignment this term, and your note for the report on it.',
  );
  const blocks = await page.evaluate(() =>
    ReportSheets.onForm(ReportSheets.formFor(getReportConfig('sci8') || {})).map(id => ReportSheets.BLOCKS[id].label),
  );
  await expect(cards.nth(1).locator('.qn-info-row .qn-info-part')).toHaveText(blocks);
  await expect(cards.nth(1).locator('.qn-info-off')).toContainText('Add them in Progress Reports.');
  await expect(sheet).toContainText('Student Voice answers marked Private.');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
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
    await page.locator('[data-action="tqRate"][data-habit="part"][data-value="4"]').click();
    await expect(page.locator('#tq-empty-rated')).toHaveText('1 of 6 habits rated');
    // Clicking it puts the cursor in the box; typing hides it.
    await page.locator('#tq-empty').click();
    await expect(page.locator('#tq-narrative')).toBeFocused();
    await page.keyboard.type('Cece had a good term.');
    await expect(page.locator('#tq-empty')).toBeHidden();
    await expect(page.locator('#tq-comment-foot')).toBeVisible();
    await expect(page.locator('#tq-approve-next')).toBeEnabled();
  });

  test('the missing-work row waits for I checked this; a sentence over 20 words keeps Approve off', async ({
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
      '1 of 22 · check that it is really missing before you approve',
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
    await expect(row.locator('.qn-req-source').last()).toHaveText('1 of 22 · checked');
    await expect(approve).toBeEnabled();
    // A sentence over 20 words: the count turns orange and says why.
    await toEnd(page);
    await page.keyboard.type(' She ' + 'really '.repeat(19) + 'tries.');
    await expect(page.locator('#tq-count-btn')).toHaveClass(/over/);
    await expect(page.locator('#tq-limit-text')).toHaveText(' · one sentence is over 20 words');
    await expect(page.locator('#tq-ready')).toHaveText('Approve and Next is off until the comment fits.');
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAttribute(
      'title',
      'Saves this comment to the report card and opens the next student. Shorten the sentence over 20 words first.',
    );
    // Over the class's limit, the count says so instead.
    await page.evaluate(() => ReportQuestionnaire.tqLineChange({ dataset: { tqLimit: '1' }, value: '200' }));
    await expect(page.locator('#tq-count')).toHaveText(/^\d{3} of 200 characters$/);
    await expect(page.locator('#tq-limit-text')).toHaveText(' · remove or shorten a sentence');
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
    // Six habits rated and attendance entered, so Cece's draft has five
    // sentences beyond the grade sentence (which never counts as shared):
    // best piece, habits, attendance, next step, family.
    for (const key of await page.evaluate(() => CommentBank.HABITS.map(h => h.key))) {
      await page.locator(`[data-action="tqRate"][data-habit="${key}"][data-value="4"]`).click();
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
        el.value = t;
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

test('the report tabs, the picker, This Report and the comment box explain themselves on hover', async ({ page }) => {
  await open(page);
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
  // An earlier report's comment has its own tab, read only.
  await expect(page.locator('.qn-comment-tabs .seg-btn[data-tab="this"]')).toHaveAttribute(
    'title',
    'The comment for this report.',
  );
  await expect(page.locator('.qn-comment-tabs .seg-btn:not([data-tab="this"])').first()).toHaveAttribute(
    'title',
    /^The comment that went home in .+\. Read only\.$/,
  );
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
        ).work,
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
    await expect(rows(page).first().locator('.qn-req-source')).toContainText('from this term’s scores');
    await expect(rows(page).first().locator('[data-do="wording"]')).toHaveText('Other Wording ▾');
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
    expect(bestText).toContain('where she kept a field journal with dated sketches');
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
    await expect(box).toHaveValue(/^Cece is /);
  });

  test('Other Wording: up to three with the one in use ticked and its uses; a pick changes the comment; All N… opens Browse', async ({
    page,
  }) => {
    await open(page);
    // Six habits rated, so the comment has a habits sentence with alternatives.
    for (const key of await page.evaluate(() => CommentBank.HABITS.map(h => h.key))) {
      await page.locator(`[data-action="tqRate"][data-habit="${key}"][data-value="4"]`).click();
    }
    await page.locator('#tq-generate').click();
    const home = rowByLabel(page, 'Habits');
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
    await expect(first.locator('[data-do="wording"]')).toHaveCount(0);
    await page.locator('#tq-generate').click();
    await expect(page.locator('#tq-narrative')).toHaveValue(/^Cece had a steady term in Science 8\. /);
    await expect(first.locator('.qn-edited')).toHaveText('Edited');
    // A sentence of the teacher's own, added at the end, gets a row with no part.
    await toEnd(page);
    await page.keyboard.type(' She asks good questions.');
    const last = rows(page).last();
    await expect(last.locator('.qn-req-text')).toHaveText('She asks good questions.');
    await expect(last.locator('.qn-req-label')).toHaveText('');
    await expect(last.locator('.qn-edited')).toHaveText('Edited');
  });

  test('Browse Sentences: the parts, Fits, least used first, Use and In Use, search; the height is remembered', async ({
    page,
  }) => {
    await open(page);
    await page.locator('#tq-generate').click();
    // Cece's habits: five Consistently, Uses Feedback Sometimes, so the
    // Habits part has her own cases.
    for (const k of ['completes', 'ready', 'others', 'part', 'devices']) {
      await page.locator(`[data-action="tqRate"][data-habit="${k}"][data-value="4"]`).click();
    }
    await page.locator('[data-action="tqRate"][data-habit="feedback"][data-value="2"]').click();
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
    await expect(emerging.locator('.qn-browse-use').first()).toBeDisabled();
    const satisfactory = sheet.locator('.qn-browse-group[data-case="w:C"]');
    await satisfactory.locator('.qn-browse-head').click();
    await expect(satisfactory.locator('.qn-browse-sentence').first()).toHaveText(
      /a C\b.*satisfactory|satisfactory.*a C\b/,
    );
    // Habits: every habit at every rating is its own case, all 24 shown with
    // Every sentence, an empty one saying so; Cece's rated cells come first
    // and open, the rest closed; a closed case opens on a click.
    await sheet.locator('[role="tab"]', { hasText: 'Habits' }).click();
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Every sentence \d+/);
    const labels = await heads.locator('.qn-browse-head-label').allTextContents();
    const cells = labels.filter(l => / · (Consistently|Usually|Sometimes|Rarely)$/.test(l));
    expect(cells.length).toBe(24);
    expect(cells).toContain('Uses Feedback · Sometimes');
    const ownHeads = sheet.locator('.qn-browse-group.own .qn-browse-head');
    // After Cece's own cases: the other cells, then the summary.
    const rest = labels.slice(await ownHeads.count());
    expect(rest.slice(0, 18).every(l => / · (Consistently|Usually|Sometimes|Rarely)$/.test(l))).toBe(true);
    expect(rest[18]).toMatch(/^Summary/);
    await expect(ownHeads.first().locator('.qn-browse-head-label')).toHaveText('Completes Work · Consistently');
    await expect(ownHeads.nth(4).locator('.qn-browse-head-label')).toHaveText('Uses Feedback · Sometimes');
    for (const h of await ownHeads.all()) await expect(h).toHaveAttribute('aria-expanded', 'true');
    const feedback = sheet.locator('.qn-browse-group[data-case="cell:feedback:2"]');
    await expect(feedback.locator('.qn-browse-row, .qn-browse-none').first()).toBeVisible();
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
    await expect(ownGroup.locator('.qn-browse-head-label')).toHaveText(/^Science/);
    const use = ownGroup
      .locator('.qn-browse-row')
      .filter({ has: page.locator('.qn-browse-use:not([disabled])') })
      .first();
    const text = await use.locator('.qn-browse-sentence').textContent();
    await use.locator('.qn-browse-use').click();
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-sentence').filter({ hasText: text })).toHaveCount(1);
    await expect(page.locator('#tq-narrative')).toHaveValue(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // Every sentence: more rows and more cases, the ones that do not fit with Use off.
    await sheet.locator('#tq-browse-fits').click();
    await expect(sheet.locator('#tq-fits-menu [role="option"]')).toHaveText([
      /Fits Cece\d+$/,
      /Every sentence for this part\d+$/,
    ]);
    await sheet.locator('#tq-fits-menu [data-fits="0"]').click();
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Every sentence \d+/);
    expect(await rowsList.count()).toBeGreaterThan(fitCount);
    await expect(heads.locator('.qn-browse-head-label', { hasText: /^Social Studies · Evidence$/ })).toHaveCount(1);
    expect(await sheet.locator('.qn-browse-use[disabled]').count()).toBeGreaterThan(0);
    // Search filters across the groups and opens the ones with a match.
    await sheet.locator('#tq-browse-search').fill('At home');
    const matched = sheet.locator('.qn-browse-group');
    expect(await matched.count()).toBeGreaterThan(1);
    for (const g of await matched.all()) {
      await expect(g.locator('.qn-browse-head')).toHaveAttribute('aria-expanded', 'true');
      await expect(g.locator('.qn-browse-head-label')).toHaveText(/For the Family$/);
    }
    for (const r of await sheet.locator('.qn-browse-sentence').all()) await expect(r).toHaveText(/at home/i);
    await sheet.locator('#tq-browse-search').fill('zzzz');
    await expect(sheet.locator('.qn-browse-empty')).toHaveText('No sentences match “zzzz”.');
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

/* The bank's frames for excellent work habits (needs habitsExcellent), as
   one pattern over their realised forms: a pronoun or name slot matches a
   word, a [one|many] verb either form. */
async function excellentFrames(page) {
  const texts = await page.evaluate(() =>
    COMMENT_BANK.sentences.filter(s => (s.needs || []).indexOf('habitsExcellent') >= 0).map(s => s.text),
  );
  const alts = texts.map(t =>
    t
      .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
      .replace(/\{\w+\}/g, '[^ ]+')
      .replace(/\\\[([^|\]]*)\\\|([^\]]*)\\\]/g, '(?:$1|$2)'),
  );
  expect(alts.length).toBeGreaterThan(1);
  return new RegExp(alts.join('|'));
}

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
    await page.locator(`[data-action="tqRate"][data-habit="${k}"][data-value="4"]`).click();
  }
  // All six rated Consistently: the habits sentence is one of the bank's
  // excellent frames, whichever the seed picks.
  const excellent = await excellentFrames(page);
  await expect(page.locator('#tq-narrative')).toHaveValue(excellent);
  await expect(rowByLabel('Habits')).toHaveCount(1);
  await expect(rowByLabel('Habits').locator('.qn-req-text')).toHaveText(excellent);

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
  await expect(rowByLabel('Habits')).toHaveCount(1);
});

/* Approve and Next opens the next student not yet approved, round to the
   top; it never jumps to Progress Reports. */
test('Approve and Next on the last student goes round to the next unapproved one; all approved, it stays', async ({
  page,
}) => {
  await open(page);
  const ids = await page.evaluate(() => ReportQuestionnaire.getTqStudents().map(s => s.id));
  const last = ids[ids.length - 1];
  // Everyone approved but Noor and the last student in the roster.
  await page.evaluate(
    ({ ids, keep }) => {
      ids.forEach(id => {
        if (!keep.includes(id)) upsertTermRating('sci8', id, 'term-2', { approvedAt: new Date().toISOString() });
      });
    },
    { ids, keep: ['st2', last] },
  );
  await page.locator(`#gb-sidebar .student-row[data-sid="${last}"]`).click();
  await expect(page.locator('#tq-ready')).toHaveText(`${ids.length - 2} of ${ids.length} Ready`);
  await page.evaluate(() => ['missing', 'low'].forEach(id => ReportQuestionnaire.tqSetCheck(id, true)));
  await page.locator('#tq-approve-next').click();
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('.report-seg-btn[data-tab="questionnaire"]')).toHaveClass(/active/);
  await expect(page.locator('#tq-ready')).toHaveText(`${ids.length - 1} of ${ids.length} Ready`);

  // The last one: every comment approved, so the screen stays on Noor.
  await page.evaluate(() => ['missing', 'low'].forEach(id => ReportQuestionnaire.tqSetCheck(id, true)));
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('#tq-ready')).toHaveText(`${ids.length} of ${ids.length} Ready`);
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('.report-seg-btn[data-tab="questionnaire"]')).toHaveClass(/active/);
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st2"] .student-row-mark')).toHaveText('✓');
});
