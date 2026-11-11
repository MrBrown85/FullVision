import { test, expect } from '@playwright/test';

/* The Learner Profile's "How … Sees Their Learning" (redesign R6): each
   competency the student rated in a reflection, their rating beside the
   teacher's level, and a note when they are a step apart. Demo Mode, Mei
   Wong (st23) in Science 8. */

test('a student’s own rating sits beside the teacher’s level', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const names = await page.evaluate(() => {
    const r = getReflections('sci8');
    const secs = getSections('sci8');
    r.st23 = r.st23 || {};
    // Rated at the teacher's level, then a step below it.
    [secs[0], secs[1]].forEach((sec, i) => {
      const lv = Math.max(1, Math.min(4, roundLevel(getSectionProficiency('sci8', 'st23', sec.id))));
      r.st23[sec.id] = { confidence: i ? Math.max(1, lv - 1) : lv, text: '', date: '2026-11-01' };
    });
    saveReflections('sci8', r);
    return [secs[0].name, secs[1].name];
  });
  await page.evaluate(() => window.Router.navigate('/student?id=st23&course=sci8&tab=profile'));
  const calib = page.locator('#lp-calib');
  await expect(calib.locator('h2')).toHaveText('How Mei Sees Their Learning');
  const rows = calib.locator('.lp-calib-row:not(.lp-calib-head):not(.lp-calib-unrated)');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(names[0]);
  await expect(rows.nth(0).locator('.lp-calib-note')).toHaveText('You agree.');
  await expect(rows.nth(1).locator('.lp-calib-note')).toHaveText('Rates themselves lower. Show them the evidence.');
  await expect(rows.nth(1).locator('.lp-scale.own')).toHaveAttribute('aria-label', /^Mei says /);
});
