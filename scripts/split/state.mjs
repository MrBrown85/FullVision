#!/usr/bin/env node
// scripts/split/state.mjs — puts a page file's changing variables on one object.
//
// A page file is one closure, and its parts share variables that are assigned
// again and again as the teacher works (`cmSelectedCourse = cid`). A part
// moved to its own file cannot follow a variable like that. On one object
// (`state.cmSelectedCourse = cid`) every part can be handed the object once.
//
//   node scripts/split/state.mjs teacher/dash-class-manager.js            what would change
//   node scripts/split/state.mjs teacher/dash-class-manager.js --write    change the file
//   node scripts/split/state.mjs teacher/dash-class-manager.js --prove origin/main
//
// --prove reads the file as it is at the git ref and as it is now, and walks
// the two programs side by side. They must be the same program except that
// each use of a moved variable `x` is now `state.x`, each `var x = …;` is now
// `state.x = …;`, and one `var state = {};` line is new. Anything else fails.
// Only variables that are reassigned move; functions and set-once values stay.
//
// The holder is a plain `{}`. A read of `state.x` before x is first assigned
// gives undefined only while nothing has added `x` to Object.prototype; the
// tool refuses the names JavaScript itself puts there, and cannot see a
// library that adds more.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { analyze as scopes } from 'eslint-scope';
import { parse, closureOf, setParents } from './analyze.mjs';

const POSITION = new Set(['start', 'end', 'loc', 'range', 'parent', 'raw']);

function load(src) {
  const { ast } = parse(src);
  setParents(ast, null);
  const manager = scopes(ast, { ecmaVersion: 2026, sourceType: 'script', range: true });
  const closure = closureOf(ast, src);
  if (!closure) throw new Error('this file is not one closure (window.Name = (function () { … })();)');
  return { src, ast, manager, closure, body: closure.fn.body.body, scope: manager.acquire(closure.fn) };
}

const isCalled = id =>
  !!id.parent &&
  ((id.parent.type === 'CallExpression' && id.parent.callee === id) ||
    (id.parent.type === 'TaggedTemplateExpression' && id.parent.tag === id));

const isNameless = e =>
  !!e &&
  ((e.type === 'FunctionExpression' && !e.id) ||
    e.type === 'ArrowFunctionExpression' ||
    (e.type === 'ClassExpression' && !e.id));

const inFunction = (m, node) => {
  for (let n = node.parent; n && n !== m.closure.fn.body; n = n.parent) {
    if (/Function/.test(n.type)) return true;
  }
  return false;
};

const topOf = (m, node) => {
  let n = node;
  while (n.parent && n.parent !== m.closure.fn.body) n = n.parent;
  return n.parent === m.closure.fn.body ? n : null;
};

/* What must hold of the old file before any variable can move.
   - The closure is in strict mode. In sloppy code `delete x`, `with` and
     `eval` can tell a variable from a property.
   - The holder's name is not used anywhere, as a variable or a global. */
export function guard(m, name) {
  const first = m.body[0];
  if (!first || first.directive !== 'use strict') throw new Error("the closure does not start with 'use strict'");
  for (const s of m.manager.scopes) {
    if (s.variables.some(v => v.name === name)) throw new Error(`the name "${name}" is already used in this file`);
  }
  for (const r of m.manager.globalScope.through) {
    const n = r.identifier.name;
    if (n === name) throw new Error(`the name "${name}" is already read as a global in this file`);
    if (n === 'eval') throw new Error(`eval is used at line ${r.identifier.loc.start.line}`);
  }
}

/* A name every object already has would read as that, not as undefined,
   before its first assignment; `__proto__` would not store a value at all. */
const TAKEN = new Set([...Object.getOwnPropertyNames(Object.prototype), '__proto__']);

/* The variables that move: declared by a top-level `var`/`let` of the
   closure, by a plain name, and assigned somewhere after that. */
