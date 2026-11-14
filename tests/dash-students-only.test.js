/**
 * The Dashboard draws only what a click changed (teacher/page-dashboard.js).
 *
 * A search, the sort menu, a grid heading, a flag, Flagged and Cards | Grid
 * change only the students: they are drawn again in their own box
 * (#dash-students), with the toolbar's count, and the rest of the page (the
 * overview cards, Observations) stays. An observation added from a row's
 * "+" draws the Observations card and that student's card. Each of these
 * used to draw the whole page.
 *
 * Counted: whole-page draws (#main), overview draws, Observations card
 * draws. Checked: the students drawn alone are what a whole-page draw gives.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'dash-students-only';
const N = 12;

describe('the Dashboard draws the students alone', () => {
  let stub, doc, page, n, dialog;

  beforeEach(() => {
    localStorage.clear();
    stub = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      PageDashboard: globalThis.PageDashboard,
      voiceLoaded: StudentVoice.loaded,
      overview: DashOverview.renderOverviewPanel,
      obsCard: DashObservations.renderCard,
      openDialog: ObsCapture.openDialog,
      css: globalThis.CSS,
    };
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="sidebar-mount"></div><main id="main"></main></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
    globalThis.CSS = { escape: s => String(s) };
    Object.defineProperty(doc.defaultView.HTMLSelectElement.prototype, 'value', {
      get() {
        return this._value || '';
      },
      set(v) {
        this._value = v;
      },
      configurable: true,
    });
    doc.defaultView.HTMLElement.prototype.focus = function () {};
    doc.defaultView.HTMLElement.prototype.setSelectionRange = function () {};
    StudentVoice.loaded = () => true;
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [
        { id: 'sec1', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] },
        { id: 'sec2', name: 'Planning', tags: [{ id: 't2', label: 'Planning' }] },
      ],
      _customized: true,
      _version: 1,
    };
    saveStudents(
      CID,
      Array.from({ length: N }, (_, i) => ({
        id: 's' + i,
        firstName: (i % 2 ? 'Ana' : 'Ben') + i,
        lastName: 'L' + String(i).padStart(2, '0'),
      })),
    );
    _cache.observations[CID] = {};
    setActiveCourse(CID);
    saveDashboardPrefs({ studentView: 'cards' });
    runInThisContext(readFileSync(resolve(root, 'teacher/page-dashboard.js'), 'utf-8'), {
      filename: 'teacher/page-dashboard.js',
    });
    page = PageDashboard;
    page.init({});

    n = { page: 0, overview: 0, obsCard: 0 };
    const main = doc.getElementById('main');
    const desc = Object.getOwnPropertyDescriptor(doc.defaultView.Element.prototype, 'innerHTML');
    Object.defineProperty(main, 'innerHTML', {
      get() {
        return desc.get.call(this);
      },
      set(v) {
        n.page++;
        desc.set.call(this, v);
      },
      configurable: true,
    });
    DashOverview.renderOverviewPanel = function () {
      n.overview++;
      return stub.overview.apply(this, arguments);
    };
    DashObservations.renderCard = function () {
      n.obsCard++;
      return stub.obsCard.apply(this, arguments);
    };
    dialog = null;
    ObsCapture.openDialog = opts => {
      dialog = opts;
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    const remove = globalThis.removeEventListener;
    globalThis.removeEventListener = () => {};
    page.destroy();
    globalThis.removeEventListener = remove;
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.PageDashboard = stub.PageDashboard;
    globalThis.CSS = stub.css;
    StudentVoice.loaded = stub.voiceLoaded;
    DashOverview.renderOverviewPanel = stub.overview;
    DashObservations.renderCard = stub.obsCard;
    ObsCapture.openDialog = stub.openDialog;
    delete COURSES[CID];
    delete _cache.learningMaps[CID];
    delete _cache.observations[CID];
  });

  const ev = (el, type) => el.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true, cancelable: true }));
  // The cards' slide (is-sliding, a transform) is motion, not what is shown.
  const students = () =>
    doc
      .getElementById('dash-students')
      .innerHTML.replace(/ style="transform:[^"]*"/g, '')
      .replace(/ is-(sliding|placing)/g, '');
  const names = () => [...doc.querySelectorAll('#dash-students .dash-card[data-sid]')].map(c => c.dataset.sid);
  // What a whole-page draw shows for the students in the same state.
  function wholePage() {
    page.render();
    return students();
  }

  const ACTIONS = {
    search() {
      const el = doc.querySelector('.dash-search-input');
      el.value = 'ana';
      ev(el, 'input');
      vi.advanceTimersByTime(200);
    },
    'sort menu'() {
      const el = doc.querySelector('.dash-sort-select');
      el.value = 'first-desc';
      ev(el, 'change');
    },
    'grid heading'() {
      ev(doc.querySelector('[data-action="studentView"][data-view="grid"]'), 'click');
      ev(doc.querySelector('.dash-sg-sort[data-key="name"]'), 'click');
    },
    flag() {
      ev(doc.querySelector('.dash-card[data-sid="s3"] [data-action="toggleFlag"]'), 'click');
    },
    Flagged() {
      ev(doc.querySelector('.dash-card[data-sid="s3"] [data-action="toggleFlag"]'), 'click');
      ev(doc.querySelector('[data-action="toggleFlaggedFilter"]'), 'click');
    },
    'Cards | Grid'() {
      ev(doc.querySelector('[data-action="studentView"][data-view="grid"]'), 'click');
    },
  };

  Object.keys(ACTIONS).forEach(name => {
    it(name + ': the students alone, as a whole-page draw shows them', () => {
      ACTIONS[name]();
      expect(n).toEqual({ page: 0, overview: 0, obsCard: 0 });
      const alone = students();
      expect(wholePage()).toBe(alone);
    });
  });

  it('the search and Flagged filter the cards, and the toolbar counts them', () => {
    ACTIONS.search();
    expect(names()).toEqual(['s1', 's3', 's5', 's7', 's9', 's11']);
    expect(doc.querySelector('.dash-toolbar-label').textContent).toBe('6 Students');
    ACTIONS.Flagged();
    expect(names()).toEqual(['s3']);
    expect(doc.querySelector('[data-action="toggleFlaggedFilter"]').textContent).toContain('Flagged (1)');
  });

  it('an observation from a row’s "+" draws the Observations card and that student’s card', () => {
    ev(doc.querySelector('[data-action="obsAdd"][data-sid="s4"]'), 'click');
    expect(dialog).toBeTruthy();
    const other = doc.querySelector('.dash-card[data-sid="s5"]');
    addQuickOb(CID, 's4', 'Asked a good question', [], 'strength', null);
    dialog.onAdd({ studentIds: ['s4'], ok: true });
    vi.advanceTimersByTime(10);
    expect(n).toEqual({ page: 0, overview: 0, obsCard: 1 });
    expect(doc.querySelector('.dash-card[data-sid="s5"]')).toBe(other);
    expect(doc.querySelector('.dash-card[data-sid="s4"]').textContent).toContain('Last observed today');
    const alone = students();
    expect(wholePage()).toBe(alone);
  });

  it('an observation tagged with a Core Competency draws the whole page (its count changes)', () => {
    ev(doc.querySelector('[data-action="obsAdd"][data-sid="s4"]'), 'click');
    addQuickOb(CID, 's4', 'Worked well with others', ['cc:COL'], 'strength', null);
    dialog.onAdd({ studentIds: ['s4'], ok: true });
    vi.advanceTimersByTime(10);
    expect(n.page).toBe(1);
  });
});
