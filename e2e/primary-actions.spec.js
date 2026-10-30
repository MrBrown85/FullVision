import { test, expect } from '@playwright/test';

/* One primary action per screen, and the breadcrumb on the dashboard's child
   screens (docs/DECISIONS.md, "Buttons and breadcrumbs (2026-10-19)"). Runs
   in Demo Mode on Science 8 at desktop width. */

test.use({ viewport: { width: 1440, height: 900 } });

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
}

/* Labels of the visible buttons and links filled with the --active blue,
   outside dialogs. Off-screen elements (the skip link) don't count. */
async function solidPrimaries(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--active)';
    document.body.appendChild(probe);
    const blue = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(el => {
        if (el.closest('dialog, [role="dialog"], [aria-modal="true"]')) return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom <= 0 || r.right <= 0) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.backgroundColor === blue;
      })
      .map(el => el.textContent.trim());
  });
}

test.describe('One primary action per screen', () => {
  const screens = [
    { name: 'Dashboard', route: '/dashboard', ready: '.dash-toolbar', primary: [] },
    {
      name: 'Assignments',
      route: '/assignments',
      ready: '[data-action="showNewForm"]',
      primary: ['+ New Assessment'],
    },
    { name: 'Observations', route: '/observations', ready: '.obsc-add', primary: ['Add'] },
    { name: 'Gradebook', route: '/gradebook', ready: '.tb-action-btn', primary: ['+ New Assessment'] },
    // The review screen's two actions are both solid: Generate Comment writes
    // the comment and Approve and Next sends it on (the approved "Review
    // screen" mockup, fullvision-generate-plan PR 11a).
    {
      name: 'Term Questionnaire',
      route: '/reports',
      ready: '#tq-approve-next',
      primary: [/^Approve and Next/, 'Generate Comment'],
    },
    {
      name: 'Student page',
      route: '/student?id=st23&course=sci8',
      ready: '.student-toolbar',
      primary: ['Term Questionnaire'],
    },
  ];

  for (const s of screens) {
    test(s.name, async ({ page }) => {
      await enterDemo(page);
      await page.goto(s.route);
      await page.waitForSelector(s.ready);
      const found = await solidPrimaries(page);
      expect(found, JSON.stringify(found)).toHaveLength(s.primary.length);
      s.primary.forEach((label, i) => expect(found[i]).toMatch(label));
    });
  }

  test('Reports progress', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/reports');
    await page.locator('.report-seg-btn[data-tab="progress"]').click();
    await expect(page.locator('#tb-print-btn')).toBeVisible();
    expect(await solidPrimaries(page)).toEqual(['Print Reports']);
  });
});

test.describe('Breadcrumb on the dashboard child screens', () => {
  test('student page: Dashboard › student name, linking back', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/student?id=st23&course=sci8');
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumb).toBeVisible();
    await expect(crumb).toHaveText(/Dashboard\s*›?\s*Mei Wong/);
    await expect(crumb.locator('[aria-current="page"]')).toHaveText('Mei Wong');
    await expect(page.locator('.tb-seg-link.tb-seg-active')).toHaveText('Dashboard');
    await expect(page.locator('.tb-back-btn')).toHaveCount(0);

    const link = crumb.getByRole('link', { name: 'Dashboard' });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.dash-toolbar [data-action="openClassManager"]')).toBeVisible();
  });

  test('Class Management: Dashboard › Class Management, linking back', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/dashboard');
    await page.locator('.dash-toolbar [data-action="openClassManager"]').click();
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumb).toBeVisible();
    await expect(crumb.locator('[aria-current="page"]')).toHaveText('Class Management');
    await expect(page.locator('.tb-seg-link.tb-seg-active')).toHaveText('Dashboard');
    await expect(page.locator('.cm-layout')).toBeVisible();

    const link = crumb.getByRole('link', { name: 'Dashboard' });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.cm-layout')).toHaveCount(0);
    await expect(page.locator('.dash-toolbar [data-action="openClassManager"]')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  });
});
