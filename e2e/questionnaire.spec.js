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
    await page.locator('[data-action="tqRate"][data-habit="part"][data-value="4"]').click();
    await expect(page.locator('#tq-empty-rated')).toHaveText('1 of 6 habits rated');
    // Clicking it puts the cursor in the box; typing hides it.
    await page.locator('#tq-empty').click();
    await expect(page.locator('#tq-narrative')).toBeFocused();
    await page.keyboard.type('Cece had a good term.');
    await expect(page.locator('#tq-empty')).toBeHidden();
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
    await page.locator('#tq-generate').click();
    const cece = await page.locator('#tq-narrative').inputValue();
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
      /[A-Z][a-z]+ of these sentences are also in Cece Adeyemi’s comment\. Press Generate Comment for another version, or change a sentence\./,
    );
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
    await page.locator('#tq-generate').click();
    const box = page.locator('#tq-narrative');
    const draft = await box.inputValue();
    const n = await page.evaluate(
      () => ReportQuestionnaire.sentencesOf(document.getElementById('tq-narrative').value).length,
    );
    await expect(rows(page)).toHaveCount(n);
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Grade');
    await expect(rows(page).first().locator('.qn-req-source')).toContainText('from this term’s scores');
    await expect(rows(page).first().locator('[data-do="wording"]')).toHaveText('Other Wording ▾');
    await expect(page.locator('#tq-sentences .qn-sub')).toHaveText(
      'Reword, edit or drag to reorder. The comment above follows.',
    );
    await expect(page.locator('#tq-sentences .qn-srow-handle[draggable="true"]')).toHaveCount(n);
    await expect(page.locator('[data-do="reset"]')).toHaveCount(0);
    // The best piece's row, moved first, names Cece; the grade sentence now
    // uses her pronoun.
    const best = rowByLabel(page, 'Best Piece');
    const bestText = await best.locator('.qn-req-text').textContent();
    await best.locator('.qn-srow-handle').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(rows(page).first().locator('.qn-req-label')).toHaveText('Best Piece');
    await expect(rows(page).first().locator('.qn-req-text')).toContainText('Cece');
    await expect(rows(page).nth(1).locator('.qn-req-text')).toHaveText(/^She is /);
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
    await page.locator('#tq-generate').click();
    const home = page.locator('#tq-sentences .qn-srow', { hasText: 'At home, you can ask' });
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
    await expect(menu.locator('.qn-menu-all')).toHaveText(/^All \d+ next step sentences…$/);
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
    await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Next Step');
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
    // Grade: the one in use, In Use, and the count.
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Fits Cece \d+ of \d+/);
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-inuse')).toHaveText('In Use');
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-meta')).toHaveText(/^In use/);
    // Next Step: Use puts a sentence in the comment and the row says In Use.
    await sheet.locator('[role="tab"]', { hasText: 'Next Step' }).click();
    const rowsList = sheet.locator('.qn-browse-row');
    const fitCount = Number((await sheet.locator('#tq-browse-n').textContent()).split(' of ')[0]);
    await expect(rowsList).toHaveCount(fitCount);
    const use = rowsList.filter({ has: page.locator('.qn-browse-use:not([disabled])') }).first();
    const text = await use.locator('.qn-browse-sentence').textContent();
    await use.locator('.qn-browse-use').click();
    await expect(sheet.locator('.qn-browse-row.on .qn-browse-sentence').filter({ hasText: text })).toHaveCount(1);
    await expect(page.locator('#tq-narrative')).toHaveValue(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    // Every sentence: more rows, the ones that do not fit with Use off.
    await sheet.locator('#tq-browse-fits').click();
    await expect(sheet.locator('#tq-fits-menu [role="option"]')).toHaveText([
      /Fits Cece\d+$/,
      /Every sentence for this part\d+$/,
    ]);
    await sheet.locator('#tq-fits-menu [data-fits="0"]').click();
    await expect(sheet.locator('#tq-browse-fits')).toHaveText(/^Every sentence \d+/);
    expect(await rowsList.count()).toBeGreaterThan(fitCount);
    await expect(sheet.locator('.qn-browse-use[disabled]').first()).toBeVisible();
    // Search narrows the list.
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
