/**
 * shared/calc.js reads scores in one place (student page build plan 1.3,
 * S0-T1). Every score, status, points score, Complete/Incomplete mark,
 * Overall Comment and DIBELS number goes through the _scoreRead object, and the
 * set of scores in use is part of every cache key, so the scores a student
 * has been given back (S0-F1) can be served by the same calculations
 * without sharing a cached number with the teacher's working copy.
 *
 * - The source guard fails when calc.js names one of the data layer's score
 *   readers, or reaches into its cache, anywhere but inside _scoreRead; and
 *   inside it, when it names any but the three it is built on, or names the
 *   returned set's builder (S0-F1) anywhere but in scores().
 * - _scoreRead gives what the data layer's own readers give, on a class
 *   whose rows are picked so each small difference between the two shows.
 * - Every cache key carries the score set, and a second set gets its own
 *   numbers.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const SOURCE = readFileSync(join(ROOT, 'shared/calc.js'), 'utf-8');

/* ── The source guard ────────────────────────────────────────── */

/* Every function in shared/data.js that reads a score, a status, a comment,
   a tick or a DIBELS number without writing one. calc.js may not name any
   of them outside _scoreRead: not to call it, not through window or
   globalThis, not to keep it under another name. */
const READERS = [
  'getScores',
  'getAssignmentStatuses',
  'getAssignmentStatus',
  'getPointsScore',
  'getCompletionMark',
  'getScoreComment',
  'getScoreReportNote',
  'getTagComment',
  'getRubricCriterionComment',
  'getRubricCriterionBeyond',
  'getDibelsScores',
  'getDibelsScore',
  'getRubricChecks',
  'getRubricCheckIds',
  'isRubricCheckOn',
  'hasScoreOrFeedback',
  'canSetAssignmentStatus',
  'isScoreLocked',
  'isGroupWithheld',
  'backToGroupGradeSource',
  // Sorting by Missing reads the statuses.
  'sortStudents',
  '_rubricCriterionNoteFor',
  '_rubricCriterionCommentFor',
  '_getRubricCriterionNote',
  '_groupGradeHolder',
  '_holdsGroupCopy',
  // The returned set's builder (S0-F1): _scoreRead.scores alone may name it.
  'getReturnedScores',
  // Which grades are drafts (S0-F2): calc.js works no draft rule out itself.
  'getGradeReturns',
  'getGradeReturn',
];
// The three _scoreRead is built on, once each.
const INSIDE_READER = { getScores: 1, getAssignmentStatuses: 1, getDibelsScore: 1 };
const RETURNED = 'getReturnedScores';
const RETURNED_ELSEWHERE = RETURNED + ' outside scores()';

/* The one line outside _scoreRead that names a reader. It is from before the
   reader: the DIBELS cell asks whether the data layer has DIBELS at all
   (typeof) and then reads through _scoreRead. Exactly this text, once; a
   second copy, or the bare name anywhere else, still fails. */
const DIBELS_TYPEOF = "typeof getDibelsScore === 'function' ? _scoreRead.dibels(";

const NAME = '[A-Za-z0-9_$]';
const READER_RE = new RegExp('(?<!' + NAME + ')(' + READERS.join('|') + ')(?!' + NAME + ')', 'g');
// The data layer's cache: only the learning map, which the previews swap.
const CACHE_RE = new RegExp('(?<!' + NAME + ')_cache(?!' + NAME + ')(?!\\.learningMaps(?!' + NAME + '))', 'g');
const STORAGE_RE = new RegExp('(?<!' + NAME + ')localStorage(?!' + NAME + ')', 'g');

// Every place a piece of source reaches for a score: [{ what, line }].
function directReads(text) {
  const hits = [];
  text.split('\n').forEach(line => {
    [READER_RE, CACHE_RE, STORAGE_RE].forEach(re => {
      for (const m of line.matchAll(re)) hits.push({ what: m[1] || m[0], line: line.trim() });
    });
  });
  return hits;
}

