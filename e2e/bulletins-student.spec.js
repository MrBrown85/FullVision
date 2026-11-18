import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Bulletins on the student's page (docs/plans/bulletins-plan.md, slice B1d;
   the Bulletins Artboard, C1 to C3; on since B1g), in Demo Mode, against the built site with the live site's CSP and
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
    ([css, own]) => {
      // The class's own bulletins, as the teacher's Demo Mode keeps them on this device (OWN_BULLETINS).
      if (own) {
        const tall = document.createElement('canvas');
        tall.width = 120;
        tall.height = 600;
        const g = tall.getContext('2d');
        g.fillStyle = '#eef';
        g.fillRect(0, 0, 120, 600);
        g.fillStyle = '#336';
        g.fillRect(10, 10, 100, 20);
        const page = tall.toDataURL('image/png');
        const at = m => new Date(Date.now() - m * 60000).toISOString();
        const b = (id, m, more) =>
          Object.assign(
            { id, kind: 'announcement', body: 'Notes for today, ' + id + '.', posted_at: at(m), files: [] },
            more,
          );
        const long = 'https://www.example.org/' + 'a-very-long-address/'.repeat(80) + '?q=' + 'x'.repeat(200);
        localStorage.setItem(
          'gb-bulletins-sci8',
          JSON.stringify({
            bulletins: [
              b('own-1', 600),
              b('own-2', 590),
              b('own-3', 580),
              b('own-link', 570, {
                link_url: 'https://www.youtube.com/watch?v=inside-a-cell',
                link_title: 'Inside a Cell (video)',
              }),
              b('own-4', 560),
              b('own-long', 550, { link_url: long, link_title: 'A Long Address' }),
              b('own-longtitle', 545, {
                link_url: long,
                link_title:
                  'Inside a Cell: The Whole Walkthrough of the Membrane, the Nucleus, the Mitochondria and Everything Between Them, Part Two',
              }),
              b('own-5', 540),
              b('own-tall', 530, {
                files: [
                  {
                    id: 'own-tall-file',
                    kind: 'pdf',
                    title: 'A Tall Page',
                    page_count: 2,
                    position: 1,
                    status: 'ready',
                    paths: [page, page],
                  },
                ],
              }),
              b('own-6', 520),
              b('own-7', 510),
              b('own-8', 500),
            ],
            seen: {},
            reactions: {},
          }),
        );
      }
      const add = () => {
        const st = document.createElement('style');
        st.textContent = css + ' { display: none !important; }';
        document.documentElement.appendChild(st);
      };
      if (document.documentElement) add();
      else document.addEventListener('DOMContentLoaded', add);
    },
    [ADBLOCK, !!opts.own],
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

/* A page open full size, measured: Back below the header, and the picture and Previous/Next above
   the tab bar. Returns what does not hold, in words. */
function viewerFaults(page) {
  return page.evaluate(() => {
    const out = [];
    const r = sel => {
      const el = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().height > 0);
      return el ? el.getBoundingClientRect() : null;
    };
    const head = r('#app .sp-head');
    const tabs = r('#app .sp-tabs-bottom');
    const floor = tabs ? tabs.top : window.innerHeight;
    const back = r('.sp-bulletin-viewer-back');
    const img = r('.sp-bulletin-viewer-img');
    if (back && head && back.top < head.bottom - 0.5) out.push('Back under the header');
    if (img && img.bottom > floor + 0.5)
      out.push('picture under the tab bar: ' + Math.round(img.bottom) + ' > ' + Math.round(floor));
    for (const sel of ['.sp-bulletin-viewer-turn:not(.sp-bulletin-viewer-next)', '.sp-bulletin-viewer-next']) {
      const b = r(sel);
      if (b && b.bottom > floor + 0.5)
        out.push(sel + ' under the tab bar: ' + Math.round(b.bottom) + ' > ' + Math.round(floor));
    }
    return out;
  });
}

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
    ).toHaveText('2 new');
    await expect(
      page.locator('.sp-set-classes .sp-class', { hasText: 'Humanities 8' }).locator('.sp-bulletin-class-new'),
    ).toHaveCount(0);
    // Back to Science 8 from Switch Class: a class opened afresh, so it opens on Bulletins again.
    await page.locator('.sp-set-classes .sp-class', { hasText: 'Science 8' }).click();
    await expect(page.locator('.sp-head-title')).toHaveText('Science 8');
    await expect(bar(page).locator('[data-tab="bulletins"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#sp-bulletin-new')).toBeVisible();
  });
});

