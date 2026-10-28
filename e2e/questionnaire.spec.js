import { test, expect } from '@playwright/test';

/* The Term Questionnaire, rebuilt around the comment (DECISIONS 14,
   docs/questionnaire-plan.md), in Demo Mode on Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
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

test('Approve sets Ready and the roster tick; an edit clears it', async ({ page }) => {
  await open(page);
  const cece = page.locator('#gb-sidebar .student-row[data-sid="st1"]');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await expect(cece.locator('.qn-needs')).toHaveText('Needs Approval');

  await page.locator('#tq-approve').click();
  await expect(page.locator('#tq-approve')).toHaveText('✓ Approved');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
  await expect(cece.locator('.qn-tick')).toHaveText('✓');
  await expect(cece.locator('.qn-needs')).toHaveText('');

  // Not Ready leaves Cece out once another student is on screen.
  await page.locator('[data-action="tqRosterFilter"][data-filter="not-ready"]').click();
  await expect(page.locator('[data-filter="not-ready"]')).toHaveText('Not Ready 26');
  await page.locator('#gb-sidebar .student-row[data-sid="st7"]').click();
  await expect(cece).toBeHidden();
  await page.locator('[data-action="tqRosterFilter"][data-filter="all"]').click();
  await cece.click();

  // An edit after approval clears it.
  await toEnd(page);
  await page.keyboard.type(' One more sentence.');
  await expect(page.locator('#tq-approve')).toHaveText('Approve Comment');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await expect(cece.locator('.qn-needs')).toHaveText('Needs Approval');

  // The text is kept, and is plain text.
  await page.reload();
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('#tq-narrative')).toHaveValue(/One more sentence\.$/);
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

test('the line meter reads the form’s Lines', async ({ page }) => {
  await open(page);
  await expect(page.locator('#tq-meter-label')).toHaveText(/^\d+ of 10 lines$/);
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    const form = ReportSheets.setLines(ReportSheets.formFor(cfg), 'teacher-narrative', 6);
    saveReportConfig('sci8', Object.assign({}, cfg, { form }));
  });
  await page.reload();
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('#tq-meter-label')).toHaveText(/^\d+ of 6 lines$/);
});

test('↑ ↓ change the student only outside a text field; ⌘ Return saves and moves on', async ({ page }) => {
  await open(page);
  await page.locator('.qn-evidence').click({ position: { x: 20, y: 200 } });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await page.locator('#tq-narrative').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.qn-name')).toHaveText('Hannah Berg');
  await expect(page.locator('#tq-student-pos')).toHaveText('3 of 27');
});

test('earlier reports are read only', async ({ page }) => {
  await open(page);
  await page.locator('[data-action="tqCommentTab"]').nth(1).click();
  await expect(page.locator('.qn-comment-card .qn-hint')).toContainText('Went home in');
  await expect(page.locator('#tq-narrative')).toHaveCount(0);
  await expect(page.locator('.qn-earlier')).toContainText('consistent, dependable student');
});

test('Growth: every score as a dot, Start → Now as the Progress in One Area block prints them', async ({ page }) => {
  await open(page);
  const rows = page.locator('.qn-growth-row');
  await expect(rows).toHaveCount(6);
  await expect(rows.first().locator('.qn-dot')).toHaveCount(13);
  await expect(rows.first().locator('.qn-growth-sn')).toHaveText('2.9 → 2.9');
  // Dots sit on three rows by level and never overlap.
  const overlaps = await page.evaluate(() =>
    [...document.querySelectorAll('.qn-dots')].some(strip => {
      const boxes = [...strip.children].map(d => d.getBoundingClientRect());
      return boxes.some((b, i) => i && b.left < boxes[i - 1].right - 0.5);
    }),
  );
  expect(overlaps).toBe(false);
  // The report's Progress in One Area, for each competency, prints the same Start and Now.
  const fromBlock = await page.evaluate(() => {
    const st = getStudents('sci8').find(s => s.id === 'st1');
    return CommentBank.facts('sci8', st, 'term-2').comps.map(c => {
      const rating = getStudentTermRating('sci8', 'st1', 'term-2') || {};
      upsertTermRating('sci8', 'st1', 'term-2', { focusSectionId: c.id });
      const html = ReportBlocks.renderBlockProgress('sci8', st, { termId: 'term-2' }, {});
      upsertTermRating('sci8', 'st1', 'term-2', { focusSectionId: rating.focusSectionId || null });
      const d = document.createElement('div');
      d.innerHTML = html;
      const facts = [...d.querySelectorAll('.report-progress-facts span')].map(x => x.textContent);
      const start = facts[facts.indexOf('Start of term') + 1].split(' ')[0];
      const now = facts[facts.indexOf('Now') + 1].split(' ')[0];
      return start + ' → ' + now;
    });
  });
  expect(await page.locator('.qn-growth-sn').allTextContents()).toEqual(fromBlock);
  await expect(page.locator('.qn-record')).toContainText('22 of 22');
});

test('a note quoted in the comment says In the comment; the private note is marked', async ({ page }) => {
  await open(page);
  const first = page.locator('.qn-obs').first();
  await expect(first.locator('.qn-quoted')).toHaveCount(0);
  const text = await first.locator('.qn-obs-text').textContent();
  await toEnd(page);
  await page.keyboard.type(' I noted: “' + text.trim() + '”');
  await expect(first.locator('.qn-quoted')).toHaveText('In the comment');
  await expect(page.locator('.qn-private')).toContainText('Private · Never Printed');
  await expect(page.locator('.qn-private')).toContainText('grandma');
});

test('a student with no observations this term gets the one-line explanation', async ({ page }) => {
  await open(page);
  await page.evaluate(() => getStudentQuickObs('sci8', 'st1').forEach(o => deleteQuickOb('sci8', 'st1', o.id)));
  await page.locator('#gb-sidebar .student-row[data-sid="st7"]').click();
  await page.locator('#gb-sidebar .student-row[data-sid="st1"]').click();
  await expect(page.locator('[data-card="obs"] .qn-empty')).toHaveText(
    'None this term. The comment works without them: Work Habits is built from your habit ratings.',
  );
});

test('Jasper: nothing from his phone yet, his forms Not Answered, his goal Not set yet', async ({ page }) => {
  await open(page, 'st7');
  await expect(page.locator('[data-card="voice"] .qn-card-sub')).toHaveText('Nothing from his phone yet');
  await expect(page.locator('[data-card="voice"] .qn-form').first()).toContainText('Not Answered');
  await expect(page.locator('.qn-goal-text')).toHaveText('Not set yet');
  await expect(page.locator('.qn-about')).toHaveText('Goes by Jas · he/him · STU-207');
});

test('Add appends the filled sentence; the row shows ✓ Added in place, nothing redrawn', async ({ page }) => {
  await open(page);
  await expect(page.locator('.qn-bank-card .qn-card-sub').first()).toHaveText('100 sentences · 43 fit Cece');
  const row = page.locator('.qn-part[data-part="now"] .qn-row').first();
  const text = await row.getAttribute('data-text');
  await row.evaluate(el => (el.__mark = 'same'));
  await row.click();
  await expect(page.locator('#tq-narrative')).toHaveValue(
    new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
  );
  await expect(row.locator('.qn-pill')).toHaveText('✓ Added');
  expect(await row.evaluate(el => el.__mark)).toBe('same');
  // Saved, and a second Add of the same sentence adds nothing.
  await row.click();
  const value = await page.locator('#tq-narrative').inputValue();
  expect(value.split(text).length - 1).toBe(1);
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').narrative)).toBe(value);
  // Deleting it from the box gives the row back its Add.
  await page.locator('#tq-narrative').fill(value.replace(text, '').trim());
  await expect(row.locator('.qn-pill')).toHaveText('Add');
});

test('Focus Area changes the next-step sentences; a habit picked changes what fits', async ({ page }) => {
  await open(page);
  const go = page.locator('.qn-part[data-part="go"]');
  const first = await go.locator('.qn-row').first().textContent();
  const focus = go.locator('[data-action="tqPickFocus"]');
  await focus.nth(1).click();
  await expect(focus.nth(1)).toHaveAttribute('aria-pressed', 'true');
  const name = (await focus.nth(1).textContent()).replace(/ \d.*$/, '');
  await expect(go.locator('.qn-row').first()).toContainText('next step is in ' + name);
  expect(await go.locator('.qn-row').first().textContent()).not.toBe(first);
  // I Can picks the statement quoted.
  const ican = go.locator('[data-action="tqPickICan"]');
  await ican.nth(1).click();
  await expect(go.locator('.qn-row').first()).toContainText((await ican.nth(1).textContent()).trim());
  // Completes Work starts from the record; Takes Part picked at Consistently adds its sentences.
  const habits = page.locator('.qn-part[data-part="habits"]');
  await expect(habits.locator('.qn-rate').first()).toContainText('From assignments · 22 of 22, 0 late, 0 missing');
  await expect(habits.locator('.qn-part-head .qn-card-sub')).toHaveText('5 fit Cece');
  await page.locator('[data-action="tqRate"][data-habit="part"][data-value="4"]').click();
  await expect(habits.locator('.qn-part-head .qn-card-sub')).toHaveText('9 fit Cece');
  await expect(page.locator('.qn-rates-head .qn-card-sub')).toHaveText('2 of 6 rated');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({ part: 4 });
});

test('no overflow at 1440 × 900, with every part of the bank shown in full', async ({ page }) => {
  await open(page);
  expect(await overflow(page)).toEqual([]);
  for (const part of ['habits', 'now', 'go', 'how']) {
    const more = page.locator(`[data-action="tqMore"][data-part="${part}"]`);
    if (await more.count()) await more.click();
  }
  expect(await overflow(page)).toEqual([]);
});

test.describe('on a 1366 × 768 laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the strip has the BC Requirements button, no bottom bar, no overflow', async ({ page }) => {
    await open(page);
    await expect(page.locator('.qn-bc-btn')).toBeVisible();
    await expect(page.locator('.qn-bottom')).toBeHidden();
    await expect(page.locator('#tq-save-next')).toBeVisible();
    expect(await overflow(page)).toEqual([]);
  });

  test('What FullVision Has is three tabs, one card at a time, none overflowing', async ({ page }) => {
    await open(page);
    await expect(page.locator('.qn-ev-tabs')).toBeVisible();
    for (const [tab, card] of [
      ['Observations', 'obs'],
      ['Voice', 'voice'],
      ['Growth', 'growth'],
    ]) {
      await page.locator('.qn-ev-tabs').getByRole('button', { name: tab }).click();
      await expect(page.locator(`[data-card="${card}"]`)).toBeVisible();
      await expect(page.locator('.qn-ev-card:visible')).toHaveCount(1);
      expect(await overflow(page)).toEqual([]);
    }
  });
});

test.describe('the BC Written Learning Update and the Questions sheet', () => {
  test('the six requirements tick as sentences are added', async ({ page }) => {
    await open(page);
    const count = page.locator('.qn-bc-count');
    await expect(count).toHaveText('2 of 6 requirements');
    const req = name => page.locator('.qn-req', { hasText: name });
    await expect(req('Work Habits')).toContainText('Nothing from part 1 yet');
    for (const part of ['habits', 'now', 'go', 'how']) {
      await page.locator(`.qn-part[data-part="${part}"] .qn-row:not(.added)`).first().click();
    }
    await expect(count).toHaveText('✓ 6 of 6 requirements');
    await expect(page.locator('#tq-bc-short')).toHaveText('✓ 6 of 6 requirements');
    await page.locator('[data-action="tqToggleBcAll"]').click();
    await expect(req('Work Habits')).toContainText('Teacher Comment · part 1');
    await expect(req('Self-Reflection and Goals')).toContainText('Self-Assessment and Goal · answered');
    await expect(page.locator('.qn-also-row')).toHaveText([
      /Proficiency Legend\s*Same for all/,
      /Attendance\s*Optional/,
      /Missing Work\s*From assignments/,
      /Assignment Grades\s*From scores/,
      /Parent \/ Guardian Response\s*Family writes/,
    ]);
    await expect(page.locator('.qn-left')).toContainText('Approve the Comment');
    await page.locator('#tq-approve').click();
    await expect(page.locator('.qn-left')).toContainText('Nothing. Cece is ready.');
  });

  test('Jasper is waiting on his Self-Assessment and Goal', async ({ page }) => {
    await open(page, 'st7');
    await expect(page.locator('.qn-req', { hasText: 'Self-Reflection and Goals' })).toContainText(
      'Self-Assessment and Goal · waiting on Jasper',
    );
    await expect(page.locator('.qn-left')).toContainText('Waiting on Jasper');
  });

  test('a form without Proficiency shows it as not met, with the reason', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const cfg = getReportConfig('sci8') || {};
      const form = ReportSheets.removeCell(ReportSheets.formFor(cfg), 'proficiency');
      saveReportConfig('sci8', Object.assign({}, cfg, { form }));
    });
    await page.reload();
    await page.locator('#report-period').selectOption('Report 2');
    await expect(page.locator('.qn-req', { hasText: 'Proficiency in Each Area' })).toContainText(
      'The Proficiency block is not on this report',
    );
    await expect(page.locator('.qn-req', { hasText: 'Proficiency in Each Area' }).locator('.qn-req-mark')).toHaveText(
      '●',
    );
  });

  test('Questions lists exactly the form’s blocks; its boxes turn cards off', async ({ page }) => {
    await open(page);
    await page.locator('#tq-questions-btn').click();
    const sheet = page.getByRole('dialog', { name: 'Questions' });
    await expect(sheet).toBeVisible();
    const blocks = await page.evaluate(() =>
      ReportSheets.onForm(ReportSheets.formFor(getReportConfig('sci8') || {})).map(id => ReportSheets.BLOCKS[id].label),
    );
    await expect(sheet.locator('.qn-q-row:not(.qn-q-head) .qn-q-block')).toHaveText(blocks);
    await expect(sheet.locator('.qn-q-row', { hasText: 'Teacher Comment' })).toContainText('You');
    await sheet.locator('[data-tq-card="obs"]').uncheck();
    await expect(page.locator('[data-card="obs"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await page.reload();
    await page.locator('#report-period').selectOption('Report 2');
    await expect(page.locator('[data-card="obs"]')).toHaveCount(0);
    expect(await overflow(page)).toEqual([]);
  });

  test('Open in Progress Reports lands on the student’s report', async ({ page }) => {
    await open(page, 'st7');
    await page.locator('[data-action="tqOpenReport"]').click();
    await expect(page.getByRole('tab', { name: 'Progress Reports' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#picker-label')).toHaveText('Jasper Gill');
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toContainText('Jas');
  });
});

test.describe('the BC card on a 1366 × 768 laptop', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('opens from the strip’s button and closes with Escape', async ({ page }) => {
    await open(page);
    await expect(page.locator('#tq-bc-card')).toBeHidden();
    await expect(page.locator('#tq-bc-short')).toHaveText('2 of 6 requirements');
    await page.locator('.qn-bc-btn').click();
    await expect(page.locator('#tq-bc-card')).toBeVisible();
    expect(await overflow(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tq-bc-card')).toBeHidden();
  });
});

test('end to end: rate, write from the bank, approve, move on, and the report prints it', async ({ page }) => {
  await open(page);
  await page.locator('[data-action="tqRate"][data-habit="part"][data-value="4"]').click();
  const added = [];
  for (const part of ['habits', 'now', 'go', 'how']) {
    const row = page.locator(`.qn-part[data-part="${part}"] .qn-row:not(.added)`).first();
    added.push(await row.getAttribute('data-text'));
    await row.click();
  }
  await expect(page.locator('.qn-bc-count')).toHaveText('✓ 6 of 6 requirements');
  await page.locator('#tq-approve').click();
  await page.locator('#tq-save-next').click();
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st1"] .qn-tick')).toHaveText('✓');

  await page.locator('#gb-sidebar .student-row[data-sid="st1"]').click();
  await page.locator('[data-action="tqOpenReport"]').click();
  const comment = page.locator('.report-sheet').first().locator('.report-comment-text');
  for (const t of added) await expect(comment).toContainText(t);
  expect(await overflow(page)).toEqual([]);
});
