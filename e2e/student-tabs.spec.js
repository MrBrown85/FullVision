/**
 * The student page's five tabs: each shows its count for the term, the
 * keyboard moves between them, and each panel keeps the page's tools
 * (evidence drawer, override, goals). Demo Mode, Cece in Science 8.
 */
import { test, expect } from '@playwright/test';

async function openCece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&tab=comps');
  await page.locator('.stu-tabs').waitFor();
  return sid;
}

test('five tabs, Overview first, and the arrow keys move between them', async ({ page }) => {
  await openCece(page);
  const tabs = page.getByRole('tab', {
    name: /Overview|Competencies|Grades|Observations|Learner Profile/,
  });
  // Grades replaced Assessments and Grade Breakdown (redesign R5), for every class.
  await expect(page.locator('.stu-tab .stu-tab-label')).toHaveText([
    'Overview',
    'Competencies',
    'Grades',
    'Observations',
    'Learner Profile',
  ]);
  await expect(page.locator('#stu-tab-comps')).toHaveAttribute('aria-selected', 'true');
  // Cece is Proficient or above on all 24 of her scored competencies; three
  // of the 27 have no work yet.
  await expect(page.locator('#stu-tab-comps .stu-tab-stat')).toHaveText('27 of 27 Proficient');
  await expect(tabs).toHaveCount(5);
  await page.locator('#stu-tab-comps').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#stu-tab-grades')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#stu-tab-grades')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#stu-tab-profile')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.stu-profile-group h3')).toHaveText(['Learning Dispositions', 'Relational and Identity']);
});

test('a student page with no tab named opens on the Overview', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid);
  await expect(page.locator('#stu-tab-overview')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.stu-ov-title')).toHaveText('Cece’s Overview');
  await expect(page.locator('.stu-ov-all .stu-ov-row').first()).toBeVisible();
});

test('a competency row opens its evidence and the override', async ({ page }) => {
  await openCece(page);
  const comp = page.locator('.stu-comp').first();
  await expect(comp.locator('.stu-comp-override')).toBeHidden();
  await comp.locator('.stu-comp-row').click();
  await expect(comp.locator('.ced')).toBeVisible();
  await comp.getByRole('button', { name: 'Override Proficiency' }).click();
  await expect(comp.locator('.override-panel')).toBeVisible();
});

test('a competency goal saves from the Learner Profile', async ({ page }) => {
  const sid = await openCece(page);
  await page.locator('#stu-tab-profile').click();
  // Cece's own two goals (About Me and the Goal Check-In) are in the count.
  await expect(page.locator('#stu-tab-profile .stu-tab-stat')).toHaveText('2 Goals');
  // Competencies with no goal yet fold into one line; open it.
  await page.locator('details.gl-rest > summary').click();
  const row = page.locator('.gl-row').first();
  await row.getByRole('button', { name: '+ Goal' }).click();
  await row.locator('textarea').first().fill('Write a testable question before each lab');
  await row.getByRole('button', { name: 'Save' }).first().click();
  const card = page.locator('#lp-goals .gl-card', { hasText: 'Write a testable question before each lab' });
  await expect(card).toContainText('Set by you');
  await expect(page.locator('#stu-tab-profile .stu-tab-stat')).toHaveText('3 Goals');
  const saved = await page.evaluate(id => Object.values(getGoals(getActiveCourse())[id] || {}), sid);
  expect(saved).toContain('Write a testable question before each lab');
});

test('the student page has no term picker and counts the year so far', async ({ page }) => {
  await openCece(page);
  await expect(page.locator('select.term-select')).toHaveCount(0);
  const n = await page.evaluate(() => getAssessments(getActiveCourse()).length);
  await expect(page.locator('#stu-tab-grades .stu-tab-sub')).toContainText(/all time/i);
  expect(n).toBeGreaterThan(0);
});

test('a Letter class shows percents, not proficiency words', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(() => {
    const cid = getActiveCourse();
    COURSES[cid].gradingSystem = 'letter';
    clearProfCache();
    return getStudents(cid).find(s => s.firstName === 'Cece').id;
  });
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&tab=comps');
  await page.locator('.stu-tabs').waitFor();
  await expect(page.locator('#stu-tab-comps .stu-tab-stat')).toHaveText('27 of 27 Scored');
  await expect(page.locator('.stu-comp-level .stu-level').first()).toHaveText(/^\d+%$/);
});

