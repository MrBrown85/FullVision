/**
 * The Bulletins write bar in the Assignments bar's style (Colin, Nov 25): the
 * closed bar is a grey field with Add a File and Add a Link beside it; the
 * open box has grey fields, Let Students React as a row of its own with a
 * switch, and Add a File, Add a Link, Cancel and Post along the bottom.
 * Demo Mode, Science 8 with its Student Page on.
 *
 * Layout is asserted in the page's own font and in the wide stand-in for CI's
 * Linux fonts (e2e/wide-font.js), at three desktop widths and two iPad ones.
 */
import { test, expect } from '@playwright/test';
import { useFont, FONTS } from './wide-font.js';

// The wide stand-in is a style the page's own CSP would refuse.
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 } });

async function openDemo(page, width = 1440, height = 900, { tablet = false, studentPage = true } = {}) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/dashboard/);
  await page.locator('.dash-glance').waitFor();
  if (!studentPage) await page.evaluate(() => setStudentPageSwitch(getActiveCourse(), false));
  await page.goto('/bulletins');
  await expect(page.locator('.bulletin-title')).toHaveText('Bulletins');
  if (tablet) await page.evaluate(() => document.documentElement.classList.add('fv-tablet'));
}

const bar = page => page.locator('#bulletin-bar');
const box = page => page.locator('#bulletin-compose');
const switchEl = page => page.getByRole('switch', { name: 'Let Students React' });

// Every drawn control in a card as a box, plus what is wrong with the card: a control outside it, two controls on
// each other, or a control whose own contents run past its edge.
const problems = (page, selector) =>
  page.evaluate(sel => {
    const card = document.querySelector(sel);
    const c = card.getBoundingClientRect();
    const items = [
      ...card.querySelectorAll('button, input, select, textarea, .bulletin-react-chip, .bulletin-react-label'),
    ]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(p => p.r.width > 0 && p.r.height > 0);
    const out = [];
    for (const p of items) {
      if (p.r.left < c.left - 0.5 || p.r.right > c.right + 0.5) out.push('outside: ' + (p.el.id || p.el.className));
      if (p.el.scrollWidth > p.el.clientWidth + 1 && !/^(INPUT|SELECT|TEXTAREA)$/.test(p.el.tagName))
        out.push('clipped: ' + (p.el.textContent || p.el.className));
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i].r;
        const b = items[j].r;
        if (items[i].el.contains(items[j].el) || items[j].el.contains(items[i].el)) continue;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
          out.push(
            'overlap: ' + (items[i].el.id || items[i].el.className) + ' / ' + (items[j].el.id || items[j].el.className),
          );
      }
    const col = document.querySelector('.bulletin-col').getBoundingClientRect();
    return {
      out,
      cardWidth: Math.round(c.width),
      colWidth: Math.round(col.width),
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, selector);

const heights = (page, selector) =>
  page.locator(selector).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));

test('the closed bar is a grey field with Add a File and Add a Link beside it', async ({ page }) => {
  await openDemo(page);
  await expect(bar(page)).toBeVisible();
  const field = bar(page).locator('.bulletin-bar-open');
  await expect(field).toHaveText('Write to Science 8…');
  const buttons = bar(page).getByRole('button', { name: /^Add a (File|Link)$/ });
  await expect(buttons).toHaveCount(2);
  await expect(buttons).toHaveText(['Add a File', 'Add a Link']);
  expect(await heights(page, '#bulletin-bar .bulletin-bar-open')).toEqual([36]);
  expect(await heights(page, '#bulletin-bar .tb-action-btn')).toEqual([32, 32]);
  const look = await field.evaluate(el => {
    const cs = getComputedStyle(el);
    return { fill: cs.backgroundColor, radius: cs.borderRadius, border: cs.borderTopWidth };
  });
  expect(look).toEqual({ fill: 'rgba(118, 118, 128, 0.12)', radius: '8px', border: '0px' });
  // The title line has no count: nothing beside the title when there is nothing to warn of.
  await expect(page.locator('.bulletin-sub')).toHaveCount(0);
  await expect(page.locator('.bulletin-page')).not.toContainText('students can see it');
});

