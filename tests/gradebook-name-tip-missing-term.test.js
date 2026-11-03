/**
 * The name tip's missing count counted every term (Nov 3 bug sweep,
 * Gradebook group 3). In a Letter class viewed in Term 2, the tip showed
 * the Term 2 grade and, under it, "2 assessments missing" for Term 1 work
 * that doesn't count toward that grade. It now counts the term on screen,
 * as the grade and the category rows do.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cA';
const quiz = (id, date) => ({ id, title: id, scoreMode: 'points', maxPoints: 10, tagIds: ['T1'], date });

let stubDocument;
let win;

beforeEach(() => {
  localStorage.clear();
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div>' +
      '<div id="gb-tooltip"></div></body></html>',
  );
  win = dom.window;
  const doc = dom.document;
  const make = doc.createElement.bind(doc);
  // The slanted header measures its titles on a canvas; the tip places
  // itself under the row.
  doc.createElement = tag => {
    const el = make(tag);
    if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
    return el;
  };
  win.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 20, width: 100, height: 20 });
  globalThis.document = doc;
  globalThis.CSS = { escape: s => String(s) };
  globalThis.getComputedStyle = () => ({});
  PageAssignments.graderOpen = () => false;
  runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem: 'letter' };
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
  // Two Term 1 quizzes marked Missing; a Term 2 quiz with a score.
  _cache.assessments[CID] = [quiz('t1a', '2026-10-01'), quiz('t1b', '2026-10-08'), quiz('t2', '2026-12-01')];
  _cache.scores[CID] = { s1: [{ assessmentId: 't2', tagId: 'T1', score: 8, date: '2026-12-01', note: '' }] };
  _cache.statuses[CID] = { 's1:t1a': 'NS', 's1:t1b': 'NS' };
  _cache.courseConfigs[CID] = {
    reportingTerms: [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-15' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-11-16', ends_on: '2027-01-31' },
    ],
  };
});

afterEach(() => {
  PageGradebook.destroy();
  setSelectedTermOrdinal(CID, null);
  delete COURSES[CID];
  globalThis.document = stubDocument;
});

function nameTip() {
  PageGradebook.init({ course: CID });
  document.querySelector('.gb-grid-rowhead-name').dispatchEvent(new win.Event('focusin', { bubbles: true }));
  return document.getElementById('gb-tooltip').textContent;
}

describe('the name tip missing count', () => {
  it('leaves out Missing work from another term', () => {
    setSelectedTermOrdinal(CID, 2);
    expect(nameTip()).not.toContain('missing');
  });

  it('counts Missing work in the term on screen', () => {
    setSelectedTermOrdinal(CID, 1);
    expect(nameTip()).toContain('2 assessments missing (count as 0)');
  });
});
