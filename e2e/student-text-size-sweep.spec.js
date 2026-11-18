import { test, expect } from '@playwright/test';
import { SCREENS, reach, openDemo } from './student-screens.js';

/* Every test here opens its own page and shares nothing, so they run side by
   side across workers (a file's tests otherwise run one after another in a
   single worker, and the whole sweep outran CI's job limit). */
test.describe.configure({ mode: 'parallel' });

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

   A fault `main` already had at Normal may be listed in KNOWN_AT_NORMAL
   and is allowed there only, in the page's own font; Large, Larger and
   the wide font allow nothing.

   Each check runs in the page's own font, and again in a wide one
   (WIDE_FONT) as a Chromebook, Android, Windows or CI's Linux draws it.

   Runs in Chromium, and in WebKit with FV_WEBKIT=1 (playwright.config.js). */

const WIDTHS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const SIZES = ['normal', 'large', 'larger'];
/* A wide face, forced on every element of the student page before its own
   scripts run: the Mac's font is narrow, and CI's Linux Chromium falls back
   to DejaVu Sans, which is not. Verdana's letters are DejaVu Sans's widths
   to within a percent or two, so no extra letter-spacing: with 0.04em more
   it failed screens CI passes. */
const WIDE_FONT = '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';
const FONTS = ['own', 'wide'];
/* The wide font runs where it found faults: 320 px at every size, and
   390 px at Normal (where CI's DejaVu Sans spilled Send to My Teacher). */
const WIDE_AT = { 320: SIZES, 390: ['normal'] };

/* The screens in groups, one test each, so no one test runs long enough to
   risk the timeout on a slow runner. Every screen is in exactly one group. */
const FIRST_BULLETINS = SCREENS.findIndex(s => s.bulletins);
const FIRST_QUIZ = SCREENS.findIndex(s => s.quizzes);
const GROUPS = [
  ['assignments', 0, 7],
  ['my learning and feedback', 7, 16],
  ['send work and reflect', 16, 24],
  ['cards, report and settings', 24, FIRST_BULLETINS],
  // Bulletins (docs/plans/bulletins-plan.md B1d), behind its build switch: the last screens.
  ['bulletins', FIRST_BULLETINS, FIRST_QUIZ],
  // A quiz (docs/plans/quizzes-plan.md Q3b), behind the quizzes switch: the last screens.
  ['quizzes', FIRST_QUIZ, SCREENS.length],
].map(([name, from, to]) => ({ name, screens: SCREENS.slice(from, to) }));

async function useFont(page, font) {
  if (font !== 'wide') return;
  await page.addInitScript(css => {
    const put = () => {
      const t = document.createElement('style');
      t.id = '__wide-font';
      t.textContent = css;
      document.documentElement.appendChild(t);
    };
    if (document.documentElement) put();
    else document.addEventListener('DOMContentLoaded', put);
  }, WIDE_FONT);
}

// The only boxes that may scroll sideways: the carousel's strip of pages, and a bulletin file's.
const SIDEWAYS = '.sp-car-track, .sp-bulletin-file-track';

/* What `main` drew at Normal on narrow phones before Text Size, allowed in
   the page's own font at the widths listed: "screen — fault". Empty since
   Nov 18: the three it held (My Learning's titles cut in two, the
   reflection's steps and its Send to My Teacher spilling at 320 px) now
   hold in both fonts. */
const KNOWN_AT_NORMAL = [];

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
      // The page, a handout open over it, and a bulletin link's question over it (on <body>).
      for (const el of document.querySelectorAll('#app *, .hv-layer *, .sp-bulletin-ask, .sp-bulletin-ask *')) {
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
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !el.closest('#app, .sp-bulletin-ask') || !shown(el) || readerOnly(el) || inStrip(el)) continue;
        // A web address breaks anywhere, on purpose (the link question shows it whole).
        if (el.closest('.sp-bulletin-ask-url')) continue;
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
      for (const el of document.querySelectorAll('.sp-set, .sp-logout, .sp-sheet, .sp-bulletin-ask')) {
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

for (const font of FONTS) {
  for (const vp of WIDTHS) {
    for (const size of SIZES) {
      if (font === 'wide' && !(WIDE_AT[vp.width] || []).includes(size)) continue;
      test.describe(vp.width + ' px at ' + size + (font === 'wide' ? ', wide font' : ''), () => {
        test.use({ viewport: vp, isMobile: true, hasTouch: true });

        for (const group of GROUPS)
          test('every student screen holds together: ' + group.name, async ({ page }) => {
            test.setTimeout(120_000);
            await useFont(page, font);
            const errors = [];
            page.on('pageerror', e => errors.push(String(e)));
            const found = [];
            for (const screen of group.screens) {
              if (size !== 'normal' && screen.sized === false) continue;
              await reach(page, screen, { size, desk: false });
              for (const f of await faults(page, vp.width, vp.height)) {
                const line = screen.name + ' — ' + f;
                const known =
                  font === 'own' &&
                  size === 'normal' &&
                  KNOWN_AT_NORMAL.some(k => k.at.includes(vp.width) && k.fault.test(line));
                if (!known) found.push(line);
              }
            }
            expect(found).toEqual([]);
            expect(errors).toEqual([]);
          });

        /* Every bar the page can show: three tabs (Bulletins off, or no route on the
           server), and four with Bulletins on (docs/plans/bulletins-plan.md B1d). */
        for (const bulletins of [false, true])
          test('the tab bar holds ' + (bulletins ? 'four tabs, Bulletins on' : 'three tabs'), async ({ page }) => {
            await useFont(page, font);
            if (bulletins) await page.addInitScript(() => localStorage.setItem('fv-build-bulletins', '1'));
            await openDemo(page, { size }, 'demo-card');
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
            expect(labels.map(l => l.text)).toEqual(
              (bulletins ? ['Bulletins'] : []).concat(['Assignments', 'My Learning', 'Reflect']),
            );
            expect(labels.filter(l => !l.fits)).toEqual([]);
            // The icons in one row, however the labels wrap.
            const icons = await page
              .locator('.sp-tabs-bottom .sp-tab-icon')
              .evaluateAll(els => [...new Set(els.map(el => Math.round(el.getBoundingClientRect().top)))]);
            expect(icons).toHaveLength(1);
            expect((await faults(page, vp.width, vp.height)).filter(f => /tab/.test(f))).toEqual([]);
          });
      });
    }
  }
}
