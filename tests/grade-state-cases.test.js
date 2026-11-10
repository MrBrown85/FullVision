/**
 * The Draft and Returned rule, case by case
 * (docs/plans/student-page-build-plan.md 1.2, "The same rule in the
 * browser"). tests/fixtures/grade-state-cases.json is one file of worked
 * cases that runs through the SQL triggers and through
 * shared/grade-state.js, so the two cannot drift. This is the browser's run.
 *
 * The file is the server track's, copied unchanged. A case is data: this
 * runner knows the steps the file's own how_to_read lists, and fails on one
 * it does not know rather than skipping it. It keeps what the score tables
 * would hold for each student (the working copy, the status, the row) and
 * how the work is scored, and asks GradeState for everything else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = join(new URL('.', import.meta.url).pathname, 'fixtures', 'grade-state-cases.json');
const SUITE = JSON.parse(readFileSync(FILE, 'utf-8'));

/* How each kind of work in the file is scored (how_to_read.work): what
   GradeState.partInUse is given. Checkbox k1 is on c1 and k2 on c2. */
const SCORING = {
  competencies: () => ({ kind: 'competencies', tags: ['t1', 't2'] }),
  rubric: () => ({ kind: 'rubric', criteria: ['c1', 'c2'], checks: ['k1', 'k2'], on: { k1: 'c1', k2: 'c2' } }),
  points: () => ({ kind: 'points' }),
};
// Edit a Copy: the copy's ids.
const COPY_OF = { criteria: { c1: 'c3', c2: 'c4' }, checks: { k1: 'k3', k2: 'k4' } };

/* One case: the class, how the work is scored, and each student's piece. */
function newCase(c) {
  return {
    klass: Object.assign({}, c.class),
    scoring: SCORING[c.work](),
    cells: {},
    clock: Date.parse('2026-11-03T17:00:00Z'),
  };
}
function cellOf(world, sid) {
  return (
    world.cells[sid] ||
    (world.cells[sid] = {
      grade: { value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] },
      status: null,
      note: null,
      row: null,
      lastReturnedAt: null,
    })
  );
}

const keep = (given, saved) => (given === undefined ? (saved === undefined ? null : saved) : given);
const without = (rows, id) => Object.fromEntries(Object.entries(rows).filter(([key]) => key !== id));
const renamed = (rows, map) => Object.fromEntries(Object.entries(rows).map(([id, row]) => [map[id] || id, row]));

/* What each step does to one student's working copy. A status and a Note
   for the Report are not in a copy, so they never change the row. */
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
  // Clear Score: the score and levels go; the Overall Comment and the ticks stay.
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

/* Steps about the class or the work, not one student's grade. */
const CLASS_STEPS = {
  // The settings change: a class that stops holding grades returns every waiting draft.
  class(world, step, now) {
    const was = world.klass;
    world.klass = { student_page: step.student_page, return_grades: step.return_grades };
    const rows = { work: {} };
    Object.keys(world.cells).forEach(sid => (rows.work[sid] = world.cells[sid].row));
    const out = GradeState.afterSettingChange(was, world.klass, rows, sid => world.cells[sid].grade, now);
    Object.keys(world.cells).forEach(sid => (world.cells[sid].row = (out.work || {})[sid] || null));
  },
  // Edit a Copy: the scores and ticks follow the work to the copy; each grade keeps its state.
  move_rubric(world) {
    const s = world.scoring;
    s.criteria = s.criteria.map(id => COPY_OF.criteria[id] || id);
    s.checks = s.checks.map(id => COPY_OF.checks[id] || id);
    s.on = Object.fromEntries(Object.entries(s.on).map(([k, c]) => [COPY_OF.checks[k], COPY_OF.criteria[c]]));
    Object.values(world.cells).forEach(cell => {
      cell.grade.criteria = renamed(cell.grade.criteria, COPY_OF.criteria);
      cell.grade.checks = cell.grade.checks.map(id => COPY_OF.checks[id] || id);
      cell.row = GradeState.afterMove(cell.row, COPY_OF.criteria, COPY_OF.checks);
    });
  },
  /* A criterion, competency or checkbox is deleted from the class. The work
     is no longer scored by it, and every student's rows for it go: a change
     like any other. A criterion takes its checkboxes with it. */
  delete(world, step, now) {
    const s = world.scoring;
    const checks =
      step.what === 'check' ? [step.id] : step.what === 'criterion' ? s.checks.filter(k => s.on[k] === step.id) : [];
    if (step.what === 'criterion') s.criteria = s.criteria.filter(id => id !== step.id);
    if (step.what === 'tag') s.tags = s.tags.filter(id => id !== step.id);
    if (s.checks) s.checks = s.checks.filter(id => !checks.includes(id));
    Object.values(world.cells).forEach(cell => {
      const before = structuredClone(cell.grade);
      if (step.what === 'criterion') cell.grade.criteria = without(cell.grade.criteria, step.id);
      if (step.what === 'tag') cell.grade.tags = without(cell.grade.tags, step.id);
      cell.grade.checks = cell.grade.checks.filter(id => !checks.includes(id));
      cell.row = GradeState.afterWrite(world.klass, cell.row, before, cell.grade, now);
    });
  },
};

