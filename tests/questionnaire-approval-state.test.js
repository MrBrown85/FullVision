/**
 * Approval and screen state (bug hunt, Nov 1 2026):
 *
 * 1. Approve never saves a sentence whose claim fails today's facts: the
 *    row shows what it says and what is true now, with Use the New
 *    Sentence or Keep as Written, and Approve and Next stays off until each
 *    is chosen. A comment recovered from saved text is checked too, and an
 *    approved one is checked on load even when the facts hash matches.
 * 2. Rows kept in memory never write over a newer saved comment (another
 *    tab or device).
 * 3. The Write Your Own box (and any open menu) never follows the teacher
 *    to another student.
 * 4. IE chosen with no deadline is not saved until a date is picked; then
 *    the basis and the deadline save together.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
let CID = 'course-approval-state';
let classes = 0;
const TERM = 'term-1';
const PRI = { id: 'stu-pri', firstName: 'Priya', lastName: 'Nandi', pronouns: 'she/her' };
const MAT = { id: 'stu-mat', firstName: 'Mateo', lastName: 'Silva', pronouns: 'he/him' };
const secs = ['Evidence', 'Perspective', 'Significance'];
const NH_BEFORE = 'Two assignments are not handed in: “Task 4” and “Task 8.”';
const NH_AFTER = 'One assignment is not handed in: “Task 8.”';
const APPROVED_AT = '2026-10-28T18:00:00.000Z';

let hadDoc, oldDoc, btn, ready, annotator, oldAnnotator;
beforeAll(() => {
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  globalThis.document = {
    getElementById: id => (id === 'tq-approve-next' ? btn : id === 'tq-ready' ? ready : null),
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
  for (let i = 1; i <= classes; i++) delete COURSES['course-approval-state-' + i];
});

/* History 12, ten tasks; Priya has Task 4 and Task 8 labelled Missing. */
function seed() {
  btn = { disabled: false, title: '' };
  ready = { textContent: '' };
  CID = 'course-approval-state-' + ++classes;
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
  clearProfCache();
}
/* Task 4 is handed in and marked. */
function markTask4() {
  delete _cache.statuses[CID][PRI.id + ':a3'];
  _cache.scores[CID][PRI.id].push({ assessmentId: 'a3', tagId: 't0', score: 4, date: '2026-10-04' });
  clearProfCache();
}
const facts = () => CommentBank.facts(CID, PRI, TERM);
const rating = (sid = PRI.id) => getStudentTermRating(CID, sid, TERM) || {};
/* Priya's draft with the plan's own Not Handed In sentence (m01). */
function drafted() {
  const f = facts();
  const ctx = CommentBank.context(f, {});
  let s = 5;
  while (!CommentBank.draft(ctx, { seed: s }).ids.includes('m01')) s++;
  const d = CommentBank.draft(ctx, { seed: s });
  return { f, d, rows: RQ.rowsFromDraft(d) };
}
function open(sid = PRI.id) {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === sid);
  return RQ.renderTermQuestionnaire(CID);
}
const rowOf = text => RQ.recoverRows(text, CommentBank.context(facts(), {}), null);

