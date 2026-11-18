/**
 * The Inbox's Side by Side view and the assessment switch (D6 of
 * docs/plans/dashboard-inbox-plan.md; board C2), behind the dashRow switch.
 * Demo Mode, Science 8, the student page and Send Work on: Light Refraction
 * Lab has work waiting (Sofia Petrov sent two pages), Cell Microscope Lab is
 * assessed. There is no Compare view, so no Compare control.
 */
import { test, expect } from '@playwright/test';

const LIGHT = 'sci8a21';
const CELL = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForFunction(() => {
    const el = document.getElementById('app-loading');
    return !el || getComputedStyle(el).display === 'none' || +getComputedStyle(el).opacity === 0;
  });
  await page.waitForTimeout(500);
  await page.locator('#dash-inbox').screenshot({ path: SHOTS + '/' + name + '.png' });
};

async function open(page, { bulletins = false, dark = false, side = true } = {}) {
  await page.addInitScript(
    ([bulletins, side]) => {
      try {
        localStorage.setItem('fv-build-dashRow', '1');
        if (side) localStorage.setItem('fv-dash-inbox-view:sci8', 'side');
        if (bulletins) {
          localStorage.setItem('fv-build-bulletins', '1');
          window.DashBulletins = {
            html: () =>
              '<section class="dash-bulletins-stub" style="flex:1;background:var(--surface);border-radius:12px"></section>',
          };
        }
      } catch (e) {
        /* storage blocked */
      }
    },
    [bulletins, side],
  );
  if (dark) await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
  });
  await page.locator('#dash-inbox').waitFor();
  if (side) {
    // The pictures take their height from the room the tile gives the row.
    await page.waitForFunction(() =>
      document.getElementById('dash-inbox-side-row')?.style.getPropertyValue('--dash-inbox-side-h'),
    );
    await page.waitForTimeout(150);
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

// Sofia Petrov's pile, the first one in the row.
const PILE = '#dash-inbox .dash-inbox-side-pile.is-pile';
const lowerHidden = page =>
  page.locator(PILE + ' .dash-inbox-side-page:not(:first-child)').evaluateAll(els =>
    els.every(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.visibility === 'hidden' || cs.display === 'none' || (r.width === 0 && r.height === 0);
    }),
  );
// How far the next student's page stands from this pile's left edge.
const nextLeft = page =>
  page
    .locator(PILE)
    .evaluate(el => el.closest('li').nextElementSibling.getBoundingClientRect().left - el.getBoundingClientRect().left);

test.use({ viewport: { width: 1280, height: 800 } });

test('Side by Side comes from the view pill, switches the tile in place and survives a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page, { side: false });
  await expect(page.locator('.dash-inbox-row').first()).toBeVisible();
  await page.locator('#dash-view-btn-inbox').click();
  await expect(page.locator('#dash-view-menu-inbox [data-view="side"]')).toHaveCount(1); // later slices add their own views
  await expect(page.locator('#dash-view-menu-inbox')).toContainText("Each student's pages in a row, to compare.");
  await page.locator('#dash-view-menu-inbox [role="menuitemradio"]', { hasText: 'Side by Side' }).click();
  await expect(page.locator('.dash-inbox-side-row')).toBeVisible();
  await expect(page.locator('.dash-inbox-row')).toHaveCount(0);
  await expect(page.locator('#dash-inbox')).toHaveCount(1);
  await expect(page.locator('.dash-inbox-head .dash-view-btn')).toHaveText('Side by Side');
  await page.reload();
  await page.locator('#dash-inbox').waitFor();
  await expect(page.locator('.dash-inbox-side-row')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the row lists every student with work in: to grade first by arrival, then assessed, and the line under each', async ({
  page,
}) => {
  await open(page);
  const got = await page.evaluate(
    ([aid]) => {
      const cid = getActiveCourse();
      const ids = getStudents(cid).map(s => s.id);
      const c = GraderWork.workCounts(cid, aid, ids);
      return {
        shown: [...document.querySelectorAll('.dash-inbox-side-item')].map(li => ({
          sid: li.getAttribute('data-sid'),
          name: li.querySelector('.dash-inbox-side-name').textContent,
          line: li.querySelector('.dash-inbox-side-line').textContent,
        })),
        inIds: GraderWork.workInIds(cid, aid, ids),
        members: DashInboxSide.model(cid, aid).items.flatMap(i => i.members),
        notIn: c.notin,
        foot: document.querySelector('.dash-inbox-side-foot').textContent,
      };
    },
    [LIGHT],
  );
  // A pair is one item; every student with work in is a member of one.
  expect([...got.members].sort()).toEqual([...got.inIds].sort());
  expect(got.shown.length).toBe(got.inIds.length - 1);
  await expect(page.locator('.dash-inbox-side-name', { hasText: 'Aiden Singh and Olivia Tam' })).toHaveCount(1);
  got.shown.forEach(s => expect(s.line).toMatch(/ · (To Grade|Assessed)/));
  expect(got.foot).toBe('To grade first, then assessed. ' + got.notIn + ' not in yet.');
  await expect(page.locator('.dash-inbox-side-line', { hasText: /^Late · / })).toHaveCount(1);
  // The word Late is said, and only the word is amber.
  await expect(page.locator('.dash-inbox-side-line .dash-inbox-late')).toHaveText('Late');
  await expect(page.locator('#dash-inbox')).not.toContainText(/Compare 2|picked/);
  await expect(page.getByRole('button', { name: /compare/i })).toHaveCount(0);
});

