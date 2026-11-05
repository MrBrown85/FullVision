/**
 * Marks changed after approval (fullvision-generate-plan PR 12 and Decision
 * 1; the "Marks changed after approval" board of the States mockup).
 *
 * - Each approval keeps what the comment was built from in
 *   term_rating.draft_meta: sentence ids, slot values, the class sentences
 *   used and a hash of the facts.
 * - On a later visit, a sentence whose claimed value changed, or a class
 *   sentence edited since, shows struck through beside the sentence that is
 *   true now, with Keep as Approved or Use the New Sentence; the roster
 *   shows an orange dot in place of the ✓. Approved text is never changed
 *   without the teacher's click.
 * - Next report's Generate leaves out last report's approved sentences.
 * - The Sentences rows recover exactly from the record's ids.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
// A class of its own per test: the screen keeps each comment's rows in
// memory by class, student and report.
let CID = 'course-marks-changed';
let classes = 0;
const TERM = 'term-1';
const PRI = { id: 'stu-pri', firstName: 'Priya', lastName: 'Nandi', pronouns: 'she/her' };
const MAT = { id: 'stu-mat', firstName: 'Mateo', lastName: 'Silva', pronouns: 'he/him' };
const secs = ['Evidence', 'Perspective', 'Significance'];
const CLOSING = 'Thank you for a good start to the year.';
const APPROVED_AT = '2026-10-28T18:00:00.000Z';

let hadDoc, oldDoc, btn, els, annotator, oldAnnotator;
beforeAll(() => {
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  btn = { disabled: false, title: '' };
  globalThis.document = {
    getElementById: id => (id === 'tq-approve-next' ? btn : els[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {} } },
  };
  oldAnnotator = globalThis.setSidebarAnnotator;
  globalThis.setSidebarAnnotator = fn => (annotator = fn);
});
afterAll(() => {
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
  globalThis.setSidebarAnnotator = oldAnnotator;
  for (let i = 1; i <= classes; i++) delete COURSES['course-marks-changed-' + i];
});

/* History 12, ten tasks; Priya has Task 4 and Task 8 labelled Missing. */
function seed() {
  els = {};
  CID = 'course-marks-changed-' + ++classes;
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [Object.assign({}, PRI), Object.assign({}, MAT)];
  _cache.learningMaps[CID] = {
    sections: secs.map((n, i) => ({ id: 'sec' + i, name: n, shortName: n, tags: [{ id: 't' + i, label: n }] })),
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 10 }, (_, i) => ({
    id: 'a' + i,
    title: 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: ['t' + (i % 3)],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  const levels = [4, 3, 3];
  const missing = ['a3', 'a7'];
  const rows = sid =>
    _cache.assessments[CID].filter(a => !(sid === PRI.id && missing.indexOf(a.id) >= 0)).map(a => ({
      assessmentId: a.id,
      tagId: a.tagIds[0],
      score: levels[Number(a.tagIds[0].slice(1))],
      date: a.date,
    }));
  _cache.scores[CID] = { [PRI.id]: rows(PRI.id), [MAT.id]: rows(MAT.id) };
  const st = {};
  missing.forEach(aid => (st[PRI.id + ':' + aid] = 'NS'));
  _cache.statuses[CID] = st;
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.reportConfig[CID] = null;
  localStorage.removeItem('gb-report-config-' + CID);
  saveReportConfig(CID, { commentSettings: { closing: CLOSING } });
  clearProfCache();
}
/* Task 4 is handed in and marked. */
function markTask4() {
  delete _cache.statuses[CID][PRI.id + ':a3'];
  _cache.scores[CID][PRI.id].push({ assessmentId: 'a3', tagId: 't0', score: 4, date: '2026-10-04' });
  clearProfCache();
}
const facts = (termId = TERM) => CommentBank.facts(CID, PRI, termId);
/* Priya's draft (the probe seed gives grade, best piece, strengths, habits,
   not handed in, next step, home, closing) and its rows. */
function drafted() {
  const f = facts();
  const ctx = CommentBank.context(f, {});
  // The first seed from 5 whose draft uses the plan's own Not Handed In
  // sentence (m01) rather than one of its frames (m02-m21), so the record's
  // values can be checked by wording (NH_BEFORE, NH_AFTER).
  let seed = 5;
  while (!CommentBank.draft(ctx, { seed }).ids.includes('m01')) seed++;
  const d = CommentBank.draft(ctx, { seed });
  return { f, ctx, d, rows: RQ.rowsFromDraft(d) };
}
function open(sid) {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === (sid || PRI.id));
  return RQ.renderTermQuestionnaire(CID);
}
/* Priya's comment approved on Oct 28 with its record. */
function approved(edit) {
  const { f, d, rows } = drafted();
  if (edit) edit(rows);
  const text = RQ.composeRows(rows);
  upsertTermRating(CID, PRI.id, TERM, {
    narrative: text,
    approvedAt: APPROVED_AT,
    draftMeta: CommentBank.draftMeta(rows, f, { approvedAt: APPROVED_AT }),
  });
  return { text, d, rows };
}
const rating = () => getStudentTermRating(CID, PRI.id, TERM) || {};

const NH_BEFORE = 'Two assignments are not handed in: “Task 4” and “Task 8.”';
const NH_AFTER = 'One assignment is not handed in: “Task 8.”';

describe('the record kept with an approval (CommentBank.draftMeta)', () => {
  beforeEach(seed);
  it('keeps each sentence’s id, part, step, text and Edited, the slot values, the class sentences used and the facts hash', () => {
    const { f, d, rows } = drafted();
    const meta = CommentBank.draftMeta(rows, f, { approvedAt: APPROVED_AT });
    expect(meta.sentences.map(x => x.id)).toEqual(d.ids);
    expect(meta.sentences.map(x => x.text)).toEqual(d.sentences.map(x => x.text));
    expect(meta.sentences.every(x => x.edited === false && x.part && x.step)).toBe(true);
    const nh = meta.sentences.find(x => x.step === 'notHandedIn');
    expect(nh.values.missingWork).toBe(NH_BEFORE);
    expect(meta.slots.missingWork).toBe(NH_BEFORE);
    expect(meta.class_sentences).toEqual({ closing: CLOSING });
    expect(meta.sentences.find(x => x.step === 'closer')).toMatchObject({ class_line: true, text: CLOSING });
    expect(meta.facts_hash).toBe(CommentBank.factsHash(f));
    expect(meta.facts_hash).toMatch(/^h[0-9a-f]+\.[0-9a-f]+$/);
    expect(meta.approved_at).toBe(APPROVED_AT);
    // The migration's checks: an object, sentences an array, slots and
    // class_sentences objects, facts_hash a string, under 64 KB.
    expect(JSON.stringify(meta).length).toBeLessThan(65536);
  });

  it('nothing is flagged while the facts and the class sentences are as they were', () => {
    const { f, d, rows } = drafted();
    const meta = CommentBank.draftMeta(rows, f);
    expect(CommentBank.staleness(meta, facts(), {}, { text: d.text })).toBeNull();
    expect(CommentBank.staleness(null, f, {})).toBeNull();
    expect(CommentBank.staleness({}, f, {})).toBeNull();
  });

  it('the approved ids for next report leave out edited, class and own sentences', () => {
    const meta = {
      sentences: [
        { id: 'gr01', step: 'grade' },
        { id: 'n36', step: 'example', edited: true },
        { id: 'class:closer', step: 'closer', class_line: true },
        { id: 'text:3', step: null, edited: true },
        { id: 'm01', step: 'notHandedIn' },
      ],
    };
    expect(CommentBank.approvedIds(meta)).toEqual(['gr01', 'm01']);
    expect(CommentBank.approvedIds(null)).toEqual([]);
  });
});

describe('marks changed (CommentBank.staleness)', () => {
  beforeEach(seed);
  it('flags only the sentences whose claimed values changed, with the sentence that is true now', () => {
    const { f, d, rows } = drafted();
    const meta = CommentBank.draftMeta(rows, f);
    markTask4();
    const s = CommentBank.staleness(meta, facts(), {}, { text: d.text });
    expect(s.pieces).toEqual(['Task 4']);
    expect(s.hasGrade).toBe(true);
    const nh = s.changes.find(c => c.before === NH_BEFORE);
    expect(nh).toMatchObject({ kind: 'marks', after: NH_AFTER, id: 'm01' });
    // Every flagged sentence was a bank sentence the record checked; the
    // best piece, the closing and the home sentence still hold.
    const flagged = s.changes.map(c => meta.sentences[c.i].step);
    expect(flagged).toContain('notHandedIn');
    expect(flagged).not.toContain('closer');
    expect(flagged).not.toContain('home');
    expect(flagged).not.toContain('example');
  });

  it('a changed hash with no claimed value changed flags nothing', () => {
    const { f, d, rows } = drafted();
    const meta = CommentBank.draftMeta(rows, f);
    saveTermAttendance(CID, PRI.id, TERM, 2, 1);
    const now = facts();
    expect(CommentBank.factsHash(now)).not.toBe(meta.facts_hash);
    expect(CommentBank.staleness(meta, now, {}, { text: d.text })).toBeNull();
  });

  it('never flags a sentence the teacher edited, or one no longer in the comment', () => {
    const { f, d, rows } = drafted();
    const at = rows.findIndex(r => r.step === 'notHandedIn');
    rows[at] = Object.assign({}, rows[at], { text: 'Task 4 and Task 8 are still to come.', edited: true });
    const meta = CommentBank.draftMeta(rows, f);
    expect(meta.sentences[at]).toMatchObject({ edited: true });
    expect(meta.sentences[at].values).toBeUndefined();
    markTask4();
    const s = CommentBank.staleness(meta, facts(), {});
    // (Nothing else may have moved: null is no card at all.)
    expect(s === null || s.changes.every(c => c.i !== at)).toBe(true);
    // The grade sentence is gone from the saved comment: not shown.
    const text = RQ.composeRows(rows).replace(rows[0].text, '').trim();
    const t = CommentBank.staleness(meta, facts(), {}, { text: text });
    expect(t === null || t.changes.every(c => c.i !== 0)).toBe(true);
    expect(d.text).toContain(NH_BEFORE);
  });

  it('Keep as Approved keeps the sentence for good; the facts become the record’s once none is left', () => {
    const { f, d, rows } = drafted();
    let meta = CommentBank.draftMeta(rows, f);
    markTask4();
    const now = facts();
    let s = CommentBank.staleness(meta, now, {}, { text: d.text });
    const n = s.changes.length;
    s.changes.forEach(c => {
      const left = CommentBank.staleness(meta, now, {}, { text: d.text });
      meta = CommentBank.keepApproved(meta, left.changes[0], left, now);
    });
    expect(meta.sentences.filter(x => x.kept).length).toBe(n);
    expect(meta.facts_hash).toBe(CommentBank.factsHash(now));
    expect(CommentBank.staleness(meta, now, {}, { text: d.text })).toBeNull();
  });
});

describe('a class sentence edited after approval (Decision 1)', () => {
  beforeEach(seed);
  it('flags the closing sentence the comment used, with the new one; Keep as Approved until it changes again', () => {
    const { f, d, rows } = drafted();
    let meta = CommentBank.draftMeta(rows, f);
    saveReportConfig(CID, { commentSettings: { closing: 'Thank you for your hard work this term.' } });
    let s = CommentBank.staleness(meta, facts(), {}, { text: d.text });
    expect(s.changes).toEqual([
      {
        i: meta.sentences.findIndex(x => x.step === 'closer'),
        kind: 'class',
        key: 'closing',
        before: CLOSING,
        after: 'Thank you for your hard work this term.',
      },
    ]);
    expect(s.pieces).toEqual([]);
    meta = CommentBank.keepApproved(meta, s.changes[0], s, facts());
    expect(meta.class_seen).toEqual({ closing: 'Thank you for your hard work this term.' });
    expect(meta.class_sentences).toEqual({ closing: CLOSING });
    expect(CommentBank.staleness(meta, facts(), {}, { text: d.text })).toBeNull();
    saveReportConfig(CID, { commentSettings: { closing: 'See you in January.' } });
    s = CommentBank.staleness(meta, facts(), {}, { text: d.text });
    expect(s.changes[0]).toMatchObject({ before: CLOSING, after: 'See you in January.' });
    // A closing taken away: the sentence that is true now is none.
    saveReportConfig(CID, { commentSettings: { closing: '' } });
    expect(CommentBank.staleness(meta, facts(), {}, { text: d.text }).changes[0].after).toBe('');
  });
});

describe('the note in the Teacher Comment card', () => {
  const m = (n, extra = {}) => Object.assign({ changes: Array.from({ length: n }, () => ({ kind: 'marks' })) }, extra);
  it('names the pieces marked since the approval, as the mockup words it', () => {
    expect(RQ.staleNote(m(1, { pieces: ['Assessing the Treaty of Versailles'] }), 'Oct 28')).toBe(
      '“Assessing the Treaty of Versailles” was marked after Oct 28, so one sentence no longer matches the gradebook. Approved text is never changed for you.',
    );
    expect(RQ.staleNote(m(2, { pieces: ['Task 4', 'Task 8'] }), 'Oct 28')).toBe(
      '“Task 4” and “Task 8” were marked after Oct 28, so two sentences no longer match the gradebook. Approved text is never changed for you.',
    );
    expect(RQ.staleNote(m(3, { pieces: ['A', 'B', 'C'] }), 'Oct 28')).toMatch(
      /^Three assignments were marked after Oct 28, so three sentences/,
    );
    // Nothing was marked since: the note says so without naming a piece.
    expect(RQ.staleNote(m(1, { pieces: [] }), 'Oct 28')).toMatch(/^Grades changed after Oct 28, so one sentence/);
  });
  it('names a class sentence edited since', () => {
    expect(RQ.staleNote({ changes: [{ kind: 'class', key: 'closing' }], pieces: [] }, 'Oct 28')).toBe(
      'The closing sentence changed after Oct 28, so one sentence no longer matches your class settings. Approved text is never changed for you.',
    );
  });
});

describe('the review screen', () => {
  beforeEach(seed);

  it('Approve and Next keeps the record with the approval, from the rows on screen', () => {
    const { d } = drafted();
    upsertTermRating(CID, PRI.id, TERM, { narrative: d.text });
    open();
    RQ.tqSetCheck('missing', true);
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === PRI.id);
    RQ.tqApproveNext();
    const r = rating();
    expect(r.approvedAt).toBeTruthy();
    expect(r.narrative).toBe(d.text);
    expect(r.draftMeta.sentences.map(x => x.id)).toEqual(d.ids);
    expect(r.draftMeta.approved_at).toBe(r.approvedAt);
    expect(r.draftMeta.class_sentences).toEqual({ closing: CLOSING });
  });

  it('after a mark changes: the board, the comment as approved, and an orange dot in the roster', () => {
    const { text } = approved();
    markTask4();
    const html = open();
    expect(rating().narrative).toBe(text);
    expect(rating().approvedAt).toBe(APPROVED_AT);
    expect(html).toMatch(/<span class="qn-approved-chip" id="tq-approved-chip"[^>]*>Approved Oct 28<\/span>/);
    expect(html).toContain(
      '“Task 4” was marked after Oct 28, so ' +
        (CommentBank.staleness(rating().draftMeta, facts(), {}).changes.length === 1
          ? 'one sentence no longer matches'
          : 'two sentences no longer match') +
        ' the gradebook. Approved text is never changed for you.',
    );
    expect(html).toContain(
      `<span class="qn-stale-label">Approved</span><span class="qn-stale-was">${NH_BEFORE}</span>`,
    );
    expect(html).toContain(`<span class="qn-stale-label">Now true</span><span class="qn-stale-now">${NH_AFTER}</span>`);
    expect(html).toContain('>Keep as Approved</button>');
    expect(html).toContain('>Use the New Sentence</button>');
    expect(html).toContain(
      'Using the new sentence clears the approval until you approve again. In the roster, flagged students show an orange dot instead of a ✓.',
    );
    RQ.syncRoster();
    expect(annotator(PRI.id).mark).toContain('class="student-row-mark flag"');
    expect(annotator(PRI.id).mark).toContain('●');
    expect(annotator(PRI.id).sub).toBe('');
    // Mateo is approved with no change: the ✓.
    upsertTermRating(CID, MAT.id, TERM, { narrative: 'Mateo had a steady term.', approvedAt: APPROVED_AT });
    RQ.syncRoster();
    expect(annotator(MAT.id).mark).toContain('✓');
  });

  it('a grade that changed shows in the grade line; one that holds says so', () => {
    approved();
    markTask4();
    const s = CommentBank.staleness(rating().draftMeta, facts(), {});
    const html = open();
    const big = RQ.headerGrade(CID, PRI.id, facts(), TERM).big;
    expect(html).toContain(
      'The grade is now ' + big + '.' + (s.gradeChanged ? '' : ' The grade sentence still holds.') + '</span>',
    );
    // The grade sentence edited by the teacher: never flagged, so it holds.
    seed();
    // (The grade sentence is first or second: the comment's shape.)
    approved(rows => {
      const g = rows.findIndex(r => r.step === 'grade');
      rows[g] = Object.assign({}, rows[g], { text: 'Priya worked hard this term.', edited: true });
    });
    markTask4();
    expect(open()).toContain('The grade sentence still holds.');
  });

  it('Keep as Approved: the comment stays approved and as it was, and the flag goes', () => {
    const { text } = approved();
    markTask4();
    open();
    let s = RQ.staleFor(CID, PRI);
    while (s) {
      RQ.tqStale('keep', 0);
      s = RQ.staleFor(CID, PRI);
    }
    expect(rating().approvedAt).toBe(APPROVED_AT);
    expect(rating().narrative).toBe(text);
    expect(open()).not.toContain('qn-stale');
    RQ.syncRoster();
    expect(annotator(PRI.id).mark).toContain('✓');
  });

  it('Use the New Sentence puts it in place and clears the approval; nothing changes without the click', () => {
    const { text } = approved();
    markTask4();
    open();
    expect(rating().narrative).toBe(text);
    const s = RQ.staleFor(CID, PRI);
    const k = s.changes.findIndex(c => c.before === NH_BEFORE);
    RQ.tqStale('use', k);
    expect(rating().narrative).toBe(text.replace(NH_BEFORE, NH_AFTER));
    expect(rating().approvedAt).toBeNull();
    const html = open();
    expect(html).not.toContain('qn-approved-chip');
    expect(html).not.toContain(NH_BEFORE);
    RQ.syncRoster();
    expect(annotator(PRI.id).sub).toBe('Needs Approval');
  });

  it('an approved comment says Approved on its own screen; a student with no comment says No Comment (Step 4 group 3 #66)', () => {
    const { text } = approved();
    let html = open();
    expect(html).toContain('id="tq-approved-chip"');
    expect(html).toMatch(/>Approved [A-Z][a-z]{2} \d{1,2}<\/span>/);
    RQ.syncRoster();
    expect(annotator(PRI.id).sub).toBe('');
    // Edited: needs approval again, and the chip is gone.
    upsertTermRating(CID, PRI.id, TERM, { narrative: text + ' One more sentence.' });
    html = open();
    expect(html).not.toContain('tq-approved-chip');
    RQ.syncRoster();
    expect(annotator(PRI.id).sub).toBe('Needs Approval');
    // No comment at all: nothing to approve yet.
    upsertTermRating(CID, PRI.id, TERM, { narrative: '' });
    RQ.syncRoster();
    expect(annotator(PRI.id).sub).toBe('No Comment');
  });

  it('a sentence kept as approved stays kept when the comment is approved again', () => {
    approved();
    markTask4();
    open();
    const s = RQ.staleFor(CID, PRI);
    const k = s.changes.findIndex(c => c.before === NH_BEFORE);
    RQ.tqStale('keep', k);
    const left = RQ.staleFor(CID, PRI);
    expect(left === null || left.changes.every(c => c.before !== NH_BEFORE)).toBe(true);
    // Another change used: the approval clears; approving again keeps the Keep.
    if (left) RQ.tqStale('use', 0);
    open();
    RQ.tqSetCheck('missing', true);
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(x => x.id === PRI.id);
    RQ.tqApproveNext();
    expect(rating().approvedAt).toBeTruthy();
    expect(rating().draftMeta.sentences.find(x => x.text === NH_BEFORE)).toMatchObject({ kept: true });
    const again = RQ.staleFor(CID, PRI);
    expect(again === null || again.changes.every(c => c.before !== NH_BEFORE)).toBe(true);
  });

  it('a class sentence kept after an edit stays seen when the comment is approved again', () => {
    approved();
    saveReportConfig(CID, { commentSettings: { closing: 'Thank you for your hard work this term.' } });
    open();
    RQ.tqStale('keep', 0);
    expect(RQ.staleFor(CID, PRI)).toBeNull();
    upsertTermRating(CID, PRI.id, TERM, { approvedAt: null });
    open();
    RQ.tqSetCheck('missing', true);
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(x => x.id === PRI.id);
    RQ.tqApproveNext();
    expect(rating().draftMeta.class_sentences).toEqual({ closing: CLOSING });
    expect(rating().draftMeta.class_seen).toEqual({ closing: 'Thank you for your hard work this term.' });
    expect(RQ.staleFor(CID, PRI)).toBeNull();
  });

  it('a class sentence edited after approval flags the comment and never rewrites it', () => {
    const { text } = approved();
    open();
    RQ.syncRoster();
    expect(annotator(PRI.id).mark).toContain('✓');
    saveReportConfig(CID, { commentSettings: { closing: 'Thank you for your hard work this term.' } });
    const html = open();
    expect(rating().narrative).toBe(text);
    expect(html).toContain(
      'The closing sentence changed after Oct 28, so one sentence no longer matches your class settings.',
    );
    expect(html).toContain('<span class="qn-stale-now">Thank you for your hard work this term.</span>');
    expect(html).not.toContain('The grade is now');
    RQ.syncRoster();
    expect(annotator(PRI.id).mark).toContain('flag');
  });

  it('no record, no flag: a comment approved before records were kept', () => {
    const { d } = drafted();
    upsertTermRating(CID, PRI.id, TERM, { narrative: d.text, approvedAt: APPROVED_AT });
    markTask4();
    const html = open();
    expect(html).not.toContain('qn-stale');
    expect(RQ.staleFor(CID, PRI)).toBeNull();
    RQ.syncRoster();
    expect(annotator(PRI.id).mark).toContain('✓');
  });
});

