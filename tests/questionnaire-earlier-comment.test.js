/**
 * The Earlier Comment (Nov 3): a saved comment's sentences that are neither
 * from the bank nor recorded as the teacher's (draft_meta.teacher_text) —
 * a comment from before the record, or the old generator's — were shown as
 * "Your Sentence · Typed by you" and kept by every Generate, so a wrong
 * C- (58.3%) sat beside the C+ grade sentence however often Generate ran.
 *
 * Now they are Earlier Comment rows: Generate replaces them, with Undo; Keep
 * This Sentence or an edit makes one the teacher's; a sentence they type is
 * recorded as theirs and kept; and an Earlier Comment sentence that gives a
 * grade the gradebook does not show is flagged before Approve.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const RQ = ReportQuestionnaire;
let CID = 'course-earlier';
let runs = 0;
const TERM = 'term-1';
const MAYA = { id: 'stu-maya', firstName: 'Maya', lastName: 'Lopez', pronouns: 'she/her' };
const section = (id, tagId, name) => ({ id, name, shortName: name, tags: [{ id: tagId, label: name }] });

/* History 12, a Letter class: Maya has marks on all eight tasks. */
function seed() {
  CID = 'course-earlier-' + ++runs;
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter', gradeLevel: '12' };
  _cache.students[CID] = [Object.assign({ designations: [] }, MAYA)];
  _cache.learningMaps[CID] = {
    sections: [section('sec-1', 't1', 'Cause and Consequence'), section('sec-2', 't2', 'Evidence')],
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = Array.from({ length: 8 }, (_, i) => ({
    id: 'a' + i,
    title: 'Task ' + (i + 1),
    scoreMode: 'proficiency',
    tagIds: [i % 2 ? 't2' : 't1'],
    type: 'summative',
    date: '2026-10-' + String(i + 1).padStart(2, '0'),
  }));
  _cache.scores[CID] = {
    [MAYA.id]: Array.from({ length: 8 }, (_, i) => ({
      assessmentId: 'a' + i,
      tagId: i % 2 ? 't2' : 't1',
      score: 3,
      date: '2026-10-' + String(i + 1).padStart(2, '0'),
    })),
  };
  _cache.statuses[CID] = {};
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {};
  _cache.observations[CID] = {};
  _cache.reflections[CID] = {};
  _cache.termRatings[CID] = {};
  _cache.reportConfig[CID] = null;
  localStorage.removeItem('gb-report-config-' + CID);
  clearProfCache();
  els = {};
  toasts = [];
}
const student = () => getStudents(CID).find(s => s.id === MAYA.id);
const grade = () => CommentBank.facts(CID, student(), TERM).grade;
const rate = data => upsertTermRating(CID, MAYA.id, TERM, data);
const saved = () => getStudentTermRating(CID, MAYA.id, TERM) || {};
function open() {
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
  RQ.tqStudentIndex = 0;
  return RQ.renderTermQuestionnaire(CID);
}
function box(value) {
  els['tq-narrative'] = {
    value,
    dataset: { cid: CID, term: TERM, sid: MAYA.id },
    style: {},
    scrollHeight: 0,
    focus() {},
    select() {},
    setSelectionRange() {},
  };
  return els['tq-narrative'];
}
const card = html => html.slice(html.indexOf('id="tq-sentences"'));

// The old generator's sentences (Saaleha's comment, Oct 20), for Maya.
const OLD_1 =
  'Maya is still finding their footing in History 12, and I want to highlight both the progress and the areas where they need support.';
const OLD_2 = 'I care about Maya’s success and I want to find the right path forward.';

let hadDoc, oldDoc, oldToast, els, toasts;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T19:00:00Z'));
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  oldToast = globalThis.showUndoToast;
  els = {};
  toasts = [];
  globalThis.document = {
    getElementById: id => els[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
    body: { classList: { add() {}, remove() {} } },
  };
  globalThis.showUndoToast = (message, undo) => toasts.push({ message, undo });
});
afterAll(async () => {
  vi.useRealTimers();
  await new Promise(r => setTimeout(r, 400));
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
  globalThis.showUndoToast = oldToast;
});
beforeEach(() => {
  localStorage.clear();
  seed();
});
afterEach(() => {
  delete COURSES[CID];
  clearProfCache();
});

