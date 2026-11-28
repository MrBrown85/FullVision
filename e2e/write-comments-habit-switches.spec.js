import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The Work Habits switches on Write Comments (Colin, Nov 27): each habit's
   row has an In the Comment switch that adds the habit to the comment or
   takes it out. The bank's sentence is worded again for the habits it now
   names; a sentence the teacher edited is never rewritten; Generate Again
   keeps the choices; a sentence sits under the first habit it names; two
   sentences naming one habit show a note with Remove One. Demo Mode,
   Science 8's Report 2, Cece. */
test.use({ viewport: { width: 1440, height: 1100 } });

const KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
// Consistently: Completes Work, Comes Ready (one sentence); Usually: Works With Others, Takes Part (another).
const RATED = { completes: 4, ready: 4, others: 3, part: 3, feedback: 3, devices: 4 };

async function open(page, ratings = RATED) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  for (const key of KEYS)
    if (ratings[key]) await page.locator(`.qn-hs-stop[data-habit="${key}"][data-value="${ratings[key]}"]`).click();
  await page.locator('#tq-generate').click();
  await expect(lines(page).first()).toBeVisible();
}

const sw = (page, key) => page.locator(`.wc-fact-wrap[data-fact="habit:${key}"] input[role="switch"]`);
const lines = page => page.locator('.wc-box[data-part="habits"] .wc-line .wc-text');
const comment = page => page.locator('#tq-narrative').inputValue();
/* The switch clicked the way a teacher does (it is an invisible input over the track). */
const flip = async (page, key) => {
  await page.locator(`.wc-fact-wrap[data-fact="habit:${key}"] .wc-sw`).click();
};
const states = async page => {
  const out = {};
  for (const k of KEYS) out[k] = await sw(page, k).isChecked();
  return out;
};
const choice = page =>
  page.evaluate(() => (getStudentTermRating('sci8', 'st1', 'term-2').draftMeta || {}).habit_choice || null);
/* The habit each sentence sits under, first habit's name by sentence text. */
const placed = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.wc-box[data-part="habits"] .wc-line')].map(l => [
      l.closest('.wc-fact-wrap').dataset.fact.replace('habit:', ''),
      l.querySelector('.wc-text').textContent,
    ]),
  );

