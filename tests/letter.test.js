/**
 * letter: the tests that were tests/letter-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('letter-bands', () => {
  /**
   * One table of BC letter bands (BC_LETTER_BANDS) drives every letter cutoff
   * in calc.js, and scoreLevelText names one score's level with its + or −.
   * The old hand-written cutoffs are kept here to prove nothing moved.
   */

  function oldPercentageToLetter(R, cid) {
    if (R == null) return null;
    if (R >= 86) return 'A';
    if (R >= 73) return 'B';
    if (R >= 67) return 'C+';
    if (R >= 60) return 'C';
    if (R >= 50) return 'C-';
    return cid == null || courseHasEnded(cid) ? 'F' : 'IE';
  }
  function oldPercentLevel(pct) {
    return pct >= 86 ? 4 : pct >= 73 ? 3 : pct >= 60 ? 2 : 1;
  }
  function oldNextLetterBand(R) {
    var bands = [
      { label: 'A', min: 86 },
      { label: 'B', min: 73 },
      { label: 'C+', min: 67 },
      { label: 'C', min: 60 },
      { label: 'C-', min: 50 },
      { label: 'F', min: 0 },
    ];
    if (R == null || isNaN(Number(R))) return null;
    for (var i = bands.length - 1; i >= 0; i--) {
      if (bands[i].min > Number(R)) return { letter: bands[i].label, min: bands[i].min };
    }
    return null;
  }

  const VALUES = [null, undefined, NaN, -5, 0, 49.99, 50, 59.9, 60, 66.95, 67, 72.99, 73, 85.95, 86, 100, 104.5];
  for (let p = 0; p <= 1000; p++) VALUES.push(p / 10);

  describe('BC_LETTER_BANDS', () => {
    const originalTerms = globalThis.getReportingTerms;
    afterEach(() => {
      globalThis.getReportingTerms = originalTerms;
    });

    it('gives the same letter as the old cutoffs, with and without a class', () => {
      VALUES.forEach(v => {
        expect(percentageToLetter(v)).toBe(oldPercentageToLetter(v));
      });
      // A class with no reporting terms never ends, so under 50 is IE.
      globalThis.getReportingTerms = () => [];
      VALUES.forEach(v => {
        expect(percentageToLetter(v, 'course-x')).toBe(oldPercentageToLetter(v, 'course-x'));
      });
    });

    it('gives the same colour level as the old cutoffs (C- and F are 1)', () => {
      VALUES.forEach(v => {
        expect(_percentLevel(v)).toBe(oldPercentLevel(v));
      });
    });

    it('gives the same next band up', () => {
      VALUES.forEach(v => {
        expect(nextLetterBand(v)).toEqual(oldNextLetterBand(v));
      });
    });

    it('is not the points → proficiency scale (50–59% is Developing there)', () => {
      const developing = DEFAULT_GRADING_SCALE.boundaries.find(b => b.proficiency === 2);
      expect(developing.min).toBe(50);
      expect(_percentLevel(55)).toBe(1);
    });
  });

  describe('scoreLevelText', () => {
    it('names the level with its + or −', () => {
      expect(scoreLevelText(3, 1)).toBe('Proficient +');
      expect(scoreLevelText(2, -1)).toBe('Developing −');
      expect(scoreLevelText(3, 0)).toBe('Proficient');
      expect(scoreLevelText(3)).toBe('Proficient');
    });

    it('drops a sign a level cannot carry (no 1− or 4+)', () => {
      expect(scoreLevelText(4, 1)).toBe('Extending');
      expect(scoreLevelText(1, -1)).toBe('Emerging');
    });

    it('is empty with no level', () => {
      expect(scoreLevelText(0, 1)).toBe('');
      expect(scoreLevelText(null)).toBe('');
    });
  });
});

