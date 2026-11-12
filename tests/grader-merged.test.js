/**
 * grader: the tests that were tests/grader-*.test.js (tests/grader.test.js
 * stays its own file), one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { key, mount, unmount } from './helpers/gradebook-dom.js';
import { U, clearClass, seedClass } from './helpers/pin-save-paths.js';

describe('grader-arrows-step-students', () => {
  /**
   * In the gradebook's grader the focus opens in the Score box, where ← and →
   * moved the caret, not the student, though the hint said "← → change
   * student"; Return stepped, and the hint didn't say so; and Escape after
   * stepping selected the first student's cell, not the one the teacher ended
   * on (Nov 3 bug sweep, Step 4 group 3 #31). Now ← → change student while
   * the box holds the saved points, the hint names Return, and closing
   * selects the last student's cell.
   */

  const CID = 'cR';
  const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };

  function seed() {
    _cache.students[CID] = [
      { id: 's1', firstName: 'Ava', lastName: 'Adams' },
      { id: 's2', firstName: 'Ben', lastName: 'Brown' },
    ];
    _cache.assessments[CID] = [quiz];
    _cache.scores[CID] = { s1: [{ assessmentId: 'q1', tagId: 'T1', score: 8, date: '2026-10-10', note: '' }], s2: [] };
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
  }

  let realPage;
  afterEach(() => {
    if (window.PageAssignments.graderOpen()) window.PageAssignments.closeGrader();
    unmount();
    window.PageAssignments = realPage;
  });

  function openGrader() {
    mount(seed, { course: CID });
    realPage = window.PageAssignments;
    runInThisContext(readFileSync('teacher/page-assignments.js', 'utf-8'), { filename: 'teacher/page-assignments.js' });
    const cell = document.querySelector('.gb-scores-cell[data-aid="q1"][data-sid="s1"]');
    cell.classList.add('gb-focus');
    cell.focus();
    key(cell, 'Enter');
    return document.activeElement;
  }

  const student = () => document.querySelector('#grader-overlay .grader-student').textContent;

  describe('the grader Score box', () => {
    it('changes student with → while it holds the saved points', () => {
      const box = openGrader();
      expect(box.classList.contains('grdp-input')).toBe(true);
      expect(student()).toContain('Ava');
      key(box, 'ArrowRight');
      expect(student()).toContain('Ben');
      key(document.activeElement, 'ArrowLeft');
      expect(student()).toContain('Ava');
    });

    it('keeps ← → for the caret once something is typed', () => {
      const box = openGrader();
      box.value = '7';
      const e = key(box, 'ArrowRight');
      expect(e.defaultPrevented).toBe(false);
      expect(student()).toContain('Ava');
    });

    it('says Return goes to the next student', () => {
      openGrader();
      expect(document.querySelector('#grader-overlay .grader-hint').textContent).toBe(
        'Return next student · ← → change student · Esc closes',
      );
    });

    it('selects the cell of the student it ended on when it closes', () => {
      const box = openGrader();
      key(box, 'ArrowRight');
      key(document.activeElement, 'Escape');
      expect(window.PageAssignments.graderOpen()).toBe(false);
      expect(document.activeElement.matches('.gb-scores-cell[data-aid="q1"][data-sid="s2"]')).toBe(true);
    });
  });
});

