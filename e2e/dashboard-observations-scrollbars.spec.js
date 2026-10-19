import { test, expect } from '@playwright/test';

/* The dashboard's Observations card with classic scrollbars, as Windows
   shows them. Playwright's Chromium hides scrollbars by default, which hides
   the case where the grid pane's vertical scrollbar takes width from the
   student columns. In Demo Mode on Science 8. */

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher\/app\.html/);
}

const card = page => page.locator('#dash-obs-card');

test('a scrollbar in the grid is counted, and names stay in view when it scrolls sideways', async ({ page }) => {
  await enterDemo(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/teacher/app.html#/dashboard?course=sci8');
  await expect(card(page).locator('.dash-ob2-row[data-sid]').first()).toBeVisible();
  // A 40px scrollbar and a short pane, so the grid always has one.
  await page.addStyleTag({
    content:
      '.dash-ob2-pane::-webkit-scrollbar { width: 40px; height: 12px; background: #ddd; }' +
      '.dash-ob2-pane::-webkit-scrollbar-thumb { background: #999; }' +
      '.dash-ob2-pane { max-height: 160px !important; }',
  });
  const frame = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('dash-obs-card'));
    const px = k => parseFloat(cs[k]) || 0;
    return {
      blockMin: DashObservations.lastModel().blockMin,
      edge: px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth'),
    };
  });
  const setCardWidth = inner =>
    page.evaluate(
      ([w]) => {
        const el = document.getElementById('dash-obs-card');
        el.style.boxSizing = 'border-box';
        el.style.justifySelf = 'start';
        el.style.width = w + 'px';
        window.dispatchEvent(new Event('resize'));
      },
      [inner + frame.edge],
    );
  const pane = card(page).locator('.dash-ob2-pane');

  // The card has room for a column of students; the pane, less its
  // scrollbar, does not: the grid scrolls sideways instead of clipping.
  await setCardWidth(frame.blockMin + 20);
  expect(await pane.evaluate(p => p.offsetWidth - p.clientWidth)).toBe(40);
  await expect(pane).toHaveClass(/is-scroll-x/);
  expect(await pane.evaluate(p => p.scrollWidth > p.clientWidth)).toBe(true);

  // Much narrower, scrolled all the way right: every name is still there.
  await setCardWidth(frame.blockMin - 220);
  await expect.poll(() => pane.evaluate(p => p.scrollWidth - p.clientWidth)).toBeGreaterThan(150);
  await pane.scrollIntoViewIfNeeded();
  await pane.evaluate(p => (p.scrollLeft = p.scrollWidth));
  const names = await pane.evaluate(p => {
    const box = p.getBoundingClientRect();
    const bottom = Math.min(box.bottom, window.innerHeight);
    const visible = [...p.querySelectorAll('.dash-ob2-name')].filter(n => n.getBoundingClientRect().bottom <= bottom);
    return visible.map(n => {
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
      return { inside: r.left >= box.left - 0.5, onTop: !!hit && (hit === n || n.contains(hit)) };
    });
  });
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toEqual({ inside: true, onTop: true });
});
