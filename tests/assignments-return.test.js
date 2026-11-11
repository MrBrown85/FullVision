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
 * 2. With the switch on and When I Return Them, on the page: the toolbar's
 *    "N to return" and its filter; a card's chips and Return N Graded, which
 *    asks first; the Draft or Returned mark on every kind of row; grading in
 *    place; one student's Return beside the Draft mark; pair work; Missing
 *    and Excused; and that no number moves. In the grader dialog: Show and
 *    its counts, what the arrows step through, and Return N Graded.
 *
 * Every count is read through GradeState.draftsIn and draftsWaiting, and
 * every question's words through GradeState's shared helpers (S1-T5);
 * tests/assignments-return-counts.test.js holds the page, the gradebook and
 * the phone together on one class.
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
  fire,
  key,
  typeAndLeave,
  openAssignments,
  openGrader,
  closePages,
  serverSaysStudentPageOn,
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
// A test that waits on the page's own timers moves the clock (movedClock) instead of sleeping.
let clockMoved = false;
const settled = () => (clockMoved ? vi.advanceTimersByTimeAsync(10) : new Promise(r => setTimeout(r, 10)));
const movedClock = () => {
  clockMoved = true;
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
    now: new Date('2026-11-10T18:00:00.000Z'),
  });
};
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
  clockMoved = false;
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
    [
      'a class whose student page is on, set to As Soon As I Save',
      { student_page_enabled: true, return_grades: 'on_save' },
    ],
    ['a class whose student page is on with no choice made', { student_page_enabled: true }],
  ])('byte for byte, in %s', async (_, config) => {
    same(await walk(config));
  });

  // This one stands as S1-F2 wrote it. S0-W1 makes a signed-in teacher's
  // switch the server's, but the two settings on the device alone are not
  // the server's word (shared/data.js _serverSaysStudentPage): they draw
  // nothing.
  it('byte for byte for a signed-in teacher, even with both settings on this device', async () => {
    const session = signIn();
    try {
      same(await walk({ student_page_enabled: true, return_grades: 'on_return' }));
    } finally {
      session.signOut();
    }
  });

  // S0-W1: signed in, every class that does not hold grades; and for one
  // whose student page is off, nothing new is asked of the server.
  it.each([
    ['a class with neither setting', {}],
    ['a class set to When I Return Them whose student page is off', { return_grades: 'on_return' }],
    [
      'a class the server says is on, set to As Soon As I Save',
      { student_page_enabled: true, return_grades: 'on_save' },
    ],
    ['a class the server says is on, with no choice made', { student_page_enabled: true }],
  ])('byte for byte for a signed-in teacher, in %s', async (_, config) => {
    const session = signIn();
    if (config.student_page_enabled === true) serverSaysStudentPageOn(CID);
    try {
      same(await walk(config));
      if (config.student_page_enabled !== true) {
        expect(session.sent().filter(c => /grade_return|return_grades|student_card|draft_count/.test(c[0]))).toEqual(
          [],
        );
        expect(Object.keys(localStorage._store).filter(k => k.indexOf('grade-returns') >= 0)).toEqual([]);
      }
    } finally {
      serverSaysStudentPageOn(CID, false);
      session.signOut();
    }
  });

  it('and the check can tell: a signed-in class the server says holds grades is not what main draws', async () => {
    const session = signIn();
    serverSaysStudentPageOn(CID);
    try {
      const packed = pack(await walk({ student_page_enabled: true, return_grades: 'on_return' }));
      const changed = Object.keys(before).filter(name => packed[name] !== before[name]);
      expect(changed.length).toBeGreaterThan(0);
    } finally {
      serverSaysStudentPageOn(CID, false);
      session.signOut();
    }
  });
});

/* ── With the switch on and When I Return Them ─────────────────────────── */
const HELD = { student_page_enabled: true, return_grades: 'on_return' };
const EVERYONE = [AVA, BEN, CARA, DEV, ELI];
const WORK = [ESSAY, QUIZ, LAB, EXIT, JOURNAL, CLAIM, TALK, BENCH];
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const today = () => formatShortDate('2026-11-10T18:00:00.000Z');
const openPage = (params, more) => openAssignments(seedWith({ config: HELD, ...more }), CID, params);
const openCard = aid => openPage({ open: aid });
const pill = () => document.querySelector('.assess-to-return-btn');
const pillCount = () => (pill() ? parseInt(pill().textContent, 10) : 0);
const toReturnChip = aid => text(inCard(aid, '.assess-to-return'));
const returnedChip = aid => text(inCard(aid, '.assess-returned'));
const cardReturn = aid => inCard(aid, '.assess-return-btn');
const mark = (aid, sid) => text(inCard(aid, '.ret-mark[data-ret-sids*="' + sid + '"]'));
const inlineRow = aid => inCard(aid, '.grader-return-inline');
const inlineReturn = aid => inCard(aid, '[data-action="returnOne"]');
const confirmDialog = () => document.querySelector('.confirm-overlay');
const asks = () => ({
  title: text(confirmDialog().querySelector('.confirm-title')),
  message: text(confirmDialog().querySelector('.confirm-message')),
  buttons: Array.from(confirmDialog().querySelectorAll('button')).map(text),
});
const confirmOk = () => document.getElementById('confirm-ok-btn').onclick();
const confirmCancel = () => document.getElementById('confirm-cancel-btn').onclick();
const listed = () => Array.from(document.querySelectorAll('#main .assess-card')).map(c => c.id.replace('ac-', ''));
const drafts = (aid, ids = EVERYONE) => GradeState.draftsIn(CID, aid, ids);
// Five drafts on the Essay (one a changed returned grade), one on the Quiz,
// the pair's two, and a benchmark, which has no state.
function grade() {
  [BEN, CARA, DEV].forEach((sid, i) => Grader.setLevel(CID, sid, ESSAY, QUESTION, 2 + i, 0));
  Grader.setStatus(CID, CARA, ESSAY, null);
  Grader.setLevel(CID, CARA, ESSAY, QUESTION, 3, 0);
  Grader.setLevel(CID, AVA, ESSAY, QUESTION, 4, 0);
  Grader.setLevel(CID, ELI, ESSAY, PLAN, 2, 0);
  Grader.setPoints(CID, BEN, QUIZ, 6);
  Grader.setLevel(CID, AVA, TALK, QUESTION, 4, 0);
  Grader.setDibels(CID, AVA, BENCH, 'boy', { orfWrc: 90 });
}
// Opens the page on a class with the drafts above already saved.
function openGraded(params) {
  return openAssignments(
    () => {
      seedWith({ config: HELD })();
      grade();
    },
    CID,
    params,
  );
}

