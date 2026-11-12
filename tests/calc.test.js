/**
 * calc: the tests that were tests/calc-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearClass, seedClass } from './helpers/pin-save-paths.js';

describe('calc-describe-method', () => {
  /**
   * describeCalcMethod: the class's competency calculation method in plain
   * words, shown under the student page's competency tiles and in the printed
   * report. It reads the same setting getTagProficiency uses: the course
   * config first, then the course row, then "most recent".
   */

  const CID = 'course-describe';

  beforeEach(() => {
    _cache.courseConfigs[CID] = {};
    COURSES[CID] = { id: CID, name: 'Science 8' };
  });
  afterEach(() => {
    delete _cache.courseConfigs[CID];
    delete COURSES[CID];
  });

  describe('describeCalcMethod', () => {
    it('defaults to mean', () => {
      expect(describeCalcMethod(CID)).toBe('Average of all scores');
    });

    it('names each method', () => {
      const expected = {
        mostRecent: 'Most recent score',
        highest: 'Highest score',
        average: 'Average of all scores',
        median: 'Median score',
        mode: 'Most common score',
      };
      Object.keys(expected).forEach(method => {
        _cache.courseConfigs[CID] = { calcMethod: method };
        expect(describeCalcMethod(CID)).toBe(expected[method]);
      });
    });

    it('gives the decay weight as a percentage', () => {
      _cache.courseConfigs[CID] = { calcMethod: 'decayingAvg', decayWeight: 0.8 };
      expect(describeCalcMethod(CID)).toBe('Decaying average: newer work counts more (80%)');
    });

    it('uses the default 65% decay weight when none is set', () => {
      _cache.courseConfigs[CID] = { calcMethod: 'decayingAvg' };
      expect(describeCalcMethod(CID)).toBe('Decaying average: newer work counts more (65%)');
    });

    it('reads the course row when the config has no method', () => {
      COURSES[CID] = { id: CID, name: 'Science 8', calcMethod: 'median' };
      expect(describeCalcMethod(CID)).toBe('Median score');
    });

    it('prefers the course config over the course row', () => {
      COURSES[CID] = { id: CID, name: 'Science 8', calcMethod: 'median' };
      _cache.courseConfigs[CID] = { calcMethod: 'highest' };
      expect(describeCalcMethod(CID)).toBe('Highest score');
    });

    it('falls back to most recent for an unknown method', () => {
      _cache.courseConfigs[CID] = { calcMethod: 'weird' };
      expect(describeCalcMethod(CID)).toBe('Most recent score');
    });

    it('is exported on window.Calc', () => {
      expect(window.Calc.describeCalcMethod).toBe(describeCalcMethod);
    });
  });
});

describe('calc-level-boundary', () => {
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
});

