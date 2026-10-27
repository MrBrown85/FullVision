import { test, expect } from '@playwright/test';

/* Progress Reports › Sent to Phones (docs/STUDENT-VOICE-PLAN.md, PR 9;
   canvas T1) in Demo Mode, Science 8: send this period's report, a slip per
   student, the counts, a student's copy as they'd see it, and Close All
   Links. */

test('send to phones, print slips, preview a copy, close the links', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await page.getByRole('button', { name: 'Sent to Phones' }).click();
  await expect(page.locator('.pp-title')).toContainText('to Students’ Phones');
  await page.evaluate(() => {
    window.print = () => {
      window.__slips = document.querySelectorAll('#qr-slips-root .qs-slip').length;
    };
  });
  await page.getByRole('button', { name: 'Send to Phones and Print Slips' }).click();
  await expect.poll(() => page.evaluate(() => window.__slips)).toBe(27);
  await expect(page.locator('.pp-stats')).toContainText('0 of 27');
  await expect(page.locator('.pp-row')).toHaveCount(27);

  // A copy as the student would see it (Demo Mode marks Cece as opened).
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('gb-phone-reports-sci8'));
    list[0].students.find(s => s.enrollment_id === 'st1').opened_at = new Date().toISOString();
    localStorage.setItem('gb-phone-reports-sci8', JSON.stringify(list));
    PageReports.renderReports();
  });
  await expect(page.locator('.pp-stats')).toContainText('1 of 27');
  await page.locator('.pp-row', { hasText: 'Cece Adeyemi' }).getByRole('button', { name: 'Read Report' }).click();
  const phone = page.getByRole('dialog', { name: 'Report as the student sees it' });
  await expect(phone.locator('.pr-name')).toHaveText('Cece Adeyemi');
  await expect(phone.locator('.pr-goal')).toContainText('Hand in labs on time');
  await phone.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Close All Links' }).click();
  await page.locator('#confirm-ok-btn').click();
  await expect(page.locator('.pp-sub')).toContainText('Links closed');
  await expect(page.getByRole('button', { name: 'Print QR Slips' })).toHaveCount(0);
});
