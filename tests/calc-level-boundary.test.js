/**
 * A level reads as it is printed (shared/calc.js: printedLevel, roundLevel,
 * _onPaper, _wholePercent; DECISIONS, "A level reads as it is printed",
 * 2026-11-11; grade math, for Colin's review).
 *
 * The figure is the level on paper to one decimal, a half rounding up, and
 * the word, code, colour, + or − and counts by level all come from that
 * figure: 2.47 prints 2.5 and reads Proficient, 2.44 prints 2.4 and reads
 * Developing. "On paper" matters too: a + or − is a third, which a computer
 * can't hold exactly, so an average that is exactly 2.5 (or 2.45, or 1.65)
 * can come out a hair under. A printed whole % and a letter keep their own
 * rule: the % on paper, rounded as shown.
 */
import './setup.js';
import { afterAll, describe, expect, it } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'boundary-class';
const ME = 'boundary-priya';

const lv = (value, modifier) => ({ value, modifier: modifier || 0, comment: null });
const levels = tags => ({
  score: { value: null, modifier: 0, comment: null, status: null },
  tag_scores: Object.entries(tags).map(([tag_id, r]) => Object.assign({ tag_id }, r)),
  rubric_scores: [],
});
const piece = (id, date) => ({ id, title: id, date, dueDate: date, type: 'summative', weight: 1, tagIds: ['t-ev'] });

/* One skill, Evidence, scored once per piece in date order. `marks` are
   [level, modifier]. */
function seedSkill(marks, opts) {
  opts = opts || {};
  localStorage.clear();
  clearClass(CID);
  const assessments = marks.map((m, i) => piece('p' + i, '2026-10-' + String(10 + i).padStart(2, '0')));
  const cells = { [ME]: {} };
  marks.forEach((m, i) => (cells[ME]['p' + i] = levels({ 't-ev': lv(m[0], m[1]) })));
  const rows = {};
  assessments.forEach(a => (rows[a.id] = { [ME]: { is_draft: false, returned_at: '2026-11-01T18:00:00Z' } }));
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
    courseConfigs: Object.assign({ student_page_enabled: true, return_grades: 'on_return' }, opts.config),
    gradeReturns: rows,
  });
  COURSES[CID] = {
    id: CID,
    name: 'Course',
    block: 'A',
    gradingSystem: opts.system || 'proficiency',
    gradeLevel: opts.system && opts.system !== 'proficiency' ? '11' : '8',
  };
  delete _returnedSets[CID];
  clearProfCache();
}

/* A plain class to read single values against, in a grading style. */
function seedStyle(system, config) {
  seedSkill([[3, 0]], { system, config });
}

afterAll(() => clearClass(CID));

const E = [1, 0];
const Xm = [4, -1];
const Dm = [2, -1];

