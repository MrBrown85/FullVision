import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers.js';

/* Signed in, the score writers read a piece of work as the page holds it,
   not as the class load sent it. With the load's row, signed in: grading
   one member of a group filled nobody else; a competency added since the
   load, and each competency of a points piece made proficiency, went up as
   the piece's overall score; a points piece given a rubric sent its
   criterion as the overall score. Demo Mode has always read the page's row.

   Signed in, every id is server-shaped (UUIDs), so every write is sent as
   it is live; ids like stu-001 send no score calls at all. Edits are made
   as the assessment form saves them (the stored row changed in place, the
   field cleared set to undefined, the list saved). Run with TZ=UTC. Tests
   only. */

test.use({ viewport: { width: 1440, height: 900 } });

const CID = 'c0000000-0000-4000-8000-0000000000e1';
const S = [1, 2, 3, 4, 5].map(n => '50000000-0000-4000-8000-00000000000' + n);
const NAMES = ['Ann Adams', 'Ben Brown', 'Cal Cole', 'Dee Diaz', 'Eve Ellis'];
const T1 = 'a0000000-0000-4000-8000-0000000000e1';
const T2 = 'a0000000-0000-4000-8000-0000000000e2';
const RUBRIC = 'd0000000-0000-4000-8000-0000000000e1';
const CRIT = 'd0000000-0000-4000-8000-0000000000e2';
const GROUP = 'b0000000-0000-4000-8000-0000000000e1'; // Ann, Ben and Cal; Dee alone
const NO_GROUPS = 'b0000000-0000-4000-8000-0000000000e2'; // group work with no groups saved
const ADD = 'b0000000-0000-4000-8000-0000000000e3';
const POINTS = 'b0000000-0000-4000-8000-0000000000e4';
const POINTS_RUBRIC = 'b0000000-0000-4000-8000-0000000000e5';
const PLAIN = 'b0000000-0000-4000-8000-0000000000e6';

function piece(id, title, extra) {
  return Object.assign(
    {
      id,
      title,
      date: '2026-10-01',
      type: 'summative',
      tagIds: [T1],
      collaboration: 'individual',
      created: '2026-10-01T00:00:00.000Z',
    },
    extra,
  );
}
const PIECES = [
  piece(GROUP, 'Group Lab', { collaboration: 'group', groups: [[S[0], S[1], S[2]], [S[3]]], groupCount: 2 }),
  piece(NO_GROUPS, 'Groups Not Made', { collaboration: 'group' }),
  piece(ADD, 'Add a Competency'),
  piece(POINTS, 'Points Quiz', { scoreMode: 'points', maxPoints: 10 }),
  piece(POINTS_RUBRIC, 'Points Lab', { scoreMode: 'points', maxPoints: 10 }),
  piece(PLAIN, 'Plain Work'),
];
const STUDENTS = S.map((id, i) => ({
  id,
  personId: id.replace(/^5/, '6'),
  firstName: NAMES[i].split(' ')[0],
  lastName: NAMES[i].split(' ')[1],
  preferred: '',
  pronouns: '',
  studentNumber: String(1000 + i),
  email: '',
  dateOfBirth: '',
  designations: [],
  attendance: [],
  sortName: NAMES[i].split(' ')[1] + ' ' + NAMES[i].split(' ')[0],
}));
const MAP = {
  _customized: true,
  _version: 1,
  _flatVersion: 2,
  subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
  sections: [
    {
      id: 'sec-q',
      subject: 'SCI8',
      name: 'Questioning',
      shortName: 'Q',
      color: '#0891b2',
      tags: [{ id: T1, label: 'Question and Predict', text: '', color: '#0891b2', i_can_statements: [] }],
    },
    {
      id: 'sec-p',
      subject: 'SCI8',
      name: 'Planning',
      shortName: 'P',
      color: '#0891b2',
      tags: [{ id: T2, label: 'Plan Investigations', text: '', color: '#0891b2', i_can_statements: [] }],
    },
  ],
};
const RUBRICS = [
  { id: RUBRIC, name: 'Lab Rubric', criteria: [{ id: CRIT, name: 'Method', tagIds: [T1], levels: {} }] },
];

/* The class, written once before the page's scripts run. Signed in it is
   the fake server's data at the first call; in Demo Mode it sits beside the
   sample class once Demo Mode has made it. */
