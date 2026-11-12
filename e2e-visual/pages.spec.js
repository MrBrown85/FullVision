import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/* Screenshot comparison for CSS changes. Every state below is one page (or
   one dialog, tab or sheet) in Demo Mode, pictured full page, and tagged
   with every stylesheet its page loads.

   Two runs, the same VISUAL_DIR for both (playwright.visual.config.js keeps
   the pictures outside the repo):

     1. Record on main:     PORT=8350 npx playwright test --config=playwright.visual.config.js --update-snapshots
     2. Compare on the branch: PORT=8350 npx playwright test --config=playwright.visual.config.js

   A state passes only when its picture matches main's to the pixel.

   VISUAL_SHEET=teacher/reports.css runs only the states whose page loads
   that sheet (a path from the repo root, as the pages link it).

   VISUAL_DEAD=selectors.json, a JSON array of selectors, also checks that
   no element on any state matches one of them, and lists any that do. A
   CSS deletion names the selectors it removed.

   Times are fixed (2026-11-12 09:00), so "today", ages and due dates draw
   the same on every run. Animations are stopped and the caret hidden.

   Stability: two runs of unchanged code matched on every state. A state
   that moves between runs gets mask: page => [locators] for the moving
   part, with a comment saying why; none needs one today.

   What a picture misses: the app scrolls inside its panels, so most
   pictures are the window's height. A rule that shows only further down a
   panel, on hover, or in a state not listed here is not seen; add a state
   for it. */

const DESKTOP_APP = [
  // teacher/app.html's <head>, in its order.
  'teacher/styles.css',
  'shared/loading-screen.css',
  'teacher/dashboard.css',
  'teacher/assignments.css',
  'teacher/student.css',
  'teacher/work-wall.css',
  'teacher/gradebook.css',
  'teacher/class-results.css',
  'teacher/observations.css',
  'teacher/obs-capture.css',
  'teacher/reports.css',
  'teacher/rubric-print.css',
  'teacher/qr-slips.css',
  'teacher/preview-student.css',
  's/page-view.css',
  'shared/phone-report.css',
  'teacher/grades-print.css',
];
const PHONE_APP = [
  // teacher-mobile/index.html's <head>.
  'teacher/styles.css',
  'shared/loading-screen.css',
  'teacher/obs-capture.css',
  'teacher/work-wall.css',
  'teacher-mobile/styles.css',
];
const STUDENT_PAGE = [
  // s/index.html's <head>.
  'shared/phone-report.css',
  'shared/loading-screen.css',
  's/student.css',
  's/page-view.css',
];
const LOGIN = ['teacher/styles.css', 'login.css'];
const PRIVACY = ['teacher/styles.css'];

const NOW = new Date('2026-11-12T09:00:00');

/* ── Getting in ────────────────────────────────────────────── */

// From e2e/gradebook-headers.spec.js.
async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

// From e2e/mobile-sheets.spec.js.
async function enterPhoneDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('#m-loading')).toBeHidden();
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