const KNOWN = Object.keys(WRITES).concat(Object.keys(CLASS_STEPS), ['return', 'seen']);

function run(world, step) {
  world.clock += 60000;
  const now = new Date(world.clock).toISOString();
  if (CLASS_STEPS[step.do]) return CLASS_STEPS[step.do](world, step, now);
  if (step.do === 'return') {
    (step.students || [step.student || 's1']).forEach(sid => {
      const cell = cellOf(world, sid);
      cell.row = GradeState.afterReturn(cell.row, cell.grade, now);
    });
    return;
  }
  const cell = cellOf(world, step.student || 's1');
  if (step.do === 'seen') {
    cell.row = GradeState.afterSeen(cell.row, now);
  } else if (WRITES[step.do]) {
    const before = structuredClone(cell.grade);
    WRITES[step.do](cell, step);
    cell.row = GradeState.afterWrite(world.klass, cell.row, before, cell.grade, now);
  } else {
    throw new Error('A step this runner does not know: ' + JSON.stringify(step));
  }
}

/* What the file checks, for one student: the row's state, what the student
   is given (only the part the work is scored by now; nothing while the
   piece is Missing or Excused), and whether the returned date moved since
   the check before. */
function seen(world, sid) {
  const cell = cellOf(world, sid);
  const at = (cell.row && cell.row.returned_at) || null;
  const out = {
    state: GradeState.stateOfRow(cell.row, cell.grade),
    student: GradeState.studentCopy(cell.row, cell.grade, cell.status, world.scoring),
    status: cell.status,
    previous: GradeState.studentPrevious(cell.row, cell.status, world.scoring),
    updated: !!(cell.row && cell.row.updated_at),
    returned_at: at === cell.lastReturnedAt ? 'unchanged' : 'changed',
  };
  cell.lastReturnedAt = at;
  return out;
}

