/**
 * Live-run fixes for the IE and Language Goals paths (bug hunt, live run 2).
 *
 * 1. Ticking a Language Goals line on the reports page saves it for the
 *    class (page-reports.js forwards data-tq-lang), and Generate uses the
 *    picked line on the language-goals path.
 * 2. The Language Goals row stays on the Sentences card once the comment
 *    has sentences, as Support and Closing do.
 * 3. An IE comment written without Generate shows its Required rows with
 *    "I checked this", so Approve and Next can be reached.
 * 5. A saved deadline that has passed, or falls after the school year,
 *    counts as none: Approve and Next stays off with "Pick a deadline from
 *    today to {last school day}.", the Deadline sentence is withheld on
 *    screen, in print and in Generate, and the calendar opens on today's
 *    month with the focus in it.
 * 6. On the IE path with work that has no mark yet, Completes Work is never
 *    filled from the record: only the teacher's ratings print, and verify()
 *    rejects a "completes work on time" claim the record gave.
 * 11. The calendar note names the last day that can be picked, the school
 *    year's ("on or before June 30") in every term; the calendar and
 *    Approve use that one range; the arrow keys in the open calendar never
 *    move to another student.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const RQ = ReportQuestionnaire;
// A class of its own per seed: the screen keeps each comment's rows in memory.
let CID = 'course-ie-goals-fix';
let runs = 0;
const TERM = 'term-1';
const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Khan', pronouns: 'she/her' };
const MAYA = { id: 'stu-maya', firstName: 'Maya', lastName: 'Lopez', pronouns: 'she/her' };
const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

/* History 12, a Letter class: Noor (ELL) has marks on three of eight tasks
   and nothing marked missing; Maya has all eight. */
function seed() {
  CID = 'course-ie-goals-fix-' + ++runs;
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [Object.assign({ designations: ['ELL'] }, NOOR), Object.assign({ designations: [] }, MAYA)];
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
  const row = i => ({
    assessmentId: 'a' + i,
    tagId: i % 2 ? 't2' : 't1',
    score: 3,
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  });
  _cache.scores[CID] = { [NOOR.id]: [0, 1, 2].map(row), [MAYA.id]: [0, 1, 2, 3, 4, 5, 6, 7].map(row) };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.reportConfig[CID] = null;
  localStorage.removeItem('gb-report-config-' + CID);
  clearProfCache();
  els = {};
  btn.disabled = false;
  btn.title = '';
}
const student = () => getStudents(CID).find(s => s.id === NOOR.id);
const factsNow = () => CommentBank.facts(CID, student(), TERM);
const rate = data => upsertTermRating(CID, NOOR.id, TERM, data);
const saved = () => getStudentTermRating(CID, NOOR.id, TERM) || {};
const settings = () => (getReportConfig(CID) || {}).commentSettings || {};
const save = patch =>
  saveReportConfig(CID, { form: { sides: [] }, commentSettings: Object.assign({}, settings(), patch) });
const draftNow = (seedN, picks) =>
  CommentBank.draft(CommentBank.context(factsNow(), picks || {}), { seed: seedN || 1, quiet: true });
function open(sid) {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === (sid || NOOR.id));
  return RQ.renderTermQuestionnaire(CID);
}

/* The reports page's change handler, as written in page-reports.js, run
   with the real questionnaire. */
function studioChange() {
  const src = readFileSync('teacher/page-reports.js', 'utf-8');
  const fn = src.match(/ {2}function _handleStudioChange\(e\) \{[\s\S]*?\n {2}\}\n/);
  expect(fn, '_handleStudioChange in page-reports.js').toBeTruthy();
  // eslint-disable-next-line no-new-func
  return new Function('RQ', fn[0] + '\nreturn _handleStudioChange;')(RQ);
}

