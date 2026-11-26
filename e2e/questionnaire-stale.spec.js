import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The Teacher Comment card for an approved comment whose sentences no longer
   match the gradebook (#tq-stale): Keep as Approved and Use the New Sentence
   always act (Nov 26 2026). Demo Mode, Science 8, Cece, Report 2.

   The live bug: the comment was approved, two pieces went Missing, and the
   teacher pressed Generate Comment. Generate wrote new sentences and took the
   approval off, but the card stayed on screen with the old approved sentences
   and no Approved chip, and its buttons found nothing to act on. */
test.use({ viewport: { width: 1440, height: 1100 } });

async function approvedAndStale(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.locator('#tq-narrative').waitFor();
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
    COURSES.sci8.gradingSystem = 'letter';
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#tq-generate').click();
  await page.waitForTimeout(300);
  await page.locator('#tq-approve-next').click();
  await page.waitForTimeout(300);
  // Two pieces are labelled Missing after the approval.
  await page.evaluate(() => {
    const dated = getAssessments('sci8')
      .filter(x => x.date && !/^sci8-quiz-/.test(x.id))
      .sort((x, y) => x.date.localeCompare(y.date));
    dated.slice(-2).forEach(a => {
      _cache.scores['sci8']['st1'] = (_cache.scores['sci8']['st1'] || []).filter(e => e.assessmentId !== a.id);
      setAssignmentStatus('sci8', 'st1', a.id, 'NS');
    });
    clearProfCache();
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st2');
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor();
  await expect(page.locator('#tq-stale')).toBeVisible();
  await expect(page.locator('#tq-approved-chip')).toBeVisible();
}
const saved = page => page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2') || {});

for (const font of FONTS) {
  test.describe(font + ' font', () => {
    test('Generate on an approved, out-of-date comment takes the card off with the approval', async ({ page }) => {
      await approvedAndStale(page);
      await useFont(page, font);
      await page.locator('#tq-generate').click();
      await expect(page.locator('#tq-stale')).toHaveCount(0);
      await expect(page.locator('#tq-approved-chip')).toHaveCount(0);
      expect((await saved(page)).approvedAt || null).toBeNull();
      // Sentences that do not match show on their rows, as for any unapproved comment.
      await expect(page.locator('#tq-comment-card')).not.toContainText('Approved text is never changed for you');
    });

    test('typing in an approved comment takes the card off with the approval', async ({ page }) => {
      await approvedAndStale(page);
      await useFont(page, font);
      await page.locator('#tq-narrative').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Well done.');
      await expect(page.locator('#tq-approved-chip')).toHaveCount(0);
      await expect(page.locator('#tq-stale')).toHaveCount(0);
    });

    test('a card left on screen from before the comment changed: both buttons still act', async ({ page }) => {
      for (const action of ['keep', 'use']) {
        await approvedAndStale(page);
        await useFont(page, font);
        const html = await page.locator('#tq-stale').evaluate(e => e.outerHTML);
        await page.locator('#tq-generate').click();
        await expect(page.locator('#tq-stale')).toHaveCount(0);
        // Put the old card back, as the live page showed it.
        await page.evaluate(h => document.querySelector('.qn-comment-top').insertAdjacentHTML('afterend', h), html);
        await page.locator(`#tq-stale .qn-stale-${action}`).first().click();
        await expect(page.locator('#tq-stale')).toHaveCount(0);
      }
    });

    test('Use the New Sentence on an approved comment still puts the sentence in and takes the approval off', async ({
      page,
    }) => {
      await approvedAndStale(page);
      await useFont(page, font);
      await page.locator('#tq-stale .qn-stale-use').first().click();
      await expect(page.locator('#tq-stale')).toHaveCount(0);
      await expect(page.locator('#tq-approved-chip')).toHaveCount(0);
      await expect(page.locator('#tq-narrative')).toHaveValue(/Cece has a C\+ in Science 8/);
    });

    test('Keep as Approved leaves the comment approved and clears the card', async ({ page }) => {
      await approvedAndStale(page);
      await useFont(page, font);
      await page.locator('#tq-stale .qn-stale-keep').first().click();
      await expect(page.locator('#tq-stale')).toHaveCount(0);
      await expect(page.locator('#tq-approved-chip')).toBeVisible();
      expect((await saved(page)).approvedAt).toBeTruthy();
    });
  });
}
