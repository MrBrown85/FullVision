/**
 * The Inbox's Roll Call view (D8 of docs/plans/dashboard-inbox-plan.md).
 * Demo Mode, Science 8, the student page and Send Work on. Set FV_SHOTS to a folder to keep pictures.
 */
import { test, expect } from '@playwright/test';

const LIGHT = 'sci8a21';
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

async function open(page, { bulletins = false, dark = false } = {}) {
  await page.addInitScript(bulletins => {
    try {
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
  }, bulletins);
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
}

async function chooseRoll(page) {
  await page.locator('#dash-view-btn-inbox').click();
  await page.locator('#dash-view-menu-inbox [data-view="roll"]').click();
  await page.locator('.dash-inbox-roll').waitFor();
}

test.use({ viewport: { width: 1280, height: 800 } });

test('Roll Call is in the view pill, switches the tile in place and survives a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  await page.locator('#dash-view-btn-inbox').click();
  await expect(page.locator('#dash-view-menu-inbox [data-view="roll"]')).toContainText(
    "The whole class: who has sent work, and who hasn't.",
  );
  await page.locator('#dash-view-menu-inbox [data-view="roll"]').click();
  await expect(page.locator('#dash-inbox-title')).toHaveText('Inbox');
  await expect(page.locator('#dash-view-btn-inbox')).toContainText('Roll Call');
  await expect(page.locator('.dash-inbox-roll')).toBeVisible();
  await expect(page.locator('.dash-inbox-row')).toHaveCount(0);
  await page.reload();
  await page.locator('.dash-glance').waitFor();
  await expect(page.locator('.dash-inbox-roll')).toBeVisible();
  expect(errors).toEqual([]);
});

test('at 299 px every student is a name chip, all inside the tile, in the model states', async ({ page }) => {
  await open(page, { bulletins: true });
  await chooseRoll(page);
  const tile = await page.locator('#dash-inbox').boundingBox();
  expect(Math.round(tile.height)).toBe(299);
  await expect(page.locator('.dash-inbox-roll')).toHaveClass(/is-names/);
  await expect(page.locator('.dash-inbox-roll-img')).toHaveCount(0);
  const got = await page.evaluate(aid => {
    const cid = getActiveCourse();
    const m = DashInboxRoll.model(cid, aid);
    const tileR = document.getElementById('dash-inbox').getBoundingClientRect();
    const grid = document.getElementById('dash-inbox-roll-grid');
    const chips = [...document.querySelectorAll('.dash-inbox-roll-chip')];
    return {
      rootAid: document.querySelector('.dash-inbox-roll').getAttribute('data-aid'),
      n: m.students.length,
      scrolls: grid.scrollHeight > grid.clientHeight,
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      inside: chips.every(c => {
        const r = c.getBoundingClientRect();
        return r.left >= tileR.left && r.right <= tileR.right && r.top >= tileR.top && r.bottom <= tileR.bottom;
      }),
      sizes: chips.slice(0, 3).map(c => {
        const r = c.getBoundingClientRect();
        return Math.round(r.width) + 'x' + Math.round(r.height);
      }),
      states: chips.map((c, i) => ({
        sid: c.getAttribute('data-sid'),
        solid: c.classList.contains('is-in'),
        dashed: c.classList.contains('is-out'),
        tick: c.classList.contains('is-returned') && !!c.querySelector('.dash-inbox-roll-tick'),
        bold: c.classList.contains('is-tograde') && Number(getComputedStyle(c).fontWeight) >= 700,
        name: c.getAttribute('aria-label'),
        title: c.getAttribute('title'),
        model: m.students[i],
      })),
    };
  }, LIGHT);
  expect(got.rootAid).toBe(LIGHT);
  expect(got.states.length).toBe(got.n);
  expect(got.inside).toBe(true);
  expect(got.scrolls).toBe(false);
  expect(got.pageScrollsSideways).toBe(false);
  for (const s of got.states) {
    expect(s.sid).toBe(s.model.sid);
    expect(s.solid).toBe(s.model.in);
    expect(s.dashed).toBe(!s.model.in);
    expect(s.tick).toBe(s.model.in && s.model.state === 'returned');
    expect(s.bold).toBe(s.model.in && s.model.state === 'tograde');
    expect(s.name).toBe(s.model.said);
    expect(s.title).toBe(s.model.said);
  }
  expect(got.states.some(s => s.solid)).toBe(true);
  expect(got.states.some(s => s.dashed)).toBe(true);
  test.info().annotations.push({ type: 'chips at 299', description: got.sizes.join(', ') });
  await shot(page, 'roll-names-299-light');
});

