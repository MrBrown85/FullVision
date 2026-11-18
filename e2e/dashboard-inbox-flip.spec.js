/**
 * The Inbox's Flip Through view (D7 of docs/plans/dashboard-inbox-plan.md).
 * Demo Mode, Science 8, the student page and Send
 * Work on. The first piece with work in is Cell Microscope Lab: ten students,
 * Noor Al-Rashid (third) and Fatima Hassan (ninth, late) with two pages,
 * Mateo Cruz added by the teacher, Ethan Dubois on paper.
 */
import { test, expect } from '@playwright/test';

const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForFunction(() => {
    const el = document.getElementById('app-loading');
    return !el || getComputedStyle(el).display === 'none' || +getComputedStyle(el).opacity === 0;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
};

async function open(page, { bulletins = false, dark = false, piece = 'sci8a1', view = true, touch = false } = {}) {
  // A touch device answers (pointer: coarse); the desktop browser here does not.
  if (touch)
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = q =>
        /pointer:\s*coarse/.test(q)
          ? {
              matches: true,
              media: q,
              addEventListener() {},
              removeEventListener() {},
              addListener() {},
              removeListener() {},
            }
          : real(q);
    });
  await page.addInitScript(() => {
    // Every wheel listener added to an element, with whether it is passive.
    window.__wheelListeners = [];
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (type === 'wheel') {
        const passive = !!(opts && typeof opts === 'object' && opts.passive);
        window.__wheelListeners.push({ passive, el: this.id || this.className || String(this) });
      }
      return add.call(this, type, fn, opts);
    };
  });
  await page.addInitScript(
    ([bulletins, piece]) => {
      try {
        if (bulletins) {
          localStorage.setItem('fv-build-bulletins', '1');
          // A stand-in for the Bulletins tile, which is built apart from the Inbox.
          window.DashBulletins = {
            html: () =>
              '<section class="dash-bulletins-stub" style="flex:1;background:var(--surface);border-radius:12px"></section>',
          };
        }
        // The piece the switch has kept for this class: Cell Microscope Lab unless a test says none.
        if (piece) localStorage.setItem('fv-dash-inbox-piece:sci8', piece);
      } catch (e) {
        /* storage blocked */
      }
    },
    [bulletins, piece],
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
  if (view) await choose(page);
}

async function choose(page) {
  await page.locator('#dash-view-btn-inbox').click();
  await page.locator('#dash-view-menu-inbox [data-view="flip"]').click();
  await expect(page.locator('#dash-view-btn-inbox')).toHaveText('Flip Through');
  await expect(page.locator('.dash-inbox-flip-stage')).toBeVisible();
}

const box = (page, sel) =>
  page
    .locator(sel)
    .first()
    .evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });

// A point on a turned page that nothing in front of it covers, as a hand would find it.
async function visiblePoint(page, who) {
  const at = await page.evaluate(who => {
    const b = [...document.querySelectorAll('.dash-inbox-flip-pg')].find(x => x.getAttribute('aria-label') === who);
    const r = b.getBoundingClientRect();
    for (let f = 0.99; f > 0; f -= 0.01) {
      const x = r.left + r.width * f;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit.closest('.dash-inbox-flip-pg') === b) return { x, y };
    }
    return null;
  }, who);
  expect(at).not.toBeNull();
  return at;
}

const name = page => page.locator('.dash-inbox-flip-name');
const settle = page => page.waitForTimeout(320);

test.use({ viewport: { width: 1280, height: 800 } });

test('Flip Through is in the view pill, switches the tile in place, and survives a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page, { view: false });
  await expect(page.locator('#dash-inbox')).toBeVisible();
  await expect(page.locator('.dash-inbox-row').first()).toBeVisible();
  await page.locator('#dash-view-btn-inbox').click();
  const item = page.locator('#dash-view-menu-inbox [data-view="flip"]');
  await expect(item).toContainText("One student's work at a time, large.");
  await item.click();
  await expect(page.locator('.dash-inbox-row')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-flip-stage')).toBeVisible();
  await expect(page.locator('#dash-inbox')).toHaveCount(1);
  await page.reload();
  await page.locator('.dash-inbox-flip-stage').waitFor();
  await expect(page.locator('#dash-view-btn-inbox')).toHaveText('Flip Through');
  expect(errors).toEqual([]);
});

test('the stage lists the work in, to grade first then assessed, each a button with a name', async ({ page }) => {
  await open(page);
  const got = await page.evaluate(() => {
    const cid = getActiveCourse();
    const list = DashInboxFlip.entries(cid, DashInboxFlip.chosen(cid, DashInbox.model()));
    return {
      names: list.map(e => e.name),
      buttons: [...document.querySelectorAll('.dash-inbox-flip-pg')].map(b => b.getAttribute('aria-label')),
      count: GraderWork.workInIds(
        cid,
        list[0].aid,
        getStudents(cid).map(s => s.id),
      ).length,
    };
  });
  expect(got.names.length).toBe(got.count);
  // The centre's name carries what its click does; the others are the name alone.
  expect(got.buttons[0]).toBe(got.names[0] + ', Open in Grader');
  expect(got.buttons.slice(1)).toEqual(got.names.slice(1));
  await expect(name(page)).toHaveText(got.names[0]);
});