describe('calc-month-ago', () => {
  /**
   * My Learning's "Up from Developing a month ago" and which Next Step applies
   * (shared/calc.js: monthAgoDate, skillMonthChange, gradeMonthChange,
   * nextStepLevel; docs/plans/student-page-build-plan.md S13; grade math, for
   * Colin's review).
   *
   * The rule: both grades come from returned work only, by the calculation
   * every grade uses. "A month ago" is the year to date as of the day 30 days
   * before today, read the way a report reads the year to date as of its
   * term's end: work dated on or before that day counts, later work does not.
   * "Today" is always an argument; no test reads the clock.
   */

  const CID = 'month-class';
  const ME = 'month-priya';
  const TOP = 'month-maya';
  const TODAY = '2026-11-10'; // a month ago is Oct 11

  const lv = (value, modifier) => ({ value, modifier: modifier || 0, comment: null });
  const levels = tags => ({
    score: { value: null, modifier: 0, comment: null, status: null },
    tag_scores: Object.entries(tags).map(([tag_id, r]) => Object.assign({ tag_id }, r)),
    rubric_scores: [],
  });
  const points = value => ({
    score: { value, modifier: 0, comment: null, status: null },
    tag_scores: [],
    rubric_scores: [],
  });
  const back = { is_draft: false, returned_at: '2026-11-01T18:00:00Z' };
  const draft = { is_draft: true };
  const piece = (id, title, date, extra) =>
    Object.assign({ id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: [] }, extra);

  /* A class in the cache. `cells` { sid: { aid: cell } }; every graded piece
   is returned unless `returns` says otherwise ({ aid: { sid: row } }). */
  function seed({ system, gradeLevel, sections, assessments, cells, returns, statuses, categories, config }) {
    localStorage.clear();
    clearClass(CID);
    const scores = _gradebookCellsToScoreCache(CID, assessments, cells).scores;
    const rows = {};
    Object.keys(cells).forEach(sid =>
      Object.keys(cells[sid]).forEach(aid => {
        rows[aid] = rows[aid] || {};
        rows[aid][sid] = (returns && returns[aid] && returns[aid][sid]) || back;
      }),
    );
    seedClass(CID, {
      students: [
        { id: ME, firstName: 'Priya', lastName: 'Shah' },
        { id: TOP, firstName: 'Maya', lastName: 'Chen' },
      ],
      assessments,
      scores,
      statuses: statuses || {},
      learningMaps: {
        subjects: [{ id: 'subj', name: 'Course' }],
        competencyGroups: [],
        sections: sections.map(([id, name]) => ({ id, name, subject: 'subj', tags: [{ id: 't-' + id, label: name }] })),
      },
      categories: categories || [],
      courseConfigs: Object.assign({ student_page_enabled: true, return_grades: 'on_return' }, config),
      gradeReturns: rows,
    });
    COURSES[CID] = { id: CID, name: 'Course', block: 'A', gradingSystem: system, gradeLevel: gradeLevel || '8' };
    delete _returnedSets[CID];
    clearProfCache();
  }

  const returnedLevel = sec => withReturnedOnly(() => getSectionProficiency(CID, ME, sec));

  /* ── Humanities 8, a Proficiency class (boards "My Learning (Proficiency
   Class)", "One Skill", "One Skill, Top Step") ─────────────────────────
   Evidence, One Skill's How It's Going: Sep 21 Developing, Oct 5 Proficient
   minus, Oct 19 Proficient, Nov 3 Proficient plus. Inquiry Proficient on
   Oct 19. Perspective Developing on Oct 30. Maya has Evidence at Extending. */
  const HUM_SECTIONS = [
    ['ev', 'Evidence'],
    ['inq', 'Inquiry'],
    ['per', 'Perspective'],
  ];
  const HUM_PIECES = [
    piece('e1', 'Feudalism in Medieval England', '2026-09-21', { tagIds: ['t-ev'] }),
    piece('e2', 'Magna Carta', '2026-10-05', { tagIds: ['t-ev'] }),
    piece('e3', 'The King: Evidence and Reputation', '2026-10-19', { tagIds: ['t-ev', 't-inq'] }),
    piece('e4', 'Assessing the Medieval Church', '2026-11-03', { tagIds: ['t-ev'] }),
    piece('p1', 'Points of View', '2026-10-30', { tagIds: ['t-per'] }),
  ];
  function humCells(extra) {
    return Object.assign(
      {
        [ME]: {
          e1: levels({ 't-ev': lv(2) }),
          e2: levels({ 't-ev': lv(3, -1) }),
          e3: levels({ 't-ev': lv(3), 't-inq': lv(3) }),
          e4: levels({ 't-ev': lv(3, 1) }),
          p1: levels({ 't-per': lv(2) }),
        },
        [TOP]: {
          e2: levels({ 't-ev': lv(3) }),
          e3: levels({ 't-ev': lv(4) }),
          e4: levels({ 't-ev': lv(4) }),
        },
      },
      extra,
    );
  }
  function humanities(opts) {
    opts = opts || {};
    seed({
      system: opts.system || 'proficiency',
      sections: HUM_SECTIONS,
      assessments: structuredClone(opts.assessments || HUM_PIECES),
      cells: opts.cells || humCells(),
      returns: opts.returns,
      statuses: opts.statuses,
      config: opts.config,
    });
  }

  afterAll(() => clearClass(CID));

  describe('monthAgoDate: the day a month ago is', () => {
    it('30 days before today, across a month and a year', () => {
      expect(monthAgoDate('2026-11-10')).toBe('2026-10-11');
      expect(monthAgoDate('2026-03-01')).toBe('2026-01-30');
      expect(monthAgoDate('2028-03-01')).toBe('2028-01-31'); // a leap year
      expect(monthAgoDate('2027-01-15')).toBe('2026-12-16');
    });
    it('null for anything that is not a real day, so nothing is compared', () => {
      ['', null, undefined, 'today', '2026-02-30', '2026-13-01', '2026-11-10T08:00:00Z', 20261110].forEach(bad => {
        expect(monthAgoDate(bad)).toBeNull();
      });
      humanities();
      expect(skillMonthChange(CID, ME, 'ev', '2026-02-30')).toBeNull();
      expect(gradeMonthChange(CID, ME, undefined)).toBeNull();
    });
  });

  describe('a Proficiency class: the boards’ worked example', () => {
    beforeEach(() => humanities());

    it('One Skill’s Evidence (Sep 21 Developing, Oct 5 Proficient −, Oct 19 Proficient, Nov 3 Proficient +) is up from Developing a month ago', () => {
      const c = skillMonthChange(CID, ME, 'ev', TODAY);
      // A month ago (Oct 11): Sep 21's 2 and Oct 5's 2.67 average 2.33, Developing.
      expect(c.then).toBeCloseTo((2 + 8 / 3) / 2, 10);
      // Now: all four average 2.75, Proficient.
      expect(c.now).toBeCloseTo((2 + 8 / 3 + 3 + 10 / 3) / 4, 10);
      expect(c).toMatchObject({ from: 'Developing', dir: 1, since: '2026-10-11' });
      // Now is the level My Learning shows for the skill.
      expect(c.now).toBe(returnedLevel('ev'));
    });

    it('My Learning: You’re at Proficient (Evidence 2.75, Inquiry 3, Perspective 2), up from Developing a month ago (Evidence 2.33 alone)', () => {
      const g = gradeMonthChange(CID, ME, TODAY);
      expect(g.now).toBeCloseTo((2.75 + 3 + 2) / 3, 10);
      expect(levelWord(CID, g.now)).toBe('Proficient');
      expect(g.then).toBeCloseTo((2 + 8 / 3) / 2, 10);
      expect(g).toMatchObject({ from: 'Developing', dir: 1 });
      expect(g.now).toBe(withReturnedOnly(() => getOverallProficiency(CID, ME)));
    });

    it('a skill first marked after a month ago has no comparison (Perspective, first on Oct 30)', () => {
      expect(skillMonthChange(CID, ME, 'per', TODAY)).toBeNull();
      expect(skillMonthChange(CID, ME, 'inq', TODAY)).toBeNull();
    });

    it('a month ago is the same level the class showed with only the work dated on or before that day', () => {
      const then = skillMonthChange(CID, ME, 'ev', TODAY).then;
      const overallThen = gradeMonthChange(CID, ME, TODAY).then;
      const early = HUM_PIECES.filter(p => p.date <= '2026-10-11');
      const cells = humCells();
      Object.keys(cells).forEach(sid =>
        Object.keys(cells[sid]).forEach(aid => {
          if (!early.some(p => p.id === aid)) delete cells[sid][aid];
        }),
      );
      humanities({ assessments: early, cells });
      expect(then).toBe(returnedLevel('ev'));
      expect(overallThen).toBe(withReturnedOnly(() => getOverallProficiency(CID, ME)));
    });

    it('nothing a teacher sees moves: every grade after the call is the grade before it', () => {
      const before = [getSectionProficiency(CID, ME, 'ev'), getOverallProficiency(CID, ME), returnedLevel('ev')];
      skillMonthChange(CID, ME, 'ev', TODAY);
      gradeMonthChange(CID, ME, TODAY);
      expect([getSectionProficiency(CID, ME, 'ev'), getOverallProficiency(CID, ME), returnedLevel('ev')]).toEqual(
        before,
      );
      expect(getActiveTerm(CID)).toBeNull();
    });

    it('two different todays give two different months (no cached number is shared)', () => {
      expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBeCloseTo(7 / 3, 10);
      // Oct 25: a month ago is Sep 25, when only Sep 21's Developing was in.
      const c = skillMonthChange(CID, ME, 'ev', '2026-10-25');
      expect(c.then).toBe(2);
      expect(c.now).toBe(returnedLevel('ev'));
    });
  });

  describe('Next Step: which level’s step applies', () => {
    beforeEach(() => humanities());

    it('My Learning’s Next Step: Perspective at Developing takes the Developing step', () => {
      expect(nextStepLevel(CID, ME, 'per')).toEqual({ level: 2, key: 'Developing', top: false });
    });
    it('One Skill’s Evidence at Proficient (2.75) takes the Proficient step', () => {
      expect(nextStepLevel(CID, ME, 'ev')).toEqual({ level: 3, key: 'Proficient', top: false });
    });
    it('One Skill, Top Step: Evidence at Extending (3, 4, 4: 3.67) has no step, You’ve Reached the Top Step', () => {
      expect(nextStepLevel(CID, TOP, 'ev')).toEqual({ level: 4, key: 'Extending', top: true });
    });
    it('a skill with nothing returned has no Next Step', () => {
      expect(nextStepLevel(CID, TOP, 'per')).toBeNull();
    });
    it('the level is the one the skill’s word shows (levelWord), from returned work only', () => {
      // Perspective at Developing returned; a draft at Extending is not seen.
      humanities({
        assessments: [...HUM_PIECES, piece('p2', 'Perspectives Essay', '2026-11-06', { tagIds: ['t-per'] })],
        cells: humCells({ [ME]: { ...humCells()[ME], p2: levels({ 't-per': lv(4) }) } }),
        returns: { p2: { [ME]: draft } },
      });
      expect(nextStepLevel(CID, ME, 'per').key).toBe('Developing');
      expect(getSectionProficiency(CID, ME, 'per')).toBe(3); // the teacher's view, the draft in
    });
    it('a hand-set section level is the level the step follows, as the skill shows it', () => {
      humanities();
      _cache.overrides[CID] = { [ME]: { per: { level: 4, reason: 'Conference', date: '2026-11-05', calculated: 2 } } };
      clearProfCache();
      expect(nextStepLevel(CID, ME, 'per')).toEqual({ level: 4, key: 'Extending', top: true });
    });
  });

  describe('a draft changes nothing', () => {
    it('a draft dated before a month ago, and one after, are in neither grade', () => {
      const plain = (humanities(), skillMonthChange(CID, ME, 'ev', TODAY));
      const withDrafts = [
        ...HUM_PIECES,
        piece('d0', 'Early Draft', '2026-09-01', { tagIds: ['t-ev'] }),
        piece('d1', 'Late Draft', '2026-11-08', { tagIds: ['t-ev'] }),
      ];
      const cells = humCells({
        [ME]: { ...humCells()[ME], d0: levels({ 't-ev': lv(4) }), d1: levels({ 't-ev': lv(1) }) },
      });
      humanities({ assessments: withDrafts, cells, returns: { d0: { [ME]: draft }, d1: { [ME]: draft } } });
      expect(skillMonthChange(CID, ME, 'ev', TODAY)).toEqual(plain);
      expect(gradeMonthChange(CID, ME, TODAY).then).toBeCloseTo(7 / 3, 10);
      // Returned, the early one moves a month ago (so the test above can fail).
      humanities({ assessments: withDrafts, cells, returns: { d1: { [ME]: draft } } });
      expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBeCloseTo((4 + 2 + 8 / 3) / 3, 10);
    });

    it('nothing returned a month ago: the only earlier work is a draft, so no comparison', () => {
      humanities({ returns: { e1: { [ME]: draft }, e2: { [ME]: draft } } });
      expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
      expect(gradeMonthChange(CID, ME, TODAY)).toBeNull();
    });

    it('nothing returned now either: no comparison and no Next Step', () => {
      const none = {};
      HUM_PIECES.forEach(p => (none[p.id] = { [ME]: draft }));
      humanities({ returns: none });
      expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
      expect(gradeMonthChange(CID, ME, TODAY)).toBeNull();
      expect(nextStepLevel(CID, ME, 'ev')).toBeNull();
    });
  });

  describe('Missing, Excused and Late (DECISIONS: Missing wins everywhere; never drafts)', () => {
    it('Missing on Oct 5’s piece counts no level, now and a month ago (Sep 21’s 2 alone then)', () => {
      humanities({ statuses: { [ME + ':e2']: 'NS' } });
      const c = skillMonthChange(CID, ME, 'ev', TODAY);
      expect(c.then).toBe(2);
      expect(c.now).toBeCloseTo((2 + 3 + 10 / 3) / 3, 10);
      expect(c).toMatchObject({ from: 'Developing', dir: 1 });
    });
    it('Missing on the only earlier piece: nothing a month ago, so no comparison', () => {
      humanities({ statuses: { [ME + ':e1']: 'NS', [ME + ':e2']: 'NS' } });
      expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
    });
    it('Excused is left out, as Missing is in a Proficiency class', () => {
      humanities({ statuses: { [ME + ':e2']: 'EXC' } });
      expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBe(2);
    });
    it('Late counts like any returned grade', () => {
      humanities({ statuses: { [ME + ':e2']: 'LATE' } });
      expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBeCloseTo(7 / 3, 10);
    });
  });

  describe('the 30-day edge', () => {
    const edge = date => {
      humanities({
        assessments: [
          piece('e1', 'Feudalism in Medieval England', '2026-09-21', { tagIds: ['t-ev'] }),
          piece('x', 'On the Edge', date, { tagIds: ['t-ev'] }),
        ],
        cells: { [ME]: { e1: levels({ 't-ev': lv(2) }), x: levels({ 't-ev': lv(4) }) } },
      });
      return skillMonthChange(CID, ME, 'ev', TODAY);
    };
    it('work dated exactly 30 days ago (Oct 11) counts a month ago', () => {
      expect(edge('2026-10-11').then).toBe(3);
    });
    it('work dated 29 days ago (Oct 12) does not', () => {
      const c = edge('2026-10-12');
      expect(c.then).toBe(2);
      expect(c).toMatchObject({ now: 3, from: 'Developing', dir: 1 });
    });
    it('undated work counts in both, as it does in a report', () => {
      expect(edge('').then).toBe(3);
    });
  });

  describe('the class’s calculation method', () => {
    it('Decaying Average (65%): 2.43 a month ago, Developing; 3.15 now, Proficient', () => {
      humanities({ config: { calcMethod: 'decayingAvg', decayWeight: 0.65 } });
      const c = skillMonthChange(CID, ME, 'ev', TODAY);
      const then = 2 * 0.35 + (8 / 3) * 0.65;
      const now = (then * 0.35 + 3 * 0.65) * 0.35 + (10 / 3) * 0.65;
      expect(c.then).toBeCloseTo(then, 10);
      expect(c.now).toBeCloseTo(now, 10);
      expect(c).toMatchObject({ from: 'Developing', dir: 1 });
    });
    it('Count Only the Most Recent 3: 2.33 a month ago (two pieces); 3.0 now (Oct 5, Oct 19, Nov 3)', () => {
      humanities({ config: { recentScoreLimit: 3 } });
      const c = skillMonthChange(CID, ME, 'ev', TODAY);
      expect(c.then).toBeCloseTo(7 / 3, 10);
      expect(c.now).toBeCloseTo((8 / 3 + 3 + 10 / 3) / 3, 10);
    });
    it('Most Recent Score: Proficient − then, Proficient + now: the same word, so dir 0', () => {
      humanities({ config: { calcMethod: 'mostRecent' } });
      const c = skillMonthChange(CID, ME, 'ev', TODAY);
      expect(c.then).toBeCloseTo(8 / 3, 10);
      expect(c.now).toBeCloseTo(10 / 3, 10);
      expect(c).toMatchObject({ from: 'Proficient', dir: 0 });
    });
    it('going down: Most Recent Score with a Developing piece on Nov 3', () => {
      humanities({
        config: { calcMethod: 'mostRecent' },
        cells: humCells({ [ME]: { ...humCells()[ME], e4: levels({ 't-ev': lv(2) }) } }),
      });
      expect(skillMonthChange(CID, ME, 'ev', TODAY)).toMatchObject({ from: 'Proficient', dir: -1 });
    });
  });

  describe('reading as of a day', () => {
    it('puts back what was in view, also when the read throws', () => {
      humanities();
      expect(_readAsOfDate(CID, '2026-10-11', () => getActiveTerm(CID).endsOn)).toBe('2026-10-11');
      expect(getActiveTerm(CID)).toBeNull();
      expect(() =>
        _readAsOfDate(CID, '2026-10-11', () => {
          throw new Error('stop');
        }),
      ).toThrow('stop');
      expect(getActiveTerm(CID)).toBeNull();
      expect(getSectionProficiency(CID, ME, 'ev')).toBeCloseTo(2.75, 10);
    });
  });

  describe('a report in view is left as it was', () => {
    it('the grades are the year so far, and the term in view is put back', () => {
      humanities({
        config: {
          reportingTerms: [
            { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-15' },
            { ordinal: 2, label: 'Term 2', starts_on: '2026-10-16', ends_on: '2027-01-29' },
          ],
        },
      });
      const yearSoFar = skillMonthChange(CID, ME, 'ev', TODAY);
      setActiveTerm(CID, 1);
      try {
        expect(skillMonthChange(CID, ME, 'ev', TODAY)).toEqual(yearSoFar);
        expect(nextStepLevel(CID, ME, 'ev').key).toBe('Proficient');
        expect(getActiveTerm(CID).ordinal).toBe(1);
        // Term 1's own Evidence (Sep 21, Oct 5): unchanged by the call.
        expect(getSectionProficiency(CID, ME, 'ev')).toBeCloseTo(7 / 3, 10);
      } finally {
        setActiveTerm(CID, null);
      }
    });
  });

  /* ── Socials 10, a Letter class (boards "My Learning (Letter Grade Class)"
   and "Falling Grade, 3 Missing") ─────────────────────────────────────── */
  const SOC_CATS = [
    { id: 'pq', name: 'Practice Questions', weight: 40, displayOrder: 0 },
    { id: 'ce', name: 'Current Events', weight: 20, displayOrder: 1 },
    { id: 'te', name: 'Tests', weight: 40, displayOrder: 2 },
  ];
  const pts = (id, title, date, max, cat) =>
    piece(id, title, date, { scoreMode: 'points', maxPoints: max, categoryId: cat, tagIds: ['t-ev'] });
  function socials(assessments, mine, statuses, system) {
    seed({
      system: system || 'letter',
      gradeLevel: '10',
      sections: [['ev', 'Evidence']],
      assessments,
      cells: { [ME]: mine },
      statuses,
      categories: structuredClone(SOC_CATS),
    });
  }

  describe('a Letter class', () => {
    it('B 78% (Practice 84%, Current Events 70%, Tests 76%), up from C+ (70%) a month ago', () => {
      socials(
        [
          pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq'),
          pts('c1', 'Current Events 1', '2026-10-05', 10, 'ce'),
          pts('t1', 'Unit 1 Test', '2026-10-08', 10, 'te'),
          pts('q2', 'Practice Questions 2', '2026-10-30', 15, 'pq'),
          pts('t2', 'Unit 2 Test: Trigonometry', '2026-11-04', 40, 'te'),
        ],
        { q1: points(7), c1: points(7), t1: points(7), q2: points(14), t2: points(31) },
      );
      const g = gradeMonthChange(CID, ME, TODAY);
      // A month ago: 7/10 in each category, 70%: C+.
      expect(g.then).toBe(70);
      // Now: 40% × 21/25 (84) + 20% × 7/10 (70) + 40% × 38/50 (76) = 78: B.
      expect(g.now).toBe(78);
      expect(g).toMatchObject({ from: 'C+', dir: 1 });
      expect(withReturnedOnly(() => getCourseLetterData(CID, ME)).S).toBe('B');
    });

    it('Falling Grade, 3 Missing: IE 49% (Practice 64%, Current Events 25%, Tests 46%), down from C (60%) a month ago', () => {
      socials(
        [
          pts('q1', 'Practice Questions 1', '2026-10-01', 20, 'pq'),
          pts('c1', 'Current Events 1', '2026-10-05', 10, 'ce'),
          pts('t1', 'Unit 1 Test', '2026-10-08', 100, 'te'),
          pts('c3', 'Current Events 3', '2026-10-12', 5, 'ce'),
          pts('c5', 'Current Events 5', '2026-10-26', 5, 'ce'),
          pts('q4', 'Practice Questions 4.2', '2026-10-30', 5, 'pq'),
        ],
        { q1: points(16), c1: points(5), t1: points(46) },
        { [ME + ':c3']: 'NS', [ME + ':c5']: 'NS', [ME + ':q4']: 'NS' },
      );
      const g = gradeMonthChange(CID, ME, TODAY);
      // A month ago (Oct 11): 40% × 80 + 20% × 50 + 40% × 46 = 60.4, shown 60%: C.
      expect(g.then).toBe(60);
      // Now each Missing piece counts 0: 40% × 16/25 + 20% × 5/20 + 40% × 46 = 49: IE.
      expect(g.now).toBe(49);
      expect(g).toMatchObject({ from: 'C', dir: -1 });
      expect(withReturnedOnly(() => getCourseLetterData(CID, ME)).S).toBe('IE');
    });

    it('Missing on work dated before a month ago counts 0 in both', () => {
      socials(
        [pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq'), pts('q0', 'Practice 0', '2026-09-20', 10, 'pq')],
        { q1: points(8) },
        { [ME + ':q0']: 'NS' },
      );
      const g = gradeMonthChange(CID, ME, TODAY);
      expect(g.then).toBe(40);
      expect(g.now).toBe(40);
      // 40% is IE while the course runs (no reporting dates here).
      expect(g).toMatchObject({ from: 'IE', dir: 0 });
    });

    it('the same letter is no change, though the % moved (B 74% to B 80%)', () => {
      socials(
        [
          pts('q1', 'Practice Questions 1', '2026-10-01', 50, 'pq'),
          pts('q2', 'Practice Questions 2', '2026-10-30', 50, 'pq'),
        ],
        { q1: points(37), q2: points(43) },
      );
      expect(gradeMonthChange(CID, ME, TODAY)).toMatchObject({ then: 74, now: 80, from: 'B', dir: 0 });
    });

    it('nothing returned a month ago in a Letter class: no comparison', () => {
      socials([pts('q2', 'Practice Questions 2', '2026-10-30', 10, 'pq')], { q2: points(9) });
      expect(gradeMonthChange(CID, ME, TODAY)).toBeNull();
      expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
    });

    it('a skill reads as its %, so 67% to 83% is up though both are Proficient’s level (Most Recent: 3− then, 3+ now)', () => {
      humanities({ system: 'letter', config: { calcMethod: 'mostRecent' } });
      const c = skillMonthChange(CID, ME, 'ev', TODAY);
      expect(c).toMatchObject({ from: '67%', dir: 1 });
    });

    it('a skill in a Letter class reads as its %', () => {
      socials(
        [
          pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq'),
          pts('q2', 'Practice Questions 2', '2026-10-30', 10, 'pq'),
        ],
        { q1: points(5), q2: points(10) },
      );
      const c = skillMonthChange(CID, ME, 'ev', TODAY);
      expect(c.from).toBe(formatLevel(CID, c.then));
      expect(c.from).toMatch(/%$/);
      expect(c.dir).toBe(1);
    });

    it('a Letter class’s Next Step still follows the skill’s level (Falling Grade’s Next Step: Perspective)', () => {
      socials([pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq')], { q1: points(6) });
      const v = withReturnedOnly(() => getSectionProficiency(CID, ME, 'ev'));
      expect(nextStepLevel(CID, ME, 'ev').level).toBe(Math.round(v));
    });
  });

  describe('a Letter and Skills class (board "Letter and Skills")', () => {
    /* Life Sciences 11: Data Patterns Proficient on Oct 1 and Extending on
     Nov 2; Scientific Argument Proficient − on Oct 6 and Developing on Nov 5.
     Each level counts as its % (Counts As, level ÷ 4: 3 is 75%, 3− 66.7%). */
    const SCI = [
      piece('s1', 'Cell Data', '2026-10-01', { tagIds: ['t-dp'] }),
      piece('s2', 'Claim and Evidence', '2026-10-06', { tagIds: ['t-sa'] }),
      piece('s3', 'Population Graphs', '2026-11-02', { tagIds: ['t-dp'] }),
      piece('s4', 'Vaccine Argument', '2026-11-05', { tagIds: ['t-sa'] }),
    ];
    beforeEach(() =>
      seed({
        system: 'both',
        gradeLevel: '11',
        sections: [
          ['dp', 'Data Patterns'],
          ['sa', 'Scientific Argument'],
        ],
        assessments: structuredClone(SCI),
        cells: {
          [ME]: {
            s1: levels({ 't-dp': lv(3) }),
            s2: levels({ 't-sa': lv(3, -1) }),
            s3: levels({ 't-dp': lv(4) }),
            s4: levels({ 't-sa': lv(2) }),
          },
        },
      }),
    );

    it('leads with the letter: B 73% ((75 + 66.7 + 100 + 50) / 4), up from C+ 71% ((75 + 66.7) / 2) a month ago', () => {
      const g = gradeMonthChange(CID, ME, TODAY);
      expect(g).toMatchObject({ now: 73, then: 71, from: 'C+', dir: 1 });
      expect(withReturnedOnly(() => getCourseLetterData(CID, ME)).S).toBe('B');
    });
    it('each skill by its word: Data Patterns up from Proficient (3 to 3.5, Extending)', () => {
      expect(skillMonthChange(CID, ME, 'dp', TODAY)).toMatchObject({ then: 3, now: 3.5, from: 'Proficient', dir: 1 });
    });
    it('Next Step: Scientific Argument at Developing ((2.67 + 2) / 2) takes the Developing step', () => {
      expect(nextStepLevel(CID, ME, 'sa')).toEqual({ level: 2, key: 'Developing', top: false });
      expect(skillMonthChange(CID, ME, 'sa', TODAY)).toMatchObject({ from: 'Proficient', dir: -1 });
    });
  });
});

describe('calc-pure', () => {
  /**
   * Pure calculation tests — shared/calc.js core math functions.
   * These need no mocking — they take arguments and return results.
   */

  // Helper: build a score object
  function s(score, date, opts) {
    return {
      score,
      date: date || '2025-01-01',
      type: 'summative',
      tagId: 't1',
      assessmentId: 'a1',
      ...(opts || {}),
    };
  }

  /* ── pointsToProf ─────────────────────────────────────────── */
  describe('pointsToProf', () => {
    it('returns 4 for 86% and above', () => {
      expect(pointsToProf(86, 100)).toBe(4);
      expect(pointsToProf(90, 100)).toBe(4);
      expect(pointsToProf(100, 100)).toBe(4);
    });

    it('returns 3 for 73-85%', () => {
      expect(pointsToProf(85, 100)).toBe(3);
      expect(pointsToProf(73, 100)).toBe(3);
    });

    it('returns 2 for 50-72%', () => {
      expect(pointsToProf(72, 100)).toBe(2);
      expect(pointsToProf(50, 100)).toBe(2);
    });

    it('returns 1 for below 50%', () => {
      expect(pointsToProf(49, 100)).toBe(1);
      expect(pointsToProf(0, 100)).toBe(1);
    });

    it('returns 0 for zero or negative maxPoints', () => {
      expect(pointsToProf(50, 0)).toBe(0);
      expect(pointsToProf(50, -10)).toBe(0);
      expect(pointsToProf(0, 0)).toBe(0);
    });

    it('works with non-100 maxPoints', () => {
      expect(pointsToProf(9, 10)).toBe(4); // 90%
      expect(pointsToProf(7, 10)).toBe(2); // 70%
      expect(pointsToProf(43, 50)).toBe(4); // 86%
      expect(pointsToProf(5, 10)).toBe(2); // 50%
    });

    it('supports custom grading scale', () => {
      const custom = {
        boundaries: [
          { min: 90, proficiency: 4 },
          { min: 70, proficiency: 3 },
          { min: 40, proficiency: 2 },
          { min: 0, proficiency: 1 },
        ],
      };
      expect(pointsToProf(85, 100, custom)).toBe(3);
      expect(pointsToProf(95, 100, custom)).toBe(4);
      expect(pointsToProf(39, 100, custom)).toBe(1);
    });
  });

  /* ── _calcGroup ───────────────────────────────────────────── */
  describe('_calcGroup', () => {
    describe('mostRecent', () => {
      it('returns the last score by date', () => {
        expect(_calcGroup([s(2, '2025-01-01'), s(3, '2025-02-01'), s(4, '2025-03-01')], 'mostRecent', 0.65)).toBe(4);
      });

      it('sorts unsorted input and returns most recent', () => {
        expect(_calcGroup([s(4, '2025-03-01'), s(2, '2025-01-01')], 'mostRecent', 0.65)).toBe(4);
      });

      it('handles a single score', () => {
        expect(_calcGroup([s(3, '2025-01-01')], 'mostRecent', 0.65)).toBe(3);
      });
    });

    describe('highest', () => {
      it('returns the max score', () => {
        expect(_calcGroup([s(2), s(4), s(1)], 'highest', 0.65)).toBe(4);
      });

      it('handles a single score', () => {
        expect(_calcGroup([s(1)], 'highest', 0.65)).toBe(1);
      });
    });

    describe('mode', () => {
      it('returns the most frequent score', () => {
        expect(_calcGroup([s(3, '2025-01-01'), s(3, '2025-02-01'), s(2, '2025-03-01')], 'mode', 0.65)).toBe(3);
      });

      it('breaks ties with the most recent score', () => {
        // 2 and 3 each appear twice — 3 is more recent
        expect(
          _calcGroup([s(2, '2025-01-01'), s(3, '2025-02-01'), s(2, '2025-03-01'), s(3, '2025-04-01')], 'mode', 0.65),
        ).toBe(3);
      });

      it('breaks ties with most recent (reversed)', () => {
        // 2 and 3 each appear twice — 2 is more recent
        expect(
          _calcGroup([s(3, '2025-01-01'), s(2, '2025-02-01'), s(3, '2025-03-01'), s(2, '2025-04-01')], 'mode', 0.65),
        ).toBe(2);
      });

      it('respects assessment weights', () => {
        // Score 2 with weight 3 vs two score 3s with weight 1 each
        const scores = [
          s(2, '2025-01-01', { assessmentId: 'heavy' }),
          s(3, '2025-02-01', { assessmentId: 'light' }),
          s(3, '2025-03-01', { assessmentId: 'light2' }),
        ];
        const weights = { heavy: 3, light: 1, light2: 1 };
        expect(_calcGroup(scores, 'mode', 0.65, weights)).toBe(2);
      });

      it('counts a 3+ and a 3 as the same level and keeps the newest one', () => {
        // Levels 3, 3, 2: the most common level is 3; the newest 3 is the 3+
        const scores = [s(3, '2025-01-01'), s(2, '2025-02-01'), s(10 / 3, '2025-03-01', { level: 3 })];
        expect(_calcGroup(scores, 'mode', 0.65)).toBeCloseTo(10 / 3, 5);
        // Newest 3 is a 3−
        const minus = [s(10 / 3, '2025-01-01', { level: 3 }), s(8 / 3, '2025-02-01', { level: 3 }), s(4, '2025-03-01')];
        expect(_calcGroup(minus, 'mode', 0.65)).toBeCloseTo(8 / 3, 5);
      });
    });

    describe('average', () => {
      it('returns the unweighted mean', () => {
        // 2 + 3 + 4 = 9 / 3 = 3
        expect(_calcGroup([s(2), s(3), s(4)], 'average', 0.65)).toBe(3);
      });

      it('returns the single score for one entry', () => {
        expect(_calcGroup([s(4)], 'average', 0.65)).toBe(4);
      });

      it('keeps the fraction instead of rounding to a whole level', () => {
        // (2+3) / 2 = 2.5
        expect(_calcGroup([s(2), s(3)], 'average', 0.65)).toBe(2.5);
      });

      it('keeps a + or − in the mean', () => {
        // 3+ (3.33) and 3 average to 3.17, which used to show as 3.0
        expect(_calcGroup([s(10 / 3, '2025-01-01', { level: 3 }), s(3, '2025-02-01')], 'average', 0.65)).toBeCloseTo(
          19 / 6,
          5,
        );
      });

      it('respects per-assessment weights', () => {
        // (2*3 + 4*1) / 4 = 10/4 = 2.5
        const scores = [
          { score: 2, date: '2025-01-01', assessmentId: 'heavy' },
          { score: 4, date: '2025-02-01', assessmentId: 'light' },
        ];
        expect(_calcGroup(scores, 'average', 0.65, { heavy: 3, light: 1 })).toBe(2.5);
      });
    });

    describe('median', () => {
      it('returns the middle value for an odd-length list', () => {
        expect(_calcGroup([s(1), s(3), s(4)], 'median', 0.65)).toBe(3);
      });

      it('averages the two middle values for an even-length list', () => {
        // (2+4)/2 = 3
        expect(_calcGroup([s(1), s(2), s(4), s(4)], 'median', 0.65)).toBe(3);
        // (2+3)/2 = 2.5, not rounded
        expect(_calcGroup([s(1), s(2), s(3), s(4)], 'median', 0.65)).toBe(2.5);
      });

      it('is insensitive to an unusually low outlier', () => {
        // Mean of [1, 3, 4] = 2.67 but median = 3 (rewards typical performance)
        expect(_calcGroup([s(1), s(3), s(4)], 'median', 0.65)).toBe(3);
      });

      it('returns the single score for one entry', () => {
        expect(_calcGroup([s(2)], 'median', 0.65)).toBe(2);
      });
    });

    describe('decayingAvg', () => {
      it('returns the score for a single entry', () => {
        expect(_calcGroup([s(3)], 'decayingAvg', 0.65)).toBe(3);
      });

      it('weights recent scores higher', () => {
        // avg = 2*0.35 + 4*0.65 = 0.7 + 2.6 = 3.3
        expect(_calcGroup([s(2, '2025-01-01'), s(4, '2025-02-01')], 'decayingAvg', 0.65)).toBeCloseTo(3.3, 5);
      });

      it('uses high decay weight correctly', () => {
        // avg = 1*0.1 + 4*0.9 = 0.1 + 3.6 = 3.7
        expect(_calcGroup([s(1, '2025-01-01'), s(4, '2025-02-01')], 'decayingAvg', 0.9)).toBeCloseTo(3.7, 5);
      });

      it('penalizes declining performance', () => {
        // avg = 4*0.35 + 1*0.65 = 1.4 + 0.65 = 2.05
        expect(_calcGroup([s(4, '2025-01-01'), s(1, '2025-02-01')], 'decayingAvg', 0.65)).toBeCloseTo(2.05, 5);
      });
    });

    describe('edge cases', () => {
      it('returns 0 for empty array', () => {
        expect(_calcGroup([], 'mostRecent', 0.65)).toBe(0);
      });

      it('returns 0 when all scores are zero (filtered out)', () => {
        expect(_calcGroup([s(0, '2025-01-01'), s(0, '2025-02-01')], 'mostRecent', 0.65)).toBe(0);
      });

      it('defaults to mostRecent for unknown method', () => {
        expect(_calcGroup([s(2, '2025-01-01'), s(3, '2025-02-01')], 'bogus', 0.65)).toBe(3);
      });

      it('handles null dates', () => {
        expect(_calcGroup([s(2, null), s(4, null)], 'highest', 0.65)).toBe(4);
      });
    });
  });

  /* ── calcProficiency ──────────────────────────────────────── */
  describe('calcProficiency', () => {
    it('calculates summative-only by default', () => {
      const scores = [s(3, '2025-01-01'), s(4, '2025-02-01')];
      expect(calcProficiency(scores, 'mostRecent', 0.65, {})).toBe(4);
    });

    it('ignores formative when formative weight is 0', () => {
      const scores = [s(3, '2025-01-01', { type: 'summative' }), s(1, '2025-02-01', { type: 'formative' })];
      expect(
        calcProficiency(scores, 'mostRecent', 0.65, {
          categoryWeights: { summative: 1.0, formative: 0 },
        }),
      ).toBe(3);
    });

    it('blends summative and formative with weights', () => {
      const scores = [s(4, '2025-01-01', { type: 'summative' }), s(2, '2025-02-01', { type: 'formative' })];
      // 4*0.7 + 2*0.3 = 2.8 + 0.6 = 3.4, not rounded
      expect(
        calcProficiency(scores, 'mostRecent', 0.65, {
          categoryWeights: { summative: 0.7, formative: 0.3 },
        }),
      ).toBeCloseTo(3.4, 5);
    });

    it('uses only formative when no summative evidence', () => {
      const scores = [s(3, '2025-01-01', { type: 'formative' })];
      expect(
        calcProficiency(scores, 'mostRecent', 0.65, {
          categoryWeights: { summative: 0.7, formative: 0.3 },
        }),
      ).toBe(3);
    });

    it('uses only summative when no formative evidence', () => {
      const scores = [s(4, '2025-01-01', { type: 'summative' })];
      expect(
        calcProficiency(scores, 'mostRecent', 0.65, {
          categoryWeights: { summative: 0.7, formative: 0.3 },
        }),
      ).toBe(4);
    });

    it('returns 0 for empty scores', () => {
      expect(calcProficiency([], 'mostRecent', 0.65, {})).toBe(0);
    });
  });

  /* ── calcLetterGrade ──────────────────────────────────────── */
  // A level counts as its Counts As percent; with no class, the defaults,
  // level ÷ 4 (docs/DECISIONS.md, "Proficiency percents").
  describe('calcLetterGrade', () => {
    it('counts a level as level ÷ 4 by default', () => {
      expect(calcLetterGrade(4.0)).toEqual({ letter: 'A', pct: 100 });
      expect(calcLetterGrade(3.5)).toEqual({ letter: 'A', pct: 87.5 });
      expect(calcLetterGrade(3.0)).toEqual({ letter: 'B', pct: 75 });
      expect(calcLetterGrade(2.5)).toEqual({ letter: 'C', pct: 62.5 });
      expect(calcLetterGrade(2.0)).toEqual({ letter: 'C-', pct: 50 });
    });

    it('gives F at 0 and below 50%', () => {
      expect(calcLetterGrade(0)).toEqual({ letter: 'F', pct: 0 });
      expect(calcLetterGrade(1.5).letter).toBe('F');
    });

    it('percentage increases monotonically with proficiency', () => {
      const levels = [0, 0.5, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 3.25, 3.5, 3.75, 4.0];
      for (let i = 1; i < levels.length; i++) {
        expect(calcLetterGrade(levels[i]).pct).toBeGreaterThanOrEqual(calcLetterGrade(levels[i - 1]).pct);
      }
    });

    it('never exceeds 100%', () => {
      expect(calcLetterGrade(4.0).pct).toBeLessThanOrEqual(100);
      expect(calcLetterGrade(5.0).pct).toBeLessThanOrEqual(100);
    });
  });
});