describe('the reported case: Emerging, Extending −, Extending −, Developing −', () => {
  it('averages 2.5 on paper and the computer gets 2.4999999999999996', () => {
    // The noise is real: this is the sum the average makes, in date order.
    const sum = 1 + (4 - 1 / 3) + (4 - 1 / 3) + (2 - 1 / 3);
    expect(sum / 4).toBe(2.4999999999999996);
  });

  [
    ['in that order', [E, Xm, Xm, Dm]],
    ['in the other order', [Dm, Xm, Xm, E]],
    ['Extending − first', [Xm, E, Dm, Xm]],
  ].forEach(([name, marks]) => {
    it('reads Proficient, as the figure 2.5 says, ' + name, () => {
      seedSkill(marks);
      const v = getSectionProficiency(CID, ME, 'ev');
      expect(v).toBeCloseTo(2.5, 12);
      expect(formatLevel(CID, v)).toBe('2.5');
      expect(levelWord(CID, v)).toBe('Proficient');
      expect(levelText(CID, v)).toBe('Proficient');
      expect(levelCode(v)).toBe('PRF');
      expect(nearestScoreLevel(v)).toEqual({ level: 3, text: '3−' });
      expect(nextStepLevel(CID, ME, 'ev')).toEqual({ level: 3, key: 'Proficient', top: false });
      const o = getOverallProficiency(CID, ME);
      expect(studentGradeBadges(CID, ME).prof).toEqual({ text: '2.5', level: 3 });
      expect(studentRosterBadges(CID, ME).prof).toMatchObject({ text: 'PRF', title: 'Proficient' });
      expect(classGradeSummary(CID, [ME])).toEqual({ text: '2.5', level: 3 });
      expect(classGradeDistribution(CID, [ME]).find(b => b.level === 3).ids).toEqual([ME]);
      expect(competencyDistribution(CID, [ME], { sectionId: 'ev' }).bands[2].ids).toEqual([ME]);
      expect(levelWord(CID, o)).toBe('Proficient');
    });
  });

  it('the month line no longer claims a move that did not happen', () => {
    // September: Emerging, Extending −, Extending − (2.78, Proficient).
    // Nov 1: Developing −. Now exactly 2.5, still Proficient.
    localStorage.clear();
    clearClass(CID);
    const dates = ['2026-09-08', '2026-09-15', '2026-09-22', '2026-11-01'];
    const marks = [E, Xm, Xm, Dm];
    const assessments = dates.map((d, i) => piece('p' + i, d));
    const cells = { [ME]: {} };
    marks.forEach((m, i) => (cells[ME]['p' + i] = levels({ 't-ev': lv(m[0], m[1]) })));
    const rows = {};
    assessments.forEach(a => (rows[a.id] = { [ME]: { is_draft: false, returned_at: '2026-11-02T18:00:00Z' } }));
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
      courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
      gradeReturns: rows,
    });
    COURSES[CID] = { id: CID, name: 'Course', block: 'A', gradingSystem: 'proficiency', gradeLevel: '8' };
    delete _returnedSets[CID];
    clearProfCache();
    const m = skillMonthChange(CID, ME, 'ev', '2026-11-10');
    expect(m.from).toBe('Proficient');
    expect(m.dir).toBe(0);
    expect(gradeMonthChange(CID, ME, '2026-11-10').dir).toBe(0);
  });
});

/* ── Every boundary, reached from both sides ─────────────────────────── */

// The value a step counts as, worked out as the app works it out.
const stepValue = t => {
  const level = Math.round(t / 3);
  return scoreModValue({ score: level, mod: t - level * 3 });
};
const STEPS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // 1, 1+, 2−, … 4, in thirds

/* An order of entered levels whose mean is num / den levels on paper but
   whose float mean, summed in that order, comes out under (`side` -1) or
   over (+1) the float nearest that value. Searched, so the noise is a real
   one a class can make. */
function noisyOrder(num, den, side) {
  const exact = num / den;
  for (let n = 2; n <= 6; n++) {
    if ((3 * num * n) % den) continue;
    const want = (3 * num * n) / den; // the sum, in thirds
    const found = [];
    const walk = (list, sum) => {
      const left = n - list.length;
      if (found.length || sum + 3 * left > want || sum + 12 * left < want) return;
      if (list.length === n) {
        if (sum !== want) return;
        const mean = calcProficiency(
          list.map((t, i) => ({ score: stepValue(t), date: '2026-10-' + (10 + i), assessmentId: 'a' + i })),
          'average',
        );
        if (side < 0 ? mean < exact : mean > exact) found.push({ list, mean });
        return;
      }
      STEPS.forEach(t => walk(list.concat(t), sum + t));
    };
    walk([], 0);
    if (found.length) return found[0];
  }
  return null;
}

/* A float a hair off `exact`: from a real noisy sum when one exists within
   six pieces, else the next float. */
function hair(num, den, side) {
  const order = noisyOrder(num, den, side);
  if (order) return order.mean;
  const exact = num / den;
  return side < 0 ? exact - exact * Number.EPSILON : exact + exact * Number.EPSILON;
}

