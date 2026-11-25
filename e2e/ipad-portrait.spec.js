import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The desktop app on an iPad held upright (teacher/tablet.css).
 *
 * Nov 14 2026: Colin found many screens clipped and overlapping on an iPad
 * in portrait: the grader's title on top of its tabs, the rubric pushed out
 * of view, the student dashboard's tabs and Learner Profile cut off at the
 * right, a score row's comment squeezed to nothing, Help squeezing the page
 * into 400 points. Each screen is walked as an iPad at the three upright
 * widths and checked for a control or a line of text that runs off the
 * screen, is cut off by its box, or sits on top of another.
 *
 * A computer must never change: it never gets html.fv-tablet, and with
 * tablet.css taken away the desktop app draws exactly the same. */

// iPadOS asks for desktop sites with a Mac's user agent; the touch points
// are what tell it from a Mac (shared/device.js).
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

async function asIpad(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, userAgent: IPAD_UA });
  await context.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  return context;
}

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

// The class's Student Page and Send Work on, so the grader shows sent work.
async function studentPageOn(page) {
  await page.goto('/dashboard?manage=student-page');
  for (const id of ['sp-build-switch', 'sp-send-switch']) {
    await page.waitForSelector('#' + id, { state: 'attached' });
    await page.evaluate(i => {
      const el = document.getElementById(i);
      if (!el.checked) el.click();
    }, id);
    await page.waitForTimeout(300);
  }
}

/* What is wrong with the screen as drawn: controls and text off the side or
   cut off by their box, and controls on top of each other in one layer. A
   box that scrolls sideways on purpose (a strip, a table, the gradebook's
   grid) is fine; one that scrolls up and down too is a page pushed wider
   than the screen. Text cut with an ellipsis is meant. */
function audit() {
  const W = document.documentElement.clientWidth;
  const H = innerHeight;
  const shown = e => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || r.top >= H || r.bottom <= 0) return null;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || +cs.opacity === 0) return null;
    // Inside a closed section: laid out, but clipped wholly out of view.
    for (let k = e.parentElement; k && k !== document.body; k = k.parentElement) {
      const kc = getComputedStyle(k);
      if (kc.overflowX === 'visible' && kc.overflowY === 'visible') continue;
      const kr = k.getBoundingClientRect();
      if (r.bottom <= kr.top || r.top >= kr.bottom || r.right <= kr.left || r.left >= kr.right) return null;
    }
    return r;
  };
  const sideways = k => {
    const cs = getComputedStyle(k);
    if (!/(auto|scroll)/.test(cs.overflowX) || k.scrollWidth <= k.clientWidth + 1) return false;
    return !/(auto|scroll)/.test(cs.overflowY) || k.matches('[class*="gb-"], [class*="table"], .cm-rs-scroll');
  };
  const onPurpose = k => sideways(k) || k.matches('.gb-grid-colheads');
  const cutBy = (e, r) => {
    for (let k = e.parentElement; k && k !== document.body; k = k.parentElement) {
      if (onPurpose(k)) return null;
      if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(k).overflowX)) {
        const kr = k.getBoundingClientRect();
        if (r.right > kr.right + 1 && r.left < kr.right) return k;
      }
    }
    return null;
  };
  const layer = e => {
    for (let k = e; k; k = k.parentElement) {
      const cs = getComputedStyle(k);
      if (cs.position === 'fixed' || cs.position === 'sticky') return k;
      if (cs.position === 'absolute' && cs.zIndex !== 'auto') return k;
    }
    return document.body;
  };
  const label = e =>
    (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);

  const problems = [];
  const controls = [
    ...document.querySelectorAll('button, a, [role=tab], input, select, textarea, h1, h2, h3, label, .seg-btn'),
  ].filter(shown);
  const texts = [...document.querySelectorAll('body *')].filter(
    e => !e.children.length && e.textContent.trim() && shown(e) && getComputedStyle(e).textOverflow !== 'ellipsis',
  );
  for (const e of new Set([...controls, ...texts])) {
    const r = shown(e);
    let inScroller = false;
    for (let k = e.parentElement; k; k = k.parentElement) if (onPurpose(k)) inScroller = true;
    if ((r.right > W + 1 || r.left < -1) && !inScroller) problems.push('off the screen: ' + label(e));
    else if (cutBy(e, r)) problems.push('cut off: ' + label(e));
  }
  const leaves = controls.filter(e => !controls.some(o => o !== e && e.contains(o)));
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.contains(b) || b.contains(a) || layer(a) !== layer(b)) continue;
      // A rubric box scrolled under the grader's foot bar is covered by it (the bar is opaque and sits above the
      // pane). That is not an overlap of two controls: it counts only if the box's own centre is not under the bar.
      if (!!a.closest('.grader-foot') !== !!b.closest('.grader-foot')) {
        const under = a.closest('.grader-foot') ? b : a;
        const u = under.getBoundingClientRect();
        const top = document.elementFromPoint(u.left + u.width / 2, u.top + u.height / 2);
        if (top && top.closest('.grader-foot')) continue;
      }
      const ra = shown(a);
      const rb = shown(b);
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ix <= 4 || iy <= 4) continue;
      const hit = document.elementFromPoint(Math.max(ra.left, rb.left) + ix / 2, Math.max(ra.top, rb.top) + iy / 2);
      if (hit && (a.contains(hit) || b.contains(hit)))
        problems.push('on top of each other: ' + label(a) + ' × ' + label(b));
    }
  }
  return [...new Set(problems)];
}

