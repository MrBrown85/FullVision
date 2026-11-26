#!/usr/bin/env node
// scripts/split/cut.mjs — moves part of a one-closure page file to its own
// file, by lines, and proves the move changed nothing.
//
//   node scripts/split/cut.mjs teacher/dash-class-manager.js \
//     --to teacher/cm-roster.js --global CmRoster --lines 2100-2890,3010-3120 \
//     --title "Class Settings: the roster"            (add --dry to only report)
//   node scripts/split/cut.mjs teacher/dash-class-manager.js \
//     --prove origin/main --piece teacher/cm-roster.js
//
// The moved code is copied as text, never retyped. What is written new is
// small and fixed in shape, so the proof can name every line of it:
//   in the new file   the closure wrapper; one `var` naming what the main file
//                     hands over; `configure(h)`, which takes it; the return.
//   in the main file  one `var name = Global.name;` per moved name it still
//                     uses; one or two `Global.configure({ … })` calls.
// The main file's functions are handed over as they are (not wrapped), so a
// listener added with one in the new file is the same function the main file
// removes.
//
// --prove: the old file's statements, in order, must be exactly the main
// file's statements plus the new file's, each the same program text, once
// the lines above are set aside. The new file must load before the main one.
//
// Run scripts/split/state.mjs on the file first: a part that reads a variable
// the main file reassigns cannot move (map.mjs says which).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { analyze as scopes } from 'eslint-scope';
import { analyzeSource, pieceReport, parse, closureOf, setParents } from './analyze.mjs';

const POSITION = new Set(['start', 'end', 'loc', 'range', 'parent', 'raw']);

function sameTree(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameTree(x, b[i]));
  }
  if (a.type !== b.type) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter(k => !POSITION.has(k)));
  for (const k of keys) if (!sameTree(a[k], b[k])) return false;
  return true;
}

export function picked(a, ranges) {
  const out = [];
  for (const st of a.statements) {
    const inside = ranges.some(([from, to]) => st.from >= from && st.to <= to);
    const touches = ranges.some(([from, to]) => st.to >= from && st.from <= to);
    if (inside) out.push(st.i);
    else if (touches) throw new Error(`lines ${st.from}-${st.to} are one statement; a range cuts through it`);
  }
  if (!out.length) throw new Error('no statement lies inside those lines');
  return out;
}