for (const font of FONTS) {
  test.describe(font + ' font', () => {
    test('each habit row has an In the Comment switch, on when a sentence names it, in one line', async ({ page }) => {
      await open(page);
      await useFont(page, font);
      expect(await states(page)).toEqual({
        completes: true,
        ready: true,
        others: true,
        part: true,
        feedback: false,
        devices: false,
      });
      for (const k of KEYS) {
        await expect(sw(page, k)).toHaveAttribute('role', 'switch');
        await expect(sw(page, k)).toHaveAccessibleName('In the Comment');
      }
      // The switch, the bars and the rating word sit on one line at the row's right end, in the row.
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('.wc-box[data-part="habits"] .wc-fact')].map(f => {
          const r = f.getBoundingClientRect();
          const box = el => el.getBoundingClientRect();
          const s = box(f.querySelector('.wc-sw'));
          const b = box(f.querySelector('.qn-hs'));
          const v = f.querySelector('.wc-val');
          return {
            sameLine: Math.abs(s.top + s.height / 2 - (b.top + b.height / 2)) < 3,
            inside: s.right <= r.right + 0.5 && s.left >= r.left,
            afterWord: s.left >= box(v).right - 0.5,
            wordFits: v.scrollWidth <= v.clientWidth + 0.5,
            w: s.width,
          };
        }),
      );
      for (const r of rows) {
        expect(r).toMatchObject({ sameLine: true, inside: true, afterWord: true, wordFits: true });
        expect(r.w).toBeCloseTo(rows[0].w, 0);
      }
    });

    test('a switch on adds the habit, a switch off takes it out, and the choice is kept', async ({ page }) => {
      await open(page);
      await useFont(page, font);
      const was = await comment(page);
      await flip(page, 'devices');
      await expect(sw(page, 'devices')).toBeChecked();
      expect((await placed(page)).map(a => a[0])).toContain('devices');
      expect(await comment(page)).not.toBe(was);
      // The bank's own wording for the habit: the comment still says every other habit it did.
      expect(await comment(page)).toContain('hands in her work on time');
      await flip(page, 'feedback');
      await expect(sw(page, 'feedback')).toBeChecked();
      expect((await placed(page)).map(a => a[0])).toContain('feedback');
      // Off: the sentence is worded again without it.
      await flip(page, 'completes');
      await expect(sw(page, 'completes')).not.toBeChecked();
      expect(await comment(page)).not.toContain('hands in her work on time');
      expect(await states(page)).toEqual({
        completes: false,
        ready: true,
        others: true,
        part: true,
        feedback: true,
        devices: true,
      });
      // A sentence that named only that habit goes.
      await flip(page, 'ready');
      const kept = await choice(page);
      expect(kept.off.sort()).toEqual(['completes', 'ready']);
      expect(kept.on).toEqual(expect.arrayContaining(['devices', 'feedback']));
      // Back on again.
      await flip(page, 'completes');
      await expect(sw(page, 'completes')).toBeChecked();
      expect(await comment(page)).toContain('done on time');
    });

    test('every habit switched on has its own sentence, six switches on, six habits named', async ({ page }) => {
      await open(page);
      await useFont(page, font);
      for (const k of KEYS) {
        if (!(await sw(page, k).isChecked())) await flip(page, k);
      }
      for (const k of KEYS) await expect(sw(page, k)).toBeChecked();
    });

    test('Generate Again keeps what is on and leaves out what is off', async ({ page }) => {
      await open(page);
      await useFont(page, font);
      await flip(page, 'devices');
      await flip(page, 'feedback');
      await flip(page, 'completes');
      const want = { completes: false, ready: true, others: true, part: true, feedback: true, devices: true };
      for (let n = 0; n < 3; n++) {
        await page.locator('#tq-generate').click();
        await expect.poll(() => states(page)).toEqual(want);
        const text = await comment(page);
        expect(text).not.toContain('hands in her work on time');
        const at = (await placed(page)).map(a => a[0]);
        expect(at).toContain('devices');
        expect(at).toContain('feedback');
      }
      // And after the page is opened again.
      await page.reload();
      await page.locator('#report-period').selectOption('Report 2');
      await expect.poll(() => states(page)).toEqual(want);
    });

    test('a sentence the teacher edited is never rewritten; its habits stay on and cannot be switched', async ({
      page,
    }) => {
      await open(page);
      await useFont(page, font);
      await lines(page).first().click();
      const mine = 'She is dependable about handing in work and arriving ready.';
      await page.locator('.wc-edit').fill(mine);
      await page.keyboard.press('Enter');
      await expect(lines(page).first()).toHaveText(mine);
      for (const k of ['completes', 'ready']) {
        await expect(sw(page, k)).toBeChecked();
        await expect(sw(page, k)).toBeDisabled();
      }
      await flip(page, 'devices');
      await flip(page, 'others');
      await expect(sw(page, 'others')).not.toBeChecked();
      expect(await comment(page)).toContain(mine);
      await page.locator('#tq-generate').click();
      await expect.poll(() => comment(page)).toContain(mine);
      await expect(sw(page, 'others')).not.toBeChecked();
      await expect(sw(page, 'devices')).toBeChecked();
    });

    test('a sentence sits under the first habit it names; the others it names are lit when it is pointed at', async ({
      page,
    }) => {
      await open(page);
      await useFont(page, font);
      const at = await placed(page);
      // "hands in her work … comes to class ready" names Completes Work first; "works well with others … joins in" Works With Others.
      expect(at.map(a => a[0])).toEqual(['completes', 'others']);
      const first = page.locator('.wc-fact-wrap[data-fact="habit:completes"] .wc-line');
      await first.hover();
      await expect(page.locator('.wc-fact-wrap[data-fact="habit:ready"] .wc-fact')).toHaveClass(/\bhot\b/);
      await expect(page.locator('.wc-fact-wrap[data-fact="habit:others"] .wc-fact')).not.toHaveClass(/\bhot\b/);
      await page.locator('.wc-fact-wrap[data-fact="habit:others"] .wc-line').hover();
      await expect(page.locator('.wc-fact-wrap[data-fact="habit:part"] .wc-fact')).toHaveClass(/\bhot\b/);
      await expect(page.locator('.wc-fact-wrap[data-fact="habit:ready"] .wc-fact')).not.toHaveClass(/\bhot\b/);
      // Taking the first habit out moves the sentence under the next one it names.
      await flip(page, 'completes');
      expect((await placed(page)).map(a => a[0])).toEqual(['ready', 'others']);
    });

    test('two sentences naming one habit show a note; Remove One takes out the later bank sentence', async ({
      page,
    }) => {
      await open(page);
      await useFont(page, font);
      await expect(page.locator('#wc-notes .wc-note', { hasText: 'name' })).toHaveCount(0);
      await page.locator('.wc-box[data-part="habits"] [data-do="wcSay"]').click();
      const note = page.locator('#wc-notes .wc-note', { hasText: /sentences name / });
      await expect(note).toHaveCount(1);
      await expect(note.locator('.wc-note-text')).toHaveText(/^Two sentences name [A-Z][\w ,]+\.$/);
      const before = await lines(page).count();
      const text = await comment(page);
      await note.getByRole('button', { name: 'Remove One' }).click();
      await expect(note).toHaveCount(0);
      expect(await lines(page).count()).toBe(before - 1);
      expect((await comment(page)).length).toBeLessThan(text.length);
      // The first sentence stays; the habits it names are still on.
      expect((await states(page)).completes).toBe(true);
    });
  });
}

test.describe('motion', () => {
  test('a sentence that moves glides about 200 ms, nothing fades in; Reduce Motion turns it off', async ({ page }) => {
    await open(page);
    const glides = () =>
      page.evaluate(() => {
        document.querySelector('.wc-fact-wrap[data-fact="habit:completes"] .wc-sw').click();
        return document
          .getAnimations()
          .filter(a => a.effect.target && a.effect.target.closest && a.effect.target.closest('#wc-boxes'))
          .filter(a => a.constructor.name === 'Animation')
          .map(a => ({
            d: a.effect.getTiming().duration,
            keys: Object.keys(a.effect.getKeyframes()[0]).filter(
              k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k),
            ),
          }));
      });
    const anims = await glides();
    expect(anims.some(a => a.d === 200 && a.keys.includes('transform'))).toBe(true);
    expect(anims.some(a => a.keys.includes('opacity'))).toBe(false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await flipBack(page);
    const still = await glides();
    expect(still).toEqual([]);
  });

  test('with the CPU slowed five times the sentence still lands under the right habit', async ({ page }) => {
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 5 });
    await flip(page, 'completes');
    await expect.poll(() => placed(page).then(a => a.map(x => x[0]))).toEqual(['ready', 'others']);
    await flip(page, 'devices');
    await expect(sw(page, 'devices')).toBeChecked();
    expect((await placed(page)).map(a => a[0])).toContain('devices');
    // Nothing is still moving.
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});

async function flipBack(page) {
  await page.locator('.wc-fact-wrap[data-fact="habit:completes"] .wc-sw').click();
}
