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
      // Log Out? takes a press once it has been up a moment (a double tap is not a yes).
      await page.waitForTimeout(450);
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

/* A row of Settings, scrolled to: whole (no box between it and the sheet
   cuts any of it, so nothing has squashed it), at least 44 px tall, on the
   screen, and the thing a tap at its middle reaches. '' when all hold. */
async function wholeAndTappable(row) {
  await row.scrollIntoViewIfNeeded();
  return row.evaluate(el => {
    const r = el.getBoundingClientRect();
    if (r.height < 44) return 'only ' + Math.round(r.height) + ' px tall';
    if (r.top < 0 || r.bottom > window.innerHeight) return 'off the screen';
    for (let p = el.parentElement; p && !p.matches('body'); p = p.parentElement) {
      if (getComputedStyle(p).overflow === 'visible') continue;
      const b = p.getBoundingClientRect();
      if (r.top < b.top - 1 || r.bottom > b.bottom + 1) return 'cut by ' + p.className;
      if (p.matches('.sp-set')) break;
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && el.contains(hit) ? '' : 'not what a tap reaches';
  });
}

/* Demo Mode's sample card, at a Text Size, with a second class added (so
   Switch Class is listed and Settings is at its tallest), Settings open. */
async function demoTwoClasses(page, size) {
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.sp-set [data-act="card-add"]').click();
  await page.locator('#sp-code').fill('ABCD-EFGH');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  if (size !== 'normal') await page.locator('.sp-set-size[data-size="' + size + '"]').click();
  await page.waitForTimeout(300);
}

/* The review's fault 1: a zoomed vh made Settings taller than the screen
   (Log Out below the window on a 657 px Chromebook; the title above the
   top on small phones). Settings now fits the screen and scrolls inside. */
for (const vp of [
  { width: 1366, height: 657, phone: false },
  { width: 320, height: 568, phone: true },
  { width: 375, height: 667, phone: true },
  { width: 390, height: 844, phone: true },
]) {
  for (const size of ['normal', 'large', 'larger']) {
    test.describe('Settings fits ' + vp.width + ' × ' + vp.height + ' at ' + size, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone });

      test('the whole sheet is on the screen, every class can be seen and tapped, and Log Out reached', async ({
        page,
      }) => {
        await demoTwoClasses(page, size);
        const box = await page.locator('.sp-set').boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
        // Choosing a size scrolled Settings to it; at its top, the title and Done.
        await page.locator('.sp-set').evaluate(el => (el.scrollTop = 0));
        await expect(page.getByRole('heading', { name: 'Settings' })).toBeInViewport({ ratio: 1 });
        await expect(page.locator('.sp-set-done')).toBeInViewport({ ratio: 1 });
        // Each class row whole (nothing squashes it), once scrolled to, and the one under the finger.
        const rows = page.locator('.sp-set .sp-class');
        await expect(rows).toHaveCount(2);
        for (let i = 0; i < 2; i += 1) expect(await wholeAndTappable(rows.nth(i))).toBe('');
        const out = page.locator('.sp-set-out');
        await out.scrollIntoViewIfNeeded();
        await expect(out).toBeInViewport({ ratio: 1 });
        await out.click();
        await expect(page.getByRole('alertdialog', { name: 'Log Out?' })).toBeVisible();
        const ask = await page.locator('.sp-logout').boundingBox();
        expect(ask.y).toBeGreaterThanOrEqual(0);
        expect(ask.y + ask.height).toBeLessThanOrEqual(vp.height + 1);
      });
    });
  }
}

/* Five classes on one device, on the smallest phone at each size: Settings
   scrolls, and every class stays whole and opens. */
const FIVE = [
  ['Humanities 8', 'A', 'K7M4QX2P'],
  ['Math 8', 'C', 'H3JX7KQ2'],
  ['French 8', 'D', 'M4PW9TQ7'],
  ['Art 8', 'E', 'R8VK2HX4'],
].map(([name, block, code], i) => {
  const base = samplePage(TODAY);
  const enrollment = id(40 + i);
  return sampleCard(TODAY, {
    code,
    enrollment,
    course: { name, block },
    page: Object.assign(base, {
      student: { enrollment_id: enrollment, first_name: 'Cece' },
      course: Object.assign({}, base.course, { name, block }),
    }),
  });
});

for (const size of ['normal', 'large', 'larger']) {
  test.describe('Switch Class with five classes at 320 × 568, ' + size, () => {
    test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

    test('every class row is whole, can be scrolled to, and opens its class', async ({ page }) => {
      await serve(page, fakeStudentSubmit({ cards: [sampleCard(TODAY), ...FIVE] }));
      await signIn(page);
      const gear = page.getByRole('button', { name: 'Settings', exact: true });
      if (size !== 'normal') {
        await gear.click();
        await page.locator('.sp-set-size[data-size="' + size + '"]').click();
        await page.locator('.sp-set-done').click();
      }
      for (const { code } of FIVE) {
        await gear.click();
        await page.locator('.sp-set [data-act="card-add"]').click();
        await page.getByLabel('Card Code').fill(code);
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.getByLabel('Student Number').fill('0123456');
        await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
        await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
      }
      await gear.click();
      await page.waitForTimeout(300);
      const rows = page.locator('.sp-set .sp-class');
      await expect(rows).toHaveCount(5);
      for (let i = 0; i < 5; i += 1) expect(await wholeAndTappable(rows.nth(i)), 'row ' + (i + 1)).toBe('');
      // The first class, from the top of the list: it opens.
      await rows.nth(0).scrollIntoViewIfNeeded();
      await rows.nth(0).click();
      await expect(page.locator('.sp-head-class')).toHaveText('Science 8Block B');
    });
  });
}