describe('words, codes and colours follow the printed figure: around 1.5, 2.5 and 3.5', () => {
  [
    [1.5, 'Emerging', 'Developing'],
    [2.5, 'Developing', 'Proficient'],
    [3.5, 'Proficient', 'Extending'],
  ].forEach(([b, below, above]) => {
    it(b + ': from ' + (b - 0.05).toFixed(2) + ' it prints ' + b.toFixed(1) + ' and reads ' + above, () => {
      seedStyle('proficiency');
      const lo = Math.floor(b);
      // [level, printed, whole level]
      const table = [
        [b - 0.06, (b - 0.1).toFixed(1), lo], // 2.44
        [b - 0.0501, (b - 0.1).toFixed(1), lo], // 2.4499
        [b - 0.05, b.toFixed(1), lo + 1], // 2.45
        [hair(Math.round((b - 0.05) * 60), 60, -1), b.toFixed(1), lo + 1], // 2.45, a hair under
        [b - 0.03, b.toFixed(1), lo + 1], // 2.47
        [hair(b * 6, 6, -1), b.toFixed(1), lo + 1], // 2.5, a hair under
        [b, b.toFixed(1), lo + 1],
        [b + 0.05, (b + 0.1).toFixed(1), lo + 1], // 2.55
      ];
      table.forEach(([v, printed, whole]) => {
        expect(formatLevel(CID, v)).toBe(printed);
        expect(levelFigure(v)).toBe(printed);
        expect(printedLevel(v)).toBe(Number(printed));
        expect(roundLevel(v)).toBe(whole);
        expect(levelWord(CID, v)).toBe(whole > lo ? above : below);
        expect(levelCode(v)).toBe(PROF_CODES[whole]);
      });
    });
  });

  it('an exact x.x5 prints the same however the computer came to it (1.65 is 1.7)', () => {
    seedStyle('proficiency');
    [
      [33, 20, '1.7'],
      [47, 20, '2.4'],
      [53, 20, '2.7'],
      [73, 20, '3.7'],
    ].forEach(([num, den, printed]) => {
      [hair(num, den, -1), num / den, hair(num, den, 1)].forEach(v => {
        expect(formatLevel(CID, v)).toBe(printed);
        expect(levelFigure(v)).toBe(printed);
      });
    });
    // toFixed alone gives "1.6" for the 1.65 the computer holds.
    expect((1.65).toFixed(1)).toBe('1.6');
  });
});

describe('+ and − follow the printed figure: the nearest step to it, a tie going up', () => {
  // Every printed figure from 1.0 to 4.0, k tenths: its nearest step is
  // 3k/10 thirds, a half rounding up.
  for (let k = 10; k <= 40; k++) {
    const step = Math.floor((3 * k + 5) / 10);
    const level = Math.max(1, Math.min(4, Math.round(step / 3)));
    const text = formatScoreLevel(level, step - level * 3);
    it((k / 10).toFixed(1) + ' is ' + text, () => {
      [k / 10 - 0.05, k / 10, k / 10 + 0.0499].forEach(v => {
        if (!(v > 0)) return;
        expect(nearestScoreLevel(v)).toEqual({ level, text });
      });
    });
  }

  it('each cut, from both sides', () => {
    // [just under the cut, at the cut]: 1.14 prints 1.1 (1), 1.15 prints 1.2 (1+).
    [
      [1.14, '1', 1.15, '1+'],
      [1.44, '1+', 1.45, '2\u2212'],
      [1.84, '2\u2212', 1.85, '2'],
      [2.14, '2', 2.15, '2+'],
      [2.44, '2+', 2.45, '3\u2212'],
      [2.84, '3\u2212', 2.85, '3'],
      [3.14, '3', 3.15, '3+'],
      [3.44, '3+', 3.45, '4\u2212'],
      [3.84, '4\u2212', 3.85, '4'],
    ].forEach(([under, a, at, b]) => {
      expect(nearestScoreLevel(under).text).toBe(a);
      expect(nearestScoreLevel(at).text).toBe(b);
    });
  });
});