/* Every Bulletins screen whole at the phone widths students have and each
   Text Size (a 320 px phone at Larger lays out at 246 px). Measured against
   the layout's own width (documentElement.clientWidth, which a phone's
   wider visual viewport does not change), with what is inside a sheet or
   the question included, and each screen checked to have opened before it
   is looked at. */
const WIDTHS = [320, 360, 375, 390, 430];
const WIDE_FONT =
  '#app, #app *, .sp-bulletin-ask, .sp-bulletin-ask * { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';
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

      /* Twice: in the page's own font, and in a wider one (Verdana or DejaVu Sans with a little
         letter-spacing), as a Linux CI runner or a Windows laptop draws it. Both must hold. */
      for (const font of ['own', 'wide']) {
        test(
          'every Bulletins screen holds together, and the bar holds four tabs, ' + font + ' font',
          async ({ page }) => {
            await open(page, { size });
            if (font === 'wide') await page.addStyleTag({ content: WIDE_FONT });
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
                  /* Where the words are drawn (a range over the label's text), inside the tab's own
                 box, and no word drawn on two lines: a label's box can grow past its tab. */
                  fits: (() => {
                    const l = t.querySelector('.sp-tab-label');
                    const b = t.getBoundingClientRect();
                    const range = document.createRange();
                    range.selectNodeContents(l);
                    const rects = [...range.getClientRects()].filter(r => r.width > 0);
                    const lines = new Set(rects.map(r => Math.round(r.top))).size;
                    return (
                      rects.every(r => r.left >= b.left - 1 && r.right <= b.right + 1) &&
                      lines <= l.textContent.split(' ').length
                    );
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
            for (const f of await viewerFaults(page)) found.push('a page full size — ' + f);
            expect(found).toEqual([]);
          },
        );
      }
    });
  }
}

/* The link's question is never over the card that opened it, so Open Website is never under the
   finger: at every phone width and Text Size, in the page's font and a wide one, for a plain link and
   a very long one, with the card near the top, the middle and the bottom of the screen. And a page
   opened full size (a tall portrait page too) keeps Back, the picture and Previous/Next between the
   header and the tab bar. */
for (const width of WIDTHS) {
  for (const size of SIZES) {
    test.describe(width + ' px at ' + size + ', placing', () => {
      test.use({ viewport: { width, height: width < 360 ? 568 : 760 }, isMobile: true, hasTouch: true });

      test('the link question beside the card, and a tall page full size above the tab bar', async ({ page }) => {
        test.setTimeout(90_000);
        await open(page, { size, own: true });
        const found = [];
        for (const font of ['own', 'wide']) {
          if (font === 'wide') await page.addStyleTag({ content: WIDE_FONT });
          for (const which of ['own-link', 'own-long', 'own-longtitle']) {
            const card = page.locator('[data-bulletin="' + which + '"] .sp-bulletin-link');
            for (const at of [0.2, 0.5, 0.8]) {
              await card.evaluate((el, f) => {
                const r = el.getBoundingClientRect();
                window.scrollBy(0, r.top + r.height / 2 - f * window.innerHeight);
              }, at);
              const tap = await card.boundingBox();
              await card.click();
              const ask = page.locator('.sp-bulletin-ask');
              await expect(ask).toBeVisible();
              const go = await page.locator('.sp-bulletin-ask-go').boundingBox();
              const box = await ask.boundingBox();
              const H = page.viewportSize().height;
              const x = tap.x + tap.width / 2;
              const y = tap.y + tap.height / 2;
              const tag = font + ' font, ' + which + ' at ' + at + ': ';
              if (x >= go.x && x <= go.x + go.width && y >= go.y && y <= go.y + go.height)
                found.push(tag + 'Open Website under the tap');
              // Never over the tapped point; over the card only when neither side had room for it.
              if (box.y < y && box.y + box.height > y) found.push(tag + 'the question over the tap point');
              const beside = Math.max(tap.y - 16, H - (tap.y + tap.height) - 16);
              if (box.height <= beside && box.y < tap.y + tap.height - 0.5 && box.y + box.height > tap.y + 0.5)
                found.push(tag + 'the question over the card');
              // Inside the screen, unless that would put it over the tapped point.
              const fits = Math.max(y - 16, H - y - 16) >= box.height;
              if (fits && (box.y < -0.5 || box.y + box.height > H + 0.5))
                found.push(tag + 'the question past the screen');
              await page.locator('.sp-bulletin-ask-no').click();
              await expect(ask).toHaveCount(0);
            }
          }
          // A tall portrait page, full size, then back.
          await page.locator('[data-bulletin-file="own-tall-file"] .sp-bulletin-file-slide[data-page="0"]').click();
          await expect(page.locator('.sp-bulletin-viewer-img')).toBeVisible();
          await expect(page.locator('.sp-bulletin-viewer-next')).toBeVisible();
          for (const f of await viewerFaults(page)) found.push(font + ' font, a tall page: ' + f);
          await page.locator('.sp-bulletin-viewer-back').click();
          await expect(page.locator('.sp-bulletin-viewer')).toHaveCount(0);
        }
        expect(found).toEqual([]);
      });
    });
  }
}

