/**
 * grade: the tests that were tests/grade-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clearClass, seedClass } from './helpers/pin-save-paths.js';

describe('grade-display-mode', () => {
  /**
   * Every screen shows grades the way the class is set to grade
   * (shared/calc.js): Proficiency shows levels out of 4, Letter shows the
   * letter grade and %, Both shows both. A competency's level shows as a %
   * by level ÷ 4.
   */

  const CID = 'f0000000-0000-4000-8000-000000000001';

  describe('grades shown by grading setting', () => {
    var originalOverall;
    var originalLetter;
    var overall;
    var letter;

    beforeEach(() => {
      originalOverall = globalThis.getOverallProficiency;
      originalLetter = globalThis.getCourseLetterData;
      overall = { s1: 2.8, s2: 3.4, s3: 0 };
      letter = { s1: { S: 'B', R: 78.9 }, s2: { S: 'A', R: 91 }, s3: { S: null, R: null } };
      globalThis.getOverallProficiency = function (cid, sid) {
        return overall[sid] || 0;
      };
      globalThis.getCourseLetterData = function (cid, sid) {
        return letter[sid];
      };
      if (typeof COURSES === 'undefined') globalThis.COURSES = {};
    });

    afterEach(() => {
      globalThis.getOverallProficiency = originalOverall;
      globalThis.getCourseLetterData = originalLetter;
      delete COURSES[CID];
    });

    function setting(gradingSystem) {
      COURSES[CID] = { id: CID, name: 'Philosophy 12', gradingSystem: gradingSystem };
    }

    it('reads the class setting, Proficiency by default', () => {
      expect(courseGradeMode(CID)).toBe('proficiency');
      setting('letter');
      expect(courseGradeMode(CID)).toBe('letter');
      setting('both');
      expect(courseGradeMode(CID)).toBe('both');
    });

    it('shows a competency level as a level, a %, or both', () => {
      setting('proficiency');
      expect(formatLevel(CID, 2.8)).toBe('2.8');
      setting('letter');
      expect(formatLevel(CID, 2.8)).toBe('70%');
      setting('both');
      expect(formatLevel(CID, 2.8)).toBe('2.8 · 70%');
      expect(formatLevel(CID, 0)).toBe('—');
    });

    it("names a student's or competency's level, or gives its % in a Letter class", () => {
      setting('proficiency');
      expect(levelText(CID, 2.8)).toBe('Proficient');
      setting('both');
      expect(levelText(CID, 2.8)).toBe('Proficient');
      setting('letter');
      expect(levelText(CID, 2.8)).toBe('70%');
      expect(levelText(CID, 0)).toBe('');
      expect(levelText(CID, 0, 'No Evidence')).toBe('No Evidence');
    });

    it("shows a student's overall grade as the class grades", () => {
      setting('proficiency');
      expect(studentGradeSummary(CID, 's1')).toEqual({ text: '2.8', level: 3 });
      setting('letter');
      expect(studentGradeSummary(CID, 's1')).toEqual({ text: 'B 78.9%', level: 3 });
      setting('both');
      expect(studentGradeSummary(CID, 's1')).toEqual({ text: '2.8 · B 78.9%', level: 3 });
      expect(studentGradeSummary(CID, 's3').text).toBe('');
    });

    it('shows the roster grade as a proficiency code', () => {
      // The code follows the printed figure: 2.44 prints 2.4, 2.49 prints 2.5.
      expect([0, 1, 1.4, 1.5, 2.44, 2.49, 2.67, 3, 3.33, 3.5, 4].map(levelCode)).toEqual([
        'IE',
        'EMG',
        'EMG',
        'DEV',
        'DEV',
        'PRF',
        'PRF',
        'PRF',
        'PRF',
        'EXT',
        'EXT',
      ]);
      setting('proficiency');
      expect(studentRosterBadges(CID, 's1')).toEqual({
        prof: { text: 'PRF', level: 3, title: 'Proficient' },
        letter: null,
      });
      // No evidence reads IE, BC's Insufficient Evidence, not IC.
      expect(studentRosterBadges(CID, 's3').prof).toEqual({ text: 'IE', level: 0, title: 'No Evidence' });
      setting('both');
      expect(studentRosterBadges(CID, 's1').prof.text).toBe('PRF');
      expect(studentRosterBadges(CID, 's1').letter.text).toBe('B 78.9%');
      setting('letter');
      expect(studentRosterBadges(CID, 's1')).toEqual({
        prof: null,
        letter: { text: 'B 78.9%', grade: 'B', pct: '78.9%', level: 3 },
      });
      expect(studentRosterBadges(CID, 's3')).toEqual({ prof: null, letter: null });
    });

    it('colours a letter grade by its band', () => {
      setting('letter');
      expect(studentGradeSummary(CID, 's2').level).toBe(4);
      letter.s2 = { S: 'C', R: 62 };
      expect(studentGradeSummary(CID, 's2').level).toBe(2);
    });

    it('drops the proficiency word in a Letter class', () => {
      setting('letter');
      expect(levelWord(CID, 2.8)).toBe('');
      setting('both');
      expect(levelWord(CID, 2.8)).toBe(PROF_LABELS[3]);
    });

    it('averages the class the same way', () => {
      setting('proficiency');
      expect(classGradeSummary(CID, ['s1', 's2', 's3']).text).toBe('3.1');
      setting('letter');
      // (78.9 + 91) / 2 = 84.95, shown to one decimal as 85%, a B.
      expect(classGradeSummary(CID, ['s1', 's2', 's3']).text).toBe('B 85%');
    });
  });
});

