/**
 * The speed guard: how much work a draw and a click do, counted.
 *
 * What it is for. On Nov 13, 2026, 1,456 scanned sheets were filed and every
 * page that shows work became slow: a lookup copied the whole class's work
 * for each cell. Nothing caught it, because the tests ran on classes with a
 * handful of rows and the speed recorder (e2e-perf/) records and never
 * fails. This file draws the desktop pages for a class the size and state
 * of History 12 that day and counts what each draw and each click costs.
 *
 * It counts; it does not time. A count is the same on every machine, so a
 * limit can be exact (docs/plans/alignment-plan.md, item 49: no limit on a
 * time until the recorder's spread between runs is known). What is counted,
 * for each step:
 *
 *   copied    characters through JSON.parse and JSON.stringify: deep copies
 *             and re-reads of this device's saved class.
 *   saved     characters written to localStorage.
 *   drawn     characters of HTML handed to the page (innerHTML and its kin).
 *   elements  elements on the page once the step is done.
 *   lookups   calls to getScores, getAssessments, getStudents and
 *             getStudentSubmission: how many times the step went back to the
 *             class's lists. A loop over every student of every piece shows
 *             here.
 *   class     whole-class copies of the student work (_studentWorkSubmissions).
 *
 * The limits are the numbers in tests/speed-baseline.json, as
 * tests/file-size-baseline.json holds line counts. A count may stay or come
 * down. It may not grow past its number (2% and 200 are allowed for a clock
 * or an id changing length). When a change brings a count down by a fifth
 * or more, the test asks for the number to be lowered, so the gain is kept.
 *
 * To write the numbers again after a change that is meant to move them:
 *   UPDATE_SPEED_BASELINE=1 npx vitest run tests/speed-guard.test.js
 * and say in the PR which numbers moved and why.
 */
import './setup.js';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseHTML } from 'linkedom';
import {
  U,
  seedClass,
  clearClass,
  openAssignments,
  openGrader,
  closePages,
  click,
  key,
  leave,
} from './helpers/pin-save-paths.js';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'speed-baseline.json');
const baseline = JSON.parse(readFileSync(FILE, 'utf-8'));
const UPDATE = !!process.env.UPDATE_SPEED_BASELINE;
const seen = {};

// History 12 on Nov 13, 2026: 30 students, 36 pieces (half on a two-criterion
// rubric, half on two competencies), every cell scored, the student page on,
// Send Work on, 635 pieces of work in with two pages each.
const CID = U(1);
const RUBRIC = U(60);
const CRIT = [U(61), U(62)];
const TAGS = [U(41), U(42)];
const IDS = Array.from({ length: 30 }, (_, i) => U(100 + i));
const AIDS = Array.from({ length: 36 }, (_, i) => U(300 + i));
const WORDS = { 1: 'Starts the task.', 2: 'Does part of it.', 3: 'Does all of it.', 4: 'Does it and explains why.' };
const onRubric = i => i % 2 === 0;