/* The review's fault 2: a double tap on Settings' Log Out landed its second
   tap on the confirm's Log Out. Now Cancel is where the first tap was, and
   Log Out? takes no press for its first 400 ms. */
for (const width of [320, 390, 430]) {
  for (const size of ['normal', 'large', 'larger']) {
    test.describe('a double tap on Log Out at ' + width + ' px, ' + size, () => {
      test.use({ viewport: { width, height: width === 320 ? 568 : 844 }, isMobile: true, hasTouch: true });

      test('leaves the student signed in, 150 ms and 300 ms apart', async ({ page }) => {
        await demoTwoClasses(page, size);
        for (const gap of [150, 300]) {
          if (!(await page.locator('.sp-set').count())) {
            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            await page.waitForTimeout(300);
          }
          const out = page.locator('.sp-set-out');
          await out.scrollIntoViewIfNeeded();
          const b = await out.boundingBox();
          const x = b.x + b.width / 2;
          const y = b.y + b.height / 2;
          await page.touchscreen.tap(x, y);
          await page.waitForTimeout(gap);
          await page.touchscreen.tap(x, y);
          await page.waitForTimeout(600);
          await expect(page.getByRole('heading', { name: 'You’re signed out' })).toHaveCount(0);
          await expect(page.locator('.sp-head-class')).toBeVisible();
          // What the second tap found under it was never the confirm's Log Out.
          const under = await page.evaluate(
            ([px, py]) => {
              const el = document.elementFromPoint(px, py);
              const act = el && el.closest('[data-act]');
              return act ? act.getAttribute('data-act') : '';
            },
            [x, y],
          );
          expect(under).not.toBe('card-done');
          // Back to the page for the next pair.
          if (await page.locator('.sp-logout').count()) await page.keyboard.press('Escape');
        }
      });
    });
  }
}

/* Two tabs of one session: a size chosen in one reaches the other, and the
   other's activity never writes it away. */
test.describe('Text Size in two tabs of one session', () => {
  test.use(PHONE_390);

  test('Larger in one tab shows in the other and stays on the device', async ({ page, context }) => {
    const fn = twoClasses();
    await serve(page, fn);
    await signIn(page);
    const other = await context.newPage();
    await serve(other, fn);
    await other.goto('/s/');
    await expect(other.getByRole('heading', { name: 'Assignments' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.sp-set-size[data-size="larger"]').click();
    await expect.poll(() => drawnAt(other)).toEqual({ zoom: '1.3', html: 'sp-size-larger' });
    // The other tab is used for a while: its writes keep the size.
    for (let i = 0; i < 7; i += 1) {
      await other.mouse.move(100 + i * 5, 300);
      await other.waitForTimeout(1000);
    }
    expect(JSON.parse((await stored(page)).local[KEY]).z).toBe('larger');
    expect(await drawnAt(page)).toEqual({ zoom: '1.3', html: 'sp-size-larger' });
  });
});

/* Preview as Student on a Chromebook: Settings is the small menu under the
   gear, inside the device, as on the student's Chromebook (the review found
   it pinned to the left and stretched to the bottom). */
test.describe('Preview as Student: Settings on the Chromebook', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('a small menu under the gear, inside the device, at each Text Size', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => {
      const cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0;
    });
    await page.evaluate(() => setStudentPageSwitch(getActiveCourse(), true));
    await page.goto('/dashboard?manage=student-page');
    await page.getByRole('button', { name: 'Open Preview' }).click();
    await page.locator('[data-ps-device="chromebook"]').click();
    const screen = page.locator('.ps-screen');
    for (const size of ['normal', 'large', 'larger']) {
      await screen.locator('[data-act="settings-open"]').click();
      if (size !== 'normal') {
        await screen.locator('.sp-set-size[data-size="' + size + '"]').click();
        await screen.locator('.sp-set-done').click();
        await screen.locator('[data-act="settings-open"]').click();
      }
      await page.waitForTimeout(300);
      const set = await screen.locator('.sp-set').boundingBox();
      const gear = await screen.locator('.sp-gear').boundingBox();
      const dev = await screen.boundingBox();
      // Inside the device's screen, always.
      expect(set.x).toBeGreaterThanOrEqual(dev.x - 1);
      expect(set.x + set.width).toBeLessThanOrEqual(dev.x + dev.width + 1);
      expect(set.y + set.height).toBeLessThanOrEqual(dev.y + dev.height + 1);
      // The preview's Chromebook is 820 px: zoomed to Large or Larger the page is under 760 px
      // and takes the phone's layout, as a Chromebook that narrow would. At Normal, the menu.
      if (size === 'normal') {
        expect(set.width).toBeLessThan(500);
        expect(set.y).toBeGreaterThanOrEqual(gear.y + gear.height - 1);
        expect(Math.abs(set.x + set.width - (gear.x + gear.width))).toBeLessThanOrEqual(4);
        expect(set.height).toBeLessThan(dev.height - 60);
      }
      await page.keyboard.press('Escape');
      await expect(screen.locator('.sp-set')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
});
