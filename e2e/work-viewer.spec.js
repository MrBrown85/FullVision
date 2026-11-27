/**
 * The page view (shared/work-viewer.js): the student page's Work tab, Flip
 * Through Work, in Demo Mode (Science 8, Noor's Cell Microscope Lab, two
 * pages). The page fits the window: the whole page shows with nothing to
 * scroll, sized by height in its own proportions, centred, with the arrows
 * beside it and Page 1 of 2 under it; at 1440, 1280, an iPad (744, 820 and
 * 1180 across) and in a wide font. The arrows, the arrow keys, a swipe and
 * the strip of pages turn the page; Close and Escape close it. A page turns
 * at once, with the CPU slowed too.
 *
 * FV_SHOTS=<dir> keeps a picture of each size.
 */
import { test, expect } from '@playwright/test';

const SHOTS = process.env.FV_SHOTS || '';
const WIDE_FONT =
  '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';

async function openNoor(page, { pages = 2 } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && !!getStudentSubmission(cid, 'st2', 'sci8a1');
  });
  const cid = await page.evaluate(pages => {
    const cid = getActiveCourse();
    if (pages > 2) {
      // Noor's lab as a longer piece: her two pages, then copies of them (Demo Mode's own drawings).
      const work = getCourseSubmissions(cid);
      const sub = work.submissions.find(s => s.enrollment_id === 'st2' && s.assessment_id === 'sci8a1');
      const two = sub.files.slice(0, 2);
      sub.files = Array.from({ length: pages }, (_, i) =>
        Object.assign({}, two[i % 2], { id: two[i % 2].id + '-' + i, page: i + 1 }),
      );
      saveDemoStudentWork(cid, work);
    }
    return cid;
  }, pages);
  await page.goto('/student?id=st2&course=' + cid + '&tab=work');
  await expect(page.locator('.sw-card')).toHaveCount(1);
  return cid;
}

const viewer = page => page.locator('#work-viewer-overlay');
const shownImg = page => viewer(page).locator('.wv-img:not([hidden])');

async function openViewer(page) {
  const flip = page.locator('[data-sw="full"]');
  await expect(flip).toHaveText('Flip Through Work');
  await flip.click();
  await expect(viewer(page)).toBeVisible();
  await expect.poll(() => shownImg(page).evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
}

/* Where the page and what is around it are, in the window. */
function measure(page) {
  return page.evaluate(() => {
    const box = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    };
    const v = document.getElementById('work-viewer-overlay');
    const img = [...v.querySelectorAll('.wv-img')].find(i => !i.hidden);
    const words = [...v.querySelectorAll('.wv-bar button, .wv-at')].map(el => ({
      fits: el.scrollWidth <= el.clientWidth + 1,
      box: box(el),
    }));
    return {
      vw: innerWidth,
      vh: innerHeight,
      img: box(img),
      shape: img.naturalWidth / img.naturalHeight,
      stage: box(v.querySelector('.wv-stage')),
      prev: box(v.querySelector('[data-wv="page"][data-dir="-1"]')),
      next: box(v.querySelector('[data-wv="page"][data-dir="1"]')),
      at: box(v.querySelector('.wv-at')),
      title: box(v.querySelector('.wv-titles')),
      grade: box(v.querySelector('[data-wv="grade"]')),
      words,
      scrolls: v.querySelector('.wv-box').scrollHeight > v.querySelector('.wv-box').clientHeight + 1,
    };
  });
}

function expectFits(m) {
  const { img } = m;
  // The whole page is in the window, with nothing to scroll.
  expect(m.scrolls).toBe(false);
  expect(img.t).toBeGreaterThanOrEqual(0);
  expect(img.l).toBeGreaterThanOrEqual(0);
  expect(img.b).toBeLessThanOrEqual(m.vh);
  expect(img.r).toBeLessThanOrEqual(m.vw);
  // In its own proportions: never stretched.
  expect(Math.abs(img.w / img.h - m.shape)).toBeLessThan(0.01);
  // As big as the room lets it be: as tall as the stage (less the counter), or as wide as the room between the arrows.
  const tall = img.h >= m.stage.h - 30 - 2;
  const wide = img.w >= m.stage.w - 2 * 56 - 2;
  expect(tall || wide).toBe(true);
  // Centred, the arrows beside it, the counter just under it.
  expect(Math.abs((img.l + img.r) / 2 - m.vw / 2)).toBeLessThan(2);
  expect(m.prev.r).toBeLessThanOrEqual(img.l);
  expect(m.next.l).toBeGreaterThanOrEqual(img.r);
  expect(img.l - m.prev.r).toBeLessThan(20);
  expect(m.next.l - img.r).toBeLessThan(20);
  expect(m.at.t).toBeGreaterThanOrEqual(img.b - 1);
  expect(m.at.b - img.b).toBeLessThan(36);
  expect(m.at.b).toBeLessThanOrEqual(m.vh);
  // Every word on the bar fits its button, inside the window, and the title stays clear of the buttons.
  m.words.forEach(w => {
    expect(w.fits).toBe(true);
    expect(w.box.r).toBeLessThanOrEqual(m.vw);
  });
  expect(m.title.r).toBeLessThanOrEqual(m.grade.l);
}

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: 'iPad 820', width: 820, height: 1180 },
  { name: 'iPad mini 744', width: 744, height: 1133 },
  { name: 'iPad across', width: 1180, height: 820 },
];