let hadDoc, oldDoc, btn, els;
beforeAll(() => {
  // Today is November 1, 2026: the school year runs to June 30, 2027.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T19:00:00Z'));
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  btn = { disabled: false, title: '' };
  els = {};
  globalThis.document = {
    getElementById: id => (id === 'tq-approve-next' ? btn : els[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {} } },
  };
});
afterAll(async () => {
  vi.useRealTimers();
  // Generate's timers (the class warning) run before the page goes.
  await new Promise(r => setTimeout(r, 400));
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
});
beforeEach(() => localStorage.clear());
afterEach(() => {
  delete COURSES[CID];
  clearProfCache();
});

describe('1. Language Goals ticks on the reports page', () => {
  it('a tick reaches the questionnaire and is saved for the class; Generate uses the picked line', () => {
    seed();
    rate({ reportingBasis: 'language_goals' });
    open();
    const change = studioChange();
    change({ target: { dataset: { tqLang: 'lg-reads-aloud' }, checked: true } });
    expect(settings().languageGoalsChosen).toEqual(['lg-reads-aloud']);
    change({ target: { dataset: { tqLang: 'lg-speaks' }, checked: true } });
    change({ target: { dataset: { tqLang: 'lg-speaks' }, checked: false } });
    expect(settings().languageGoalsChosen).toEqual(['lg-reads-aloud']);
    const html = RQ.renderTermQuestionnaire(CID);
    expect(html).not.toContain('No language goal lines chosen for this class.');
    expect(html).toContain('No language goal picked for Noor.');

    RQ.tqLine('pickLang', { dataset: { line: 'lg-reads-aloud' } });
    const d = draftNow(1);
    const got = d.sentences.find(x => x.step === 'languageGoals');
    expect(got && got.text).toBe(
      'She can read a text aloud in English; the next step is answering a question about what it says.',
    );
    expect(d.text).toContain(got.text);
  });
});

describe('2. The Language Goals row once the comment has sentences', () => {
  it('stays among the rows, with Choose…, before Support and Closing', () => {
    seed();
    rate({
      reportingBasis: 'language_goals',
      narrative:
        'This term, Noor is assessed in relation to her goals for English language proficiency. She explains causes and their effects clearly.',
    });
    let html = open();
    expect(html).toContain('id="tq-row-languageGoals"');
    expect(html).toContain('No language goal lines chosen for this class. The comment leaves this sentence out.');
    const lang = html.indexOf('id="tq-row-languageGoals"');
    expect(lang).toBeLessThan(html.indexOf('id="tq-row-closing"'));
    expect(lang).toBeLessThan(html.indexOf('id="tq-row-support"'));
    expect(lang).toBeGreaterThan(html.indexOf('<span class="qn-req-label">Statement</span>'));

    // With a line ticked and picked, the row shows it.
    save({ languageGoalsChosen: ['lg-reads-aloud'], languageGoalsFor: { [TERM]: { [NOOR.id]: 'lg-reads-aloud' } } });
    html = open();
    expect(html).toContain('One of your language goal lines for History 12');
    // Never on the grade path.
    rate({ reportingBasis: 'grade' });
    expect(open()).not.toContain('id="tq-row-languageGoals"');
  });

  it('sits before the Next Step row, never between it and its family line', () => {
    seed();
    // Maya, with all eight tasks marked, gets a Next Step sentence.
    _cache.students[CID].find(x => x.id === MAYA.id).designations = ['ELL'];
    const maya = () => getStudents(CID).find(x => x.id === MAYA.id);
    const mayaFacts = () => CommentBank.facts(CID, maya(), TERM);
    const draftMaya = () => CommentBank.draft(CommentBank.context(mayaFacts(), {}), { seed: 1, quiet: true });
    upsertTermRating(CID, MAYA.id, TERM, { reportingBasis: 'language_goals' });
    const d = draftMaya();
    expect(d.sentences.map(x => x.step)).toContain('nextStep');
    upsertTermRating(CID, MAYA.id, TERM, { narrative: d.text });
    let html = open(MAYA.id);
    const next = () => html.indexOf('<span class="qn-req-label">Next Step</span>');
    expect(next()).toBeGreaterThan(0);
    expect(html.indexOf('id="tq-row-languageGoals"')).toBeGreaterThan(0);
    expect(html.indexOf('id="tq-row-languageGoals"')).toBeLessThan(next());
    // With a line picked, Generate puts it just before the Next Step sentence.
    save({ languageGoalsChosen: ['lg-reads-aloud'], languageGoalsFor: { [TERM]: { [MAYA.id]: 'lg-reads-aloud' } } });
    const g = draftMaya();
    const steps = g.sentences.map(x => x.step);
    expect(steps.indexOf('languageGoals')).toBe(steps.indexOf('nextStep') - 1);
    if (steps.includes('home')) expect(steps.indexOf('home')).toBe(steps.indexOf('nextStep') + 1);
    upsertTermRating(CID, MAYA.id, TERM, { narrative: g.text });
    html = open(MAYA.id);
    expect(html.indexOf('id="tq-row-languageGoals"')).toBeGreaterThan(0);
    expect(html.indexOf('id="tq-row-languageGoals"')).toBeLessThan(next());
  });
});