describe('letters and printed percents', () => {
  it('a level on a BC Letter Bands step gets that step’s letter (3+ is an A)', () => {
    seedStyle('letter', {
      gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: BC_LETTER_BAND_PERCENTS },
    });
    [
      [10, 'A', 'B'], // 3+ is 86
      [8, 'B', 'C+'], // 3− is 73
      [7, 'C+', 'C'], // 2+ is 67
      [4, 'C-', 'IE'], // 1+ is 50
    ].forEach(([t, letter, under]) => {
      [hair(t, 3, -1), t / 3, hair(t, 3, 1)].forEach(v => {
        expect(calcLetterGrade(v, CID).letter).toBe(letter);
        expect(formatLevel(CID, v)).toBe(
          BC_LETTER_BAND_PERCENTS[formatScoreLevel(Math.round(t / 3), t - Math.round(t / 3) * 3).replace('−', '-')] +
            '%',
        );
      });
      expect(calcLetterGrade(t / 3 - 0.01, CID).letter).toBe(under);
    });
  });

  it('every letter band reads its letter from a hair under its start, and not from honestly under', () => {
    BC_LETTER_BANDS.slice(0, -1).forEach(band => {
      const m = band.min;
      [m - m * Number.EPSILON, m, m + m * Number.EPSILON].forEach(p => {
        expect(percentageToLetter(p)).toBe(band.label);
        expect(_percentLevel(p)).toBe(band.level);
      });
      expect(percentageToLetter(m - 0.01)).not.toBe(band.label);
    });
  });

  it('a printed whole percent rounds a half up, as on paper', () => {
    seedStyle('letter');
    // Level ÷ 4: an exact 2.5 is 62.5%, printed 63%.
    const v = hair(15, 6, -1);
    expect((v / 4) * 100).toBeLessThan(62.5);
    expect(formatLevel(CID, v)).toBe('63%');
    expect(formatLevelAs(CID, v, 'percent')).toBe('63%');
    expect(formatLevel(CID, 2.49)).toBe('62%');
    // 11.5 out of 20 is 57.5%.
    expect((11.5 / 20) * 100).toBeLessThan(57.5);
    expect(formatPointsPercent(11.5, 20)).toBe('58%');
    expect(formatPointsPercent(11.4, 20)).toBe('57%');
  });

  it('a points score exactly on a Points to Proficiency start gets that level (29 / 50 is 58%)', () => {
    const scale = {
      boundaries: [
        { min: 85, proficiency: 4 },
        { min: 70, proficiency: 3 },
        { min: 58, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
    };
    expect((29 / 50) * 100).toBeLessThan(58);
    expect(pointsToProf(29, 50, scale)).toBe(2);
    expect(pointsToProf(14.5, 25, scale)).toBe(2);
    expect(pointsToProf(28.9, 50, scale)).toBe(1);
    // The default table's starts (86, 73, 50) are already exact.
    expect(pointsToProf(43, 50)).toBe(4);
    expect(pointsToProf(36.5, 50)).toBe(3);
    expect(pointsToProf(25, 50)).toBe(2);
  });
});

/* ── Every other reading of a level or %, each with the noisy 2.5 ────── */

const NOISY = 1 + (4 - 1 / 3) + (4 - 1 / 3) + (2 - 1 / 3); // 9.999999999999998
const HALF = NOISY / 4; // 2.4999999999999996, exactly 2.5 on paper

/* One piece that scores four competencies: Emerging, Extending −,
   Extending −, Developing −. The gradebook cell is their mean. */
function seedFourOnOne(system) {
  localStorage.clear();
  clearClass(CID);
  const ids = ['a', 'b', 'c', 'd'];
  const marks = [E, Xm, Xm, Dm];
  const assessments = [
    {
      id: 'p0',
      title: 'p0',
      date: '2026-10-10',
      dueDate: '2026-10-10',
      type: 'summative',
      weight: 1,
      tagIds: ids.map(i => 't-' + i),
    },
  ];
  const tags = {};
  ids.forEach((id, i) => (tags['t-' + id] = lv(marks[i][0], marks[i][1])));
  seedClass(CID, {
    students: [{ id: ME, firstName: 'Priya', lastName: 'Shah' }],
    assessments,
    scores: _gradebookCellsToScoreCache(CID, assessments, { [ME]: { p0: levels(tags) } }).scores,
    learningMaps: {
      subjects: [{ id: 'subj', name: 'Course' }],
      competencyGroups: [],
      sections: ids.map(id => ({ id, name: id, subject: 'subj', tags: [{ id: 't-' + id, label: id }] })),
    },
    categories: [],
    courseConfigs: {},
  });
  COURSES[CID] = {
    id: CID,
    name: 'Course',
    block: 'A',
    gradingSystem: system,
    gradeLevel: system === 'proficiency' ? '8' : '11',
  };
  clearProfCache();
  return assessments[0];
}

describe('every other reading of a level or a % on a boundary', () => {
  it('the noisy value is really under 2.5', () => {
    expect(HALF).toBeLessThan(2.5);
  });

  it('a gradebook cell: its level (colour) and its %', () => {
    const a = seedFourOnOne('both');
    const cell = assessmentCellValue(CID, ME, a);
    expect(cell.value).toBeLessThan(2.5);
    expect(cell.level).toBe(3);
    expect(cell.percentText).toBe('63%');
    expect(cell.text).toBe('2.5 · 63%');
  });

  it('a column’s score spread and its counts by level', () => {
    const a = seedFourOnOne('proficiency');
    const counts = classColumnLevelCounts(CID, [{ id: ME }], { assessment: a });
    expect(counts.counts[3]).toBe(1);
    expect(counts.counts[2]).toBe(0);
  });

  it('a group grade’s level (an assessment group, a category)', () => {
    seedSkill([E, Xm, Xm, Dm]);
    const g = assessmentGroupGrade(CID, ME, _cache.assessments[CID]);
    expect(g.prof).toBeLessThan(2.5);
    expect(g.level).toBe(3);
  });

  it('a results grid row’s counts by level', () => {
    const row = _gridRow([{ id: ME }], () => HALF);
    expect(row.counts[3]).toBe(1);
    expect(row.ids[3]).toEqual([ME]);
  });

  it('first and latest evidence (evidenceChange)', () => {
    const c = evidenceChange([
      { score: HALF, date: '2026-10-01' },
      { score: 1, date: '2026-10-02' },
    ]);
    expect(c.first).toBe(3);
  });

  it('the growth sparkline’s colour and title', () => {
    const html = renderGrowthSparkline([{ prof: HALF, date: '2026-10-01' }]);
    expect(html).toContain(PROF_COLORS[3]);
    expect(html).toContain(': Proficient"');
  });

  it('a Letter class’s change texts read each % on paper', () => {
    seedStyle('letter');
    // 62.5% (an exact 2.5) is 63%; 2.0 is 50%.
    expect(levelChangeAs(CID, 2, HALF)).toBe('+13%');
    expect(levelChangeAs(CID, HALF, 2)).toBe('−13%');
    expect(levelMoveText(CID, 2, HALF).text).toBe('↑ 13');
    expect(levelMoveText(CID, HALF, 2).text).toBe('↓ 13');
  });

  it('a Class Average’s %: points and Complete/Incomplete', () => {
    seedStyle('proficiency');
    const pct = (11.5 / 20) * 100; // 57.5 on paper
    expect(pct).toBeLessThan(57.5);
    const points = { id: 'q', scoreMode: 'points', maxPoints: 20 };
    expect(classColumnAverageText(CID, points, { avg: 11.5, pct, count: 1 })).toBe('11.5/20 · 58%');
    const done = { id: 'q', scoreMode: 'complete', maxPoints: 1 };
    expect(isCompletionScored(done)).toBe(true);
    expect(classColumnAverageText(CID, done, { avg: 0.575, pct, count: 1 })).toBe('58%');
  });

  it('a Letter class’s month line compares the % each side prints', () => {
    // September: Proficient, Developing (exactly 2.5, 62.5%, "63%").
    // October: Emerging, Extending −, Extending −, Developing −. Still
    // exactly 2.5, though the computer gets 2.4999999999999996.
    localStorage.clear();
    clearClass(CID);
    const dates = ['2026-09-08', '2026-09-15', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
    const marks = [[3, 0], [2, 0], E, Xm, Xm, Dm];
    const assessments = dates.map((d, i) => piece('p' + i, d));
    const cells = { [ME]: {} };
    marks.forEach((m, i) => (cells[ME]['p' + i] = levels({ 't-ev': lv(m[0], m[1]) })));
    const rows = {};
    assessments.forEach(a => (rows[a.id] = { [ME]: { is_draft: false, returned_at: '2026-11-02T18:00:00Z' } }));
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
      courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
      gradeReturns: rows,
    });
    COURSES[CID] = { id: CID, name: 'Course', block: 'A', gradingSystem: 'letter', gradeLevel: '11' };
    delete _returnedSets[CID];
    clearProfCache();
    const m = skillMonthChange(CID, ME, 'ev', '2026-11-10');
    expect(m.then).toBe(2.5);
    expect(m.now).toBeLessThan(2.5);
    expect(m.from).toBe('63%');
    expect(m.dir).toBe(0);
  });
});

