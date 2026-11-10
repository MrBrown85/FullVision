/**
 * The returned set of scores as the app builds it (S0-F2; student page
 * build plan 1.3): shared/data.js's own getReturnedScores, with no
 * reference helper installed. calc.js reads it inside withReturnedOnly.
 *
 * For the Demo class (Science 8) and the eval fixture (History 12):
 * 1. The invariant: with no grade a draft, returned-only is what all-work
 *    is, and the set is getScores' own object, entry for entry. At the end,
 *    both classes together are tests/fixtures/golden-grades.json byte for
 *    byte.
 * 2. Drafts, made the way a teacher makes them (the real score writers and
 *    Return, in a class with the build switch on): a draft never returned
 *    is not there; a changed returned grade counts as it was returned; a
 *    cleared one counts until the clear is returned; Missing wins at once;
 *    Excused leaves the piece out of both sets; Late keeps the score.
 * 3. The app's builder against the reference builder calc.js was tested
 *    with (tests/helpers/returned-scores.js), with a few drafts: the same
 *    levels, comments and order. The app's goes further in two ways the
 *    S0-F1 review asked for: a returned grade comes back as the entries
 *    getScores held (the reference reads points work kept under several
 *    competencies back under one), and a class that holds grades whose
 *    rows are not loaded throws (tests/grade-return-data.test.js).
 * 4. Entry for entry: with every grade in the class returned and one then
 *    changed, the returned set is the getScores of before the change, for
 *    a piece of every assessment in turn.
 * 5. It is cheap: built once for a working copy, and again after a save.
 *
 * Science 8 is loaded first: Demo Mode only seeds its class when no other
 * class is loaded. The clock is frozen as in the golden test.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FROZEN_AT,
  GOLDEN,
  canonical,
  differences,
  levelsOf,
  loadDemoClass,
  loadEvalClass,
  recordClass,
  shownOf,
} from './helpers/golden-grades.js';
import {
  copyOfGrade,
  draftNeverReturned,
  draftOnReturned,
  everyGradeReturned,
  returnedScores as referenceSet,
} from './helpers/returned-scores.js';

const CLASSES = [
  ['demo-science-8', loadDemoClass],
  ['eval-history-12', loadEvalClass],
];

// Every student's grades for the year so far, in the class's own style.
function grades(cid) {
  const out = {};
  getStudents(cid).forEach(s => {
    out[s.id] = { levels: levelsOf(cid, s.id, true), shown: shownOf(cid, s.id, null) };
  });
  return canonical(out, '');
}
const allWork = cid => (clearProfCache(), grades(cid));
const returnedOnly = cid => (clearProfCache(), withReturnedOnly(() => grades(cid)));
const entriesOn = (cid, sid, aid) => (getScores(cid)[sid] || []).filter(e => e.assessmentId === aid);
// What grade math and the screens read of each entry, in order.
const read = set =>
  Object.fromEntries(
    Object.keys(set).map(sid => [
      sid,
      set[sid].map(e =>
        [e.assessmentId, e.tagId, e.score, e.mod || 0, e.note || '', e.critNote || '', e.critBeyond || ''].join(' | '),
      ),
    ]),
  );
const graded = (cid, sid, a) => entriesOn(cid, sid, a.id).some(e => isScoreEntered(a, e));

// Rows set by hand, as the reference builder's tests set them.
function setRows(cid, rows) {
  if (rows) _cache.gradeReturns[cid] = rows;
  else delete _cache.gradeReturns[cid];
  delete _returnedSets[cid];
  clearProfCache();
}

// A student with a score on a piece of this kind, and the piece.
function find(cid, wanted) {
  for (const a of getAssessments(cid)) {
    if (!wanted(a)) continue;
    const s = getStudents(cid).find(st => graded(cid, st.id, a) && !getAssignmentStatus(cid, st.id, a.id));
    if (s) return { a, sid: s.id };
  }
  throw new Error('the class has no such piece');
}
const isLevels = a => !isPointsScored(a) && !isDibelsScored(a);
const isPoints = a => isPointsScored(a) && !isCompletionScored(a);

// Lower the grade the way a teacher would: every level to 1, or the points to 0.
function lower(cid, sid, a) {
  if (isPointsScored(a)) return setPointsScore(cid, sid, a.id, 0);
  entriesOn(cid, sid, a.id).forEach(e => upsertScore(cid, sid, a.id, e.tagId, 1, a.date || '', scoreTypeFor(a), '', 0));
}
// Clear Score, and every tick taken off: Clear Score leaves an Advanced
// Rubric's ticks, and a tick is part of a grade.
function clear(cid, sid, a) {
  if (isPointsScored(a)) return setPointsScore(cid, sid, a.id, null);
  const keys = entriesOn(cid, sid, a.id).map(e => e.tagId);
  saveScores(cid, clearScoreEntries(cid, getScores(cid), sid, a, keys));
  getRubricCheckIds(cid, sid, a.id).forEach(id => setRubricCheck(cid, sid, a.id, id, false));
}

// What the invariant recorded for each class, for the golden file at the end.
const record = { allWork: {}, noRows: {}, everyRowReturned: {} };

describe.each(CLASSES)('%s', (name, load) => {
  const ctx = { cid: null };
  const seen = { reads: 0, builds: 0, same: false };
  let loaded;
  let wasDemo;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    const cid = (ctx.cid = load());

    // 1. The invariant, recorded before anything else touches the class.
    const real = globalThis.getReturnedScores;
    const realBuild = GradeState.returnedScores;
    const settings = structuredClone(getCourseConfig(cid));
    globalThis.getReturnedScores = id => (seen.reads++, real(id));
    GradeState.returnedScores = (...args) => (seen.builds++, realBuild(...args));
    try {
      record.allWork[name] = recordClass(cid).record;
      expect(seen.reads).toBe(0);
      record.noRows[name] = withReturnedOnly(() => recordClass(cid)).record;
      // Every grade with a returned row, in a class that holds grades.
      setStudentPageSwitch(cid, true);
      setRows(cid, everyGradeReturned(cid));
      record.everyRowReturned[name] = withReturnedOnly(() => recordClass(cid)).record;
      seen.same = real(cid) === getScores(cid);
    } finally {
      globalThis.getReturnedScores = real;
      GradeState.returnedScores = realBuild;
      setRows(cid, undefined);
      saveCourseConfig(cid, settings);
    }

    setActiveTerm(cid, null);
    loaded = structuredClone({
      scores: getScores(cid),
      statuses: getAssignmentStatuses(cid),
      rubricChecks: getRubricChecks(cid),
      courseConfigs: getCourseConfig(cid),
    });
  }, 60000);

  /* The class as it was loaded, before each test: its scores, statuses and
     ticks in the cache and in localStorage (the saved copy is what a write
     is compared with), no rows, the build switch off. */
  beforeEach(() => {
    const cid = ctx.cid;
    Object.keys(loaded).forEach(field => {
      _cache[field][cid] = structuredClone(loaded[field]);
      localStorage.setItem('gb-' + _DATA_KEYS[field] + '-' + cid, JSON.stringify(loaded[field]));
    });
    setRows(cid, undefined);
    localStorage.removeItem('gb-grade-returns-' + cid);
  });

  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  const hold = () => expect(setStudentPageSwitch(ctx.cid, true)).toBe(true);

  describe('with no grade a draft, returned-only gives what all-work gives', () => {
    it('calc.js really read the app’s set, and no set had to be built for it', () => {
      expect(seen.reads).toBeGreaterThan(1000);
      expect(seen.builds).toBe(0);
      // Entry for entry: with no draft it is the working copy itself.
      expect(seen.same).toBe(true);
    });

    it('the same in a class with no rows', () => {
      expect(differences(canonical(record.allWork[name], ''), canonical(record.noRows[name], ''))).toEqual([]);
    });

    it('the same in a class where every grade has a returned row', () => {
      expect(differences(canonical(record.allWork[name], ''), canonical(record.everyRowReturned[name], ''))).toEqual(
        [],
      );
    });

    it('never gives nothing back, whatever the class', () => {
      expect(getReturnedScores(ctx.cid)).toBe(getScores(ctx.cid));
      expect(getReturnedScores('no-such-class')).toEqual({});
      hold();
      expect(getReturnedScores(ctx.cid)).toBe(getScores(ctx.cid));
    });
  });

  describe('drafts made with the real writers', () => {
    it.each([
      ['levels', isLevels],
      ['points', isPoints],
    ])('a returned grade that was changed counts as it was returned (%s)', (what, kind) => {
      const cid = ctx.cid;
      // History 12 has no points work.
      if (what === 'points' && !getAssessments(cid).some(isPoints)) return expect(name).toBe('eval-history-12');
      const { a, sid } = find(cid, kind);
      const before = allWork(cid);
      hold();
      lower(cid, sid, a);
      expect(GradeState.stateOf(cid, sid, a.id)).toBe('draft');
      const all = allWork(cid);
      expect(all[sid]).not.toEqual(before[sid]);
      expect(returnedOnly(cid)).toEqual(before);
      expect(getReturnedScores(cid)).not.toBe(getScores(cid));
      // Returned: both sets agree again, and the set is the working copy.
      expect(returnGrades(cid, a.id, [sid]).returned).toBe(1);
      expect(returnedOnly(cid)).toEqual(all);
      expect(getReturnedScores(cid)).toBe(getScores(cid));
    });

    it('a grade never returned is not there: the numbers the class has without it', () => {
      const cid = ctx.cid;
      const { a, sid } = find(cid, isLevels);
      const was = entriesOn(cid, sid, a.id).map(e => [e.tagId, e.score, e.mod || 0]);
      // With the switch off the clear is returned at once; then the class holds grades.
      clear(cid, sid, a);
      const without = allWork(cid);
      hold();
      was.forEach(([tid, score, mod]) =>
        upsertScore(cid, sid, a.id, tid, score, a.date || '', scoreTypeFor(a), '', mod),
      );
      expect(getGradeReturn(cid, sid, a.id)).toEqual({ is_draft: true });
      expect(allWork(cid)[sid]).not.toEqual(without[sid]);
      expect(returnedOnly(cid)).toEqual(without);
      expect(entriesOn(cid, sid, a.id).length).toBeGreaterThan(0);
      expect((getReturnedScores(cid)[sid] || []).filter(e => e.assessmentId === a.id)).toEqual([]);
    });

    it('a returned grade that was cleared still counts until the clear is returned', () => {
      const cid = ctx.cid;
      const { a, sid } = find(cid, isLevels);
      const before = allWork(cid);
      hold();
      clear(cid, sid, a);
      const cleared = allWork(cid);
      expect(cleared[sid]).not.toEqual(before[sid]);
      expect(returnedOnly(cid)).toEqual(before);
      returnGrades(cid, a.id, [sid]);
      // A cleared grade, once returned, shows no result.
      expect(getGradeReturn(cid, sid, a.id)).toBe(null);
      expect(returnedOnly(cid)).toEqual(cleared);
    });

    it('Missing wins at once: the returned grade stops counting everywhere with no Return, and comes back when Missing is taken off', () => {
      const cid = ctx.cid;
      const { a, sid } = find(cid, isLevels);
      const before = allWork(cid);
      hold();
      clear(cid, sid, a);
      applyAssignmentStatus(cid, sid, a.id, 'NS');
      expect(getAssignmentStatus(cid, sid, a.id)).toBe('NS');
      const missing = allWork(cid);
      expect(missing[sid]).not.toEqual(before[sid]);
      // The course grade and the competency levels agree, in both sets.
      expect(returnedOnly(cid)).toEqual(missing);
      expect(GradeState.stateOf(cid, sid, a.id)).toBe(null);
      applyAssignmentStatus(cid, sid, a.id, null);
      expect(returnedOnly(cid)).toEqual(before);
      expect(GradeState.stateOf(cid, sid, a.id)).toBe('draft');
    });

    it('Excused leaves the piece out of both sets at once; Late keeps the score that was returned', () => {
      const cid = ctx.cid;
      const { a, sid } = find(cid, isLevels);
      const before = allWork(cid);
      hold();
      lower(cid, sid, a);
      // Late is only a label: the returned grade counts as it did.
      setAssignmentStatus(cid, sid, a.id, 'LATE');
      expect(withReturnedOnly(() => assessmentCellValue(cid, sid, a))).toMatchObject({ late: true, status: 'LATE' });
      setAssignmentStatus(cid, sid, a.id, null);
      expect(returnedOnly(cid)).toEqual(before);
      // Excused, set straight on the list (a screen refuses it on scored work).
      const statuses = getAssignmentStatuses(cid);
      statuses[sid + ':' + a.id] = 'EXC';
      saveAssignmentStatuses(cid, statuses);
      expect(returnedOnly(cid)).toEqual(allWork(cid));
      expect(returnedOnly(cid)[sid]).not.toEqual(before[sid]);
    });

    it('is built once for a working copy, and again after a save', () => {
      const cid = ctx.cid;
      const { a, sid } = find(cid, isLevels);
      hold();
      lower(cid, sid, a);
      const realBuild = GradeState.returnedScores;
      let builds = 0;
      GradeState.returnedScores = (...args) => (builds++, realBuild(...args));
      try {
        const set = getReturnedScores(cid);
        returnedOnly(cid);
        expect(getReturnedScores(cid)).toBe(set);
        expect(builds).toBe(1);
        // Another student's grade is saved: the set is built again.
        const other = getStudents(cid).find(s => s.id !== sid && graded(cid, s.id, a));
        lower(cid, other.id, a);
        expect(getReturnedScores(cid)).not.toBe(set);
        expect(builds).toBe(2);
        // A status is saved: built again, since Missing wins at once.
        setAssignmentStatus(cid, sid, a.id, 'LATE');
        getReturnedScores(cid);
        expect(builds).toBe(3);
      } finally {
        GradeState.returnedScores = realBuild;
      }
    });

    it('agrees with the reference builder on a class with a few drafts', () => {
      const cid = ctx.cid;
      hold();
      const rows = {};
      const set = (aid, sid, row) => ((rows[aid] = rows[aid] || {})[sid] = row);
      const used = {};
      // One piece each; points work only where one competency carries it.
      const pick = wanted =>
        find(cid, a => wanted(a) && !used[a.id] && (isLevels(a) || scoreTagIds(a).length === 1) && (used[a.id] = true));
      // Changed since it was returned; never returned; cleared since it was returned.
      const changed = pick(isLevels);
      set(changed.a.id, changed.sid, draftOnReturned(copyOfGrade(cid, changed.sid, changed.a.id)));
      entriesOn(cid, changed.sid, changed.a.id).forEach(e => (e.score = 1));
      const fresh = pick(isLevels);
      set(fresh.a.id, fresh.sid, draftNeverReturned());
      const cleared = pick(isLevels);
      set(cleared.a.id, cleared.sid, draftOnReturned(copyOfGrade(cid, cleared.sid, cleared.a.id)));
      getScores(cid)[cleared.sid] = getScores(cid)[cleared.sid].filter(e => e.assessmentId !== cleared.a.id);
      if (getAssessments(cid).some(a => isPoints(a) && scoreTagIds(a).length === 1)) {
        const points = pick(isPoints);
        set(points.a.id, points.sid, draftOnReturned(copyOfGrade(cid, points.sid, points.a.id)));
        entriesOn(cid, points.sid, points.a.id).forEach(e => (e.score = 0));
      }
      setRows(cid, rows);
      const real = getReturnedScores(cid);
      expect(read(real)).toEqual(read(referenceSet(cid, getScores(cid), rows)));
      expect(read(real)).not.toEqual(read(getScores(cid)));
      // The cleared piece is back in its assessment's place, not at the end.
      const mine = real[cleared.sid].map(e => e.assessmentId);
      const order = getAssessments(cid).map(a => a.id);
      expect(mine.indexOf(cleared.a.id)).toBeGreaterThanOrEqual(0);
      expect(mine.slice().sort((x, y) => order.indexOf(x) - order.indexOf(y))).toEqual(mine);
      // With a returned row for every other grade, as the backfill leaves a class.
      const full = everyGradeReturned(cid);
      Object.keys(rows).forEach(aid => (full[aid] = Object.assign({}, full[aid], rows[aid])));
      setRows(cid, full);
      expect(read(getReturnedScores(cid))).toEqual(read(referenceSet(cid, getScores(cid), full)));
      // Missing, then Excused, on the cleared piece: both leave it out.
      ['NS', 'EXC'].forEach(status => {
        getAssignmentStatuses(cid)[cleared.sid + ':' + cleared.a.id] = status;
        setRows(cid, full);
        expect(read(getReturnedScores(cid))).toEqual(read(referenceSet(cid, getScores(cid), full)));
        expect(getReturnedScores(cid)[cleared.sid].filter(e => e.assessmentId === cleared.a.id)).toEqual([]);
      });
    });

    it('entry for entry: every grade returned, then one changed, is the getScores of before the change', () => {
      const cid = ctx.cid;
      const tried = [];
      getAssessments(cid).forEach(a => {
        if (isDibelsScored(a)) return;
        const s = getStudents(cid).find(st => graded(cid, st.id, a) && !getAssignmentStatus(cid, st.id, a.id));
        if (!s) return;
        // Every grade has a returned row, as the backfill leaves a class.
        hold();
        setRows(cid, everyGradeReturned(cid));
        const before = structuredClone(getScores(cid));
        lower(cid, s.id, a);
        expect(getGradeReturn(cid, s.id, a.id).is_draft, a.title).toBe(true);
        expect(getScores(cid), a.title).not.toEqual(before);
        expect(getReturnedScores(cid), a.title).toEqual(before);
        // Put back as loaded for the next piece.
        _cache.scores[cid] = structuredClone(loaded.scores);
        localStorage.setItem('gb-scores-' + cid, JSON.stringify(loaded.scores));
        tried.push(a.id);
      });
      expect(tried.length).toBeGreaterThan(5);
    });

    it('every grade returned, then a unit test kept under several competencies changed: the golden values are the ones before', () => {
      const cid = ctx.cid;
      const several = x => isPoints(x) && scoreTagIds(x).length > 1;
      if (!getAssessments(cid).some(several)) return expect(name).toBe('eval-history-12');
      const { a, sid } = find(cid, several);
      hold();
      setRows(cid, everyGradeReturned(cid));
      setPointsScore(cid, sid, a.id, 0);
      expect(getGradeReturn(cid, sid, a.id).is_draft).toBe(true);
      // Every view, grading style and switch the golden file records.
      const now = withReturnedOnly(() => recordClass(cid)).record;
      expect(differences(canonical(record.allWork[name], ''), canonical(now, ''))).toEqual([]);
      expect(
        differences(canonical(record.allWork[name], ''), canonical(recordClass(cid).record, '')).length,
      ).toBeGreaterThan(0);
    });

    it('points work kept once per competency comes back as the entries getScores holds (the Demo class)', () => {
      const cid = ctx.cid;
      const several = x => isPoints(x) && scoreTagIds(x).length > 1;
      if (!getAssessments(cid).some(several)) return expect(name).toBe('eval-history-12');
      const { a, sid } = find(cid, several);
      const own = entriesOn(cid, sid, a.id);
      expect(own.length).toBeGreaterThan(1);
      const points = Number(own[0].score);
      const before = allWork(cid);
      hold();
      setPointsScore(cid, sid, a.id, points > 0 ? 0 : 1);
      // The copy keeps one score, as the server does.
      expect(getGradeReturn(cid, sid, a.id).returned_copy).toMatchObject({ value: points, tags: {} });
      const back = getReturnedScores(cid)[sid].filter(e => e.assessmentId === a.id);
      expect(back.map(e => [e.tagId, e.score])).toEqual(own.map(e => [e.tagId, points]));
      expect(returnedOnly(cid)).toEqual(before);
      // The reference builder reads it back as one entry: where they differ.
      const reference = referenceSet(cid, getScores(cid), getGradeReturns(cid))[sid];
      expect(reference.filter(e => e.assessmentId === a.id).length).toBe(1);
      // Cleared, with nothing of the student's own to shape it by, it is
      // carried as the class's other scores on the piece are.
      setPointsScore(cid, sid, a.id, null);
      expect(
        getReturnedScores(cid)
          [sid].filter(e => e.assessmentId === a.id)
          .map(e => [e.tagId, e.score]),
      ).toEqual(own.map(e => [e.tagId, points]));
      expect(returnedOnly(cid)).toEqual(before);
    });
  });
});

describe('both classes, with no grade a draft', () => {
  it('are tests/fixtures/golden-grades.json byte for byte through the app’s returned set', () => {
    const golden = readFileSync(GOLDEN, 'utf-8');
    const asFile = classes => JSON.stringify(canonical({ frozenAt: FROZEN_AT, classes }, ''), null, 2) + '\n';
    expect(asFile(record.noRows) === golden, 'no rows').toBe(true);
    expect(asFile(record.everyRowReturned) === golden, 'every grade returned').toBe(true);
    expect(asFile(record.allWork) === golden, 'all work').toBe(true);
  });
});
