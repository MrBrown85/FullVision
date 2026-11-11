/**
 * The phone's Grade tab with student work (S7-F1, S7-F2): To Grade first,
 * the row menu, All Caught Up, the filter that applies as you tap, and the
 * speed grader with the work's pages, the pinned strip and only the work
 * waiting. Demo Mode, Science 8, on the sample work of Cell Microscope Lab
 * (shared/seed-data.js), at 375 x 812.
 *
 * The sample grades every piece, so nothing waits to grade until a test
 * clears a student's grade; with the build switch off the phone is as it
 * was and none of this is drawn.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const LAB = 'sci8a1'; // Cell Microscope Lab: Students Send Photos
const SHOTS = process.env.FV_SHOTS || '';

async function openPhone(page, { on = true, clear = [] } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(
    ({ on, clear, LAB }) => {
      const cid = getActiveCourse();
      if (on) setStudentPageSwitch(cid, true, 'on_return');
      const a = getAssessments(cid).find(x => x.id === LAB);
      // Clear the grades of the students named, so their work waits.
      clear.forEach(sid => {
        Grader.clearScore(cid, getScores(cid), sid, a);
        Grader.setOverallComment(cid, sid, LAB, '');
      });
    },
    { on, clear, LAB },
  );
  await page.reload();
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
}

async function openGradeTab(page) {
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
}

const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('with the build switch off, the Grade tab opens on Recent and shows no work', async ({ page }) => {
  await openPhone(page, { on: false, clear: ['st2'] });
  await openGradeTab(page);
  await expect(page.locator('.m-seg-btn[data-val="recent"]')).toHaveClass(/m-seg-active/);
  await expect(page.locator('.m-seg-btn[data-val="tograde"]')).toHaveCount(0);
  await expect(page.locator('.m-tg-row')).toHaveCount(0);
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + LAB + '"]').click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await expect(page.locator('.m-work')).toHaveCount(0);
});

test('nothing waiting: All Caught Up, and See All Assessments', async ({ page }) => {
  await openPhone(page);
  await openGradeTab(page);
  await expect(page.locator('.m-seg-btn[data-val="tograde"]')).toHaveClass(/m-seg-active/);
  await expect(page.locator('#m-grade-caught')).toBeVisible();
  await expect(page.locator('#m-grade-caught')).toContainText('All Caught Up');
  await expect(page.locator('#m-grade-caught')).toContainText('Nothing is waiting to grade in Science 8.');
  await shot(page, 'S7-F1-all-caught-up');
  await page.locator('#m-grade-caught [data-val="all"]').click();
  await expect(page.locator('#m-grade-caught')).toBeHidden();
  await expect(page.locator('.m-tg-row[data-aid="' + LAB + '"]')).toBeVisible();
});

test('To Grade first, the row menu, and grading only the work waiting', async ({ page }) => {
  await openPhone(page, { clear: ['st2', 'st3'] });
  await openGradeTab(page);
  const seg = page.locator('.m-seg-btn[data-val="tograde"]');
  await expect(seg).toContainText('To Grade');
  await expect(seg.locator('.m-seg-count')).toHaveText('2');
  const row = page.locator('.m-tg-row[data-aid="' + LAB + '"]');
  await expect(row).toBeVisible();
  await expect(row.locator('.m-tg-pill')).toHaveText('2 to grade');
  await expect(row.locator('.m-tg-notin')).toContainText('not in');
  await shot(page, 'S7-F1-to-grade-first');

  await row.locator('[data-action="m-grade-row-menu"]').click();
  const menu = page.locator('#m-sheet-container .m-tg-menu');
  await expect(menu).toContainText('Grade the 2 Waiting');
  await expect(menu).toContainText('Starts with Noor Al-Rashid');
  await expect(menu).toContainText('Grade Everyone');
  await shot(page, 'S7-F1-row-menu');
  await menu.locator('[data-only="tograde"]').click();

  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await expect(page.locator('#m-thumb-strip .m-thumb')).toHaveCount(2);
  await expect(page.locator('#m-nav-bar-grade-swiper')).toContainText('1 of 2 to grade');
  const card = page.locator('.m-swiper-card').first();
  await expect(card.locator('.m-work-sent')).toContainText('Submitted');
  await expect(card.locator('.m-work-sent')).toContainText('2 photos');
  await expect(card.locator('.m-work-note')).toHaveText('Page 2 has my answers.');
  await expect(card.locator('.m-work-page img').first()).toHaveAttribute('src', /sample-work\/cell-lab-noor-1\.jpg$/);
  await expect(card.locator('.m-work-dot')).toHaveCount(2);
  await page.waitForTimeout(400);
  await shot(page, 'S7-F2-speed-grader-photos');

  // Scrolled: the pages pin as a strip at the top of the card.
  await card.evaluate(c => (c.scrollTop = c.scrollHeight));
  await expect(card.locator('.m-work-pin')).toHaveClass(/is-on/);
  await expect(card.locator('.m-work-pin-btn')).toHaveAttribute('aria-label', 'Show Noor’s photos');
  await shot(page, 'S7-F2-photo-pinned');
  await card.locator('.m-work-pin-btn').click();
  await expect(card.locator('.m-work-pin')).not.toHaveClass(/is-on/);

  // Full screen: every page.
  await card.locator('.m-work-full').click();
  await expect(page.locator('#m-sheet-container .m-work-sheet-page')).toHaveCount(2);
});

test('the filter applies as you tap', async ({ page }) => {
  await openPhone(page, { clear: ['st2'] });
  await openGradeTab(page);
  await page.locator('.m-seg-btn[data-val="all"]').click();
  const total = await page.evaluate(() => getAssessments(getActiveCourse()).length);
  await page.locator('[data-action="m-grade-filter-open"]').click();
  const sheet = page.locator('#m-sheet-container .m-live-filter');
  await expect(sheet.locator('.m-live-filter-count')).toHaveText('Showing ' + total + ' of ' + total);
  await sheet.locator('[data-kind="gradedStatus"][data-val="has-ungraded"]').click();
  // The list under the sheet changes at once.
  const shown = await page.locator('#m-grade-list .m-cell:visible').count();
  await expect(sheet.locator('.m-live-filter-count')).toHaveText('Showing ' + shown + ' of ' + total);
  await expect(sheet.locator('[data-val="has-ungraded"]')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'S7-F1-filter-live');
  // Tapped again, it lets go.
  await sheet.locator('[data-val="has-ungraded"]').click();
  await expect(sheet.locator('.m-live-filter-count')).toHaveText('Showing ' + total + ' of ' + total);
  await sheet.locator('[data-action="m-grade-filter-done"]').click();
  await expect(sheet).toHaveCount(0);
});
