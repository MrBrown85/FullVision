/**
 * Comments in the rubric editor (Comment Bank, switch on): Edit Rubric from the
 * Rubric Bank and the assessment form's editor. Demo Mode, Science 8, whose Lab
 * Investigation Rubric keeps comments. The layout holds in the page font and a
 * wide stand-in, at a desktop width and two iPad widths.
 */
import { test, expect } from '@playwright/test';
import { clickToolbarItem } from './helpers.js';
import { FONTS, useFont } from './wide-font.js';

const LONG =
  'You planned a fair test, kept every other variable the same and wrote down what you saw at each step. Next, explain what the result tells you using the words from class, and say what you would change.';

async function demo(page, width = 1280) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
}

async function openEditor(page) {
  await clickToolbarItem(page, 'more', 'openRubricBank');
  const bank = page.getByRole('dialog', { name: 'Rubric Bank' });
  await expect(bank).toBeVisible();
  await bank.locator('.rb-row', { hasText: 'Lab Investigation Rubric' }).click();
  await bank.locator('[data-rb="edit"]').click();
  const ed = page.locator('#rubric-modal');
  await expect(ed.locator('.af-ge-card')).toBeVisible();
  return ed;
}

const rubric = page =>
  page.evaluate(() => JSON.parse(JSON.stringify(getRubrics('sci8').find(r => r.name === 'Lab Investigation Rubric'))));

/* A criterion of its own, so it starts with no comments. */
const newRow = async ed => {
  await ed.locator('[data-action="geAddCrit"]').click();
  return ed.locator('.af-ge-grid tbody tr:not(.af-cm-overall)').last();
};

test('+ Comments, type comments at two levels, save, reopen: they are bubbles', async ({ page }) => {
  await demo(page);
  let ed = await openEditor(page);
  const row = await newRow(ed);
  // Shut: the link, and no line to type in.
  await expect(row.locator('.af-cm-link')).toHaveText('+ Comments');
  await expect(ed.locator('textarea.af-cm-field')).toHaveCount(0);
  await row.locator('.af-cm-link').click();
  // Open: the link goes, one empty line a level.
  await expect(row.locator('.af-cm-link')).toHaveCount(0);
  const l3 = row.locator('.af-ge-cell:has([data-level="3"])');
  const l2 = row.locator('.af-ge-cell:has([data-level="2"])');
  // The caret is in the first empty line.
  await expect(row.locator('textarea.af-cm-field').first()).toBeFocused();
  const first = row.locator('textarea.af-cm-field[data-level="3"]').first();
  await expect(first).toHaveAttribute('placeholder', 'Add a comment');
  await first.click();
  await first.pressSequentially('Careful with the steps.');
  // The next empty line has come, and the caret stayed in the line being typed.
  await expect(row.locator('textarea.af-cm-field[data-level="3"]')).toHaveCount(2);
  await expect(first).toBeFocused();
  await row.locator('textarea.af-cm-field[data-level="3"]').nth(1).fill('Shows each step in order.');
  await row.locator('textarea.af-cm-field[data-level="2"]').first().fill('Needs the steps one at a time.');
  await expect(l3.locator('textarea.af-cm-field')).toHaveCount(3);
  await expect(l2.locator('textarea.af-cm-field')).toHaveCount(2);
  await ed.locator('[data-action="geSave"]').click();
  await expect(page.locator('#rubric-modal')).toHaveCount(0);
  const saved = await rubric(page);
  const crit = saved.criteria[saved.criteria.length - 1];
  expect(crit.comments.filter(c => c.level === 3).map(c => c.text)).toEqual([
    'Careful with the steps.',
    'Shows each step in order.',
  ]);
  expect(crit.comments.filter(c => c.level === 2).map(c => c.text)).toEqual(['Needs the steps one at a time.']);
  // Reopened, they are bubbles.
  ed = await openEditor(page);
  const bubbles = ed.locator('.af-ge-grid tbody tr:not(.af-cm-overall)').last().locator('.af-cm');
  await expect(bubbles).toHaveCount(3);
  // In the grid's order, level by level.
  await expect(bubbles.first()).toHaveAttribute('title', 'Needs the steps one at a time.');
  await expect(bubbles.nth(1)).toHaveAttribute('title', 'Careful with the steps.');
  // A click on a bubble opens the criterion with the caret in that line.
  await bubbles.nth(2).click();
  await expect(ed.locator('textarea.af-cm-field:focus')).toHaveValue('Shows each step in order.');
});

test('an emptied line is dropped on save; the other classes are never offered a comment that is not there', async ({
  page,
}) => {
  await demo(page);
  const ed = await openEditor(page);
  const before = (await rubric(page)).criteria[0].comments.length;
  await ed.locator('.af-ge-grid tbody tr').first().locator('.af-cm-link').click();
  const lines = ed.locator('.af-ge-grid tbody tr').first().locator('textarea.af-cm-field:not(.is-new)');
  await lines.first().fill('');
  await ed.locator('[data-action="geSave"]').click();
  expect((await rubric(page)).criteria[0].comments.length).toBe(before - 1);
});

