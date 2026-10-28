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
  await page.locator('#tq-narrative').click();
  await page.keyboard.press('End');
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
  await page.locator('#tq-narrative').click();
  await page.keyboard.press('End');
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

test('no overflow at 1440 × 900', async ({ page }) => {
  await open(page);
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
