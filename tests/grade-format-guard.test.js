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
 *
 * A level reads as it is printed (DECISIONS, 2026-11-11): 2.47 prints 2.5
 * and is Proficient. So outside calc.js nothing rounds or compares a level
 * or a % itself; it calls roundLevel, printedLevel, levelWord, levelCode,
 * nearestScoreLevel, wholePercent, oneDecimal or formatPointsPercent. The
 * second half of this file fails on:
 * - a Math.round, Math.floor or Math.ceil of anything that looks like a
 *   level or a % (its argument names a level, prof, avg, score, pct, …)
 *   that is not on the list below, each with why it is not a grade;
 * - a level compared with 1.5, 2.5 or 3.5 (or x.45) by hand;
 * - more `.toFixed(` than a file has today.
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
  // A points score's % in a cell's title, through calc.js oneDecimal.
  'teacher/page-gradebook.js': 1,
};
const PROF_LABELS_USES = {
  'teacher-mobile/card-widgets.js': 1,
  'teacher-mobile/student-detail.js': 7,
  'teacher-mobile/tab-grade.js': 7, // + the grading card's level key and its level buttons' names (Step 4 sweep, Nov 3)
  'teacher/comment-bank.js': 1,
  'teacher/comment-personal.js': 1,
  // The level word as a line's label ("Developing: …").
  'teacher/competency-wording.js': 1,
  'teacher/dash-class-manager.js': 2,
  'teacher/dash-insights.js': 7,
  'teacher/dash-observations.js': 1,
  'teacher/page-assignments.js': 27, // + Edit My Wording's level labels (rubric rows), Nov 2; + the compact rubric editor's column heads, cell hints and points labels (rubric starts PR 5)
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

/* ── A level or % rounded or compared by hand ───────────────────── */

// Every file but calc.js (where grades are read) and the sample class.
const ROUND_EXEMPT = new Set(['shared/calc.js', 'shared/seed-data.js']);
// An argument that looks like a level or a % by its names.
const LEVELISH =
  /level|lvl|prof|avg|overall|score|mean|median|pct|percent|grade|current|\bsp\b|\bgp\b|\bv\b|value|\bnow\b|\bstart\b|\bthen\b|\bval\b|\bR\b|\*\s*100\b/i;
// Rounding what a calc.js reader gave (tenths of a printed figure) is fine.
const READ_FIRST = /^(printedLevel|roundLevel|oneDecimal|wholePercent)\(/;

/* The Math.round / floor / ceil calls outside calc.js whose argument looks
   like a level or a % and is not one: 'file kind argument' → why. */
const NOT_A_GRADE = {
  'shared/backup-restore.js floor v': 'a whole-number check on a restored setting',
  'shared/constants.js round v * 100': 'formatPoints: points to two decimals',
  'shared/constants.js round n * 100': 'a points score as saved, to two decimals',
  'teacher/class-results.js round (n / total) * 100': 'a share of students',
  'teacher/cm-questionnaires.js round (answered / students.length) * 100': 'a share answered',
  'teacher/dash-class-manager.js round dw * 100': 'a Decaying Average weight, a setting',
  'teacher/dash-class-manager.js round ((e.clientX - d.rect.left) / d.rect.width) * 100 * (1 / snap)':
    'a Counts As % dragged on its slider',
  'teacher/grading-setup-copy.js round calc.decayWeight * 100': 'a Decaying Average weight, a setting',
  'teacher/rubric-print.js round (f - 0.05) * 100': 'a print scale',
  'teacher/rubric-print.js round out.scale * 100': 'a print scale',
  'shared/data.js floor Number(v)': 'a whole-number setting',
  'shared/data.js floor v': 'a whole-number check (a habit rating, a count)',
  'shared/phone-report-view.js round Number(level) || 0':
    'the phone report’s level is already whole: phone-reports.js sends roundLevel’s',
  'shared/student-view.js floor v': 'a count or an index',
  'teacher/class-results.js round pct': 'a bar’s width',
  'teacher/class-results.js round (38 - ((p.pct - lo) / (hi - lo)) * 32) * 10': 'a chart point’s y',
  'teacher/class-results.js round v.value * 10': 'stacks dots that share a points value',
  'teacher/comment-bank.js floor Number(v)': 'a saved limit, a whole number',
  'teacher/comment-bank.js round (nx.min - Number(g.pct)) * 10': 'the gap to the next letter from the shown course %',
  'teacher/comment-personal.js floor Number(v[k])': 'a count',
  'teacher/dash-class-manager.js round up ? Math.max(8, r.top - 4 - menu.offsetHeight) : r.bottom + 4':
    'a menu’s position',
  'teacher/dash-class-manager.js round v * 10': 'a Counts As % being set, to one decimal',
  'teacher/dash-class-manager.js round Math.max(0, Math.min(100, v)) * 10': 'a Counts As % being set',
  "teacher/dash-class-manager.js round (_cmPtsValue(cid, p) + (e.key === 'ArrowRight' ? by : -by)) * 10":
    'a Points to Proficiency start being set',
  'teacher/dash-insights.js round r.min': 'a rule’s fewest pieces',
  'teacher/factor-field.js round Number(v) * 10': 'an assessment’s Factor',
  'teacher/grades-print.js round Math.max(8, r.right - menu.offsetWidth)': 'a menu’s position',
  'teacher/page-assignments.js round r.left + r.width / 2 - boxRect.left - 8': 'a pointer’s position',
  'teacher/page-assignments.js round (parseLocalDate(r.revise_by) - day) / 86400000': 'days',
  'teacher/page-dashboard.js round r.bottom - c.top + 2': 'a tip’s position',
  'teacher/page-student.js round p.R - lg.R': 'points between two course % as shown',
  'teacher/page-student.js round one.R - lg.R': 'points between two course % as shown',
  'teacher/page-student.js round (Math.min(e.score, 4) / 4) * 28': 'a bar’s height',
  'teacher/page-student.js round levelBarPercent(cid, r.v)': 'a bar’s width',
  'teacher/report-blocks.js round (nowG.pct - thenG.pct) * 10': 'the change between two course % as shown',
  'teacher/report-blocks.js round (profPlus / total) * 100': 'a share of scores',
  'teacher/report-blocks.js round (counts[level] / total) * 100': 'a share of scores',
  'teacher/report-questionnaire.js round ((x - r.left - inset) / span) * (HS_STOPS - 1)': 'a slider stop',
  'teacher/report-questionnaire.js round (nx.min - Number(g.pct)) * 10':
    'the gap to the next letter from the shown course %',
  'teacher-mobile/card-widgets.js round levelBarPercent(cid, value)': 'a bar’s width',
  'teacher-mobile/card-widgets.js round pct': 'evidence coverage, a share',
  'teacher-mobile/tab-grade.js round (gradedCount / total) * 100': 'a share graded',
  's/page-view.js round Number(level)': 'a level the student view gives, already whole (calc.js’s)',
  's/page-view.js round v * 10000': 'a share',
  's/page-view.js round 8 + ((4 - Math.max(1, Math.min(4, Number(v) || 1))) / 3) * (CHART.h - 16)': 'a chart point’s y',
  's/student-data.js floor v': 'a whole-number check',
};

/* `.toFixed(` per file today, none of them a level or a %: SVG and CSS
   positions, a zoom, a points %'s title through oneDecimal, and the CSV's
   two decimals of the level as stored (data, not a reading). */
const TO_FIXED = {
  'shared/constants.js': 1, // pointsPctHtml, through oneDecimal
  'teacher/page-gradebook.js': 4, // a title through oneDecimal; the CSV's stored levels to two decimals
  'teacher/page-student.js': 12, // chart coordinates
  'teacher/report-studio.js': 1, // a zoom
  'teacher/rubric-bank.js': 2, // gradient stops
  'teacher/student-evidence.js': 1, // positions
  'teacher-mobile/card-widgets.js': 4, // chart coordinates
};

/* Comments blanked, so a comment can name Math.round. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

function argAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

function allSources() {
  const out = [];
  DIRS.forEach(dir => {
    readdirSync(join(ROOT, dir))
      .filter(f => f.endsWith('.js'))
      .forEach(f => {
        const rel = dir + '/' + f;
        if (!ROUND_EXEMPT.has(rel)) out.push({ rel, src: code(readFileSync(join(ROOT, rel), 'utf-8')) });
      });
  });
  return out;
}

/* 'file kind argument' for each Math.round / floor / ceil of something
   that looks like a level or a %. */
function roundings(files) {
  const out = [];
  files.forEach(({ rel, src }) => {
    const re = /Math\.(round|floor|ceil)\(/g;
    let m;
    while ((m = re.exec(src))) {
      const arg = argAt(src, m.index + m[0].length - 1)
        .replace(/\s+/g, ' ')
        .trim();
      if (!READ_FIRST.test(arg) && LEVELISH.test(arg)) out.push(rel + ' ' + m[1] + ' ' + arg);
    }
  });
  return out;
}

describe('a level or % is read only through calc.js', () => {
  const files = allSources();

  it('rounds no level or % by hand (Math.round, floor, ceil)', () => {
    const hits = roundings(files).filter(key => !NOT_A_GRADE[key]);
    expect(hits).toEqual([]);
  });

  it('lists only roundings that are still there', () => {
    const found = new Set(roundings(files));
    expect(Object.keys(NOT_A_GRADE).filter(key => !found.has(key))).toEqual([]);
  });

  it('compares no level with a line by hand (1.5, 2.5, 3.5)', () => {
    const hits = [];
    files.forEach(({ rel, src }) => {
      const re = /[<>]=?\s*[1-4]\.(5|45)\b/g;
      let m;
      while ((m = re.exec(src))) hits.push(rel + ': ' + src.slice(Math.max(0, m.index - 40), m.index + 8).trim());
    });
    expect(hits).toEqual([]);
  });

  it('rounds no more figures by hand than before (.toFixed)', () => {
    const over = files
      .map(f => [f.rel, count(f.src, '.toFixed('), TO_FIXED[f.rel] || 0])
      .filter(([, n, cap]) => n > cap)
      .map(([rel, n, cap]) => rel + ': ' + n + ' > ' + cap);
    expect(over).toEqual([]);
  });

  it('prints a one-decimal figure only from calc.js (oneDecimal(…).toFixed(1))', () => {
    const hits = [];
    files.forEach(({ rel, src }) => {
      let at = src.indexOf('.toFixed(1)');
      while (at >= 0) {
        const line = src.slice(src.lastIndexOf('\n', at) + 1, at);
        if (!/oneDecimal\([^;]*\)$/.test(line)) hits.push(rel + ': ' + line.trim());
        at = src.indexOf('.toFixed(1)', at + 1);
      }
    });
    expect(hits).toEqual([]);
  });

  it('catches the old ways of reading a level', () => {
    const fake = [
      { rel: 'x.js', src: 'var r = Math.round(sp);' },
      { rel: 'x.js', src: 'var w = PROF_LABELS[Math.max(1, Math.min(4, Math.round(avg)))];' },
      { rel: 'x.js', src: "return Math.round(stats.pct) + '%';" },
      { rel: 'x.js', src: 'var t = Math.round(levelToPercent(cid, overall) * 10) / 10;' },
      { rel: 'x.js', src: 'if (!(Math.round(c.level) >= 3)) return;' },
    ];
    expect(roundings(fake)).toHaveLength(5);
    const fine = 'var r = roundLevel(sp); var t = Math.round(printedLevel(v) * 10); var x = Math.round(left);';
    expect(roundings([{ rel: 'x.js', src: fine }])).toEqual([]);
  });
});
