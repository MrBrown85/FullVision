/**
 * Clear Score on Advanced Rubric work takes the ticked checkboxes off with
 * the levels (#809). Cmd+Z put the levels back but not the ticks, so the
 * tick record was gone for good from the grader, the printed rubric and the
 * phone (Nov 3 bug sweep, Gradebook group 1). Cmd+Z now ticks them again.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cA';
const rubric = {
  id: 'r1',
  name: 'Lab Skills',
  style: 'advanced',
  criteria: [
    {
      id: 'k-crit',
      name: 'Safety',
      tagIds: ['T1'],
      levels: { 4: 'Leads', 3: 'Follows every step', 2: 'Needs reminders', 1: 'Needs many reminders' },
      checks: [
        { id: 'k1', level: 3, label: 'Goggles on' },
        { id: 'k2', level: 3, label: 'Cleans the station' },
        { id: 'k3', level: 4, label: 'Reminds others' },
      ],
    },
  ],
};
const lab = {
  id: 'a1',
  title: 'Lab',
  scoreMode: 'proficiency',
  rubricId: 'r1',
  tagIds: ['T1'],
  date: '2026-10-10',
  type: 'summative',
};

let stubDocument;
let win;

beforeEach(() => {
  localStorage.clear();
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  );
  win = dom.window;
  const doc = dom.document;
  const make = doc.createElement.bind(doc);
  // The slanted header measures its titles on a canvas.
  doc.createElement = tag => {
    const el = make(tag);
    if (tag === 'canvas') el.getContext = () => ({ measureText: () => ({ width: 50 }) });
    return el;
  };
  globalThis.document = doc;
  globalThis.CSS = { escape: s => String(s) };
  globalThis.getComputedStyle = () => ({});
  PageAssignments.graderOpen = () => false;
  runInThisContext(readFileSync('teacher/page-gradebook.js', 'utf-8'), { filename: 'teacher/page-gradebook.js' });
  _cache.students[CID] = [{ id: 's1', firstName: 'Ava', lastName: 'Test' }];
  _cache.rubrics[CID] = [rubric];
  _cache.assessments[CID] = [lab];
  _cache.scores[CID] = { s1: [{ assessmentId: 'a1', tagId: 'T1', score: 3, date: '2026-10-10', note: '' }] };
  _cache.rubricChecks[CID] = { 's1:a1': ['k1', 'k2'] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
  PageGradebook.init({ course: CID });
});

afterEach(() => {
  PageGradebook.destroy();
  globalThis.document = stubDocument;
});

describe('Cmd+Z after Clear Score on Advanced Rubric work', () => {
  it('puts back the ticks with the level', () => {
    const cell = document.querySelector('.gb-scores-cell[data-aid="a1"][data-sid="s1"]');
    cell.dispatchEvent(new win.Event('contextmenu', { bubbles: true, cancelable: true }));
    document.querySelector('[data-ctx="clearCell"]').dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(getScores(CID).s1).toEqual([]);
    expect(getRubricCheckIds(CID, 's1', 'a1')).toEqual([]);

    const z = new win.Event('keydown', { bubbles: true, cancelable: true });
    z.key = 'z';
    z.metaKey = true;
    document.body.dispatchEvent(z);
    expect(getScores(CID).s1.map(e => e.score)).toEqual([3]);
    expect(getRubricCheckIds(CID, 's1', 'a1')).toEqual(['k1', 'k2']);
  });
});
