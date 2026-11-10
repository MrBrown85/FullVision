/**
 * The returned checklist ticks (S2-F1): GradeState.returnedCheckIds, the
 * rule, and window.getReturnedRubricCheckIds in shared/data.js, the reader
 * report surfaces use on returned grades (teacher/report-scores.js).
 *
 * A tick is part of a grade, so students are given the ticks the same way
 * GradeState.returnedScores gives them levels: the working ticks where
 * nothing is a draft, the returned copy's ticks where a draft sits on a
 * returned grade, none where the grade was never returned.
 *
 * 1. The rule on its own, state by state.
 * 2. The rule through every case in tests/fixtures/grade-state-cases.json
 *    (the cases the SQL triggers also run): wherever the file says what the
 *    student is given, the ticks given are its ticks.
 * 3. The data layer's reader on a real class: each state the levels are
 *    tested in, Missing and Excused, a DIBELS benchmark, a class that does
 *    not hold grades, and a signed-in class whose rows have not loaded.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, signIn, seedClass, clearClass } from './helpers/pin-save-paths.js';

/* ── 1. The rule ─────────────────────────────────────────────── */

describe('GradeState.returnedCheckIds', () => {
  const copy = checks => ({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks });

  it('gives the working ticks in a class that does not hold grades, whatever the row says', () => {
    expect(GradeState.returnedCheckIds(null, ['k1'], false)).toEqual(['k1']);
    expect(GradeState.returnedCheckIds({ is_draft: true }, ['k1'], false)).toEqual(['k1']);
    expect(GradeState.returnedCheckIds({ is_draft: true, returned_copy: copy([]) }, ['k1'], false)).toEqual(['k1']);
  });

  it('with no row, the grade was there before the rule was kept: the working ticks', () => {
    expect(GradeState.returnedCheckIds(null, ['k1', 'k2'], true)).toEqual(['k1', 'k2']);
  });

  it('returned and unchanged: the working ticks', () => {
    const row = { is_draft: false, returned_at: '2026-11-03T17:00:00Z' };
    expect(GradeState.returnedCheckIds(row, ['k2'], true)).toEqual(['k2']);
  });

  it('a draft never returned: none', () => {
    expect(GradeState.returnedCheckIds({ is_draft: true }, ['k1'], true)).toEqual([]);
  });

  it('a draft on a returned grade: the returned ticks, with ticks added or taken off since', () => {
    const row = { is_draft: true, returned_at: '2026-11-03T17:00:00Z', returned_copy: copy(['k1']) };
    expect(GradeState.returnedCheckIds(row, ['k1', 'k2'], true)).toEqual(['k1']);
    expect(GradeState.returnedCheckIds(row, [], true)).toEqual(['k1']);
    // A returned grade with no ticks keeps none.
    const bare = { is_draft: true, returned_at: '2026-11-03T17:00:00Z', returned_copy: copy([]) };
    expect(GradeState.returnedCheckIds(bare, ['k2'], true)).toEqual([]);
  });

  it('a returned grade cleared and not yet returned: what was returned', () => {
    const row = { is_draft: true, returned_at: '2026-11-03T17:00:00Z', returned_copy: copy(['k2']) };
    expect(GradeState.returnedCheckIds(row, [], true)).toEqual(['k2']);
  });

  it('gives a new list, never the one it was handed', () => {
    const working = ['k1'];
    const out = GradeState.returnedCheckIds(null, working, true);
    expect(out).toEqual(working);
    expect(out).not.toBe(working);
  });
});

/* ── 2. The shared cases ─────────────────────────────────────── */

const SUITE = JSON.parse(
  readFileSync(join(new URL('.', import.meta.url).pathname, 'fixtures', 'grade-state-cases.json'), 'utf-8'),
);
const COPY_OF = { criteria: { c1: 'c3', c2: 'c4' }, checks: { k1: 'k3', k2: 'k4' } };

/* A small runner of the file's steps, as tests/grade-state-cases.test.js
   runs them, keeping each student's working copy, status and row. */
