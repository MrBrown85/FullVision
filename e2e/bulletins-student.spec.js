import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Bulletins on the student's page (docs/plans/bulletins-plan.md, slice B1d;
   the Bulletins Artboard, C1 to C3), in Demo Mode with the `bulletins`
   build switch on, against the built site with the live site's CSP and
   every ad blocker name hidden as a blocker would hide it
   (tests/fixtures/adblock-hidden-names.txt). The clock is pinned before the
   page loads (Wednesday, Nov 18, 2026, 7 p.m. in Vancouver), so the day
   headings and times are exact. Nothing is sent anywhere. Runs in Chromium,
   and in WebKit with FV_WEBKIT=1 (playwright.config.js, webkit-student). */

const NOW = new Date('2026-11-18T19:00:00-08:00');
const ADBLOCK = readFileSync('tests/fixtures/adblock-hidden-names.txt', 'utf8')
  .split('\n')
  .filter(l => l && !l.startsWith('!'))
  .join(',\n');

test.use({ timezoneId: 'America/Vancouver', locale: 'en-CA' });

async function open(page, opts = {}) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.clock.install({ time: NOW });
  await page.addInitScript(
    ([css, flag]) => {
      if (flag) localStorage.setItem('fv-build-bulletins', '1');
      const add = () => {
        const st = document.createElement('style');
        st.textContent = css + ' { display: none !important; }';
        document.documentElement.appendChild(st);
      };
      if (document.documentElement) add();
      else document.addEventListener('DOMContentLoaded', add);
    },
    [ADBLOCK, opts.flag !== false],
  );
  await page.goto('/s/#' + (opts.hash || 'demo-card'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.locator('.sp-view').first().waitFor();
  if (opts.size && opts.size !== 'normal') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.sp-set-size[data-size="' + opts.size + '"]').click();
    await page.locator('.sp-set-done').click();
  }
  return posts;
}

const bar = page => page.locator('.sp-tabs').locator('visible=true');

