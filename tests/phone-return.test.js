/**
 * The phone's Draft and Returned: Return and Next in the grader, the Grade
 * tab's To Return list with Return N, and the student card's To Return list
 * (S1-F3, docs/plans/student-page-build-plan.md S1).
 *
 * 1. With the build switch off, with Return Grades on As Soon As I Save, and
 *    for a signed-in teacher, the phone's HTML is byte for byte what it was
 *    before this change. tests/fixtures/phone-switch-off.json holds the
 *    phone as origin/main drew it (commit 2df6b0b9, before S1-F3): for a
 *    Proficiency class the Grade tab's list (Recent and All), every grading
 *    screen as it opens, the grading screen after a level, a + and a status,
 *    points, a rubric level and a tick, a Complete mark and pair work, the
 *    list after that grading and every student card; for a Both and a Letter
 *    class the list, the grading screens and the cards. A signed-in teacher's
 *    phone differs from Demo Mode's in one place, on main too: after a save
 *    the sync dot says Syncing. So the snapshot also holds, under "signed
 *    in › …", each picture that differs when the same walk is run signed in.
 *    It was written by this file's own walk, run in a checkout of
 *    origin/main with only this file added:
 *      UPDATE_PHONE_SNAPSHOT=1 npx vitest run tests/phone-return.test.js
 *    Run that only on code from before a change the phone is meant to keep
 *    out; never to make a failing comparison pass.
 * 2. With the switch on and When I Return Them: the grading screen's bar in
 *    each state a grade can be in, Return and Next, the To Return segment,
 *    its rows and their Return N with its question, and the card's list.
 *
 * Every count is read through GradeState.draftsIn, which asks
 * GradeState.stateOf: the function the desktop's grader, gradebook and
 * Class Settings read. tests/phone-return-counts.test.js draws the same
 * class on the gradebook and holds the phone's numbers and words to it.
 */
import './setup-mobile.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, signIn, seedClass, clearClass } from './helpers/pin-save-paths.js';

const SNAPSHOT = join(new URL('.', import.meta.url).pathname, 'fixtures', 'phone-switch-off.json');
const UPDATE = process.env.UPDATE_PHONE_SNAPSHOT === '1';

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
const EVERYONE = [AVA, BEN, CARA, DEV, ELI];

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

function seed({ config = {}, system = 'proficiency', ...more } = {}) {
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
}

/* ── The phone on a linkedom page ───────────────────────────────────────
   The holders teacher-mobile/index.html has. shell.js boots itself, so it
   is not loaded: a tap is sent to the MGrade function shell.js calls. */
let stubDocument = null;
let win = null;

function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  win = dom.window;
  // linkedom has no layout: scrolling is a no-op.
  win.HTMLElement.prototype.scrollTo = function () {};
  win.HTMLElement.prototype.scrollIntoView = function () {};
  // linkedom keeps no focus: focus() sets document.activeElement (the body
  // when nothing, or a removed element, has it).
  let active = null;
  Object.defineProperty(dom.document, 'activeElement', {
    configurable: true,
    get: () => (active && active.isConnected ? active : dom.document.body),
  });
  win.HTMLElement.prototype.focus = function () {
    active = this;
  };
  globalThis.document = dom.document;
  return dom.document;
}
const stack = () => document.getElementById('m-nav-stack');

// The Grade tab's list, drawn as shell.js draws a tab.
function openList() {
  // html-safe: MGrade.renderPicker escapes names and text; a test page
  stack().innerHTML = MGrade.renderPicker(CID);
  MGrade.filterAssessments(CID);
}
// One assessment's grading screen, drawn and wired as shell.js does.
function openGrading(aid) {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, aid);
  MGrade.setupSwiper(CID, aid);
}
// What the Students tab hands each card (teacher-mobile/tab-students.js).
const cardData = () => ({
  sections: getSections(CID),
  statuses: getAssignmentStatuses(CID),
  assessments: getAssessments(CID),
  termId: 'term-1',
  widgetConfig: getCardWidgetConfig(),
});
const cardHtml = sid =>
  MCardWidgets.assembleCard(
    getStudents(CID).find(s => s.id === sid),
    CID,
    cardData(),
  );

/* The walk the snapshot records. Returns { name: html }. */
function walk(config) {
  const out = {};
  for (const system of ['proficiency', 'both', 'letter']) {
    const name = what => system + ' › ' + what;
    const whole = system === 'proficiency';
    localStorage.clear();
    seed({ config, system });
    page();
    openList();
    out[name('Grade list')] = stack().innerHTML;
    MGrade.filterAssessments(CID, 'all');
    out[name('Grade list, All')] = stack().innerHTML;
    getAssessments(CID).forEach(a => {
      out[name('Grading ' + a.title)] = MGrade.renderSwiper(CID, a.id);
    });
    if (whole) {
      openGrading(ESSAY);
      MGrade.setScore(CID, BEN, ESSAY, QUESTION, 3);
      MGrade.setScoreMod(CID, BEN, ESSAY, QUESTION, 1);
      MGrade.setStatus(CID, DEV, ESSAY, 'EXC');
      MGrade.jumpToStudent(1, true);
      out[name('Grading Essay, after a level, a + and a status')] = stack().innerHTML;
      openGrading(QUIZ);
      MGrade.adjustPointsScore(CID, BEN, QUIZ, 1, 10);
      out[name('Grading Quiz, after a point')] = stack().innerHTML;
      openGrading(LAB);
      MGrade.setCriterionScore(CID, BEN, LAB, SAFETY, 3);
      MGrade.tickCheck(CID, BEN, LAB, SAFETY, GOGGLES, true);
      out[name('Grading Lab, after a level and a tick')] = stack().innerHTML;
      openGrading(EXIT);
      MGrade.setCompletion(CID, BEN, EXIT, 'complete');
      out[name('Grading Exit Ticket, after a mark')] = stack().innerHTML;
      openGrading(TALK);
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4);
      out[name('Grading Pair Talk, after a level')] = stack().innerHTML;
      openList();
      out[name('Grade list, after grading')] = stack().innerHTML;
    }
    EVERYONE.forEach(sid => {
      out[name('Card ' + sid.slice(-2))] = cardHtml(sid);
    });
    clearClass(CID);
  }
  return out;
}