function runCase(c, onCheck) {
  let klass = Object.assign({}, c.class);
  const scoring = { criteria: ['c1', 'c2'], checks: ['k1', 'k2'], on: { k1: 'c1', k2: 'c2' }, tags: ['t1', 't2'] };
  const cells = {};
  let clock = Date.parse('2026-11-03T17:00:00Z');
  const cell = sid =>
    cells[sid] ||
    (cells[sid] = {
      grade: { value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] },
      status: null,
      row: null,
    });
  const write = (sid, change) => {
    const it = cell(sid);
    const before = structuredClone(it.grade);
    change(it);
    it.row = GradeState.afterWrite(klass, it.row, before, it.grade, new Date(clock).toISOString());
  };
  c.steps.forEach((step, i) => {
    clock += 60000;
    const now = new Date(clock).toISOString();
    const sid = step.student || 's1';
    if (step.expect) return onCheck(step.expect, cell(step.expect.for || 's1'), klass, scoring, i + 1);
    switch (step.do) {
      case 'level':
        return write(sid, x => {
          const was = x.grade.tags[step.tag] || {};
          x.grade.tags[step.tag] = {
            value: step.value,
            modifier: step.modifier || 0,
            comment: step.comment === undefined ? was.comment || null : step.comment,
          };
        });
      case 'criterion':
        return write(sid, x => {
          const was = x.grade.criteria[step.criterion] || {};
          x.grade.criteria[step.criterion] = {
            value: step.value,
            modifier: step.modifier || 0,
            comment: step.comment === undefined ? was.comment || null : step.comment,
            beyond: step.beyond === undefined ? was.beyond || null : step.beyond,
          };
        });
      case 'score':
        return write(sid, x => {
          x.grade.value = step.value;
          x.grade.modifier = step.modifier || 0;
        });
      case 'tick':
        return write(sid, x => {
          const others = x.grade.checks.filter(id => id !== step.check);
          x.grade.checks = step.on ? others.concat(step.check) : others;
        });
      case 'comment':
        return write(sid, x => (x.grade.comment = step.text));
      case 'clear':
        return write(sid, x => {
          x.grade.value = null;
          x.grade.modifier = 0;
          x.grade.tags = {};
          x.grade.criteria = {};
        });
      case 'note':
        return;
      case 'status':
        cell(sid).status = step.status;
        return;
      case 'seen':
        cell(sid).row = GradeState.afterSeen(cell(sid).row, now);
        return;
      case 'return':
        (step.students || [sid]).forEach(s => (cell(s).row = GradeState.afterReturn(cell(s).row, cell(s).grade, now)));
        return;
      case 'class': {
        const was = klass;
        klass = { student_page: step.student_page, return_grades: step.return_grades };
        const rows = { work: {} };
        Object.keys(cells).forEach(s => (rows.work[s] = cells[s].row));
        const out = GradeState.afterSettingChange(was, klass, rows, s => cells[s].grade, now);
        Object.keys(cells).forEach(s => (cells[s].row = (out.work || {})[s] || null));
        return;
      }
      case 'move_rubric':
        scoring.criteria = scoring.criteria.map(id => COPY_OF.criteria[id] || id);
        scoring.checks = scoring.checks.map(id => COPY_OF.checks[id] || id);
        scoring.on = Object.fromEntries(
          Object.entries(scoring.on).map(([k, cr]) => [COPY_OF.checks[k], COPY_OF.criteria[cr]]),
        );
        Object.values(cells).forEach(x => {
          x.grade.criteria = Object.fromEntries(
            Object.entries(x.grade.criteria).map(([id, r]) => [COPY_OF.criteria[id] || id, r]),
          );
          x.grade.checks = x.grade.checks.map(id => COPY_OF.checks[id] || id);
          x.row = GradeState.afterMove(x.row, COPY_OF.criteria, COPY_OF.checks);
        });
        return;
      case 'delete': {
        const gone =
          step.what === 'check'
            ? [step.id]
            : step.what === 'criterion'
              ? scoring.checks.filter(k => scoring.on[k] === step.id)
              : [];
        if (step.what === 'criterion') scoring.criteria = scoring.criteria.filter(id => id !== step.id);
        if (step.what === 'tag') scoring.tags = scoring.tags.filter(id => id !== step.id);
        scoring.checks = scoring.checks.filter(id => !gone.includes(id));
        Object.values(cells).forEach(x => {
          const before = structuredClone(x.grade);
          if (step.what === 'criterion')
            x.grade.criteria = Object.fromEntries(Object.entries(x.grade.criteria).filter(([id]) => id !== step.id));
          if (step.what === 'tag')
            x.grade.tags = Object.fromEntries(Object.entries(x.grade.tags).filter(([id]) => id !== step.id));
          x.grade.checks = x.grade.checks.filter(id => !gone.includes(id));
          x.row = GradeState.afterWrite(klass, x.row, before, x.grade, now);
        });
        return;
      }
      default:
        throw new Error('A step this runner does not know: ' + JSON.stringify(step));
    }
  });
}

