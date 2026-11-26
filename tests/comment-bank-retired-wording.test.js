/**
 * Plainer missing-work sentences and year-to-date attendance (Nov 26, slice 3
 * of docs/plans/term-questionnaire-redesign-plan.md).
 *
 * - The new missing-work sentences (m22-m28) and attendance frames
 *   (h79-h90) read as Colin approved them, agree with they/them, and never
 *   say "this term".
 * - The old wordings (m02-m21, h60, h62, h64-h66, h68, h70-h72, h76-h78)
 *   are retired: never offered, never generated, but still found by id, so
 *   a saved comment that holds one reads the same, is not flagged because
 *   of the retirement, and does not turn into the teacher's own sentence.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const THEY = { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' };

const RETIRED_MISSING = Array.from({ length: 20 }, (_, i) => 'm' + String(i + 2).padStart(2, '0'));
const RETIRED_ATTENDANCE = ['h60', 'h62', 'h64', 'h65', 'h66', 'h68', 'h70', 'h71', 'h72', 'h76', 'h77', 'h78'];
const RETIRED_IDS = RETIRED_MISSING.concat(RETIRED_ATTENDANCE);
const NEW_MISSING = ['m22', 'm23', 'm24', 'm25', 'm26', 'm27', 'm28'];
const NEW_ATTENDANCE = Array.from({ length: 12 }, (_, i) => 'h' + (79 + i));

const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const retiredById = id => COMMENT_BANK.retired.find(s => s.id === id);
const nh = (count, titles, groups) => ({ count, titles, groups: groups || [] });

function facts(over) {
  return Object.assign(
    {
      cid: 'cls-retired-wording',
      sid: 'gabriel',
      name: 'Gabriel',
      first: 'Gabriel',
      course: 'History 12',
      family: 'socials',
      pronouns: HE,
      pronounsOnFile: true,
      comps: [],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 0, handed: 0, late: 0, missing: 0 },
      notHandedIn: nh(0, []),
      habits: {},
      overall: 3,
      standing: '',
      letter: '',
      levelText: () => '',
      grade: { mode: 'letter', letter: 'B', pct: 80, next: null, pieces: [] },
      enrolled: '2026-09-03',
      classStart: '2026-09-03',
    },
    over || {},
  );
}
const ctxOf = f => CommentBank.context(f, {});
const fitting = (f, ids) => ids.filter(id => CommentBank.fits(byId(id), ctxOf(f)));
const said = (f, id) => CommentBank.fill(byId(id), ctxOf(f));

describe('the new missing-work sentences', () => {
  const one = facts({ notHandedIn: nh(1, ['Map Quiz']) });
  const two = facts({ notHandedIn: nh(2, ['Map Quiz', 'Poster']) });
  const many = facts({ notHandedIn: nh(4, ['Map Quiz', 'Poster', 'Lab: Heat', 'Essay']) });
  const group = facts({
    notHandedIn: nh(
      15,
      ['Current Events: Week 1', 'Current Events: Week 2', 'Current Events: Week 3'],
      [{ name: 'Current Events', count: 6 }],
    ),
  });

  it('offers each wording for its own case only', () => {
    expect(fitting(one, NEW_MISSING)).toEqual(['m27']);
    expect(fitting(two, NEW_MISSING)).toEqual(['m28']);
    expect(fitting(many, NEW_MISSING)).toEqual(['m22', 'm23', 'm24']);
    expect(fitting(group, NEW_MISSING)).toEqual(['m25', 'm26']);
  });

  it('says them as Colin approved', () => {
    expect(said(one, 'm27')).toBe('He still needs to hand in “Map Quiz.”');
    expect(said(two, 'm28')).toBe('He still needs to hand in “Map Quiz” and “Poster.”');
    expect(said(many, 'm22')).toBe('He has four assignments still to hand in.');
    expect(said(many, 'm23')).toBe('He still needs to hand in four assignments.');
    expect(said(many, 'm24')).toBe('He has not yet handed in four assignments.');
    expect(said(group, 'm25')).toBe(
      'He has 15 assignments still to hand in, including six Current Events assignments.',
    );
    expect(said(group, 'm26')).toBe(
      'He still needs to hand in 15 assignments, including six Current Events assignments.',
    );
  });

  it('agrees with they/them', () => {
    const they = f => Object.assign({}, f, { pronouns: THEY });
    expect(said(they(one), 'm27')).toBe('They still need to hand in “Map Quiz.”');
    expect(said(they(two), 'm28')).toBe('They still need to hand in “Map Quiz” and “Poster.”');
    expect(said(they(many), 'm22')).toBe('They have four assignments still to hand in.');
    expect(said(they(many), 'm23')).toBe('They still need to hand in four assignments.');
    expect(said(they(many), 'm24')).toBe('They have not yet handed in four assignments.');
    expect(said(they(group), 'm26')).toMatch(/^They still need to hand in 15 assignments, including/);
  });

  it('no missing-work or attendance sentence the bank offers says "this term"', () => {
    COMMENT_BANK.sentences
      .filter(s => s.group === 'Not Handed In' || s.group === 'Attendance')
      .forEach(s => expect(s.text, s.id).not.toMatch(/this term/i));
  });

  it('every attendance frame says the year', () => {
    NEW_ATTENDANCE.forEach(id => expect(byId(id).text, id).toMatch(/so far this year/i));
    expect(said(facts({ absent: 2, late: 0 }), 'h82')).toBe(
      'The attendance record shows two classes missed so far this year.',
    );
    // Never more than the plan's 20 words as realised.
    NEW_ATTENDANCE.forEach(id => {
      const f = facts({ absent: 14, late: 12 });
      if (CommentBank.fits(byId(id), ctxOf(f)))
        expect(CommentRealiser.wordCount(said(f, id)), id).toBeLessThanOrEqual(20);
    });
  });

  it('agrees with they/them in every attendance frame', () => {
    const f = facts({ absent: 2, late: 2, pronouns: THEY });
    const got = NEW_ATTENDANCE.filter(id => CommentBank.fits(byId(id), ctxOf(f))).map(id => said(f, id));
    expect(got.length).toBeGreaterThan(2);
    got.forEach(t => expect(t).not.toMatch(/\b(has|was) (been|missed|come|arrived)\b/));
  });

  it('Generate offers them and never a retired sentence, across many seeds', () => {
    const cases = [one, two, many, group].map(f => Object.assign({}, f, { absent: 3, late: 1 }));
    cases.forEach(f => {
      const ctx = ctxOf(f);
      for (let seed = 1; seed <= 25; seed++) {
        const d = CommentBank.draft(ctx, { seed });
        d.ids.forEach(id => expect(RETIRED_IDS, 'seed ' + seed).not.toContain(id));
        d.sentences.forEach(s => expect(s.text, s.id).not.toMatch(/this term/i));
      }
    });
  });
});

describe('the retired wordings', () => {
  it('are out of the bank, kept whole under COMMENT_BANK.retired, and no id is reused', () => {
    RETIRED_IDS.forEach(id => {
      expect(byId(id), id + ' still offered').toBeUndefined();
      const r = retiredById(id);
      expect(r, id + ' not kept').toBeTruthy();
      expect(Array.isArray(r.claims), id).toBe(true);
    });
    // No id is shared between the offered bank and the retired, or among
    // the retired ones this change added.
    const live = new Set(COMMENT_BANK.sentences.map(x => x.id));
    RETIRED_IDS.forEach(id => expect(live.has(id), id).toBe(false));
    expect(new Set(RETIRED_IDS.map(id => COMMENT_BANK.retired.filter(r => r.id === id).length))).toEqual(new Set([1]));
    // The old wordings are as they were written.
    expect(retiredById('m16').text).toBe('The number of assignments not handed in is {missingCount}.');
    expect(retiredById('h62').text).toBe('This term, {he} [has|have] been absent for {absentClasses}.');
    // The new ones took new ids.
    NEW_MISSING.concat(NEW_ATTENDANCE).forEach(id => expect(byId(id), id).toBeTruthy());
  });

  it('are never offered, whatever the facts', () => {
    const f = facts({ absent: 3, late: 1, notHandedIn: nh(2, ['Map Quiz', 'Poster']) });
    const ctx = ctxOf(f);
    CommentBank.parts(ctx, '', { more: { habits: true } }).forEach(p =>
      p.rows.forEach(r => expect(RETIRED_IDS, r.id).not.toContain(r.id)),
    );
  });
});

/* A saved comment that holds a retired sentence. */
describe('a saved comment that holds a retired sentence', () => {
  const RQ = ReportQuestionnaire;
  const CID = 'course-retired-wording';
  const TERM = 'term-1';
  const PRI = { id: 'stu-pri', firstName: 'Priya', lastName: 'Nandi', pronouns: 'she/her' };
  const secs = ['Evidence', 'Perspective', 'Significance'];
  const OLD_NH = 'This term, two assignments are not handed in: “Task 4” and “Task 8.”';
  const OLD_ATT = 'This term, she has been absent for three classes.';
  let hadDoc, oldDoc;

  beforeAll(() => {
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {} } },
    };
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    delete COURSES[CID];
  });
  beforeEach(() => {
    COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
    _cache.students[CID] = [Object.assign({}, PRI)];
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
    const missing = ['a3', 'a7'];
    _cache.scores[CID] = {
      [PRI.id]: _cache.assessments[CID].filter(a => missing.indexOf(a.id) < 0).map(a => ({
        assessmentId: a.id,
        tagId: a.tagIds[0],
        score: 3,
        date: a.date,
      })),
    };
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
    clearProfCache();
  });

  const facts1 = () => CommentBank.facts(CID, PRI, TERM);

  /* Priya's draft with its Not Handed In sentence put back as the old m11
     read, and an attendance sentence as the old h62 read, each with its
     record (values) as the approval kept it. */
  function savedWithRetired() {
    const f = facts1();
    // The year's total is 10; this term's share, which the old sentence said, is 3.
    f.absent = 10;
    f.absentTerm = 3;
    const ctx = CommentBank.context(f, {});
    let seed = 5;
    while (!CommentBank.draft(ctx, { seed }).ids.includes('m01')) seed++;
    const d = CommentBank.draft(ctx, { seed });
    const rows = RQ.rowsFromDraft(d);
    const at = rows.findIndex(r => r.step === 'notHandedIn');
    const old = retiredById('m11');
    const pv = CommentBank.provenanceAs(old, ctx, { missingTitles: '“Task 4” and “Task 8”' });
    rows[at] = Object.assign({}, rows[at], {
      id: 'm11',
      text: OLD_NH,
      drafted: OLD_NH,
      raw: { id: 'm11', part: 'habits', step: 'notHandedIn', text: OLD_NH },
      prov: pv,
      s: old,
    });
    // An attendance sentence the draft did not have, after the Not Handed In one.
    const oldAtt = retiredById('h62');
    const apv = CommentBank.provenanceAs(oldAtt, ctx, { absentClasses: 'three classes' });
    rows.splice(at + 1, 0, {
      id: 'h62',
      step: 'attendance',
      text: OLD_ATT,
      drafted: OLD_ATT,
      edited: false,
      raw: { id: 'h62', part: 'habits', step: 'attendance', text: OLD_ATT },
      prov: apv,
      s: oldAtt,
      classLine: false,
    });
    const text = RQ.composeRows(rows);
    const meta = CommentBank.draftMeta(rows, f, { approvedAt: '2026-10-28T18:00:00.000Z' });
    return { f, ctx, text, meta, rows };
  }

  it('keeps its record: the retired id, its text and its values', () => {
    const { meta } = savedWithRetired();
    const x = meta.sentences.find(s => s.id === 'm11');
    expect(x).toMatchObject({ text: OLD_NH, edited: false, step: 'notHandedIn' });
    expect(x.values.missingTitles).toBe('“Task 4” and “Task 8”');
    expect(meta.sentences.find(s => s.id === 'h62').values.absentClasses).toBe('three classes');
    expect(CommentBank.approvedIds(meta)).toEqual(expect.arrayContaining(['m11', 'h62']));
  });

  it('is not flagged while the marks are as they were', () => {
    const { f, text, meta } = savedWithRetired();
    expect(CommentBank.staleness(meta, f, {}, { text })).toBeNull();
  });

  it('is still flagged when the marks it names really change', () => {
    const { f, text, meta } = savedWithRetired();
    delete _cache.statuses[CID][PRI.id + ':a3'];
    _cache.scores[CID][PRI.id].push({ assessmentId: 'a3', tagId: 't0', score: 4, date: '2026-10-04' });
    clearProfCache();
    const now = CommentBank.facts(CID, PRI, TERM);
    now.absent = f.absent;
    now.absentTerm = f.absentTerm;
    const s = CommentBank.staleness(meta, now, {}, { text });
    expect(s.changes.some(c => c.kind === 'marks' && c.before === OLD_NH)).toBe(true);
    // The retired attendance sentence still holds.
    expect(s.changes.some(c => c.before === OLD_ATT)).toBe(false);
  });

  it('a retired "this term" attendance sentence follows this term\u2019s share, not the year\u2019s total', () => {
    const { f, text, meta } = savedWithRetired();
    const flagged = over => {
      const s = CommentBank.staleness(meta, Object.assign({}, f, over), {}, { text });
      return !!s && s.changes.some(c => c.before === OLD_ATT);
    };
    expect(flagged({})).toBe(false);
    // The year's total moves (more absences since): the old sentence still holds.
    expect(flagged({ absent: 12 })).toBe(false);
    // Its own number changes: flagged.
    expect(flagged({ absentTerm: 4 })).toBe(true);
  });

  it('opens with the same text and the same rows: a bank row, never the teacher’s own sentence', () => {
    const { ctx, text, meta } = savedWithRetired();
    const rows = RQ.recoverRows(text, ctx, Object.assign({ teacher_text: [] }, meta));
    const nhRow = rows.find(r => r.text === OLD_NH);
    const attRow = rows.find(r => r.text === OLD_ATT);
    [nhRow, attRow].forEach(r => {
      expect(r, 'row lost').toBeTruthy();
      expect(r.edited).toBe(false);
      expect(RQ.isTyped(r)).toBe(false);
      expect(r.earlier).toBeFalsy();
      expect(RQ.rowLabel(r, '')).not.toBe('Your Sentence');
    });
    expect(nhRow).toMatchObject({ id: 'm11', step: 'notHandedIn' });
    expect(attRow).toMatchObject({ id: 'h62', step: 'attendance' });
    expect(RQ.composeRows(rows)).toBe(text);
    // Saved again, the record still holds both with their values.
    const again = CommentBank.draftMeta(rows, facts1(), {});
    expect(again.sentences.find(s => s.id === 'm11').values.missingTitles).toBe('“Task 4” and “Task 8”');
  });
});