async function seedClass(page, demo) {
  await page.addInitScript(
    d => {
      if (localStorage.getItem('e2e-current-piece-seeded')) return;
      if (d.demo && !JSON.parse(localStorage.getItem('gb-assessments-sci8') || '[]').length) return;
      localStorage.setItem('e2e-current-piece-seeded', '1');
      const courses = d.demo ? JSON.parse(localStorage.getItem('gb-courses') || '{}') : {};
      courses[d.CID] = {
        id: d.CID,
        name: 'Grade 8 Science',
        gradingSystem: 'proficiency',
        calcMethod: 'mostRecent',
        curriculumTags: [],
      };
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      if (!d.demo) localStorage.setItem('gb-config', JSON.stringify({ activeCourse: d.CID }));
      // The fake server's key, and this device's own (Demo Mode reads it).
      localStorage.setItem('gb-learningMaps-' + d.CID, JSON.stringify(d.MAP));
      localStorage.setItem('gb-learningmap-' + d.CID, JSON.stringify(d.MAP));
      localStorage.setItem('gb-students-' + d.CID, JSON.stringify(d.STUDENTS));
      localStorage.setItem('gb-assessments-' + d.CID, JSON.stringify(d.PIECES));
      localStorage.setItem('gb-rubrics-' + d.CID, JSON.stringify(d.RUBRICS));
      localStorage.setItem('gb-scores-' + d.CID, '{}');
    },
    { CID, MAP, STUDENTS, PIECES, RUBRICS, demo },
  );
}

async function waitForClass(page) {
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(n => getAssessments(n.cid).length === n.count, { cid: CID, count: PIECES.length });
}

async function start(page, mode) {
  await page.clock.setFixedTime(new Date('2026-11-12T18:00:00Z'));
  if (mode === 'signed in') {
    await mockAuth(page);
    await seedClass(page, false);
    await page.goto('/dashboard');
  } else {
    await seedClass(page, true);
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/\/dashboard/);
    await page.waitForFunction(() => getAssessments('sci8').length > 0);
    await page.reload();
  }
  await waitForClass(page);
}

const go = (page, path) => page.evaluate(p => window.Router.navigate(p), path);
const sidOf = (page, name) =>
  page.evaluate(([cid, n]) => getStudents(cid).find(s => s.firstName + ' ' + s.lastName === n).id, [CID, name]);
// Score calls the fake server was sent, oldest first, from `from` on.
const scoreCalls = (page, from) =>
  page.evaluate(
    n =>
      (window.__e2eRpcLog || [])
        .slice(n)
        .filter(c => /score/.test(c.name))
        .map(c => [c.name, c.params]),
    from,
  );
const logLength = page => page.evaluate(() => (window.__e2eRpcLog || []).length);
// Each student's entries on a piece in the saved copy: "key=level".
const saved = (page, aid) =>
  page.evaluate(
    ([cid, a, ids]) => {
      const sc = JSON.parse(localStorage.getItem('gb-scores-' + cid) || '{}');
      return ids.map(sid =>
        (sc[sid] || [])
          .filter(e => e.assessmentId === a)
          .map(e => e.tagId + '=' + e.score)
          .sort()
          .join(' '),
      );
    },
    [CID, aid, S],
  );
// An edit as the assessment form saves it.
const edit = (page, aid, change) =>
  page.evaluate(
    ([cid, a, ch]) => {
      const list = getAssessments(cid);
      const cur = list.find(x => x.id === a);
      Object.keys(ch).forEach(k => (cur[k] = ch[k] === null ? undefined : ch[k]));
      saveAssessments(cid, list);
    },
    [CID, aid, change],
  );
// A level as the grader's level cards save it.
const grade = (page, sid, aid, key, level) =>
  page.evaluate(([cid, s, a, k, l]) => Grader.setLevel(cid, s, a, k, l), [CID, sid, aid, key, level]);

async function settle(page) {
  await page.waitForTimeout(600);
}

async function openScores(page) {
  await go(page, '/gradebook?course=' + CID);
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await expect(page.locator('#gb-data td.gb-scores-cell').first()).toBeVisible();
}
const cell = (page, aid, sid) => page.locator(`.gb-scores-cell[data-aid="${aid}"][data-sid="${sid}"]`);

