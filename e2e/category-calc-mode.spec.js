import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp, TEST_ASSESSMENT } from './helpers.js';

// A category set to Average of Percentages counts each assessment once:
// 9/10 and 18/36 is (90 + 50) / 2 = 70%, where Total Points pools them to
// 27/46 = 58.7%. The gradebook's course grade follows the category's
// Calculation (docs/DECISIONS.md, "Category calculation").
const QUIZ = {
  ...TEST_ASSESSMENT,
  id: 'a-quiz',
  title: 'Quiz',
  tagIds: ['QAP'],
  scoreMode: 'points',
  maxPoints: 10,
  categoryId: 'k1',
};
const UNIT = {
  ...TEST_ASSESSMENT,
  id: 'a-unit',
  title: 'Unit Test',
  tagIds: ['PI'],
  scoreMode: 'points',
  maxPoints: 36,
  categoryId: 'k1',
};

test("the gradebook's course % follows the category's Calculation", async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [QUIZ, UNIT]);
  await gotoApp(page, '/gradebook');

  const setMode = mode =>
    page.evaluate(
      ({ mode }) => {
        var cid = getActiveCourse();
        COURSES[cid].gradingSystem = 'letter';
        var cc = getCourseConfig(cid);
        cc.gradingSystem = 'letter';
        cc.roundPercent = false;
        _persistLoadedField(cid, 'courseConfigs', cc);
        _persistLoadedField(cid, 'categories', [
          { id: 'k1', name: 'Tests & Quizzes', weight: 100, displayOrder: 0, calcMode: mode },
        ]);
        setPointsScore(cid, 'stu-001', 'a-quiz', 9);
        setPointsScore(cid, 'stu-001', 'a-unit', 18);
        clearProfCache();
        PageGradebook.render();
      },
      { mode },
    );
  const overall = page.locator('a.gb-grid-rowhead-name[data-sid="stu-001"] ~ .gb-grid-rowhead-grade');

  await setMode('points');
  await expect(overall).toContainText('58.7%');

  await setMode('percent');
  await expect(overall).toContainText('C+ 70%');
});