describe('the returned ticks agree with every case the SQL triggers also run', () => {
  const withTicks = SUITE.cases.filter(c => c.steps.some(s => s.do === 'tick'));

  it('the file has cases with ticks in them', () => {
    expect(withTicks.length).toBeGreaterThanOrEqual(5);
  });

  /* Wherever the file says what the student is given, and the piece is not
     Missing or Excused (where the student is given nothing, as calc.js and
     the screens apply it), the ticks given are the file's. Only the
     checkboxes the work is scored by now count, as partInUse has it. */
  SUITE.cases
    .filter(c => c.work !== 'dibels')
    .forEach(c => {
      it(c.name, () => {
        let checked = 0;
        runCase(c, (want, x, klass, scoring, at) => {
          if (!('student' in want) || x.status === 'NS' || x.status === 'EXC') return;
          const given = GradeState.returnedCheckIds(x.row, x.grade.checks, GradeState.holds(klass))
            .filter(id => c.work === 'rubric' && scoring.checks.includes(id))
            .sort();
          expect(given, 'step ' + at).toEqual(want.student ? want.student.checks : []);
          checked++;
        });
        if (c.steps.some(s => s.do === 'tick')) expect(checked).toBeGreaterThan(0);
      });
    });
});

/* ── 3. The data layer's reader ──────────────────────────────── */

const CID = 'c-ticks';
const LAB = { id: 'lab', title: 'Lab', date: '2026-10-14', type: 'summative', tagIds: ['t1'], rubricId: 'rub' };
const BENCH = { id: 'bench', title: 'Reading Benchmark', date: '2026-10-16', scoreMode: 'dibels', tagIds: [] };
const RUBRIC = {
  id: 'rub',
  name: 'Lab Report',
  criteria: [
    {
      id: 'c1',
      name: 'Method',
      tagIds: ['t1'],
      levels: {},
      checks: [{ id: 'k1', level: 3, label: 'Lists every step' }],
    },
    { id: 'c2', name: 'Safety', tagIds: ['t1'], levels: {}, checks: [{ id: 'k2', level: 3, label: 'Wears goggles' }] },
  ],
};
const STUDENTS = ['s1', 's2'].map((id, i) => ({ id, firstName: ['Jordan', 'Avery'][i], lastName: 'Test' }));
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

function seed(config, extra) {
  localStorage.clear();
  clearClass(CID);
  seedClass(
    CID,
    Object.assign(
      {
        students: STUDENTS,
        assessments: [structuredClone(LAB), structuredClone(BENCH)],
        rubrics: [structuredClone(RUBRIC)],
        courseConfigs: config || {},
      },
      extra || {},
    ),
  );
}
const ticks = sid => getReturnedRubricCheckIds(CID, sid, 'lab');
const level = (sid, crit, value) => upsertScore(CID, sid, 'lab', crit, value, LAB.date, 'summative', '', 0);
const tick = (sid, k, on) => setRubricCheck(CID, sid, 'lab', k, on);
const give = sid => returnGrades(CID, 'lab', [sid]);
// The returned set's levels on the lab, as getReturnedScores gives them (a 0 is no level).
const returnedLevels = sid =>
  (getReturnedScores(CID)[sid] || [])
    .filter(e => e.assessmentId === 'lab' && Number(e.score) > 0)
    .map(e => e.tagId + '=' + e.score)
    .sort();

