import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import { findLowContrastText } from './contrast-check.js';
import { fakeStudentSubmit, id, sampleCard, samplePage } from '../tests/helpers/fake-student-submit.js';
import { TODAY, serve, signIn } from './student-card-fake.js';

/* Small text is readable: every visible text element under 18 px has at
   least 4.5:1 contrast against its background, in light and dark mode, on
   the main Demo Mode pages (design fixes PR A, 2026-10-19). Blue text uses
   --link; --active is for fills, focus rings, selected states and icons.
   Section and competency colours drawn as text go through tintText().

   Left out on purpose:
   - Level colours (--score-*), as text or as a fill under white text: the
     gradebook and level colours stay as they are (Colin, 2026-10-19).
   - White text on a solid --active fill is not left out: filled buttons and
     chosen pills use --active-fill (5.57:1 light, 6.51:1 dark), and this spec
     holds them to 4.5:1 in both modes. A level fill is exempt only on the
     elements that draw one (fillSelectors), never by its colour value.
   - The gradebook table (.gb-grid): its tiles keep their colours, as above. */

test.beforeEach(({ page }) => demoStudentPageOff(page));

const OPTIONS = { skip: ['.gb-grid'] };

async function enterDemo(page, { phone = false } = {}) {
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(phone ? /teacher-mobile\// : /\/dashboard/);
}

async function expectReadable(page) {
  // Let fades and other finite transitions settle first.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})),
    ),
  );
  const failures = await findLowContrastText(page, OPTIONS);
  expect(failures, JSON.stringify(failures, null, 1)).toEqual([]);
}

/* The Inbox with Send Work on, so the sample work shows (Light Refraction Lab
   has work waiting), and a kept time long ago so the sends show as +N.
   `caughtUp` assesses everything waiting; `view` picks a view from the pill. */
async function openInbox(page, { view = null, caughtUp = false } = {}) {
  await page.evaluate(caughtUp => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    localStorage.setItem('fv-dash-inbox-seen:' + cid, '2000-01-01T00:00:00.000Z');
    if (caughtUp) {
      const ids = getStudents(cid).map(s => s.id);
      getAssessments(cid).forEach(a =>
        GraderWork.workCounts(cid, a.id, ids).ids.tograde.forEach(sid =>
          Grader.setOverallComment(cid, sid, a.id, 'Seen.'),
        ),
      );
    }
    PageDashboard.render();
  }, caughtUp);
  await page.locator('#dash-inbox, #dash-inbox-caught').first().waitFor();
  if (view && view !== 'menu') {
    await page.locator('#dash-view-btn-inbox').click();
    await page.locator('#dash-view-menu-inbox [data-view="' + view + '"]').click();
  } else if (view === 'menu') {
    await page.locator('#dash-view-btn-inbox').click();
    await expect(page.locator('#dash-view-menu-inbox')).toBeVisible();
  } else if (!caughtUp) {
    await expect(page.locator('.dash-inbox-grade').first()).toBeVisible();
    await expect(page.locator('.dash-inbox-new').first()).toBeVisible();
  }
  if (caughtUp) await expect(page.locator('.dash-inbox-drop-area').first()).toBeVisible();
  // Let a view's own pictures and fades settle.
  await page.waitForTimeout(400);
}

const DESKTOP = [
  { name: 'dashboard', hash: '/dashboard', ready: '.dash-card' },
  // The Inbox is behind a build switch. Its +N badge, Grade button, ticks and
  // buttons are white words on the blue fill; each view and the piece switch
  // are held to 4.5:1 too.
  ...[
    ['By Assessment', null],
    ['By Assessment, view menu open', 'menu'],
    ['Side by Side', 'side'],
    ['Flip Through', 'flip'],
    ['Roll Call', 'roll'],
  ].map(([label, view]) => ({
    name: 'dashboard with the Inbox on, ' + label,
    hash: '/dashboard',
    ready: '.dash-glance',
    open: page => openInbox(page, { view }),
  })),
  {
    name: 'dashboard with the Inbox on, All Caught Up and the drop area',
    hash: '/dashboard',
    ready: '.dash-glance',
    open: page => openInbox(page, { caughtUp: true }),
  },
  {
    name: 'assignments with a rubric open',
    hash: '/assignments',
    ready: '#ac-sci8a1',
    open: async page => {
      // The title, not the header's centre: on an Advanced Rubric the
      // Checklists control pushes the view toggle under the midpoint.
      await page.locator('#ac-sci8a1 .assess-title').click();
      const row = page.locator('#ac-sci8a1 .rsg-criterion-row').first();
      await expect(row).toBeVisible();
      // A chosen + or − shows the pressed state.
      await row.locator('.rsg-mod:not(:disabled)').first().click();
      await expect(row.locator('.rsg-mod.active')).toHaveCount(1);
      // Pointing at a level opens the descriptor bar and its competency tags,
      // so they are part of this page's check. (Hovered on purpose: newer
      // Playwright doesn't leave the pointer over the level after a click.)
      await row.locator('.rsg-level[data-action="selectRubricScore"]').first().hover();
      await expect(page.locator('#rsg-descriptor-bar .rsg-descriptor-tag').first()).toBeVisible();
    },
  },
  { name: 'gradebook', hash: '/gradebook', ready: '.gb-grid' },
  // The student page, one tab at a time.
  ...['comps', 'grades', 'evidence', 'profile'].map(tab => ({
    name: 'student ' + tab,
    hash: '/student?id=st23&course=sci8',
    ready: '.stu-tabs',
    async open(page) {
      await page.locator('#stu-tab-' + tab).click();
      await expect(page.locator('#stu-tab-' + tab)).toHaveAttribute('aria-selected', 'true');
    },
  })),
  { name: 'reports', hash: '/reports', ready: '.student-row' },
];

