import { test, expect } from '@playwright/test';
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
   has work waiting), and a kept time long ago so the new work shows its dot.
   `caughtUp` assesses everything waiting; `view` picks a view from the
   switch; `stack` opens a stack. */
async function openInbox(page, { view = null, caughtUp = false, stack = false } = {}) {
  await page.evaluate(caughtUp => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    localStorage.setItem('fv-dash-inbox-seen:' + cid, '2000-01-01T00:00:00.000Z');
    if (caughtUp) {
      // Nothing waiting includes no question (a question is a line in the Inbox, Nov 27).
      setCourseFeedbackOptions(cid, { reflect_on_feedback: false }, _newEntryId());
      const ids = getStudents(cid).map(s => s.id);
      getAssessments(cid).forEach(a => {
        GraderWork.workCounts(cid, a.id, ids).ids.tograde.forEach(sid =>
          Grader.setOverallComment(cid, sid, a.id, 'Seen.'),
        );
        const back = GraderWork.workCounts(cid, a.id, ids).ids.toreturn;
        if (back.length) Grader.returnGrades(cid, a.id, back);
      });
    }
    PageDashboard.render();
  }, caughtUp);
  await page.locator('#dash-inbox').waitFor();
  if (view) await page.locator('[data-dash-inbox="mode"][data-mode="' + view + '"]').click();
  else if (!caughtUp) {
    await expect(page.locator('.dash-inbox-action').first()).toBeVisible();
    await expect(page.locator('.dash-inbox-stack-dot').first()).toBeVisible();
  }
  if (stack) await page.locator('.dash-inbox-stack').first().click();
  if (caughtUp) await expect(page.locator('.dash-inbox-caught-up').first()).toBeVisible();
  // Let a view's own pictures and fades settle.
  await page.waitForTimeout(400);
}

/* The sample class with its Student Page and Send Work on, as openInbox
   sets them, then the page drawn again. */
async function sendWorkOn(page, hash) {
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
  });
  await page.goto(hash);
}

const DESKTOP = [
  { name: 'dashboard', hash: '/dashboard', ready: '.dash-card' },
  // The Inbox: its dot, buttons and stacks are held to 4.5:1 in each view and state.
  ...[
    ['To Grade', null, false],
    ['To Grade, a stack open', null, true],
    ['Roll Call', 'rollcall', false],
  ].map(([label, view, stack]) => ({
    name: 'dashboard, the Inbox, ' + label,
    hash: '/dashboard',
    ready: '.dash-glance',
    open: page => openInbox(page, { view, stack }),
  })),
  {
    name: 'dashboard, the Inbox with nothing waiting',
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
    },
  },
  /* The tinted and outlined blue buttons that went out under 4.5:1 in
     #1602: Answer on a student's question (now a line in the Inbox), and on an open
     card with work to grade, Grade Submissions and Return N Graded, then
     the grader's Return All and Return for Revision. */
  {
    name: 'dashboard, a question in the Inbox',
    hash: '/dashboard',
    ready: '.dash-card',
    open: async page => {
      await sendWorkOn(page, '/dashboard');
      await expect(page.locator('.dash-inbox-q-answer').first()).toBeVisible();
    },
  },
  {
    name: 'assignments, the grader on work to grade',
    hash: '/assignments',
    ready: '#ac-sci8a1',
    open: async page => {
      await sendWorkOn(page, '/assignments');
      // The piece with graded work not yet returned, so Return All shows.
      // Its buttons show once the card is open.
      const card = page.locator('[id^="ac-"]:has(.assess-return-btn)').first();
      await card.locator('.assess-title').click();
      await card.locator('.assess-grade-work-btn').click();
      await expect(page.locator('.grader-return-all').first()).toBeVisible();
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
