import { test, expect } from '@playwright/test';
import { CECE, fakeStudentSubmit, id, sampleCard, samplePage } from '../tests/helpers/fake-student-submit.js';
import {
  TODAY,
  KEY,
  PHONE,
  CHROMEBOOK,
  serve,
  routes,
  stored,
  fits,
  named,
  shot,
  contrast,
  signIn,
  showAll,
} from './student-card-fake.js';

/* The rest of the student's sign-in screens (S3-F3), against the built site
   with the live site's CSP: After Done, Switching Classes (Your Classes and
   Add Another Card), Is This You? on a Chromebook, and Scan the Code With
   the Camera. The student-submit function is answered in the test by its
   own handler and routes over a stand-in database, as in
   e2e/student-card-wired.spec.js. */

const HUM = id(3);

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

for (const size of [
  { name: 'a phone', tag: 'phone', use: PHONE },
  { name: 'a Chromebook', tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('Switching Classes on ' + size.name, () => {
    test.use(size.use);

    test('Your Classes, Add Another Card, Is This You?, the second class, and back to the first', async ({ page }) => {
      const fn = twoClasses();
      const posts = await serve(page, fn);
      const errors = [];
      page.on('pageerror', err => errors.push(String(err)));
      await signIn(page);
      const token = JSON.parse((await stored(page)).local[KEY]).t;

      // The class's name opens Your Classes.
      await page.getByRole('button', { name: 'Science 8 Block B' }).click();
      const sheet = page.getByRole('dialog', { name: 'Your Classes' });
      await expect(sheet).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your Classes' })).toBeFocused();
      await expect(sheet.getByRole('button', { name: 'Add Another Card' })).toBeVisible();
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s3f3-your-classes');
      // Escape closes it and gives the focus back to the class's name.
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Science 8 Block B' })).toBeFocused();

      // Add Another Card.
      await page.getByRole('button', { name: 'Science 8 Block B' }).click();
      await sheet.getByRole('button', { name: 'Add Another Card' }).click();
      await expect(page.getByRole('heading', { name: 'Add Another Card' })).toBeVisible();
      await expect(page.getByText('Type the code on the card for your other class.')).toBeVisible();
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s3f3-add-another-card');
      posts.length = 0;
      await page.getByLabel('Card Code').fill('K7M4-QX2P');
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Back to Your Page' })).toBeVisible();
      await page.getByLabel('Student Number').fill('0123456');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Humanities 8 Block A' })).toBeVisible();
      await showAll(page);
      await expect(page.locator('.sp-row-title')).toHaveText(['Medieval Europe Map']);
      await expect.poll(() => routes(posts)).toEqual(['card', 'add-card', 'page', 'work']);
      // One session: the token is the same; the class it opens is the new one.
      const kept = JSON.parse((await stored(page)).local[KEY]);
      expect(kept.t).toBe(token);
      expect(kept.e).toBe(HUM);

      // Both classes listed; back to the first.
      await page.getByRole('button', { name: 'Humanities 8 Block A' }).click();
      await expect(sheet.locator('.sp-class-name')).toHaveText(['Science 8', 'Humanities 8']);
      await expect(sheet.locator('.sp-class[aria-current="true"] .sp-class-name')).toHaveText('Humanities 8');
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s3f3-two-classes');
      await sheet.locator('.sp-class', { hasText: 'Science 8' }).click();
      await expect(page.getByRole('button', { name: 'Science 8 Block B' })).toBeVisible();
      await expect(page.locator('.sp-piece.sp-picked .sp-piece-title')).toBeVisible();
      expect(JSON.parse((await stored(page)).local[KEY]).e).toBe(CECE);
      expect(errors).toEqual([]);
    });

    test('a card that won’t open while adding says why, and the student stays signed in', async ({ page }) => {
      const fn = twoClasses();
      fn.state.cards.K7M4QX2P.locked = true;
      await serve(page, fn);
      await signIn(page);
      await page.getByRole('button', { name: 'Science 8 Block B' }).click();
      await page.getByRole('button', { name: 'Add Another Card' }).click();
      await page.getByLabel('Card Code').fill('K7M4-QX2P');
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('alert')).toHaveText(
        'This card is locked after too many wrong tries. Ask your teacher to unlock it.',
      );
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s3f3-add-locked');
      await page.getByRole('button', { name: 'Back to Your Page' }).click();
      await expect(page.getByRole('heading', { name: 'Assignments' })).toBeVisible();
      expect((await stored(page)).local[KEY]).toBeTruthy();
    });

    test('After Done', async ({ page }) => {
      await serve(page, twoClasses());
      await signIn(page);
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('heading', { name: 'You’re signed out' })).toBeVisible();
      await expect(
        page.getByText(
          size.tag === 'phone' ? 'This phone no longer has your card.' : 'This computer no longer has your card.',
          { exact: true },
        ),
      ).toBeVisible();
      await fits(page);
      await named(page);
      await contrast(page);
      await shot(page, size.tag + '-s3f3-after-done');
    });
  });
}