export function cut(src, opts) {
  const a = analyzeSource(src, opts.file);
  if (!a.closure) throw new Error('this file is not one closure');
  const host = a.closure.name;
  const G = opts.global;
  /* A `state.x = …;` line sets up the main file's own object while it loads:
     it stays behind, even inside the lines asked for. */
  const setsState = i => {
    const n = a.body[i];
    const e = n.type === 'ExpressionStatement' ? n.expression : null;
    return !!(
      e &&
      e.type === 'AssignmentExpression' &&
      e.left.type === 'MemberExpression' &&
      e.left.object.type === 'Identifier' &&
      e.left.object.name === 'state'
    );
  };
  const asked = picked(a, opts.ranges);
  const moving = asked.filter(i => !setsState(i));
  const stayed = asked.length - moving.length;
  const inPiece = new Set(moving);
  const r = pieceReport(a, moving);
  const blockers = r.blockers.slice();
  for (const i of moving) {
    const t = a.statements[i].type;
    if (t === 'ReturnStatement') blockers.push("the closure's return statement cannot move");
  }
  if (blockers.length) return { blockers, report: r };

  const handedFns = r.needs.fn.slice().sort();
  const handedFixed = r.needs.fixed.slice().sort();
  const given = [...r.gives.fn, ...r.gives.fixed].sort();
  const handed = [...handedFixed, ...handedFns];
  const lines = src.split('\n');
  const text = (from, to) => lines.slice(from - 1, to).join('\n');

  /* The moved text, in file order, each run of neighbours kept together. */
  const runs = [];
  for (const i of moving) {
    const st = a.statements[i];
    const last = runs[runs.length - 1];
    if (last && last.lastIndex === i - 1) {
      last.to = st.to;
      last.lastIndex = i;
    } else runs.push({ from: st.from, to: st.to, lastIndex: i });
  }
  const moved = runs.map(run => text(run.from, run.to).replace(/^\n+|\n+$/g, '')).join('\n\n');

  const names = moving.flatMap(i => a.statements[i].declares);
  const today = new Date().toISOString().slice(0, 10);
  const base = opts.to.split('/').pop();
  const piece =
    '// @ts-check\n' +
    `/* ${base} — ${opts.title || 'part of ' + opts.file}. Moved from ${opts.file}\n` +
    `   on ${today} with scripts/split/cut.mjs, as text, unchanged. ${host} hands\n` +
    `   over what this file uses through configure(). It loads before ${opts.file.split('/').pop()}. */\n` +
    `/** @type {any} */ (window).${G} = (function () {\n` +
    "  'use strict';\n\n" +
    (handed.length
      ? `  /* Handed over by ${host} (configure). */\n` +
        `  var ${handed.join(', ')};\n` +
        '  function configure(h) {\n' +
        handed.map(n => `    if ('${n}' in h) ${n} = h.${n};`).join('\n') +
        '\n  }\n\n'
      : '  function configure() {}\n\n') +
    moved +
    '\n\n  return {\n    configure: configure,\n' +
    given.map(n => `    ${n}: ${n},`).join('\n') +
    (given.length ? '\n' : '') +
    '  };\n})();\n';

  /* The main file: the moved lines go; pointers and configure calls come. */
  const gone = new Set();
  for (const run of runs) for (let n = run.from; n <= run.to; n++) gone.add(n);
  const isScaffold = st => {
    const node = a.body[st.i];
    if (node.directive) return true;
    if (node.type === 'VariableDeclaration') {
      return node.declarations.every(
        d =>
          (d.id.name === 'state' && d.init && d.init.type === 'ObjectExpression' && !d.init.properties.length) ||
          (d.init &&
            d.init.type === 'MemberExpression' &&
            d.init.object.type === 'Identifier' &&
            !d.init.computed &&
            d.init.property.name === d.id.name),
      );
    }
    return (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      node.expression.callee.type === 'MemberExpression' &&
      node.expression.callee.property.name === 'configure'
    );
  };
  const kept = a.statements.filter(st => !inPiece.has(st.i));
  const holder = kept.find(st => {
    const node = a.body[st.i];
    return node.type === 'VariableDeclaration' && node.declarations[0].id.name === 'state';
  });
  const directive = kept.find(st => a.body[st.i].directive);
  const afterPointers = holder || directive;
  if (!afterPointers) throw new Error("the main file has no 'use strict' line to put the pointers after");
  let scaffoldEnd = afterPointers;
  for (const st of kept) {
    if (st.i <= afterPointers.i) continue;
    if (!isScaffold(st)) break;
    scaffoldEnd = st;
  }
  const pad = '  ';
  const pointerText = given.length
    ? `\n${pad}/* In ${base} (moved ${today}). */\n` + given.map(n => `${pad}var ${n} = ${G}.${n};`).join('\n')
    : '';
  const firstCall = ['state', ...handedFns].filter(n => n !== 'state' || handedFixed.includes('state'));
  const lateFixed = handedFixed.filter(n => n !== 'state');
  const callText = list => `${pad}${G}.configure({ ${list.map(n => `${n}: ${n}`).join(', ')} });`;
  let lateAfter = null;
  for (const n of lateFixed) {
    const st = a.statements[a.names[n].declaredIn];
    if (!lateAfter || st.i > lateAfter.i) lateAfter = st;
  }
  /* A set-once value declared in the scaffold itself (an earlier piece's
     pointer) is ready at the first call. */
  const early = lateFixed.filter(n => a.names[n].declaredIn <= scaffoldEnd.i);
  const late = lateFixed.filter(n => a.names[n].declaredIn > scaffoldEnd.i);
  const insertions = new Map();
  const add = (line, t) => insertions.set(line, (insertions.get(line) || '') + t);
  if (pointerText) add(afterPointers.to, pointerText);
  if (firstCall.length || early.length) add(scaffoldEnd.to, '\n' + callText([...firstCall, ...early]));
  if (late.length) add(lateAfter.to, '\n' + callText(late));

  const out = [];
  lines.forEach((line, k) => {
    const n = k + 1;
    if (!gone.has(n)) out.push(line);
    if (insertions.has(n)) out.push(...insertions.get(n).replace(/^\n/, '').split('\n'));
  });
  for (const n of insertions.keys()) if (gone.has(n)) throw new Error('an insertion point sits inside the moved lines');
  return {
    blockers: [],
    report: r,
    piece,
    main: out.join('\n').replace(/\n{3,}/g, '\n\n'),
    lines: r.lines,
    stayed,
    names,
    handed,
    given,
    host,
  };
}