describe('3. An IE comment written without Generate', () => {
  const TYPED = 'Noor needs more marked work for a grade this term. Please talk with me about a plan.';

  it('shows the Required rows with "I checked this", and Approve and Next follows the tick', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18', narrative: TYPED });
    const html = open();
    ['Grade', 'Problem', 'Plan', 'Deadline', 'Meeting'].forEach(label =>
      expect(html, label).toContain(
        `<span class="qn-req-label">${label}</span><span class="qn-req-chip">Required</span>`,
      ),
    );
    expect(html).toContain('data-tq-check="ie"');
    // The teacher's own sentences are still there.
    expect(html).toContain('Please talk with me about a plan.');
    RQ.syncApprove();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Tick “I checked this” first.');
    RQ.tqSetCheck('ie', true);
    expect(RQ.approveBlockers(student())).toEqual([]);
    expect(btn.disabled).toBe(false);
  });

  it('a generated IE comment keeps a single Problem row', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18', narrative: draftNow(1).text });
    const html = open();
    expect(html.split('<span class="qn-req-label">Problem</span>').length - 1).toBe(1);
    expect(html.split('data-tq-check="ie"').length - 1).toBe(1);
  });
});

describe('3b. A meeting sentence the teacher typed', () => {
  // Not a bank sentence: the teacher's own words.
  const MEET = 'Please call me so we can set up a time to talk.';
  const TYPED = 'Noor needs more marked work for a grade this term. ' + MEET;
  const meetingRows = html => html.split('<span class="qn-req-label">Meeting</span>').length - 1;

  it('matches a short list of phrasings, only on the IE path and only for typed rows', () => {
    const typed = t => RQ.typedRow(t, 1);
    [
      'Please contact me to set a time.',
      'I would like to meet with you about this.',
      'Please call me at school.',
    ].forEach(t => expect(RQ.meetingRowAt([typed('Noor is kind.'), typed(t)], 'ie'), t).toBe(1));
    expect(RQ.meetingRowAt([typed('Noor reads every day.')], 'ie')).toBe(-1);
    expect(RQ.meetingRowAt([typed(MEET)], '')).toBe(-1);
    expect(RQ.meetingRowAt([typed(MEET), { step: 'ieMeeting', text: 'x' }], 'ie')).toBe(-1);
  });

  it('stands for the Meeting row, Written by you, and Generate keeps it instead of adding one', () => {
    seed();
    rate({
      reportingBasis: 'ie',
      ieDeadline: '2026-12-18',
      narrative: TYPED,
      draftMeta: { v: 1, sentences: [], teacher_text: [MEET] },
    });
    let html = open();
    expect(meetingRows(html)).toBe(1);
    expect(html).toMatch(
      /<span class="qn-req-label">Meeting<\/span><span class="qn-req-chip">Required<\/span><\/div>\s*<div class="qn-req-body"><span class="qn-req-text">Please call me so we can set up a time to talk\.<\/span><span class="qn-req-source">Written by you<\/span>/,
    );
    // Generate fills in the other parts around it, never a second Meeting.
    const box = {
      value: TYPED,
      dataset: { cid: CID, term: TERM, sid: NOOR.id },
      style: {},
      scrollHeight: 0,
      focus() {},
      select() {},
      setSelectionRange() {},
    };
    els['tq-narrative'] = box;
    try {
      RQ.tqGenerate();
      const text = box.value;
      expect(text).toContain(MEET);
      expect(text.split(MEET).length - 1).toBe(1);
      const bankMeeting = COMMENT_BANK.sentences.filter(x => x.group === 'IE Meeting');
      const f = factsNow();
      const ctx = CommentBank.context(f, {});
      bankMeeting.forEach(x => expect(text).not.toContain(CommentBank.fill(x, ctx)));
      html = RQ.renderTermQuestionnaire(CID);
      expect(meetingRows(html)).toBe(1);
      expect(html).toContain('Written by you');
    } finally {
      delete els['tq-narrative'];
    }
  });
});

