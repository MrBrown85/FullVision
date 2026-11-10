/**
 * The Draft and Returned rule, case by case
 * (docs/plans/student-page-build-plan.md 1.2, "The same rule in the
 * browser"). tests/fixtures/grade-state-cases.json is one file of worked
 * cases that runs through the SQL triggers and through
 * shared/grade-state.js, so the two cannot drift. This is the browser's run.
 *
 * The file is the server track's, copied unchanged. A case is data: this
 * runner knows the steps the file's own how_to_read lists, and fails on one
 * it does not know rather than skipping it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = join(new URL('.', import.meta.url).pathname, 'fixtures', 'grade-state-cases.json');
const SUITE = JSON.parse(readFileSync(FILE, 'utf-8'));

/* One student's piece of work, as the score tables hold it. */
function newCell(klass) {
  return {
    klass: Object.assign({}, klass),
    grade: { value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] },
    status: null,
    note: null,
    row: null,
    clock: Date.parse('2026-11-03T17:00:00Z'),
  };
}

const keep = (given, saved) => (given === undefined ? (saved === undefined ? null : saved) : given);

/* What each step does to the working copy. A status and a Note for the
   Report are not in a copy, so they never reach the rule. */
const WRITES = {
  level(cell, step) {
    const was = cell.grade.tags[step.tag] || {};
    cell.grade.tags[step.tag] = {
      value: step.value,
      modifier: step.modifier || 0,
      comment: keep(step.comment, was.comment),
    };
  },
  criterion(cell, step) {
    const was = cell.grade.criteria[step.criterion] || {};
    cell.grade.criteria[step.criterion] = {
      value: step.value,
      modifier: step.modifier || 0,
      comment: keep(step.comment, was.comment),
      beyond: keep(step.beyond, was.beyond),
    };
  },
  score(cell, step) {
    cell.grade.value = step.value;
    cell.grade.modifier = step.modifier || 0;
  },
  tick(cell, step) {
    const others = cell.grade.checks.filter(id => id !== step.check);
    cell.grade.checks = step.on ? others.concat(step.check) : others;
  },
  comment(cell, step) {
    cell.grade.comment = step.text;
  },
  // Clear Score: the score and levels go; the Overall Comment stays.
  clear(cell) {
    cell.grade.value = null;
    cell.grade.modifier = 0;
    cell.grade.tags = {};
    cell.grade.criteria = {};
  },
  note(cell, step) {
    cell.note = step.text;
  },
  status(cell, step) {
    cell.status = step.status;
  },
};

function run(cell, step) {
  cell.clock += 60000;
  const now = new Date(cell.clock).toISOString();
  if (step.do === 'return') {
    cell.row = GradeState.afterReturn(cell.row, cell.grade, now);
  } else if (step.do === 'seen') {
    cell.row = GradeState.afterSeen(cell.row, now);
  } else if (step.do === 'class') {
    cell.klass = { student_page: step.student_page, return_grades: step.return_grades };
  } else if (WRITES[step.do]) {
    const before = structuredClone(cell.grade);
    WRITES[step.do](cell, step);
    cell.row = GradeState.afterWrite(cell.klass, cell.row, before, cell.grade, now);
  } else {
    throw new Error('A step this runner does not know: ' + JSON.stringify(step));
  }
}

function seen(cell) {
  return {
    state: GradeState.stateOfRow(cell.row, cell.grade),
    student: GradeState.studentCopy(cell.row, cell.grade),
    status: cell.status,
    previous: (cell.row && cell.row.previous_copy) || null,
    updated: !!(cell.row && cell.row.updated_at),
  };
}

