/**
 * The Assignments page and the desktop grader: what is waiting to return
 * (S1-F2, docs/plans/student-page-build-plan.md S1).
 *
 * 1. With the build switch off, with Return Grades on As Soon As I Save, and
 *    for a signed-in teacher, the Assignments page's HTML is byte for byte
 *    what it was before this change. tests/fixtures/assignments-switch-off.json
 *    holds the page as origin/main drew it (commit c14d30ec, before S1-F2):
 *    the toolbar and the list with nothing open and with every card open,
 *    for every kind of work (competency levels, points, an Advanced rubric,
 *    Complete/Incomplete, an Overall level, a single-point rubric, pair work
 *    and a DIBELS benchmark); the same after grading in place and after a
 *    redraw; the Filter menu; the roster; one student's view, before and
 *    after a level; and the grader dialog. A Both and a Letter class: the
 *    list, every card open, and one student. The largest pictures that
 *    repeat another (the list with nothing open, redrawn, and a Both or
 *    Letter class's) are kept as a SHA-256 of their HTML, which is still
 *    byte for byte; the rest are kept whole, so a failure can be read.
 *    Signed in, origin/main draws the same HTML as in Demo Mode, so one
 *    snapshot serves both. It was written by this file's own walk, run in a
 *    checkout of origin/main with only this file added:
 *      UPDATE_ASSIGNMENTS_SNAPSHOT=1 npx vitest run tests/assignments-return.test.js
 *    Run that only on code from before a change the page is meant to keep
 *    out; never to make a failing comparison pass.
 * 2. With the switch on and When I Return Them: see the blocks below.
 */
import './setup.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  typeAndLeave,
  openAssignments,
  openGrader,
  closePages,
} from './helpers/pin-save-paths.js';

const SNAPSHOT = join(new URL('.', import.meta.url).pathname, 'fixtures', 'assignments-switch-off.json');
const UPDATE = process.env.UPDATE_ASSIGNMENTS_SNAPSHOT === '1';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const DEV = U(14);
const ELI = U(15);
const ESSAY = U(31); // levels on two competencies
const QUIZ = U(32); // points, out of 10
const LAB = U(33); // an Advanced rubric
const EXIT = U(34); // Complete/Incomplete
const JOURNAL = U(35); // one Overall level, no competency
const CLAIM = U(36); // a single-point rubric
const TALK = U(37); // pair work: Ava and Ben are graded together
const BENCH = U(38); // a DIBELS benchmark
const QUESTION = U(41);
const PLAN = U(42);
const LAB_RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const GOGGLES = U(74);
const CLAIM_RUBRIC = U(81);
const STATES = U(82);
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };

const entry = (sid, aid, tid, score, more) => ({
  id: sid + ':' + aid + ':' + tid,
  assessmentId: aid,
  tagId: tid,
  score,
  date: '2026-10-10',
  type: 'summative',
  note: '',
  created: '2026-10-10T17:00:00.000Z',
  ...more,
});

// Ava has a grade on every piece; Ben on the pair's; Eli a Late essay.
const SCORES = {
  [AVA]: [
    entry(AVA, ESSAY, QUESTION, 3, { note: 'Careful work.' }),
    entry(AVA, ESSAY, PLAN, 2, { mod: 1, note: 'Careful work.' }),
    entry(AVA, QUIZ, QUESTION, 7),
    entry(AVA, LAB, SAFETY, 3, { mod: -1 }),
    entry(AVA, LAB, METHOD, 4),
    entry(AVA, EXIT, QUESTION, 1),
    entry(AVA, JOURNAL, 'overall', 3),
    entry(AVA, CLAIM, STATES, 3, { critNote: 'Say why' }),
    entry(AVA, TALK, QUESTION, 3),
  ],
  [BEN]: [entry(BEN, TALK, QUESTION, 3)],
  [ELI]: [entry(ELI, ESSAY, QUESTION, 4), entry(ELI, ESSAY, PLAN, 3)],
};
// Missing, Excused and Late, each with nothing else, and Late on a grade.
const STATUSES = {
  [CARA + ':' + ESSAY]: 'NS',
  [DEV + ':' + QUIZ]: 'EXC',
  [ELI + ':' + QUIZ]: 'LATE',
  [ELI + ':' + ESSAY]: 'LATE',
};

