/**
 * Layout the Assignments page used to force (docs/plans/speed-assessment.md,
 * section 7, A1 and A2). Counted, not timed: linkedom lays nothing out, so
 * each test counts the calls that make a browser lay the page out.
 *
 * A1. The grader dialog took focus with a scroll straight after its draw
 *     (61 ms), and a level click ran scrollIntoView on its row straight
 *     after its writes (49 ms). The dialog is focused without a scroll; a
 *     row is scrolled to only when part of it is out of sight, after the
 *     frame's own layout.
 * A2. The blank rubric's rows were sized one row at a time: a height
 *     written, read and written again, row by row, laying the page out for
 *     each. Now every height is set to auto, then every one read, then
 *     every one written.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  U,
  seedClass,
  clearClass,
  click,
  key,
  openAssignments,
  openGrader,
  closePages,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const LAB = U(33);
const RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const QUESTION = U(41);
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };

const seed = () =>
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    rubrics: [
      {
        id: RUBRIC,
        name: 'Lab Skills',
        criteria: [
          { id: SAFETY, name: 'Safety', tagIds: [QUESTION], levels: WORDS, checks: [] },
          { id: METHOD, name: 'Method', tagIds: [QUESTION], levels: WORDS, checks: [] },
        ],
      },
    ],
    assessments: [{ id: LAB, title: 'Lab', rubricId: RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' }],
  });

const settled = () => new Promise(r => setTimeout(r, 10));
const row = (sid, crit) =>
  document.querySelector(
    '#ac-' + LAB + ' .rsg-criterion-row[data-student="' + sid + '"][data-criterion="' + crit + '"]',
  );

/* A page laid out by hand: each element's box is `boxOf(el)`, the window
   1200 by 800. Counts scrollIntoView calls. */
let scrolls;
let boxOf;
let undo;
function layout() {
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement('div')));
  const had = { scroll: proto.scrollIntoView, rect: proto.getBoundingClientRect };
  scrolls = [];
  boxOf = () => ({ top: 100, left: 10, bottom: 140, right: 900 });
  proto.scrollIntoView = function () {
    scrolls.push(this);
  };
  proto.getBoundingClientRect = function () {
    return boxOf(this);
  };
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 800;
  undo = () => {
    proto.scrollIntoView = had.scroll;
    proto.getBoundingClientRect = had.rect;
    delete globalThis.innerWidth;
    delete globalThis.innerHeight;
  };
}

let wasDemo;
beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
});
afterEach(async () => {
  if (undo) undo();
  undo = null;
  await settled();
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('A1: focus and scrolling after a draw', () => {
  it('the grader dialog takes focus without scrolling', () => {
    const calls = [];
    openGrader(
      () => {
        seed();
        const proto = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement('div')));
        let p = proto;
        while (p && !Object.prototype.hasOwnProperty.call(p, 'focus')) p = Object.getPrototypeOf(p);
        const focus = p.focus;
        p.focus = function (opts) {
          if (this.classList && this.classList.contains('grader-dialog')) calls.push(opts);
          return focus.apply(this, arguments);
        };
      },
      CID,
      LAB,
      AVA,
    );
    expect(calls).toEqual([{ preventScroll: true }]);
    expect(document.activeElement.classList.contains('grader-dialog')).toBe(true);
  });

  it('a level clicked on a row in sight scrolls nothing; a row partly out of sight is scrolled to', async () => {
    openAssignments(seed, CID, { open: LAB });
    await settled();
    layout();
    click(row(BEN, SAFETY).querySelector('.rsg-level.l3'));
    await settled();
    expect(scrolls).toEqual([]);
    expect(row(BEN, SAFETY).classList.contains('kb-focus')).toBe(true);
    // Its bottom below the window: scrolled to, once.
    boxOf = el =>
      el === row(AVA, METHOD)
        ? { top: 780, left: 10, bottom: 830, right: 900 }
        : { top: 0, left: 0, bottom: 10, right: 10 };
    click(row(AVA, METHOD).querySelector('.rsg-level.l2'));
    await settled();
    expect(scrolls.length).toBe(1);
    expect(scrolls[0] === row(AVA, METHOD)).toBe(true);
  });

  it('an arrow key moves the focus and scrolls only to a row out of sight', async () => {
    openAssignments(seed, CID, { open: LAB });
    await settled();
    layout();
    click(row(AVA, SAFETY));
    key(document.body, 'ArrowDown');
    await settled();
    expect(row(AVA, METHOD).classList.contains('kb-focus')).toBe(true);
    expect(scrolls).toEqual([]);
  });

  it('with no layout to read (no window size), it scrolls as before', async () => {
    openAssignments(seed, CID, { open: LAB });
    await settled();
    layout();
    delete globalThis.innerWidth;
    click(row(BEN, SAFETY).querySelector('.rsg-level.l3'));
    await settled();
    expect(scrolls.length).toBe(1);
  });
});

describe('A2: the blank rubric’s rows are measured in three passes', () => {
  it('every height is set to auto, then read, then written: one layout, not one a row', async () => {
    openAssignments(seed, CID, {});
    await settled();
    click(document.querySelector('[data-action="showNewForm"]'));
    await settled();
    const card = document.querySelector('#af-rubric-view .af-ge-card');
    expect(card, 'the blank rubric editor did not open').not.toBe(null);
    // Two criteria, so two rows.
    click(card.querySelector('[data-action="geAddCrit"]'));
    await settled();
    const log = [];
    const box = document.querySelector('.af-ge-grid tbody tr .af-ge-text');
    const textProto = Object.getPrototypeOf(box);
    const styleOwner = (() => {
      let p = textProto;
      while (p && !Object.getOwnPropertyDescriptor(p, 'style')) p = Object.getPrototypeOf(p);
      return p;
    })();
    const styleDesc = Object.getOwnPropertyDescriptor(styleOwner, 'style');
    Object.defineProperty(textProto, 'scrollHeight', {
      configurable: true,
      get() {
        log.push('read');
        return 120;
      },
    });
    Object.defineProperty(textProto, 'style', {
      configurable: true,
      get() {
        const style = styleDesc.get.call(this);
        return new Proxy(style, {
          set(target, prop, value) {
            if (prop === 'height') log.push(value === 'auto' ? 'auto' : 'px');
            target[prop] = value;
            return true;
          },
        });
      },
    });
    try {
      click(document.querySelector('.af-ge-card [data-action="geAddCrit"]'));
    } finally {
      delete textProto.scrollHeight;
      delete textProto.style;
    }
    const rows = document.querySelectorAll('.af-ge-grid tbody tr').length;
    expect(rows).toBeGreaterThan(2);
    // Every auto, then every read, then every height, for each sizing of the
    // grid (the redraw sizes it, and so does the editor's own draw): a run
    // of three a sizing, where row by row was two runs of three for each row.
    const runs = log.filter((x, i) => i === 0 || x !== log[i - 1]);
    expect(runs.length % 3).toBe(0);
    for (let i = 0; i < runs.length; i += 3) expect(runs.slice(i, i + 3)).toEqual(['auto', 'read', 'px']);
    expect(runs.length / 3).toBeLessThan(rows);
    expect(log.filter(x => x === 'read').length).toBeGreaterThanOrEqual(rows * 2);
    // The heights are what was read.
    expect(document.querySelector('.af-ge-grid tbody tr .af-ge-text').style.height).toBe('120px');
  });
});