/* ── Every one-decimal figure is printed on paper ────────────────────── */

/* Sections, each with its own pieces in date order; `subject` defaults to
   one course. [{ id, subject, marks: [[level, modifier]] }]. */
function seedSections(spec, system) {
  localStorage.clear();
  clearClass(CID);
  const assessments = [];
  const cells = { [ME]: {} };
  let day = 0;
  spec.forEach(sec =>
    sec.marks.forEach(m => {
      const id = 'p' + assessments.length;
      day++;
      const date = new Date(Date.UTC(2026, 8, 1) + day * 86400000).toISOString().slice(0, 10);
      assessments.push({ id, title: id, date, dueDate: date, type: 'summative', weight: 1, tagIds: ['t-' + sec.id] });
      cells[ME][id] = levels({ ['t-' + sec.id]: lv(m[0], m[1]) });
    }),
  );
  const subjects = Array.from(new Set(spec.map(x => x.subject || 'subj'))).map(id => ({ id, name: id }));
  seedClass(CID, {
    students: [{ id: ME, firstName: 'Priya', lastName: 'Shah' }],
    assessments,
    scores: _gradebookCellsToScoreCache(CID, assessments, cells).scores,
    learningMaps: {
      subjects,
      competencyGroups: [],
      sections: spec.map(x => ({
        id: x.id,
        name: x.id,
        subject: x.subject || 'subj',
        tags: [{ id: 't-' + x.id, label: x.id }],
      })),
    },
    categories: [],
    courseConfigs: {},
  });
  COURSES[CID] = { id: CID, name: 'Course', block: 'A', gradingSystem: system || 'proficiency', gradeLevel: '8' };
  clearProfCache();
}

