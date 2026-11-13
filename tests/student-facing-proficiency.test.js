/**
 * Students and families read proficiencies, not scores out of 4 (DECISIONS,
 * "Student-facing levels are proficiencies", 2026-11-12). Colin: "students
 * receive proficiencies. all student-facing scores need to be a
 * proficiency", and "they only see the proficiency, because teachers may
 * override it."
 *
 * 1. The guard. Every file that draws something a student or family reads
 *    (STUDENT_FACING) may build a level as a figure ("3.2", "3.2 / 4") only
 *    where a Letter class still prints one, and those places are counted
 *    here with why. A new `levelFigure(`, `' / 4'`, `out of 4`,
 *    `formatLevel(`, `formatLevelAs(`, `studentGradeSummary(`,
 *    `levelChange(`, `levelChangeAs(` or `levelBarPercent(` in one of these
 *    files fails, and says to use calc.js's student helpers
 *    (studentLevelText, studentMarkText, studentGradeText,
 *    studentGroupGradeText, studentLevelChange, studentLevelBarPercent)
 *    instead. Teacher files are not checked: they keep their figures. The
 *    caps only go down.
 * 2. The output. Demo Mode's Science 8 is drawn as a Proficiency, a Both and
 *    a Letter class, every student-facing surface (every Progress Reports
 *    block, the Assessments list with its Feedback Pages and rubric sheets, the
 *    phone copy, the student page): no figure for a level in a Proficiency
 *    or Both class, the proficiency words there, and a Letter class's output
 *    and every points or Complete/Incomplete score exactly what main gave
 *    before this change (tests/fixtures/student-facing-unchanged.json,
 *    written by this file in a checkout of the commit before it:
 *    UPDATE_STUDENT_FACING=1 npx vitest run tests/student-facing-proficiency.test.js).
 * 3. Overrides. A student whose competency the teacher set by hand reads the
 *    teacher's level on the Assessments list, a Progress Report, the student
 *    page and the phone copy, and nothing there shows the calculated figure.
 */
import './setup.js';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { surfaces } from './helpers/report-surfaces.js';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FILE = resolve(HERE, 'fixtures/student-facing-unchanged.json');
const UPDATE = process.env.UPDATE_STUDENT_FACING === '1';
const fingerprint = s => createHash('sha256').update(s).digest('hex').slice(0, 20) + ' ' + s.length;

/* A level as a figure: "3.2", "3.2 / 4", "out of 4". Not a % ("82.5%"),
   not part of a longer number, a date or a time. */
const FIGURE = /\/ ?4\b|out of 4|(?<![\d.:])[0-4]\.\d(?![\d%])/;
const WORD = /Emerging|Developing|Proficient|Extending/;

/* ── 1. The guard ───────────────────────────────────────────────── */

const STUDENT_FACING = [
  'teacher/report-blocks.js',
  'teacher/grade-report.js',
  'teacher/report-feedback.js',
  'teacher/report-feedback-cards.js',
  'teacher/rubric-print.js',
  'teacher/phone-reports.js',
  'shared/phone-report-view.js',
  'shared/student-view.js',
].concat(
  readdirSync(join(ROOT, 's'))
    .filter(f => f.endsWith('.js'))
    .map(f => 's/' + f),
);

const FIGURE_CALLS = [
  "' / 4'",
  'out of 4',
  'levelFigure(',
  'formatLevel(',
  'formatLevelAs(',
  'studentGradeSummary(',
  'levelChange(',
  'levelChangeAs(',
  'levelBarPercent(',
];

/* 'file needle' → how many there are today, and why each is not a level a
   student in a Proficiency or Both class reads as a figure. */
const ALLOWED = {
  "teacher/report-blocks.js ' / 4'": [2, 'Assignment Grades in a Letter class (_rowMarks), as before'],
  'teacher/report-blocks.js levelFigure(': [2, 'the same two Letter-class marks'],
  'teacher/report-blocks.js out of 4': [1, 'the Assignment Grades legend in a Letter class'],
  'teacher/report-blocks.js formatLevel(': [
    5,
    'a Letter class only (_levelHtml, the override note, the Proficiency block, the legend), or the % of a Both class (_levelHtml)',
  ],
  'teacher/report-blocks.js formatLevelAs(': [4, "always 'percent': a piece's % in a Letter or Both class"],
  'teacher/grade-report.js levelFigure(': [1, 'the Assessments list in a Letter class'],
  'shared/student-view.js formatLevel(': [2, 'My Learning in a Letter class: the %'],
  'shared/student-view.js studentGradeSummary(': [1, 'the level and whether there is any grade, not its text'],
};