// Demo Mode from the front page turns the student features on (Send Work
// among them), which the student page's Work tab needs.
async function enterFrontPageDemo(page) {
  await page.goto('/index.html');
  await page.getByRole('link', { name: 'Try Demo Mode' }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function cece(page) {
  return page.evaluate(() => getStudents('sci8').find(s => s.firstName === 'Cece').id);
}

async function studentTab(page, tab, enter = enterDemo) {
  await enter(page);
  const sid = await cece(page);
  await page.goto('/student?course=sci8&id=' + sid + '&tab=' + tab);
  await expect(page.locator('#stu-tab-' + tab)).toHaveAttribute('aria-selected', 'true');
}

async function manageTab(page, tab, name) {
  await enterDemo(page);
  await page.goto('/dashboard?manage=' + tab);
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

// The grader dialog grows in; wait for it to finish (e2e/grader-level-bar.spec.js).
async function settled(locator) {
  await locator.evaluate(el =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter(a => a.effect && a.effect.getTiming().iterations !== Infinity)
        .map(a => a.finished),
    ),
  );
}

// Opened by its address, not by a click from the Term Questionnaire: leaving
// the questionnaire redraws the roster, and its first grade badge sometimes
// stayed blank, so the picture changed from run to run.
async function reportsTab(page, tab, name) {
  await enterDemo(page);
  await page.goto('/reports?course=sci8&tab=' + tab);
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

async function progressReports(page) {
  await reportsTab(page, 'progress', 'Progress Reports');
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await expect(page.locator('.report-sheet').first()).toBeVisible();
}

async function phoneTab(page, name) {
  await enterPhoneDemo(page);
  await page.locator(`.m-tab-item[data-tab="${name}"]`).click();
}

async function phoneSheet(page) {
  await expect(page.locator('#m-sheet-container .m-sheet.m-sheet-visible')).toBeVisible();
  await expect(page.locator('#m-sheet-backdrop')).toHaveCSS('opacity', '1');
}

async function phoneSwiper(page) {
  await phoneTab(page, 'grade');
  await page.locator('text=Science Fair Proposal').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
}

// The student page's card, then Is This You? and the Assignments list
// (e2e/student-card.spec.js). Demo Mode builds all of it on the device.
async function studentCard(page) {
  await page.route('**/functions/v1/**', route => route.abort());
  await page.goto('/s/#demo-card');
  await expect(page.getByLabel('Card Code')).toBeVisible();
}

async function press(page, name) {
  const button = page.getByRole('button', { name });
  if (page.viewportSize().width < 900) await button.tap();
  else await button.click();
}

async function studentSignedIn(page) {
  await studentCard(page);
  await press(page, 'Continue');
  await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
  await page.getByLabel('Month').selectOption('3');
  await page.getByLabel('Day').selectOption('14');
  await page.getByLabel('Year').selectOption(String(NOW.getFullYear() - 13));
  await press(page, 'Yes, That’s Me');
  await expect(page.getByRole('heading', { name: 'Assignments' })).toBeAttached();
}

async function studentPageTab(page, name) {
  await studentSignedIn(page);
  await page.locator('.sp-tabs-bottom').getByRole('button', { name }).click();
  await expect(page.locator('.sp-tabs-bottom .sp-tab-on')).toContainText(name);
}

/* ── The states ────────────────────────────────────────────── */

const STATES = [
  // Desktop, teacher/app.html
  {
    name: 'dashboard',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.locator('.dash-comp-card .dash-comp-row').first().waitFor();
    },
  },
  {
    name: 'manage-students',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => manageTab(page, 'students', /^Students/),
  },
  {
    name: 'manage-grading',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => manageTab(page, 'grading', /^Grading/),
  },
  {
    name: 'manage-terms',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => manageTab(page, 'terms', /Terms/),
  },
  {
    name: 'manage-competencies',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => manageTab(page, 'competencies', /^Competencies/),
  },
  {
    name: 'assignments',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.goto('/assignments?course=sci8');
      await page.locator('#ac-sci8a2').waitFor();
    },
  },
  {
    name: 'assignments-card-open',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.goto('/assignments?course=sci8');
      await page.locator('[data-action="toggleAssess"][data-aid="sci8a2"]').click();
      await expect(page.locator('#ac-sci8a2')).toHaveClass(/\bopen\b/);
    },
  },
  {
    name: 'assignments-grader',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.goto('/assignments?course=sci8');
      await page.locator('#ac-sci8a2').waitFor();
      await page.evaluate(() => PageAssignments.openGrader('sci8', 'sci8a2', 'st1'));
      const dialog = page.locator('.grader-dialog');
      await dialog.waitFor();
      await settled(page.locator('.grader-overlay'));
    },
  },
  {
    name: 'gradebook-scores',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.goto('/gradebook?course=sci8');
      await page.locator('[data-action="setView"][data-mode="scores"]').click();
      await page.locator('#gb-data .gb-stats-row td[data-aid="sci8a4"]').waitFor();
    },
  },
  {
    name: 'gradebook-competencies',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.goto('/gradebook?course=sci8');
      await page.locator('[data-action="setView"][data-mode="detailed"]').click();
      await expect(page.locator('.gb-grid-assess-group').first()).toBeVisible();
    },
  },
  {
    name: 'student-overview',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => studentTab(page, 'overview'),
  },
  {
    name: 'student-comps',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => studentTab(page, 'comps'),
  },
  {
    name: 'student-grades',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => studentTab(page, 'grades'),
  },
  {
    name: 'student-work',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => studentTab(page, 'work', enterFrontPageDemo),
  },
  {
    name: 'student-evidence',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => studentTab(page, 'evidence'),
  },
  {
    name: 'student-profile',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: page => studentTab(page, 'profile'),
  },
  {
    name: 'observations',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.goto('/observations');
      await expect(page.locator('.obs-card').first()).toBeVisible();
    },
  },
  {
    name: 'reports-questionnaire',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await reportsTab(page, 'questionnaire', 'Term Questionnaire');
      await page.locator('#tq-narrative').waitFor();
    },
  },
  {
    name: 'reports-progress',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: progressReports,
  },
  {
    name: 'reports-progress-print',
    project: 'desktop',
    sheets: DESKTOP_APP,
    media: 'print',
    go: progressReports,
  },
  {
    name: 'class-results',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.goto('/gradebook?course=sci8');
      await page.locator('[data-action="setView"][data-mode="scores"]').click();
      const cell = page.locator('#gb-data .gb-stats-row td[data-aid="sci8a4"]');
      await cell.scrollIntoViewIfNeeded();
      await cell.click();
      await expect(page.locator('#class-results')).toBeVisible();
      await expect(page.locator('#cr-title')).toHaveText('KMT & States of Matter Lab');
      await settled(page.locator('#class-results'));
    },
  },
  {
    name: 'help-panel',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      await enterDemo(page);
      await page.locator('.dash-comp-card .dash-comp-row').first().waitFor();
      await page.getByRole('button', { name: 'Help' }).click();
      const panel = page.locator('#help-panel');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Help', level: 2 })).toBeVisible();
      await settled(panel);
    },
  },
  {
    name: 'preview-as-student',
    project: 'desktop',
    sheets: DESKTOP_APP,
    go: async page => {
      // From e2e/student-my-learning.spec.js: the class's student page on.
      await enterDemo(page);
      const name = await page.evaluate(() => {
        setStudentPageSwitch('sci8', true);
        return displayNameWithLast(sortStudents(getStudents('sci8'), 'lastName')[0]);
      });
      await page.goto('/dashboard?manage=student-page');
      await page.getByRole('button', { name: 'Open Preview' }).click();
      const dialog = page.getByRole('dialog', { name: 'Previewing as ' + name });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.ps-screen')).toBeVisible();
      await settled(dialog);
    },
  },
  {
    name: 'login',
    project: 'desktop',
    sheets: LOGIN,
    go: async page => {
      await page.goto('/login.html');
      await expect(page.locator('#demo-mode-btn')).toBeVisible();
    },
  },
  {
    name: 'privacy',
    project: 'desktop',
    sheets: PRIVACY,
    go: async page => {
      await page.goto('/privacy.html');
      await expect(page.locator('h1').first()).toBeVisible();
    },
  },

  // Desktop, the student page on a Chromebook
  {
    name: 'student-page-card',
    project: 'desktop',
    sheets: STUDENT_PAGE,
    go: studentCard,
  },
  {
    name: 'student-page-assignments',
    project: 'desktop',
    sheets: STUDENT_PAGE,
    go: studentSignedIn,
  },

  // Phone, teacher-mobile/index.html
  {
    name: 'phone-students',
    project: 'phone',
    sheets: PHONE_APP,
    go: async page => {
      await phoneTab(page, 'students');
      await expect(page.locator('.m-card-stack-item[data-depth="0"]')).toBeVisible();
    },
  },
  {
    name: 'phone-student-detail',
    project: 'phone',
    sheets: PHONE_APP,
    go: async page => {
      await phoneTab(page, 'students');
      await page.locator('.m-card-stack-item[data-depth="0"] [data-action="m-student-detail"]').click();
      await expect(page.locator('#m-screen-student-detail #m-st-panel-comps')).toBeVisible();
    },
  },
  {
    name: 'phone-observe',
    project: 'phone',
    sheets: PHONE_APP,
    go: async page => {
      await phoneTab(page, 'observe');
      await expect(page.locator('[data-action="m-obs-new"]')).toBeVisible();
    },
  },
  {
    name: 'phone-new-observation',
    project: 'phone',
    sheets: PHONE_APP,
    go: async page => {
      await phoneTab(page, 'observe');
      await page.locator('[data-action="m-obs-new"]').click();
      await phoneSheet(page);
    },
  },
  {
    name: 'phone-grade-picker',
    project: 'phone',
    sheets: PHONE_APP,
    go: async page => {
      await phoneTab(page, 'grade');
      await expect(page.locator('text=Science Fair Proposal').first()).toBeVisible();
    },
  },
  {
    name: 'phone-grade-swiper',
    project: 'phone',
    sheets: PHONE_APP,
    go: phoneSwiper,
  },
  {
    name: 'phone-grade-filter',
    project: 'phone',
    sheets: PHONE_APP,
    go: async page => {
      await phoneTab(page, 'grade');
      await page.locator('[data-action="m-grade-filter-open"]').click();
      await phoneSheet(page);
    },
  },

  // Phone, the student page, s/index.html
  {
    name: 'student-page-card',
    project: 'phone',
    sheets: STUDENT_PAGE,
    go: studentCard,
  },
  {
    name: 'student-page-is-this-you',
    project: 'phone',
    sheets: STUDENT_PAGE,
    go: async page => {
      await studentCard(page);
      await press(page, 'Continue');
      await expect(page.getByRole('heading', { name: 'Is this you, Cece?' })).toBeVisible();
    },
  },
  {
    name: 'student-page-assignments',
    project: 'phone',
    sheets: STUDENT_PAGE,
    go: studentSignedIn,
  },
  {
    name: 'student-page-feedback',
    project: 'phone',
    sheets: STUDENT_PAGE,
    go: async page => {
      await studentSignedIn(page);
      await page.getByRole('button', { name: 'All assignments' }).tap();
      await page.locator('.sp-row', { hasText: 'Energy Transfer Investigation' }).tap();
      const piece = page.locator('.sp-piece.sp-picked');
      await expect(piece).toBeVisible();
      await piece.getByRole('button', { name: 'See Your Feedback' }).tap();
      await expect(page.getByRole('heading', { level: 1, name: 'Energy Transfer Investigation' })).toBeFocused();
    },
  },
  {
    name: 'student-page-my-learning',
    project: 'phone',
    sheets: STUDENT_PAGE,
    go: page => studentPageTab(page, 'My Learning'),
  },
  {
    name: 'student-page-questionnaires',
    project: 'phone',
    sheets: STUDENT_PAGE,
    go: page => studentPageTab(page, 'Questionnaires'),
  },
  {
    name: 'student-page-reports',
    project: 'phone',
    sheets: STUDENT_PAGE,
    go: page => studentPageTab(page, 'Reports'),
  },
];

