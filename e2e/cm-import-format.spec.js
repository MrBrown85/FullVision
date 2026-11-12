import { test, expect } from '@playwright/test';

/* Import Roster (board: Import Roster canvas, Nov 11 2026), Demo Mode.
   An empty class shows where the class list goes; a MyEd class list goes
   straight to Ready to Add with nothing to match; any other file is checked
   column by column, its problems on their rows; afterwards a panel says what
   changed, and Undo This Import takes the new students back out. The roster's
   proficiency codes have tooltips. */

const MYED =
  'Legal Surname,Legal First Name,Usual First Name,Pupil #,Grade,Homeroom,Gender,Date of Birth\n' +
  'Bains,Arjun,AJ,1203400,08,D-12,M,2012-04-10\n' +
  'Castillo,Maya,,1203407,08,D-12,F,2012-02-24\n' +
  'Dhillon,Simran,,1203414,08,D-12,F,2012-07-16\n';

const MESSY =
  'Student Name,ID,Birthday,Parent Contact,Block,Notes,IEP\n' +
  '"Bains, Arjun",1203400,5/13/2012,bains.family@gmail.com,B,,\n' +
  '"Castillo, Maya",1203407,5/22/2012,castillo.family@gmail.com,B,,\n' +
  '"Fontaine, Luc",1203428,Sept 31 2012,fontaine.family@gmail.com,B,,\n' +
  '"Johal, Navdeep",1203456,1/15/2012,johal.family@gmail.com,B,,P\n' +
  '"Kowalczyk, Zofia",1203456,1/27/2012,kowalczyk.family@gmail.com,B,,\n' +
  '"",1203498,2/26/2012,patel.family@gmail.com,B,,\n';

