import { test, expect } from '@playwright/test';
import { gotoApp, clickAction } from './helpers.js';

/* Class Settings › Grading › Points and Proficiency stays locked until Edit
   (docs/DECISIONS.md, "Points and Proficiency locks until Edit"). Colin,
   2026-11-27: "Users are accidentally dragging things and then forgetting
   where they had set them." The numbers (the rules, the ghost rule, what a
   draft would do to a grade, nothing leaking) are pinned in
   tests/grading-tab.test.js and tests/points-scale-draft.test.js; this checks
   the page: a pull on a locked marker, a drag in the draft, a ghost, a preset
   pointed at, Save's question, Undo, and a copy into another class. */

const MARKER_3 = '#cm-pts-step-3';
const scale = page => page.evaluate(() => structuredClone(getGradingScale('sci8')));
const left = (page, key) =>
  page.evaluate(k => document.querySelector('.cm-pts-marker[data-key="' + k + '"]:not(.cm-pts-ghost)').style.left, key);

async function openGrading(page, { letter = true, width = 1440 } = {}) {
  await page.setViewportSize({ width, height: 1100 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await gotoApp(page, '/dashboard?manage=grading&class=sci8');
  await expect(page.locator('.cm-gs-cards')).toBeVisible();
  if (letter) await page.locator('[data-action="cmSetGradingSystem"][data-value="letter"]').click();
  await expect(page.locator('#cm-pts-ruler')).toBeVisible();
  await page.locator('#cm-pts-ruler').scrollIntoViewIfNeeded();
  // The page redraws once the class's other settings have loaded: wait for the ruler to hold still.
  await expect
    .poll(async () => {
      const a = await page.locator(MARKER_3).boundingBox();
      await page.waitForTimeout(120);
      const b = await page.locator(MARKER_3).boundingBox();
      return a.x === b.x && a.y === b.y;
    })
    .toBe(true);
}

// A press on a marker, a pull across the ruler, and (unless held) the release.
async function drag(page, selector, dx, { release = true } = {}) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 3 });
  await page.mouse.move(x + dx, y, { steps: 3 });
  if (release) await page.mouse.up();
}

const slowed = async page => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 5 });
};

test.describe('locked until Edit', () => {
  test('a pull on a locked marker changes nothing and saves nothing, and pulses Edit', async ({ page }) => {
    await openGrading(page);
    const before = await scale(page);
    const stored = await page.evaluate(() => localStorage.getItem('gb-courseconfig-sci8'));
    // The markers are labels at rest, not buttons; there are no presets.
    await expect(page.locator('.cm-pts-scroll')).toHaveClass(/is-rest/);
    await expect(page.locator('button.cm-pts-pill, button.cm-pts-handle')).toHaveCount(0);
    await expect(page.locator('.cm-pts-actions')).toHaveCount(0);
    await expect(page.locator('.cm-pts-hint')).not.toContainText('Drag a marker');

    await drag(page, MARKER_3, 120, { release: false });
    // It gives up to 8px, then springs back when let go.
    const pulled = await page.locator(MARKER_3).evaluate(el => getComputedStyle(el).transform);
    expect(pulled).toMatch(/^matrix\(1, 0, 0, 1, (-?[0-9.]+), 0\)$/);
    expect(Math.abs(Number(pulled.match(/, (-?[0-9.]+), 0\)$/)[1]))).toBeLessThanOrEqual(8.01);
    await page.mouse.up();
    await expect(page.locator('#cm-pts-edit-btn')).toHaveClass(/is-nudge/);
    await expect(page.locator(MARKER_3)).not.toHaveClass(/is-pulling/);
    expect(await left(page, '3')).toBe('75%');
    expect(await scale(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem('gb-courseconfig-sci8'))).toBe(stored);
    // Arrow keys and Tab find nothing to move: no marker takes the focus.
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    expect(await left(page, '3')).toBe('75%');
  });

  test('with Reduce Motion a pull moves nothing, and Edit shows a still ring', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openGrading(page);
    await drag(page, MARKER_3, 120, { release: false });
    expect(await page.locator(MARKER_3).evaluate(el => getComputedStyle(el).transform)).toBe('none');
    await page.mouse.up();
    const ring = await page.locator('#cm-pts-edit-btn').evaluate(el => {
      const cs = getComputedStyle(el);
      return [cs.animationName, cs.boxShadow];
    });
    expect(ring[0]).toBe('none');
    expect(ring[1]).not.toBe('none');
  });
});

