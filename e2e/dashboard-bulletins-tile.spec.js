/**
 * The Bulletins tile on the Dashboard (slice B1e; on since B1g), Demo Mode: it sits under the Inbox in 40% of the left column, shows the
 * sample class's three bulletins in whole rows that share its height (two lines of words each), and its links open the
 * Bulletins page at that bulletin, at its Seen by list, or with the box open. Since Nov 26 the tile is notes from 580 px
 * across (Colin: "always notes"), so the rows are tested in a 1100 px window, where the tile is narrower than that.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 800 } });

async function open(page, { oldBulletins = null, oldDashRow = null, questions = true } = {}) {
  await page.addInitScript(
    ([oldBulletins, oldDashRow]) => {
      // What a browser that saw the row before D9, or Bulletins before B1g, may still have kept.
      if (oldDashRow != null) localStorage.setItem('fv-build-dashRow', oldDashRow);
      if (oldBulletins != null) localStorage.setItem('fv-build-bulletins', oldBulletins);
    },
    [oldBulletins, oldDashRow],
  );
  // Demo Mode starts the sample class with the Student Page on, however it is entered.
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/dashboard|teacher-mobile/, { timeout: 15000 });
  // A phone-width window is sent to the phone app at sign-in; the desktop page is opened by its address.
  if (page.viewportSize().width < 600) await page.goto('/dashboard');
  await page.locator('.dash-glance').waitFor();
  if (!questions) {
    // The Student Page on, but no question waiting (Reflect on Feedback off): the row then starts higher and is taller than its floor.
    await page.evaluate(() => {
      setCourseFeedbackOptions(getActiveCourse(), { reflect_on_feedback: false }, _newEntryId());
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

test('the Inbox slot is as tall as its stacks (60% at most), the tile has the rest, with three whole rows that fill it and nothing cut off', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('.dash-bulletins-tile')).toBeVisible();
  const inbox = await box(page, '.dash-row-inbox');
  const slot = await box(page, '.dash-row-bulletins');
  const tile = await box(page, '.dash-bulletins-tile');
  // The Inbox is as tall as its row of stacks, never over its 60% (299 of 510); Bulletins has the rest (Colin, Nov 26).
  expect(inbox.height).toBeLessThanOrEqual(300);
  expect(Math.abs(inbox.height + 12 + slot.height - 510)).toBeLessThanOrEqual(1);
  expect(slot.height).toBeGreaterThanOrEqual(198);
  expect(Math.abs(tile.height - slot.height)).toBeLessThanOrEqual(1);
  expect(Math.round(slot.top - inbox.bottom)).toBe(12);

  const rows = page.locator('.dash-bulletins-row:visible');
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
  // Every row at least 40 px; together they fill the tile to its padding: no empty band.
  expect(inside.heights.every(h => h >= 40)).toBe(true);
  expect(inside.shown).toEqual([true, true, true]);
  expect(inside.tileBottom - inside.lastBottom).toBeGreaterThanOrEqual(16);
  expect(inside.tileBottom - inside.lastBottom).toBeLessThanOrEqual(18);
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
  await expect(page.locator('.dash-bulletins-seen').first()).toHaveText(
    /^Seen by (\d+ of \d+|All \d+)$|^Not Seen Yet$/,
  );
  expect(await page.locator('.dash-bulletins-tile').textContent()).not.toContain('Not Seen');
  // Write a Bulletin is the secondary button; the Reminder label is amber with a pin.
  await expect(page.locator('.dash-bulletins-write')).toHaveClass(/btn-ghost/);
  expect(await page.locator('.dash-bulletins-write').evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  await expect(page.locator('.dash-bulletins-rem').first().locator('svg')).toHaveCount(1);
  // Times are the weekday or the clock alone, with no a.m. or p.m.
  const times = await page.locator('.dash-bulletins-time').allTextContents();
  for (const t of times) expect(t).toMatch(/^(Just Now|Yesterday|[A-Z][a-z]{2}|[A-Z][a-z]{2} \d{1,2}|\d{1,2}:\d{2})$/);
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
  await expect(arrived.locator('.bsl-head').first()).toContainText('Not Seen Yet');
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
  await expect(page.locator('.dash-bulletins-row:visible')).toHaveCount(3);
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
  // Bulletins keeps at least its 40% (199 px); the Inbox above it is as tall as its stacks.
  expect(tile.height).toBeGreaterThanOrEqual(198);
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
  // Bulletins keeps at least its 40% (199 px); the Inbox above it is as tall as its stacks.
  expect(tile.height).toBeGreaterThanOrEqual(198);
});

test('at 1100 x 900 the Inbox slot is at most 359 px and the tile at least 239 px, three whole rows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await open(page, { questions: false });
  expect(Math.round((await box(page, '.dash-row')).height)).toBe(610);
  // The stacks size themselves once the row has its height, so the tiles settle a moment after the draw.
  await expect.poll(async () => (await box(page, '.dash-bulletins-tile')).height).toBeGreaterThanOrEqual(238);
  expect((await box(page, '.dash-row-inbox')).height).toBeLessThanOrEqual(360);
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

test("an old 'fv-build-bulletins' of 0 changes nothing: the Inbox slot is at most 299 px and the tile has its rows (B1g)", async ({
  page,
}) => {
  await open(page, { oldBulletins: '0' });
  expect(Math.round((await box(page, '.dash-row-inbox')).height)).toBeLessThanOrEqual(300);
  await expect(page.locator('.dash-bulletins-tile')).toHaveCount(1);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(3);
});

/** The rows drawn and what is left over, for any font. */
async function fit(page) {
  return page.evaluate(() => {
    const t = document.querySelector('.dash-bulletins-tile');
    const tr = t.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.dash-bulletins-row')].filter(
      r => getComputedStyle(r).display !== 'none',
    );
    const list = document.querySelector('.dash-bulletins-rows').getBoundingClientRect();
    const heights = rows.map(r => r.getBoundingClientRect().height);
    const kinds = rows.map(r => r.querySelector('.dash-bulletins-kind'));
    return {
      shown: rows.length,
      min: Math.min(...heights),
      spare: list.bottom - rows[rows.length - 1].getBoundingClientRect().bottom,
      scrolls: [t.scrollHeight - t.clientHeight, t.scrollWidth - t.clientWidth],
      inside: rows.every(r => r.getBoundingClientRect().bottom <= tr.bottom && r.getBoundingClientRect().top >= tr.top),
      wordsCut: rows.map(r => {
        const w = r.querySelector('.dash-bulletins-words');
        const lh = parseFloat(getComputedStyle(w).lineHeight);
        return w.getBoundingClientRect().height <= lh * 2 + 4;
      }),
      seenWhole: [...document.querySelectorAll('.dash-bulletins-seen')].every(e => e.scrollWidth <= e.clientWidth),
      kindWhole: kinds.every(k => !k || k.scrollWidth <= k.clientWidth + 1),
    };
  });
}