test('the switch changes the piece, is kept, and a pressed button says so', async ({ page }) => {
  await open(page);
  const btns = page.locator('.dash-inbox-pick-btn');
  await expect(btns).toHaveCount(2);
  await expect(btns.nth(0)).toHaveText(/^Light Refraction Lab · \d+ In$/);
  await expect(btns.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(btns.nth(1)).toHaveAttribute('aria-pressed', 'false');
  const first = await page.locator('.dash-inbox-side-item').count();
  await btns.nth(1).click();
  await expect(page.locator('.dash-inbox-pick-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dash-inbox-side-row')).toHaveAttribute('aria-label', 'Work in for Cell Microscope Lab');
  expect(await page.locator('.dash-inbox-side-item').count()).not.toBe(first);
  expect(await page.evaluate(() => localStorage.getItem('fv-dash-inbox-piece:' + getActiveCourse()))).toBe(CELL);
  // Arrow keys move between the switch's buttons.
  await page.locator('.dash-inbox-pick-btn').nth(1).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.dash-inbox-pick-btn').nth(0)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-inbox-pick-btn').nth(0)).toHaveAttribute('aria-pressed', 'true');
  // The redraw gives the focus back to the pressed button (Enter, then a click).
  await expect(page.locator('.dash-inbox-pick-btn').nth(0)).toBeFocused();
  await page.locator('.dash-inbox-pick-btn').nth(1).click();
  await expect(page.locator('.dash-inbox-pick-btn').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dash-inbox-pick-btn').nth(1)).toBeFocused();
});

test('after the grader closes the focus returns to the page that was clicked, and a pile gathers if the pointer is away', async ({
  page,
}) => {
  await open(page);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .hover();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  await expect.poll(async () => (await box(page, PILE)).width).toBeGreaterThan(200);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .nth(1)
    .click();
  await expect(page.locator('.grader-dialog')).toBeVisible();
  // The pointer leaves while the grader is open; it is closed with a click on Done.
  await page.mouse.move(5, 5);
  await page.locator('.grader-done').click();
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await page.mouse.move(5, 5);
  await expect(page.locator(PILE)).not.toHaveClass(/is-open/);
  await expect.poll(() => lowerHidden(page)).toBe(true);
  // The focus is not lost to the page body.
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
});

test('after a mouse click on a page and Escape in the grader, a pile with the pointer away gathers', async ({
  page,
}) => {
  await open(page);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .hover();
  await expect.poll(async () => (await box(page, PILE)).width).toBeGreaterThan(200);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .nth(1)
    .click();
  await expect(page.locator('.grader-dialog')).toBeVisible();
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await expect(page.locator(PILE)).not.toHaveClass(/is-open/);
  await expect.poll(() => lowerHidden(page)).toBe(true);
  expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
});

