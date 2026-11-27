/**
 * View as Student: the ways into Preview as Student from a student's own page
 * (a button beside Edit Student), an assignment card's ⋯ menu (opens with that
 * piece showing) and the Bulletins page (opens on the Bulletins tab). Demo
 * Mode, Science 8, 1440 x 900. Each shows only while the class's Student Page
 * is on; Escape gives the focus back to the control.
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';

test.use({ viewport: { width: 1440, height: 900 } });

const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);
const LAB = 'sci8a1';

async function demo(page, off) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (off) await demoStudentPageOff(page);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
}

// Opens the Cell Microscope Lab's card, which shows its ⋯ menu.
async function openCard(page, title = 'Cell Microscope Lab') {
  const card = page.locator('.assess-card', { hasText: title }).first();
  await card.locator('.assess-bar, .assess-head, h3, .assess-title').first().click();
  await expect(page.locator('.assess-card.open').first()).toBeVisible();
  return page.locator('.assess-card.open').first();
}

test('a student’s own page: View as Student opens that class’s preview, and Escape returns', async ({ page }) => {
  await demo(page);
  await page.goto('/student?id=st23&course=sci8');
  const btn = page.getByRole('button', { name: 'View as Student' });
  await expect(btn).toBeVisible();
  await shot(page, 'student-page');
  await btn.click();
  await expect(page.locator('#preview-student')).toBeVisible();
  await shot(page, 'student-page-preview');
  await page.keyboard.press('Escape');
  await expect(page.locator('#preview-student')).toHaveCount(0);
  await expect(btn).toBeFocused();
});

test('an assignment card’s ⋯ menu opens the preview with that piece showing', async ({ page }) => {
  await demo(page);
  await page.goto('/assignments');
  const card = await openCard(page);
  const more = card.locator('[data-action="toggleCardMenu"]').first();
  await more.click();
  await shot(page, 'assignments-menu');
  const item = page.locator('.assess-menu:not([hidden]) [data-action="viewAsStudent"]').first();
  await expect(item).toBeVisible();
  const aid = await item.getAttribute('data-aid');
  await item.click();
  const overlay = page.locator('#preview-student');
  await expect(overlay).toBeVisible();
  // The lab is returned, so the preview opens its Your Feedback.
  await expect(overlay.locator('#sp-fb-title')).toContainText('Cell Microscope Lab');
  await shot(page, 'assignments-preview');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('a piece the student still has to do opens as its card on Assignments', async ({ page }) => {
  await demo(page);
  await page.goto('/assignments');
  const title = await page.evaluate(() => getAssessments(getActiveCourse()).find(a => a.id === 'sci8a21').title);
  const card = await openCard(page, title);
  await card.locator('[data-action="toggleCardMenu"]').first().click();
  await card.locator('.assess-menu:not([hidden]) [data-action="viewAsStudent"]').click();
  const overlay = page.locator('#preview-student');
  await expect(overlay.locator('.sp-picked')).toHaveAttribute('data-piece', 'sci8a21');
  await shot(page, 'assignments-preview-due');
});

test('Bulletins: View as Student opens the preview on the Bulletins tab', async ({ page }) => {
  await demo(page);
  await page.goto('/bulletins');
  const btn = page.getByRole('button', { name: 'View as Student' });
  await expect(btn).toBeVisible();
  await shot(page, 'bulletins');
  await btn.click();
  const overlay = page.locator('#preview-student');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('.sp-tab-on').first()).toContainText('Bulletins');
  await shot(page, 'bulletins-preview');
  await page.keyboard.press('Escape');
  await expect(btn).toBeFocused();
});

test('with the Student Page off, none of the three shows', async ({ page }) => {
  await demo(page, true);
  await page.goto('/student?id=st23&course=sci8');
  await expect(page.locator('.student-toolbar .tb-edit-btn', { hasText: 'Edit Student' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View as Student' })).toHaveCount(0);
  await shot(page, 'student-page-off');
  await page.goto('/assignments');
  const card = await openCard(page);
  await card.locator('[data-action="toggleCardMenu"]').first().click();
  await expect(card.locator('.assess-menu:not([hidden]) [data-action="classResults"]')).toBeVisible();
  await expect(page.locator('[data-action="viewAsStudent"]')).toHaveCount(0);
  await page.goto('/bulletins');
  await expect(page.locator('#bulletin-head')).toBeVisible();
  await expect(page.getByRole('button', { name: 'View as Student' })).toHaveCount(0);
});

// A wide font (Linux runners, Windows laptops, Chromebooks): both buttons stay inside the window.
test('in a wide font the two buttons still fit', async ({ page }) => {
  await demo(page);
  const wide =
    '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';
  await page.goto('/student?id=st23&course=sci8');
  await page.addStyleTag({ content: wide });
  const right = async sel =>
    (await page.locator(sel).last().boundingBox()).x + (await page.locator(sel).last().boundingBox()).width;
  expect(await right('.student-toolbar .tb-edit-btn')).toBeLessThanOrEqual(1440);
  await page.goto('/bulletins');
  await page.addStyleTag({ content: wide });
  expect(await right('.bulletin-view-as')).toBeLessThanOrEqual(1440);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sideways).toBe(false);
});
