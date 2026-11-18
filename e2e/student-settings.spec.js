import { test, expect } from '@playwright/test';
import { CECE, fakeStudentSubmit, id, sampleCard, samplePage } from '../tests/helpers/fake-student-submit.js';
import { TODAY, KEY, CHROMEBOOK, serve, stored, fits, named, contrast, signIn } from './student-card-fake.js';

/* Settings on the student page (Colin, 2026-11-17: "let's replace the log
   out button and the class picker button at the top with a gear icon.
   include relevant options for students."), against the built site with
   the live site's CSP and the student-submit function answered in the test
   (e2e/student-card-fake.js). The gear opens a sheet from the bottom on a
   phone and a small menu under the gear on a Chromebook: Switch Class (two
   classes here), Add Another Card, Text Size, and Log Out, which asks first
   and takes the Text Size with the session.

   Set S0W1S_SHOTS to a folder to save pictures of the gear closed and open. */

const HUM = id(3);
const SHOTS = process.env.S0W1S_SHOTS || '';
const PHONE_390 = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

function humanities() {
  const base = samplePage(TODAY);
  return sampleCard(TODAY, {
    code: 'K7M4QX2P',
    enrollment: HUM,
    course: { name: 'Humanities 8', block: 'A' },
    page: Object.assign(base, {
      student: { enrollment_id: HUM, first_name: 'Cece' },
      course: Object.assign({}, base.course, { name: 'Humanities 8', block: 'A' }),
      assessments: [Object.assign({}, base.assessments[0], { id: id(90), title: 'Medieval Europe Map' })],
    }),
  });
}
const twoClasses = () => fakeStudentSubmit({ cards: [sampleCard(TODAY), humanities()] });

