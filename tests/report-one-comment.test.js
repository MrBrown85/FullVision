/**
 * One Report: the Teacher Comment edited where it prints
 * (teacher/report-one-comment.js).
 *
 * 1. The word diff: added, removed and unchanged words, and the counts.
 * 2. Print Reports stops while a comment has unsaved changes, and goes
 *    ahead once they are discarded.
 * 3. Save writes the new text the way the Term Questionnaire saves a typed
 *    comment, and an approved comment then needs approving again.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'teacher/report-one-comment.js'), 'utf-8'), {
  filename: 'teacher/report-one-comment.js',
});

const C = () => ReportOneComment;
const T = () => ReportOneComment._test;
const CID = 'course-one-comment';
const TERM = 'term-2';
const PRI = { id: 'stu-pri', firstName: 'Priya', lastName: 'Nandi' };
const MAT = { id: 'stu-mat', firstName: 'Mateo', lastName: 'Silva' };

function makeApi(current) {
  let cur = current;
  return {
    cid: CID,
    view: () => 'one',
    student: () => cur,
    students: () => [MAT, PRI],
    goStudent: vi.fn(sid => {
      cur = [MAT, PRI].find(s => s.id === sid);
    }),
    ctx: () => ({ termId: TERM, termLabel: 'Term 2' }),
    fit: () => null,
    redraw: vi.fn(),
    announce: vi.fn(),
  };
}

let oldToast;
beforeAll(() => {
  oldToast = globalThis.showUndoToast;
});
beforeEach(() => {
  T().reset();
  _cache.students[CID] = [Object.assign({}, PRI), Object.assign({}, MAT)];
  _cache.termRatings[CID] = {};
  globalThis.showUndoToast = vi.fn();
});
afterEach(() => {
  globalThis.showUndoToast = oldToast;
});

describe('the word diff', () => {
  it('keeps unchanged words and marks added and removed ones', () => {
    const ops = T().diffOps('She reads every day.', 'She reads carefully every day.');
    expect(ops).toEqual([
      ['=', 'She reads '],
      ['+', 'carefully '],
      ['=', 'every day.'],
    ]);
    // "reads every day." became "reads.": the words that went are struck.
    const gone = T().diffOps('She reads every day.', 'She reads.');
    expect(gone[0]).toEqual(['=', 'She ']);
    expect(gone.filter(o => o[0] === '-').map(o => o[1].trim())).toEqual(['reads every day.']);
    expect(gone.filter(o => o[0] === '+').map(o => o[1].trim())).toEqual(['reads.']);
  });

  it('draws added words underlined and removed words struck, escaped', () => {
    const html = T().diffHtml('Works <well>.', 'Works <well> with others.');
    expect(html).toContain('<ins>');
    expect(html).toContain('<del>');
    expect(html).not.toContain('<well>');
    expect(T().diffHtml('Same words.', 'Same words.')).toBe('Same words.');
  });

  it('counts words added and removed', () => {
    expect(T().diffCount('one two three', 'one two three four five')).toEqual({ add: 2, del: 0 });
    expect(T().diffCount('one two three', 'one three')).toEqual({ add: 0, del: 1 });
    expect(T().countText('one two three', 'one two three four five six seven eight')).toBe('5 words added');
    expect(T().countText('one two three', 'one three four')).toBe('1 word added, 1 word removed');
    expect(T().countText('one two', 'one two')).toBe('No changes');
    expect(T().countText('one two', 'one two\n')).toBe('No changes');
    expect(T().countText('', 'A new comment of seven words here.')).toBe('7 words');
  });
});

describe('Print Reports', () => {
  it('stops while a comment has unsaved changes and goes ahead after Discard', () => {
    const api = makeApi(MAT);
    expect(C().beforePrint(api)).toBe(true);
    T().setDraft(CID, TERM, PRI.id, 'Priya asks good questions.');
    expect(C().beforePrint(api)).toBe(false);
    // It goes to the student whose comment is waiting.
    expect(api.goStudent).toHaveBeenCalledWith(PRI.id);
    T().discard(api, PRI.id);
    expect(api.announce).toHaveBeenCalledWith('Discarded');
    expect(C().beforePrint(api)).toBe(true);
  });

  it('only counts changes in this class and report', () => {
    const api = makeApi(MAT);
    T().setDraft('another-class', TERM, PRI.id, 'Elsewhere.');
    T().setDraft(CID, 'term-1', PRI.id, 'Another report.');
    expect(C().beforePrint(api)).toBe(true);
  });
});

describe('Save', () => {
  it('saves the new text through upsertTermRating as the questionnaire saves a typed comment', () => {
    upsertTermRating(CID, PRI.id, TERM, {
      narrative: 'Priya reads every day.',
      approvedAt: '2026-11-01T00:00:00.000Z',
      draftMeta: { v: 1, sentences: [], teacher_text: ['Priya reads every day.'] },
    });
    const api = makeApi(PRI);
    const spy = vi.spyOn(globalThis, 'upsertTermRating');
    T().setDraft(CID, TERM, PRI.id, 'Priya reads every day. She asks good questions.');
    T().save(api, PRI.id);
    expect(spy).toHaveBeenCalledTimes(1);
    const [cid, sid, term, data] = spy.mock.calls[0];
    expect([cid, sid, term]).toEqual([CID, PRI.id, TERM]);
    expect(data.narrative).toBe('Priya reads every day. She asks good questions.');
    expect('approvedAt' in data).toBe(false);
    expect(data.draftMeta.teacher_text).toEqual(['Priya reads every day.', 'She asks good questions.']);
    expect(data.draftMeta.name).toBe('Priya');
    spy.mockRestore();
    const r = getStudentTermRating(CID, PRI.id, TERM);
    expect(r.narrative).toBe('Priya reads every day. She asks good questions.');
    // An edit after approval clears it (upsertTermRating's rule).
    expect(r.approvedAt).toBe(null);
    expect(T().drafts()[CID + '|' + TERM + '|' + PRI.id]).toBeUndefined();
    expect(api.redraw).toHaveBeenCalled();
    expect(api.announce).toHaveBeenCalledWith('Saved');
    expect(showUndoToast).toHaveBeenCalledWith('Saved Priya’s comment', expect.any(Function));
    // Undo writes the comment as it was.
    showUndoToast.mock.calls[0][1]();
    expect(getStudentTermRating(CID, PRI.id, TERM).narrative).toBe('Priya reads every day.');
  });

  it('uses the questionnaire’s own save when it offers one', () => {
    const api = makeApi(PRI);
    const own = vi.fn();
    ReportQuestionnaire.saveNarrativeFor = own;
    try {
      T().setDraft(CID, TERM, PRI.id, 'A new comment.');
      T().save(api, PRI.id);
      expect(own).toHaveBeenCalledWith(CID, PRI.id, TERM, 'A new comment.');
    } finally {
      delete ReportQuestionnaire.saveNarrativeFor;
    }
  });

  it('never changes a grade: it writes only the comment and its record', () => {
    const api = makeApi(PRI);
    const spy = vi.spyOn(globalThis, 'upsertTermRating');
    T().setDraft(CID, TERM, PRI.id, 'Priya works carefully.');
    T().save(api, PRI.id);
    Object.keys(spy.mock.calls[0][3]).forEach(k => expect(['narrative', 'draftMeta']).toContain(k));
    spy.mockRestore();
  });
});