/* The bar with Bulletins in it (StudentBulletinsView.fitTabs): every label whole, inside its tab, at
   every width and Text Size in both fonts; the drawn size never smaller at a bigger Text Size; five
   tabs fit as well as four; and in the teacher's Preview as Student, sized from the phone frame's bar,
   not the teacher's window. */
async function tabLabels(page, scope) {
  return page.locator(scope + ' .sp-tabs-bottom .sp-tab-label').evaluateAll(els =>
    els.map(el => {
      const tab = el.closest('.sp-tab').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter(r => r.width > 0);
      const lines = new Set(rects.map(r => Math.round(r.top))).size;
      const icon = el.closest('.sp-tab').querySelector('.sp-tab-icon').getBoundingClientRect();
      return {
        text: el.textContent,
        drawn: Math.round(parseFloat(getComputedStyle(el).fontSize) * (icon.width / 22) * 10) / 10,
        fits:
          rects.every(r => r.left >= tab.left - 1 && r.right <= tab.right + 1) &&
          lines <= el.textContent.split(' ').length,
        icon: Math.round(icon.top),
      };
    }),
  );
}

for (const width of WIDTHS) {
  test.describe(width + ' px, the tab bar', () => {
    test.use({ viewport: { width, height: 700 }, isMobile: true, hasTouch: true });

    test('labels whole in both fonts, and never smaller at a bigger Text Size', async ({ page }) => {
      test.setTimeout(90_000);
      for (const font of ['own', 'wide']) {
        const drawn = [];
        for (const size of SIZES) {
          await page.goto('about:blank');
          await open(page, { size });
          if (font === 'wide') await page.addStyleTag({ content: WIDE_FONT });
          // Drawn again in that font, as a page first drawn in it is.
          await page.evaluate(() => StudentBulletinsView.fitTabs(document.getElementById('app')));
          const labels = await tabLabels(page, '#app');
          expect(labels.map(l => l.text)).toEqual(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
          expect(
            labels.filter(l => !l.fits),
            font + ' ' + size,
          ).toEqual([]);
          expect(new Set(labels.map(l => l.icon)).size).toBe(1);
          drawn.push(labels[1].drawn);
        }
        expect(drawn[1], font + ': Large against Normal ' + drawn).toBeGreaterThanOrEqual(drawn[0]);
        expect(drawn[2], font + ': Larger against Large ' + drawn).toBeGreaterThanOrEqual(drawn[1]);
      }
    });

    test('five tabs fit as four do, in the wide font at Larger', async ({ page }) => {
      await open(page, { size: 'larger' });
      await page.addStyleTag({ content: WIDE_FONT });
      await page.evaluate(() => {
        const bar = document.querySelector('#app .sp-tabs-bottom');
        const extra = bar.querySelector('[data-tab="assignments"]').cloneNode(true);
        extra.classList.remove('sp-tab-on');
        extra.removeAttribute('aria-current');
        bar.appendChild(extra);
        StudentBulletinsView.fitTabs(document.getElementById('app'));
      });
      const labels = await tabLabels(page, '#app');
      expect(labels).toHaveLength(5);
      expect(labels.filter(l => !l.fits)).toEqual([]);
      expect(new Set(labels.map(l => l.icon)).size).toBe(1);
    });
  });
}

test.describe('Preview as Student, a desktop window', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the bar in the phone frame holds four tabs at every Text Size, in both fonts', async ({ page }) => {
    test.setTimeout(90_000);
    await page.clock.install({ time: NOW });
    await page.goto('/login.html?demo=1');
    await page.waitForFunction(
      () =>
        typeof PreviewStudent !== 'undefined' &&
        typeof getStudents === 'function' &&
        (getStudents('sci8') || []).length > 0,
    );
    await page.evaluate(() => PreviewStudent.open('sci8', 'st1'));
    const screen = '.ps-screen';
    await expect(page.locator(screen + ' .sp-tabs-bottom [data-tab="bulletins"]')).toBeVisible();
    for (const font of ['own', 'wide']) {
      if (font === 'wide') {
        await page.addStyleTag({
          content: '.ps-screen, .ps-screen * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }',
        });
      }
      for (const size of SIZES) {
        await page.locator(screen + ' .sp-gear').click();
        await page.locator(screen + ' .sp-set-size[data-size="' + size + '"]').click();
        await page.locator(screen + ' .sp-set-done').click();
        await page.evaluate(() => StudentBulletinsView.fitTabs(document.querySelector('.ps-screen')));
        const labels = await tabLabels(page, screen);
        expect(labels.map(l => l.text)).toEqual(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
        expect(
          labels.filter(l => !l.fits),
          font + ' ' + size,
        ).toEqual([]);
        expect(new Set(labels.map(l => l.icon)).size).toBe(1);
      }
    }
  });
});