describe.skipIf(UPDATE)('with the build switch on and When I Return Them: the Assignments page', () => {
  it('a class with nothing waiting shows no count and no Return; grades from before are Returned with no date', async () => {
    openPage();
    await settled();
    expect(pill()).toBe(null);
    expect(document.querySelector('.assess-to-return-slot')).not.toBe(null);
    expect(document.querySelector('#main .assess-to-return')).toBe(null);
    expect(document.querySelector('#main .assess-return-btn')).toBe(null);
    // Ava and Eli have an Essay grade from before the switch came on.
    expect(returnedChip(ESSAY)).toBe('2 returned');
    expect(returnedChip(QUIZ)).toBe('1 returned');
    expect(returnedChip(TALK)).toBe('2 returned');
    expandAll();
    await settled();
    expect(mark(ESSAY, AVA)).toBe('Returned');
    expect(mark(ESSAY, ELI)).toBe('Returned');
    expect(mark(ESSAY, BEN)).toBe('');
    // Missing with nothing in is not a grade.
    expect(mark(ESSAY, CARA)).toBe('');
    expect(mark(QUIZ, AVA)).toBe('Returned');
    expect(mark(TALK, AVA)).toBe('Returned');
  });

  it('counts the drafts on the toolbar and on each card, as GradeState does', async () => {
    openGraded();
    await settled();
    expect(text(pill())).toBe('8 to return');
    expect(pillCount()).toBe(GradeState.draftsWaiting(CID));
    expect(pill().getAttribute('aria-pressed')).toBe('false');
    expect(pill().getAttribute('title')).toBe('Show only the assessments with a draft to return.');
    WORK.forEach(aid => {
      const n = drafts(aid).length;
      expect(toReturnChip(aid), aid).toBe(n ? n + ' to return' : null);
      expect(cardReturn(aid) ? text(cardReturn(aid)) : null, aid).toBe(n ? 'Return ' + n + ' Graded' : null);
    });
    expect(toReturnChip(ESSAY)).toBe('5 to return');
    expect(toReturnChip(QUIZ)).toBe('1 to return');
    expect(toReturnChip(TALK)).toBe('2 to return');
    // Returned counts the students whose grade is given and not waiting.
    expect(returnedChip(ESSAY)).toBe(null);
    expect(returnedChip(QUIZ)).toBe('1 returned');
    expect(returnedChip(LAB)).toBe('1 returned');
    // A DIBELS benchmark has no state: no chips, no slot, no button.
    expect(card(BENCH).querySelector('.assess-returns, .assess-return-slot, .ret-mark')).toBe(null);
    // The button names who in its hover line and the work for a screen reader.
    expect(cardReturn(ESSAY).getAttribute('title')).toBe('5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.');
    expect(cardReturn(ESSAY).getAttribute('aria-label')).toBe('Return 5 Graded, Essay');
    expect(cardReturn(QUIZ).getAttribute('title')).toBe('1 draft: Ben can’t see it yet.');
    expect(cardReturn(ESSAY).tagName).toBe('BUTTON');
    expect(pill().tagName).toBe('BUTTON');
  });

  it('marks each row: Draft while a grade waits, Returned once given, nothing for a status alone', async () => {
    openGraded();
    expandAll();
    await settled();
    EVERYONE.forEach(sid => expect(mark(ESSAY, sid), sid).toBe('Draft'));
    // The ledger rows.
    expect(mark(QUIZ, BEN)).toBe('Draft');
    expect(mark(QUIZ, AVA)).toBe('Returned');
    // Excused and Late with nothing in.
    expect(mark(QUIZ, DEV)).toBe('');
    expect(mark(QUIZ, ELI)).toBe('');
    expect(mark(EXIT, AVA)).toBe('Returned');
    // A ledger's name keeps its cell; the mark sits in it.
    const name = card(QUIZ).querySelector('.ldg-row[data-status-student="' + BEN + '"] .ldg-name');
    expect(name.className).toBe('ldg-name ldg-name-ret');
    expect(text(name.querySelector('.ldg-name-text'))).toBe('Ben Brown');
    // Pair work is one row for the pair, and one mark.
    expect(card(TALK).querySelectorAll('.ret-mark').length).toBe(4);
    expect(mark(TALK, AVA)).toBe('Draft');
    expect(mark(TALK, BEN)).toBe('Draft');
    expect(inCard(TALK, '.ret-mark[data-ret-sids="' + AVA + ',' + BEN + '"]')).not.toBe(null);
    // An Advanced rubric with a second grid draws the mark once per student.
    expect(card(LAB).querySelectorAll('.ret-mark[data-ret-sids="' + AVA + '"]').length).toBe(1);
  });

  it('a Missing or Excused piece is never a draft, and Late is only a label', async () => {
    openGraded({ open: ESSAY });
    await settled();
    expect(toReturnChip(ESSAY)).toBe('5 to return');
    // Missing set over Dev's draft: the mark and the counts drop it.
    const statuses = getAssignmentStatuses(CID);
    statuses[DEV + ':' + ESSAY] = 'NS';
    statuses[BEN + ':' + ESSAY] = 'EXC';
    saveAssignmentStatuses(CID, statuses);
    window.PageAssignments.render();
    await settled();
    expect(mark(ESSAY, DEV)).toBe('');
    expect(mark(ESSAY, BEN)).toBe('');
    // Eli's Essay is Late and graded: a draft like any other.
    expect(mark(ESSAY, ELI)).toBe('Draft');
    expect(toReturnChip(ESSAY)).toBe('3 to return');
    expect(text(cardReturn(ESSAY))).toBe('Return 3 Graded');
    expect(cardReturn(ESSAY).getAttribute('title')).toBe('3 drafts: Ava, Cara and Eli can’t see them yet.');
    expect(pillCount()).toBe(GradeState.draftsWaiting(CID));
    expect(pillCount()).toBe(6);
  });

  it('grading in place brings the mark, the chips, the button and the count up to date without a redraw', async () => {
    openCard(ESSAY);
    await settled();
    const seen = card(ESSAY);
    expect(pill()).toBe(null);
    expect(mark(ESSAY, BEN)).toBe('');
    click(levelOf(tagRow(ESSAY, BEN, QUESTION), 3));
    await settled();
    expect(card(ESSAY)).toBe(seen);
    expect(mark(ESSAY, BEN)).toBe('Draft');
    expect(toReturnChip(ESSAY)).toBe('1 to return');
    expect(returnedChip(ESSAY)).toBe('2 returned');
    expect(text(cardReturn(ESSAY))).toBe('Return 1 Graded');
    expect(text(pill())).toBe('1 to return');
    // A returned grade changed is a draft again; put back, it is not.
    click(levelOf(tagRow(ESSAY, AVA, QUESTION), 4));
    await settled();
    expect(mark(ESSAY, AVA)).toBe('Draft');
    expect(toReturnChip(ESSAY)).toBe('2 to return');
    expect(returnedChip(ESSAY)).toBe('1 returned');
    expect(text(pill())).toBe('2 to return');
    click(levelOf(tagRow(ESSAY, AVA, QUESTION), 3));
    await settled();
    expect(mark(ESSAY, AVA)).toBe('Returned');
    expect(text(pill())).toBe('1 to return');
    // The same level clicked again clears it: nothing is left to return.
    click(levelOf(tagRow(ESSAY, BEN, QUESTION), 3));
    await settled();
    expect(mark(ESSAY, BEN)).toBe('');
    expect(cardReturn(ESSAY)).toBe(null);
    expect(pill()).toBe(null);
    expect(card(ESSAY)).toBe(seen);
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
  });

  it('a button is not swapped out by an event that changed nothing', async () => {
    openGraded({ open: ESSAY });
    await settled();
    const button = cardReturn(ESSAY);
    const chip = inCard(ESSAY, '.assess-to-return');
    const row = inCard(ESSAY, '.ret-mark[data-ret-sids="' + BEN + '"] .ret-draft');
    const count = pill();
    // A click and a key that save nothing, and a status that is no part of a grade.
    click(inCard(ESSAY, '.rsg-student-name'));
    fire(document.querySelector('.assess-search-input'), 'focusout');
    click(statusButton(ESSAY, BEN, 'LATE'));
    await settled();
    expect(cardReturn(ESSAY)).toBe(button);
    expect(inCard(ESSAY, '.assess-to-return')).toBe(chip);
    expect(inCard(ESSAY, '.ret-mark[data-ret-sids="' + BEN + '"] .ret-draft')).toBe(row);
    expect(pill()).toBe(count);
    // A save that changes the count does swap it.
    click(levelOf(tagRow(ESSAY, BEN, QUESTION), 2));
    await settled();
    if (typeof dismissUndoToast === 'function') dismissUndoToast();
    expect(drafts(ESSAY).length).toBe(4);
    expect(cardReturn(ESSAY)).not.toBe(button);
    expect(text(cardReturn(ESSAY))).toBe('Return 4 Graded');
  });

  it('points typed in a ledger and a comment saved off its timer are drafts too', async () => {
    movedClock();
    openCard(QUIZ);
    await settled();
    typeAndLeave(pointsBox(QUIZ, CARA), '6');
    await settled();
    expect(mark(QUIZ, CARA)).toBe('Draft');
    expect(text(pill())).toBe('1 to return');
    // The Overall Comment saves 800 ms after the last key, with no event.
    const box = inCard(QUIZ, '.rsg-overall-comment[data-sid="' + BEN + '"]');
    box.value = 'Check question 4.';
    fire(box, 'input');
    await settled();
    expect(mark(QUIZ, BEN)).toBe('');
    await vi.advanceTimersByTimeAsync(900);
    expect(GradeState.stateOf(CID, BEN, QUIZ)).toBe('draft');
    expect(mark(QUIZ, BEN)).toBe('Draft');
    expect(text(pill())).toBe('2 to return');
  });

  it('Return N Graded on a card asks first, naming who gets their grade; Cancel returns nothing', async () => {
    openGraded({ open: ESSAY });
    await settled();
    const returns = vi.spyOn(Grader, 'returnGrades');
    const button = cardReturn(ESSAY);
    click(button);
    expect(asks()).toEqual({
      title: 'Return 5 Grades Now?',
      message: '5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.',
      buttons: ['Cancel', 'Return 5 Graded'],
    });
    confirmCancel();
    await settled();
    expect(confirmDialog()).toBe(null);
    expect(returns).not.toHaveBeenCalled();
    expect(drafts(ESSAY).length).toBe(5);
    expect(document.activeElement).toBe(button);
    expect(text(pill())).toBe('8 to return');

    click(cardReturn(ESSAY));
    confirmOk();
    await settled();
    expect(returns).toHaveBeenCalledTimes(1);
    expect(returns.mock.calls[0]).toEqual([CID, ESSAY, EVERYONE]);
    expect(drafts(ESSAY)).toEqual([]);
    EVERYONE.forEach(sid => expect(mark(ESSAY, sid), sid).toBe('Returned ' + today()));
    expect(cardReturn(ESSAY)).toBe(null);
    expect(toReturnChip(ESSAY)).toBe(null);
    expect(returnedChip(ESSAY)).toBe('5 returned');
    expect(text(pill())).toBe('3 to return');
    expect(pillCount()).toBe(GradeState.draftsWaiting(CID));
    // The button went with the drafts: the card's next button has the focus.
    expect(document.activeElement).toBe(inCard(ESSAY, '.assess-header-actions button'));
    returns.mockRestore();
  });

  it('one draft asks too: the button names nobody', async () => {
    openGraded({ open: QUIZ });
    await settled();
    click(cardReturn(QUIZ));
    expect(asks()).toEqual({
      title: 'Return 1 Grade Now?',
      message: '1 draft: Ben can’t see it yet.',
      buttons: ['Cancel', 'Return 1 Graded'],
    });
    confirmOk();
    await settled();
    expect(GradeState.stateOf(CID, BEN, QUIZ)).toBe('returned');
    expect(mark(QUIZ, BEN)).toBe('Returned ' + today());
  });

  it('the drafts are counted again when the question is answered', async () => {
    openGraded({ open: ESSAY });
    await settled();
    const returns = vi.spyOn(Grader, 'returnGrades');
    click(cardReturn(ESSAY));
    expect(asks().title).toBe('Return 5 Grades Now?');
    // Two are returned from another screen while the question is up.
    returns.mockClear();
    Grader.returnGrades(CID, ESSAY, [BEN, CARA]);
    returns.mockClear();
    confirmOk();
    await settled();
    expect(returns.mock.calls).toEqual([[CID, ESSAY, [AVA, DEV, ELI]]]);
    expect(drafts(ESSAY)).toEqual([]);
    returns.mockRestore();
  });

  it('pair work is returned together, and the count and names say so', async () => {
    openGraded({ open: TALK });
    await settled();
    const returns = vi.spyOn(Grader, 'returnGrades');
    expect(toReturnChip(TALK)).toBe('2 to return');
    click(cardReturn(TALK));
    expect(asks()).toEqual({
      title: 'Return 2 Grades Now?',
      message: '2 drafts: Ava and Ben can’t see them yet.',
      buttons: ['Cancel', 'Return 2 Graded'],
    });
    confirmOk();
    await settled();
    expect(returns.mock.calls[0][2].slice().sort()).toEqual([AVA, BEN]);
    expect(GradeState.stateOf(CID, AVA, TALK)).toBe('returned');
    expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
    expect(mark(TALK, AVA)).toBe('Returned ' + today());
    returns.mockRestore();
  });

  it('“N to return” pressed leaves only the assessments with a draft; the last one returned turns it off', async () => {
    openGraded();
    await settled();
    expect(listed().length).toBe(8);
    click(pill());
    await settled();
    expect(listed().sort()).toEqual([ESSAY, QUIZ, TALK].sort());
    expect(pill().getAttribute('aria-pressed')).toBe('true');
    expect(pill().className).toContain('active');
    expect(text(pill())).toBe('8 to return ×');
    expect(pill().getAttribute('title')).toBe(
      'Showing only the assessments with a draft to return. Click to show everything.',
    );
    // The pill keeps the keyboard.
    expect(document.activeElement).toBe(pill());
    // A card with nothing left to return leaves the list.
    click(cardReturn(QUIZ));
    confirmOk();
    await settled();
    expect(listed().sort()).toEqual([ESSAY, TALK].sort());
    expect(text(pill())).toBe('7 to return ×');
    click(pill());
    await settled();
    expect(listed().length).toBe(8);
    expect(pill().getAttribute('aria-pressed')).toBe('false');
    // On again; returning the last drafts turns it off and shows everything.
    click(pill());
    await settled();
    click(cardReturn(ESSAY));
    confirmOk();
    await settled();
    click(cardReturn(TALK));
    confirmOk();
    await settled();
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    expect(pill()).toBe(null);
    expect(listed().length).toBe(8);
  });

  it('the count follows the Filter menu and the search: it is the drafts on screen', async () => {
    movedClock();
    openGraded();
    await settled();
    const box = document.querySelector('.assess-search-input');
    box.value = 'quiz';
    fire(box, 'input');
    await vi.advanceTimersByTimeAsync(400);
    expect(listed()).toEqual([QUIZ]);
    expect(text(pill())).toBe('1 to return');
  });

  describe('with one student open', () => {
    it('Return sits beside the Draft mark under each grader, and is one click', async () => {
      openGraded({ student: CARA });
      await settled();
      const returns = vi.spyOn(Grader, 'returnGrades');
      // The count is this student's drafts; the cards offer no Return N Graded.
      expect(text(pill())).toBe('1 to return');
      expect(document.querySelector('#main .assess-return-btn')).toBe(null);
      expect(toReturnChip(ESSAY)).toBe('1 to return');
      expect(returnedChip(ESSAY)).toBe(null);
      expect(document.querySelector('#main .assess-returned')).toBe(null);
      const row = inlineRow(ESSAY);
      expect(text(row.querySelector('.grader-draft-mark'))).toBe('Draft');
      expect(text(row.querySelector('.grader-draft-text'))).toBe('Saved. Not returned yet.');
      expect(row.querySelector('.grader-draft-still')).toBe(null);
      expect(text(inlineReturn(ESSAY))).toBe('Return');
      expect(inlineReturn(ESSAY).getAttribute('aria-label')).toBe('Return, Essay');
      expect(inlineReturn(ESSAY).tagName).toBe('BUTTON');
      // Nothing in: Return is there, greyed out. A status alone: no row.
      expect(inlineReturn(LAB).disabled).toBe(true);
      expect(inlineRow(BENCH)).toBe(null);

      click(inlineReturn(ESSAY));
      await settled();
      expect(confirmDialog()).toBe(null);
      expect(returns.mock.calls).toEqual([[CID, ESSAY, [CARA]]]);
      expect(text(inlineRow(ESSAY))).toBe('Returned ' + today());
      expect(inlineReturn(ESSAY)).toBe(null);
      expect(pill()).toBe(null);
      expect(toReturnChip(ESSAY)).toBe(null);
      returns.mockRestore();
    });

    it('a changed returned grade says what the student still sees', async () => {
      openPage({ student: AVA });
      await settled();
      expect(text(inlineRow(ESSAY))).toBe('Returned');
      click(graderTagLevel(card(ESSAY), QUESTION, 4));
      await settled();
      const row = inlineRow(ESSAY);
      expect(text(row.querySelector('.grader-draft-mark'))).toBe('Draft');
      expect(text(row.querySelector('.grader-draft-still'))).toBe('Ava still sees the grade you returned.');
      expect(text(pill())).toBe('1 to return');
      // Returned, then changed again: the line has the date.
      click(inlineReturn(ESSAY));
      await settled();
      expect(text(inlineRow(ESSAY))).toBe('Returned ' + today());
      vi.setSystemTime(new Date('2026-11-12T18:00:00.000Z'));
      click(graderTagLevel(card(ESSAY), QUESTION, 2));
      await settled();
      expect(text(inlineRow(ESSAY).querySelector('.grader-draft-still'))).toBe(
        'Ava still sees the grade you returned ' + today() + '.',
      );
    });

    it('a status with nothing in shows no row, and Missing over a draft hides it', async () => {
      openGraded({ student: DEV });
      await settled();
      // Excused on the Quiz with nothing in.
      expect(inlineRow(QUIZ).hidden).toBe(true);
      expect(text(inlineRow(QUIZ))).toBe('');
      expect(text(inlineRow(ESSAY).querySelector('.grader-draft-mark'))).toBe('Draft');
    });

    it('on pair work a partner’s draft goes too, so Return asks first and names both', async () => {
      openGraded({ student: BEN });
      await settled();
      const returns = vi.spyOn(Grader, 'returnGrades');
      expect(toReturnChip(TALK)).toBe('1 to return');
      const button = inlineReturn(TALK);
      click(button);
      expect(asks()).toEqual({
        title: 'Return 2 Grades Now?',
        message: '2 drafts: Ava and Ben can’t see them yet.',
        buttons: ['Cancel', 'Return 2 Graded'],
      });
      confirmCancel();
      expect(returns).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button);
      click(inlineReturn(TALK));
      confirmOk();
      await settled();
      expect(returns.mock.calls[0][2].slice().sort()).toEqual([AVA, BEN]);
      expect(GradeState.stateOf(CID, AVA, TALK)).toBe('returned');
      expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
      // Ben's Essay and Quiz drafts are untouched.
      expect(GradeState.stateOf(CID, BEN, ESSAY)).toBe('draft');
      expect(text(pill())).toBe('2 to return');
      returns.mockRestore();
    });

    it('the row is about the student on screen: a partner’s draft alone shows no Draft here', async () => {
      openGraded({ student: BEN });
      await settled();
      // Ben's piece of the pair's work is returned; Ava's still waits.
      Grader.returnGrades(CID, TALK, [BEN]);
      window.PageAssignments.render();
      await settled();
      expect(text(inlineRow(TALK))).toBe('Returned ' + today());
      expect(inlineReturn(TALK)).toBe(null);
      expect(toReturnChip(TALK)).toBe(null);
      // Changed again, the line names Ben, not the pair.
      Grader.gradeSeparately(CID, TALK, BEN);
      window.PageAssignments.render();
      await settled();
      click(graderTagLevel(card(TALK), QUESTION, 1));
      await settled();
      expect(text(inlineRow(TALK).querySelector('.grader-draft-still'))).toBe(
        'Ben still sees the grade you returned ' + today() + '.',
      );
    });

    it('a partner already returned is not asked about: one click', async () => {
      openGraded({ student: BEN });
      await settled();
      Grader.returnGrades(CID, TALK, [AVA]);
      const returns = vi.spyOn(Grader, 'returnGrades');
      click(inlineReturn(TALK));
      await settled();
      expect(confirmDialog()).toBe(null);
      expect(returns).toHaveBeenCalledTimes(1);
      expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
      returns.mockRestore();
    });
  });

  it('no number on the page moves because a grade is a draft', async () => {
    const numbers = () => ({
      roster: roster(),
      tallies: Array.from(document.querySelectorAll('#main .ldg-tally, #main .ldg-stats')).map(text),
    });
    openAssignments(() => {
      seedWith({ config: HELD })();
      grade();
    }, CID);
    expandAll();
    await settled();
    const held = numbers();
    expect(GradeState.draftsWaiting(CID)).toBe(8);
    closePages();
    clearClass(CID);
    openAssignments(() => {
      seedWith({ config: {} })();
      grade();
    }, CID);
    expandAll();
    await settled();
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    expect(numbers()).toEqual(held);
  });

  it('in a class moved to As Soon As I Save nothing is drawn and every new action does nothing', async () => {
    openGraded();
    await settled();
    expect(pillCount()).toBe(8);
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { return_grades: 'on_save' }));
    window.PageAssignments.render();
    await settled();
    expect(toolbar() + main()).not.toMatch(/to return|returned|ret-mark|assess-return|Draft|grader-return/);
    const returns = vi.spyOn(Grader, 'returnGrades');
    // A made-up button for each new action: nothing is returned or drawn.
    ['toggleToReturn', 'returnDrafts', 'returnOne'].forEach(action => {
      const btn = document.createElement('button');
      btn.setAttribute('data-action', action);
      btn.setAttribute('data-aid', ESSAY);
      btn.setAttribute('data-sid', BEN);
      card(ESSAY).appendChild(btn);
      click(btn);
      btn.remove();
    });
    await settled();
    expect(returns).not.toHaveBeenCalled();
    expect(confirmDialog()).toBe(null);
    expect(listed().length).toBe(8);
    returns.mockRestore();
  });
});