test('the focus returns to the second page of a pile when the grader closes from the keyboard', async ({ page }) => {
  await open(page);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(PILE + ' .dash-inbox-side-page').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.grader-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await expect(page.locator(PILE + ' .dash-inbox-side-page').nth(1)).toBeFocused();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
});

test('the default piece is the first with work to grade', async ({ page }) => {
  await open(page);
  // Cell Microscope Lab gets the newest work, all assessed: the switch still opens on Light Refraction Lab.
  await page.evaluate(() => {
    localStorage.removeItem('fv-dash-inbox-piece:' + getActiveCourse());
    const cid = getActiveCourse();
    const work = getCourseSubmissions(cid);
    work.submissions.forEach(s => {
      if (s.assessment_id === 'sci8a1') s.sent_at = '2030-01-01T10:00:00Z';
    });
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
  });
  await expect(page.locator('.dash-inbox-pick-btn').nth(0)).toHaveText(/^Cell Microscope Lab/);
  await expect(page.locator('.dash-inbox-pick-btn[aria-pressed="true"]')).toHaveText(/^Light Refraction Lab/);
});

test('a pile spreads on hover and pushes the others along, and gathers when left', async ({ page }) => {
  await open(page);
  await expect(page.locator(PILE + ' .dash-inbox-side-count')).toHaveText('2 pages');
  expect(await lowerHidden(page)).toBe(true);
  const w0 = (await box(page, PILE)).width;
  const next0 = await nextLeft(page);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .hover();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  await expect.poll(async () => (await box(page, PILE)).width).toBeGreaterThan(w0 * 1.9);
  await expect.poll(() => nextLeft(page)).toBeGreaterThan(next0 + w0 * 0.9);
  expect(await lowerHidden(page)).toBe(false);
  await shot(page, 'side-open-light');
  await page.mouse.move(5, 5);
  await expect(page.locator(PILE)).not.toHaveClass(/is-open/);
  await expect.poll(() => lowerHidden(page)).toBe(true);
  // Back to a closed pile's width, within a few px the row's own sizing may move it (4 wide, 6 for the next page).
  await expect.poll(async () => Math.abs((await box(page, PILE)).width - w0)).toBeLessThanOrEqual(4);
  await expect.poll(async () => Math.abs((await nextLeft(page)) - next0)).toBeLessThanOrEqual(6);
});

test('a pile spreads on focus and gathers on Escape and when the focus leaves', async ({ page }) => {
  await open(page);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .focus();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  // The second page is reachable from the keyboard.
  await page.keyboard.press('Tab');
  await expect(page.locator(PILE + ' .dash-inbox-side-page').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(PILE)).not.toHaveClass(/is-open/);
  await expect(page.locator(PILE + ' .dash-inbox-side-page').first()).toBeFocused();
  await expect.poll(() => lowerHidden(page)).toBe(true);
  // Leaving and coming back spreads it again; Tab through both pages and out gathers it.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator(PILE)).not.toHaveClass(/is-open/);
});

test('with reduced motion a pile spreads with no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  // The app's reduced-motion rule makes every transition 0.01 ms; no delay is left.
  const t = await page.locator(PILE).evaluate(el =>
    [el, ...el.querySelectorAll('.dash-inbox-side-page')].map(e => {
      const cs = getComputedStyle(e);
      return [cs.transitionDuration, cs.transitionDelay];
    }),
  );
  t.forEach(([d, delay]) => {
    expect(d.split(',').every(x => parseFloat(x) < 0.001)).toBe(true);
    expect(delay.split(',').every(x => parseFloat(x) === 0)).toBe(true);
  });
  const w0 = (await box(page, PILE)).width;
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .focus();
  // At once: no frames in between.
  const w1 = (await box(page, PILE)).width;
  expect(w1).toBeGreaterThan(w0 * 1.9);
  expect(await lowerHidden(page)).toBe(false);
});

