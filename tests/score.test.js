/**
 * score: the tests that were tests/score-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('score-comments', () => {
  /**
   * Competency comments and comment-only scores (grader plan PR 12,
   * migrations/20261027_score_comments.sql): tag_score.comment travels in the
   * class bundle and on upsert_tag_score, a comment saves with no level, and
   * an entry with no level never counts as a 0.
   */

  const CID = '11111111-1111-1111-1111-111111111111';
  const AID = '22222222-2222-4222-8222-222222222222';
  const SID = '33333333-3333-4333-8333-333333333333';
  const TAG_1 = '88888888-8888-4888-8888-888888888888';
  const TAG_2 = '99999999-9999-4999-8999-999999999999';

  function seedClass() {
    saveStudents(CID, [{ id: SID, firstName: 'Ada', lastName: 'Lovelace' }]);
    saveAssessments(CID, [
      { id: AID, title: 'Levels lab', date: '2026-10-03', type: 'summative', tagIds: [TAG_1, TAG_2], rubricId: '' },
    ]);
    saveScores(CID, {
      [SID]: [{ id: 'e1', assessmentId: AID, tagId: TAG_1, score: 3, date: '2026-10-03', type: 'summative', note: '' }],
    });
  }

  describe('competency comments', () => {
    var originalGetSupabase;
    var originalUseSupabase;
    var client;

    beforeEach(() => {
      localStorage.clear();
      ['scores', 'assessments', 'students'].forEach(function (field) {
        if (_cache[field]) delete _cache[field][CID];
      });
      seedClass();
      originalGetSupabase = getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = true;
      _teacherId = 'teacher-uuid';
      client = {
        calls: [],
        rpc(name, payload) {
          client.calls.push({ name: name, payload: payload || {} });
          return Promise.resolve({ data: null, error: null });
        },
      };
      globalThis.getSupabase = () => client;
    });

    afterEach(() => {
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
    });

    const tagCalls = () => client.calls.filter(c => c.name === 'upsert_tag_score');

    it('saves a comment on a scored competency with its level', () => {
      saveTagComment(CID, SID, AID, TAG_1, 'Strong data table.');
      expect(getTagComment(CID, SID, AID, TAG_1)).toBe('Strong data table.');
      const calls = tagCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].payload).toMatchObject({ p_tag_id: TAG_1, p_value: 3, p_comment: 'Strong data table.' });
    });

    it('saves a comment on an unscored competency with no level', () => {
      saveTagComment(CID, SID, AID, TAG_2, 'Add units.');
      const calls = tagCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].payload).toMatchObject({ p_tag_id: TAG_2, p_value: null, p_comment: 'Add units.' });
    });

    it('sends the saved comment with a later level change', () => {
      saveTagComment(CID, SID, AID, TAG_2, 'Add units.');
      upsertScore(CID, SID, AID, TAG_2, 2, '2026-10-03', 'summative', '');
      const calls = tagCalls();
      expect(calls).toHaveLength(2);
      expect(calls[1].payload).toMatchObject({ p_value: 2, p_comment: 'Add units.' });
    });

    it('reads the comment from the class bundle tag_rows sixth element', () => {
      const cells = _bundleCells({
        students: [{ enrollment_id: SID }],
        assessments: [{ id: AID }],
        tag_index: [TAG_1],
        criterion_index: [],
        score_rows: [],
        tag_rows: [[0, 0, 0, null, 0, 'Comment only']],
        criterion_rows: [],
      });
      expect(cells[SID][AID].tag_scores[0]).toEqual({
        tag_id: TAG_1,
        value: null,
        modifier: 0,
        comment: 'Comment only',
      });
      const entry = _scoreEntryFromCanonical(CID, getAssessments(CID)[0], TAG_1, null, '', 0, 'Comment only');
      expect(entry.score).toBe(0);
      expect(entry.critNote).toBe('Comment only');
    });

    it('an entry with no level is unscored, not a 0, in the assessment score', () => {
      clearProfCache();
      expect(getAssessmentOverallScore(CID, SID, AID)).toBe(3);
      saveTagComment(CID, SID, AID, TAG_2, 'Add units.');
      clearProfCache();
      expect(getAssessmentOverallScore(CID, SID, AID)).toBe(3);
      upsertScore(CID, SID, AID, TAG_2, 3, '2026-10-03', 'summative', '');
      upsertScore(CID, SID, AID, TAG_2, 0, '2026-10-03', 'summative', '');
      clearProfCache();
      expect(getAssessmentOverallScore(CID, SID, AID)).toBe(3);
    });
  });
});