describe('next report leaves out last report’s approved sentences (draft()’s exclude)', () => {
  beforeEach(seed);
  it('reads the latest earlier approved report’s record', () => {
    approved();
    const ids = CommentBank.approvedIds(rating().draftMeta);
    expect(ids.length).toBeGreaterThan(3);
    expect(RQ.lastTermIds(CID, PRI.id, 'term-2')).toEqual(ids);
    expect(RQ.lastTermIds(CID, PRI.id, 'term-1')).toEqual([]);
    // Report 2 approved without a record: Report 3 has nothing to leave out.
    upsertTermRating(CID, PRI.id, 'term-2', { narrative: 'Priya had a good term.', approvedAt: APPROVED_AT });
    expect(RQ.lastTermIds(CID, PRI.id, 'term-3')).toEqual([]);
    // Not approved: skipped.
    upsertTermRating(CID, PRI.id, 'term-2', { approvedAt: null });
    expect(RQ.lastTermIds(CID, PRI.id, 'term-3')).toEqual(ids);
  });

  it('Generate Comment on Report 2 passes them, and the draft uses none of them where another fits', () => {
    approved();
    const ids = CommentBank.approvedIds(rating().draftMeta);
    const options = [
      { value: 'Report 1', text: 'Report 1' },
      { value: 'Report 2', text: 'Report 2' },
    ];
    els['report-period'] = { value: 'Report 2', options, selectedIndex: 1 };
    els['tq-narrative'] = {
      value: '',
      dataset: { cid: CID, sid: PRI.id, term: 'term-2' },
      style: {},
      focus() {},
      select() {},
    };
    open();
    const real = CommentBank.draft;
    let seen = null;
    let out = null;
    CommentBank.draft = (ctx, opts) => {
      seen = opts.exclude;
      out = real(ctx, opts);
      return out;
    };
    try {
      RQ.tqGenerate();
    } finally {
      CommentBank.draft = real;
    }
    expect(seen).toEqual(ids);
    expect(out.ids.filter(id => ids.indexOf(id) >= 0 && !/^class:/.test(id)).length).toBeLessThan(ids.length);
  });
});