/* Switch Class (gear review, should-fix): at every Text Size, the current class's tick stays on its
   name's line, and its counts ("3 to do", and "2 new" with Bulletins on) stay whole inside the row. */
test.describe('Switch Class at 320 px', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

  test('the tick beside the name, the counts whole, at every Text Size and in both fonts', async ({ page }) => {
    test.setTimeout(90_000);
    for (const font of ['own', 'wide']) {
      for (const size of SIZES) {
        await page.goto('about:blank');
        await open(page, { size });
        if (font === 'wide') await page.addStyleTag({ content: WIDE_FONT });
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.locator('.sp-set [data-act="card-add"]').click();
        await page.locator('#sp-code').fill('ABCD-EFGH');
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByLabel('Student Number').fill('1234567');
        await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
        await expect(page.locator('.sp-head-title')).toHaveText('Humanities 8');
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.locator('.sp-set .sp-class', { hasText: 'Science 8' }).click();
        await expect(page.locator('.sp-head-title')).toHaveText('Science 8');
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.waitForTimeout(300);
        const rows = await page.locator('.sp-set .sp-class').evaluateAll(els =>
          els.map(el => {
            const r = el.getBoundingClientRect();
            const name = el.querySelector('.sp-class-name').getBoundingClientRect();
            const tick = el.querySelector('.sp-class-tick');
            const t = tick ? tick.getBoundingClientRect() : null;
            return {
              name: el.querySelector('.sp-class-name').textContent,
              tick: !t || (t.top < name.bottom && t.bottom > name.top),
              counts: [...el.querySelectorAll('.sp-class-todo, .sp-bulletin-class-new')].every(x => {
                const q = x.getBoundingClientRect();
                return q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && x.scrollWidth <= x.clientWidth + 1;
              }),
            };
          }),
        );
        expect(
          rows.filter(x => !x.tick || !x.counts),
          font + ' ' + size,
        ).toEqual([]);
        await expect(page.locator('.sp-set .sp-bulletin-class-new')).toHaveText('2 new');
      }
    }
  });
});
