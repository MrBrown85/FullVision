// scripts/size-limits.mjs — how long a source file and a function may be.
//
// New code: a file at most FILE_LIMIT lines, a function at most
// FUNCTION_LIMIT lines (Colin, 2026-11-26; DECISIONS, "Size limits for new
// code"). Code already longer is listed in a baseline with its length today:
// it may stay the same or shrink, never grow, and a listed number comes down
// when the code does. tests/file-size.test.js and tests/function-size.test.js
// hold the code to them.
//
// Lines are counted as ESLint's max-lines and max-lines-per-function count
// them: every line, comments and blank lines included. A function invoked
// where it is written (the `(function () { … })()` that wraps a page file) is
// not a function for this count, as ESLint's IIFEs option leaves it out.
//
//   node scripts/size-limits.mjs           report what is over and what fails
//   node scripts/size-limits.mjs --update  lower and drop baseline entries to
//                                          match the code, and follow functions
//                                          that moved to another file; never
//                                          raises an entry or adds one
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { DIRS, EXEMPT } from './typecheck-ratchet.mjs';

export const FILE_LIMIT = 400;
export const FUNCTION_LIMIT = 50;
export const FILE_BASELINE = 'tests/file-size-baseline.json';
export const FUNCTION_BASELINE = 'tests/function-size-baseline.json';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export function sourceFiles(root = ROOT) {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.js') && !EXEMPT.some(re => re.test(rel))) out.push(rel);
    }
  };
  DIRS.forEach(walk);
  return out.sort();
}

export const lineCount = text => (text.match(/\n/g) || []).length;

/* ── Naming a function so its baseline entry survives edits ──────────
   The path of named functions around it, then its own name: the function
   declared, the variable or property it is assigned to, or, for a callback,
   the call it is handed to (`render > forEach callback 2`). The file is not
   part of the name, so --update can follow a function cut to another file. */

function memberText(n) {
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'ThisExpression') return 'this';
  if (n.type === 'MemberExpression' && !n.computed) {
    const left = memberText(n.object);
    return left ? left + '.' + n.property.name : null;
  }
  return null;
}

function keyName(k) {
  if (!k) return null;
  if (k.type === 'Identifier' || k.type === 'PrivateIdentifier') return k.name;
  if (k.type === 'Literal') return String(k.value);
  return null;
}

const isFunction = n =>
  n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

function isInvokedInPlace(fn, parent) {
  if (!parent) return false;
  if (parent.type === 'CallExpression' && parent.callee === fn) return true;
  // (function () {}).call(this) and .apply
  if (
    parent.type === 'MemberExpression' &&
    parent.object === fn &&
    !parent.computed &&
    (parent.property.name === 'call' || parent.property.name === 'apply')
  )
    return true;
  return false;
}

function ownName(fn, parent) {
  if (fn.id && fn.id.name) return fn.id.name;
  if (!parent) return null;
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (parent.type === 'AssignmentExpression' && parent.right === fn) return memberText(parent.left);
  if (
    (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') &&
    parent.value === fn
  )
    return keyName(parent.key);
  return null;
}

function callbackName(fn, parent) {
  if (
    parent &&
    (parent.type === 'CallExpression' || parent.type === 'NewExpression') &&
    parent.arguments.includes(fn)
  ) {
    const c = parent.callee;
    const name =
      c.type === 'MemberExpression' && !c.computed ? c.property.name : c.type === 'Identifier' ? c.name : null;
    return (name || 'call') + ' callback';
  }
  return 'function';
}

/* Every function over the limit in one file's source, by name. */
export function longFunctions(src, limit = FUNCTION_LIMIT) {
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true });
  } catch {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  }
  const found = {};
  const seen = {};
  const counters = new Map();
  function visit(node, parent, trail) {
    if (!node || typeof node.type !== 'string') return;
    let next = trail;
    if (isFunction(node) && !isInvokedInPlace(node, parent)) {
      let name = ownName(node, parent);
      if (!name) {
        const base = callbackName(node, parent);
        const scope = trail.join(' > ');
        const k = scope + '|' + base;
        counters.set(k, (counters.get(k) || 0) + 1);
        name = base + ' ' + counters.get(k);
      }
      next = trail.concat(name);
      let key = next.join(' > ');
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] > 1) key += ' #' + seen[key];
      const lines = node.loc.end.line - node.loc.start.line + 1;
      if (lines > limit) found[key] = { lines, line: node.loc.start.line };
    }
    for (const field of Object.keys(node)) {
      if (field === 'loc') continue;
      const v = node[field];
      if (Array.isArray(v)) v.forEach(c => visit(c, node, next));
      else if (v && typeof v.type === 'string') visit(v, node, next);
    }
  }
  visit(ast, null, []);
  return found;
}

/* What the code is today. */
export function measure(root = ROOT) {
  const files = {};
  const functions = {};
  for (const rel of sourceFiles(root)) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    files[rel] = lineCount(src);
    for (const [name, f] of Object.entries(longFunctions(src)))
      functions[rel + ' :: ' + name] = { ...f, file: rel, name };
  }
  return { files, functions };
}