test('arrows, a click on a side page, and the slider each move the centre, and the caption follows', async ({
  page,
}) => {
  await open(page);
  const names = await page.evaluate(() => {
    const cid = getActiveCourse();
    return DashInboxFlip.entries(cid, DashInboxFlip.chosen(cid, DashInbox.model())).map(e => e.name);
  });
  const stage = page.locator('.dash-inbox-flip-stage');
  const slider = page.locator('.dash-inbox-flip-slider');
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText(names[1]);
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText(names[2]);
  await page.keyboard.press('ArrowLeft');
  await expect(name(page)).toHaveText(names[1]);
  // Clamped at the first.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(name(page)).toHaveText(names[0]);
  await expect(slider).toHaveAttribute('aria-label', 'Student 1 of ' + names.length);
  // A side page, by its name.
  await settle(page);
  const at = await visiblePoint(page, names[3]);
  await page.mouse.click(at.x, at.y);
  await expect(name(page)).toHaveText(names[3]);
  await expect(slider).toHaveValue('3');
  await expect(slider).toHaveAttribute('aria-label', 'Student 4 of ' + names.length);
  // The slider.
  await slider.fill('6');
  await expect(name(page)).toHaveText(names[6]);
  await expect(page.locator('.dash-inbox-flip-pg.is-centre')).toHaveAttribute('data-flip-i', '6');
  // Clamped at the last.
  await stage.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText(names[names.length - 1]);
});

test('up and down turn through a two-page student, stopping at the first and the last', async ({ page }) => {
  await open(page);
  const stage = page.locator('.dash-inbox-flip-stage');
  // Noor Al-Rashid has two pages.
  await page.locator('.dash-inbox-flip-slider').fill('2');
  await expect(name(page)).toHaveText('Noor Al-Rashid');
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 1 of 2');
  const src = () =>
    page.locator('.dash-inbox-flip-pg.is-centre [data-flip-part="page"]:not([hidden])').getAttribute('data-flip-pic');
  const first = await src();
  await stage.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 2 of 2');
  expect(await src()).not.toBe(first);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 2 of 2');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 1 of 2');
  expect(await src()).toBe(first);
  // The control under the page does the same.
  await page.getByRole('button', { name: 'Next Page' }).click();
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 2 of 2');
  await expect(page.getByRole('button', { name: 'Next Page' })).toHaveAttribute('aria-disabled', 'true');
  await page.getByRole('button', { name: 'Previous Page' }).click();
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 1 of 2');
  // A student with one page has no control, and Down does not trap the page.
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText('Liam Chen');
  await expect(page.locator('.dash-inbox-flip-pager')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-flip-meta')).toContainText('1 page');
  await shot(page, 'flip-299-pages');
});

test('the caption says what is true of the student', async ({ page }) => {
  await open(page);
  const slider = page.locator('.dash-inbox-flip-slider');
  const meta = page.locator('.dash-inbox-flip-meta');
  await slider.fill('6');
  await expect(name(page)).toHaveText('Mateo Cruz');
  await expect(meta).toContainText('Added by You');
  await expect(meta).not.toContainText('Late');
  await slider.fill('7');
  await expect(name(page)).toHaveText('Ethan Dubois');
  await expect(meta).toContainText('On Paper');
  // A paper hand-in with no scan is a lined sheet with the name on it.
  const sheet = page.locator('.dash-inbox-flip-pg.is-centre .dash-inbox-flip-sheet');
  await expect(sheet).toContainText('Ethan Dubois');
  await expect(sheet).toContainText('Handed In on Paper');
  await slider.fill('8');
  await expect(name(page)).toHaveText('Fatima Hassan');
  await expect(meta).toContainText('Late');
  await expect(page.locator('.dash-inbox-flip-open')).toHaveText('Open in Grader');
});

test('with no piece kept the first piece with work to grade shows, to grade first', async ({ page }) => {
  await open(page, { piece: null });
  await page.locator('.dash-inbox-flip-stage').waitFor();
  const got = await page.evaluate(() => {
    const cid = getActiveCourse();
    const list = DashInboxFlip.entries(cid, 'sci8a21');
    return list.map(e => [e.name, e.waiting]);
  });
  const firstDone = got.findIndex(x => !x[1]);
  expect(got.length).toBeGreaterThan(0);
  expect(got[0][1]).toBe(true);
  if (firstDone >= 0) expect(got.slice(firstDone).every(x => !x[1])).toBe(true);
  await expect(name(page)).toHaveText(got[0][0]);
  await expect(page.locator('.dash-inbox-flip-open')).toHaveText('Open in Grader');
});

