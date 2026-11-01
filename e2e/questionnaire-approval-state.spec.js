import { test, expect } from '@playwright/test';

/* Approval and screen state (bug hunt, Nov 1 2026), in Demo Mode on
   Science 8's Report 2 (Term 2, from July 13). */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await go(page, student);
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
}
async function go(page, student) {
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
}
const saved = (page, sid) => page.evaluate(s => getStudentTermRating('sci8', s, 'term-2') || {}, sid);

/* Liam's Generate draft names his best piece this term; returns its title. */
async function generateLiam(page) {
  await page.locator('#tq-generate').click();
  await expect(page.locator('#tq-narrative')).toHaveValue(/best piece was “/);
  return (await page.locator('#tq-narrative').inputValue()).match(/best piece was “(.+?)[.?!]?”/)[1];
}

/* That piece marked down in the gradebook: a level of 1, or 1 point. */
async function markDown(page, title) {
  await page.evaluate(t => {
    const a = getAssessments('sci8').find(x => x.title === t);
    getScores('sci8')
      .st4.filter(e => e.assessmentId === a.id)
      .forEach(e => upsertScore('sci8', 'st4', e.assessmentId, e.tagId, 1, e.date, e.type, e.note, e.mod));
  }, title);
}

/* Liam's Generate draft, approved; then his best piece is marked down. */
async function approveLiamThenMarkDown(page) {
  await open(page, 'st4');
  await page.evaluate(() => upsertTermRating('sci8', 'st4', 'term-2', { narrative: '' }));
  await go(page, 'st5');
  await go(page, 'st4');
  const best = await generateLiam(page);
  for (const cb of await page.locator('[data-tq-check]').all()) await cb.check();
  await page.locator('#tq-approve-next').click();
  await expect.poll(async () => (await saved(page, 'st4')).approvedAt).toBeTruthy();
  await markDown(page, best);
  return best;
}

test('a mark changed after approval: the notice and the orange dot', async ({ page }) => {
  const best = await approveLiamThenMarkDown(page);
  await go(page, 'st5');
  await go(page, 'st4');
  const board = page.locator('#tq-stale');
  await expect(board).toBeVisible();
  await expect(board.locator('.qn-stale-note')).toContainText('“' + best + '” was marked after');
  await expect(board.locator('.qn-stale-was').first()).toHaveText('His best piece was “' + best + '.”');
  await expect(board.locator('.qn-stale-keep').first()).toHaveText('Keep as Approved');
  await expect(page.locator('#gb-sidebar .student-row[data-sid="st4"] .student-row-mark.flag')).toHaveText('●');
  await expect(page.locator('#tq-approve-next')).toBeDisabled();
  await expect(page.locator('#tq-ready')).toHaveText(
    'Approve and Next is off until you pick Keep as Approved or Use the New Sentence.',
  );
});

test('a mark changed before approval: the row shows it and Approve and Next waits', async ({ page }) => {
  await open(page, 'st4');
  await page.evaluate(() => upsertTermRating('sci8', 'st4', 'term-2', { narrative: '' }));
  await go(page, 'st5');
  await go(page, 'st4');
  const best = await generateLiam(page);
  for (const cb of await page.locator('[data-tq-check]').all()) await cb.check();
  // Marked down in another tab of the gradebook, then Approve and Next.
  await markDown(page, best);
  await page.locator('#tq-approve-next').click();
  expect((await saved(page, 'st4')).approvedAt).toBeFalsy();
  await expect(page.locator('.qn').first()).toHaveAttribute('data-sid', 'st4');
  const claim = page.locator('#tq-sentences .qn-claim').first();
  await expect(claim.locator('.qn-stale-was')).toHaveText('His best piece was “' + best + '.”');
  await expect(claim.locator('.qn-stale-label').first()).toHaveText('Written');
  await expect(claim.locator('.qn-stale-keep')).toHaveText('Keep as Written');
  await expect(page.locator('#tq-approve-next')).toBeDisabled();
  await expect(page.locator('#tq-ready')).toHaveText(
    'Approve and Next is off until you pick Use the New Sentence or Keep as Written.',
  );
  const now = await claim.locator('.qn-stale-now').textContent();
  await claim.locator('.qn-stale-use').click();
  await expect(page.locator('#tq-narrative')).toHaveValue(new RegExp(now.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Every row resolved: Approve and Next saves the comment as it is now.
  while (await page.locator('#tq-sentences .qn-claim .qn-stale-use').count())
    await page.locator('#tq-sentences .qn-claim .qn-stale-use').first().click();
  await expect(page.locator('#tq-approve-next')).toBeEnabled();
  await page.locator('#tq-approve-next').click();
  await expect.poll(async () => (await saved(page, 'st4')).approvedAt).toBeTruthy();
  expect((await saved(page, 'st4')).narrative).not.toContain('His best piece was “' + best + '.”');
});

test('Write Your Own on one student does not follow to the next', async ({ page }) => {
  await open(page, 'st1');
  await page.locator('#tq-generate').click();
  await page.locator('#tq-sentences .qn-gap').first().locator('.qn-gap-add').click();
  await page.locator('#tq-add-menu [data-do="ownOpen"]').click();
  await page.locator('#tq-own-input').fill('Sentence for Cece only');
  const before = (await saved(page, 'st2')).narrative;
  await page.locator('#gb-sidebar .student-row[data-sid="st2"]').click();
  await expect(page.locator('.qn').first()).toHaveAttribute('data-sid', 'st2');
  await expect(page.locator('#tq-own-input')).toHaveCount(0);
  expect((await saved(page, 'st2')).narrative).toBe(before);
  expect(await page.locator('#tq-narrative').inputValue()).not.toContain('Sentence for Cece only');
});

test('IE with no date: the calendar opens, nothing saves until a date; Escape keeps Letter Grade', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => {
    COURSES.sci8.gradingSystem = 'letter';
    COURSES.sci8.gradeLevel = '10';
    // Cece has marks on only a few assignments, so IE is on offer.
    const keep = getScores('sci8').st1.slice(0, 2);
    getScores('sci8').st1 = keep;
    clearProfCache();
  });
  await go(page, 'st1');
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  const ie = page.locator('#tq-basis [data-basis="ie"]');
  test.skip(!(await ie.count()), 'IE is not on offer for this student in Demo Mode');
  await ie.click();
  await expect(page.locator('#tq-cal')).toBeVisible();
  await expect(ie).toHaveClass(/\bpending\b/);
  await expect(page.locator('#tq-basis')).toContainText('Pick the deadline to report IE.');
  expect((await saved(page, 'st1')).reportingBasis || 'grade').toBe('grade');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  await expect(page.locator('#tq-basis [data-basis="grade"]')).toHaveAttribute('aria-checked', 'true');
  expect((await saved(page, 'st1')).reportingBasis || 'grade').toBe('grade');
  // Again, and a date: IE and the deadline save together.
  await ie.click();
  await page.locator('#tq-cal .qn-cal-day:not([disabled])').first().click();
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  const r = await saved(page, 'st1');
  expect(r.reportingBasis).toBe('ie');
  expect(r.ieDeadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('#tq-basis [data-basis="ie"]')).toHaveAttribute('aria-checked', 'true');
});
