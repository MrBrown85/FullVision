/**
 * Demo Mode's sample as it is, with work waiting (ruling 115, "Add one
 * piece"): Light Refraction Lab in Science 8 (shared/seed-data.js). With
 * the build switch and Send Work on, and Demo Mode opened again, Maya's and
 * Liv's work is a draft. Every screen's number is read from GraderWork,
 * the one count, so the screens cannot disagree with it or with each
 * other: the dashboard's cell, the gradebook, the Assignments page, the
 * grader's Show bar, the Work Wall, and the phone's Grade tab. Nothing in
 * the sample is changed by the test before it reads.
 */
import { test, expect } from '@playwright/test';

const LIGHT = 'sci8a21'; // Light Refraction Lab
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

// The build switch and Send Work on, as Class Settings › Student Page turns them on.
const turnOn = () => {
  const cid = getActiveCourse();
  setStudentPageSwitch(cid, true, 'on_return');
  const work = getCourseSubmissions(cid);
  work.course.send_work = true;
  saveDemoStudentWork(cid, work);
};

// The one count, for the piece and the class.
const counts = LIGHT => {
  const cid = getActiveCourse();
  const c = GraderWork.workCounts(cid, LIGHT);
  return {
    cid,
    piece: { tograde: c.tograde, toreturn: c.toreturn, returned: c.returned, notin: c.notin, groups: c.groups },
    ids: c.ids,
    classToGrade: GraderWork.classWorkCounts(cid).tograde,
  };
};

test.describe('desktop, 1366 wide', () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test('To Grade and To Return on every screen, from the one count', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => getCourseSubmissions('sci8').submissions.length === 16, null, {
      timeout: 15000,
    });
    await page.evaluate(turnOn);
    // Demo Mode opened again: the class holds grades now, so the drafts are made.
    await page.goto('/dashboard');
    await page.waitForFunction(() => GradeState.draftsWaiting('sci8') === 2, null, { timeout: 15000 });
    const at = await page.evaluate(counts, LIGHT);
    // The sample: Ines, Sofia, Marcus and Aiden's pair to grade; Maya and Liv drafts; the rest not in.
    expect(at.piece).toEqual({ tograde: 4, toreturn: 2, returned: 0, notin: 20, groups: 1 });
    expect(at.ids.tograde).toEqual(['st11', 'st12', 'st14', 'st16', 'st17']);
    expect(at.ids.toreturn).toEqual(['st19', 'st20']);
    expect(at.classToGrade).toBe(at.piece.tograde);

    const cell = page.locator('.dash-glance-tograde');
    await expect(cell.locator('.dash-glance-value')).toHaveText(String(at.classToGrade));
    await expect(cell.locator('.dash-glance-sub')).toContainText('Not Returned');

    await page.goto('/gradebook');
    await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
    await expect(page.locator('.gb-to-grade-btn')).toHaveText(new RegExp('^' + at.classToGrade + ' to grade'));
    await expect(page.locator('.gb-scores-cell[data-aid="' + LIGHT + '"] .gb-to-grade')).toHaveCount(
      at.ids.tograde.length,
    );

    await page.goto('/assignments');
    await expect(page.locator('.assess-tograde-n')).toHaveText(String(at.classToGrade));

    // The grader on the first student waiting: the work pane and the Show bar.
    await page.goto('/gradebook');
    await page.waitForSelector('#dock-mount nav', { timeout: 10000 });
    const first = page.locator('.gb-scores-cell[data-sid="' + at.ids.tograde[0] + '"][data-aid="' + LIGHT + '"]');
    await first.scrollIntoViewIfNeeded();
    await first.click();
    const dialog = page.locator('#grader-overlay .grader-dialog');
    await expect(dialog).toHaveClass(/has-work/);
    await expect(dialog.locator('.grader-show [data-show="tograde"]')).toHaveText(
      new RegExp('To Grade\\s*' + at.piece.tograde),
    );
    await expect(dialog.locator('.grader-show [data-show="toreturn"]')).toHaveText(
      new RegExp('To Return\\s*' + at.piece.toreturn),
    );
    await expect(dialog.locator('.grader-show [data-show="notin"]')).toHaveText(
      new RegExp('Not In\\s*' + at.piece.notin),
    );
    await expect(dialog.locator('img').first()).toHaveAttribute('src', /sample-work\/light-lab-ines-1\.jpg$/);
    await page.waitForTimeout(400);
    await shot(page, 'Demo-sample-grader-to-grade-1366');
    await dialog.locator('.grader-show [data-show="toreturn"]').click();
    await expect(dialog.locator('.grader-show [data-show="toreturn"]')).toHaveAttribute('aria-pressed', 'true');
    await shot(page, 'Demo-sample-grader-to-return-1366');
    await dialog.locator('[data-grader="close"]').click();

    await page.goto('/assignments');
    await page.evaluate(aid => WorkWall.open(getActiveCourse(), aid), LIGHT);
    const wall = page.locator('#work-wall-overlay');
    await expect(wall.locator('.ww-pill[data-filter="tograde"]')).toHaveText('To Grade ' + at.piece.tograde);
    await shot(page, 'Demo-sample-work-wall-1366');
    expect(errors).toEqual([]);
  });
});

test.describe('phone, 375 wide', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('the Grade tab opens on To Grade, from the one count', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/teacher-mobile\//);
    await page.waitForFunction(() => getCourseSubmissions('sci8').submissions.length === 16, null, {
      timeout: 15000,
    });
    await page.evaluate(turnOn);
    await page.reload();
    await page.waitForFunction(() => GradeState.draftsWaiting('sci8') === 2, null, { timeout: 15000 });
    const at = await page.evaluate(counts, LIGHT);
    expect(at.piece).toEqual({ tograde: 4, toreturn: 2, returned: 0, notin: 20, groups: 1 });
    expect(await page.evaluate(() => MGradePhotos.classToGrade('sci8'))).toBe(at.classToGrade);

    await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
    await page.locator('.m-tab-item[data-tab="grade"]').click();
    await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
    const seg = page.locator('.m-seg-btn[data-val="tograde"]');
    await expect(seg).toHaveClass(/m-seg-active/);
    await expect(seg.locator('.m-seg-count')).toHaveText(String(at.classToGrade));
    const row = page.locator('.m-tg-row[data-aid="' + LIGHT + '"]');
    await expect(row.locator('.m-tg-pill')).toHaveText(at.piece.tograde + ' to grade');
    await expect(row.locator('.m-tg-notin')).toHaveText(at.piece.notin + ' not in');
    await expect(page.locator('#m-grade-caught')).toBeHidden();
    await shot(page, 'Demo-sample-phone-to-grade-375');

    // The speed grader on the work waiting.
    await row.locator('[data-action="m-grade-row-menu"]').click();
    await page.locator('#m-sheet-container .m-tg-menu [data-only="tograde"]').click();
    await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
    const card = page.locator('.m-swiper-card').first();
    await expect(card.locator('.m-work-sent')).toContainText('Submitted');
    await page.waitForTimeout(400);
    await shot(page, 'Demo-sample-phone-speed-grader-375');
  });
});
