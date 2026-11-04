/**
 * The Language Goals list (plan PR 3b; the school's ELL lines adapted,
 * docs/comment-bank-school-codes.md).
 *
 * - FullVision has no language-proficiency facts, so no rule selects a
 *   line: the teacher ticks the lines used in a class and picks one per
 *   student from the Language Goals row; until then the comment leaves
 *   the sentence out.
 * - The lines are templates ({He}, both verb forms), filled for the
 *   student like a bank sentence; each says what the student can do in
 *   English and one next step, never the designation.
 * - The row shows only when the student is assessed on language goals
 *   (reporting_basis 'language_goals'), in the style of the Support row.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const CID = 'course-lang-goals';
const TERM = 'term-1';
const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Khan', pronouns: 'she/her' };
const SAM = { id: 'stu-sam', firstName: 'Sam', lastName: 'Lee' };
const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

function seed(opts) {
  opts = opts || {};
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [
    Object.assign({}, NOOR, { designations: ['ELL'] }),
    Object.assign({}, SAM, { designations: opts.samEll ? ['ELL'] : [] }),
  ];
  _cache.learningMaps[CID] = {
    sections: [section('sec-1', 't1', 'Cause and Consequence'), section('sec-2', 't2', 'Evidence')],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 8 }, (_, i) => ({
    id: 'a' + i,
    title: 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: [i % 2 ? 't2' : 't1'],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  const rows = () =>
    _cache.assessments[CID].map(a => ({ assessmentId: a.id, tagId: a.tagIds[0], score: 3, date: a.date }));
  _cache.scores[CID] = { [NOOR.id]: rows(), [SAM.id]: rows() };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.reportConfig[CID] = null;
  localStorage.removeItem('gb-report-config-' + CID);
  clearProfCache();
}
const student = id => getStudents(CID).find(s => s.id === (id || NOOR.id));
const factsOf = id => CommentBank.facts(CID, student(id), TERM);
const settings = () => (getReportConfig(CID) || {}).commentSettings || {};
const save = patch =>
  saveReportConfig(CID, {
    form: { sides: [] },
    commentSettings: Object.assign({}, settings(), patch),
  });
const draftOf = (f, seedN) => CommentBank.draft(CommentBank.context(f, {}), { seed: seedN || 1 });

let hadDoc, oldDoc, inputs;
beforeAll(() => {
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  inputs = {};
  globalThis.document = {
    getElementById: id => (id === 'tq-approve-next' ? { disabled: false, title: '' } : inputs[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
});
afterAll(() => {
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
  delete COURSES[CID];
});
beforeEach(() => localStorage.clear());
afterEach(() => {
  delete COURSES[CID];
  clearProfCache();
});

function open(sid) {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === (sid || NOOR.id));
  return RQ.renderTermQuestionnaire(CID);
}

describe('the Language Goals lines', () => {
  it('say what the student can do in English and one next step, within 20 words, never the designation', () => {
    expect(CommentBank.LANGUAGE_GOAL_LINES.length).toBeGreaterThanOrEqual(12);
    const ids = new Set();
    CommentBank.LANGUAGE_GOAL_LINES.forEach(l => {
      expect(ids.has(l.id), l.id).toBe(false);
      ids.add(l.id);
      expect(l.text, l.id).toMatch(/^\{(He|His)\}/);
      expect(l.text, l.id).toMatch(/the next step is/);
      expect(l.text, l.id).not.toMatch(/\b(ELL|designation|limited|unable|difficulty|struggles?|requires?)\b/i);
      expect(CommentRealiser.wordCount(CommentLint.plain(l.text)), l.id).toBeLessThanOrEqual(20);
      expect(l.src, l.id).toMatch(/^GHS /);
    });
  });

  it('are listed per class with the teacher’s own, and read from report_config', () => {
    seed();
    const list = CommentBank.languageGoalsChecklist(CID);
    expect(list.length).toBe(CommentBank.LANGUAGE_GOAL_LINES.length);
    expect(list.every(l => !l.on && !l.own)).toBe(true);
    save({
      languageGoalsChosen: ['lg-reads-aloud', 'own-1'],
      languageGoalsOwn: [
        { id: 'own-1', text: '{He} can greet the class in English; the next step is a full sentence.' },
      ],
    });
    const now = CommentBank.languageGoalsChecklist(CID);
    expect(now.find(l => l.id === 'lg-reads-aloud').on).toBe(true);
    expect(now[now.length - 1]).toMatchObject({ id: 'own-1', own: true, on: true });
    expect(CommentBank.classLines(CID, NOOR.id, TERM, 'socials').languageGoals.map(l => l.id)).toEqual([
      'lg-reads-aloud',
      'own-1',
    ]);
  });
});

describe('the line in the comment', () => {
  it('is left out until the teacher picks one, then filled for the student on the language-goals path', () => {
    seed();
    save({ languageGoalsChosen: ['lg-reads-aloud'] });
    upsertTermRating(CID, NOOR.id, TERM, { reportingBasis: 'language_goals' });
    let f = factsOf();
    expect(CommentBank.reportPath(f)).toBe('language_goals');
    expect(CommentBank.languageGoalChoice(f)).toBeNull();
    expect(CommentBank.context(f, {}).languageGoalLine).toBe('');
    expect(draftOf(f).sentences.some(x => x.step === 'languageGoals')).toBe(false);

    save({ languageGoalsFor: { [TERM]: { [NOOR.id]: 'lg-reads-aloud' } } });
    f = factsOf();
    expect(CommentBank.languageGoalChoice(f)).toMatchObject({ line: { id: 'lg-reads-aloud' }, mine: true });
    for (let n = 1; n <= 4; n++) {
      const d = draftOf(f, n);
      const got = d.sentences.find(x => x.step === 'languageGoals');
      expect(got, 'seed ' + n).toMatchObject({ id: 'class:languageGoals', part: 'go', classLine: true });
      expect(got.text).toBe(
        'She can read a text aloud in English; the next step is answering a question about what it says.',
      );
      expect(d.text).toContain(got.text);
      // The comment opens on how Noor is assessed (a Language Goals grade
      // frame, Nov 4 2026), named, with no term in it.
      expect(d.sentences[0]).toMatchObject({ step: 'grade' });
      expect(d.sentences[0].id).toMatch(/^vgg\d\d$/);
      expect(d.sentences[0].text).toMatch(/Noor/);
      expect(d.sentences[0].text).toMatch(/language goals|English language goals|goals for learning English/);
      expect(d.sentences[0].text).not.toMatch(/this term/);
      // Before the support line and the closing, after the next step.
      const steps = d.sentences.map(x => x.step);
      expect(steps.indexOf('languageGoals')).toBeGreaterThan(steps.indexOf('grade'));
      expect(steps.indexOf('languageGoals')).toBeLessThan(
        steps.indexOf('closer') < 0 ? steps.length : steps.indexOf('closer'),
      );
      expect(d.replaced).toEqual([]);
    }
  });

  it('takes they/them for a student with no pronouns on file', () => {
    seed({ samEll: true });
    save({ languageGoalsChosen: ['lg-speaks'], languageGoalsFor: { [TERM]: { [SAM.id]: 'lg-speaks' } } });
    upsertTermRating(CID, SAM.id, TERM, { reportingBasis: 'language_goals' });
    const d = draftOf(factsOf(SAM.id));
    const got = d.sentences.find(x => x.step === 'languageGoals');
    expect(got.text).toBe(
      'They can say new words in English after hearing them; the next step is using them in a sentence.',
    );
  });

  it('never appears on the grade path, even with a pick stored', () => {
    seed();
    save({ languageGoalsChosen: ['lg-reads-aloud'], languageGoalsFor: { [TERM]: { [NOOR.id]: 'lg-reads-aloud' } } });
    const f = factsOf();
    expect(CommentBank.reportPath(f)).toBe('');
    expect(CommentBank.languageGoalChoice(f)).toBeNull();
    expect(draftOf(f).sentences.some(x => x.step === 'languageGoals')).toBe(false);
    expect(draftOf(f).text).not.toContain('read a text aloud');
  });

  it('is a class line: never near-identical, never counted as thin', () => {
    seed();
    save({ languageGoalsChosen: ['lg-reads-aloud'], languageGoalsFor: { [TERM]: { [NOOR.id]: 'lg-reads-aloud' } } });
    upsertTermRating(CID, NOOR.id, TERM, { reportingBasis: 'language_goals' });
    const d = draftOf(factsOf());
    const got = d.sentences.find(x => x.step === 'languageGoals');
    expect(got.classLine).toBe(true);
    const prov = d.provenance.find(p => p.sentenceId === 'class:languageGoals');
    expect(prov).toMatchObject({ claims: [], classLine: true, factKeys: ['class.languageGoals'] });
  });
});

describe('the Language Goals row on the review screen', () => {
  it('shows only for a student assessed on language goals, with the empty state and Choose…', () => {
    seed();
    expect(open()).not.toContain('Language Goals</span>');
    upsertTermRating(CID, NOOR.id, TERM, { reportingBasis: 'language_goals' });
    const html = open();
    expect(html).toContain('<span class="qn-req-label">Language Goals</span>');
    expect(html).toContain('No language goal lines chosen for this class. The comment leaves this sentence out.');
    expect(html).toContain('data-do="langMenu"');
    // The other student, on the grade path, has no such row.
    expect(open(SAM.id)).not.toContain('Language Goals</span>');
  });

  it('ticks lines for the class, writes one, and picks or leaves out a line for one student', () => {
    seed();
    upsertTermRating(CID, NOOR.id, TERM, { reportingBasis: 'language_goals' });
    open();
    RQ.tqLineChange({ dataset: { tqLang: 'lg-reads-aloud' }, checked: true });
    expect(settings().languageGoalsChosen).toEqual(['lg-reads-aloud']);
    let html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('No language goal picked for Noor. The comment leaves this sentence out.');
    expect(html).toContain('>Language Goal ▾</button>');
    RQ.tqLine('langMenu');
    html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('role="menu" aria-label="Language goal lines for History 12"');
    expect(html).toContain('Use for Noor');
    expect(html).toContain('Lines you use in History 12');
    expect(html).toContain(
      'She can read a text aloud in English; the next step is answering a question about what it says.',
    );
    expect(html).toContain('Leave this sentence out');
    expect(html).toContain('+ Write Your Own');
    RQ.tqLine('writeOwnLang');
    inputs['tq-line-own-lang'] = {
      value: '{He} can greet the class in English; the next step is a full sentence.',
      focus() {},
    };
    RQ.tqLine('saveOwnLang');
    delete inputs['tq-line-own-lang'];
    const own = settings().languageGoalsOwn[0];
    expect(own.text).toBe('{He} can greet the class in English; the next step is a full sentence.');
    expect(settings().languageGoalsChosen).toEqual(['lg-reads-aloud', own.id]);
    RQ.tqLine('pickLang', { dataset: { line: own.id } });
    expect(settings().languageGoalsFor[TERM][NOOR.id]).toBe(own.id);
    html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain(
      'She can greet the class in English; the next step is a full sentence.</span><span class="qn-req-source">One of your language goal lines for History 12',
    );
    RQ.tqLine('pickLang', { dataset: { line: 'none' } });
    expect(settings().languageGoalsFor[TERM][NOOR.id]).toBeNull();
    html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('No language goal picked for Noor.');
    // The support row and the closing row are still there, in their style.
    expect(html).toContain('<span class="qn-req-label">Support</span>');
    expect(html).toContain('<span class="qn-req-label">Closing</span>');
  });
});
