/**
 * Changing class from each tab's class picker loads the other class's roster.
 *
 * On 2026-10-15 the sidebar picker did nothing on every tab but Dashboard:
 * its onchange="…" attribute was an inline handler, which the production
 * nonce CSP blocks (fixed in #154). The test server sends that same CSP
 * (scripts/e2e-server.mjs), so an inline handler fails here as it does live.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, gotoApp, TEST_LEARNING_MAP } from './helpers.js';

const CLASS_A = {
  id: 'a0000000-0000-4000-8000-00000000000a',
  name: 'Science 8 — Block A',
  students: [
    ['a0000000-0000-4000-8000-0000000000a1', 'Ada', 'Lovelace'],
    ['a0000000-0000-4000-8000-0000000000a2', 'Alan', 'Turing'],
  ],
};
const CLASS_B = {
  id: 'b0000000-0000-4000-8000-00000000000b',
  name: 'Science 8 — Block B',
  students: [
    ['b0000000-0000-4000-8000-0000000000b1', 'Grace', 'Hopper'],
    ['b0000000-0000-4000-8000-0000000000b2', 'Katherine', 'Johnson'],
  ],
};

/* Both classes go into the fake server (see mockAuth), Block A open. */
async function seedTwoClasses(page) {
  await page.addInitScript(
    ({ classes, learningMap }) => {
      const courses = {};
      classes.forEach(c => {
        courses[c.id] = {
          id: c.id,
          name: c.name,
          gradingSystem: 'proficiency',
          calcMethod: 'mostRecent',
          decayWeight: 0.65,
        };
        const students = c.students.map(([id, firstName, lastName]) => ({
          id,
          firstName,
          lastName,
          preferred: '',
          pronouns: '',
          studentNumber: '',
          email: '',
          dateOfBirth: '',
          designations: [],
          enrolledDate: '',
          attendance: [],
          sortName: lastName + ' ' + firstName,
        }));
        const assessments = [
          {
            id: c.id.slice(0, -1) + 'f',
            title: 'Lab 1',
            date: '2026-10-01',
            type: 'summative',
            tagIds: ['QAP'],
            scoreMode: 'proficiency',
            weight: 1,
          },
        ];
        localStorage.setItem('gb-students-' + c.id, JSON.stringify(students));
        localStorage.setItem('gb-assessments-' + c.id, JSON.stringify(assessments));
        localStorage.setItem('gb-learningMaps-' + c.id, JSON.stringify(learningMap));
      });
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: classes[0].id }));
    },
    { classes: [CLASS_A, CLASS_B], learningMap: TEST_LEARNING_MAP },
  );
}

// [tab, route, picker, where the roster shows]. Gradebook has its own picker
// and no sidebar; Student goes back to Dashboard on a switch.
const TABS = [
  ['Dashboard', '/dashboard', '#gb-course-select', '#gb-roster-list'],
  ['Assignments', '/assignments', '#gb-course-select', '#gb-roster-list'],
  ['Student', '/student?id=' + CLASS_A.students[0][0], '#gb-course-select', '#main'],
  ['Gradebook', '/gradebook', '.gb-course-select', '#main'],
  ['Observations', '/observations', '#gb-course-select', '#gb-roster-list'],
  ['Reports', '/reports', '#gb-course-select', '#gb-roster-list'],
];

test.describe('Class picker', () => {
  let cspViolations;

  test.beforeEach(async ({ page }) => {
    cspViolations = [];
    page.on('console', msg => {
      if (/Content Security Policy/i.test(msg.text())) cspViolations.push(msg.text());
    });
    await mockAuth(page);
    await seedTwoClasses(page);
  });

  test('the test server sends the production nonce CSP', async ({ page }) => {
    const response = await page.goto('/teacher/app.html#/dashboard');
    const csp = response.headers()['content-security-policy'] || '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[0-9a-f-]+'/);
    expect(csp.split(';').find(d => d.trim().startsWith('script-src'))).not.toContain('unsafe-inline');
  });

  for (const [tab, route, picker, roster] of TABS) {
    test(`switches the roster on ${tab}`, async ({ page }) => {
      await gotoApp(page, route);
      const region = page.locator(roster);
      await expect(region).toContainText('Lovelace', { timeout: 10_000 });

      await page.locator(picker).first().selectOption(CLASS_B.id);

      await expect(region).toContainText('Hopper', { timeout: 10_000 });
      await expect(region).toContainText('Johnson');
      await expect(region).not.toContainText('Lovelace');
      if (tab !== 'Student') await expect(page.locator(picker).first()).toHaveValue(CLASS_B.id);
      expect(
        await page.evaluate(() => (window.__e2eRpcLog || []).some(c => c.name === 'get_class_bundle')),
        'the class loads through get_class_bundle',
      ).toBe(true);
      expect(cspViolations, 'no CSP violations').toEqual([]);
    });
  }
});
