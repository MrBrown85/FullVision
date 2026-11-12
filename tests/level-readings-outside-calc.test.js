/**
 * Every screen and report outside calc.js reads a level as calc.js does
 * (DECISIONS, "A level reads as it is printed", 2026-11-11; grade display,
 * for Colin's review).
 *
 * A level reads as it is printed: 2.47 prints 2.5 and is Proficient, 2.44
 * prints 2.4 and is Developing. calc.js gives the word (levelWord), the whole
 * level its code and colour come from (roundLevel) and the + or −
 * (nearestScoreLevel). The pages below used to round the level themselves
 * (Math.round, a raw `>= 2.5`), so from x.45 to just under x.5 they said
 * Developing where the gradebook and the student page say Proficient. Each
 * is handed a level near a line, and must read it as calc.js does.
 *
 * The level is stubbed: every calc.js reader a surface asks (the overall,
 * a folder, a competency, a competency's tag) hands back the value under
 * test, so the surface's own reading is all that is checked.
 */
import './setup-mobile.js';
import { afterAll, describe, expect, it } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (typeof ClassResults === 'undefined')
  runInThisContext(readFileSync(resolve(ROOT, 'teacher/class-results.js'), 'utf-8'), { filename: 'class-results.js' });
const CID = 'readings-class';
const ME = 'readings-priya';

// Around each line (1.5, 2.5, 3.5) and each + or − cut, and the same a hair
// under, as an average of thirds comes out of a computer.
const LINES = [1.44, 1.45, 1.47, 1.5, 2.44, 2.45, 2.47, 2.5, 3.44, 3.45, 3.47, 3.5];
const CUTS = [1.14, 1.15, 1.84, 1.85, 2.14, 2.15, 2.84, 2.85, 3.14, 3.15, 3.84, 3.85];
const hair = v => v - Number.EPSILON * 4;
const VALUES = LINES.concat(CUTS)
  .concat(LINES.map(hair))
  .concat([37 / 15, 2.4999999999999996]);

const lv = (value, modifier) => ({ value, modifier: modifier || 0, comment: null });
const piece = (id, date) => ({
  id,
  title: 'Piece ' + id,
  date,
  dueDate: date,
  type: 'summative',
  weight: 1,
  tagIds: ['t-ev'],
});

