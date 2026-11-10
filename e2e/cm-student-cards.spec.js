import { test, expect } from '@playwright/test';

// S0-W1: the student page's build switch and a bare Student Cards list in
// Class Settings › Student Page, in Demo Mode.
//
// The switch is offered nowhere in the app. It shows only when the app was
// opened at an address that carries ?build=student-page: a Student Page
// switch in a card of its own. Turning it off with grades waiting asks
// first. With the student page on, Student Cards makes a card for each
// student, lists them, and prints them eight to a page on the sheet the
// questionnaire slips use.

const CODE = /^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}-[ABCDEFGHJKMNPQRTUVWXYZ2346789]{3}$/;

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The sample class is seeded a moment after the dashboard opens.
  await page.waitForFunction(
    () => {
      var cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0 && getAllTags(cid).length > 0;
    },
    null,
    { timeout: 15000 },
  );
  return page.evaluate(() => {
    var cid = getActiveCourse();
    var students = sortStudents(getStudents(cid), 'lastName');
    var tag = getAllTags(cid)[0];
    saveAssessments(
      cid,
      getAssessments(cid).concat([
        { id: 'e2e-cards', title: 'Tide Pool Notes', date: courseToday(cid), type: 'summative', tagIds: [tag.id] },
      ]),
    );
    return {
      cid: cid,
      sid: students[0].id,
      tag: tag.id,
      count: students.length,
      names: students.map(s => ((s.preferred || s.firstName || '').trim() + ' ' + (s.lastName || '')).trim()),
    };
  });
}

const tabs = page => page.locator('.cm-tabs [role="tab"]');
const theSwitch = page => page.getByRole('switch', { name: 'Student Page' });

// Print with the dialog held shut: what is on the sheet while it would be open.
async function printed(page, press) {
  await page.evaluate(() => {
    window.__sheet = null;
    window.print = () => {
      var root = document.getElementById('qr-slips-root');
      window.__sheet = {
        pages: Array.from(root.querySelectorAll('.qs-page')).map(p => p.children.length),
        names: Array.from(root.querySelectorAll('.qs-name')).map(e => e.textContent),
        classes: Array.from(new Set(Array.from(root.querySelectorAll('.qs-class')).map(e => e.textContent))),
        titles: Array.from(new Set(Array.from(root.querySelectorAll('.qs-title')).map(e => e.textContent))),
        codes: Array.from(root.querySelectorAll('.qs-type:not(.qs-pass) strong')).map(e => e.textContent),
        qrs: root.querySelectorAll('.qs-qr svg').length,
        text: root.textContent,
        active: document.body.classList.contains('qr-slips-active'),
      };
    };
  });
  await press();
  await page.waitForFunction(() => !!window.__sheet);
  return page.evaluate(() => window.__sheet);
}

