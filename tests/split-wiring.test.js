/**
 * The wiring between a page file and the pieces cut from it (scripts/split/cut.mjs).
 *
 * A piece is a closure of its own. It cannot see the page's variables, so the
 * page hands it what it uses through one configure(h) call, and the piece
 * keeps a copy of each name. A copy is right only while the original never
 * changes: if the page later assigns a handed name again, the piece goes on
 * using the old value and nothing fails. The tool refuses to cut a piece that
 * would be in that position; this test holds the same line for every edit
 * made afterwards.
 *
 * For every piece (a file whose configure(h) is the tool's shape):
 *   - the piece assigns a handed name only inside configure;
 *   - every name it takes is handed to it, and nothing else is handed;
 *   - a handed name is a function, or a variable given its value once, at
 *     the top of the page's closure, before the configure call that hands it.
 * A value that changes belongs on the page's state object (pageState, state),
 * which is one object both sides hold.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { analyze } from 'eslint-scope';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['teacher', 'teacher-mobile', 'shared', 's'];

const files = DIRS.flatMap(dir =>
  readdirSync(resolve(root, dir))
    .filter(n => n.endsWith('.js'))
    .map(n => dir + '/' + n),
).filter(f => readFileSync(resolve(root, f), 'utf-8').includes('configure'));

function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach(c => walk(c, visit, parents.concat(node)));
    else if (child && typeof child.type === 'string') walk(child, visit, parents.concat(node));
  }
}

/* `window.Name = (function () { … })();`, with or without a cast around window. */
function closuresOf(ast) {
  const out = [];
  for (const st of ast.body) {
    const e = st.type === 'ExpressionStatement' ? st.expression : null;
    if (!e || e.type !== 'AssignmentExpression' || e.left.type !== 'MemberExpression') continue;
    const call = e.right;
    if (call.type !== 'CallExpression' || call.callee.type !== 'FunctionExpression') continue;
    out.push({ global: e.left.property.name, fn: call.callee });
  }
  return out;
}

/* The names a tool-made configure(h) takes, or null when configure is some other shape. */
function received(configure) {
  if (configure.params.length !== 1 || configure.params[0].type !== 'Identifier') return null;
  const h = configure.params[0].name;
  const names = [];
  for (const st of configure.body.body) {
    const t = st.type === 'IfStatement' ? st.test : null;
    const a =
      st.type === 'IfStatement' && st.consequent.type === 'ExpressionStatement' ? st.consequent.expression : null;
    const fits =
      t &&
      a &&
      t.type === 'BinaryExpression' &&
      t.operator === 'in' &&
      t.left.type === 'Literal' &&
      t.right.type === 'Identifier' &&
      t.right.name === h &&
      a.type === 'AssignmentExpression' &&
      a.left.type === 'Identifier' &&
      a.left.name === t.left.value &&
      a.right.type === 'MemberExpression' &&
      a.right.object.type === 'Identifier' &&
      a.right.object.name === h &&
      a.right.property.name === t.left.value;
    if (!fits) return null;
    names.push(a.left.name);
  }
  return names.length ? names : null;
}

const inside = (node, outer) => node.range[0] >= outer.range[0] && node.range[1] <= outer.range[1];

/* Reads the files given as { 'dir/name.js': text } and returns what is wrong with their wiring. */
function check(sources) {
  const parsed = Object.keys(sources).map(file => {
    const ast = acorn.parse(sources[file], {
      ecmaVersion: 'latest',
      sourceType: 'script',
      ranges: true,
      locations: true,
    });
    const manager = analyze(ast, { ecmaVersion: 2026, sourceType: 'script', range: true });
    return { file, ast, manager, closures: closuresOf(ast) };
  });
  /* Every piece: its global name, the names it takes, and its own breaches. */
  const pieces = new Map();
  for (const p of parsed) {
    for (const c of p.closures) {
      const configure = c.fn.body.body.find(st => st.type === 'FunctionDeclaration' && st.id.name === 'configure');
      const names = configure && received(configure);
      if (!names) continue;
      const scope = p.manager.acquire(c.fn);
      const breaches = [];
      for (const name of names) {
        const v = scope.set.get(name);
        for (const ref of v ? v.references : []) {
          if (ref.isWrite() && !inside(ref.identifier, configure))
            breaches.push(`${p.file}:${ref.identifier.loc.start.line} assigns ${name}, which it was handed`);
        }
      }
      pieces.set(c.global, { file: p.file, names, breaches, handed: new Set() });
    }
  }

  /* Every `Piece.configure({ … })` call, and what is wrong with what it hands. */
  const handing = [];
  for (const p of parsed) {
    for (const c of p.closures) {
      const scope = p.manager.acquire(c.fn);
      walk(c.fn.body, (node, parents) => {
        if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return;
        const { object, property } = node.callee;
        if (object.type !== 'Identifier' || property.name !== 'configure' || !pieces.has(object.name)) return;
        const piece = pieces.get(object.name);
        const arg = node.arguments[0];
        const at = `${p.file}:${node.loc.start.line} ${object.name}.configure`;
        if (!arg || arg.type !== 'ObjectExpression') return handing.push(`${at} is not handed a plain object`);
        const atLoad = !parents.some(n => /Function/.test(n.type));
        for (const prop of arg.properties) {
          const key = prop.key && (prop.key.name || prop.key.value);
          piece.handed.add(key);
          if (!piece.names.includes(key)) handing.push(`${at} hands ${key}, which ${piece.file} does not take`);
          if (prop.value.type !== 'Identifier') continue;
          const v = scope.set.get(prop.value.name);
          if (!v) continue; // a global, or a name local to the function that makes the call
          const writes = v.references.filter(r => r.isWrite());
          const isFunction = v.defs.some(d => d.type === 'FunctionName');
          if (isFunction && writes.length) handing.push(`${at} hands ${key}, a function that is assigned again`);
          if (!isFunction && writes.length > 1)
            handing.push(
              `${at} hands ${key}, which is assigned ${writes.length} times (line ${writes[1].identifier.loc.start.line})`,
            );
          if (!isFunction && writes.length === 1) {
            const w = writes[0];
            if (w.from !== scope) handing.push(`${at} hands ${key}, which is assigned inside a function`);
            else if (atLoad && w.identifier.range[0] > node.range[0])
              handing.push(`${at} hands ${key} before it has its value (line ${w.identifier.loc.start.line})`);
          }
        }
      });
    }
  }

  const breaches = [...pieces.values()].flatMap(p => p.breaches);
  const missing = [];
  for (const [global, p] of pieces)
    for (const name of p.names) if (!p.handed.has(name)) missing.push(`${global} (${p.file}) is never handed ${name}`);
  return { pieces, breaches, handing, missing };
}

