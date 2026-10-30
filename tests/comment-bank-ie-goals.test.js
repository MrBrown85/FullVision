/**
 * Generate plan PR 3 (second half): IE, language goals and IEP goals.
 *
 * - Automatic IE (calc.js, under 50% before the course ends) takes the IE
 *   path with no switch.
 * - The teacher may choose IE when the student has marks on fewer than half
 *   the work the class has marks on; it is stored as reporting_basis 'ie'.
 * - The IE comment's Grade, Problem, Plan, Deadline and Meeting sentences
 *   are Required; Approve and Next stays off until the deadline is picked
 *   and the missing-work row is ticked.
 * - ELL offers Language Goals, an IEP offers IEP Goals: no letter prints
 *   and a fixed statement replaces the grade sentence.
 * - The report and the gradebook read the stored basis (calc.js).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const words = t => t.trim().split(/\s+/).length;
const IE_IDS = ['gr06', 'ie01', 'ie02', 'ie03', 'ie04', 'ie05', 'ie06', 'ie07', 'ie08', 'ie09', 'ie10'];
const claimsGrade = id => ((byId(id) || {}).claims || []).indexOf('grade') >= 0;

const CID = 'course-ie-goals';
const TERM = 'term-1';
const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Khan', pronouns: 'she/her' };
const MAYA = { id: 'stu-maya', firstName: 'Maya', lastName: 'Lopez', pronouns: 'she/her' };
const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

/* Eight proficiency-scored tasks. Maya has a mark on all of them; Noor on
   the ones `noor` gives a level for (null = no mark). `missing` lists the
   tasks labelled Missing for Noor. */