/* Comments blanked, so a comment can name what it must not call. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

function figureCalls(files) {
  const out = {};
  files.forEach(({ rel, src }) => {
    FIGURE_CALLS.forEach(needle => {
      const n = code(src).split(needle).length - 1;
      if (n) out[rel + ' ' + needle] = n;
    });
  });
  return out;
}

describe('the guard: student-facing files build no level as a figure', () => {
  const files = STUDENT_FACING.map(rel => ({ rel, src: readFileSync(join(ROOT, rel), 'utf-8') }));

  it('has no more figure calls than the Letter-class ones listed', () => {
    const found = figureCalls(files);
    const over = Object.keys(found)
      .filter(key => found[key] > (ALLOWED[key] ? ALLOWED[key][0] : 0))
      .map(
        key =>
          key +
          ': ' +
          found[key] +
          ' (a student reads a proficiency: use studentLevelText, studentMarkText, studentGradeText, studentGroupGradeText, studentLevelChange or studentLevelBarPercent from shared/calc.js)',
      );
    expect(over).toEqual([]);
  });

  it('lists only what is still there (the caps only go down)', () => {
    const found = figureCalls(files);
    const stale = Object.keys(ALLOWED).filter(key => (found[key] || 0) < ALLOWED[key][0]);
    expect(stale).toEqual([]);
  });

  it('catches a figure built the old way', () => {
    const slips = [
      { rel: 'x.js', src: "return levelFigure(v) + ' / 4';" },
      { rel: 'x.js', src: "var t = 'BC Proficiency Scale, out of 4';" },
      { rel: 'x.js', src: 'row.score = formatLevel(cid, cv.value);' },
      { rel: 'x.js', src: 'var g = studentGradeSummary(cid, sid).text;' },
    ];
    expect(Object.keys(figureCalls(slips))).toHaveLength(5);
    const fine = [
      { rel: 'x.js', src: '/* never levelFigure(v) here */ var t = studentLevelText(cid, v); // not formatLevel(' },
    ];
    expect(figureCalls(fine)).toEqual({});
  });
});

/* ── 2. The output, in Demo Mode's class ─────────────────────────── */

/* What a page shows of some HTML: its text, and what is read out
   (aria-label, title, alt). */
function shownOf(html) {
  const said = [];
  String(html).replace(/(?:aria-label|title|alt)="([^"]*)"/g, (m, v) => said.push(v));
  return (
    String(html)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&') +
    ' ' +
    said.join(' ')
  );
}

/* Every string in a value (the JSON a surface gives), as shown. Numbers are
   data, not text: they are left out. */
function stringsOf(value, out) {
  out = out || [];
  if (typeof value === 'string') out.push(shownOf(value));
  else if (Array.isArray(value)) value.forEach(v => stringsOf(v, out));
  else if (value && typeof value === 'object') Object.keys(value).forEach(k => stringsOf(value[k], out));
  return out;
}

const DRAWN = ['st1', 'st2', 'st3', 'st4', 'st5', 'st6'];

/* The student-facing surfaces of the class as it is graded now. */
function draw(cid) {
  clearProfCache();
  const out = surfaces(cid, ['progress', 'quick', 'phones'], { students: DRAWN });
  DRAWN.forEach(sid => {
    const v = StudentView.fromCache(cid, sid, { learning: true });
    out['student page › ' + sid] = JSON.stringify(v.view || null);
  });
  return out;
}

/* Every points and Complete/Incomplete score a student or family reads in
   a Proficiency class: the Assessments list's rows and score cards, the
   Assignment Grades rows, the student page's results, the printed score
   sheet. Each as it is shown. */