/* One student, one competency (Evidence), three scored pieces. */
function seed(system) {
  localStorage.clear();
  clearClass(CID);
  const assessments = ['p0', 'p1', 'p2'].map((id, i) => piece(id, '2026-10-1' + i));
  const cells = { [ME]: {} };
  assessments.forEach(a => {
    cells[ME][a.id] = {
      score: { value: null, modifier: 0, comment: null, status: null },
      tag_scores: [Object.assign({ tag_id: 't-ev' }, lv(3, 0))],
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
    courseConfigs: {},
  });
  COURSES[CID] = { id: CID, name: 'Course', block: 'A', gradingSystem: system || 'proficiency', gradeLevel: '8' };
  clearProfCache();
}

const READERS = [
  'getOverallProficiency',
  'getGroupProficiency',
  'getSectionProficiency',
  'getSectionProficiencyRaw',
  'getTagProficiency',
];

/* Runs `fn` with every level reader handing back `v`. */
function atLevel(v, fn) {
  const real = {};
  READERS.forEach(name => {
    real[name] = globalThis[name];
    globalThis[name] = () => v;
  });
  try {
    return fn();
  } finally {
    READERS.forEach(name => (globalThis[name] = real[name]));
  }
}

/* What calc.js says the level reads as. */
function said(v) {
  const level = roundLevel(v);
  return { level, word: levelWord(CID, v), colour: PROF_COLORS[level], near: nearestScoreLevel(v) };
}

const student = () => getStudents(CID).find(s => s.id === ME);

afterAll(() => clearClass(CID));

describe('calc.js agrees with itself on the values under test', () => {
  it('2.47 reads Proficient and 2.44 Developing, so the table below means something', () => {
    seed();
    expect(said(2.47)).toMatchObject({ level: 3, word: 'Proficient' });
    expect(said(2.44)).toMatchObject({ level: 2, word: 'Developing' });
    expect(said(hair(2.45))).toMatchObject({ level: 3, word: 'Proficient' });
    expect(said(1.45)).toMatchObject({ level: 2, word: 'Developing' });
    expect(said(3.45)).toMatchObject({ level: 4, word: 'Extending' });
    // Math.round, what the pages used, disagrees on each of these.
    expect([2.47, 1.45, 3.45, hair(2.45)].map(Math.round)).toEqual([2, 1, 3, 2]);
  });

  it('the helpers pages outside calc.js call', () => {
    expect(wholePercent(57.49999999999999)).toBe(58);
    expect(wholePercent(57.4)).toBe(57);
    expect(wholePercent(62.5)).toBe(63);
    expect(oneDecimal(2.9499999999999997)).toBe(3);
    expect(oneDecimal(2.94)).toBe(2.9);
    expect(oneDecimal(85.95)).toBe(86);
    ['printedLevel', 'roundLevel', 'wholePercent', 'oneDecimal', 'nearestScoreLevelName'].forEach(name =>
      expect(typeof Calc[name]).toBe('function'),
    );
  });

  it('nearestScoreLevelName names the step nearestScoreLevel prints', () => {
    expect(nearestScoreLevelName(0)).toBe('');
    expect(nearestScoreLevelName(37 / 15)).toBe(scoreLevelText(3, -1));
    expect(nearestScoreLevelName(2.44)).toBe(scoreLevelText(2, 1));
    expect(nearestScoreLevelName(3.15)).toBe(scoreLevelText(3, 1));
    expect(nearestScoreLevelName(3.14)).toBe(scoreLevelText(3, 0));
    expect(nearestScoreLevelName(3.85)).toBe(scoreLevelText(4, 0));
    expect(nearestScoreLevelName(3.84)).toBe(scoreLevelText(4, -1));
    VALUES.forEach(v => {
      const n = nearestScoreLevel(v);
      const mod = /\+$/.test(n.text) ? 1 : /−$/.test(n.text) ? -1 : 0;
      expect(nearestScoreLevelName(v), String(v)).toBe(scoreLevelText(n.level, mod));
    });
  });
});

describe.each(VALUES)('a level of %s', v => {
  const ctx = { termId: 'term-1', termLabel: 'Report 1' };

  it('reads the same on every report block', () => {
    seed();
    const s = said(v);
    atLevel(v, () => {
      // The dots (●●●○ for Proficient).
      expect((ReportBlocks.levelDots(v).match(/●/g) || []).length).toBe(s.level);
      // Academic Summary: the overall word and each competency's chip.
      const summary = ReportBlocks.renderBlockAcademicSummary(CID, student(), ctx);
      expect(summary).toContain('<div class="report-overall-word">' + s.word + '</div>');
      expect(summary).toContain('data-prof="' + s.level + '" style="color:' + s.colour + '"');
      // Curricular Competencies.
      const table = ReportBlocks.renderBlockCompetencyTable(CID, student(), ctx, {});
      expect(table).toContain('<td class="report-ct-level" data-prof="' + s.level + '">');
      expect(table).toContain('</span>' + s.word);
      // Learning Outcomes: the competency's word and colour, the tag's bar.
      const outcomes = ReportBlocks.renderBlockSectionOutcomes(CID, student());
      expect(outcomes).toContain(
        'data-prof="' + s.level + '" style="font-size:0.68rem;font-weight:600;color:' + s.colour + '">' + s.word,
      );
      expect(outcomes).toContain('data-prof-bg="' + s.level + '"');
      // Section Proficiency Breakdown: a strength from Proficient up.
      const chart = ReportBlocks.renderBlockSectionChart(CID, student());
      const strengths = chart.split('Areas for Growth')[0];
      expect(strengths.indexOf('<span>Evidence</span>') >= 0, 'listed as a strength').toBe(s.level >= 3);
      // Proficiency: the word alone, no figure (DECISIONS, "Student-facing levels are proficiencies").
      const prof = ReportBlocks.renderBlockProficiency(CID, student(), ctx, { word: true });
      expect(prof).toContain('<td class="report-prof-n">' + s.word + '</td>');
      expect(prof).not.toContain(formatLevel(CID, v));
    });
  });

  it('Growth Since Last Report tints both columns by the word', () => {
    seed();
    const s = said(v);
    const real = [globalThis.previousReportTerm, globalThis.getActiveTerm];
    globalThis.previousReportTerm = () => ({ ordinal: 1, label: 'Report 1' });
    globalThis.getActiveTerm = () => ({ ordinal: 2, label: 'Report 2' });
    try {
      const html = atLevel(v, () => ReportBlocks.renderBlockGrowth(CID, student(), { termId: 'term-2' }, {}));
      expect(html).toContain('<td class="report-ct-level col-before" data-prof="' + s.level + '">');
      expect(html).toContain('<td class="report-ct-level" data-prof="' + s.level + '">');
    } finally {
      [globalThis.previousReportTerm, globalThis.getActiveTerm] = real;
    }
  });

  it('Class Results colours a class average by its word', () => {
    seed();
    const s = said(v);
    const a = getAssessments(CID)[0];
    const real = globalThis.classColumnAverage;
    globalThis.classColumnAverage = () => ({ avg: v, count: 1 });
    try {
      const html = ClassResults.cardHtml(CID, getStudents(CID), a);
      expect(html).toContain('<span class="gb-tip-grade" style="color:' + s.colour + '">');
      expect(html).toContain('<small>' + s.word + '</small>');
    } finally {
      globalThis.classColumnAverage = real;
    }
  });

  it('Generate says the word the gradebook shows', () => {
    seed();
    const s = said(v);
    const f = atLevel(v, () => CommentBank.facts(CID, student(), 'term-1'));
    expect(f.standing).toBe(s.word);
  });

  it('a phone report gives each skill the level of its word', () => {
    seed();
    const s = said(v);
    const snap = atLevel(v, () => PhoneReports.snapshot(CID, student(), ctx));
    expect(snap.skills[0]).toMatchObject({ word: s.word, level: s.level });
  });

  it('the dashboard counts a student below a rule as the word says', () => {
    seed();
    const s = said(v);
    const below = atLevel(v, () => DashInsights.isBelowRule(CID, { sectionIds: [] }, ME, v, { below: 3, min: 0 }));
    expect(below).toBe(s.level < 3);
  });

  it('the phone app colours and names it as the gradebook does', () => {
    seed();
    const s = said(v);
    expect(MComponents.profBg(v)).toBe(s.colour);
    const data = { widgetConfig: { order: ['hero'], disabled: [] } };
    const hero = atLevel(v, () => MCardWidgets.render('hero', student(), CID, data));
    expect(hero).toContain('<div class="m-scard-prof-label">' + s.word + '</div>');
    const detail = atLevel(v, () => MStudentDetail.renderDetail({ cid: CID, sid: ME, renderBadges: () => '' }));
    expect(detail).toContain('<div class="m-hero-prof-label">' + s.word + '</div>');
  });
});

describe('the phone’s Focus Areas: competencies below Proficient, by the figure shown', () => {
  // 2.94 prints 2.9 and is listed; 2.95, even a hair under, prints 3.0 and is not.
  it.each([
    [2.4, true],
    [2.94, true],
    [hair(2.95), false],
    [2.95, false],
    [2.97, false],
    [3, false],
  ])('%s listed: %s', (v, listed) => {
    seed();
    const real = globalThis.getFocusAreas;
    globalThis.getFocusAreas = () => [{ prof: v, tag: { label: 'Evidence' }, section: { color: '#336699' } }];
    try {
      const detail = MStudentDetail.renderDetail({ cid: CID, sid: ME, renderBadges: () => '' });
      expect(detail.indexOf('Focus Areas') >= 0).toBe(listed);
    } finally {
      globalThis.getFocusAreas = real;
    }
  });
});

describe('Download All My Data names a rubric level as its figure says', () => {
  it('the word and the figure are the same step', () => {
    if (typeof ExportAll === 'undefined')
      runInThisContext(readFileSync(resolve(ROOT, 'teacher/export-all.js'), 'utf-8'), {
        filename: 'teacher/export-all.js',
      });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    const real = globalThis.rubricCriterionLevel;
    try {
      const cid = loadDemoClass();
      VALUES.forEach(v => {
        globalThis.rubricCriterionLevel = () => v;
        const sheets = ExportAll.rows({ cids: [cid], teacher: 'A Teacher', date: '2026-11-09' });
        const rubric = sheets.find(s => s.name === 'Rubric Levels');
        const head = rubric.columns.map(c => c.header);
        expect(rubric.rows.length).toBeGreaterThan(0);
        const row = rubric.rows[0];
        const n = nearestScoreLevel(v);
        expect(row[head.indexOf('Level')], String(v)).toBe(nearestScoreLevelName(v));
        expect(String(row[head.indexOf('Level')]).indexOf(PROF_LABELS[n.level]), String(v)).toBe(0);
        expect(row[head.indexOf('Figure')], String(v)).toBe(n.text);
      });
    } finally {
      globalThis.rubricCriterionLevel = real;
      vi.useRealTimers();
      clearProfCache();
    }
  });
});

describe('a % prints as calc.js prints it', () => {
  it('beside a points score on the phone: 23 / 40 is 57.5%, which prints 58%', () => {
    // 23 / 40 × 100 is 57.49999999999999 in a computer.
    expect((23 / 40) * 100).toBeLessThan(57.5);
    expect(pointsPctHtml(23, 40, 0)).toBe('58%');
    expect(pointsPctHtml(23, 40, 0)).toBe(formatPointsPercent(23, 40));
    expect(pointsPctHtml(171.9, 200, 1)).toBe('86.0%');
    expect(pointsPctHtml(17.19, 20, 1)).toBe(oneDecimal(85.95).toFixed(1) + '%');
  });

  it('under a column on the printed grade sheet, as the gradebook’s Class Average', () => {
    seed();
    const a = Object.assign({}, getAssessments(CID)[0], { scoreMode: 'points', maxPoints: 40 });
    const col = { id: a.id, assessment: a, outOf: 40 };
    const real = globalThis.getClassPointsAverage;
    // 23 of 40 on average; the average points a hair under 2.95.
    globalThis.getClassPointsAverage = () => ({ pct: (23 / 40) * 100, avg: 2.9499999999999997, count: 1 });
    try {
      expect(GradesPrint.columnAverageText(CID, getStudents(CID), col, { scoresAs: 'percent' })).toBe('58%');
      expect(GradesPrint.columnAverageText(CID, getStudents(CID), col, { scoresAs: 'points' })).toBe('3');
    } finally {
      globalThis.getClassPointsAverage = real;
    }
  });
});