// 17 Emerging and 3 Developing: 23 ÷ 20 = 1.15 on paper, which the
// computer holds a hair under (toFixed gives "1.1", ×10 gives 11.4999…).
const ONE_FIFTEEN = Array.from({ length: 20 }, (_, i) => (i < 17 ? [1, 0] : [2, 0]));
// 1.15 a hair under, as a sum can make it: ×10 gives 11.499999999999996.
const LOW = 1.15 - 1.15 * Number.EPSILON;

describe('every one-decimal figure is the level on paper, a half rounding up', () => {
  it('the noise is real', () => {
    expect((1.15).toFixed(1)).toBe('1.1');
    expect(Math.round(LOW * 10)).toBe(11);
  });

  it('a skill, the overall, the badge and the class summary print 1.2', () => {
    seedSections([{ id: 'ev', marks: ONE_FIFTEEN }]);
    const v = getSectionProficiency(CID, ME, 'ev');
    expect(v).toBeCloseTo(1.15, 12);
    expect(formatLevel(CID, v)).toBe('1.2');
    expect(formatLevelAs(CID, v, 'level')).toBe('1.2');
    expect(nearestScoreLevel(v).text).toBe('1+');
    expect(studentGradeBadges(CID, ME).prof.text).toBe('1.2');
    expect(studentGradeSummary(CID, ME).text).toBe('1.2');
    expect(classGradeSummary(CID, [ME]).text).toBe('1.2');
    expect(assessmentGroupGrade(CID, ME, _cache.assessments[CID]).text).toBe('1.2');
  });

  it('a Both class’s figure beside its %', () => {
    seedSections([{ id: 'ev', marks: ONE_FIFTEEN }], 'both');
    const v = getSectionProficiency(CID, ME, 'ev');
    expect(formatLevel(CID, v)).toBe('1.2 · 29%');
  });

  it('a level set by hand keeps the calculated level on paper', () => {
    seedSections([{ id: 'ev', marks: ONE_FIFTEEN }]);
    setSectionOverride(CID, ME, 'ev', 3, 'Conference');
    expect(getSectionOverride(CID, ME, 'ev').calculated).toBe(1.2);
  });

  it('the letter’s % from a level, to one decimal', () => {
    seedStyle('letter');
    // 1.15 ÷ 4 = 28.75%: 28.8.
    expect(calcLetterGrade(1.15, CID).pct).toBe(28.8);
  });

  it('change texts: levelChange, levelMoveText, groupGradeGap, groupGradeDiff', () => {
    seedStyle('proficiency');
    expect(levelChange(1, LOW)).toBe('+0.2');
    expect(levelChangeAs(CID, 1, LOW)).toBe('+0.2');
    expect(levelMoveText(CID, 1, LOW).text).toBe('↑ 0.2');
    expect(groupGradeGap(CID, { prof: LOW }, { prof: 1 }).text).toBe('0.2 above class');
    expect(groupGradeDiff(CID, { prof: LOW }, { prof: 1 }).text).toBe('+0.2');
  });

  it('points averages and spreads', () => {
    seedStyle('proficiency');
    const a = { id: 'q', scoreMode: 'points', maxPoints: 20 };
    expect(classColumnAverageText(CID, a, { avg: LOW, pct: 5.75, count: 1 })).toBe('1.2/20 · 6%');
    expect(classSpreadText(CID, a, LOW, true)).toBe('1.2/20');
    expect(classSpreadRangeText(CID, a, { low: LOW, high: LOW, points: true })).toBe('1.2–1.2/20');
  });

  it('the previews of a setting change print the figure on paper', () => {
    seedSections([{ id: 'ev', marks: ONE_FIFTEEN }]);
    expect(previewCalcMethodChange(CID, 'mostRecent').example).toEqual({
      name: 'Priya Shah',
      before: '1.2',
      after: '2.0',
    });
    seedSections([
      { id: 'ev', marks: ONE_FIFTEEN },
      { id: 'x', marks: [[4, 0]] },
    ]);
    expect(
      previewLearningMapChange(CID, map => {
        map.sections = map.sections.filter(s => s.id !== 'x');
      }).example.after,
    ).toBe('1.2');
    // (1.15 + 4 + 4) ÷ 3 = 3.05 on paper: 3.1. Each course equally: 2.575, 2.6.
    seedSections([
      { id: 'ev', marks: ONE_FIFTEEN },
      { id: 'x', subject: 'two', marks: [[4, 0]] },
      { id: 'y', subject: 'two', marks: [[4, 0]] },
    ]);
    expect(previewCoursesEqualChange(CID, true).example).toEqual({ name: 'Priya Shah', before: '3.1', after: '2.6' });
  });
});