/* ── The proof ──────────────────────────────────────────────── */

function load(src) {
  const { ast } = parse(src);
  setParents(ast, null);
  const closure = closureOf(ast, src);
  if (!closure) throw new Error('not one closure');
  const manager = scopes(ast, { ecmaVersion: 2022, sourceType: 'script', range: true });
  return { ast, closure, body: closure.fn.body.body, manager, scope: manager.acquire(closure.fn) };
}
const line = n => (n.loc ? n.loc.start.line : '?');
const declaredNames = st =>
  st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration'
    ? [st.id.name]
    : st.type === 'VariableDeclaration'
      ? st.declarations.map(d => d.id.name)
      : [];

export function proveMove(before, mainNow, pieceNow) {
  const O = load(before);
  const M = load(mainNow);
  const P = load(pieceNow);
  const G = P.closure.name;
  if (!G) throw new Error('the new file does not assign its closure to window.Name');
  const written = [];

  /* The new file's own lines: 'use strict', the handed-over names,
     configure, the return. Everything else must come from the old file. */
  const handed = new Set();
  let sawConfigure = false;
  let returned = null;
  const pieceRest = [];
  for (const st of P.body) {
    if (st.directive === 'use strict') continue;
    if (
      st.type === 'VariableDeclaration' &&
      st.kind === 'var' &&
      !sawConfigure &&
      st.declarations.every(d => !d.init && d.id.type === 'Identifier') &&
      !pieceRest.length
    ) {
      st.declarations.forEach(d => handed.add(d.id.name));
      written.push(`${G}: var ${[...handed].join(', ')}`);
      continue;
    }
    if (st.type === 'FunctionDeclaration' && st.id.name === 'configure' && !pieceRest.length) {
      sawConfigure = true;
      const h = st.params[0] && st.params[0].name;
      const seen = new Set();
      for (const s of st.body.body) {
        const ok =
          s.type === 'IfStatement' &&
          !s.alternate &&
          s.test.type === 'BinaryExpression' &&
          s.test.operator === 'in' &&
          s.test.left.type === 'Literal' &&
          s.test.right.type === 'Identifier' &&
          s.test.right.name === h &&
          s.consequent.type === 'ExpressionStatement' &&
          s.consequent.expression.type === 'AssignmentExpression' &&
          s.consequent.expression.operator === '=' &&
          s.consequent.expression.left.type === 'Identifier' &&
          s.consequent.expression.left.name === s.test.left.value &&
          s.consequent.expression.right.type === 'MemberExpression' &&
          !s.consequent.expression.right.computed &&
          s.consequent.expression.right.object.name === h &&
          s.consequent.expression.right.property.name === s.test.left.value &&
          handed.has(s.test.left.value);
        if (!ok) throw new Error(`${G}.configure does more than take what it is handed (line ${line(s)})`);
        seen.add(s.test.left.value);
      }
      for (const n of handed) if (!seen.has(n)) throw new Error(`${G}.configure never takes ${n}`);
      written.push(`${G}: configure(h)`);
      continue;
    }
    if (st.type === 'ReturnStatement') {
      returned = st;
      continue;
    }
    pieceRest.push(st);
  }
  if (!sawConfigure) throw new Error(`${G} has no configure()`);
  if (!returned || returned !== P.body[P.body.length - 1]) throw new Error(`${G} must end with its return`);
  const pieceNames = new Set(pieceRest.flatMap(declaredNames));
  const exported = new Set();
  for (const p of returned.argument.properties) {
    const ok =
      p.type === 'Property' &&
      !p.computed &&
      p.key.type === 'Identifier' &&
      p.value.type === 'Identifier' &&
      p.value.name === p.key.name;
    if (!ok) throw new Error(`${G}'s return renames or computes something (line ${line(p)})`);
    if (p.key.name !== 'configure' && !pieceNames.has(p.key.name))
      throw new Error(`${G} returns ${p.key.name}, which it does not define`);
    exported.add(p.key.name);
  }
  written.push(`${G}: return { ${[...exported].join(', ')} }`);

  /* The main file's own new lines: pointers to G and calls to G.configure. */
  const pointers = new Set();
  const mainRest = [];
  const mainNames = new Set(M.body.flatMap(declaredNames));
  for (const st of M.body) {
    const isPointer =
      st.type === 'VariableDeclaration' &&
      st.declarations.every(
        d =>
          d.init &&
          d.init.type === 'MemberExpression' &&
          !d.init.computed &&
          d.init.object.type === 'Identifier' &&
          d.init.object.name === G &&
          d.init.property.name === d.id.name,
      );
    if (isPointer) {
      for (const d of st.declarations) {
        if (!exported.has(d.id.name))
          throw new Error(`the main file points at ${G}.${d.id.name}, which ${G} does not return`);
        pointers.add(d.id.name);
      }
      written.push(`main: var ${st.declarations.map(d => d.id.name).join(', ')} = ${G}.…`);
      continue;
    }
    const e = st.type === 'ExpressionStatement' ? st.expression : null;
    if (
      e &&
      e.type === 'CallExpression' &&
      e.callee.type === 'MemberExpression' &&
      e.callee.object.name === G &&
      e.callee.property.name === 'configure'
    ) {
      const arg = e.arguments[0];
      if (e.arguments.length !== 1 || arg.type !== 'ObjectExpression')
        throw new Error(`a ${G}.configure call is not one plain object (line ${line(st)})`);
      for (const p of arg.properties) {
        const ok =
          p.type === 'Property' &&
          !p.computed &&
          p.key.type === 'Identifier' &&
          p.value.type === 'Identifier' &&
          p.value.name === p.key.name;
        if (!ok) throw new Error(`a ${G}.configure call renames or computes something (line ${line(p)})`);
        if (!handed.has(p.key.name))
          throw new Error(`the main file hands over ${p.key.name}, which ${G} does not take`);
        if (!mainNames.has(p.key.name))
          throw new Error(`the main file hands over ${p.key.name}, which it does not define`);
      }
      written.push(`main: ${G}.configure({ ${arg.properties.map(p => p.key.name).join(', ')} })`);
      continue;
    }
    mainRest.push(st);
  }

  /* The old statements, in order, are the main file's and the new file's. */
  let m = 0;
  let p = 0;
  let movedCount = 0;
  for (const st of O.body) {
    if (m < mainRest.length && sameTree(st, mainRest[m])) m++;
    else if (p < pieceRest.length && sameTree(st, pieceRest[p])) {
      p++;
      movedCount++;
    } else {
      throw new Error(
        `the old statement at line ${line(st)} is neither the main file's next statement (line ${m < mainRest.length ? line(mainRest[m]) : 'end'}) ` +
          `nor the new file's (line ${p < pieceRest.length ? line(pieceRest[p]) : 'end'})`,
      );
    }
  }
  if (m !== mainRest.length)
    throw new Error(`the main file has a statement the old file did not (line ${line(mainRest[m])})`);
  if (p !== pieceRest.length)
    throw new Error(`the new file has a statement the old file did not (line ${line(pieceRest[p])})`);

  /* Outside the closure's body the main file is untouched. */
  const keepO = O.closure.fn.body.body;
  const keepM = M.closure.fn.body.body;
  O.closure.fn.body.body = [];
  M.closure.fn.body.body = [];
  const outsideSame = sameTree(O.ast, M.ast);
  O.closure.fn.body.body = keepO;
  M.closure.fn.body.body = keepM;
  if (!outsideSame) throw new Error('the main file changed outside its closure body');

  /* Every name is still reachable: nothing in either file now reads, as a
     bare global, a name the old closure defined. */
  const oldNames = new Set(O.scope.variables.map(v => v.name));
  const oldGlobals = new Set(O.manager.globalScope.through.map(r => r.identifier.name));
  for (const [who, X] of [
    ['the main file', M],
    [G, P],
  ]) {
    for (const r of X.manager.globalScope.through) {
      const n = r.identifier.name;
      if (oldNames.has(n) && !oldGlobals.has(n))
        throw new Error(`${who} uses ${n} at line ${line(r.identifier)} but no longer has it`);
    }
  }
  /* Nothing in the new file runs while it loads except declarations. */
  for (const st of pieceRest) {
    if (!/Declaration$/.test(st.type)) throw new Error(`${G} runs a statement while loading (line ${line(st)})`);
  }
  return { global: G, moved: movedCount, kept: m, written, handed: [...handed], pointers: [...pointers] };
}

