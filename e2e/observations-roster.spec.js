import { test, expect } from '@playwright/test';

/* The Observations page's roster (docs/DECISIONS.md, "Observations off the
   Dashboard"): the days since each student was last observed, amber from 3
   weeks; Not Observed in 3+ Weeks keeps only those students; a student
   written to stays until the next is picked. The Dashboard no longer has an
   Observations card. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
}

// Two students with only an old observation, so they are 3+ weeks out.
async function seedOld(page, sids) {
  // Demo Mode seeds its sample class first; this writes over two students.
  await page.waitForFunction(() => getAssessments('sci8').length > 0 && getOpenConcerns('sci8').length > 0);
  await page.evaluate(ids => {
    const all = JSON.parse(localStorage.getItem('gb-quick-obs-sci8') || '{}');
    const d = new Date(Date.now() - 30 * 86400000);
    const day =
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    ids.forEach(id => {
      all[id] = [
        {
          id: 'qo_old_' + id,
          text: 'Old note',
          dims: [],
          sentiment: 'strength',
          context: null,
          date: day,
          created: d.toISOString(),
        },
      ];
    });
    localStorage.setItem('gb-quick-obs-sci8', JSON.stringify(all));
  }, sids);
}

const row = (page, sid) => page.locator('#gb-roster-list .student-row[data-sid="' + sid + '"]');

test('the Dashboard has no Observations card', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/dashboard?course=sci8');
  await expect(page.locator('.dash-card').first()).toBeVisible();
  await expect(page.locator('#dash-obs-card')).toHaveCount(0);
});

test('the roster shows days since last observed, and Not Observed in 3+ Weeks keeps only those', async ({ page }) => {
  await enterDemo(page);
  await seedOld(page, ['st4', 'st5']);
  await page.goto('/observations?course=sci8');

  // Every student has a mark in place of the grade; the grades menu is gone.
  const rows = page.locator('#gb-roster-list .student-row[data-sid]');
  await expect(row(page, 'st5').locator('.obs-days')).toBeVisible();
  const total = await rows.count();
  await expect(page.locator('#gb-roster-list .obs-days')).toHaveCount(total);
  await expect(page.locator('#sb-show-btn')).toBeHidden();
  await expect(row(page, 'st5').locator('.obs-days')).toHaveText('30d');
  await expect(row(page, 'st5').locator('.obs-days')).toHaveClass(/is-overdue/);
  await expect(row(page, 'st5').locator('.obs-days')).toHaveAttribute('title', 'Last observed 30 days ago');

  // The switch counts the amber ones.
  const overdue = await page.locator('#gb-roster-list .obs-days.is-overdue').count();
  expect(overdue).toBeGreaterThanOrEqual(2);
  const toggle = page.locator('.obs-roster-toggle');
  await expect(toggle).toHaveText('Not Observed in 3+ Weeks' + overdue);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('.obs-roster-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#gb-roster-list .student-row[data-sid]:visible')).toHaveCount(overdue);

  // Pick one and write to them: they stay while picked, then leave.
  await row(page, 'st5').click();
  await page.locator('#capture-input').fill('Explained the lab steps to a partner');
  await page.keyboard.press('Enter');
  await expect(page.locator('.obs-card', { hasText: 'Explained the lab steps to a partner' })).toBeVisible();
  await expect(row(page, 'st5')).toBeVisible();
  await expect(row(page, 'st5').locator('.obs-days')).toHaveText('Today');
  await expect(row(page, 'st5').locator('.obs-days')).not.toHaveClass(/is-overdue/);
  await expect(page.locator('.obs-roster-toggle')).toHaveText('Not Observed in 3+ Weeks' + (overdue - 1));
  await row(page, 'st4').click();
  await expect(row(page, 'st5')).toBeHidden();

  // Off again: everyone is back.
  await page.locator('.obs-roster-toggle').click();
  await expect(page.locator('#gb-roster-list .student-row[data-sid]:visible')).toHaveCount(total);
});

test('another page gets its grades back in the roster', async ({ page }) => {
  await enterDemo(page);
  await page.goto('/observations?course=sci8');
  await expect(page.locator('#gb-roster-list .obs-days').first()).toBeVisible();
  await page.evaluate(() => Router.navigate('/assignments?course=sci8'));
  await page.waitForURL(/\/assignments/);
  await expect(page.locator('#gb-roster-list .student-row').first()).toBeVisible();
  await expect(page.locator('#gb-roster-list .obs-days')).toHaveCount(0);
  await expect(page.locator('.obs-roster-toggle')).toHaveCount(0);
});