function seed(opts) {
  opts = opts || {};
  const noor = opts.noor || [3, 3, 3, null, null, null, null, null];
  COURSES[CID] = {
    id: CID,
    name: 'History 12',
    gradingSystem: opts.mode || 'letter',
    gradeLevel: opts.gradeLevel == null ? '12' : opts.gradeLevel,
  };
  _cache.students[CID] = [
    Object.assign({}, NOOR, { designations: opts.designations || [] }),
    Object.assign({}, MAYA, { designations: [] }),
  ];
  _cache.learningMaps[CID] = {
    sections: [section('sec-1', 't1', 'Cause and Consequence'), section('sec-2', 't2', 'Evidence')],
  };
  _cache.categories[CID] = [];
  const titles = (opts.titles || []).slice();
  _cache.assessments[CID] = noor.map((_, i) => ({
    id: 'a' + i,
    title: titles[i] || 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: [i % 2 ? 't2' : 't1'],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  const row = (v, i) => ({
    assessmentId: 'a' + i,
    tagId: i % 2 ? 't2' : 't1',
    score: v,
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  });
  _cache.scores[CID] = {
    [NOOR.id]: noor.map((v, i) => (v == null ? null : row(v, i))).filter(Boolean),
    [MAYA.id]: noor.map((_, i) => row(3, i)),
  };
  const st = {};
  (opts.missing || []).forEach(i => (st[NOOR.id + ':a' + i] = 'NS'));
  _cache.statuses[CID] = st;
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  clearProfCache();
}
const student = () => getStudents(CID).find(s => s.id === NOOR.id);
const factsNow = () => CommentBank.facts(CID, student(), TERM);
const rate = data => upsertTermRating(CID, NOOR.id, TERM, data);

beforeEach(() => localStorage.clear());
afterEach(() => {
  delete COURSES[CID];
  clearProfCache();
});

describe('the IE and goals sentences in the bank', () => {
  const ctxFor = p => ({
    _p: p,
    name: 'Jack',
    missingWork: 'x',
    markedMine: 'four',
    markedClass: '28',
    ieDeadline: 'December 18',
  });
  const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
  const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

  it('words the IE grade sentence, the plan, the deadline and the meeting as the mockup', () => {
    const ctx = ctxFor(HE);
    expect(CommentBank.fill(byId('gr06'), ctx)).toBe(
      'Jack’s mark this term is IE, which means there is not yet enough evidence for a letter grade.',
    );
    expect(CommentBank.fill(byId('ie04'), ctx)).toBe('To earn a grade, he needs to hand in the missing work.');
    expect(CommentBank.fill(byId('ie07'), ctx)).toBe('The deadline to replace this IE with a grade is December 18.');
    expect(CommentBank.fill(byId('ie08'), ctx)).toBe('Please contact me so we can talk about this plan together.');
    expect(CommentBank.fill(byId('ie04'), ctxFor(THEY))).toBe(
      'To earn a grade, they need to hand in the missing work.',
    );
  });

  it('words the language and IEP goals statements as the plan', () => {
    expect(CommentBank.fill(byId('gr07'), ctxFor(HE))).toBe(
      'This term, Jack is assessed in relation to his goals for English language proficiency.',
    );
    expect(CommentBank.fill(byId('gr08'), ctxFor(THEY))).toBe(
      'This term, Jack is assessed in relation to the goals in their IEP.',
    );
  });

  it('keeps every sentence at 20 words or fewer', () => {
    IE_IDS.concat(['gr07', 'gr08']).forEach(id =>
      expect(words(CommentBank.fill(byId(id), ctxFor(HE))), id).toBeLessThanOrEqual(20),
    );
  });
});

describe('the work-not-handed-in sentence', () => {
  const S = CommentBank.notHandedInSentence;
  it('quotes one title, the period inside the closing quote', () => {
    expect(S({ count: 1, titles: ['1.1 Two Ways to Build an Empire'], groups: [] })).toBe(
      'One assignment is not handed in: “Two Ways to Build an Empire.”',
    );
    expect(S({ count: 1, titles: ['3.5 Why Did the Peace Fail?'], groups: [] })).toBe(
      'One assignment is not handed in: “Why Did the Peace Fail?”',
    );
  });
  it('joins two titles with "and"', () => {
    expect(S({ count: 2, titles: ['Map Quiz', 'Lab 2'], groups: [] })).toBe(
      'Two assignments are not handed in: “Map Quiz” and “Lab 2.”',
    );
  });
  it('counts three or more, with the largest group', () => {
    expect(S({ count: 15, titles: [], groups: [{ name: 'Current Events', count: 6 }] })).toBe(
      'Fifteen assignments are not handed in, including six Current Events assignments.',
    );
    expect(S({ count: 21, titles: [], groups: [{ name: 'Current Events', count: 12 }] })).toBe(
      'Twenty-one assignments are not handed in, including 12 Current Events assignments.',
    );
    expect(S({ count: 3, titles: ['a', 'b', 'c'], groups: [] })).toBe('Three assignments are not handed in.');
    expect(S({ count: 0, titles: [], groups: [] })).toBe('');
  });
});

describe('Letter Grade | IE: the teacher’s choice', () => {
  it('is offered when the student has marks on fewer than half the class’s marked work', () => {
    seed();
    const f = factsNow();
    expect(f.grade.marked).toEqual({ mine: 3, all: 8 });
    expect(f.grade.letter).toBe('B');
    expect(CommentBank.ieOffered(f)).toBe(true);
    expect(CommentBank.reportPath(f)).toBe('');
    expect(ReportQuestionnaire.basisChoices(f)).toMatchObject({ ie: true, goals: [], basis: 'grade' });
    // Letter Grade is the default: the letter sentence still leads.
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.ids[0]).toBe('gr01');
  });

  it('is not offered with marks on half or more, in a Proficiency class, or below grade 10', () => {
    seed({ noor: [3, 3, 3, 3, null, null, null, null] });
    expect(CommentBank.ieOffered(factsNow())).toBe(false);
    seed({ mode: 'proficiency' });
    expect(CommentBank.ieOffered(factsNow())).toBe(false);
    seed({ gradeLevel: '9' });
    expect(CommentBank.ieOffered(factsNow())).toBe(false);
    seed({ gradeLevel: '10-12' });
    expect(CommentBank.ieOffered(factsNow())).toBe(true);
  });

  it('chosen, writes the Required IE parts in order, with [date] until a deadline is picked', () => {
    seed();
    rate({ reportingBasis: 'ie' });
    const f = factsNow();
    expect(f.grade.basis).toBe('ie');
    expect(CommentBank.reportPath(f)).toBe('ie');
    expect(CommentBank.ieSource(f)).toBe('teacher');
    expect(CommentBank.ieProblemOf(f)).toBe('marks');
    for (let n = 1; n <= 6; n++) {
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed: n });
      const req = d.ids.filter(id => IE_IDS.indexOf(id) >= 0);
      expect(req, 'seed ' + n).toEqual(['gr06', 'ie02', 'ie05', 'ie07', 'ie08']);
      expect(d.ids[0]).toBe('gr06');
      expect(d.ids.slice(1).filter(claimsGrade)).toEqual([]);
      expect(d.text).toContain('She has a mark on three of the eight assignments marked so far this term.');
      expect(d.text).toContain('The deadline to replace this IE with a grade is [date].');
      expect(d.text).not.toMatch(/earning a/);
      expect(d.replaced).toEqual([]);
    }
  });

  it('with no marks at all, says so plainly', () => {
    seed({ noor: [null, null, null, null, null, null, null, null] });
    rate({ reportingBasis: 'ie' });
    const f = factsNow();
    expect(CommentBank.ieProblemOf(f)).toBe('noMarks');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.text).toContain('She has no marks yet on the eight assignments marked so far this term.');
    expect(d.ids.filter(id => IE_IDS.concat(['ie09', 'ie10']).indexOf(id) >= 0)).toEqual([
      'gr06',
      'ie09',
      'ie10',
      'ie07',
      'ie08',
    ]);
    expect(d.replaced).toEqual([]);
  });

  it('says the picked deadline, and verify catches a deadline that changed', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    const f = factsNow();
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.text).toContain('The deadline to replace this IE with a grade is December 18.');
    rate({ reportingBasis: 'ie', ieDeadline: '2027-01-08' });
    const v = CommentBank.verify(d, factsNow(), {});
    expect(v.replaced.find(r => r.sentenceId === 'ie07').failed).toContain('deadline');
  });

  it('names the work labelled Missing as the problem and the plan', () => {
    seed({
      missing: [3, 4, 5],
      titles: [, , , 'Current Events: Week 1', 'Current Events: Week 2', 'Current Events: Week 3'],
    });
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    const f = factsNow();
    expect(CommentBank.ieProblemOf(f)).toBe('missing');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.text).toContain('Three assignments are not handed in, including three Current Events assignments.');
    expect(d.text).toContain('To earn a grade, she needs to hand in the missing work.');
    expect(d.replaced).toEqual([]);
  });

  it('switched back to Letter Grade, the letter sentence leads again', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    rate({ reportingBasis: 'grade', ieDeadline: '2026-12-18' });
    const d = CommentBank.draft(CommentBank.context(factsNow(), {}), { seed: 1 });
    expect(d.ids[0]).toBe('gr01');
  });

  it('is ignored in a Proficiency class', () => {
    seed({ mode: 'proficiency' });
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    const f = factsNow();
    expect(f.grade.basis).toBe('grade');
    expect(CommentBank.reportPath(f)).toBe('');
  });
});