describe('the Sentences rows recover from the record (recoverRows)', () => {
  beforeEach(seed);
  it('takes the record’s ids and Edited marks, where matching the bank alone would not', () => {
    const { f, ctx, rows } = drafted();
    const at = rows.findIndex(r => r.step === 'overall');
    rows[at] = Object.assign({}, rows[at], { text: 'Her source work is careful.', edited: true });
    const meta = CommentBank.draftMeta(rows, f);
    const text = RQ.composeRows(rows);
    const exact = RQ.recoverRows(text, ctx, meta);
    expect(exact.map(r => r.id)).toEqual(meta.sentences.map(x => x.id));
    expect(exact[at]).toMatchObject({ edited: true, step: 'overall', text: 'Her source work is careful.' });
    expect(exact.find(r => r.step === 'closer')).toMatchObject({ classLine: true, id: 'class:closer' });
    // Without the record nothing says the teacher wrote it: the Earlier
    // Comment's, which Generate replaces.
    const guessed = RQ.recoverRows(text, ctx);
    expect(guessed[at]).toMatchObject({ step: null, edited: false, earlier: true });
    // With the record of what they typed (draft_meta.teacher_text), theirs.
    const theirs = RQ.recoverRows(text, ctx, { teacher_text: ['Her source work is careful.'] });
    expect(theirs[at]).toMatchObject({ step: null, edited: true });
    expect(theirs[at].earlier).toBeFalsy();
    // The approved values travel with the row, so a later approval keeps
    // the record of what was claimed.
    const nh = exact.find(r => r.step === 'notHandedIn');
    expect(nh.prov.values.missingWork).toBe(NH_BEFORE);
  });

  it('a sentence not in the record falls back to matching the bank', () => {
    const { f, ctx, d, rows } = drafted();
    const meta = CommentBank.draftMeta(rows.slice(0, 2), f);
    const out = RQ.recoverRows(d.text, ctx, meta);
    expect(out.map(r => r.id)).toEqual(d.ids);
  });
});

