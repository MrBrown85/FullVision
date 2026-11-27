/* Write Comments draws one box per part (docs/plans/write-comments-plan.md,
   decisions 3 to 6): each starts closed but Work Habits, a closed box is its
   row with its main fact and a chip for the sentences it has in the comment,
   an open box shows every fact, and a sentence the comment says sits under
   its fact. The plain functions about a comment are ReportWcParts'. */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;
const P = ReportWcParts;

describe('ReportWcParts', () => {
  it('has the boxes in the plan’s order', () => {
    expect(P.BOXES.map(b => b.label)).toEqual([
      'Grade',
      'Best Piece',
      'Strength',
      'Work Habits',
      'Attendance',
      'Voice',
      'Observations',
      'Missing Work',
      'Next Step',
      'For the Class',
      'Your Sentences',
    ]);
  });

  it('puts a row in the box of its step: the best piece, the student’s words, a class line, a typed sentence', () => {
    expect(P.boxOf({ step: 'grade' }, false)).toBe('grade');
    expect(P.boxOf({ step: 'example' }, true)).toBe('best');
    expect(P.boxOf({ step: 'example', s: { group: "In the Student's Words" } }, false)).toBe('voice');
    expect(P.boxOf({ step: 'nextStep', words: 'goal' }, false)).toBe('voice');
    expect(P.boxOf({ step: 'habitsMore' }, false)).toBe('habits');
    expect(P.boxOf({ step: 'attendance' }, false)).toBe('att');
    expect(P.boxOf({ step: 'closer', classLine: true }, false)).toBe('cls');
    expect(P.boxOf({ step: null }, false)).toBe('yours');
  });

  it('reads the fact a sentence rests on from its record before today’s context', () => {
    const row = {
      prov: { factKeys: ['comp:A'], sources: { strengths: ['comp:B'], name: [] } },
    };
    expect(P.factKeys(row)).toEqual(['comp:B']);
    expect(P.has({ prov: { factKeys: ['work:w1', 'grade'] } }, 'work:w1')).toBe(true);
    expect(P.factKeys({})).toEqual([]);
  });

  it('puts a new sentence after the last one of its box, never in another’s place', () => {
    const boxes = ['grade', 'strength', 'habits', 'next', 'cls'];
    expect(P.insertAt(boxes, 'strength')).toBe(2);
    expect(P.insertAt(boxes, 'best')).toBe(1);
    expect(P.insertAt(boxes, 'missing')).toBe(3);
    expect(P.insertAt(boxes, 'yours')).toBe(5);
    expect(P.insertAt([], 'grade')).toBe(0);
  });

  it('reads a typed sentence as reworded when half its words are an old sentence’s', () => {
    expect(P.isReword('Cece usually hands in her work on time.', 'She usually hands in her work on time.')).toBe(true);
    expect(P.isReword('Please call me this week.', 'She usually hands in her work on time.')).toBe(false);
  });

  it('finds three or more sentences in a row that open the same way', () => {
    const run = P.sameOpening(['He is kind.', 'He works hard.', 'He asks questions.', 'Next, try this.']);
    expect(run).toEqual({ word: 'he', from: 0, n: 3 });
    expect(P.openingNote(run)).toBe('Three sentences in a row start with He.');
    expect(P.sameOpening(['He is kind.', 'She works hard.', 'He asks questions.'])).toBeNull();
  });

  it('gives a reading grade between 3 and 12', () => {
    expect(P.readingGrade('', 1)).toBe(0);
    expect(P.readingGrade('It is a cat. It is a dog.', 2)).toBe(3);
    const hard =
      'Considerably interdisciplinary understanding demonstrates extraordinarily sophisticated communication.';
    expect(P.readingGrade(hard, 1)).toBe(12);
  });
});

describe('the boxes drawn for a Demo Mode student', () => {
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
  const noor = () => RQ.getTqStudents().find(s => s.firstName === 'Noor');
  const draw = () => {
    RQ.tqStudentIndex = RQ.getTqStudents().indexOf(noor());
    return RQ.renderTermQuestionnaire(cid);
  };

  it('starts every box closed but Work Habits, and a closed box is its row alone', () => {
    ReportWc.ui.open = { habits: true };
    const html = draw();
    const open = [...html.matchAll(/<section class="wc-box( open)?" data-bk="(\w+)"/g)]
      .filter(m => m[1])
      .map(m => m[2]);
    expect(open).toEqual(['habits']);
    expect((html.match(/<section class="wc-box"/g) || []).length).toBeGreaterThan(8);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span class="wc-chev" aria-hidden="true">');
    expect(html).not.toContain('class="wc-fact-wrap" data-fact="comp:');
  });

  it('shows a closed box’s main fact and the sentences it has in the comment', () => {
    const st = noor();
    const f = CommentBank.facts(cid, st, ReportBlocks.getTermId());
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) });
    upsertTermRating(cid, st.id, ReportBlocks.getTermId(), { narrative: d.text });
    ReportWc.ui.open = { habits: true };
    const html = draw();
    expect(html).toMatch(/aria-label="Grade"[\s\S]*?wc-head-fact">[^<]+</);
    expect(html).toMatch(/<span class="wc-chip own">\d+ in the Comment<\/span>/);
    // Only the Work Habits box shows its sentences; opening Strength shows its facts.
    ReportWc.ui.open.strength = true;
    expect(draw()).toContain('class="wc-fact-wrap" data-fact="comp:');
  });
});