describe('1. approval checks every bank sentence against today’s marks', () => {
  beforeEach(seed);

  it('rows in memory: a mark changed before Approve keeps it off and shows the row’s change', () => {
    const { d } = drafted();
    upsertTermRating(CID, PRI.id, TERM, { narrative: d.text });
    open(); // rows recovered and kept in memory
    markTask4(); // the teacher marks Task 4 in the gradebook, comes back
    RQ.tqSetCheck('missing', true);
    RQ.tqApproveNext();
    expect(rating().approvedAt).toBeFalsy();
    const st = RQ.getTqStudents()[RQ.tqStudentIndex];
    expect(st.id).toBe(PRI.id);
    expect(RQ.approveBlockers(st)).toContain('claims');
    // The grade moved too (C+ to B): every sentence that no longer holds.
    expect(RQ.claimChanges(st)).toEqual(
      expect.arrayContaining([expect.objectContaining({ before: NH_BEFORE, after: NH_AFTER })]),
    );
    RQ.syncApprove();
    expect(btn.disabled).toBe(true);
    expect(ready.textContent).toBe('Approve and Next is off until you pick Use the New Sentence or Keep as Written.');
    const html = open();
    expect(html).toContain(`<span class="qn-stale-label">Written</span><span class="qn-stale-was">${NH_BEFORE}</span>`);
    expect(html).toContain(`<span class="qn-stale-label">Now true</span><span class="qn-stale-now">${NH_AFTER}</span>`);
    expect(html).toContain('>Keep as Written</button>');
    expect(html).toContain('>Use the New Sentence</button>');
  });

  it('Use the New Sentence puts the true sentence in; the approval then saves it', () => {
    const { d } = drafted();
    upsertTermRating(CID, PRI.id, TERM, { narrative: d.text });
    open();
    markTask4();
    open();
    const st = RQ.getTqStudents()[RQ.tqStudentIndex];
    while (RQ.claimChanges(st).length) RQ.tqClaim('use', String(RQ.claimChanges(st)[0].row));
    expect(rating().narrative).toContain(NH_AFTER);
    expect(rating().narrative).not.toContain(NH_BEFORE);
    expect(RQ.claimChanges(st)).toEqual([]);
    RQ.tqSetCheck('missing', true);
    RQ.tqApproveNext();
    expect(rating().approvedAt).toBeTruthy();
    expect(rating().narrative).toContain(NH_AFTER);
    expect(CommentBank.staleness(rating().draftMeta, facts(), {}, { text: rating().narrative })).toBeNull();
  });

  it('Keep as Written keeps the text; it is the teacher’s and is not flagged after approval', () => {
    const { d } = drafted();
    upsertTermRating(CID, PRI.id, TERM, { narrative: d.text });
    open();
    markTask4();
    open();
    const st = RQ.getTqStudents()[RQ.tqStudentIndex];
    while (RQ.claimChanges(st).length) RQ.tqClaim('keep', String(RQ.claimChanges(st)[0].row));
    expect(RQ.claimChanges(st)).toEqual([]);
    expect(rating().narrative).toBe(d.text);
    RQ.tqSetCheck('missing', true);
    RQ.tqApproveNext();
    expect(rating().approvedAt).toBeTruthy();
    expect(rating().narrative).toContain(NH_BEFORE);
    expect(rating().draftMeta.sentences.find(x => x.text === NH_BEFORE).kept).toBe(true);
    expect(RQ.staleFor(CID, PRI)).toBeNull();
  });

  it('after a reload: a saved bank sentence with old values is a bank row, checked, not Edited', () => {
    const { d } = drafted();
    upsertTermRating(CID, PRI.id, TERM, { narrative: d.text });
    markTask4(); // before this page ever drew the comment
    const rows = rowOf(d.text);
    const nh = rows.find(r => r.text === NH_BEFORE);
    expect(nh.id).toBe('m01');
    expect(nh.edited).toBe(false);
    open();
    const st = RQ.getTqStudents()[RQ.tqStudentIndex];
    expect(RQ.claimChanges(st).map(c => c.before)).toContain(NH_BEFORE);
    RQ.tqSetCheck('missing', true);
    RQ.tqApproveNext();
    expect(rating().approvedAt).toBeFalsy();
  });

  it('a template sentence with other values reads its values back; a real edit stays Edited', () => {
    const s = COMMENT_BANK.sentences.find(x => x.id === 'm01');
    expect(CommentBank.valuesIn(s, NH_BEFORE)).toEqual({ missingWork: NH_BEFORE });
    expect(CommentBank.valuesIn(s, 'Priya worked hard on Task 4.')).toBeNull();
    const edited = RQ.recoverRows(
      'Two assignments are still missing, and I am worried.',
      CommentBank.context(facts(), {}),
      {
        teacher_text: ['Two assignments are still missing, and I am worried.'],
      },
    );
    expect(edited[0].edited).toBe(true);
  });

  it('an approved comment whose stale record has today’s hash is still flagged on load, with the orange dot', () => {
    const { d, rows } = drafted();
    markTask4();
    // The old flow: approved over the stale draft, today's hash stamped on it.
    upsertTermRating(CID, PRI.id, TERM, {
      narrative: d.text,
      approvedAt: APPROVED_AT,
      draftMeta: CommentBank.draftMeta(rows, facts(), { approvedAt: APPROVED_AT }),
    });
    const stale = CommentBank.staleness(rating().draftMeta, facts(), {}, { text: d.text });
    expect(stale.changes.map(c => c.before)).toContain(NH_BEFORE);
    expect(stale.moved).toBe(false);
    const html = open();
    expect(html).toContain(
      (stale.changes.length === 1 ? 'One sentence no longer matches' : 'Two sentences no longer match') +
        ' the gradebook. Approved text is never changed for you.',
    );
    expect(html).toContain('>Keep as Approved</button>');
    RQ.syncRoster();
    expect(annotator(PRI.id).mark).toContain('class="student-row-mark flag"');
    // Approving again waits for Keep as Approved or Use the New Sentence.
    const st = RQ.getTqStudents()[RQ.tqStudentIndex];
    expect(RQ.approveBlockers(st)).toContain('claims');
    RQ.syncApprove();
    expect(ready.textContent).toBe('Approve and Next is off until you pick Keep as Approved or Use the New Sentence.');
  });
});