test('shut, a comment shows three lines at most and the whole text is its title', async ({ page }) => {
  await demo(page, 820);
  let ed = await openEditor(page);
  const row = await newRow(ed);
  await row.locator('.af-cm-link').click();
  await row.locator('textarea.af-cm-field[data-level="3"]').first().fill(LONG);
  await ed.locator('[data-action="geSave"]').click();
  ed = await openEditor(page);
  const bubble = ed.locator('.af-ge-grid tbody tr:not(.af-cm-overall)').last().locator('.af-cm').first();
  await expect(bubble).toHaveAttribute('title', LONG);
  const m = await bubble.locator('.af-cm-t').evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      h: el.getBoundingClientRect().height,
      line: parseFloat(cs.lineHeight),
      cut: el.scrollHeight > el.clientHeight,
    };
  });
  expect(m.h).toBeLessThanOrEqual(m.line * 3 + 1);
  expect(m.cut).toBe(true);
});

test('overall comments: + Overall Comments in the foot opens the last row', async ({ page }) => {
  await demo(page);
  const ed = await openEditor(page);
  // The Lab rubric keeps two: shut, a row of bubbles.
  const overall = ed.locator('.af-cm-overall');
  await expect(overall.locator('.af-cm')).toHaveCount(2);
  await ed.locator('.af-ge-foot [data-cm="open"]').click();
  await expect(overall.locator('textarea.af-cm-field')).toHaveCount(3);
  await overall.locator('textarea.af-cm-field').nth(2).fill('Next time, share your plan first.');
  await ed.locator('[data-action="geSave"]').click();
  await expect.poll(async () => (await rubric(page)).overallComments.length).toBe(3);
});

test('the assessment form’s editor has the same comments', async ({ page }) => {
  await demo(page);
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  const ed = page.locator('#af-rubric-view .af-ge-card');
  await expect(ed).toBeVisible();
  await ed.locator('.af-ge-tools .af-cm-link').first().click();
  const f3 = ed.locator('textarea.af-cm-field[data-level="3"]').first();
  await f3.fill('Clear plan.');
  await expect(ed.locator('textarea.af-cm-field[data-level="3"]')).toHaveCount(2);
  // Opening another criterion shuts this one: its comment is a bubble.
  await ed.locator('[data-action="geAddCrit"]').click();
  await ed.locator('.af-ge-grid tbody tr').nth(1).locator('.af-cm-link').click();
  await expect(ed.locator('.af-ge-grid tbody tr').first().locator('.af-cm')).toHaveText('Clear plan.');
  await ed.locator('#af-ge-name').fill('Form Rubric');
  await ed.locator('[data-action="geSave"]').click();
  await expect(page.locator('#af-rubric-view .af-ge-card')).toHaveCount(0);
});

for (const font of FONTS) {
  for (const width of [1280, 820, 744]) {
    test(`layout in the ${font} font at ${width}: no bubble spills its cell, comment words line up under the description`, async ({
      page,
    }) => {
      await demo(page, width);
      const ed = await openEditor(page);
      await useFont(page, font);
      const measure = () =>
        ed.evaluate(card => {
          const out = { spill: [], offset: [], bubbles: 0 };
          card.querySelectorAll('.af-ge-grid tbody tr:not(.af-cm-overall) td.af-ge-cell').forEach(td => {
            const cell = td.getBoundingClientRect();
            const text = td.querySelector('.af-ge-text');
            if (!text) return;
            const want = text.getBoundingClientRect().left + parseFloat(getComputedStyle(text).paddingLeft);
            td.querySelectorAll('.af-cm, .af-cm-field').forEach(b => {
              out.bubbles++;
              const r = b.getBoundingClientRect();
              if (r.left < cell.left - 0.5 || r.right > cell.right + 0.5) out.spill.push(b.className);
              const inner = b.querySelector('.af-cm-t');
              const left = inner
                ? inner.getBoundingClientRect().left
                : r.left + parseFloat(getComputedStyle(b).paddingLeft);
              if (Math.abs(left - want) > 1) out.offset.push([left, want]);
            });
          });
          return out;
        });
      const shut = await measure();
      expect(shut.bubbles).toBeGreaterThan(0);
      expect(shut.spill).toEqual([]);
      expect(shut.offset).toEqual([]);
      // Open: the same for the lines to type in.
      await ed.locator('.af-ge-grid tbody tr').first().locator('.af-cm-link').click();
      const open = await measure();
      expect(open.bubbles).toBeGreaterThan(shut.bubbles);
      expect(open.spill).toEqual([]);
      expect(open.offset).toEqual([]);
    });
  }
}