function seed() {
  const scores = {};
  IDS.forEach((sid, s) => {
    scores[sid] = [];
    AIDS.forEach((aid, a) => {
      (onRubric(a) ? CRIT : TAGS).forEach((key, k) => {
        scores[sid].push({
          id: 'e' + s + '-' + a + '-' + k,
          assessmentId: aid,
          tagId: key,
          score: 1 + ((s + a + k) % 4),
          date: '2026-10-02',
          type: 'summative',
          note: '',
          created: '2026-10-02T12:00:00.000Z',
        });
      });
    });
  });
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'First' + i, lastName: 'Last' + String(i).padStart(2, '0') })),
    learningMaps: {
      subjects: [],
      sections: [
        { id: U(51), name: 'Question', tags: [{ id: TAGS[0], label: 'Question', text: 'Ask questions' }] },
        { id: U(52), name: 'Evidence', tags: [{ id: TAGS[1], label: 'Evidence', text: 'Use evidence' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    rubrics: [
      {
        id: RUBRIC,
        name: 'Historical Thinking',
        criteria: [
          { id: CRIT[0], name: 'Historical Thinking', tagIds: [TAGS[0]], levels: WORDS, checks: [] },
          { id: CRIT[1], name: 'Quality of Answers', tagIds: [TAGS[1]], levels: WORDS, checks: [] },
        ],
      },
    ],
    assessments: AIDS.map((id, i) => ({
      id,
      title: 'Piece ' + (i + 1),
      tagIds: onRubric(i) ? [] : TAGS,
      rubricId: onRubric(i) ? RUBRIC : '',
      date: '2026-10-01',
      dueDate: '2026-10-02',
      type: 'summative',
    })),
    scores,
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  const subs = [];
  let n = 0;
  AIDS.forEach(aid =>
    IDS.forEach((sid, i) => {
      if (subs.length >= 635 || (i * 7 + n++) % 5 === 0) return;
      const k = subs.length;
      const page = p => ({
        id: 'f' + k + '-' + p,
        page: p,
        path: [CID, aid, sid, 's' + k, 'f' + k + '-' + p].join('/') + '.jpg',
        thumb_path: [CID, aid, sid, 's' + k, 'f' + k + '-' + p].join('/') + '-thumb.jpg',
        sha256: ('h' + k + p).padEnd(64, '0'),
        bytes: 400000,
        thumb_bytes: 20000,
        width: 1546,
        height: 2000,
        rotation: 0,
        added_by: 'teacher',
      });
      subs.push({
        id: 's' + k,
        assessment_id: aid,
        enrollment_id: sid,
        version: 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: false,
        is_late: false,
        note: null,
        sent_at: '2026-11-13T19:00:00Z',
        created_at: '2026-11-13T19:00:00Z',
        files: [page(1), page(2)],
      });
    }),
  );
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: AIDS.map(id => ({ id, students_send: 'photos', after_due: 'stop' })),
    submissions: subs,
  });
}

/* ── The meter ─────────────────────────────────────────────── */
const real = {};
const LOOKUPS = ['getScores', 'getAssessments', 'getStudents', 'getStudentSubmission'];
let count = null;
// The class is put in place with the meter off: a step counts the page's work, not the test's.
const quietSeed = () => {
  const mine = count;
  count = null;
  seed();
  count = mine;
};

function meterOn() {
  real.parse = JSON.parse;
  real.stringify = JSON.stringify;
  real.setItem = localStorage.setItem;
  real.work = globalThis._studentWorkSubmissions;
  JSON.parse = function (text) {
    if (count && typeof text === 'string') count.copied += text.length;
    return real.parse.apply(JSON, arguments);
  };
  JSON.stringify = function () {
    const out = real.stringify.apply(JSON, arguments);
    if (count && typeof out === 'string') count.copied += out.length;
    return out;
  };
  localStorage.setItem = function (k, v) {
    if (count) count.saved += String(v).length;
    return real.setItem.apply(localStorage, arguments);
  };
  globalThis._studentWorkSubmissions = function (cid) {
    if (count) count.class++;
    return real.work(cid);
  };
  LOOKUPS.forEach(name => {
    const fn = (real[name] = globalThis[name]);
    globalThis[name] = function () {
      if (count) count.lookups++;
      return fn.apply(this, arguments);
    };
  });
}
function meterOff() {
  JSON.parse = real.parse;
  JSON.stringify = real.stringify;
  localStorage.setItem = real.setItem;
  globalThis._studentWorkSubmissions = real.work;
  LOOKUPS.forEach(name => (globalThis[name] = real[name]));
  count = null;
}

// The HTML handed to the page: innerHTML, outerHTML and insertAdjacentHTML.
// linkedom's element classes are shared by every page it makes, so one
// page made here is enough to meter the pages the helpers make later.
(function meterHtml() {
  let proto = Object.getPrototypeOf(
    parseHTML('<!DOCTYPE html><html><body></body></html>').document.createElement('div'),
  );
  while (proto && !Object.getOwnPropertyDescriptor(proto, 'innerHTML')) proto = Object.getPrototypeOf(proto);
  if (!proto) throw new Error('linkedom has no innerHTML to meter');
  ['innerHTML', 'outerHTML'].forEach(name => {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.set) return;
    Object.defineProperty(proto, name, {
      configurable: true,
      get: d.get,
      set(v) {
        if (count) count.drawn += String(v).length;
        return d.set.call(this, v);
      },
    });
  });
  const insert = proto.insertAdjacentHTML;
  if (insert)
    proto.insertAdjacentHTML = function (where, html) {
      if (count) count.drawn += String(html).length;
      return insert.apply(this, arguments);
    };
})();

/* One step: run it with the meter on, then hold its counts to the baseline. */
function step(name, run) {
  count = { copied: 0, saved: 0, drawn: 0, elements: 0, lookups: 0, class: 0 };
  const mine = count;
  run();
  count = null;
  mine.elements = typeof document.querySelectorAll === 'function' ? document.querySelectorAll('*').length : 0;
  seen[name] = mine;
  if (UPDATE) return mine;
  const limit = baseline[name];
  expect(limit, 'tests/speed-baseline.json has no "' + name + '". Run with UPDATE_SPEED_BASELINE=1.').toBeTruthy();
  Object.keys(mine).forEach(what => {
    const now = mine[what];
    const max = limit[what];
    const said =
      name +
      ': ' +
      what +
      ' is ' +
      now.toLocaleString('en-CA') +
      '; its limit is ' +
      max.toLocaleString('en-CA') +
      '. ';
    expect(
      now <= Math.ceil(max * 1.02) + 200,
      said +
        'This step now does more work than it did. Find what grew (the file’s head says what each count is), or, if it is meant, write the numbers again and say why in the PR.',
    ).toBe(true);
    expect(
      now >= Math.floor(max * 0.8) - 200,
      said +
        'Well done: it came down. Lower the number so the gain is kept: UPDATE_SPEED_BASELINE=1 npx vitest run tests/speed-guard.test.js',
    ).toBe(true);
  });
  return mine;
}

let wasDemo;
beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  meterOn();
});
afterEach(() => {
  meterOff();
  closePages();
  unmount();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});
