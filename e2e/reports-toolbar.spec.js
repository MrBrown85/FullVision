/**
 * The Reports toolbar in the Assignments bar's style (teacher/report-toolbar.js;
 * Colin, Nov 25: "the Reporting bar in the same style"). Demo Mode, Science 8,
 * 27 students.
 *
 * Term Questionnaire: Report, the Ready count with its track, ⋯ (Edit Student,
 * Where This Information Comes From) and Approve and Next ›, which reads
 * Print Reports › while every student is Ready. Print Reports: the student
 * picker, Report, and Print Reports; on a narrow window the arrows and Parts.
 *
 * Layout is asserted in the page's own font and in the wide stand-in for CI's
 * Linux fonts (e2e/wide-font.js): one row from 1280 with no sideways overflow,
 * a clean wrap at 1024 and 820, and the right-hand buttons where they were
 * when a student is approved or the tab changes.
 */
import { test, expect } from '@playwright/test';
import { useFont } from './wide-font.js';

// The wide stand-in is a style the page's own CSP would refuse.
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });

async function openReports(page, tab = 'questionnaire', width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.goto('/reports?tab=' + tab + '&student=st1');
  await page.locator('.report-toolbar').waitFor();
  if (tab === 'questionnaire') {
    await page.locator('#report-period').selectOption('Report 2');
    await page.locator('#tq-narrative').waitFor();
  }
}

const tab = (page, id) => page.locator('.report-seg-btn[data-tab="' + id + '"]');
const approve = page => page.locator('#tq-approve-next');
const more = page => page.locator('#tq-more-btn');
const ready = page => page.locator('#tq-ready');
const track = page => page.locator('#tq-ready-track');

// Every part of the bar that is drawn: { name, x, y, w, h }.
const boxes = page =>
  page.evaluate(() => {
    const tb = document.querySelector('.report-toolbar');
    const out = [];
    tb.querySelectorAll(':scope > *, .rtb-end > *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.classList.contains('rtb-end')) return;
      out.push({
        name: el.id || el.className.split(' ')[0] || el.tagName,
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      });
    });
    return out;
  });
const box = async (page, sel) => {
  const r = await page.locator(sel).boundingBox();
  return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10 };
};

/* No sideways overflow and nothing past the bar's edges; the rows the parts
   sit in and any two that overlap (a part clipped). */
async function fits(page) {
  return page.evaluate(() => {
    const tb = document.querySelector('.report-toolbar');
    const t = tb.getBoundingClientRect();
    const parts = [...tb.querySelectorAll(':scope > *, .rtb-end > *')]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(p => p.r.width > 0 && p.r.height > 0 && !p.el.classList.contains('rtb-end'));
    return {
      overflow: tb.scrollWidth - tb.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      outside: parts.filter(p => p.r.left < t.left - 0.5 || p.r.right > t.right + 0.5).map(p => p.el.className),
      // A part whose own words run past its box (the Ready count in a wider font).
      spill: parts.filter(p => p.el.scrollWidth > p.el.clientWidth + 1).map(p => p.el.id || p.el.className),
      rows: new Set(parts.map(p => Math.round(p.r.top + p.r.height / 2))).size,
      heights: [...new Set(parts.map(p => Math.round(p.r.height)))],
      overlaps: parts
        .flatMap((a, i) =>
          parts
            .slice(i + 1)
            .filter(
              b =>
                a.r.left < b.r.right - 0.5 &&
                b.r.left < a.r.right - 0.5 &&
                a.r.top < b.r.bottom - 0.5 &&
                b.r.top < a.r.bottom - 0.5,
            )
            .map(b => a.el.className + ' / ' + b.el.className),
        )
        .slice(0, 5),
    };
  });
}

