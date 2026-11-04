/**
 * At a Glance reads the year so far (Questionnaire glance plan, step 1), on
 * the one year-to-date rule (DECISIONS, Year-to-date grading): facts()
 * counts the competencies, the record and the missing work in the year to
 * date as of the report's end, and names the report before (f.lastReport)
 * as a marker, each competency's level then in c.start when c.since is set.
 * A piece from Term 1 labelled Missing still counts on Report 2, and the
 * comment then says no "this term" about it. Demo Mode, Science 8 from the
 * bank, Cece on Report 2.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
let saved;
const cece = () => getStudents(CID).find(s => s.firstName === 'Cece');
const facts = () => CommentBank.facts(CID, cece(), 'term-2');

beforeAll(() => {
  saved = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  seedIfNeeded();
  setActiveTerm(CID, 2);
});

afterAll(() => {
  setActiveTerm(CID, null);
  window.isDemoMode = saved;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});

/* Labels one of Cece's Term 1 pieces Missing for the test, then puts it back. */
function withTerm1Missing(fn) {
  const a = getAssessments(CID).find(x => x.id === 'sci8a3');
  const st = getAssignmentStatuses(CID);
  const key = cece().id + ':' + a.id;
  const was = st[key];
  st[key] = 'NS';
  clearProfCache();
  try {
    return fn(a);
  } finally {
    if (was) st[key] = was;
    else delete st[key];
    clearProfCache();
  }
}

describe('the year to date, with the last report as a marker', () => {
  it('has all 27 skills, 17 with a level at the Term 1 report', () => {
    const f = facts();
    expect(f.comps).toHaveLength(27);
    expect(f.comps.filter(c => c.since)).toHaveLength(17);
    expect(f.lastReport).toEqual({ label: 'Term 1', endsOn: '2026-07-14' });
  });

  it('reads the year’s levels and pieces, the level at the last report, and the term’s own scores', () => {
    const f = facts();
    const sharing = f.comps.find(x => x.name === 'Sharing Findings');
    expect(sharing.scores).toHaveLength(11);
    expect(formatLevel(CID, sharing.level)).toBe('3.2');
    expect(sharing.since).toBe('Report 1');
    expect(formatLevel(CID, sharing.start)).toBe('2.8');
    expect(sharing.termScores).toHaveLength(5);
    expect(getActiveTerm(CID).ordinal).toBe(2);
  });

  it('is the facts’ one list of competencies', () => {
    const f = facts();
    expect(f.comps).toEqual(CommentBank.compsOf(CID, cece()));
    expect(f.comps.every(c => c.termScores.every(s => s.d >= '2026-07-15'))).toBe(true);
  });

  it('counts the record over the year to date', () => {
    const f = facts();
    expect(f.record.total).toBe(37);
    expect(f.record.missing).toBe(0);
    expect(f.notHandedIn.count).toBe(0);
    expect(f.missingOutsideTerm).toBe(0);
  });

  it('has no earlier report on Report 1', () => {
    setActiveTerm(CID, 1);
    try {
      expect(CommentBank.facts(CID, cece(), 'term-1').lastReport).toBeNull();
    } finally {
      setActiveTerm(CID, 2);
    }
  });
});

describe('missing work so far this year', () => {
  it('a Term 1 piece labelled Missing still counts on Report 2', () =>
    withTerm1Missing(a => {
      const f = facts();
      expect(f.notHandedIn.titles).toEqual([a.title]);
      expect(f.record.missing).toBe(1);
      expect(f.missingOutsideTerm).toBe(1);
      const ctx = CommentBank.context(f, {});
      expect(ctx.missingWork).toBeTruthy();
      expect(ctx.missingTitle).toContain(a.title);
    }));

  it('keeps it in the total as missing, so Completes Work weighs it', () => {
    const before = facts().record;
    withTerm1Missing(() => {
      const rec = facts().record;
      expect(rec.total).toBe(before.total);
      expect(rec.missing).toBe(1);
      expect(rec.handed).toBe(before.handed - 1);
      expect(CommentBank.completesFromRecord(rec)).toBe(2);
    });
    expect(CommentBank.completesFromRecord(before)).toBe(4);
  });

  it('offers no missing-work sentence that says "this term" for it', () =>
    withTerm1Missing(() => {
      const ctx = CommentBank.context(facts(), {});
      const missing = COMMENT_BANK.sentences.filter(s => (s.claims || []).indexOf('notHandedIn') >= 0);
      const thisTerm = missing.filter(s => /\bthis term\b/i.test(s.text));
      expect(thisTerm.length).toBeGreaterThan(0);
      thisTerm.forEach(s => expect(CommentBank.fits(s, ctx), s.id).toBe(false));
      expect(missing.some(s => !/\bthis term\b/i.test(s.text) && CommentBank.fits(s, ctx))).toBe(true);
    }));
});
