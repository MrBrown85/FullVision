/**
 * The Observations page's feed, counted (teacher/page-observations.js).
 *
 *  - The class's observations and the cards' context (names, quotes, the
 *    same-capture groups) are worked out once per change to them. A search
 *    or a filter used to read every observation two or three times over
 *    (getAllQuickObs) and build the context again.
 *  - The feed shows the newest 50 that pass the filters, with Show More.
 *    It used to draw every card (200 in a busy class) on each search.
 *  - A student clicked in the list beside the page filters the feed; it
 *    used to draw the whole page again.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'obs-feed-speed';
const N = 30;
const PER = 7; // 210 observations

describe('the Observations feed', () => {
  let stub, doc, page, reads, contexts, pages;

  beforeEach(() => {
    localStorage.clear();
    stub = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      CustomEvent: globalThis.CustomEvent,
      PageObservations: globalThis.PageObservations,
      getAllQuickObs: globalThis.getAllQuickObs,
      context: ObsCard.context,
    };
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="page-toolbar-mount"></div><div id="sidebar-mount"></div><main id="main"></main></div></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.CustomEvent = doc.defaultView.CustomEvent; // the re-key's event, on this document
    globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    const students = Array.from({ length: N }, (_, i) => ({
      id: 's' + i,
      firstName: 'F' + i,
      lastName: 'L' + String(i).padStart(2, '0'),
    }));
    saveStudents(CID, students);
    const obs = {};
    students.forEach((st, i) => {
      obs[st.id] = Array.from({ length: PER }, (_, k) => {
        const day = String(1 + ((i * PER + k) % 28)).padStart(2, '0');
        return {
          id: 'o' + i + '-' + k,
          text: (k % 2 ? 'Asked a question about ' : 'Shared a plan for ') + 'topic ' + k,
          dims: [],
          sentiment: k % 3 ? 'strength' : null,
          date: '2026-10-' + day,
          created: '2026-10-' + day + 'T1' + (k % 10) + ':00:00.000Z',
        };
      });
    });
    _cache.observations[CID] = obs;
    setActiveCourse(CID);
    runInThisContext(readFileSync(resolve(root, 'teacher/page-observations.js'), 'utf-8'), {
      filename: 'teacher/page-observations.js',
    });
    page = PageObservations;
    reads = 0;
    contexts = 0;
    pages = 0;
    globalThis.getAllQuickObs = function () {
      reads++;
      return stub.getAllQuickObs.apply(this, arguments);
    };
    ObsCard.context = function () {
      contexts++;
      return stub.context.apply(this, arguments);
    };
    page.init({ course: CID });
    // Count whole-page draws from here on.
    const main = doc.getElementById('main');
    const desc =
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(main)), 'innerHTML') ||
      Object.getOwnPropertyDescriptor(doc.defaultView.Element.prototype, 'innerHTML');
    Object.defineProperty(main, 'innerHTML', {
      get() {
        return desc.get.call(this);
      },
      set(v) {
        pages++;
        desc.set.call(this, v);
      },
      configurable: true,
    });
    reads = 0;
    contexts = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    page.destroy();
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.CustomEvent = stub.CustomEvent;
    globalThis.PageObservations = stub.PageObservations;
    globalThis.getAllQuickObs = stub.getAllQuickObs;
    ObsCard.context = stub.context;
    delete COURSES[CID];
    delete _cache.observations[CID];
  });

  const cards = () => doc.querySelectorAll('#obs-feed .obs-card').length;
  const count = () => doc.getElementById('obs-count').textContent;
  function search(text) {
    const el = doc.getElementById('obs-search-input');
    el.value = text;
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
  }
  function click(el) {
    el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
  }

  it('shows the newest 50, then 50 more on Show More', () => {
    expect(cards()).toBe(50);
    expect(count()).toBe(N * PER + ' observations');
    const more = doc.querySelector('#obs-feed [data-action="obsShowMore"]');
    expect(more.textContent).toBe('Show More');
    expect(doc.querySelector('.obs-feed-more').textContent).toContain('Showing the newest 50 of ' + N * PER);
    let focused = null;
    doc.defaultView.HTMLElement.prototype.focus = function () {
      focused = this;
    };
    click(more);
    expect(cards()).toBe(100);
    // The first card that was not there before has focus.
    expect(focused && focused.getAttribute('data-obid')).toBe(
      doc.querySelectorAll('#obs-feed .obs-card')[50].getAttribute('data-obid'),
    );
  });

  it('the newest come first, as before', () => {
    const shown = [...doc.querySelectorAll('#obs-feed .obs-card')].map(c => c.getAttribute('data-obid'));
    const newest = stub
      .getAllQuickObs(CID)
      .slice(0, 50)
      .map(o => o.id);
    expect(shown.sort()).toEqual(newest.sort());
  });

  it('a search reads the observations no more and builds no context', () => {
    search('question');
    search('plan');
    search('topic 3');
    expect(reads).toBe(0);
    expect(contexts).toBe(0);
    expect(count()).toBe(N + ' of ' + N * PER + ' observations');
    expect(cards()).toBe(N);
    expect(pages).toBe(0);
  });

  it('a search finds what it found before: the note, the name and the context', () => {
    search('l07');
    expect(cards()).toBe(PER);
    search('nothing like this');
    expect(doc.querySelector('.obs-empty-title').textContent).toBe('No matching observations');
  });

  it('a student picked in the list filters the feed without drawing the page again', () => {
    const row = doc.querySelector('#gb-roster-list .student-row');
    expect(row).toBeTruthy();
    click(row);
    expect(pages).toBe(0);
    expect(cards()).toBe(PER);
    expect(doc.getElementById('filter-student-btn').classList.contains('active')).toBe(true);
  });

  /* A save lands: the server id is swapped in on the stored observation, and
     the list and its count stay the same (PR #1421 review). */
  const ids = () => [...doc.querySelectorAll('#obs-feed .obs-card')].map(c => c.getAttribute('data-obid'));
  const stored = () => getQuickObs(CID).s0.map(o => o.id);
  function addAndLand(text) {
    addQuickOb(CID, 's0', text, [], 'strength', null);
    page.render();
    const local = stored().find(id => id.startsWith('qo_'));
    _rekey(CID, 'observation', local, 'srv-' + local);
    return { local, server: 'srv-' + local };
  }

  it('an added observation that reached the server is found, opened and deleted by its server id', () => {
    const { local, server } = addAndLand('Brand new note');
    // The card already on screen takes the server id.
    expect(ids()).toContain(server);
    expect(ids()).not.toContain(local);
    search('brand new');
    expect(ids()).toEqual([server]);
    click(doc.querySelector('#obs-feed .obs-card'));
    expect(doc.getElementById('obs-focus-backdrop')).toBeTruthy();
    click(doc.querySelector('#obs-focus-backdrop [data-action="closeFocus"]'));
    click(doc.querySelector('#obs-feed .obs-card-delete'));
    expect(ids()).toEqual([]);
    vi.advanceTimersByTime(7000);
    expect(stored()).not.toContain(server);
    expect(stored()).toHaveLength(PER);
  });

  it('an observation re-keyed in place is edited by its server id, and a search finds the edit', () => {
    const { server } = addAndLand('First wording');
    search('first wording');
    click(doc.querySelector('#obs-feed .obs-card'));
    const ta = doc.getElementById('focus-textarea');
    expect(ta).toBeTruthy();
    ta.value = 'Second wording';
    ta.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    click(doc.querySelector('#obs-focus-backdrop [data-action="focusSave"]'));
    expect(getQuickObs(CID).s0.find(o => o.id === server).text).toBe('Second wording');
    search('second wording');
    expect(ids()).toEqual([server]);
  });

  it('a delete waiting on Undo when the save lands still deletes', () => {
    addQuickOb(CID, 's0', 'Gone soon', [], 'strength', null);
    page.render();
    click(doc.querySelector('#obs-feed .obs-card-delete'));
    const local = stored().find(id => id.startsWith('qo_'));
    _rekey(CID, 'observation', local, 'srv-' + local);
    expect(ids()).not.toContain('srv-' + local);
    vi.advanceTimersByTime(7000);
    expect(stored()).toHaveLength(PER);
  });

  it('Show More puts focus on the first new card when an observation was dated before it was written', () => {
    // Written last, observed a month before the rest: drawn at the bottom.
    getQuickObs(CID).s1.push({
      id: 'late-entry',
      text: 'Written up late',
      dims: [],
      date: '2026-09-01',
      created: '2026-10-30T12:00:00.000Z',
    });
    page.render();
    const before = new Set(ids());
    let focused = null;
    doc.defaultView.HTMLElement.prototype.focus = function () {
      focused = this;
    };
    click(doc.querySelector('#obs-feed [data-action="obsShowMore"]'));
    const firstNew = ids().find(id => !before.has(id));
    expect(focused && focused.getAttribute('data-obid')).toBe(firstNew);
  });

  it('an added observation is in the feed at once', () => {
    addQuickOb(CID, 's0', 'Brand new note', [], 'strength', null);
    page.render();
    expect(doc.querySelector('#obs-feed .obs-card-text').textContent).toBe('Brand new note');
    expect(count()).toBe(N * PER + 1 + ' observations');
  });
});