export function pick(m) {
  const moved = [];
  const problems = [];
  for (const v of m.scope.variables) {
    if (v.name === 'arguments') continue;
    const reassigned = v.references.some(r => r.isWrite() && !r.init);
    if (!reassigned) continue;
    const where = 'line ' + v.defs[0].name.loc.start.line;
    if (v.defs.length !== 1) {
      problems.push(`${v.name} is declared ${v.defs.length} times (${where})`);
      continue;
    }
    const def = v.defs[0];
    if (def.type === 'FunctionName') {
      problems.push(`${v.name} is a function that is assigned again (${where}); left as it is`);
      continue;
    }
    if (def.type !== 'Variable') continue;
    const decl = def.parent;
    const top = topOf(m, decl);
    if (top !== decl) {
      // A loop counter or a block's own variable: fine if it never leaves its statement.
      const outside = v.references.some(r => topOf(m, r.identifier) !== top);
      if (outside) problems.push(`${v.name} is declared inside a block and used outside it (${where})`);
      continue;
    }
    if (def.node.id.type !== 'Identifier') {
      problems.push(`${v.name} is declared by unpacking (${where})`);
      continue;
    }
    if (decl.kind !== 'var') {
      // Reading a `let` before its line throws; a property would give undefined.
      problems.push(`${v.name} is declared with ${decl.kind}, not var (${where}); left as it is`);
      continue;
    }
    if (TAKEN.has(v.name)) {
      problems.push(`${v.name} is a name every object already has (${where}); left as it is`);
      continue;
    }
    /* `var x = function () {}` names the function x; `state.x = function () {}`
       leaves it nameless, which shows in .name and in an error's stack. */
    const nameless = v.references.find(r => r.isWrite() && isNameless(r.writeExpr));
    if (nameless) {
      problems.push(
        `${v.name} is given a function or class with no name of its own at line ${nameless.identifier.loc.start.line}; left as it is`,
      );
      continue;
    }
    /* `var x;` leaves an earlier value alone; `state.x = undefined;` would
       reset it. So a bare declaration moves only when nothing above it, in
       code that runs while the file loads, touches the variable. */
    if (!def.node.init) {
      const early = v.references.find(r => r.identifier.start < decl.start && !inFunction(m, r.identifier));
      if (early) {
        problems.push(
          `${v.name} is declared with no value (${where}) after line ${early.identifier.loc.start.line} already uses it while loading; left as it is`,
        );
        continue;
      }
    }
    moved.push(v);
  }
  return { moved, problems };
}

export function rewrite(src, name) {
  const m = load(src);
  const { moved, problems } = pick(m);
  guard(m, name);
  const movedSet = new Set(moved);
  const edits = [];
  const fail = (what, node) => {
    throw new Error(`${what} at line ${node.loc.start.line}: handle this one by hand`);
  };

  for (const v of moved) {
    for (const ref of v.references) {
      const id = ref.identifier;
      if (ref.init && id === v.defs[0].node.id) continue; // the declaration, below
      const p = id.parent;
      if (p.type === 'Property' && p.shorthand) {
        edits.push({ start: p.start, end: p.end, text: `${v.name}: ${name}.${v.name}` });
      } else if (
        p.type === 'AssignmentPattern' &&
        p.parent.type === 'Property' &&
        p.parent.shorthand &&
        p.left === id
      ) {
        fail(`{ ${v.name} = … } unpacks into a moved variable`, id);
      } else if (isCalled(id)) {
        /* `x()` runs x with no `this`; `state.x()` would hand it `state`.
           `(0, state.x)()` runs it with no `this`, as before. */
        edits.push({ start: id.start, end: id.end, text: `(0, ${name}.${v.name})` });
      } else {
        edits.push({ start: id.start, end: id.end, text: `${name}.${v.name}` });
      }
    }
  }

  const declarations = new Set(moved.map(v => v.defs[0].parent));
  for (const decl of declarations) {
    const isMoved = d => moved.some(v => v.defs[0].node === d);
    const ds = decl.declarations;
    edits.push({ start: decl.start, end: ds[0].start, text: isMoved(ds[0]) ? '' : decl.kind + ' ' });
    ds.forEach((d, k) => {
      if (isMoved(d)) {
        edits.push({ start: d.id.start, end: d.id.end, text: `${name}.${d.id.name}` });
        if (!d.init) edits.push({ start: d.id.end, end: d.id.end, text: ' = undefined' });
      }
      if (k + 1 < ds.length) {
        /* The comma becomes a semicolon; a comment between the two names
           stays where it is, above the second. */
        const between = src.slice(d.end, ds[k + 1].start);
        const comma = between.match(/^\s*,/);
        if (!comma) fail('no comma found between two declared names', d);
        edits.push({ start: d.end, end: d.end + comma[0].length, text: ';' });
        if (!isMoved(ds[k + 1])) edits.push({ start: ds[k + 1].start, end: ds[k + 1].start, text: decl.kind + ' ' });
      }
    });
  }

  const first = m.body[0];
  const at = first && first.directive ? first.end : m.closure.fn.body.start + 1;
  const pad = first ? src.slice(src.lastIndexOf('\n', first.start) + 1, first.start).match(/^\s*/)[0] : '  ';
  edits.push({
    start: at,
    end: at,
    text:
      `\n\n${pad}/* What this file holds while its page is open: every variable that is\n` +
      `${pad}   assigned again as the teacher works. One object, so a part of this\n` +
      `${pad}   file that moves to its own file can be handed it once. */\n` +
      `${pad}var ${name} = {};`,
  });

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  let last = Infinity;
  for (const e of edits) {
    if (e.end > last) throw new Error('two edits overlap near offset ' + e.start);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
  }
  return { out, moved: moved.map(v => v.name), problems, uses: edits.length, movedSet };
}

