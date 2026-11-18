import { test, expect } from '@playwright/test';
import { PHONE, fits, named, contrast, shot } from './student-card-fake.js';

/* A teacher-built reflection on the student page (docs/plans/reflect-plan.md;
   the mockup's boards 4 and 5), in Demo Mode, against the built site with
   the live site's CSP: Reflect's count, Unit 2 Exit Reflection opened from
   it, every new kind answered by touch-sized buttons, the star that keeps
   Send back, and Sent. Then Preview as a Student. Nothing is sent. */

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  // The sample class has bulletins, so the page opens on them (B1g); Assignments is the next tab.
  await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
  await expect(page.getByRole('button', { name: 'Outstanding 2' })).toBeVisible();
  return posts;
}

// Every button and box on screen is at least 44px tall. A 44px box can
// measure 43.99998 once the page is scaled, so the height is rounded to a
// hundredth first.
async function touchSized(page) {
  const small = await page.$$eval('.sp-main button, .sp-main input, .sp-main select', els =>
    els
      .filter(el => el.offsetParent !== null)
      .map(el => [el.getAttribute('aria-label') || el.textContent.trim() || el.id, el.getBoundingClientRect().height])
      .filter(([, h]) => Math.round(h * 100) / 100 < 44),
  );
  expect(small).toEqual([]);
}

test.describe('a teacher-built reflection on a phone', () => {
  test.use(PHONE);

  test('Unit 2 Exit Reflection: each kind answered, the starred ones first, then Sent', async ({ page }) => {
    const posts = await demo(page);
    const nav = page.locator('.sp-tabs-bottom');
    await expect(nav.locator('[data-tab="questionnaires"] .sp-tab-badge')).toHaveText('2');
    await nav.getByRole('button', { name: 'Reflect' }).click();
    await page
      .locator('.sp-forms-phone .sp-form-card', { hasText: 'Unit 2 Exit Reflection' })
      .getByRole('button', { name: 'Start' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Unit 2 Exit Reflection' })).toBeVisible();
    await expect(page.locator('#sp-count')).toHaveText('0 of 6 answered');
    await fits(page);
    await named(page);
    await contrast(page);
    await touchSized(page);
    await shot(page, 'phone-reflect-unit2');

    // Send with nothing answered: the plain message, and the first starred question has the focus.
    await page.getByRole('button', { name: 'Send to My Teacher' }).click();
    await expect(page.getByRole('alert')).toHaveText('Answer the questions marked with a star first.');
    await expect(page.locator('#q-demo-unit2-1')).toBeFocused();

    await page.locator('#q-demo-unit2-1').fill('Why the small numbers never change.');
    await page.getByRole('radio', { name: '4', exact: true }).click();
    await expect(page.getByRole('radio', { name: '4', exact: true })).toHaveAttribute('aria-checked', 'true');
    // Other opens its box; a choice then takes its place.
    await page.getByRole('radio', { name: 'Other' }).click();
    await expect(page.locator('#q-demo-unit2-3-other')).toBeFocused();
    await page.locator('#q-demo-unit2-3-other').fill('Videos');
    await page.locator('[data-qbox="demo-unit2-3"]').getByRole('radio', { name: 'Labs' }).click();
    await expect(page.locator('#q-demo-unit2-3-other')).toHaveCount(0);
    // Each statement's row of choices.
    for (const [statement, choice] of [
      ['I asked questions when I was stuck', 'Usually'],
      ['I checked my work before handing it in', 'Sometimes'],
      ['I helped someone in my group', 'Always'],
    ]) {
      await page.getByRole('radiogroup', { name: statement }).getByRole('radio', { name: choice }).click();
    }
    // The ranking: Labs moves down, and the focus stays on it.
    await page.getByRole('button', { name: 'Move Labs down' }).click();
    await expect(page.locator('[data-rank-q="demo-unit2-5"] .sp-rq-rank-text')).toHaveText([
      'Notes',
      'Labs',
      'Practice Questions',
    ]);
    await expect(page.getByRole('button', { name: 'Move Labs down' })).toBeFocused();
    await page.locator('#q-demo-unit2-7').fill('2026-11-20');
    await expect(page.locator('#sp-count')).toHaveText('6 of 6 answered');
    await touchSized(page);
    await contrast(page);
    await shot(page, 'phone-reflect-unit2-answered');

    await page.getByRole('button', { name: 'Send to My Teacher' }).click();
    await expect(page.getByRole('heading', { name: 'Sent to Your Teacher' })).toBeVisible();
    await expect(page.getByText('This was Demo Mode. Nothing was sent.')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Your Page' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Reflect', exact: true })).toBeVisible();
    expect(posts).toEqual([]);
  });

  test('Preview as a Student: the builder’s draft, read once, and Send sends nothing', async ({ page }) => {
    const posts = [];
    page.on('request', req => {
      if (/functions\/v1\//.test(req.url())) posts.push(req.url());
    });
    await page.goto('/s/#preview-reflection');
    await expect(page.getByRole('heading', { name: 'Nothing to Preview' })).toBeVisible();
    await page.evaluate(() =>
      localStorage.setItem(
        'fv-reflect-preview',
        JSON.stringify({
          title: 'Lab Check-In',
          description: 'Two quick questions.',
          course: { name: 'Chemistry 11' },
          questions: [
            { prompt: 'How did the lab go?', kind: 'text', options: { long: false } },
            {
              prompt: 'Pick one.',
              kind: 'choice',
              options: { choices: ['Red', 'Blue'], dropdown: true, multiple: false },
            },
          ],
        }),
      ),
    );
    // The builder's address: a query that changes each time, which the page ignores.
    await page.goto('/s/?preview=' + Date.now() + '#preview-reflection');
    await expect(page.getByText('This is a preview. Nothing is sent.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Lab Check-In' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('fv-reflect-preview'))).toBeNull();
    await page.getByLabel('How did the lab go?').fill('Fine.');
    await page.getByLabel('Pick one.').selectOption('Blue');
    await touchSized(page);
    await contrast(page);
    await page.getByRole('button', { name: 'Send to My Teacher' }).click();
    await expect(page.getByText('This is a preview. Nothing was sent.')).toBeVisible();
    expect(posts).toEqual([]);
  });
});
