import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* Slice 8 of the Term Questionnaire redesign: the six habit bars open the
   ratings, the amber note when a habit sentence and the missing work
   disagree, and + Close to a C+. Demo Mode, Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 1100 } });

async function open(page, student, opts = {}) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.locator('#tq-narrative').waitFor();
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  if (opts.letter) await page.evaluate(() => (COURSES.sci8.gradingSystem = 'letter'));
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  if (opts.rated)
    for (const key of ['completes', 'ready', 'others', 'part', 'feedback', 'devices'])
      await page.locator(`.qn-hs-stop[data-habit="${key}"][data-value="4"]`).click();
  await page.locator('#tq-generate').click();
  await page.waitForTimeout(300);
}
const habitsBox = page => page.locator('#tq-sentences .qn-box[data-part="habits"]');

test('the six bars open the ratings; a rating changed there moves the bars, the sentences and the left sliders', async ({
  page,
}) => {
  await open(page, 'st2', { rated: true });
  const box = habitsBox(page);
  const bars = box.locator('[data-do="habitsMenu"]');
  await expect(bars.locator('.qn-ev-bar')).toHaveCount(6);
  await expect(bars).toHaveAttribute('aria-expanded', 'false');
  await bars.click();
  const menu = page.locator('#tq-habits-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.qn-hm-row')).toHaveCount(6);
  await expect(menu.locator('.qn-hm-word').first()).toHaveText('Consistently');
  const was = await box.locator('.qn-req-text').first().textContent();
  await menu.locator('[data-habit="completes"][data-value="2"]').click();
  await expect(menu.locator('.qn-hm-word').first()).toHaveText('Sometimes');
  await expect(page.locator('.qn-hs[data-habit="completes"]')).toHaveAttribute('data-value', '2');
  await expect(box.locator('.qn-ev-bar').first()).toHaveCSS('height', '9px');
  expect(await box.locator('.qn-req-text').first().textContent()).not.toBe(was);
  // Keyboard: Escape closes it and the focus goes back to the bars.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(bars).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tq-habits-menu')).toBeVisible();
});

test('the amber note: Rate It lowers the rating a step; Keep It hides it and remembers; nothing in the gradebook changes', async ({
  page,
}) => {
  await open(page, 'st6', { rated: true });
  const note = page.locator('.qn-habit-note');
  await expect(note).toHaveCount(1);
  await expect(note.locator('.qn-habit-note-text')).toHaveText(
    /^This says he always hands in his work on time\. One assignment is not handed in: “KMT & States of Matter Lab\.”$/,
  );
  await expect(note.locator('.qn-habit-note-fix')).toHaveText('Rate It Usually');
  const statuses = await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')));
  await note.locator('.qn-habit-note-fix').click();
  await expect(page.locator('.qn-hs[data-habit="completes"]')).toHaveAttribute('data-value', '3');
  await expect(note.locator('.qn-habit-note-text')).toContainText('hands in his work on time');
  await note.locator('.qn-habit-note-keep').click();
  await expect(note).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')))).toBe(statuses);
  // Remembered for this student and report, through a redraw and a reload.
  await page.locator('#tq-generate').click();
  await expect(note).toHaveCount(0);
  await page.reload();
  await page.locator('#tq-narrative').waitFor();
  await expect(page.locator('.qn-habit-note')).toHaveCount(0);
});

test('no note for a student with nothing missing, or with the habit rated Sometimes', async ({ page }) => {
  await open(page, 'st2', { rated: true });
  await expect(page.locator('.qn-habit-note')).toHaveCount(0);
});

test('+ Close to a C: only when the sentence does not already say it; adds one sentence under the grade', async ({
  page,
}) => {
  await open(page, 'st26', { letter: true });
  // The drafted grade sentence already says it: no button.
  await expect(page.locator('[data-do="closeAdd"]')).toHaveCount(0);
  const grade = page.locator('#tq-sentences .qn-box[data-part="grade"]');
  await grade.locator('.qn-req-text').first().click();
  await page.locator('.qn-edit-field').fill('Leo has a C- in Science 8 so far.');
  await page.keyboard.press('Enter');
  const btn = grade.locator('[data-do="closeAdd"]');
  await expect(btn).toHaveText('+ Close to a C');
  await btn.click();
  await expect(grade.locator('.qn-srow')).toHaveCount(2);
  await expect(grade.locator('.qn-srow').nth(1).locator('.qn-req-text')).toHaveText('He is close to a C.');
  expect(await page.locator('#tq-narrative').inputValue()).toContain(
    'Leo has a C- in Science 8 so far. He is close to a C.',
  );
  await expect(btn).toHaveCount(0);
});

test('no + Close to in a Proficiency class', async ({ page }) => {
  await open(page, 'st26');
  await expect(page.locator('[data-do="closeAdd"]')).toHaveCount(0);
});

for (const font of FONTS) {
  test(`the ratings popover and the note fit in the ${font} font`, async ({ page }) => {
    await open(page, 'st6', { rated: true });
    await useFont(page, font);
    await habitsBox(page).locator('[data-do="habitsMenu"]').click();
    const over = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#tq-sentences *').forEach(el => {
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
