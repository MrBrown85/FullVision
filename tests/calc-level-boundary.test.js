/**
 * A level exactly on a boundary reads as the scale says (shared/calc.js:
 * _onPaper, roundLevel, _wholePercent; grade math, for Colin's review).
 *
 * A + or − is worth a third, which a computer can't hold exactly, so an
 * average that is exactly 2.5 on paper can come out 2.4999999999999996. The
 * figure beside it prints "2.5", and 2.5 is Proficient, but the word used to
 * come from the unrounded value and said Developing. Every reading that
 * compares a level or a percent with a boundary now reads it on paper (12
 * significant figures) first. A level honestly under a boundary stays under.
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

describe('words, codes and colours: 1.5, 2.5 and 3.5', () => {
  [
    [1.5, 'Emerging', 'Developing'],
    [2.5, 'Developing', 'Proficient'],
    [3.5, 'Proficient', 'Extending'],
  ].forEach(([b, below, above]) => {
    it(b + ' reads ' + above + ' from either side, and just under it is ' + below, () => {
      seedStyle('proficiency');
      const thirds = b * 3; // in thirds: 4.5, 7.5, 10.5
      const under = hair(thirds * 2, 6, -1);
      const over = hair(thirds * 2, 6, 1);
      expect(under).toBeLessThan(b);
      expect(over).toBeGreaterThan(b);
      [under, b, over].forEach(v => {
        expect(levelWord(CID, v)).toBe(above);
        expect(levelCode(v)).toBe(PROF_CODES[Math.ceil(b)]);
        expect(roundLevel(v)).toBe(Math.ceil(b));
        expect(formatLevel(CID, v)).toBe(b.toFixed(1));
      });
      [b - 0.01, b - 1e-6, b - 1e-9].forEach(v => {
        expect(levelWord(CID, v)).toBe(below);
        expect(roundLevel(v)).toBe(Math.floor(b));
      });
    });
  });
});

describe('+ and − (nearestScoreLevel): halfway between two steps', () => {
  // Halfway between steps t and t+1 is (2t + 1) / 6 levels; it rounds up.
  for (let t = 3; t < 12; t++) {
    it(formatScoreLevel(Math.round(t / 3), t - Math.round(t / 3) * 3) + ' and the step above', () => {
      const up = nearestScoreLevel((t + 1) / 3).text;
      const down = nearestScoreLevel(t / 3).text;
      [hair(2 * t + 1, 6, -1), (2 * t + 1) / 6, hair(2 * t + 1, 6, 1)].forEach(v => {
        expect(nearestScoreLevel(v).text).toBe(up);
      });
      expect(nearestScoreLevel((2 * t + 1) / 6 - 1e-6).text).toBe(down);
    });
  }
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

describe('what stays as it was', () => {
  it('the level itself is never changed, only what it is compared as', () => {
    seedSkill([E, Xm, Xm, Dm]);
    expect(getSectionProficiency(CID, ME, 'ev')).toBe(2.4999999999999996);
    expect(getOverallProficiency(CID, ME)).toBe(2.4999999999999996);
  });

  it('an honest level just under 2.5 prints 2.5 and reads Developing, as before (owner’s choice)', () => {
    // Five pieces, 37 thirds: 2.47 on paper. The figure rounds it to 2.5;
    // the word follows the level, not the figure.
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
    expect(levelWord(CID, v)).toBe('Developing');
  });
});

/* ── The property: the word is the level on paper's word ─────────────── */

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

describe('the property: every average of entered levels reads as its exact value says', () => {
  it('20,000 random histories of one to eight pieces, averaged in date order', () => {
    seedStyle('proficiency');
    const r = rng(20261111);
    let halves = 0;
    for (let k = 0; k < 20000; k++) {
      const n = 1 + Math.floor(r() * 8);
      // Mostly steps that land on halves, so boundaries come up often.
      const pool = k % 2 ? STEPS : [3, 5, 7, 8, 10, 11];
      const list = Array.from({ length: n }, () => pool[Math.floor(r() * pool.length)]);
      const T = list.reduce((a, b) => a + b, 0); // the sum in thirds, exact
      const v = calcProficiency(
        list.map((t, i) => ({ score: stepValue(t), date: '2026-10-' + (10 + i), assessmentId: 'a' + i })),
        'average',
      );
      // The exact level is T / 3n. Its whole level, a half rounding up:
      const whole = Math.floor((2 * T + 3 * n) / (6 * n));
      // Its nearest step (in thirds), a half rounding up:
      const step = Math.floor((2 * T + n) / (2 * n));
      expect(roundLevel(v)).toBe(whole);
      expect(levelWord(CID, v)).toBe(PROF_LABELS[whole]);
      expect(levelCode(v)).toBe(PROF_CODES[whole]);
      const sl = Math.max(1, Math.min(4, Math.round(step / 3)));
      expect(nearestScoreLevel(v)).toEqual({ level: sl, text: formatScoreLevel(sl, step - sl * 3) });
      // On a half exactly, the printed figure is that half and the word is
      // the level above it.
      if ((2 * T) % (3 * n) === 0 && ((2 * T) / (3 * n)) % 2 === 1) {
        halves++;
        expect(formatLevel(CID, v)).toBe((T / (3 * n)).toFixed(1));
        expect(Number(formatLevel(CID, v))).toBe(whole - 0.5);
      }
    }
    expect(halves).toBeGreaterThan(500);
  });
});
