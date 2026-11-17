import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK } from './student-card-fake.js';

/* A handout's pages on a card still to do, to swipe through (s/page-carousel.js;
   Colin, 2026-11-17: "it should look like Instagram"), in Demo Mode at phone
   and Chromebook size. The Quick Check is Missing with a two-page Study
   Guide; the Poster is due with its Poster Checklist. Nothing is sent. */

const SHOTS = process.env.CAROUSEL_SHOTS || '';

async function demo(page, hash) {
  const posts = [];
  const pictures = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
    if (/\/assets\/sample-handouts\//.test(req.url())) pictures.push(req.url().replace(/^.*\/sample-handouts\//, ''));
  });
  await page.goto('/s/#' + (hash || 'demo-card'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.locator('.sp-deck .sp-piece').first()).toBeVisible();
  return { posts, pictures };
}

const card = (page, id) => page.locator('.sp-piece[data-piece="' + id + '"]');
const loaded = img => img.evaluate(el => el.complete && el.naturalWidth > 0);

test.describe('on a phone', () => {
  test.use(PHONE);

  test('a Missing card shows page 1; a swipe shows page 2; a tap opens it full size', async ({ page }) => {
    const { posts, pictures } = await demo(page);
    const quick = card(page, 'demo-quick');
    const car = quick.locator('.sp-car');
    await expect(car).toBeVisible();
    const track = car.locator('.sp-car-track');
    const first = car.locator('.sp-car-slide').nth(0).locator('img');
    await expect.poll(() => loaded(first)).toBe(true);
    await expect(car.locator('.sp-car-count')).toHaveText('1 / 2');
    await expect(car.locator('.sp-car-dot-on')).toHaveCount(1);
    await expect(car.locator('.sp-car-dot').nth(0)).toHaveClass(/sp-car-dot-on/);
    await expect(car.locator('.sp-car-caption')).toHaveText('Study Guide');
    // The picture fills the card's width at a letter page's shape, the whole page showing.
    const box = await track.boundingBox();
    expect(box.width).toBeGreaterThan(330);
    expect(Math.abs(box.height - (box.width * 11) / 8.5)).toBeLessThan(3);
    expect(box.height).toBeLessThanOrEqual(812 * 0.7 + 1);
    // No arrows on a phone: it swipes.
    await expect(car.locator('.sp-car-next')).toBeHidden();
    if (SHOTS) await page.screenshot({ path: SHOTS + '/carousel-phone-page-1.png' });

    // A sideways swipe moves the pages.
    const at = await track.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: Math.round(at.x + at.width * 0.8),
      y: Math.round(at.y + at.height / 2),
      xDistance: -Math.round(at.width * 0.7),
      yDistance: 0,
      gestureSourceType: 'touch',
      speed: 1200,
    });
    await expect(car.locator('.sp-car-count')).toHaveText('2 / 2');
    await expect(car.locator('.sp-car-dot').nth(1)).toHaveClass(/sp-car-dot-on/);
    // It snaps to the whole of page 2.
    await expect.poll(() => track.evaluate(t => Math.abs(t.scrollLeft - t.clientWidth))).toBeLessThan(2);
    await expect.poll(() => loaded(car.locator('.sp-car-slide').nth(1).locator('img'))).toBe(true);
    // The list did not move up or down.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/carousel-phone-page-2.png' });

    // A tap on page 2 opens it full size, in the handout's own pane; Back comes back to page 2.
    await car.locator('.sp-car-slide').nth(1).click();
    const pane = page.locator('.sp-handout');
    await expect(pane.getByRole('heading', { name: 'Study Guide' })).toBeVisible();
    await expect(pane.locator('.sp-fb-sub')).toHaveText('Page 2 of 2');
    await expect.poll(() => loaded(pane.locator('img.sp-work-img'))).toBe(true);
    await pane.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('.sp-handout')).toHaveCount(0);
    await expect(card(page, 'demo-quick').locator('.sp-car-count')).toHaveText('2 / 2');

    // A vertical swipe over the pictures scrolls the list, and leaves the pages where they were.
    await page.evaluate(() => window.scrollTo(0, 0));
    const again = await card(page, 'demo-quick').locator('.sp-car-track').boundingBox();
    await cdp.send('Input.synthesizeScrollGesture', {
      x: Math.round(again.x + again.width / 2),
      y: Math.round(again.y + again.height * 0.8),
      xDistance: 0,
      yDistance: -300,
      gestureSourceType: 'touch',
      speed: 1200,
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(card(page, 'demo-quick').locator('.sp-car-count')).toHaveText('2 / 2');

    expect(pictures.filter(p => /^poster-checklist/.test(p)).length).toBeLessThanOrEqual(2);
    expect(posts).toEqual([]);
  });

  test('a card far below the screen fetches no picture until the student scrolls near it', async ({ page }) => {
    const { posts, pictures } = await demo(page, 'demo-card-feed');
    const quick = card(page, 'demo-quick').locator('.sp-car-slide').nth(0).locator('img');
    await expect.poll(() => loaded(quick)).toBe(true);
    await page.waitForTimeout(300);
    // The Poster and the Review are screens below: nothing of theirs is asked for.
    expect(pictures.some(p => /^poster-checklist/.test(p))).toBe(false);
    expect(pictures.some(p => /^proposal-planner/.test(p))).toBe(false);
    await expect(card(page, 'demo-poster').locator('.sp-car-slide img')).toHaveCount(0);
    // Near it: its first page comes; on screen, the next.
    await card(page, 'demo-poster').scrollIntoViewIfNeeded();
    await expect
      .poll(() => pictures.filter(p => /^poster-checklist/.test(p)).sort())
      .toEqual(['poster-checklist-1.jpg', 'poster-checklist-2.jpg']);
    expect(posts).toEqual([]);
  });

  test('a card handed in has no pages to swipe; a page reserves its space while it loads', async ({ page }) => {
    await page.route('**/assets/sample-handouts/study-guide-1.svg', () => {
      /* held: the page never arrives */
    });
    await demo(page, 'demo-card-revise');
    // Needs Revision: handed in, the card keeps no carousel.
    const revise = page.locator('.sp-piece-revise');
    await expect(revise.first()).toBeVisible();
    await expect(revise.locator('.sp-car')).toHaveCount(0);
    // My Learning's sent and returned work has none either.
    await expect(page.locator('.sp-piece:not(.sp-piece-due):not(.sp-piece-missing) .sp-car')).toHaveCount(0);
    // A page on its way is a grey box the size of the page, never a broken picture.
    const slide = card(page, 'demo-quick').locator('.sp-car-slide').nth(0);
    const box = await slide.boundingBox();
    expect(box.height).toBeGreaterThan(400);
    expect(await slide.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(236, 238, 242)');
  });
});

