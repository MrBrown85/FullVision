import { test, expect } from '@playwright/test';

/* What the facts in the boxes must still do (docs/plans/write-comments-plan.md,
   decision 11): the named piece and skill, the missing work, the student's
   Voice, the class warning, and what ratings and attendance add. Demo Mode,
   Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 1100 } });

async function open(page, student = 'st1', opts = {}) {
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
  if (opts.generate) {
    await page.locator('#tq-narrative').evaluate(el => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#tq-generate-first').click();
    await expect(page.locator('#tq-read .wc-sent').first()).toBeVisible();
  }
}
const head = (page, key) => page.locator('#wc-head-' + key);
async function openBox(page, key) {
  if ((await head(page, key).getAttribute('aria-expanded')) !== 'true') await head(page, key).click();
}
const comment = page => page.locator('#tq-narrative').inputValue();

test('Name This One changes the sentence and the head, and survives Generate and a reload', async ({ page }) => {
  await open(page, 'st1', { generate: true });
  await openBox(page, 'best');
  const box = page.locator('.wc-box[data-part="best"]');
  await expect(box.locator('.wc-line')).toHaveCount(1);
  const name = box.locator('[data-do="wcSay"]').nth(1);
  await expect(name).toHaveText('Name This One');
  const title = (
    await name
      .locator('xpath=ancestor::*[contains(@class,"wc-fact")][1]//*[contains(@class,"wc-fact-name")]')
      .first()
      .textContent()
  ).trim();
  await name.click();
  await expect.poll(() => comment(page)).toContain(title);
  await expect(box.locator('.wc-line .wc-text').first()).toContainText(title);
  await expect(head(page, 'best')).toContainText(title);
  await expect(box.locator('.wc-foot')).toContainText('Open in Grader ›');
  await page.locator('#tq-generate').click();
  await expect(head(page, 'best')).toContainText(title);
  await page.reload();
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await expect(head(page, 'best')).toContainText(title);
});

test('Say This on a skill names that skill as a strength', async ({ page }) => {
  await open(page, 'st1', { generate: true });
  await openBox(page, 'strength');
  const box = page.locator('.wc-box[data-part="strength"]');
  const say = box.locator('[data-do="wcSay"]').first();
  const name = (
    await say
      .locator('xpath=ancestor::*[contains(@class,"wc-fact")][1]//*[contains(@class,"wc-fact-name")]')
      .first()
      .textContent()
  ).trim();
  const before = await comment(page);
  await say.click();
  await expect.poll(() => comment(page)).not.toBe(before);
  // The sentence sits under that skill's own row.
  await expect(box.locator('.wc-fact-wrap', { hasText: name }).locator('.wc-line')).toHaveCount(1);
});

test('See the N lists the missing work and opens the grader; it changes no status', async ({ page }) => {
  await open(page, 'st6');
  await openBox(page, 'missing');
  const before = await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')));
  const see = page.locator('.wc-box[data-part="missing"] [data-do="wcSee"]');
  await expect(see).toHaveText(/^See the \d+$/);
  await see.click();
  const items = page.locator('.wc-box[data-part="missing"] .wc-sub');
  await expect(items.first()).toBeVisible();
  await items.first().locator('[data-action="tqOpenGrader"]').click();
  await expect(page.locator('#grader-overlay .grader-dialog')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')))).toBe(before);
});

test('Cece’s Voice: the answers, the private one marked and never quotable, a quoted answer says In the Comment', async ({
  page,
}) => {
  await open(page);
  await openBox(page, 'voice');
  const box = page.locator('.wc-box[data-part="voice"]');
  await expect(head(page, 'voice')).toContainText('Cece’s Voice');
  const priv = box.locator('.wc-fact-wrap', { has: page.locator('.wc-chip.priv') });
  await expect(priv.locator('.wc-fact-name')).toHaveText('To you only');
  await expect(priv).toContainText('grandma');
  await expect(priv.locator('[data-do="wcSay"]')).toHaveCount(0);
  const good = box.locator('.wc-fact-wrap', { hasText: 'Good at' });
  await expect(good.locator('.wc-chip', { hasText: 'In the Comment' })).toHaveCount(0);
  await good.locator('[data-do="wcSay"]').click();
  await expect(good.locator('.wc-chip', { hasText: 'In the Comment' })).toBeVisible();
  await expect(good.locator('.wc-line')).toHaveCount(1);
});

test('a near-identical comment shows the class warning with Show Both', async ({ page }) => {
  await open(page);
  await openBox(page, 'att');
  for (const key of await page.evaluate(() => CommentBank.HABITS.map(h => h.key))) {
    await page.locator(`.qn-hs-stop[data-habit="${key}"][data-value="4"]`).click();
  }
  await page.locator('#tq-att-absences').fill('3');
  await page.locator('#tq-att-absences').press('Tab');
  await page.locator('#tq-att-lates').fill('1');
  await page.locator('#tq-att-lates').press('Tab');
  await page.locator('#tq-generate').click();
  const cece = await comment(page);
  expect(await page.evaluate(t => ReportQuestionnaire.sentencesOf(t).length, cece)).toBeGreaterThanOrEqual(6);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await expect(page.locator('#tq-warn')).toHaveCount(0);
  await page.evaluate(
    t => {
      const el = document.getElementById('tq-narrative');
      el.value = ReportQuestionnaire.sentencesOf(t).slice(0, 6).join(' ');
      ReportQuestionnaire.tqNarrativeInput();
    },
    cece.replace(/Cece/g, 'Noor'),
  );
  await expect(page.locator('#tq-warn')).toContainText(/Five of these sentences are also in Cece Adeyemi’s comment\./);
  await page.locator('[data-action="tqShowBoth"]').click();
  const both = page.locator('#tq-both-overlay');
  await expect(both.locator('#tq-both-title')).toHaveText('Both Comments');
  await expect(both.locator('.qn-both-name').nth(0)).toHaveText('Noor Al-Rashid');
  await expect(both.locator('.qn-both-name').nth(1)).toHaveText('Cece Adeyemi');
  expect(await both.locator('.qn-both-s.shared').count()).toBeGreaterThanOrEqual(10);
  await page.keyboard.press('Escape');
  await expect(both).toHaveCount(0);
  await expect(page.locator('[data-action="tqShowBoth"]')).toBeFocused();
});

test('a rating adds the habits sentences and attendance adds and removes its sentence, without Generate', async ({
  page,
}) => {
  await open(page, 'st1', { generate: true });
  await openBox(page, 'att');
  const habits = page.locator('.wc-box[data-part="habits"] .wc-line');
  const att = page.locator('.wc-box[data-part="att"] .wc-line');
  await expect(habits).toHaveCount(0);
  for (const k of ['completes', 'ready', 'others', 'part', 'feedback', 'devices']) {
    await page.locator(`.qn-hs-stop[data-habit="${k}"][data-value="4"]`).click();
  }
  const excellent = /hands in her work on time and comes to class ready to start\./;
  await expect(page.locator('#tq-narrative')).toHaveValue(excellent);
  await expect(page.locator('#tq-narrative')).toHaveValue(
    /listens to others, joins in class discussions, and uses feedback/,
  );
  await expect(habits).toHaveCount(2);
  await expect(habits.first().locator('.wc-text')).toHaveText(excellent);

  await page.locator('#tq-att-absences').fill('3');
  await page.locator('#tq-att-absences').press('Tab');
  await page.locator('#tq-att-lates').fill('1');
  await page.locator('#tq-att-lates').press('Tab');
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');
  const attendance = /[^.]*\bthree classes\b[^.]*\bonce\b[^.]*\.|[^.]*\bonce\b[^.]*\bthree classes\b[^.]*\./;
  await expect(page.locator('#tq-narrative')).toHaveValue(attendance);
  await expect(att).toHaveCount(1);
  await expect(att.locator('.wc-text')).toHaveText(attendance);
  await expect(head(page, 'att')).toContainText('3 Absent · 1 Late');

  await page.locator('#tq-att-absences').fill('');
  await page.locator('#tq-att-absences').press('Tab');
  await page.locator('#tq-att-lates').fill('');
  await page.locator('#tq-att-lates').press('Tab');
  await expect(page.locator('#tq-att-note')).toHaveText('Optional. Left out until entered.');
  await expect(page.locator('#tq-narrative')).not.toHaveValue(/three classes/);
  await expect(att).toHaveCount(0);
  await expect(habits).toHaveCount(2);
});

test('attendance totals to date give this term without any math; a lower total warns', async ({ page }) => {
  await open(page);
  await openBox(page, 'att');
  const pickReport = async n => {
    await page.locator('#report-period').selectOption('Report ' + n);
    await page.locator('#tq-att-absences').waitFor();
  };
  const enter = async (absences, lates) => {
    await page.locator('#tq-att-absences').fill(String(absences));
    await page.locator('#tq-att-absences').press('Tab');
    await page.locator('#tq-att-lates').fill(String(lates));
    await page.locator('#tq-att-lates').press('Tab');
  };
  await pickReport(1);
  await enter(4, 3);
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');
  await pickReport(2);
  await expect(page.locator('#tq-att-note')).toHaveText('Optional. Left out until entered.');
  await enter(10, 5);
  await expect(page.locator('#tq-att-note')).toHaveText('Added to the comment.');
  await page.reload();
  await openBox(page, 'att');
  await pickReport(2);
  await expect(page.locator('#tq-att-absences')).toHaveValue('10');
  await expect(page.locator('#tq-att-lates')).toHaveValue('5');
  await page.locator('#tq-att-absences').fill('3');
  await page.locator('#tq-att-absences').press('Tab');
  await expect(page.locator('#tq-att-note')).toContainText('Lower than the 4 absences');
  await expect(page.locator('#tq-att-absences')).toHaveClass(/warn/);
});