test('a click on a page opens the grader on that student, in the row order', async ({ page }) => {
  await open(page);
  const li = page.locator('.dash-inbox-side-item').nth(2);
  const name = await li.locator('.dash-inbox-side-name').textContent();
  await li.locator('.dash-inbox-side-page').first().click();
  await expect(page.locator('.grader-dialog')).toBeVisible();
  await expect(page.locator('.grader-student')).toContainText(name.split(' ')[0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await expect(page.locator('#dash-inbox .dash-inbox-side-row')).toBeVisible();
  // Enter does the same from the keyboard.
  await page.locator('.dash-inbox-side-item').nth(0).locator('.dash-inbox-side-page').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.grader-dialog')).toBeVisible();
});

test('a 13-page pile spreads, scrolls with the row, and asks only for pictures near view', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const work = getCourseSubmissions(cid);
    const subs = work.submissions.filter(s => s.assessment_id === 'sci8a21' && (s.files || []).length > 1);
    const s = subs[0];
    const base = s.files[0];
    s.files = Array.from({ length: 13 }, (_, i) => Object.assign({}, base, { id: 'many' + i, page: i + 1 }));
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
  });
  await expect(page.locator(PILE + ' .dash-inbox-side-count')).toHaveText('13 pages');
  const row = page.locator('#dash-inbox-side-row');
  // Focus keeps the pile open while the row scrolls from under the pointer.
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .focus();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  await expect.poll(async () => (await box(page, PILE)).width).toBeGreaterThan(1000);
  // The row scrolls; the page does not.
  const m = await row.evaluate(el => ({ over: el.scrollWidth - el.clientWidth }));
  expect(m.over).toBeGreaterThan(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0,
  );
  // Not every page was asked for: those far to the right wait for the scroll.
  const loaded = () => page.locator(PILE + ' img').evaluateAll(imgs => imgs.filter(i => i.getAttribute('src')).length);
  await expect.poll(loaded).toBeGreaterThan(0);
  const before = await loaded();
  expect(before).toBeLessThan(13);
  await row.evaluate(el => (el.scrollLeft = el.scrollWidth));
  await expect.poll(loaded).toBeGreaterThan(before);
});

test('a redraw keeps the open pile and the scroll, and asks for no picture twice', async ({ page }) => {
  await open(page);
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .focus();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  const imgs = page.locator('#dash-inbox .dash-inbox-side-img');
  await expect
    .poll(async () => imgs.evaluateAll(a => a.filter(i => i.complete && i.naturalWidth > 0).length))
    .toBeGreaterThan(0);
  await page.locator('#dash-inbox-side-row').evaluate(el => (el.scrollLeft = 120));
  await page.evaluate(() => {
    window.__asked = 0;
    const was = window.openStudentWorkPage;
    window.openStudentWorkPage = function () {
      window.__asked++;
      return was.apply(this, arguments);
    };
    PageDashboard.render();
    PageDashboard.render();
  });
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  expect(await page.locator('#dash-inbox-side-row').evaluate(el => el.scrollLeft)).toBe(120);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__asked)).toBe(0);
});