const real = check(Object.fromEntries(files.map(f => [f, readFileSync(resolve(root, f), 'utf-8')])));

describe('split wiring', () => {
  it('finds the pieces', () => {
    // Class Settings (teacher/cm-*.js) and Assignments (teacher/assign-*.js) were cut with the tool.
    expect(real.pieces.size).toBeGreaterThan(40);
  });

  it('a piece assigns a handed name only inside configure', () => {
    expect(real.breaches).toEqual([]);
  });

  it('a handed name is a function, or a variable given its value once before it is handed', () => {
    expect(real.handing).toEqual([]);
  });

  it('every name a piece takes is handed to it', () => {
    expect(real.missing).toEqual([]);
  });
});

/* The same check on a small page and piece, each changed one way it must catch. */
describe('split wiring: what the check catches', () => {
  const PIECE = `window.Piece = (function () {
  'use strict';
  var state, limit, show;
  function configure(h) {
    if ('state' in h) state = h.state;
    if ('limit' in h) limit = h.limit;
    if ('show' in h) show = h.show;
  }
  function hide() {
    if (state.count > limit) show();
  }
  return { configure: configure, hide: hide };
})();
`;
  const PAGE = `window.Page = (function () {
  'use strict';
  var state = {};
  var hide = Piece.hide;
  var limit = 3;
  Piece.configure({ state: state, limit: limit, show: show });
  function show() {
    state.count = 0;
  }
  function reset() {
    state.count = 1;
  }
  return { show: show, hide: hide, reset: reset };
})();
`;
  const run = (page, piece) => check({ 'teacher/page.js': page, 'teacher/piece.js': piece });
  const swap = (text, from, to) => {
    expect(text).toContain(from);
    return text.replace(from, to);
  };

  it('passes the pair as written', () => {
    const r = run(PAGE, PIECE);
    expect(r.pieces.size).toBe(1);
    expect(r.breaches.concat(r.handing, r.missing)).toEqual([]);
  });

  it.each([
    [
      'the page assigns a handed variable again',
      () => run(swap(PAGE, 'state.count = 1;', 'state.count = 1;\n    limit = 5;'), PIECE),
      /hands limit, which is assigned 2 times/,
    ],
    [
      'the page replaces a handed function',
      () => run(swap(PAGE, 'state.count = 1;', 'show = function () {};'), PIECE),
      /hands show, a function that is assigned again/,
    ],
    [
      'the page hands a variable before it has its value',
      () =>
        run(
          swap(
            swap(PAGE, '  var limit = 3;\n', '  var limit;\n'),
            '  function show() {',
            '  limit = 3;\n  function show() {',
          ),
          PIECE,
        ),
      /hands limit before it has its value/,
    ],
    [
      'the page gives a handed variable its value inside a function',
      () => run(swap(swap(PAGE, '  var limit = 3;\n', '  var limit;\n'), 'state.count = 1;', 'limit = 3;'), PIECE),
      /hands limit, which is assigned inside a function/,
    ],
    [
      'the page hands a name the piece does not take',
      () => run(swap(PAGE, 'show: show }', 'show: show, extra: 1 }'), PIECE),
      /hands extra, which teacher\/piece.js does not take/,
    ],
    [
      'the page leaves out a name the piece takes',
      () => run(swap(PAGE, ', show: show }', ' }'), PIECE),
      /is never handed show/,
    ],
    [
      'the piece assigns a handed name itself',
      () => run(PAGE, swap(PIECE, 'if (state.count > limit) show();', 'limit = 9;')),
      /assigns limit, which it was handed/,
    ],
  ])('fails when %s', (_, changed, message) => {
    const r = changed();
    expect(r.breaches.concat(r.handing, r.missing).join('\n')).toMatch(message);
  });
});
