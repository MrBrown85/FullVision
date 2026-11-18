import { test, expect } from '@playwright/test';

/* Every student screen Demo Mode reaches, at the phone widths students
   have (320, 360, 375, 390, 430) and each Text Size (Normal, Large,
   Larger). Text Size zooms the page, so its layout is as narrow as 246 px
   (320 at Larger); this keeps every screen whole there. On each screen it
   fails on:
     - text clipped or spilling out of its box,
     - anything wider than the screen,
     - a word broken in the middle (a word drawn on two lines),
     - a sheet or menu taller than the screen, or reaching past its top.
   Runs in Chromium, and in WebKit with FV_WEBKIT=1 (playwright.config.js). */

const WIDTHS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const SIZES = ['normal', 'large', 'larger'];

// What is wrong with the screen as it is now, in words.
function faults(page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
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
    // Inside something that scrolls or swipes sideways on purpose (a carousel).
    const inScroller = el => {
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const name = el =>
      el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : '');
    const words = el => '"' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) + '"';
    const all = [...document.querySelectorAll('#app *, .hv-layer *')];
    for (const el of all) {
      if (!shown(el) || readerOnly(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // Wider than the screen.
      if (!inScroller(el) && (r.right > W + 1 || r.left < -1))
        out.push('off the screen: ' + name(el) + ' ' + words(el));
      // Text clipped by, or spilling out of, its box.
      const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (text && !/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        out.push((cs.overflowX === 'visible' ? 'spills: ' : 'clipped: ') + name(el) + ' ' + words(el));
      }
      if (
        text &&
        cs.overflowY !== 'visible' &&
        !/auto|scroll/.test(cs.overflowY) &&
        el.scrollHeight > el.clientHeight + 2
      ) {
        out.push('clipped: ' + name(el) + ' ' + words(el));
      }
    }
    // A word drawn on two lines.
    const walker = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !shown(el) || readerOnly(el) || inScroller(el)) continue;
      const s = n.textContent;
      // Hyphens, slashes and dashes are places a line may break.
      for (const m of s.matchAll(/[^\s\-/–—·]{2,}/g)) {
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
  });
}

async function openDemo(page, hash) {
  await page.goto('about:blank');
  await page.goto('/s/#' + hash);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.locator('.sp-view').first().waitFor();
}

async function setSize(page, size) {
  if (size === 'normal') return;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sp-set-size[data-size="' + size + '"]').click();
  await page.locator('.sp-set-done').click();
}

const visible = (page, sel) => page.locator(sel).locator('visible=true').first();
const tab = (page, id) => visible(page, '.sp-tab[data-tab="' + id + '"]').click();

/* Each walk: a demo, and the screens reached from it, each looked at with
   `look(name)`. A step that cannot be taken fails the test: a screen that
   is not reached is not checked. */
const WALKS = [
  [
    'demo-card-feed',
    async (page, look) => {
      await look('assignments');
      await page.locator('[data-act="segment"]').nth(1).click();
      await look('upcoming');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await look('settings');
      await page.locator('.sp-set-out').click();
      await look('log out?');
    },
  ],
  [
    'demo-card-send',
    async (page, look) => {
      await tab(page, 'learning');
      await look('my learning');
      await page.locator('[data-act="feedback"]').nth(2).click();
      await look('your feedback');
      await visible(page, '[data-act="levels"]').click();
      await look('what the levels mean');
      await visible(page, '[data-act="whole"]').click();
      await look('the whole rubric');
    },
  ],
  [
    'demo-card-send',
    async (page, look) => {
      await visible(page, '[data-act="send-open"]').click();
      await look('send my work');
    },
  ],
  [
    'demo-card-revise',
    async (page, look) => {
      await look('assignments, revision');
      await tab(page, 'learning');
      await page.locator('[data-act="feedback"]').nth(1).click();
      await visible(page, '[data-act="compare"]').click();
      await look('before and after');
    },
  ],
  [
    'demo-card-both',
    async (page, look) => {
      await tab(page, 'learning');
      await look('my learning, letter and proficiency');
    },
  ],
  [
    'demo-card-letter',
    async (page, look) => {
      await tab(page, 'learning');
      await look('my learning, letter');
    },
  ],
  [
    'demo-card-group',
    async (page, look) => {
      await look('assignments, group');
      await tab(page, 'learning');
      await look('my learning, group');
    },
  ],
  [
    'demo-card-reflect',
    async (page, look) => {
      await tab(page, 'questionnaires');
      await look('reflect');
      await visible(page, '[data-act="q-start"]').click();
      await look('reflection, step 1');
      await visible(page, '[data-act="next"]').click();
      await look('reflection, step 2');
    },
  ],
  [
    'demo-card-reflect',
    async (page, look) => {
      await tab(page, 'learning');
      await page.locator('[data-act="feedback"]').first().click();
      await visible(page, '[data-act="reflect-open"]').click();
      await look('reflect on feedback');
    },
  ],
  [
    'demo-card',
    async (page, look) => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.locator('.sp-set [data-act="card-add"]').click();
      await look('add another card');
      await page.locator('#sp-code').fill('ABCD-EFGH');
      await page.getByRole('button', { name: 'Continue' }).click();
      await look('add another card, is this you');
      await page.getByLabel('Student Number').fill('1234567');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await look('settings, two classes');
    },
  ],
];

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
        test.setTimeout(90_000);
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        const found = [];
        for (const [hash, walk] of WALKS) {
          await openDemo(page, hash);
          await setSize(page, size);
          // Motion settles before each look (sheets slide in for about 220 ms).
          const look = async screen => {
            await page.waitForTimeout(300);
            for (const f of await faults(page)) found.push(screen + ' — ' + f);
          };
          await walk(page, look);
        }
        expect(found).toEqual([]);
        expect(errors).toEqual([]);
      });

      test('the tab bar holds four tabs', async ({ page }) => {
        await openDemo(page, 'demo-card');
        await setSize(page, size);
        await addFourthTab(page);
        const labels = await page.locator('.sp-tabs-bottom .sp-tab-label').evaluateAll(els =>
          els.map(el => ({
            text: el.textContent,
            fits: el.scrollWidth <= el.clientWidth + 1,
            px: getComputedStyle(el).fontSize,
          })),
        );
        expect(labels.map(l => l.text)).toEqual(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
        expect(labels.filter(l => !l.fits)).toEqual([]);
        expect((await faults(page)).filter(f => /tab/.test(f))).toEqual([]);
      });
    });
  }
}
