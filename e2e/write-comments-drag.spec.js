import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* Write Comments: the handle on a sentence drags it, and what it does is
   seen (docs/plans/write-comments-plan.md). The sentence lifts and follows
   the pointer, a slot shows where it lands, the others glide out of the way
   and it settles. Afterwards the comment is in the new order, the box shows
   the same order, and Moved. with Undo shows only when the order changed.
   In a box of skills the rows that hold a sentence come first, in the
   comment's order, so the skill row moves with its sentence. Demo Mode,
   Science 8's Report 2, Cece. Run in the page's font and a wide one, and
   with the CPU slowed. */
test.use({ viewport: { width: 1440, height: 1100 } });

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
/* The comment's sentences, each by its words after the first (a name moves to whichever sentence is first). */
const tail = t => t.trim().split(' ').slice(1).join(' ');
const comment = async page => (await page.locator('#tq-read .wc-sent').allTextContents()).map(tail);
const lines = async (page, key) => (await box(page, key).locator('.wc-line .wc-text').allTextContents()).map(tail);
/* The order of the box's lines in the comment. */
const inComment = async (page, key) => {
  const c = await comment(page);
  return (await lines(page, key)).map(t => c.indexOf(t));
};
const names = async (page, key) =>
  box(page, key).locator('.wc-fact-wrap:has(.wc-line) .wc-fact-name').allTextContents();
const toast = page => page.locator('#undo-toast');

async function drag(page, from, to, { shot } = {}) {
  // Measured once the boxes have stopped gliding.
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => 0))));
  const g = await from.boundingBox();
  const t = await to.boundingBox();
  const x = g.x + g.width / 2;
  const y = g.y + g.height / 2;
  const dy = t.y + 6 - y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x, y + (dy * i) / 10);
    if (i === 5 && shot) await shot();
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

const RUNS = [];
for (const font of FONTS) for (const slow of [1, 5]) RUNS.push({ font, slow });

