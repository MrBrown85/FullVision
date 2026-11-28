import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* Write Comments: the In the Comment group and keeping the teacher's place
   (docs/plans/write-comments-plan.md). In a box of skills, the rows that hold
   a sentence are listed first under a small In the Comment heading, which
   shows only while one does. When a row jumps up into the group (Say This) or
   drops back out (the sentence's x), the row just below it stays where it is
   on screen: the page scrolls by the change. Demo Mode, Science 8's Report 2,
   Cece, in a window short enough to scroll. Run in the page's font and a wide
   one, and with the CPU slowed. */
test.use({ viewport: { width: 1440, height: 640 } });

async function open(page) {
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
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#tq-narrative').evaluate(el => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#tq-generate-first').click();
  await expect(page.locator('#tq-read .wc-sent').first()).toBeVisible();
}
const box = (page, key) => page.locator(`.wc-box[data-part="${key}"]`);
async function openBox(page, key) {
  const head = page.locator('#wc-head-' + key);
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
}
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => 0))));
/* The on-screen top of a skill row of the Strength box, by its id. */
const topOf = (page, id) =>
  page.evaluate(i => {
    const body = document.querySelector('.wc-box[data-part="strength"] .wc-body');
    const w = i === 'foot' ? body.querySelector('.wc-foot') : body.querySelector(`.wc-fact-wrap[data-fact="${i}"]`);
    return w ? w.getBoundingClientRect().top : null;
  }, id);
/* The row after a skill row, and the ids of the rows in the group. */
const nextId = (page, id) =>
  page.evaluate(i => {
    const all = [...document.querySelectorAll('.wc-box[data-part="strength"] .wc-body > :is(.wc-fact-wrap, .wc-foot)')];
    const k = all.findIndex(e => e.getAttribute('data-fact') === i);
    return k >= 0 && all[k + 1] ? all[k + 1].getAttribute('data-fact') || 'foot' : null;
  }, id);
const held = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.wc-box[data-part="strength"] .wc-body > .wc-fact-wrap')]
      .filter(e => e.querySelector('.wc-line'))
      .map(e => e.getAttribute('data-fact')),
  );

for (const font of FONTS)
  for (const slow of [1, 5]) {
    test.describe(`${font} font, CPU x${slow}`, () => {
      test.beforeEach(async ({ page }) => {
        await open(page);
        await useFont(page, font);
        if (slow > 1) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow });
        }
      });

      test('Strength: Say This on a lower row names the group and the page keeps its place; x reverses it @flaky', async ({
        page,
      }) => {
        await openBox(page, 'strength');
        // Start with no sentence in the box: the heading is not shown.
        const xs = box(page, 'strength').locator('.wc-line .wc-x');
        while (await xs.count()) {
          await xs.first().click();
          await settle(page);
        }
        await expect(box(page, 'strength').locator('.wc-group')).toHaveCount(0);

        // A row well down the list, with the page scrolled so it is on screen.
        const says = box(page, 'strength').locator('.wc-fact-wrap:not(:has(.wc-line)) [data-do="wcSay"]');
        const n = await says.count();
        expect(n).toBeGreaterThan(1);
        const say = says.nth(n - 1);
        await say.scrollIntoViewIfNeeded();
        const id = await say.evaluate(el => el.closest('.wc-fact-wrap').getAttribute('data-fact'));
        const next = await nextId(page, id);
        expect(next).not.toBeNull();
        const scrolled = await page.evaluate(() => {
          let p = document.querySelector('#wc-boxes').parentElement;
          while (p && !(p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)))
            p = p.parentElement;
          return p ? p.scrollTop : 0;
        });
        expect(scrolled).toBeGreaterThan(0);

        const before = await topOf(page, next);
        await say.click();
        await expect(box(page, 'strength').locator('.wc-group')).toHaveCount(1);
        await expect(box(page, 'strength').locator('.wc-group')).toHaveText('In the Comment');
        await settle(page);
        // The row is now in the group, under the heading, and the next row stayed put.
        expect(await held(page)).toEqual([id]);
        expect(
          await box(page, 'strength')
            .locator('.wc-body > :first-child')
            .evaluate(e => e.className),
        ).toContain('wc-group');
        expect(Math.abs((await topOf(page, next)) - before)).toBeLessThanOrEqual(2);

        // Taking the sentence out drops the row back and the heading goes; again the next row stays.
        const nextBack = await nextId(page, id);
        const x = box(page, 'strength').locator('.wc-line .wc-x').first();
        await x.scrollIntoViewIfNeeded();
        const at = await topOf(page, nextBack);
        await x.click();
        await expect(box(page, 'strength').locator('.wc-group')).toHaveCount(0);
        await settle(page);
        expect(await held(page)).toEqual([]);
        expect(Math.abs((await topOf(page, nextBack)) - at)).toBeLessThanOrEqual(2);
      });
    });
  }