test('a paper hand-in says On Paper, and the shared piece switch changes the piece', async ({ page }) => {
  await open(page, { bulletins: true });
  await page.evaluate(() => {
    localStorage.setItem('fv-dash-inbox-view:' + getActiveCourse(), 'roll');
    PageDashboard.render();
  });
  // The switch is the shared one; picking Cell Microscope Lab keeps the focus on the pressed button.
  const lab = page.locator('.dash-inbox-pick-btn', { hasText: 'Cell Microscope Lab' });
  await lab.focus();
  await lab.press('Enter');
  await expect(page.locator('.dash-inbox-roll')).toHaveAttribute('data-aid', 'sci8a1');
  await expect(page.locator('.dash-inbox-pick-btn[aria-pressed="true"]')).toContainText('Cell Microscope Lab');
  expect(await page.evaluate(() => document.activeElement.className)).toContain('dash-inbox-pick-btn');
  const ethan = page.locator('.dash-inbox-roll-chip', { hasText: 'Ethan' });
  await expect(ethan).toHaveAttribute('aria-label', /On Paper/);
  await expect(ethan.locator('.dash-inbox-roll-paper')).toBeVisible();
  await expect(page.locator('.dash-inbox-roll-count')).toContainText('Ethan Dubois on paper');
});

test('the grader closes and the focus is back on the student who opened it; a redraw keeps the scroll', async ({
  page,
}) => {
  await open(page);
  await chooseRoll(page);
  const sid = await page.evaluate(aid => {
    const m = DashInboxRoll.model(getActiveCourse(), aid);
    return m.students.filter(c => c.in)[1].sid;
  }, LIGHT);
  const chip = page.locator('.dash-inbox-roll-chip[data-sid="' + sid + '"]');
  await chip.click();
  await expect(page.locator('#grader-overlay')).toBeVisible();
  // Events from under the open grader are ignored: no menu opens.
  await page.evaluate(() => document.querySelector('.dash-inbox-roll-chip.is-out').click());
  await expect(page.locator('.dash-inbox-roll-menu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await expect(chip).toBeFocused();
  // A redraw keeps the grid's scroll place.
  await page.evaluate(() => {
    const g = document.getElementById('dash-inbox-roll-grid');
    g.scrollTop = 20;
    window.__top = g.scrollTop;
    PageDashboard.render();
  });
  const top = await page.evaluate(() => document.getElementById('dash-inbox-roll-grid').scrollTop);
  expect(top).toBe(await page.evaluate(() => window.__top));
});

test('at the full column the chips carry pages, each at least 80 px tall', async ({ page }) => {
  await open(page);
  await chooseRoll(page);
  await expect(page.locator('.dash-inbox-roll')).toHaveClass(/is-pages/);
  const tile = await page.locator('#dash-inbox').boundingBox();
  expect(tile.height).toBeGreaterThanOrEqual(380);
  await expect(page.locator('.dash-inbox-roll-img').first()).toHaveAttribute('src', /.+/);
  const got = await page.evaluate(() => {
    const pgs = [...document.querySelectorAll('.dash-inbox-roll-pg')];
    const grid = document.getElementById('dash-inbox-roll-grid');
    const withPic = [...document.querySelectorAll('.dash-inbox-roll-chip.is-in .dash-inbox-roll-pg')];
    const out = [...document.querySelectorAll('.dash-inbox-roll-chip.is-out .dash-inbox-roll-pg')];
    return {
      minH: Math.min(...pgs.map(p => p.getBoundingClientRect().height)),
      w: Math.round(pgs[0].getBoundingClientRect().width),
      h: Math.round(pgs[0].getBoundingClientRect().height),
      cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      emptyText: out.map(p => p.textContent.trim()).join(''),
      emptyDashed: out.every(p => getComputedStyle(p).borderStyle.startsWith('dashed')),
      withPic: withPic.length,
      sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrolls: grid.scrollHeight > grid.clientHeight,
    };
  });
  expect(got.minH).toBeGreaterThanOrEqual(80);
  expect([7, 9]).toContain(got.cols);
  expect(got.emptyText).toBe('');
  expect(got.emptyDashed).toBe(true);
  expect(got.withPic).toBeGreaterThan(0);
  expect(got.sideways).toBe(false);
  test.info().annotations.push({
    type: 'page at full column',
    description: got.w + 'x' + got.h + ', ' + got.cols + ' across, scrolls: ' + got.scrolls,
  });
  await shot(page, 'roll-pages-510-light');
});

test('a click on a student with work in opens the grader on them', async ({ page }) => {
  await open(page);
  await chooseRoll(page);
  const name = await page.evaluate(aid => {
    const m = DashInboxRoll.model(getActiveCourse(), aid);
    return m.students.find(c => c.in && c.state === 'tograde').full;
  }, LIGHT);
  await page
    .locator('.dash-inbox-roll-chip', { has: page.locator('.dash-inbox-roll-name') })
    .first()
    .waitFor();
  await page.locator('.dash-inbox-roll-chip[aria-label^="' + name + ':"]').click();
  await expect(page.locator('.grader-work')).toBeVisible();
  await expect(page.locator('.grader-student')).toContainText(name.split(' ')[0]);
});

test('a click on a student with nothing in opens a menu with only Add Work', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    localStorage.setItem('fv-dash-inbox-view:' + getActiveCourse(), 'roll');
    PageDashboard.render();
  });
  const menu = page.locator('.dash-inbox-roll-menu');
  // Not in the page at rest, so not visible.
  await expect(page.locator('.dash-inbox-roll')).toBeVisible();
  await expect(menu).toHaveCount(0);
  const out = page.locator('.dash-inbox-roll-chip.is-out').first();
  const sid = await out.getAttribute('data-sid');
  const box = await out.boundingBox();
  await out.click();
  await expect(menu).toBeVisible();
  await expect(out).toHaveClass(/is-menu/);
  await expect(out).toHaveAttribute('aria-expanded', 'true');
  // The open chip is plainly marked: its drawn box differs from a resting one's.
  const look = el =>
    el.evaluate(n => {
      const b = n.querySelector('.dash-inbox-roll-pg') || n;
      const cs = getComputedStyle(b);
      return cs.borderTopColor + '|' + cs.borderTopWidth + '|' + cs.borderTopStyle + '|' + cs.boxShadow;
    });
  const resting = page.locator('.dash-inbox-roll-chip.is-out').nth(3);
  expect(await look(out)).not.toBe(await look(resting));
  expect(await look(out)).toContain('solid');
  await expect(menu.locator('[role="menuitem"]')).toHaveCount(1);
  await expect(menu).toContainText('Add Work');
  await expect(page.locator('body')).not.toContainText('Mark Missing');
  // The item is not where the click was.
  const item = await menu.locator('.dash-inbox-roll-item').boundingBox();
  expect(item.y).toBeGreaterThan(box.y + box.height / 2 + 2);
  await shot(page, 'roll-menu-light');
  // A redraw keeps it; a click elsewhere closes it.
  await page.evaluate(() => PageDashboard.render());
  await expect(menu).toBeVisible();
  await page.locator('.dash-inbox-roll-count').click();
  await expect(menu).toHaveCount(0);
  // Escape closes it, and the focus goes back to the chip.
  await page.locator('.dash-inbox-roll-chip[data-sid="' + sid + '"]').click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // Another student's menu replaces it.
  await out.click();
  await page.locator('.dash-inbox-roll-chip.is-out').nth(1).click();
  await expect(menu).toHaveCount(1);
  // Add Work opens the grader on that student, where Add Work is.
  await menu.locator('.dash-inbox-roll-item').click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.grader-addwork')).toBeVisible();
});