test('the centre page, its button and Enter open the grader on that student', async ({ page }) => {
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('1');
  const who = await name(page).textContent();
  await page.locator('.dash-inbox-flip-pg.is-centre').click();
  await expect(page.locator('.grader-dialog')).toBeVisible();
  await expect(page.locator('.grader-student')).toContainText(who.split(' ')[0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  // The caption's button, and the tile is back as it was.
  await expect(name(page)).toHaveText(who);
  await page.locator('.dash-inbox-flip-open').click();
  await expect(page.locator('.grader-student')).toContainText(who.split(' ')[0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await page.locator('.dash-inbox-flip-stage').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.grader-student')).toContainText(who.split(' ')[0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
});

test('a redraw keeps the centred student and the page, and asks for no picture twice', async ({ page }) => {
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('2');
  await page.locator('.dash-inbox-flip-stage').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 2 of 2');
  const pics = page.locator('#dash-inbox .dash-inbox-flip-img');
  await expect
    .poll(async () => pics.evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length))
    .toBeGreaterThan(2);
  await page.evaluate(() => {
    window.__asked = 0;
    const was = window.openStudentWorkPage;
    window.openStudentWorkPage = function () {
      window.__asked++;
      return was.apply(this, arguments);
    };
  });
  await page.evaluate(() => {
    PageDashboard.render();
    PageDashboard.render();
  });
  await expect(name(page)).toHaveText('Noor Al-Rashid');
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 2 of 2');
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('2');
  // The stage kept its focus, and every picture is back without a request.
  await expect(page.locator('.dash-inbox-flip-stage')).toBeFocused();
  await expect
    .poll(async () => pics.evaluateAll(imgs => imgs.filter(i => i.getAttribute('src')).length))
    .toBe(await pics.count());
  expect(await page.evaluate(() => window.__asked)).toBe(0);
});

test('a sideways scroll moves one page a gesture; a vertical one scrolls the page', async ({ page }) => {
  await open(page);
  const stage = await box(page, '.dash-inbox-flip-stage');
  await page.mouse.move(stage.left + stage.width / 2, stage.top + stage.height / 2);
  // A flurry of sideways events, a trackpad's swipe and its tail, is one page.
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(30, 0);
    await page.waitForTimeout(15);
  }
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('1');
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 0);
  // Quiet, then another gesture: one more.
  await page.mouse.wheel(-120, 0);
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('0');
  await page.waitForTimeout(300);
  // A vertical wheel over the stage is not stopped: the page scrolls and nothing moves.
  const scrolled = () =>
    page.evaluate(() => {
      const main = document.getElementById('main');
      return Math.max(window.scrollY, main ? main.scrollTop : 0);
    });
  const before = await scrolled();
  const wheelEvents = await page.evaluate(() => {
    window.__wheel = [];
    document.addEventListener('wheel', e => window.__wheel.push(e.defaultPrevented), { passive: true });
    return true;
  });
  expect(wheelEvents).toBe(true);
  await page.mouse.wheel(0, 300);
  await expect.poll(scrolled).toBeGreaterThan(before);
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('0');
  expect(await page.evaluate(() => window.__wheel.some(Boolean))).toBe(false);
});

test('the only non-passive wheel listener is the stage, and a sideways wheel is prevented, a vertical one not', async ({
  page,
}) => {
  await open(page);
  const got = await page.evaluate(() => window.__wheelListeners.filter(l => !l.passive).map(l => String(l.el)));
  // The tile and everything else of the Inbox add no listener that can hold a scroll; the stage's does.
  expect(got.filter(el => el.includes('dash-inbox') && !el.includes('dash-inbox-flip-stage'))).toEqual([]);
  const prevented = await page.evaluate(() => {
    const stage = document.querySelector('.dash-inbox-flip-stage');
    const fire = (dx, dy) => {
      const e = new WheelEvent('wheel', { deltaX: dx, deltaY: dy, bubbles: true, cancelable: true });
      stage.dispatchEvent(e);
      return e.defaultPrevented;
    };
    return { side: fire(60, 4), vertical: fire(2, 80), diagonal: fire(10, 30) };
  });
  expect(prevented).toEqual({ side: true, vertical: false, diagonal: false });
  // And the vertical ones moved no stop (the sideways one moved one).
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('1');
});

test('arrow keys work after a click on a page, and after the grader closes with focus on the centre page', async ({
  page,
}) => {
  await open(page);
  const names = await page.evaluate(() => {
    const cid = getActiveCourse();
    return DashInboxFlip.entries(cid, DashInboxFlip.chosen(cid)).map(e => e.name);
  });
  await settle(page);
  const at = await visiblePoint(page, names[2]);
  await page.mouse.click(at.x, at.y);
  await expect(name(page)).toHaveText(names[2]);
  // Focus is on a page now, not the stage.
  expect(await page.evaluate(() => document.activeElement.className)).toContain('dash-inbox-flip-pg');
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText(names[3]);
  await page.keyboard.press('ArrowLeft');
  await expect(name(page)).toHaveText(names[2]);
  // The slider and the page control keep their own arrow keys.
  await page.locator('.dash-inbox-flip-slider').focus();
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText(names[3]);
  // Open the grader from the centre page; on close arrows still move the stage.
  await page.locator('.dash-inbox-flip-pg.is-centre').click();
  await expect(page.locator('.grader-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-flip-pg.is-centre')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText(names[4]);
});

test('a flip rebuilds no page, and asks for no picture it holds again', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__asks = [];
    const was = window.openStudentWorkPage;
    window.openStudentWorkPage = function (cid, file, which) {
      window.__asks.push(file.id + '|' + which);
      return was.apply(this, arguments);
    };
  });
  const slider = page.locator('.dash-inbox-flip-slider');
  const stage = page.locator('.dash-inbox-flip-stage');
  await slider.fill('4');
  await settle(page);
  await expect
    .poll(async () =>
      page.locator('#dash-inbox .dash-inbox-flip-img').evaluateAll(i => i.filter(x => x.complete).length),
    )
    .toBeGreaterThan(8);
  // Mark every img; one step must leave all but the few that changed role.
  await page.evaluate(() => document.querySelectorAll('.dash-inbox-flip-img').forEach(i => (i.__old = true)));
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await settle(page);
  const fresh = await page.evaluate(
    () => [...document.querySelectorAll('.dash-inbox-flip-img')].filter(i => !i.__old).length,
  );
  expect(fresh).toBeLessThanOrEqual(3);
  // One step forward and back asks for nothing it asked for before.
  const before = await page.evaluate(() => window.__asks.length);
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  expect(await page.evaluate(() => window.__asks.length)).toBe(before);
});