describe('Automatic IE: under 50% before the course ends', () => {
  it('takes the IE path with no switch, the low mark as the problem', () => {
    seed({ noor: [1, 1, 2, 1, 1, 1, 2, 1] });
    const f = factsNow();
    expect(f.grade.letter).toBe('IE');
    expect(CommentBank.reportPath(f)).toBe('ie');
    expect(CommentBank.ieSource(f)).toBe('calc');
    expect(ReportQuestionnaire.basisChoices(f).ie).toBe(false);
    expect(CommentBank.ieProblemOf(f)).toBe('low');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
    expect(d.ids.filter(id => IE_IDS.indexOf(id) >= 0)).toEqual(['gr06', 'ie03', 'ie06', 'ie07', 'ie08']);
    expect(d.replaced).toEqual([]);
  });

  it('keeps F as calc.js gives it: no IE path once the course has ended', () => {
    seed({ noor: [1, 1, 2, 1, 1, 1, 2, 1] });
    const was = globalThis.courseHasEnded;
    globalThis.courseHasEnded = () => true;
    try {
      clearProfCache();
      const f = factsNow();
      expect(f.grade.letter).toBe('F');
      expect(CommentBank.reportPath(f)).toBe('');
      expect(CommentBank.gradeOf(f)).toBeNull();
    } finally {
      globalThis.courseHasEnded = was;
      clearProfCache();
    }
  });
});