test.describe('Is This You? on a Chromebook', () => {
  test.use(CHROMEBOOK);

  test('one card in the middle, as the board’s step 2; no phone code box', async ({ page }) => {
    await serve(page, twoClasses());
    await page.goto('/s/#P3R8-WDK4');
    const box = page.locator('.sp-check-box');
    await expect(box.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
    await expect(box.getByText('Science 8 · Block B')).toBeVisible();
    await expect(box.getByRole('button', { name: 'Yes, That’s Me' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'No, That’s Not Me' })).toBeVisible();
    await expect(page.getByText('No camera? Type the code on your card')).toBeHidden();
    const width = await box.evaluate(el => el.getBoundingClientRect().width);
    expect(width).toBe(440);
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'chromebook-s3f3-is-this-you');
  });
});

test.describe('Is This You? on a phone', () => {
  test.use(PHONE);

  test('the avatar centred above the heading; Yes and No full width with a gap', async ({ page }) => {
    await serve(page, twoClasses());
    await page.goto('/s/#P3R8-WDK4');
    const box = page.locator('.sp-check-box');
    await expect(box.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
    const r = await box.evaluate(el => {
      const at = s => el.querySelector(s).getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const a = at('.sp-avatar');
      const h = at('.sp-big');
      const yes = at('[data-act="card-yes"]');
      const no = at('[data-act="card-notme"]');
      return {
        avatarMid: a.left + a.width / 2,
        boxMid: b.left + b.width / 2,
        avatarAbove: a.bottom <= h.top,
        yes: yes.width,
        no: no.width,
        box: b.width,
        gap: no.top - yes.bottom,
      };
    });
    expect(Math.abs(r.avatarMid - r.boxMid)).toBeLessThan(2);
    expect(r.avatarAbove).toBe(true);
    expect(r.yes).toBe(r.box);
    expect(r.no).toBe(r.box);
    expect(r.gap).toBeGreaterThanOrEqual(8);
    await shot(page, 'phone-s3f3-is-this-you');
  });
});

/* A camera and a QR reader standing in for the Chromebook's: the camera is
   a canvas's picture, and the reader finds the card's address on its
   fourth look. */
async function fakeCamera(page) {
  await page.addInitScript(() => {
    window.__looks = 0;
    window.__stopped = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const g = c.getContext('2d');
      g.fillStyle = '#444';
      g.fillRect(0, 0, 320, 240);
      const stream = c.captureStream(5);
      stream.getTracks().forEach(t => {
        const stop = t.stop.bind(t);
        t.stop = () => {
          window.__stopped += 1;
          stop();
        };
      });
      return stream;
    };
    window.BarcodeDetector = class {
      async detect() {
        window.__looks += 1;
        return window.__looks >= 4 && window.__found ? [{ rawValue: 'https://fullvision.ca/s/#P3R8WDK4' }] : [];
      }
    };
  });
}

test.describe('Scan the Code With the Camera', () => {
  test('on a Chromebook: the camera reads the card and Is This You? opens; the camera is off', async ({ browser }) => {
    const ctx = await browser.newContext(CHROMEBOOK);
    const page = await ctx.newPage();
    await fakeCamera(page);
    const fn = twoClasses();
    const posts = await serve(page, fn);
    await page.goto('/s/#P3R8-WDK4');
    await page.getByRole('button', { name: 'No, That’s Not Me' }).click();
    await page.getByRole('button', { name: 'Type a Different Code' }).click();
    const scan = page.getByRole('button', { name: 'Scan the Code With the Camera' });
    await expect(scan).toBeVisible();
    await fits(page);
    await named(page);
    await contrast(page);
    await shot(page, 'chromebook-s3f3-type-or-scan');
    await scan.click();
    await expect(page.getByRole('heading', { name: 'Scan the code on your card' })).toBeVisible();
    await expect(page.getByText('Hold your card up to the camera.')).toBeVisible();
    await named(page);
    await contrast(page);
    await shot(page, 'chromebook-s3f3-camera');
    posts.length = 0;
    await page.evaluate(() => (window.__found = true));
    await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
    expect(posts.map(p => p.body)).toEqual([{ route: 'card', code: 'P3R8WDK4' }]);
    expect(await page.evaluate(() => window.__stopped)).toBeGreaterThan(0);
    await ctx.close();
  });

  test('on a phone it is not offered: the phone’s own camera scans the card', async ({ browser }) => {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await fakeCamera(page);
    await serve(page, twoClasses());
    await page.goto('/s/#demo-card');
    await expect(page.getByRole('heading', { name: 'Scan the code on your card' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan the Code With the Camera' })).toBeHidden();
    await ctx.close();
  });
});
