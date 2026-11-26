/**
 * The rest of the "this term" sentences say the year (Nov 26, slice 3 of
 * docs/plans/term-questionnaire-redesign-plan.md; Colin: a report is a date
 * and nothing resets). The old wordings are retired by id and still resolve;
 * the five that said marks rose now say "since the last report" and are not
 * offered before Report 1.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const HE = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
const retiredById = id => COMMENT_BANK.retired.find(s => s.id === id);

// [old id, new id, new text]
const CHANGED = [
  ['hl002', 'hl121', 'Every piece of assigned work so far this year was complete and on time.'],
  ['hl005', 'hl122', 'All of {his} assigned work so far this year was finished by the day it was due.'],
  ['hl007', 'hl123', 'Most of {his} work so far this year was complete and done by its due date.'],
  ['hl008', 'hl124', 'So far this year, most tasks were complete by the day they were due.'],
  ['hl010', 'hl125', 'Most of what {he} [was|were] assigned so far this year was finished on time.'],
  ['hl015', 'hl126', 'Part of {his} work is complete and on time, and the aim this year is a plan for each task.'],
  [
    'hl034',
    'hl127',
    '{His} materials are with {him} some days, and the aim this year is a checklist of what to bring.',
  ],
  [
    'hl055',
    'hl128',
    'Working with others is beginning to go well, and the aim this year is a shared plan for each task.',
  ],
  [
    'hl075',
    'hl129',
    'In some lessons {he} [adds|add] to the discussion, and the aim this year is to do that in every lesson.',
  ],
  [
    'hl095',
    'hl130',
    'Using feedback is beginning to show, and the aim this year is to read each comment and make one change.',
  ],
  ['hl115', 'hl131', 'In some lessons {his} screen is on the task, and the aim this year is the same in every lesson.'],
  ['ie02', 'ie39', '{He} [has|have] a mark on {markedMine} of the {markedClass} assignments marked so far this year.'],
  ['ie09', 'ie40', '{He} [has|have] no marks yet on the {markedClass} assignments marked so far this year.'],
  [
    'ie11',
    'ie41',
    'So far this year, {markedClass} assignments have been marked, and {he} [has|have] a mark on {markedMine} of them.',
  ],
  ['ie12', 'ie42', 'Of the {markedClass} assignments marked so far this year, {he} [has|have] a mark on {markedMine}.'],
  ['ie13', 'ie43', '{His} marks cover {markedMine} of the {markedClass} assignments marked so far this year.'],
  [
    'ie14',
    'ie44',
    'So far this year, {markedClass} assignments have been marked, and {he} [has|have] no mark on any of them.',
  ],
  ['ie15', 'ie45', 'Of the {markedClass} assignments marked so far this year, none has a mark for {him}.'],
  [
    'ie16',
    'ie46',
    '{He} [does|do] not yet have a mark on any of the {markedClass} assignments marked so far this year.',
  ],
  ['n411', 'n1030', 'Marks rose since the last report, and {he} can {strengths}.'],
  ['n415', 'n1031', '{He} can {strengths}, and {his} marks rose since the last report.'],
  ['n442', 'n1032', 'Since joining the class this year, {he} [has|have] shown {he} can {strengths}.'],
  ['n871', 'n1033', '{His} marks in the language rose since the last report.'],
  ['n873', 'n1034', 'Marks in the language climbed since the last report.'],
];
// Left as they are: a goal for the rest of the term, and questions to ask at home about the class's work.
const LEFT = ['g202', 'f69', 'f71', 'f89', 'f279', 'f412', 'f496'];

describe('the sentences that said "this term"', () => {
  it('say the year now, under new ids', () => {
    CHANGED.forEach(([old, id, text]) => {
      expect(byId(id), id).toBeTruthy();
      expect(byId(id).text, id).toBe(text);
      expect(byId(old), old + ' still offered').toBeUndefined();
    });
  });

  it('keep the old wording whole under COMMENT_BANK.retired, so a saved comment still resolves by id', () => {
    CHANGED.forEach(([old, id]) => {
      const r = retiredById(old);
      expect(r, old).toBeTruthy();
      expect(r.text, old).toMatch(/this term|the term/i);
      expect(Array.isArray(r.claims), old).toBe(true);
      // The new sentence is the old one with only its time phrase changed.
      const n = byId(id);
      ['part', 'group', 'needs', 'when', 'story', 'claims', 'subjects', 'habit', 'level'].forEach(k =>
        expect(n[k], old + ' ' + k).toEqual(r[k]),
      );
    });
  });

  it('leaves none in the bank that says "this term" about grades, work, skills, habits or attendance', () => {
    const left = COMMENT_BANK.sentences.filter(s => /\bthis term\b|\bover the term\b|\bthe term\b/i.test(s.text));
    expect(left.map(s => s.id).sort()).toEqual(LEFT.slice().sort());
  });

  it('a saved comment holding a retired one is still checked, and reads the same', () => {
    const f = {
      cid: 'cls-year-terms',
      sid: 'g',
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
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: Object.fromEntries(CommentBank.HABITS.map(h => [h.key, 4])),
      overall: 3,
      standing: '',
      letter: '',
      levelText: () => '',
      grade: { mode: 'letter', letter: 'B', pct: 80, next: null, pieces: [] },
      enrolled: '2026-09-03',
      classStart: '2026-09-03',
    };
    const ctx = CommentBank.context(f, {});
    const old = retiredById('hl002');
    const pv = CommentBank.provenanceAs(old, ctx, {});
    const d = {
      sentences: [{ id: 'hl002', part: 'habits', step: 'habits', text: old.text }],
      provenance: [pv],
    };
    const ok = CommentBank.verify(d, f, {});
    expect(ok.replaced).toEqual([]);
    expect(ok.sentences[0].text).toBe('Every piece of assigned work this term was complete and on time.');
    // The habit really changes: flagged, as before the retirement.
    const worse = Object.assign({}, f, { habits: Object.assign({}, f.habits, { completes: 2 }) });
    expect(CommentBank.verify(d, worse, {}).replaced.map(r => r.sentenceId)).toContain('hl002');
  });
});

describe('"since the last report"', () => {
  const climb = ['n1030', 'n1031', 'n1033', 'n1034'];
  const ctxWith = lastReport => ({
    _f: { lastReport },
    climb: 'yes',
    strengths: 'plan a design',
    strength: 'plan a design',
    _p: HE,
    name: 'Gabriel',
  });

  it('is not offered before Report 1, when there is no last report', () => {
    climb.forEach(id => {
      expect(byId(id).text).toMatch(/since the last report/);
      expect(CommentBank.fits(byId(id), ctxWith(null)), id).toBe(false);
    });
  });

  it('is offered once there is a last report', () => {
    const last = { label: 'Term 1', endsOn: '2026-11-01' };
    expect(CommentBank.fits(byId('n1030'), ctxWith(last))).toBe(true);
    expect(CommentBank.fits(byId('n1031'), ctxWith(last))).toBe(true);
  });

  it('a saved comment that holds the old wording is not touched by the gate', () => {
    // verify() reads a sentence with story: false, so the gate does not apply
    // to a saved one, and the retired wordings never said it.
    COMMENT_BANK.retired
      .filter(r => ['n411', 'n415', 'n871', 'n873'].includes(r.id))
      .forEach(r => expect(r.text).not.toMatch(/since the last report/));
  });
});
