/**
 * Dashboard top bar, slice D1: when the class average has not changed since
 * the last report, the "No Change" line stays in the page (so the cell keeps
 * its height) and is not visible. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
}

// Draws the Dashboard with the change forced, and reports the cell's state.
async function drawWith(page, change) {
  return page.evaluate(c => {
    window.classGradeChange = () => c;
    PageDashboard.render();
    const cell = document.querySelector('.dash-glance-avg');
    const el = cell.querySelector('.dash-glance-change');
    return {
      height: cell.getBoundingClientRect().height,
      present: !!el,
      visibility: el ? getComputedStyle(el).visibility : null,
      ariaHidden: el ? el.getAttribute('aria-hidden') : null,
    };
  }, change);
}

for (const font of FONTS) {
  test(`No Change is in the page, invisible, and the Class Average cell keeps its height (${font} font)`, async ({
    page,
  }) => {
    await openDashboard(page);
    await useFont(page, font);
    const none = await drawWith(page, { text: 'No Change', dir: 0, since: 'Report 1' });
    const up = await drawWith(page, { text: '▲ 0.3', dir: 1, since: 'Report 1' });
    const down = await drawWith(page, { text: '▼ 0.3', dir: -1, since: 'Report 1' });

    expect(none.present).toBe(true);
    expect(none.visibility).toBe('hidden');
    expect(none.ariaHidden).toBe('true');
    expect(up.visibility).toBe('visible');
    expect(up.ariaHidden).toBeNull();
    expect(down.visibility).toBe('visible');
    expect(none.height).toBe(up.height);
    expect(none.height).toBe(down.height);
  });

  /* The top bar holds its words in its cells, and the middle row under it
     still follows the window: as tall as the window leaves, never under 510. */
  test(`at 1280 x 800 the top bar's words stay in their cells and the row follows it (${font} font)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDashboard(page);
    await useFont(page, font);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      work.course.send_work = true;
      saveDemoStudentWork(cid, work);
      PageDashboard.render();
    });
    await page.locator('.dash-glance-tograde').waitFor();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.dash-glance > *')];
      const spill = cells
        .flatMap(c => {
          const cb = c.getBoundingClientRect();
          return (
            [...c.querySelectorAll('*')]
              .filter(e => !e.children.length && e.textContent.trim() && getComputedStyle(e).visibility !== 'hidden')
              // A hover tip is out of sight at rest, and its own box.
              .filter(e => !e.closest('.dist-tip, [role="tooltip"]') && e.getClientRects().length)
              .filter(e => {
                const r = e.getBoundingClientRect();
                return r.right > cb.right + 0.5 || r.bottom > cb.bottom + 0.5 || r.left < cb.left - 0.5;
              })
              .map(e => e.textContent.trim().slice(0, 30))
          );
        })
        .filter(Boolean);
      const row = document.querySelector('.dash-row').getBoundingClientRect();
      return { spill, rowH: Math.round(row.height), want: Math.max(510, Math.round(innerHeight - row.top - 12)) };
    });
    expect(m.spill).toEqual([]);
    expect(Math.abs(m.rowH - m.want)).toBeLessThanOrEqual(1);
  });
}
