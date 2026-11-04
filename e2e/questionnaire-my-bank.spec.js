import { test, expect } from '@playwright/test';

/* + Add to My Bank on the Term Questionnaire (Nov 3 sweep, step 4).
   Demo Mode, Science 8, Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
}

test('Belongs Under starts on the part it was opened from, says why Grade is not offered, and the box wraps (group 2 #58)', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tq-generate').click();
  await page.locator('#tq-browse-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
  const box = sheet.locator('#tq-own');
  // From the Strengths tab: Strengths.
  await sheet.locator('[role="tab"]', { hasText: 'Strengths' }).click();
  await sheet.locator('.qn-browse-add-top').click();
  await expect(box.locator('#tq-own-part')).toHaveValue('strengths');
  await expect(box.locator('.qn-own-hint', { hasText: 'My Bank keeps no' })).toHaveCount(0);
  await box.locator('.qn-line-cancel').click();
  // From the Grade tab: Grade is not a part My Bank keeps, and it says so.
  await sheet.locator('[role="tab"]', { hasText: 'Grade' }).click();
  await sheet.locator('.qn-browse-add-top').click();
  await expect(box.locator('.qn-own-hint', { hasText: 'My Bank keeps no Grade sentences' })).toHaveCount(1);
  // The box is two lines and wraps a long sentence.
  const input = box.locator('#tq-own-input');
  await expect(input).toHaveJSProperty('tagName', 'TEXTAREA');
  await input.fill(
    'Cece reads every lab question twice, plans each step on paper first and then checks her results with a partner.',
  );
  expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await input.evaluate(el => el.clientHeight)).toBeGreaterThan(40);
});

test('a search with no match here offers the parts where it does match (group 3 #69)', async ({ page }) => {
  await open(page);
  await page.locator('#tq-generate').click();
  await page.locator('#tq-browse-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
  await sheet.locator('[role="tab"]', { hasText: 'Closing' }).click();
  await sheet.locator('[role="tab"]', { hasText: 'Grade' }).click();
  // A word only the Next Step sentences use.
  const word = await page.evaluate(() => {
    const words = s =>
      new Set(
        String(s.text)
          .replace(/\{[^}]*\}|\[[^\]]*\]/g, ' ')
          .toLowerCase()
          .match(/[a-z]{6,}/g) || [],
      );
    const next = COMMENT_BANK.sentences.filter(s => s.group === 'Next Step' && !s.mine);
    const grade = new Set(COMMENT_BANK.sentences.filter(s => s.group !== 'Next Step').flatMap(s => [...words(s)]));
    for (const s of next) for (const w of words(s)) if (!grade.has(w)) return w;
    return '';
  });
  expect(word).not.toBe('');
  await sheet.locator('#tq-browse-search').fill(word);
  const empty = sheet.locator('.qn-browse-empty');
  await expect(empty).toContainText('match “' + word + '”');
  const go = empty.locator('.qn-browse-elsewhere-btn', { hasText: 'Next Step' });
  await expect(go).toHaveCount(1);
  await go.click();
  await expect(sheet.locator('[role="tab"][aria-selected="true"]')).toHaveText('Next Step');
  await expect(sheet.locator('.qn-browse-row').first()).toBeVisible();
});

test('the My Bank form names its case select and says what the brackets mean (group 3 #72)', async ({ page }) => {
  await open(page);
  await page.locator('#tq-generate').click();
  await page.locator('#tq-browse-btn').click();
  const sheet = page.getByRole('dialog', { name: 'Sentences for Cece' });
  await sheet.locator('[role="tab"]', { hasText: 'Strengths' }).click();
  await sheet.locator('.qn-browse-add-top').click();
  const box = sheet.locator('#tq-own');
  await expect(box.getByLabel('Used For')).toHaveValue('');
  await expect(box.locator('label.qn-own-label', { hasText: 'Used For' })).toBeVisible();
  await expect(box.locator('#tq-own-case option').first()).toHaveText('Any Student');
  await expect(box.locator('.qn-own-hint')).toHaveText(
    'Write it for this student. In the saved sentence, the words in brackets change for each student.',
  );
  await expect(box).not.toContainText('slots');
});
