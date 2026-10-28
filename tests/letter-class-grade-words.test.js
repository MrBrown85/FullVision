/**
 * A Letter class doesn't describe students with proficiency words. The
 * dashboard's Class Average bar counts students by letter grade, and the
 * Reports questionnaire's Academic Snapshot and auto-written narrative give
 * the letter and %. Proficiency classes are unchanged; Both shows both in
 * the snapshot and counts by level on the dashboard.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      actionItems: [],
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

  /* The Comment Bank's sentences that fit Noor, filled in. */
  function bankSentences() {
    const ctx = CommentBank.context(CommentBank.facts(CID, NOOR, TERM), {});
    return COMMENT_BANK.sentences.filter(s => CommentBank.fits(s, ctx)).map(s => CommentBank.fill(s, ctx));
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
    expect(text).toContain('Noor has a B (75%) overall, with their strongest work in Cause and Consequence.');
    expect(text).not.toMatch(PROF_WORDS);
  });

  it('keeps the proficiency wording in a Proficiency class', () => {
    seed('proficiency');
    expect(bankSentences()).toContain(
      'Noor is working at a Proficient level overall, with their strongest results in Cause and Consequence.',
    );
  });
});