describe('getReturnedRubricCheckIds', () => {
  afterEach(() => clearClass(CID));

  it('a grade from before the rule was kept (no row): the working ticks', () => {
    seed(HELD, {
      scores: {
        s1: [{ id: 'e1', assessmentId: 'lab', tagId: 'c1', score: 3, date: LAB.date, type: 'summative', note: '' }],
      },
      rubricChecks: { 's1:lab': ['k1'] },
    });
    expect(getGradeReturn(CID, 's1', 'lab')).toBe(null);
    expect(ticks('s1')).toEqual(['k1']);
    expect(returnedLevels('s1')).toEqual(['c1=3']);
  });

  it('follows the levels through a draft, a return, ticks added and taken off, and a clear', () => {
    seed(HELD);
    // A draft never returned: no ticks, no levels.
    level('s1', 'c1', 3);
    tick('s1', 'k1', true);
    expect(GradeState.stateOf(CID, 's1', 'lab')).toBe('draft');
    expect(ticks('s1')).toEqual([]);
    expect(returnedLevels('s1')).toEqual([]);
    // Returned and unchanged: the working ticks.
    give('s1');
    expect(ticks('s1')).toEqual(['k1']);
    expect(returnedLevels('s1')).toEqual(['c1=3']);
    // A tick added since: the student keeps what was returned.
    tick('s1', 'k2', true);
    expect(GradeState.stateOf(CID, 's1', 'lab')).toBe('draft');
    expect(getRubricCheckIds(CID, 's1', 'lab').sort()).toEqual(['k1', 'k2']);
    expect(ticks('s1')).toEqual(['k1']);
    // A tick taken off since: still what was returned.
    tick('s1', 'k2', false);
    tick('s1', 'k1', false);
    expect(getRubricCheckIds(CID, 's1', 'lab')).toEqual([]);
    expect(ticks('s1')).toEqual(['k1']);
    // And a level changed beside it: levels and ticks come from the same copy.
    level('s1', 'c1', 4);
    expect(returnedLevels('s1')).toEqual(['c1=3']);
    expect(ticks('s1')).toEqual(['k1']);
    // Returned again: the working copy is given.
    give('s1');
    expect(ticks('s1')).toEqual([]);
    expect(returnedLevels('s1')).toEqual(['c1=4']);
  });

  it('a returned grade cleared and not yet returned: what was returned', () => {
    seed(HELD);
    level('s1', 'c1', 3);
    tick('s1', 'k2', true);
    give('s1');
    level('s1', 'c1', 0);
    tick('s1', 'k2', false);
    expect(GradeState.stateOf(CID, 's1', 'lab')).toBe('draft');
    expect(ticks('s1')).toEqual(['k2']);
    expect(returnedLevels('s1')).toEqual(['c1=3']);
    // Returned, there is nothing left.
    give('s1');
    expect(ticks('s1')).toEqual([]);
    expect(returnedLevels('s1')).toEqual([]);
  });

  it('Missing and Excused change nothing here, as in the returned set: calc.js and the screens apply them', () => {
    ['NS', 'EXC'].forEach(status => {
      seed(HELD);
      level('s1', 'c1', 3);
      tick('s1', 'k1', true);
      give('s1');
      tick('s1', 'k2', true);
      applyAssignmentStatus(CID, 's1', 'lab', status);
      expect(ticks('s1'), status).toEqual(['k1']);
      expect(returnedLevels('s1'), status).toEqual(['c1=3']);
    });
  });

  it('a DIBELS benchmark has no Draft or Returned state: the working ticks', () => {
    seed(HELD, { rubricChecks: { 's1:bench': ['x'] } });
    expect(getReturnedRubricCheckIds(CID, 's1', 'bench')).toEqual(['x']);
  });

  it('in a class that does not hold grades it is getRubricCheckIds', () => {
    [
      {},
      { return_grades: 'on_return' },
      { student_page_enabled: true, return_grades: 'on_save' },
      { student_page_enabled: true },
    ].forEach(config => {
      seed(config);
      level('s1', 'c1', 3);
      tick('s1', 'k1', true);
      tick('s2', 'k2', true);
      ['s1', 's2'].forEach(sid =>
        expect(ticks(sid), JSON.stringify(config)).toEqual(getRubricCheckIds(CID, sid, 'lab')),
      );
    });
  });
});

describe('getReturnedRubricCheckIds on a signed-in class whose rows have not loaded', () => {
  const LIVE = U(1);
  let session;
  let realSettings;
  beforeEach(() => {
    seedClass(LIVE, {
      students: [{ id: U(11), firstName: 'Jordan', lastName: 'Test' }],
      assessments: [Object.assign(structuredClone(LAB), { id: U(31) })],
      rubrics: [structuredClone(RUBRIC)],
      rubricChecks: { [U(11) + ':' + U(31)]: ['k1'] },
    });
    session = signIn();
    realSettings = globalThis.getReturnSettings;
  });
  afterEach(() => {
    globalThis.getReturnSettings = realSettings;
    session.signOut();
    clearClass(LIVE);
  });

  it('throws: not loaded is never every tick returned', () => {
    globalThis.getReturnSettings = () => ({ student_page: true, return_grades: 'on_return' });
    delete _gradeReturnsLoadedFor[LIVE];
    expect(() => getReturnedRubricCheckIds(LIVE, U(11), U(31))).toThrow(/has not loaded.*no draft is shown/);
    _loadGradeReturns(LIVE, {});
    expect(getReturnedRubricCheckIds(LIVE, U(11), U(31))).toEqual(['k1']);
  });
});