test('the address names the tab, a reload keeps it, and a student opened with no tab gets the last one', async ({
  page,
}) => {
  const sid = await openCece(page);
  await page.locator('#stu-tab-evidence').click();
  await expect(page).toHaveURL(/[?&]tab=evidence/);
  await page.reload();
  await expect(page.locator('#stu-tab-evidence')).toHaveAttribute('aria-selected', 'true');
  // No tab in the link: the one last opened on this device.
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid);
  await expect(page.locator('#stu-tab-evidence')).toHaveAttribute('aria-selected', 'true');
  // Old links to Assessments and Grade Breakdown open Grades.
  for (const old of ['assess', 'breakdown']) {
    await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&tab=' + old);
    await expect(page.locator('#stu-tab-grades')).toHaveAttribute('aria-selected', 'true');
  }
  // An old link to Goals and Reflections opens the Learner Profile.
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&tab=goals');
  await expect(page.locator('#stu-tab-profile')).toHaveAttribute('aria-selected', 'true');
});

test('‹ › go to the next student in roster order and keep the tab', async ({ page }) => {
  await openCece(page);
  await page.locator('#stu-tab-evidence').click();
  const order = await page.evaluate(() => sortStudents(getStudents(getActiveCourse()), 'lastName').map(s => s.id));
  const here = await page.evaluate(() => new URLSearchParams(location.search).get('id'));
  const next = order[order.indexOf(here) + 1];
  await page.getByRole('button', { name: /^Next student/ }).click();
  await expect(page).toHaveURL(new RegExp('id=' + next + '&.*tab=evidence'));
  await expect(page.locator('#stu-tab-evidence')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /^Previous student/ }).click();
  await expect(page).toHaveURL(new RegExp('id=' + here + '&'));
});

test('the dashboard opens the tab that matches where the teacher clicked', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  const card = page.locator('.dash-card').first();
  await card.locator('.dash-card-strip').click();
  await expect(page.locator('#stu-tab-comps')).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await page.locator('.dash-card').first().locator('.dash-card-obs').click();
  await expect(page.locator('#stu-tab-evidence')).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await page.locator('.dash-ob2-name').first().click();
  await expect(page.locator('#stu-tab-evidence')).toHaveAttribute('aria-selected', 'true');
});

// The Competencies tab's rows already show each competency; the separate
// Competency Profile list under them was a repeat (Colin, 2026-10-22), and
// the page no longer asks the server for it.
test('the Competencies tab has no Competency Profile list', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(() => {
    window.__profileCalls = 0;
    window.v2.getStudentProfile = function () {
      window.__profileCalls++;
      return Promise.resolve({
        data: {
          competency_tree: {
            subjects: [{ name: 'Science 8', sections: [{ name: 'Questioning', tags: [{ code: 'QAP', label: 'Q' }] }] }],
          },
        },
      });
    };
    return getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id;
  });
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&tab=comps');
  await expect(page.locator('#stu-tab-comps')).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(300);
  await expect(page.getByText('Competency Profile')).toHaveCount(0);
  expect(await page.evaluate(() => window.__profileCalls)).toBe(0);
});