test('Add Work for the Class opens the class page', async ({ page }) => {
  await open(page);
  await chooseRoll(page);
  await page.locator('.dash-inbox-roll-all').click();
  await expect(page.locator('#add-work-class-overlay')).toBeVisible();
});

test('a keyboard reaches every chip in class-list order, and focus is visible', async ({ page }) => {
  await open(page, { bulletins: true });
  await chooseRoll(page);
  await page.locator('.dash-inbox-roll-chip').first().focus();
  await page.keyboard.press('ArrowRight');
  const got = await page.evaluate(() => {
    const aid = document.querySelector('.dash-inbox-roll').dataset.aid;
    const ids = DashInboxRoll.model(getActiveCourse(), aid).students.map(s => s.sid);
    const dom = [...document.querySelectorAll('.dash-inbox-roll-chip')].map(c => c.dataset.sid);
    return {
      same: JSON.stringify(ids) === JSON.stringify(dom),
      active: document.activeElement.dataset.sid,
      second: ids[1],
      outline: getComputedStyle(document.activeElement).outlineStyle,
    };
  });
  expect(got.same).toBe(true);
  expect(got.active).toBe(got.second);
  expect(got.outline).not.toBe('none');
});

test('dark mode, 299 px', async ({ page }) => {
  await open(page, { bulletins: true, dark: true });
  await chooseRoll(page);
  await shot(page, 'roll-names-299-dark');
  await expect(page.locator('.dash-inbox-roll')).toBeVisible();
});