test('ten flips across the pile ask for each picture once', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.__asks = [];
    const was = window.openStudentWorkPage;
    window.openStudentWorkPage = function (cid, file, which) {
      window.__asks.push(file.id + '|' + which);
      return was.apply(this, arguments);
    };
  });
  const stage = page.locator('.dash-inbox-flip-stage');
  // Drawn again from nothing, so the first look is part of the count.
  await page.evaluate(() => PageDashboard.render());
  await stage.focus();
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(80);
  }
  await settle(page);
  const asks = await page.evaluate(() => window.__asks);
  expect(asks.length).toBeGreaterThan(5);
  expect(new Set(asks).size).toBe(asks.length);
});

test('after grading, the stage stays at the same place, so the next student to grade is centred', async ({ page }) => {
  await open(page, { piece: 'sci8a21' });
  const names = await page.evaluate(() => DashInboxFlip.entries(getActiveCourse(), 'sci8a21').map(e => e.name));
  expect(names.length).toBeGreaterThan(3);
  await page.locator('.dash-inbox-flip-slider').fill('1');
  await expect(name(page)).toHaveText(names[1]);
  await page.locator('.dash-inbox-flip-open').click();
  await expect(page.locator('.grader-dialog')).toBeVisible();
  // The student just opened is graded under the dialog, so they leave the to-grade order.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const e = DashInboxFlip.entries(cid, 'sci8a21')[1];
    saveScoreComment(cid, e.sid, 'sci8a21', 'Good work.');
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await expect(name(page)).toHaveText(names[2]);
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('1');
  await expect(page.locator('.dash-inbox-flip-open')).toBeFocused();
});

test('every stop is in a list for a screen reader, and an item moves the stage', async ({ page }) => {
  await open(page);
  const names = await page.evaluate(() => DashInboxFlip.entries(getActiveCourse(), 'sci8a1').map(e => e.fullName));
  const list = page.getByRole('list', { name: 'Work sent' });
  await expect(list.getByRole('listitem')).toHaveCount(names.length);
  await expect(list.getByRole('button').nth(8)).toContainText('Fatima Hassan');
  await expect(list.getByRole('button').nth(8)).toContainText('late, 2 pages');
  await list
    .getByRole('button')
    .nth(8)
    .evaluate(b => b.click());
  await expect(name(page)).toHaveText('Fatima Hassan');
  // Out of sight, but not by display: a screen reader reaches it, a sighted eye does not.
  const r = await list.evaluate(el => {
    const b = el.getBoundingClientRect();
    return [b.width, b.height, getComputedStyle(el).display];
  });
  expect(r[0]).toBeLessThanOrEqual(1);
  expect(r[1]).toBeLessThanOrEqual(1);
});

test('the caption button is the secondary Open in Grader, and the slider has a 24 px hit area', async ({ page }) => {
  await open(page);
  const btn = page.locator('.dash-inbox-flip-open');
  await expect(btn).toHaveText('Open in Grader');
  const bg = await btn.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(0, 122, 255)');
  const h = await page.locator('.dash-inbox-flip-slider').evaluate(el => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(24);
});

test('a swipe moves one page', async ({ page }) => {
  await open(page);
  const s = await box(page, '.dash-inbox-flip-stage');
  const y = s.top + s.height / 2;
  await page.mouse.move(s.left + 500, y);
  await page.mouse.down();
  await page.mouse.move(s.left + 400, y, { steps: 6 });
  await page.mouse.move(s.left + 250, y, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('1');
});

test('off the stage means out of sight and out of the tab order', async ({ page }) => {
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('0');
  await settle(page);
  const got = await page.evaluate(() => {
    const w = window.DashInboxFlip.WINDOW;
    return [...document.querySelectorAll('.dash-inbox-flip-pg')].map((b, i) => {
      const cs = getComputedStyle(b);
      return { i, hidden: cs.visibility === 'hidden', tab: b.tabIndex, off: b.classList.contains('is-off'), w };
    });
  });
  expect(got.length).toBeGreaterThan(6);
  got.forEach(g => {
    expect(g.tab).toBe(-1);
    expect(g.hidden).toBe(g.i > g.w);
    expect(g.off).toBe(g.i > g.w);
  });
  // Tab visits the view pill's neighbours, the stage, the caption's button and the slider; no page.
  await page.locator('.dash-inbox-flip-stage').focus();
  const order = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement.className));
  }
  expect(order[0]).toContain('dash-inbox-flip-open');
  expect(order[1]).toContain('dash-inbox-flip-slider');
  expect(order.some(c => c.includes('dash-inbox-flip-pg'))).toBe(false);
  // Pictures only for the pages on the stage.
  const imgs = await page.locator('#dash-inbox .dash-inbox-flip-img').count();
  // A thumbnail for each page on the stage, the whole page over three.
  expect(imgs).toBeLessThanOrEqual(6 + 3);
});

test('the centre and one stop each side show the whole page over a thumbnail, the rest a thumbnail', async ({
  page,
}) => {
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('3');
  await settle(page);
  const pics = page.locator('#dash-inbox .dash-inbox-flip-img');
  await expect
    .poll(async () => pics.evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length))
    .toBeGreaterThan(8);
  const got = await page.evaluate(() =>
    [...document.querySelectorAll('.dash-inbox-flip-pg')].map((b, i) => {
      const t = b.querySelector('[data-flip-part="thumb"]:not([hidden])');
      const p = b.querySelector('[data-flip-part="page"]:not([hidden])');
      return {
        i,
        sheet: !!b.querySelector('[data-flip-id="sheet"]'),
        centre: b.classList.contains('is-centre'),
        thumb: t ? t.currentSrc : '',
        page: p ? p.currentSrc : '',
      };
    }),
  );
  const c = got.findIndex(g => g.centre);
  got.forEach(g => {
    const d = Math.abs(g.i - c);
    if (g.sheet) return;
    // One thumbnail beyond the stage's edge is held (and kept until two beyond).
    if (d <= 6) expect(g.thumb).toContain('thumb');
    else if (d > 7) expect(g.thumb).toBe('');
    if (d <= 1) {
      expect(g.page).not.toBe('');
      expect(g.page).not.toContain('thumb');
    } else if (d > 2) expect(g.page).toBe('');
  });
});