describe('5. A saved deadline that cannot stand', () => {
  const STALE_SENTENCE = d => `Work submitted by ${d} can replace this IE with a grade.`;
  const comment = d =>
    [
      'Noor’s mark this term is IE, which means there is not yet enough evidence for a letter grade.',
      STALE_SENTENCE(d),
      'Please contact me so we can talk about this plan together.',
    ].join(' ');

  [
    ['has passed', '2026-10-15', 'October 15'],
    ['falls after the school year', '2027-08-15', 'August 15'],
  ].forEach(([what, iso, day]) => {
    it(`one that ${what}: Approve and Next off with the plain reason, the sentence withheld`, () => {
      seed();
      expect(CommentBank.deadlineOk(CID, iso)).toBe(false);
      rate({ reportingBasis: 'ie', ieDeadline: iso, narrative: comment(day) });
      const f = factsNow();
      expect(f.grade.ieDeadlineOk).toBe(false);
      // Generate drafts no Deadline sentence until a new date is picked.
      for (let n = 1; n <= 4; n++) {
        const d = draftNow(n);
        expect(
          d.sentences.some(x => x.step === 'ieDeadline'),
          'seed ' + n,
        ).toBe(false);
        expect(d.text).not.toContain(day);
      }
      // On screen and in print the sentence is left out.
      open();
      expect(RQ.shownText(saved())).toBe(
        [
          'Noor’s mark this term is IE, which means there is not yet enough evidence for a letter grade.',
          'Please contact me so we can talk about this plan together.',
        ].join(' '),
      );
      const printed = ReportBlocks.renderBlockTeacherNarrative(CID, student(), { termId: TERM });
      expect(printed).not.toContain(day);
      expect(printed).toContain('Please contact me');
      // The Deadline row asks for a date; Approve and Next says why it is off.
      const html = RQ.renderTermQuestionnaire(CID);
      expect(html).toContain('Pick a Date</button>');
      expect(html).toContain('Pick a deadline from today to June 30.');
      RQ.tqSetCheck('ie', true);
      expect(RQ.approveBlockers(student())).toContain('deadlineRange');
      expect(btn.disabled).toBe(true);
      expect(btn.title).toContain('Pick a deadline from today to June 30.');
    });
  });

  it('the calendar opens on today’s month with days to pick, the focus in it', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-10-15', narrative: comment('October 15') });
    open();
    let focused = null;
    els['tq-cal'] = { focus: () => (focused = 'tq-cal') };
    RQ.tqOpenDeadline();
    expect(focused).toBe('tq-cal');
    const html = RQ.renderTermQuestionnaire(CID);
    expect(html).toContain('<span class="qn-cal-title">November 2026</span>');
    expect(html).toMatch(/data-date="2026-11-02" aria-label="November 2">/);
    expect(html).not.toContain('data-date="2026-10-');
  });

  it('a new date puts the sentence back with that date, and Approve and Next follows', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-10-15', narrative: comment('October 15') });
    open();
    RQ.tqPickDeadline('2026-12-18');
    expect(saved().ieDeadline).toBe('2026-12-18');
    expect(saved().narrative).toContain(STALE_SENTENCE('December 18'));
    expect(saved().narrative).not.toContain('October 15');
    RQ.tqSetCheck('ie', true);
    expect(RQ.approveBlockers(student())).not.toContain('deadlineRange');
    expect(RQ.approveBlockers(student())).not.toContain('deadline');
  });

  it('choosing IE with a stale date waits for a new one', () => {
    seed();
    rate({ reportingBasis: 'grade', ieDeadline: '2026-10-15' });
    open();
    RQ.tqSetBasis('ie');
    expect(RQ.iePending()).toBe(true);
    expect(saved().reportingBasis).toBe('grade');
    RQ.tqCloseDeadline();
  });

  it('withDeadline leaves a comment alone while the date stands', () => {
    const t = comment('December 18');
    expect(CommentBank.withDeadline(t, '2026-12-18')).toBe(t);
    expect(CommentBank.withDeadline(t, '2026-12-18', true)).toBe(t);
    // A date elsewhere, in a sentence that is not about the IE, stays.
    const other = 'Noor presented on October 15. ' + STALE_SENTENCE('October 15');
    expect(CommentBank.withDeadline(other, '2026-10-15', false)).toBe('Noor presented on October 15.');
  });
});

