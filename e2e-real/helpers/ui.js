/**
 * UI driver helpers — drive the production action handlers exactly the way
 * the user does. Every helper here calls window.DashClassManager.handleAction
 * (or the equivalent page module's handler) instead of synthesizing direct
 * RPC calls. That's the discipline: the test is only as honest as the code
 * path it exercises.
 */

/**
 * Open the class manager and click the "+ New" button. Polls for the button
 * inside a single evaluate so the swap between empty-state and data-loaded
 * sidebar renders doesn't leave us with a stale node.
 */
export async function openWizardFromClassManager(page) {
  await page.evaluate(() => window.DashClassManager.openClassManager());
  await page.evaluate(async () => {
    const dcm = window.DashClassManager;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const btn = document.querySelector('[data-action="cmStartCreate"]');
      if (btn) {
        dcm.handleAction('cmStartCreate', btn, null);
        return;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('cmStartCreate button never appeared');
  });
  await page.waitForFunction(
    () =>
      typeof CURRICULUM_INDEX !== 'undefined' && CURRICULUM_INDEX !== null && Object.keys(CURRICULUM_INDEX).length > 0,
    null,
    { timeout: 15_000 },
  );
  await page.evaluate(() => window.DashClassManager.renderClassManager());
  await page.waitForSelector('[data-action="cwSelectGrade"]', { timeout: 5000 });
}

export async function pickGrade(page, grade) {
  await page.evaluate(g => {
    const btn = document.querySelector(`[data-action="cwSelectGrade"][data-grade="${g}"]`);
    window.DashClassManager.handleAction('cwSelectGrade', btn, null);
  }, grade);
  await page.waitForSelector('[data-action="cwSelectSubject"]', { timeout: 5000 });
}

export async function pickSubject(page, subjectName) {
  await page.evaluate(name => {
    const btn = Array.from(document.querySelectorAll('[data-action="cwSelectSubject"]')).find(
      b => b.textContent.trim() === name,
    );
    if (!btn) throw new Error(`Subject not found: ${name}`);
    window.DashClassManager.handleAction('cwSelectSubject', btn, null);
  }, subjectName);
  await page.waitForSelector('[data-action="cwToggleCourse"]', { timeout: 5000 });
}

export async function toggleCurriculumTag(page, tag) {
  await page.evaluate(t => {
    const btn = document.querySelector(`[data-action="cwToggleCourse"][data-tag="${t}"]`);
    if (!btn) throw new Error(`Course not found: ${t}`);
    window.DashClassManager.handleAction('cwToggleCourse', btn, null);
  }, tag);
}

export async function wizardGoToStep(page, step) {
  if (step !== 2 && step !== 3) throw new Error('wizardGoToStep accepts 2 or 3');
  const action = step === 2 ? 'cwGoToStep2' : 'cwGoToStep3';
  await page.evaluate(a => {
    const btn = document.querySelector(`[data-action="${a}"]`);
    window.DashClassManager.handleAction(a, btn, null);
  }, action);
  await page.waitForSelector(step === 2 ? '#cm-new-name' : '[data-action="cwFinishCreate"]', { timeout: 5000 });
}

export async function setWizardClassName(page, name) {
  await page.fill('#cm-new-name', name);
}

export async function finishWizard(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-action="cwFinishCreate"]');
    window.DashClassManager.handleAction('cwFinishCreate', btn, null);
  });
  // The editor's categories field appears once the V2 dispatch has settled.
  await page.waitForSelector('[data-action="cmCatAdd"]', { timeout: 20_000 });
}

/**
 * Navigate to the assignments page and switch the active course. The
 * URL ?course= param is not honored by page-assignments init (it reads from
 * _activeCourse), so we drive the switch explicitly through the exposed
 * PageAssignments.switchCourse API.
 */
export async function openAssignmentForCourse(page, courseId) {
  await page.goto(`/teacher/app.html#/assignments`);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.PageAssignments !== undefined, null, { timeout: 15_000 });
  await page.evaluate(cid => window.PageAssignments.switchCourse(cid), courseId);
}

/**
 * Click "+ New Assessment" and wait for the form's category dropdown to
 * appear. Falls back to clicking the button manually if the auto-open path
 * (?new=1) didn't fire.
 */
export async function openNewAssessmentForm(page) {
  await page.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (document.getElementById('af-category')) return;
      const btn = document.querySelector('[data-action="showNewForm"]');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 200));
    }
  });
  await page.waitForSelector('#af-category', { timeout: 10_000 });
}