async function enterDemo(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openStudents(page, cid) {
  await page.locator('[data-action="openClassManager"]').first().click();
  if (cid)
    await page
      .locator('[data-action="cmSelectClass"][data-cid="' + cid + '"]')
      .first()
      .click();
  await page.getByRole('tab', { name: /^Students/ }).click();
}

async function chooseFile(page, button, name, text) {
  const chooser = page.waitForEvent('filechooser');
  await button.click();
  await (await chooser).setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
}

test('A new class: a MyEd class list goes straight in, then Undo takes it back out', async ({ page }) => {
  await enterDemo(page);
  const cid = await page.evaluate(() => createCourse({ name: 'Science 8 Block D' }).id);
  await openStudents(page, cid);

  const empty = page.getByRole('region', { name: 'Add Your Students' });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Get the List From MyEducation BC');
  await expect(empty.getByRole('link', { name: 'Download Template' })).toHaveAttribute('href', '/roster-template.csv');
  await expect(page.locator('[data-action="cmImportRoster"]')).toHaveCount(0);

  await chooseFile(page, empty.getByRole('button', { name: 'Choose File' }), 'ScienceD_Roster.csv', MYED);
  const review = page.locator('.cm-import-review');
  await expect(review.getByRole('heading', { name: 'Ready to Add 3 Students' })).toBeVisible();
  await expect(review).toContainText(
    "This is a class list from MyEducation BC. Every column was read, so there's nothing to match.",
  );
  await expect(review).toContainText('Left out: Grade, Homeroom and Gender.');
  await expect(review.locator('.cm-import-field-btn')).toHaveCount(0);
  await review.getByRole('button', { name: 'Add 3 Students' }).click();

  const done = page.getByRole('region', { name: '3 Students Added to Science 8 Block D' });
  await expect(done).toBeVisible();
  await expect(page.locator('.cm-rs-new-tag')).toHaveCount(3);
  await expect(page.locator('.cm-rs-row').first().locator('[data-col="pref"]')).toHaveValue('AJ');
  await done.getByRole('button', { name: 'Undo This Import' }).click();
  await expect(page.getByRole('heading', { name: 'Import Undone' })).toBeVisible();
  await expect(page.locator('.cm-rs-row')).toHaveCount(0);
  expect(await page.evaluate(id => getStudents(id).length + getWithdrawnStudents(id).length, cid)).toBe(0);
});

test('A file of your own: columns checked over your rows, problems on their rows', async ({ page }) => {
  await enterDemo(page);
  const cid = await page.evaluate(() => createCourse({ name: 'Science 8 Block B' }).id);
  await openStudents(page, cid);
  await chooseFile(
    page,
    page.locator('.cm-import-empty').getByRole('button', { name: 'Choose File' }),
    'Block B.csv',
    MESSY,
  );
  const review = page.locator('.cm-import-review');
  await expect(review.getByRole('heading', { name: 'Check How Your File Was Read' })).toBeVisible();
  await expect(review.locator('.cm-import-tag.is-guess')).toHaveCount(2);
  await expect(review).toContainText('Read as month/day/year: 5/13/2012 can only be May 13.');
  await expect(review).toContainText('3 Rows Need a Look');
  await expect(review).toContainText('5 students will be added to Science 8 Block B.');

  // The column menu: each choice says what it takes; Escape closes it.
  const idBtn = review.getByRole('button', { name: 'What ID holds: Student Number' });
  await idBtn.click();
  const menu = review.getByRole('menu', { name: 'What ID holds' });
  await expect(menu.getByRole('menuitemradio', { name: /Student Number/ })).toBeFocused();
  await expect(menu).toContainText('2012-05-15, May 15 2012, or 5/15/2012.');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(idBtn).toBeFocused();

  // A name typed on the row with none adds that student.
  const nameBox = review.getByLabel('Type a name to add them');
  await nameBox.fill('Patel, Riya');
  await nameBox.press('Enter');
  await expect(review).toContainText('6 students will be added');

  // Designations only when chosen.
  await review.getByRole('button', { name: 'Import as Designations' }).click();
  await review.getByRole('button', { name: 'Add 6 Students' }).click();
  const done = page.getByRole('region', { name: '6 Students Added to Science 8 Block B' });
  await expect(done).toContainText(
    "have a blank to fill in: Luc Fontaine's birthday and Zofia Kowalczyk's student number.",
  );
  await done.getByRole('button', { name: 'Show Them' }).click();
  await expect(page.locator('.cm-rs-row:not([hidden])')).toHaveCount(2);
  const roster = await page.evaluate(id => getStudents(id), cid);
  expect(roster.find(s => s.firstName === 'Navdeep').designations).toEqual(['P']);
  expect(roster.find(s => s.firstName === 'Zofia').studentNumber).toBe('');
});

test('A class with students: Import Roster opens the drop strip and shows what will change', async ({ page }) => {
  await enterDemo(page);
  await openStudents(page);
  await page.locator('[data-action="cmImportRoster"]').click();
  const strip = page.getByRole('region', { name: 'Import Roster' });
  await expect(strip).toContainText('Students already here are matched by student number, so no one is added twice.');
  await expect(strip.getByRole('button', { name: 'Choose File' })).toBeFocused();
  await strip.getByRole('button', { name: 'Cancel' }).click();
  await expect(strip).toHaveCount(0);
  await expect(page.locator('[data-action="cmImportRoster"]')).toBeFocused();

  // The template is read in full and goes straight through.
  const csv = await page.evaluate(() => fetch('/roster-template.csv').then(r => r.text()));
  expect(await page.evaluate(t => DashClassManager.rosterImportReady(DashClassManager.rosterImportTable(t)), csv)).toBe(
    true,
  );
  await page.locator('[data-action="cmImportRoster"]').click();
  await chooseFile(page, strip.getByRole('button', { name: 'Choose File' }), 'roster.csv', csv);
  const review = page.locator('.cm-import-review');
  await expect(review.getByRole('heading', { name: 'What This File Will Change' })).toBeVisible();
  await expect(review).toContainText('In Your Class, Not in This File');
  await expect(review.getByRole('button', { name: 'Save Changes' })).toBeVisible();
  await review.getByRole('button', { name: 'Cancel' }).click();
  await expect(review).toHaveCount(0);
});

test('Each code beside a name has a tooltip, and the roster has no key', async ({ page }) => {
  await enterDemo(page);
  await expect(page.locator('#gb-roster-list .student-row-prof').first()).toBeVisible();
  await expect(page.locator('#gb-roster-legend')).toHaveCount(0);
  const titles = await page
    .locator('#gb-roster-list .student-row-prof')
    .evaluateAll(els => [...new Set(els.map(e => e.textContent + '=' + e.title))]);
  const names = {
    EXT: 'Extending',
    PRF: 'Proficient',
    DEV: 'Developing',
    EMG: 'Emerging',
    IE: 'Insufficient Evidence',
  };
  expect(titles.length).toBeGreaterThan(0);
  for (const t of titles) {
    const [code, title] = t.split('=');
    if (names[code]) expect(title).toBe(names[code]);
  }
  // Show: None hides the codes.
  await page.locator('#sb-show-btn').click();
  await page.locator('#sb-show-menu [role="menuitemradio"]', { hasText: 'None' }).click();
  await expect(page.locator('#gb-roster-list .student-row-prof')).toHaveCount(0);
});