describe('letter-class-grade-words', () => {
  /**
   * A Letter class doesn't describe students with proficiency words. The
   * dashboard's Class Average bar counts students by letter grade, and the
   * Reports questionnaire's Academic Snapshot and auto-written narrative give
   * the letter and %. Proficiency classes are unchanged; Both shows both in
   * the snapshot and counts by level on the dashboard.
   */

  const PROF_WORDS = /Extending|Proficient|Developing|Emerging/i;

  describe('class grade distribution', () => {
    const CID = 'course-distribution';
    const STUDENTS = [
      { id: 's1', firstName: 'Ava', lastName: 'Chan' },
      { id: 's2', firstName: 'Ben', lastName: 'Diaz' },
      { id: 's3', firstName: 'Cy', lastName: 'Eng' },
      { id: 's4', firstName: 'Dee', lastName: 'Fox' },
      { id: 's5', firstName: 'Eli', lastName: 'Gill' },
    ];
    const IDS = STUDENTS.map(s => s.id);
    const stubbed = ['getOverallProficiency', 'getCourseLetterData'];
    const originals = {};
    const overall = { s1: 2.8, s2: 3.4, s3: 0, s4: 2.4, s5: 1.2 };
    const letter = {
      s1: { S: 'B', R: 78.9 },
      s2: { S: 'A', R: 91 },
      s3: { S: null, R: null },
      s4: { S: 'C+', R: 68 },
      s5: { S: 'C', R: 62 },
    };

    beforeEach(() => {
      stubbed.forEach(name => (originals[name] = globalThis[name]));
      globalThis.getOverallProficiency = (cid, sid) => overall[sid] || 0;
      globalThis.getCourseLetterData = (cid, sid) => letter[sid];
      _cache.students[CID] = STUDENTS;
    });

    afterEach(() => {
      stubbed.forEach(name => (globalThis[name] = originals[name]));
      delete COURSES[CID];
    });

    function setting(gradingSystem) {
      COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem };
    }

    const counts = bands => bands.map(b => [b.label, b.level, b.ids]);

    it('counts a Proficiency class by level', () => {
      setting('proficiency');
      expect(counts(classGradeDistribution(CID, IDS))).toEqual([
        ['Extending', 4, []],
        ['Proficient', 3, ['s1', 's2']],
        ['Developing', 2, ['s4']],
        ['Emerging', 1, ['s5']],
      ]);
    });

    it('counts a Letter class by letter grade, coloured by band', () => {
      setting('letter');
      expect(counts(classGradeDistribution(CID, IDS))).toEqual([
        ['A', 4, ['s2']],
        ['B', 3, ['s1']],
        ['C+', 2, ['s4']],
        ['C', 2, ['s5']],
        ['C-', 1, []],
        ['IE', 1, []],
      ]);
    });

    it('counts a Both class by level, the grade it shows first', () => {
      setting('both');
      expect(classGradeDistribution(CID, IDS).map(b => b.label)).toEqual([
        'Extending',
        'Proficient',
        'Developing',
        'Emerging',
      ]);
    });

    function distributionBar() {
      const html = DashOverview.renderOverviewPanel({
        cid: CID,
        sections: [],
        allStudents: STUDENTS,
        assessments: [],
        tagCoveragePct: 0,
        sectionClassAvgs: [],
        tagsWithEvidence: 0,
        allTags: [],
        tagCoverageMap: {},
        assessedCCs: new Set(),
        ccCounts: {},
        ccAssessments: {},
        recentObsCount: 0,
        flagCount: 0,
      });
      return html.slice(html.indexOf('Class Average'), html.indexOf('Missing and Late'));
    }

    it('shows letter grades on the dashboard bar in a Letter class', () => {
      setting('letter');
      const bar = distributionBar();
      expect(bar).not.toMatch(PROF_WORDS);
      expect(bar).toContain('<div class="dist-tip-title">A</div><div class="dist-tip-name">Ben Diaz</div>');
      expect(bar).toContain('<div class="dist-tip-title">C+</div>');
      expect(bar).not.toContain('<div class="dist-tip-title">F</div>');
    });

    it('keeps proficiency words on the dashboard bar in a Proficiency class', () => {
      setting('proficiency');
      const bar = distributionBar();
      expect(bar).toContain('<div class="dist-tip-title">Proficient</div>');
      expect(bar).not.toContain('<div class="dist-tip-title">Extending</div>');
    });
  });

  describe('Reports questionnaire in a Letter class', () => {
    const CID = 'course-questionnaire-letter';
    const TERM = 'term-1';
    const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Khan', pronouns: 'they/them' };

    const section = (id, tagId) => ({
      id,
      name: 'Cause and Consequence',
      shortName: 'Cause',
      tags: [{ id: tagId, label: 'Cause and Consequence' }],
    });
    const assess = (id, title, tagId) => ({ id, title, scoreMode: 'proficiency', tagIds: [tagId], type: 'summative' });
    const score = (assessmentId, tagId, level) => ({ assessmentId, tagId, score: level, date: '2026-10-10' });

    // Two competencies, both at level 3: Proficient, or 75% (a B).
    function seed(gradingSystem) {
      COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem };
      _cache.students[CID] = [NOOR];
      _cache.learningMaps[CID] = { sections: [section('sec-1', 't1'), section('sec-2', 't2')] };
      _cache.categories[CID] = [];
      _cache.assessments[CID] = [assess('a1', 'Historical Inquiry Essay', 't1'), assess('a2', 'Map Quiz', 't2')];
      _cache.scores[CID] = { [NOOR.id]: [score('a1', 't1', 3), score('a2', 't2', 3)] };
      _cache.statuses[CID] = {};
      _cache.overrides[CID] = {};
      _cache.courseConfigs[CID] = {};
      _cache.observations[CID] = {};
      _cache.reflections[CID] = {};
      _cache.termRatings[CID] = {};
      clearProfCache();
      ReportQuestionnaire.configure({ activeCourse: CID, renderReports() {} });
      ReportQuestionnaire.tqStudentIndex = 0;
    }

    /* The Comment Bank's sentences that fit Noor, each filled as the comment's
     first sentence (naming her). */
    function bankSentences() {
      const ctx = CommentBank.context(CommentBank.facts(CID, NOOR, TERM), {});
      return COMMENT_BANK.sentences
        .filter(s => CommentBank.fits(s, ctx))
        .map(s => CommentBank.fill(s, ctx, { first: true }));
    }

    beforeEach(() => localStorage.clear());
    afterEach(() => {
      vi.restoreAllMocks();
      delete COURSES[CID];
    });

    it('gives the comment bank a letter grade, not a proficiency word', () => {
      seed('letter');
      const text = bankSentences().join(' ');
      // Was (tqAutoNarrative): "Academically, Noor is working at a proficient
      // level, with strong results in cause and consequence."
      expect(text).toContain('Noor has a B in Socials 9 so far, which is very good work.');
      // One piece per competency is below the "strongest" evidence gate (plan
      // PR 6), so no sentence names a strongest competency.
      expect(text).not.toContain('Cause and Consequence');
      expect(text).not.toMatch(PROF_WORDS);
    });

    it('keeps the proficiency wording in a Proficiency class', () => {
      seed('proficiency');
      expect(bankSentences()).toContain('Noor is working at a Proficient level in Socials 9.');
    });
  });
});

