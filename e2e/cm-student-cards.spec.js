import { test, expect } from '@playwright/test';
import { catchPrints, heldAnywhere, sheets } from './student-card-fake.js';
import { notAdded } from '../tests/helpers/kept-secret.js';

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
      firsts: students.map(s => (s.preferred || s.firstName || '').trim()),
      ids: students.map(s => s.id),
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
  await expect(card.locator('.sc-table thead th')).toHaveText(['Student', 'Card', 'Status', '']);
  await expect(card.locator('.sc-name')).toHaveText(at.names);
  await expect(card.locator('.sc-which')).toHaveText(at.names.map(() => 'No Card Yet'));
  await expect(card.locator('.sc-actions button')).toHaveText(['Make and Print ' + at.count + ' Cards']);
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
  const keptBefore = await heldAnywhere(page);
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
  await expect(card.locator('.sc-actions button')).toHaveText(['Print Again', 'New Codes for This Class']);
  if (SHOTS) await card.screenshot({ path: SHOTS + '/s3w1-demo-after.png' });
  const shownText = await page.locator('body').innerText();
  const kept = await heldAnywhere(page);
  for (const code of sheet.codes) {
    expect(shownText).not.toContain(code);
    expect(kept).not.toContain(code);
    expect(kept).not.toContain(code.replace('-', ''));
  }
  // A password is four digits, which the device already holds by the hundred: found no more often than before.
  for (const password of sheet.passwords) {
    expect(shownText).not.toContain(password);
    notAdded(expect, keptBefore, kept, password);
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
  await expect(back.locator('.sc-actions button')).toHaveText(['New Codes for This Class']);
  await expect(back.locator('.sc-note')).toHaveCount(0);

  // A student added later: Make and Print 1 Card, and the others keep theirs.
  const before = await page.evaluate(cid => JSON.parse(localStorage.getItem('gb-student-cards-' + cid)), at.cid);
  await page.evaluate(cid => {
    saveStudents(cid, getStudents(cid).concat([{ id: 'e2e-new', firstName: 'Zed', lastName: 'Zzyzx' }]));
    DashClassManager.renderClassManager();
  }, at.cid);
  await expect(back.locator('.sc-actions button')).toHaveText(['New Codes for This Class', 'Make and Print 1 Card']);
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
  await expect(page.locator('.sc-card .sc-actions button')).toHaveText(['New Codes for This Class']);
  expect(await heldAnywhere(page)).not.toContain(zed.codes[0]);

  // Nothing went to a server, and nothing waits to.
  expect(await page.evaluate(() => localStorage.getItem('fv-sync-queue-v1'))).toBe(null);
  expect(errors).toEqual([]);
});

/* S3-F2 in Demo Mode: Print New Card, New Codes for This Class, Unlock and
   Unlock All, and a page back from the Back cache. Every question's words
   are the design's; Cancel changes nothing; no code is on the page or
   anywhere on the device afterwards. Set S3F2_SHOTS to a folder to save a
   picture of each question and of the list. */
const F2_SHOTS = process.env.S3F2_SHOTS || '';

// Every code and password the sheets printed is nowhere on the page or the
// device. A password is four digits, which the device already holds by the
// hundred: it is found no more often than in `keptBefore`, what the device
// held before any card was made.
async function noCodeKept(page, printed, keptBefore) {
  const shownText = await page.locator('body').innerText();
  const kept = await heldAnywhere(page);
  for (const sheet of printed) {
    for (const code of sheet.codes) {
      expect(shownText).not.toContain(code);
      expect(kept).not.toContain(code);
      expect(kept).not.toContain(code.replace('-', ''));
    }
    for (const password of sheet.passwords) {
      expect(shownText).not.toContain(password);
      notAdded(expect, keptBefore, kept, password);
    }
  }
}
const savedCards = (page, cid) =>
  page.evaluate(id => JSON.parse(localStorage.getItem('gb-student-cards-' + id) || '[]'), cid);

