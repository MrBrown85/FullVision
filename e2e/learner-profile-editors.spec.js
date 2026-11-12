import { test, expect } from '@playwright/test';

/* The Learner Profile's competency goal and reflection editors (Nov 3
   sweep, step 4), in Demo Mode on Liam in Science 8, who has no goals or
   reflections yet. */

test.use({ viewport: { width: 1440, height: 900 } });

async function openStudent(page, first) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const sid = await page.evaluate(n => getStudents('sci8').find(s => s.firstName === n).id, first);
  await page.evaluate(r => window.Router.navigate(r), '/student?id=' + sid + '&course=sci8&tab=profile');
  await page.locator('.lp-layout').waitFor();
  // Competencies with no goal or reflection fold into one line; open it.
  await page.evaluate(() => document.querySelectorAll('details.gl-rest').forEach(d => (d.open = true)));
  return sid;
}

test('+ Reflection puts the cursor in the box, so typing lands there', async ({ page }) => {
  await openStudent(page, 'Liam');
  const row = page.locator('.gl-row').first();
  await row.getByRole('button', { name: '+ Reflection' }).click();
  await page.keyboard.type('I can plan a fair test now.');
  await expect(row.locator('textarea[id^="refl-input-"]')).toHaveValue('I can plan a fair test now.');
});

test("the reflection box's hint uses no pronoun, so it fits every student", async ({ page }) => {
  await openStudent(page, 'Liam');
  const box = page.locator('.gl-row').first().locator('textarea[id^="refl-input-"]');
  await expect(box).toHaveAttribute('placeholder', 'Liam’s own words about this competency…');
});

test('the goal box spans the row; Enter saves, Shift+Enter adds a line, Escape leaves it as it was', async ({
  page,
}) => {
  const sid = await openStudent(page, 'Liam');
  const row = page.locator('.gl-row').first();
  const secId = await row.locator('[data-action="editGoal"]').getAttribute('data-secid');
  await row.getByRole('button', { name: '+ Goal' }).click();
  const box = page.locator('#goal-input-' + secId);
  await expect(box).toBeFocused();
  const size = await box.boundingBox();
  const rowBox = await row.boundingBox();
  expect(size.width).toBeGreaterThan(rowBox.width * 0.6);
  expect(size.height).toBeGreaterThanOrEqual(70);
  await page.keyboard.type('Try a hypothesis with an if-then sentence.');
  const scroll = await box.evaluate(el => el.scrollHeight - el.clientHeight);
  expect(scroll).toBeLessThanOrEqual(1);

  // Escape closes it and nothing is saved.
  await page.keyboard.press('Escape');
  await expect(box).toBeHidden();
  const none = await page.evaluate(a => (getGoals('sci8')[a[0]] || {})[a[1]] || '', [sid, secId]);
  expect(none).toBe('');

  // Shift+Enter adds a line; Enter saves.
  await page.locator('[data-action="editGoal"][data-secid="' + secId + '"]').click();
  await expect(box).toHaveValue('');
  await page.keyboard.type('Plan a fair test.');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Change one thing.');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(a => (getGoals('sci8')[a[0]] || {})[a[1]], [sid, secId]))
    .toBe('Plan a fair test.\nChange one thing.');
});

test('Remove Goal takes a goal away with an Undo that puts it back', async ({ page }) => {
  const sid = await openStudent(page, 'Liam');
  const secId = await page.locator('.gl-row [data-action="editGoal"]').first().getAttribute('data-secid');
  const goal = () => page.evaluate(a => (getGoals('sci8')[a[0]] || {})[a[1]] || '', [sid, secId]);
  await page.locator('[data-action="editGoal"][data-secid="' + secId + '"]').click();
  await page.keyboard.type('Use if-then sentences.');
  await page.keyboard.press('Enter');
  await expect.poll(goal).toBe('Use if-then sentences.');

  // The editor of a set goal has Remove Goal; a new one doesn't.
  await page.locator('[data-action="editGoal"][data-secid="' + secId + '"]').click();
  const remove = page.locator('[data-action="removeGoal"][data-secid="' + secId + '"]');
  await expect(remove).toHaveText('Remove Goal');
  await remove.click();
  await expect.poll(goal).toBe('');
  const toast = page.locator('#undo-toast');
  await expect(toast).toContainText('Goal removed');
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(goal).toBe('Use if-then sentences.');
  await expect(page.locator('#goal-text-' + secId)).toHaveText('Use if-then sentences.');

  // Clearing the text and saving is a removal too, with the same Undo.
  await page.locator('[data-action="editGoal"][data-secid="' + secId + '"]').click();
  await page.locator('#goal-input-' + secId).fill('');
  await page.keyboard.press('Enter');
  await expect.poll(goal).toBe('');
  await expect(page.locator('#undo-toast')).toContainText('Goal removed');
});

