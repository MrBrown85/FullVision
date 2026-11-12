/**
 * Pins what the phone's Grade tab does today, before any split of
 * teacher-mobile/tab-grade.js. Demo Mode, Science 8, 375 x 667: a level, +
 * and clear on one competency; Missing, Excused and Late on one student;
 * Complete and Incomplete; the Set To toast's Undo; an Overall Comment and
 * a criterion comment kept after a reload; and a level and a status set on
 * the phone shown in the desktop gradebook. Tests only.
 */
import { test, expect } from '@playwright/test';
import { gotoApp, clickAction, getText } from './helpers.js';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const LAB_SKILLS = 'sci8a10'; // Mid-Year Lab Skills Check: two competencies, no rubric
const HUNT = 'sci8a13'; // Periodic Table Scavenger Hunt: Complete/Incomplete
const PROPOSAL = 'sci8a20'; // Science Fair Proposal: a rubric
const CELL_LAB = 'sci8a1'; // Cell Microscope Lab: takes student work

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('#m-loading')).toBeHidden();
}

// The Grade tab, All, then one piece of work. Returns the first card.
async function openWork(page, aid) {
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + aid + '"]').click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  return page.locator('.m-swiper-card').first();
}

const entries = (page, sid, aid) =>
  page.evaluate(
    ({ sid, aid }) =>
      (getScores('sci8')[sid] || [])
        .filter(e => e.assessmentId === aid)
        .map(e => ({ tagId: e.tagId, score: e.score, mod: e.mod || 0 })),
    { sid, aid },
  );
const status = (page, sid, aid) => page.evaluate(({ sid, aid }) => getAssignmentStatus('sci8', sid, aid), { sid, aid });
const row = (card, tid) => card.locator('.m-score-group', { has: card.page().locator('[data-tid="' + tid + '"]') });

