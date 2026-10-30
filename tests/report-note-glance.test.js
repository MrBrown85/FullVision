/**
 * At a Glance and the Note for the Report (Generate plan, PR 7): when the
 * best piece has no note, "No note for the report yet · Add one", and Add
 * one opens the grader on that piece for the student on screen. Demo Mode
 * (Science 8, Report 2).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('At a Glance: the note for the report', () => {
  let cid, saved, hadDoc, oldDoc, oldPA;
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
    oldPA = window.PageAssignments;
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    window.PageAssignments = oldPA;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });
  const cece = () => getStudents(cid).find(s => s.firstName === 'Cece');
  const show = st => {
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
    return RQ.renderTermQuestionnaire(cid);
  };

  it('asks for a note on the best piece when it has none', () => {
    const st = cece();
    const best = RQ.bestPiece(CommentBank.facts(cid, st, 'term-2').work);
    const html = show(st);
    expect(html).toContain('No note for the report yet · ');
    expect(html).toContain('data-action="tqAddReportNote" data-aid="' + best.id + '"');
    expect(html).toContain('>Add one</button>');
  });

  it('says nothing once the best piece has a note', () => {
    const st = cece();
    const best = RQ.bestPiece(CommentBank.facts(cid, st, 'term-2').work);
    saveScoreReportNote(cid, st.id, best.id, 'kept a field journal with dated sketches');
    try {
      expect(show(st)).not.toContain('No note for the report yet');
    } finally {
      saveScoreReportNote(cid, st.id, best.id, '');
    }
  });

  it('Add one opens the grader on that piece for this student only', () => {
    const st = cece();
    show(st);
    const calls = [];
    window.PageAssignments = { openGrader: (...args) => calls.push(args), graderOpen: () => false };
    RQ.tqAddReportNote('assess-x');
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 3)).toEqual([cid, 'assess-x', st.id]);
    expect(calls[0][3].studentIds).toEqual([st.id]);
    expect(typeof calls[0][3].onClose).toBe('function');
  });

  it('leaves the keys to the grader while it is open', () => {
    const st = cece();
    show(st);
    const at = RQ.tqStudentIndex;
    window.PageAssignments = { openGrader() {}, graderOpen: () => true };
    const e = { key: 'ArrowDown', target: { closest: () => null }, preventDefault() {} };
    RQ.handleKey(e);
    expect(RQ.tqStudentIndex).toBe(at);
  });

  it('is wired to the reports page', () => {
    const src = readFileSync('teacher/page-reports.js', 'utf-8');
    expect(src).toContain('RQ.tqAddReportNote(el.dataset.aid)');
  });
});