test.describe('the page fits the window', () => {
  for (const size of SIZES) {
    for (const wideFont of [false, true]) {
      test(size.name + (wideFont ? ', wide font' : ''), async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        await openNoor(page);
        if (wideFont) await page.addStyleTag({ content: WIDE_FONT });
        await openViewer(page);
        await expect(viewer(page).locator('.wv-at')).toHaveText('Page 1 of 2');
        expectFits(await measure(page));
        if (SHOTS && !wideFont) await page.screenshot({ path: SHOTS + '/work-viewer-' + size.width + '.png' });
        await viewer(page).locator('[data-wv="page"][data-dir="1"]').click();
        await expect(viewer(page).locator('.wv-at')).toHaveText('Page 2 of 2');
        await expect.poll(() => shownImg(page).evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
        expectFits(await measure(page));
        expect(errors).toEqual([]);
      });
    }
  }
});

test.describe('turning the page and closing', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the arrows and the arrow keys turn the page; Escape closes and focus comes back', async ({ page }) => {
    await openNoor(page);
    await openViewer(page);
    const v = viewer(page);
    const at = v.locator('.wv-at');
    const prev = v.locator('[data-wv="page"][data-dir="-1"]');
    const next = v.locator('[data-wv="page"][data-dir="1"]');
    await expect(at).toHaveText('Page 1 of 2');
    await expect(prev).toBeDisabled();
    await next.click();
    await expect(at).toHaveText('Page 2 of 2');
    await expect(next).toBeDisabled();
    await expect(shownImg(page)).toHaveAttribute('data-page', '1');
    await prev.click();
    await expect(at).toHaveText('Page 1 of 2');
    await page.keyboard.press('ArrowRight');
    await expect(at).toHaveText('Page 2 of 2');
    await page.keyboard.press('ArrowRight');
    await expect(at).toHaveText('Page 2 of 2');
    await page.keyboard.press('ArrowLeft');
    await expect(at).toHaveText('Page 1 of 2');
    // The keys stay in the view: the student page's tabs do not move under it.
    await expect(page.locator('#stu-tab-work')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(v).toHaveCount(0);
    await expect(page.locator('[data-sw="full"]')).toBeFocused();
    await expect(page.locator('#stu-tab-work')).toHaveAttribute('aria-selected', 'true');
  });

  test('Close closes; so does a click on the dark beside the page', async ({ page }) => {
    await openNoor(page);
    await openViewer(page);
    await viewer(page).locator('[data-wv="close"]').click();
    await expect(viewer(page)).toHaveCount(0);
    await openViewer(page);
    const stage = await viewer(page).locator('.wv-stage').boundingBox();
    await page.mouse.click(stage.x + 8, stage.y + 8);
    await expect(viewer(page)).toHaveCount(0);
  });

  test('a piece of five pages: the strip jumps to a page, and the counter and arrows follow', async ({ page }) => {
    await openNoor(page, { pages: 5 });
    await openViewer(page);
    const v = viewer(page);
    await expect(v.locator('.wv-thumb')).toHaveCount(5);
    await expect(v.locator('.wv-thumb.is-on')).toHaveAttribute('data-page', '0');
    await v.locator('.wv-thumb').nth(4).click();
    await expect(v.locator('.wv-at')).toHaveText('Page 5 of 5');
    await expect(v.locator('.wv-thumb.is-on')).toHaveAttribute('data-page', '4');
    await expect(v.locator('[data-wv="page"][data-dir="1"]')).toBeDisabled();
    await expect.poll(() => shownImg(page).evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    expectFits(await measure(page));
    if (SHOTS) await page.screenshot({ path: SHOTS + '/work-viewer-strip-1440.png' });
  });

  test('a page turns at once, the CPU slowed six times: nothing fades or slides', async ({ page }) => {
    await openNoor(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openViewer(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    const v = viewer(page);
    for (const [dir, want] of [
      [1, '1'],
      [-1, '0'],
      [1, '1'],
    ]) {
      await v.locator('[data-wv="page"][data-dir="' + dir + '"]').click();
      // The same frame as the click: one page showing, the new one, with nothing running on it.
      const now = await page.evaluate(() => {
        const shown = [...document.querySelectorAll('#work-viewer-overlay .wv-img')].filter(i => !i.hidden);
        return {
          shown: shown.map(i => i.getAttribute('data-page')),
          moving: document
            .getAnimations()
            .filter(a => a.effect && a.effect.target && a.effect.target.closest('.wv-stage')).length,
        };
      });
      expect(now.shown).toEqual([want]);
      expect(now.moving).toBe(0);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});

test.describe('on an iPad', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test('a swipe across the page turns it', async ({ page }) => {
    await openNoor(page);
    await openViewer(page);
    const at = viewer(page).locator('.wv-at');
    const img = await shownImg(page).boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (from, to) => {
      const y = img.y + img.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
      for (let i = 1; i <= 5; i++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: from + ((to - from) * i) / 5, y }],
        });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(img.x + img.width * 0.8, img.x + img.width * 0.2);
    await expect(at).toHaveText('Page 2 of 2');
    await swipe(img.x + img.width * 0.2, img.x + img.width * 0.8);
    await expect(at).toHaveText('Page 1 of 2');
  });
});
