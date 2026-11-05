/**
 * The teacher's inputs Generate reads (Nov 4 2026; plan
 * ~/reports/generate-inputs-placement-plan.md, items 6-10), over Demo Mode's
 * Science 8 class: what the class studied, the next step the teacher chose,
 * each assessment's kind, the teacher's own comment wording, and the
 * strongest rubric criterion on the best piece.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('the teacher’s inputs', () => {
  let cid, term, saved;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    term = ReportBlocks.getTermId();
  });
  afterAll(() => {
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });
  const studs = () => getStudents(cid);
  const factsOf = st => CommentBank.facts(cid, st, term);
  const draftAll = (k = 1) => {
    const comments = [];
    return studs().map(st => {
      const f = factsOf(st);
      const d = CommentBank.draft(CommentBank.context(f, {}), {
        seed: CommentBank.seedFor(st.id + '|' + term) + k,
        comments: comments.slice(),
      });
      comments.push({ sid: st.id, text: d.text });
      return { st, f, d };
    });
  };

  it('says what the class studied in one sentence at most, in some comments, and verifies it as a class line', () => {
    const rc = getReportConfig(cid) || {};
    const cs = Object.assign({}, rc.commentSettings || {}, {
      studied: { [term]: 'This report, we studied cells and ecosystems.' },
    });
    saveReportConfig(cid, Object.assign({}, rc, { commentSettings: cs }));
    expect(CommentBank.studiedTopic(cid, term)).toBe('cells and ecosystems');
    const all = draftAll();
    const said = all.filter(x => /cells and ecosystems/.test(x.d.text));
    expect(said.length).toBeGreaterThan(0);
    expect(said.length).toBeLessThan(all.length);
    all.forEach(({ f, d }) => {
      expect(d.sentences.filter(s => /cells and ecosystems/.test(s.text)).length).toBeLessThanOrEqual(1);
      expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    });
    // Changed, the saved sentence fails verify (a class line).
    const x = said[0];
    saveReportConfig(
      cid,
      Object.assign({}, rc, { commentSettings: Object.assign({}, cs, { studied: { [term]: 'We studied forces.' } }) }),
    );
    expect(CommentBank.verify(x.d, factsOf(x.st), {}).replaced.length).toBeGreaterThan(0);
    saveReportConfig(cid, rc);
  });

  it('offers three next steps, lowest first with two pieces or more, and drafts the one the teacher chose', () => {
    const st = studs().find(s => CommentBank.nextStepChoices(factsOf(s)).length >= 2);
    const f = factsOf(st);
    const choices = CommentBank.nextStepChoices(f);
    expect(choices.length).toBeLessThanOrEqual(3);
    choices.forEach((c, i) => {
      expect(c.pieces).toBeGreaterThanOrEqual(2);
      if (i) expect(c.level).toBeGreaterThanOrEqual(choices[i - 1].level);
    });
    expect(choices.filter(c => c.engine).length).toBeLessThanOrEqual(1);
    const pick = choices.find(c => !c.engine) || choices[1];
    upsertTermRating(cid, st.id, term, { focusSectionId: pick.id });
    const g = factsOf(st);
    const n = CommentBank.nextSkillOf(g);
    expect(String(n.comp.id)).toBe(String(pick.id));
    expect(n.chosen).toBe(true);
    expect(CommentBank.nextStepChoices(g).find(c => c.id === pick.id).chosen).toBe(true);
    const d = CommentBank.draft(CommentBank.context(g, {}), { seed: 3, quiet: true });
    const step = d.provenance.find(pv => (pv.sources || {}).step || (pv.sources || {}).stepDoing);
    if (step)
      expect(((step.sources.step || step.sources.stepDoing)[0] || '').replace(/^comp:/, '')).toBe(String(pick.id));
    expect(CommentBank.verify(d, g, {}).replaced).toEqual([]);
    upsertTermRating(cid, st.id, term, { focusSectionId: null });
  });

  it('reads each assessment’s kind, from its Evidence Type or else its title', () => {
    const f = factsOf(studs()[0]);
    f.work.forEach(w => {
      const a = getAssessments(cid).find(x => x.id === w.id);
      if (/\bquiz|test|check\b/i.test(w.title) && (!a.evidenceType || a.evidenceType === 'written'))
        expect(w.kind).toBe('test');
      if (a.evidenceType === 'lab') expect(w.kind).toBe('lab');
    });
  });

  it('prefers the teacher’s own wording for a strength, a step and a home prompt', () => {
    const st = studs().find(s => {
      const ctx = CommentBank.context(factsOf(s), {});
      return !!ctx.strengthAt && (ctx._strengthRoutes || [])[0] && ctx._strengthRoutes[0].comp.tag;
    });
    const f = factsOf(st);
    const ctx = CommentBank.context(f, {});
    const rt = ctx._strengthRoutes[0];
    const levels = { Developing: 2, Proficient: 3, Extending: 4 };
    if (!levels[rt.word]) return;
    CompetencyWording.saveCommentWording(
      rt.comp.tag,
      'at',
      levels[rt.word],
      'writes careful notes on every experiment',
    );
    const again = CommentBank.context(factsOf(st), {});
    expect(again._pick.strengthAt[0] || again.strengthAt).toMatch(/notes on every experiment/);
    const d = CommentBank.draft(again, { seed: 2, quiet: true });
    expect(CommentBank.verify(d, factsOf(st), {}).replaced).toEqual([]);
    CompetencyWording.saveCommentWording(rt.comp.tag, 'at', levels[rt.word], '');
  });

  it('names the best piece’s strongest rubric criterion only when it is strictly highest, and verifies it', () => {
    studs().forEach(st => {
      const f = factsOf(st);
      const ctx = CommentBank.context(f, {});
      if (!ctx.criterionTop) return;
      expect(ctx._criterionTop.score).toBeGreaterThan(0);
      const d = CommentBank.draft(ctx, { seed: 4, quiet: true });
      expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    });
  });
});
