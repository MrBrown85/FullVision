import { test, expect } from '@playwright/test';

/* The IE deadline is withheld until a date is picked (Colin, Nov 2), in
   Demo Mode with Science 8 switched to a Letter class (grade 10, so IE is
   on offer) and Cece on IE for Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => {
    COURSES.sci8.gradingSystem = 'letter';
    COURSES.sci8.gradeLevel = '10';
    clearProfCache();
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  await page.evaluate(() => {
    upsertTermRating('sci8', 'st1', 'term-2', { reportingBasis: 'ie', ieDeadline: null, narrative: '' });
    clearProfCache();
  });
  // Redraw on IE: the period picked again.
  await page.locator('#report-period').selectOption('Report 1');
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('.qn-grade-big')).toHaveText('IE');
}

const saved = page => page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2'));
const deadlineRow = page =>
  page.locator('#tq-sentences .qn-req-row').filter({ has: page.locator('.qn-req-label', { hasText: /^Deadline$/ }) });
const labels = page => page.locator('#tq-sentences .qn-req-label').allTextContents();

test('Generate leaves the deadline out until a date is picked; picking puts it in, a new date replaces only that date', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tq-generate').click();
  const box = page.locator('#tq-narrative');
  const drafted = await box.inputValue();
  expect(drafted).toContain('IE');
  expect(drafted).not.toContain('[date]');
  expect(drafted).not.toMatch(/deadline|replace this IE/i);

  // The Deadline row stays, Required, with Pick a Date and no sentence.
  const row = deadlineRow(page);
  await expect(row).toHaveCount(1);
  await expect(row.locator('.qn-req-chip')).toHaveText('Required');
  await expect(row.locator('#tq-deadline-btn')).toHaveText('Pick a Date');
  await expect(row.locator('.qn-req-text')).toHaveCount(0);
  // Where the sentence will go: after the Plan (Cece has all her work
  // marked, so none), before Support and Meeting (the IEPath mockup).
  const inPlace = order => {
    expect(order.indexOf('Deadline')).toBe(order.indexOf('Support') - 1);
    expect(order.indexOf('Support')).toBeLessThan(order.indexOf('Meeting'));
  };
  inPlace(await labels(page));
  await expect(page.locator('#tq-approve-next')).toBeDisabled();

  // Pick the first day the calendar allows.
  await page.locator('#tq-deadline-btn').click();
  const day = page.locator('#tq-cal .qn-cal-day:not([disabled])').first();
  const label = await day.getAttribute('aria-label');
  await day.click();
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  const picked = await box.inputValue();
  expect(picked).toContain(label);
  expect(picked).not.toContain('[date]');
  expect((await saved(page)).narrative).toBe(picked);
  await expect(deadlineRow(page).locator('.qn-req-text')).toContainText(label);
  await expect(page.locator('#tq-deadline-btn')).toHaveText(label);
  inPlace(await labels(page));
  // Only the Deadline sentence was added.
  const sentence = await deadlineRow(page).locator('.qn-req-text').textContent();
  expect(picked.replace(sentence + ' ', '')).toBe(drafted);

  // Another date: only the date in that sentence changes. The calendar
  // has no Clear Date.
  await page.locator('#tq-deadline-btn').click();
  await expect(page.locator('#tq-cal')).not.toContainText('Clear Date');
  const next = page.locator('#tq-cal .qn-cal-day:not([disabled])').nth(1);
  const label2 = await next.getAttribute('aria-label');
  await next.click();
  await expect(box).toHaveValue(picked.replace(sentence, sentence.replace(label, label2)));
  expect((await saved(page)).narrative).toBe(await box.inputValue());
});

test('a saved [date] comment is shown without that sentence, written only when a date is picked', async ({ page }) => {
  await open(page);
  await page.locator('#tq-generate').click();
  const drafted = await page.locator('#tq-narrative').inputValue();
  const legacy = drafted + ' The deadline to replace this IE with a grade is [date].';
  await page.evaluate(text => upsertTermRating('sci8', 'st1', 'term-2', { narrative: text }), legacy);
  // Opened again: the period picked again.
  await page.locator('#report-period').selectOption('Report 1');
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('#tq-narrative')).toHaveValue(drafted);
  // Nothing written on load.
  expect((await saved(page)).narrative).toBe(legacy);
  // Picking a date saves the comment as shown, with the new sentence.
  await page.locator('#tq-deadline-btn').click();
  const day = page.locator('#tq-cal .qn-cal-day:not([disabled])').first();
  const label = await day.getAttribute('aria-label');
  await day.click();
  const text = (await saved(page)).narrative;
  expect(text).not.toContain('[date]');
  expect(text).toContain(label);
  await expect(page.locator('#tq-narrative')).toHaveValue(text);
});

test('the calendar keeps the focus: ‹ and › with clicks and keys, then ↓ ↑ never move to another student', async ({
  page,
}) => {
  await open(page);
  const name = page.locator('.qn-name');
  const who = await name.textContent();
  const url = page.url();
  await page.locator('#tq-deadline-btn').click();
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  const inCal = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#tq-cal'));
  const title = () => page.locator('#tq-cal .qn-cal-title').textContent();
  const first = await title();

  // A real click on ›: the month moves, the focus stays in the calendar,
  // and ↓ ↑ stay with this student.
  await page.locator('#tq-cal [data-dir="1"]').click();
  expect(await title()).not.toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(name).toHaveText(who);
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  expect(page.url()).toBe(url);

  // ‹ by click, then › by Enter on the focused button.
  await page.locator('#tq-cal [data-dir="-1"]').click();
  expect(await title()).toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);
  await page.locator('#tq-cal [data-dir="1"]').focus();
  await page.keyboard.press('Enter');
  expect(await title()).not.toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);

  // A click on the calendar's title (no control) keeps the focus there too.
  await page.locator('#tq-cal .qn-cal-title').click();
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);

  // Escape closes it and gives the focus back to Pick a Date.
  await page.keyboard.press('Escape');
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  await expect(page.locator('#tq-deadline-btn')).toBeFocused();
});

test('choosing IE waits for a date; › and ↓ in that calendar keep the student and the waiting IE', async ({ page }) => {
  await open(page);
  await page.evaluate(() => upsertTermRating('sci8', 'st1', 'term-2', { reportingBasis: 'grade', ieDeadline: null }));
  await page.locator('#report-period').selectOption('Report 1');
  await page.locator('#report-period').selectOption('Report 2');
  const name = page.locator('.qn-name');
  const who = await name.textContent();
  await page.locator('#tq-basis [data-basis="ie"]').click();
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  await page.locator('#tq-cal [data-dir="1"]').click();
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  expect(await page.evaluate(() => ReportQuestionnaire.iePending())).toBe(true);
});