/* ── Command line ───────────────────────────────────────────── */

if (import.meta.url === 'file://' + process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const file = args[0];
  try {
    if (!file || file.startsWith('--')) throw new Error('usage: see the top of scripts/split/cut.mjs');
    if (args.includes('--prove')) {
      const before = execFileSync('git', ['show', `${opt('--prove')}:${file}`], {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      });
      const r = proveMove(before, fs.readFileSync(file, 'utf8'), fs.readFileSync(opt('--piece'), 'utf8'));
      console.log(
        `PROVED: ${r.moved} statements moved from ${file} to ${opt('--piece')} unchanged; ${r.kept} stayed, unchanged and in order.\n` +
          `Lines written on purpose (${r.written.length}):\n  ` +
          r.written.join('\n  '),
      );
    } else {
      const ranges = opt('--lines')
        .split(',')
        .map(x => x.split('-').map(Number));
      const r = cut(fs.readFileSync(file, 'utf8'), {
        file,
        to: opt('--to'),
        global: opt('--global'),
        title: opt('--title'),
        ranges,
      });
      if (r.blockers.length) {
        console.log(`STOPPED: these lines cannot move as they are:\n  ${[...new Set(r.blockers)].join('\n  ')}`);
        process.exit(1);
      }
      console.log(
        `${r.lines} lines, ${r.names.length} names move to ${opt('--to')} (window.${opt('--global')}).\n` +
          (r.stayed ? `${r.stayed} state.x = … lines inside those lines stay in the main file.\n` : '') +
          `Handed over (${r.handed.length}): ${r.handed.join(', ') || 'nothing'}\n` +
          `The main file still uses (${r.given.length}): ${r.given.join(', ') || 'nothing'}`,
      );
      if (!args.includes('--dry')) {
        fs.writeFileSync(opt('--to'), r.piece);
        fs.writeFileSync(file, r.main);
        console.log('Written. Run prettier on both, then --prove.');
      }
    }
  } catch (e) {
    console.error('NOT PROVED / stopped: ' + e.message);
    process.exit(1);
  }
}
