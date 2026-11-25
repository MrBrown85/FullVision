/**
 * The redrawn Inbox with nothing waiting (board R5) and a scan held over it
 * (board R6), slice I4 of docs/plans/inbox-redesign-plan.md. Demo Mode, Science 8, the student page and Send Work on,
 * every piece assessed and returned. Drops are made in the page with a
 * DataTransfer, as e2e/dashboard-inbox-drop.spec.js does. Set FV_SHOTS to a
 * folder to keep pictures.
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import { FONTS, useFont } from './wide-font.js';

test.beforeEach(({ page }) => demoStudentPageOff(page));

const LIGHT = 'sci8a21';
const TARGET = '.dash-inbox-target[data-aid="' + LIGHT + '"]';
const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
};

test.use({ viewport: { width: 1280, height: 800 } });

const EXPIRING = () => {
  window.__expiring = real => {
    let live = true;
    let effect = 'none';
    return {
      get types() {
        return live ? real.types : [];
      },
      get files() {
        return live ? real.files : [];
      },
      get items() {
        return live ? real.items : [];
      },
      get dropEffect() {
        return effect;
      },
      set dropEffect(v) {
        effect = v;
      },
      getData: k => (live ? real.getData(k) : ''),
      end() {
        live = false;
      },
    };
  };
};

// Everything assessed and returned; with `tile: false` no Bulletins slot is drawn.
async function open(page, { tile = true } = {}) {
  await page.addInitScript(EXPIRING);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  if (!tile)
    await page.evaluate(() => {
      DashBulletins.html = () => '';
    });
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    const ids = getStudents(cid).map(s => s.id);
    getAssessments(cid).forEach(a =>
      GraderWork.workCounts(cid, a.id, ids).ids.tograde.forEach(sid =>
        Grader.setOverallComment(cid, sid, a.id, 'Seen.'),
      ),
    );
    getAssessments(cid).forEach(a => {
      const back = GraderWork.workCounts(cid, a.id, ids).ids.toreturn;
      if (back.length) Grader.returnGrades(cid, a.id, back);
    });
    PageDashboard.render();
  });
  await page.locator('#dash-inbox').waitFor();
}

async function files(page) {
  await page.evaluate(() => {
    window.__files = [new File(['x'], 'Period 3 Scan.pdf', { type: 'application/pdf' })];
  });
}

/* A drag event at an element, carrying window.__files; true when the page took it. */
async function drag(page, selector, type) {
  return page.evaluate(
    ({ selector, type }) => {
      const real = new DataTransfer();
      window.__files.forEach(f => real.items.add(f));
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      const at = { clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
      const ev = new DragEvent(type, Object.assign({ bubbles: true, cancelable: true }, at));
      Object.defineProperty(ev, 'dataTransfer', { value: window.__expiring(real) });
      el.dispatchEvent(ev);
      ev.dataTransfer.end();
      return ev.defaultPrevented;
    },
    { selector, type },
  );
}

const box = (page, sel) => page.locator(sel).first().boundingBox();
const tileHeight = async page => Math.round((await box(page, '#dash-inbox')).height);

// Nothing in the tile's header runs past the tile or into its neighbour.
async function headerFits(page) {
  return page.evaluate(() => {
    const tile = document.getElementById('dash-inbox').getBoundingClientRect();
    const head = document.querySelector('#dash-inbox .dash-inbox-head');
    const rects = [...head.children].filter(k => k.getClientRects().length).map(k => k.getBoundingClientRect());
    return {
      inside: rects.every(r => r.left >= tile.left - 0.5 && r.right <= tile.right + 0.5),
      apart: rects.every((r, i) => i === 0 || r.left >= rects[i - 1].right - 0.5),
      fits: head.scrollWidth <= head.clientWidth + 1,
      chips: [...head.querySelectorAll('.dash-inbox-chip')].filter(c => c.getClientRects().length).length,
    };
  });
}

test('nothing waiting: the tile is one 64 px line and Bulletins takes the column', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  expect(await tileHeight(page)).toBe(64);
  const bulletins = await box(page, '.dash-row-bulletins');
  const col = await box(page, '.dash-row-left');
  expect(Math.round(bulletins.height)).toBe(Math.round(col.height - 64 - 12));
  const head = page.locator('#dash-inbox .dash-inbox-head');
  await expect(head.locator('.dash-inbox-title')).toHaveText('Inbox');
  await expect(head.locator('.dash-inbox-switch [aria-pressed="true"]')).toHaveText('To Grade');
  await expect(head.locator('.dash-inbox-caught-up')).toHaveText('All Caught Up');
  await expect(head.locator('[data-dash-inbox="targets-open"]')).toHaveText('Add Work');
  await expect(head.locator('a')).toHaveText('Assignments →');
  await expect(page.locator('#dash-inbox .dash-inbox-action', { hasText: 'Start Grading' })).toHaveCount(0);
  await expect(page.locator('#dash-inbox .dash-inbox-targets:visible')).toHaveCount(0);
  // At this width the chips do not fit beside the rest, so none is drawn: the rest is never cut instead.
  await expect(page.locator('.dash-inbox-chip:visible')).toHaveCount(0);
  // Wider, the chips are the pieces still taking work (two at most); a click shows Roll Call on one.
  const taking = await page.evaluate(() => DashInboxQueue.build(getActiveCourse(), {}).taking.slice(0, 2));
  expect(taking.length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1700, height: 900 });
  const chips = page.locator('.dash-inbox-chip:visible');
  await expect(chips).toHaveCount(taking.length);
  await expect(chips.first()).toContainText(taking[0].notin + ' Not In');
  await expect(chips.first()).toHaveAttribute('aria-label', new RegExp(taking[0].title));
  await shot(page, 'r5-wide');
  await chips.first().click();
  await expect(page.locator('.dash-inbox-rollcall')).toBeVisible();
  await expect(page.locator('#dash-inbox.is-quiet')).toHaveCount(0);
  await page.locator('.dash-inbox-switch [data-mode="stacks"]').click();
  await expect(page.locator('#dash-inbox.is-quiet')).toHaveCount(1);
  await shot(page, 'r5-sample');
  expect(errors).toEqual([]);
});

