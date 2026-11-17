/**
 * Show: Submitted on the Assignments page (teacher/assign-show.js; Colin,
 * Nov 16): "submitted assignments should open and show only students who
 * have submitted. Easy to click and unselect." With it on, only the
 * assessments with work in are listed, each open, each showing only the
 * students whose work is in (GraderWork.workInIds). A second click puts the
 * page back as it was: the same cards open, the same scroll.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, click, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const LAB = U(31); // Students Send Photos: 0-4 sent (3 graded, 4 returned)
const TALK = U(32); // group work, one per group: 0-2 are a group; 0 and 5 sent
const QUIZ = U(33); // takes no work, nothing in
const Q = U(41);
const IDS = Array.from({ length: 8 }, (_, i) => U(100 + i));
let wasDemo;
let wasStyle;

function sub(sid, aid) {
  const at = courseToday(CID) + 'T09:00:00Z';
  return {
    id: 'w' + sid.slice(-3) + aid.slice(-2),
    assessment_id: aid,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    note: null,
    sent_at: at,
    created_at: at,
    files: [
      { id: 'f' + sid.slice(-3) + aid.slice(-2), page: 1, path: 'p.jpg', thumb_path: 'p-t.jpg', sha256: sid + aid },
    ],
  };
}

function seed({ sendWork = true } = {}) {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'S' + i, lastName: 'L' + i })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: LAB, title: 'Lab', tagIds: [Q], date: '2026-10-20' },
      { id: TALK, title: 'Talk', tagIds: [Q], date: '2026-10-21', collaboration: 'group', groups: [IDS.slice(0, 3)] },
      { id: QUIZ, title: 'Quiz', tagIds: [Q], date: '2026-10-22' },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [
      { id: LAB, students_send: 'photos' },
      { id: TALK, students_send: 'photos', group_work: 'group' },
    ],
    submissions: [...IDS.slice(0, 5).map(sid => sub(sid, LAB)), sub(IDS[0], TALK), sub(IDS[5], TALK)],
  });
  Grader.setLevel(CID, IDS[3], LAB, Q, 3, 0);
  Grader.setLevel(CID, IDS[4], LAB, Q, 2, 0);
  Grader.returnGrades(CID, LAB, [IDS[4]]);
}

const bar = show => document.querySelector('.assess-tograde-seg [data-show="' + show + '"]');
const pressed = () =>
  Array.from(document.querySelectorAll('.assess-tograde-seg .seg-btn'))
    .filter(b => b.getAttribute('aria-pressed') === 'true')
    .map(b => b.dataset.show);
const cards = () => Array.from(document.querySelectorAll('#main .assess-card')).map(c => c.id.slice(3));
const openCards = () => cards().filter(aid => document.getElementById('ac-' + aid).querySelector('.assess-body *'));
const studentsOn = aid =>
  Array.from(new Set(Array.from(document.querySelectorAll('#ac-' + aid + ' [data-sid]')).map(el => el.dataset.sid)));
const main = () => document.getElementById('main');

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  wasStyle = globalThis.getComputedStyle;
  localStorage.clear();
});
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  globalThis.getComputedStyle = wasStyle;
});

describe('GraderWork.workInIds', () => {
  it("lists the students whose work is in, graded or not, and a group-mate's work counts", () => {
    seed();
    expect(GraderWork.workInIds(CID, LAB, IDS)).toEqual(IDS.slice(0, 5));
    expect(GraderWork.workInIds(CID, TALK, IDS)).toEqual([IDS[0], IDS[1], IDS[2], IDS[5]]);
    expect(GraderWork.workInIds(CID, QUIZ, IDS)).toEqual([]);
    // A group member labelled Missing is left out, as To Grade leaves them.
    setAssignmentStatus(CID, IDS[2], TALK, 'NS');
    expect(GraderWork.workInIds(CID, TALK, IDS)).toEqual([IDS[0], IDS[1], IDS[5]]);
  });
});

describe('Show: Submitted', () => {
  it('lists only the work sent in, open, with only the students who sent it', () => {
    openAssignments(() => seed(), CID, {});
    expect(pressed()).toEqual(['all']);
    expect(bar('submitted').textContent).toBe('Submitted 9');
    click(bar('submitted'));
    expect(pressed()).toEqual(['submitted']);
    expect(cards().sort()).toEqual([LAB, TALK].sort());
    expect(openCards().sort()).toEqual([LAB, TALK].sort());
    expect(studentsOn(LAB).sort()).toEqual(IDS.slice(0, 5).sort());
    expect(studentsOn(TALK).sort()).toEqual([IDS[0], IDS[1], IDS[2], IDS[5]].sort());
  });

  it('a second click puts the page back: the same cards open, the same scroll', () => {
    openAssignments(() => seed(), CID, {});
    globalThis.getComputedStyle = () => ({ overflowY: 'auto' });
    click(document.querySelector('#ac-' + QUIZ + ' .assess-header'));
    expect(openCards()).toEqual([QUIZ]);
    main().scrollTop = 420;
    click(bar('submitted'));
    expect(main().scrollTop).toBe(0);
    // A card closed while Submitted is on stays closed.
    click(document.querySelector('#ac-' + LAB + ' .assess-header'));
    expect(openCards()).toEqual([TALK]);
    click(bar('submitted'));
    expect(pressed()).toEqual(['all']);
    expect(cards().length).toBe(3);
    expect(openCards()).toEqual([QUIZ]);
    expect(main().scrollTop).toBe(420);
    expect(studentsOn(QUIZ).length).toBe(IDS.length);
  });

  it('All or To Grade turn it off; To Grade pressed again is All', () => {
    openAssignments(() => seed(), CID, {});
    click(bar('submitted'));
    click(bar('tograde'));
    expect(pressed()).toEqual(['tograde']);
    expect(openCards()).toEqual([]);
    click(bar('tograde'));
    expect(pressed()).toEqual(['all']);
    click(bar('submitted'));
    click(bar('all'));
    expect(pressed()).toEqual(['all']);
    expect(cards().length).toBe(3);
  });

  it('there is no bar while Send Work is off', () => {
    openAssignments(() => seed({ sendWork: false }), CID, {});
    expect(document.querySelector('.assess-tograde-seg')).toBeNull();
  });
});