beforeEach(() => {
  stubDocument = globalThis.document;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
});

const BOTH_SETTINGS = { student_page_enabled: true, return_grades: 'on_return' };
const SIGNED_IN = 'signed in › ';

/* The walk as a signed-in teacher. The snapshot's signed-in pictures were
   taken on main with both settings on this device, where a signed-in
   teacher's switch read off: so they are main's phone for a signed-in class
   whose student page is off. `asked` is given every RPC the walk sent. */
function walkSignedIn(config, asked) {
  const session = signIn();
  try {
    return walk(config || BOTH_SETTINGS);
  } finally {
    if (asked) session.sent().forEach(c => asked.push(c[0]));
    session.signOut();
  }
}

describe('with the build switch off the phone is what it was', () => {
  if (UPDATE) {
    it('writes the snapshot (run on the code from before the change)', () => {
      const device = walk();
      const signedIn = walkSignedIn();
      const out = { ...device };
      Object.keys(signedIn).forEach(name => {
        if (signedIn[name] !== device[name]) out[SIGNED_IN + name] = signedIn[name];
      });
      writeFileSync(SNAPSHOT, JSON.stringify(out, null, 2) + '\n');
    });
    return;
  }
  const snapshot = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};
  const before = {};
  const beforeSignedIn = {};
  Object.keys(snapshot)
    .filter(name => name.indexOf(SIGNED_IN) !== 0)
    .forEach(name => {
      before[name] = snapshot[name];
      beforeSignedIn[name] = SIGNED_IN + name in snapshot ? snapshot[SIGNED_IN + name] : snapshot[name];
    });

  it('the snapshot covers the list, the grading screens and the cards', () => {
    // 15 a class (2 lists, 8 grading screens, 5 cards), and the Proficiency
    // class's 6 pictures of a grading session.
    expect(Object.keys(before).length).toBe(15 * 3 + 6);
    Object.keys(before).forEach(name => expect(before[name].length, name).toBeGreaterThan(300));
    // Signed in, main differs only on a grading screen after a save, and
    // only in the sync dot.
    const differs = Object.keys(before).filter(name => beforeSignedIn[name] !== before[name]);
    expect(differs.length).toBe(5);
    differs.forEach(name => {
      expect(name).toMatch(/^proficiency › Grading .*, after /);
      expect(
        beforeSignedIn[name].replace(
          'class="tb-sync-dot syncing" id="sync-indicator-dot" title="Syncing..." aria-label="Syncing..."',
          'class="tb-sync-dot idle" id="sync-indicator-dot" title="All changes saved" aria-label="All changes saved"',
        ) === before[name],
        name,
      ).toBe(true);
    });
    // The walk leaves grades entered with the switch off, which are Returned.
    expect(before['proficiency › Grade list, after grading']).not.toBe(before['proficiency › Grade list']);
    expect(before['proficiency › Grading Essay, after a level, a + and a status']).toContain('m-score-active');
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
  ])('byte for byte, in %s', (_, config) => {
    const now = walk(config);
    expect(Object.keys(now)).toEqual(Object.keys(before));
    Object.keys(before).forEach(name => expect(now[name] === before[name], name).toBe(true));
  });

  // Until S0-W1 a signed-in teacher's switch read off whatever the device
  // held, and this test said so with both settings on. The switch is the
  // server's now, so the proof is the one above, signed in: every class
  // that does not hold grades.
  it.each([
    ['a class with neither setting', {}],
    ['a class set to When I Return Them whose student page is off', { return_grades: 'on_return' }],
    ['a class whose student page was turned off again', { student_page_enabled: false, return_grades: 'on_return' }],
    [
      'a class whose student page is on, set to As Soon As I Save',
      { student_page_enabled: true, return_grades: 'on_save' },
    ],
    ['a class whose student page is on with no choice made', { student_page_enabled: true }],
  ])('byte for byte for a signed-in teacher, in %s', (_, config) => {
    const asked = [];
    const now = walkSignedIn(config, asked);
    expect(Object.keys(now)).toEqual(Object.keys(before));
    Object.keys(before).forEach(name => expect(now[name] === beforeSignedIn[name], name).toBe(true));
    // With the student page off, nothing is asked of the server about Draft
    // and Returned or cards.
    if (config.student_page_enabled !== true) {
      expect(asked.filter(name => /grade_return|return_grades|student_card|draft_count/.test(name))).toEqual([]);
    }
  });

  it('and the check can tell: a signed-in class that holds grades is not what main draws (S0-W1)', () => {
    const now = walkSignedIn(BOTH_SETTINGS);
    const changed = Object.keys(before).filter(name => now[name] !== beforeSignedIn[name]);
    expect(changed.length).toBeGreaterThan(0);
  });
});

/* ── With the switch on and When I Return Them ─────────────────────────── */
const HELD = { student_page_enabled: true, return_grades: 'on_return' };
const MC = () => window.MComponents;