test('with Reduce Motion the pages do not turn or glide', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('2');
  const got = await page.evaluate(() => {
    const side = document.querySelector('.dash-inbox-flip-pg:not(.is-centre):not(.is-off)');
    const cs = getComputedStyle(side);
    return { dur: cs.transitionDuration, transform: cs.transform };
  });
  expect(got.dur.split(',').every(d => parseFloat(d) === 0)).toBe(true);
  // No turn: the matrix has no rotation (a pure scale and shift).
  const m = got.transform.match(/matrix3d\(([^)]+)\)/);
  expect(m).not.toBeNull();
  const v = m[1].split(',').map(Number);
  expect(Math.abs(v[2])).toBeLessThan(1e-6);
  expect(Math.abs(v[8])).toBeLessThan(1e-6);
});

test('pages glide: a transition on transform, 150 to 250 ms', async ({ page }) => {
  await open(page);
  const t = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.dash-inbox-flip-pg:not(.is-centre)'));
    return { props: cs.transitionProperty, dur: cs.transitionDuration };
  });
  expect(t.props).toContain('transform');
  const first = parseFloat(t.dur.split(',')[0]) * 1000;
  expect(first).toBeGreaterThanOrEqual(150);
  expect(first).toBeLessThanOrEqual(250);
});

async function sizes(page) {
  return page.evaluate(() => {
    const r = s => {
      const b = document.querySelector(s).getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height };
    };
    const tile = r('#dash-inbox');
    const clipped = [...document.querySelectorAll('#dash-inbox .dash-inbox-flip-pg:not(.is-off)')].filter(b => {
      const x = b.getBoundingClientRect();
      return x.left < tile.left - 1 || x.right > tile.right + 1 || x.top < tile.top - 1 || x.bottom > tile.bottom + 1;
    }).length;
    const inTile = [...document.querySelectorAll('#dash-inbox .dash-inbox-flip *')].filter(el => {
      // The stage clips its turned pages; the screen-reader list is clipped to a pixel.
      if (el.closest('.dash-inbox-flip-stage, .dash-inbox-flip-vh')) return false;
      const x = el.getBoundingClientRect();
      return x.width && (x.right > tile.right + 1 || x.bottom > tile.bottom + 1);
    }).length;
    const main = document.getElementById('main');
    return {
      tile,
      stage: r('.dash-inbox-flip-stage'),
      centre: r('.dash-inbox-flip-pg.is-centre'),
      cap: r('.dash-inbox-flip-cap'),
      slider: r('.dash-inbox-flip-slider'),
      clipped,
      inTile,
      sideways: [
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        main.scrollWidth - main.clientWidth,
        document.querySelector('#dash-inbox').scrollWidth - document.querySelector('#dash-inbox').clientWidth,
      ],
    };
  });
}

function fills(m, at) {
  // The centre page is as tall as the stage; the caption and slider sit inside the tile.
  // Within a pixel and a half: the page keeps one pixel for its edge, so another font's
  // fractional line heights cannot push it past the 2 px the board allows.
  expect(Math.abs(m.centre.height - m.stage.height), at).toBeLessThanOrEqual(1.5);
  expect(m.centre.top, at).toBeGreaterThanOrEqual(m.stage.top - 0.5);
  expect(m.centre.bottom, at).toBeLessThanOrEqual(m.stage.bottom + 0.5);
  expect(m.cap.top, at).toBeGreaterThanOrEqual(m.stage.bottom - 0.5);
  expect(m.slider.top, at).toBeGreaterThanOrEqual(m.cap.bottom - 0.5);
  expect(m.slider.bottom, at).toBeLessThanOrEqual(m.tile.bottom + 0.5);
  expect(m.inTile, at).toBe(0);
  expect(m.sideways, at).toEqual([0, 0, 0]);
}

// The page's own font, and a wider one with more space between letters and between lines, as a
// Windows laptop, a Chromebook or the Linux machine that runs CI may draw it; its chrome is a
// fraction of a pixel taller, as line heights in other fonts make it. Every fit holds in both.
const FONTS = {
  own: '',
  wide: '#dash-inbox, #dash-inbox * { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; line-height: 1.37 !important; font-size: 13.3px !important; } #dash-inbox-flip-pick { margin-bottom: 6.35px !important; } .dash-inbox-flip-cap { margin-top: 6.45px !important; }',
};

async function setFont(page, css) {
  await page.evaluate(c => {
    let t = document.getElementById('__font');
    if (!t) {
      t = document.createElement('style');
      t.id = '__font';
      document.head.appendChild(t);
    }
    t.textContent = c;
  }, css);
  await page.waitForTimeout(350);
}

/** Every fit assertion, in each font; the tile's own height must not move. Returns the page-font sizes. */
async function fitsInEveryFont(page, tileHeight) {
  let own;
  for (const [fontName, css] of Object.entries(FONTS)) {
    await setFont(page, css);
    const m = await sizes(page);
    const at = fontName + ' font';
    if (tileHeight) expect(Math.round(m.tile.height), at).toBe(tileHeight);
    fills(m, at);
    if (fontName === 'own') own = m;
  }
  await setFont(page, '');
  return own;
}

