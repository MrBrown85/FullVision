/**
 * The Comment Bank in the grader (docs/plans/comment-bank-plan.md, "The screens > Grader"), in
 * Demo Mode with the commentBank switch on before the page loads. Science 8, Scientific
 * Inquiry on the KMT & States of Matter Lab (sci8a4); the Lab Investigation rubric carries
 * sample comments (shared/seed-data.js). Noor has an earlier comment on the Cell Microscope
 * Lab, which shares the criterion's competencies, so Last Time shows.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

const AID = 'sci8a4';
const CRIT = 'crit_sci8_lab_inquiry';
const TESTABLE = 'Your question was testable and you kept the other variables the same.';
const LONG =
  'Your plan names the one thing you change and the one you measure. Next, say how many trials you will run and why that many is enough to trust the result, then list what you keep the same.';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

const rowOf = (page, sid) =>
  page.locator('#ac-' + AID + ' .rsg-criterion-row[data-student="' + sid + '"][data-criterion="' + CRIT + '"]');
const field = page => page.locator('#crit-comment-input');
const bankChips = page => page.locator('.rsg-crit-bank .rsg-crit-bank-chip');

async function startScenario(page, opts) {
  page.on('pageerror', e => {
    throw e;
  });
  await page.addInitScript(() => localStorage.setItem('fv-build-commentBank', '1'));
  if (!opts || opts.reduced !== false) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  await page.evaluate(
    ({ AID, CRIT, TESTABLE }) => {
      const cid = getActiveCourse();
      Grader.setCriterionComment(
        cid,
        'st2',
        'sci8a1',
        CRIT,
        'Name the variable you change before you start, and the data.',
      );
      // Two classmates were given a banked comment on the first lab: its count is 2.
      Grader.setCriterionComment(cid, 'st4', 'sci8a1', CRIT, TESTABLE);
      Grader.setCriterionComment(cid, 'st5', 'sci8a1', CRIT, TESTABLE);
      // Cece's comment on this lab is what Same As offers.
      Grader.setCriterionComment(cid, 'st1', AID, CRIT, 'Plan the test before you build it.');
    },
    { AID, CRIT, TESTABLE },
  );
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  const card = page.locator('#ac-' + AID);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await expect(rowOf(page, 'st2')).toBeVisible();
}

/* Noor's Scientific Inquiry comment, open, with Proficient picked. */
async function openNoor(page) {
  const row = rowOf(page, 'st2');
  await row.scrollIntoViewIfNeeded();
  if (!(await row.locator('.rsg-level.l3.active').count())) await row.locator('.rsg-level.l3').click();
  await row.locator('.rsg-crit-comment').click();
  await expect(field(page)).toBeFocused();
}