describe('the figures read from a level set aside: stubbed to a noisy 1.15', () => {
  // Each reads a level from a calc.js function; the stub hands it 1.15 a
  // hair under, which the old ×10 rounding printed as 1.1.
  function withStub(name, fn, run) {
    const real = globalThis[name];
    globalThis[name] = fn;
    try {
      return run();
    } finally {
      globalThis[name] = real;
    }
  }

  it('a level set by hand stores its calculated level on paper', () => {
    seedSections([{ id: 'ev', marks: ONE_FIFTEEN }]);
    withStub(
      'getSectionProficiencyRaw',
      () => LOW,
      () => setSectionOverride(CID, ME, 'ev', 3, 'Conference'),
    );
    expect(getSectionOverride(CID, ME, 'ev').calculated).toBe(1.2);
  });

  it('the class’s change since the last report', () => {
    seedStyle('proficiency');
    let call = 0;
    const r = withStub(
      'previousReportTerm',
      () => ({ ordinal: 1, label: 'Report 1' }),
      () =>
        withStub(
          '_classGradeMeans',
          () => ({ prof: call++ === 0 ? LOW : 1, pct: null }),
          () => classGradeChange(CID, [ME]),
        ),
    );
    expect(r.text).toBe('\u25B2 0.2');
  });

  it('a setting’s preview of the overall', () => {
    seedSections([{ id: 'ev', marks: ONE_FIFTEEN }]);
    let call = 0;
    const r = withStub(
      'getOverallProficiency',
      () => (call++ === 0 ? LOW : 2),
      () => previewCoursesEqualChange(CID, true),
    );
    expect(r.example).toEqual({ name: 'Priya Shah', before: '1.2', after: '2.0' });
  });
});