function seedWith({ config = {}, system = 'proficiency', ...more } = {}) {
  return () => {
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
        { id: CARA, firstName: 'Cara', lastName: 'Chen' },
        { id: DEV, firstName: 'Dev', lastName: 'Dhillon' },
        { id: ELI, firstName: 'Eli', lastName: 'Evans' },
      ],
      learningMaps: {
        subjects: [],
        sections: [
          { id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] },
          { id: U(52), name: 'Plan', tags: [{ id: PLAN, label: 'Plan', text: 'Plan a test' }] },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      rubrics: [
        {
          id: LAB_RUBRIC,
          name: 'Lab Skills',
          style: 'advanced',
          criteria: [
            {
              id: SAFETY,
              name: 'Safety',
              tagIds: [QUESTION],
              levels: WORDS,
              checks: [{ id: GOGGLES, level: 3, label: 'Goggles on' }],
            },
            { id: METHOD, name: 'Method', tagIds: [PLAN], levels: WORDS, checks: [] },
          ],
        },
        {
          id: CLAIM_RUBRIC,
          name: 'Claim',
          style: 'single_point',
          criteria: [{ id: STATES, name: 'States a Claim', tagIds: [], levels: { 3: 'States a claim' }, checks: [] }],
        },
      ],
      assessments: [
        { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
        { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
        { id: LAB, title: 'Lab', rubricId: LAB_RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' },
        { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [QUESTION], date: '2026-10-13' },
        { id: JOURNAL, title: 'Journal', tagIds: [], date: '2026-10-14', type: 'summative' },
        { id: CLAIM, title: 'Claim', rubricId: CLAIM_RUBRIC, tagIds: [], date: '2026-10-15', type: 'summative' },
        {
          id: TALK,
          title: 'Pair Talk',
          tagIds: [QUESTION],
          date: '2026-10-16',
          type: 'summative',
          collaboration: 'pair',
          pairs: [[AVA, BEN]],
        },
        { id: BENCH, title: 'Reading Benchmark', scoreMode: 'dibels', tagIds: [], date: '2026-10-17' },
      ],
      scores: SCORES,
      statuses: STATUSES,
      rubricChecks: { [AVA + ':' + LAB]: [GOGGLES] },
      courseConfigs: config,
      ...more,
    });
    COURSES[CID].gradingSystem = system;
  };
}

/* ── The page's parts and controls. Rows are redrawn after some saves, so
   each is looked up when it is used. ──────────────────────────────────── */
const toolbar = () => document.getElementById('page-toolbar-mount').innerHTML;
const main = () => document.getElementById('main').innerHTML;
const roster = () => document.getElementById('sidebar-mount').innerHTML;
const overlay = () => document.getElementById('grader-overlay');
const card = aid => document.getElementById('ac-' + aid);
const inCard = (aid, selector) => card(aid).querySelector(selector);
const tagRow = (aid, sid, tag) =>
  inCard(aid, '.rsg-criterion-row.is-tag[data-student="' + sid + '"][data-tag="' + tag + '"]');
const critRow = (aid, sid, criterion) =>
  inCard(aid, '.rsg-criterion-row[data-student="' + sid + '"][data-criterion="' + criterion + '"]');
const levelOf = (row, n) => row.querySelector('.rsg-level.l' + n);
const statusButton = (aid, sid, which) =>
  inCard(aid, '[data-action="toggleStudentStatus"][data-sid="' + sid + '"][data-status="' + which + '"]');
const pointsBox = (aid, sid) => inCard(aid, '.ldg-pts-input[data-sid="' + sid + '"]');
const markButton = (aid, sid, which) =>
  inCard(aid, '[data-action="setCompletion"][data-sid="' + sid + '"][data-mark="' + which + '"]');
// One student's view and the dialog: the grader's own controls.
const graderTagLevel = (root, tag, n) =>
  root.querySelector('[data-action="graderTagLevel"][data-tag="' + tag + '"][data-level="' + n + '"]');
// The page brings itself up to date a moment after each event.
const settled = () => new Promise(r => setTimeout(r, 10));
const expandAll = () => click(document.querySelector('[data-action="expandAllAssess"]'));

/* The walk the snapshot records. Returns { name: html }. */
async function walk(config) {
  const out = {};
  for (const system of ['proficiency', 'both', 'letter']) {
    const name = what => system + ' › ' + what;
    const whole = system === 'proficiency';
    const seed = seedWith({ config, system });

    // The whole class.
    openAssignments(seed, CID);
    await settled();
    out[name('toolbar')] = toolbar();
    out[name('list, nothing open')] = main();
    if (whole) out[name('roster')] = roster();
    expandAll();
    await settled();
    out[name('list, every card open')] = main();
    if (whole) {
      out[name('toolbar, every card open')] = toolbar();
      // Graded in place: a level, points, a mark, a rubric level, statuses.
      click(levelOf(tagRow(ESSAY, BEN, QUESTION), 2));
      typeAndLeave(pointsBox(QUIZ, CARA), '6');
      click(markButton(EXIT, BEN, 'complete'));
      click(levelOf(critRow(LAB, CARA, SAFETY), 3));
      click(statusButton(ESSAY, DEV, 'LATE'));
      click(statusButton(JOURNAL, DEV, 'NS'));
      await settled();
      out[name('list, after grading in place')] = main();
      out[name('toolbar, after grading in place')] = toolbar();
      window.PageAssignments.render();
      await settled();
      out[name('list, redrawn after grading')] = main();
      click(document.querySelector('[data-action="toggleAssessFilterMenu"]'));
      await settled();
      out[name('toolbar, Filter open')] = toolbar();
    }
    closePages();
    clearClass(CID);

    // One student.
    openAssignments(seed, CID, { student: AVA });
    await settled();
    out[name('one student, Ava')] = main();
    if (whole) {
      out[name('one student, toolbar')] = toolbar();
      window.PageAssignments.toggleFocusStudent(BEN);
      await settled();
      out[name('one student, Ben')] = main();
      click(graderTagLevel(card(ESSAY), QUESTION, 3));
      await settled();
      out[name('one student, Ben after a level')] = main();
      window.PageAssignments.toggleFocusStudent(BEN);
      await settled();
      out[name('back to the whole class')] = main();
    }
    closePages();
    clearClass(CID);
    if (!whole) continue;

    // The grader dialog, over the gradebook.
    openGrader(seed, CID, ESSAY, AVA);
    await settled();
    out[name('dialog, Essay, Ava')] = overlay().outerHTML;
    click(overlay().querySelector('[data-grader="next"]'));
    await settled();
    click(graderTagLevel(overlay(), QUESTION, 3));
    await settled();
    out[name('dialog, Essay, Ben after a level')] = overlay().outerHTML;
    closePages();
    clearClass(CID);
    openGrader(seed, CID, TALK, AVA);
    await settled();
    out[name('dialog, Pair Talk')] = overlay().outerHTML;
    closePages();
    clearClass(CID);
    openGrader(seed, CID, BENCH, AVA);
    await settled();
    out[name('dialog, Reading Benchmark')] = overlay().outerHTML;
    closePages();
    clearClass(CID);
  }
  return out;
}

/* The pictures kept as a hash: each is 245,000 characters and all but a
   few of them are in a picture kept whole. */
const HASHED = [
  'proficiency › list, nothing open',
  'proficiency › list, after grading in place',
  'proficiency › list, redrawn after grading',
  'proficiency › one student, Ben',
  'proficiency › back to the whole class',
  'both › list, nothing open',
  'both › list, every card open',
  'both › one student, Ava',
  'letter › list, nothing open',
  'letter › list, every card open',
  'letter › one student, Ava',
];
function pack(out) {
  const packed = {};
  Object.keys(out).forEach(name => {
    packed[name] = HASHED.includes(name)
      ? 'sha256:' + createHash('sha256').update(out[name]).digest('hex') + ' of ' + out[name].length + ' characters'
      : out[name];
  });
  return packed;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  const page = window.PageAssignments;
  if (typeof dismissUndoToast === 'function' && page && page.graderOpen && page.graderOpen()) dismissUndoToast();
  closePages();
  clearClass(CID);
  localStorage.clear();
});