test('Student Cards: Print New Card, New Codes for This Class, Unlock, with their questions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const at = await demo(page);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid);
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  const actions = card.locator('.sc-actions button');
  await expect(actions).toHaveText(['Make and Print ' + at.count + ' Cards']);
  // No card yet: nothing on a row to press, and no New Codes.
  await expect(card.locator('.sc-do button')).toHaveCount(0);

  const keptBefore = await heldAnywhere(page);
  await catchPrints(page);
  await actions.first().click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  const all = [(await sheets(page))[0]];
  await expect(actions).toHaveText(['Print Again', 'New Codes for This Class']);

  // Print New Card for the first student: the question, in the design's words.
  const first = at.firsts[0];
  await card.getByRole('button', { name: 'Print a New Card for ' + at.names[0] }).click();
  let ask = page.getByRole('dialog', { name: 'Print a New Card for ' + first + '?' });
  await expect(ask).toBeVisible();
  await expect(ask.locator('.confirm-message')).toHaveText(
    'The card ' +
      first +
      ' has now stops working as soon as the new one is made. Everything ' +
      first +
      ' has sent stays.',
  );
  await expect(ask.getByRole('button')).toHaveText(['Cancel', 'Print New Card']);
  if (F2_SHOTS) {
    // Once the question has faded in.
    await page.waitForTimeout(600);
    await page.screenshot({ path: F2_SHOTS + '/s3f2-print-new-card-question.png' });
  }
  // Cancel: nothing made, nothing printed.
  const before = await savedCards(page, at.cid);
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await savedCards(page, at.cid)).toEqual(before);
  expect((await sheets(page)).length).toBe(1);
  // Print New Card: one sheet, Card 2, and only that student's card changed.
  await card.getByRole('button', { name: 'Print a New Card for ' + at.names[0] }).click();
  await page
    .getByRole('dialog', { name: 'Print a New Card for ' + first + '?' })
    .getByRole('button', { name: 'Print New Card' })
    .click();
  await expect.poll(async () => (await sheets(page)).length).toBe(2);
  const one = (await sheets(page))[1];
  all.push(one);
  expect(one.names).toEqual([at.names[0]]);
  expect(one.numbers).toEqual(['Card 2']);
  expect(all[0].codes).not.toContain(one.codes[0]);
  const afterOne = await savedCards(page, at.cid);
  expect(afterOne.find(c => c.enrollment_id === at.ids[0]).id).not.toBe(
    before.find(c => c.enrollment_id === at.ids[0]).id,
  );
  expect(afterOne.filter(c => c.enrollment_id !== at.ids[0])).toEqual(
    before.filter(c => c.enrollment_id !== at.ids[0]),
  );
  await expect(card.locator('.sc-which').first()).toHaveText(/^Card 2 · Made /);
  await expect(card.locator('.sc-note')).toHaveText(
    '1 card went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
  );
  await noCodeKept(page, all, keptBefore);

  // A student added later has no card: New Codes for This Class counts them as a first card.
  await page.evaluate(cid => {
    saveStudents(cid, getStudents(cid).concat([{ id: 'e2e-new', firstName: 'Zed', lastName: 'Zzyzx' }]));
    DashClassManager.renderClassManager();
  }, at.cid);
  const n = at.count + 1;
  await card.getByRole('button', { name: 'New Codes for This Class' }).click();
  ask = page.getByRole('dialog', { name: 'New Codes for All ' + n + ' Students?' });
  await expect(ask).toBeVisible();
  await expect(ask.locator('.confirm-message')).toHaveText(
    at.count +
      ' cards stop working now. 1 student gets their first card. Print the new cards and hand them out. ' +
      "Students can't open their page until they have their new card. Everything they have sent stays.",
  );
  await expect(ask.getByRole('button')).toHaveText(['Cancel', 'Make ' + n + ' New Cards']);
  if (F2_SHOTS) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: F2_SHOTS + '/s3f2-new-codes-question.png' });
  }
  const beforeAll = await savedCards(page, at.cid);
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(await savedCards(page, at.cid)).toEqual(beforeAll);
  expect((await sheets(page)).length).toBe(2);
  await card.getByRole('button', { name: 'New Codes for This Class' }).click();
  await page
    .getByRole('dialog', { name: 'New Codes for All ' + n + ' Students?' })
    .getByRole('button', { name: 'Make ' + n + ' New Cards' })
    .click();
  await expect.poll(async () => (await sheets(page)).length).toBe(3);
  const every = (await sheets(page))[2];
  all.push(every);
  expect(every.names.length).toBe(n);
  expect(every.names[every.names.length - 1]).toBe('Zed Zzyzx');
  expect(every.numbers[0]).toBe('Card 3');
  expect(every.numbers[every.numbers.length - 1]).toBe('Card 1');
  const afterAll = await savedCards(page, at.cid);
  expect(afterAll.length).toBe(n);
  expect(afterAll.some(c => beforeAll.some(b => b.id === c.id))).toBe(false);
  await expect(card.locator('.sc-note')).toHaveText(
    n +
      ' cards went to the printer. Print Again works until you leave this screen. After that, printing makes new codes.',
  );
  await noCodeKept(page, all, keptBefore);

  // Two cards locked (as five wrong tries would leave them): Unlock on each row, and Unlock All.
  await page.evaluate(cid => {
    var kept = JSON.parse(localStorage.getItem('gb-student-cards-' + cid));
    kept[0].locked_at = kept[1].locked_at = new Date().toISOString();
    kept[0].wrong_tries = kept[1].wrong_tries = 5;
    localStorage.setItem('gb-student-cards-' + cid, JSON.stringify(kept));
  }, at.cid);
  await page.goto('/dashboard?manage=student-page');
  await expect(card.locator('.sc-lock')).toHaveCount(2);
  await expect(actions).toHaveText(['Unlock All', 'New Codes for This Class']);
  if (F2_SHOTS) {
    await page.setViewportSize({ width: 1280, height: 2200 });
    await page.waitForTimeout(500);
    await card.screenshot({ path: F2_SHOTS + '/s3f2-list-locked.png' });
  }
  await card.getByRole('button', { name: 'Unlock ' + at.names[0] + '’s Card' }).click();
  await expect(card.locator('.sc-lock')).toHaveCount(1);
  await expect(actions).toHaveText(['New Codes for This Class']);
  await expect(card.locator('.sc-status').first()).toHaveText(/^Printed /);
  // Unlock All, with three locked.
  await page.evaluate(cid => {
    var kept = JSON.parse(localStorage.getItem('gb-student-cards-' + cid));
    kept[0].locked_at = kept[2].locked_at = new Date().toISOString();
    localStorage.setItem('gb-student-cards-' + cid, JSON.stringify(kept));
  }, at.cid);
  await page.goto('/dashboard?manage=student-page');
  await expect(card.locator('.sc-lock')).toHaveCount(3);
  await card.getByRole('button', { name: 'Unlock All' }).click();
  await expect(card.locator('.sc-lock')).toHaveCount(0);
  expect((await savedCards(page, at.cid)).every(c => !c.locked_at && !c.wrong_tries)).toBe(true);
  if (F2_SHOTS) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: F2_SHOTS + '/s3f2-page.png' });
    await card.screenshot({ path: F2_SHOTS + '/s3f2-list.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  // Back from the Back cache after pagehide: the list is drawn again, with no dead Print Again.
  await catchPrints(page);
  await card.getByRole('button', { name: 'Print a New Card for ' + at.names[1] }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Print New Card' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  all.push((await sheets(page))[0]);
  await expect(actions).toHaveText(['Print Again', 'New Codes for This Class']);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(actions).toHaveText(['New Codes for This Class']);
  await expect(card.locator('.sc-note')).toHaveCount(0);

  await noCodeKept(page, all, keptBefore);
  expect(await page.evaluate(() => localStorage.getItem('fv-sync-queue-v1'))).toBe(null);
  expect(errors).toEqual([]);
});

/* S3-F1 in Demo Mode: the filters, each with its count, and Cards Work
   Until. No code on the page or the device. Set S3F2_SHOTS to a folder for
   pictures of the whole page and of a filter. */
test('Student Cards: the filters and Cards Work Until', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const at = await demo(page);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid);
  await page.goto('/dashboard?manage=student-page');
  const card = page.locator('.sc-card');
  const filters = card.getByRole('radiogroup', { name: 'Show' });
  await expect(filters.getByRole('radio')).toHaveText([
    'All ' + at.count,
    'Not Printed ' + at.count,
    'Locked 0',
    'Never Opened 0',
  ]);
  await expect(filters.getByRole('radio', { name: /^All/ })).toHaveAttribute('aria-checked', 'true');

  const keptBefore = await heldAnywhere(page);
  await catchPrints(page);
  await card.getByRole('button', { name: 'Make and Print ' + at.count + ' Cards' }).click();
  await expect.poll(async () => (await sheets(page)).length).toBe(1);
  const [sheet] = await sheets(page);

  // One card opened, one locked (as the student's page and five wrong tries would leave them).
  await page.evaluate(cid => {
    var kept = JSON.parse(localStorage.getItem('gb-student-cards-' + cid));
    kept[0].last_opened_at = new Date().toISOString();
    kept[1].locked_at = new Date().toISOString();
    localStorage.setItem('gb-student-cards-' + cid, JSON.stringify(kept));
  }, at.cid);
  await page.goto('/dashboard?manage=student-page');
  await expect(filters.getByRole('radio')).toHaveText([
    'All ' + at.count,
    'Not Printed 0',
    'Locked 1',
    'Never Opened ' + (at.count - 1),
  ]);
  if (F2_SHOTS) {
    await page.setViewportSize({ width: 1280, height: 2200 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: F2_SHOTS + '/s3f1-page.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await filters.getByRole('radio', { name: /^Locked/ }).click();
  await expect(filters.getByRole('radio', { name: /^Locked/ })).toHaveAttribute('aria-checked', 'true');
  await expect(filters.getByRole('radio', { name: /^Locked/ })).toBeFocused();
  await expect(card.locator('.sc-name')).toHaveText([at.names[1]]);
  if (F2_SHOTS) {
    await page.waitForTimeout(300);
    await card.screenshot({ path: F2_SHOTS + '/s3f1-filter-locked.png' });
  }
  await filters.getByRole('radio', { name: /^Not Printed/ }).click();
  await expect(card.locator('.sc-table')).toHaveCount(0);
  await expect(card.locator('.sc-empty')).toHaveText('Every student has a printed card.');
  await filters.getByRole('radio', { name: /^Never Opened/ }).click();
  await expect(card.locator('.sc-name')).toHaveCount(at.count - 1);
  await expect(card.locator('.sc-name')).not.toContainText([at.names[0]]);
  await filters.getByRole('radio', { name: /^All/ }).click();
  await expect(card.locator('.sc-name')).toHaveText(at.names);

  // Cards Work Until: the default, a chosen day on every card, and back.
  const day = card.getByLabel('Cards Work Until');
  const until = await page.evaluate(cid => getCardsWorkUntil(cid), at.cid);
  await expect(day).toHaveValue(until.date);
  await expect(card.locator('#sc-until-hint')).toContainText('A card stops opening after this day.');
  await day.fill('2027-03-12');
  await expect(card.locator('[data-action="spCardsWorkUntilDefault"]')).toBeVisible();
  await expect(card.locator('#sc-until-hint')).toHaveText('A card stops opening after this day.');
  expect((await savedCards(page, at.cid)).every(c => c.works_until === '2027-03-12')).toBe(true);
  await page.reload();
  await expect(page.locator('.sc-card').getByLabel('Cards Work Until')).toHaveValue('2027-03-12');
  await page.locator('.sc-card [data-action="spCardsWorkUntilDefault"]').click();
  await expect(page.locator('.sc-card').getByLabel('Cards Work Until')).toHaveValue(until.date);
  await expect(page.locator('.sc-card [data-action="spCardsWorkUntilDefault"]')).toHaveCount(0);
  expect((await savedCards(page, at.cid)).every(c => c.works_until === until.date)).toBe(true);

  await noCodeKept(page, [sheet], keptBefore);
  expect(await page.evaluate(() => localStorage.getItem('fv-sync-queue-v1'))).toBe(null);
  expect(errors).toEqual([]);
});