describe('2. rows in memory never write over a newer saved comment', () => {
  beforeEach(seed);
  it('a comment saved on another device, then ↓ on a row: the new comment is moved, not the old one', () => {
    open();
    upsertTermRating(CID, PRI.id, TERM, { narrative: 'Priya works hard. She asks good questions. She helps others.' });
    open(); // rows recovered and cached
    // Another tab or device saves a new comment; the sync lands it here.
    _cache.termRatings[CID][PRI.id][TERM].narrative = 'Priya wrote a strong essay. She revised it twice.';
    RQ.tqSentences('down', { dataset: { row: '0' } }); // no redraw in between
    let now = rating().narrative;
    expect(now).toBe('Priya wrote a strong essay. She revised it twice.');
    open();
    RQ.tqSentences('down', { dataset: { row: '0' } });
    now = rating().narrative;
    expect(now).toContain('strong essay');
    expect(now).not.toContain('asks good questions');
  });
});

describe('3. nothing open follows the teacher to another student', () => {
  beforeEach(seed);
  it('Write Your Own at a gap on Mateo, then Priya: no box, and Save writes nothing into Priya’s comment', () => {
    upsertTermRating(CID, MAT.id, TERM, { narrative: 'Mateo had a steady term.' });
    upsertTermRating(CID, PRI.id, TERM, { narrative: 'Priya had a strong term.' });
    open(MAT.id);
    RQ.tqSentences('ownOpen', { dataset: { where: 'gap', gap: '1' } });
    RQ.tqSentences('ownInput', { dataset: {}, value: 'Mateo rebuilt his trench model twice.' });
    expect(RQ.ownOpen()).toBe(true);
    RQ.tqSelectStudent(PRI.id); // roster click
    RQ.renderTermQuestionnaire(CID);
    expect(RQ.ownOpen()).toBe(false);
    RQ.tqSentences('ownSave', { dataset: {} });
    expect(rating(PRI.id).narrative).toBe('Priya had a strong term.');
    expect(rating(MAT.id).narrative).toBe('Mateo had a steady term.');
  });
  it('a box opened on one student is never saved into another, even with no redraw between', () => {
    upsertTermRating(CID, MAT.id, TERM, { narrative: 'Mateo had a steady term.' });
    upsertTermRating(CID, PRI.id, TERM, { narrative: 'Priya had a strong term.' });
    open(MAT.id);
    RQ.tqSentences('ownOpen', { dataset: { where: 'gap', gap: '1' } });
    RQ.tqSentences('ownInput', { dataset: {}, value: 'Mateo rebuilt his trench model twice.' });
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === PRI.id);
    RQ.tqSentences('ownSave', { dataset: {} });
    expect(rating(PRI.id).narrative).toBe('Priya had a strong term.');
    expect(RQ.ownOpen()).toBe(false);
  });
});

