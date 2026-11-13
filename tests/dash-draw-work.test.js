/**
 * Work the Dashboard used to repeat on every draw, counted:
 *
 *  - Each competency chip on each student card worked out every column's
 *    code for the class again (DashInsights.columnCode). The codes are now
 *    worked out once a draw.
 *  - getStudentQuickObs sorted the student's list in place on every call,
 *    several calls a student a draw. A list already in order is handed back
 *    as it is.
 *  - After every draw the Observations card was measured in the click,
 *    which lays the page out again. Drawn to the stored width, it is now
 *    measured in the next frame and drawn again only if the width moved.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'dash-draw-work';
const N = 30;
const SECTIONS = ['Questioning', 'Planning', 'Processing', 'Evaluating', 'Communicating'];

describe('getStudentQuickObs', () => {
  const realSort = Array.prototype.sort;
  let sorts = 0;
  beforeEach(() => {
    _cache.observations[CID] = {
      s1: [
        { id: 'a', created: '2026-10-01T10:00:00Z' },
        { id: 'b', created: '2026-10-03T10:00:00Z' },
        { id: 'c', created: '2026-10-02T10:00:00Z' },
        { id: 'd' },
      ],
    };
    sorts = 0;
    Array.prototype.sort = function () {
      sorts++;
      return realSort.apply(this, arguments);
    };
  });
  afterEach(() => {
    Array.prototype.sort = realSort;
    delete _cache.observations[CID];
  });

  it('sorts the list newest first once, then hands it back as it is', () => {
    const first = getStudentQuickObs(CID, 's1');
    expect(first.map(o => o.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sorts).toBe(1);
    const again = getStudentQuickObs(CID, 's1');
    expect(again).toBe(first);
    expect(again.map(o => o.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sorts).toBe(1);
  });

  it('sorts again when a newer observation is added', () => {
    getStudentQuickObs(CID, 's1');
    _cache.observations[CID].s1.push({ id: 'e', created: '2026-10-05T10:00:00Z' });
    expect(getStudentQuickObs(CID, 's1').map(o => o.id)).toEqual(['e', 'b', 'c', 'a', 'd']);
    expect(getStudentQuickObs(CID, 'nobody')).toEqual([]);
  });
});

describe('the Dashboard draw', () => {
  let stub, doc, page, frames, measures, paneWidth;

  beforeEach(() => {
    localStorage.clear();
    stub = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      PageDashboard: globalThis.PageDashboard,
      voiceLoaded: StudentVoice.loaded,
      raf: globalThis.requestAnimationFrame,
      columnCode: DashInsights.columnCode,
      columnCodes: DashInsights.columnCodes,
      renderCard: DashObservations.renderCard,
    };
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="sidebar-mount"></div><main id="main"></main></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
    Object.defineProperty(doc.defaultView.HTMLSelectElement.prototype, 'value', {
      get() {
        return this._value || '';
      },
      set(v) {
        this._value = v;
      },
      configurable: true,
    });
    // Widths: #main is 1000 wide; the Observations pane's width is counted.
    measures = 0;
    paneWidth = 900;
    Object.defineProperty(doc.defaultView.HTMLElement.prototype, 'clientWidth', {
      get() {
        if (this.id === 'main') return 1000;
        if (this.classList && this.classList.contains('dash-ob2-pane')) {
          measures++;
          return paneWidth;
        }
        return 0;
      },
      configurable: true,
    });
    frames = [];
    globalThis.requestAnimationFrame = fn => frames.push(fn);
    StudentVoice.loaded = () => true;

    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: SECTIONS.map((name, i) => ({ id: 'sec' + i, name, tags: [{ id: 't' + i, label: name }] })),
      _customized: true,
      _version: 1,
    };
    saveStudents(
      CID,
      Array.from({ length: N }, (_, i) => ({
        id: 's' + i,
        firstName: 'F' + i,
        lastName: 'L' + String(i).padStart(2, '0'),
      })),
    );
    setActiveCourse(CID);
    runInThisContext(readFileSync(resolve(root, 'teacher/page-dashboard.js'), 'utf-8'), {
      filename: 'teacher/page-dashboard.js',
    });
    page = PageDashboard;
    page.init({});
    flush();
  });

  afterEach(() => {
    const remove = globalThis.removeEventListener;
    globalThis.removeEventListener = () => {};
    page.destroy();
    globalThis.removeEventListener = remove;
    delete doc.defaultView.HTMLElement.prototype.clientWidth;
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.PageDashboard = stub.PageDashboard;
    globalThis.requestAnimationFrame = stub.raf;
    StudentVoice.loaded = stub.voiceLoaded;
    DashInsights.columnCode = stub.columnCode;
    DashInsights.columnCodes = stub.columnCodes;
    DashObservations.renderCard = stub.renderCard;
    delete COURSES[CID];
    delete _cache.learningMaps[CID];
  });

  function flush() {
    while (frames.length) frames.shift()();
  }
  function sortBy(value) {
    const sel = doc.querySelector('.dash-sort-select');
    sel.value = value;
    sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  }

  it('works the column codes out once a draw', () => {
    let one = 0;
    let all = 0;
    DashInsights.columnCode = function () {
      one++;
      return stub.columnCode.apply(this, arguments);
    };
    DashInsights.columnCodes = function () {
      all++;
      return stub.columnCodes.apply(this, arguments);
    };
    sortBy('last-desc');
    expect(doc.querySelectorAll('.dash-card-strip.is-chips .dash-card-seg').length).toBe(N * SECTIONS.length);
    expect(one).toBe(0);
    // The cards' once, and the Curricular Competencies card's own.
    expect(all).toBeLessThanOrEqual(2);
    const codes = stub.columnCodes(CID);
    const chip = doc.querySelector('.dash-card-seg[data-key]');
    expect(chip.textContent.startsWith(codes[chip.getAttribute('data-key')])).toBe(true);
  });

  it('measures the Observations card after the click, not in it', () => {
    let drawn = 0;
    DashObservations.renderCard = function () {
      drawn++;
      return stub.renderCard.apply(this, arguments);
    };
    measures = 0;
    sortBy('last-desc');
    expect(measures).toBe(0);
    expect(drawn).toBe(1);
    flush();
    expect(measures).toBeGreaterThan(0);
    // The width did not move: the card is not drawn again.
    expect(drawn).toBe(1);
  });

  it('draws the Observations card again when the width moved', () => {
    sortBy('last-desc');
    let drawn = 0;
    DashObservations.renderCard = function () {
      drawn++;
      return stub.renderCard.apply(this, arguments);
    };
    paneWidth = 300;
    flush();
    expect(drawn).toBeGreaterThan(0);
  });
});