describe('Letter Grade | Language Goals and IEP Goals', () => {
  it('ELL offers Language Goals; chosen, the statement replaces the grade sentence', () => {
    seed({ noor: [3, 3, 3, 3, 3, 3, 3, 3], designations: ['ELL'] });
    let f = factsNow();
    expect(CommentBank.goalsOffered(f)).toEqual(['language_goals']);
    expect(ReportQuestionnaire.basisChoices(f)).toMatchObject({ ie: false, goals: ['language_goals'] });
    rate({ reportingBasis: 'language_goals' });
    f = factsNow();
    expect(CommentBank.reportPath(f)).toBe('language_goals');
    for (let n = 1; n <= 6; n++) {
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed: n });
      expect(d.sentences[0].text).toBe(
        'This term, Noor is assessed in relation to her goals for English language proficiency.',
      );
      expect(d.ids.slice(1).filter(claimsGrade)).toEqual([]);
      expect(d.ids.filter(id => IE_IDS.indexOf(id) >= 0)).toEqual([]);
      expect(d.text).not.toMatch(/earning a|\bB\b/);
      expect(d.replaced).toEqual([]);
    }
    expect(CommentBank.requiredParts(CommentBank.context(f, {}))).toEqual([
      {
        key: 'grade',
        label: 'Statement',
        id: 'gr07',
        text: 'This term, Noor is assessed in relation to her goals for English language proficiency.',
      },
    ]);
  });

  it('an IEP designation offers IEP Goals, with its own statement', () => {
    seed({ noor: [3, 3, 3, 3, 3, 3, 3, 3], designations: ['Q'] });
    expect(CommentBank.goalsOffered(factsNow())).toEqual(['iep_goals']);
    rate({ reportingBasis: 'iep_goals' });
    const d = CommentBank.draft(CommentBank.context(factsNow(), {}), { seed: 1 });
    expect(d.sentences[0].text).toBe('This term, Noor is assessed in relation to the goals in her IEP.');
  });

  it('offers nothing without a designation, or in a Proficiency class', () => {
    seed({ noor: [3, 3, 3, 3, 3, 3, 3, 3] });
    expect(CommentBank.goalsOffered(factsNow())).toEqual([]);
    seed({ noor: [3, 3, 3, 3, 3, 3, 3, 3], designations: ['ELL'], mode: 'proficiency' });
    expect(CommentBank.goalsOffered(factsNow())).toEqual([]);
  });

  it('goals win over an IE from calc.js: no letter, no IE', () => {
    seed({ noor: [1, 1, 2, 1, 1, 1, 2, 1], designations: ['ELL'] });
    rate({ reportingBasis: 'language_goals' });
    expect(CommentBank.reportPath(factsNow())).toBe('language_goals');
  });
});

describe('the report and the gradebook read the reporting basis (calc.js)', () => {
  it('prints IE, or No Letter Grade for goals, with no %, for that report only', () => {
    seed();
    expect(studentGradeBadges(CID, NOOR.id, TERM).letter).toMatchObject({ grade: 'B', pct: '75%' });
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    expect(reportingBasis(CID, NOOR.id, TERM)).toBe('ie');
    expect(reportingBasis(CID, NOOR.id, 1)).toBe('ie');
    expect(studentGradeBadges(CID, NOOR.id, TERM).letter).toEqual({
      text: 'IE',
      grade: 'IE',
      pct: '',
      level: 1,
      basis: 'ie',
    });
    expect(studentGradeSummary(CID, NOOR.id, TERM).text).toBe('IE');
    // Without a report, and for another report, the grade as calculated.
    expect(studentGradeSummary(CID, NOOR.id).text).toBe('B 75%');
    expect(studentGradeSummary(CID, NOOR.id, 'term-2').text).toBe('B 75%');
    rate({ reportingBasis: 'language_goals' });
    expect(studentGradeSummary(CID, NOOR.id, TERM).text).toBe('No Letter Grade');
  });

  it('keeps the proficiency in a Both class, and ignores the basis in a Proficiency class', () => {
    seed({ mode: 'both' });
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    expect(studentGradeSummary(CID, NOOR.id, TERM).text).toBe('3.0 · IE');
    seed({ mode: 'proficiency' });
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    expect(reportingBasis(CID, NOOR.id, TERM)).toBe('grade');
    expect(studentGradeSummary(CID, NOOR.id, TERM).text).toBe('3.0');
  });

  it('a rating without the field (before the migration) is the grade', () => {
    seed();
    rate({ narrative: 'Hello.' });
    expect(reportingBasis(CID, NOOR.id, TERM)).toBe('grade');
    rate({ reportingBasis: 'nonsense' });
    expect(reportingBasis(CID, NOOR.id, TERM)).toBe('grade');
  });

  it('the gradebook follows the term in view', () => {
    seed();
    _cache.courseConfigs[CID] = {
      reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' }],
    };
    expect(viewedReportTerm(CID)).toBeNull();
    setActiveTerm(CID, 1);
    try {
      expect(viewedReportTerm(CID)).toBe('term-1');
    } finally {
      setActiveTerm(CID, null);
    }
  });

  it('the Academic Summary block prints IE or No Letter Grade with its line', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    let html = ReportBlocks.renderBlockAcademicSummary(CID, student(), { termId: TERM });
    expect(html).toContain('>IE<');
    expect(html).toContain('Insufficient Evidence');
    expect(html).not.toContain('75%');
    rate({ reportingBasis: 'iep_goals' });
    html = ReportBlocks.renderBlockAcademicSummary(CID, student(), { termId: TERM });
    expect(html).toContain('No Letter Grade');
    expect(html).toContain('Assessed on IEP goals');
    // Another report prints the letter.
    expect(ReportBlocks.renderBlockAcademicSummary(CID, student(), { termId: 'term-2' })).toContain('B (75%)');
  });
});

