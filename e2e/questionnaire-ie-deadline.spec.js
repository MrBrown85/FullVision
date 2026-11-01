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

test('Generate leaves the deadline out until a date is picked; picking puts it in, Clear Date takes it out', async ({
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

  // Clear Date: the sentence comes out again and the row asks for a date.
  await page.locator('#tq-deadline-btn').click();
  await page.locator('#tq-cal-clear').click();
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  await expect(box).toHaveValue(drafted);
  expect((await saved(page)).ieDeadline).toBe(null);
  await expect(deadlineRow(page).locator('#tq-deadline-btn')).toHaveText('Pick a Date');
  await expect(deadlineRow(page).locator('.qn-req-text')).toHaveCount(0);
  await expect(page.locator('#tq-approve-next')).toBeDisabled();
});

test('a comment saved with [date] loses that sentence on load while no date is picked', async ({ page }) => {
  await open(page);
  await page.locator('#tq-generate').click();
  const drafted = await page.locator('#tq-narrative').inputValue();
  await page.evaluate(text => {
    upsertTermRating('sci8', 'st1', 'term-2', {
      narrative: text + ' The deadline to replace this IE with a grade is [date].',
    });
  }, drafted);
  // Opened again: the period picked again.
  await page.locator('#report-period').selectOption('Report 1');
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('#tq-narrative')).toHaveValue(drafted);
  expect((await saved(page)).narrative).toBe(drafted);
});