test.describe('editing', () => {
  test.beforeEach(async ({ page }) => {
    await openGrading(page);
  });

  test('Edit opens a draft; a drag moves the marker, Save waits, and Cancel puts everything back', async ({ page }) => {
    const before = await scale(page);
    await clickAction(page, 'cmPtsEdit');
    await expect(page.locator('.cm-pts-scroll')).toHaveClass(/is-editing/);
    await expect(page.locator('#cm-pts-save')).toBeDisabled();
    await expect(page.locator('.cm-pts-actions')).toHaveCount(1);
    await drag(page, MARKER_3, 45);
    expect(Number((await left(page, '3')).replace('%', ''))).toBeGreaterThan(75.5);
    await expect(page.locator('#cm-pts-save')).toBeEnabled();
    // Nothing is saved until Save.
    expect(await scale(page)).toEqual(before);
    await clickAction(page, 'cmPtsCancel');
    await expect(page.locator('.cm-pts-scroll')).toHaveClass(/is-rest/);
    expect(await left(page, '3')).toBe('75%');
    expect(await scale(page)).toEqual(before);
    await expect(page.locator('#cm-pts-save')).toHaveCount(0);
  });

  test('a drag keeps up with the pointer on a slow computer', async ({ page }) => {
    await slowed(page);
    await clickAction(page, 'cmPtsEdit');
    await drag(page, MARKER_3, 45);
    expect(Number((await left(page, '3')).replace('%', ''))).toBeGreaterThan(75.5);
    // The ghost the drag left is drawn, and the Check With a Student card has read the draft.
    await expect(page.locator('.cm-pts-ghost[data-key="3"]')).toHaveCount(1);
    await expect(page.locator('.cm-check-was')).toBeVisible();
  });

  test('the grade preview is in view with the ruler during a drag, and goes when the draft moves no grade', async ({
    page,
  }) => {
    await clickAction(page, 'cmPtsEdit');
    await expect(page.locator('#cm-pts-preview')).toHaveText('');
    await drag(page, MARKER_3, 45, { release: false });
    const line = page.locator('#cm-pts-preview');
    await expect(line).toContainText('Cece Adeyemi');
    await expect(line).toContainText(', was B 78.9%');
    // The ruler and the answer to the drag are on screen together, with no scrolling up to the card.
    const inView = async sel => {
      const b = await page.locator(sel).boundingBox();
      const h = await page.evaluate(() => innerHeight);
      return b.y >= 0 && b.y + b.height <= h;
    };
    expect(await inView('#cm-pts-ruler')).toBe(true);
    expect(await inView('#cm-pts-preview')).toBe(true);
    await page.mouse.up();
    // Back to where it was saved: nothing moves, so nothing is said.
    await page.locator('.cm-pts-ghost[data-key="3"] .cm-pts-pill').click();
    await expect(line).toHaveText('');
  });

  test('a ghost marks the saved place, and clicking it puts the marker back', async ({ page }) => {
    await clickAction(page, 'cmPtsEdit');
    await drag(page, MARKER_3, 45);
    const ghost = page.locator('.cm-pts-ghost[data-key="3"] .cm-pts-pill');
    await expect(ghost).toHaveAttribute('aria-label', 'Put 3 back at 75%');
    // Where it was saved, on its row.
    expect(await page.locator('.cm-pts-ghost[data-key="3"]').evaluate(el => el.style.left)).toBe('75%');
    await ghost.click();
    expect(await left(page, '3')).toBe('75%');
    await expect(page.locator('.cm-pts-ghost')).toHaveCount(0);
    await expect(page.locator('#cm-pts-save')).toBeDisabled();
  });

  test('a band start that moves leaves a dashed line and tab, and clicking puts it back', async ({ page }) => {
    await clickAction(page, 'cmPtsEdit');
    await page.locator('#cm-pts-edge-3').focus();
    // Shift moves a handle by 5: far enough that its ghost is not under it.
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    const ghost = page.locator('.cm-pts-edge.cm-pts-ghost[data-level="3"] .cm-pts-handle');
    await expect(ghost).toHaveAttribute('aria-label', 'Put Proficient back at 73%');
    await ghost.click();
    await expect(page.locator('.cm-pts-ghost')).toHaveCount(0);
    expect((await scale(page)).boundaries[1]).toEqual({ min: 73, proficiency: 3 });
  });

  test('pointing at a preset shows where the markers would land; leaving puts them back; clicking takes it', async ({
    page,
  }) => {
    await clickAction(page, 'cmPtsEdit');
    const bc = page.locator('[data-action="cmPointsScaleBc"]');
    await bc.hover();
    await expect.poll(() => left(page, '3')).toBe('80%');
    // The saved place is marked while it is previewed.
    await expect(page.locator('.cm-pts-ghost').first()).toBeAttached();
    expect((await scale(page)).percents[3]).toBe(75);
    await page.mouse.move(5, 5);
    await expect.poll(() => left(page, '3')).toBe('75%');
    await expect(page.locator('.cm-pts-ghost')).toHaveCount(0);
    // Focus previews too.
    await bc.focus();
    await expect.poll(() => left(page, '3')).toBe('80%');
    await bc.click();
    await expect.poll(() => left(page, '3')).toBe('80%');
    await expect(page.locator('#cm-pts-save')).toBeEnabled();
    expect((await scale(page)).percents[3]).toBe(75);
  });

  test('Check With a Student reads the draft: Was, and the letters that change', async ({ page }) => {
    const was = await page.locator('.cm-check-value').innerText();
    await clickAction(page, 'cmPtsEdit');
    await page.locator('[data-action="cmPointsScaleBc"]').click();
    await expect(page.locator('.cm-check-was')).toHaveText('Was ' + was);
    await expect(page.locator('.cm-check-value')).not.toHaveText(was);
    const group = page.locator('.cm-check-group', { hasText: 'Letter Grades That Change' });
    await expect(group).toBeVisible();
    await expect(group.locator('.cm-check-sub')).toContainText(/^· \d+ of 27$/);
    await expect(group.locator('.cm-check-move').first()).toContainText(' → ');
    await clickAction(page, 'cmPtsCancel');
    await expect(page.locator('.cm-check-was')).toHaveCount(0);
    await expect(page.locator('.cm-check-value')).toHaveText(was);
  });

  test('Save asks what moved, saves on Save, and Undo puts the previous scale back', async ({ page }) => {
    const before = await scale(page);
    await clickAction(page, 'cmPtsEdit');
    await page.locator('[data-action="cmPointsScaleBc"]').click();
    await clickAction(page, 'cmPtsSave');
    await expect(page.locator('#confirm-title')).toHaveText('Change the Course %?');
    const rows = page.locator('.cm-pts-ask-row:not(.is-wide)');
    await expect(rows.first()).toContainText('→');
    expect(await rows.count()).toBeGreaterThan(3);
    await expect(page.locator('.confirm-message')).toContainText(/\d+ students? gets? a new letter grade\./);
    // Cancel sends nothing.
    await page.locator('#confirm-cancel-btn').click();
    expect(await scale(page)).toEqual(before);
    await clickAction(page, 'cmPtsSave');
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('.undo-toast')).toContainText('Markers saved');
    await expect(page.locator('.cm-pts-scroll')).toHaveClass(/is-rest/);
    expect((await scale(page)).percents[3]).toBe(80);
    await page.locator('.undo-toast-btn').click();
    await expect.poll(() => scale(page)).toEqual(before);
    expect(await left(page, '3')).toBe('75%');
  });

  test('leaving the Grading tab drops the draft', async ({ page }) => {
    await clickAction(page, 'cmPtsEdit');
    await page.locator('[data-action="cmPointsScaleBc"]').click();
    await page.getByRole('tab', { name: /^Details/ }).click();
    await page.getByRole('tab', { name: /^Grading/ }).click();
    await expect(page.locator('.cm-pts-scroll')).toHaveClass(/is-rest/);
    expect(await left(page, '3')).toBe('75%');
  });
});