describe.skipIf(UPDATE)('with the build switch on and When I Return Them: the grader dialog', () => {
  const at = selector => overlay().querySelector(selector);
  const bar = () => at('.grader-show');
  const seg = which => at('.grader-show [data-show="' + which + '"]');
  const segs = () => Array.from(overlay().querySelectorAll('.grader-show .seg-btn')).map(text);
  const pressed = () =>
    Array.from(overlay().querySelectorAll('.grader-show .seg-btn'))
      .filter(b => b.getAttribute('aria-pressed') === 'true')
      .map(b => b.getAttribute('data-show'));
  const returnAll = () => at('.grader-return-all');
  const name = () => text(at('.grader-student'));
  const prev = () => at('[data-grader="prev"]');
  const next = () => at('[data-grader="next"]');
  // The dialog over the gradebook on a class with the drafts saved.
  function open(aid, sid, opts) {
    openGrader(
      () => {
        seedWith({ config: HELD })();
        grade();
      },
      CID,
      aid,
      sid,
    );
    if (opts) {
      window.PageAssignments.closeGrader();
      window.PageAssignments.openGrader(CID, aid, sid, opts);
    }
    return overlay();
  }

  it('a bar under the title has Show with its counts and Return N Graded', async () => {
    open(ESSAY, AVA);
    await settled();
    expect(bar().previousElementSibling.className).toBe('grader-toolbar');
    expect(bar().nextElementSibling.className).toBe('grader-scroll');
    expect(at('.grader-show-seg').getAttribute('role')).toBe('group');
    expect(at('.grader-show-seg').getAttribute('aria-label')).toBe('Show');
    expect(segs()).toEqual(['To Return 5', 'Returned 0', 'All 5']);
    expect(pressed()).toEqual(['all']);
    // Nothing is returned yet: that choice is greyed out.
    expect(seg('returned').disabled).toBe(true);
    expect(seg('toreturn').disabled).toBe(false);
    expect(text(returnAll())).toBe('Return 5 Graded');
    expect(returnAll().getAttribute('title')).toBe('5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.');
    expect(returnAll().tagName).toBe('BUTTON');
    // The counts are GradeState's.
    expect(drafts(ESSAY).length).toBe(5);
  });

  it('the counts follow each save and each return, without the bar being redrawn when nothing changed', async () => {
    open(QUIZ, AVA);
    await settled();
    expect(segs()).toEqual(['To Return 1', 'Returned 1', 'All 5']);
    const same = seg('toreturn');
    click(at('.grader-dialog'));
    await settled();
    expect(seg('toreturn')).toBe(same);
    // Ava's returned score changed: a draft again.
    typeAndLeave(at('.grdp-input'), '9');
    await settled();
    expect(segs()).toEqual(['To Return 2', 'Returned 0', 'All 5']);
    expect(text(returnAll())).toBe('Return 2 Graded');
    click(at('[data-grader="return"]'));
    await settled();
    expect(segs()).toEqual(['To Return 1', 'Returned 1', 'All 5']);
    expect(text(returnAll())).toBe('Return 1 Graded');
  });

  it('there is no bar with one student, on a DIBELS benchmark, or in a class that holds no grades', async () => {
    open(ESSAY, AVA, { studentIds: [AVA] });
    await settled();
    expect(bar()).toBe(null);
    closePages();
    clearClass(CID);
    open(BENCH, AVA);
    await settled();
    expect(bar()).toBe(null);
    closePages();
    clearClass(CID);
    openGrader(seedWith({ config: { student_page_enabled: true, return_grades: 'on_save' } }), CID, ESSAY, AVA);
    click(graderTagLevel(overlay(), QUESTION, 4));
    await settled();
    expect(bar()).toBe(null);
    expect(overlay().outerHTML).not.toMatch(/grader-show|Return \d+ Graded|To Return/);
  });

  it('To Return is what the arrows step through; the student on screen stays until a step', async () => {
    open(QUIZ, AVA);
    Grader.setPoints(CID, DEV, QUIZ, null);
    Grader.setStatus(CID, DEV, QUIZ, null);
    Grader.setPoints(CID, DEV, QUIZ, 4);
    await settled();
    // Drafts: Ben and Dev. Ava is Returned.
    expect(segs()).toEqual(['To Return 2', 'Returned 1', 'All 5']);
    click(seg('toreturn'));
    await settled();
    expect(pressed()).toEqual(['toreturn']);
    // Ava is not one of them: the first draft opens.
    expect(name()).toBe('Ben Brown');
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(false);
    // The pressed choice keeps the keyboard.
    expect(document.activeElement).toBe(seg('toreturn'));
    click(next());
    await settled();
    // Cara has no draft: the step goes past her to Dev.
    expect(name()).toBe('Dev Dhillon');
    expect(next().disabled).toBe(true);
    expect(prev().disabled).toBe(false);
    // The arrow keys step the same way (from the points box, as the hint says).
    expect(document.activeElement.className).toContain('grdp-input');
    key(document.activeElement, 'ArrowLeft');
    await settled();
    expect(name()).toBe('Ben Brown');
    // Returning the grade on screen leaves the student there.
    click(at('[data-grader="return"]'));
    await settled();
    expect(name()).toBe('Ben Brown');
    expect(segs()).toEqual(['To Return 1', 'Returned 2', 'All 5']);
    expect(pressed()).toEqual(['toreturn']);
    expect(next().disabled).toBe(false);
    click(next());
    await settled();
    expect(name()).toBe('Dev Dhillon');
    // The last one returned: Show goes back to All and every student steps.
    click(at('[data-grader="return"]'));
    await settled();
    expect(pressed()).toEqual(['all']);
    expect(seg('toreturn').disabled).toBe(true);
    expect(name()).toBe('Dev Dhillon');
    expect(next().disabled).toBe(false);
    click(prev());
    await settled();
    expect(name()).toBe('Cara Chen');
  });

  it('Returned steps through the students whose grade is given; All steps through everyone', async () => {
    open(QUIZ, BEN);
    Grader.returnGrades(CID, QUIZ, [BEN]);
    click(at('.grader-dialog'));
    await settled();
    expect(segs()).toEqual(['To Return 0', 'Returned 2', 'All 5']);
    click(seg('returned'));
    await settled();
    expect(name()).toBe('Ben Brown');
    expect(next().disabled).toBe(true);
    click(prev());
    await settled();
    expect(name()).toBe('Ava Adams');
    expect(prev().disabled).toBe(true);
    click(seg('all'));
    await settled();
    expect(pressed()).toEqual(['all']);
    expect(name()).toBe('Ava Adams');
    click(next());
    await settled();
    expect(name()).toBe('Ben Brown');
    click(next());
    await settled();
    expect(name()).toBe('Cara Chen');
  });

  it('Return N Graded asks first when it returns more than the grade on screen', async () => {
    open(ESSAY, BEN);
    await settled();
    const returns = vi.spyOn(Grader, 'returnGrades');
    const button = returnAll();
    click(button);
    expect(asks()).toEqual({
      title: 'Return 5 Grades Now?',
      message: '5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.',
      buttons: ['Cancel', 'Return 5 Graded'],
    });
    confirmCancel();
    await settled();
    expect(returns).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    click(returnAll());
    confirmOk();
    await settled();
    expect(returns.mock.calls).toEqual([[CID, ESSAY, EVERYONE]]);
    expect(drafts(ESSAY)).toEqual([]);
    expect(returnAll()).toBe(null);
    expect(segs()).toEqual(['To Return 0', 'Returned 5', 'All 5']);
    expect(text(at('.grader-returned'))).toBe('Returned ' + today());
    returns.mockRestore();
  });

  it('with only the grade on screen waiting, Return 1 Graded is one click, as the dialog’s Return is', async () => {
    open(QUIZ, BEN);
    await settled();
    const returns = vi.spyOn(Grader, 'returnGrades');
    expect(text(returnAll())).toBe('Return 1 Graded');
    click(returnAll());
    await settled();
    expect(confirmDialog()).toBe(null);
    expect(returns.mock.calls).toEqual([[CID, QUIZ, [BEN]]]);
    expect(GradeState.stateOf(CID, BEN, QUIZ)).toBe('returned');
    returns.mockRestore();
  });

  it('one draft that is not the student on screen asks, and names them', async () => {
    open(QUIZ, AVA);
    await settled();
    click(returnAll());
    expect(asks()).toEqual({
      title: 'Return 1 Grade Now?',
      message: '1 draft: Ben can’t see it yet.',
      buttons: ['Cancel', 'Return 1 Graded'],
    });
    confirmCancel();
  });

  it('pair work: the pair on screen is returned in one click; a partner a search hides is counted and named', async () => {
    open(TALK, AVA);
    await settled();
    expect(name()).toBe('Pair 1');
    // Students, as the gradebook and the phone count: the pair is two.
    expect(segs()).toEqual(['To Return 2', 'Returned 0', 'All 5']);
    expect(text(returnAll())).toBe('Return 2 Graded');
    const returns = vi.spyOn(Grader, 'returnGrades');
    click(returnAll());
    await settled();
    expect(confirmDialog()).toBe(null);
    expect(returns.mock.calls[0][2].slice().sort()).toEqual([AVA, BEN]);
    expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
    returns.mockRestore();
    closePages();
    clearClass(CID);

    // The gradebook's rows are Ben and Cara: Ava is hidden by a search.
    open(TALK, CARA, { studentIds: [BEN, CARA] });
    await settled();
    expect(segs()).toEqual(['To Return 1', 'Returned 0', 'All 2']);
    expect(text(returnAll())).toBe('Return 2 Graded');
    expect(returnAll().getAttribute('title')).toBe('2 drafts: Ava and Ben can’t see them yet.');
    click(returnAll());
    expect(asks().title).toBe('Return 2 Grades Now?');
    confirmOk();
    await settled();
    expect(GradeState.stateOf(CID, AVA, TALK)).toBe('returned');
    expect(GradeState.stateOf(CID, BEN, TALK)).toBe('returned');
  });

  it('pair work: To Return steps to the pair', async () => {
    open(TALK, DEV);
    await settled();
    click(seg('toreturn'));
    await settled();
    expect(name()).toBe('Pair 1');
    expect(prev().disabled).toBe(true);
    expect(next().disabled).toBe(true);
  });

  it('Missing or Excused over a draft is on no count', async () => {
    open(ESSAY, AVA);
    const statuses = getAssignmentStatuses(CID);
    statuses[DEV + ':' + ESSAY] = 'NS';
    saveAssignmentStatuses(CID, statuses);
    click(at('.grader-dialog'));
    await settled();
    expect(segs()).toEqual(['To Return 4', 'Returned 0', 'All 5']);
    expect(text(returnAll())).toBe('Return 4 Graded');
  });
});

