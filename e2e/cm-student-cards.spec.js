import { test, expect } from '@playwright/test';
import { catchPrints, heldAnywhere, sheets } from './student-card-fake.js';

// S0-W1 and S3-W1: the student page's build switch and the Student Cards
// list in Class Settings › Student Page, in Demo Mode.
//
// The switch is offered nowhere in the app. It shows only when the app was
// opened at an address that carries ?build=student-page: a Student Page
// switch in a card of its own. Turning it off with grades waiting asks
// first. With the student page on, Student Cards lists each student's card
// with no code, and Make and Print makes the cards and prints them eight to
// a page on the sheet the questionnaire slips use.

const CODE = /^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{4}-[ABCDEFGHJKMNPQRTUVWXYZ2346789]{4}$/;

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

/* Make and Print in Demo Mode (S3-W1; the card-codes design, sections 4,
   8 and 10): the list shows no code, ever; one press makes every card and
   opens the print dialog; the code is printed and kept nowhere on the
   device; Print Again prints the same codes until Class Settings closes or
   the page reloads. Set S3W1_SHOTS to a folder to save the list before and
   after. */
const SHOTS = process.env.S3W1_SHOTS || '';

test('Student Cards: Make and Print, no code kept, and Print Again until the screen goes', async ({ page }) => {
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
  const order = await page.evaluate(() => {
    var a = document.querySelector('.sp-card').getBoundingClientRect();
    var b = document.querySelector('.sc-card').getBoundingClientRect();
    return a.bottom <= b.top;
  });
  expect(order).toBe(true);

  // Every student, A to Z, with no card yet; one button.
  const rows = card.locator('.sc-table tbody tr');
  await expect(rows).toHaveCount(at.count);
  await expect(card.locator('.sc-table thead th')).toHaveText(['Student', 'Card', 'Status']);
  await expect(card.locator('.sc-name')).toHaveText(at.names);
  await expect(card.locator('.sc-which')).toHaveText(at.names.map(() => 'No Card Yet'));
  await expect(card.getByRole('button')).toHaveText(['Make and Print ' + at.count + ' Cards']);
  if (SHOTS) {
    // Once the loading screen has faded.
    await page
      .waitForFunction(
        () =>
          ![...document.querySelectorAll('.app-loading')].some(
            e => e.offsetParent && getComputedStyle(e).opacity !== '0',
          ),
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
    await card.screenshot({ path: SHOTS + '/s3w1-demo-before.png' });
  }

  // One press: the cards are made and the print dialog opens.
  await catchPrints(page);
  await card.getByRole('button', { name: 'Make and Print ' + at.count + ' Cards' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  const [sheet] = await sheets(page);
  expect(sheet.pages.length).toBe(Math.ceil(at.count / 8));
  expect(sheet.pages.reduce((a, b) => a + b, 0)).toBe(at.count);
  expect(sheet.names).toEqual(at.names);
  expect(sheet.numbers).toEqual(at.names.map(() => 'Card 1'));
  sheet.codes.forEach(code => expect(code).toMatch(CODE));
  expect(new Set(sheet.codes).size).toBe(at.count);
  expect(sheet.qrs).toBe(at.count);
  expect(sheet.classes.length).toBe(1);
  expect(sheet.classes[0]).toContain('Science 8');
  expect(sheet.text).toContain('Scan with your phone camera.');
  expect(sheet.text).toContain('No camera? Go to localhost:');
  expect(sheet.text).not.toMatch(/once/i);
  // The sheet comes off the page.
  await expect(page.locator('#qr-slips-root .qs-page')).toHaveCount(0);

  // The list: no code anywhere, each card printed, the line and Print Again.
  await expect(card.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(at.count);
  await expect(card.locator('.sc-which').first()).toHaveText(/^Card 1 · Made \w+ \d+$/);
  const line =
    at.count +
    ' cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.';
  await expect(card.locator('.sc-note')).toHaveText(line);
  await expect(card.getByRole('button')).toHaveText(['Print Again']);
  if (SHOTS) await card.screenshot({ path: SHOTS + '/s3w1-demo-after.png' });
  const secrets = sheet.codes.concat(sheet.passwords);
  const shownText = await page.locator('body').innerText();
  const kept = await heldAnywhere(page);
  for (const code of secrets) {
    expect(shownText).not.toContain(code);
    expect(kept).not.toContain(code);
    expect(kept).not.toContain(code.replace('-', ''));
  }
  const saved = await page.evaluate(cid => localStorage.getItem('gb-student-cards-' + cid), at.cid);
  expect(JSON.parse(saved).length).toBe(at.count);
  expect(saved).not.toMatch(/"(code|password)":/);

  // Print Again: the same codes.
  await card.getByRole('button', { name: 'Print Again' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(2);
  const again = (await sheets(page))[1];
  expect(again.codes).toEqual(sheet.codes);
  expect(again.passwords).toEqual(sheet.passwords);

  // Class Settings closes and opens again: Print Again is gone, the cards show as printed.
  await page.locator('[data-action="closeClassManager"]').first().click();
  await expect(page.locator('.sc-card')).toHaveCount(0);
  await page.goto('/dashboard?manage=student-page');
  const back = page.locator('.sc-card');
  await expect(back.locator('.sc-status', { hasText: /^Printed / })).toHaveCount(at.count);
  await expect(back.getByRole('button')).toHaveCount(0);
  await expect(back.locator('.sc-note')).toHaveCount(0);

  // A student added later: Make and Print 1 Card, and the others keep theirs.
  const before = await page.evaluate(cid => JSON.parse(localStorage.getItem('gb-student-cards-' + cid)), at.cid);
  await page.evaluate(cid => {
    saveStudents(cid, getStudents(cid).concat([{ id: 'e2e-new', firstName: 'Zed', lastName: 'Zzyzx' }]));
    DashClassManager.renderClassManager();
  }, at.cid);
  await expect(back.getByRole('button')).toHaveText(['Make and Print 1 Card']);
  await expect(back.locator('.sc-which').last()).toHaveText('No Card Yet');
  await catchPrints(page);
  await back.getByRole('button', { name: 'Make and Print 1 Card' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  const zed = (await sheets(page))[0];
  expect(zed.names).toEqual(['Zed Zzyzx']);
  // Zed has no birthday or student number on file: his card prints a password.
  expect(zed.passwords.length).toBe(1);
  expect(zed.passwords[0]).toMatch(/^\d{4}$/);
  await expect(back.locator('.sc-note')).toHaveText(
    '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
  );
  const now = await page.evaluate(cid => JSON.parse(localStorage.getItem('gb-student-cards-' + cid)), at.cid);
  expect(now.slice(0, at.count).map(c => c.id)).toEqual(before.map(c => c.id));

  // The page going (pagehide) lets go of the codes at once.
  expect(await page.evaluate(() => StudentCards._holding())).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  expect(await page.evaluate(() => StudentCards._holding())).toBe(false);

  // A reload: Print Again is gone.
  await page.reload();
  await expect(page.locator('.sc-card .sc-status', { hasText: /^Printed / })).toHaveCount(at.count + 1);
  await expect(page.locator('.sc-card').getByRole('button')).toHaveCount(0);
  expect(await heldAnywhere(page)).not.toContain(zed.codes[0]);

  // Nothing went to a server, and nothing waits to.
  expect(await page.evaluate(() => localStorage.getItem('fv-sync-queue-v1'))).toBe(null);
  expect(errors).toEqual([]);
});
