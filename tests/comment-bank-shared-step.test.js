/**
 * The next step most of the class shares (Colin, 2026-11-02), shown with the
 * Questionnaire's Closing row for the teacher's own closing line. Demo Mode
 * (Science 8, Report 2).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('the class’s shared next step', () => {
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

  it('is the next step the most students share, with its count', () => {
    const students = getStudents(cid);
    const termId = ReportBlocks.getTermId();
    const r = CommentBank.sharedNextStep(cid, { termId, students });
    const counts = {};
    students.forEach(st => {
      const f = CommentBank.facts(cid, st, termId);
      const ls = CommentBank.levelStepOf(f);
      const ns = ls ? null : CommentBank.nextSkillOf(f);
      const t = ls ? ls.text : ns ? ns.skill : '';
      if (t) counts[t] = (counts[t] || 0) + 1;
    });
    const top = Math.max(...Object.values(counts));
    expect(r.count).toBe(top);
    expect(counts[r.text]).toBe(top);
    expect(r.total).toBe(students.length);
  });

  it('is none when no step is shared by two students', () => {
    const one = getStudents(cid).slice(0, 1);
    expect(CommentBank.sharedNextStep(cid, { termId: ReportBlocks.getTermId(), students: one })).toBeNull();
  });
});
