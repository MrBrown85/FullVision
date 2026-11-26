/**
 * The Assignments toolbar keeps its parts (teacher/keep-dom.js; Colin,
 * Nov 26). Choosing a Show option, or opening another assessment's card,
 * used to draw the whole bar again: the search box, the buttons and the
 * slider flashed, and the keyboard was lost. Now the same elements stay,
 * the lit segment and the counts change in place, and the search box keeps
 * its text and the keyboard. Demo Mode, Science 8 with its Student Page on.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDemo(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
  });
  await page.goto('/assignments');
  await expect(page.locator('.atb-show')).toBeVisible();
}

// Marks every element in the toolbar mount.
const mark = page =>
  page.evaluate(() => document.querySelectorAll('#page-toolbar-mount *').forEach(el => (el.__kept = 1)));

// What is in the toolbar now that was not marked: a part drawn new.
const drawnNew = (page, outsideMenus = false) =>
  page.evaluate(
    outside =>
      [...document.querySelectorAll('#page-toolbar-mount *')]
        .filter(el => !el.__kept && !(outside && el.closest('.assess-menu')))
        .map(el => el.tagName + '.' + String(el.className)),
    outsideMenus,
  );

test('choosing a Show option keeps every part of the toolbar', async ({ page }) => {
  await openDemo(page);
  const options = await page.locator('.atb-show .seg-btn').evaluateAll(bs => bs.map(b => b.dataset.show));
  expect(options.length).toBeGreaterThan(2);
  for (const show of [...options, 'all']) {
    await mark(page);
    await page.locator('.atb-show [data-show="' + show + '"]').click();
    expect(await drawnNew(page), 'after ' + show).toEqual([]);
    await expect(page.locator('.atb-show [aria-pressed="true"]')).toHaveAttribute('data-show', show);
  }
});

test('the search box keeps its text and the keyboard through the Show bar', async ({ page }) => {
  await openDemo(page);
  const input = page.locator('.assess-search-input');
  await input.click();
  await page.keyboard.type('s');
  await expect(input).toHaveValue('s');
  await mark(page);
  for (const show of ['submitted', 'tograde', 'notin', 'all']) {
    // The click moves the keyboard to the button; the box itself is untouched.
    await page.locator('.atb-show [data-show="' + show + '"]').click();
    await expect(input).toHaveValue('s');
    expect(await drawnNew(page), 'after ' + show).toEqual([]);
  }
  await input.click();
  await page.keyboard.type('c');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('sc');
});

test('the keyboard stays on a Show option after it is chosen', async ({ page }) => {
  await openDemo(page);
  const tograde = page.locator('.atb-show [data-show="tograde"]');
  await mark(page);
  await tograde.focus();
  await page.keyboard.press('Enter');
  await expect(tograde).toBeFocused();
  expect(await page.evaluate(() => document.activeElement.__kept)).toBe(1);
});

test('the lit pill still glides to the new option', async ({ page }) => {
  await openDemo(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    window.__glides = 0;
    new MutationObserver(rs =>
      rs.forEach(r => r.addedNodes.forEach(n => n.classList && n.classList.contains('seg-glide') && window.__glides++)),
    ).observe(document.querySelector('.atb-show'), { childList: true });
  });
  await page.locator('.atb-show [data-show="notin"]').click();
  await expect.poll(() => page.evaluate(() => window.__glides)).toBeGreaterThan(0);
  await expect(page.locator('.atb-show [aria-pressed="true"]')).toHaveAttribute('data-show', 'notin');
  await expect(page.locator('.atb-show .seg-glide')).toHaveCount(0);
});

test('opening and closing another assessment keeps the toolbar', async ({ page }) => {
  await openDemo(page);
  const headers = page.locator('.assess-header');
  for (const show of ['all', 'tograde']) {
    if (show !== 'all') await page.locator('.atb-show [data-show="' + show + '"]').click();
    const n = Math.min(await headers.count(), 3);
    for (let i = 0; i < n; i++) {
      await mark(page);
      await headers.nth(i).click();
      // Only the More menu's Expand All and Collapse All come and go with the cards.
      const fresh = await drawnNew(page, true);
      expect(fresh, 'card ' + i + ' in ' + show).toEqual([]);
    }
  }
});

// Observations had no such problem: its bar already changes in place. This
// holds it there. Only the filter chips (drawn from the filters) are new.
test('the Observations toolbar keeps its parts for All and Open Concerns', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0 && getOpenConcerns('sci8').length > 0);
  await page.goto('/observations?course=sci8');
  await expect(page.locator('.obs-toolbar .atb-show')).toBeVisible();
  const input = page.locator('.obs-toolbar input[type="text"]').first();
  await input.click();
  await page.keyboard.type('s');
  const marked = () => page.evaluate(() => document.querySelectorAll('.obs-toolbar *').forEach(el => (el.__kept = 1)));
  const fresh = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.obs-toolbar *')]
        .filter(el => !el.__kept && !el.closest('#obs-chips'))
        .map(el => el.tagName + '.' + String(el.className)),
    );
  for (const key of ['concerns', 'all', 'concerns', 'all']) {
    await marked();
    await page.locator('.atb-show [data-show="' + key + '"]').click();
    expect(await fresh(), 'after ' + key).toEqual([]);
    await expect(input).toHaveValue('s');
  }
});