test('Grades builds the course grade by category, and Group By groups the work', async ({ page }) => {
  await openCece(page);
  await page.locator('#stu-tab-grades').click();
  await expect(page.locator('#stu-tab-grades .stu-tab-stat')).toHaveText(/ · 3 Categories$/);
  await expect(page.locator('.stu-gr-seg')).toHaveCount(3);
  await expect(page.locator('.stu-gr-group')).toHaveCount(3);
  await expect(page.locator('.stu-gr-group-meta').first()).toContainText('40% of the grade');
  // Labs & Investigations: 8 labs, and the sample's Light Refraction Lab (ruling 115), not graded yet.
  await expect(page.locator('.stu-gr-group').first().locator('.stu-ov-row')).toHaveCount(9);
  // Class averages stay off until turned on.
  await expect(page.locator('.stu-gr-class')).toHaveCount(0);
  await page.locator('[data-action="stuGrClass"]').click();
  await expect(page.locator('.stu-gr-class')).toHaveCount(3);
  await expect(page.locator('[data-action="stuGrClass"]')).toBeChecked();
  for (const g of ['module', 'type', 'rubric', 'date']) {
    await page.locator('[data-action="stuGrGroup"][data-group="' + g + '"]').click();
    await expect(page.locator('[data-action="stuGrGroup"][data-group="' + g + '"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('[data-action="stuGrGroup"][data-group="' + g + '"]')).toBeFocused();
  }
});

// A view switch or a chip redraws the tab; the page stays where it was and
// the clicked control keeps the focus (Colin, 2026-10-24).
test('Grades buttons keep the scroll position and focus', async ({ page }) => {
  await openCece(page);
  await page.locator('#stu-tab-grades').click();
  const chip = page.locator('[data-action="stuGrFilter"][data-filter="marked"]');
  await page.evaluate(() => document.querySelector('.student-scroll').scrollTo(0, 200));
  const before = await page.evaluate(() => document.querySelector('.student-scroll').scrollTop);
  expect(before).toBeGreaterThan(100);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.querySelector('.student-scroll').scrollTop)).toBe(before);
  expect(await page.evaluate(() => document.activeElement.dataset.filter)).toBe('marked');
});

// The header is one line: the full name, then pronouns, student number and
// birthday; a click on the student number copies it (Colin, 2026-10-24).
test('the header shows one line of facts and copies the student number', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCece(page);
  const header = page.locator('.student-header-top');
  await expect(header.locator('.student-name-xl')).toHaveText('Cece Adeyemi');
  await expect(header.locator('.sh-meta')).toContainText('STU-201');
  await expect(header).not.toContainText('Born');
  await expect(header).not.toContainText('complete');
  await expect(header).not.toContainText('Attendance');
  await header.locator('[data-action="copy-student-field"]').click();
  await expect(header.locator('[data-action="copy-student-field"]')).toHaveText('Copied!');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('STU-201');
});

test("a shared rubric's criterion Average counts each assessment's Factor", async ({ page }) => {
  const sid = await openCece(page);
  // The rubric shared by the most of Cece's assessments, its first criterion
  // scored on at least two of them; the newest of those counts 4 times.
  const expected = await page.evaluate(sid => {
    const cid = getActiveCourse();
    const byRubric = {};
    getAssessments(cid)
      .filter(a => a.rubricId)
      .forEach(a => (byRubric[a.rubricId] = (byRubric[a.rubricId] || []).concat(a)));
    for (const [rid, list] of Object.entries(byRubric)) {
      const crit = getRubricById(cid, rid).criteria[0];
      const scored = list.filter(a => rubricCriterionLevel(cid, sid, a, crit) != null);
      if (scored.length < 2) continue;
      const newest = scored
        .slice()
        .sort((x, y) => (x.date || '').localeCompare(y.date || ''))
        .pop();
      saveAssessments(
        cid,
        getAssessments(cid).map(a => (a.id === newest.id ? { ...a, weight: 4 } : a)),
      );
      let sum = 0;
      let total = 0;
      scored.forEach(a => {
        const f = a.id === newest.id ? 4 : getAssessmentWeight(a);
        sum += f * rubricCriterionLevel(cid, sid, a, crit);
        total += f;
      });
      return { rubric: getRubricById(cid, rid).name, crit: crit.name, avg: formatLevel(cid, sum / total) };
    }
    return null;
  }, sid);
  expect(expected).not.toBeNull();
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&tab=comps');
  await page.locator('#stu-tab-grades').click();
  await page.locator('[data-action="stuGrGroup"][data-group="rubric"]').click();
  const group = page.locator('.stu-gr-rubric-group', {
    has: page.locator('.stu-gr-group-name', { hasText: expected.rubric }),
  });
  const row = group.locator('.stu-rt-row:not(.stu-rt-head)', { hasText: expected.crit }).first();
  await expect(row.locator('.stu-rt-avg')).toHaveText(expected.avg);
});
