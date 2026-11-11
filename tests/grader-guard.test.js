/**
 * A screen writes a grade only through shared/grader.js
 * (docs/plans/student-page-build-plan.md, 1.4). This guard fails when any
 * other file calls one of the score writers in shared/data.js.
 *
 * It began with a cap for each screen that still called them, lowered as
 * the screen moved onto the grader: the desktop grader dialog (S0-T2), the
 * gradebook and Class Results (S1-T1), the phone's Grade tab (S1-T2) and
 * the Assignments page (S1-T3). The last cap reached zero with S1-T3, so
 * the caps are gone: no call is allowed.
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
  'returnWork', // the same, with the marks on their pages (S9-F1)
  'returnForRevision', // Return for Revision: returns the work, and Hide makes the grade a draft (S11)
  'cancelRevision', // Take Back: gives a hidden grade back (S11)
];

// data.js holds the writers; grader.js is the one caller; seed-data.js
// builds the Demo class by saving whole lists, before any screen is open.
const EXEMPT = new Set(['shared/data.js', 'shared/grader.js', 'shared/seed-data.js']);

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
  it('every writer in the list is a function in shared/data.js', () => {
    const data = readFileSync(join(ROOT, 'shared/data.js'), 'utf-8');
    const missing = WRITERS.filter(name => !new RegExp('^function ' + name + '\\(', 'm').test(data));
    expect(missing).toEqual([]);
  });

  it('no file but shared/grader.js calls a score writer in data.js', () => {
    const files = sources();
    // The screens are among the files read.
    ['teacher/page-assignments.js', 'teacher/page-gradebook.js', 'teacher-mobile/tab-grade.js'].forEach(rel => {
      expect(files.some(f => f.rel === rel)).toBe(true);
    });
    const calls = files
      .map(f => [f.rel, count(f.src)])
      .filter(([, n]) => n > 0)
      .map(([rel, n]) => rel + ': ' + n + ' (write through shared/grader.js)');
    expect(calls).toEqual([]);
  });

  it('counts a writer’s call, and not a grader action or a longer name', () => {
    expect(count('upsertScore(cid);\n  saveScores(cid, scores);\n// setPointsScore(')).toBe(3);
    expect(count('Grader.returnGrades(cid, aid, ids); _upsertScoreOne(cid); mySaveScores(cid); upsertScore;')).toBe(0);
  });
});
