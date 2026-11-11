/**
 * An observation saved from a reflection stays private when it is edited
 * (S10 follow-up to PR 1092, Colin's ruling 110, "Keep private"). Its
 * context, 'reflection', is the mark that keeps the student's words out of
 * every report, so it is kept for good:
 * - the data layer's save (updateQuickOb) refuses to change it, in Demo Mode
 *   and signed in (what goes to update_observation), so no screen can;
 * - the Observations page's edit card (also opened from a student's
 *   evidence, PageObservations.openEditor) shows the context as fixed with
 *   the line "From a reflection. Not used in reports.";
 * - the grader's comment editor changes only the text.
 * (The phone's sheet: tests/mobile-observe-reflection.test.js.)
 * Every other path that copies an observation keeps the mark or leaves it
 * out: Download All My Data says so in the Type column; Duplicate Class
 * copies no observations; a class backup and restore keeps it
 * (tests/backup-restore.test.js). The app has no way to duplicate one
 * observation or move it to another student.
 * After each edit, both report doors still leave it out.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

runInThisContext(readFileSync(resolve(__dirname, '../teacher/page-observations.js'), 'utf-8'), {
  filename: 'teacher/page-observations.js',
});
runInThisContext(readFileSync(resolve(__dirname, '../teacher/export-all.js'), 'utf-8'), {
  filename: 'teacher/export-all.js',
});

const CID = 'f1111111-1111-4111-8111-1111111111cc';
const SID = 'f3333333-3333-4333-8333-3333333333cc';
const OB_ID = 'f4444444-4444-4444-8444-4444444444cc';
const ST = { id: SID, firstName: 'Cy', lastName: 'Young' };
const WORDS = 'Next time I’ll find all three reasons first.';
const LINE = 'From a reflection. Not used in reports.';

function seed() {
  localStorage.clear();
  localStorage.setItem('gb-demo-mode', '1');
  COURSES[CID] = { id: CID, name: 'English 10', gradingSystem: 'proficiency' };
  _cache.students[CID] = [ST];
  _cache.observations[CID] = {};
  saveQuickObs(CID, {
    [SID]: [
      {
        id: OB_ID,
        text: 'Plan after Letter: “' + WORDS + '”',
        sentiment: 'note',
        context: 'reflection',
        dims: [],
        date: '2026-10-10',
        created: '2026-10-10T18:00:00.000Z',
      },
      {
        id: 'other',
        text: 'Led the lab group.',
        sentiment: 'strength',
        dims: [],
        date: '2026-10-11',
        created: '2026-10-11T18:00:00.000Z',
      },
    ],
  });
}

function theOb() {
  return getQuickObs(CID)[SID].find(o => o.id === OB_ID);
}

// Both doors a report has to an observation still leave it out.
function expectKeptOutOfReports() {
  expect(theOb().context).toBe('reflection');
  expect(ReportBlocks.renderBlockObservations(CID, ST)).not.toContain(WORDS);
  expect(ReportFeedback.observations(CID, ST, null).map(r => r.text)).toEqual(['Led the lab group.']);
}

beforeEach(seed);
afterEach(() => {
  delete COURSES[CID];
  localStorage.clear();
});

describe('the data layer keeps the context', () => {
  it('in Demo Mode, a new context is refused; text, type and tags still change', () => {
    updateQuickOb(CID, SID, OB_ID, { context: 'discussion', sentiment: 'strength', text: 'Plan: ' + WORDS });
    expect(theOb().context).toBe('reflection');
    expect(theOb().sentiment).toBe('strength');
    expect(theOb().text).toBe('Plan: ' + WORDS);
    expectKeptOutOfReports();
    updateQuickOb(CID, SID, OB_ID, { context: null });
    expectKeptOutOfReports();
    updateQuickOb(CID, SID, OB_ID, { context: '' });
    expectKeptOutOfReports();
  });

  it('signed in, update_observation still sends the reflection context', async () => {
    var calls = [];
    var keep = { getSupabase: globalThis.getSupabase, use: _useSupabase };
    localStorage.removeItem('gb-demo-mode');
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    globalThis.getSupabase = () => ({
      rpc(name, payload) {
        calls.push({ name, payload });
        return Promise.resolve({ data: null, error: null });
      },
    });
    try {
      updateQuickOb(CID, SID, OB_ID, { context: 'independent', sentiment: 'growth' });
      await new Promise(r => setTimeout(r, 0));
    } finally {
      globalThis.getSupabase = keep.getSupabase;
      _useSupabase = keep.use;
    }
    var call = calls.find(c => c.name === 'update_observation');
    expect(call).toBeTruthy();
    expect(call.payload.p_patch.context_type).toBe('reflection');
    expect(call.payload.p_patch.sentiment).toBe('growth');
    expectKeptOutOfReports();
  });

  it('any other observation still takes a new context', () => {
    updateQuickOb(CID, SID, 'other', { context: 'discussion' });
    expect(getQuickObs(CID)[SID].find(o => o.id === 'other').context).toBe('discussion');
  });

  it('the grader’s comment editor (text only) keeps it', () => {
    updateQuickOb(CID, SID, OB_ID, { text: 'Edited: ' + WORDS });
    expectKeptOutOfReports();
  });
});

describe('the Observations page’s edit card', () => {
  var dom;
  var origDoc;
  beforeEach(() => {
    dom = parseHTML('<!doctype html><html><body></body></html>');
    origDoc = globalThis.document;
    globalThis.document = dom.document;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.document = origDoc;
  });

  function card() {
    return dom.document.querySelector('.obs-focus-card');
  }
  // The card closes after its fade (a 200 ms timer, moved on here).
  async function closed() {
    await vi.waitFor(() => {
      vi.advanceTimersByTime(250);
      expect(dom.document.querySelector('.obs-focus-backdrop')).toBeNull();
    });
  }
  function click(sel) {
    var el = card().querySelector(sel);
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  }

  it('shows the context as fixed, with the line, and Save keeps it', async () => {
    expect(PageObservations.openEditor(CID, SID, OB_ID, {})).toBe(true);
    var row = card().querySelector('.obs-focus-row');
    expect(row.textContent).toContain('Context');
    expect(row.textContent).toContain(LINE);
    expect(row.querySelector('[data-action="focusToggleCtxMenu"]')).toBeNull();
    expect(row.querySelector('[data-action="focusPickContext"]')).toBeNull();
    // Change the type and save.
    click('[data-sentiment="strength"]');
    click('[data-action="focusSave"]');
    expect(theOb().sentiment).toBe('strength');
    expectKeptOutOfReports();
    await closed();
  });

  it('another observation still has its context menu', async () => {
    expect(PageObservations.openEditor(CID, SID, 'other', {})).toBe(true);
    var row = card().querySelector('.obs-focus-row');
    expect(row.querySelector('[data-action="focusToggleCtxMenu"]')).not.toBeNull();
    expect(row.textContent).not.toContain(LINE);
    click('[data-action="focusSave"]');
    await closed();
  });
});

describe('paths that copy an observation', () => {
  it('Download All My Data keeps the mark in the Type column', () => {
    var sheets = ExportAll.rows({ cids: [CID], teacher: 'T', date: '2026-11-11' });
    var obs = sheets.find(s => s.name === 'Observations').rows;
    var mine = obs.find(r => String(r[6]).indexOf(WORDS) >= 0);
    expect(mine[3]).toBe('Note · ' + LINE);
    var other = obs.find(r => r[6] === 'Led the lab group.');
    expect(other[3]).toBe('Strength');
  });

  it('Duplicate Class copies no observations', () => {
    var before = Object.keys(COURSES);
    DashClassManager.duplicateCourse(CID, '');
    var copy = Object.keys(COURSES).find(id => before.indexOf(id) < 0);
    expect(copy).toBeTruthy();
    expect(getAllQuickObs(copy)).toEqual([]);
    delete COURSES[copy];
  });
});
