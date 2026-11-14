/**
 * A gradebook draw writes the page and does not stop to measure it
 * (page-gradebook.js _paint, gradebook-chrome.js). Before, each draw read
 * every slanted title's style to size the header, then wrote the header's
 * height on every title, then scrolled the selected cell into view at
 * once: the browser laid the table out again for each, about 3,000 cells
 * on a class the size of History 12.
 *
 * Now the header's height is worked out from the titles' text before the
 * draw is written (the titles' two fonts are read once, from the first
 * titles drawn) and written with the HTML; the selected cell is scrolled
 * in the next frame, and only when it is out of view. The height is the
 * same as before: just tall enough for the longest title, 100 to 170 px
 * (e2e/gradebook-header-height.spec.js measures it in a browser).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mount, unmount, key } from './helpers/gradebook-dom.js';

const CID = 'cH';
const TITLES = ['Quiz', 'A Much Longer Title For The Second Piece', 'Lab'];

function seed() {
  _cache.students[CID] = [
    { id: 's1', firstName: 'Ava', lastName: 'Adams' },
    { id: 's2', firstName: 'Ben', lastName: 'Brown' },
  ];
  _cache.assessments[CID] = TITLES.map((title, i) => ({
    id: 'a' + i,
    title,
    tagIds: ['T1'],
    date: '2026-10-1' + i,
    type: 'summative',
  }));
  _cache.scores[CID] = { s1: [], s2: [] };
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

let styleReads = 0;
let scrolls = 0;
let realStyle;
function count(doc) {
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
  proto.scrollIntoView = function () {
    scrolls++;
  };
}
const heights = () => Array.from(document.querySelectorAll('#gb-colheads .gb-grid-colhead')).map(el => el.style.height);

beforeEach(() => {
  realStyle = globalThis.getComputedStyle;
  styleReads = 0;
  scrolls = 0;
});
afterEach(() => {
  unmount();
  globalThis.getComputedStyle = realStyle;
  localStorage.clear();
});

describe('a gradebook draw does not measure the page', () => {
  it('a redraw reads no style and sizes the header from the titles, as before', () => {
    const doc = mount(seed, { course: CID });
    count(doc);
    globalThis.getComputedStyle = () => {
      styleReads++;
      return { fontWeight: '600', fontSize: '12px', fontFamily: 'sans-serif' };
    };
    // The first draw with titles may read their two fonts once.
    PageGradebook.render();
    expect(styleReads).toBeLessThanOrEqual(2);
    styleReads = 0;
    PageGradebook.render();
    expect(styleReads).toBe(0);
    // The helper's canvas makes every title 50 px wide: the shortest header.
    // e2e/gradebook-header-height.spec.js checks the height with real fonts.
    const h = '100px';
    expect(heights()).toEqual(TITLES.map(() => h));
    expect(document.querySelector('.gb-grid').style.getPropertyValue('--gb-head-h')).toBe(h);
    expect(document.querySelectorAll('#gb-colheads .gb-header-resize-handle').length).toBe(1);
  });

  it('a selected cell in view is not scrolled; one out of view is, once', () => {
    const doc = mount(seed, { course: CID });
    count(doc);
    const cell = () => document.querySelector('#gb-data td.gb-scores-cell[data-sid="s1"][data-aid="a1"]');
    cell().classList.add('gb-focus');
    cell().focus();
    PageGradebook.render();
    expect(scrolls).toBe(0);
    // The grid is 800 by 600 in a 1280 by 800 window; Ben's row is below it.
    const grid = document.getElementById('gb-data');
    grid.getBoundingClientRect = () => ({ top: 100, left: 200, bottom: 700, right: 1000 });
    Object.assign(grid, { clientTop: 0, clientLeft: 0, clientHeight: 600, clientWidth: 800 });
    Object.assign(window, { innerHeight: 800, innerWidth: 1280 });
    document.querySelectorAll('#gb-data td').forEach(td => {
      td.getBoundingClientRect = () => ({ top: 140, bottom: 180, left: 248, right: 296 });
    });
    key(cell(), 'ArrowRight');
    key(document.activeElement, 'ArrowLeft');
    expect(scrolls, 'a cell in view').toBe(0);
    const below = document.querySelector('#gb-data td.gb-scores-cell[data-sid="s2"][data-aid="a1"]');
    below.getBoundingClientRect = () => ({ top: 5000, bottom: 5040, left: 0, right: 48 });
    key(cell(), 'ArrowDown');
    expect(document.activeElement).toBe(below);
    expect(scrolls).toBe(1);
  });
});
