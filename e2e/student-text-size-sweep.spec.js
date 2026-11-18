import { test, expect } from '@playwright/test';
import { SCREENS, reach, openDemo } from './student-screens.js';

/* Every student screen Demo Mode reaches (e2e/student-screens.js), at the
   phone widths students have (320, 360, 375, 390, 430) and each Text Size
   (Normal, Large, Larger). Text Size zooms the page, so its layout is as
   narrow as 246 px (320 at Larger). On each screen it fails on:
     - anything wider than the screen the test set (not the page's own
       idea of its width: a phone widens that to fit what spills),
     - text clipped by its box, spilling out of it, or a box that scrolls
       sideways (only the carousel's strip may),
     - a word broken in the middle (a word drawn on two lines),
     - a sheet or menu reaching past the top or bottom of the screen.
   Each screen is checked only once its own mark is on screen.

   Normal must draw exactly as `main` did before Text Size, so a fault
   `main` already had at Normal is listed in KNOWN_AT_NORMAL and allowed
   there only; Large and Larger allow nothing.

   Runs in Chromium, and in WebKit with FV_WEBKIT=1 (playwright.config.js). */

const WIDTHS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const SIZES = ['normal', 'large', 'larger'];
// The only boxes that may scroll sideways: the carousel's strip of pages.
const SIDEWAYS = '.sp-car-track';

/* What `main` already draws at Normal on narrow phones (checked on main on
   2026-11-18, both engines): left as they are, since Normal must not
   change. Each is "screen — fault", and holds at the widths listed. */
const KNOWN_AT_NORMAL = [
  {
    at: [320],
    fault:
      /^my learning, letter and proficiency — word broken: "(Investigation|Microscope|Ecosystem|Connections)" in span\.sp-row-title$/,
  },
  { at: [320], fault: /^reflection, step 1 — spills: button\.sp-opt "(Beginning|Confident)"$/ },
  { at: [320], fault: /^reflection, step 2 — spills: button\.sp-btn "Send to My Teacher"$/ },
];

// What is wrong with the screen as it is now, in words. `vw` and `vh` are the screen the test set.
function faults(page, vw, vh) {
  return page.evaluate(
    ([W, H, SIDEWAYS]) => {
      const out = [];
      const shown = el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      };
      // Words for screen readers only: one pixel, clipped on purpose.
      const readerOnly = el => {
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.position === 'absolute' && (cs.clip !== 'auto' || cs.clipPath !== 'none') && p.offsetWidth <= 2)
            return true;
        }
        return false;
      };
      const inStrip = el => !!el.closest(SIDEWAYS);
      const name = el =>
        el.tagName.toLowerCase() +
        (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : '');
      const words = el => '"' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) + '"';
      if (document.documentElement.scrollWidth > W + 1)
        out.push('page wider than the screen: ' + document.documentElement.scrollWidth + ' > ' + W);
      for (const el of document.querySelectorAll('#app *, .hv-layer *')) {
        if (!shown(el) || readerOnly(el)) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // Wider than the screen.
        if (!inStrip(el) && (r.right > W + 1 || r.left < -1)) out.push('off the screen: ' + name(el) + ' ' + words(el));
        const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        // A text box or file picker scrolls its own contents: not a box of the page's.
        const control = el.matches('input, textarea, select');
        const sideways = !control && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
        // A box that scrolls or clips sideways: only the carousel's strip may.
        if (sideways && cs.overflowX !== 'visible' && !el.matches(SIDEWAYS) && !inStrip(el))
          out.push('clipped or scrolls sideways: ' + name(el) + ' ' + words(el));
        // Text spilling out of its box.
        else if (sideways && text && !inStrip(el)) out.push('spills: ' + name(el) + ' ' + words(el));
        // Text cut off at the bottom of a box that does not scroll.
        if (text && /hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2)
          out.push('clipped: ' + name(el) + ' ' + words(el));
      }
      // A word drawn on two lines.
      const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !shown(el) || readerOnly(el) || inStrip(el)) continue;
        // Hyphens, slashes and dashes are places a line may break.
        for (const m of n.textContent.matchAll(/[^\s\-/–—·]{2,}/g)) {
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          const tops = new Set([...range.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
          if (tops.size > 1) out.push('word broken: "' + m[0] + '" in ' + name(el));
        }
      }
      // A sheet or menu: inside the screen, top and bottom.
      for (const el of document.querySelectorAll('.sp-set, .sp-logout, .sp-sheet')) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.top < -1 || r.bottom > H + 1)
          out.push('sheet past the screen: ' + name(el) + ' ' + Math.round(r.top) + '..' + Math.round(r.bottom));
      }
      return [...new Set(out)];
    },
    [vw, vh, SIDEWAYS],
  );
}

/* A fourth tab is coming (Bulletins, first). Added here in the test only, by
   copying a tab: the bar holds four labels at every width and size. */
async function addFourthTab(page) {
  await page.evaluate(() => {
    const bar = document.querySelector('.sp-tabs-bottom');
    const tab = bar.querySelector('.sp-tab').cloneNode(true);
    tab.classList.remove('sp-tab-on');
    tab.removeAttribute('aria-current');
    tab.querySelector('.sp-tab-label').textContent = 'Bulletins';
    bar.insertBefore(tab, bar.firstChild);
  });
}

for (const vp of WIDTHS) {
  for (const size of SIZES) {
    test.describe(vp.width + ' px at ' + size, () => {
      test.use({ viewport: vp, isMobile: true, hasTouch: true });

      test('every student screen holds together', async ({ page }) => {
        test.setTimeout(240_000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        const found = [];
        for (const screen of SCREENS) {
          if (size !== 'normal' && screen.sized === false) continue;
          await reach(page, screen, { size, desk: false });
          for (const f of await faults(page, vp.width, vp.height)) {
            const line = screen.name + ' — ' + f;
            const known = size === 'normal' && KNOWN_AT_NORMAL.some(k => k.at.includes(vp.width) && k.fault.test(line));
            if (!known) found.push(line);
          }
        }
        expect(found).toEqual([]);
        expect(errors).toEqual([]);
      });

      test('the tab bar holds four tabs', async ({ page }) => {
        await openDemo(page, { size }, 'demo-card');
        await addFourthTab(page);
        /* Where the words are drawn (a range over the label's text), inside
           the tab's own box: a label's box can grow past its tab with the
           words in it, so its own scroll width proves nothing. */
        const labels = await page.locator('.sp-tabs-bottom .sp-tab-label').evaluateAll(els =>
          els.map(el => {
            const tab = el.closest('.sp-tab').getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(el);
            const words = [...range.getClientRects()].filter(r => r.width > 0);
            const fits = words.every(r => r.left >= tab.left - 1 && r.right <= tab.right + 1);
            return { text: el.textContent, fits };
          }),
        );
        expect(labels.map(l => l.text)).toEqual(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
        expect(labels.filter(l => !l.fits)).toEqual([]);
        expect((await faults(page, vp.width, vp.height)).filter(f => /tab/.test(f))).toEqual([]);
      });
    });
  }
}