test('dark mode, full column', async ({ page }) => {
  await open(page, { dark: true });
  await chooseRoll(page);
  await expect(page.locator('.dash-inbox-roll-img').first()).toHaveAttribute('src', /.+/);
  await shot(page, 'roll-pages-510-dark');
});

test('at 299 px the menu is whole, inside the window and the tile, and not clipped', async ({ page }) => {
  await open(page, { bulletins: true });
  await chooseRoll(page);
  const menu = page.locator('.dash-inbox-roll-menu');
  await expect(menu).toHaveCount(0);
  // The last student with nothing in: the worst place for a menu.
  const outs = page.locator('.dash-inbox-roll-chip.is-out');
  const last = outs.last();
  await last.click();
  await expect(menu).toBeVisible();
  const got = await page.evaluate(() => {
    const m = document.querySelector('.dash-inbox-roll-menu').getBoundingClientRect();
    const t = document.getElementById('dash-inbox').getBoundingClientRect();
    const hit = (x, y) => !!document.elementFromPoint(x, y)?.closest('.dash-inbox-roll-menu');
    const chip = document.querySelector('.dash-inbox-roll-chip.is-menu').getBoundingClientRect();
    return {
      inWindow: m.left >= 0 && m.top >= 0 && m.right <= innerWidth && m.bottom <= innerHeight,
      inTile: m.left >= t.left && m.top >= t.top && m.right <= t.right && m.bottom <= t.bottom,
      corners: [
        hit(m.left + 5, m.top + 5),
        hit(m.right - 5, m.top + 5),
        hit(m.left + 5, m.bottom - 5),
        hit(m.right - 5, m.bottom - 5),
      ],
      apart: m.top >= chip.bottom || m.bottom <= chip.top,
    };
  });
  expect(got.inWindow).toBe(true);
  expect(got.inTile).toBe(true);
  expect(got.corners).toEqual([true, true, true, true]);
  expect(got.apart).toBe(true);
  await shot(page, 'roll-menu-299-light');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('an Excused student is quiet and opens the grader; a Missing one is said in a word', async ({ page }) => {
  await open(page, { bulletins: true });
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const m = DashInboxRoll.model(cid, 'sci8a21');
    const outs = m.students.filter(c => c.kind === 'out');
    setAssignmentStatus(cid, outs[0].sid, 'sci8a21', 'EXC');
    setAssignmentStatus(cid, outs[1].sid, 'sci8a21', 'NS');
    window.__ex = [outs[0].sid, outs[1].sid];
    localStorage.setItem('fv-dash-inbox-view:' + cid, 'roll');
    PageDashboard.render();
  });
  const [ex, ms] = await page.evaluate(() => window.__ex);
  const exc = page.locator('.dash-inbox-roll-chip[data-sid="' + ex + '"]');
  await expect(exc).toHaveAttribute('aria-label', /: Excused$/);
  await expect(exc).toHaveAttribute('title', /: Excused$/);
  await expect(exc).toHaveClass(/is-excused/);
  await expect(exc).toContainText('Excused');
  expect(await exc.evaluate(n => getComputedStyle(n).borderTopStyle)).not.toBe('dashed');
  const miss = page.locator('.dash-inbox-roll-chip[data-sid="' + ms + '"]');
  await expect(miss).toHaveAttribute('aria-label', /: Missing$/);
  await expect(miss).toContainText('Missing');
  expect(await miss.evaluate(n => getComputedStyle(n).borderTopStyle)).toBe('dashed');
  // Excused is a chip like the rest: the grader opens on that student.
  await exc.click();
  await expect(page.locator('.grader-student')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await miss.click();
  await expect(page.locator('.dash-inbox-roll-menu')).toBeVisible();
  // The open menu's own chip again closes it.
  await miss.click();
  await expect(page.locator('.dash-inbox-roll-menu')).toHaveCount(0);
});

test('Late has a word in the chip, and no picture can be dragged', async ({ page }) => {
  await open(page);
  await chooseRoll(page);
  await expect(page.locator('.dash-inbox-roll-chip[aria-label^="Marcus Lee"] .dash-inbox-roll-tag')).toHaveText('Late');
  await expect(page.locator('.dash-inbox-roll-img').first()).toHaveAttribute('src', /.+/);
  const drag = await page.evaluate(() =>
    [...document.querySelectorAll('.dash-inbox-roll-img')].every(i => i.draggable === false),
  );
  expect(drag).toBe(true);
});

test('one Tab stop; arrows, Home and End move inside the grid; focus survives a redraw', async ({ page }) => {
  await open(page, { bulletins: true });
  await chooseRoll(page);
  expect(await page.locator('.dash-inbox-roll-chip[tabindex="0"]').count()).toBe(1);
  expect(await page.locator('.dash-inbox-roll-chip[tabindex="-1"]').count()).toBe(26);
  const sids = await page.evaluate(() =>
    [...document.querySelectorAll('.dash-inbox-roll-chip')].map(c => c.dataset.sid),
  );
  await page.locator('.dash-inbox-roll-chip').first().focus();
  // Right visits every chip in order, across every wrap.
  const seen = [sids[0]];
  for (let i = 1; i < sids.length; i++) {
    await page.keyboard.press('ArrowRight');
    seen.push(await page.evaluate(() => document.activeElement.dataset.sid));
  }
  expect(seen).toEqual(sids);
  // Down and up cross the wraps.
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => document.activeElement.dataset.sid)).toBe(sids[0]);
  await page.keyboard.press('ArrowDown');
  const row2 = await page.evaluate(() => document.activeElement.dataset.sid);
  expect(sids.indexOf(row2)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowUp');
  expect(await page.evaluate(() => document.activeElement.dataset.sid)).toBe(sids[0]);
  await page.keyboard.press('End');
  expect(await page.evaluate(() => document.activeElement.dataset.sid)).toBe(sids[sids.length - 1]);
  // The one Tab stop follows the focus.
  expect(await page.evaluate(() => document.querySelector('.dash-inbox-roll-chip[tabindex="0"]').dataset.sid)).toBe(
    sids[sids.length - 1],
  );
  // A redraw keeps the focused student.
  await page.evaluate(() => PageDashboard.render());
  expect(await page.evaluate(() => document.activeElement.dataset.sid)).toBe(sids[sids.length - 1]);
});

