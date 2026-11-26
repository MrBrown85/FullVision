/**
 * A click inside one Dashboard tile redraws only that tile. Every element in #main is marked, the click is made, and
 * what the click did not touch must be the very same elements. Demo Mode, Science 8, the student page and Send Work on.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

async function open(page) {
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
  await page.locator('.dash-inbox-stack').first().waitFor();
  await page.locator('.dash-card').first().waitFor();
}

const mark = page => page.evaluate(() => document.querySelectorAll('#main *').forEach(el => (el.__kept = 1)));

// Of the elements inside each selector, the share that are still the marked ones (-1: the selector is not on the page).
const kept = (page, selectors) =>
  page.evaluate(sels => {
    const out = {};
    for (const s of sels) {
      const els = [...document.querySelectorAll(s + ', ' + s + ' *')];
      out[s] = els.length ? els.filter(el => el.__kept === 1).length / els.length : -1;
    }
    return out;
  }, selectors);

const ALL = ['.dash-glance', '#dash-inbox', '.dash-row-bulletins', '.dash-row-comp', '#dash-students'];
const without = (...gone) => ALL.filter(s => !gone.includes(s));
async function expectKept(page, selectors) {
  const k = await kept(page, selectors);
  for (const s of selectors) expect(k[s], s).toBe(1);
}

test('Roll Call and To Grade, opening and closing a stack, redraw only the Inbox', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  await mark(page);
  await page.locator('.dash-inbox-switch [data-mode="rollcall"]').click();
  await expect(page.locator('.dash-inbox-switch [data-mode="rollcall"]')).toHaveAttribute('aria-pressed', 'true');
  await expectKept(page, without('#dash-inbox'));
  await page.locator('.dash-inbox-switch [data-mode="stacks"]').click();
  await expect(page.locator('.dash-inbox-switch [data-mode="stacks"]')).toHaveAttribute('aria-pressed', 'true');
  await expectKept(page, without('#dash-inbox'));
  await page.locator('.dash-inbox-stack').first().waitFor();
  await mark(page);
  await page.locator('[data-dash-inbox="stack-open"]').first().click();
  await expect(page.locator('[data-dash-inbox="stack-close"]').first()).toBeVisible();
  await expectKept(page, without('#dash-inbox'));
  await mark(page);
  await page.locator('[data-dash-inbox="stack-close"]').first().click();
  await expect(page.locator('[data-dash-inbox="stack-close"]')).toHaveCount(0);
  await expectKept(page, without('#dash-inbox'));
  expect(errors).toEqual([]);
});

test('This Term | Year on Competencies redraws only that tile', async ({ page }) => {
  await open(page);
  await mark(page);
  const year = page.locator('#dash-comp-page-curricular .dash-comp-span .seg-btn').nth(1);
  await year.click();
  await expect(page.locator('#dash-comp-page-curricular .dash-comp-span .seg-btn').nth(1)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectKept(page, without('.dash-row-comp'));
  await expect(page.locator('#dash-comp-span-curricular-year')).toBeFocused();
});

test('Flagging a student redraws that one card and the Flagged count', async ({ page }) => {
  await open(page);
  await mark(page);
  const cards = page.locator('.dash-card');
  const n = await cards.count();
  await cards.nth(3).locator('.dash-flag-btn').click();
  await expect(cards.nth(3)).toHaveClass(/flagged/);
  await expect(page.locator('.dash-show [data-n="flagged"]')).toHaveText('1');
  const left = await page.evaluate(() => [...document.querySelectorAll('.dash-card')].map(el => el.__kept === 1));
  expect(left.length).toBe(n);
  // The other cards are the same elements (the clicked card may be redrawn or changed in place).
  expect(left.filter((k, i) => i !== 3 && !k)).toEqual([]);
  await expectKept(page, without('#dash-students'));
  await expect(page.locator('#dash-students .dash-flag-btn.is-on')).toHaveCount(1);
  // And back off.
  await cards.nth(3).locator('.dash-flag-btn').click();
  await expect(page.locator('.dash-show [data-n="flagged"]')).toHaveCount(0);
  await expect(page.locator('#dash-students .dash-flag-btn.is-on')).toHaveCount(0);
});