// Approves every student but st1 for the report on screen, then draws the roster again.
async function approveAllButFirst(page) {
  await page.evaluate(() => {
    const termId = ReportBlocks.getTermId();
    getStudents('sci8').forEach(s => {
      if (s.id !== 'st1') upsertTermRating('sci8', s.id, termId, { approvedAt: new Date().toISOString() });
    });
  });
  await page.locator('#gb-sidebar .student-row[data-sid="st2"]').click();
  await page.locator('#gb-sidebar .student-row[data-sid="st1"]').click();
  await expect(ready(page)).toHaveText('26 of 27 Ready');
}

test.describe('layout', () => {
  for (const font of ['page', 'wide']) {
    for (const which of ['questionnaire', 'progress']) {
      for (const width of [1280, 1440, 1680]) {
        test(`${which}: one row, no sideways overflow at ${width} wide (${font} font)`, async ({ page }) => {
          await openReports(page, which, width);
          await useFont(page, font);
          const f = await fits(page);
          expect(f.overflow).toBeLessThanOrEqual(1);
          expect(f.page).toBeLessThanOrEqual(0);
          expect(f.outside).toEqual([]);
          expect(f.overlaps).toEqual([]);
          expect(f.spill).toEqual([]);
          expect(f.rows).toBe(1);
          // Every control is 32px (the Ready count's box is the same height).
          expect(f.heights).toEqual([32]);
        });
      }
      for (const [width, height] of [
        [1024, 768],
        [820, 1180],
      ]) {
        test(`${which}: wraps cleanly at ${width} wide (${font} font), nothing clipped`, async ({ page }) => {
          await openReports(page, which, width, height);
          await useFont(page, font);
          const f = await fits(page);
          expect(f.page).toBeLessThanOrEqual(0);
          expect(f.overflow).toBeLessThanOrEqual(1);
          expect(f.outside).toEqual([]);
          expect(f.overlaps).toEqual([]);
          expect(f.spill).toEqual([]);
        });
      }
    }
  }

  test('Approve and Next and Print Reports share a box, so the right edge stays put between tabs', async ({ page }) => {
    await openReports(page, 'questionnaire');
    const a = await box(page, '#tq-approve-next');
    expect(a.w).toBe(152);
    await tab(page, 'progress').click();
    await expect(page.locator('#tb-print-btn')).toBeVisible();
    expect(await box(page, '#tb-print-btn')).toEqual(a);
    await tab(page, 'questionnaire').click();
    await expect(approve(page)).toBeVisible();
    expect(await box(page, '#tq-approve-next')).toEqual(a);
  });

  test('approving a student does not move a button on the right', async ({ page }) => {
    await openReports(page);
    const before = await boxes(page);
    await approve(page).click();
    await expect(ready(page)).toHaveText('1 of 27 Ready');
    expect(await boxes(page)).toEqual(before);
  });

  test('the Ready count keeps its width through "All 27 Ready"', async ({ page }) => {
    await openReports(page);
    await approveAllButFirst(page);
    const before = await boxes(page);
    await approve(page).click();
    await expect(ready(page)).toHaveText('All 27 Ready');
    expect(await boxes(page)).toEqual(before);
  });
});