// The tab shows one figure, its goals; the grey "Last answer" line went with
// the folder tabs (Colin, 2026-11-11).
test('a saved reflection counts on the ID card and in Reflections; the tab keeps its one figure', async ({ page }) => {
  await openStudent(page, 'Liam');
  await expect(page.locator('#stu-tab-profile .stu-tab-stat')).toHaveText(/^\d+ Goals?$/);
  const row = page.locator('.gl-row').first();
  await row.getByRole('button', { name: '+ Reflection' }).click();
  await page.keyboard.type('I can plan a fair test now.');
  await page.keyboard.press('Enter');
  await expect(page.locator('#lp-goals')).toContainText('I can plan a fair test now.');
  await expect(page.locator('#lp-refl .lp-none')).toHaveText(
    'No questionnaire reflections from Liam yet. 1 competency reflection is under Competency Goals.',
  );
  await expect(page.locator('#stu-tab-profile .stu-tab-stat')).toHaveText(/^\d+ Goals?$/);
  await expect(page.locator('#stu-tab-profile .stu-tab-sub')).toHaveCount(0);
});

test("Core Competencies in Cece's Words shows what she answered, without retyping", async ({ page }) => {
  await openStudent(page, 'Cece');
  await page.locator('#lp-core .seg-btn', { hasText: /1/ }).first().click();
  const row = name => page.locator('#lp-core .stu-core-trow', { hasText: name });
  await expect(row('Personal Awareness & Responsibility').locator('.stu-core-step.on')).toHaveAttribute(
    'data-step',
    'Growing',
  );
  await expect(row('Personal Awareness & Responsibility')).toContainText('I set goals but I forget to check on them.');
  await expect(row('Personal & Cultural Identity').locator('.stu-core-step.on')).toHaveAttribute(
    'data-step',
    'Confident',
  );
  await expect(row('Personal Awareness & Responsibility').locator('.stu-core-from')).toContainText('From Cece');
  await expect(row('Communicating').getByRole('button', { name: '+ Self-Assessment' })).toBeVisible();
});

test('the Core Competencies table fits inside its card at 1440 px', async ({ page }) => {
  await openStudent(page, 'Cece');
  const fit = await page.evaluate(() => {
    const panel = document.querySelector('.stu-panel').getBoundingClientRect();
    const rows = [...document.querySelectorAll('#lp-core .stu-core-trow')];
    return {
      over: rows.filter(r => r.scrollWidth > r.clientWidth + 1).length,
      right: Math.max(
        ...[...document.querySelectorAll('#lp-core .stu-core-work')].map(w => w.getBoundingClientRect().right),
      ),
      panelRight: panel.right,
    };
  });
  expect(fit.over).toBe(0);
  expect(fit.right).toBeLessThanOrEqual(fit.panelRight - 12);
});

test("the student's chosen self-assessment step is a solid colour block", async ({ page }) => {
  await openStudent(page, 'Cece');
  const on = page.locator('#lp-refl .stu-core-step.on').first();
  await expect(on).toHaveText('Growing');
  const look = await on.evaluate(el => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = 'var(--score-2)';
    document.body.appendChild(probe);
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { bg: cs.backgroundColor, color: cs.color, want };
  });
  expect(look.bg).toBe(look.want);
  expect(look.color).toBe('rgb(255, 255, 255)');
});

test('About Me turned off links straight to Class Settings › Questionnaires', async ({ page }) => {
  await openStudent(page, 'Liam');
  await page.evaluate(() => {
    const k = 'gb-questionnaires-sci8';
    const qs = JSON.parse(localStorage.getItem(k));
    qs.forEach(q => {
      if (q.kind === 'about_me') q.is_on = false;
    });
    localStorage.setItem(k, JSON.stringify(qs));
    Questionnaires._reset();
    window.PageStudent.render();
  });
  await page.locator('#lp-about').getByRole('link', { name: 'Class Settings › Questionnaires' }).click();
  // Class Settings keeps its own address (/dashboard?manage=…) once open.
  await expect(page).toHaveURL(/\/dashboard\?manage=questionnaires$/);
  await expect(page.locator('[role=tab][aria-selected=true]')).toContainText('Questionnaires');
});

// The profile reads Cece's answers from the seeded class. How each section
// draws them is pinned in tests/learner-profile.test.js; this checks the page
// is wired to them, that the older profile stays below, and the jump link.
test("Cece's answers reach the profile, laid out as the redesign's board", async ({ page }) => {
  await openStudent(page, 'Cece');
  const card = page.locator('.lp2-card');
  await expect(card.locator('.id-say strong')).toHaveText('SEE');
  await expect(page.locator('.id-private-text')).toContainText('My grandma is staying with us');
  await expect(page.locator('#lp-about')).toContainText('I ask a lot of questions');
  await expect(page.locator('#lp-goals .st').first()).toHaveText('Working On It');
  await expect(page.locator('#lp-refl .stu-core-step.on')).toHaveText(['Growing', 'Confident']);
  await expect(page.locator('#lp-dispositions .stu-profile-group h3')).toHaveText([
    'Learning Dispositions',
    'Relational and Identity',
  ]);
  await expect(page.locator('#lp-core .stu-core-table')).toBeVisible();
});

test('a student with no answers gets no private note, and the tab no badge', async ({ page }) => {
  await openStudent(page, 'Liam');
  await expect(page.locator('#lp-about')).toContainText('Liam hasn’t answered About Me yet.');
  await expect(page.locator('.id-private')).toHaveCount(0);
  await expect(page.locator('#stu-tab-profile .stu-tab-badge')).toHaveCount(0);
});