afterAll(() => {
  if (UPDATE)
    writeFileSync(
      FILE,
      real.stringify ? real.stringify.call(JSON, seen, null, 2) + '\n' : JSON.stringify(seen, null, 2) + '\n',
    );
});

const card = aid => document.getElementById('ac-' + aid);

// These draws are heavy (that is what the file measures), and a shared CI
// machine takes several times longer than a laptop: the counts are held, the
// clock is not.
describe('a class the size of History 12, with 635 pieces of work in', { timeout: 120000 }, () => {
  it('the Assignments page', () => {
    step('Assignments: open', () => openAssignments(quietSeed, CID, {}));
    step('Assignments: open one card', () => click(card(AIDS[0]).querySelector('.assess-title')));
    expect(card(AIDS[0]).querySelector('.rsg-criterion-row'), 'the card did not open').not.toBeNull();
    step('Assignments: click a rubric level', () => {
      const levels = card(AIDS[0]).querySelectorAll('.rsg-level[data-action="selectRubricScore"]');
      expect(levels.length).toBeGreaterThan(8);
      click(levels[5]);
    });
  });

  it('the Gradebook', () => {
    step('Gradebook: open', () => mount(quietSeed, { course: CID }));
    showCompetencies();
    const cell = document.querySelector(
      '#gb-data td.gb-score[data-aid="' + AIDS[1] + '"][data-sid="' + IDS[2] + '"][data-tid="' + TAGS[0] + '"]',
    );
    expect(cell, 'no competency cell to type in').not.toBeNull();
    cell.classList.add('gb-focus');
    cell.focus();
    const before = getScores(CID)[IDS[2]].find(e => e.assessmentId === AIDS[1] && e.tagId === TAGS[0]).score;
    const typed = before === 4 ? '3' : '4';
    step('Gradebook: type a score', () => key(document.querySelector('#gb-data td.gb-focus') || document.body, typed));
    const after = getScores(CID)[IDS[2]].find(e => e.assessmentId === AIDS[1] && e.tagId === TAGS[0]).score;
    expect(after, 'the typed score did not land').toBe(Number(typed));
  });

  it('Edit Score in the Scores view', () => {
    mount(quietSeed, { course: CID });
    const cell = document.querySelector(
      '#gb-data td.gb-scores-cell[data-aid="' + AIDS[1] + '"][data-sid="' + IDS[3] + '"]',
    );
    expect(cell, 'no Scores cell to type in').not.toBeNull();
    cell.classList.add('gb-focus');
    cell.focus();
    const typed = getScores(CID)[IDS[3]].find(e => e.assessmentId === AIDS[1]).score === 4 ? '3' : '4';
    step('Gradebook: Edit Score in the Scores view', () => {
      key(cell, typed);
      const box = document.querySelector('.gb-scores-input');
      expect(box, 'Edit Score did not open').not.toBeNull();
      leave(box);
    });
    expect(
      getScores(CID)
        [IDS[3]].filter(e => e.assessmentId === AIDS[1])
        .map(e => e.score),
    ).toEqual([Number(typed), Number(typed)]);
  });

  it('the grader', () => {
    step('Grader: open on a student', () => openGrader(quietSeed, CID, AIDS[0], IDS[1]));
    expect(document.querySelector('#grader-overlay .grader-dialog'), 'the grader did not open').not.toBeNull();
    step('Grader: next student', () => key(document, 'ArrowRight'));
  });

  // Opened from a gradebook cell, so closing it is the gradebook's to draw.
  it('closing the grader over the gradebook', () => {
    openGrader(quietSeed, CID, AIDS[0], IDS[1]);
    PageAssignments.closeGrader();
    const open = () => {
      click(
        document.querySelector('#gb-data td.gb-scores-cell[data-aid="' + AIDS[0] + '"][data-sid="' + IDS[1] + '"]'),
      );
      expect(document.querySelector('#grader-overlay .grader-dialog'), 'the grader did not open').not.toBeNull();
    };
    open();
    step('Grader: close', () => PageAssignments.closeGrader());
    open();
    // The first criterion is at 2 for this student: 4 changes it.
    click(
      document.querySelector(
        '#grader-overlay [data-action="graderLevel"][data-critid="' + CRIT[0] + '"][data-level="4"]',
      ),
    );
    expect(getScores(CID)[IDS[1]].find(e => e.assessmentId === AIDS[0] && e.tagId === CRIT[0]).score).toBe(4);
    step('Grader: close after a level', () => PageAssignments.closeGrader());
  });

  it('counting the class’s work', () => {
    seed();
    step('Counting the class’s work', () => {
      GraderWork.classWorkCounts(CID);
      AIDS.forEach(aid => IDS.forEach(sid => getStudentSubmission(CID, sid, aid)));
    });
  });
});
