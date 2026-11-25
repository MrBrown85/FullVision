import { test, expect } from '@playwright/test';

/* The student phone page, /s/ (docs/STUDENT-VOICE-PLAN.md, PR 7), at
   phone size against the built site. The student-submit function is
   mocked. Demo Mode answers a questionnaire with taps and typing and makes
   no request at all. */

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

/* The mock answers the function's `card` route as it answers any code that is
   no card, not_found, and keeps it out of `posts`. */
const NOT_A_CARD = { ok: false, error: 'not_found' };

async function mockFunction(page) {
  const posts = [];
  await page.route('**/functions/v1/student-submit**', async route => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || '{}');
    if (body.route === 'card') {
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(NOT_A_CARD),
      });
    }
    posts.push({ url: req.url(), body });
    const reply = body.route === 'open' ? OPEN : { ok: true, submitted_at: '2026-11-04T10:00:00Z' };
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(reply),
    });
  });
  return posts;
}

test('the page fits a phone: no sideways scroll, Send stays in reach', async ({ page }) => {
  await mockFunction(page);
  await page.goto('/s/#demo-about');
  await page.getByRole('button', { name: 'Yes, Start' }).tap();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide).toBeLessThanOrEqual(0);
  const foot = await page.locator('.sp-foot').boundingBox();
  expect(foot.y + foot.height).toBeLessThanOrEqual(812);
});

test('Demo Mode answers About Me with no request', async ({ page }) => {
  const posts = await mockFunction(page);
  await page.goto('/s/#demo-about');
  await page.getByRole('button', { name: 'Yes, Start' }).tap();
  await expect(page.getByText('Only your teacher sees this')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).tap();
  await page.getByRole('button', { name: '+ Another' }).tap();
  await page.getByLabel('Another answer').fill('Igbo');
  await page.getByRole('button', { name: 'Add', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Igbo' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Send to My Teacher' }).tap();
  await expect(page.getByText('This was Demo Mode. Nothing was sent.')).toBeVisible();
  expect(posts).toHaveLength(0);
});