test('the three controls of the closed bar open what they opened before', async ({ page }) => {
  await openDemo(page);
  await bar(page).locator('.bulletin-bar-open').click();
  await expect(box(page)).toBeVisible();
  await expect(bar(page)).toBeHidden();
  await expect(page.locator('#bulletin-link-url')).toHaveCount(0);
  await box(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(bar(page)).toBeVisible();

  await bar(page).getByRole('button', { name: 'Add a Link' }).click();
  await expect(box(page)).toBeVisible();
  await expect(page.locator('#bulletin-link-url')).toBeFocused();
  // With the link fields showing, the box has no second Add a Link.
  await expect(box(page).getByRole('button', { name: 'Add a Link' })).toHaveCount(0);
  await box(page).getByRole('button', { name: 'Cancel' }).click();

  await bar(page).getByRole('button', { name: 'Add a File' }).click();
  await expect(box(page)).toBeVisible();
  await expect(box(page).getByRole('button', { name: 'Add a File' })).toBeVisible();
});

test('the open box: grey fields, the buttons along the bottom and Post at its fixed size', async ({ page }) => {
  await openDemo(page);
  await bar(page).locator('.bulletin-bar-open').click();
  await box(page).getByRole('button', { name: 'Reminder', exact: true }).click();
  await box(page).getByRole('button', { name: 'Add a Link' }).click();
  for (const sel of [
    '#bulletin-words',
    '#bulletin-until',
    '#bulletin-linked',
    '#bulletin-link-url',
    '#bulletin-link-title',
  ]) {
    const look = await page.locator(sel).evaluate(el => {
      el.blur();
      const cs = getComputedStyle(el);
      return { fill: cs.backgroundColor, border: cs.borderTopColor, radius: cs.borderTopLeftRadius };
    });
    expect(look, sel).toEqual({ fill: 'rgba(118, 118, 128, 0.12)', border: 'rgba(0, 0, 0, 0)', radius: '8px' });
  }
  // The app's blue ring on focus.
  await page.locator('#bulletin-words').focus();
  const ring = await page
    .locator('#bulletin-words')
    .evaluate(el => ({ border: getComputedStyle(el).borderTopColor, shadow: getComputedStyle(el).boxShadow }));
  expect(ring.border).toBe('rgb(0, 122, 255)');
  expect(ring.shadow).toContain('0, 122, 255');
  // The bottom row: Add a File, then Cancel and Post at the right.
  const names = await box(page).locator('.bulletin-actions button').allTextContents();
  expect(names).toEqual(['Add a File', 'Cancel', 'Post']);
  expect(await heights(page, '#bulletin-compose .bulletin-actions button')).toEqual([32, 32, 32]);
  const post = page.locator('#bulletin-post');
  const widths = [];
  widths.push(await post.evaluate(el => Math.round(el.getBoundingClientRect().width)));
  await page.locator('#bulletin-words').fill('Words');
  widths.push(await post.evaluate(el => Math.round(el.getBoundingClientRect().width)));
  expect(widths[0]).toBe(widths[1]);
  // The hint sentence under the box is gone.
  await expect(box(page)).not.toContainText('Only you see who');
  await expect(box(page)).not.toContainText('Students see Got It');
});

test('Let Students React is a row with a switch: off shows no chips, on shows three', async ({ page }) => {
  await openDemo(page);
  await bar(page).locator('.bulletin-bar-open').click();
  const sw = switchEl(page);
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(box(page).locator('.bulletin-react-chip')).toHaveCount(0);
  const dims = await sw.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), role: el.getAttribute('role') };
  });
  expect(dims).toEqual({ w: 38, h: 22, role: 'switch' });
  // The label at the left, the switch at the right of the same row.
  const row = box(page).locator('.bulletin-react-row');
  const label = await row.locator('.bulletin-react-label').boundingBox();
  const sb = await sw.boundingBox();
  const rb = await row.boundingBox();
  expect(label.x).toBeLessThan(rb.x + 20);
  expect(sb.x + sb.width).toBeGreaterThan(rb.x + rb.width - 6);

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  const chips = box(page).locator('.bulletin-react-chip');
  await expect(chips).toHaveText(['Got It', 'Done', 'I Have a Question']);
  expect(await heights(page, '#bulletin-compose .bulletin-react-chip')).toEqual([24, 24, 24]);
  expect(await chips.first().evaluate(el => getComputedStyle(el).borderRadius)).toBe('8px');
  // The chips sit after the label, before the switch.
  const c0 = await chips.first().boundingBox();
  expect(c0.x).toBeGreaterThan(label.x + label.width);
  expect(c0.x + c0.width).toBeLessThan(sb.x);

  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(chips).toHaveCount(0);
});

test('a reaction switched on is what the bulletin posts with', async ({ page }) => {
  await openDemo(page);
  await bar(page).locator('.bulletin-bar-open').click();
  await switchEl(page).click();
  await page.locator('#bulletin-words').fill('Tap one when you have it.');
  await page.locator('#bulletin-post').click();
  const card = page.locator('#bulletin-feed .bulletin-post', { hasText: 'Tap one when you have it.' });
  await expect(card).toBeVisible();
  const on = await page.evaluate(
    () => getBulletins(getActiveCourse()).filter(b => /Tap one/.test(b.body))[0].reactions_on,
  );
  expect(on).toBe(true);
});

