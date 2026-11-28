import { test, expect } from '@playwright/test';

/* Sentences of the teacher's own and the bank's other wordings, in the new
   boxes (docs/plans/write-comments-plan.md, decisions 6 and 11): Write Your
   Own, Add to My Bank, Belongs Under, Other Ways back to the bank's wording,
   and Remove From Comment with Undo. Demo Mode, Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 1100 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
}
/* The seeded comment cleared and a draft written, so every box has its sentences. */
async function generated(page) {
  await page.locator('#tq-narrative').evaluate(el => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#tq-generate-first').click();
  await expect(page.locator('#tq-read .wc-sent').first()).toBeVisible();
}
const head = (page, key) => page.locator('#wc-head-' + key);
async function openBox(page, key) {
  if ((await head(page, key).getAttribute('aria-expanded')) !== 'true') await head(page, key).click();
}
const comment = page => page.locator('#tq-narrative').inputValue();

test('Write Your Own: saved from the sentence sheet, shown as Yours, used, and still there after a reload', async ({
  page,
}) => {
  await open(page);
  await page.locator('.qn-hs-stop[data-habit="completes"][data-value="4"]').click();
  await generated(page);
  await page.locator('.qn-hs-stop[data-habit="completes"][data-value="4"]').click();
  await page.locator('.qn-hs-stop[data-habit="completes"][data-value="4"]').click();
  await openBox(page, 'habits');
  await page.locator('.wc-box[data-part="habits"] [data-do="wcBrowse"]').click();
  const sheet = page.getByRole('dialog', { name: 'Comment Bank for Cece' });
  await sheet.locator('[role="tab"]', { hasText: 'Work Habits' }).click();
  const box = sheet.locator('#tq-own');
  await expect(sheet.locator('.qn-browse-bar .btn')).toHaveText('+ Write Your Own');
  await sheet.locator('#tq-browse-write').click();
  await expect(box.locator('#tq-own-input')).toBeFocused();
  await expect(box.locator('#tq-own-part')).toHaveValue('habits');
  await box.locator('#tq-own-case').selectOption('');
  await expect(box.locator('.btn-primary')).toHaveText('Add to Work Habits');
  await expect(box.locator('#tq-own-save')).toBeDisabled();
  await box.locator('#tq-own-input').fill('Cece brings her notebook and starts the warm-up without a reminder.');
  await expect(box.locator('.qn-own-why')).toHaveCount(0);
  await box.locator('#tq-own-save').click();
  const mine = sheet.locator('.qn-browse-row', { has: page.locator('.qn-chip-yours') });
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.qn-chip-yours')).toHaveText('Yours · Any Student');
  await mine.locator('.qn-browse-use').click();
  await expect(mine.locator('.qn-browse-inuse')).toHaveText('In the Comment');
  await mine.locator('.qn-browse-unuse').click();
  await expect(page.locator('#tq-narrative')).not.toHaveValue(/She brings her notebook/);
  await mine.locator('.qn-browse-use').click();
  await expect(page.locator('#tq-narrative')).toHaveValue(/She brings her notebook and starts the warm-up/);
  await sheet.locator('.qn-browse-done').click();
  // It is a line of the Work Habits box.
  await expect(
    page.locator('.wc-box[data-part="habits"] .wc-line', { hasText: 'She brings her notebook' }),
  ).toHaveCount(1);
  await page.reload();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await expect(page.locator('#tq-narrative')).toHaveValue(/She brings her notebook/);
  await openBox(page, 'habits');
  await page.locator('.wc-box[data-part="habits"] [data-do="wcBrowse"]').click();
  await sheet.locator('[role="tab"]', { hasText: 'Work Habits' }).click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveText(['Yours · Any Student']);
  await sheet.locator('.qn-browse-del').click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveCount(0);
  await expect(page.locator('#undo-toast')).toContainText('Removed from your bank.');
  await page.locator('#undo-toast .undo-toast-btn').click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveText(['Yours · Any Student']);
});

test('+ Write Your Own in a box foot adds a Yours line there; Add to My Bank on it starts on its part', async ({
  page,
}) => {
  await open(page);
  await generated(page);
  await openBox(page, 'strength');
  await page.locator('.wc-box[data-part="strength"] [data-do="wcWrite"]').last().click();
  await page.locator('#tq-wc-write').fill('Cece asks a question when a step is unclear');
  await page.locator('#tq-wc-write').press('Enter');
  const line = page.locator('.wc-box[data-part="strength"] .wc-line', { hasText: 'Cece asks a question' });
  await expect(line).toHaveCount(1);
  await expect(line.locator('.wc-chip.own', { hasText: 'Yours' })).toBeVisible();
  await expect.poll(() => comment(page)).toContain('Cece asks a question when a step is unclear.');
  await line.locator('[data-do="ownAdd"]').click();
  const own = page.locator('#tq-own');
  await expect(own.locator('#tq-own-input')).toHaveValue('Cece asks a question when a step is unclear.');
  await expect(own.locator('#tq-own-part')).toHaveValue('strengths');
  await own.locator('#tq-own-save').click();
  await expect(own).toHaveCount(0);
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(1);
  // Saved: the line says it is in the bank, and offers to add it no more.
  await expect(line.locator('[data-do="ownAdd"]')).toHaveCount(0);
  await expect(line.locator('.wc-chip', { hasText: 'In My Bank' })).toBeVisible();
  // Still so after a reload, in whichever box the sentence is read back into.
  await page.reload();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  const back = page.locator('.wc-line', { hasText: 'Cece asks a question' });
  await expect(back).toHaveCount(1);
  const part = await back.getAttribute('data-wc-part');
  await openBox(page, part);
  await expect(back.locator('.wc-chip', { hasText: 'In My Bank' })).toBeVisible();
  await expect(back.locator('[data-do="ownAdd"]')).toHaveCount(0);
  // Selected in the comment box, it is not offered for the bank either.
  await page.locator('#tq-narrative').evaluate(el => {
    const at = el.value.indexOf('Cece asks a question');
    el.focus();
    el.setSelectionRange(at, at + 20);
    el.dispatchEvent(new Event('select'));
  });
  await expect(page.locator('#tq-sel-add')).toBeHidden();
  // Changed by hand, it is a new sentence: Add to My Bank comes back.
  await back.locator('.wc-text').click();
  await back.locator('.wc-edit').fill('Cece asks a question when a step is unclear, and then tries it again.');
  await back.locator('.wc-edit').press('Enter');
  await expect.poll(() => comment(page)).toContain('tries it again.');
  const changed = page.locator('.wc-line', { hasText: 'tries it again' });
  await expect(changed.locator('[data-do="ownAdd"]')).toHaveCount(1);
  await expect(changed.locator('.wc-chip', { hasText: 'In My Bank' })).toHaveCount(0);
});

test('Belongs Under says why Grade is not offered', async ({ page }) => {
  await open(page);
  await generated(page);
  await openBox(page, 'grade');
  await page.locator('.wc-box[data-part="grade"] [data-do="wcWrite"]').click();
  await page.locator('#tq-wc-write').fill('Cece has been working hard in Science 8');
  await page.locator('#tq-wc-write').press('Enter');
  const line = page.locator('.wc-box[data-part="grade"] .wc-line', { hasText: 'Cece has been working hard' });
  await line.locator('[data-do="ownAdd"]').click();
  await expect(page.locator('#tq-own .qn-own-hint', { hasText: 'My Bank keeps no Grade sentences' })).toHaveCount(1);
});

test('Add to My Bank from the comment box: the pill shows only on a typed sentence; × purges after the toast', async ({
  page,
}) => {
  await open(page);
  await generated(page);
  await page.locator('#tq-read').click();
  const box = page.locator('#tq-narrative');
  const pill = page.locator('#tq-sel-add');
  await box.evaluate(el => {
    el.setSelectionRange(0, 12);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect(pill).toBeHidden();
  await box.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type(' Cece asks a question when a step is unclear.');
  await expect
    .poll(() =>
      page.evaluate(() => ReportQuestionnaire.sentencesOf(document.getElementById('tq-narrative').value).length),
    )
    .toBeGreaterThan(3);
  await page.waitForTimeout(500);
  await box.evaluate(el => {
    const i = el.value.indexOf('Cece asks');
    el.setSelectionRange(i, i + 9);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('Add to My Bank');
  await pill.click();
  const own = page.locator('.wc-line', { hasText: 'Cece asks a question' }).locator('#tq-own');
  await expect(own.locator('#tq-own-input')).toHaveValue('Cece asks a question when a step is unclear.');
  await own.locator('#tq-own-part').selectOption('strengths');
  await own.locator('#tq-own-save').click();
  await expect(own).toHaveCount(0);
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(1);
  await openBox(page, 'strength');
  await page.locator('.wc-box[data-part="strength"] [data-do="wcBrowse"]').click();
  const sheet = page.getByRole('dialog', { name: 'Comment Bank for Cece' });
  await sheet.locator('[role="tab"]', { hasText: 'Strength' }).click();
  await expect(sheet.locator('.qn-chip-yours')).toHaveText(['Yours · Any Student']);
  await sheet.locator('.qn-browse-del').click();
  await expect(page.locator('#undo-toast')).toBeVisible();
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(0);
  await page.evaluate(() => dismissUndoToast());
  await expect(page.locator('#undo-toast')).toHaveCount(0);
  await page.reload();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  expect(await page.evaluate(() => PersonalBank.list().length)).toBe(0);
});

test('an edited sentence can go back to the bank wording from Other Ways; Remove From Comment has Undo', async ({
  page,
}) => {
  await open(page);
  await generated(page);
  await openBox(page, 'grade');
  const line = page.locator('.wc-box[data-part="grade"] .wc-line').first();
  const bankText = (await line.locator('.wc-text').textContent()).trim();
  await line.locator('.wc-text').click();
  await line.locator('.wc-edit').fill(bankText.replace(/\.$/, ' today.'));
  await line.locator('.wc-edit').press('Enter');
  await expect.poll(() => comment(page)).toContain('today.');
  await expect(line.locator('.wc-chip.own', { hasText: 'Yours' })).toBeVisible();
  // Other Ways lists the bank's own wording last; Use puts it back.
  await line.locator('[data-do="wcWays"]').click();
  await page.locator('.wc-box[data-part="grade"] .wc-way').last().locator('[data-do="wcUse"]').click();
  await expect.poll(() => comment(page)).not.toContain('today.');
  await expect(page.locator('.wc-box[data-part="grade"] .wc-chip.own', { hasText: 'Yours' })).toHaveCount(0);
  // Remove From Comment, then Undo.
  const before = await comment(page);
  const first = page.locator('.wc-box[data-part="grade"] .wc-line').first();
  const gone = (await first.locator('.wc-text').textContent()).trim();
  await first.locator('[data-do="remove"]').click();
  await expect.poll(() => comment(page)).not.toContain(gone.slice(gone.indexOf(' ') + 1));
  await page.locator('#undo-toast button', { hasText: 'Undo' }).click();
  await expect.poll(() => comment(page)).toBe(before);
});

test('an edited sentence is marked Yours and a typed one is kept; Generate Again keeps both', async ({ page }) => {
  await open(page);
  await generated(page);
  await openBox(page, 'grade');
  const line = page.locator('.wc-box[data-part="grade"] .wc-line').first();
  const bankText = (await line.locator('.wc-text').textContent()).trim();
  await line.locator('.wc-text').click();
  await line.locator('.wc-edit').fill(bankText.replace(/\.$/, ' this month.'));
  await line.locator('.wc-edit').press('Enter');
  await expect(line.locator('.wc-chip.own', { hasText: 'Yours' })).toBeVisible();
  await page.locator('.wc-box[data-part="grade"] [data-do="wcWrite"]').click();
  await page.locator('#tq-wc-write').fill('Cece keeps a tidy notebook');
  await page.locator('#tq-wc-write').press('Enter');
  await expect.poll(() => comment(page)).toContain('Cece keeps a tidy notebook.');
  await page.locator('#tq-generate').click();
  expect(await comment(page)).toContain('this month.');
  expect(await comment(page)).toContain('Cece keeps a tidy notebook.');
  await expect(
    page.locator('.wc-box[data-part="grade"] .wc-line', { hasText: 'Cece keeps a tidy notebook' }),
  ).toHaveCount(1);
});

test('the grip moves a sentence with the arrow keys and the comment follows', async ({ page }) => {
  await open(page);
  await generated(page);
  await openBox(page, 'strength');
  // A sentence with none to pass has no grip; two more give the Strength box three.
  await expect(page.locator('[data-wc-grip]')).toHaveCount(0);
  for (let i = 0; i < 2; i++) await page.locator('.wc-box[data-part="strength"] [data-do="wcSay"]').first().click();
  await expect(page.locator('.wc-box[data-part="strength"] .wc-grip')).toHaveCount(3);
  const before = await comment(page);
  const grip = page.locator('.wc-box[data-part="strength"] .wc-grip').first();
  await grip.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => comment(page)).not.toBe(before);
  expect((await comment(page)).split(' ').sort()).toEqual(before.split(' ').sort());
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => comment(page)).toBe(before);
});

/* Comment Bank under the comment (Colin, Nov 26: "teachers should be able
   to just click the comment bank button to allow them to insert it
   anywhere"): the sentence goes where the teacher last clicked in the
   comment, else at its end, and each next one after it; the sheet says
   where. */
test('Comment Bank puts a sentence where the teacher clicked in the comment, else at its end', async ({ page }) => {
  await open(page);
  await generated(page);
  const sents = page.locator('#tq-read .wc-sent');
  const first = await sents.first().textContent();
  const n = await sents.count();
  // No click in the comment: at its end.
  await page.locator('#tq-comment-bank').click();
  const sheet = page.getByRole('dialog', { name: 'Comment Bank for Cece' });
  await expect(sheet.locator('.qn-browse-goes')).toHaveText('Goes at the end of the comment.');
  await sheet.locator('.qn-browse-done').click();
  await expect(page.locator('#tq-comment-bank')).toBeFocused();
  // A click in the first sentence: after it.
  await page.locator('#tq-read').click({ position: { x: 80, y: 10 } });
  await expect(page.locator('#tq-narrative')).toBeFocused();
  expect(await page.locator('#tq-narrative').evaluate(el => el.selectionStart)).toBeLessThan(first.length);
  await page.locator('#tq-comment-bank').click();
  await expect(sheet.locator('.qn-browse-goes')).toContainText('Goes after “' + first.split(' ').slice(0, 3).join(' '));
  const use = sheet.locator('#tq-browse-list [data-do="use"]').first();
  const used = (
    await use.evaluate(b => b.closest('.qn-browse-row').querySelector('.qn-browse-text, span').textContent)
  ).trim();
  await use.click();
  await sheet.locator('.qn-browse-done').click();
  await expect(sents).toHaveCount(n + 1);
  await expect(sents.nth(0)).toHaveText(first);
  // The sheet names the student; in the comment, after the first sentence, it says She.
  await expect(sents.nth(1)).toContainText(used.split(' ').slice(1, 5).join(' '));
});