const SCREENS = [
  ['Dashboard', async page => page.goto('/dashboard')],
  [
    'Assignments, a piece open',
    async page => {
      await page.goto('/assignments');
      await page.locator('.assess-card').first().locator('.assess-header').click();
      await page.locator('.ldg-row').first().waitFor();
    },
  ],
  [
    'New Assessment',
    async page => {
      await page.goto('/assignments');
      await page.getByRole('button', { name: '+ New Assessment' }).first().click();
    },
  ],
  [
    'the grader',
    async page => {
      await page.goto('/assignments');
      await page
        .getByText(/^\d+ to grade$/)
        .first()
        .click();
      await page.locator('[data-action=gradeSubmissions]').first().click();
      await page.locator('.grader-dialog.has-work .grader-panel-col').waitFor();
    },
  ],
  ['Gradebook', async page => page.goto('/gradebook')],
  ['Observations', async page => page.goto('/observations')],
  ['Term Questionnaire', async page => page.goto('/reports')],
  [
    'Print Reports',
    async page => {
      await page.goto('/reports');
      await page.getByRole('tab', { name: 'Print Reports' }).click();
    },
  ],
  ['Class Settings, Students', async page => page.goto('/dashboard?manage=students')],
  ['Class Settings, Grading', async page => page.goto('/dashboard?manage=grading')],
  ['Class Settings, Competencies', async page => page.goto('/dashboard?manage=competencies')],
  [
    'Help',
    async page => {
      await page.goto('/dashboard');
      await page.locator('[aria-label="Help"]').first().click();
      await page.locator('#help-panel').waitFor();
    },
  ],
  ...['overview', 'comps', 'grades', 'work', 'evidence', 'profile'].map(tab => [
    'student dashboard, ' + tab,
    async page => {
      const id = await page.evaluate(() => getStudents('sci8')[0].id);
      await page.goto('/student?id=' + id + '&course=sci8');
      await page
        .locator('[data-action="stuTab"][data-tab="' + tab + '"]')
        .first()
        .click();
    },
  ]),
];

for (const [width, height, ipad] of [
  [744, 1133, 'iPad mini'],
  [820, 1180, 'iPad Air'],
  [1024, 1366, 'iPad Pro 13-inch'],
]) {
  test(`${ipad} upright (${width} wide): nothing cut off, off the side or on top of something else`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const context = await asIpad(browser, width, height);
    const page = await context.newPage();
    page.on('dialog', d => d.accept());
    await enterDemo(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('fv-tablet'))).toBe(true);
    await studentPageOn(page);
    const found = {};
    for (const [name, open] of SCREENS) {
      await open(page);
      await page.waitForTimeout(700);
      // A screen still settling can overlap for a moment: only what is
      // still wrong a second later counts.
      let problems = await page.evaluate(audit);
      if (problems.length) {
        await page.waitForTimeout(1000);
        const again = await page.evaluate(audit);
        problems = problems.filter(p => again.includes(p));
      }
      if (problems.length) found[name] = problems.slice(0, 5);
      await page.keyboard.press('Escape');
    }
    expect(found).toEqual({});
    await context.close();
  });
}

/* The Dashboard's middle row upright (DECISIONS, "The Dashboard's middle
   row"; board F): stacked, the Inbox 450 px and Competencies 520 px under
   it, nothing sideways, and every control in it a finger's size (44 px) in
   each Inbox view and on both Competencies pages, in the page's font and in
   the wide stand-in for CI's fonts (e2e/wide-font.js). */
