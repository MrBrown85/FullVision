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
});
