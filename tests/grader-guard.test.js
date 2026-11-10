/**
 * A screen writes a grade only through shared/grader.js
 * (docs/plans/student-page-build-plan.md, 1.4). This guard fails when any
 * other file calls one of the score writers in shared/data.js more often
 * than it does today.
 *
 * The caps only go down. Each is today's count, and each names the PR that
 * takes it to zero. A count above its cap fails; so does a count below it,
 * until the cap is lowered to match. When every cap is zero, delete CAPS.
 *
 * A call is counted wherever its name is followed by "(" in the file's
 * text, a comment included.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const DIRS = ['shared', 'teacher', 'teacher-mobile', 's'];

/* Every function in shared/data.js that writes a grade. Not here: a class
   restored from a backup (import_json_restore), which has its own rule
   (plan 1.2); setRubricPrints, which records a printout, not a grade; and
   the writers' own helpers (names starting with _), which only data.js
   calls. */
const WRITERS = [
  // One cell
  'upsertScore', // a level, with its + or −: a competency, a rubric criterion or the whole piece
  'setPointsScore', // points
  'setCompletionMark', // Complete or Incomplete
  'setRubricCheck', // a checklist tick
  'saveRubricCriterionComment', // a criterion's comment
  'saveRubricCriterionBeyond', // a single-point rubric's Went Beyond
  'saveTagComment', // a competency's comment
  'saveScoreComment', // the Overall Comment
  'saveScoreReportNote', // the Note for the Report
  'setAssignmentStatus', // Missing, Excused or Late, the status alone
  'applyAssignmentStatus', // the same, and Missing zeroes the levels
  'saveDibelsScore', // a DIBELS window's numbers
  'setGradedSeparately', // Grade Separately; Back to Group Grade replaces a grade
  // Many cells
  'saveScores', // the class's whole score list: fills, Clear Score, undo
  'persistScoreDiffToCanonical', // sends what changed between two score lists
  'clearScoreEntries', // Clear Score: takes a cell's entries off a score list
  'restoreScoreCells', // Undo for a fill or a cleared level
  'saveAssignmentStatuses', // the class's whole status list
  'saveRubricChecks', // the class's whole tick list
  'moveRubricScores', // scores follow an assessment to another rubric
  'returnGrades', // Return: the students are given their grade (S0-F2)
];

// data.js holds the writers; grader.js is the one caller; seed-data.js
// builds the Demo class by saving whole lists, before any screen is open.
const EXEMPT = new Set(['shared/data.js', 'shared/grader.js', 'shared/seed-data.js']);

const CAPS = {
  // S1-T3 (Assignments page: list, rubric grid, ledgers, fills, Set
  // Everyone To). Two of these are the grader dialog's own: its points box
  // (_graderCommitPoints) and its Note for the Report (_saveReportNote).
  // tests/score-save-parity.test.js and tests/report-note.test.js look for
  // those two calls in this file's text, so they move with those tests.
  'teacher/page-assignments.js': 23,
  // S1-T1 (gradebook and Class Results): moved.
  'teacher/page-gradebook.js': 0,
  'teacher/class-results.js': 0,
  // S1-T2 (phone Grade tab).
  'teacher-mobile/tab-grade.js': 0,
};

function sources() {
  const out = [];
  DIRS.forEach(dir => {
    readdirSync(join(ROOT, dir))
      .filter(f => f.endsWith('.js'))
      .forEach(f => {
        const rel = dir + '/' + f;
        if (!EXEMPT.has(rel)) out.push({ rel, src: readFileSync(join(ROOT, rel), 'utf-8') });
      });
  });
  return out;
}

// Grader.returnGrades is the grader's own action, named as the writer it calls.
const CALL = new RegExp('(?<![\\w$])(?<!Grader\\.)(?:' + WRITERS.join('|') + ')\\(', 'g');

function count(src) {
  return (src.match(CALL) || []).length;
}

describe('grades are written only through shared/grader.js', () => {
  const counts = sources()
    .map(f => [f.rel, count(f.src)])
    .filter(([rel, n]) => n > 0 || CAPS[rel] !== undefined);

  it('every writer in the list is a function in shared/data.js', () => {
    const data = readFileSync(join(ROOT, 'shared/data.js'), 'utf-8');
    const missing = WRITERS.filter(name => !new RegExp('^function ' + name + '\\(', 'm').test(data));
    expect(missing).toEqual([]);
  });

  it('no file calls a score writer in data.js more than before', () => {
    const over = counts
      .filter(([rel, n]) => n > (CAPS[rel] || 0))
      .map(([rel, n]) => rel + ': ' + n + ' > ' + (CAPS[rel] || 0) + ' (write through shared/grader.js)');
    expect(over).toEqual([]);
  });

  it('a cap is lowered as its calls move to shared/grader.js', () => {
    const under = counts
      .filter(([rel, n]) => n < (CAPS[rel] || 0))
      .map(([rel, n]) => rel + ': ' + n + ' < ' + CAPS[rel] + ' (lower the cap)');
    expect(under).toEqual([]);
  });

  it('names only files that exist', () => {
    const known = new Set(sources().map(f => f.rel));
    expect(Object.keys(CAPS).filter(rel => !known.has(rel))).toEqual([]);
  });
});
