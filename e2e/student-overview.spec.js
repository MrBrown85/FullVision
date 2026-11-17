/**
 * The student Overview pictures the grade (DECISIONS, "The student Overview
 * pictures the grade (2026-11-17)"). Demo Mode, Science 8: the grade's line
 * over the year with what is behind each day, the competencies pointing at
 * the days they were assessed, a competency narrowing All Your Work, the
 * Missing tile showing the missing work, and each piece's feedback open to
 * read without a click. At a desk and on an iPad held upright.
 */
import { test, expect } from '@playwright/test';

async function openStudent(page, first) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(name => getStudents('sci8').find(s => s.firstName === name).id, first);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&course=sci8&tab=overview');
  await page.locator('.stu-gp').waitFor();
  return sid;
}

test('the grade over the year and the competencies point at each other', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openStudent(page, 'Sam');
  await expect(page.locator('.stu-ov-todo, .stu-ov-better')).toHaveCount(0);

  // One point a day work counted, then today; the last is now.
  const points = page.locator('.stu-gp-pt');
  expect(await points.count()).toBeGreaterThan(10);
  await expect(points.last()).toHaveAttribute('aria-label', /^Today: \d\.\d Proficient/);

  // Pointing at a day: what was assessed, and the competencies it counted toward light up.
  const day = page.locator('.stu-gp-pt[data-secs]:not([data-secs=""])').first();
  await day.hover();
  await expect(day.locator('.stu-gp-tip')).toBeVisible();
  await expect(page.locator('.stu-gp')).toHaveClass(/linking/);
  const lit = await page.locator('.stu-gp-tile.hl').count();
  expect(lit).toBeGreaterThan(0);
  await page.mouse.move(2, 2);
  await expect(page.locator('.stu-gp')).not.toHaveClass(/linking/);

  // A competency narrows All Your Work to its work; its chip puts everything back.
  const all = await page.locator('.stu-ov-all .stu-ov-item').count();
  const tile = page.locator('.stu-gp-tile:not([disabled])').first();
  const n = (await tile.getAttribute('data-aids')).split(' ').length;
  await tile.click();
  await expect(page.locator('.stu-ov-all .stu-ov-item')).toHaveCount(n);
  await expect(page.locator('.stu-gp-tile[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('.stu-ov-comp-chip').click();
  await expect(page.locator('.stu-ov-all .stu-ov-item')).toHaveCount(all);

  // A day's work is shown below when the day is clicked.
  await day.click();
  const aid = (await day.getAttribute('data-aids')).split(' ')[0];
  await expect(page.locator('#stu-ov-row-' + aid)).toBeInViewport();

  // The feedback reads without a click: a Single-Point Rubric's Work On, with each criterion's level.
  const journal = page.locator('.stu-ov-item', { hasText: 'Biodiversity Field Journal' });
  await expect(journal.locator('.stu-ov-fb-crit')).toHaveCount(3);
  await expect(journal.locator('.stu-ov-fb-part.work')).toContainText('Work On');
  await expect(page.locator('.stu-ov-row-btn')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the Missing tile shows the missing work', async ({ page }) => {
  await openStudent(page, 'Ethan');
  await page.locator('button.stu-ov-miss').click();
  await expect(page.locator('.stu-ov-chip[data-filter="missing"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.stu-ov-all .stu-ov-item')).toHaveCount(1);
  await expect(page.locator('.stu-ov-all .stu-ov-item .stu-ov-pill.miss')).toHaveText('Missing');
});

test('on an iPad held upright, nothing runs off the side', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openStudent(page, 'Sam');
  const wide = await page.evaluate(() => {
    const ov = document.querySelector('.stu-ov');
    const right = ov.getBoundingClientRect().right + 1;
    return Array.from(ov.querySelectorAll('.stu-gp-tile, .stu-gp-x span, .stu-ov-fb-crit, .stu-ov-item-head'))
      .filter(el => el.getBoundingClientRect().right > right)
      .map(el => el.className);
  });
  expect(wide).toEqual([]);
});
