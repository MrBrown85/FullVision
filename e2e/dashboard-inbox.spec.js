/**
 * The Dashboard's Inbox tile (D4 of docs/plans/dashboard-inbox-plan.md,
 * redrawn by docs/plans/inbox-redesign-plan.md): what holds for the tile
 * whichever view it shows. Demo Mode, Science 8, the student page and Send
 * Work on, so the sample work shows: Light Refraction Lab has work waiting.
 * (The stacks, Roll Call and the empty state have their own specs.)
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';

test.beforeEach(({ page }) => demoStudentPageOff(page));

const LIGHT = 'sci8a21';
const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  // The app's own loading screen has gone by the time the picture is taken.
  await page.waitForFunction(() => {
    const el = document.getElementById('app-loading');
    return (
      !el ||
      getComputedStyle(el).display === 'none' ||
      getComputedStyle(el).visibility === 'hidden' ||
      +getComputedStyle(el).opacity === 0
    );
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
};

async function open(page, { oldFlag = null, tile = true, sendWork = true, dark = false } = {}) {
  await page.addInitScript(
    ([oldFlag]) => {
      try {
        // What a browser that saw the row before D9 may still have kept.
        if (oldFlag != null) localStorage.setItem('fv-build-dashRow', oldFlag);
      } catch (e) {
        /* storage blocked */
      }
    },
    [oldFlag],
  );
  if (dark) await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  // With no tile (Bulletins is on since B1g): a signed-in class whose server has not answered list_bulletins, or
  // whose read failed, draws no Bulletins slot (e2e/dashboard-bulletins-late.spec.js); Demo Mode always has one.
  if (!tile)
    await page.evaluate(() => {
      DashBulletins.html = () => '';
      PageDashboard.render();
    });
  if (sendWork) {
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
}

const box = (page, sel) =>
  page
    .locator(sel)
    .first()
    .evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    });

test.use({ viewport: { width: 1280, height: 800 } });

test('the stacks match the queue, and the top bar and the Inbox give one To Grade', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  const got = await page.evaluate(() => {
    const cid = getActiveCourse();
    const ids = getStudents(cid).map(s => s.id);
    const q = DashInboxQueue.build(cid, { seen: localStorage.getItem('fv-dash-inbox-seen:' + cid) });
    return {
      shown: [...document.querySelectorAll('.dash-inbox-stack')].map(r => ({
        aid: r.getAttribute('data-aid'),
        n: Number(r.querySelector('.dash-inbox-stack-count').textContent),
      })),
      queue: q.stacks.map(p => ({ aid: p.aid, n: p.tograde })),
      sum: [...document.querySelectorAll('.dash-inbox-stack-count')].reduce((n, el) => n + Number(el.textContent), 0),
      topBar: Number(document.querySelector('.dash-glance-tograde .dash-glance-value').textContent),
      classCount: GraderWork.classWorkCounts(cid, ids).tograde,
    };
  });
  expect(got.shown.length).toBeGreaterThan(0);
  expect(got.shown).toEqual(got.queue);
  expect(got.shown[0].aid).toBe(LIGHT);
  expect(got.sum).toBe(got.topBar);
  expect(got.sum).toBe(got.classCount);
  expect(got.topBar).toBeGreaterThan(0);
  // No count in the header; the two-way switch; one link.
  await expect(page.locator('.dash-inbox-head')).not.toContainText(/\d/);
  await expect(page.locator('.dash-inbox-head .dash-view-btn')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-head [data-dash-inbox="mode"][aria-pressed="true"]')).toHaveText('To Grade');
  expect(errors).toEqual([]);
});

test("a stack's title opens the Work Wall", async ({ page }) => {
  await open(page);
  await page.locator('.dash-inbox-stack-title[data-aid="' + LIGHT + '"]').click();
  await expect(page.locator('#work-wall-overlay')).toBeVisible();
  await expect(page.locator('#work-wall-overlay')).toContainText('Light Refraction Lab');
  await page.locator('#work-wall-overlay .ww-back').click();
  await expect(page.locator('#work-wall-overlay')).toHaveCount(0);
  await expect(page.locator('#dash-inbox')).toBeVisible();
});

test('a redraw keeps the tile, the chosen view and an open stack, and asks for no picture twice', async ({ page }) => {
  await open(page);
  await page.locator('.dash-inbox-stack[data-aid="' + LIGHT + '"]').click();
  await expect(page.locator('.dash-inbox-spread')).toBeVisible();
  const pics = page.locator('#dash-inbox img[data-work-pic]');
  await expect
    .poll(async () => pics.evaluateAll(imgs => imgs.filter(i => i.complete && i.naturalWidth > 0).length))
    .toBeGreaterThan(0);
  const n = await pics.count();
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
  await expect(page.locator('#dash-inbox')).toBeVisible();
  await expect(page.locator('.dash-inbox-spread')).toBeVisible();
  expect(await pics.count()).toBe(n);
  await expect.poll(async () => pics.evaluateAll(imgs => imgs.filter(i => i.getAttribute('src')).length)).toBe(n);
  expect(await page.evaluate(() => window.__asked)).toBe(0);
  // The view the teacher chose is the view drawn again.
  await page.locator('[data-dash-inbox="mode"][data-mode="rollcall"]').click();
  await expect(page.locator('.dash-inbox-rollcall')).toBeVisible();
  await page.evaluate(() => PageDashboard.render());
  await expect(page.locator('.dash-inbox-rollcall')).toBeVisible();
  await expect(page.locator('[data-dash-inbox="mode"][data-mode="rollcall"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the tile is 299 px beside Bulletins and the row tall without it, with nothing sideways', async ({ page }) => {
  await open(page);
  expect(Math.round((await box(page, '#dash-inbox')).height)).toBe(299);
  const sideways = await page.evaluate(() => [
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.getElementById('main').scrollWidth - document.getElementById('main').clientWidth,
  ]);
  expect(sideways).toEqual([0, 0]);
  expect(Math.round((await box(page, '.dash-row')).height)).toBe(510);
  await shot(page, 'inbox-299-light');
});

test('with no Bulletins tile the Inbox is the row tall', async ({ page }) => {
  await open(page, { tile: false });
  expect(Math.round((await box(page, '#dash-inbox')).height)).toBe(510);
  await shot(page, 'inbox-510-light');
});

test('dark: the tile draws on the dark surface', async ({ page }) => {
  await open(page, { dark: true, tile: false });
  await shot(page, 'inbox-510-dark');
  await expect(page.locator('#dash-inbox')).toBeVisible();
  const bg = await page.locator('#dash-inbox').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');
});

test('dark beside Bulletins', async ({ page }) => {
  await open(page, { dark: true });
  await shot(page, 'inbox-299-dark');
  expect(Math.round((await box(page, '#dash-inbox')).height)).toBe(299);
});

test("a browser that kept 'fv-build-dashRow' as 0 still gets the row and the Inbox", async ({ page }) => {
  await open(page, { oldFlag: '0' });
  await expect(page.locator('.dash-row')).toHaveCount(1);
  await expect(page.locator('#dash-inbox')).toBeVisible();
});

test('with Send Work off the slot keeps Recent Assessments', async ({ page }) => {
  await open(page, { sendWork: false });
  await expect(page.locator('#dash-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-recent')).toBeVisible();
});