for (const { font, slow } of RUNS) {
  test.describe(`${font} font, CPU x${slow}`, () => {
    test.beforeEach(async ({ page }) => {
      await open(page);
      await useFont(page, font);
      if (slow > 1) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow });
      }
    });

    test('Strength: a sentence dragged up takes its skill row with it; the comment and the box agree; Undo puts both back', async ({
      page,
    }) => {
      await openBox(page, 'strength');
      for (let i = 0; i < 2; i++) {
        const say = box(page, 'strength').locator('[data-do="wcSay"]').first();
        await expect(say).toBeVisible();
        await say.click();
        await expect(box(page, 'strength').locator('.wc-line')).toHaveCount(i + 2);
      }
      const gripsOn = box(page, 'strength').locator('.wc-grip');
      await expect(gripsOn).toHaveCount(3);
      const text0 = await lines(page, 'strength');
      const names0 = await names(page, 'strength');
      // The skill rows that hold a sentence are listed in the comment's order.
      expect(await inComment(page, 'strength')).toEqual([...(await inComment(page, 'strength'))].sort((a, b) => a - b));
      expect(names0).toHaveLength(3);

      let mid = null;
      await drag(page, gripsOn.last(), box(page, 'strength').locator('.wc-line').first(), {
        shot: async () => {
          const up = box(page, 'strength').locator('.wc-line.lifted');
          await expect(up).toHaveCount(1);
          mid = await up.evaluate(el => ({
            transform: el.style.transform,
            slot: !!document.querySelector('.qn-slot'),
          }));
        },
      });
      // It lifted, followed the pointer, and a slot showed where it lands.
      expect(mid.transform).toContain('translateY');
      expect(mid.slot).toBe(true);
      await expect(box(page, 'strength').locator('.wc-line.lifted')).toHaveCount(0);
      await expect(page.locator('.qn-slot')).toHaveCount(0);

      // The last sentence is first, in the box and in the comment; its skill row moved with it.
      await expect.poll(() => lines(page, 'strength')).toEqual([text0[2], text0[0], text0[1]]);
      expect(await names(page, 'strength')).toEqual([names0[2], names0[0], names0[1]]);
      const c = await inComment(page, 'strength');
      expect(c).toEqual([...c].sort((a, b) => a - b));
      expect(c[0]).toBeGreaterThanOrEqual(0);
      await expect(toast(page)).toContainText('Moved.');

      await toast(page).getByRole('button', { name: 'Undo' }).click();
      await expect.poll(() => lines(page, 'strength')).toEqual(text0);
      expect(await names(page, 'strength')).toEqual(names0);
    });

    test('a drop where it began changes nothing and shows no toast; Escape puts it back', async ({ page }) => {
      await openBox(page, 'strength');
      for (let i = 0; i < 2; i++) await box(page, 'strength').locator('[data-do="wcSay"]').first().click();
      await expect(box(page, 'strength').locator('.wc-line')).toHaveCount(3);
      const text0 = await lines(page, 'strength');
      const before = await comment(page);
      const grip = box(page, 'strength').locator('.wc-grip').nth(1);
      const g = await grip.boundingBox();
      // Out and back to the same place.
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 12, { steps: 3 });
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await expect(toast(page)).toHaveCount(0);
      expect(await lines(page, 'strength')).toEqual(text0);
      expect(await comment(page)).toEqual(before);
      // Escape in the middle of a drag.
      const g2 = await box(page, 'strength').locator('.wc-grip').last().boundingBox();
      const top = await box(page, 'strength').locator('.wc-line').first().boundingBox();
      await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
      await page.mouse.down();
      await page.mouse.move(g2.x + g2.width / 2, top.y + 6, { steps: 8 });
      await expect.poll(() => lines(page, 'strength')).not.toEqual(text0);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await expect.poll(() => lines(page, 'strength')).toEqual(text0);
      expect(await comment(page)).toEqual(before);
      await expect(toast(page)).toHaveCount(0);
    });

    test('Work Habits: two typed sentences swap in the box and the comment; a lone sentence has no handle', async ({
      page,
    }) => {
      await openBox(page, 'habits');
      const add = async text => {
        await box(page, 'habits').locator('[data-do="wcWrite"]').click();
        await page.locator('#tq-wc-write').fill(text);
        await page.locator('[data-do="wcWriteAdd"]').click();
      };
      await add('She is on time.');
      await expect(box(page, 'habits').locator('.wc-line')).toHaveCount(1);
      await expect(box(page, 'habits').locator('.wc-grip')).toHaveCount(0);
      await add('She shares her ideas.');
      await expect(box(page, 'habits').locator('.wc-grip')).toHaveCount(2);
      const t0 = await lines(page, 'habits');
      expect(t0).toHaveLength(2);
      await drag(page, box(page, 'habits').locator('.wc-grip').last(), box(page, 'habits').locator('.wc-line').first());
      await expect.poll(() => lines(page, 'habits')).toEqual([t0[1], t0[0]]);
      const c = await inComment(page, 'habits');
      expect(c[0]).toBeLessThan(c[1]);
      await expect(toast(page)).toContainText('Moved.');
      await toast(page).getByRole('button', { name: 'Undo' }).click();
      await expect.poll(() => lines(page, 'habits')).toEqual(t0);
      expect((await inComment(page, 'habits'))[0]).toBeLessThan((await inComment(page, 'habits'))[1]);
    });

    test('arrow keys on a handle move the sentence the same way, and the handle keeps focus', async ({ page }) => {
      await openBox(page, 'strength');
      for (let i = 0; i < 2; i++) await box(page, 'strength').locator('[data-do="wcSay"]').first().click();
      await expect(box(page, 'strength').locator('.wc-line')).toHaveCount(3);
      const text0 = await lines(page, 'strength');
      const names0 = await names(page, 'strength');
      // At the top, up does nothing and says nothing.
      await box(page, 'strength').locator('.wc-grip').first().focus();
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
      await expect(toast(page)).toHaveCount(0);
      expect(await lines(page, 'strength')).toEqual(text0);
      await box(page, 'strength').locator('.wc-grip').last().focus();
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => lines(page, 'strength')).toEqual([text0[0], text0[2], text0[1]]);
      expect(await names(page, 'strength')).toEqual([names0[0], names0[2], names0[1]]);
      await expect(toast(page)).toContainText('Moved.');
      await expect(box(page, 'strength').locator('.wc-line').nth(1).locator('.wc-grip')).toBeFocused();
      const c = await inComment(page, 'strength');
      expect(c).toEqual([...c].sort((a, b) => a - b));
    });
  });
}