test('files held over the line open the targets; a drop on one opens Add Work for that piece', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  await files(page);
  const list = await page.evaluate(() => DashInboxDrop.choices(getActiveCourse(), 7).map(c => c.label));
  expect(list.length).toBeGreaterThanOrEqual(2);
  const stored = () => page.evaluate(() => JSON.stringify(getCourseSubmissions(getActiveCourse()).submissions));
  const before = await stored();

  await drag(page, '#dash-inbox', 'dragenter');
  expect(await drag(page, '#dash-inbox', 'dragover')).toBe(true);
  const targets = page.locator('#dash-inbox .dash-inbox-target');
  await expect(targets).toHaveCount(list.length + 1);
  // The tile has opened to its usual share of the column.
  await expect.poll(() => tileHeight(page)).toBeGreaterThan(200);
  // The pieces Add Work For lists, in its order, then Another Assessment.
  expect(await targets.locator('.dash-inbox-target-title').allTextContents()).toEqual([...list, 'Another Assessment']);
  // The one under the pointer is lit.
  await drag(page, TARGET, 'dragover');
  await expect(page.locator(TARGET)).toHaveClass(/is-over/);
  await shot(page, 'r6-sample');

  expect(await drag(page, TARGET, 'drop')).toBe(true);
  const awc = page.locator('#add-work-class-overlay');
  await expect(awc).toBeVisible();
  await expect(awc).toContainText('Light Refraction Lab');
  // The line is back, and nothing is saved.
  await expect.poll(() => tileHeight(page)).toBe(64);
  expect(await stored()).toBe(before);
  expect(errors).toEqual([]);
});

test('the targets close again when the drag leaves', async ({ page }) => {
  await open(page);
  await files(page);
  await drag(page, '#dash-inbox', 'dragenter');
  await expect(page.locator('#dash-inbox .dash-inbox-targets:visible')).toHaveCount(1);
  await drag(page, '#dash-inbox', 'dragleave');
  await expect(page.locator('#dash-inbox .dash-inbox-targets:visible')).toHaveCount(0);
  await expect.poll(() => tileHeight(page)).toBe(64);
});