describe('6. Completes Work on a thin IE comment', () => {
  // The sentences that say the student completes work on time: matched on
  // Completes Work at Consistently, or naming it as a strength.
  const onTime = d =>
    d.sentences.filter((x, i) => {
      const pv = d.provenance[i] || {};
      if ((pv.values || {})['when.completes'] === 4) return true;
      // The pipeline's habits as behaviour (Nov 4 2026): Completes Work said
      // as what the student does.
      const said = [pv.values || {}].map(v => [v.habitDoes, v.habitDoes2].join(' '))[0];
      if (/\b(completes|finishes) (his|her|their) work\b/.test(said)) return true;
      return ['habitStrengths', 'strongHabits', 'habitsExcellent'].some(k =>
        ((pv.sources || {})[k] || [])
          .concat(k === 'habitsExcellent' && (pv.values || {})[k] ? ['habit:completes'] : [])
          .includes('habit:completes'),
      );
    });

  it('is never filled from the record while work has no mark yet: no on-time claim', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    const f = factsNow();
    expect(CommentBank.ieProblemOf(f)).toBe('marks');
    // The record alone would say Consistently.
    expect(CommentBank.completesFromRecord(f.record)).toBe(4);
    expect(CommentBank.effectiveHabits(undefined, f.record, f)).toEqual({});
    expect(CommentBank.context(f, {})._habits).toEqual({});
    for (let n = 1; n <= 6; n++) expect(onTime(draftNow(n)), 'seed ' + n).toEqual([]);
    // The screen's habits match: nothing rated, nothing from the record.
    expect(open()).not.toContain('Completes Work rated');
  });

  it('the teacher’s own rating still prints', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    const ctx = CommentBank.context(factsNow(), { habits: { completes: 4 } });
    expect(ctx._habits).toEqual({ completes: 4 });
  });

  it('verify() rejects an on-time claim once only the record could back it', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    // Drafted while the teacher had Completes Work at Consistently.
    const rated = { habits: { completes: 4 } };
    const d = [...Array(12).keys()].map(n => draftNow(n + 1, rated)).find(x => onTime(x).length);
    expect(d, 'a draft that says on time').toBeTruthy();
    expect(CommentBank.verify(d, factsNow(), rated).replaced).toEqual([]);
    // The rating taken away: the record, with work unmarked, cannot say it.
    const v = CommentBank.verify(d, factsNow(), {});
    expect(onTime(v)).toEqual([]);
    const ids = onTime(d).map(x => x.id);
    const failed = v.replaced.filter(r => ids.indexOf(r.sentenceId) >= 0);
    expect(failed.length).toBe(ids.length);
    failed.forEach(r => expect(r.failed.some(c => c === 'habits' || c === 'habitBehaviour')).toBe(true));
  });
});