test('beside Bulletins the tile is 299 px and the centre page fills the stage', async ({ page }) => {
  await open(page, { bulletins: true });
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  const m = await fitsInEveryFont(page, 299);
  console.log(
    '299',
    JSON.stringify({
      tile: m.tile.width + 'x' + m.tile.height,
      stage: m.stage.width + 'x' + m.stage.height,
      centre: m.centre.width + 'x' + m.centre.height,
    }),
  );
  await shot(page, 'flip-299-light');
  // Part way through a student's pages: the second of two.
  await page.locator('.dash-inbox-flip-slider').fill('2');
  await page.locator('.dash-inbox-flip-stage').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 2 of 2');
  await settle(page);
  await fitsInEveryFont(page, 299);
  await shot(page, 'flip-299-page2');
});

test('with the whole column the tile is 510 px and the centre page fills the stage', async ({ page }) => {
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  const m = await fitsInEveryFont(page, 510);
  expect(m.centre.height).toBeGreaterThan(300);
  console.log(
    '510',
    JSON.stringify({
      tile: m.tile.width + 'x' + m.tile.height,
      stage: m.stage.width + 'x' + m.stage.height,
      centre: m.centre.width + 'x' + m.centre.height,
    }),
  );
  await shot(page, 'flip-510-light');
});

test('on a taller window the column is 610 px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  const m = await fitsInEveryFont(page, 610);
  console.log(
    'tall',
    JSON.stringify({
      tile: m.tile.width + 'x' + m.tile.height,
      stage: m.stage.width + 'x' + m.stage.height,
      centre: m.centre.width + 'x' + m.centre.height,
    }),
  );
});

test('on a 1440 x 900 window beside Bulletins the tile is 359 px and the centre page fills the stage', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, { bulletins: true });
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  await fitsInEveryFont(page, 359);
});

test('stacked on an iPad the tile is 450 px and the centre page fills the stage', async ({ page }) => {
  await page.setViewportSize({ width: 796, height: 1100 });
  await open(page);
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  const m = await fitsInEveryFont(page, 450);
  console.log(
    'ipad',
    JSON.stringify({
      tile: m.tile.width + 'x' + m.tile.height,
      stage: m.stage.width + 'x' + m.stage.height,
      centre: m.centre.width + 'x' + m.centre.height,
    }),
  );
  await shot(page, 'flip-ipad-light');
});

test('dark, beside Bulletins and with the whole column', async ({ page }) => {
  await open(page, { dark: true, bulletins: true });
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  await shot(page, 'flip-299-dark');
  await page.evaluate(() => {
    localStorage.removeItem('fv-build-bulletins');
    delete window.DashBulletins;
  });
  await page.reload();
  await page.locator('.dash-inbox-flip-stage').waitFor();
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  await shot(page, 'flip-510-dark');
  const bg = await page
    .locator('.dash-inbox-flip-pg.is-centre .dash-inbox-flip-face')
    .evaluate(el => getComputedStyle(el).borderTopColor);
  expect(bg).toBeTruthy();
});

test('the shared switch: a pick redraws the stage, the centre starts again, the focus stays on the button', async ({
  page,
}) => {
  await open(page);
  await expect(page.locator('#dash-inbox-flip-pick')).toContainText('Light Refraction Lab');
  await page.locator('.dash-inbox-flip-slider').fill('5');
  const was = await name(page).textContent();
  const light = page.locator('[data-dash-inbox-pick="sci8a21"]');
  await light.focus();
  await light.click();
  await expect(light).toHaveAttribute('aria-pressed', 'true');
  await expect(light).toBeFocused();
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('0');
  await expect(name(page)).not.toHaveText(was);
  const first = await page.evaluate(() => DashInboxFlip.entries(getActiveCourse(), 'sci8a21')[0].name);
  await expect(name(page)).toHaveText(first);
  // A redraw keeps the piece and the page; the piece is the same in Side by Side.
  await page.evaluate(() => PageDashboard.render());
  await expect(name(page)).toHaveText(first);
  await page.locator('#dash-view-btn-inbox').click();
  await page.locator('#dash-view-menu-inbox [data-view="side"]').click();
  await expect(page.locator('[data-dash-inbox-pick="sci8a21"]')).toHaveAttribute('aria-pressed', 'true');
});

test('after the grader closes the focus goes back to what opened it', async ({ page }) => {
  await open(page);
  for (const [how, sel] of [
    ['page', '.dash-inbox-flip-pg.is-centre'],
    ['open', '.dash-inbox-flip-open'],
    ['stage', '.dash-inbox-flip-stage'],
  ]) {
    if (how === 'stage') {
      await page.locator(sel).focus();
      await page.keyboard.press('Enter');
    } else await page.locator(sel).click();
    await expect(page.locator('.grader-dialog')).toBeVisible();
    // A key meant for the grader does not move the stage under it.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(page.locator('.grader-dialog')).toHaveCount(0);
    await expect(page.locator(sel)).toBeFocused();
  }
});