for (const [w, h] of [
  [800, 800],
  [769, 700],
]) {
  test('at ' + w + 'x' + h + ' the first draw is one render, and a redraw keeps the scroll', async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/);
    await page.locator('.dash-glance').waitFor();
    await page.evaluate(() => {
      const cid = getActiveCourse();
      setStudentPageSwitch(cid, true, 'on_return');
      const work = getCourseSubmissions(cid);
      work.course.send_work = true;
      saveDemoStudentWork(cid, work);
      localStorage.setItem('fv-dash-inbox-view:' + cid, 'roll');
      window.__renders = 0;
      const was = PageDashboard.render;
      PageDashboard.render = function () {
        window.__renders++;
        return was.apply(this, arguments);
      };
    });
    // Count only the renders the roll itself asks for: none beyond the one we make.
    await page.evaluate(() => {
      window.__renders = 0;
      DashInboxRoll.reset();
      PageDashboard.render();
    });
    await page.locator('.dash-inbox-roll').waitFor();
    await page.waitForTimeout(500);
    const first = await page.evaluate(() => ({
      renders: window.__renders,
      form: document.querySelector('.dash-inbox-roll').className,
      tile: Math.round(document.getElementById('dash-inbox').getBoundingClientRect().height),
      scrolls: (g => g.scrollHeight > g.clientHeight)(document.getElementById('dash-inbox-roll-grid')),
    }));
    expect(first.renders).toBe(1);
    // The grid scrolls only where the pages cannot fit; set a scroll and draw again.
    await page.evaluate(() => {
      const g = document.getElementById('dash-inbox-roll-grid');
      g.scrollTop = 25;
      window.__top = g.scrollTop;
    });
    await page.evaluate(() => PageDashboard.render());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      top: document.getElementById('dash-inbox-roll-grid').scrollTop,
      want: window.__top,
      renders: window.__renders,
    }));
    expect(after.top).toBe(after.want);
    expect(after.renders).toBe(2);
    test.info().annotations.push({ type: w + 'x' + h, description: JSON.stringify(first) });
  });
}