test.describe('on a phone, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('opens on Bulletins at the New line, the board’s days and times, the red count', async ({ page }) => {
    const posts = await open(page);
    await expect(bar(page).locator('.sp-tab-label')).toHaveText(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
    await expect(bar(page).locator('[data-tab="bulletins"]')).toHaveAttribute('aria-current', 'page');
    await expect(bar(page).locator('[data-tab="bulletins"] .sp-tab-badge')).toHaveText('2');
    await expect(page.locator('.sp-bulletin-day')).toHaveText(['Monday', 'Yesterday', 'Today']);
    await expect(page.locator('.sp-bulletin-time')).toHaveText(['8:42 a.m.', '2:30 p.m.', '9:58 a.m.', '10:15 a.m.']);
    await expect(page.locator('.sp-bulletin-kind')).toHaveText(['Reminder · Until Sun, Nov 22', 'Photo of the Board']);
    // The New line sits just under the reminder's bar, which sits just under the header.
    const head = await page.locator('.sp-head').boundingBox();
    const pin = await page.locator('.sp-bulletin-pinbar').boundingBox();
    const line = await page.locator('#sp-bulletin-new').boundingBox();
    expect(Math.abs(pin.y - (head.y + head.height))).toBeLessThan(2);
    expect(line.y - (pin.y + pin.height)).toBeGreaterThanOrEqual(0);
    expect(line.y - (pin.y + pin.height)).toBeLessThan(24);
    // The reminder carries its assignment's band, and opens its card.
    await expect(page.locator('.sp-bulletin-piece .sp-band')).toContainText('In 4 Days');
    await page.locator('.sp-bulletin-pinbar').click();
    await expect(page.locator('.sp-bulletin-reminder')).toBeInViewport();
    await page.locator('.sp-bulletin-piece').click();
    await expect(bar(page).locator('[data-tab="assignments"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.sp-picked .sp-piece-title')).toHaveText('Science Fair Proposal');
    expect(posts).toEqual([]);
  });

  test('a reaction: one tap, the student’s own choice, and nothing sent in Demo Mode', async ({ page }) => {
    const posts = await open(page);
    const got = page.locator('.sp-bulletin-react[data-word="got_it"]');
    await expect(page.locator('.sp-bulletin-react')).toHaveText(['Got It', 'Done', 'I Have a Question']);
    await got.click();
    await expect(got).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.sp-bulletin-react[data-word="question"]').click();
    await expect(got).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.sp-bulletin-react[data-word="question"]')).toHaveAttribute('aria-pressed', 'true');
    // Seen: on screen a moment, the count goes down; nothing is sent.
    await page.clock.runFor(1500);
    await expect(bar(page).locator('[data-tab="bulletins"] .sp-tab-badge')).toHaveCount(0);
    expect(posts).toEqual([]);
  });

  test('a link asks first, away from the tap; closed things are out of sight at rest', async ({ page, context }) => {
    await open(page);
    await context.route('**://www.youtube.com/**', r =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<p>away</p>' }),
    );
    // At rest: no question, no page open full size; anything marked hidden is out of sight.
    await expect(page.locator('.sp-bulletin-ask, .sp-bulletin-ask-back, .sp-bulletin-viewer')).toHaveCount(0);
    const shownHidden = await page.evaluate(() =>
      [...document.querySelectorAll('[hidden]')]
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => el.className),
    );
    expect(shownHidden).toEqual([]);
    const card = page.locator('.sp-bulletin-link');
    await expect(card.locator('.sp-bulletin-link-host')).toHaveText('youtube.com');
    await card.scrollIntoViewIfNeeded();
    const tap = await card.boundingBox();
    await card.click();
    const ask = page.getByRole('alertdialog', { name: 'Open a Website' });
    await expect(ask.locator('.sp-bulletin-ask-words')).toHaveText('Open this website in a new tab?');
    await expect(ask.locator('.sp-bulletin-ask-url')).toHaveText('https://www.youtube.com/watch?v=inside-a-cell');
    await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // Open Website is never where the finger that opened the question was.
    const go = await ask.getByRole('button', { name: 'Open Website' }).boundingBox();
    const cx = tap.x + tap.width / 2;
    const cy = tap.y + tap.height / 2;
    expect(cx >= go.x && cx <= go.x + go.width && cy >= go.y && cy <= go.y + go.height).toBe(false);
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.sp-bulletin-ask, .sp-bulletin-ask-back')).toHaveCount(0);
    await expect(card).toBeFocused();
    // Open Website: a new tab, with no way back to this page and no referrer.
    await card.click();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Open Website' }).click(),
    ]);
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://www.youtube.com/watch?v=inside-a-cell');
    expect(await popup.evaluate(() => [window.opener === null, document.referrer])).toEqual([true, '']);
    await expect(page.locator('.sp-bulletin-ask')).toHaveCount(0);
  });

  test('a file’s pages swipe sideways; a tap opens the page full size; Back returns', async ({ page }) => {
    await open(page);
    const strip = page.locator('.sp-bulletin-file-pdf');
    await strip.scrollIntoViewIfNeeded();
    await expect(strip.locator('.sp-bulletin-file-count')).toHaveText('1 / 2');
    await expect(strip.locator('.sp-bulletin-file-slide').first().locator('img')).toHaveAttribute(
      'src',
      '/assets/sample-bulletins/cell-theory-1.svg',
    );
    await strip.locator('.sp-bulletin-file-track').evaluate(t => t.scrollTo({ left: t.clientWidth, behavior: 'auto' }));
    await expect(strip.locator('.sp-bulletin-file-count')).toHaveText('2 / 2');
    await strip.locator('.sp-bulletin-file-slide[data-page="1"]').click();
    await expect(page.locator('#sp-bulletin-viewer-title')).toHaveText('Cell Theory Reading');
    await expect(page.locator('.sp-bulletin-viewer-sub')).toHaveText('Page 2 of 2');
    await expect(page.locator('.sp-bulletin-viewer-img')).toHaveJSProperty('complete', true);
    await page.getByRole('button', { name: 'Previous Page' }).click();
    await expect(page.locator('.sp-bulletin-viewer-sub')).toHaveText('Page 1 of 2');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('.sp-bulletin-viewer')).toHaveCount(0);
    await expect(strip.locator('.sp-bulletin-file-slide[data-page="0"]')).toBeFocused();
  });

  test('the second sample class has nothing posted: it opens on Assignments (C3)', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.sp-set [data-act="card-add"]').click();
    await page.locator('#sp-code').fill('ABCD-EFGH');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Student Number').fill('1234567');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
    await expect(page.locator('.sp-head-title')).toHaveText('Humanities 8');
    await expect(bar(page).locator('[data-tab="assignments"]')).toHaveAttribute('aria-current', 'page');
    await expect(bar(page).locator('.sp-tab-label')).toHaveText(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
    // Switch Class says how many are new in the other class.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(
      page.locator('.sp-set-classes .sp-class', { hasText: 'Science 8' }).locator('.sp-bulletin-class-new'),
    ).toHaveCount(0);
  });

  test('with the switch off: three tabs, nothing of Bulletins, nothing sent', async ({ page }) => {
    const posts = await open(page, { flag: false });
    await expect(bar(page).locator('.sp-tab-label')).toHaveText(['Assignments', 'My Learning', 'Reflect']);
    await expect(page.locator('[class*="sp-bulletin"]')).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /bulletin/.test(k)))).toEqual([]);
    expect(posts).toEqual([]);
  });
});

