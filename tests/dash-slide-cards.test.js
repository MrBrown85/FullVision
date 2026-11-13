/**
 * After a sort, the Dashboard's student cards slide to their new places
 * (DashStudentCards.cardsBefore and slideFrom). Each card's new place is
 * read before any card is moved. Reading a place after moving another card
 * makes the browser lay the page out again: once for each card, up to 30 a
 * sort, on the code before.
 *
 * Counted here as layouts forced: a place read after a class change, with
 * nothing read in between.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'dash-slide';
const N = 20;

describe('the student cards slide after a sort', () => {
  let stub, doc, page, forced, reads, dirty, restore;

  beforeEach(() => {
    localStorage.clear();
    stub = {
      document: globalThis.document,
      getComputedStyle: globalThis.getComputedStyle,
      PageDashboard: globalThis.PageDashboard,
      voiceLoaded: StudentVoice.loaded,
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
    StudentVoice.loaded = () => true;
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
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

    // The meter: a card's place depends on its index in the grid.
    forced = 0;
    reads = 0;
    dirty = false;
    const El = doc.defaultView.HTMLElement.prototype;
    const tokens = Object.getPrototypeOf(doc.body.classList);
    const was = { rect: El.getBoundingClientRect, add: tokens.add, remove: tokens.remove, toggle: tokens.toggle };
    El.getBoundingClientRect = function () {
      reads++;
      if (dirty) forced++;
      dirty = false;
      const i = Array.prototype.indexOf.call(this.parentNode ? this.parentNode.children : [], this);
      return { left: (i % 4) * 200, top: Math.floor(i / 4) * 150, width: 190, height: 140 };
    };
    ['add', 'remove', 'toggle'].forEach(name => {
      tokens[name] = function () {
        dirty = true;
        return was[name].apply(this, arguments);
      };
    });
    restore = () => {
      El.getBoundingClientRect = was.rect;
      tokens.add = was.add;
      tokens.remove = was.remove;
      tokens.toggle = was.toggle;
    };
  });

  afterEach(() => {
    restore();
    const remove = globalThis.removeEventListener;
    globalThis.removeEventListener = () => {};
    page.destroy();
    globalThis.removeEventListener = remove;
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.PageDashboard = stub.PageDashboard;
    StudentVoice.loaded = stub.voiceLoaded;
    delete COURSES[CID];
  });

  function sortBy(value) {
    const sel = doc.querySelector('.dash-sort-select');
    sel.value = value;
    sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  }

  it('reads every new place before moving a card', () => {
    expect(doc.querySelectorAll('.dash-grid > .dash-card[data-sid]').length).toBe(N);
    sortBy('last-desc');
    // N places before the sort, N after.
    expect(reads).toBe(2 * N);
    // One layout for the old places, one for the new: not one per card.
    expect(forced).toBe(2);
  });

  it('starts each card where it was and lets it slide', () => {
    sortBy('last-desc');
    const first = doc.querySelector('.dash-grid > .dash-card[data-sid]');
    expect(first.getAttribute('data-sid')).toBe('s' + (N - 1));
    expect(first.classList.contains('is-sliding')).toBe(true);
    expect(first.style.transform).toBe('');
  });
});
