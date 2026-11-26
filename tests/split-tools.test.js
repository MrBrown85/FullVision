/**
 * The split tools (scripts/split/): what they change, what they refuse, and
 * that their proofs fail on anything else.
 *
 * state.mjs puts a page file's reassigned variables on one object;
 * cut.mjs moves lines to their own file as text. Each has a proof that the
 * program is otherwise the same. These tests hold the proofs to that on a
 * small file: a proof that passes a changed program is worse than none.
 */
import { describe, expect, it } from 'vitest';
import { prove, rewrite } from '../scripts/split/state.mjs';
import { cut, proveMove } from '../scripts/split/cut.mjs';

const page = body => `window.Page = (function () {\n  'use strict';\n${body}\n})();\n`;

const BEFORE = page(`
  var open = null;
  var count = 0,
    label = 'none',
    FIXED = 3;
  var later;
  var onDone = null;
  function configure(opts) {
    onDone = opts.onDone;
  }
  function show(id) {
    open = id;
    count++;
    later = { open, n: count };
    if (onDone) onDone(label + FIXED);
    return function open2(open) {
      return open;
    };
  }
  function hide() {
    open = null;
    label = 'hidden';
  }
  return { configure: configure, show: show, hide: hide };`);

describe('state.mjs: variables onto one object', () => {
  const out = rewrite(BEFORE, 'state');

  it('moves every reassigned variable, and only those', () => {
    expect(out.moved.sort()).toEqual(['count', 'label', 'later', 'onDone', 'open']);
    expect(out.out).toContain('var state = {};');
    expect(out.out).toContain('state.open = null;');
    expect(out.out).toContain('state.later = undefined');
    expect(out.out).toMatch(/var FIXED = 3/); // set once: stays a variable
    expect(out.out).toContain('{ open: state.open, n: state.count }'); // a shorthand is written out
    expect(out.out).toMatch(/return function open2\(open\) \{\s+return open;/); // a parameter of the same name is not touched
  });

  it('keeps a call running with no this', () => {
    expect(out.out).toContain('(0, state.onDone)(state.label + FIXED)');
  });

  it('proves its own result', () => {
    const r = prove(BEFORE, out.out, 'state');
    expect(r.moved.length).toBe(5);
    expect(r.uses).toBe(r.expectedUses);
  });

  it.each([
    ['a use points at another variable', s => s.replace('state.open = id;', 'state.label = id;')],
    ['a value changed', s => s.replace("state.label = 'none'", "state.label = 'some'")],
    ['a statement deleted', s => s.replace('state.count++;', '')],
    ['a statement added', s => s.replace('state.count++;', 'state.count++;\n    state.count++;')],
    [
      'two statements swapped',
      s =>
        s.replace("state.open = null;\n    state.label = 'hidden';", "state.label = 'hidden';\n    state.open = null;"),
    ],
    ['a parameter turned into state', s => s.replace('return open;', 'return state.open;')],
    ['the holder assigned again', s => s.replace('state.count++;', 'state = {};')],
    ['a call handed state as its this', s => s.replace('(0, state.onDone)(', 'state.onDone(')],
    [
      'the holder moved below running code',
      s =>
        s.replace(/\n\s*var state = \{\};/, '').replace('state.open = null;', 'state.open = null;\n  var state = {};'),
    ],
  ])('the proof fails when %s', (_, tamper) => {
    const changed = tamper(out.out);
    expect(changed).not.toBe(out.out);
    expect(() => prove(BEFORE, changed, 'state')).toThrow();
  });

  it('refuses a file that is not strict, or already uses the name', () => {
    expect(() => rewrite(BEFORE.replace("'use strict';", ''), 'state')).toThrow(/use strict/);
    expect(() => rewrite(BEFORE, 'label')).toThrow(/already used/);
    expect(() =>
      prove(BEFORE.replace('function hide() {', 'function hide() {\n    var state;'), out.out, 'state'),
    ).toThrow(/already used/);
  });

  it('leaves alone what it cannot move exactly', () => {
    const r = rewrite(
      page(`
  early = 1;
  var early;
  let scoped = 1;
  var named = null;
  var constructor = 1;
  function f() {
    early = 2;
    scoped = 2;
    named = function () {};
    constructor = 2;
  }
  return { f: f };`),
      'state',
    );
    expect(r.moved).toEqual([]);
    expect(r.problems.join('\n')).toMatch(/early is declared with no value/);
    expect(r.problems.join('\n')).toMatch(/scoped is declared with let/);
    expect(r.problems.join('\n')).toMatch(/named is given a function or class with no name/);
    expect(r.problems.join('\n')).toMatch(/constructor is a name every object already has/);
  });
});

describe('cut.mjs: lines to their own file', () => {
  const MAIN = rewrite(BEFORE, 'state').out + '';
  const lineOf = text => MAIN.split('\n').findIndex(l => l.includes(text)) + 1;
  const from = lineOf('function hide() {');
  const to = lineOf("state.label = 'hidden';") + 1;
  const made = cut(MAIN, {
    file: 'teacher/page.js',
    to: 'teacher/page-hide.js',
    global: 'PageHide',
    title: 'hiding',
    ranges: [[from, to]],
  });

  it('moves the lines as text and writes only the wiring', () => {
    expect(made.blockers).toEqual([]);
    expect(made.piece).toContain("state.label = 'hidden';");
    expect(made.piece).toContain("if ('state' in h) state = h.state;");
    expect(made.main).not.toContain('function hide()');
    expect(made.main).toContain('var hide = PageHide.hide;');
    expect(made.main).toContain('PageHide.configure({ state: state });');
  });

  it('proves the move, and names every line written on purpose', () => {
    const r = proveMove(MAIN, made.main, made.piece);
    expect(r.moved).toBe(1);
    expect(r.written.join('\n')).toMatch(/PageHide: configure\(h\)/);
    expect(r.written.join('\n')).toMatch(/main: var hide = PageHide/);
  });

  it.each([
    ['the moved code changed', (m, p) => [m, p.replace("state.label = 'hidden';", "state.label = 'gone';")]],
    ['the main file changed elsewhere', (m, p) => [m.replace('state.count++;', 'state.count += 2;'), p]],
    ['the main file gained a statement', (m, p) => [m.replace('state.count++;', 'state.count++;\n    hide();'), p]],
    [
      'the new file gained a statement',
      (m, p) => [m, p.replace('function hide() {', 'function extra() {}\n  function hide() {')],
    ],
    [
      'the new file runs code while loading',
      (m, p) => [m, p.replace('function hide() {', 'window.x = 1;\n  function hide() {')],
    ],
    [
      'configure does more than take what it is handed',
      (m, p) => [
        m,
        p.replace("if ('state' in h) state = h.state;", "if ('state' in h) state = h.state;\n    h.state.open = 1;"),
      ],
    ],
    [
      'the pointer names something else',
      (m, p) => [m.replace('var hide = PageHide.hide;', 'var hide = PageHide.configure;'), p],
    ],
  ])('the proof fails when %s', (_, tamper) => {
    const [m, p] = tamper(made.main, made.piece);
    expect(m + p).not.toBe(made.main + made.piece);
    expect(() => proveMove(MAIN, m, p)).toThrow();
  });

  it('stops a cut that reads a variable the main file reassigns', () => {
    // Before the rename, `hide` assigns `open` and `label`, which the main file owns.
    const stopped = cut(BEFORE, {
      file: 'teacher/page.js',
      to: 'x.js',
      global: 'X',
      ranges: [
        [
          BEFORE.split('\n').findIndex(l => l.includes('function hide() {')) + 1,
          BEFORE.split('\n').findIndex(l => l.includes("label = 'hidden';")) + 2,
        ],
      ],
    });
    expect(stopped.blockers.join('\n')).toMatch(/assigns open/);
  });
});
