/**
 * The phone's observation sheet keeps an observation from a reflection
 * private (S10 follow-up to PR 1092, ruling 110): its Context row is fixed,
 * with the line "From a reflection. Not used in reports.", no picker opens,
 * and Save keeps the context 'reflection' through the real data layer, so
 * both report doors still leave the student's words out. The data layer's
 * own guard: tests/reflection-observation-locked.test.js.
 */
import './setup-mobile.js';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'f1111111-1111-4111-8111-1111111111dd';
const SID = 'f3333333-3333-4333-8333-3333333333dd';
const OB_ID = 'f4444444-4444-4444-8444-4444444444dd';
const ST = { id: SID, firstName: 'Cy', lastName: 'Young' };
const WORDS = 'Next time I’ll find all three reasons first.';
const LINE = 'From a reflection. Not used in reports.';

const keep = {};
beforeEach(() => {
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
    ],
  });
  keep.getActiveCourse = globalThis.getActiveCourse;
  globalThis.getActiveCourse = () => CID;
  keep.ui = {
    dismissSheet: MComponents.dismissSheet,
    showToast: MComponents.showToast,
    presentSheet: MComponents.presentSheet,
  };
});
afterEach(() => {
  globalThis.getActiveCourse = keep.getActiveCourse;
  Object.assign(MComponents, keep.ui);
  MObserve.resetSheetState();
  delete COURSES[CID];
  localStorage.clear();
});

function withSheet(fn) {
  const dom = parseHTML('<!doctype html><html><body><div id="sheet"></div></body></html>');
  const origDoc = globalThis.document;
  globalThis.document = dom.document;
  Object.assign(MComponents, {
    presentSheet: html => {
      dom.document.getElementById('sheet').innerHTML = html;
    },
    dismissSheet() {},
    showToast() {},
  });
  try {
    return fn(dom.document.getElementById('sheet'));
  } finally {
    globalThis.document = origDoc;
  }
}

function theOb() {
  return getQuickObs(CID)[SID].find(o => o.id === OB_ID);
}

describe('the phone’s edit sheet, for an observation from a reflection', () => {
  it('shows Context as a fixed row with the line, and opens no picker', () => {
    withSheet(sheet => {
      MObserve.presentEditObsSheet(CID, SID, OB_ID);
      const row = sheet.querySelector('#m-obs-ctx-row');
      expect(row.tagName).toBe('DIV');
      expect(row.getAttribute('data-action')).toBeNull();
      expect(row.textContent).toContain('Context');
      expect(row.textContent).toContain(LINE);
      MObserve.openPicker('context');
      expect(sheet.querySelector('#m-obs-edit-picker').hidden).toBe(true);
    });
  });

  it('Save keeps the context, whatever is picked, and the words stay out of reports', () => {
    withSheet(sheet => {
      MObserve.presentEditObsSheet(CID, SID, OB_ID);
      MObserve.pick('context', 'independent');
      MObserve.setContext('discussion');
      MObserve.setSentiment('strength');
      sheet.querySelector('#m-obs-text').value = 'Plan: ' + WORDS;
      MObserve.saveObservation(CID);
    });
    expect(theOb().sentiment).toBe('strength');
    expect(theOb().context).toBe('reflection');
    expect(ReportBlocks.renderBlockObservations(CID, ST)).not.toContain(WORDS);
    expect(ReportFeedback.observations(CID, ST, null)).toEqual([]);
  });

  it('another observation still opens the Context picker', () => {
    saveQuickObs(CID, {
      [SID]: [
        { id: 'plain', text: 'Led the group.', sentiment: 'strength', dims: [], created: '2026-10-11T18:00:00Z' },
      ],
    });
    withSheet(sheet => {
      MObserve.presentEditObsSheet(CID, SID, 'plain');
      const row = sheet.querySelector('#m-obs-ctx-row');
      expect(row.getAttribute('data-action')).toBe('m-obs-picker');
      expect(row.textContent).not.toContain(LINE);
      MObserve.pick('context', 'independent');
      MObserve.saveObservation(CID);
    });
    expect(getQuickObs(CID)[SID][0].context).toBe('independent');
  });
});