describe('4. IE with no deadline waits for the date', () => {
  // Noor has marks on 3 of 8 assignments, so IE is on offer.
  const NOOR = { id: 'stu-noor', firstName: 'Noor', lastName: 'Haddad', pronouns: 'she/her' };
  const MAYA = { id: 'stu-maya', firstName: 'Maya', lastName: 'Ortiz', pronouns: 'she/her' };
  function seedIe() {
    btn = { disabled: false, title: '' };
    ready = { textContent: '' };
    CID = 'course-approval-state-' + ++classes;
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
    _cache.students[CID] = [Object.assign({}, NOOR), Object.assign({}, MAYA)];
    _cache.learningMaps[CID] = {
      sections: [
        { id: 's1', name: 'Evidence', shortName: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] },
        { id: 's2', name: 'Perspective', shortName: 'Perspective', tags: [{ id: 't2', label: 'Perspective' }] },
      ],
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
    clearProfCache();
  }
  const noor = () => getStudentTermRating(CID, NOOR.id, TERM) || {};
  beforeEach(seedIe);

  it('IE opens the calendar at once and saves nothing; the switch shows IE waiting', () => {
    upsertTermRating(CID, NOOR.id, TERM, { narrative: 'Noor had a quiet term.' });
    open(NOOR.id);
    expect(RQ.basisChoices(CommentBank.facts(CID, NOOR, TERM)).ie).toBe(true);
    RQ.tqSetBasis('ie');
    expect(noor().reportingBasis || 'grade').toBe('grade');
    expect(noor().ieDeadline || null).toBeNull();
    expect(RQ.iePending()).toBe(true);
    expect(RQ.deadlineOpen()).toBe(true);
    const html = open(NOOR.id);
    expect(html).toContain('class="seg-btn pending" aria-checked="false" data-action="tqSetBasis" data-basis="ie"');
    expect(html).toContain('aria-checked="false" data-action="tqSetBasis" data-basis="grade"');
    expect(html).toContain('Pick the deadline to report IE. Until then the report shows the letter grade.');
    expect(html).toContain('id="tq-cal"');
    // Not on the IE path: no Required rows, no deadline gate.
    expect(CommentBank.reportPath(CommentBank.facts(CID, NOOR, TERM))).toBeFalsy();
  });

  it('cancelling leaves Letter Grade, with nothing saved', () => {
    open(NOOR.id);
    RQ.tqSetBasis('ie');
    RQ.tqCloseDeadline();
    expect(RQ.iePending()).toBe(false);
    expect(RQ.deadlineOpen()).toBe(false);
    expect(noor().reportingBasis || 'grade').toBe('grade');
    const html = open(NOOR.id);
    expect(html).toContain('aria-checked="true" data-action="tqSetBasis" data-basis="grade"');
    expect(html).not.toContain('seg-btn pending');
  });

  it('picking a date saves IE and the deadline together', () => {
    open(NOOR.id);
    RQ.tqSetBasis('ie');
    const day = RQ.schoolYear(CID, '2026-11-01').end;
    RQ.tqPickDeadline(day);
    expect(noor().reportingBasis).toBe('ie');
    expect(noor().ieDeadline).toBe(day);
    expect(RQ.iePending()).toBe(false);
    expect(_termRatingPatch({ reportingBasis: noor().reportingBasis, ieDeadline: noor().ieDeadline })).toEqual({
      reportingBasis: 'ie',
      ieDeadline: day,
    });
  });

  it('a student switch drops the waiting IE', () => {
    open(NOOR.id);
    RQ.tqSetBasis('ie');
    open(MAYA.id);
    expect(RQ.iePending()).toBe(false);
    expect(RQ.deadlineOpen()).toBe(false);
    expect(noor().reportingBasis || 'grade').toBe('grade');
  });
});