/* Every Bulletins screen whole at the phone widths students have and each
   Text Size (a 320 px phone at Larger lays out at 246 px). Measured against
   the layout's own width (documentElement.clientWidth, which a phone's
   wider visual viewport does not change), with what is inside a sheet or
   the question included, and each screen checked to have opened before it
   is looked at. */
const WIDTHS = [320, 360, 375, 390, 430];
const SIZES = ['normal', 'large', 'larger'];

function faults(page, scope) {
  return page.evaluate(sel => {
    const W = document.documentElement.clientWidth;
    const H = document.documentElement.clientHeight;
    const out = [];
    const shown = el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const readerOnly = el => {
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.position === 'absolute' && cs.clip !== 'auto' && p.offsetWidth <= 2) return true;
      }
      return false;
    };
    const inStrip = el => !!el.closest('.sp-bulletin-file-track');
    const name = el =>
      el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : '');
    const all = [...document.querySelectorAll(sel)];
    for (const el of all) {
      if (!shown(el) || readerOnly(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!inStrip(el) && (r.right > W + 1 || r.left < -1)) out.push('off the screen: ' + name(el));
      const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (
        text &&
        !/auto|scroll/.test(cs.overflowX) &&
        cs.textOverflow !== 'ellipsis' &&
        el.scrollWidth > el.clientWidth + 1 &&
        el.clientWidth > 0
      )
        out.push('clipped or spilling: ' + name(el) + ' "' + el.textContent.trim().slice(0, 30) + '"');
      if (el.matches('.sp-bulletin-ask') && (r.top < -1 || r.bottom > H + 1)) out.push('question past the screen');
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (
        !el ||
        !el.closest(
          sel
            .split(',')
            .map(s => s.replace(/ \*$/, ''))
            .join(','),
        ) ||
        !shown(el) ||
        readerOnly(el)
      )
        continue;
      if (el.closest('.sp-bulletin-ask-url, .sp-bulletin-link-host')) continue; // an address breaks anywhere, on purpose
      for (const m of n.textContent.matchAll(/[^\s\-/–—·]{2,}/g)) {
        const range = document.createRange();
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        const tops = new Set([...range.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
        if (tops.size > 1) out.push('word broken: "' + m[0] + '" in ' + name(el));
      }
    }
    if (document.documentElement.scrollWidth > W + 1) out.push('the page scrolls sideways');
    return [...new Set(out)];
  }, scope);
}

for (const width of WIDTHS) {
  for (const size of SIZES) {
    test.describe(width + ' px at ' + size, () => {
      test.use({ viewport: { width, height: width < 360 ? 568 : 760 }, isMobile: true, hasTouch: true });

      test('every Bulletins screen holds together, and the bar holds four tabs', async ({ page }) => {
        await open(page, { size });
        // The sample class opens on Bulletins (Settings changes nothing of that).
        await expect(bar(page).locator('[data-tab="bulletins"]')).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('.sp-bulletin-feed')).toBeVisible();
        const found = [];
        const look = async (screen, scope) => {
          await page.waitForTimeout(260); // motion settles (200 ms)
          for (const f of await faults(page, scope || '#app *')) found.push(screen + ' — ' + f);
        };
        await look('the feed');
        await page.evaluate(() => window.scrollTo(0, 0));
        await look('the feed, top');
        // The four tabs: icons in one row, every label whole.
        const tabs = await bar(page)
          .locator('.sp-tab')
          .evaluateAll(els =>
            els.map(t => ({
              icon: Math.round(t.querySelector('.sp-tab-icon').getBoundingClientRect().top),
              // The label whole, and inside its own button.
              fits: (() => {
                const l = t.querySelector('.sp-tab-label');
                const r = l.getBoundingClientRect();
                const b = t.getBoundingClientRect();
                return l.scrollWidth <= l.clientWidth + 1 && r.left >= b.left - 0.5 && r.right <= b.right + 0.5;
              })(),
            })),
          );
        expect(tabs).toHaveLength(4);
        expect(new Set(tabs.map(t => t.icon)).size).toBe(1);
        expect(tabs.filter(t => !t.fits)).toEqual([]);
        // The link's question.
        await page.locator('.sp-bulletin-link').click();
        await expect(page.locator('.sp-bulletin-ask')).toBeVisible();
        await look('the link question', '#app *, .sp-bulletin-ask, .sp-bulletin-ask *');
        await page.locator('.sp-bulletin-ask-no').click();
        await expect(page.locator('.sp-bulletin-ask')).toHaveCount(0);
        // A page full size.
        await page.locator('.sp-bulletin-file-slide[data-page="0"]').last().click();
        await expect(page.locator('.sp-bulletin-viewer-img')).toBeVisible();
        await look('a page full size');
        const img = await page.locator('.sp-bulletin-viewer-img').boundingBox();
        const vh = page.viewportSize().height;
        expect(img.y + img.height).toBeLessThanOrEqual(vh);
        expect(found).toEqual([]);
      });
    });
  }
}