describe('grader-return-area', () => {
  /**
   * The grader's Return area, one part both layouts fill (S11-T1,
   * docs/plans/student-page-build-plan.md S11).
   *
   * GraderWork.returnArea (shared/grader.js) says what the place beside
   * Return shows for one student's piece; the desktop grader's row
   * (teacher/page-assignments.js) and the phone's bar (teacher-mobile/
   * tab-grade.js) each draw it. The move changed nothing either draws:
   * tests/grader-dialog-return.test.js and tests/phone-return.test.js hold
   * their HTML to the byte, and tests/markup-desktop.test.js holds "Marks
   * saved. Not returned yet.". This file holds the part's own answers in
   * every state a piece can be in.
   */

  const CID = U(1);
  const AVA = U(11);
  const BEN = U(12);
  const ESSAY = U(31);
  const BENCH = U(32);
  const QUESTION = U(41);
  let wasDemo;

  function seed(courseConfigs) {
    seedClass(CID, {
      students: [
        { id: AVA, firstName: 'Ava', lastName: 'Adams' },
        { id: BEN, firstName: 'Ben', lastName: 'Brown' },
      ],
      learningMaps: {
        subjects: [],
        sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        { id: ESSAY, title: 'Essay', tagIds: [QUESTION], date: '2026-10-10' },
        { id: BENCH, title: 'Fall Benchmark', scoreMode: 'dibels', date: '2026-10-10' },
      ],
      courseConfigs,
    });
  }
  const piece = aid => getAssessments(CID).find(a => a.id === aid);
  const area = (sid = AVA, aid = ESSAY, opts) => GraderWork.returnArea(CID, piece(aid), sid, [sid], opts);

  beforeEach(() => {
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T18:00:00.000Z'));
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearClass(CID);
    localStorage.clear();
    window.isDemoMode = wasDemo;
  });

  describe('GraderWork.returnArea', () => {
    it('nothing with the build switch off, on a DIBELS benchmark, or As Soon As I Save with nothing waiting', () => {
      seed({});
      expect(area()).toBeNull();
      seed({ student_page_enabled: true, return_grades: 'on_save' });
      Grader.setLevel(CID, AVA, ESSAY, QUESTION, 3);
      expect(area()).toBeNull();
      seed({ student_page_enabled: true, return_grades: 'on_return' });
      expect(area(AVA, BENCH)).toBeNull();
    });

    it('empty, then a draft, then returned, then a draft over the returned grade', () => {
      seed({ student_page_enabled: true, return_grades: 'on_return' });
      expect(area()).toEqual({ kind: 'empty' });
      Grader.setLevel(CID, AVA, ESSAY, QUESTION, 3);
      expect(area()).toEqual({ kind: 'draft', given: null });
      Grader.returnGrades(CID, ESSAY, [AVA]);
      expect(area()).toEqual({ kind: 'returned', returnedAt: '2026-11-03T18:00:00.000Z' });
      vi.setSystemTime(new Date('2026-11-04T18:00:00.000Z'));
      Grader.setLevel(CID, AVA, ESSAY, QUESTION, 4);
      expect(area()).toEqual({ kind: 'draft', given: { returnedAt: '2026-11-03T18:00:00.000Z' } });
    });

    it('a status with nothing in shows nothing; a status is never a draft', () => {
      seed({ student_page_enabled: true, return_grades: 'on_return' });
      Grader.setStatus(CID, BEN, ESSAY, 'NS');
      expect(area(BEN)).toBeNull();
      Grader.setStatus(CID, BEN, ESSAY, 'LATE');
      expect(area(BEN)).toBeNull();
    });

    it('marks waiting on a returned grade only when the layout asks (the desktop)', () => {
      seed({ student_page_enabled: true, return_grades: 'on_return' });
      Grader.setLevel(CID, AVA, ESSAY, QUESTION, 3);
      Grader.returnGrades(CID, ESSAY, [AVA]);
      const was = window.studentMarkupWaiting;
      window.studentMarkupWaiting = (cid, sid, aid) => cid === CID && sid === AVA && aid === ESSAY;
      try {
        expect(area(AVA, ESSAY, { marks: true })).toEqual({ kind: 'marks' });
        expect(area(AVA, ESSAY).kind).toBe('returned');
      } finally {
        window.studentMarkupWaiting = was;
      }
    });
  });
});

describe('grader-tab-after-points', () => {
  /**
   * In the gradebook's grader, Tab from the Score box after a new score saved
   * it, but the save redrew the dialog and replaced Overall Comment, so focus
   * fell to the page and the next keystroke went nowhere (Nov 3 bug sweep,
   * Step 4 group 2 #22). With no change Tab worked. Focus now goes to the new
   * Overall Comment box.
   */

  const CID = 'cG';
  const quiz = { id: 'q1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date: '2026-10-10' };

  function seed() {
    _cache.students[CID] = [
      { id: 's1', firstName: 'Ava', lastName: 'Adams' },
      { id: 's2', firstName: 'Ben', lastName: 'Brown' },
    ];
    _cache.assessments[CID] = [quiz];
    _cache.scores[CID] = { s1: [], s2: [] };
    _cache.statuses[CID] = {};
    _cache.courseConfigs[CID] = {};
  }

  let realPage;
  afterEach(() => {
    if (window.PageAssignments.graderOpen()) window.PageAssignments.closeGrader();
    unmount();
    window.PageAssignments = realPage;
  });

  function openGrader() {
    mount(seed, { course: CID });
    realPage = window.PageAssignments;
    runInThisContext(readFileSync('teacher/page-assignments.js', 'utf-8'), { filename: 'teacher/page-assignments.js' });
    const cell = document.querySelector('.gb-scores-cell[data-aid="q1"][data-sid="s1"]');
    cell.classList.add('gb-focus');
    cell.focus();
    key(cell, 'Enter');
    return document.activeElement;
  }

  describe('Tab from the grader Score box', () => {
    it('lands on Overall Comment after a new score', async () => {
      const box = openGrader();
      expect(box.classList.contains('grdp-input')).toBe(true);
      box.value = '7';
      // Tab: focus moves to the next control, Overall Comment.
      document.getElementById('grdt-overall-q1').focus();
      expect(getPointsScore(CID, 's1', 'q1')).toBe(7);
      await new Promise(r => setTimeout(r, 5));
      expect(document.activeElement.id).toBe('grdt-overall-q1');
      expect(document.activeElement.isConnected).toBe(true);
    });
  });
});