function pointsWork(cid, drawn) {
  const points = getAssessments(cid).filter(a => isPointsScored(a));
  const titles = points.map(a => a.title);
  const out = {};
  Object.keys(drawn).forEach(key => {
    const v = drawn[key];
    if (/ › quick › /.test(key)) {
      const q = JSON.parse(v);
      out[key + ' › rows'] = JSON.stringify(
        q.rows.filter(r => titles.indexOf(r.title) >= 0).map(r => [r.title, r.score, r.outOf, r.percent, r.note]),
      );
      out[key + ' › cards'] = JSON.stringify(q.cards.filter(c => /fb-score|fb-complete/.test(c)));
    } else if (/ › progress › grade-table/.test(key)) {
      const rows = v.match(/<div class="report-grades-row">[\s\S]*?<\/div>/g) || [];
      out[key] = JSON.stringify(rows.filter(r => titles.some(t => r.indexOf('>' + t + '<') >= 0)));
    } else if (/^student page/.test(key)) {
      const view = JSON.parse(v);
      out[key] = JSON.stringify(
        ((view && view.work) || [])
          .filter(p => p.result && (p.result.kind === 'points' || p.result.kind === 'complete'))
          .map(p => [p.title, p.result]),
      );
    }
  });
  DRAWN.forEach(sid => {
    out['score sheets › ' + sid] = JSON.stringify(
      ReportScores.withReportScores('handout', () =>
        points.map(a => {
          const d = RubricPrint.sheetData(cid, a.id, sid);
          return d && d.overall;
        }),
      ),
    );
  });
  return out;
}