describe('grade-format-guard', () => {
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
    'teacher-mobile/tab-grade.js': 4, // the checklist's level names; the level buttons' words are scoreLevelText's (MComponents.levelButtonsHTML)
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
    'shared/student-view.js floor r.page_count': 'how many pages a handout has',
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
    's/page-view.js round 8 + ((4 - Math.max(1, Math.min(4, Number(v) || 1))) / 3) * (CHART.h - 16)':
      'a chart point’s y',
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
});

describe('grade-report', () => {
  /**
   * The Grade Report (teacher/grade-report.js): the ready-made progress
   * report with a row per assessment this term, a summary by category and
   * the term grade, laid out to one sheet per student.
   */

  const G = GradeReport;
  const CID = 'cg';
  const ST = { id: 's1', firstName: 'Ada', lastName: 'Lovelace' };

  const keep = {};
  const stub = (name, fn) => {
    if (!(name in keep)) keep[name] = globalThis[name];
    globalThis[name] = fn;
  };
  afterEach(() => {
    Object.keys(keep).forEach(k => {
      globalThis[k] = keep[k];
      delete keep[k];
    });
  });

  function seed(mode) {
    const work = [
      { id: 'a1', title: 'Formulas Quiz', date: '2026-09-10', categoryId: 'c2', scoreMode: 'points', maxPoints: 15 },
      { id: 'a2', title: 'Plate Tectonics', date: '2026-10-05', categoryId: 'c1' },
      { id: 'a3', title: 'Energy Quiz', date: '2026-10-12', categoryId: 'c2', scoreMode: 'points', maxPoints: 10 },
      { id: 'a4', title: 'Reading Log', date: '2026-10-14', categoryId: 'c1', scoreMode: 'complete' },
      { id: 'a5', title: 'Field Trip Form', date: '2026-10-15', categoryId: 'c1' },
      { id: 'a6', title: 'Next Week', date: '2026-10-20', categoryId: 'c1' },
    ];
    const cells = {
      a1: { kind: 'points', value: 12, level: 3, late: true },
      a2: { kind: 'level', value: 3.33, level: 3, percentText: '83%', late: false },
      a3: { kind: 'status', status: 'NS', value: 0, level: 0, late: false },
      a4: { kind: 'complete', mark: 'complete', value: 1, late: false },
      a5: { kind: 'status', status: 'EXC', late: false },
      a6: { kind: 'none', late: false },
    };
    stub('getAssessments', () => work);
    stub('assessmentInYearToDate', () => true);
    stub('assessmentCellValue', (cid, sid, a) => cells[a.id]);
    stub('getCategories', () => [
      { id: 'c1', name: 'Labs', weight: 40 },
      { id: 'c2', name: 'Quizzes', weight: 60 },
    ]);
    stub('courseGradeMode', () => mode || 'proficiency');
  }

  describe('options', () => {
    it('fills the defaults and keeps only known choices', () => {
      expect(G.options(null)).toEqual({
        summary: true,
        ungraded: true,
        numbers: false,
        order: 'oldest',
        name: 'preferred',
        feedback: false,
        rubrics: true,
        comments: true,
        observations: false,
        termComment: false,
      });
      expect(
        G.options({
          summary: false,
          ungraded: false,
          numbers: true,
          comment: true,
          order: 'newest',
          name: 'first',
          junk: 1,
        }),
      ).toEqual({
        summary: false,
        ungraded: false,
        numbers: true,
        order: 'newest',
        name: 'first',
        feedback: false,
        rubrics: true,
        comments: true,
        observations: false,
        termComment: false,
      });
    });

    it('keeps the Feedback Pages choices when they are true or false, nothing else', () => {
      const o = G.options({ feedback: true, rubrics: false, comments: false, observations: true, termComment: 'yes' });
      expect(o).toMatchObject({
        feedback: true,
        rubrics: false,
        comments: false,
        observations: true,
        termComment: false,
      });
      expect(G.options({ feedback: 1 }).feedback).toBe(false);
    });
  });

  describe('rows', () => {
    it('lists this term’s marked, missing and excused work, oldest first, and unmarked work with a dash', () => {
      seed();
      stub('courseToday', () => '2026-10-29');
      const rows = G.rows(CID, ST, { ungraded: false });
      expect(rows.map(r => r.title)).toEqual([
        'Formulas Quiz',
        'Plate Tectonics',
        'Energy Quiz',
        'Reading Log',
        'Field Trip Form',
      ]);
      expect(rows[0]).toMatchObject({
        category: 'Quizzes',
        score: '12',
        outOf: '15',
        percent: '80%',
        note: 'Late',
      });
      expect(rows[1]).toMatchObject({ category: 'Labs', score: '3.3', outOf: '4', note: '' });
      expect(rows[0]).not.toHaveProperty('word');
      expect(rows[2]).toMatchObject({ score: '', outOf: '', note: 'Missing' });
      expect(rows[3]).toMatchObject({ score: 'Complete', outOf: '' });
      expect(rows[4]).toMatchObject({ score: '', note: 'Excused' });
      // Ungraded Assignments (on by default): work up to today with no mark
      // shows with a dash; work not yet due stays off.
      const all = G.rows(CID, ST);
      expect(all.map(r => r.title)).toEqual([
        'Formulas Quiz',
        'Plate Tectonics',
        'Energy Quiz',
        'Reading Log',
        'Field Trip Form',
        'Next Week',
      ]);
      expect(all[5]).toMatchObject({ score: '\u2014', outOf: '', percent: '', note: '' });
      stub('courseToday', () => '2026-10-18');
      expect(G.rows(CID, ST).map(r => r.title)).not.toContain('Next Week');
    });

    it('runs newest first on request', () => {
      seed();
      expect(G.rows(CID, ST, { order: 'newest', ungraded: false })[0].title).toBe('Field Trip Form');
    });

    it('numbers the rows 1 to n in the order they print, ungraded work included', () => {
      seed();
      stub('courseToday', () => '2026-10-29');
      const oldest = G.rows(CID, ST);
      expect(oldest.map(r => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(oldest[0].title).toBe('Formulas Quiz');
      expect(oldest[5]).toMatchObject({ n: 6, title: 'Next Week' });
      const newest = G.rows(CID, ST, { order: 'newest' });
      expect(newest.map(r => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(newest[0]).toMatchObject({ n: 1, title: 'Next Week' });
      // Rows left off (Ungraded Assignments off) leave no gap.
      expect(G.rows(CID, ST, { ungraded: false }).map(r => r.n)).toEqual([1, 2, 3, 4, 5]);
    });

    it('counts in Category Summary only the rows above it', () => {
      seed();
      stub('assessmentGroupGrade', () => ({ text: '80%' }));
      stub('categoryCalcMode', () => 'average');
      const counts = opts => G.categorySummary(CID, ST, opts).map(c => c.name + ' ' + c.count);
      stub('courseToday', () => '2026-10-29');
      expect(counts()).toEqual(['Labs 4', 'Quizzes 2']);
      // Unmarked work with Ungraded Assignments off, and work not yet due.
      expect(counts({ ungraded: false })).toEqual(['Labs 3', 'Quizzes 2']);
      stub('courseToday', () => '2026-10-18');
      expect(counts()).toEqual(['Labs 3', 'Quizzes 2']);
    });

    it('shows the percent in a Letter or Both class, and never a proficiency word', () => {
      seed('letter');
      expect(G.columnsFor(CID)).toEqual({ percent: true });
      seed('proficiency');
      expect(G.columnsFor(CID)).toEqual({ percent: false });
      seed('both');
      expect(G.columnsFor(CID)).toEqual({ percent: true });
    });
  });

  describe('plan', () => {
    const sizes = { letterheadPx: 60, tailPx: 200, headPx: 20 };
    const regular = { key: 'regular', rowPx: 19, cols: 1 };
    const two = { key: 'two', rowPx: 15, cols: 2 };
    const H = 996;

    it('keeps everything on the front when it fits there', () => {
      expect(G.plan(20, sizes, regular, H)).toEqual({ front: 20, back: 0, tailOnFront: true, fits: true });
    });

    it('carries the rows the front cannot hold to the back, with the summary under them', () => {
      const p = G.plan(60, sizes, regular, H);
      expect(p.tailOnFront).toBe(false);
      expect(p.front).toBe(Math.floor((H - 60 - 12 - 20) / 19));
      expect(p.front + p.back).toBe(60);
      expect(p.fits).toBe(true);
    });

    it('keeps room on the back for the line naming the student', () => {
      const p = G.plan(60, sizes, regular, H);
      const named = G.plan(60, Object.assign({ namePx: 16 }, sizes), regular, H);
      expect(named.front).toBe(p.front);
      expect(named.back).toBe(Math.min(60 - p.front, Math.floor((H - 28 - 200 - 12 - 20) / 19)));
      expect(G.plan(10, Object.assign({}, sizes, { tailPx: H - 20, namePx: 16 }), regular, H).fits).toBe(false);
    });

    it('does not fit past both sides at a size, and holds twice the rows in two columns', () => {
      expect(G.plan(120, sizes, regular, H).fits).toBe(false);
      const p = G.plan(120, sizes, two, H);
      expect(p.fits).toBe(true);
      expect(p.front % 2).toBe(0);
    });

    it('counts a two-line row at its height (step 4 group 3 #91)', () => {
      const tall = Array.from({ length: 60 }, (_, i) => i < 10);
      const p = G.plan(60, Object.assign({ tall }, sizes), Object.assign({ row2Px: 33 }, regular), H);
      // 904px under the letterhead and header: ten rows of 33, then 30 of 19.
      expect(p.front).toBe(40);
      expect(p.front + p.back).toBe(60);
      // In two columns the taller column decides.
      const q = G.plan(
        4,
        Object.assign({ tall: [true, true, false, false] }, sizes),
        Object.assign({ row2Px: 30 }, two),
        200,
      );
      expect(q.front).toBe(4);
      const r = G.plan(
        4,
        Object.assign({ tall: [true, true, false, false] }, sizes),
        Object.assign({ row2Px: 30 }, two),
        132,
      );
      // 132 - 72 = 60 under the letterhead: header 20 leaves 40, one tall row
      // a column.
      expect(r.front).toBe(2);
    });
  });

  describe('long titles and categories (step 4 group 3 #91)', () => {
    const LONG = "5.1 Mapping Germany's Conquest of Europe, 1939-1941, With Sources and a Written Response";
    const layout = () => {
      seed();
      const work = getAssessments().map(a => (a.id === 'a2' ? Object.assign({}, a, { title: LONG }) : a));
      stub('getAssessments', () => work);
      stub('courseToday', () => '2026-10-29');
      stub('ReportBlocks', {
        renderBlockHeader: () => '<div class="gr-letterhead">Letterhead</div>',
        renderContinuedLine: () => '<div class="sheet-name-line">Ada Lovelace (continued)</div>',
        reportContext: () => ({}),
      });
      stub('ReportSheets', { sideHeight: () => 996 });
      stub('studentGradeSummary', () => ({ text: '80%' }));
      stub('assessmentGroupGrade', () => ({ text: '80%' }));
      stub('categoryCalcMode', () => 'average');
      stub('fullName', s => s.firstName + ' ' + s.lastName);
      // No DOM here: every block 50px tall, every text 7px a character.
      const stage = {
        innerHTML: '',
        firstChild: { offsetHeight: 50 },
        querySelectorAll() {
          return [...this.innerHTML.matchAll(/class="gr-measure"[^>]*>([^<]*)</g)].map(m => ({
            offsetWidth: m[1].replace(/&#39;|&amp;/g, 'x').length * 7,
          }));
        },
      };
      return G.layoutStudent(CID, ST, {}, { paper: 'letter', stage, grade: {} }).html;
    };

    it('prints a title too long for its cell on two lines, and only that row', () => {
      const html = layout();
      const rows = [...html.matchAll(/<div class="gr-row([^"]*)">((?:(?!<div class="gr-row).)*)/g)];
      const wrapped = rows.filter(m => m[1].includes('gr-wrap')).map(m => m[2]);
      expect(wrapped).toHaveLength(1);
      expect(wrapped[0]).toContain('Mapping Germany');
      expect(html).toMatch(/--gr-row2:\d+px/);
    });
  });

  describe('Assignment Numbers column', () => {
    const stageHtml = numbers => {
      seed();
      stub('courseToday', () => '2026-10-29');
      stub('ReportBlocks', {
        renderBlockHeader: () => '<div class="gr-letterhead">Letterhead</div>',
        renderContinuedLine: () => '<div class="sheet-name-line">Ada Lovelace (continued)</div>',
        reportContext: () => ({}),
      });
      stub('ReportSheets', { sideHeight: () => 996 });
      stub('studentGradeSummary', () => ({ text: '80%' }));
      stub('assessmentGroupGrade', () => ({ text: '80%' }));
      stub('categoryCalcMode', () => 'average');
      stub('fullName', s => s.firstName + ' ' + s.lastName);
      // No DOM here: a stage that measures every block 50px tall.
      const stage = { innerHTML: '', firstChild: { offsetHeight: 50 }, querySelectorAll: () => [] };
      return G.layoutStudent(CID, ST, {}, { paper: 'letter', stage, grade: { numbers } }).html;
    };
    const cells = (html, re) => [...html.matchAll(re)].map(m => m[1]);

    it('adds a # header and a number on every row when on', () => {
      const html = stageHtml(true);
      expect(cells(html, /gr-head"><span class="gr-c gr-n gr-r">([^<]*)</g)).toEqual(['#']);
      expect(cells(html, /<span class="gr-c gr-n gr-r">(\d+)</g)).toEqual(['1', '2', '3', '4', '5', '6']);
    });

    it('leaves the table as it was when off', () => {
      const html = stageHtml(false);
      expect(html).not.toContain('gr-c gr-n ');
      expect(html).toContain('gr-head"><span class="gr-c gr-date">Date<');
    });
  });

  /* The Feedback Pages' packing: pure over measured heights. */
  describe('packColumns', () => {
    const cols = r => r.sides.map(sd => sd.map(col => col.map(p => p.i)));

    it('fits in one column', () => {
      const r = G.packColumns([100, 200, 300], 1000, { gap: 12 });
      expect(cols(r)).toEqual([[[0, 1, 2], []]]);
      expect(r.over).toBe(false);
    });

    it('counts the gap between cards, not before the first', () => {
      // 3 × 330 + 2 gaps = 1014 > 1000: the third card moves on.
      expect(cols(G.packColumns([330, 330, 330], 1000, { gap: 12 }))).toEqual([[[0, 1], [2]]]);
      // Exactly full: 2 × 494 + 12 = 1000.
      expect(cols(G.packColumns([494, 494], 1000, { gap: 12 }))).toEqual([[[0, 1], []]]);
    });

    it('overflows to the right column, then to the next side', () => {
      const r = G.packColumns([600, 600, 600, 600, 100], 1000, { gap: 12 });
      expect(cols(r)).toEqual([
        [[0], [1]],
        [[2], [3, 4]],
      ]);
    });

    it('keeps the order: a short card never moves back into an earlier gap', () => {
      const r = G.packColumns([700, 400, 100, 900, 50], 1000, { gap: 12 });
      const order = r.sides.flatMap(sd => sd.flatMap(col => col.map(p => p.i)));
      expect(order).toEqual([0, 1, 2, 3, 4]);
      expect(cols(r)).toEqual([
        [[0], [1, 2]],
        [[3, 4], []],
      ]);
    });

    it('gives no sides for no cards', () => {
      expect(G.packColumns([], 1000)).toEqual({ sides: [], over: false });
    });

    it('puts a card taller than a column alone and says it is over', () => {
      const r = G.packColumns([100, 1200, 100], 1000, { gap: 12 });
      expect(cols(r)).toEqual([
        [[0], [1]],
        [[2], []],
      ]);
      expect(r.over).toBe(true);
    });

    it('splits a rubric taller than a column between its rows, title and header repeated', () => {
      const rubric = { h: 1500, rows: [300, 300, 300, 300, 200], head: 60, contHead: 64, foot: 10, tail: 80 };
      const r = G.packColumns([200, rubric, 100], 1000, { gap: 12 });
      const pieces = r.sides.flatMap(sd => sd.flatMap(col => col)).filter(p => p.i === 1);
      // The first piece fills the room under the first card: 1000 − 200 − 12
      // = 788 holds the head, two rows and the foot (670).
      expect(pieces.map(p => [p.from, p.to, p.part, p.last])).toEqual([
        [0, 2, 0, false],
        [2, 5, 1, true],
      ]);
      expect(pieces[0].h).toBe(60 + 600 + 10);
      expect(pieces[1].h).toBe(64 + 800 + 80);
      expect(cols(r)).toEqual([
        [[0, 1], [1]],
        [[2], []],
      ]);
      expect(r.over).toBe(false);
    });

    it('never splits a card that fits a whole column: it moves to the next column instead', () => {
      const rubric = { h: 900, rows: [450, 450], head: 0, contHead: 0, foot: 0, tail: 0 };
      const r = G.packColumns([200, rubric], 1000, { gap: 12 });
      expect(r.sides[0][1]).toEqual([{ i: 1, h: 900 }]);
    });
  });

  describe('splitRows', () => {
    const parts = { head: 50, contHead: 55, foot: 5, tail: 40 };

    it('keeps every row whole and in order, the tail on the last piece', () => {
      const r = G.splitRows([200, 200, 200, 200, 200, 200], parts, 600, 600);
      expect(r.pieces).toEqual([
        { from: 0, to: 2, h: 455 },
        { from: 2, to: 4, h: 460 },
        { from: 4, to: 6, h: 495 },
      ]);
      expect(r.startNext).toBe(false);
      expect(r.over).toBe(false);
    });

    it('moves the last row on when the Feedback under it does not fit', () => {
      const r = G.splitRows([270, 270], { head: 50, contHead: 50, foot: 5, tail: 300 }, 600, 600);
      expect(r.pieces.map(p => [p.from, p.to])).toEqual([
        [0, 1],
        [1, 2],
      ]);
    });

    it('starts on a fresh column when not one row fits the room left', () => {
      const r = G.splitRows([300, 300, 300], parts, 600, 200);
      expect(r.startNext).toBe(true);
      expect(r.pieces[0]).toEqual({ from: 0, to: 1, h: 355 });
    });

    it('puts a row taller than a column alone and says it is over', () => {
      const r = G.splitRows([100, 900, 100], parts, 600, 600);
      expect(r.pieces.map(p => [p.from, p.to])).toEqual([
        [0, 1],
        [1, 2],
        [2, 3],
      ]);
      expect(r.over).toBe(true);
    });
  });

  describe('feedbackItems', () => {
    const items = () => [
      { id: 'r1', kind: 'rubric', rubric: { rows: [{}] }, feedback: [] },
      { id: 'r2', kind: 'rubric', rubric: { rows: [{}] }, feedback: [{ text: 'Good' }] },
      { id: 'p1', kind: 'points', rubric: null, feedback: [{ text: 'Check units' }] },
    ];

    it('keeps every card with Rubrics and Assignment Comments on', () => {
      stub('ReportFeedback', { forStudent: () => items() });
      expect(G.feedbackItems(CID, ST, G.options({})).map(x => x.id)).toEqual(['r1', 'r2', 'p1']);
    });

    it('Rubrics off drops the tables; a rubric with nothing written goes', () => {
      stub('ReportFeedback', { forStudent: () => items() });
      const out = G.feedbackItems(CID, ST, G.options({ rubrics: false }));
      expect(out.map(x => x.id)).toEqual(['r2', 'p1']);
      expect(out[0].rubric).toBe(null);
    });

    it('Assignment Comments off drops the feedback; a points card with nothing left goes', () => {
      stub('ReportFeedback', { forStudent: () => items() });
      const out = G.feedbackItems(CID, ST, G.options({ comments: false }));
      expect(out.map(x => x.id)).toEqual(['r1', 'r2']);
      expect(out[1].feedback).toEqual([]);
    });

    it('passes the order on', () => {
      let seen = null;
      stub('ReportFeedback', {
        forStudent: (cid, st, o) => {
          seen = o.order;
          return [];
        },
      });
      G.feedbackItems(CID, ST, G.options({ order: 'newest' }));
      expect(seen).toBe('newest');
    });
  });

  describe('extra cards: Observations and Term Comment', () => {
    const OBS = [
      { id: 'o1', date: 'Oct 6', dateIso: '2026-10-06', text: 'Led the group.', tags: ['Collaboration'] },
      { id: 'o2', date: 'Oct 9', dateIso: '2026-10-09', text: 'Asked a good question.', tags: [] },
      { id: 'o3', date: 'Oct 12', dateIso: '2026-10-12', text: 'Helped a partner.', tags: [] },
    ];
    const feed = (obs, text) => {
      const seen = {};
      stub('ReportFeedback', {
        observations: (cid, st, termId) => {
          seen.obs = termId;
          return obs;
        },
        termComment: (cid, st, termId) => {
          seen.term = termId;
          return text;
        },
      });
      return seen;
    };

    it('the options are off until ticked, and they add nothing then', () => {
      feed(OBS, 'A good term.');
      expect(G.extraCards(CID, ST, { termId: 'term-1' }, G.options({ feedback: true }))).toEqual([]);
    });

    it('Observations, then the Term Comment, for the report term', () => {
      const seen = feed(OBS, 'First.\nSecond.');
      const out = G.extraCards(CID, ST, { termId: 'term-2' }, G.options({ observations: true, termComment: true }));
      expect(out.map(x => x.kind)).toEqual(['observations', 'term']);
      expect(out[0].rows).toHaveLength(3);
      expect(out[1].rows).toEqual(['First.', 'Second.']);
      expect(seen).toEqual({ obs: 'term-2', term: 'term-2' });
    });

    it('a card is left out when the student has nothing for it', () => {
      feed([], 'A good term.');
      const o = G.options({ observations: true, termComment: true });
      expect(G.extraCards(CID, ST, {}, o).map(x => x.kind)).toEqual(['term']);
      feed(OBS, '');
      expect(G.extraCards(CID, ST, {}, o).map(x => x.kind)).toEqual(['observations']);
    });

    it('a piece of the Observations card holds its entries; a later piece says (continued)', () => {
      stub('ReportFeedback', ReportFeedback);
      const x = { kind: 'observations', rows: OBS };
      const first = G.extraHtml(x, { from: 0, to: 2, part: 0 });
      expect(first).toContain('Observations</b>');
      expect(first).toContain('Led the group.');
      expect(first).toContain('Asked a good question.');
      expect(first).not.toContain('Helped a partner.');
      const later = G.extraHtml(x, { from: 2, to: 3, part: 1 });
      expect(later).toContain('Observations (continued)');
      expect(later).toContain('Helped a partner.');
      expect(later).not.toContain('Led the group.');
    });

    it('a Term Comment splits between paragraphs the same way', () => {
      const x = { kind: 'term', rows: ['One.', 'Two.', 'Three.'] };
      const later = G.extraHtml(x, { from: 1, to: 3, part: 1 });
      expect(later).toContain('Term Comment (continued)');
      expect(later).toContain('Two.');
      expect(later).toContain('Three.');
      expect(later).not.toContain('One.');
    });

    it('splitRows cuts a long observations log between entries', () => {
      const rows = [100, 100, 100, 100, 100, 100];
      const r = G.splitRows(rows, { head: 30, contHead: 30, foot: 6, tail: 6 }, 340, 340);
      expect(r.over).toBe(false);
      expect(r.pieces.map(p => [p.from, p.to])).toEqual([
        [0, 3],
        [3, 6],
      ]);
    });
  });

  /* The Grade Report's Back started straight with the table or the summary,
   so a sheet printed single-sided could not be matched to its student;
   every side after the Front of a built report names the student (#875,
   Colin Nov 3: "Yes, all three"). */
  describe('the Back names the student', () => {
    const layout = sideH => {
      seed();
      stub('courseToday', () => '2026-10-29');
      stub('ReportBlocks', {
        renderBlockHeader: () => '<div class="gr-letterhead">Letterhead</div>',
        renderContinuedLine: () => '<div class="sheet-name-line">Ada Lovelace (continued)</div>',
        reportContext: () => ({}),
      });
      stub('ReportSheets', { sideHeight: () => sideH });
      stub('studentGradeSummary', () => ({ text: '80%' }));
      stub('assessmentGroupGrade', () => ({ text: '80%' }));
      stub('categoryCalcMode', () => 'average');
      stub('fullName', s => s.firstName + ' ' + s.lastName);
      const stage = { innerHTML: '', firstChild: { offsetHeight: 50 }, querySelectorAll: () => [] };
      return G.layoutStudent(CID, ST, {}, { paper: 'letter', stage, grade: {} });
    };
    const sidesOf = html => html.split('<div class="sheet-zoom"').slice(1);

    it('puts the line at the top of the Back, not on the Front', () => {
      const r = layout(200);
      expect(r.sides).toBe(2);
      const [front, back] = sidesOf(r.html);
      expect(front).not.toContain('sheet-name-line');
      expect(back).toMatch(/<div class="sheet-body"><div class="sheet-name-line">Ada Lovelace \(continued\)<\/div>/);
    });

    it('a report that fits the Front has no line', () => {
      const r = layout(996);
      expect(r.sides).toBe(1);
      expect(r.html).not.toContain('sheet-name-line');
    });
  });
});

describe('grade-state-drafts-in', () => {
  /**
   * GradeState.draftsIn (S1-F1, docs/plans/student-page-build-plan.md 1.4):
   * the students whose piece of work is a draft. A screen's To Return count
   * for a piece is the length of this list, and Return N Graded returns it,
   * so the gradebook, the graders and the phone count from one place.
   *
   * It is stateOf, the function the desktop grader dialog reads for its Draft
   * row, asked for each student: the same test of a cell as
   * GradeState.draftsWaiting (S1-F4), the class's whole count. So the lengths
   * over every student and assessment add up to draftsWaiting(cid).
   */

  const CID = 'c-drafts-in';
  const ESSAY = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1', 't2'] };
  const QUIZ = { id: 'quiz', title: 'Quiz', date: '2026-10-12', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] };
  const TALK = {
    id: 'talk',
    title: 'Talk',
    date: '2026-10-15',
    type: 'summative',
    tagIds: ['t1'],
    collaboration: 'pair',
    pairs: [['s1', 's2']],
  };
  const BENCH = { id: 'bench', title: 'Reading Benchmark', date: '2026-10-16', scoreMode: 'dibels', tagIds: [] };
  const IDS = ['s1', 's2', 's3', 's4'];
  const STUDENTS = IDS.map((id, i) => ({ id, firstName: ['Jordan', 'Avery', 'Noor', 'Lena'][i], lastName: 'Test' }));

  const level = (sid, aid, value) => upsertScore(CID, sid, aid, 't1', value, '2026-10-10', 'summative', '', 0);
  const drafts = (aid, ids = IDS) => GradeState.draftsIn(CID, aid, ids);

  function seed(config) {
    localStorage.clear();
    clearClass(CID);
    seedClass(CID, {
      students: STUDENTS,
      assessments: [ESSAY, QUIZ, TALK, BENCH].map(a => structuredClone(a)),
      courseConfigs: config || {},
    });
  }

  beforeEach(() => seed({ student_page_enabled: true, return_grades: 'on_return' }));
  afterEach(() => {
    clearClass(CID);
    localStorage.clear();
  });

  describe('GradeState.draftsIn', () => {
    it('lists the students with a draft, in the order asked, and no one else', () => {
      expect(drafts('essay')).toEqual([]);
      level('s3', 'essay', 3);
      level('s1', 'essay', 2);
      expect(drafts('essay')).toEqual(['s1', 's3']);
      expect(drafts('essay', ['s4', 's3', 's1'])).toEqual(['s3', 's1']);
      // Only the students asked about.
      expect(drafts('essay', ['s2', 's3'])).toEqual(['s3']);
      expect(drafts('essay', [])).toEqual([]);
      expect(drafts('essay', null)).toEqual([]);
      // Another piece of work has its own.
      expect(drafts('quiz')).toEqual([]);
    });

    it('agrees with stateOf, which the grader dialog reads, for every student and piece', () => {
      level('s1', 'essay', 3);
      setPointsScore(CID, 's2', 'quiz', 7);
      setPointsScore(CID, 's3', 'quiz', 0);
      level('s1', 'talk', 4);
      Grader.returnGrades(CID, 'quiz', ['s2']);
      ['essay', 'quiz', 'talk'].forEach(aid => {
        expect(drafts(aid), aid).toEqual(IDS.filter(sid => GradeState.stateOf(CID, sid, aid) === GradeState.DRAFT));
      });
      expect(drafts('quiz')).toEqual(['s3']);
      // Pair work: one save is a draft for both.
      expect(drafts('talk')).toEqual(['s1', 's2']);
    });

    it('a returned grade is not in it; changed since, it is again', () => {
      level('s1', 'essay', 3);
      Grader.returnGrades(CID, 'essay', drafts('essay'));
      expect(drafts('essay')).toEqual([]);
      level('s1', 'essay', 4);
      expect(drafts('essay')).toEqual(['s1']);
      // Put back to what was returned: nothing waits.
      level('s1', 'essay', 3);
      expect(drafts('essay')).toEqual([]);
    });

    it('Missing, Excused and Late alone are never drafts; Missing or Excused over a draft hides it', () => {
      applyAssignmentStatus(CID, 's1', 'essay', 'NS');
      applyAssignmentStatus(CID, 's2', 'essay', 'EXC');
      applyAssignmentStatus(CID, 's3', 'essay', 'LATE');
      expect(drafts('essay')).toEqual([]);
      // Late is only a label: a grade under it is a draft like any other.
      level('s3', 'essay', 3);
      expect(drafts('essay')).toEqual(['s3']);
      // Missing set over a draft's grade leaves no draft to show.
      level('s4', 'essay', 2);
      const statuses = getAssignmentStatuses(CID);
      statuses['s4:essay'] = 'NS';
      saveAssignmentStatuses(CID, statuses);
      expect(GradeState.stateOf(CID, 's4', 'essay')).toBe(null);
      expect(drafts('essay')).toEqual(['s3']);
    });

    it('over every student and assessment the lengths add up to draftsWaiting', () => {
      const total = () => [ESSAY, QUIZ, TALK, BENCH].reduce((n, a) => n + drafts(a.id).length, 0);
      expect(total()).toBe(0);
      expect(GradeState.draftsWaiting(CID)).toBe(0);
      level('s1', 'essay', 3);
      level('s2', 'essay', 2);
      setPointsScore(CID, 's3', 'quiz', 7);
      level('s1', 'talk', 4); // the pair: two drafts
      applyAssignmentStatus(CID, 's4', 'quiz', 'LATE');
      expect(total()).toBe(5);
      expect(GradeState.draftsWaiting(CID)).toBe(5);
      // A grade under Missing shows no Draft mark and is in neither count.
      const statuses = getAssignmentStatuses(CID);
      statuses['s2:essay'] = 'NS';
      saveAssignmentStatuses(CID, statuses);
      expect(total()).toBe(4);
      expect(GradeState.draftsWaiting(CID)).toBe(4);
      Grader.returnGrades(CID, 'talk', drafts('talk'));
      expect(total()).toBe(2);
      expect(GradeState.draftsWaiting(CID)).toBe(2);
      // A DIBELS benchmark has no Draft or Returned state, whatever is saved
      // on it (stateOf), so neither count has it.
      saveScoreComment(CID, 's1', 'bench', 'Read with expression.');
      expect(GradeState.stateOf(CID, 's1', 'bench')).toBe(null);
      expect(drafts('bench')).toEqual([]);
      expect(total()).toBe(2);
      expect(GradeState.draftsWaiting(CID)).toBe(2);
    });

    it('work that is not in the class has none', () => {
      expect(drafts('no-such-work')).toEqual([]);
    });

    it('a class that returns each save at once has none', () => {
      seed({ student_page_enabled: true, return_grades: 'on_save' });
      level('s1', 'essay', 3);
      expect(drafts('essay')).toEqual([]);
      seed({});
      level('s1', 'essay', 3);
      expect(drafts('essay')).toEqual([]);
    });
  });
});

describe('grade-state-drafts-waiting', () => {
  /**
   * GradeState.draftsWaiting(cid): how many grades in a class wait as drafts
   * (S1-F4). It counts what a screen shows as Draft (GradeState.stateOf), so
   * the number Class Settings names when a class leaves When I Return Them is
   * the number of Draft marks the teacher can find.
   */

  const CID = 'c-waiting';
  const ESSAY = { id: 'essay', title: 'Essay', date: '2026-10-10', type: 'summative', tagIds: ['t1'] };
  const QUIZ = { id: 'quiz', title: 'Quiz', date: '2026-10-12', scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] };
  const STUDENTS = ['s1', 's2', 's3'].map((id, i) => ({
    id,
    firstName: ['Jordan', 'Avery', 'Noor'][i],
    lastName: 'Test',
  }));

  function seed(config) {
    localStorage.clear();
    clearClass(CID);
    seedClass(CID, {
      students: STUDENTS,
      assessments: [ESSAY, QUIZ].map(a => structuredClone(a)),
      courseConfigs: config,
    });
  }
  const level = (sid, value) => Grader.setLevel(CID, sid, 'essay', 't1', value, 0);

  describe('GradeState.draftsWaiting', () => {
    var originalUseSupabase;
    beforeEach(() => {
      originalUseSupabase = _useSupabase;
      _useSupabase = false;
      seed({ student_page_enabled: true, return_grades: 'on_return' });
      return () => {
        _useSupabase = originalUseSupabase;
        clearClass(CID);
      };
    });

    it('is 0 in a class with no rows, and in a class nobody has heard of', () => {
      expect(GradeState.draftsWaiting(CID)).toBe(0);
      expect(GradeState.draftsWaiting('no-such-class')).toBe(0);
      expect(GradeState.draftsWaiting(undefined)).toBe(0);
    });

    it('counts each grade that waits, across assessments, and drops one once it is returned', () => {
      level('s1', 3);
      level('s2', 2);
      Grader.setPoints(CID, 's1', 'quiz', 7);
      expect(GradeState.draftsWaiting(CID)).toBe(3);

      Grader.returnGrades(CID, 'essay', ['s1']);
      expect(GradeState.draftsWaiting(CID)).toBe(2);

      // A change to the returned grade waits again.
      level('s1', 4);
      expect(GradeState.draftsWaiting(CID)).toBe(3);
    });

    it('agrees with stateOf cell by cell', () => {
      level('s1', 3);
      level('s3', 1);
      Grader.setPoints(CID, 's2', 'quiz', 4);
      Grader.returnGrades(CID, 'essay', ['s3']);
      var marks = 0;
      ['essay', 'quiz'].forEach(aid =>
        STUDENTS.forEach(s => {
          if (GradeState.stateOf(CID, s.id, aid) === GradeState.DRAFT) marks++;
        }),
      );
      expect(marks).toBe(2);
      expect(GradeState.draftsWaiting(CID)).toBe(marks);
    });

    it('leaves out a draft under Missing or Excused: the screen shows the status, not Draft', () => {
      level('s1', 3);
      level('s2', 3);
      level('s3', 3);
      // A screen refuses Missing or Excused on scored work, but a class can
      // hold one (a status that arrived from another device): the whole list,
      // as a load saves it.
      saveAssignmentStatuses(CID, { 's1:essay': 'NS', 's2:essay': 'EXC' });
      expect(GradeState.stateOf(CID, 's1', 'essay')).toBeNull();
      expect(GradeState.stateOf(CID, 's2', 'essay')).toBeNull();
      expect(getGradeReturn(CID, 's1', 'essay').is_draft).toBe(true);
      expect(GradeState.draftsWaiting(CID)).toBe(1);
      // Late is only a label.
      saveAssignmentStatuses(CID, { 's1:essay': 'NS', 's2:essay': 'EXC', 's3:essay': 'LATE' });
      expect(GradeState.draftsWaiting(CID)).toBe(1);
    });

    it('leaves out a row whose student or assessment is no longer in the class', () => {
      level('s1', 3);
      level('s2', 3);
      Grader.setPoints(CID, 's1', 'quiz', 7);
      expect(GradeState.draftsWaiting(CID)).toBe(3);
      // The rows stay; the class no longer lists the student or the piece.
      _cache.students[CID] = STUDENTS.filter(s => s.id !== 's2');
      expect(GradeState.draftsWaiting(CID)).toBe(2);
      _cache.assessments[CID] = [structuredClone(ESSAY)];
      expect(GradeState.draftsWaiting(CID)).toBe(1);
      expect(getGradeReturn(CID, 's2', 'essay').is_draft).toBe(true);
    });

    it('is 0 where nothing is held: As Soon As I Save, or the switch off', () => {
      seed({ student_page_enabled: true, return_grades: 'on_save' });
      level('s1', 3);
      expect(GradeState.draftsWaiting(CID)).toBe(0);
      seed({});
      level('s1', 3);
      expect(GradeState.draftsWaiting(CID)).toBe(0);
    });
  });
});