test.describe('The Comment Bank in the grader', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('Last Time above the box, Same As untouched, the Bank row for the level picked with counts', async ({
    page,
  }) => {
    await startScenario(page);
    await openNoor(page);
    const last = page.locator('.rsg-crit-last');
    await expect(last).toHaveText(/^Last Time, Cell Microscope Lab:\s*Name the variable you change/);
    expect(await last.evaluate(el => getComputedStyle(el.querySelector('.rsg-crit-last-text')).textOverflow)).toBe(
      'ellipsis',
    );
    const lastBox = await last.boundingBox();
    const fieldBox = await field(page).boundingBox();
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(fieldBox.y + 1);
    // Same As: the classmates' comments are offered as before.
    await expect(page.locator('.rsg-crit-reuse-label')).toHaveText('Same As');
    // Bank: the level picked (Proficient), most used first, with the count at the right.
    await expect(page.locator('.rsg-crit-bank-label')).toHaveText('Bank');
    await expect(bankChips(page).first()).toContainText(TESTABLE);
    await expect(bankChips(page).first().locator('.rsg-crit-bank-cx')).toHaveText('2×');
    expect(await bankChips(page).count()).toBeLessThanOrEqual(3);
    await expect(bankChips(page).nth(1)).toContainText('Noor, your safety steps');
    shot(page, 'bank-open-comment');
  });

  test('pointing at a chip, or Down from the empty box, shows the whole comment in grey; Enter picks it', async ({
    page,
  }) => {
    await startScenario(page);
    await page.evaluate(
      ({ CRIT, LONG }) => RubricComments.addCriterionComment(getActiveCourse(), 'rub_sci8_lab', CRIT, 3, LONG),
      { CRIT, LONG },
    );
    await openNoor(page);
    const was = await field(page).getAttribute('placeholder');
    await bankChips(page).first().hover();
    await expect(field(page)).toHaveAttribute('placeholder', TESTABLE);
    await expect(field(page)).toHaveValue('');
    await page.mouse.move(5, 5);
    await expect(field(page)).toHaveAttribute('placeholder', was);
    // A long comment makes the box grow to hold it, and it goes back after.
    const before = (await field(page).boundingBox()).height;
    await bankChips(page).last().hover();
    await expect(field(page)).toHaveAttribute('placeholder', LONG);
    expect((await field(page).boundingBox()).height).toBeGreaterThan(before);
    await page.mouse.move(5, 5);
    expect((await field(page).boundingBox()).height).toBe(before);
    // Down steps through Same As, then the Bank.
    await field(page).press('ArrowDown');
    const same = await page.locator('.rsg-crit-reuse-chip').first().getAttribute('title');
    await expect(field(page)).toHaveAttribute('placeholder', same);
    await field(page).press('ArrowDown');
    await expect(field(page)).toHaveAttribute('placeholder', TESTABLE);
    await expect(bankChips(page).first()).toHaveClass(/is-hi/);
    await field(page).press('ArrowUp');
    await field(page).press('ArrowUp');
    await expect(field(page)).toHaveAttribute('placeholder', was);
    await field(page).press('ArrowDown');
    await field(page).press('ArrowDown');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue(TESTABLE);
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('placeholder', was);
  });

  test('a long comment grows the box under the pointer; a click where the chip was still picks it', async ({
    page,
  }) => {
    await startScenario(page);
    await page.evaluate(
      ({ CRIT, LONG }) => RubricComments.addCriterionComment(getActiveCourse(), 'rub_sci8_lab', CRIT, 3, LONG),
      { CRIT, LONG },
    );
    await openNoor(page);
    await bankChips(page).last().hover();
    await expect(field(page)).toHaveAttribute('placeholder', LONG);
    await page.waitForTimeout(150);
    await expect(field(page)).toHaveAttribute('placeholder', LONG);
    await page.mouse.down();
    await page.mouse.up();
    await expect(field(page)).toHaveValue(LONG);
  });

  test('Enter and Escape with nothing highlighted mean what they did', async ({ page }) => {
    await startScenario(page);
    await openNoor(page);
    await field(page).press('Enter');
    await expect(rowOf(page, 'st2').locator('#crit-comment-input')).toHaveCount(0);
    await expect(page.locator('#crit-comment-input')).toHaveCount(1);
    await field(page).press('Escape');
    await expect(page.locator('#crit-comment-input')).toHaveCount(0);
  });

  test('a pick, more typed, Add to Bank keeps the new part, and the next student is offered it', async ({ page }) => {
    await startScenario(page);
    await openNoor(page);
    await bankChips(page).first().click();
    await expect(field(page)).toHaveValue(TESTABLE);
    await expect(field(page)).toBeFocused();
    await field(page).pressSequentially(' Noor, show your units on every table');
    await expect(page.locator('.rsg-crit-bank-add')).toHaveText('Add to Bank');
    shot(page, 'bank-add-to-bank');
    await page.locator('.rsg-crit-bank-add').click();
    await expect(page.locator('.rsg-crit-bank-kept')).toHaveText('In the Bank');
    const kept = await page.evaluate(
      ({ CRIT }) =>
        getRubricById(getActiveCourse(), 'rub_sci8_lab')
          .criteria.find(c => c.id === CRIT)
          .comments.slice(-1)[0],
      { CRIT },
    );
    expect(kept).toEqual({ level: 3, text: '[Name], show your units on every table' });
    await field(page).press('Escape');
    // The next student, with Proficient picked, is offered it with her own name.
    const next = rowOf(page, 'st3');
    await next.scrollIntoViewIfNeeded();
    await next.locator('.rsg-level.l3').click();
    await next.locator('.rsg-crit-comment').click();
    await field(page).pressSequentially('show your units');
    await expect(bankChips(page)).toHaveCount(1);
    await expect(bankChips(page).first()).toContainText('Sam, show your units on every table');
    // A pick takes the place of the part typed.
    await bankChips(page).first().click();
    await expect(field(page)).toHaveValue('Sam, show your units on every table');
  });

  test('the whole bank opens as one panel and shuts on a second click; Edit Comments opens Edit Rubric', async ({
    page,
  }) => {
    await startScenario(page, { reduced: false });
    await openNoor(page);
    await page.waitForTimeout(500);
    await page.locator('.rsg-crit-bank-label').click();
    const panel = page.locator('.rsg-crit-bank-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.rsg-crit-bank-lv').first()).toHaveText('Proficient');
    const levels = await panel.locator('.rsg-crit-bank-lv').allTextContents();
    expect(levels.filter(Boolean)).toEqual(['Proficient', 'Developing', 'Extending']);
    // Each comment once.
    const all = await panel.locator('.rsg-crit-bank-ct').allTextContents();
    expect(new Set(all).size).toBe(all.length);
    // Nothing clipped: the editor grows to hold the panel.
    await page.waitForTimeout(400);
    const clip = await page.evaluate(() => {
      const edit = document.querySelector('.rsg-crit-edit');
      const p = document.querySelector('.rsg-crit-bank-panel').getBoundingClientRect();
      const e = edit.getBoundingClientRect();
      return {
        maxHeight: getComputedStyle(edit).maxHeight,
        over: p.bottom - e.bottom,
        scroll: edit.scrollHeight - edit.clientHeight,
      };
    });
    expect(clip.maxHeight).toBe('none');
    expect(clip.over).toBeLessThanOrEqual(1);
    expect(clip.scroll).toBeLessThanOrEqual(1);
    shot(page, 'bank-whole-bank');
    await page.locator('.rsg-crit-bank-label').click();
    await expect(panel).toBeHidden();
    await page.locator('.rsg-crit-bank-label').click();
    await page.locator('.rsg-crit-bank-edit').click();
    await expect(page.getByText('Edit Rubric').first()).toBeVisible();
  });

  test('the Overall Comment shows the Bank while it has focus', async ({ page }) => {
    await startScenario(page);
    const overall = page.locator('#ac-' + AID + ' .rsg-overall-comment[data-sid="st2"]');
    await overall.scrollIntoViewIfNeeded();
    await overall.focus();
    const box = overall.locator('xpath=..').locator('.rsg-crit-bank-box');
    await expect(box).toBeVisible();
    await expect(box.locator('.rsg-crit-bank-chip')).toHaveCount(2);
    await box.locator('.rsg-crit-bank-chip').first().click();
    await expect(overall).toHaveValue(/You planned a fair test/);
    // The pick is saved, not only shown.
    expect(await page.evaluate(aid => getScoreComment(getActiveCourse(), 'st2', aid), AID)).toMatch(
      /^You planned a fair test/,
    );
    await overall.pressSequentially(' Then reread your units on every table');
    await box.locator('.rsg-crit-bank-add').click();
    await expect(box.locator('.rsg-crit-bank-kept')).toHaveText('In the Bank');
    expect(await page.evaluate(aid => getScoreComment(getActiveCourse(), 'st2', aid), AID)).toMatch(
      /Then reread your units on every table$/,
    );
    await page.locator('#ac-' + AID + ' .rsg-overall-comment[data-sid="st3"]').focus();
    await expect(box).toHaveCount(0);
  });
});

