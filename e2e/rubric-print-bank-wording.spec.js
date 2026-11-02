/**
 * Print Rubrics for an assessment scored only on competencies: its Tag Rubric
 * prints the curriculum bank's four descriptors for a competency imported
 * from the bank (tag.bank_id), loading shared/bank-proficiency.js the first
 * time, under the production CSP (DECISIONS.md, Report forms 6).
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

const ASSESSMENT = {
  id: 'assess-tags-001',
  title: 'Curiosity Check',
  date: '2026-10-21',
  type: 'summative',
  tagIds: ['QAP'],
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-10-21').toISOString(),
};

test('a Tag Rubric prints the bank’s descriptors for a bank competency', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ assessment, cid }) => {
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
  const bankRequest = page.waitForRequest(r => r.url().includes('/shared/bank-proficiency.js'));
  await gotoApp(page, '/assignments');
  expect(await page.evaluate(() => typeof window.BANK_PROFICIENCY)).toBe('undefined');
  // QAP came from the bank: give it the bank id a wizard import saves.
  await page.evaluate(cid => {
    window.getTagById(cid, 'QAP').bank_id = 'bc.sci8.cc.1';
  }, TEST_COURSE.id);

  await page.evaluate(
    ({ cid, aid }) => {
      window.print = () => {};
      window.__realSetTimeout = window.setTimeout;
      window.setTimeout = (fn, ms, ...rest) => (!ms ? 0 : window.__realSetTimeout(fn, ms, ...rest));
      window.RubricPrint.open(cid, aid, { mode: 'blank' });
    },
    { cid: TEST_COURSE.id, aid: ASSESSMENT.id },
  );
  await bankRequest;
  const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Print \d+ Pages?$/ }).click();
  const sheet = page.locator('#rubric-print-root .rubric-sheet').first();
  await expect(sheet).toContainText('The student consistently shows sustained curiosity about science topics.');
  await expect(sheet).not.toContainText('demonstrates a complete understanding');
});