for (const [width, height, ipad] of [
  [744, 1133, 'iPad mini'],
  [820, 1180, 'iPad Air'],
  [1024, 1366, 'iPad Pro 13-inch'],
]) {
  test(`${ipad} upright (${width} wide): the Dashboard's row stacks, and every control in it is 44 px`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await asIpad(browser, width, height);
    const page = await context.newPage();
    await enterDemo(page);
    await studentPageOn(page);
    await page.goto('/dashboard');
    await page.locator('#dash-inbox').waitFor();
    const found = {};
    for (const font of FONTS) {
      await useFont(page, font);
      for (const view of ['stacks', 'rollcall']) {
        for (const pg of ['curricular', 'core']) {
          await page.evaluate(
            ([view, pg]) => {
              localStorage.setItem('fv-dash-inbox-view:sci8', view);
              localStorage.setItem('fv-dash-comp-page:sci8', pg);
              PageDashboard.render();
            },
            [view, pg],
          );
          await page.waitForTimeout(400);
          const m = await page.evaluate(() => {
            const box = s => document.querySelector(s).getBoundingClientRect();
            const small = [
              ...document.querySelectorAll(
                '.dash-row button, .dash-row a, .dash-row [role=link], .dash-row [role=tab], .dash-row input, .dash-row select',
              ),
            ]
              .filter(e => {
                // A student's tick is 13 px wide, 12 tall: one of a row of them (28 across the tile).
                // Its row's name and the tile's other controls are the finger's size.
                if (e.matches('.dash-comp-tick')) return false;
                const r = e.getBoundingClientRect();
                const cs = getComputedStyle(e);
                return r.width && r.height && cs.visibility !== 'hidden' && Math.min(r.width, r.height) < 44 - 0.5;
              })
              .map(e => (e.textContent || e.getAttribute('aria-label') || e.className).trim().slice(0, 30));
            const inbox = box('.dash-row-inbox');
            const comp = box('.dash-row-comp');
            return {
              inbox: Math.round(inbox.height),
              comp: Math.round(comp.height),
              stacked: comp.top >= inbox.bottom + 11,
              sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              small: [...new Set(small)],
            };
          });
          if (m.inbox !== 450 || m.comp !== 520 || !m.stacked || m.sideways > 0 || m.small.length)
            found[font + '/' + view + '/' + pg] = m;
        }
      }
    }
    expect(found).toEqual({});
    await context.close();
  });
}

test('the grader on an iPad: full screen, the title clear of the tabs, the rubric in view', async ({ browser }) => {
  const context = await asIpad(browser, 820, 1180);
  const page = await context.newPage();
  await enterDemo(page);
  await studentPageOn(page);
  await page.goto('/assignments');
  await page
    .getByText(/^\d+ to grade$/)
    .first()
    .click();
  await page.locator('[data-action=gradeSubmissions]').first().click();
  const dialog = page.locator('.grader-dialog.has-work');
  await expect(dialog).toBeVisible();
  // Full screen once it has finished opening.
  await expect.poll(async () => dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 820, height: 1180 });
  const title = await page.locator('.grader-title').boundingBox();
  const tabs = await page.locator('.grader-show-seg').boundingBox();
  expect(title.y + title.height).toBeLessThanOrEqual(tabs.y);
  const rubric = await page.locator('.grader-panel-col').boundingBox();
  expect(rubric.y).toBeLessThan(1180);
  expect(rubric.width).toBeGreaterThan(700);
  await context.close();
});

test('a computer never gets the iPad layer, and draws the same without tablet.css', async ({ browser }) => {
  const shots = [];
  for (const blockTablet of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    if (blockTablet) await context.route('**/teacher/tablet.css*', r => r.fulfill({ status: 200, body: '' }));
    const page = await context.newPage();
    await enterDemo(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('fv-tablet'))).toBe(false);
    const id = await page.evaluate(() => getStudents('sci8')[0].id);
    await page.goto('/student?id=' + id + '&course=sci8');
    await page.locator('[data-action="stuTab"][data-tab="profile"]').first().click();
    await page.waitForTimeout(800);
    shots.push(await page.screenshot({ animations: 'disabled', caret: 'hide' }));
    await context.close();
  }
  expect(shots[0].equals(shots[1])).toBe(true);
});
