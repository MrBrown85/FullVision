/**
 * Grades are shown only through shared/calc.js (CLAUDE.md rule 3). This
 * guard fails when new code works a grade out on its own:
 * - a list of the proficiency words outside PROF_LABELS;
 * - more `.toFixed(1)` (a level rounded by hand; use levelFigure or
 *   formatLevel) or `PROF_LABELS[` (a level named by hand; use levelText
 *   for a student's or competency's level, scoreLevelText for one score)
 *   than a file has today.
 * The caps only go down: when a change removes uses, lower its number here.
 * PROF_LABELS[ is still right for a label that names a level, such as a
 * legend, a rubric column or a level button.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const DIRS = ['shared', 'teacher', 'teacher-mobile', 's'];
// Where grades are meant to be formatted, plus data files of sentences.
const EXEMPT = new Set(['shared/calc.js', 'shared/constants.js', 'shared/comment-bank.js', 'shared/seed-data.js']);
// s/ loads phone-report-view.js without constants.js, so it keeps its own
// copy of the words; s/student.js holds a preview's sample report.
const OWN_WORDS = new Set(['shared/phone-report-view.js', 's/student.js']);

const TO_FIXED_1 = {
  'teacher/page-gradebook.js': 4,
  'teacher/student-overrides.js': 1,
  'teacher/ui.js': 1,
};
const PROF_LABELS_USES = {
  'teacher-mobile/card-widgets.js': 4,
  'teacher-mobile/student-detail.js': 7,
  'teacher-mobile/tab-grade.js': 4,
  'teacher/comment-bank.js': 1,
  'teacher/comment-personal.js': 1,
  // The level word as a line's label ("Developing: …") and as the key of the bank's step for it.
  'teacher/competency-wording.js': 2,
  'teacher/dash-class-manager.js': 4,
  'teacher/dash-insights.js': 8,
  'teacher/dash-observations.js': 1,
  'teacher/dash-student-cards.js': 1,
  'teacher/page-assignments.js': 22,
  'teacher/page-gradebook.js': 2,
  'teacher/page-student.js': 2,
  'teacher/report-blocks.js': 21,
  'teacher/report-feedback-cards.js': 2,
  'teacher/report-questionnaire.js': 1,
  'teacher/rubric-bank.js': 2,
  'teacher/student-overrides.js': 2,
  'teacher/ui.js': 2,
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

function count(src, needle) {
  return src.split(needle).length - 1;
}

const WORD = "'(?:Emerging|Developing|Proficient|Extending)'";
const WORD_LIST = new RegExp(WORD + '\\s*,\\s*' + WORD + '|\\b[1-4]\\s*:\\s*' + WORD);

describe('grades are formatted only in calc.js', () => {
  const files = sources();

  it('has no list of the proficiency words outside PROF_LABELS', () => {
    const hits = files
      .filter(f => !OWN_WORDS.has(f.rel))
      .filter(f => WORD_LIST.test(f.src))
      .map(f => f.rel);
    expect(hits).toEqual([]);
  });

  it('rounds no more levels by hand than before (.toFixed(1))', () => {
    const over = files
      .map(f => [f.rel, count(f.src, '.toFixed(1)'), TO_FIXED_1[f.rel] || 0])
      .filter(([, n, cap]) => n > cap)
      .map(([rel, n, cap]) => rel + ': ' + n + ' > ' + cap);
    expect(over).toEqual([]);
  });

  it('names no more levels by hand than before (PROF_LABELS[)', () => {
    const over = files
      .map(f => [f.rel, count(f.src, 'PROF_LABELS['), PROF_LABELS_USES[f.rel] || 0])
      .filter(([, n, cap]) => n > cap)
      .map(([rel, n, cap]) => rel + ': ' + n + ' > ' + cap);
    expect(over).toEqual([]);
  });
});