/* ── S0-W1: the same screens for a signed-in teacher ───────────────────────
   Once the server has said the class's student page is on, the screens
   S1-F2 built are live for a signed-in teacher, and Return goes to the
   server: return_grades, one call for each student, for that work. (This
   file loads no outbox, so each write goes straight to the recording
   client in the order the page asked for it; the outbox's ordering is in
   tests/grade-return-server.test.js.) */
describe.skipIf(UPDATE)('signed in, in a class the server says holds grades', () => {
  let session;
  const returned = () =>
    session
      .sent()
      .filter(c => c[0] === 'return_grades')
      .map(c => [c[1].p_assessment_id, c[1].p_enrollment_ids, c[1].p_idempotency_key]);
  const at = selector => overlay().querySelector(selector);

  beforeEach(() => {
    session = signIn();
    serverSaysStudentPageOn(CID);
  });
  afterEach(() => {
    serverSaysStudentPageOn(CID, false);
    session.signOut();
  });

  it('the page counts the drafts and marks each row, as it does in Demo Mode', async () => {
    openGraded();
    expandAll();
    await settled();
    expect(text(pill())).toBe('8 to return');
    expect(pillCount()).toBe(GradeState.draftsWaiting(CID));
    expect(toReturnChip(ESSAY)).toBe('5 to return');
    expect(text(cardReturn(ESSAY))).toBe('Return 5 Graded');
    EVERYONE.forEach(sid => expect(mark(ESSAY, sid), sid).toBe('Draft'));
    expect(mark(QUIZ, AVA)).toBe('Returned');
    // A DIBELS benchmark has no state here either.
    expect(card(BENCH).querySelector('.assess-returns, .assess-return-slot, .ret-mark')).toBe(null);
    // Grading sent the scores as it always has, and no return yet.
    expect(returned()).toEqual([]);
  });

  it('with the two settings on the device alone (no word from the server) none of it is drawn or sent', async () => {
    serverSaysStudentPageOn(CID, false);
    openGraded();
    expandAll();
    await settled();
    expect(pill()).toBe(null);
    expect(document.querySelector('#main .assess-to-return, #main .assess-return-btn, #main .ret-mark')).toBe(null);
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    expect(session.sent().filter(c => /grade_return|return_grades|draft_count/.test(c[0]))).toEqual([]);
  });

  it('Return N Graded on a card: asked first, then one return for each student, for that work, each with a key', async () => {
    openGraded({ open: ESSAY });
    await settled();
    click(cardReturn(ESSAY));
    expect(asks()).toEqual({
      title: 'Return 5 Grades Now?',
      message: '5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.',
      buttons: ['Cancel', 'Return 5 Graded'],
    });
    confirmCancel();
    await settled();
    expect(returned()).toEqual([]);
    click(cardReturn(ESSAY));
    confirmOk();
    await settled();
    expect(returned().map(r => [r[0], r[1]])).toEqual(EVERYONE.map(sid => [ESSAY, [sid]]));
    returned().forEach(r => expect(r[2]).toBe('<key>'));
    // Returned on this device at once.
    expect(drafts(ESSAY)).toEqual([]);
    EVERYONE.forEach(sid => expect(mark(ESSAY, sid), sid).toBe('Returned ' + today()));
    expect(text(pill())).toBe('3 to return');
  });

  it('with one student open, Return beside the Draft mark is one click and one return', async () => {
    openGraded({ student: CARA });
    await settled();
    expect(text(inlineReturn(ESSAY))).toBe('Return');
    click(inlineReturn(ESSAY));
    await settled();
    expect(confirmDialog()).toBe(null);
    expect(returned().map(r => [r[0], r[1]])).toEqual([[ESSAY, [CARA]]]);
    expect(text(inlineRow(ESSAY))).toBe('Returned ' + today());
    expect(pill()).toBe(null);
  });

  it('pair work is returned together: one return for each partner', async () => {
    openGraded({ open: TALK });
    await settled();
    click(cardReturn(TALK));
    confirmOk();
    await settled();
    expect(returned().map(r => [r[0], r[1]])).toEqual([
      [TALK, [AVA]],
      [TALK, [BEN]],
    ]);
  });

  it('the grader dialog’s Return N Graded sends the same', async () => {
    openGrader(
      () => {
        seedWith({ config: HELD })();
        grade();
      },
      CID,
      ESSAY,
      BEN,
    );
    await settled();
    expect(text(at('.grader-return-all'))).toBe('Return 5 Graded');
    click(at('.grader-return-all'));
    confirmOk();
    await settled();
    expect(returned().map(r => [r[0], r[1]])).toEqual(EVERYONE.map(sid => [ESSAY, [sid]]));
    expect(at('.grader-return-all')).toBe(null);
    expect(text(at('.grader-returned'))).toBe('Returned ' + today());
  });

  it('in a class the server says is on As Soon As I Save, nothing is drawn and no return is sent', async () => {
    openAssignments(() => {
      seedWith({ config: { student_page_enabled: true, return_grades: 'on_save' } })();
      grade();
    }, CID);
    expandAll();
    await settled();
    expect(pill()).toBe(null);
    expect(document.querySelector('#main .assess-return-btn')).toBe(null);
    expect(returned()).toEqual([]);
  });
});
