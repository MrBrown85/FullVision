/**
 * The Bulletins tile on the Dashboard (slice B1e), Demo Mode with both build
 * switches on: it sits under the Inbox in 40% of the left column, shows the
 * sample class's three bulletins in whole 38 px rows, and its links open the
 * Bulletins page at that bulletin, at its Seen by list, or with the box open.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

async function open(page, { bulletins = true, dashRow = true } = {}) {
  await page.addInitScript(
    ([bulletins, dashRow]) => {
      if (dashRow) localStorage.setItem('fv-build-dashRow', '1');
      if (bulletins) localStorage.setItem('fv-build-bulletins', '1');
    },
    [bulletins, dashRow],
  );
  // The front page's Try Demo Mode link (student=1) starts the sample class with the Student Page on.
  await page.goto('/login.html?student=1');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/dashboard/);
  await page.locator('.dash-glance').waitFor();
}

const box = (page, sel) =>
  page
    .locator(sel)
    .first()
    .evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });

test('the Inbox slot is 299 px and the tile 199 px, with three whole rows and nothing cut off', async ({ page }) => {
  await open(page);
  await expect(page.locator('.dash-bulletins-tile')).toBeVisible();
  const inbox = await box(page, '.dash-row-inbox');
  const slot = await box(page, '.dash-row-bulletins');
  const tile = await box(page, '.dash-bulletins-tile');
  expect(Math.abs(inbox.height - 299)).toBeLessThanOrEqual(1);
  expect(Math.abs(slot.height - 199)).toBeLessThanOrEqual(1);
  expect(Math.abs(tile.height - 199)).toBeLessThanOrEqual(1);
  expect(Math.round(slot.top - inbox.bottom)).toBe(12);

  const rows = page.locator('.dash-bulletins-row');
  await expect(rows).toHaveCount(3);
  const inside = await rows.evaluateAll((els, tileSel) => {
    const t = document.querySelector(tileSel);
    const tr = t.getBoundingClientRect();
    return {
      heights: els.map(e => Math.round(e.getBoundingClientRect().height)),
      shown: els.map(e => getComputedStyle(e).display !== 'none'),
      lastBottom: Math.round(els[els.length - 1].getBoundingClientRect().bottom),
      tileBottom: Math.round(tr.bottom),
      scrolls: [t.scrollHeight - t.clientHeight, t.scrollWidth - t.clientWidth],
      words: els.map(e => {
        const w = e.querySelector('.dash-bulletins-words');
        return w.getBoundingClientRect().width > 40;
      }),
    };
  }, '.dash-bulletins-tile');
  expect(inside.heights).toEqual([38, 38, 38]);
  expect(inside.shown).toEqual([true, true, true]);
  expect(inside.lastBottom).toBeLessThan(inside.tileBottom);
  expect(inside.scrolls).toEqual([0, 0]);
  expect(inside.words).toEqual([true, true, true]);

  // The sample bulletins: the pinned reminder first, a Photo of the Board, no kind called Photo.
  const kinds = await page.locator('.dash-bulletins-kind').allTextContents();
  expect(kinds[0]).toBe('Reminder');
  expect(kinds).toContain('Photo of the Board');
  expect(kinds).not.toContain('Photo');
  await expect(page.locator('.dash-bulletins-head')).toContainText('Bulletins');
  await expect(page.locator('.dash-bulletins-write')).toHaveText('Write a Bulletin');
  await expect(page.locator('.dash-bulletins-open')).toHaveText('Open Bulletins →');
  // The Seen line is the data layer's own words.
  await expect(page.locator('.dash-bulletins-seen').first()).toHaveText(/^Seen by \d+ of \d+ · \d+ Not Seen$/);
});

test('a row opens the Bulletins page at that bulletin, outlined', async ({ page }) => {
  await open(page);
  const second = page.locator('.dash-bulletins-row').nth(1);
  const words = (await second.locator('.dash-bulletins-words').getAttribute('aria-label')).replace(/^[^:]+: /, '');
  await second.locator('.dash-bulletins-words').click();
  await page.waitForURL(/\/bulletins/);
  const arrived = page.locator('.bulletin-post.bulletin-arrived');
  await expect(arrived).toHaveCount(1);
  await expect(arrived).toContainText(words.slice(0, 20));
  await expect(arrived).toBeInViewport();
  // Its Seen by list is not open.
  await expect(arrived.locator('.bulletin-seenlist')).toBeHidden();
  expect(page.url()).not.toContain('open=');
});

test('Seen by opens that bulletin with its list open', async ({ page }) => {
  await open(page);
  await page.locator('.dash-bulletins-row').nth(1).locator('.dash-bulletins-seen').click();
  await page.waitForURL(/\/bulletins/);
  const arrived = page.locator('.bulletin-post.bulletin-arrived');
  await expect(arrived).toHaveCount(1);
  await expect(arrived.locator('.bulletin-seenlist')).toBeVisible();
  await expect(arrived.locator('.bulletin-seen-head').first()).toContainText('Not Seen Yet');
});

test('Write a Bulletin opens the page with the box open; Open Bulletins opens the page', async ({ page }) => {
  await open(page);
  await page.locator('.dash-bulletins-write').click();
  await page.waitForURL(/\/bulletins/);
  await expect(page.locator('#bulletin-compose')).toBeVisible();
  await expect(page.locator('#bulletin-words')).toBeFocused();
  await page.goto('/dashboard');
  await page.locator('.dash-bulletins-tile').waitFor();
  await page.locator('.dash-bulletins-open').click();
  await page.waitForURL(/\/bulletins/);
  await expect(page.locator('#bulletin-compose')).toBeHidden();
});

test('a bulletin posted on the page is in the tile when the Dashboard comes back: Just Now, in bold', async ({
  page,
}) => {
  await open(page);
  await page.locator('.dash-bulletins-write').click();
  await page.locator('#bulletin-words').fill('Bring a calculator tomorrow.');
  await page.locator('#bulletin-post').click();
  await expect(page.locator('#bulletin-compose')).toBeHidden();
  await page.goto('/dashboard');
  await page.locator('.dash-bulletins-tile').waitFor();
  // The pinned reminder keeps the top row; the new bulletin is the first of the latest.
  const rows = page.locator('.dash-bulletins-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.dash-bulletins-kind')).toHaveText('Reminder');
  await expect(rows.nth(1)).toContainText('Bring a calculator tomorrow.');
  await expect(rows.nth(1).locator('.dash-bulletins-time')).toHaveText('Just Now');
  expect(
    await rows
      .nth(1)
      .locator('.dash-bulletins-time')
      .evaluate(e => getComputedStyle(e).fontWeight),
  ).toBe('700');
  const tile = await box(page, '.dash-bulletins-tile');
  expect(Math.abs(tile.height - 199)).toBeLessThanOrEqual(1);
});

test('empty: Nothing Posted Yet at the same height', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    localStorage.setItem('gb-bulletins-sci8', JSON.stringify({ bulletins: [], seen: {}, reactions: {} }));
  });
  await page.goto('/dashboard');
  await page.locator('.dash-bulletins-tile').waitFor();
  await expect(page.locator('.dash-bulletins-none b')).toHaveText('Nothing Posted Yet');
  await expect(page.locator('.dash-bulletins-none')).toContainText(
    "Bulletins reach every student's phone, on the first tab of their page.",
  );
  const tile = await box(page, '.dash-bulletins-tile');
  expect(Math.abs(tile.height - 199)).toBeLessThanOrEqual(1);
});

test('stacked on an iPad the tile is 300 px', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await open(page);
  const tile = await box(page, '.dash-bulletins-tile');
  expect(Math.round(tile.height)).toBe(300);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(3);
});

test('with Bulletins off the Inbox has the whole column (510 px) and there is no tile', async ({ page }) => {
  await open(page, { bulletins: false });
  expect(Math.round((await box(page, '.dash-row-inbox')).height)).toBe(510);
  await expect(page.locator('.dash-bulletins-tile')).toHaveCount(0);
  await expect(page.locator('.dash-row-bulletins')).toHaveCount(0);
});