describe('the grade-state cases the SQL triggers also run', () => {
  it('the file is the format this runner reads', () => {
    expect(SUITE.format).toBe(1);
    expect(SUITE.cases.length).toBeGreaterThanOrEqual(44);
    // Every kind of work, step and check the file says it uses is one the runner knows.
    expect(SUITE.cases.map(c => c.work).filter(w => !SCORING[w])).toEqual([]);
    const steps = Object.keys(SUITE.how_to_read.do).filter(name => name !== 'student (on any step)');
    expect(steps.sort()).toEqual(KNOWN.slice().sort());
    const checks = ['state', 'student', 'status', 'previous', 'updated', 'returned_at', 'for'];
    expect(Object.keys(SUITE.how_to_read.expect).sort()).toEqual(checks.sort());
    const used = new Set();
    SUITE.cases.forEach(c => c.steps.forEach(step => used.add(step.do || 'expect')));
    expect([...used].filter(name => name !== 'expect' && !KNOWN.includes(name))).toEqual([]);
  });

  SUITE.cases.forEach(c => {
    it(c.name, () => {
      const world = newCase(c);
      let checked = 0;
      c.steps.forEach((step, i) => {
        if (!step.expect) return run(world, step);
        const want = Object.assign({}, step.expect);
        delete want.for;
        const got = seen(world, step.expect.for || 's1');
        Object.keys(got).forEach(k => {
          if (!(k in want)) delete got[k];
        });
        expect(got, 'step ' + (i + 1)).toEqual(want);
        checked++;
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

describe('the part of a copy the work is scored by now', () => {
  const whole = {
    value: 7,
    modifier: 1,
    comment: 'Careful work.',
    tags: { t1: { value: 3 }, t9: { value: 2 } },
    criteria: { c1: { value: 3, comment: 'Number the steps' }, c9: { value: 4 } },
    checks: ['k1', 'k9'],
  };
  const part = scoring => GradeState.partInUse(whole, scoring);

  it('a rubric: the levels and ticks of its own criteria and checkboxes', () => {
    expect(part({ kind: 'rubric', criteria: ['c1', 'c2'], checks: ['k1', 'k2'] })).toEqual({
      v: 1,
      value: null,
      modifier: 0,
      comment: 'Careful work.',
      tags: {},
      criteria: { c1: { value: 3, modifier: 0, comment: 'Number the steps', beyond: null } },
      checks: ['k1'],
    });
  });

  it('points: the score, and a 0 is a score', () => {
    expect(part({ kind: 'points' })).toMatchObject({ value: 7, tags: {}, criteria: {}, checks: [] });
    expect(GradeState.partInUse({ value: 0 }, { kind: 'points' }).value).toBe(0);
  });

  it('competencies: the levels of the ones still linked', () => {
    expect(part({ kind: 'competencies', tags: ['t1', 't2'] })).toMatchObject({
      value: null,
      modifier: 0,
      tags: { t1: { value: 3, modifier: 0, comment: null } },
      criteria: {},
      checks: [],
    });
  });

  it('competency work whose grade holds only an Overall level gives that level; with any competency or criterion row, it does not', () => {
    const scoring = { kind: 'competencies', tags: ['t1', 't2'] };
    expect(GradeState.partInUse({ value: 3, modifier: 1 }, scoring)).toMatchObject({ value: 3, modifier: 1, tags: {} });
    expect(GradeState.partInUse({ value: 3, tags: { t1: { value: 2 } } }, scoring)).toMatchObject({
      value: null,
      modifier: 0,
      tags: { t1: { value: 2, modifier: 0, comment: null } },
    });
    // A row the work no longer uses still means the grade is not only an Overall level.
    expect(GradeState.partInUse({ value: 3, tags: { t9: { value: 2 } } }, scoring)).toBe(null);
    expect(GradeState.partInUse({ value: 3, criteria: { c9: { comment: 'Old note' } } }, scoring)).toBe(null);
    // A 0 is no level; a comment alone is not a row.
    expect(GradeState.partInUse({ value: 0 }, scoring)).toBe(null);
    expect(GradeState.partInUse({ value: 3, comment: 'See me' }, scoring)).toMatchObject({
      value: 3,
      comment: 'See me',
    });
    // A rubric never takes it.
    expect(GradeState.partInUse({ value: 3 }, { kind: 'rubric', criteria: ['c1'], checks: [] })).toBe(null);
  });

  it('none of those: the one Overall level, where a 0 is none', () => {
    expect(part({ kind: 'overall' })).toMatchObject({ value: 7, modifier: 1, tags: {}, criteria: {} });
    expect(GradeState.partInUse({ value: 0 }, { kind: 'overall' })).toBe(null);
  });

  it('the Overall Comment is always in it; with nothing left there is no grade; with no scoring given, the whole copy', () => {
    expect(GradeState.partInUse({ tags: { t9: { value: 2 } }, comment: 'See me' }, { kind: 'points' })).toMatchObject({
      comment: 'See me',
      tags: {},
    });
    expect(GradeState.partInUse({ tags: { t9: { value: 2 } } }, { kind: 'points' })).toBe(null);
    expect(part(undefined)).toEqual(GradeState.copyOf(whole));
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

describe('Missing and Excused win at once', () => {
  const three = GradeState.copyOf({ tags: { t1: { value: 3 } } });
  const row = { is_draft: true, returned_at: '2026-11-03T17:00:00.000Z', returned_copy: three };

  it.each(['NS', 'EXC'])(
    '%s: the student is given no grade; the mark taken off, the returned grade is back',
    status => {
      expect(GradeState.studentCopy(row, null, status)).toBe(null);
      expect(GradeState.studentCopy(row, null, null)).toEqual(three);
      // The row does not change: under the mark it is still a draft.
      expect(GradeState.stateOfRow(row, null)).toBe('draft');
      // Nor is what they had before shown.
      const again = { is_draft: false, returned_at: '2026-11-04T17:00:00.000Z', previous_copy: three };
      expect(GradeState.studentPrevious(again, status)).toBe(null);
      expect(GradeState.studentPrevious(again, null)).toEqual(three);
    },
  );

  it('Late hides nothing', () => {
    expect(GradeState.studentCopy(row, null, 'LATE')).toEqual(three);
  });

  it('the returned set holds nothing from the returned copy of a Missing or Excused piece', () => {
    const entriesOf = (sid, aid, copy) => [{ assessmentId: aid, tagId: 't1', score: copy.tags.t1.value }];
    const rows = { essay: { s1: row } };
    const set = status => GradeState.returnedScores({ s1: [] }, rows, entriesOf, status ? { 's1:essay': status } : {});
    expect(set(null)).toEqual({ s1: [{ assessmentId: 'essay', tagId: 't1', score: 3 }] });
    expect(set('NS')).toEqual({ s1: [] });
    expect(set('EXC')).toEqual({ s1: [] });
    expect(set('LATE')).toEqual(set(null));
  });
});

describe('where a returned copy sits among a student’s entries', () => {
  // Two pieces of the same date on one competency: their order breaks the tie.
  const a = score => ({ assessmentId: 'a', tagId: 't1', score });
  const b = score => ({ assessmentId: 'b', tagId: 't1', score });
  const c = score => ({ assessmentId: 'c', tagId: 't1', score });
  const draftOn = level => ({ is_draft: true, returned_copy: GradeState.copyOf({ tags: { t1: { value: level } } }) });
  const entriesOf = (sid, aid, copy) => [{ assessmentId: aid, tagId: 't1', score: copy.tags.t1.value }];
  const set = (working, rows) => GradeState.returnedScores({ s1: working }, rows, entriesOf, {}, ['a', 'b', 'c']).s1;

  it('a changed grade stays where its working entry is', () => {
    expect(set([b(2), a(1), c(3)], { a: { s1: draftOn(4) } })).toEqual([b(2), a(4), c(3)]);
  });

  it('a cleared grade goes back in its assessment’s place, not at the end', () => {
    // a was 4, then cleared: Most Recent of the two is still b's 2.
    expect(set([b(2)], { a: { s1: draftOn(4) } })).toEqual([a(4), b(2)]);
    expect(set([a(1), c(3)], { b: { s1: draftOn(4) } })).toEqual([a(1), b(4), c(3)]);
    expect(set([a(1), b(2)], { c: { s1: draftOn(4) } })).toEqual([a(1), b(2), c(4)]);
    // Two cleared: each in its place.
    expect(set([b(2)], { c: { s1: draftOn(3) }, a: { s1: draftOn(4) } })).toEqual([a(4), b(2), c(3)]);
  });

  it('a student whose every grade is a draft never returned has an empty list, not a missing one', () => {
    const rows = { a: { s1: { is_draft: true } }, b: { s1: { is_draft: true } } };
    expect(GradeState.returnedScores({ s1: [a(3), b(2)] }, rows, entriesOf, {}, ['a', 'b'])).toEqual({ s1: [] });
  });
});
