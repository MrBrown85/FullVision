/**
 * At a Glance and the Note for the Report (Generate plan, PR 7): when the
 * best piece has no note, "Add a note for the report ›", which opens the
 * grader on that piece for the student on screen, as Open in Grader and
 * each piece's title do. Demo Mode (Science 8, Report 2).
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
    const best = RQ.bestPiece(CommentBank.facts(cid, st, 'term-2'));
    const html = show(st);
    expect(html).toContain('data-action="tqAddReportNote" data-aid="' + best.id + '"');
    expect(html).toContain('>Add a note for the report ›</button>');
  });

  it('shows the note under the best piece once it has one', () => {
    const st = cece();
    const best = RQ.bestPiece(CommentBank.facts(cid, st, 'term-2'));
    saveScoreReportNote(cid, st.id, best.id, 'kept a field journal with dated sketches');
    try {
      const html = show(st);
      expect(html).not.toContain('Add a note for the report');
      expect(html).toContain('Note for the report: “kept a field journal with dated sketches”');
    } finally {
      saveScoreReportNote(cid, st.id, best.id, '');
    }
  });

  it('Add a note and Open in Grader open the grader on that piece for this student only', () => {
    const st = cece();
    show(st);
    const calls = [];
    window.PageAssignments = { openGrader: (...args) => calls.push(args), graderOpen: () => false };
    RQ.tqAddReportNote('assess-x');
    RQ.tqOpenGrader('assess-y');
    expect(calls).toHaveLength(2);
    expect(calls[1].slice(0, 3)).toEqual([cid, 'assess-y', st.id]);
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
    expect(src).toContain('RQ.tqOpenGrader(el.dataset.aid)');
    expect(src).toContain('RQ.tqGlanceToggle(el.dataset.row)');
  });
});