// calc.js split into the _scoreRead object and everything else.
function readerAndRest(source) {
  const start = source.indexOf('var _scoreRead = {');
  const end = source.indexOf('\n};\n', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return { reader: source.slice(start, end + 4), rest: source.slice(0, start) + source.slice(end + 4) };
}

// The direct reads outside _scoreRead, the DIBELS typeof line let through once.
function outsideReads(source) {
  const rest = readerAndRest(source).rest.replace(DIBELS_TYPEOF, "typeof (the data layer's) === 'function' ? (");
  return directReads(rest).map(h => h.what + ' at "' + h.line + '"');
}

// _scoreRead's scores member, up to the next one.
function scoresMember(source) {
  const reader = readerAndRest(source).reader;
  const start = reader.indexOf('\n  scores: function');
  const end = reader.indexOf('\n  statuses: function');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return reader.slice(start, end);
}

/* How often _scoreRead names each reader. The returned set's builder is
   counted only where it is named outside scores(), which is never right. */
function insideReads(source) {
  const counts = {};
  directReads(readerAndRest(source).reader).forEach(h => (counts[h.what] = (counts[h.what] || 0) + 1));
  const elsewhere = (counts[RETURNED] || 0) - directReads(scoresMember(source)).filter(h => h.what === RETURNED).length;
  delete counts[RETURNED];
  if (elsewhere) counts[RETURNED_ELSEWHERE] = elsewhere;
  return counts;
}

describe('calc.js reads scores only through _scoreRead', () => {
  it('names no reader of scores, statuses, ticks or DIBELS numbers outside _scoreRead', () => {
    expect(outsideReads(SOURCE)).toEqual([]);
  });

  it('builds _scoreRead on getScores, getAssignmentStatuses and getDibelsScore alone, once each', () => {
    expect(insideReads(SOURCE)).toEqual(INSIDE_READER);
  });

  it('reads both sets in scores(), and names the returned set nowhere else', () => {
    const names = directReads(scoresMember(SOURCE)).map(h => h.what);
    expect(names.filter(n => n === 'getScores')).toHaveLength(1);
    expect(names.filter(n => n === RETURNED).length).toBeGreaterThan(0);
    expect(names.filter(n => n !== 'getScores' && n !== RETURNED)).toEqual([]);
  });

  // The guard itself: each of these, added to calc.js outside _scoreRead, is caught.
  const SNEAKS = [
    ['a plain call', 'var x = getScores(cid)[sid];', ['getScores']],
    ['through window', 'var x = window.getScores(cid);', ['getScores']],
    ['through globalThis', 'var x = globalThis.getAssignmentStatus(cid, sid, aid);', ['getAssignmentStatus']],
    ['under another name', 'var gs = getScores;', ['getScores']],
    ['with .call', 'var x = getScores.call(null, cid);', ['getScores']],
    ['with ?.', 'var x = getPointsScore?.(cid, sid, aid);', ['getPointsScore']],
    ['by its name in a string', "var x = window['getCompletionMark'](cid, sid, aid);", ['getCompletionMark']],
    [
      'a typeof guard that then calls it',
      "var f = typeof getDibelsScore === 'function' ? getDibelsScore : null;",
      ['getDibelsScore', 'getDibelsScore'],
    ],
    [
      'a second copy of the DIBELS typeof line',
      'var again = ' + DIBELS_TYPEOF + 'cid, sid, aid, p) : null;',
      ['getDibelsScore'],
    ],
    ['the cache by a string key', "var x = _cache['scores'][cid];", ['_cache']],
    ['the cache by a dot key', 'var x = _cache.statuses[cid];', ['_cache']],
    ['the cache taken apart', 'var { scores, statuses } = _cache;', ['_cache']],
    ['the saved copy', "var x = localStorage.getItem('gb-scores-' + cid);", ['localStorage']],
    [
      'two on one line',
      'var x = a.getScores(cid) || getAssignmentStatuses(cid);',
      ['getScores', 'getAssignmentStatuses'],
    ],
    ['a comment with no score', 'var x = getScoreComment(cid, sid, aid);', ['getScoreComment']],
    ['a report note', 'var x = getScoreReportNote(cid, sid, aid);', ['getScoreReportNote']],
    ['whether a status can be set', "var x = canSetAssignmentStatus(cid, sid, aid, 'NS');", ['canSetAssignmentStatus']],
    ['whether a score is locked', 'var x = isScoreLocked(cid, sid, aid);', ['isScoreLocked']],
    ['the ticks on a criterion', 'var x = getRubricCheckIds(cid, sid, aid, crit);', ['getRubricCheckIds']],
    ['a withheld group grade', 'var x = isGroupWithheld(cid, sid, aid);', ['isGroupWithheld']],
    ['score or feedback', 'var x = hasScoreOrFeedback(cid, sid, aid);', ['hasScoreOrFeedback']],
    ['the returned set, past the reader', 'var x = getReturnedScores(cid)[sid];', ['getReturnedScores']],
  ];
  it.each(SNEAKS)('catches %s', (_name, line, names) => {
    const hits = outsideReads(SOURCE + '\nfunction _sneak(cid, sid, aid, crit, p) {\n  ' + line + '\n}\n');
    expect(hits).toEqual(names.map(n => n + ' at "' + line + '"'));
  });

  it('catches every reader on the list by its bare name', () => {
    READERS.forEach(name => {
      expect(outsideReads(SOURCE + '\nvar keep = ' + name + ';\n'), name).toEqual([
        name + ' at "var keep = ' + name + ';"',
      ]);
    });
  });

  it('leaves calc.js’s own names and the learning-map cache alone', () => {
    const own = [
      'var a = getTagScores(cid, sid, tid).concat(getCountedTagScores(cid, sid, tid));',
      'var b = _scoreRead.scores(cid)[sid] || _scoreRead.status(cid, sid, aid);',
      'var c = _cache.learningMaps[cid];',
      'var d = _tagScoresCache[key] || _assessmentOverallCache[key];',
    ];
    expect(outsideReads(SOURCE + '\n' + own.join('\n') + '\n')).toEqual([]);
  });

  // The same, for a read added inside _scoreRead.
  const INSIDE_SNEAKS = [
    ['a data-layer reader in place of a copy', '    return getScoreComment(cid, sid, aid);', { getScoreComment: 1 }],
    ['a second read of the scores', '    return getScores(cid)[sid];', { getScores: 2 }],
    ['the cache', '    return _cache.scores[cid];', { _cache: 1 }],
    ['the returned set outside scores()', '    return getReturnedScores(cid)[sid];', { [RETURNED_ELSEWHERE]: 1 }],
  ];
  it.each(INSIDE_SNEAKS)('catches %s inside _scoreRead', (_name, line, extra) => {
    const at = SOURCE.indexOf('var _scoreRead = {') + 'var _scoreRead = {'.length;
    const source = SOURCE.slice(0, at) + '\n  extra: function (cid, sid, aid) {\n' + line + '\n  },' + SOURCE.slice(at);
    expect(outsideReads(source)).toEqual([]);
    const want = Object.assign({}, INSIDE_READER);
    Object.keys(extra).forEach(k => (want[k] = extra[k]));
    expect(insideReads(source)).toEqual(want);
  });
});

/* ── A small class ───────────────────────────────────────────── */

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

/* ── _scoreRead against the data layer's own readers ─────────── */

/* pointsScore, completionMark and comment are small copies of data.js's
   getPointsScore, getCompletionMark and getScoreComment, built on
   _scoreRead.scores so the returned set (S0-F1) needs no copy of its own.
   These rows are the ones where a copy could drift: a blank, a number kept
   as text, a 0, two entries on one piece in each order, an entry with a
   comment and no score, an entry with no score key, a hole in the list.
   Each row is one student; pt is points work, cp Complete/Incomplete, lv a
   level. */
const p = (score, extra) => entry('pt', score, 'overall', extra);
const c = (score, extra) => entry('cp', score, 'overall', extra);
const l = (score, extra) => entry('lv', score, TAG, extra);
const noScore = assessmentId => ({ assessmentId, tagId: 'overall', date: '2026-10-01' });

const ROWS = {
  blankThenScore: [p(''), p(7), c(null, { note: 'x' }), c(1), l(3, { note: 7 })],
  textScore: [p('8'), c(''), l(3, { note: 'first' }), l(2, { note: 'second' })],
  highThenLow: [p(8), p(3), c(1), c(0), l(2, { note: 'second' }), l(3, { note: 'first' })],
  lowThenHigh: [p(3), p(8), c(0), c(1), l(3, { note: '' }), l(3, { note: 'later' })],
  textZero: [p('0'), c('0'), l(3)],
  zero: [p(0), c(0), l(0, { note: 'No level yet.' })],
  commentOnly: [p(null, { note: 'See me.' }), c('1')],
  noScoreKey: [noScore('pt'), noScore('cp')],
  noteThenScore: [p(null, { note: 'Late start.' }), p(5), c(2)],
  oddScores: [p('abc'), c(-1), p(10.5)],
  hole: [null, l(3, { note: 'kept' })],
  holeAfter: [l(3, { note: 'kept' }), p(4), c(1), null],
  nothing: [],
  // 'absent' is on the roster with no list of scores at all.
};
const ROW_IDS = Object.keys(ROWS).concat(['absent']);
const ROW_STATUSES = {
  'blankThenScore:lv': 'NS',
  'textScore:lv': 'EXC',
  'highThenLow:pt': 'LATE',
  // A long-form status from before the three codes: read as it is kept.
  'lowThenHigh:lv': 'notSubmitted',
  'textZero:lv': '',
  'zero:lv': 0,
  'commentOnly:cp': 'excused',
};
// Every piece, and one nobody has a score on.
const ROW_PIECES = ['lv', 'pt', 'cp', 'none'];

function seedRows() {
  seed(3);
  _cache.students[CID] = ROW_IDS.map(id => ({ id, firstName: id, lastName: 'Test' }));
  _cache.scores[CID] = structuredClone(ROWS);
  _cache.statuses[CID] = Object.assign({}, ROW_STATUSES);
  clearProfCache();
}

// What a read gives, or that it threw (a hole in the list throws in both).
function outcome(read) {
  try {
    return { value: read() };
  } catch (err) {
    return { threw: err instanceof TypeError ? 'TypeError' : String(err) };
  }
}

describe('_scoreRead gives what the data layer gives', () => {
  it('hands over the data layer’s own scores and statuses', () => {
    seedRows();
    expect(_scoreRead.scores(CID)).toBe(getScores(CID));
    expect(_scoreRead.statuses(CID)).toBe(getAssignmentStatuses(CID));
  });

  const PAIRS = [
    ['status', (sid, aid) => _scoreRead.status(CID, sid, aid), (sid, aid) => getAssignmentStatus(CID, sid, aid)],
    ['pointsScore', (sid, aid) => _scoreRead.pointsScore(CID, sid, aid), (sid, aid) => getPointsScore(CID, sid, aid)],
    [
      'completionMark',
      (sid, aid) => _scoreRead.completionMark(CID, sid, aid),
      (sid, aid) => getCompletionMark(CID, sid, aid),
    ],
    ['comment', (sid, aid) => _scoreRead.comment(CID, sid, aid), (sid, aid) => getScoreComment(CID, sid, aid)],
  ];
  it.each(PAIRS)('%s is the data layer’s on every row and piece', (name, mine, theirs) => {
    seedRows();
    const differ = [];
    ROW_IDS.forEach(sid =>
      ROW_PIECES.forEach(aid => {
        const a = outcome(() => mine(sid, aid));
        const b = outcome(() => theirs(sid, aid));
        const same = 'threw' in a || 'threw' in b ? a.threw === b.threw : Object.is(a.value, b.value);
        if (!same) differ.push(sid + ' on ' + aid + ': ' + JSON.stringify(a) + ', data.js ' + JSON.stringify(b));
      }),
    );
    expect(differ).toEqual([]);
  });

  it('reads a points score as data.js does', () => {
    seedRows();
    const pts = sid => _scoreRead.pointsScore(CID, sid, 'pt');
    expect(pts('blankThenScore')).toBe(7); // a blank is no score; the next entry is
    expect(pts('textScore')).toBe(8); // a number, not '8'
    expect(pts('highThenLow')).toBe(8); // the first of two
    expect(pts('lowThenHigh')).toBe(3);
    expect(pts('textZero')).toBe(0);
    expect(pts('zero')).toBe(0); // a 0 is a score
    expect(pts('commentOnly')).toBeNull();
    expect(pts('noScoreKey')).toBeNull();
    expect(pts('noteThenScore')).toBe(5); // past the entry that only holds a comment
    expect(pts('oddScores')).toBeNaN();
    expect(pts('holeAfter')).toBe(4);
    expect(pts('nothing')).toBeNull();
    expect(pts('absent')).toBeNull();
    expect(() => pts('hole')).toThrow(TypeError);
  });

  it('reads a Complete/Incomplete mark as data.js does', () => {
    seedRows();
    const mark = sid => _scoreRead.completionMark(CID, sid, 'cp');
    expect(mark('blankThenScore')).toBeNull(); // the first entry decides, and it has no score
    expect(mark('textScore')).toBe('incomplete'); // a blank is not unmarked
    expect(mark('highThenLow')).toBe('complete'); // the first of two
    expect(mark('lowThenHigh')).toBe('incomplete');
    expect(mark('textZero')).toBe('incomplete');
    expect(mark('zero')).toBe('incomplete');
    expect(mark('commentOnly')).toBe('complete');
    expect(mark('noScoreKey')).toBeNull();
    expect(mark('noteThenScore')).toBe('complete');
    expect(mark('oddScores')).toBe('incomplete');
    expect(mark('nothing')).toBeNull();
    expect(mark('absent')).toBeNull();
  });

  it('reads the Overall Comment as data.js does', () => {
    seedRows();
    const note = (sid, aid) => _scoreRead.comment(CID, sid, aid || 'lv');
    expect(note('blankThenScore')).toBe('7'); // text, whatever was kept
    expect(note('textScore')).toBe('first'); // the first of two
    expect(note('highThenLow')).toBe('second');
    expect(note('lowThenHigh')).toBe('later'); // past an empty one
    expect(note('textZero')).toBe('');
    expect(note('zero')).toBe('No level yet.');
    expect(note('commentOnly', 'pt')).toBe('See me.');
    expect(note('hole')).toBe('kept'); // a hole in the list is skipped
    expect(note('holeAfter')).toBe('kept');
    expect(note('nothing')).toBe('');
    expect(note('absent')).toBe('');
  });

  it('reads a status as data.js does', () => {
    seedRows();
    const status = (sid, aid) => _scoreRead.status(CID, sid, aid || 'lv');
    expect(status('blankThenScore')).toBe('NS');
    expect(status('textScore')).toBe('EXC');
    expect(status('highThenLow', 'pt')).toBe('LATE');
    expect(status('highThenLow')).toBeNull(); // another piece
    expect(status('lowThenHigh')).toBe('notSubmitted'); // as kept, not turned into a code
    expect(status('commentOnly', 'cp')).toBe('excused');
    expect(status('textZero')).toBeNull(); // '' and 0 are no status
    expect(status('zero')).toBeNull();
    expect(status('nothing')).toBeNull();
    expect(status('absent')).toBeNull();
  });
});

/* ── The cache key ───────────────────────────────────────────── */

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
    // The returned set, reading other scores, with no cache clear between.
    globalThis.getReturnedScores = () => scoresAt(1);
    try {
      _scoreSet = 'returned';
      expect(getTagProficiency(CID, 's1', TAG)).toBe(1);
      expect(getCourseLetterData(CID, 's1').R).toBeLessThan(beforePct);
      // Back on the first set: its cached numbers were never touched.
      _scoreSet = 'all';
      expect(getTagProficiency(CID, 's1', TAG)).toBe(before);
      expect(getCourseLetterData(CID, 's1').R).toBe(beforePct);
    } finally {
      delete globalThis.getReturnedScores;
    }
  });
});