describe('saving the record (shared/data.js)', () => {
  it('sends draft_meta with the approval, and a server without the column ignores it', async () => {
    const meta = { sentences: [{ id: 'gr01' }], slots: {}, class_sentences: {}, facts_hash: 'h1.2' };
    expect(_termRatingPatch({ approvedAt: APPROVED_AT, draftMeta: meta })).toEqual({ approved: true, draftMeta: meta });
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
      await window.v2.saveTermRating('11111111-1111-1111-1111-111111111111', 1, { approved: true, draftMeta: meta });
      await window.v2.saveTermRating('11111111-1111-1111-1111-111111111111', 1, { draftMeta: 'bad' });
    } finally {
      globalThis.getSupabase = was.getSupabase;
      _useSupabase = was.use;
    }
    const sent = calls.filter(c => c.name === 'save_term_rating').map(c => c.payload.p_payload);
    expect(sent[0]).toEqual({ approved: true, draft_meta: meta });
    expect(sent[1]).toEqual({ draft_meta: null });
  });

  it('reads draft_meta from the class bundle, and keeps this device’s copy when the column is missing', () => {
    const ENR = '33333333-3333-3333-3333-333333333333';
    const cid = 'course-bundle-meta';
    const mine = { sentences: [{ id: 'gr01' }], facts_hash: 'h1.2' };
    _cache.termRatings[cid] = { [ENR]: { 'term-1': { draftMeta: mine } } };
    _applyBundleTermRatings(cid, [{ enrollment_id: ENR, term: 1, narrative_html: 'x' }]);
    expect(getStudentTermRating(cid, ENR, 'term-1').draftMeta).toEqual(mine);
    const theirs = { sentences: [{ id: 'gr02' }], facts_hash: 'h3.4' };
    _applyBundleTermRatings(cid, [{ enrollment_id: ENR, term: 1, narrative_html: 'x', draft_meta: theirs }]);
    expect(getStudentTermRating(cid, ENR, 'term-1').draftMeta).toEqual(theirs);
    _applyBundleTermRatings(cid, [{ enrollment_id: ENR, term: 1, narrative_html: 'x', draft_meta: null }]);
    expect(getStudentTermRating(cid, ENR, 'term-1').draftMeta).toBeNull();
    delete _cache.termRatings[cid];
  });
});