/* Nothing spills its box, at the widths of a desktop and a tablet, in the page's font and a wider one. */
for (const width of [1280, 820, 744]) {
  for (const font of FONTS) {
    test(`no chip or row spills its box at ${width} wide, in the ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await startScenario(page);
      await useFont(page, font);
      await openNoor(page);
      const spill = () =>
        page.evaluate(() => {
          const out = [];
          const edit = document.querySelector('.rsg-crit-edit');
          const e = edit.getBoundingClientRect();
          const inside = (el, within, what) => {
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            if (r.right > within.right + 1 || r.left < within.left - 1) out.push(what + ' leaves its box');
          };
          edit
            .querySelectorAll('.rsg-crit-last, .rsg-crit-bank, .rsg-crit-bank-panel, .rsg-crit-edit-box')
            .forEach(el => inside(el, e, el.className));
          document.querySelectorAll('.rsg-crit-bank .rsg-crit-bank-chips').forEach(row => {
            const r = row.getBoundingClientRect();
            row
              .querySelectorAll('.rsg-crit-bank-chip, .rsg-crit-bank-add, .rsg-crit-bank-kept')
              .forEach(el => inside(el, r, 'a chip'));
          });
          document.querySelectorAll('.rsg-crit-bank-panel .rsg-crit-bank-line').forEach(line => {
            const r = line.getBoundingClientRect();
            line
              .querySelectorAll('.rsg-crit-bank-chip, .rsg-crit-bank-edit')
              .forEach(el => inside(el, r, 'a panel chip'));
          });
          // Every chip is one line of its own height.
          document.querySelectorAll('.rsg-crit-bank-chip').forEach(c => {
            if (c.getBoundingClientRect().height > 26) out.push('a chip wraps');
          });
          return out;
        });
      expect(await spill()).toEqual([]);
      await field(page).pressSequentially(' Noor, show your units on every table and graph, then check each one');
      await expect(page.locator('.rsg-crit-bank-add')).toBeVisible();
      expect(await spill()).toEqual([]);
      await field(page).fill('');
      await page.locator('.rsg-crit-bank-label').click();
      await expect(page.locator('.rsg-crit-bank-panel')).toBeVisible();
      expect(await spill()).toEqual([]);
      await bankChips(page).count();
      shot(page, `bank-${width}-${font}`);
    });
  }
}
