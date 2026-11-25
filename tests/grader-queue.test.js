/**
 * The grader's queue (I3, docs/plans/inbox-redesign-plan.md): opened with
 * `queue`, [{ aid, studentIds }], the dialog carries on from one assessment
 * into the next; after the last it shows All Caught Up. PageAssignments.askReturn
 * is the one question the Dashboard's Return N Graded asks. With no queue the
 * dialog is as it was (tests/grader-dialog-return.test.js holds its markup).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages, confirmOk } from './helpers/pin-save-paths.js';
import { click, key } from './helpers/gradebook-dom.js';

const CID = U(1);
const P1 = U(31); // First Piece, takes photos
const P2 = U(32); // Second Piece, takes photos
const P3 = U(33); // A Very Long Group Piece Title, group work
const Q = U(41);
const S = Array.from({ length: 6 }, (_, i) => U(101 + i));
const NAMES = ['Ava', 'Ben', 'Cara', 'Dev', 'Eli', 'Fern'];
const HELD = { student_page_enabled: true, return_grades: 'on_return' };
let wasDemo;

function sub(sid, aid, n) {
  return {
    id: 'w' + n,
    assessment_id: aid,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    is_late: false,
    note: null,
    sent_at: '2026-10-30T20:4' + n + ':00Z',
    created_at: '2026-10-30T20:41:00Z',
    files: [{ id: 'f' + n, page: 1, path: 'lab-p1.jpg', thumb_path: 'lab-p1-t.jpg', sha256: 'h' + n }],
  };
}

function seed(config = HELD) {
  return () => {
    seedClass(CID, {
      students: S.map((id, i) => ({ id, firstName: NAMES[i], lastName: String.fromCharCode(65 + i) + 'son' })),
      learningMaps: {
        subjects: [],
        sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        { id: P1, title: 'First Piece', tagIds: [Q], date: '2026-10-20' },
        { id: P2, title: 'Second Piece', tagIds: [Q], date: '2026-10-21' },
        {
          id: P3,
          title: 'A Very Long Group Piece Title',
          tagIds: [Q],
          date: '2026-10-22',
          collaboration: 'group',
          groups: [S.slice(0, 2), S.slice(2, 4), S.slice(4, 6)],
        },
      ],
      courseConfigs: config,
    });
    saveDemoStudentWork(CID, {
      course: { send_work: true },
      assessments: [
        { id: P1, students_send: 'photos' },
        { id: P2, students_send: 'photos' },
      ],
      submissions: [sub(S[0], P1, 0), sub(S[1], P1, 1), sub(S[2], P1, 2), sub(S[3], P2, 3), sub(S[4], P2, 4)],
    });
  };
}

const QUEUE = [
  { aid: P1, studentIds: [S[0], S[1], S[2]] },
  { aid: P2, studentIds: [S[3], S[4]] },
];

const open = (aid, sid, opts, config) => {
  const overlay = openGrader(seed(config), CID, aid, sid);
  window.PageAssignments.openGrader(CID, aid, sid, opts);
  return document.getElementById('grader-overlay') || overlay;
};
const at = selector => document.querySelector('#grader-overlay ' + selector);
const title = () => at('.grader-title').textContent;
const who = () => at('.grader-student').textContent;
const next = () => at('[data-grader="next"]');
const prev = () => at('[data-grader="prev"]');
const label = el => el.textContent.replace(/\s+/g, ' ').trim();
const settled = () => new Promise(r => setTimeout(r, 10));
const draft = (sid, aid) => Grader.setLevel(CID, sid, aid, Q, 3, 0);
const waiting = (aid, sids) => GraderWork.draftsReturned(CID, aid, sids);

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
});
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('Next on a piece’s last student', () => {
  it('with no queue is off at the end, as it was', () => {
    open(P1, S[2], { studentIds: [S[0], S[1], S[2]] });
    expect(who()).toBe('Cara Cson');
    expect(next().disabled).toBe(true);
    expect(next().classList.contains('is-queue')).toBe(false);
    expect(next().getAttribute('aria-label')).toBe('Next student');
  });

  it('with a queue names the next piece, in its label, title and accessible name', () => {
    open(P1, S[2], { studentIds: QUEUE[0].studentIds, queue: QUEUE });
    expect(next().disabled).toBe(false);
    expect(label(next())).toBe('Next: Second Piece →');
    expect(next().getAttribute('title')).toBe('Next: Second Piece →');
    expect(next().getAttribute('aria-label')).toBe('Next: Second Piece →');
  });

  it('is the plain arrow before the last student', () => {
    open(P1, S[0], { studentIds: QUEUE[0].studentIds, queue: QUEUE });
    expect(next().classList.contains('is-queue')).toBe(false);
    expect(next().getAttribute('aria-label')).toBe('Next student');
    click(next());
    click(next());
    expect(label(next())).toBe('Next: Second Piece →');
    click(prev());
    expect(next().classList.contains('is-queue')).toBe(false);
    expect(next().getAttribute('aria-label')).toBe('Next student');
  });

  it('a queue without the opened piece is ignored', () => {
    open(P1, S[2], { studentIds: QUEUE[0].studentIds, queue: [QUEUE[1]] });
    expect(next().disabled).toBe(true);
  });
});

describe('stepping across pieces', () => {
  it('a click carries on into the next piece: its title, its first student, the same dialog and onClose', () => {
    let closed = 0;
    open(P1, S[2], { studentIds: QUEUE[0].studentIds, queue: QUEUE, onClose: () => closed++ });
    const overlay = document.getElementById('grader-overlay');
    click(next());
    expect(document.getElementById('grader-overlay')).toBe(overlay);
    expect(title()).toBe('Second Piece');
    expect(who()).toBe('Dev Dson');
    expect(closed).toBe(0);
    // Its steps are its own students.
    click(next());
    expect(who()).toBe('Eli Eson');
    click(prev());
    expect(who()).toBe('Dev Dson');
    window.PageAssignments.closeGrader();
    expect(closed).toBe(1);
  });

  it('the Right arrow does the same', () => {
    open(P1, S[2], { studentIds: QUEUE[0].studentIds, queue: QUEUE });
    key(document.body, 'ArrowRight');
    expect(title()).toBe('Second Piece');
    expect(who()).toBe('Dev Dson');
  });

  it('Previous on a piece’s first student goes back to the last student of the one before', () => {
    open(P2, S[3], { studentIds: QUEUE[1].studentIds, queue: QUEUE });
    expect(prev().disabled).toBe(false);
    expect(prev().getAttribute('title')).toBe('Previous: First Piece');
    click(prev());
    expect(title()).toBe('First Piece');
    expect(who()).toBe('Cara Cson');
    expect(label(next())).toBe('Next: Second Piece →');
  });

  it('Previous on the very first student has nowhere to go', () => {
    open(P1, S[0], { studentIds: QUEUE[0].studentIds, queue: QUEUE });
    expect(prev().disabled).toBe(true);
  });

  it('a piece with no one in its list is stepped over', () => {
    const queue = [QUEUE[0], { aid: P3, studentIds: [] }, QUEUE[1]];
    open(P1, S[2], { studentIds: QUEUE[0].studentIds, queue });
    expect(label(next())).toBe('Next: Second Piece →');
    click(next());
    expect(title()).toBe('Second Piece');
    click(prev());
    expect(title()).toBe('First Piece');
  });

  it('the Show filter on To Grade steps through what it lists, then carries on', async () => {
    open(P1, S[0], { studentIds: QUEUE[0].studentIds, queue: QUEUE, show: 'tograde' });
    expect(who()).toBe('Ava Ason');
    // The last student in the list is graded: Ben is the last one To Grade lists.
    draft(S[2], P1);
    await settled();
    click(next());
    expect(who()).toBe('Ben Bson');
    expect(label(next())).toBe('Next: Second Piece →');
    click(next());
    expect(title()).toBe('Second Piece');
    expect(who()).toBe('Dev Dson');
    // Show is as it was opened: the next piece is on To Grade too.
    expect(at('.grader-show [data-show="tograde"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('a piece with groups steps by group, and its last group is the edge', () => {
    const queue = [QUEUE[0], { aid: P3, studentIds: S }];
    open(P1, S[2], { studentIds: QUEUE[0].studentIds, queue });
    click(next());
    expect(title()).toBe('A Very Long Group Piece Title');
    const first = who();
    expect(next().classList.contains('is-queue')).toBe(false);
    click(next());
    const second = who();
    expect(second).not.toBe(first);
    expect(next().classList.contains('is-queue')).toBe(false);
    click(next());
    // The third of three groups is the last step: three steps, not six students.
    expect(who()).not.toBe(second);
    expect(label(next())).toBe('Finish');
    click(prev());
    click(prev());
    expect(who()).toBe(first);
    // Previous on the first group goes back a piece.
    click(prev());
    expect(title()).toBe('First Piece');
    expect(who()).toBe('Cara Cson');
  });
});

describe('All Caught Up', () => {
  const lastOfAll = () => {
    open(P2, S[4], { studentIds: QUEUE[1].studentIds, queue: QUEUE, show: 'all' });
  };
  const panel = () => at('.grader-caught-up');

  it('Finish on the last step of the last piece shows the panel, with a line for each piece waiting', () => {
    open(P2, S[4], { studentIds: QUEUE[1].studentIds, queue: QUEUE });
    draft(S[0], P1);
    draft(S[1], P1);
    draft(S[3], P2);
    click(prev());
    click(next());
    expect(label(next())).toBe('Finish');
    click(next());
    expect(panel()).not.toBe(null);
    expect(panel().querySelector('h2').textContent).toBe('All Caught Up');
    const lines = Array.from(panel().querySelectorAll('li')).map(li => Array.from(li.children).map(label).join(' '));
    expect(lines).toEqual(['First Piece 2 graded', 'Second Piece 1 graded']);
    const buttons = Array.from(panel().querySelectorAll('button')).map(b => b.textContent);
    expect(buttons).toEqual(['Return 3 Graded', 'Not Yet']);
    expect(document.activeElement).toBe(panel().querySelector('button'));
  });

  it('the Right arrow on the last step shows it too', () => {
    lastOfAll();
    key(document.body, 'ArrowRight');
    expect(panel()).not.toBe(null);
  });

  it('Not Yet closes the dialog and returns nothing', () => {
    let closed = 0;
    open(P2, S[4], { studentIds: QUEUE[1].studentIds, queue: QUEUE, onClose: () => closed++ });
    draft(S[3], P2);
    click(next());
    click(panel().querySelectorAll('button')[1]);
    expect(document.getElementById('grader-overlay')).toBe(null);
    expect(closed).toBe(1);
    expect(waiting(P2, S)).toEqual([S[3]]);
  });

  it('Return N Graded asks first, naming everyone, then returns every piece and closes', () => {
    open(P2, S[4], { studentIds: QUEUE[1].studentIds, queue: QUEUE });
    draft(S[0], P1);
    draft(S[3], P2);
    draft(S[0], P2);
    click(next());
    click(panel().querySelector('[data-grader="caught-return"]'));
    // Nothing is returned until the question is answered.
    expect(waiting(P1, S)).toEqual([S[0]]);
    expect(document.querySelector('.confirm-title').textContent).toBe('Return 3 Grades Now?');
    const message = document.querySelector('.confirm-message').textContent;
    expect(message).toContain('Ava');
    expect(message).toContain('Dev');
    expect(message).toContain('3 drafts');
    confirmOk();
    expect(waiting(P1, S)).toEqual([]);
    expect(waiting(P2, S)).toEqual([]);
    expect(document.getElementById('grader-overlay')).toBe(null);
  });

  it('Previous takes the panel away', () => {
    lastOfAll();
    click(next());
    expect(panel()).not.toBe(null);
    key(document.body, 'ArrowLeft');
    expect(panel()).toBe(null);
    expect(who()).toBe('Eli Eson');
  });

  it('in a class that holds no grades, and with nothing waiting, it is the heading and Done', () => {
    open(P2, S[4], { studentIds: QUEUE[1].studentIds, queue: QUEUE }, {});
    click(next());
    expect(Array.from(panel().querySelectorAll('button')).map(b => b.textContent)).toEqual(['Done']);
    expect(panel().querySelectorAll('li').length).toBe(0);
    click(panel().querySelector('button'));
    expect(document.getElementById('grader-overlay')).toBe(null);
  });

  it('with nothing waiting in a class that holds grades, it is Done too', () => {
    lastOfAll();
    click(next());
    expect(Array.from(panel().querySelectorAll('button')).map(b => b.textContent)).toEqual(['Done']);
  });
});

describe('PageAssignments.askReturn', () => {
  const ask = (aids, then) => {
    window.PageAssignments.askReturn(CID, aids, null, then);
  };
  // The grader opened and closed: the page's code is loaded on a mounted class, as the Dashboard has it.
  const setup = config => {
    openGrader(seed(config), CID, P1, S[0]);
    window.PageAssignments.closeGrader();
  };

  it('asks once for every piece, then returns each one and calls then', () => {
    setup();
    draft(S[0], P1);
    draft(S[1], P1);
    draft(S[3], P2);
    let called = 0;
    ask([P1, P2], () => called++);
    expect(document.querySelectorAll('.confirm-overlay').length).toBe(1);
    expect(document.querySelector('.confirm-title').textContent).toBe('Return 3 Grades Now?');
    expect(document.querySelector('.confirm-message').textContent).toContain('Ava, Ben and Dev');
    expect(document.getElementById('confirm-ok-btn').textContent).toBe('Return 3 Graded');
    expect(called).toBe(0);
    confirmOk();
    expect(waiting(P1, S)).toEqual([]);
    expect(waiting(P2, S)).toEqual([]);
    expect(called).toBe(1);
  });

  it('Cancel returns nothing and does not call then', () => {
    setup();
    draft(S[0], P1);
    let called = 0;
    ask([P1], () => called++);
    document.getElementById('confirm-cancel-btn').onclick();
    expect(waiting(P1, S)).toEqual([S[0]]);
    expect(called).toBe(0);
  });

  it('a student with a grade waiting on two pieces is named once', () => {
    setup();
    draft(S[0], P1);
    draft(S[0], P2);
    ask([P1, P2]);
    expect(document.querySelector('.confirm-title').textContent).toBe('Return 2 Grades Now?');
    expect(document.querySelector('.confirm-message').textContent).toBe('2 drafts: Ava can’t see them yet.');
  });

  it('does nothing with nothing waiting, or in a class that holds no grades', () => {
    setup();
    let called = 0;
    ask([P1, P2], () => called++);
    expect(document.querySelector('.confirm-overlay')).toBe(null);
    closePages();
    clearClass(CID);
    setup({});
    draft(S[0], P1);
    ask([P1], () => called++);
    expect(document.querySelector('.confirm-overlay')).toBe(null);
    expect(called).toBe(0);
  });
});
