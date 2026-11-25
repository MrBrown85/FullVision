/**
 * The Inbox's redrawn Roll Call (teacher/dash-inbox-rollcall.js; slice I2 of
 * docs/plans/inbox-redesign-plan.md). Demo
 * Mode, Science 8, the student page and Send Work on. Set FV_SHOTS to a
 * folder to keep pictures.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(500);
  await page.locator('#dash-inbox').screenshot({ path: SHOTS + '/' + name + '.png' });
};

async function open(page, { tile = true } = {}) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  if (!tile)
    await page.evaluate(() => {
      DashBulletins.html = () => '';
      PageDashboard.render();
    });
  // The header's switch may not be merged: choose the view through the Inbox itself.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    localStorage.setItem('fv-dash-inbox-view:' + cid, 'rollcall');
    DashInbox.setView(cid, 'rollcall');
    PageDashboard.render();
  });
  await page.locator('.dash-inbox-rollcall[data-aid]').waitFor();
}

test.use({ viewport: { width: 1280, height: 800 } });

test('the grid is the class in class-list order, four columns read down', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  const got = await page.evaluate(() => {
    const cid = getActiveCourse();
    const want = DashInboxRollCall.model(cid, document.querySelector('.dash-inbox-rollcall').dataset.aid).students;
    const btns = [...document.querySelectorAll('.dash-inbox-rc-st')];
    const grid = document.querySelector('.dash-inbox-rc-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const rects = btns.map(b => b.getBoundingClientRect());
    return {
      same: btns.map(b => b.dataset.sid).join() === want.map(c => c.sid).join(),
      n: btns.length,
      cols,
      height: rects[0].height,
      // Down a column: the second button is under the first.
      down: rects[1].top > rects[0].top && Math.abs(rects[1].left - rects[0].left) < 2,
      firstOfSecondCol: rects.findIndex(r => r.left > rects[0].left + 20),
      rows: Number(grid.style.getPropertyValue('--dash-inbox-rc-rows')),
    };
  });
  expect(got.same).toBe(true);
  expect(got.cols).toBe(4);
  expect(got.height).toBe(38);
  expect(got.down).toBe(true);
  expect(got.firstOfSecondCol).toBe(got.rows);
  expect(got.n).toBeGreaterThan(20);
  expect(errors).toEqual([]);
  await shot(page, 'rollcall');
});

test('a toggle picks out its students and a second press clears it', async ({ page }) => {
  await open(page);
  const key = page.locator('.dash-inbox-rc-key').first();
  const state = await key.getAttribute('data-state');
  const count = Number((await key.textContent()).match(/\d+/)[0]);
  await key.click();
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dash-inbox-rc-st:not(.is-plain)')).toHaveCount(count);
  await expect(page.locator('.dash-inbox-rc-st:not(.is-plain)').first()).toHaveAttribute('data-mark', state);
  await shot(page, 'rollcall-filter');
  await key.click();
  await expect(key).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.dash-inbox-rc-st.is-plain')).toHaveCount(0);
});

test('Handed In on Paper moves a student from Not In to in', async ({ page }) => {
  await open(page);
  // Pick a piece that has someone not in.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const p = DashInboxRollCall.pieces(cid).find(x => DashInboxRollCall.model(cid, x.aid).counts.notin > 0);
    DashInboxRollCall.show(cid, p.aid);
  });
  await page.locator('.dash-inbox-rollcall[data-aid]').waitFor();
  const out = page.locator('.dash-inbox-rc-st[data-mark="notin"]').first();
  const sid = await out.getAttribute('data-sid');
  const before = await page.locator('.dash-inbox-rc-st[data-mark="notin"]').count();
  await out.click();
  await expect(page.locator('.dash-inbox-rc-item')).toHaveText(['Handed In on Paper', 'Add a Scan or Photo']);
  await shot(page, 'rollcall-menu');
  await page.getByRole('menuitem', { name: 'Handed In on Paper' }).click();
  await expect(page.locator('.dash-inbox-rc-st[data-sid="' + sid + '"]')).not.toHaveAttribute('data-mark', 'notin');
  await expect(page.locator('.dash-inbox-rc-st[data-mark="notin"]')).toHaveCount(before - 1);
  await expect(page.locator('.dash-inbox-rc-st[data-sid="' + sid + '"]')).toBeFocused();
});

test('Escape and an outside click close the menu, and the arrows move in it', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const p = DashInboxRollCall.pieces(cid).find(x => DashInboxRollCall.model(cid, x.aid).counts.notin > 0);
    DashInboxRollCall.show(cid, p.aid);
  });
  const out = page.locator('.dash-inbox-rc-st[data-mark="notin"]').first();
  await out.click();
  await expect(page.locator('.dash-inbox-rc-item').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.dash-inbox-rc-item').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dash-inbox-rc-pop')).toHaveCount(0);
  await expect(out).toBeFocused();
  await out.click();
  await expect(page.locator('.dash-inbox-rc-pop')).toHaveCount(1);
  await page.locator('#dash-inbox .dash-inbox-rc-title').click();
  await expect(page.locator('.dash-inbox-rc-pop.is-menu')).toHaveCount(0);
});

test('the arrows and the title menu change the assessment, kept for the class', async ({ page }) => {
  await open(page);
  const read = () =>
    page.evaluate(() => ({
      aid: document.querySelector('.dash-inbox-rollcall').dataset.aid,
      kept: localStorage.getItem('fv-dash-inbox-rollpiece:' + getActiveCourse()),
      all: DashInboxRollCall.pieces(getActiveCourse()).map(p => p.aid),
    }));
  const a = await read();
  expect(a.all.length).toBeGreaterThan(2);
  const at = a.all.indexOf(a.aid);
  const dir = at < a.all.length - 1 ? 'next' : 'prev';
  await page.locator('[data-dash-rc="' + dir + '"]').click();
  const b = await read();
  expect(b.aid).toBe(a.all[at + (dir === 'next' ? 1 : -1)]);
  expect(b.kept).toBe(b.aid);
  await expect(page.locator('[data-dash-rc="' + dir + '"]')).toBeFocused();
  // The menu lists every piece, those with nothing in among them.
  await page.locator('.dash-inbox-rc-title').click();
  await expect(page.locator('.dash-inbox-rc-opt')).toHaveCount(a.all.length);
  await shot(page, 'rollcall-list');
  await page.locator('.dash-inbox-rc-opt').nth(0).click();
  expect((await read()).aid).toBe(a.all[0]);
  // A reload keeps it.
  await page.reload();
  await page.locator('.dash-inbox-rollcall[data-aid]').waitFor();
  expect((await read()).aid).toBe(a.all[0]);
});

test('a student with work in opens the grader, and the focus comes back', async ({ page }) => {
  await open(page);
  const st = page.locator('.dash-inbox-rc-st:not([data-mark="notin"])').first();
  const sid = await st.getAttribute('data-sid');
  await st.click();
  await page.locator('#grader-overlay').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#grader-overlay').waitFor({ state: 'detached' });
  await expect(page.locator('.dash-inbox-rc-st[data-sid="' + sid + '"]')).toBeFocused();
});

for (const tile of [true, false]) {
  for (const font of FONTS) {
    test(`nothing overflows the tile at 1280 x 800 (Bulletins ${tile ? 'on' : 'off'}, ${font} font)`, async ({
      page,
    }) => {
      await open(page, { tile });
      await useFont(page, font);
      await page.locator('.dash-inbox-rollcall[data-aid]').waitFor();
      const r = await page.evaluate(() => {
        const tileEl = document.getElementById('dash-inbox');
        const t = tileEl.getBoundingClientRect();
        const grid = document.querySelector('.dash-inbox-rc-grid');
        const g = grid.getBoundingClientRect();
        const bar = document.querySelector('.dash-inbox-rc-bar').getBoundingClientRect();
        const inside = [...document.querySelectorAll('.dash-inbox-rc-bar > *, .dash-inbox-rc-key')].every(el => {
          const q = el.getBoundingClientRect();
          return q.left >= t.left - 1 && q.right <= t.right + 1;
        });
        const names = [...document.querySelectorAll('.dash-inbox-rc-nm')].map(n => n.getBoundingClientRect().width);
        return {
          tileSideways: tileEl.scrollWidth > tileEl.clientWidth,
          pageSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          gridSideways: grid.scrollWidth > grid.clientWidth + 1,
          gridInside: g.bottom <= t.bottom + 1 && g.top >= bar.bottom - 1,
          barInside: inside,
          leastName: Math.min(...names),
          cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        };
      });
      expect(r.tileSideways).toBe(false);
      expect(r.pageSideways).toBe(false);
      expect(r.gridSideways).toBe(false);
      expect(r.gridInside).toBe(true);
      expect(r.barInside).toBe(true);
      expect(r.leastName).toBeGreaterThanOrEqual(40);
      expect(r.cols).toBeGreaterThanOrEqual(2);
      await shot(page, `rollcall-${tile ? 'bulletins' : 'nobulletins'}-${font}`);
    });
  }
}

test('a narrow tile drops to fewer columns', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(300);
  const cols = await page.evaluate(
    () => getComputedStyle(document.querySelector('.dash-inbox-rc-grid')).gridTemplateColumns.split(' ').length,
  );
  expect(cols).toBeLessThanOrEqual(4);
  expect(cols).toBeGreaterThanOrEqual(2);
});