// A tap, sent as teacher-mobile/shell.js sends it.
let cardsRedrawn = 0;
function tap(el) {
  if (!el) throw new Error('no such control on the screen');
  if (el.hasAttribute('disabled')) return 'disabled';
  const a = name => el.getAttribute('data-' + name);
  const action = a('action');
  if (el.classList.contains('m-confirm-ok')) return el.onclick();
  if (action === 'm-sheet-cancel') return MC().dismissSheet();
  if (action === 'm-grade-seg') return MGrade.filterAssessments(CID, a('val'));
  if (action === 'm-grade-return-next') return MGrade.returnAndNext();
  if (action === 'm-grade-return-all') return MGrade.askReturnAll(CID, a('aid'), el);
  if (action === 'm-card-return')
    return MGrade.returnFromCard(CID, a('aid'), a('sid'), el, () => {
      cardsRedrawn++;
    });
  if (action === 'm-grade-assess') {
    openGrading(a('aid'));
    if (a('open') === 'draft') MGrade.jumpToFirstDraft(CID, a('aid'));
    return;
  }
  throw new Error('not one of this change’s controls: ' + action);
}

const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const state = (sid, aid) => GradeState.stateOf(CID, sid, aid);
const isDraft = (sid, aid) => state(sid, aid) === 'draft';
const drafts = aid => GradeState.draftsIn(CID, aid, EVERYONE);
// A level, as the desktop grader saves one: the grade is a draft afterwards.
const grade = (sid, aid, tid, level) => Grader.setLevel(CID, sid, aid, tid, level, 0);

// The grading screen's bar.
const bar = () => document.getElementById('m-grade-return');
const barState = () => text(document.getElementById('m-grade-return-state'));
const barButton = () => document.querySelector('#m-grade-return-act button');
const onCard = () => MGrade.getCurrentIndex();
// The next card is on screen: Return and Next takes a tap again.
const slideDone = () => vi.advanceTimersByTime(600);

// The Grade tab's To Return segment and list.
const segment = () => document.querySelector('.m-seg-btn[data-val="toreturn"]');
const segmentCount = () => {
  const n = segment() && segment().querySelector('.m-seg-count');
  return n ? parseInt(n.textContent, 10) : 0;
};
const panel = () => document.getElementById('m-grade-to-return');
const rows = () => Array.from(panel().querySelectorAll('.m-to-return-row'));
const row = aid => rows().find(r => r.getAttribute('data-aid') === aid);
const rowCount = aid => parseInt(text(row(aid).querySelector('.m-draft-mark')), 10);
const returnN = aid => row(aid).querySelector('[data-action="m-grade-return-all"]');
function openToReturn() {
  openList();
  tap(segment());
}

// The confirm sheet.
const sheet = () => document.querySelector('#m-sheet-container .m-confirm-sheet');
const sheetClosed = () => vi.advanceTimersByTime(400);

// A student's card, on a page of its own.
function card(sid) {
  // html-safe: MCardWidgets.assembleCard escapes names and text; a test page
  stack().innerHTML = cardHtml(sid);
  return stack().querySelector('.m-scard-return');
}
const cardRows = () =>
  Array.from(stack().querySelectorAll('.m-scard-return-row')).map(r => ({
    title: text(r.querySelector('.m-scard-return-title')),
    mark: text(r.querySelector('.m-draft-mark')),
    line: text(r.querySelector('.m-scard-return-text')),
    button: r.querySelector('[data-action="m-card-return"]'),
  }));