export function readBaseline(rel, root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

const fmt = n => n.toLocaleString('en-US');

/* Each problem, in a sentence that says what to do. */
export function fileProblems(now, fileBase) {
  const out = [];
  for (const [rel, lines] of Object.entries(now.files)) {
    const listed = rel in fileBase;
    if (!listed && lines > FILE_LIMIT)
      out.push(`${rel} has ${fmt(lines)} lines; a file may have ${FILE_LIMIT}. Move a part into its own file.`);
    else if (listed && lines > fileBase[rel])
      out.push(
        `${rel} has ${fmt(lines)} lines; it may not grow past ${fmt(fileBase[rel])}. Move a part into its own file.`,
      );
    else if (listed && lines < fileBase[rel])
      out.push(`${rel} shrank to ${fmt(lines)} lines. Run node scripts/size-limits.mjs --update to lower its entry.`);
  }
  for (const rel of Object.keys(fileBase)) {
    if (!(rel in now.files)) out.push(`${rel} is gone. Run node scripts/size-limits.mjs --update.`);
    else if (now.files[rel] <= FILE_LIMIT)
      out.push(`${rel} is within ${FILE_LIMIT} lines. Run node scripts/size-limits.mjs --update.`);
  }
  return out;
}

export function functionProblems(now, fnBase) {
  const out = [];
  for (const [key, f] of Object.entries(now.functions)) {
    if (!(key in fnBase))
      out.push(
        `${f.file}:${f.line} ${f.name} has ${f.lines} lines; a function may have ${FUNCTION_LIMIT}. Split it into smaller functions. ` +
          `If it moved here from another file, run node scripts/size-limits.mjs --update.`,
      );
    else if (f.lines > fnBase[key])
      out.push(
        `${f.file}:${f.line} ${f.name} has ${f.lines} lines; it may not grow past ${fnBase[key]}. Split it into smaller functions.`,
      );
    else if (f.lines < fnBase[key])
      out.push(`${f.file}:${f.line} ${f.name} shrank to ${f.lines} lines. Run node scripts/size-limits.mjs --update.`);
  }
  for (const key of Object.keys(fnBase)) {
    if (!(key in now.functions))
      out.push(`${key} is gone or within ${FUNCTION_LIMIT} lines. Run node scripts/size-limits.mjs --update.`);
  }
  return out;
}

export const problems = (now, fileBase, fnBase) => [...fileProblems(now, fileBase), ...functionProblems(now, fnBase)];

/* The baselines brought down to the code: never raised, never added to,
   except that an entry follows its function to another file when the
   function there is no longer than it was. */
export function updated(now, fileBase, fnBase) {
  const files = {};
  for (const [rel, limit] of Object.entries(fileBase)) {
    const lines = now.files[rel];
    if (lines > FILE_LIMIT) files[rel] = Math.min(limit, lines);
  }
  const functions = {};
  const orphans = new Map();
  for (const [key, limit] of Object.entries(fnBase)) {
    if (key in now.functions) functions[key] = Math.min(limit, now.functions[key].lines);
    else orphans.set(key.split(' :: ')[1], (orphans.get(key.split(' :: ')[1]) || []).concat({ key, limit }));
  }
  const followed = [];
  for (const [key, f] of Object.entries(now.functions)) {
    if (key in fnBase) continue;
    const candidates = orphans.get(f.name) || [];
    const i = candidates.findIndex(c => f.lines <= c.limit);
    if (i < 0) continue;
    const [c] = candidates.splice(i, 1);
    functions[key] = f.lines;
    followed.push(`${c.key} -> ${f.file}`);
  }
  const sortObj = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { files: sortObj(files), functions: sortObj(functions), followed };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const now = measure();
  const fileBase = readBaseline(FILE_BASELINE);
  const fnBase = readBaseline(FUNCTION_BASELINE);
  if (process.argv.includes('--update')) {
    const u = updated(now, fileBase, fnBase);
    fs.writeFileSync(path.join(ROOT, FILE_BASELINE), JSON.stringify(u.files, null, 2) + '\n');
    fs.writeFileSync(path.join(ROOT, FUNCTION_BASELINE), JSON.stringify(u.functions, null, 2) + '\n');
    u.followed.forEach(m => console.log('followed: ' + m));
  }
  const left = problems(now, readBaseline(FILE_BASELINE), readBaseline(FUNCTION_BASELINE));
  const overFiles = Object.values(now.files).filter(n => n > FILE_LIMIT).length;
  console.log(
    `${Object.keys(now.files).length} files: ${overFiles} over ${FILE_LIMIT} lines. ` +
      `${Object.keys(now.functions).length} functions over ${FUNCTION_LIMIT} lines.`,
  );
  if (left.length) {
    console.log(left.join('\n'));
    process.exit(1);
  }
}
