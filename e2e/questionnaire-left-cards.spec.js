import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The left cards wear the Sentences card's look (term-questionnaire-redesign-plan,
   slice 7): a tile and name on every card, a tile on each At a Glance row, and a
   card and its sentence light each other when pointed at or focused. Demo Mode,
   Science 8's Report 2. */

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

test("the left cards share the boxes' tiles, names and type", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 'st2');
  const left = page.locator('.qn');
  const names = await left.locator('.qn-box-name').allTextContents();
  for (const n of ['Work Habits', 'At a Glance', 'Observations', 'Attendance']) expect(names).toContain(n);
  expect(names.some(n => /’s Voice$/.test(n))).toBe(true);
  const tile = await left
    .locator('.qn-card-top .qn-box-tile')
    .first()
    .evaluate(el => {
      const cs = getComputedStyle(el);
      return { w: cs.width, r: cs.borderRadius };
    });
  expect(tile).toEqual({ w: '22px', r: '6px' });
  const name = await left
    .locator('.qn-card-top .qn-box-name')
    .first()
    .evaluate(el => {
      const cs = getComputedStyle(el);
      return { fs: cs.fontSize, fw: cs.fontWeight };
    });
  expect(name).toEqual({ fs: '14px', fw: '600' });
  // Each At a Glance row carries its part's tile.
  await expect(left.locator('.qn-glance .qn-fact .qn-box-tile').first()).toBeVisible();
});

test('pointing at a row lights its box, and the reverse', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 'st2');
  const row = page.locator('.qn-left [data-lit="strengths"]').first();
  const box = page.locator('#tq-sentences .qn-box[data-part="strengths"]');
  await expect(box).toBeVisible();
  await expect(box).not.toHaveClass(/qn-lit/);
  await row.hover();
  await expect(box).toHaveClass(/qn-lit/);
  await expect(row).toHaveClass(/qn-lit/);
  // Moving off puts both out.
  await page.locator('.qn-head').hover();
  await expect(box).not.toHaveClass(/qn-lit/);
  await expect(row).not.toHaveClass(/qn-lit/);
  // The reverse: the box lights the row.
  await box.hover();
  await expect(row).toHaveClass(/qn-lit/);
  // Keyboard focus lights too: a glance row's button.
  await page.locator('.qn-head').hover();
  await expect(box).not.toHaveClass(/qn-lit/);
  await page.locator('.qn-left [data-lit="strengths"] .qn-glance-toggle').focus();
  await expect(box).toHaveClass(/qn-lit/);
  // The Work Habits card lights its box.
  await page.locator('.qn-habits .qn-card-top').hover();
  await expect(page.locator('#tq-sentences .qn-box[data-part="habits"]')).toHaveClass(/qn-lit/);
  // The toggle still opens a row's pieces.
  await page.locator('.qn-head').hover();
  await page.locator('.qn-left [data-lit="strengths"] .qn-glance-toggle').click();
  await expect(page.locator('#tq-glance-strongest')).toBeVisible();
});

test('nothing is drawn lit under Reduce Motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 'st2');
  const row = page.locator('.qn-left [data-lit="strengths"]').first();
  await row.hover();
  const bg = await row.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
});

for (const width of [1280, 1680, 820]) {
  test(`the left cards do not overflow at ${width} wide, in the page font and a wide one`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, 'st2');
    for (const font of FONTS) {
      await useFont(page, font);
      const bad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.qn-left *').forEach(el => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || el.offsetParent === null) return;
          if (el.parentElement.classList.contains('qn-habit-scale')) return;
          if (['qn-habit-name', 'qn-habit-desc'].some(c => el.classList.contains(c))) return;
          if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(cs.overflowX))
            out.push((el.className || el.tagName) + ': ' + (el.textContent || '').trim().slice(0, 30));
        });
        if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
        return out;
      });
      expect(bad, font).toEqual([]);
    }
  });
}