describe('what stays as it was', () => {
  it('the level itself is never changed, only what it is compared as', () => {
    seedSkill([E, Xm, Xm, Dm]);
    expect(getSectionProficiency(CID, ME, 'ev')).toBe(2.4999999999999996);
    expect(getOverallProficiency(CID, ME)).toBe(2.4999999999999996);
  });

  it('a level just under 2.5 that prints 2.5 reads Proficient, as printed (Colin, 2026-11-11)', () => {
    // Five pieces, 37 thirds: (3 + 3 + 2 + 2 + 2⅓) ÷ 5 = 2.47 on paper. It
    // prints 2.5, so it reads Proficient, with the code, colour and + or −
    // of 2.5. The level itself stays 2.47.
    seedSkill([
      [3, 0],
      [3, 0],
      [2, 0],
      [2, 0],
      [2, 1],
    ]);
    const v = getSectionProficiency(CID, ME, 'ev');
    expect(v).toBeCloseTo(37 / 15, 12);
    expect(formatLevel(CID, v)).toBe('2.5');
    expect(levelWord(CID, v)).toBe('Proficient');
    expect(levelCode(v)).toBe('PRF');
    expect(nearestScoreLevel(v)).toEqual({ level: 3, text: '3\u2212' });
    expect(nextStepLevel(CID, ME, 'ev')).toEqual({ level: 3, key: 'Proficient', top: false });
    expect(studentGradeBadges(CID, ME).prof).toEqual({ text: '2.5', level: 3 });
  });

  it('a level that prints 2.4 reads Developing', () => {
    // (3 + 3 + 2 + 2 + 2) ÷ 5 = 2.4.
    seedSkill([
      [3, 0],
      [3, 0],
      [2, 0],
      [2, 0],
      [2, 0],
    ]);
    const v = getSectionProficiency(CID, ME, 'ev');
    expect(formatLevel(CID, v)).toBe('2.4');
    expect(levelWord(CID, v)).toBe('Developing');
    expect(nearestScoreLevel(v).text).toBe('2+');
  });
});

/* ── The property: every reading agrees with the printed figure ─────── */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// What a printed figure ("2.5") says: its whole level and its nearest step,
// a half rounding up, worked out from the text in whole tenths.
function fromFigure(text) {
  const k = Math.round(Number(text) * 10);
  const whole = Math.floor((k + 5) / 10);
  const step = Math.floor((3 * k + 5) / 10);
  const level = Math.max(1, Math.min(4, Math.round(step / 3)));
  return { whole, near: { level, text: formatScoreLevel(level, step - level * 3) } };
}

function checkAgrees(v) {
  const fig = formatLevel(CID, v);
  const said = fromFigure(fig);
  expect(levelFigure(v)).toBe(fig);
  expect(roundLevel(v)).toBe(said.whole);
  expect(levelWord(CID, v)).toBe(PROF_LABELS[said.whole]);
  expect(levelCode(v)).toBe(PROF_CODES[said.whole]);
  expect(nearestScoreLevel(v)).toEqual(said.near);
  expect(renderGrowthSparkline([{ prof: v, date: '2026-10-01' }])).toContain(PROF_COLORS[said.whole]);
  expect(_gridRow([{ id: ME }], () => v).counts[Math.max(1, Math.min(4, said.whole))]).toBe(1);
}

describe('the property: the printed figure and every reading of it agree', () => {
  it('20,000 random histories of one to eight pieces, against the exact value in thirds', () => {
    seedStyle('proficiency');
    const r = rng(20261111);
    let nearLine = 0;
    for (let k = 0; k < 20000; k++) {
      const n = 1 + Math.floor(r() * 8);
      const pool = k % 2 ? STEPS : [3, 5, 7, 8, 10, 11];
      const list = Array.from({ length: n }, () => pool[Math.floor(r() * pool.length)]);
      const T = list.reduce((a, b) => a + b, 0); // the sum in thirds, exact
      const v = calcProficiency(
        list.map((t, i) => ({ score: stepValue(t), date: '2026-10-' + (10 + i), assessmentId: 'a' + i })),
        'average',
      );
      // The exact level is T / 3n; printed, it is P tenths, a half rounding
      // up: P = floor((20T + 3n) / 6n).
      const P = Math.floor((20 * T + 3 * n) / (6 * n));
      expect(formatLevel(CID, v)).toBe((P / 10).toFixed(1));
      checkAgrees(v);
      if (P % 10 === 5 && 10 * T < 3 * n * P) nearLine++; // under x.5, printed x.5
    }
    expect(nearLine).toBeGreaterThan(200);
  });

  it('20,000 random levels from 1 to 4, any number of decimals', () => {
    seedStyle('proficiency');
    const r = rng(1111);
    for (let k = 0; k < 20000; k++) checkAgrees(1 + r() * 3);
  });
});