test.describe('on a Chromebook', () => {
  test.use(CHROMEBOOK);

  test('Next Page and the Right arrow key move the pages; the dots and the count follow', async ({ page }) => {
    const { posts } = await demo(page);
    const car = card(page, 'demo-quick').locator('.sp-car');
    await expect(car).toBeVisible();
    await expect.poll(() => loaded(car.locator('.sp-car-slide').nth(0).locator('img'))).toBe(true);
    const prev = car.getByRole('button', { name: 'Previous Page' });
    const next = car.getByRole('button', { name: 'Next Page' });
    await expect(prev).toBeHidden();
    await expect(next).toBeVisible();
    // No taller than 70% of the screen, the whole page showing.
    const box = await car.locator('.sp-car-track').boundingBox();
    expect(box.height).toBeLessThanOrEqual(768 * 0.7 + 1);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/carousel-chromebook-arrows.png' });
    await next.click();
    await expect(car.locator('.sp-car-count')).toHaveText('2 / 2');
    await expect(car.locator('.sp-car-dot').nth(1)).toHaveClass(/sp-car-dot-on/);
    await expect(next).toBeHidden();
    await expect(prev).toBeVisible();
    // The keys, with the pages focused.
    await car.locator('.sp-car-track').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(car.locator('.sp-car-count')).toHaveText('1 / 2');
    await page.keyboard.press('ArrowRight');
    await expect(car.locator('.sp-car-count')).toHaveText('2 / 2');
    // Two handouts on one card: their pages follow one another, the name following the page.
    await page.getByRole('button', { name: /^Upcoming/ }).click();
    const fair = card(page, 'demo-fair').locator('.sp-car');
    await expect(fair.locator('.sp-car-slide')).toHaveCount(3);
    await expect(fair.locator('.sp-car-caption')).toHaveText('Proposal Planner');
    await fair.getByRole('button', { name: 'Next Page' }).click();
    await expect(fair.locator('.sp-car-count')).toHaveText('2 / 3');
    await fair.getByRole('button', { name: 'Next Page' }).click();
    await expect(fair.locator('.sp-car-count')).toHaveText('3 / 3');
    await expect(fair.locator('.sp-car-caption')).toHaveText('Lab Safety Checklist');
    // A click on the page opens it full size.
    await fair.locator('.sp-car-slide').nth(2).click();
    await expect(page.locator('.sp-handout .sp-work-title')).toHaveText('Lab Safety Checklist');
    expect(posts).toEqual([]);
  });
});
