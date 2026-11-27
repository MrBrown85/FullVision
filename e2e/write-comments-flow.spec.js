import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* What Write Comments must still do (docs/plans/write-comments-plan.md,
   decision 11), proved in the browser: approving and moving on, the roster,
   the habit ratings and their note, + Close to, the count and its limit.
   Demo Mode, Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 1100 } });

async function open(page, student = 'st1', opts = {}) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  if (opts.letter) await page.evaluate(() => (COURSES.sci8.gradingSystem = 'letter'));
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  if (opts.rated)
    for (const key of ['completes', 'ready', 'others', 'part', 'feedback', 'devices'])
      await page.locator(`.qn-hs-stop[data-habit="${key}"][data-value="4"]`).click();
  if (opts.generate) {
    await page.locator('#tq-generate').click();
    await page.waitForTimeout(300);
  }
}
const row = (page, sid) => page.locator(`#gb-sidebar .student-row[data-sid="${sid}"]`);
const comment = page => page.locator('#tq-narrative').inputValue();
/* The comment as a box to type in, the cursor at its end. */
async function typeAtEnd(page, text) {
  // With no comment yet, "No comment yet" is the box to type in.
  await ((await page.locator('#tq-read').isVisible()) ? page.locator('#tq-read') : page.locator('#tq-empty')).click();
  await page.locator('#tq-narrative').evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type(text);
}

test('Approve and Next sets Ready and the roster tick and opens the next student; an edit clears it', async ({
  page,
}) => {
  await open(page);
  const cece = row(page, 'st1');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await expect(cece.locator('.student-row-note')).not.toBeEmpty();
  await page.locator('#tq-approve-next').click();
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
  await expect(cece.locator('.student-row-mark')).toHaveText('✓');
  await expect(cece.locator('.student-row-note')).toHaveCount(0);
  await cece.click();
  // An edit after approval clears it.
  await typeAtEnd(page, ' One more sentence.');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await expect(cece.locator('.student-row-note')).not.toBeEmpty();
  // The text is kept, and is plain text.
  await page.locator('#tq-narrative').blur();
  await page.reload();
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('#tq-narrative')).toHaveValue(/One more sentence\.$/);
});

test('the roster marks survive a sidebar redraw; arrows move without approving and skip students Needs a Look hides', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tq-approve-next').click();
  await page.evaluate(() => refreshSidebar());
  await expect(row(page, 'st1').locator('.student-row-mark')).toHaveText('✓');
  await expect(row(page, 'st7').locator('.student-row-note')).toHaveText('Needs Approval');
  await expect(page.locator('.qn-roster-filter [data-filter="not-ready"]')).toContainText('Needs a Look');
  // Leaving the questionnaire gives the grades back.
  await page.locator('.report-seg-btn[data-tab="progress"]').click();
  await expect(page.locator('#gb-sidebar .student-row-note')).toHaveCount(0);
  await expect(page.locator('#gb-sidebar .qn-roster-filter')).toHaveCount(0);
  await page.locator('.report-seg-btn[data-tab="questionnaire"]').click();
  await expect(page.locator('#tq-narrative')).toBeAttached();
  // The arrow keys move from the list without approving.
  const ids = await page.evaluate(() => ReportQuestionnaire.getTqStudents().map(s => s.id));
  await row(page, ids[1]).click();
  await row(page, ids[1]).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#gb-sidebar .student-row.selected')).toHaveAttribute('data-sid', ids[2]);
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
});

test('↑ ↓ change the student only outside a text field; ⌘ Return approves and moves on', async ({ page }) => {
  await open(page);
  await page.locator('.qn-name').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await expect(page.locator('#tq-ready')).toHaveText('0 of 27 Ready');
  await page.locator('#tq-read').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.qn-name')).toHaveText('Noor Al-Rashid');
  await page.keyboard.press('Meta+Enter');
  await expect(page.locator('.qn-name')).toHaveText('Hannah Berg');
  await expect(page.locator('#tq-ready')).toHaveText('1 of 27 Ready');
});

test('Work Habits: the track snaps to the nearest stop, past the ends too, and a drag moves between stops', async ({
  page,
}) => {
  await open(page);
  const slider = page.locator('.qn-hs[data-habit="others"]');
  // The slider moves a little as the rating's word changes width: it is measured again before each press.
  const geo = async () => {
    const track = await slider.locator('.qn-hs-track').boundingBox();
    const dots = await slider
      .locator('.qn-hs-dot')
      .evaluateAll(els => els.map(e => e.getBoundingClientRect().x + e.getBoundingClientRect().width / 2));
    return { track, dots, y: track.y + track.height / 2 };
  };
  let g = await geo();
  await page.mouse.click(g.track.x + 3, g.y);
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  g = await geo();
  await page.mouse.click(g.track.x + g.track.width - 3, g.y);
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  g = await geo();
  await page.mouse.click(g.dots[1] + 8, g.y);
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  g = await geo();
  await page.mouse.move(g.dots[1], g.y);
  await page.mouse.down();
  await page.mouse.move((g.dots[1] + g.dots[2]) / 2, g.y, { steps: 4 });
  await page.mouse.move(g.dots[2], g.y, { steps: 4 });
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({ others: 3 });
});