describe('a saved comment with no record of what the teacher typed', () => {
  it('shows its sentences as Earlier Comment rows, not Your Sentence', () => {
    rate({ narrative: OLD_1 + ' ' + OLD_2 });
    const html = card(open());
    expect((html.match(/<span class="qn-req-label">Earlier Comment<\/span>/g) || []).length).toBe(2);
    expect(html).not.toContain('<span class="qn-req-label">Your Sentence</span>');
    expect(html).not.toContain('Typed by you');
    expect(html).toContain('From the earlier comment · Generate Comment replaces it');
    expect((html.match(/data-do="options"/g) || []).length).toBe(2);
  });

  it('Generate replaces them, says so, and Undo brings them back', () => {
    const text = OLD_1 + ' ' + OLD_2;
    rate({ narrative: text });
    open();
    const el = box(text);
    RQ.tqGenerate();
    expect(el.value).not.toContain(OLD_1);
    expect(el.value).not.toContain(OLD_2);
    expect(el.value.length).toBeGreaterThan(0);
    const toast = toasts[toasts.length - 1];
    expect(toast.message).toBe('Replaced, with 2 sentences from the earlier comment.');
    toast.undo();
    expect(el.value).toBe(text);
    // Pressing again replaces them every time, never keeps them.
    RQ.tqGenerate();
    expect(el.value).not.toContain(OLD_1);
  });

  it('Keep This Sentence makes one the teacher’s: recorded, and Generate keeps it', () => {
    const text = OLD_1 + ' ' + OLD_2;
    rate({ narrative: text });
    const before = card(open());
    expect(before).not.toContain('data-do="keepEarlier"');
    RQ.tqSentences('options', { dataset: { row: '1' } });
    const menu = card(RQ.renderTermQuestionnaire(CID));
    expect(menu).toContain('<span class="qn-menu-head">Earlier Comment</span>');
    expect(menu).toContain('>Keep This Sentence</span>');
    const el = box(text);
    RQ.tqSentences('keepEarlier', { dataset: { row: '1' } });
    expect(saved().draftMeta.teacher_text).toEqual([OLD_2]);
    // After a reload the record still says it is theirs.
    const rows = RQ.recoverRows(
      text,
      CommentBank.context(CommentBank.facts(CID, student(), TERM), {}),
      saved().draftMeta,
    );
    expect(rows.map(r => [RQ.rowLabel(r, ''), !!r.earlier])).toEqual([
      ['Earlier Comment', true],
      ['Your Sentence', false],
    ]);
    RQ.tqGenerate();
    expect(el.value).toContain(OLD_2);
    expect(el.value).not.toContain(OLD_1);
  });
});

describe('a sentence the teacher types', () => {
  it('is recorded as theirs when the comment saves, and stays through Generate after a reload', () => {
    open();
    const el = box('');
    RQ.tqGenerate();
    const mine = 'Maya led her group’s debate prep this week.';
    el.value = el.value + ' ' + mine;
    RQ.tqSaveNarrative();
    expect(saved().draftMeta.teacher_text).toEqual([mine]);
    // A reload: the rows come back from the saved comment and its record.
    const rows = RQ.recoverRows(
      el.value,
      CommentBank.context(CommentBank.facts(CID, student(), TERM), {}),
      saved().draftMeta,
    );
    const own = rows.find(r => r.text === mine);
    expect(RQ.isTyped(own)).toBe(true);
    expect(own.earlier).toBeFalsy();
    RQ.tqGenerate();
    expect(el.value).toContain(mine);
  });
});

describe('an Earlier Comment sentence that gives a grade the gradebook does not show', () => {
  it('reads letters and an overall %, only in a Letter class', () => {
    const g = { mode: 'letter', letter: 'C+', pct: 67 };
    expect(RQ.gradeClaimWrong('Academically, Maya has a C- (58.3%) overall.', g)).toBe(true);
    expect(RQ.gradeClaimWrong('Maya is earning a C+ this term.', g)).toBe(false);
    expect(RQ.gradeClaimWrong('A C is Maya’s mark this term.', g)).toBe(true);
    expect(RQ.gradeClaimWrong('Her average is 58% overall.', g)).toBe(true);
    expect(RQ.gradeClaimWrong('Her average is 67% overall.', g)).toBe(false);
    // A piece's own % is not the course grade.
    expect(RQ.gradeClaimWrong('She scored 80% on the essay.', g)).toBe(false);
    expect(RQ.gradeClaimWrong('Maya asks good questions.', g)).toBe(false);
    expect(RQ.gradeClaimWrong('Maya has a C- overall.', { mode: 'proficiency', letter: null })).toBe(false);
  });

  it('is flagged before Approve; Remove It takes it out with Undo', () => {
    const g = grade();
    const wrong = g.letter === 'C-' ? 'B' : 'C-';
    const stale = 'Academically, Maya has a ' + wrong + ' (58.3%) overall.';
    const text = OLD_2 + ' ' + stale;
    rate({ narrative: text });
    const html = card(open());
    expect(html).toContain('This sentence gives a grade the gradebook does not show.');
    expect(html).toContain('The gradebook shows ' + g.letter + ' · ' + g.pct + '%.');
    const st = RQ.getTqStudents()[0];
    expect(RQ.claimChanges(st).map(c => [c.row, c.kind])).toEqual([[1, 'grade']]);
    expect(RQ.approveBlockers(st)).toContain('claims');
    const el = box(text);
    RQ.tqClaim('use', 1);
    expect(el.value).toBe(OLD_2);
    expect(toasts[toasts.length - 1].message).toBe('Removed from the comment.');
    expect(RQ.approveBlockers(st)).not.toContain('claims');
  });

  it('Keep as Written makes it the teacher’s and it is not checked again', () => {
    const g = grade();
    const wrong = g.letter === 'C-' ? 'B' : 'C-';
    const stale = 'Academically, Maya has a ' + wrong + ' overall.';
    rate({ narrative: stale });
    open();
    box(stale);
    const st = RQ.getTqStudents()[0];
    RQ.tqClaim('keep', 0);
    expect(saved().draftMeta.grade_kept).toEqual([stale]);
    expect(saved().draftMeta.teacher_text).toEqual([stale]);
    expect(RQ.claimChanges(st)).toEqual([]);
  });

  it('a sentence the teacher typed is theirs and never checked', () => {
    const g = grade();
    const wrong = g.letter === 'C-' ? 'B' : 'C-';
    const typed = 'Academically, Maya has a ' + wrong + ' overall.';
    rate({ narrative: typed, draftMeta: { v: 1, sentences: [], teacher_text: [typed] } });
    open();
    expect(RQ.claimChanges(RQ.getTqStudents()[0])).toEqual([]);
  });
});
