/**
 * Points work in a Letter class: the mark Generate prints beside the piece
 * is the student's own % on it (points earned out of possible, calc.js), the
 * number the gradebook works out, not the piece's level as a %. verify()
 * checks that number. Synthetic class only (tests/eval-fixture.js), every
 * name and mark invented.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { syntheticClass } from './eval-fixture.js';
import { runAccuracy } from '../scripts/eval/accuracy.mjs';
import { generateClass } from '../scripts/eval/generate.mjs';

const PSA = 4; // "Primary Source Analysis"
// Out of 20, per student in roster order: 95%, 75%, 55%, 85%, 45%.
const POINTS = [19, 15, 11, 17, 9];

/* The fixture's Letter class with one piece scored out of 20 points, on
   the BC Letter Bands preset (Counts As 3+ = 86, 4- = 92), so a level's %
   is not points earned out of possible. */
function pointsClass() {
  const bundle = syntheticClass();
  bundle.course_config.grading_scale = {
    boundaries: DEFAULT_GRADING_SCALE.boundaries,
    percents: { ...BC_LETTER_BAND_PERCENTS },
    labels: null,
  };
  const gb = bundle.gradebook;
  Object.assign(gb.assessments[PSA], { score_mode: 'points', max_points: 20, tag_ids: [] });
  gb.tag_rows = gb.tag_rows.filter(r => r[1] !== PSA);
  gb.score_rows.forEach(r => {
    if (r[1] === PSA) r[2] = POINTS[r[0]];
  });
  return bundle;
}

const byId = id => COMMENT_BANK.sentences.find(s => s.id === id);

/* One sentence as a draft, filled from ctx, to verify against facts. */
function one(id, ctx) {
  const s = byId(id);
  const text = CommentBank.fill(s, ctx);
  return { text, ids: [id], sentences: [{ id, part: s.part, text }], provenance: [CommentBank.provenance(s, ctx)] };
}

function owen() {
  const run = generateClass(pointsClass());
  const d = run.drafts.find(x => x.student.firstName === 'Owen');
  return { cid: run.cid, student: d.student, f: d.facts };
}

describe('points work in a Letter class', () => {
  it('carries its own % from calc.js, the same number as the gradebook', () => {
    const { cid, student, f } = owen();
    const a = getAssessments(cid).find(x => x.title === 'Primary Source Analysis');
    const w = f.work.find(x => x.id === a.id);
    expect(assessmentCellValue(cid, student.id, a)).toMatchObject({ kind: 'points', value: 17 });
    expect(w.pct).toBeCloseTo(getAssessmentGroupPercentage(cid, student.id, [a]).pct, 9);
    expect(w.pct).toBeCloseTo(85, 9);
    // Its level (3.4) as a % on the class's Counts As would be 87%, the
    // wrong number.
    expect(f.levelText(w.v)).toBe('87%');
    // Proficiency work has no % of its own here.
    expect(f.work.filter(x => x.id !== a.id).every(x => x.pct === null)).toBe(true);
  });

  it('prints that % beside the piece, never the level as a %', () => {
    const { f } = owen();
    const ctx = CommentBank.context(f, {});
    expect(ctx.assignment).toBe('Primary Source Analysis');
    expect(ctx.level).toBe('85%');
    expect(CommentBank.fill(byId('n31'), ctx)).toContain('reached 85%.');
  });

  it('is checked by verify(): the right % passes, the level as a % is replaced', () => {
    const { f } = owen();
    const ctx = CommentBank.context(f, {});
    const d = one('n31', ctx);
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    const wrong = one('n31', { ...ctx, level: '87%' });
    expect(wrong.text).toContain('reached 87%.');
    const v = CommentBank.verify(wrong, f, {});
    expect(v.replaced[0]).toMatchObject({ sentenceId: 'n31' });
    expect(v.replaced[0].failed).toContain('bestPiece');
  });

  it('leaves no wrong mark in any student’s draft (the accuracy audit)', () => {
    const r = runAccuracy({ classData: pointsClass() });
    expect(r.summary.generated.total).toBe(0);
    expect(r.summary.verifierReplaced).toBe(0);
  });
});

describe('the Term Questionnaire’s best piece (At a Glance)', () => {
  it('shows the same % as the comment, not the level as a %', () => {
    const run = generateClass(pointsClass());
    const st = run.students.find(s => s.firstName === 'Owen');
    const hadDoc = 'document' in globalThis;
    const oldDoc = globalThis.document;
    // The page reads the report picker's label through the document.
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    try {
      ReportQuestionnaire.configure({ activeCourse: run.cid, renderReports: () => {} });
      ReportQuestionnaire.tqStudentIndex = ReportQuestionnaire.getTqStudents().findIndex(s => s.id === st.id);
      const html = ReportQuestionnaire.renderTermQuestionnaire(run.cid);
      const best = html.match(/<div class="qn-fact qn-best">[\s\S]*?<\/div>\s*<\/div>/)[0];
      expect(best).toContain('Primary Source Analysis · 85%');
      expect(best).not.toContain('87%');
    } finally {
      if (hadDoc) globalThis.document = oldDoc;
      else delete globalThis.document;
    }
  });
});