test('a file dragged over the tile raises the drop cover over Flip Through, and the stage ignores events under it', async ({
  page,
}) => {
  await open(page);
  const slider = page.locator('.dash-inbox-flip-slider');
  await expect(slider).toHaveValue('0');
  const cover = page.locator('#dash-inbox .dash-inbox-drop-cover');
  const coverShown = () => cover.evaluate(el => !el.hidden && getComputedStyle(el).display !== 'none');
  expect(await coverShown()).toBe(false);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    window.__dt = dt;
    document
      .getElementById('dash-inbox')
      .dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  expect(await coverShown()).toBe(true);
  // A sideways wheel on the stage does nothing while the cover is up. (A key, a press and a
  // mouse move each end the drop's own drag first, before the stage hears them, so the cover is
  // gone by then: the stage's guards for them are the belt to that brace.)
  const raise = () =>
    page.evaluate(() =>
      document
        .getElementById('dash-inbox')
        .dispatchEvent(new DragEvent('dragenter', { dataTransfer: window.__dt, bubbles: true, cancelable: true })),
    );
  await raise();
  expect(await coverShown()).toBe(true);
  await page.evaluate(() => {
    const stage = document.querySelector('.dash-inbox-flip-stage');
    stage.dispatchEvent(new WheelEvent('wheel', { deltaX: 200, deltaY: 0, bubbles: true, cancelable: true }));
  });
  await expect(slider).toHaveValue('0');
  expect(await coverShown()).toBe(true);
  // A key press ends the drag, and then it is the stage's.
  await page.evaluate(() => {
    const stage = document.querySelector('.dash-inbox-flip-stage');
    stage.focus();
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  });
  expect(await coverShown()).toBe(false);
  await raise();
  await page.evaluate(() =>
    document
      .getElementById('dash-inbox')
      .dispatchEvent(new DragEvent('dragleave', { dataTransfer: window.__dt, bubbles: true, cancelable: true })),
  );
  await expect.poll(coverShown).toBe(false);
  // Cleared: the stage answers again.
  await page.locator('.dash-inbox-flip-stage').focus();
  await page.keyboard.press('ArrowRight');
  // The key press that ended the drag moved one stop; this one moves another.
  await expect(slider).toHaveValue('2');
});

test('a drag that starts on the stage (text, not files) is no file drop and flips no stop', async ({ page }) => {
  await open(page);
  const slider = page.locator('.dash-inbox-flip-slider');
  const r = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'a selected line');
    const page0 = document.querySelector('.dash-inbox-flip-pg.is-centre');
    for (const t of ['dragstart', 'dragenter', 'dragover']) {
      page0.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
    const cover = document.querySelector('#dash-inbox .dash-inbox-drop-cover');
    return {
      coverShown: !!cover && !cover.hidden,
      imgsDraggable: [...document.querySelectorAll('.dash-inbox-flip-img')].every(
        i => i.getAttribute('draggable') === 'false',
      ),
    };
  });
  expect(r).toEqual({ coverShown: false, imgsDraggable: true });
  await expect(slider).toHaveValue('0');
  // Dragging the slider's thumb moves stops only through the slider.
  const b = await box(page, '.dash-inbox-flip-slider');
  await page.mouse.move(b.left + 12, b.top + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(Number(await slider.inputValue())).toBeGreaterThan(0);
  await expect(page.locator('#dash-inbox .dash-inbox-drop-cover')).toBeHidden();
});

test('a paper hand-in holds its words under a wide font, in the page font and at both sizes', async ({ page }) => {
  await open(page, { bulletins: true });
  await page.locator('.dash-inbox-flip-slider').fill('7');
  await expect(name(page)).toHaveText('Ethan Dubois');
  await settle(page);
  const FONTS = {
    own: '',
    wide: 'body, .dash-inbox-flip-sheet, .dash-inbox-flip-sheet * { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }',
  };
  for (const [fontName, css] of Object.entries(FONTS)) {
    await page.evaluate(c => {
      let t = document.getElementById('__font');
      if (!t) {
        t = document.createElement('style');
        t.id = '__font';
        document.head.appendChild(t);
      }
      t.textContent = c;
    }, css);
    const m = await page.evaluate(() =>
      [...document.querySelectorAll('.dash-inbox-flip-pg:not(.is-off) .dash-inbox-flip-sheet')].map(el => {
        const lines = n => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight));
        const name = el.querySelector('.dash-inbox-flip-sheet-name');
        const note = el.querySelector('.dash-inbox-flip-sheet-note');
        return {
          centre: !!el.closest('.is-centre'),
          fits: el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
          nameLines: lines(name),
          noteLines: lines(note),
          noteWords: (() => {
            const r = document.createRange();
            r.selectNodeContents(note);
            return r.getBoundingClientRect().right <= el.getBoundingClientRect().right + 0.5;
          })(),
        };
      }),
    );
    expect(m.length, fontName).toBeGreaterThan(0);
    m.forEach(x => {
      expect(x.fits, fontName).toBe(true);
      expect(x.nameLines, fontName).toBeLessThanOrEqual(2);
      expect(x.noteLines, fontName).toBeLessThanOrEqual(2);
      expect(x.noteWords, fontName).toBe(true);
    });
  }
});

test('over the stage a mostly vertical wheel scrolls the page and moves no stop; a sideways one moves one stop and does not scroll', async ({
  page,
}) => {
  await open(page);
  const scrolled = () =>
    page.evaluate(() => {
      const main = document.getElementById('main');
      return Math.max(window.scrollY, main ? main.scrollTop : 0);
    });
  const reset = () =>
    page.evaluate(() => {
      window.scrollTo(0, 0);
      const main = document.getElementById('main');
      if (main) main.scrollTop = 0;
    });
  const s = await box(page, '.dash-inbox-flip-stage');
  await page.mouse.move(s.left + s.width / 2, s.top + s.height / 2);
  for (const [dx, dy] of [
    [1, 40],
    [3, 40],
    [10, 40],
    [20, 30],
  ]) {
    await reset();
    await page.waitForTimeout(100);
    await page.mouse.wheel(dx, dy);
    await expect.poll(scrolled, { message: dx + ',' + dy }).toBeGreaterThan(0);
    await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('0');
  }
  await reset();
  await page.waitForTimeout(300);
  await page.mouse.wheel(40, 3);
  await expect(page.locator('.dash-inbox-flip-slider')).toHaveValue('1');
  await page.waitForTimeout(300);
  expect(await scrolled()).toBe(0);
});