const WIDE =
  '.dash-bulletins-tile, .dash-bulletins-tile * { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';

for (const [w, h, rowsShown] of [
  [1100, 800, 3],
  [1100, 900, 3],
]) {
  for (const wide of [false, true]) {
    test(`at ${w} x ${h} the rows are whole and fill the tile${wide ? ' in a wide font' : ''}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, { questions: h === 800 });
      if (wide) await page.addStyleTag({ content: WIDE });
      const f = await fit(page);
      expect(f.shown).toBe(rowsShown);
      expect(f.min).toBeGreaterThanOrEqual(40);
      // Nothing is left under the last row: the rows share the whole height.
      expect(f.spare).toBeLessThan(1);
      expect(f.inside).toBe(true);
      expect(f.scrolls).toEqual([0, 0]);
      expect(f.wordsCut.every(Boolean)).toBe(true);
      expect(f.seenWhole).toBe(true);
      expect(f.kindWhole).toBe(true);
    });
  }
}

test('more bulletins than fit: as many whole rows as the height holds, at four heights', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const now = Date.now();
    const list = [];
    for (let i = 0; i < 8; i++)
      list.push({
        id: 'x' + i,
        kind: 'announcement',
        body: 'Post number ' + i + ' with enough words to need a second line when the tile is not very wide at all.',
        posted_at: new Date(now - (i + 2) * 3600000).toISOString(),
        created_at: new Date(now - (i + 2) * 3600000).toISOString(),
        seen: 3,
        can_see: 26,
      });
    localStorage.setItem('gb-bulletins-sci8', JSON.stringify({ bulletins: list, seen: {}, reactions: {} }));
  });
  await page.goto('/dashboard');
  await page.locator('.dash-bulletins-tile').waitFor();
  for (const wide of [false, true]) {
    if (wide) await page.addStyleTag({ content: WIDE });
    // Whole rows only: whatever the tile's height, rows are 40 px or more and nothing is left under them.
    for (const px of [120, 199, 239, 300]) {
      await page.evaluate(px => {
        document.querySelector('.dash-bulletins-tile').style.height = px + 'px';
      }, px);
      const f = await fit(page);
      expect(f.shown).toBe(Math.min(5, Math.max(0, Math.floor((px - 2 - 32 - 40) / 40))));
      expect(f.min).toBeGreaterThanOrEqual(40);
      expect(f.spare).toBeLessThan(1);
      expect(f.inside).toBe(true);
      expect(f.scrolls).toEqual([0, 0]);
    }
  }
});

/** The wide form: notes side by side, a blank one to write on, Open Bulletins beside the title. */
async function cards(page) {
  return page.evaluate(() => {
    const q = s => document.querySelector(s);
    const tile = q('.dash-bulletins-tile').getBoundingClientRect();
    const shown = [...document.querySelectorAll('.dash-bulletins-row')].filter(
      r => getComputedStyle(r).display !== 'none',
    );
    const rect = e => e.getBoundingClientRect();
    const vis = e => !!e && getComputedStyle(e).display !== 'none' && !!e.offsetParent;
    const blank = q('.dash-bulletins-blank-btn');
    return {
      width: tile.width,
      notes: q('.dash-bulletins-tile').classList.contains('is-notes'),
      count: shown.length,
      // offsetTop: the notes are tilted a degree or so (posted notes, #1630), which moves their drawn tops a few pixels.
      tops: shown.map(r => r.offsetTop),
      widths: shown.map(r => Math.round(rect(r).width)),
      heights: shown.map(r => r.offsetHeight),
      inside: shown.every(r => rect(r).bottom <= tile.bottom && rect(r).right <= tile.right),
      uncut: shown.map(r => r.scrollHeight <= r.clientHeight + 1 && r.scrollWidth <= r.clientWidth + 1),
      // The day sits in the note's foot, right of Seen by, on its line.
      timeInFoot: shown.map(r => {
        const t = rect(r.querySelector('.dash-bulletins-time'));
        const s = rect(r.querySelector('.dash-bulletins-seen'));
        return t.left > s.right - 1 && Math.abs((t.top + t.bottom) / 2 - (s.top + s.bottom) / 2) < 8;
      }),
      // Layout offsets, not drawn rectangles: a tilted note's rectangles grow by a few pixels each way.
      wordsOver: shown.map(r => {
        const words = r.querySelector('.dash-bulletins-words');
        return r.querySelector('.dash-bulletins-seen').offsetTop >= words.offsetTop + words.offsetHeight - 1;
      }),
      // The words sit in the middle of the paper, not squeezed to its top: the room over them (under the label, or
      // under the paper's top padding) and the room under them, down to Seen by, are the same.
      centred: shown.map(r => {
        const words = r.querySelector('.dash-bulletins-words');
        const kind = r.querySelector('.dash-bulletins-kind');
        const from = vis(kind) ? kind.offsetTop + kind.offsetHeight : parseFloat(getComputedStyle(r).paddingTop);
        const over = words.offsetTop - from;
        const under = r.querySelector('.dash-bulletins-seen').offsetTop - (words.offsetTop + words.offsetHeight);
        return Math.abs(over - under) <= 3;
      }),
      seenLeft: shown.map(r => Math.abs(rect(r.querySelector('.dash-bulletins-seen')).left - rect(r).left) < 24),
      plainLabels: shown.filter(r => vis(r.querySelector('.dash-bulletins-plain'))).length,
      writeButton: vis(q('.dash-bulletins-write')),
      blank: vis(blank),
      blankText: blank ? blank.textContent.trim() : '',
      blankInside: !!blank && rect(blank).bottom <= tile.bottom && rect(blank).right <= tile.right,
      blankAfter: !!blank && shown.length > 0 && rect(blank).left > rect(shown[shown.length - 1]).left,
      openInHead: Math.abs(rect(q('.dash-bulletins-open')).top - rect(q('.dash-bulletins-title')).top) < 16,
      openAboveNotes: shown.length
        ? rect(q('.dash-bulletins-open')).bottom <= Math.min(...shown.map(r => rect(r).top)) + 6
        : true,
      sub: vis(q('.dash-bulletins-sub')) ? q('.dash-bulletins-sub').innerText : '',
      tileScroll: [
        q('.dash-bulletins-tile').scrollHeight - q('.dash-bulletins-tile').clientHeight,
        q('.dash-bulletins-tile').scrollWidth - q('.dash-bulletins-tile').clientWidth,
      ],
    };
  });
}

for (const wide of [false, true]) {
  test(`at 1680 x 1050 the tile is three notes and a blank one${wide ? ' in a wide font' : ''}`, async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    await open(page);
    if (wide) await page.addStyleTag({ content: WIDE });
    await expect(page.locator('.dash-bulletins-tile')).toHaveClass(/is-notes/);
    const c = await cards(page);
    expect(c.width).toBeGreaterThanOrEqual(900);
    expect(c.count).toBe(3);
    expect(new Set(c.tops).size).toBe(1);
    expect(c.widths.every(w => w >= 230)).toBe(true);
    expect(c.inside).toBe(true);
    expect(c.uncut.every(Boolean)).toBe(true);
    expect(c.timeInFoot.every(Boolean)).toBe(true);
    expect(c.wordsOver.every(Boolean)).toBe(true);
    expect(c.centred.every(Boolean), JSON.stringify(c.centred)).toBe(true);
    expect(c.seenLeft.every(Boolean)).toBe(true);
    // A plain announcement has no label; Write a Bulletin is the blank note after the last one; there is no foot.
    expect(c.plainLabels).toBe(0);
    expect(c.writeButton).toBe(false);
    expect(c.blank).toBe(true);
    expect(c.blankText).toBe('Write a Bulletin');
    expect(c.blankInside).toBe(true);
    expect(c.blankAfter).toBe(true);
    expect(c.openInHead).toBe(true);
    expect(c.openAboveNotes).toBe(true);
    // The subtitle shows only when it has something to act on.
    expect(c.sub).toBe('');
    expect(c.tileScroll).toEqual([0, 0]);
    // The reminder's note says how long it stays.
    const until = await page
      .locator('.dash-bulletins-rem')
      .first()
      .evaluate(e => getComputedStyle(e, '::after').content);
    expect(until).toMatch(/Until [A-Z][a-z]{2}/);
  });
}

test('a note is as tall as its words need: on a tall tile it is not a strip of empty paper', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page);
  // One short bulletin on a tile made tall.
  await page.evaluate(() => {
    const real = window.getBulletins;
    window.getBulletins = cid =>
      real(cid)
        .slice(0, 1)
        .map(b => Object.assign({}, b, { kind: 'announcement', files: [], body: 'Bring your lab notebook.' }));
    document.querySelector('.dash-row-bulletins').style.height = '520px';
    PageDashboard.render();
    document.querySelector('.dash-row-bulletins').style.height = '520px';
  });
  await expect(page.locator('.dash-bulletins-tile')).toHaveClass(/is-notes/);
  const c = await cards(page);
  expect(c.count).toBe(1);
  // A sticky note's shape, with the tile's height left to the board.
  expect(c.heights[0]).toBeLessThanOrEqual(c.widths[0]);
  expect(c.heights[0]).toBeGreaterThanOrEqual(150);
  expect(c.centred).toEqual([true]);
  expect(c.blank).toBe(true);
  expect(c.blankInside).toBe(true);
});

test('a bulletin that is a photo and no words shows the photo on its note', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await open(page);
  const pic = page.locator('.dash-bulletins-tile.is-notes .dash-bulletins-words.has-pic img.dash-bulletins-pic');
  await expect(pic).toHaveCount(1);
  await expect(pic).toBeVisible();
  expect(await pic.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true);
  // The note still opens its bulletin, and still says what it is to a screen reader.
  await expect(page.locator('.dash-bulletins-words.has-pic')).toHaveAttribute('aria-label', /A photo/);
});

test('at 1100 x 800 the tile is rows, with no class name in the subtitle', async ({ page }) => {
  await open(page);
  const c = await cards(page);
  expect(c.width).toBeLessThan(600);
  expect(c.notes).toBe(false);
  // This narrow, the subtitle is left out; it never names the class.
  expect(c.sub).not.toContain('Science 8');
  // Rows keep Write a Bulletin as a button in the header; the blank note is the notes' own.
  expect(c.writeButton).toBe(true);
  expect(c.blank).toBe(false);
});

/** What Tab reaches, in order, starting from `from`. */
async function tabOrder(page, count, from) {
  await page.locator(from).first().focus();
  const order = [];
  for (let i = 0; i < count; i++) {
    order.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        const k = a.className.match(/dash-bulletins-(words|seen|write|open|blank)/);
        return k ? k[1] : a.className || a.tagName;
      }),
    );
    await page.keyboard.press('Tab');
  }
  return order;
}

test('wide: Tab goes Open Bulletins, the notes, then the blank note, as on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await open(page);
  await expect(page.locator('.dash-bulletins-tile')).toHaveClass(/is-notes/);
  expect(await tabOrder(page, 8, '.dash-bulletins-open')).toEqual([
    'open',
    'words',
    'seen',
    'words',
    'seen',
    'words',
    'seen',
    'blank',
  ]);
  // Reading order: the same.
  const dom = await page.evaluate(() =>
    [...document.querySelectorAll('.dash-bulletins-tile > *')].map(e => e.className.replace('dash-bulletins-', '')),
  );
  expect(dom).toEqual(['head', 'actions', 'rows']);
});

test('rows: Write a Bulletin and Open Bulletins come first, as on screen; the form follows a resize', async ({
  page,
}) => {
  await open(page);
  const tile = page.locator('.dash-bulletins-tile');
  await expect(tile).not.toHaveClass(/is-notes/);
  expect(await tabOrder(page, 4, '.dash-bulletins-write')).toEqual(['write', 'open', 'words', 'seen']);
  await page.setViewportSize({ width: 1680, height: 1050 });
  await expect(tile).toHaveClass(/is-notes/);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(tile).not.toHaveClass(/is-notes/);
});

/* Narrower than three notes need: two notes and the blank one, at 1280 x 800 and 1440 x 900. */
for (const [w, h] of [
  [1280, 800],
  [1440, 900],
]) {
  test(`at ${w} x ${h} the tile is two notes and a blank one`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    await expect(page.locator('.dash-bulletins-tile')).toHaveClass(/is-notes/);
    const c = await cards(page);
    expect(c.width).toBeGreaterThanOrEqual(580);
    expect(c.count).toBe(2);
    expect(new Set(c.tops).size).toBe(1);
    expect(c.inside).toBe(true);
    expect(c.uncut.every(Boolean)).toBe(true);
    expect(c.blank).toBe(true);
    expect(c.blankInside).toBe(true);
    expect(c.writeButton).toBe(false);
    expect(c.tileScroll).toEqual([0, 0]);
  });
}

test('the tile crossing 580 px without a window resize changes its form, and back', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await open(page);
  const tile = page.locator('.dash-bulletins-tile');
  await expect(tile).toHaveClass(/is-notes/);
  // The tile's parent shrinks to 540 px: the window does not change.
  await page.evaluate(() => {
    document.querySelector('.dash-row-bulletins').style.width = '540px';
  });
  await expect(tile).not.toHaveClass(/is-notes/);
  await expect(page.locator('.dash-bulletins-write')).toBeVisible();
  await expect(page.locator('.dash-bulletins-blank-btn')).toBeHidden();
  await page.evaluate(() => {
    document.querySelector('.dash-row-bulletins').style.width = '';
  });
  await expect(tile).toHaveClass(/is-notes/);
  await expect(page.locator('.dash-bulletins-write')).toBeHidden();
  await expect(page.locator('.dash-bulletins-blank-btn')).toBeVisible();
});

test('the Reminder card names its end day in the words link, not only in generated text', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await open(page);
  const label = await page
    .locator('.dash-bulletins-row')
    .first()
    .locator('.dash-bulletins-words')
    .getAttribute('aria-label');
  expect(label).toMatch(/^Reminder · Until [A-Z][a-z]{2}: /);
});

for (const [w, h] of [
  [1680, 1050],
  [1280, 800],
]) {
  test(`Seen by answers a press within 24 px or more of height at ${w} x ${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    const t = await page.evaluate(() => {
      const b = document.querySelector('.dash-bulletins-seen:not(.dash-bulletins-pending)');
      const r = b.getBoundingClientRect();
      const x = r.left + Math.min(10, r.width / 2);
      const hit = y => {
        const e = document.elementFromPoint(x, y);
        return !!(e && e.closest('.dash-bulletins-seen') === b);
      };
      // The target runs from the highest to the lowest point that reaches the button.
      let top = r.top;
      while (hit(top - 1)) top -= 1;
      let bottom = r.bottom;
      while (hit(bottom + 1)) bottom += 1;
      return bottom - top;
    });
    expect(t).toBeGreaterThanOrEqual(24);
  });
}