/* ── The proof ──────────────────────────────────────────────── */

export function prove(before, after, name) {
  const A = load(before);
  const B = load(after);
  guard(A, name);
  const { moved } = pick(A);
  const stillThere = new Set(B.scope.variables.map(v => v.name));
  const gone = moved.filter(v => !stillThere.has(v.name));
  const goneNames = new Set(gone.map(v => v.name));
  /* Every place in the old file that reads or writes a moved variable, by
     position: only there may `x` have become `state.x`. */
  const uses = new Set();
  const declared = new Map();
  for (const v of gone) {
    for (const r of v.references) uses.add(r.identifier.start);
    declared.set(v.defs[0].node, v);
  }

  const isState = (b, prop) =>
    b &&
    b.type === 'MemberExpression' &&
    !b.computed &&
    !b.optional &&
    b.object.type === 'Identifier' &&
    b.object.name === name &&
    b.property.type === 'Identifier' &&
    b.property.name === prop;

  let count = 0;
  function same(a, b, path) {
    if (a === b) return;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
      if (a !== b) throw new Error(`${path}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`);
      return;
    }
    if (a instanceof RegExp || b instanceof RegExp) {
      if (String(a) !== String(b)) throw new Error(`${path}: ${a} became ${b}`);
      return;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
        throw new Error(`${path}: a list of ${a.length} became a list of ${b.length}`);
      a.forEach((x, i) => same(x, b[i], `${path}[${i}]`));
      return;
    }
    const line = a.loc ? ` (old line ${a.loc.start.line})` : '';
    if (a.type === 'Identifier' && a.virtual !== 'plain' && (uses.has(a.start) || a.virtual === 'moved')) {
      if (isCalled(a)) {
        const ok =
          b.type === 'SequenceExpression' &&
          b.expressions.length === 2 &&
          b.expressions[0].type === 'Literal' &&
          b.expressions[0].value === 0 &&
          isState(b.expressions[1], a.name);
        if (!ok) throw new Error(`${path}${line}: the call ${a.name}() should have become (0, ${name}.${a.name})()`);
      } else if (!isState(b, a.name)) {
        throw new Error(`${path}${line}: ${a.name} should have become ${name}.${a.name}`);
      }
      count++;
      return;
    }
    if (a.type === 'Property' && a.shorthand && a.value.type === 'Identifier' && uses.has(a.value.start)) {
      const ok =
        b.type === 'Property' &&
        !b.shorthand &&
        !b.computed &&
        !b.method &&
        b.kind === a.kind &&
        b.key.type === 'Identifier' &&
        b.key.name === a.key.name &&
        isState(b.value, a.value.name);
      if (!ok)
        throw new Error(
          `${path}${line}: { ${a.key.name} } should have become { ${a.key.name}: ${name}.${a.key.name} }`,
        );
      count++;
      return;
    }
    if (a.type !== b.type) throw new Error(`${path}${line}: ${a.type} became ${b.type}`);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => !POSITION.has(k) && k !== 'virtual'));
    for (const k of keys) same(a[k], b[k], `${path}.${k}`);
  }

  /* The old top-level statements as they should now read: a `var` that
     declared moved variables is one statement per name. */
  const expected = [];
  for (const st of A.body) {
    if (st.type !== 'VariableDeclaration' || !st.declarations.some(d => declared.has(d))) {
      expected.push(st);
      continue;
    }
    let run = [];
    const flush = () => {
      if (run.length) expected.push({ type: 'VariableDeclaration', kind: st.kind, declarations: run, loc: st.loc });
      run = [];
    };
    for (const d of st.declarations) {
      if (!declared.has(d)) {
        run.push(d);
        continue;
      }
      flush();
      expected.push({
        type: 'ExpressionStatement',
        loc: d.loc,
        expression: {
          type: 'AssignmentExpression',
          operator: '=',
          loc: d.loc,
          left: { type: 'Identifier', name: d.id.name, virtual: 'moved', loc: d.loc },
          right: d.init || { type: 'Identifier', name: 'undefined', virtual: 'plain' },
        },
      });
    }
    flush();
  }

  const isHolder = st =>
    st.type === 'VariableDeclaration' &&
    st.declarations.length === 1 &&
    st.declarations[0].id.name === name &&
    st.declarations[0].init &&
    st.declarations[0].init.type === 'ObjectExpression' &&
    st.declarations[0].init.properties.length === 0;
  const holders = B.body.filter(isHolder);
  if (holders.length !== 1) throw new Error(`expected one "var ${name} = {};" line, found ${holders.length}`);
  if (B.body[0].directive !== 'use strict' || B.body[1] !== holders[0])
    throw new Error(`"var ${name} = {};" must be the first line after 'use strict', before anything that runs`);
  const actual = B.body.filter(st => !isHolder(st));

  /* Everything outside the closure's body must be untouched. */
  const bodyA = A.closure.fn.body.body;
  const bodyB = B.closure.fn.body.body;
  A.closure.fn.body.body = [];
  B.closure.fn.body.body = [];
  same(A.ast, B.ast, 'file');
  A.closure.fn.body.body = bodyA;
  B.closure.fn.body.body = bodyB;
  same(expected, actual, 'body');

  /* No other `state` anywhere, nothing assigns to it, and no moved name is
     left behind as a bare name. */
  for (const s of B.manager.scopes) {
    for (const v of s.variables) {
      if (v.name === name && s !== B.scope)
        throw new Error(`another "${name}" is declared at line ${v.defs[0].name.loc.start.line}`);
    }
  }
  const holder = B.scope.variables.find(v => v.name === name);
  if (holder.references.some(r => r.isWrite() && !r.init)) throw new Error(`"${name}" itself is assigned somewhere`);
  const oldGlobals = new Set(A.manager.globalScope.through.map(r => r.identifier.name));
  for (const r of B.manager.globalScope.through) {
    const n = r.identifier.name;
    if (goneNames.has(n) && !oldGlobals.has(n))
      throw new Error(`${n} is still used as a bare name at line ${r.identifier.loc.start.line}`);
  }
  const expectedUses =
    gone.reduce((sum, v) => sum + v.references.length, 0) + gone.filter(v => !v.defs[0].node.init).length;
  if (count !== expectedUses) throw new Error(`${expectedUses} uses were expected to change and ${count} did`);
  return {
    moved: gone.map(v => v.name),
    uses: count,
    expectedUses,
    kept: moved.filter(v => stillThere.has(v.name)).map(v => v.name),
  };
}

