/**
 * The student page's five tabs: each shows its count for the term, the
 * keyboard moves between them, and each panel keeps the page's tools
 * (evidence drawer, override, goals). Demo Mode, Cece in Science 8.
 */
import { test, expect } from '@playwright/test';

async function openCece(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  const sid = await page.evaluate(() => getStudents(getActiveCourse()).find(s => s.firstName === 'Cece').id);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid);
  await page.locator('.stu-tabs').waitFor();
  return sid;
}

test('five tabs, Competencies first, and the arrow keys move between them', async ({ page }) => {
  await openCece(page);
  const tabs = page.getByRole('tab', {
    name: /Competencies|Assessments|Observations|Grade Breakdown|Learner Profile/,
  });
  await expect(page.locator('.stu-tab .stu-tab-label')).toHaveText([
    'Competencies',
    'Assessments',
    'Observations',
    'Grade Breakdown',
    'Learner Profile',
  ]);
  await expect(page.locator('#stu-tab-comps')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#stu-tab-comps .stu-tab-stat')).toHaveText('6 of 6 Proficient');
  await expect(tabs).toHaveCount(5);
  await page.locator('#stu-tab-comps').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#stu-tab-assess')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#stu-tab-assess')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#stu-tab-profile')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.stu-profile-group h3')).toHaveText(['Learning Dispositions', 'Relational and Identity']);
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

test('the tab counts follow the reporting term', async ({ page }) => {
  await openCece(page);
  const stat = page.locator('#stu-tab-assess .stu-tab-stat');
  const allTime = await stat.textContent();
  const select = page.locator('select.term-select');
  const terms = await select.locator('option').evaluateAll(os => os.map(o => o.value).filter(v => v !== 'all'));
  test.skip(!terms.length, 'Demo class has no reporting terms');
  await select.selectOption(terms[0]);
  await expect(stat).not.toHaveText(allTime);
  await expect(page.locator('#stu-tab-assess .stu-tab-sub')).not.toContainText('All time');
});

test('a Letter class shows percents, not proficiency words', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  const sid = await page.evaluate(() => {
    const cid = getActiveCourse();
    COURSES[cid].gradingSystem = 'letter';
    clearProfCache();
    return getStudents(cid).find(s => s.firstName === 'Cece').id;
  });
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid);
  await page.locator('.stu-tabs').waitFor();
  await expect(page.locator('#stu-tab-comps .stu-tab-stat')).toHaveText('6 of 6 Scored');
  await expect(page.locator('.stu-comp-level .stu-level').first()).toHaveText(/^\d+%$/);
});

test('the address names the tab, a reload keeps it, and a student opened with no tab gets the last one', async ({
  page,
}) => {
  const sid = await openCece(page);
  await page.locator('#stu-tab-breakdown').click();
  await expect(page).toHaveURL(/[?&]tab=breakdown/);
  await page.reload();
  await expect(page.locator('#stu-tab-breakdown')).toHaveAttribute('aria-selected', 'true');
  // No tab in the link: the one last opened on this device.
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid);
  await expect(page.locator('#stu-tab-breakdown')).toHaveAttribute('aria-selected', 'true');
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

test('Grade Breakdown shows each category with its share, and Group By groups the Assessments tab', async ({
  page,
}) => {
  await openCece(page);
  await page.locator('#stu-tab-breakdown').click();
  await expect(page.locator('#stu-tab-breakdown .stu-tab-stat')).toHaveText('3 Categories');
  await expect(page.locator('.stu-bd-cats .stu-bd-row:not(.stu-bd-head)')).toHaveCount(3);
  await page.locator('.stu-bd-cats [data-action="stuBdToggle"]').first().click();
  await expect(page.locator('.stu-bd-items .stu-bd-item')).toHaveCount(8);
  // Assignment Types comes first and opens on Timeline.
  await expect(page.locator('.stu-bd-section').first()).toHaveAttribute('aria-labelledby', 'stu-bd-types');
  await expect(page.locator('[data-action="stuTypeView"][data-view="timeline"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('.stu-chart-line')).toHaveCount(5);
  // Each section is its own card; the chart's points say what they are.
  await expect(page.locator('#stu-panel.stu-panel-cards > .stu-bd-section')).toHaveCount(4);
  await expect(page.locator('.stu-bar-key')).toContainText('Proficient');
  await page.locator('.stu-chart-dot').first().click();
  await expect(page.locator('.stu-chart-dot.show .stu-chart-tip')).toBeVisible();
  await expect(page.locator('.stu-rt-head').last()).toContainText('Start to Now');
  for (const view of ['growth', 'month', 'strengths']) {
    await page.locator('[data-action="stuTypeView"][data-view="' + view + '"]').click();
    await expect(page.locator('[data-action="stuTypeView"][data-view="' + view + '"]')).toHaveAttribute(
      'aria-checked',
      'true',
    );
  }
  await expect(page.locator('.stu-ts-row:not(.stu-ts-head)')).toHaveCount(5);
  await expect(page.locator('.stu-rt-picker .stu-chip.active')).toContainText('Rubric');
  await expect(page.locator('.stu-rt-row:not(.stu-rt-head)')).toHaveCount(3);

  await page.locator('#stu-tab-assess').click();
  await page.locator('[data-action="stuAssessGroup"][data-group="category"]').click();
  await expect(page.locator('.stu-agroup-head')).toHaveCount(3);
  await expect(page.locator('.stu-agroup-head').first()).toContainText('40% of the grade');
  await page.locator('.stu-agroup-head').first().click();
  await expect(page.locator('.stu-agroup').first().locator('.stu-assess-row')).toHaveCount(0);
});

// A view switch, a chip or a fold redraws the tab; the page stays where it
// was and the clicked control keeps the focus (Colin, 2026-10-24). Opening
// a category only adds rows under it, so nothing makes the browser clamp
// the scroll position.
test('Grade Breakdown buttons keep the scroll position and focus', async ({ page }) => {
  await openCece(page);
  await page.locator('#stu-tab-breakdown').click();
  const row = page.locator('.stu-bd-cats [data-action="stuBdToggle"]').last();
  await row.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const before = await page.evaluate(() => document.querySelector('.student-scroll').scrollTop);
  expect(before).toBeGreaterThan(100);
  await row.click();
  await expect(page.locator('.stu-bd-cats [data-action="stuBdToggle"]').last()).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(await page.evaluate(() => document.querySelector('.student-scroll').scrollTop)).toBe(before);
  expect(await page.evaluate(() => document.activeElement.dataset.action)).toBe('stuBdToggle');
  await page.locator('#stu-tab-assess').click();
  expect(await page.evaluate(() => document.querySelector('.student-scroll').scrollTop)).toBe(0);
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
