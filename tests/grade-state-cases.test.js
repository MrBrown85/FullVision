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
 *
 * Colin ruled on 2026-11-09 that a class which stops holding grades returns
 * every waiting draft as part of the change. The rule here does that
 * (GradeState.afterSettingChange). The file was written before the ruling,
 * and the cases in SUPERSEDED still say a draft stays a draft. Each is
 * checked to disagree in exactly that way; when the server track's file
 * catches up and is copied again, this test says to empty the list.
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

const SUPERSEDED = {
  'Switching to As Soon As I Save leaves a draft a draft until it is saved again or returned':
    'the switch returns the draft',
  'Switching to As Soon As I Save: the next save returns a waiting change, marked Updated':
    'the switch returns the waiting change, marked Updated',
};

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
    const was = cell.klass;
    cell.klass = { student_page: step.student_page, return_grades: step.return_grades };
    const rows = GradeState.afterSettingChange(was, cell.klass, { a: { s: cell.row } }, () => cell.grade, now);
    cell.row = (rows.a && rows.a.s) || null;
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
    state: GradeState.stateOfRow(cell.row, cell.grade, cell.status),
    student: GradeState.studentCopy(cell.row, cell.grade, cell.status),
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

  // Every expect step of a case, as [step number, what the rule gives, what the file says].
  function walk(c) {
    const cell = newCell(c.class);
    const checks = [];
    c.steps.forEach((step, i) => {
      if (!step.expect) return run(cell, step);
      const got = seen(cell);
      Object.keys(got).forEach(k => {
        if (!(k in step.expect)) delete got[k];
      });
      checks.push([i + 1, got, step.expect]);
    });
    return checks;
  }

  SUITE.cases
    .filter(c => !SUPERSEDED[c.name])
    .forEach(c => {
      it(c.name, () => {
        const checks = walk(c);
        expect(checks.length).toBeGreaterThan(0);
        checks.forEach(([step, got, want]) => expect(got, 'step ' + step).toEqual(want));
      });
    });

  it('names only cases the file has as superseded', () => {
    const names = SUITE.cases.map(c => c.name);
    expect(Object.keys(SUPERSEDED).filter(name => !names.includes(name))).toEqual([]);
  });

  Object.keys(SUPERSEDED).forEach(name => {
    const c = SUITE.cases.find(x => x.name === name);
    if (!c) return;
    it('superseded by the ruling (' + SUPERSEDED[name] + '): ' + name, () => {
      // The file says the grade is still a draft right after the class
      // changes; the rule has returned it. If this fails, the file has caught
      // up: take the case off SUPERSEDED.
      const after = c.steps.findIndex(step => step.do === 'class') + 2;
      const [, got, want] = walk(c).find(([step]) => step === after);
      expect(want.state).toBe('draft');
      expect(got.state).toBe('returned');
      expect(got.student).toEqual(GradeState.copyOf(got.student));
      expect(got.student).not.toBe(null);
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

describe('a class that stops holding grades returns every waiting draft', () => {
  const held = { student_page: true, return_grades: 'on_return' };
  const at = '2026-11-09T18:00:00.000Z';
  const three = GradeState.copyOf({ tags: { t1: { value: 3 } } });
  const four = { tags: { t1: { value: 4 } } };
  const rows = () => ({
    essay: {
      s1: { is_draft: true }, // never returned
      s2: { is_draft: true, returned_at: '2026-11-03T17:00:00.000Z', returned_copy: three }, // changed since
      s3: { is_draft: true, returned_at: '2026-11-03T17:00:00.000Z', returned_copy: three }, // cleared since
      s4: { is_draft: false, returned_at: '2026-11-03T17:00:00.000Z' },
    },
  });
  const working = sid => (sid === 's3' ? null : four);

  it.each([
    ['As Soon As I Save is chosen', { student_page: true, return_grades: 'on_save' }],
    ['the student page is turned off', { student_page: false, return_grades: 'on_return' }],
    ['no choice is left', { student_page: true, return_grades: null }],
  ])('when %s', (_, now) => {
    const before = rows();
    const out = GradeState.afterSettingChange(held, now, before, working, at);
    expect(out.essay).toEqual({
      s1: { is_draft: false, returned_at: at },
      s2: { is_draft: false, returned_at: at, previous_copy: three, updated_at: at },
      // A cleared grade, once returned, shows no result: no row is left.
      s4: { is_draft: false, returned_at: '2026-11-03T17:00:00.000Z' },
    });
    // The rows handed in are not changed.
    expect(before).toEqual(rows());
  });

  it('changes nothing when the class still holds grades, or never did', () => {
    const r = rows();
    expect(GradeState.afterSettingChange(held, held, r, working, at)).toBe(r);
    const onSave = { student_page: true, return_grades: 'on_save' };
    expect(GradeState.afterSettingChange(onSave, held, r, working, at)).toBe(r);
    expect(GradeState.afterSettingChange(onSave, { student_page: false, return_grades: null }, r, working, at)).toBe(r);
  });
});

describe('Missing wins at once', () => {
  const three = GradeState.copyOf({ tags: { t1: { value: 3 } } });
  const row = { is_draft: true, returned_at: '2026-11-03T17:00:00.000Z', returned_copy: three };

  it('a Missing piece is not a draft and gives the student no grade; taking Missing off brings the returned grade back', () => {
    expect(GradeState.stateOfRow(row, null, 'NS')).toBe('none');
    expect(GradeState.studentCopy(row, null, 'NS')).toBe(null);
    expect(GradeState.stateOfRow(row, null, null)).toBe('draft');
    expect(GradeState.studentCopy(row, null, null)).toEqual(three);
  });

  it('Late and Excused change neither the state nor what the student is given', () => {
    ['LATE', 'EXC'].forEach(status => {
      expect(GradeState.stateOfRow(row, null, status)).toBe('draft');
      expect(GradeState.studentCopy(row, null, status)).toEqual(three);
    });
  });

  it('the returned set holds nothing for a Missing piece whose returned grade was cleared', () => {
    const entriesOf = (sid, aid, copy) => [{ assessmentId: aid, tagId: 't1', score: copy.tags.t1.value }];
    const rows = { essay: { s1: row } };
    const set = status => GradeState.returnedScores({ s1: [] }, rows, entriesOf, status ? { 's1:essay': status } : {});
    expect(set(null)).toEqual({ s1: [{ assessmentId: 'essay', tagId: 't1', score: 3 }] });
    expect(set('NS')).toEqual({ s1: [] });
    expect(set('LATE')).toEqual(set(null));
    expect(set('EXC')).toEqual(set(null));
  });
});
