/**
 * The IE deadline is withheld until a date is picked (Colin, Nov 2).
 *
 * - Generate never drafts a Deadline sentence while ie_deadline is empty;
 *   no "[date]" reaches the comment, the copy or the printed report, and
 *   verify() fails a deadline sentence without a real date.
 * - The Deadline row stays on the Sentences card, Required, with Pick a
 *   Date in place of a sentence; Approve and Next stays off.
 * - Picking a date puts the sentence in at its place (after Plan, before
 *   Meeting); a new date replaces the date in that sentence only. There
 *   is no Clear Date control.
 * - A comment saved with "[date]" and not approved is shown without that
 *   sentence while no date is picked, and with the date once one is.
 *   Nothing is written on load; the cleaned text is saved the next time
 *   the teacher edits, generates, picks a date or approves. An approved
 *   comment is never changed.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The deadlines below fall in this school year: today is pinned to
// November 1, 2026 (a saved deadline that has passed counts as none).
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T19:00:00Z'));
});
afterAll(() => vi.useRealTimers());

const RQ = ReportQuestionnaire;
// A class of its own per seed: the screen keeps each comment's rows in memory.
let CID = 'course-ie-deadline';
let runs = 0;
const TERM = 'term-1';
const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Khan', pronouns: 'she/her' };
const MAYA = { id: 'stu-maya', firstName: 'Maya', lastName: 'Lopez', pronouns: 'she/her' };
const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

/* History 12, a Letter class: Noor has marks on three of eight tasks. */
function seed() {
  CID = 'course-ie-deadline-' + ++runs;
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [Object.assign({ designations: [] }, NOOR), Object.assign({ designations: [] }, MAYA)];
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
  clearProfCache();
}
const student = () => getStudents(CID).find(s => s.id === NOOR.id);
const factsNow = () => CommentBank.facts(CID, student(), TERM);
const rate = data => upsertTermRating(CID, NOOR.id, TERM, data);
const saved = () => getStudentTermRating(CID, NOOR.id, TERM) || {};
const draftNow = seedN => CommentBank.draft(CommentBank.context(factsNow(), {}), { seed: seedN || 1, quiet: true });
const stepText = (d, step) => (d.sentences.find(x => x.step === step) || {}).text || '';
const DEADLINE_IDS = COMMENT_BANK.sentences.filter(s => s.group === 'IE Deadline').map(s => s.id);

beforeEach(() => localStorage.clear());
afterEach(() => {
  delete COURSES[CID];
  clearProfCache();
});

describe('Generate withholds the deadline until a date is picked', () => {
  it('drafts no Deadline sentence and no [date] while ie_deadline is empty, in any seed', () => {
    seed();
    rate({ reportingBasis: 'ie' });
    for (let n = 1; n <= 8; n++) {
      const d = draftNow(n);
      expect(
        d.sentences.some(x => x.step === 'ieDeadline'),
        'seed ' + n,
      ).toBe(false);
      expect(
        d.ids.filter(id => DEADLINE_IDS.indexOf(id) >= 0),
        'seed ' + n,
      ).toEqual([]);
      expect(d.text, 'seed ' + n).not.toContain('[date]');
      expect(d.replaced, 'seed ' + n).toEqual([]);
    }
    // The Required part has no sentence until then.
    const parts = CommentBank.requiredParts(CommentBank.context(factsNow(), {}));
    expect(parts.find(p => p.key === 'ieDeadline')).toMatchObject({ id: null, text: '' });
  });

  it('with a date picked, drafts the Deadline sentence between the Plan and the Meeting', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    for (let n = 1; n <= 4; n++) {
      const d = draftNow(n);
      const steps = d.sentences.map(x => x.step);
      expect(stepText(d, 'ieDeadline'), 'seed ' + n).toContain('December 18');
      expect(steps.indexOf('ieDeadline'), 'seed ' + n).toBe(steps.indexOf('iePlan') + 1);
      expect(steps.indexOf('ieDeadline'), 'seed ' + n).toBeLessThan(steps.indexOf('ieMeeting'));
    }
  });

  it('verify drops a deadline sentence once the date is cleared, with no stand-in', () => {
    seed();
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    const d = draftNow(1);
    rate({ reportingBasis: 'ie', ieDeadline: null });
    const v = CommentBank.verify(d, factsNow(), {});
    expect(v.sentences.some(x => x.step === 'ieDeadline')).toBe(false);
    expect(v.text).not.toContain('December 18');
    expect(v.replaced).toEqual([expect.objectContaining({ failed: expect.arrayContaining(['deadline']), by: null })]);
  });
});