test.describe('Use in Other Classes', () => {
  test('copies the markers to another class through the check step, and not before', async ({ page }) => {
    await openGrading(page);
    await page.evaluate(() => {
      createCourse({ name: 'Science 8', gradingSystem: 'letter', block: 'D' });
    });
    // This class's markers: BC Letter Bands, saved.
    await clickAction(page, 'cmPtsEdit');
    await page.locator('[data-action="cmPointsScaleBc"]').click();
    await clickAction(page, 'cmPtsSave');
    await page.locator('#confirm-ok-btn').click();
    await expect(page.locator('.undo-toast')).toBeVisible();

    await clickAction(page, 'cmPtsUse');
    const dialog = page.locator('.copy-dialog.gsc-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#copy-dialog-title')).toHaveText('Copy Grading Setup');
    // Only Points and Proficiency is on; Review Changes waits for a class.
    await expect(dialog.locator('[data-gsc-group][aria-checked="true"]')).toHaveCount(1);
    await expect(dialog.locator('[data-gsc-group="gradingScale"]')).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('[data-copy-ok]')).toBeDisabled();
    const other = dialog.locator('[data-gsc-dst]').first();
    await expect(other).toHaveAttribute('role', 'switch');
    await other.click();
    await expect(other).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('.gsc-row.active')).toHaveCount(2);
    await dialog.locator('[data-copy-ok]').click();

    const review = page.locator('.copy-dialog.gsc-dialog', { hasText: 'Check Before Copying' });
    await expect(review).toBeVisible();
    await expect(review).toContainText('3: 75% → 80%.');
    await expect(review.locator('.gsc-mini[role="img"]')).toHaveCount(2);
    const target = await page.evaluate(() => Object.keys(COURSES).find(id => id !== 'sci8'));
    // Nothing has been copied yet.
    expect(await page.evaluate(id => getGradingScale(id).percents[3], target)).toBe(75);
    await review.locator('[data-copy-ok]').click();
    await expect.poll(() => page.evaluate(id => getGradingScale(id).percents[3], target)).toBe(80);
    expect(await scale(page)).toEqual(await page.evaluate(id => getGradingScale(id), target));
  });

  test('the dialog and the ruler keep their text inside their boxes in a wide font', async ({ page }) => {
    await openGrading(page, { width: 1280 });
    await page.addStyleTag({
      content:
        '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }',
    });
    await page.evaluate(() => {
      createCourse({ name: 'Science 8', gradingSystem: 'letter', block: 'D' });
    });
    // The preview beside the longest pick label fits in the row, and the row keeps its height.
    await clickAction(page, 'cmPtsEdit');
    const rowHeight = () => page.locator('.cm-pts-edit').evaluate(el => el.getBoundingClientRect().height);
    const idle = await rowHeight();
    await page.locator('#cm-pts-edge-2').click();
    await page.fill('#cm-pts-input', '55');
    await page.locator('#cm-pts-step-3').click();
    await page.fill('#cm-pts-input', '90');
    await page.press('#cm-pts-input', 'Enter');
    await page.locator('#cm-pts-edge-2').click();
    await expect(page.locator('#cm-pts-preview span').first()).toBeVisible();
    expect(await rowHeight()).toBe(idle);
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll('#cm-pts-preview span')].map(s => s.scrollWidth > s.clientWidth + 1),
    );
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.every(c => c === false)).toBe(true);
    await clickAction(page, 'cmPtsCancel');
    // The header's two buttons fit beside the label, and the hint does not run under them.
    const head = await page.locator('.cm-pts-head').boundingBox();
    const actions = await page.locator('.cm-pts-head-actions').boundingBox();
    expect(actions.x + actions.width).toBeLessThanOrEqual(head.x + head.width + 0.5);
    await clickAction(page, 'cmPtsUse');
    const card = page.locator('.gsc-dialog .copy-dialog-card');
    await expect(card).toBeVisible();
    const fits = await page.evaluate(() => {
      const card = document.querySelector('.gsc-dialog .copy-dialog-card').getBoundingClientRect();
      return [...document.querySelectorAll('.gsc-row')].map(row => {
        const r = row.getBoundingClientRect();
        const sw = row.querySelector('.rb-switch').getBoundingClientRect();
        const text = row.querySelector('.gsc-row-text');
        return {
          inside: r.left >= card.left - 0.5 && r.right <= card.right + 0.5,
          switchInside: sw.right <= r.right + 0.5 && sw.left >= r.left - 0.5,
          // A long line is cut with an ellipsis, never pushed over the switch.
          textClear: text.getBoundingClientRect().right <= sw.left + 0.5,
        };
      });
    });
    expect(fits.length).toBeGreaterThan(8);
    fits.forEach(f => expect(f).toEqual({ inside: true, switchInside: true, textClear: true }));
  });
});