describe('saving the reporting basis (shared/data.js)', () => {
  it('sends the basis and the deadline together, and keeps an IE without a deadline on this device', () => {
    expect(_termRatingPatch({ reportingBasis: 'ie', ieDeadline: '2026-12-18' })).toEqual({
      reportingBasis: 'ie',
      ieDeadline: '2026-12-18',
    });
    expect(_termRatingPatch({ reportingBasis: 'ie', ieDeadline: null })).toEqual({});
    expect(_termRatingPatch({ reportingBasis: 'language_goals', ieDeadline: null })).toEqual({
      reportingBasis: 'language_goals',
      ieDeadline: null,
    });
  });

  it('writes reporting_basis and ie_deadline on the wire', async () => {
    const calls = [];
    const was = { getSupabase: globalThis.getSupabase, use: _useSupabase };
    _useSupabase = true;
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name, payload });
        return Promise.resolve({ data: null, error: null });
      },
    });
    try {
      await window.v2.saveTermRating('11111111-1111-1111-1111-111111111111', 1, {
        reportingBasis: 'ie',
        ieDeadline: '2026-12-18',
      });
    } finally {
      globalThis.getSupabase = was.getSupabase;
      _useSupabase = was.use;
    }
    const call = calls.find(c => c.name === 'save_term_rating');
    expect(call.payload.p_payload).toEqual({ reporting_basis: 'ie', ie_deadline: '2026-12-18' });
  });

  it('reads the columns from the class bundle, and keeps this device’s copy when they are missing', () => {
    const ENR = '22222222-2222-2222-2222-222222222222';
    const cid = 'course-bundle-basis';
    _cache.termRatings[cid] = { [ENR]: { 'term-1': { reportingBasis: 'iep_goals', ieDeadline: null } } };
    _applyBundleTermRatings(cid, [{ enrollment_id: ENR, term: 1, narrative_html: 'x' }]);
    expect(getStudentTermRating(cid, ENR, 'term-1')).toMatchObject({ reportingBasis: 'iep_goals', ieDeadline: null });
    _applyBundleTermRatings(cid, [
      { enrollment_id: ENR, term: 1, narrative_html: 'x', reporting_basis: 'ie', ie_deadline: '2026-12-18' },
    ]);
    expect(getStudentTermRating(cid, ENR, 'term-1')).toMatchObject({
      reportingBasis: 'ie',
      ieDeadline: '2026-12-18',
    });
    delete _cache.termRatings[cid];
  });
});