describe('withDeadline: the old [date] placeholder', () => {
  const W = CommentBank.withDeadline;
  const A = 'Noor’s mark this term is IE.';
  const B = 'The deadline to replace this IE with a grade is [date].';
  const C = 'Please contact me so we can talk about this plan together.';

  it('takes out each sentence that says [date] while no date is picked, wherever it is', () => {
    expect(W([A, B, C].join(' '), null)).toBe([A, C].join(' '));
    expect(W([A, C, B].join(' '), '')).toBe([A, C].join(' '));
    expect(W([B, A].join(' '), null)).toBe(A);
    expect(W(A + '\n\n' + B + ' ' + C, null)).toBe(A + '\n\n' + C);
  });

  it('says the date once one is picked, and leaves a comment without [date] as it is', () => {
    expect(W([A, B, C].join(' '), '2026-12-18')).toBe(
      [A, 'The deadline to replace this IE with a grade is December 18.', C].join(' '),
    );
    expect(W([A, C].join(' '), null)).toBe([A, C].join(' '));
    expect(W('', null)).toBe('');
  });

  it('never prints [date] on the report card', () => {
    seed();
    rate({ reportingBasis: 'ie', narrative: [A, B, C].join(' ') });
    const html = ReportBlocks.renderReportBlock('teacher-narrative', CID, student(), { termId: TERM });
    expect(html).not.toContain('[date]');
    expect(html).toContain(A + ' ' + C);
    rate({ reportingBasis: 'ie', ieDeadline: '2026-12-18' });
    expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, student(), { termId: TERM })).toContain(
      'is December 18.',
    );
    // An approved comment prints as approved.
    rate({ reportingBasis: 'ie', ieDeadline: null, approvedAt: '2026-10-30T10:00:00Z' });
    expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, student(), { termId: TERM })).toContain(B);
  });

  it('the Term Comment card prints what the report card prints', () => {
    seed();
    const card = () => ReportFeedback.termComment(CID, student(), TERM);
    rate({ reportingBasis: 'ie', narrative: [A, B, C].join(' ') });
    expect(card()).toBe(A + ' ' + C);
    // A deadline that has passed is left out the same way.
    const passed = 'The deadline to replace this IE with a grade is October 20.';
    rate({ reportingBasis: 'ie', ieDeadline: '2026-10-20', narrative: [A, passed, C].join(' ') });
    expect(ReportBlocks.renderReportBlock('teacher-narrative', CID, student(), { termId: TERM })).not.toContain(
      'October 20',
    );
    expect(card()).toBe(A + ' ' + C);
    // An approved comment prints as approved.
    rate({
      reportingBasis: 'ie',
      ieDeadline: null,
      approvedAt: '2026-10-30T10:00:00Z',
      narrative: [A, B, C].join(' '),
    });
    expect(card()).toBe([A, B, C].join(' '));
  });
});