describe('score-save-parity', () => {
  /**
   * Desktop and phone save a score the same way: the type a new score gets
   * comes from one rule (scoreTypeFor), the one calc.js buckets by, and the
   * phone's status toggle runs the desktop's applyAssignmentStatus.
   */

  const CID = 'test';

  beforeEach(() => {
    _cache.scores[CID] = undefined;
    _cache.assessments[CID] = undefined;
    _cache.statuses[CID] = undefined;
    localStorage.clear();
  });

  describe('scoreTypeFor', () => {
    it('is summative for work in a category, whatever its own type', () => {
      expect(scoreTypeFor({ id: 'a1', categoryId: 'cat1' })).toBe('summative');
      expect(scoreTypeFor({ id: 'a1', category_id: 'cat1', type: 'formative' })).toBe('summative');
    });

    it("is the assessment's own type when it has no category", () => {
      expect(scoreTypeFor({ id: 'a1', type: 'summative' })).toBe('summative');
      expect(scoreTypeFor({ id: 'a1', type: 'formative' })).toBe('formative');
    });

    it('is formative with no category and no type, as a reload reads it', () => {
      expect(scoreTypeFor({ id: 'a1' })).toBe('formative');
    });

    it('is summative with no assessment', () => {
      expect(scoreTypeFor(null)).toBe('summative');
    });

    it('agrees with how a course grade buckets the score', () => {
      // getTagProficiency counts categorized work separately from formative
      // work with no category; the saved type has to say the same.
      [
        { id: 'a1', categoryId: 'cat1' },
        { id: 'a2', type: 'formative' },
        { id: 'a3', type: 'summative' },
        { id: 'a4' },
      ].forEach(a => {
        var bucket = a.categoryId ? 'categorized' : a.type === 'formative' || !a.type ? 'uncategorized' : 'categorized';
        expect(scoreTypeFor(a) === 'formative' ? 'uncategorized' : 'categorized').toBe(bucket);
      });
    });
  });

  describe('Missing zeroes scores through the shared rule', () => {
    it('saves the zeroed scores with the shared type and the class date', () => {
      saveAssessments(CID, [{ id: 'a1', title: 'Lab', tagIds: ['t1'] }]);
      saveScores(CID, { stu1: [] });
      applyAssignmentStatus(CID, 'stu1', 'a1', 'NS');
      var entry = getScores(CID).stu1.find(e => e.assessmentId === 'a1');
      expect(entry.type).toBe('formative');
      expect(entry.date).toBe(courseToday(CID));
    });

    it('setPointsScore saves new points with the shared type', () => {
      saveAssessments(CID, [{ id: 'a1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] }]);
      saveScores(CID, {});
      setPointsScore(CID, 'stu1', 'a1', 7);
      expect(getScores(CID).stu1[0].type).toBe('formative');
    });
  });

  describe('No score writer works out the type on its own', () => {
    const files = [
      'teacher/page-assignments.js',
      'teacher/page-gradebook.js',
      'teacher-mobile/tab-grade.js',
      'shared/data.js',
      'shared/data-student-work.js',
      'shared/data-feedback-live.js',
      'shared/data-markup.js',
      'shared/data-reflect.js',
      'shared/data-revisions.js',
    ];
    it.each(files)('%s passes scoreTypeFor to upsertScore', file => {
      const src = readFileSync(new URL('../' + file, import.meta.url), 'utf-8');
      // The old inline rules, each of which disagreed with the others.
      expect(src).not.toMatch(/assess(ment)? \? assess(ment)?\.type : 'summative'/);
      expect(src).not.toMatch(/assess(ment)?\.type \|\| 'summative'/);
      expect(src).not.toMatch(/: assessment\.type \|\| 'formative'/);
      expect(src).not.toMatch(/\(assessment && assessment\.type\) \|\| 'summative'/);
    });

    // Through Grader.setStatus since S1-T2; tests/grader.test.js holds that
    // setStatus calls applyAssignmentStatus with the same arguments.
    it('the phone status toggle calls applyAssignmentStatus', () => {
      const src = readFileSync(new URL('../teacher-mobile/tab-grade.js', import.meta.url), 'utf-8');
      const fn = src.slice(src.indexOf('function setStatus('), src.indexOf('function undoLastScore('));
      expect(fn).toContain('Grader.setStatus(cid, sid, aid, newStatus)');
      expect(fn).not.toContain('upsertScore(');
    });

    // Through Grader.setPoints since S1-T3; tests/grader.test.js holds that
    // setPoints calls setPointsScore with the same arguments.
    it('desktop points entry saves the score once, through setPointsScore', () => {
      const src = readFileSync(new URL('../teacher/page-assignments.js', import.meta.url), 'utf-8');
      const fn = src.slice(src.indexOf('function commitPointsScore('), src.indexOf('function focusPointsBox('));
      expect(fn).toContain('Grader.setPoints(cid, sid, aid, raw)');
      expect(fn).not.toContain('setScore(cid, sid, aid, aid');
    });

    // Both through Grader.setPoints since S1-T3, as the points entry above.
    it('the grader dialog and Set Unmarked to max save points once, through setPointsScore', () => {
      const src = readFileSync(new URL('../teacher/page-assignments.js', import.meta.url), 'utf-8');
      const grader = src.slice(src.indexOf('function _graderCommitPoints('), src.indexOf('function _focusGraderCard('));
      expect(grader).toContain('Grader.setPoints(cid, focusStudentId, aid, raw)');
      expect(grader).not.toMatch(/\bsetScore\(/);
      const fill = src.slice(src.indexOf('function confirmFillPoints('), src.indexOf('function livePointsUpdate('));
      expect(fill).toContain('Grader.setPoints(cid, st.id, aid, max)');
      expect(fill).not.toMatch(/\bsetScore\(/);
      // No points writer anywhere keys a score by the assessment's own id.
      expect(src).not.toMatch(/setScore\([^)]*\baid, aid\b/);
    });
  });

  // setPointsScore keeps one entry per points cell, so an edit after the
  // grader replaces its score. The source check above keeps the grader on it.
  describe('a points score saved twice through setPointsScore', () => {
    it('shows the new points in the cell and the course %', () => {
      // A student no earlier test marked Missing.
      COURSES[CID] = { id: CID, name: 'T', gradingSystem: 'letter', gradeLevel: '11' };
      saveAssessments(CID, [{ id: 'a1', title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] }]);
      saveScores(CID, {});
      setPointsScore(CID, 'stu9', 'a1', 5); // the grader
      setPointsScore(CID, 'stu9', 'a1', 9); // later, the gradebook, ledger or phone
      expect(getScores(CID).stu9.filter(e => e.assessmentId === 'a1')).toHaveLength(1);
      expect(getPointsScore(CID, 'stu9', 'a1')).toBe(9);
      expect(getCourseLetterData(CID, 'stu9').R).toBe(90);
      delete COURSES[CID];
    });
  });
});