describe('letter-grade-ie', () => {
  /**
   * BC reporting: a student under 50% gets IE (Insufficient Evidence), not F,
   * until the course ends. Proficiency words are never replaced.
   */

  describe('IE before the course ends', () => {
    const CID = 'course-ie';
    const TERMS = [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-27' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-11-28', ends_on: '2027-01-26' },
    ];
    let today;
    let originals;

    beforeEach(() => {
      originals = { getReportingTerms: globalThis.getReportingTerms, courseToday: globalThis.courseToday };
      globalThis.getReportingTerms = () => TERMS;
      globalThis.courseToday = () => today;
      today = '2026-10-27';
      setActiveTerm(CID, null);
    });

    afterEach(() => {
      globalThis.getReportingTerms = originals.getReportingTerms;
      globalThis.courseToday = originals.courseToday;
      setActiveTerm(CID, null);
      vi.restoreAllMocks();
    });

    it('gives IE under 50% before the last term ends', () => {
      expect(percentageToLetter(42, CID)).toBe('IE');
      expect(percentageToLetter(0, CID)).toBe('IE');
    });

    it('leaves passing letters alone', () => {
      expect(percentageToLetter(50, CID)).toBe('C-');
      expect(percentageToLetter(90, CID)).toBe('A');
    });

    it('gives F once the last term has ended', () => {
      today = '2027-01-26';
      expect(percentageToLetter(42, CID)).toBe('F');
    });

    it('gives F on the final report, the last term in view', () => {
      setActiveTerm(CID, 2);
      expect(percentageToLetter(42, CID)).toBe('F');
      setActiveTerm(CID, 1);
      expect(percentageToLetter(42, CID)).toBe('IE');
    });

    it('gives IE in a class with no reporting terms', () => {
      globalThis.getReportingTerms = () => [];
      expect(courseHasEnded(CID)).toBe(false);
      expect(percentageToLetter(10, CID)).toBe('IE');
    });

    it('applies to a grade from proficiency work too', () => {
      expect(calcLetterGrade(0.5, CID).letter).toBe('IE');
    });
  });
});
