/**
 * Step 4 sweep: the desktop pages at phone width (375x812), Demo Mode.
 * Each test names the finding it covers.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 } });

async function openDesktop(page, path, flag) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A page behind a build switch (fv-build-<name>) is opened with its switch on.
  if (flag) await page.addInitScript(name => localStorage.setItem('fv-build-' + name, '1'), flag);
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
      pageSideways:
        document.documentElement.scrollWidth > innerWidth || (main && main.scrollWidth > main.clientWidth + 1),
    };
  });
}

// Group 2 #40: the top tabs fit between the sidebar button and the sync dot
// and account button, the open tab shows, and the Dashboard doesn't scroll
// sideways.
for (const [path, tab, flag] of [
  ['/dashboard', 'Dashboard'],
  ['/assignments', 'Assignments'],
  ['/bulletins', 'Bulletins', 'bulletins'],
  ['/observations', 'Observations'],
  ['/gradebook', 'Gradebook'],
  ['/reports', 'Reporting'],
]) {
  test(`top tabs fit a phone on ${tab}`, async ({ page }) => {
    await openDesktop(page, path, flag);
    await expect(page.locator('.tb-seg-active')).toHaveText(tab);
    const d = await dockAndPage(page);
    expect(d.segLeft).toBeGreaterThanOrEqual(d.leftEnd - 0.5);
    expect(d.segRight).toBeLessThanOrEqual(d.rightStart + 0.5);
    expect(d.activeIn).toBe(true);
    if (path === '/dashboard') expect(d.pageSideways).toBe(false);
  });
}

// Group 2 #41: Class Settings' class list, New Class and Restore from
// Backup can be used on a phone.
test('Class Settings class list works on a phone', async ({ page }) => {
  await openDesktop(page, '/dashboard');
  await page.getByRole('button', { name: 'Class Settings' }).first().click();
  const list = page.locator('.cm-sidebar');
  await expect(list).toBeVisible();
  expect((await list.boundingBox()).width).toBeGreaterThan(300);
  // New Class is a button at the top of the class list (group 3 #6);
  // Restore from Backup stays at its foot.
  const buttons = { 'New Class': '.cm-new-class-btn', 'Restore from Backup': '.cm-new-btn' };
  for (const name of Object.keys(buttons)) {
    const btn = page.locator(buttons[name], { hasText: name });
    await btn.scrollIntoViewIfNeeded();
    const hit = await btn.evaluate(b => {
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(hit, name).toBe(true);
  }
  await page.locator('.cm-new-class-btn', { hasText: 'New Class' }).click();
  await expect(page.locator('.cm-create-active, .cm-wizard, [class*="wizard"]').first()).toBeVisible();
});

// Group 2 #42: an open rubric card on Assignments fits a phone, its level
// names don't overlap, and + New Assessment stays on screen.
test('Assignments rubric grid fits a phone', async ({ page }) => {
  await openDesktop(page, '/assignments');
  const card = page.locator('.assess-card', { hasText: 'Science Fair Proposal' }).first();
  await card.locator('.assess-header').click();
  // Every unit folder is open, so other rubric cards (closed) come before it.
  await expect(card.locator('.rsg-levels').first()).toBeVisible();
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
  const aid = await page.evaluate(
    () => getAssessments(getActiveCourse()).find(a => a.title === 'Data Reading Quiz').id,
  );
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
// breadcrumb, Edit Student stays on screen, and the page doesn't scroll
// sideways. (The term picker left the page, Colin 2026-11-03.)
test('desktop student page fits a phone', async ({ page }) => {
  await openDesktop(page, '/student?id=st1');
  await expect(page.locator('.student-toolbar .tb-edit-btn[data-action="openEditStudent"]')).toBeVisible();
  const r = await page.evaluate(() => {
    const crumb = document.querySelector('.student-toolbar .tb-breadcrumb').getBoundingClientRect();
    const step = document.querySelector('.student-toolbar .stu-step').getBoundingClientRect();
    const term = document
      .querySelector('.student-toolbar .tb-edit-btn[data-action="openEditStudent"]')
      .getBoundingClientRect();
    const main = document.getElementById('main');
    const overlap = !(
      step.right <= crumb.left ||
      step.left >= crumb.right ||
      step.bottom <= crumb.top ||
      step.top >= crumb.bottom
    );
    return {
      crumbWidth: crumb.width,
      overlap,
      termRight: term.right,
      sideways: main.scrollWidth > main.clientWidth + 1,
    };
  });
  expect(r.crumbWidth).toBeGreaterThan(100);
  expect(r.overlap).toBe(false);
  expect(r.termRight).toBeLessThanOrEqual(375);
  expect(r.sideways).toBe(false);
  await page.locator('#app-dock [data-action="toggleSidebar"]').click();
  await expect(page.locator('#gb-sidebar')).toBeVisible();
});

// Group 2 #45: Write Comments works on a phone: the sidebar button opens the
// student list, the name has room, the columns stack, nothing scrolls
// sideways, and Times Late is on screen.
test('Write Comments fits a phone', async ({ page }) => {
  await openDesktop(page, '/reports?tab=questionnaire');
  await expect(page.locator('.wc-head-card')).toBeVisible();
  await page.locator('#wc-head-att').click();
  const r = await page.evaluate(() => {
    const toggle = document.querySelector('#app-dock [data-action="toggleSidebar"]');
    const tb = toggle.getBoundingClientRect();
    const late = document.querySelector('[data-tq-att="lates"]');
    const lb = late.getBoundingClientRect();
    const qn = document.querySelector('.qn');
    const left = document.querySelector('.wc-left').getBoundingClientRect();
    const right = document.querySelector('.wc-right').getBoundingClientRect();
    return {
      toggleHit: toggle.contains(document.elementFromPoint(tb.x + tb.width / 2, tb.y + tb.height / 2)),
      whoWidth: document.querySelector('.qn-who').getBoundingClientRect().width,
      stacked: right.top >= left.bottom - 1,
      lateInView: lb.width > 0 && lb.right <= innerWidth,
      sideways: qn.scrollWidth > qn.clientWidth + 1,
    };
  });
  expect(r.toggleHit).toBe(true);
  expect(r.whoWidth).toBeGreaterThan(200);
  expect(r.stacked).toBe(true);
  expect(r.lateInView).toBe(true);
  expect(r.sideways).toBe(false);
  await page.locator('#app-dock [data-action="toggleSidebar"]').click();
  await expect(page.locator('#gb-sidebar')).toBeVisible();
});

// Group 2 #46: Progress Reports fits a phone: the sheet starts inside the
// canvas, Paper and One Student / Everyone are on screen, and the Parts
// button opens the panel.
test('Progress Reports fits a phone', async ({ page }) => {
  await openDesktop(page, '/reports?tab=progress');
  await expect(page.locator('#rb-preview .sheet-zoom .report-sheet').first()).toBeVisible();
  const sheetIn = () =>
    page.evaluate(() => {
      const p = document.getElementById('rb-preview').getBoundingClientRect();
      const s = document.querySelector('#rb-preview .sheet-zoom .report-sheet').getBoundingClientRect();
      return s.left >= p.left - 0.5 && s.right <= p.right + 0.5;
    });
  await expect.poll(sheetIn).toBe(true);
  await expect(page.locator('.studio-tools [data-action="setPaper"]').first()).toBeVisible();
  await expect(page.locator('.studio-tools [data-action="studioView"]').first()).toBeVisible();
  const off = await page.evaluate(() =>
    [...document.querySelectorAll('.studio-tools button')]
      .filter(b => {
        const r = b.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth;
      })
      .map(b => b.textContent.trim()),
  );
  expect(off).toEqual([]);
  await expect.poll(sheetIn).toBe(true);
  // On a narrow screen the panel of parts opens from the Parts button.
  await page.locator('#tb-rail-btn').click();
  await expect(page.locator('#studio-palette [data-action="oneSwitch"]').first()).toBeVisible();
});

// Class Settings › Student Page's sentence on how long photos stay fits a
// phone, with Send Work and the build switch on. The Dashboard has no photo
// line any more (Keep Photos Until and its reminder went on Nov 17 2026).
test('the photos sentence fits a phone, and the Dashboard has no photo line', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-06-25T10:00:00'));
  await openDesktop(page, '/dashboard');
  await page.waitForFunction(cid => getCourseSubmissions(cid).submissions.length === 16, 'sci8', { timeout: 15000 });
  await page.evaluate(cid => {
    setStudentPageSwitch(cid, true, 'on_return');
    var all = getCourseSubmissions(cid);
    all.course = Object.assign({}, all.course, { send_work: true });
    saveDemoStudentWork(cid, all);
  }, 'sci8');
  await page.goto('/dashboard');
  await page.waitForSelector('#main .dash-glance', { timeout: 10000 });
  await expect(page.locator('.photo-reminder')).toHaveCount(0);
  await page.goto('/dashboard?manage=student-page&course=sci8');
  await expect(page.locator('#sp-photos-stay')).toBeVisible();
  // Read in one step: Student Cards draws Class Settings again when its list
  // is read (teacher/student-cards.js), which can replace the sentence between
  // a locator's two calls. The sentence's right edge, once it is laid out.
  const right = () =>
    page.evaluate(() => {
      const el = document.getElementById('sp-photos-stay');
      const r = el && el.getBoundingClientRect();
      return r && r.width > 0 ? r.right : null;
    });
  await expect.poll(right).toBeLessThanOrEqual(375);
});