async function picture(page, name) {
  if (!SHOTS) return;
  // Settings has finished sliding in.
  await page.waitForTimeout(300);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `${SHOTS}/settings-${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

// How big the page is drawn: the zoom on the student page's frame, and the class on <html>.
const drawnAt = page =>
  page.evaluate(() => ({
    zoom: getComputedStyle(document.querySelector('#app')).zoom,
    html: document.documentElement.className.trim(),
  }));

for (const size of [
  { name: 'a phone (390 px)', tag: 'phone', use: PHONE_390 },
  { name: 'a Chromebook', tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('Settings on ' + size.name, () => {
    test.use(size.use);

    test('the gear, Switch Class, Text Size, and Log Out clearing what Settings kept', async ({ page }) => {
      const posts = await serve(page, twoClasses());
      const errors = [];
      page.on('pageerror', err => errors.push(String(err)));
      await signIn(page);

      // The header: the class's name and block as plain text, and one gear where Log Out was.
      await expect(page.locator('.sp-head-class')).toHaveText('Science 8Block B');
      await expect(page.locator('.sp-head').getByRole('button', { name: 'Log Out' })).toHaveCount(0);
      const gear = page.getByRole('button', { name: 'Settings' });
      await expect(gear).toBeVisible();
      await expect(gear).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(gear).toHaveAttribute('aria-expanded', 'false');
      const g = await gear.boundingBox();
      expect(g.width).toBeGreaterThanOrEqual(44);
      expect(g.height).toBeGreaterThanOrEqual(44);
      expect(g.x + g.width).toBeGreaterThan(size.use.viewport.width - 60);
      // Settings is not on the page at all until the gear is pressed.
      await expect(page.locator('.sp-set')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await picture(page, size.tag + '-closed');

      // Open: a modal dialog named Settings, its title focused, sliding in from where it starts.
      await gear.click();
      const sheet = page.getByRole('dialog', { name: 'Settings' });
      await expect(sheet).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeFocused();
      await expect(gear).toHaveAttribute('aria-expanded', 'true');
      await expect(sheet.getByText('Signed in as Cece', { exact: true })).toBeVisible();
      await expect(sheet.getByText('Switch Class')).toHaveCount(0);
      const anim = await page.locator('.sp-set').evaluate(el => getComputedStyle(el).animationName);
      expect(anim).toBe(size.tag === 'phone' ? 'sp-set-up' : 'sp-set-drop');
      await page.waitForTimeout(300);
      const box = await page.locator('.sp-set').boundingBox();
      if (size.tag === 'phone') {
        // A sheet from the bottom, the screen's width.
        expect(Math.round(box.y + box.height)).toBe(size.use.viewport.height);
        expect(Math.round(box.width)).toBe(size.use.viewport.width);
      } else {
        // A small menu under the gear, its right edge at the gear's.
        expect(box.y).toBeGreaterThanOrEqual(g.y + g.height);
        expect(box.width).toBeLessThan(400);
        expect(Math.abs(box.x + box.width - (g.x + g.width))).toBeLessThanOrEqual(2);
      }
      await fits(page);
      await named(page);
      await contrast(page);
      // Tab goes round inside it, never to the page behind.
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement.closest('.sp-set'))).toBe(true);
      }
      // A tap outside closes it and gives the focus back to the gear.
      await page.mouse.click(20, size.use.viewport.height / 2);
      await expect(sheet).toHaveCount(0);
      await expect(gear).toBeFocused();

      // Add Another Card, from Settings: the second class.
      await gear.click();
      await sheet.getByRole('button', { name: 'Add Another Card' }).click();
      await page.getByLabel('Card Code').fill('K7M4-QX2P');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByLabel('Student Number').fill('0123456');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
      await expect(page.locator('.sp-head-class')).toHaveText('Humanities 8Block A');

      // Switch Class: both classes, this one marked; the other opens in the same session.
      await gear.click();
      await expect(sheet.getByRole('heading', { name: 'Switch Class' })).toBeVisible();
      await expect(sheet.locator('.sp-class-name')).toHaveText(['Science 8', 'Humanities 8']);
      await expect(sheet.locator('.sp-class[aria-current="true"] .sp-class-name')).toHaveText('Humanities 8');
      await fits(page);
      await named(page);
      await contrast(page);
      await picture(page, size.tag + '-open');
      const token = JSON.parse((await stored(page)).local[KEY]).t;
      await sheet.locator('.sp-class', { hasText: 'Science 8' }).click();
      await expect(page.locator('.sp-head-class')).toHaveText('Science 8Block B');
      await expect(sheet).toHaveCount(0);
      expect(JSON.parse((await stored(page)).local[KEY])).toMatchObject({ t: token, e: CECE });

      // Text Size: each choice takes effect at once, and Settings stays open on it.
      expect(await drawnAt(page)).toEqual({ zoom: '1', html: '' });
      await gear.click();
      const sizes = sheet.getByRole('radiogroup', { name: 'Text Size' });
      await expect(sizes.getByRole('radio', { name: 'Normal', exact: true })).toHaveAttribute('aria-checked', 'true');
      await sizes.getByRole('radio', { name: 'Large', exact: true }).click();
      await expect(sizes.getByRole('radio', { name: 'Large', exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(sizes.getByRole('radio', { name: 'Large', exact: true })).toBeFocused();
      expect(await drawnAt(page)).toEqual({ zoom: '1.15', html: 'sp-size-large' });
      // The arrow keys choose within the set, as a radio group's do.
      await page.keyboard.press('ArrowRight');
      await expect(sizes.getByRole('radio', { name: 'Larger', exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(sizes.getByRole('radio', { name: 'Larger', exact: true })).toBeFocused();
      expect(await drawnAt(page)).toEqual({ zoom: '1.3', html: 'sp-size-larger' });
      await fits(page);
      await named(page);
      await contrast(page);
      await picture(page, size.tag + '-larger-open');
      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(sheet).toHaveCount(0);
      await expect(gear).toBeFocused();
      await fits(page);
      await expect(page.locator('.sp-head-title')).toBeVisible();
      await picture(page, size.tag + '-larger');
      // Kept beside the session's token, and so the page opens at that size again.
      expect(JSON.parse((await stored(page)).local[KEY])).toMatchObject({ t: token, z: 'larger' });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
      expect(await drawnAt(page)).toEqual({ zoom: '1.3', html: 'sp-size-larger' });

      // Log Out: last in Settings, and it asks first; Escape there is Cancel.
      await gear.click();
      const buttons = sheet.getByRole('button');
      await expect(buttons.last()).toHaveText('Log Out');
      await buttons.last().click();
      const ask = page.getByRole('alertdialog', { name: 'Log Out?' });
      await expect(ask).toBeVisible();
      await expect(sheet).toHaveCount(0);
      await contrast(page);
      await page.keyboard.press('Escape');
      await expect(ask).toHaveCount(0);
      await expect(gear).toBeFocused();
      expect((await stored(page)).local[KEY]).toBeTruthy();
      await gear.click();
      await sheet.getByRole('button', { name: 'Log Out' }).click();
      await ask.getByRole('button', { name: 'Log Out' }).click();
      await expect(page.getByRole('heading', { name: 'You’re signed out' })).toBeVisible();
      // Nothing of the session or of Settings is left on the device, and the page is back at Normal.
      expect((await stored(page)).local).toEqual({});
      expect(await drawnAt(page)).toEqual({ zoom: '1', html: '' });
      await expect.poll(() => posts.map(p => p.body.route)).toContain('done');
      expect(posts.elsewhere).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('Settings with reduced motion', () => {
  test.use({ ...PHONE_390, reducedMotion: 'reduce' });

  test('the sheet is simply there, with no slide', async ({ page }) => {
    await serve(page, twoClasses());
    await signIn(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    expect(await page.locator('.sp-set').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  });
});
