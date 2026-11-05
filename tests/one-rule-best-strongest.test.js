/**
 * One rule each for the best piece, Strongest and Growing (Nov 2): the
 * comment, At a Glance and the printed This Term at a Glance read
 * CommentBank.bestPieceOf, strongestOf and nextStepOf over the same
 * competencies (CommentBank.compsOf), so they never disagree. Demo Mode
 * (Science 8, Report 2), every student.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('the best piece, Strongest and Growing agree everywhere', () => {
  let cid, saved;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
  });
  afterAll(() => {
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  const glance = st =>
    ReportBlocks.renderReportBlock('term-glance', cid, st, {}, {})
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const label = (id, secs) => {
    const sec = secs.find(s => s.id === id);
    return sec ? sec.shortName || sec.name : '—';
  };

  it('At a Glance and the comment name the same best piece', () => {
    const students = getStudents(cid);
    expect(students.length).toBeGreaterThan(3);
    students.forEach(st => {
      const f = CommentBank.facts(cid, st, ReportBlocks.getTermId());
      const best = CommentBank.bestPieceOf(f);
      expect(RQ.bestPiece(f)).toBe(best);
      // The comment's best piece owns the same title (the sample voice).
      if (best) expect(CommentBank.context(f, {}).piece).toContain(CommentRealiser.workTitle(best.title));
    });
  });

  it('the printed box names the comment’s Strongest and Growing, or a dash', () => {
    const secs = ReportBlocks.reportSections(cid);
    let named = 0;
    getStudents(cid).forEach(st => {
      const comps = CommentBank.facts(cid, st, ReportBlocks.getTermId()).comps;
      expect(CommentBank.compsOf(cid, st)).toEqual(comps);
      const strong = CommentBank.strongestOf(comps)[0];
      const next = CommentBank.nextStepOf(comps);
      const text = glance(st);
      if (!text) return;
      if (strong || next) named++;
      expect(text).toContain(label(strong && strong.id, secs) + ' Strongest');
      expect(text).toContain(label(next && next.id, secs) + ' Growing');
      // At a Glance tags the same competencies.
      const tags = RQ.skillTags(comps);
      if (strong) expect(tags[strong.id]).toBe('Strongest');
      if (next) expect(tags[next.id]).toBe('Next step');
    });
    expect(named).toBeGreaterThan(0);
  });

  it('takes the override as the level of a competency with evidence this term, as calc.js does', () => {
    const st = getStudents(cid)[0];
    const c = CommentBank.compsOf(cid, st).find(x => x.scores.length > 0);
    const was = getOverrides;
    globalThis.getOverrides = () => ({ [st.id]: { [c.id]: { level: 4, reason: 'Portfolio' } } });
    try {
      const after = CommentBank.compsOf(cid, st).find(x => x.id === c.id);
      expect(after.level).toBe(4);
      // With a last report, now is the level the report prints, override
      // included; an undated override applies to Report 1 too.
      expect(after.now).toBe(after.since ? 4 : c.now);
      expect(after.start).toBe(after.since ? 4 : c.start);
    } finally {
      globalThis.getOverrides = was;
    }
  });
});