describe('with the switch on and When I Return Them', () => {
  let returned;

  function held(more) {
    localStorage.clear();
    seed({ config: HELD, ...more });
    page();
    // The tab remembers To Return from one test to the next: start on Recent.
    MGrade.filterAssessments(CID, 'recent');
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
    returned = vi.spyOn(Grader, 'returnGrades');
    cardsRedrawn = 0;
  });
  afterEach(() => {
    // Let a slide or a closing sheet finish before the next test.
    vi.advanceTimersByTime(1000);
    returned.mockRestore();
  });

  describe('the grading screen', () => {
    it('with nothing in, Return and Next is greyed out and there is no Draft mark', () => {
      held();
      openGrading(ESSAY);
      MGrade.jumpToStudent(1, true); // Ben: no grade, no status
      expect(barState()).toBe('');
      expect(text(barButton())).toBe('Return and Next');
      expect(barButton().hasAttribute('disabled')).toBe(true);
      expect(tap(barButton())).toBe('disabled');
    });

    it('a grade from before the switch came on reads Returned, with no date and no button', () => {
      held();
      openGrading(ESSAY); // Ava, graded in the seed
      expect(barState()).toBe('Returned');
      expect(barButton()).toBe(null);
    });

    it('a status with nothing in shows nothing: Missing is not a grade', () => {
      held();
      openGrading(ESSAY);
      MGrade.jumpToStudent(2, true); // Cara: Missing
      expect(barState()).toBe('');
      expect(barButton()).toBe(null);
      expect(bar().classList.contains('is-empty')).toBe(true);
    });

    it('a level makes a draft: the Draft mark, the desktop’s words and Return and Next', () => {
      held();
      openGrading(ESSAY);
      MGrade.jumpToStudent(1, true);
      MGrade.setScore(CID, BEN, ESSAY, QUESTION, 3);
      expect(isDraft(BEN, ESSAY)).toBe(true);
      expect(text(bar().querySelector('.m-draft-mark'))).toBe('Draft');
      expect(barState()).toBe('DraftSaved. Not returned yet.');
      expect(text(barButton())).toBe('Return and Next');
      expect(barButton().hasAttribute('disabled')).toBe(false);
      expect(bar().classList.contains('is-empty')).toBe(false);
      // The line that says where the grade stands is read out when it changes.
      expect(document.getElementById('m-grade-return-state').getAttribute('role')).toBe('status');
    });

    it.each([
      ['a + on a level', () => MGrade.setScoreMod(CID, AVA, ESSAY, QUESTION, 1)],
      ['a level cleared', () => MGrade.setScore(CID, AVA, ESSAY, QUESTION, 3)],
    ])('%s of a returned grade is a draft, and says what the student still sees', (_, change) => {
      held();
      openGrading(ESSAY);
      change();
      expect(isDraft(AVA, ESSAY)).toBe(true);
      expect(barState()).toBe('DraftSaved. Not returned yet.Ava still sees the grade you returned.');
    });

    it('Late is a status, never a draft: the grade stays Returned', () => {
      held();
      openGrading(ESSAY);
      MGrade.setStatus(CID, AVA, ESSAY, 'LATE');
      expect(isDraft(AVA, ESSAY)).toBe(false);
      expect(barState()).toBe('Returned');
    });

    it('every kind of save on the screen updates the bar', () => {
      held();
      const saves = [
        [QUIZ, () => MGrade.adjustPointsScore(CID, BEN, QUIZ, 1, 10)],
        [LAB, () => MGrade.setCriterionScore(CID, BEN, LAB, SAFETY, 3)],
        [LAB, () => MGrade.tickCheck(CID, BEN, LAB, SAFETY, GOGGLES, true)],
        [EXIT, () => MGrade.setCompletion(CID, BEN, EXIT, 'complete')],
        [JOURNAL, () => MGrade.setScore(CID, BEN, JOURNAL, 'overall', 3)],
      ];
      saves.forEach(([aid, save]) => {
        clearClass(CID);
        held();
        openGrading(aid);
        MGrade.jumpToStudent(1, true); // Ben
        expect(barState(), aid).toBe('');
        save();
        expect(isDraft(BEN, aid), aid).toBe(true);
        expect(barState(), aid).toBe('DraftSaved. Not returned yet.');
      });
    });

    it('a comment typed makes a draft once it is saved', () => {
      held();
      openGrading(ESSAY);
      MGrade.jumpToStudent(1, true);
      const box = document.getElementById('m-overall-' + BEN + '-' + ESSAY);
      box.value = 'Clear questions.';
      box.dispatchEvent(new win.Event('focusout', { bubbles: true }));
      expect(getScoreComment(CID, BEN, ESSAY)).toBe('Clear questions.');
      expect(barState()).toBe('DraftSaved. Not returned yet.');
    });

    it('Return and Next returns the one grade on screen in one tap and shows the next card', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      grade(DEV, ESSAY, QUESTION, 2);
      openGrading(ESSAY);
      MGrade.jumpToStudent(1, true);
      tap(barButton());
      // No question is asked, and only Ben's grade is returned.
      expect(sheet()).toBe(null);
      expect(returned).toHaveBeenCalledTimes(1);
      expect(returned).toHaveBeenCalledWith(CID, ESSAY, [BEN]);
      expect(state(BEN, ESSAY)).toBe('returned');
      expect(isDraft(DEV, ESSAY)).toBe(true);
      expect(onCard()).toBe(2); // Cara, who is Missing: nothing to say
      expect(barState()).toBe('');
      // Back on Ben: Returned, with the day.
      slideDone();
      MGrade.jumpToStudent(1, true);
      expect(barState()).toBe('Returned Nov 10');
      expect(barButton()).toBe(null);
    });

    it('a second tap while the next card slides in returns nothing', () => {
      held();
      Grader.setPoints(CID, AVA, QUIZ, 9);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      openGrading(QUIZ);
      tap(barButton());
      expect(onCard()).toBe(1);
      expect(text(barButton())).toBe('Return and Next'); // Ben's, already showing
      tap(barButton());
      expect(returned).toHaveBeenCalledTimes(1);
      expect(isDraft(BEN, QUIZ)).toBe(true);
      expect(onCard()).toBe(1);
      // Once the card is on screen the tap counts.
      slideDone();
      tap(barButton());
      expect(returned).toHaveBeenCalledTimes(2);
      expect(state(BEN, QUIZ)).toBe('returned');
      expect(onCard()).toBe(2);
    });

    it('on the last card the button says Return, and the card stays', () => {
      held();
      grade(ELI, ESSAY, QUESTION, 2); // a change to Eli's returned grade
      openGrading(ESSAY);
      MGrade.jumpToStudent(4, true);
      expect(text(barButton())).toBe('Return');
      tap(barButton());
      expect(returned).toHaveBeenCalledWith(CID, ESSAY, [ELI]);
      expect(onCard()).toBe(4);
      expect(barState()).toBe('Returned Nov 10');
    });

    it('a returned grade changed again says what the student still sees, with the day', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      Grader.returnGrades(CID, ESSAY, [BEN]);
      vi.setSystemTime(new Date('2026-11-12T18:00:00.000Z'));
      openGrading(ESSAY);
      MGrade.jumpToStudent(1, true);
      MGrade.setScore(CID, BEN, ESSAY, QUESTION, 4);
      expect(barState()).toBe('DraftSaved. Not returned yet.Ben still sees the grade you returned Nov 10.');
      // Put back to what was returned, it is not a draft.
      MGrade.setScore(CID, BEN, ESSAY, QUESTION, 3);
      expect(barState()).toBe('Returned Nov 10');
    });

    it('what is typed and not saved yet is saved before the grade is returned', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      openGrading(ESSAY);
      MGrade.jumpToStudent(1, true);
      // Typed, and the button tapped before the comment's own save ran.
      document.getElementById('m-overall-' + BEN + '-' + ESSAY).value = 'Clear questions.';
      tap(barButton());
      expect(getScoreComment(CID, BEN, ESSAY)).toBe('Clear questions.');
      expect(state(BEN, ESSAY)).toBe('returned');
      // The comment went with the grade: nothing waits behind it.
      vi.advanceTimersByTime(2000);
      expect(state(BEN, ESSAY)).toBe('returned');
      expect(GradeState.draftsWaiting(CID)).toBe(0);
    });

    it('a pair’s card returns both partners together, and names the pair', () => {
      held();
      openGrading(TALK);
      expect(barState()).toBe('Returned');
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4); // the pair's card: fills Ava and Ben
      expect(drafts(TALK)).toEqual([AVA, BEN]);
      expect(barState()).toBe('DraftSaved. Not returned yet.Pair 1 still sees the grade you returned.');
      tap(barButton());
      expect(sheet()).toBe(null);
      expect(returned).toHaveBeenCalledWith(CID, TALK, [AVA, BEN]);
      expect(drafts(TALK)).toEqual([]);
    });

    it('the bar follows the card on screen when the cards are drawn again under it', () => {
      held();
      openGrading(TALK);
      MGrade.jumpToStudent(1, true); // Cara
      MGrade.setScore(CID, CARA, TALK, QUESTION, 2);
      expect(barState()).toBe('DraftSaved. Not returned yet.');
      // Late on group work draws every card again; Cara's is still on screen.
      MGrade.setStatus(CID, CARA, TALK, 'LATE');
      expect(onCard()).toBe(1);
      expect(barState()).toBe('DraftSaved. Not returned yet.');
      // Ben graded separately gets a card of his own after the pair's: the
      // second card is now his, and his grade was returned.
      MGrade.gradeSeparately(CID, TALK, BEN);
      expect(document.querySelectorAll('.m-swiper-card')[1].getAttribute('data-sid')).toBe(BEN);
      expect(barState()).toBe('Returned');
      expect(barButton()).toBe(null);
    });

    it('a DIBELS benchmark has no bar to speak of, whatever is saved on it', () => {
      held();
      Grader.setDibels(CID, AVA, BENCH, 'boy', { orfWrc: 90 });
      openGrading(BENCH);
      expect(barState()).toBe('');
      expect(barButton()).toBe(null);
      expect(bar().classList.contains('is-empty')).toBe(true);
    });

    it('a To Return row opens the grading screen on the first draft', () => {
      held();
      grade(DEV, ESSAY, QUESTION, 2);
      openToReturn();
      tap(row(ESSAY).querySelector('.m-to-return-open'));
      expect(onCard()).toBe(3);
      expect(barState()).toBe('DraftSaved. Not returned yet.');
    });
  });

  describe('the Grade tab’s To Return list', () => {
    it('with no drafts: the segment has no count and the list says so', () => {
      held();
      openList();
      expect(text(segment())).toBe('To Return');
      expect(segment().hasAttribute('aria-label')).toBe(false);
      expect(panel().hasAttribute('hidden')).toBe(true);
      tap(segment());
      expect(panel().hasAttribute('hidden')).toBe(false);
      expect(document.getElementById('m-grade-main').hasAttribute('hidden')).toBe(true);
      expect(text(panel().querySelector('.m-empty-title'))).toBe('Nothing to Return');
      expect(text(panel().querySelector('.m-empty-subtitle'))).toBe('No grades are waiting as drafts in Science 8.');
      // See All Assessments goes to All.
      tap(panel().querySelector('[data-action="m-grade-seg"]'));
      expect(panel().hasAttribute('hidden')).toBe(true);
      expect(document.querySelector('.m-seg-btn[data-val="all"]').getAttribute('aria-pressed')).toBe('true');
      expect(segment().getAttribute('aria-pressed')).toBe('false');
    });

    it('lists each assessment with a draft, newest first, with who is waiting', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      grade(DEV, ESSAY, QUESTION, 2);
      grade(ELI, ESSAY, QUESTION, 1);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      openToReturn();
      expect(text(segment())).toBe('To Return4');
      expect(segment().getAttribute('aria-label')).toBe('To Return, 4 drafts');
      expect(segment().getAttribute('aria-pressed')).toBe('true');
      expect(rows().map(r => r.getAttribute('data-aid'))).toEqual([QUIZ, ESSAY]);
      expect(text(row(ESSAY).querySelector('.m-to-return-title'))).toBe('Essay');
      expect(text(row(ESSAY).querySelector('.m-draft-mark'))).toBe('3 drafts');
      expect(text(row(ESSAY).querySelector('.m-to-return-names'))).toBe('Ben, Dev, Eli');
      expect(text(row(ESSAY).querySelector('.m-to-return-meta'))).toBe('Oct 10');
      expect(text(returnN(ESSAY))).toBe('Return 3');
      expect(returnN(ESSAY).getAttribute('aria-label')).toBe('Return 3 Graded, Essay');
      expect(text(row(QUIZ).querySelector('.m-draft-mark'))).toBe('1 draft');
      expect(text(row(QUIZ).querySelector('.m-to-return-names'))).toBe('Ben');
      expect(text(returnN(QUIZ))).toBe('Return 1');
      expect(text(panel().querySelector('.m-to-return-note'))).toBe(
        'Graded but not returned. Students see these after you return them.',
      );
    });

    it('one draft reads "To Return, 1 draft"', () => {
      held();
      Grader.setPoints(CID, BEN, QUIZ, 8);
      openList();
      expect(segment().getAttribute('aria-label')).toBe('To Return, 1 draft');
    });

    it('Return N asks first, for one draft too, in the desktop’s words', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      grade(DEV, ESSAY, QUESTION, 2);
      grade(ELI, ESSAY, QUESTION, 1);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      openToReturn();
      tap(returnN(ESSAY));
      expect(returned).not.toHaveBeenCalled();
      expect(sheet().getAttribute('role')).toBe('dialog');
      expect(sheet().getAttribute('aria-modal')).toBe('true');
      expect(text(document.getElementById(sheet().getAttribute('aria-labelledby')))).toBe('Return 3 Grades Now?');
      expect(text(document.getElementById(sheet().getAttribute('aria-describedby')))).toBe(
        '3 drafts: Ben, Dev and Eli can’t see them yet.',
      );
      expect(Array.from(sheet().querySelectorAll('button')).map(text)).toEqual(['Return 3 Graded', 'Cancel']);
      // The focus starts on Cancel.
      expect(text(document.activeElement)).toBe('Cancel');
      tap(sheet().querySelector('[data-action="m-sheet-cancel"]'));
      sheetClosed();
      expect(sheet()).toBe(null);
      expect(returned).not.toHaveBeenCalled();
      expect(drafts(ESSAY)).toEqual([BEN, DEV, ELI]);
      // Cancel gives the focus back to the button that asked.
      expect(document.activeElement).toBe(returnN(ESSAY));

      tap(returnN(QUIZ));
      expect(text(sheet().querySelector('#m-confirm-title'))).toBe('Return 1 Grade Now?');
      expect(text(sheet().querySelector('#m-confirm-text'))).toBe('1 draft: Ben can’t see it yet.');
      expect(text(sheet().querySelector('.m-confirm-ok'))).toBe('Return 1 Graded');
    });

    it('Return N Graded returns every draft on the assessment in one action, and the list follows', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      grade(DEV, ESSAY, QUESTION, 2);
      grade(ELI, ESSAY, QUESTION, 1);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      openToReturn();
      tap(returnN(ESSAY));
      tap(sheet().querySelector('.m-confirm-ok'));
      sheetClosed();
      expect(returned).toHaveBeenCalledTimes(1);
      expect(returned.mock.calls[0].slice(0, 2)).toEqual([CID, ESSAY]);
      expect(returned.mock.calls[0][2].slice().sort()).toEqual([BEN, DEV, ELI]);
      expect(drafts(ESSAY)).toEqual([]);
      expect(isDraft(BEN, QUIZ)).toBe(true);
      expect(rows().map(r => r.getAttribute('data-aid'))).toEqual([QUIZ]);
      expect(text(segment())).toBe('To Return1');
      // The row is gone: the next row takes the focus.
      expect(document.activeElement).toBe(row(QUIZ).querySelector('.m-to-return-open'));

      tap(returnN(QUIZ));
      tap(sheet().querySelector('.m-confirm-ok'));
      sheetClosed();
      expect(GradeState.draftsWaiting(CID)).toBe(0);
      expect(text(segment())).toBe('To Return');
      expect(text(panel().querySelector('.m-empty-title'))).toBe('Nothing to Return');
      expect(document.activeElement).toBe(segment());
    });

    it('the drafts are counted again when the question is answered', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      grade(DEV, ESSAY, QUESTION, 2);
      openToReturn();
      tap(returnN(ESSAY));
      // Dev's is returned somewhere else while the question waits.
      Grader.returnGrades(CID, ESSAY, [DEV]);
      returned.mockClear();
      tap(sheet().querySelector('.m-confirm-ok'));
      expect(returned).toHaveBeenCalledWith(CID, ESSAY, [BEN]);
    });

    it('pair work: the row counts and names both partners, and both are returned', () => {
      held();
      openGrading(TALK);
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4);
      openToReturn();
      expect(text(row(TALK).querySelector('.m-draft-mark'))).toBe('2 drafts');
      expect(text(row(TALK).querySelector('.m-to-return-names'))).toBe('Ava, Ben');
      tap(returnN(TALK));
      expect(text(sheet().querySelector('#m-confirm-text'))).toBe('2 drafts: Ava and Ben can’t see them yet.');
      tap(sheet().querySelector('.m-confirm-ok'));
      expect(drafts(TALK)).toEqual([]);
    });

    it('a Missing or Excused piece is never a draft: a partner under Missing is not counted or named', () => {
      held({ statuses: { ...STATUSES, [BEN + ':' + TALK]: 'NS' } });
      openGrading(TALK);
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4);
      // Ben is Missing: the pair's new grade is Ava's alone.
      expect(isDraft(BEN, TALK)).toBe(false);
      openToReturn();
      expect(text(row(TALK).querySelector('.m-draft-mark'))).toBe('1 draft');
      expect(text(row(TALK).querySelector('.m-to-return-names'))).toBe('Ava');
      expect(text(segment())).toBe('To Return1');
      expect(GradeState.draftsWaiting(CID)).toBe(1);
    });

    it('a grade waiting under Excused shows its status, not Draft, and is on no count', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      grade(DEV, ESSAY, QUESTION, 2);
      // Excused set past the screens' own rule, as a write from outside the app could.
      saveAssignmentStatuses(CID, { ...getAssignmentStatuses(CID), [BEN + ':' + ESSAY]: 'EXC' });
      expect(getGradeReturn(CID, BEN, ESSAY).is_draft).toBe(true);
      expect(state(BEN, ESSAY)).toBe(null);
      openToReturn();
      expect(text(row(ESSAY).querySelector('.m-draft-mark'))).toBe('1 draft');
      expect(text(row(ESSAY).querySelector('.m-to-return-names'))).toBe('Dev');
      expect(segmentCount()).toBe(1);
      expect(GradeState.draftsWaiting(CID)).toBe(1);
      expect(card(BEN)).toBe(null);
      openGrading(ESSAY);
      MGrade.jumpToStudent(1, true);
      expect(barState()).toBe('');
      expect(barButton()).toBe(null);
    });

    it('a DIBELS benchmark is never on the list', () => {
      held();
      Grader.setDibels(CID, AVA, BENCH, 'boy', { orfWrc: 90 });
      openToReturn();
      expect(rows()).toEqual([]);
      expect(text(segment())).toBe('To Return');
    });

    it('the tab’s count is the rows added up, GradeState.draftsWaiting, and draftsIn for each row', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      grade(DEV, ESSAY, PLAN, 2);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      Grader.setPoints(CID, CARA, QUIZ, 6);
      Grader.setMark(CID, DEV, EXIT, 'complete');
      Grader.setLevel(CID, ELI, JOURNAL, 'overall', 2, 0);
      openGrading(TALK);
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4);
      openToReturn();
      const shown = rows().map(r => r.getAttribute('data-aid'));
      expect(shown.slice().sort()).toEqual([ESSAY, QUIZ, EXIT, JOURNAL, TALK].sort());
      shown.forEach(aid => expect(rowCount(aid), aid).toBe(drafts(aid).length));
      const sum = shown.reduce((n, aid) => n + rowCount(aid), 0);
      expect(sum).toBe(8);
      expect(segmentCount()).toBe(sum);
      expect(GradeState.draftsWaiting(CID)).toBe(sum);
    });

    it('a saved filter never hides a draft: the list is every assessment with one', () => {
      held();
      localStorage.setItem(
        'gb-grade-filters-' + CID,
        JSON.stringify({ category: [], module: [], dateRange: 'week', gradedStatus: 'fully-graded' }),
      );
      grade(BEN, ESSAY, QUESTION, 3);
      openList();
      // Every assessment is filtered out of the list of assessments.
      const visible = Array.from(document.querySelectorAll('#m-grade-list .m-cell')).filter(
        c => c.style.display !== 'none',
      );
      expect(visible).toEqual([]);
      tap(segment());
      expect(rows().map(r => r.getAttribute('data-aid'))).toEqual([ESSAY]);
    });

    it('the list stays on To Return when the tab is drawn again, and follows a return made elsewhere', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      openToReturn();
      Grader.returnGrades(CID, QUIZ, [BEN]);
      // Back from a grading screen: shell.js asks for the list again.
      MGrade.refreshToReturn(CID);
      expect(rows().map(r => r.getAttribute('data-aid'))).toEqual([ESSAY]);
      expect(text(segment())).toBe('To Return1');
      openList();
      expect(segment().classList.contains('m-seg-active')).toBe(true);
      expect(panel().hasAttribute('hidden')).toBe(false);
      expect(rows().length).toBe(1);
    });
  });

  describe('the student card’s To Return list', () => {
    it('lists the student’s drafts with the Draft mark, the grade and Return', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      Grader.setMark(CID, BEN, EXIT, 'complete');
      Grader.setOverallComment(CID, BEN, JOURNAL, 'See me about this one.');
      expect(text(card(BEN).querySelector('.m-scard-return-head'))).toBe('To Return');
      const list = cardRows();
      // Newest first.
      expect(list.map(r => r.title)).toEqual(['Journal', 'Exit Ticket', 'Quiz', 'Essay']);
      list.forEach(r => expect(r.mark).toBe('Draft'));
      expect(list.map(r => r.line)).toEqual([
        'Ben can’t see it yet', // a comment alone: no grade to show
        'Complete · Ben can’t see it yet',
        '8/10 · 80% · Ben can’t see it yet',
        '3.0 · Ben can’t see it yet',
      ]);
      expect(list.map(r => text(r.button))).toEqual(['Return', 'Return', 'Return', 'Return']);
      expect(list[3].button.getAttribute('aria-label')).toBe('Return, Essay');
      // The grade is the piece's cell, as calc.js gives it.
      expect(list[3].line.split(' · ')[0]).toBe(
        assessmentCellValue(
          CID,
          BEN,
          getAssessments(CID).find(a => a.id === ESSAY),
        ).text,
      );
    });

    it('a Letter class shows the grade its way', () => {
      held({ system: 'letter' });
      grade(BEN, ESSAY, QUESTION, 3);
      card(BEN);
      const cell = assessmentCellValue(
        CID,
        BEN,
        getAssessments(CID).find(a => a.id === ESSAY),
      );
      expect(cell.text).toMatch(/%$/);
      expect(cardRows()[0].line).toBe(cell.text + ' · Ben can’t see it yet');
    });

    it('a student with no draft has the card a class that holds no grades draws', () => {
      const others = [AVA, CARA, DEV, ELI];
      localStorage.clear();
      seed();
      grade(BEN, ESSAY, QUESTION, 3);
      const plain = others.map(cardHtml);
      clearClass(CID);
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      expect(card(CARA)).toBe(null);
      others.forEach((sid, i) => expect(cardHtml(sid) === plain[i], sid).toBe(true));
      expect(cardHtml(BEN)).toContain('m-scard-return');
    });

    it('Return on the card returns that one grade in one tap', () => {
      held();
      grade(BEN, ESSAY, QUESTION, 3);
      Grader.setPoints(CID, BEN, QUIZ, 8);
      grade(DEV, ESSAY, QUESTION, 2);
      card(BEN);
      tap(cardRows()[1].button); // the Essay
      expect(sheet()).toBe(null);
      expect(returned).toHaveBeenCalledTimes(1);
      expect(returned).toHaveBeenCalledWith(CID, ESSAY, [BEN]);
      expect(cardsRedrawn).toBe(1);
      expect(state(BEN, ESSAY)).toBe('returned');
      expect(isDraft(DEV, ESSAY)).toBe(true);
      card(BEN);
      expect(cardRows().map(r => r.title)).toEqual(['Quiz']);
    });

    it('on pair work it asks first and names both, because both are returned', () => {
      held();
      openGrading(TALK);
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4);
      card(BEN);
      expect(cardRows().map(r => r.title)).toEqual(['Pair Talk']);
      tap(cardRows()[0].button);
      expect(returned).not.toHaveBeenCalled();
      expect(text(sheet().querySelector('#m-confirm-title'))).toBe('Return 2 Grades Now?');
      expect(text(sheet().querySelector('#m-confirm-text'))).toBe('2 drafts: Ava and Ben can’t see them yet.');
      expect(text(sheet().querySelector('.m-confirm-ok'))).toBe('Return 2 Graded');
      tap(sheet().querySelector('[data-action="m-sheet-cancel"]'));
      sheetClosed();
      expect(drafts(TALK)).toEqual([AVA, BEN]);
      expect(cardsRedrawn).toBe(0);
      tap(cardRows()[0].button);
      tap(sheet().querySelector('.m-confirm-ok'));
      expect(returned).toHaveBeenCalledWith(CID, TALK, [BEN, AVA]);
      expect(drafts(TALK)).toEqual([]);
      expect(cardsRedrawn).toBe(1);
    });

    it('a partner already returned is not asked about: one tap returns the one draft', () => {
      held();
      openGrading(TALK);
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4);
      // Ben is graded separately from here, and changed; Ava's is returned.
      Grader.returnGrades(CID, TALK, [AVA, BEN]);
      Grader.gradeSeparately(CID, TALK, BEN);
      grade(BEN, TALK, QUESTION, 2);
      card(BEN);
      tap(cardRows()[0].button);
      expect(sheet()).toBe(null);
      expect(state(BEN, TALK)).toBe('returned');
    });

    it('a Missing piece and a DIBELS benchmark are never on the card', () => {
      held({ statuses: { ...STATUSES, [BEN + ':' + TALK]: 'NS' } });
      openGrading(TALK);
      MGrade.setScore(CID, AVA, TALK, QUESTION, 4);
      Grader.setDibels(CID, BEN, BENCH, 'boy', { orfWrc: 90 });
      expect(card(BEN)).toBe(null);
      expect(MGrade.studentDrafts(CID, BEN)).toEqual([]);
    });

    it('no number on the card moves because a grade is a draft', () => {
      // The same grading in a class that holds grades and one that does not.
      const grading = () => {
        grade(BEN, ESSAY, QUESTION, 3);
        grade(BEN, ESSAY, PLAN, 4);
        Grader.setPoints(CID, BEN, QUIZ, 8);
      };
      held();
      grading();
      const withDrafts = cardHtml(BEN);
      const box = card(BEN).outerHTML;
      clearClass(CID);
      localStorage.clear();
      seed({ config: { student_page_enabled: true, return_grades: 'on_save' } });
      grading();
      expect(withDrafts.replace(box, '') === cardHtml(BEN)).toBe(true);
    });
  });

  describe('the words are the desktop’s', () => {
    it.each([
      [[BEN], '1 draft: Ben can’t see it yet.'],
      [[BEN, AVA], '2 drafts: Ava and Ben can’t see them yet.'],
      [[DEV, BEN, AVA], '3 drafts: Ava, Ben and Dev can’t see them yet.'],
      [[DEV, BEN, AVA, CARA], '4 drafts: Ava, Ben, Cara and 1 other can’t see them yet.'],
      [[ELI, DEV, BEN, AVA, CARA], '5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.'],
    ])('the drafts line for %#', (sids, line) => {
      held();
      expect(MGrade.draftsSentence(CID, sids)).toBe(line);
    });
  });
});