test('Add Work opens the targets; the close button and Escape put the line back; a click opens Add Work', async ({
  page,
}) => {
  await open(page);
  const add = page.locator('[data-dash-inbox="targets-open"]');
  await add.click();
  await expect(page.locator('#dash-inbox .dash-inbox-targets:visible')).toHaveCount(1);
  await expect.poll(() => tileHeight(page)).toBeGreaterThan(200);
  await expect(page.locator('.dash-inbox-target').first()).toBeFocused();
  await page.locator('.dash-inbox-targets-close').click();
  await expect.poll(() => tileHeight(page)).toBe(64);
  await expect(add).toBeFocused();
  await add.click();
  await page.keyboard.press('Escape');
  await expect.poll(() => tileHeight(page)).toBe(64);
  // A click on a target opens Add Work for the Class on that piece, with no files.
  await add.click();
  await page.locator(TARGET).click();
  await expect(page.locator('#add-work-class-overlay')).toContainText('Light Refraction Lab');
  await expect(page.locator('#add-work-class-overlay .awt-item')).toHaveCount(0);
});

test('Another Assessment goes to Assignments', async ({ page }) => {
  await open(page);
  await page.locator('[data-dash-inbox="targets-open"]').click();
  await page.locator('[data-dash-inbox="target-other"]').click();
  await expect(page).toHaveURL(/\/assignments/);
});

test('with no Bulletins under it the tile keeps the column and the targets are its body', async ({ page }) => {
  await open(page, { tile: false });
  await page.evaluate(() => PageDashboard.render());
  const tile = await box(page, '#dash-inbox');
  const col = await box(page, '.dash-row-left');
  expect(Math.round(tile.height)).toBe(Math.round(col.height));
  await expect(page.locator('#dash-inbox.is-quiet .dash-inbox-caught-up')).toBeVisible();
  const n = await page.evaluate(() => DashInboxDrop.choices(getActiveCourse(), 7).length);
  await expect(page.locator('#dash-inbox .dash-inbox-targets.is-rest .dash-inbox-target')).toHaveCount(n + 1);
  await expect(page.locator(TARGET)).toBeVisible();
  await shot(page, 'r5-rest');
  // A drop there reaches Add Work for the piece.
  await files(page);
  await drag(page, TARGET, 'dragover');
  await expect(page.locator(TARGET)).toHaveClass(/is-over/);
  await drag(page, TARGET, 'drop');
  await expect(page.locator('#add-work-class-overlay')).toContainText('Light Refraction Lab');
});

for (const size of [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
]) {
  for (const font of FONTS) {
    test('nothing overflows at ' + size.width + '×' + size.height + ' in the ' + font + ' font', async ({ page }) => {
      await page.setViewportSize(size);
      await open(page);
      await useFont(page, font);
      const fit = await headerFits(page);
      expect(fit, JSON.stringify(fit)).toMatchObject({ inside: true, apart: true, fits: true });
      // The switch, All Caught Up, Add Work and the link are never the ones left out.
      for (const sel of [
        '.dash-inbox-switch',
        '.dash-inbox-caught-up',
        '[data-dash-inbox="targets-open"]',
        '.dash-inbox-head a',
      ])
        await expect(page.locator('#dash-inbox ' + sel)).toBeVisible();
      expect(await tileHeight(page)).toBe(64);
      // Opened, the targets stay inside the tile and the page does not scroll sideways.
      await page.locator('[data-dash-inbox="targets-open"]').click();
      await expect.poll(() => tileHeight(page)).toBeGreaterThan(150);
      await page.waitForTimeout(300);
      const inside = await page.evaluate(() => {
        const tile = document.getElementById('dash-inbox').getBoundingClientRect();
        return {
          across: document.documentElement.scrollWidth <= window.innerWidth,
          targets: [...document.querySelectorAll('.dash-inbox-target')].every(t => {
            const r = t.getBoundingClientRect();
            return r.right <= tile.right + 0.5 && r.left >= tile.left - 0.5;
          }),
        };
      });
      expect(inside).toEqual({ across: true, targets: true });
    });
  }
}