test('a level, then +, then the same level again clears it', async ({ page }) => {
  await enterDemo(page);
  const card = await openWork(page, LAB_SKILLS);
  const sid = await card.getAttribute('data-sid');
  const pc3 = row(card, 'PC3');
  await expect(pc3.locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('3');

  await pc3.locator('.m-score-btn[data-score="2"]').click();
  await expect(pc3.locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('2');
  expect((await entries(page, sid, LAB_SKILLS)).find(e => e.tagId === 'PC3')).toMatchObject({ score: 2, mod: 0 });

  const plus = pc3.locator('.m-mod-btn[data-mod="1"]');
  await plus.click();
  await expect(plus).toHaveClass(/m-mod-active/);
  await expect(plus).toHaveAttribute('aria-pressed', 'true');
  expect((await entries(page, sid, LAB_SKILLS)).find(e => e.tagId === 'PC3')).toMatchObject({ score: 2, mod: 1 });

  await pc3.locator('.m-score-btn[data-score="2"]').click();
  await expect(pc3.locator('.m-score-btn.m-score-active')).toHaveCount(0);
  await expect(pc3.locator('.m-mod-btn.m-mod-active')).toHaveCount(0);
  const pc3After = (await entries(page, sid, LAB_SKILLS)).filter(e => e.tagId === 'PC3');
  expect(pc3After.every(e => !(e.score > 0))).toBe(true);
  // The other competency keeps its level.
  await expect(row(card, 'PC4').locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('3');
});

test('Missing, Excused and Late on one student, and when Missing and Excused are greyed out', async ({ page }) => {
  await enterDemo(page);
  const card = await openWork(page, LAB_SKILLS);
  const sid = await card.getAttribute('data-sid');
  const pill = val => card.locator('.m-status-pill[data-val="' + val + '"]');
  const hint = card.locator('.m-status-hint');
  const surface = card.locator('.m-grade-card-surface');

  // Scored work: Missing and Excused are greyed out and the hint says why.
  await expect(pill('NS')).toBeDisabled();
  await expect(pill('EXC')).toBeDisabled();
  await expect(pill('LATE')).toBeEnabled();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Clear the score and comment to mark Missing or Excused.');

  // Late goes on scored work and leaves the levels live.
  await pill('LATE').click();
  await expect(pill('LATE')).toHaveClass(/m-status-active/);
  await expect(surface).not.toHaveClass(/m-card-status-disabled/);
  expect(await status(page, sid, LAB_SKILLS)).toBe('LATE');
  await pill('LATE').click();
  await expect(pill('LATE')).not.toHaveClass(/m-status-active/);
  expect(await status(page, sid, LAB_SKILLS)).toBe(null);

  // Clearing both levels frees Missing and Excused.
  await row(card, 'PC3').locator('.m-score-btn.m-score-active').click();
  await expect(pill('NS')).toBeDisabled();
  await row(card, 'PC4').locator('.m-score-btn.m-score-active').click();
  await expect(pill('NS')).toBeEnabled();
  await expect(pill('EXC')).toBeEnabled();
  await expect(hint).toBeHidden();

  await pill('NS').click();
  await expect(pill('NS')).toHaveClass(/m-status-active/);
  await expect(surface).toHaveClass(/m-card-status-disabled/);
  expect(await status(page, sid, LAB_SKILLS)).toBe('NS');

  // Excused replaces Missing.
  await pill('EXC').click();
  await expect(pill('EXC')).toHaveClass(/m-status-active/);
  await expect(pill('NS')).not.toHaveClass(/m-status-active/);
  await expect(surface).toHaveClass(/m-card-status-disabled/);
  expect(await status(page, sid, LAB_SKILLS)).toBe('EXC');

  // Late replaces Excused and the card is live again.
  await pill('LATE').click();
  await expect(card.locator('.m-status-pill.m-status-active')).toHaveText('Late');
  await expect(surface).not.toHaveClass(/m-card-status-disabled/);
  expect(await status(page, sid, LAB_SKILLS)).toBe('LATE');

  // Tapping the chosen status again takes it off.
  await pill('LATE').click();
  await expect(card.locator('.m-status-pill.m-status-active')).toHaveCount(0);
  expect(await status(page, sid, LAB_SKILLS)).toBe(null);
});

test('Complete and Incomplete, and the chosen mark tapped again clears it', async ({ page }) => {
  await enterDemo(page);
  const card = await openWork(page, HUNT);
  const sid = await card.getAttribute('data-sid');
  const mark = () => page.evaluate(({ sid, aid }) => getCompletionMark('sci8', sid, aid), { sid, aid: HUNT });
  const btn = m => card.locator('.m-cmp-btn[data-mark="' + m + '"]');
  await expect(btn('complete')).toHaveText('✓ Complete');
  await expect(btn('incomplete')).toHaveText('✗ Incomplete');
  await expect(btn('complete')).toHaveClass(/m-cmp-active/);
  expect(await mark()).toBe('complete');

  await btn('incomplete').click();
  await expect(btn('incomplete')).toHaveClass(/m-cmp-active/);
  await expect(btn('complete')).not.toHaveClass(/m-cmp-active/);
  expect(await mark()).toBe('incomplete');

  await btn('complete').click();
  await expect(btn('complete')).toHaveClass(/m-cmp-active/);
  expect(await mark()).toBe('complete');

  await btn('complete').click();
  await expect(card.locator('.m-cmp-btn.m-cmp-active')).toHaveCount(0);
  expect(await mark()).toBe(null);
});

test('Set To on a not-in card, then the toast Undo takes the levels back off', async ({ page }) => {
  await enterDemo(page);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // As e2e/mobile-add-work.spec.js does: the student page is on, so the
  // Lab takes work, and one student who sent nothing has no grade.
  const sid = await page.evaluate(LAB => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.id === LAB);
    const sentNothing = getStudents(cid)
      .map(s => s.id)
      .filter(id => !getStudentSubmission(cid, id, LAB));
    sentNothing.forEach(id => {
      const keys = [...new Set((getScores(cid)[id] || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
      Grader.setOverallComment(cid, id, LAB, '');
      getRubricCheckIds(cid, id, LAB).forEach(t => Grader.setTick(cid, id, LAB, t, false));
      if (keys.length) Grader.clearScore(cid, getScores(cid), id, a, keys);
    });
    getStudents(cid).forEach(s => {
      if (groupWorkIn(cid, s.id, 'sci8a21')) Grader.setOverallComment(cid, s.id, 'sci8a21', 'Seen.');
    });
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    return sentNothing[0];
  }, CELL_LAB);
  await page.reload();
  await expect(page.locator('#m-loading')).toBeHidden();
  await openWork(page, CELL_LAB);
  await page.locator('#m-thumb-strip .m-thumb[data-sid="' + sid + '"]').click();
  const card = page.locator('.m-swiper-card[data-sid="' + sid + '"]');
  const first = await page.evaluate(sid => displayNameFirst(getStudents('sci8').find(s => s.id === sid)), sid);
  const levels = () =>
    page.evaluate(
      ({ sid, LAB }) =>
        (getScores('sci8')[sid] || []).filter(e => e.assessmentId === LAB && e.score > 0).map(e => e.score),
      { sid, LAB: CELL_LAB },
    );
  expect(await levels()).toEqual([]);

  const setTo = card.locator('[data-action="m-work-setto-menu"]');
  await setTo.scrollIntoViewIfNeeded();
  await setTo.click();
  await page.locator('#m-sheet-container .m-setto-menu [data-action="m-work-setto"][data-level="3"]').click();
  await expect(page.locator('#m-toast .m-toast-undo')).toHaveText('Undo');
  expect(await getText(page, '#m-toast .m-toast-item span')).toBe(first + ' set to Proficient');
  const set = await levels();
  expect(set.length).toBeGreaterThan(0);
  expect(set.every(l => l === 3)).toBe(true);

  // Once the paper mark is kept, the card says so and shows the levels.
  await expect(card.locator('.m-work-sent')).toHaveText('Handed in on paper');
  await expect(card.locator('.m-score-btn.m-score-active').first()).toBeVisible();

  await clickAction(page, 'm-toast-undo');
  await expect(page.locator('#m-toast .m-toast-item')).toHaveCount(0);
  expect(await levels()).toEqual([]);
  await expect(card.locator('.m-score-btn.m-score-active')).toHaveCount(0);
});

test('an Overall Comment and a criterion comment are kept after a reload', async ({ page }) => {
  await enterDemo(page);
  let card = await openWork(page, LAB_SKILLS);
  const sid = await card.getAttribute('data-sid');
  const overall = () => page.locator('.m-swiper-card[data-sid="' + sid + '"] .m-overall-comment');
  await overall().fill('Steady work on the unit conversions.');
  await overall().blur();
  expect(await page.evaluate(({ sid, aid }) => getScoreComment('sci8', sid, aid), { sid, aid: LAB_SKILLS })).toBe(
    'Steady work on the unit conversions.',
  );

  await page.locator('#m-nav-bar-grade-swiper [data-action="m-back"]').click();
  card = await openWork(page, PROPOSAL);
  const psid = await card.getAttribute('data-sid');
  const crit = () => page.locator('.m-swiper-card[data-sid="' + psid + '"] .m-crit-group').nth(1);
  await crit().getByRole('button', { name: 'Comment' }).click();
  await crit().locator('.m-crit-comment').fill('Name the variable you change.');
  await crit().locator('.m-crit-comment').blur();

  await page.reload();
  await expect(page.locator('#m-loading')).toBeHidden();
  await openWork(page, LAB_SKILLS);
  await expect(overall()).toHaveValue('Steady work on the unit conversions.');
  await page.locator('#m-nav-bar-grade-swiper [data-action="m-back"]').click();
  await openWork(page, PROPOSAL);
  await expect(crit().locator('.m-crit-comment')).toBeVisible();
  await expect(crit().locator('.m-crit-comment')).toHaveValue('Name the variable you change.');
  const saved = await page.evaluate(
    ({ sid, aid }) => {
      const a = getAssessments('sci8').find(x => x.id === aid);
      return getRubricCriterionComment('sci8', sid, aid, getRubricById('sci8', a.rubricId).criteria[1]);
    },
    { sid: psid, aid: PROPOSAL },
  );
  expect(saved).toBe('Name the variable you change.');
});

test('a level and Late set on the phone show in the desktop gradebook', async ({ page }) => {
  await enterDemo(page);
  const card = await openWork(page, LAB_SKILLS);
  const sid = await card.getAttribute('data-sid');
  await row(card, 'PC3').locator('.m-score-btn[data-score="1"]').click();
  await row(card, 'PC4').locator('.m-score-btn[data-score="1"]').click();
  await card.locator('.m-status-pill[data-val="LATE"]').click();
  await expect(card.locator('.m-status-pill[data-val="LATE"]')).toHaveClass(/m-status-active/);

  const desktop = await page.context().newPage();
  await desktop.setViewportSize({ width: 1400, height: 900 });
  await gotoApp(desktop, '/gradebook?course=sci8');
  const cell = desktop.locator('td[data-sid="' + sid + '"][data-aid="' + LAB_SKILLS + '"]');
  // The level, then Late's small L.
  await expect(cell.locator('.gb-scores-val')).toHaveText('1.0L');
  await expect(cell.locator('.gb-late')).toHaveText('L');
  await expect(cell).toHaveAttribute('aria-label', /: 1\.0, Emerging, Late$/);
});