test.describe('the Term Questionnaire bar', () => {
  test('left to right: tabs, Report, the Ready count, ⋯ and Approve and Next; no icon buttons', async ({ page }) => {
    await openReports(page);
    const names = (await boxes(page)).map(b => b.name);
    expect(names).toEqual(['seg', 'report-period', 'tq-ready-wrap', 'assess-menu-wrap', 'tq-approve-next']);
    await expect(page.locator('#tq-edit-student-btn, #tq-info-btn')).toHaveCount(0);
    await expect(more(page)).toHaveAccessibleName('More');
    // Report is a native select, grey with no border.
    const sel = await page.locator('#report-period').evaluate(el => ({
      tag: el.tagName,
      bg: getComputedStyle(el).backgroundColor,
      border: getComputedStyle(el).borderTopWidth,
    }));
    expect(sel).toEqual({ tag: 'SELECT', bg: 'rgba(118, 118, 128, 0.12)', border: '0px' });
  });

  test('the Ready track fills as students are approved, and reads as a progress bar', async ({ page }) => {
    await openReports(page);
    await expect(track(page)).toHaveAttribute('role', 'progressbar');
    await expect(track(page)).toHaveAttribute('aria-valuemax', '27');
    await expect(track(page)).toHaveAttribute('aria-valuenow', '0');
    const fillWidth = () => track(page).evaluate(t => Math.round(t.firstElementChild.getBoundingClientRect().width));
    const trackBox = await track(page).boundingBox();
    expect(Math.round(trackBox.width)).toBe(64);
    expect(Math.round(trackBox.height)).toBe(6);
    expect(await fillWidth()).toBe(0);
    await approve(page).click();
    await expect(ready(page)).toHaveText('1 of 27 Ready');
    await expect(track(page)).toHaveAttribute('aria-valuenow', '1');
    await expect(track(page)).toHaveAttribute('aria-valuetext', '1 of 27 Ready');
    // 1 of 27 of 64px, to the pixel.
    await expect.poll(fillWidth).toBe(Math.round((1 / 27) * 64));
    await approve(page).click();
    await expect(ready(page)).toHaveText('2 of 27 Ready');
    await expect.poll(fillWidth).toBe(Math.round((2 / 27) * 64));
  });

  test('"All 27 Ready" in green, Print Reports › opens the Print Reports tab, an edit brings Approve and Next back', async ({
    page,
  }) => {
    await openReports(page);
    await approveAllButFirst(page);
    await expect(approve(page)).toHaveText('Approve and Next ›');
    await approve(page).click();
    await expect(ready(page)).toHaveText('All 27 Ready');
    await expect(approve(page)).toHaveText('Print Reports ›');
    await expect(approve(page)).toBeEnabled();
    // The words and the track turn the app's green (the class lands just after the words).
    await expect(page.locator('#tq-ready-wrap')).toHaveClass(/is-done/);
    const green = await page.evaluate(() => ({
      text: getComputedStyle(document.getElementById('tq-ready-wrap')).color,
      fill: getComputedStyle(document.querySelector('.rtb-fill')).backgroundColor,
      token: getComputedStyle(document.documentElement).getPropertyValue('--score-3').trim(),
    }));
    expect(green.fill).toBe('rgb(46, 125, 50)');
    expect(green.token).toBe('#2e7d32');
    expect(green.text).toBe('rgb(22, 101, 52)');
    // An edit takes the approval off: Approve and Next is back.
    await page.locator('#tq-narrative').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Again.');
    await expect(ready(page)).toHaveText('26 of 27 Ready');
    await expect(approve(page)).toHaveText('Approve and Next ›');
    await expect(track(page)).toHaveAttribute('aria-valuenow', '26');
    // Approved again, the button opens Print Reports, as the tab does.
    await approve(page).click();
    await expect(approve(page)).toHaveText('Print Reports ›');
    await approve(page).click();
    await expect(tab(page, 'progress')).toHaveClass(/active/);
    await expect(page.locator('#tb-print-btn')).toBeVisible();
    await expect(page.locator('#studio')).toBeVisible();
    await expect(approve(page)).toBeHidden();
  });

  test('⋯ holds Edit Student and Where This Information Comes From, and gives the focus back', async ({ page }) => {
    await openReports(page);
    const menu = page.locator('.rtb-more-wrap .assess-menu');
    await expect(menu).toBeHidden();
    await more(page).click();
    await expect(menu).toBeVisible();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('[role="menuitem"]')).toHaveText(['Edit Student', 'Where This Information Comes From']);

    // Escape closes it and returns the focus to ⋯.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more(page)).toBeFocused();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');

    // A click outside closes it.
    await more(page).click();
    await expect(menu).toBeVisible();
    await page.locator('.qn-name').click();
    await expect(menu).toBeHidden();

    // Arrow keys move through the items.
    await more(page).click();
    await expect(menu.locator('[role="menuitem"]').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.locator('[role="menuitem"]').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');

    // Edit Student: the menu closes, the dialog opens, and closing it returns the focus to ⋯.
    await more(page).click();
    await menu.locator('[data-action="tqEditStudent"]').click();
    await expect(menu).toBeHidden();
    const dialog = page.getByRole('dialog', { name: 'Edit Student' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(more(page)).toBeFocused();

    // Where This Information Comes From: the same.
    await more(page).click();
    await menu.locator('[data-action="tqInfo"]').click();
    await expect(menu).toBeHidden();
    const sheet = page.getByRole('dialog', { name: 'Where This Information Comes From' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(more(page)).toBeFocused();
  });
});

test.describe('the Print Reports bar', () => {
  test('left to right: tabs, the student picker, Report, then Print Reports', async ({ page }) => {
    await openReports(page, 'progress');
    const names = (await boxes(page)).map(b => b.name);
    expect(names).toEqual(['seg', 'student-picker', 'report-period', 'tb-print-btn']);
    for (const sel of ['#tq-ready-wrap', '#tq-more-btn', '#tq-approve-next'])
      await expect(page.locator(sel)).toBeHidden();
    // The picker is grey with no border and a fixed width, a chevron at its end.
    const pick = await page.locator('.student-picker-btn').evaluate(el => {
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        border: cs.borderTopWidth,
        w: Math.round(el.getBoundingClientRect().width),
        img: cs.backgroundImage.slice(0, 8),
      };
    });
    expect(pick).toEqual({ bg: 'rgba(118, 118, 128, 0.12)', border: '0px', w: 168, img: 'url("dat' });
  });

  test('the picker keeps its width as its label changes, and still picks students', async ({ page }) => {
    await openReports(page, 'progress');
    const picker = page.getByRole('button', { name: 'Select students' });
    const w0 = (await picker.boundingBox()).width;
    await expect(picker).toHaveText('All Students (27)');
    await picker.click();
    const list = page.locator('#picker-dropdown');
    await expect(list).toBeVisible();
    await list.locator('.student-picker-item').first().click();
    await expect(picker).toHaveText('26 of 27 Students');
    await list.getByRole('button', { name: 'Deselect All' }).click();
    await expect(picker).toHaveText('No Students Selected');
    await list.locator('.student-picker-item', { hasText: 'Cece Adeyemi' }).click();
    await expect(picker).toHaveText('Cece Adeyemi');
    expect((await picker.boundingBox()).width).toBe(w0);
    await page.locator('.report-toolbar').click({ position: { x: 2, y: 2 } });
    await expect(list).toBeHidden();
  });

  test('Report switches reports and Print Reports opens its dialog', async ({ page }) => {
    await openReports(page, 'progress');
    const period = page.locator('#report-period');
    const options = await period.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await period.selectOption({ index: options.length - 1 });
    await expect(period).toHaveValue(await period.locator('option').last().getAttribute('value'));
    await page.locator('#tb-print-btn').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('on a narrow window the arrows step students and Parts is a grey toggle, blue while pressed', async ({
    page,
  }) => {
    await openReports(page, 'progress', 820, 1180);
    const arrows = page.locator('#report-stepper .tq-toolbar-arrow');
    await expect(arrows).toHaveCount(2);
    for (const a of await arrows.all()) {
      const r = await a.boundingBox();
      expect([Math.round(r.width), Math.round(r.height)]).toEqual([32, 32]);
      expect(await a.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(118, 118, 128, 0.12)');
    }
    await expect(arrows.first()).toHaveAccessibleName('Previous Student');
    await expect(arrows.nth(1)).toHaveAccessibleName('Next Student');
    const parts = page.locator('#tb-rail-btn');
    await expect(parts).toBeVisible();
    await expect(parts).toHaveAttribute('aria-pressed', 'false');
    expect(await parts.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(118, 118, 128, 0.12)');
    await parts.click();
    await expect(parts).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#studio-palette')).toBeVisible();
    await expect.poll(() => parts.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 122, 255, 0.08)');
    await parts.click();
    await expect(parts).toHaveAttribute('aria-pressed', 'false');
  });
});