describe('11. The calendar', () => {
  it('names the school year’s last day in every term, and the calendar and Approve use that range', () => {
    seed();
    rate({ reportingBasis: 'ie' });
    open();
    const was = globalThis.getActiveTerm;
    try {
      [
        { label: 'Term 1', endsOn: '2027-01-26' },
        { label: 'Term 2', endsOn: '2027-06-30' },
      ].forEach(term => {
        globalThis.getActiveTerm = () => term;
        RQ.tqOpenDeadline();
        let html = RQ.renderTermQuestionnaire(CID);
        expect(html, term.label).toContain('<span class="qn-cal-note">Pick a date on or before June 30.</span>');
        expect(html).not.toContain('Pick a date before then.');
        expect(html).not.toContain('January 26.');
        // Today is the first day that can be picked.
        expect(html).toMatch(/data-date="2026-11-01" aria-label="November 1">/);
        for (let m = 0; m < 7; m++) RQ.tqDeadlineMonth(1);
        html = RQ.renderTermQuestionnaire(CID);
        // June 30 can be picked, July 1 is past the range.
        expect(html).toMatch(/data-date="2027-06-30" aria-label="June 30">/);
        expect(html).toContain('data-dir="1" aria-label="Next month" title="Next month" disabled');
        RQ.tqCloseDeadline();
      });
    } finally {
      globalThis.getActiveTerm = was;
    }
    // Approve follows the same range: June 30 stands, July 1 does not;
    // today stands, yesterday does not.
    expect(CommentBank.deadlineOk(CID, '2027-06-30')).toBe(true);
    expect(CommentBank.deadlineOk(CID, '2027-07-01')).toBe(false);
    expect(CommentBank.deadlineOk(CID, '2026-11-01')).toBe(true);
    expect(CommentBank.deadlineOk(CID, '2026-10-31')).toBe(false);
    rate({ ieDeadline: '2027-06-30' });
    RQ.tqSetCheck('ie', true);
    expect(RQ.approveBlockers(student())).not.toContain('deadlineRange');
  });

  it('keeps the arrow keys: no other student, and an IE waiting for its date stays', () => {
    seed();
    open();
    RQ.tqSetBasis('ie');
    expect(RQ.iePending()).toBe(true);
    const at = RQ.tqStudentIndex;
    let stopped = 0;
    let prevented = 0;
    ['ArrowDown', 'ArrowUp'].forEach(key =>
      RQ.handleKey({
        key,
        target: { closest: sel => (sel === '#tq-cal' ? {} : null) },
        preventDefault: () => prevented++,
        stopPropagation: () => stopped++,
      }),
    );
    expect(RQ.tqStudentIndex).toBe(at);
    expect(RQ.iePending()).toBe(true);
    expect(RQ.deadlineOpen()).toBe(true);
    expect(stopped).toBe(2);
    // Outside the calendar the arrows still move between students.
    RQ.tqCloseDeadline();
    RQ.handleKey({ key: 'ArrowDown', target: { closest: () => null }, preventDefault() {} });
    expect(RQ.tqStudentIndex).toBe(at + 1);
  });
});