describe('the Deadline row and the calendar (teacher/report-questionnaire.js)', () => {
  let hadDoc, oldDoc, btn, savedToday;
  beforeAll(() => {
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    btn = { disabled: false, title: '' };
    globalThis.document = {
      getElementById: id => (id === 'tq-approve-next' ? btn : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    savedToday = globalThis.courseToday;
    globalThis.courseToday = () => '2026-11-02';
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    globalThis.courseToday = savedToday;
  });
  function open() {
    RQ.configure({ activeCourse: CID, renderReports: () => {} });
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === NOOR.id);
    return RQ.renderTermQuestionnaire(CID);
  }
  /* The Sentences card's rows in order, as their labels. */
  const labels = html =>
    (html.match(/<span class="qn-req-label">[^<]*<\/span>/g) || []).map(x => x.replace(/<[^>]+>/g, ''));
  /* The Deadline row's HTML. */
  const deadlineRow = html => {
    const at = html.indexOf('<span class="qn-req-label">Deadline</span>');
    const end = html.indexOf('<div class="qn-req-row', at);
    return at < 0 ? '' : html.slice(at, end < 0 ? undefined : end);
  };
  /* A comment as Generate writes it with no date picked. */
  function withComment() {
    seed();
    rate({ reportingBasis: 'ie' });
    const d = draftNow(1);
    rate({ narrative: d.text });
    return d;
  }

  it('keeps the Deadline row, Required, with Pick a Date in place of a sentence; Approve and Next stays off', () => {
    const d = withComment();
    const html = open();
    expect(saved().narrative).toBe(d.text);
    const order = labels(html);
    expect(order.indexOf('Deadline')).toBe(order.indexOf('Plan') + 1);
    expect(order.indexOf('Deadline')).toBeLessThan(order.indexOf('Meeting'));
    const row = deadlineRow(html);
    expect(row).toContain('<span class="qn-req-chip">Required</span>');
    expect(row).toContain('Pick a Date');
    expect(row).toContain('Approve and Next stays off until you pick a date.');
    expect(row).not.toContain('qn-req-text');
    expect(html).not.toContain('[date]');
    expect(RQ.approveBlockers(RQ.getTqStudents()[RQ.tqStudentIndex])).toContain('deadline');
  });

  it('picking a date puts the sentence in after the Plan; a new date replaces only that date; no Clear Date', () => {
    const d = withComment();
    const plan = stepText(d, 'iePlan');
    const meeting = stepText(d, 'ieMeeting');
    // A date the teacher typed in a sentence of their own is never changed.
    const own = 'The next test is December 18.';
    rate({ narrative: d.text + ' ' + own });
    open();
    RQ.tqPickDeadline('2026-12-18');
    let text = saved().narrative;
    expect(saved().ieDeadline).toBe('2026-12-18');
    expect(text).not.toContain('[date]');
    const sentence = RQ.deadlineSentence(text, 'December 18', null, null);
    expect(sentence).toMatch(/December 18/);
    expect(sentence).not.toBe(own);
    expect(text.indexOf(plan)).toBeLessThan(text.indexOf(sentence));
    expect(text.indexOf(sentence)).toBeLessThan(text.indexOf(meeting));
    expect(text).toBe(d.text.replace(meeting, sentence + ' ' + meeting) + ' ' + own);
    let html = open();
    expect(deadlineRow(html)).toContain('qn-req-text');
    expect(deadlineRow(html)).toContain('December 18');

    RQ.tqPickDeadline('2027-01-08');
    text = saved().narrative;
    expect(text).toContain(sentence.replace('December 18', 'January 8'));
    expect(text).toContain(own);
    expect(text.replace(sentence.replace('December 18', 'January 8'), sentence)).toBe(
      d.text.replace(meeting, sentence + ' ' + meeting) + ' ' + own,
    );

    // No Clear Date: the calendar only picks a date.
    RQ.tqOpenDeadline();
    html = open();
    expect(html).toContain('id="tq-cal"');
    expect(html).not.toContain('Clear Date');
    expect(html).not.toContain('tqClearDeadline');
    expect(RQ.tqClearDeadline).toBeUndefined();
    RQ.tqCloseDeadline();
  });

  it('before Generate, the Required rows show the Deadline row with no sentence', () => {
    seed();
    rate({ reportingBasis: 'ie' });
    const html = open();
    const row = deadlineRow(html);
    expect(row).toContain('Pick a Date');
    expect(row).not.toContain('qn-req-text');
    // Nothing to put the sentence in yet: picking only saves the date.
    RQ.tqPickDeadline('2026-12-18');
    expect(saved()).toMatchObject({ ieDeadline: '2026-12-18' });
    expect(saved().narrative || '').toBe('');
  });

  /* A comment saved before Nov 2 with the old [date] sentence after the Plan. */
  function withLegacy(extra) {
    const d = withComment();
    const plan = stepText(d, 'iePlan');
    const legacy = d.text.replace(plan, plan + ' The deadline to replace this IE with a grade is [date].');
    rate(Object.assign({ narrative: legacy }, extra || {}));
    return { d, legacy };
  }
  const box = html => {
    const m = html.match(/<textarea id="tq-narrative"[^>]*>([^<]*)<\/textarea>/);
    return m
      ? m[1]
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
      : null;
  };

  it('a saved [date] comment, not approved: shown without the sentence, nothing written on load', () => {
    const { d, legacy } = withLegacy();
    const before = JSON.stringify(saved());
    const html = open();
    expect(box(html)).toBe(d.text);
    expect(html).not.toContain('[date]');
    expect(RQ.shownText(saved())).toBe(d.text);
    // Nothing saved by loading.
    expect(JSON.stringify(saved())).toBe(before);
    expect(saved().narrative).toBe(legacy);
  });

  it('a saved [date] comment with a date picked is shown saying the date, still not written', () => {
    const { legacy } = withLegacy({ ieDeadline: '2026-12-18' });
    const html = open();
    expect(box(html)).toBe(legacy.replace('[date]', 'December 18'));
    expect(saved().narrative).toBe(legacy);
  });

  it('the cleaned text is saved when the teacher picks a date: the sentence goes in once, at its place', () => {
    const { d } = withLegacy();
    open();
    RQ.tqPickDeadline('2026-12-18');
    const text = saved().narrative;
    expect(text).not.toContain('[date]');
    const sentence = RQ.deadlineSentence(text, 'December 18', null, null);
    expect(text).toBe(d.text.replace(stepText(d, 'ieMeeting'), sentence + ' ' + stepText(d, 'ieMeeting')));
  });

  it('the cleaned text is saved when the teacher edits: the box is what is saved', () => {
    const { d } = withLegacy();
    const html = open();
    const el = { value: box(html), dataset: { cid: CID, sid: NOOR.id, term: TERM } };
    const doc = globalThis.document;
    globalThis.document = Object.assign({}, doc, {
      body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
      getElementById: id => (id === 'tq-narrative' ? el : doc.getElementById(id)),
    });
    try {
      RQ.tqSaveNarrative();
      expect(saved().narrative).toBe(d.text);
    } finally {
      globalThis.document = doc;
    }
  });

  it('an approved comment is never changed, on screen or saved', () => {
    const { legacy } = withLegacy({ approvedAt: '2026-10-30T10:00:00Z' });
    const html = open();
    expect(box(html)).toBe(legacy);
    expect(saved().narrative).toBe(legacy);
    expect(saved().approvedAt).toBe('2026-10-30T10:00:00Z');
    expect(RQ.shownText(saved())).toBe(legacy);
  });

  it('deadlineAt: after the Plan, else before Support, Meeting or Closing, else last', () => {
    const r = steps => steps.map(step => ({ step }));
    expect(RQ.deadlineAt(r(['grade', 'ieProblem', 'iePlan', 'support', 'ieMeeting']))).toBe(3);
    expect(RQ.deadlineAt(r(['grade', 'ieProblem', 'ieMeeting', 'closer']))).toBe(2);
    expect(RQ.deadlineAt(r(['grade', 'ieProblem', 'support', 'ieMeeting']))).toBe(2);
    expect(RQ.deadlineAt(r(['grade', 'ieProblem']))).toBe(2);
  });
});
