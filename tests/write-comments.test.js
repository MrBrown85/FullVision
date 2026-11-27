/* Write Comments (docs/plans/write-comments-plan.md): the comment read back
   from what was typed (decision 8), the student list's reasons (decision 10)
   and the Say This that adds without replacing (decision 5). */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('a typed comment read back into sentences', () => {
  const bank = (id, text, step) => ({ id, step, text, drafted: text, edited: false, raw: null, prov: null, s: null });
  const rows = () => [
    bank('g1', 'Maya has a B in History 12.', 'grade'),
    bank('s1', 'She can explain how one cause led to another.', 'overall'),
    bank('n1', 'Next, she can use a source to back up each claim.', 'nextStep'),
  ];

  it('keeps a sentence left as it was, with its fact', () => {
    const out = RQ.alignRows(
      rows(),
      rows()
        .map(r => r.text)
        .join(' '),
      null,
      true,
    );
    expect(out.map(r => r.id)).toEqual(['g1', 's1', 'n1']);
    expect(out.every(r => !r.edited)).toBe(true);
  });

  it('keeps a reworded sentence in its place, marked Yours (half its words are the old one’s)', () => {
    const text = [
      'Maya has a B in History 12.',
      'She can explain clearly how one cause led to another.',
      'Next, she can use a source to back up each claim.',
    ].join(' ');
    const out = RQ.alignRows(rows(), text, null, true);
    expect(out.map(r => r.id)).toEqual(['g1', 's1', 'n1']);
    expect(out[1].edited).toBe(true);
    expect(out[1].step).toBe('overall');
  });

  it('puts a sentence with nothing in common in Your Sentences, not in the old one’s place', () => {
    const text = [
      'Maya has a B in History 12.',
      'Please call me about the field trip.',
      'Next, she can use a source to back up each claim.',
    ].join(' ');
    const out = RQ.alignRows(rows(), text, null, true);
    expect(out[1].step).toBeNull();
    expect(out[1].edited).toBe(true);
    expect(out.map(r => r.id)[0]).toBe('g1');
    expect(out.length).toBe(3);
  });

  it('follows cut and paste: a moved sentence keeps its fact', () => {
    const r = rows();
    const text = [r[0].text, r[2].text, r[1].text].join(' ');
    const out = RQ.alignRows(r, text, null, true);
    expect(out.map(x => x.id)).toEqual(['g1', 'n1', 's1']);
  });
});

describe('the student list and Say This for a Demo Mode class', () => {
  let cid, saved, hadDoc, oldDoc;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  it('counts no reason for a comment not yet approved; the line under the name still says so', () => {
    const [a, b, c] = RQ.getTqStudents();
    const term = ReportBlocks.getTermId();
    upsertTermRating(cid, a.id, term, { narrative: '', approvedAt: null });
    upsertTermRating(cid, b.id, term, { narrative: 'Hannah had a steady term.', approvedAt: null });
    upsertTermRating(cid, c.id, term, { narrative: 'Sam had a steady term.', approvedAt: '2026-11-01T10:00:00Z' });
    ReportWcLook.reset();
    // Neither is a reason to look: the tick and the line under the name already say so.
    expect(ReportWcLook.reason(a)).toBe('');
    expect(ReportWcLook.reason(b)).toBe('');
    expect(ReportWcLook.basic(a.id)).toBe('No Comment');
    expect(ReportWcLook.basic(b.id)).toBe('Needs Approval');
    expect(ReportWcLook.basic(c.id)).toBe('');
  });

  it('adds a sentence for a skill after the last Strength sentence and takes no other’s place', () => {
    const st = RQ.getTqStudents().find(s => s.firstName === 'Cece');
    RQ.tqStudentIndex = RQ.getTqStudents().indexOf(st);
    const f = CommentBank.facts(cid, st, ReportBlocks.getTermId());
    const ctx = CommentBank.context(f, {});
    const rows = RQ.rowsFromDraft(CommentBank.draft(ctx, { seed: 1 }));
    const boxes = rows.map(r => ReportWcParts.boxOf(r, RQ.bestPiece && false));
    const at = ReportWcParts.insertAt(boxes, 'strength');
    const next = RQ.insertRow(rows, RQ.typedRow('A sentence.', 99), at);
    expect(next.length).toBe(rows.length + 1);
    expect(next.filter(r => r !== next[at])).toEqual(rows);
    // Every row before it is in a box at or before Strength.
    next.slice(0, at).forEach(r => {
      expect(ReportWcParts.rank(ReportWcParts.boxOf(r, false))).toBeLessThanOrEqual(ReportWcParts.rank('strength'));
    });
  });
});
