import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The Sentences card draws one box per part (term-questionnaire-redesign-plan,
   slice 1): a head line in each (tile, name, evidence), no grey source line
   under a sentence, nothing sideways at the desktop and iPad widths, in the
   page's font and in a wide one. Demo Mode, Science 8's Report 2. */

async function open(page, student) {
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
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  // All six habits rated Consistently, so the habits part is in the comment.
  for (const key of await page.evaluate(() => CommentBank.HABITS.map(h => h.key))) {
    await page.locator(`.qn-hs-stop[data-habit="${key}"][data-value="4"]`).click();
  }
  await page.locator('#tq-generate').click();
}

/* Elements of the card whose content is wider than their box. */
async function overflow(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#tq-sentences *, .qn-head *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || el.offsetParent === null) return;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(cs.overflowX))
        out.push((el.id || el.className || el.tagName) + ': ' + (el.textContent || '').trim().slice(0, 30));
    });
    if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
    return out;
  });
}

test('the card draws one box per part with a head line and no grey source line', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 'st2');
  const card = page.locator('#tq-sentences');
  const boxes = card.locator('.qn-box');
  expect(await boxes.count()).toBeGreaterThan(3);
  await expect(card.locator('.qn-box-head')).toHaveCount(await boxes.count());
  // Each box holds rows of one part; the names are the new ones.
  const names = await card.locator('.qn-box-name').allTextContents();
  expect(names).toContain('Grade');
  expect(names).toContain('Work Habits');
  expect(names.filter(n => /^(Strengths|Habits|Not Handed In)$/.test(n))).toEqual([]);
  // The Work Habits box shares its sentences and shows the six ratings as bars.
  const habits = card.locator('.qn-box[data-part="habits"]');
  expect(await habits.locator('.qn-srow').count()).toBeGreaterThan(1);
  await expect(habits.locator('.qn-ev-bar')).toHaveCount(6);
  // No grey source line under a sentence; its words are the tooltip.
  await expect(card.locator('.qn-srow .qn-req-source, .qn-srow-facts')).toHaveCount(0);
  await expect(card.locator('.qn-srow .qn-req-text').first()).toHaveAttribute('title', /.+/);
  // No grey hint beside the title.
  await expect(card.locator('.qn-req-top .qn-sub')).toHaveCount(0);
  // The box: white, 12px corners; sentences at 15px.
  const look = await boxes.first().evaluate(el => {
    const cs = getComputedStyle(el);
    const t = getComputedStyle(el.querySelector('.qn-req-text'));
    return { bg: cs.backgroundColor, r: cs.borderRadius, fs: t.fontSize };
  });
  expect(look).toEqual({ bg: 'rgb(255, 255, 255)', r: '12px', fs: '15px' });
  // The header: no word under the grade, the count reads "N of M handed in".
  await expect(page.locator('.qn-grade-sub')).toHaveText(/^\d+ of \d+ handed in$/);
});

for (const width of [1280, 1440, 1680, 744, 820, 1024]) {
  test(`nothing overflows at ${width} wide, in the page font and a wide one`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, 'st2');
    for (const font of FONTS) {
      await useFont(page, font);
      expect(await overflow(page), font).toEqual([]);
    }
  });
}