test('the six ratings change the habit sentences', async ({ page }) => {
  await open(page, 'st2', { rated: true, generate: true });
  const habits = page.locator('.wc-box[data-part="habits"] .wc-line .wc-text');
  await expect(habits.first()).toBeVisible();
  const was = (await habits.allTextContents()).join(' ');
  await page.locator('.qn-hs-stop[data-habit="completes"][data-value="2"]').click();
  await expect(page.locator('.qn-hs[data-habit="completes"]')).toHaveAttribute('data-value', '2');
  await expect.poll(async () => (await habits.allTextContents()).join(' ')).not.toBe(was);
  await expect(page.locator('#wc-head-habits')).toContainText('Six Ratings');
});

test('the amber note: Rate It lowers the rating a step; Keep It hides it and remembers; nothing in the gradebook changes', async ({
  page,
}) => {
  await open(page, 'st6', { rated: true, generate: true });
  const note = page.locator('#wc-notes .wc-note', { hasText: 'hands in' });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText(/^This says he always hands in his work on time\./);
  await expect(note.locator('[data-do="habitNoteRate"]')).toHaveText('Rate It Usually');
  const statuses = await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')));
  await note.locator('[data-do="habitNoteRate"]').click();
  await expect(page.locator('.qn-hs[data-habit="completes"]')).toHaveAttribute('data-value', '3');
  await expect(note).toContainText('hands in his work on time');
  await note.locator('[data-do="habitNoteKeep"]').click();
  await expect(page.locator('#wc-notes .wc-note', { hasText: 'hands in' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')))).toBe(statuses);
  // Remembered for this student and report, through a redraw and a reload.
  await page.locator('#tq-generate').click();
  await expect(page.locator('#wc-notes .wc-note', { hasText: 'hands in' })).toHaveCount(0);
  await page.reload();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await expect(page.locator('#wc-notes .wc-note', { hasText: 'hands in' })).toHaveCount(0);
});

test('no note for a student with nothing missing, or with the habit rated Sometimes', async ({ page }) => {
  await open(page, 'st2', { rated: true, generate: true });
  await expect(page.locator('#wc-notes .wc-note', { hasText: 'hands in' })).toHaveCount(0);
  await open(page, 'st6', { generate: true });
  await page.locator('.qn-hs-stop[data-habit="completes"][data-value="2"]').click();
  await expect(page.locator('#wc-notes .wc-note', { hasText: 'hands in' })).toHaveCount(0);
});

test('+ Close to a C: only when the sentence does not already say it; adds one sentence under the grade', async ({
  page,
}) => {
  await open(page, 'st26', { letter: true, generate: true });
  await page.locator('#wc-head-grade').click();
  // The drafted grade sentence already says it: no button.
  const close = page.locator('.wc-box[data-part="grade"] [data-fact="close"] [data-do="wcSay"]');
  await expect(close).toHaveCount(0);
  const grade = page.locator('.wc-box[data-part="grade"] .wc-line').first();
  await grade.locator('.wc-text').click();
  await grade.locator('.wc-edit').fill('Leo has a C- in Science 8 so far.');
  await grade.locator('.wc-edit').press('Enter');
  await expect(close).toHaveCount(1);
  await close.click();
  await expect(page.locator('.wc-box[data-part="grade"] .wc-line')).toHaveCount(2);
  await expect(page.locator('.wc-box[data-part="grade"] .wc-line .wc-text').nth(1)).toHaveText('He is close to a C.');
  expect(await comment(page)).toContain('Leo has a C- in Science 8 so far. He is close to a C.');
  await expect(close).toHaveCount(0);
});

test('no + Close to in a Proficiency class', async ({ page }) => {
  await open(page, 'st26', { generate: true });
  await page.locator('#wc-head-grade').click();
  await expect(page.locator('.wc-box[data-part="grade"] [data-fact="close"]')).toHaveCount(0);
});

test('before Generate: no comment yet with the habits rated; it goes once there is text', async ({ page }) => {
  await open(page, 'st1');
  await page.locator('#tq-narrative').evaluate(el => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#tq-empty')).toBeVisible();
  await expect(page.locator('#tq-empty')).toContainText('No comment yet');
  await page.locator('.qn-hs-stop[data-habit="part"][data-value="4"]').click();
  await expect(page.locator('#tq-empty-rated')).toHaveText('1 of 6 habits rated');
  await expect(page.locator('#tq-generate-first')).toBeVisible();
  await typeAtEnd(page, 'Cece works well.');
  await expect(page.locator('#tq-empty')).toBeHidden();
  await expect(page.locator('#tq-generate-first')).toBeHidden();
});

test('a sentence over 20 words leaves Approve on; there is no character limit', async ({ page }) => {
  await open(page, 'st1');
  const long = 'She ' + 'always '.repeat(21) + 'tries.';
  await page.locator('#tq-narrative').evaluate((el, t) => {
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, long);
  await expect(page.locator('#tq-count-tail')).toHaveText(' · one sentence is over 20 words');
  await expect(page.locator('#tq-count-pill')).toHaveClass(/over/);
  await expect(page.locator('#tq-approve-next')).toBeEnabled();
  // The count is not a button: no character limit opens from it.
  await expect(page.locator('#tq-count-pill')).not.toHaveAttribute('role', /.+/);
  await expect(page.locator('#tq-limit')).toHaveCount(0);
});

for (const font of FONTS) {
  test(`the ratings and the amber note fit in the ${font} font`, async ({ page }) => {
    await open(page, 'st6', { rated: true, generate: true });
    await useFont(page, font);
    const over = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.wc *').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || el.offsetParent === null) return;
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(cs.overflowX))
          out.push((el.id || el.className || el.tagName) + ': ' + (el.textContent || '').trim().slice(0, 30));
      });
      if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
      return out;
    });
    expect(over).toEqual([]);
  });
}
