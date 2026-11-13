/**
 * The Work Wall and the Work tab (S14-F1 to F2). Demo Mode, Science 8, on
 * the sample work of Cell Microscope Lab (shared/seed-data.js), at 1366 x
 * 900. The sample has Send Work off, so each test turns it on; it grades
 * every piece, so a test clears two students' grades to leave work waiting.
 *
 * The plan's done line: the wall for a class loads thumbnails only, until a
 * page is opened. The browser's own requests are counted here.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

async function openDemo(page, { on = true, clear = [] } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  return page.evaluate(
    ({ on, clear, LAB }) => {
      const cid = getActiveCourse();
      const a = getAssessments(cid).find(x => x.id === LAB);
      clear.forEach(sid => {
        const keys = [...new Set((getScores(cid)[sid] || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
        Grader.setOverallComment(cid, sid, LAB, '');
        getRubricCheckIds(cid, sid, LAB).forEach(id => Grader.setTick(cid, sid, LAB, id, false));
        if (keys.length) Grader.clearScore(cid, getScores(cid), sid, a, keys);
      });
      if (on) {
        setStudentPageSwitch(cid, true, 'on_return');
        const work = getCourseSubmissions(cid);
        work.course.send_work = true;
        saveDemoStudentWork(cid, work);
      }
      const c = GraderWork.workCounts(cid, LAB);
      return { cid, toGrade: c.ids.tograde, notIn: c.ids.notin, all: c.all };
    },
    { on, clear, LAB },
  );
}

function sampleWork(page) {
  const seen = [];
  page.on('request', r => {
    const m = /\/assets\/sample-work\/([^?]+)/.exec(r.url());
    if (m) seen.push(m[1]);
  });
  return seen;
}

test('with Send Work off there is no wall and no Work tab', async ({ page }) => {
  const at = await openDemo(page, { on: false });
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  expect(await page.evaluate(({ cid, LAB }) => WorkWall.open(cid, LAB), { cid: at.cid, LAB })).toBe(false);
  await expect(page.locator('#work-wall-overlay')).toHaveCount(0);
  await page.goto('/student?id=st2&course=' + at.cid + '&tab=work');
  await expect(page.locator('.stu-tabs')).toBeVisible();
  await expect(page.locator('#stu-tab-work')).toHaveCount(0);
});

test('the student page on and Send Work off: work that is in still shows', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await openDemo(page, { on: false });
  await page.evaluate(cid => setStudentPageSwitch(cid, true, 'on_return'), at.cid);
  // Nobody is To Grade or Not In: the piece takes nothing while Send Work is off.
  expect(await page.evaluate(({ cid, LAB }) => GraderWork.workCounts(cid, LAB).notin, { cid: at.cid, LAB })).toBe(0);
  await page.goto('/assignments?open=' + LAB);
  await page.waitForSelector('#dock-mount nav');
  // See the Work on a student's row opens the grader on their pages.
  const see = page.locator('#ac-' + LAB + ' .rsg-see-work[data-sid="st2"]');
  await expect(see).toHaveText('See the Work');
  // Pointing at it shows the pages in a card; moving away takes the card off.
  await see.hover();
  const glance = page.locator('.ww-glance .ww-glance-img');
  await expect(glance).toHaveCount(2);
  await expect.poll(() => glance.first().evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  const box = await page.locator('.ww-glance').boundingBox();
  const view = page.viewportSize();
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width && box.y + box.height <= view.height).toBe(true);
  await page.mouse.move(5, 5);
  await expect(page.locator('.ww-glance')).toHaveCount(0);
  await see.click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toHaveClass(/has-work/);
  await expect(dialog.locator('.grader-work-img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // The wall opens for the piece.
  expect(await page.evaluate(({ cid, LAB }) => WorkWall.open(cid, LAB), { cid: at.cid, LAB })).toBe(true);
  await expect(page.locator('#work-wall-overlay .ww-title')).toHaveText('Work Wall');
  await page.evaluate(() => WorkWall.close());
  // The student page: the Work tab, and the pages whole beside the rubric in an open row.
  await page.goto('/student?id=st2&course=' + at.cid + '&tab=overview');
  await expect(page.locator('#stu-tab-work')).toHaveCount(1);
  await page.locator('.stu-ov-row-btn', { hasText: 'Cell Microscope Lab' }).first().click();
  const pages = page.locator('.stu-ov-work .ovw-img');
  await expect(pages).toHaveCount(2);
  await expect.poll(() => pages.first().evaluate(el => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await page.locator('.stu-ov-work .ovw-page').nth(1).click();
  await expect(page.locator('#work-viewer-overlay .wv-at')).toHaveText('2 of 2');
  await page.keyboard.press('Escape');
  await expect(page.locator('#work-viewer-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the wall: thumbnails only, sorting, the level filters, a page, the grader', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await openDemo(page, { clear: ['st2', 'st3'] });
  expect(at.toGrade.length).toBe(2);
  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  const seen = sampleWork(page);
  await page.evaluate(({ cid, LAB }) => WorkWall.open(cid, LAB), { cid: at.cid, LAB });
  const wall = page.locator('#work-wall-overlay');
  await expect(wall.locator('.ww-title')).toHaveText('Work Wall');
  await expect(wall.locator('.ww-card')).toHaveCount(at.all);
  await expect(wall.locator('.ww-pill[data-filter="tograde"]')).toHaveText('To Grade 2');
  await expect(wall.locator('.ww-seg-btn[data-sort="tograde"]')).toHaveAttribute('aria-pressed', 'true');
  // The two waiting come first.
  const first = await wall.locator('.ww-card').evaluateAll(cs => cs.slice(0, 2).map(c => c.dataset.sid));
  expect(first.sort()).toEqual(at.toGrade.slice().sort());
  // Every picture drawn, and every one a thumbnail.
  const pics = wall.locator('.ww-card img');
  const n = await pics.count();
  expect(n).toBeGreaterThan(5);
  await expect.poll(() => pics.evaluateAll(ims => ims.filter(i => i.complete && i.naturalWidth > 0).length)).toBe(n);
  expect(seen.length).toBe(n);
  expect(seen.every(f => /-thumb\.jpg$/.test(f))).toBe(true);
  await shot(page, 'S14-F1-work-wall-1366');

  // Level: headings by level. A level pill shows only its students.
  await wall.locator('.ww-seg-btn[data-sort="level"]').click();
  await expect(wall.locator('.ww-group-head').first()).toBeVisible();
  const prof = wall.locator('.ww-pill[data-filter="3"]');
  const count = Number((await prof.textContent()).replace(/\D/g, ''));
  await prof.click();
  await expect(prof).toHaveAttribute('aria-pressed', 'true');
  await expect(wall.locator('.ww-card')).toHaveCount(count);
  await expect(wall.locator('.ww-group-head')).toHaveText(new RegExp('^Proficient' + count + ' students?$'));
  await shot(page, 'S14-F1-work-wall-proficient-1366');
  await prof.click();
  await expect(wall.locator('.ww-card')).toHaveCount(at.all);
  // Sorting and filtering asked for nothing new.
  expect(seen.length).toBe(n);

  // A card opens that student's page full size: the one page asked for.
  await wall.locator('.ww-pill[data-filter="tograde"]').click();
  await wall.locator('.ww-card').first().click();
  const viewer = page.locator('#work-viewer-overlay');
  await expect(viewer.locator('.wv-img')).toBeVisible();
  await expect.poll(() => viewer.locator('.wv-img').evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  expect(seen.slice(n).length).toBe(1);
  expect(seen[n]).not.toMatch(/-thumb\.jpg$/);
  await shot(page, 'S14-F1-work-wall-page-1366');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // Grade in This Order: the grader on the two waiting, then back to the wall.
  await wall.locator('.ww-grade').click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  await page.locator('#grader-overlay [data-grader="close"]').first().click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  await expect(wall.locator('.ww-title')).toBeVisible();
  await wall.locator('.ww-back').click();
  await expect(wall).toHaveCount(0);
  // The Assignments page still answers.
  await expect(page.locator('#main')).toBeVisible();
  expect(errors).toEqual([]);
});

test("the Work tab: one student's work, thumbnails only", async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await openDemo(page, { clear: ['st2'] });
  const seen = sampleWork(page);
  await page.goto('/student?id=st2&course=' + at.cid + '&tab=work');
  const tile = page.locator('#stu-tab-work');
  await expect(tile).toHaveAttribute('aria-selected', 'true');
  // A piece to grade is the tab's blue badge, in place of its count.
  await expect(tile.locator('.stu-tab-badge.todo')).toHaveText('1 to Grade');
  const card = page.locator('.sw-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.sw-title')).toHaveText('Cell Microscope Lab');
  await expect(card.locator('.ww-chip')).toHaveText('To Grade');
  await expect.poll(() => card.locator('img').evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  expect(seen.length).toBe(1);
  expect(seen[0]).toMatch(/-thumb\.jpg$/);
  await shot(page, 'S14-F2-work-tab-1366');
  await page.locator('[data-sw="full"]').click();
  const viewer = page.locator('#work-viewer-overlay');
  await expect(viewer.locator('.wv-at')).toHaveText('1 of 2');
  await viewer.locator('[data-wv="grade"]').click();
  await expect(page.locator('#grader-overlay .grader-dialog')).toBeVisible();
  await page.locator('#grader-overlay [data-grader="close"]').first().click();
  await expect(page.locator('#stu-tab-work')).toBeVisible();
  expect(errors).toEqual([]);
});