for (const mode of ['signed in', 'Demo Mode']) {
  test(`${mode}: grading one member of a group fills the group; Grade Separately grades one`, async ({ page }) => {
    await start(page, mode);
    const [ann, ben, cal, dee, eve] = await Promise.all(NAMES.map(n => sidOf(page, n)));
    await openScores(page);
    const from = await logLength(page);
    // Ann, Proficient, from her cell's grader.
    await cell(page, GROUP, ann).click();
    const dialog = page.locator('#grader-overlay .grader-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('.grdl-level[data-level="3"]:visible').first().click();
    await settle(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    for (const sid of [ann, ben, cal]) await expect(cell(page, GROUP, sid)).toContainText('3');
    await expect(cell(page, GROUP, dee)).not.toContainText('3');
    expect(await saved(page, GROUP)).toEqual([T1 + '=3', T1 + '=3', T1 + '=3', '', '']);
    if (mode === 'signed in')
      expect(await scoreCalls(page, from)).toEqual(
        [ann, ben, cal].map(sid => [
          'upsert_tag_score',
          expect.objectContaining({ p_enrollment_id: sid, p_assessment_id: GROUP, p_tag_id: T1, p_value: 3 }),
        ]),
      );

    // Ben graded separately, then Developing: only Ben changes.
    await page.evaluate(([cid, a, s]) => Grader.gradeSeparately(cid, a, s), [CID, GROUP, ben]);
    await settle(page);
    const from2 = await logLength(page);
    await grade(page, ben, GROUP, T1, 2);
    await settle(page);
    expect(await saved(page, GROUP)).toEqual([T1 + '=3', T1 + '=2', T1 + '=3', '', '']);
    if (mode === 'signed in')
      expect(await scoreCalls(page, from2)).toEqual([
        ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: ben, p_assessment_id: GROUP, p_value: 2 })],
      ]);

    // Dee, alone in her group, and Eve on group work with no groups: nobody else.
    const from3 = await logLength(page);
    await grade(page, dee, GROUP, T1, 4);
    await grade(page, eve, NO_GROUPS, T1, 1);
    await settle(page);
    expect(await saved(page, GROUP)).toEqual([T1 + '=3', T1 + '=2', T1 + '=3', T1 + '=4', '']);
    expect(await saved(page, NO_GROUPS)).toEqual(['', '', '', '', T1 + '=1']);
    if (mode === 'signed in')
      expect(await scoreCalls(page, from3)).toEqual([
        ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: dee, p_assessment_id: GROUP, p_value: 4 })],
        ['upsert_tag_score', expect.objectContaining({ p_enrollment_id: eve, p_assessment_id: NO_GROUPS, p_value: 1 })],
      ]);
  });

  test(`${mode}: work edited since the load is saved as it now is`, async ({ page }) => {
    await start(page, mode);
    const [ann, ben] = await Promise.all(NAMES.slice(0, 2).map(n => sidOf(page, n)));

    // A competency added, then graded.
    await edit(page, ADD, { tagIds: [T1, T2] });
    await settle(page);
    let from = await logLength(page);
    await grade(page, ann, ADD, T2, 3);
    await settle(page);
    if (mode === 'signed in')
      expect(await scoreCalls(page, from)).toEqual([
        [
          'upsert_tag_score',
          expect.objectContaining({ p_enrollment_id: ann, p_assessment_id: ADD, p_tag_id: T2, p_value: 3 }),
        ],
      ]);

    // Points made proficiency, two competencies graded.
    await edit(page, POINTS, { scoreMode: null, maxPoints: null, tagIds: [T1, T2] });
    await settle(page);
    from = await logLength(page);
    await grade(page, ben, POINTS, T1, 3);
    await grade(page, ben, POINTS, T2, 2);
    await settle(page);
    if (mode === 'signed in')
      expect(await scoreCalls(page, from)).toEqual([
        [
          'upsert_tag_score',
          expect.objectContaining({ p_enrollment_id: ben, p_assessment_id: POINTS, p_tag_id: T1, p_value: 3 }),
        ],
        [
          'upsert_tag_score',
          expect.objectContaining({ p_enrollment_id: ben, p_assessment_id: POINTS, p_tag_id: T2, p_value: 2 }),
        ],
      ]);

    // A points piece given a rubric, its criterion graded.
    await edit(page, POINTS_RUBRIC, { scoreMode: null, maxPoints: null, rubricId: RUBRIC });
    await settle(page);
    from = await logLength(page);
    await grade(page, ann, POINTS_RUBRIC, CRIT, 4);
    await settle(page);
    if (mode === 'signed in')
      expect(await scoreCalls(page, from)).toEqual([
        [
          'upsert_rubric_score',
          expect.objectContaining({
            p_enrollment_id: ann,
            p_assessment_id: POINTS_RUBRIC,
            p_criterion_id: CRIT,
            p_value: 4,
          }),
        ],
      ]);

    // Work nobody edited: what it always sent.
    from = await logLength(page);
    await grade(page, ann, PLAIN, T1, 2);
    await settle(page);
    if (mode === 'signed in')
      expect(await scoreCalls(page, from)).toEqual([
        [
          'upsert_tag_score',
          { p_enrollment_id: ann, p_assessment_id: PLAIN, p_tag_id: T1, p_value: 2, p_modifier: 0, p_comment: null },
        ],
      ]);

    // After a reload every level is where it was given.
    await page.reload();
    await waitForClass(page);
    expect(await saved(page, ADD)).toEqual([T2 + '=3', '', '', '', '']);
    expect(await saved(page, POINTS)).toEqual(['', [T1 + '=3', T2 + '=2'].sort().join(' '), '', '', '']);
    expect(await saved(page, POINTS_RUBRIC)).toEqual([CRIT + '=4', '', '', '', '']);
    expect(await saved(page, PLAIN)).toEqual([T1 + '=2', '', '', '', '']);
  });
}
