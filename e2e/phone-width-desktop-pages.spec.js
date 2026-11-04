/**
 * Step 4 sweep: the desktop pages at phone width (375x812), Demo Mode.
 * Each test names the finding it covers.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

async function openDesktop(page, path) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\/|dashboard/);
  await page.goto(path);
  await expect(page.locator('#app-dock')).toBeVisible();
}

// What overlaps what in the top bar, and whether the page scrolls sideways.
async function dockAndPage(page) {
  return page.evaluate(() => {
    const box = s => document.querySelector(s).getBoundingClientRect();
    const seg = document.querySelector('.tb-seg');
    const left = box('.tb-left');
    const right = box('.tb-right');
    const segBox = seg.getBoundingClientRect();
    const active = seg.querySelector('.tb-seg-active').getBoundingClientRect();
    const main = document.getElementById('main');
    return {
      segLeft: segBox.left,
      segRight: segBox.right,
      leftEnd: left.width ? left.right : 0,
      rightStart: right.left,
      activeIn: active.left >= segBox.left - 1 && active.right <= segBox.right + 1,
      pageSideways: document.documentElement.scrollWidth > innerWidth || (main && main.scrollWidth > main.clientWidth + 1),
    };
  });
}

// Group 2 #40: the top tabs fit between the sidebar button and the sync dot
// and account button, the open tab shows, and the Dashboard doesn't scroll
// sideways.
for (const [path, tab] of [
  ['/dashboard', 'Dashboard'],
  ['/assignments', 'Assignments'],
  ['/observations', 'Observations'],
  ['/gradebook', 'Gradebook'],
  ['/reports', 'Reports'],
]) {
  test(`top tabs fit a phone on ${tab}`, async ({ page }) => {
    await openDesktop(page, path);
    await expect(page.locator('.tb-seg-active')).toHaveText(tab);
    const d = await dockAndPage(page);
    expect(d.segLeft).toBeGreaterThanOrEqual(d.leftEnd - 0.5);
    expect(d.segRight).toBeLessThanOrEqual(d.rightStart + 0.5);
    expect(d.activeIn).toBe(true);
    if (path === '/dashboard') expect(d.pageSideways).toBe(false);
  });
}

// Group 2 #41: Class Management's class list, New Class and Restore from
// Backup can be used on a phone.
test('Class Management class list works on a phone', async ({ page }) => {
  await openDesktop(page, '/dashboard');
  await page.getByRole('button', { name: 'Class Management' }).first().click();
  const list = page.locator('.cm-sidebar');
  await expect(list).toBeVisible();
  expect((await list.boundingBox()).width).toBeGreaterThan(300);
  for (const name of ['New Class', 'Restore from Backup']) {
    const btn = page.locator('.cm-new-btn', { hasText: name });
    await btn.scrollIntoViewIfNeeded();
    const hit = await btn.evaluate(b => {
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(hit, name).toBe(true);
  }
  await page.locator('.cm-new-btn', { hasText: 'New Class' }).click();
  await expect(page.locator('.cm-create-active, .cm-wizard, [class*="wizard"]').first()).toBeVisible();
});

// Group 2 #42: an open rubric card on Assignments fits a phone, its level
// names don't overlap, and + New Assessment stays on screen.
test('Assignments rubric grid fits a phone', async ({ page }) => {
  await openDesktop(page, '/assignments');
  await page.locator('.assess-card', { hasText: 'Science Fair Proposal' }).first().locator('.assess-header').click();
  await expect(page.locator('.rsg-levels').first()).toBeVisible();
  const r = await page.evaluate(() => {
    const main = document.getElementById('main');
    const levels = [...document.querySelectorAll('.rsg-level')].filter(l => l.getBoundingClientRect().width > 0);
    const btn = [...document.querySelectorAll('button')].find(b => /New Assessment/.test(b.textContent));
    return {
      sideways: main.scrollWidth > main.clientWidth + 1,
      cardRight: document.querySelector('.assess-card.open').getBoundingClientRect().right,
      overlapping: levels.filter(l => l.scrollWidth > l.clientWidth + 1).length,
      newRight: btn.getBoundingClientRect().right,
    };
  });
  expect(r.sideways).toBe(false);
  expect(r.cardRight).toBeLessThanOrEqual(375);
  expect(r.overlapping).toBe(0);
  expect(r.newRight).toBeLessThanOrEqual(375);
});

// Group 2 #43: the gradebook grader fits a phone: the score box, Missing,
// Excused and Late are on screen, and the Overall Comment is full width.
test('gradebook grader fits a phone', async ({ page }) => {
  await openDesktop(page, '/gradebook');
  const aid = await page.evaluate(() => getAssessments(getActiveCourse()).find(a => a.title === 'Data Reading Quiz').id);
  await page.locator(`.gb-scores-cell[data-aid="${aid}"]`).first().click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog).toBeVisible();
  const r = await dialog.evaluate(d => {
    const inView = e => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.left >= -0.5 && b.right <= innerWidth + 0.5;
    };
    return {
      statuses: [...d.querySelectorAll('.grader-status-btn')].map(inView),
      score: inView(d.querySelector('input')),
      commentWidth: d.querySelector('.grdt-note').getBoundingClientRect().width,
    };
  });
  expect(r.statuses).toEqual([true, true, true]);
  expect(r.score).toBe(true);
  expect(r.commentWidth).toBeGreaterThan(250);
});

// Group 2 #44: the desktop student page fits a phone: ‹ › clear the
// breadcrumb, the term picker stays on screen, and the page doesn't scroll
// sideways.
test('desktop student page fits a phone', async ({ page }) => {
  await openDesktop(page, '/student?id=st1');
  await expect(page.locator('.student-toolbar .term-select')).toBeVisible();
  const r = await page.evaluate(() => {
    const crumb = document.querySelector('.student-toolbar .tb-breadcrumb').getBoundingClientRect();
    const step = document.querySelector('.student-toolbar .stu-step').getBoundingClientRect();
    const term = document.querySelector('.student-toolbar .term-select').getBoundingClientRect();
    const main = document.getElementById('main');
    const overlap = !(step.right <= crumb.left || step.left >= crumb.right || step.bottom <= crumb.top || step.top >= crumb.bottom);
    return { crumbWidth: crumb.width, overlap, termRight: term.right, sideways: main.scrollWidth > main.clientWidth + 1 };
  });
  expect(r.crumbWidth).toBeGreaterThan(100);
  expect(r.overlap).toBe(false);
  expect(r.termRight).toBeLessThanOrEqual(375);
  expect(r.sideways).toBe(false);
});
