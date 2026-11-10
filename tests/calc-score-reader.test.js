/**
 * shared/calc.js reads scores in one place (student page build plan 1.3,
 * S0-T1). Every score, status, points score, Complete/Incomplete mark,
 * Overall Comment and DIBELS number goes through the _scoreRead object, and the
 * set of scores in use is part of every cache key, so the scores a student
 * has been given back (S0-F1) can be served by the same calculations
 * without sharing a cached number with the teacher's working copy.
 *
 * - The source guard fails when calc.js reads a score from the data layer
 *   anywhere but inside _scoreRead.
 * - _scoreRead gives what the data layer's own readers give.
 * - Every cache key carries the score set, and a second set gets its own
 *   numbers.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const SOURCE = readFileSync(join(ROOT, 'shared/calc.js'), 'utf-8');

// The data layer's readers of scores, statuses, ticks and DIBELS numbers.
const DIRECT_READS = [
  'getScores(',
  'getAssignmentStatus(',
  'getAssignmentStatuses(',
  'getPointsScore(',
  'getCompletionMark(',
  'getScoreComment(',
  'getDibelsScore(',
  'getDibelsScores(',
  'getRubricChecks(',
  'hasScoreOrFeedback(',
  '_cache.scores',
  '_cache.statuses',
  '_cache.dibels',
  '_cache.rubricChecks',
];

function count(src, needle) {
  return src.split(needle).length - 1;
}

// calc.js split into the _scoreRead object and everything else.
function readerAndRest() {
  const start = SOURCE.indexOf('var _scoreRead = {');
  const end = SOURCE.indexOf('\n};\n', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return { reader: SOURCE.slice(start, end + 4), rest: SOURCE.slice(0, start) + SOURCE.slice(end + 4) };
}

describe('calc.js reads scores only through _scoreRead', () => {
  it('has no direct read of a score, status, tick or DIBELS number outside _scoreRead', () => {
    const { rest } = readerAndRest();
    const hits = [];
    rest.split('\n').forEach((line, i) => {
      DIRECT_READS.forEach(needle => {
        // getTagScores( and its kin are calc.js's own; only the bare name counts.
        const at = line.indexOf(needle);
        if (at < 0 || /[A-Za-z0-9_.]/.test(line.charAt(at - 1))) return;
        hits.push(needle + ' at "' + line.trim() + '"');
      });
    });
    expect(hits).toEqual([]);
  });

  it('reads the data layer once for each kind, inside _scoreRead', () => {
    const { reader } = readerAndRest();
    expect(count(reader, 'getScores(')).toBe(1);
    expect(count(reader, 'getAssignmentStatuses(')).toBe(1);
    expect(count(reader, 'getDibelsScore(')).toBe(1);
  });
});

const CID = 'course-reader';
const TAG = 'T1';
const STUDENTS = ['s1', 's2', 's3', 's4'].map(id => ({ id, firstName: id, lastName: 'Test' }));
const ASSESSMENTS = [
  { id: 'lv', title: 'Level', scoreMode: 'proficiency', tagIds: [TAG], date: '2026-10-01', categoryId: 'cat' },
  { id: 'pt', title: 'Points', scoreMode: 'points', maxPoints: 10, tagIds: [], date: '2026-10-02', categoryId: 'cat' },
  { id: 'cp', title: 'Check', scoreMode: 'complete', maxPoints: 1, tagIds: [], date: '2026-10-03', categoryId: 'cat' },
];
const entry = (assessmentId, score, tagId, extra) =>
  Object.assign({ assessmentId, tagId, score, date: '2026-10-01' }, extra);

function scoresAt(level) {
  return {
    s1: [entry('lv', level, TAG, { note: 'Clear reasoning.' }), entry('pt', 8, 'overall'), entry('cp', 1, 'overall')],
    s2: [entry('lv', level, TAG, { mod: 1 }), entry('pt', 0, 'overall'), entry('cp', 0, 'overall')],
    s3: [entry('pt', null, 'overall', { note: 'See me.' })],
    s4: [],
  };
}

function seed(level) {
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem: 'both', levelOrder: 'asc' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = ASSESSMENTS;
  _cache.scores[CID] = scoresAt(level);
  _cache.statuses[CID] = { 's3:lv': 'NS', 's4:lv': 'EXC', 's2:pt': 'LATE' };
  _cache.rubrics[CID] = [];
  _cache.categories[CID] = [{ id: 'cat', name: 'Work', weight: 100 }];
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    subjects: [{ id: 'SUB', name: 'Science 9' }],
    sections: [{ id: 'S1', subject: 'SUB', name: 'Inquiry', tags: [{ id: TAG, label: 'Inquiry' }] }],
  };
  _cache.courseConfigs[CID] = {
    reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' }],
  };
  setActiveTerm(CID, null);
  clearProfCache();
}

afterEach(() => {
  _scoreSet = 'all';
  setActiveTerm(CID, null);
  delete COURSES[CID];
  localStorage.clear();
  clearProfCache();
});

describe('_scoreRead gives what the data layer gives', () => {
  it('for scores, statuses, points scores, completion marks and comments', () => {
    seed(3);
    expect(_scoreRead.scores(CID)).toBe(getScores(CID));
    expect(_scoreRead.statuses(CID)).toBe(getAssignmentStatuses(CID));
    STUDENTS.forEach(s =>
      ASSESSMENTS.forEach(a => {
        const where = s.id + ' on ' + a.id;
        expect(_scoreRead.status(CID, s.id, a.id), where).toBe(getAssignmentStatus(CID, s.id, a.id));
        expect(_scoreRead.pointsScore(CID, s.id, a.id), where).toBe(getPointsScore(CID, s.id, a.id));
        expect(_scoreRead.completionMark(CID, s.id, a.id), where).toBe(getCompletionMark(CID, s.id, a.id));
        expect(_scoreRead.comment(CID, s.id, a.id), where).toBe(getScoreComment(CID, s.id, a.id));
      }),
    );
    // The cases that matter: a points 0 is a score, a comment alone is not.
    expect(_scoreRead.pointsScore(CID, 's2', 'pt')).toBe(0);
    expect(_scoreRead.pointsScore(CID, 's3', 'pt')).toBeNull();
    expect(_scoreRead.completionMark(CID, 's2', 'cp')).toBe('incomplete');
    expect(_scoreRead.completionMark(CID, 's4', 'cp')).toBeNull();
    expect(_scoreRead.comment(CID, 's3', 'pt')).toBe('See me.');
    expect(_scoreRead.status(CID, 's3', 'lv')).toBe('NS');
    expect(_scoreRead.status(CID, 's1', 'lv')).toBeNull();
  });
});

describe('the score set is in the cache key', () => {
  it('names the set after the class and the term', () => {
    seed(3);
    expect(_scoreSet).toBe('all');
    expect(_ck(CID)).toBe(CID + '#all');
    setActiveTerm(CID, 1);
    expect(_ck(CID)).toBe(CID + '@1#all');
  });

  it('keys every cached result by the set', () => {
    seed(3);
    STUDENTS.forEach(s => {
      studentGradeSummary(CID, s.id);
      getCategoryAverage(CID, s.id, 'cat');
    });
    const caches = {
      _tagScoresCache,
      _criterionIndexCache,
      _tagProfCache,
      _awCache,
      _assessMapCache,
      _assessmentOverallCache,
      _categoryAvgCache,
      _courseLetterCache,
    };
    Object.keys(caches).forEach(name => {
      const keys = Object.keys(caches[name]);
      expect(keys.length, name).toBeGreaterThan(0);
      keys.forEach(key => expect(key.startsWith(CID + '#all'), name + ' › ' + key).toBe(true));
    });
  });

  it('gives a second set its own numbers, and leaves the first set its own', () => {
    seed(3);
    const before = getTagProficiency(CID, 's1', TAG);
    const beforePct = getCourseLetterData(CID, 's1').R;
    expect(before).toBe(3);
    // Another set, reading other scores, with no cache clear between.
    _scoreSet = 'another';
    _cache.scores[CID] = scoresAt(1);
    expect(getTagProficiency(CID, 's1', TAG)).toBe(1);
    expect(getCourseLetterData(CID, 's1').R).toBeLessThan(beforePct);
    // Back on the first set: its cached numbers were never touched.
    _scoreSet = 'all';
    expect(getTagProficiency(CID, 's1', TAG)).toBe(before);
    expect(getCourseLetterData(CID, 's1').R).toBe(beforePct);
  });
});
