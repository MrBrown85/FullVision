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

// The walk as a signed-in teacher, who holds both settings on this device.
function walkSignedIn() {
  const session = signIn();
  try {
    return walk(BOTH_SETTINGS);
  } finally {
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

  it('byte for byte for a signed-in teacher, even with both settings on this device', () => {
    const now = walkSignedIn();
    expect(Object.keys(now)).toEqual(Object.keys(before));
    Object.keys(before).forEach(name => expect(now[name] === beforeSignedIn[name], name).toBe(true));
  });
});