test('one live observer after ten redraws, none after leaving the Dashboard', async ({ page }) => {
  // Count the ResizeObservers that observe a node and have not disconnected.
  await page.addInitScript(() => {
    const Real = window.ResizeObserver;
    window.__liveRO = new Set();
    window.ResizeObserver = class extends Real {
      observe(...a) {
        window.__liveRO.add(this);
        return super.observe(...a);
      }
      disconnect() {
        window.__liveRO.delete(this);
        return super.disconnect();
      }
    };
  });
  await open(page);
  await chooseRoll(page);
  const count = () => page.evaluate(() => window.__liveRO.size);
  await page.evaluate(() => PageDashboard.render());
  const one = await count();
  for (let i = 0; i < 10; i++) await page.evaluate(() => PageDashboard.render());
  // Ten more draws leave no more observers than one, and the roll holds one of them.
  expect(await count()).toBe(one);
  expect(await page.evaluate(() => DashInboxRoll.live())).toMatchObject({
    observer: true,
    undo: true,
    menuListener: false,
  });
  await page.evaluate(() => DashInbox.leave(getActiveCourse()));
  expect(await count()).toBe(one - 1);
  expect(await page.evaluate(() => DashInboxRoll.live())).toMatchObject({
    observer: false,
    undo: false,
    menuListener: false,
  });
});