describe('every student-facing surface of the Demo class', { timeout: 120000 }, () => {
  const drawn = {};
  let unchanged;
  let wasDemo;
  let cid;

  beforeAll(async () => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    setStudentPageSwitch(cid, true);
    for (const system of ['proficiency', 'both', 'letter']) {
      // report-blocks.js keeps the last report's levels until the task ends; a class changes style between tasks.
      await new Promise(r => setTimeout(r, 0));
      COURSES[cid].gradingSystem = system;
      drawn[system] = draw(cid);
    }
    COURSES[cid].gradingSystem = 'proficiency';
    const points = pointsWork(cid, drawn.proficiency);
    const now = {};
    Object.keys(drawn.letter).forEach(k => (now['letter › ' + k] = fingerprint(drawn.letter[k])));
    Object.keys(points).forEach(k => (now['points › ' + k] = fingerprint(points[k])));
    if (UPDATE) writeFileSync(FILE, JSON.stringify({ frozenAt: FROZEN_AT, parts: now }, null, 2) + '\n');
    unchanged = { now, was: JSON.parse(readFileSync(FILE, 'utf-8')).parts };
  }, 120000);

  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it.each(['proficiency', 'both'])('a %s class shows no level as a figure, anywhere', system => {
    const hits = [];
    Object.keys(drawn[system]).forEach(key => {
      const v = drawn[system][key];
      const texts = /^[[{]/.test(v) ? stringsOf(JSON.parse(v)) : [shownOf(v)];
      texts.forEach(t => {
        const m = t.match(FIGURE);
        if (m) hits.push(key + ': …' + t.slice(Math.max(0, m.index - 40), m.index + 12).replace(/\s+/g, ' '));
      });
    });
    expect(hits.slice(0, 10)).toEqual([]);
  });

  it.each(['proficiency', 'both'])('a %s class names the proficiency on every surface', system => {
    const d = drawn[system];
    ['quick', 'phones', 'progress › proficiency (row)', 'progress › grade-table (row)'].forEach(part => {
      const key = Object.keys(d).find(k => k.indexOf('year › ' + part) === 0);
      expect(d[key], part).toMatch(WORD);
    });
    expect(d['student page › st1']).toMatch(WORD);
    // The Assessments list: a level's Score is its proficiency, Out Of empty.
    const q = JSON.parse(d['year › quick › st1']);
    const levels = q.rows.filter(r => WORD.test(r.score));
    expect(levels.length).toBeGreaterThan(5);
    levels.forEach(r => expect(r.outOf).toBe(''));
    expect(q.categories.every(c => WORD.test(c.grade))).toBe(true);
  });

  it('a Both class keeps its %: the proficiency and the percent', () => {
    const q = JSON.parse(drawn.both['year › quick › st1']);
    expect(q.rows.find(r => WORD.test(r.score)).percent).toMatch(/^\d+%$/);
    expect(q.categories[0].grade).toMatch(/^(Emerging|Developing|Proficient|Extending) · [A-F][+-]? [\d.]+%$/);
  });

  it('a Letter class gives exactly what it gave before', () => {
    const letter = Object.keys(unchanged.was).filter(k => k.indexOf('letter › ') === 0);
    expect(letter.length).toBeGreaterThan(100);
    expect(letter.filter(k => unchanged.now[k] !== unchanged.was[k])).toEqual([]);
  });

  it('a points or Complete/Incomplete score in a Proficiency class is shown exactly as before', () => {
    const points = Object.keys(unchanged.was).filter(k => k.indexOf('points › ') === 0);
    expect(points.length).toBeGreaterThan(50);
    expect(points.filter(k => unchanged.now[k] !== unchanged.was[k])).toEqual([]);
    // And there are such scores: a 7/10 still reads 7 out of 10, with nothing out of 4 beside it.
    const q = JSON.parse(drawn.proficiency['year › quick › st1']);
    const scored = q.rows.filter(r => /^\d+(\.\d+)?$/.test(r.score) && r.outOf !== '');
    expect(scored.length).toBeGreaterThan(3);
    scored.forEach(r => expect(r.outOf).not.toBe('4'));
    expect(q.rows.some(r => r.score === 'Complete')).toBe(true);
  });
});

/* ── 3. A level the teacher set by hand ──────────────────────────── */

describe('a competency the teacher set by hand', () => {
  const CID = 'sf-override';
  const ME = 'sf-priya';
  const piece = (id, date) => ({
    id,
    title: 'Piece ' + id,
    date,
    dueDate: date,
    type: 'summative',
    weight: 1,
    tagIds: ['t-ev'],
  });

  /* One student, one competency at 2 on three pieces (Developing), set by
     hand to Extending. */
  function seed(system) {
    localStorage.clear();
    clearClass(CID);
    const assessments = ['p0', 'p1', 'p2'].map((id, i) => piece(id, '2026-10-1' + i));
    const cells = { [ME]: {} };
    assessments.forEach(a => {
      cells[ME][a.id] = {
        score: { value: null, modifier: 0, comment: null, status: null },
        tag_scores: [{ tag_id: 't-ev', value: 2, modifier: 0, comment: null }],
        rubric_scores: [],
      };
    });
    seedClass(CID, {
      students: [{ id: ME, firstName: 'Priya', lastName: 'Shah' }],
      assessments,
      scores: _gradebookCellsToScoreCache(CID, assessments, cells).scores,
      learningMaps: {
        subjects: [{ id: 'subj', name: 'Course' }],
        competencyGroups: [],
        sections: [{ id: 'ev', name: 'Evidence', subject: 'subj', tags: [{ id: 't-ev', label: 'Evidence' }] }],
      },
      categories: [],
      courseConfigs: { student_page_enabled: true, show_my_learning: true },
    });
    COURSES[CID] = { id: CID, name: 'Course', block: 'A', gradingSystem: system, gradeLevel: '8' };
    saveOverrides(CID, { [ME]: { ev: { level: 4, reason: 'Seen in class', date: '2026-10-01', calculated: 2 } } });
    clearProfCache();
  }

  afterAll(() => {
    clearClass(CID);
    delete COURSES[CID];
    localStorage.clear();
  });

  it.each(['proficiency', 'both'])('reads the teacher’s level everywhere a student looks, in a %s class', system => {
    seed(system);
    const st = getStudents(CID)[0];
    const ctx = { termId: 'term-1', termLabel: 'Report 1' };
    expect(getSectionProficiencyRaw(CID, ME, 'ev')).toBe(2);
    expect(getSectionProficiency(CID, ME, 'ev')).toBe(4);
    // The Course Grade line, a Progress Report, the phone copy and the student page.
    // The Course Grade line and the Assignment Grades block print this (calc.js studentGradeText).
    const course = studentGradeText(CID, ME, 'term-1').text;
    expect(course).toMatch(/^Extending/);
    const prog = ['proficiency', 'section-outcomes', 'section-chart', 'progress', 'grade-table', 'competency-table']
      .map(id => shownOf(ReportBlocks.renderReportBlock(id, CID, st, ctx, { rows: 'each' })))
      .join(' ');
    const phone = PhoneReports.snapshot(CID, st, ctx);
    const view = StudentView.fromCache(CID, ME, { learning: true }).view;
    const skill = view.learning.groups[0].skills[0];
    expect(phone.skills[0].word).toBe('Extending');
    expect(phone.overall.word).toBe('Extending');
    expect(skill.text).toBe('Extending');
    expect(view.learning.overall.word).toBe('Extending');
    expect(prog).toMatch(/Evidence\s+Extending/);
    // Nothing shows the calculated level beside it: no figure, no "calculated", no Developing for Evidence.
    const all = [prog, JSON.stringify(phone), JSON.stringify(view.learning), course].join(' ');
    expect(all).not.toMatch(FIGURE);
    expect(all).not.toContain('calculated');
    expect(shownOf(ReportBlocks.renderReportBlock('section-outcomes', CID, st, ctx, {}))).not.toContain('Developing');
    expect(shownOf(ReportBlocks.renderReportBlock('section-chart', CID, st, ctx, {}))).not.toContain('Developing');
  });
});