describe('a class that stops holding grades has nothing to return on the phone', () => {
  it('the bar, the segment and the card list are gone, and the actions do nothing', () => {
    localStorage.clear();
    seed({ config: HELD });
    page();
    Grader.setLevel(CID, BEN, ESSAY, QUESTION, 3, 0);
    // As Soon As I Save chosen in Class Settings: the waiting drafts are returned.
    saveCourseConfig(CID, { ...getCourseConfig(CID), return_grades: 'on_save' });
    expect(GradeState.draftsWaiting(CID)).toBe(0);
    const returned = vi.spyOn(Grader, 'returnGrades');
    openList();
    expect(segment()).toBe(null);
    expect(document.getElementById('m-grade-to-return')).toBe(null);
    MGrade.filterAssessments(CID, 'toreturn');
    expect(document.querySelector('.m-seg-btn.m-seg-active').getAttribute('data-val')).toBe('recent');
    openGrading(ESSAY);
    expect(bar()).toBe(null);
    MGrade.returnAndNext();
    MGrade.askReturnAll(CID, ESSAY, null);
    MGrade.returnFromCard(CID, ESSAY, BEN, null, () => {
      throw new Error('nothing to return');
    });
    expect(returned).not.toHaveBeenCalled();
    expect(MGrade.studentDrafts(CID, BEN)).toEqual([]);
    expect(stack().innerHTML).not.toMatch(/m-grade-return|m-draft-mark|m-has-return|To Return/);
    expect(cardHtml(BEN)).not.toMatch(/m-scard-return|Draft/);
    returned.mockRestore();
  });
});