describe('the grade-state cases the SQL triggers also run', () => {
  it('the file is the format this runner reads', () => {
    expect(SUITE.format).toBe(1);
    expect(SUITE.cases.length).toBeGreaterThan(0);
    // Every kind of step the file says it uses is one the runner knows.
    const known = Object.keys(WRITES).concat(['return', 'seen', 'class']).sort();
    expect(Object.keys(SUITE.how_to_read.do).sort()).toEqual(known);
  });

  SUITE.cases.forEach(c => {
    it(c.name, () => {
      const cell = newCell(c.class);
      let checked = 0;
      c.steps.forEach((step, i) => {
        if (step.expect) {
          const got = seen(cell);
          const want = {};
          Object.keys(step.expect).forEach(k => (want[k] = step.expect[k]));
          Object.keys(got).forEach(k => {
            if (!(k in want)) delete got[k];
          });
          expect(got, 'step ' + (i + 1)).toEqual(want);
          checked++;
        } else run(cell, step);
      });
      expect(checked).toBeGreaterThan(0);
    });
  });
});

describe('a copy of a grade', () => {
  it('is null with nothing in it, and leaves out a row with no level and no note', () => {
    expect(GradeState.copyOf(null)).toBe(null);
    expect(GradeState.copyOf({ value: null, tags: { t1: { value: 0 } }, criteria: {}, checks: [] })).toBe(null);
    expect(GradeState.copyOf({ tags: { t1: { value: 3 }, t2: { value: null, comment: ' ' } } })).toEqual({
      v: 1,
      value: null,
      modifier: 0,
      comment: null,
      tags: { t1: { value: 3, modifier: 0, comment: null } },
      criteria: {},
      checks: [],
    });
  });

  it('keeps a 0 on the score row, where 0 points and Incomplete are scores', () => {
    expect(GradeState.copyOf({ value: 0 }).value).toBe(0);
  });

  it('is the same grade with its keys in any order and 7 written as 7.0', () => {
    const a = {
      v: 1,
      value: 7,
      modifier: 0,
      comment: null,
      tags: { a: { value: 3 }, b: { value: 2 } },
      checks: ['k2', 'k1'],
    };
    const b = { checks: ['k1', 'k2'], tags: { b: { value: 2.0, modifier: 0 }, a: { value: 3 } }, value: 7.0 };
    expect(GradeState.sameCopy(a, b)).toBe(true);
    expect(GradeState.sameCopy(a, Object.assign({}, b, { comment: 'Careful work.' }))).toBe(false);
  });
});

describe('a grade that was there before the rule was kept', () => {
  const held = { student_page: true, return_grades: 'on_return' };
  const three = { tags: { t1: { value: 3 } } };
  const four = { tags: { t1: { value: 4 } } };

  it('is Returned with no row, and the student is given it', () => {
    expect(GradeState.stateOfRow(null, three)).toBe('returned');
    expect(GradeState.studentCopy(null, three)).toEqual(GradeState.copyOf(three));
    expect(GradeState.stateOfRow(null, null)).toBe('none');
  });

  it('changed in a class that holds grades, it waits and the student keeps what they had', () => {
    const row = GradeState.afterWrite(held, null, three, four, '2026-11-09T18:00:00.000Z');
    expect(row).toEqual({ is_draft: true, returned_copy: GradeState.copyOf(three) });
    expect(GradeState.studentCopy(row, four)).toEqual(GradeState.copyOf(three));
    // Put back, it is not a draft; returned, the old grade is the previous one.
    expect(GradeState.afterWrite(held, row, four, three, '2026-11-09T18:01:00.000Z')).toBe(null);
    expect(GradeState.afterReturn(row, four, '2026-11-09T18:02:00.000Z')).toEqual({
      is_draft: false,
      returned_at: '2026-11-09T18:02:00.000Z',
      previous_copy: GradeState.copyOf(three),
      updated_at: '2026-11-09T18:02:00.000Z',
    });
  });

  it('Return does nothing to a grade that is not a draft', () => {
    const row = { is_draft: false, returned_at: '2026-11-03T17:00:00.000Z' };
    expect(GradeState.afterReturn(row, three, '2026-11-09T18:00:00.000Z')).toBe(row);
    expect(GradeState.afterReturn(null, three, '2026-11-09T18:00:00.000Z')).toBe(null);
  });
});