/* ── The run ───────────────────────────────────────────────── */

const SHEET = process.env.VISUAL_SHEET || '';
const DEAD = process.env.VISUAL_DEAD ? JSON.parse(readFileSync(process.env.VISUAL_DEAD, 'utf-8')) : [];
if (!Array.isArray(DEAD)) throw new Error('VISUAL_DEAD must name a JSON file holding an array of selectors');

// The selectors that match on the page. A pseudo-element (::before,
// ::-webkit-scrollbar, :after) is checked by the element it hangs on, and a
// state no one is in during the picture (:hover, :focus) is dropped. A
// selector the browser can't read, or one that is only a pseudo-element, is
// listed too, so it never passes unseen.
function deadOnPage(page, selectors) {
  return page.evaluate(list => {
    const found = [];
    for (const sel of list) {
      const el = sel
        .replace(/::[\w-]+(\([^)]*\))?|:(before|after|first-line|first-letter)\b/g, '')
        .replace(/:(hover|active|focus-visible|focus-within|focus|visited|target)(?![\w-])/g, '')
        .trim();
      if (!el || /(^|,)\s*($|,)|[>+~]\s*($|,)/.test(el)) {
        found.push(sel + ' (only a pseudo-element: check it by hand)');
        continue;
      }
      try {
        const n = document.querySelectorAll(el).length;
        if (n) found.push(sel + ' (' + n + ' on the page)');
      } catch (e) {
        found.push(sel + ' (not a selector the browser reads)');
      }
    }
    return found;
  }, selectors);
}

for (const state of STATES) {
  if (SHEET && !state.sheets.includes(SHEET)) continue;
  test(state.project + ': ' + state.name, { tag: '@' + state.project }, async ({ page }) => {
    await page.clock.setFixedTime(NOW);
    await state.go(page);
    if (state.media) await page.emulateMedia({ media: state.media });
    await page.evaluate(() => document.fonts.ready);
    if (DEAD.length) {
      expect.soft(await deadOnPage(page, DEAD), 'selectors VISUAL_DEAD names that match on ' + state.name).toEqual([]);
    }
    await expect(page).toHaveScreenshot(state.name + '.png', {
      fullPage: true,
      mask: state.mask ? state.mask(page) : [],
    });
  });
}