/* ── Command line ───────────────────────────────────────────── */

if (import.meta.url === 'file://' + process.argv[1]) {
  const args = process.argv.slice(2);
  const file = args.find(
    a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--prove' && args[args.indexOf(a) - 1] !== '--name',
  );
  const opt = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const name = opt('--name') || 'state';
  if (!file) {
    console.error('usage: node scripts/split/state.mjs <file> [--name state] [--write | --prove <git ref>]');
    process.exit(2);
  }
  try {
    if (args.includes('--prove')) {
      const before = execFileSync('git', ['show', `${opt('--prove')}:${file}`], {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      });
      const r = prove(before, fs.readFileSync(file, 'utf8'), name);
      console.log(
        `PROVED: ${file} is the same program as at ${opt('--prove')}, except that ${r.moved.length} variables ` +
          `now live on "${name}" (${r.uses} uses checked) and one "var ${name} = {};" line is new.`,
      );
      if (r.kept.length) console.log('Reassigned variables left as they were: ' + r.kept.join(', '));
    } else {
      const r = rewrite(fs.readFileSync(file, 'utf8'), name);
      console.log(`${r.moved.length} variables would move to "${name}":\n  ${r.moved.join(', ')}`);
      if (r.problems.length) console.log('Left alone:\n  ' + r.problems.join('\n  '));
      if (args.includes('--write')) {
        fs.writeFileSync(file, r.out);
        console.log(`Written. Run prettier on ${file}, then --prove.`);
      }
    }
  } catch (e) {
    console.error('NOT PROVED / stopped: ' + e.message);
    process.exit(1);
  }
}