test('the build switch shows only at the build address, and turning it off asks first', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const at = await demo(page);

  // The app as every teacher opens it: no Student Page tab, and no switch on any tab.
  await page.goto('/dashboard?manage=student-page');
  await expect(tabs(page)).toHaveCount(6);
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveCount(0);
  await expect(page.locator('#sp-build-switch')).toHaveCount(0);
  for (const name of [/^Details/, /^Students/, /^Questionnaires/, /^Grading/, /^Reporting Terms/, /^Competencies/]) {
    await page.getByRole('tab', { name }).click();
    await expect(page.locator('#sp-build-switch')).toHaveCount(0);
    await expect(page.locator('.sp-build')).toHaveCount(0);
  }

  // At the build address the tab is there, with the switch alone on it, off.
  await page.goto('/dashboard?manage=student-page&build=student-page');
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs(page)).toHaveCount(7);
  await expect(theSwitch(page)).not.toBeChecked();
  await expect(page.locator('.sp-build')).toContainText(
    'Off for this class. Still being built: turn it on only for a class you are testing with.',
  );
  await expect(page.locator('.sp-card')).toHaveCount(0);
  await expect(page.locator('.sc-card')).toHaveCount(0);
  expect(await page.evaluate(cid => getReturnSettings(cid).student_page, at.cid)).toBe(false);

  // On: Return Grades and Student Cards appear under it.
  await page.locator('.sp-build .gpd-switch').click();
  await expect(theSwitch(page)).toBeChecked();
  await expect(page.locator('.sp-build')).toContainText(
    'On for this class: grades are Draft or Returned, and students can have cards. Still being built.',
  );
  const group = page.getByRole('radiogroup', { name: 'Return Grades' });
  await expect(group).toBeVisible();
  await expect(page.locator('.sc-card').getByRole('heading', { name: 'Student Cards' })).toBeVisible();
  expect(await page.evaluate(cid => getReturnSettings(cid), at.cid)).toEqual({
    student_page: true,
    return_grades: null,
  });
  // No choice made yet; the teacher picks When I Return Them.
  await expect(page.locator('#sp-return-unset')).toBeVisible();
  await group.getByRole('radio', { name: 'When I Return Them' }).click();
  await expect(group.getByRole('radio', { name: 'When I Return Them' })).toBeChecked();

  // A reload at the plain address: the tab stays (the page is on), the switch is not offered.
  await page.goto('/dashboard?manage=student-page');
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#sp-build-switch')).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Return Grades' })).toBeVisible();

  // A grade waits as a draft.
  await page.evaluate(a => Grader.setLevel(a.cid, a.sid, 'e2e-cards', a.tag, 3, 0), at);
  expect(await page.evaluate(cid => GradeState.draftsWaiting(cid), at.cid)).toBe(1);

  // Turning the page off asks first, in the words Return Grades uses.
  await page.goto('/dashboard?manage=student-page&build=student-page');
  await expect(theSwitch(page)).toBeChecked();
  await page.locator('.sp-build .gpd-switch').click();
  const ask = page.getByRole('dialog', { name: 'Return 1 Grade Now?' });
  await expect(ask).toBeVisible();
  await expect(ask.locator('.confirm-message')).toHaveText(
    '1 grade is waiting as a draft. Changing this returns it to the student now.',
  );
  await expect(ask.getByRole('button')).toHaveText(['Cancel', 'Return and Change']);
  // Cancel: still on, still a draft.
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await expect(theSwitch(page)).toBeChecked();
  expect(await page.evaluate(cid => GradeState.draftsWaiting(cid), at.cid)).toBe(1);
  expect(await page.evaluate(cid => getReturnSettings(cid).student_page, at.cid)).toBe(true);

  // Return and Change: the grade is returned and the page is off.
  await page.locator('.sp-build .gpd-switch').click();
  await page
    .getByRole('dialog', { name: 'Return 1 Grade Now?' })
    .getByRole('button', { name: 'Return and Change' })
    .click();
  await expect(theSwitch(page)).not.toBeChecked();
  await expect(page.locator('.sp-card')).toHaveCount(0);
  await expect(page.locator('.sc-card')).toHaveCount(0);
  expect(await page.evaluate(cid => getReturnSettings(cid).student_page, at.cid)).toBe(false);
  expect(await page.evaluate(a => getGradeReturn(a.cid, a.sid, 'e2e-cards').is_draft, at)).toBe(false);

  // And at the plain address the tab is gone again.
  await page.goto('/dashboard?manage=student-page');
  await expect(tabs(page)).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('Student Cards: Make Cards, the list, and Print All eight to a page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const at = await demo(page);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid);

  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  await expect(card.getByRole('heading', { name: 'Student Cards' })).toBeVisible();
  await expect(card).toContainText('One card for each student. They scan it, or type its code, to open their page.');
  // Under Return Grades.
  const order = await page.evaluate(() => {
    var a = document.querySelector('.sp-card').getBoundingClientRect();
    var b = document.querySelector('.sc-card').getBoundingClientRect();
    return a.bottom <= b.top;
  });
  expect(order).toBe(true);

  // Every student, A to Z, with no card yet; nothing to print.
  const rows = card.locator('.sc-table tbody tr');
  await expect(rows).toHaveCount(at.count);
  await expect(card.locator('.sc-table thead th')).toHaveText(['Student', 'Card Code', 'Status']);
  await expect(card.locator('.sc-name')).toHaveText(at.names);
  await expect(card.locator('.sc-code').first()).toHaveText('No Card Yet');
  await expect(card.getByRole('button')).toHaveText(['Make Cards']);

  // Make Cards: a code for each, none printed.
  await card.getByRole('button', { name: 'Make Cards' }).click();
  await expect(card.getByRole('button')).toHaveText(['Print All']);
  const codes = await card.locator('.sc-code').allTextContents();
  expect(codes.length).toBe(at.count);
  codes.forEach(code => expect(code).toMatch(CODE));
  expect(new Set(codes).size).toBe(at.count);
  await expect(card.locator('.sc-status').first()).toHaveText('Not Printed');
  await expect(card.locator('.sc-status', { hasText: 'Not Printed' })).toHaveCount(at.count);

  // The list fits the panel: no sideways scroll.
  const fits = await page.evaluate(() => {
    var t = document.querySelector('.sc-table');
    var box = document.querySelector('.sc-card');
    return t.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1;
  });
  expect(fits).toBe(true);

  // Print All: every card on the slips' sheet, eight to a page.
  const sheet = await printed(page, () => card.getByRole('button', { name: 'Print All' }).click());
  expect(sheet.active).toBe(true);
  expect(sheet.pages.length).toBe(Math.ceil(at.count / 8));
  expect(sheet.pages.reduce((a, b) => a + b, 0)).toBe(at.count);
  sheet.pages.slice(0, -1).forEach(n => expect(n).toBe(8));
  expect(sheet.names).toEqual(at.names);
  expect(sheet.codes).toEqual(codes);
  expect(sheet.qrs).toBe(at.count);
  expect(sheet.titles).toEqual(['Student Card']);
  expect(sheet.classes.length).toBe(1);
  expect(sheet.classes[0]).toContain('Science 8');
  expect(sheet.text).toContain('Scan with your phone camera.');
  expect(sheet.text).toContain('No camera? Go to localhost:');
  // A card is kept: it never says a code works once.
  expect(sheet.text).not.toMatch(/once/i);

  // The sheet comes off the page, and the cards are marked printed.
  await expect(page.locator('#qr-slips-root .qs-page')).toHaveCount(0);
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(at.count);
  await expect(card.locator('.sc-status', { hasText: 'Not Printed' })).toHaveCount(0);

  // A reload keeps the same cards.
  await page.reload();
  await expect(page.locator('.sc-card .sc-code')).toHaveText(codes);
  await expect(page.locator('.sc-card .sc-status', { hasText: /^Printed / })).toHaveCount(at.count);
  // A student added later gets a card with Make Cards; the others keep theirs.
  await page.evaluate(cid => {
    saveStudents(cid, getStudents(cid).concat([{ id: 'e2e-new', firstName: 'Zed', lastName: 'Zzyzx' }]));
    DashClassManager.renderClassManager();
  }, at.cid);
  const again = page.locator('.sc-card');
  await expect(again.getByRole('button')).toHaveText(['Make Cards', 'Print All']);
  await expect(again.locator('.sc-code').last()).toHaveText('No Card Yet');
  await again.getByRole('button', { name: 'Make Cards' }).click();
  await expect(again.getByRole('button')).toHaveText(['Print All']);
  expect((await again.locator('.sc-code').allTextContents()).slice(0, at.count)).toEqual(codes);
  await expect(again.locator('.sc-code').last()).toHaveText(CODE);
  // Zed has no birthday or student number on file: his card prints a password.
  const second = await printed(page, () => again.getByRole('button', { name: 'Print All' }).click());
  expect(second.names[second.names.length - 1]).toBe('Zed Zzyzx');
  expect(second.text).toMatch(/Password\d{4}/);

  // Nothing went to a server, and nothing waits to.
  expect(await page.evaluate(() => localStorage.getItem('fv-sync-queue-v1'))).toBe(null);
  expect(errors).toEqual([]);
});