test('the arrows keep working from a page, to the last stop and back, and after the grader closes', async ({
  page,
}) => {
  await open(page);
  const names = await page.evaluate(() => DashInboxFlip.entries(getActiveCourse(), 'sci8a1').map(e => e.name));
  const last = names.length - 1;
  const onBody = () => page.evaluate(() => document.activeElement === document.body);
  const walk = async () => {
    for (let i = 1; i <= last; i++) {
      await page.keyboard.press('ArrowRight');
      await expect(name(page)).toHaveText(names[i]);
      expect(await onBody(), 'right ' + i).toBe(false);
    }
    for (let i = last - 1; i >= 0; i--) {
      await page.keyboard.press('ArrowLeft');
      await expect(name(page)).toHaveText(names[i]);
      expect(await onBody(), 'left ' + i).toBe(false);
    }
  };
  // Click a page (it takes the focus), then walk the whole piece and back.
  await settle(page);
  const at = await visiblePoint(page, names[1]);
  await page.mouse.click(at.x, at.y);
  await expect(name(page)).toHaveText(names[1]);
  await page.keyboard.press('ArrowLeft');
  await expect(name(page)).toHaveText(names[0]);
  await page.keyboard.press('ArrowRight');
  await expect(name(page)).toHaveText(names[1]);
  for (let i = 2; i <= last; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(name(page)).toHaveText(names[i]);
    expect(await onBody(), 'right ' + i).toBe(false);
  }
  for (let i = last - 1; i >= 0; i--) {
    await page.keyboard.press('ArrowLeft');
    await expect(name(page)).toHaveText(names[i]);
    expect(await onBody(), 'left ' + i).toBe(false);
  }
  // Back from the grader with the focus on the centre page: the same walk.
  await page.locator('.dash-inbox-flip-pg.is-centre').click();
  await expect(page.locator('.grader-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.grader-dialog')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-flip-pg.is-centre')).toBeFocused();
  await walk();
});

test('five round trips ask for nothing after the first; down, up, down in a 13-page pile asks each page once', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const work = getCourseSubmissions(cid);
    const noor = DashInboxFlip.entries(cid, 'sci8a1')[2];
    const sub = work.submissions.find(x => x.assessment_id === 'sci8a1' && x.enrollment_id === noor.sid);
    sub.files = Array.from({ length: 13 }, (_, i) => ({ ...sub.files[0], id: 'big-' + (i + 1), page: i + 1 }));
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
    window.__asks = [];
    const was = window.openStudentWorkPage;
    window.openStudentWorkPage = function (c, file, which) {
      window.__asks.push(file.id + '|' + which);
      return was.apply(this, arguments);
    };
  });
  const asks = () => page.evaluate(() => window.__asks.length);
  const stage = page.locator('.dash-inbox-flip-stage');
  await page.locator('.dash-inbox-flip-slider').fill('4');
  await settle(page);
  await stage.focus();
  const round = async () => {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(60);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(60);
  };
  await round();
  await settle(page);
  const after1 = await asks();
  for (let i = 0; i < 4; i++) await round();
  await settle(page);
  expect(await asks()).toBe(after1);
  // A 13-page pile: down, up, down again.
  await page.locator('.dash-inbox-flip-slider').fill('2');
  await settle(page);
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 1 of 13');
  await stage.focus();
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowDown']) {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(40);
    }
  }
  await settle(page);
  const all = await page.evaluate(() => window.__asks);
  expect(new Set(all).size).toBe(all.length);
  expect(all.filter(a => a.startsWith('big-') && a.endsWith('|page')).length).toBe(13);
});

/* A 13-page pile, the centre student's pages walked down to the last one and
   back: how many whole pages the centre holds at once (D9). */
async function walkBigPile(page) {
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const work = getCourseSubmissions(cid);
    const noor = DashInboxFlip.entries(cid, 'sci8a1')[2];
    const sub = work.submissions.find(x => x.assessment_id === 'sci8a1' && x.enrollment_id === noor.sid);
    sub.files = Array.from({ length: 13 }, (_, i) => ({ ...sub.files[0], id: 'big-' + (i + 1), page: i + 1 }));
    saveDemoStudentWork(cid, work);
    PageDashboard.render();
  });
  await page.locator('.dash-inbox-flip-slider').fill('2');
  await settle(page);
  await expect(page.locator('.dash-inbox-flip-pagetext')).toHaveText('Page 1 of 13');
  const held = () =>
    page.evaluate(() => document.querySelectorAll('.dash-inbox-flip-pg.is-centre img[data-flip-part="page"]').length);
  let most = 0;
  await page.locator('.dash-inbox-flip-stage').focus();
  for (const key of ['ArrowDown', 'ArrowUp']) {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(40);
      most = Math.max(most, await held());
    }
  }
  await settle(page);
  return Math.max(most, await held());
}

test('on a touch device the centre holds its page and the 6 nearest, not the whole 13-page pile', async ({ page }) => {
  await open(page, { touch: true });
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  expect(await walkBigPile(page)).toBeLessThanOrEqual(7);
});

test('on a computer the centre keeps every page of a 13-page pile it has fetched', async ({ page }) => {
  await open(page);
  expect(await walkBigPile(page)).toBe(13);
});

test('a class with Send Work off has no Flip Through', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/);
  await page.locator('.dash-glance').waitFor();
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await expect(page.locator('#dash-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-flip')).toHaveCount(0);
});