describe('the review screen (teacher/report-questionnaire.js)', () => {
  const RQ = ReportQuestionnaire;
  let hadDoc, oldDoc, btn;
  beforeAll(() => {
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    btn = { disabled: false, title: '' };
    globalThis.document = {
      getElementById: id => (id === 'tq-approve-next' ? btn : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
  });
  function open() {
    RQ.configure({ activeCourse: CID, renderReports: () => {} });
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === NOOR.id);
    return RQ.renderTermQuestionnaire(CID);
  }

  it('shows Letter Grade | IE with the mockup’s line when IE is on offer', () => {
    seed();
    const html = open();
    expect(html).toContain(
      'Only 3 of 8 assignments are marked. You can report IE (Insufficient Evidence) instead of a letter grade.',
    );
    expect(html).toContain('role="radiogroup" aria-label="Report this term as"');
    expect(html).toContain('data-basis="grade"');
    expect(html).toContain('data-basis="ie"');
    expect(html).toContain('title="Report B 75% from the 3 marked assignments."');
    expect(html).not.toContain('qn-required');
  });

  it('chosen IE: the header says IE, the Required rows show, Approve and Next waits for the date', () => {
    seed({ missing: [3] });
    rate({ reportingBasis: 'ie' });
    const html = open();
    expect(html).toContain('<span class="qn-grade-big">IE</span>');
    expect(html).toContain('<span class="qn-grade-sub">Insufficient Evidence</span>');
    expect(html).toContain('An IE comment needs every part marked Required.');
    ['Grade', 'Problem', 'Plan', 'Deadline', 'Meeting'].forEach(l =>
      expect(html).toContain('<span class="qn-req-label">' + l + '</span>'),
    );
    expect((html.match(/>Required</g) || []).length).toBe(5);
    expect(html).toContain('I checked this');
    expect(html).toContain('Pick a Date');
    expect(html).toContain('Approve and Next stays off until you pick a date.');
    const st = RQ.getTqStudents()[RQ.tqStudentIndex];
    expect(RQ.approveBlockers(st)).toEqual(['deadline', 'missing']);
    RQ.syncApprove();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(
      'Saves this comment to the report card and opens the next student. Pick the deadline and tick “I checked this” first.',
    );
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    open();
    expect(RQ.approveBlockers(st)).toEqual(['missing']);
    RQ.tqSetCheck('missing', true);
    expect(RQ.approveBlockers(st)).toEqual([]);
    expect(btn.disabled).toBe(false);
  });

  it('goals: the header says No Letter Grade and the Statement row is Required', () => {
    seed({ noor: [3, 3, 3, 3, 3, 3, 3, 3], designations: ['ELL'] });
    let html = open();
    expect(html).toContain('Noor has an ELL designation.');
    expect(html).toContain('role="radiogroup" aria-label="Assess this student against"');
    expect(html).toContain('>Language Goals<');
    expect(html).toContain('she/her · ELL · ');
    rate({ reportingBasis: 'language_goals' });
    html = open();
    expect(html).toContain('<span class="qn-grade-big">No Letter Grade</span>');
    expect(html).toContain('Assessed on language goals');
    expect(html).toContain('The grade sentence is replaced by the required statement.');
    expect(html).toContain('Required when Language Goals is chosen. Fixed wording; it cannot be reworded.');
    expect(RQ.approveBlockers(RQ.getTqStudents()[RQ.tqStudentIndex])).toEqual([]);
  });

  it('no switch for a student with nothing to offer', () => {
    seed({ noor: [3, 3, 3, 3, 3, 3, 3, 3] });
    const html = open();
    expect(html).not.toContain('qn-basis');
    expect(html).not.toContain('qn-required');
  });

  it('limits the deadline to the school year', () => {
    seed();
    expect(RQ.schoolYear(CID, '2026-10-30')).toEqual({ start: '2026-09-01', end: '2027-06-30' });
    expect(RQ.schoolYear(CID, '2027-02-10')).toEqual({ start: '2026-09-01', end: '2027-06-30' });
    _cache.courseConfigs[CID] = {
      reportingTerms: [
        { ordinal: 1, label: 'Term 1', starts_on: '2026-09-03', ends_on: '2026-11-27' },
        { ordinal: 3, label: 'Term 3', starts_on: '2027-03-01', ends_on: '2027-06-25' },
      ],
    };
    expect(RQ.schoolYear(CID, '2026-10-30')).toEqual({ start: '2026-09-03', end: '2027-06-25' });
  });
});

describe('Demo Mode still drafts (Science 8, a Proficiency class)', () => {
  it('has no IE or goals path', () => {
    const saved = window.isDemoMode;
    window.isDemoMode = () => true;
    try {
      runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
      seedIfNeeded();
      const st = getStudents('sci8')[0];
      const f = CommentBank.facts('sci8', st, 'term-1');
      expect(CommentBank.reportPath(f)).toBe('');
      expect(CommentBank.ieOffered(f)).toBe(false);
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 1 });
      expect(d.ids.filter(id => IE_IDS.indexOf(id) >= 0)).toEqual([]);
    } finally {
      window.isDemoMode = saved;
    }
  });
});