test('at the full column and at 299 px every picture is 80 px or more and nothing scrolls the page sideways', async ({
  page,
}) => {
  await open(page);
  const measure = () =>
    page.evaluate(() => {
      const row = document.getElementById('dash-inbox-side-row');
      const tile = document.getElementById('dash-inbox').getBoundingClientRect();
      const pages = [...document.querySelectorAll('#dash-inbox .dash-inbox-side-page')]
        .filter(p => getComputedStyle(p).visibility !== 'hidden')
        .map(p => p.getBoundingClientRect().height);
      const rb = row.getBoundingClientRect();
      const caps = [...document.querySelectorAll('.dash-inbox-side-line')].map(l => l.getBoundingClientRect().bottom);
      return {
        tile: Math.round(tile.height),
        pages,
        rowBottom: rb.bottom,
        lastCaption: Math.max(...caps),
        sideways: [
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.getElementById('main').scrollWidth - document.getElementById('main').clientWidth,
        ],
        tileOver:
          document.getElementById('dash-inbox').scrollHeight - document.getElementById('dash-inbox').clientHeight,
      };
    });
  const full = await measure();
  expect(full.tile).toBe(510);
  expect(full.pages.length).toBeGreaterThan(0);
  full.pages.forEach(h => expect(h).toBeGreaterThanOrEqual(80));
  expect(full.sideways).toEqual([0, 0]);
  expect(full.lastCaption).toBeLessThanOrEqual(full.rowBottom + 0.5);
  expect(full.tileOver).toBeLessThanOrEqual(0);
  await page.locator(PILE).evaluate(el => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await expect(page.locator(PILE + ' img').first()).toHaveAttribute('src', /./);
  // A closed pile asks for its top page alone.
  await expect(page.locator(PILE + ' img').nth(1)).not.toHaveAttribute('src', /./);
  await shot(page, 'side-closed-510-light');
  console.log('full column page height', Math.min(...full.pages));
});

test('beside Bulletins the Inbox is 299 px and the pictures are 80 px or more', async ({ page }) => {
  await open(page, { bulletins: true });
  const m = await page.evaluate(() => {
    const tile = document.getElementById('dash-inbox');
    const row = document.getElementById('dash-inbox-side-row');
    const pages = [...document.querySelectorAll('#dash-inbox .dash-inbox-side-page')].map(
      p => p.getBoundingClientRect().height,
    );
    const rb = row.getBoundingClientRect();
    const lines = [...document.querySelectorAll('.dash-inbox-side-line')].map(l => l.getBoundingClientRect().bottom);
    return {
      tile: Math.round(tile.getBoundingClientRect().height),
      pages,
      captionsInside: Math.max(...lines) <= rb.bottom + 0.5,
      tileOver: tile.scrollHeight - tile.clientHeight,
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(m.tile).toBe(299);
  m.pages.forEach(h => expect(h).toBeGreaterThanOrEqual(80));
  expect(m.captionsInside).toBe(true);
  expect(m.tileOver).toBeLessThanOrEqual(0);
  expect(m.sideways).toBe(0);
  console.log('299 px page height', Math.min(...m.pages));
  await shot(page, 'side-closed-299-light');
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .hover();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  await shot(page, 'side-open-299-light');
});

test('dark: a closed and an open pile', async ({ page }) => {
  await open(page, { dark: true });
  await page.locator(PILE).evaluate(el => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
  await expect(page.locator(PILE + ' img').first()).toHaveAttribute('src', /./);
  // A closed pile asks for its top page alone.
  await expect(page.locator(PILE + ' img').nth(1)).not.toHaveAttribute('src', /./);
  await shot(page, 'side-closed-510-dark');
  await page
    .locator(PILE + ' .dash-inbox-side-page')
    .first()
    .hover();
  await expect(page.locator(PILE)).toHaveClass(/is-open/);
  await shot(page, 'side-open-dark');
  const bg = await page.locator('#dash-inbox').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });
  test('the first tap spreads a pile and a tap on a page acts; a tap elsewhere gathers', async ({ page }) => {
    await open(page);
    await page
      .locator(PILE + ' .dash-inbox-side-page')
      .first()
      .tap();
    await expect(page.locator(PILE)).toHaveClass(/is-open/);
    await expect(page.locator('.grader-dialog')).toHaveCount(0);
    await page.locator('.dash-inbox-side-pile.is-pile .dash-inbox-side-page').first().tap();
    await expect(page.locator('.grader-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.grader-dialog')).toHaveCount(0);
    // With no pointer over it, the pile is gathered when the grader closes; a tap spreads it again.
    await expect(page.locator(PILE)).not.toHaveClass(/is-open/);
    await page
      .locator(PILE + ' .dash-inbox-side-page')
      .first()
      .tap();
    await expect(page.locator(PILE)).toHaveClass(/is-open/);
    await expect(page.locator('.grader-dialog')).toHaveCount(0);
    await page.locator('.dash-inbox-side-foot').tap();
    await expect(page.locator(PILE)).not.toHaveClass(/is-open/);
  });
});
