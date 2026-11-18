/**
 * Quiz results (slice Q4 of docs/plans/quizzes-plan.md) with the quizzes
 * switch off: the Assignments page is byte for byte what it was.
 *
 * Q4 adds two things to the page, both behind the switch: a line on a quiz
 * piece's card ("12 Answered · Confirm Levels") and See Quiz Results in its
 * ⋯ menu. tests/fixtures/quiz-results-switch-off.json holds the page as
 * origin/main drew it before Q4: Demo Mode's Science 8 (every kind of piece
 * the sample class has) and a signed-in class, in Proficiency, Letter and
 * Both, with every card shut and every card open (the menus are in the
 * page), the localStorage keys each walk left, and every server call the
 * signed-in walk made, by name and in order. It was written by this file's
 * own walk on that commit, with only this file added:
 *   UPDATE_QUIZ_RESULTS_SNAPSHOT=1 npx vitest run tests/quiz-results-switch-off.test.js
 * Run that only on code from before a change the page is meant to keep out;
 * never to make a failing comparison pass.
 */
import './setup.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, signIn, seedClass, clearClass, click, openAssignments, closePages } from './helpers/pin-save-paths.js';
import { runInThisContext } from 'node:vm';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const SNAPSHOT = join(new URL('.', import.meta.url).pathname, 'fixtures', 'quiz-results-switch-off.json');
const UPDATE = process.env.UPDATE_QUIZ_RESULTS_SNAPSHOT === '1';

// Demo Mode's sample class: seed-data.js, run once here as the browser runs it.
runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const T1 = U(41);
const T2 = U(42);

function signedInSeed(system) {
  return () => {
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brooks' },
      ],
      learningMaps: {
        subjects: [],
        sections: [
          { id: U(51), name: 'Question', tags: [{ id: T1, label: 'Questioning', code: 'QP1', text: 'Ask' }] },
          { id: U(52), name: 'Patterns', tags: [{ id: T2, label: 'Data Patterns', code: 'PA4', text: 'Find' }] },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        { id: U(31), title: 'Essay', tagIds: [T1, T2], date: '2026-10-10', type: 'summative', evidenceType: 'quiz' },
        { id: U(32), title: 'Points Check', scoreMode: 'points', maxPoints: 10, tagIds: [T1], date: '2026-10-11' },
        { id: U(33), title: 'Draft Check', tagIds: [T2], date: '2026-10-12', isDraft: true },
      ],
      scores: { [AVA]: [{ assessmentId: U(31), tagId: T1, score: 3, date: '2026-10-10', type: 'summative' }] },
      statuses: { [BEN + ':' + U(32)]: 'EXC' },
      courseConfigs: { [CID]: { student_page_enabled: true, return_grades: 'on_return' } },
    });
    COURSES[CID].gradingSystem = system;
  };
}

const settled = () => new Promise(r => setTimeout(r, 10));
const main = () => document.getElementById('main').innerHTML;
const toolbar = () => document.getElementById('page-toolbar-mount').innerHTML;
const hash = s => 'sha256:' + createHash('sha256').update(s).digest('hex') + ' of ' + s.length + ' characters';

async function pictures(seed, cid, out, name) {
  openAssignments(seed, cid);
  await settled();
  out[name + ' › toolbar'] = hash(toolbar());
  out[name + ' › list, nothing open'] = hash(main());
  click(document.querySelector('[data-action="expandAllAssess"]'));
  await settled();
  out[name + ' › list, every card open'] = hash(main());
  closePages();
}

async function demoWalk() {
  const out = {};
  for (const system of ['proficiency', 'letter', 'both']) {
    await pictures(
      () => {
        window.isDemoMode = () => true;
        Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
        localStorage.clear();
        CURRICULUM_INDEX = newBankIndex(['SCI8']);
        seedIfNeeded();
        COURSES.sci8.gradingSystem = system;
      },
      'sci8',
      out,
      'demo ' + system,
    );
  }
  out.keys = Object.keys(localStorage._store)
    .filter(k => !/^gb-sync-|^gb-last-/.test(k))
    .sort()
    .join(' ');
  return out;
}

async function signedInWalk() {
  const out = {};
  window.isDemoMode = () => false;
  const session = signIn();
  try {
    for (const system of ['proficiency', 'letter', 'both']) {
      await pictures(signedInSeed(system), CID, out, 'signed in ' + system);
      clearClass(CID);
    }
    out.keys = Object.keys(localStorage._store).sort().join(' ');
    out.calls = session.fake.calls.map(c => c.name).join(' ');
  } finally {
    session.signOut();
  }
  return out;
}

let wasDemo, wasCourses;
beforeEach(() => {
  wasCourses = structuredClone(COURSES);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-18T18:00:00.000Z'));
  wasDemo = window.isDemoMode;
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  closePages();
  window.isDemoMode = wasDemo;
  Object.keys(wasCourses).forEach(cid => Object.assign(COURSES[cid] || {}, wasCourses[cid]));
  localStorage.clear();
});

describe('with the quizzes switch off the Assignments page is what it was', () => {
  if (UPDATE) {
    it('writes the snapshot (run on the code from before the change)', async () => {
      const demo = await demoWalk();
      localStorage.clear();
      const signedIn = await signedInWalk();
      writeFileSync(SNAPSHOT, JSON.stringify({ demo, signedIn }, null, 2) + '\n');
    });
    return;
  }
  const before = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};

  it('has the snapshot', () => {
    expect(Object.keys(before.demo || {})).toHaveLength(10);
    expect(Object.keys(before.signedIn || {})).toHaveLength(11);
  });

  it('in Demo Mode: every picture, and the keys left', async () => {
    const now = await demoWalk();
    Object.keys(before.demo).forEach(name => expect(now[name], name).toBe(before.demo[name]));
  });

  it('signed in: every picture, the keys, and every call, none of them a quiz call', async () => {
    const now = await signedInWalk();
    Object.keys(before.signedIn).forEach(name => expect(now[name], name).toBe(before.signedIn[name]));
    expect(now.calls).not.toMatch(/quiz/);
  });
});