describe('with the build switch off the Assignments page is what it was', () => {
  if (UPDATE) {
    it('writes the snapshot (run on the code from before the change)', async () => {
      const demo = await walk();
      // Signed in, the page must be the same HTML for one snapshot to serve.
      const session = signIn();
      try {
        const signedIn = await walk({ student_page_enabled: true, return_grades: 'on_return' });
        Object.keys(demo).forEach(name => expect(signedIn[name] === demo[name], name).toBe(true));
      } finally {
        session.signOut();
      }
      // Grading in place changed the page; a redraw is other HTML again.
      expect(demo['proficiency › list, after grading in place']).not.toBe(demo['proficiency › list, every card open']);
      expect(demo['proficiency › list, redrawn after grading']).not.toBe(
        demo['proficiency › list, after grading in place'],
      );
      writeFileSync(SNAPSHOT, JSON.stringify(pack(demo), null, 2) + '\n');
    });
    return;
  }
  const before = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};
  const same = now => {
    const packed = pack(now);
    expect(Object.keys(packed)).toEqual(Object.keys(before));
    Object.keys(before).forEach(name => expect(packed[name] === before[name], name).toBe(true));
  };

  it('the snapshot covers the list, one student and the dialog, for each way a class shows grades', () => {
    expect(Object.keys(before).length).toBe(26);
    Object.keys(before).forEach(name => {
      if (HASHED.includes(name)) expect(before[name], name).toMatch(/^sha256:[0-9a-f]{64} of \d{5,} characters$/);
      else expect(before[name].length, name).toBeGreaterThan(800);
    });
    // The one-student view changed when a level was clicked.
    expect(before['proficiency › one student, Ben after a level'].length).toBeGreaterThan(60000);
    // No two hashed pictures of different things are the same picture.
    expect(before['proficiency › list, after grading in place']).not.toBe(
      before['proficiency › list, redrawn after grading'],
    );
  });

  it.each([
    ['a class with neither setting', {}],
    ['a class set to When I Return Them whose student page is off', { return_grades: 'on_return' }],
    ['a class whose student page was turned off again', { student_page_enabled: false, return_grades: 'on_return' }],
    [
      'a class whose student page is on, set to As Soon As I Save',
      { student_page_enabled: true, return_grades: 'on_save' },
    ],
    ['a class whose student page is on with no choice made', { student_page_enabled: true }],
  ])('byte for byte, in %s', async (_, config) => {
    same(await walk(config));
  });

  it('byte for byte for a signed-in teacher, even with both settings on this device', async () => {
    const session = signIn();
    try {
      same(await walk({ student_page_enabled: true, return_grades: 'on_return' }));
    } finally {
      session.signOut();
    }
  });
});