describe('1b. a skill chosen among several valid ones is never a false flag', () => {
  // Twelve students with even results on three skills (each on four
  // pieces): the skill an even-results sentence names rotates through the
  // class (least named first), so it is a choice, not a fact.
  const KIDS = Array.from({ length: 12 }, (_, i) => ({
    id: 'stu-even-' + i,
    firstName: ['Ana', 'Ben', 'Cal', 'Dev', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon', 'Kit', 'Lou'][i],
    lastName: 'Even' + String.fromCharCode(65 + i),
    pronouns: i % 2 ? 'he/him' : 'she/her',
  }));
  let LEVELS = [3, 3, 3];
  let SECS = secs;
  function seedEven() {
    btn = { disabled: false, title: '' };
    ready = { textContent: '' };
    CID = 'course-approval-state-' + ++classes;
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
    _cache.students[CID] = KIDS.map(k => Object.assign({}, k));
    _cache.learningMaps[CID] = {
      sections: SECS.map((n, i) => ({ id: 'sec' + i, name: n, shortName: n, tags: [{ id: 't' + i, label: n }] })),
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = Array.from({ length: 4 * SECS.length }, (_, i) => ({
      id: 'a' + i,
      title: 'Task ' + (i + 1),
      scoreMode: 'proficiency',
      tagIds: ['t' + (i % SECS.length)],
      type: 'summative',
      date: '2026-10-' + String((i % 28) + 1).padStart(2, '0'),
    }));
    _cache.scores[CID] = {};
    KIDS.forEach(k => {
      _cache.scores[CID][k.id] = _cache.assessments[CID].map(a => ({
        assessmentId: a.id,
        tagId: a.tagIds[0],
        score: LEVELS[Number(a.tagIds[0].slice(1))],
        date: a.date,
      }));
    });
    _cache.statuses[CID] = {};
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = {};
    _cache.observations[CID] = {};
    _cache.reflections[CID] = {};
    _cache.termRatings[CID] = {};
    _cache.reportConfig[CID] = null;
    clearProfCache();
  }
  /* Each student's comment drafted in turn and saved, as Generate does;
     then the page reloads: the class's comments come back with no session
     tally of the skills named (the same class under a new id here). */
  function draftClass() {
    KIDS.forEach((k, n) => {
      const f = CommentBank.facts(CID, k, TERM);
      const d = CommentBank.draft(CommentBank.context(f, {}), { seed: 7 + n });
      upsertTermRating(CID, k.id, TERM, { narrative: d.text });
    });
    const was = CID;
    seedEven();
    KIDS.forEach(k =>
      upsertTermRating(CID, k.id, TERM, { narrative: getStudentTermRating(was, k.id, TERM).narrative }),
    );
  }
  // The pipeline (Nov 4 2026) names one even skill at its level
  // ({strengthAt}), the one the fewest classmates were given.
  const evenNamed = () =>
    KIDS.filter(k => {
      const f = CommentBank.facts(CID, k, TERM);
      const ctx = CommentBank.context(f, {});
      return RQ.recoverRows(rating(k.id).narrative, ctx, null).some(
        r => r.prov && r.prov.values && r.prov.values.strengthAt,
      );
    });
  /* The checks after a reload: every comment's rows recovered from its
     saved text and checked against today's facts. */
  const flagged = () =>
    KIDS.filter(k => {
      open(k.id);
      return RQ.claimChanges(k).length > 0;
    }).map(k => k.id);

  beforeEach(() => {
    LEVELS = [3, 3, 3];
    SECS = secs;
    seedEven();
  });

  it('drafted, nothing changed, checked again after a reload: no flags', () => {
    draftClass();
    // The rotation named different skills, so the check sees choices.
    expect(evenNamed().length).toBeGreaterThan(1);

    expect(flagged()).toEqual([]);
  });

  it('a tie at the top (one of the tie named, by rotation): no flags after a reload', () => {
    // Three skills tied at Extending, one well below (the next step).
    LEVELS = [4, 4, 4, 2];
    SECS = secs.concat('Continuity and Change');
    seedEven();
    draftClass();
    const tieNamed = KIDS.filter(k => {
      const ctx = CommentBank.context(CommentBank.facts(CID, k, TERM), {});
      return RQ.recoverRows(rating(k.id).narrative, ctx, null).some(r => r.prov && r.prov.values.strengthAt);
    });
    expect(tieNamed.length).toBeGreaterThan(1);

    expect(flagged()).toEqual([]);
  });

  it('a competency lowered so the named skill is no longer even: that comment flags', () => {
    draftClass();
    const k = evenNamed()[0];
    const f = CommentBank.facts(CID, k, TERM);
    const ctx = CommentBank.context(f, {});
    const row = RQ.recoverRows(rating(k.id).narrative, ctx, null).find(r => r.prov && r.prov.values.strengthAt);
    const id = row.prov.sources.strengthAt[0].slice('comp:'.length);
    const named = (ctx._strengthRoutes || []).find(x => String(x.comp.id) === id);
    expect(named).toBeTruthy();
    // Every piece of that competency marked down a whole step.
    _cache.scores[CID][k.id].forEach(e => {
      if (_cache.assessments[CID].find(a => a.id === e.assessmentId).tagIds[0] === 't' + secs.indexOf(named.comp.name))
        e.score = 1;
    });
    clearProfCache();
    expect(flagged()).toEqual([k.id]);
  });
});
