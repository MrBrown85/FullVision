/**
 * The Bulletins tile on the Dashboard (slice B1e; on since B1g), Demo Mode: it sits under the Inbox in 40% of the left column, shows the
 * sample class's three bulletins in whole 38 px rows, and its links open the
 * Bulletins page at that bulletin, at its Seen by list, or with the box open.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

async function open(page, { oldBulletins = null, oldDashRow = null, questions = true } = {}) {
  await page.addInitScript(
    ([oldBulletins, oldDashRow]) => {
      // What a browser that saw the row before D9, or Bulletins before B1g, may still have kept.
      if (oldDashRow != null) localStorage.setItem('fv-build-dashRow', oldDashRow);
      if (oldBulletins != null) localStorage.setItem('fv-build-bulletins', oldBulletins);
    },
    [oldBulletins, oldDashRow],
  );
  // The front page's Try Demo Mode link (student=1) starts the sample class with the Student Page on.
  await page.goto(questions ? '/login.html?student=1' : '/login.html?demo=1');
  if (questions) await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/dashboard|teacher-mobile/, { timeout: 15000 });
  // A phone-width window is sent to the phone app at sign-in; the desktop page is opened by its address.
  if (page.viewportSize().width < 600) await page.goto('/dashboard');
  await page.locator('.dash-glance').waitFor();
  if (!questions) {
    // The Student Page on, but no question waiting: the row then starts higher and is taller than its floor.
    await page.evaluate(() => {
      setStudentPageSwitch(getActiveCourse(), true, 'on_return');
      PageDashboard.render();
    });
  }
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
  await expect(arrived).toBeFocused();
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
  await expect(arrived.locator('.bulletin-seen-btn')).toBeFocused();
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

test('at 1440 x 900 the Inbox slot is 359 px and the tile 239 px, three whole rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { questions: false });
  expect(Math.round((await box(page, '.dash-row')).height)).toBe(610);
  expect(Math.abs((await box(page, '.dash-row-inbox')).height - 359)).toBeLessThanOrEqual(1);
  expect(Math.abs((await box(page, '.dash-bulletins-tile')).height - 239)).toBeLessThanOrEqual(1);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(3);
});

test('at 390 px wide the tile does not scroll the page sideways and no row is cut off', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await page.locator('.dash-bulletins-tile').waitFor();
  const m = await page.evaluate(() => {
    const t = document.querySelector('.dash-bulletins-tile');
    const main = document.getElementById('main');
    return {
      over: [
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        main.scrollWidth - main.clientWidth,
      ],
      tile: [t.scrollWidth - t.clientWidth, t.scrollHeight - t.clientHeight],
    };
  });
  expect(m.over).toEqual([0, 0]);
  expect(m.tile).toEqual([0, 0]);
  // Seen by is whole (its box is as wide as its words) and the words keep room.
  const parts = await page.evaluate(() => ({
    seen: [...document.querySelectorAll('.dash-bulletins-seen')].map(e => e.scrollWidth - e.clientWidth),
    seenRight: [...document.querySelectorAll('.dash-bulletins-seen')].map(
      e =>
        e.getBoundingClientRect().right <= document.querySelector('.dash-bulletins-tile').getBoundingClientRect().right,
    ),
    words: [...document.querySelectorAll('.dash-bulletins-words')].map(e => e.getBoundingClientRect().width >= 90),
  }));
  expect(parts.seen.every(n => n === 0)).toBe(true);
  expect(parts.seenRight).toEqual([true, true, true]);
  expect(parts.words).toEqual([true, true, true]);
});

test("an old 'fv-build-dashRow' of 0 changes nothing: the row and the tile draw (D9)", async ({ page }) => {
  await open(page, { oldDashRow: '0' });
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await expect(page.locator('.dash-bulletins-tile')).toBeVisible();
});

test('stacked on an iPad the tile is 300 px', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await open(page);
  const tile = await box(page, '.dash-bulletins-tile');
  expect(Math.round(tile.height)).toBe(300);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(3);
});

test("an old 'fv-build-bulletins' of 0 changes nothing: the Inbox slot is 299 px and the tile has its rows (B1g)", async ({
  page,
}) => {
  await open(page, { oldBulletins: '0' });
  expect(Math.round((await box(page, '.dash-row-inbox')).height)).toBe(299);
  await expect(page.locator('.dash-bulletins-tile')).toHaveCount(1);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(3);
});
