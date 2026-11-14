/**
 * The pointer across the gradebook and a scroll of it do as little as they
 * can (teacher/gradebook-chrome.js). Before, each new column under the
 * pointer searched the whole page for the lit cells to clear them, and each
 * cell's background faded in and out; each scroll event read both panes'
 * scroll heights, which lays the page out mid-scroll. Now the lit cells are
 * kept in a list, the column lights without a fade, and the names' room
 * under the last row is worked out after a draw and on a resize only.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { mount, unmount, fire } from './helpers/gradebook-dom.js';

const CID = 'cV';
function seed() {
  _cache.students[CID] = ['Ava', 'Ben', 'Cara'].map((n, i) => ({ id: 's' + i, firstName: n, lastName: 'L' + i }));
  _cache.assessments[CID] = [0, 1, 2, 3].map(i => ({
    id: 'a' + i,
    title: 'Piece ' + i,
    tagIds: ['T1'],
    date: '2026-10-1' + i,
    type: 'summative',
  }));
  _cache.scores[CID] = {};
  _cache.statuses[CID] = {};
  _cache.courseConfigs[CID] = {};
}

afterEach(() => {
  unmount();
  localStorage.clear();
});

// linkedom has no cellIndex.
function withCellIndex(doc) {
  const td = doc.createElement('td');
  const proto = Object.getPrototypeOf(td);
  if (!('cellIndex' in td))
    Object.defineProperty(proto, 'cellIndex', {
      configurable: true,
      get() {
        return Array.prototype.indexOf.call(this.parentNode.children, this);
      },
    });
}

describe('the column under the pointer', () => {
  it('lights its cells and clears the last column’s without searching the page', () => {
    const doc = mount(seed, { course: CID });
    withCellIndex(doc);
    const realAll = doc.querySelectorAll.bind(doc);
    let searches = 0;
    doc.querySelectorAll = sel => {
      if (String(sel).indexOf('gb-col-hover') >= 0) searches++;
      return realAll(sel);
    };
    const cellAt = (r, c) => doc.querySelectorAll('#gb-data tbody tr')[r].children[c];
    fire(cellAt(0, 1), 'mouseover');
    fire(cellAt(1, 2), 'mouseover');
    const lit = Array.from(realAll('.gb-col-hover'));
    // Three students and Class Average in column 2, and its title.
    expect(lit.length).toBe(5);
    expect(lit.filter(el => el.tagName === 'TD').every(td => td.cellIndex === 2)).toBe(true);
    fire(doc.getElementById('gb-data'), 'mouseleave');
    expect(realAll('.gb-col-hover').length).toBe(0);
    expect(searches).toBe(0);
  });

  it('lights without the cells’ background fade', () => {
    const css = readFileSync('teacher/gradebook.css', 'utf-8');
    expect(css).toMatch(/\.gb-scores-cell\.gb-col-hover,\s*\.gb-score\.gb-col-hover\s*\{\s*transition:\s*none;/);
  });
});

describe('a scroll', () => {
  it('reads no layout; the names’ room under the last row is worked out after the draw', () => {
    const doc = mount(seed, { course: CID });
    let reads = 0;
    const sized = (el, scroll, client) => {
      Object.defineProperty(el, 'scrollHeight', {
        configurable: true,
        get() {
          reads++;
          return scroll;
        },
      });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: client });
    };
    // Make the panes measurable, then draw again: the data area's
    // horizontal scrollbar takes 15px from its view.
    const realGet = doc.getElementById.bind(doc);
    doc.getElementById = id => {
      const el = realGet(id);
      if (el && id === 'gb-data' && !el._sized) sized(el, 1015, 500);
      if (el && id === 'gb-rowheads' && !el._sized) sized(el, 1000, 500);
      if (el) el._sized = true;
      return el;
    };
    PageGradebook.render();
    expect(realGet('gb-rowheads').style.getPropertyValue('--gb-hscroll')).toBe('15px');
    reads = 0;
    const data = realGet('gb-data');
    data.scrollTop = 120;
    for (let i = 0; i < 5; i++) fire(data, 'scroll');
    expect(reads).toBe(0);
    expect(realGet('gb-rowheads').scrollTop).toBe(120);
  });
});