for (const colorScheme of ['light', 'dark']) {
  test.describe(`Text contrast, ${colorScheme} mode`, () => {
    test.use({ colorScheme });

    for (const p of DESKTOP) {
      test(`${p.name}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        if (p.flag) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), p.flag);
        await enterDemo(page);
        await page.goto(p.hash);
        await expect(page.locator(p.ready).first()).toBeVisible();
        if (p.open) await p.open(page);
        await expectReadable(page);
      });
    }

    test('phone Observe', async ({ page }) => {
      await enterDemo(page, { phone: true });
      await page.locator('.m-tab-item[data-tab="observe"]').click();
      await expect(page.locator('.m-obs-card').first()).toBeVisible();
      await expectReadable(page);
    });

    // The phone's Bulletins tab (B1f): the feed with its blue Post a Photo, Write a Bulletin, and a delete's red confirm.
    test('phone Bulletins: the feed, Write a Bulletin and the confirm', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await enterDemo(page, { phone: true });
      await page.locator('.m-tab-item[data-tab="bulletins"]').click();
      await expect(page.locator('.m-bulletin-card').first()).toBeVisible();
      await expectReadable(page);
      await page.locator('[data-m-bulletin="write"]').click();
      await expect(page.locator('#m-bulletin-write')).toBeVisible();
      await page.waitForTimeout(400);
      await expectReadable(page);
      await page.locator('#m-bulletin-write [data-m-bulletin="close"]').click();
      await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
      await page.locator('.m-bulletin-seen').first().click();
      await page.locator('#m-bulletin-seen-sheet [data-m-bulletin="delete"]').click();
      await expect(page.locator('.m-bulletin-confirm-ok')).toBeVisible();
      await page.waitForTimeout(400);
      await expectReadable(page);
    });
  });
}

/* The student page's Settings sheet (the gear): its buttons, the Text Size
   choices and the class rows, with a second class added so Switch Class shows.
   The student page has no dark mode, so it is checked once. */
test.describe('Text contrast, the student Settings sheet', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Settings open, and Switch Class with two classes', async ({ page }) => {
    const HUM = id(3);
    const base = samplePage(TODAY);
    const humanities = sampleCard(TODAY, {
      code: 'K7M4QX2P',
      enrollment: HUM,
      course: { name: 'Humanities 8', block: 'A' },
      page: Object.assign(base, {
        student: { enrollment_id: HUM, first_name: 'Cece' },
        course: Object.assign({}, base.course, { name: 'Humanities 8', block: 'A' }),
        assessments: [Object.assign({}, base.assessments[0], { id: id(90), title: 'Medieval Europe Map' })],
      }),
    });
    await serve(page, fakeStudentSubmit({ cards: [sampleCard(TODAY), humanities] }));
    await signIn(page);
    const gear = page.getByRole('button', { name: 'Settings' });
    await gear.click();
    const sheet = page.getByRole('dialog', { name: 'Settings' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    await expectReadable(page);
    await sheet.getByRole('button', { name: 'Add Another Card' }).click();
    await page.getByLabel('Card Code').fill('K7M4-QX2P');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Student Number').fill('0123456');
    await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
    await expect(page.locator('.sp-head-class')).toHaveText('Humanities 8Block A');
    await gear.click();
    await expect(sheet.getByRole('heading', { name: 'Switch Class' })).toBeVisible();
    await page.waitForTimeout(400);
    await expectReadable(page);
  });
});