test('Post is off until there are words, as before, and Cancel puts the bar back', async ({ page }) => {
  await openDemo(page);
  await bar(page).locator('.bulletin-bar-open').click();
  const post = page.locator('#bulletin-post');
  await expect(post).toBeDisabled();
  expect(await post.evaluate(el => getComputedStyle(el).opacity)).toBe('0.45');
  await page.locator('#bulletin-words').fill('Bring a pencil.');
  await expect(post).toBeEnabled();
  expect(await post.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await page.locator('#bulletin-words').fill('x'.repeat(2001));
  await expect(post).toBeDisabled();
  await page.locator('#bulletin-words').fill('Bring a pencil.');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(bar(page)).toBeVisible();
  await expect(box(page)).toBeHidden();
});

test('the title line: no count; the Student Page warning, the no-card note and the paused note stay', async ({
  page,
}) => {
  await openDemo(page, 1440, 900, { studentPage: false });
  const sub = page.locator('.bulletin-sub');
  await expect(sub).toContainText('Students cannot see Bulletins until the Student Page is turned on.');
  await expect(sub.getByRole('link', { name: 'Class Settings →' })).toHaveAttribute('href', /manage=student-page/);
  await expect(page.locator('.bulletin-page')).not.toContainText('can see it');

  await page.goto('/bulletins');
  await openDemo(page);
  await page.evaluate(() => {
    window.getBulletinsMeta = () => ({ page_on: true, can_see: 20, no_card: 3, paused: 1 });
    document.dispatchEvent(new CustomEvent('fv:bulletins-changed', { detail: {} }));
  });
  await expect(sub).toContainText('3 Have No Card Yet');
  await expect(sub.getByRole('link', { name: '3 Have No Card Yet' })).toHaveAttribute('href', /manage=student-page/);
  await expect(sub).toContainText('1 Not Counted (Page Paused)');
  await expect(sub).not.toContainText('can see it');
  await page.evaluate(() => {
    window.getBulletinsMeta = () => ({ page_on: true, can_see: 20, no_card: 0, paused: 0 });
    document.dispatchEvent(new CustomEvent('fv:bulletins-changed', { detail: {} }));
  });
  await expect(sub).toHaveCount(0);
});

for (const width of [1280, 1440, 1680]) {
  test(`the closed bar and the open box fit the 680 column at ${width} wide, in both fonts`, async ({ page }) => {
    await openDemo(page, width, 900);
    for (const font of FONTS) {
      await useFont(page, font);
      let p = await problems(page, '#bulletin-bar');
      expect(p.out, `closed, ${font}`).toEqual([]);
      expect(p.colWidth).toBe(680);
      expect(p.page).toBe(0);
    }
    await useFont(page, 'page');
    await bar(page).locator('.bulletin-bar-open').click();
    await box(page).getByRole('button', { name: 'Reminder', exact: true }).click();
    await box(page).getByRole('button', { name: 'Add a Link' }).click();
    await switchEl(page).click();
    for (const font of FONTS) {
      await useFont(page, font);
      const p = await problems(page, '#bulletin-compose');
      expect(p.out, `open, ${font}`).toEqual([]);
      expect(p.cardWidth).toBeLessThanOrEqual(680);
      expect(p.page).toBe(0);
    }
  });
}

for (const [width, height] of [
  [1024, 768],
  [820, 1180],
]) {
  test(`on an iPad at ${width} × ${height} the controls are 44 tall and the box's rows wrap cleanly, in both fonts`, async ({
    page,
  }) => {
    await openDemo(page, width, height, { tablet: true });
    for (const font of FONTS) {
      await useFont(page, font);
      const p = await problems(page, '#bulletin-bar');
      expect(p.out, `closed, ${font}`).toEqual([]);
      expect(p.page).toBe(0);
    }
    expect(await heights(page, '#bulletin-bar .bulletin-bar-open, #bulletin-bar .tb-action-btn')).toEqual([44, 44, 44]);
    await bar(page).locator('.bulletin-bar-open').click();
    await box(page).getByRole('button', { name: 'Reminder', exact: true }).click();
    await box(page).getByRole('button', { name: 'Add a Link' }).click();
    await switchEl(page).click();
    for (const font of FONTS) {
      await useFont(page, font);
      const p = await problems(page, '#bulletin-compose');
      expect(p.out, `open, ${font}`).toEqual([]);
      expect(p.page).toBe(0);
    }
    expect(await heights(page, '#bulletin-compose .bulletin-actions button')).toEqual([44, 44, 44]);
    expect(await heights(page, '#bulletin-compose .bulletin-field')).not.toContain(36);
  });
}
