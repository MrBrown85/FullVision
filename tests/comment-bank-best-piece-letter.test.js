/**
 * The best piece in a Letter class (bug sweep, Nov 3 2026): Lena has 20/20
 * on one piece and 18/20 on a later one. Both are proficiency 4, so they
 * tied and the newer won, and the draft called the 90% piece her highest
 * mark beside a 100% one. DECISIONS (Term Questionnaire 15) ties pieces at
 * the mark as it prints, which in a Letter class is the %. verify() and the
 * accuracy audit check the same. Synthetic class only (tests/eval-fixture.js),
 * every name and mark invented.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { syntheticClass } from './eval-fixture.js';
import { checkComment, runAccuracy, truthOf } from '../scripts/eval/accuracy.mjs';
import { generateClass } from '../scripts/eval/generate.mjs';

const WEEK1 = 1; // "Current Events: Week 1", dated first
const TREATY = 5; // "Lesson 4: Treaty Debate", dated later
const LENA = 4;

/* The fixture's Letter class with two pieces scored out of 20 points:
   every student 20/20 on Week 1 and 18/20 on the Treaty Debate. */
function pointsClass() {
  const bundle = syntheticClass();
  const gb = bundle.gradebook;
  [WEEK1, TREATY].forEach(i => Object.assign(gb.assessments[i], { score_mode: 'points', max_points: 20, tag_ids: [] }));
  gb.tag_rows = gb.tag_rows.filter(r => r[1] !== WEEK1 && r[1] !== TREATY);
  gb.score_rows.forEach(r => {
    if (r[1] === WEEK1) r[2] = 20;
    if (r[1] === TREATY) r[2] = 18;
  });
  return bundle;
}

function lena() {
  const run = generateClass(pointsClass());
  const d = run.drafts.find(x => x.student.firstName === 'Lena');
  return { run, cid: run.cid, student: d.student, f: d.facts, text: d.text };
}

const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);
/* One sentence as a draft, filled from ctx, to verify against facts. */
function one(id, ctx) {
  const s = byId(id);
  const text = CommentBank.fill(s, ctx);
  return { text, ids: [id], sentences: [{ id, part: s.part, text }], provenance: [CommentBank.provenance(s, ctx)] };
}
const highest = () =>
  COMMENT_BANK.sentences.find(
    s => /highest mark this term is \{assignment\}/.test(s.text) && s.claims.includes('bestPiece'),
  );

describe('the best piece in a Letter class', () => {
  it('both pieces are proficiency 4, at 100% and 90%', () => {
    const { f } = lena();
    const week1 = f.work.find(w => w.title === 'Current Events: Week 1');
    const treaty = f.work.find(w => w.title === 'Lesson 4: Treaty Debate');
    expect(week1).toMatchObject({ v: 4, pct: 100 });
    expect(treaty).toMatchObject({ v: 4, pct: 90 });
  });

  it('is the 100% piece, not the newer 90% one', () => {
    const { f } = lena();
    const ctx = CommentBank.context(f, {});
    expect(ctx.assignment).toBe('Current Events: Week 1');
    expect(ctx.level).toBe('100%');
  });

  it('verify() replaces a sentence that calls the 90% piece the highest mark', () => {
    const { f } = lena();
    const ctx = CommentBank.context(f, {});
    const s = highest();
    const right = one(s.id, ctx);
    expect(CommentBank.verify(right, f, {}).replaced).toEqual([]);
    const treaty = f.work.find(w => w.title === 'Lesson 4: Treaty Debate');
    // The same sentence with only the piece changed: its title and its source.
    const wrongCtx = { ...ctx, assignment: treaty.title };
    const wrong = one(s.id, wrongCtx);
    wrong.provenance[0].sources = { ...wrong.provenance[0].sources, assignment: ['work:' + treaty.id] };
    expect(wrong.text).toContain('Treaty Debate');
    expect(right.provenance[0].sources.assignment).toEqual(['work:' + f.work.find(w => w.title === ctx.assignment).id]);
    const v = CommentBank.verify(wrong, f, {});
    expect(v.replaced[0]).toMatchObject({ sentenceId: s.id });
    expect(v.replaced[0].failed).toContain('bestPiece');
  });

  it('the accuracy audit counts it as an error', () => {
    const { run, cid, student, f } = lena();
    const truth = truthOf(cid, student, f, run.students);
    const bad = checkComment('The piece with their highest mark this term is “Treaty Debate.”', truth);
    expect(bad.errors.map(e => e.type)).toContain('title');
    const good = checkComment('The piece with their highest mark this term is “Current Events: Week 1.”', truth);
    expect(good.errors).toEqual([]);
  });

  it('leaves no wrong best piece in any student’s draft', () => {
    const r = runAccuracy({ classData: pointsClass() });
    expect(r.summary.generated.total).toBe(0);
    expect(r.summary.verifierReplaced).toBe(0);
    r.students.forEach(s => expect(s.generated.text).not.toMatch(/highest mark[^.]*Treaty Debate/));
  });
});

describe('the best piece’s mark on the Term Questionnaire (Step 4 group 2 #59)', () => {
  it('is the same on a row’s source as on At a Glance: the piece’s own %', () => {
    const { cid, student, f } = lena();
    const RQ = window.ReportQuestionnaire;
    const ctx = CommentBank.context(f, {});
    const s = highest();
    const treaty = f.work.find(w => w.title === 'Lesson 4: Treaty Debate');
    // A row whose sentence names the 90% piece: its source says 90%, not
    // the % its proficiency 4 counts as.
    const row = {
      id: s.id,
      step: CommentBank.stepOf(s),
      text: '',
      s,
      prov: Object.assign({}, CommentBank.provenance(s, ctx), {
        factKeys: ['work:' + treaty.id],
        sources: { assignment: ['work:' + treaty.id] },
      }),
    };
    expect(RQ.rowSource(row, cid, student, f, ctx)).toContain('Lesson 4: Treaty Debate · 90%');
  });
});
