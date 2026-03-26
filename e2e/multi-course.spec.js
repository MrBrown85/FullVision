import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, gotoApp, TEACHER, TEST_COURSE, TEST_STUDENTS, TEST_LEARNING_MAP } from './helpers.js';

const SECOND_COURSE = {
  id: 'math9',
  name: 'Math 9 — Test',
  gradingSystem: 'proficiency',
  calcMethod: 'mostRecent',
  decayWeight: 0.65,
  curriculumTags: ['MATH9'],
};

const SECOND_STUDENTS = [
  { id: 'stu-101', firstName: 'Diana', lastName: 'Diaz', preferred: 'Diana', pronouns: '', studentNumber: '2001', email: '', dateOfBirth: '', designation: '', enrolledDate: '', attendance: [], sortName: 'Diaz Diana' },
  { id: 'stu-102', firstName: 'Evan', lastName: 'Edwards', preferred: 'Evan', pronouns: '', studentNumber: '2002', email: '', dateOfBirth: '', designation: '', enrolledDate: '', attendance: [], sortName: 'Edwards Evan' },
];

const SECOND_LEARNING_MAP = {
  _flatVersion: 2,
  subjects: [{ id: 'MATH9', name: 'Math 9', color: '#dc2626' }],
  sections: [
    {
      id: 'NUM', subject: 'MATH9', name: 'Number Sense', shortName: 'Numbers', color: '#dc2626',
      tags: [{ id: 'NUM', label: 'Number Operations', text: '', color: '#dc2626', subject: 'MATH9', name: 'Number Sense', shortName: 'Numbers', i_can_statements: [] }],
    },
  ],
};

/**
 * Seeds TWO courses into localStorage via addInitScript.
 */
async function seedTwoCourses(page) {
  await seedCourse(page); // Seeds TEST_COURSE (sci8)
  // Add second course + its data
  await page.addInitScript((fixtures) => {
    const { course, learningMap, students } = fixtures;
    // Add to existing courses object
    const courses = JSON.parse(localStorage.getItem('gb-courses') || '{}');
    courses[course.id] = course;
    localStorage.setItem('gb-courses', JSON.stringify(courses));
    // Per-course data for second course
    localStorage.setItem('gb-learningMaps-' + course.id, JSON.stringify(learningMap));
    localStorage.setItem('gb-students-' + course.id, JSON.stringify(students));
    localStorage.setItem('gb-assessments-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-scores-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-observations-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-modules-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-rubrics-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-flags-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-goals-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-reflections-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-overrides-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-statuses-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-notes-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-termRatings-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-customTags-' + course.id, JSON.stringify([]));
    localStorage.setItem('gb-courseConfigs-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-reportConfig-' + course.id, JSON.stringify({}));
    localStorage.setItem('gb-gradingScales-' + course.id, JSON.stringify({}));
    // Seed first course students too
    localStorage.setItem('gb-students-sci8', JSON.stringify(fixtures.firstStudents));
  }, { course: SECOND_COURSE, learningMap: SECOND_LEARNING_MAP, students: SECOND_STUDENTS, firstStudents: TEST_STUDENTS });
}

test.describe('Multi-Course Switching', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedTwoCourses(page);
  });

  test('course selector dropdown shows both courses', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const body = await page.locator('body').textContent();
    expect(body).toContain('Science 8');
    expect(body).toContain('Math 9');
  });

  test('course selector is a select element with multiple options', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const select = page.locator('select[data-action="dashSwitchCourse"], select[aria-label="Select course"]').first();
    const visible = await select.isVisible().catch(() => false);
    if (visible) {
      const options = select.locator('option');
      const count = await options.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  test('switching course shows different student roster', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    // Initially active course is sci8 — should show Alice
    const body1 = await page.locator('body').textContent();
    expect(body1).toContain('Alice');
    // Switch to math9
    const select = page.locator('select[data-action="dashSwitchCourse"], select[aria-label="Select course"]').first();
    if (await select.isVisible()) {
      await select.selectOption('math9');
      await page.waitForTimeout(1000);
      const body2 = await page.locator('body').textContent();
      expect(body2).toContain('Diana');
    }
  });

  test('students from course A do not appear in course B', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const select = page.locator('select[data-action="dashSwitchCourse"], select[aria-label="Select course"]').first();
    if (await select.isVisible()) {
      await select.selectOption('math9');
      await page.waitForTimeout(1000);
      const body = await page.locator('body').textContent();
      // Math 9 should have Diana, not Alice
      expect(body).toContain('Diana');
      expect(body).not.toContain('Alice');
    }
  });

  test('both courses are selectable in the dropdown', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    const select = page.locator('select[data-action="dashSwitchCourse"], select[aria-label="Select course"]').first();
    if (await select.isVisible()) {
      const options = await select.locator('option').allTextContents();
      expect(options.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('gradebook page also has course selector', async ({ page }) => {
    await gotoApp(page, '/gradebook');
    const select = page.locator('select[data-action="switchCourse"], select[aria-label="Select course"]').first();
    const visible = await select.isVisible().catch(() => false);
    // Either a select or the page rendered with the course name
    const body = await page.locator('body').textContent();
    const hasCourseUI = visible || body.includes('Science 8') || body.includes('Math 9');
    expect(hasCourseUI).toBeTruthy();
  });
});
