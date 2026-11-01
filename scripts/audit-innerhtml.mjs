#!/usr/bin/env node
/*
 * scripts/audit-innerhtml.mjs
 *
 * Finds every innerHTML/outerHTML assignment and every insertAdjacentHTML call
 * across teacher/, teacher-mobile/, shared/, and login-auth.js. Classifies the
 * HTML-producing expression.
 *
 * v2 does two passes:
 *   Pass 1 — builds a global index of named functions (function decl, var f =
 *            function/arrow, window.X = function, obj methods) so we can look
 *            up the body of a helper called at a sink.
 *   Pass 2 — classifies each sink's RHS, with three new tricks:
 *             (a) bare identifiers are traced to their binding within the
 *                 enclosing function scope (up to 5 hops)
 *             (b) calls to locally-defined helpers are recursed into (the
 *                 helper's return expressions are classified)
 *             (c) a recursion-guard prevents cycles
 *
 * Output:
 *   docs/xss-audit.csv — file,line,col,sink,classification,notes,snippet
 *   stdout             — summary + grouped UNKNOWN list
 *
 * Modes:
 *   (none)              write the CSV; exit non-zero if any UNKNOWN remains.
 *   --check             write nothing; exit non-zero only for an UNKNOWN site
 *                       that isn't in docs/xss-baseline.json (CI runs this:
 *                       `npm run audit:html`).
 *   --update-baseline   write docs/xss-baseline.json from today's UNKNOWNs.
 *                       Run it after making sites safe, so the list shrinks.
 * A baseline entry is the file, the sink and the sink's source with its
 * whitespace collapsed, so moving code doesn't change it; the count allows
 * the same line twice in one file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { simple as walkSimple, ancestor as walkAncestor, findNodeAround } from 'acorn-walk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..');

const ROOTS = ['teacher', 'teacher-mobile', 'shared', 's', 'login-auth.js'];
const BASELINE_PATH = path.join(REPO, 'docs', 'xss-baseline.json');
const MODE = process.argv.includes('--update-baseline')
  ? 'update-baseline'
  : process.argv.includes('--check')
    ? 'check'
    : 'csv';
const EXCLUDE_DIR = new Set([
  'node_modules',
  'dist',
  'vendor',
  '.git',
  '_dev',
  'test-results',
  '.netlify',
  '.playwright-cli',
]);

// shared/html.js's esc (every page loads it first), and the names it has on
// the phone (MC.esc / MComponents.esc) and in window.GB.
const SAFE_HELPERS = new Set(['esc', 'sanitizeHtml', '_esc', 'cssColor', 'encodeURIComponent']);
const SAFE_MEMBER_HELPERS = new Set(['MC.esc', 'MComponents.esc', 'GB.esc', 'window.GB.esc']);

function memberName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const obj = memberName(node.object);
    return obj ? obj + '.' + node.property.name : null;
  }
  return null;
}

const SAFE_ID_PATTERNS = [/(^|[._])id$/i, /Id$/, /Ids$/, /Count$/, /^i$|^j$|^n$|^idx$|^index$/, /^len$|^length$/];

const MAX_TRACE_DEPTH = 15;

function isSafeIdentName(name) {
  return SAFE_ID_PATTERNS.some(r => r.test(name));
}

function collectFiles(root) {
  const abs = path.join(REPO, root);
  if (!fs.existsSync(abs)) return [];
  const st = fs.statSync(abs);
  if (st.isFile()) return abs.endsWith('.js') ? [abs] : [];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (EXCLUDE_DIR.has(ent.name)) continue;
    const p = path.join(abs, ent.name);
    if (ent.isDirectory()) out.push(...collectFiles(path.relative(REPO, p)));
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/* `html-safe: <reason>` in a comment marks HTML a person has checked:
   - on the line(s) just above a function: everything it returns is
     escaped or fixed markup, so a call to it is REVIEWED;
   - on the line just above (or at the end of) a sink: the HTML it sets
     was built by checked code (a stored string, a template constant).
   The reason says what makes it safe. Every function that shares the name
   must carry its own marker, since the index is by name. */
const SAFE_MARK = /html-safe:\s*\S/;
const SAFE_LINES = new Map(); // file → Set of line numbers a marker covers

function parseFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const comments = [];
  const opts = sourceType => ({ ecmaVersion: 'latest', sourceType, locations: true, onComment: comments });
  let result;
  try {
    result = { src, ast: parse(src, opts('script')) };
  } catch (_) {
    comments.length = 0;
    try {
      result = { src, ast: parse(src, opts('module')) };
    } catch (e) {
      return { src, ast: null, parseError: e.message };
    }
  }
  const lines = new Set();
  for (const c of comments) {
    if (!SAFE_MARK.test(c.value)) continue;
    // The comment's own lines and the two below it.
    for (let l = c.loc.start.line; l <= c.loc.end.line + 2; l++) lines.add(l);
  }
  SAFE_LINES.set(file, lines);
  return result;
}

function isMarked(file, line) {
  const lines = SAFE_LINES.get(file);
  return !!(lines && lines.has(line));
}

function snippet(src, node, max = 180) {
  const s = src.slice(node.start, node.end).replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ─────────── Global function index (pass 1) ─────────── */

/** Map name → array of { file, fnNode, src, ast } (can have duplicates). */
const FN_INDEX = new Map();

function indexFunctions(file, ast, src) {
  if (!ast) return;
  function register(name, fnNode) {
    if (!name || !fnNode) return;
    const arr = FN_INDEX.get(name) || [];
    arr.push({ file, fnNode, src, ast, reviewed: isMarked(file, fnNode.loc.start.line) });
    FN_INDEX.set(name, arr);
  }

  walkSimple(ast, {
    FunctionDeclaration(n) {
      if (n.id && n.id.name) register(n.id.name, n);
    },
    VariableDeclarator(n) {
      if (
        n.id.type === 'Identifier' &&
        n.init &&
        (n.init.type === 'FunctionExpression' || n.init.type === 'ArrowFunctionExpression')
      ) {
        register(n.id.name, n.init);
      }
    },
    AssignmentExpression(n) {
      // obj.method = function () {...}, window.X = ...
      if (
        n.left.type === 'MemberExpression' &&
        n.left.property &&
        n.left.property.name &&
        (n.right.type === 'FunctionExpression' || n.right.type === 'ArrowFunctionExpression')
      ) {
        register(n.left.property.name, n.right);
      }
    },
    Property(n) {
      // { renderX: function() {...} } or { renderX() {...} }
      if (
        n.key &&
        n.key.name &&
        (n.value.type === 'FunctionExpression' || n.value.type === 'ArrowFunctionExpression')
      ) {
        register(n.key.name, n.value);
      }
    },
    MethodDefinition(n) {
      if (n.key && n.key.name && n.value) register(n.key.name, n.value);
    },
  });
}

/* ─────────── Scope + identifier binding ─────────── */

function enclosingFunction(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const n = ancestors[i];
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      return n;
    }
  }
  return null;
}

/** Find the initializer/assigned value of a bare identifier in a function scope.
 *  Returns the expression node, or null. */
function findBinding(fnNode, name, sinkStart) {
  if (!fnNode) return null;
  let found = null;
  walkSimple(fnNode.body, {
    VariableDeclarator(n) {
      if (n.id.type === 'Identifier' && n.id.name === name && n.init) {
        // Only accept bindings before the sink in source order
        if (n.end <= sinkStart && (!found || n.end > found._pos)) {
          found = n.init;
          found._pos = n.end;
        }
      }
    },
    AssignmentExpression(n) {
      if (n.left.type === 'Identifier' && n.left.name === name) {
        if (n.end <= sinkStart && (!found || n.end > found._pos)) {
          found = n.right;
          found._pos = n.end;
        }
      }
    },
  });
  return found;
}

/* ─────────── Classifier (pass 2) ─────────── */

function classify(expr, ctx, depth = 0) {
  if (!expr) return { kind: 'UNKNOWN', note: 'null' };
  if (depth > MAX_TRACE_DEPTH) return { kind: 'UNKNOWN', note: 'depth-limit' };

  switch (expr.type) {
    case 'Literal':
      return { kind: 'LITERAL' };

    case 'TemplateLiteral': {
      const parts = expr.expressions.map(e => classify(e, ctx, depth + 1));
      return mergeParts(parts, 'template');
    }

    case 'BinaryExpression':
      if (expr.operator === '+') {
        const parts = [classify(expr.left, ctx, depth + 1), classify(expr.right, ctx, depth + 1)];
        return mergeParts(parts, 'concat');
      }
      if (['<', '>', '<=', '>=', '==', '===', '!=', '!==', '%', '/', '*', '-'].includes(expr.operator)) {
        return { kind: 'TRUSTED_EXPR', note: 'numeric/bool' };
      }
      return { kind: 'UNKNOWN', note: 'binary:' + expr.operator };

    case 'UnaryExpression':
      return { kind: 'TRUSTED_EXPR', note: 'unary:' + expr.operator };

    case 'LogicalExpression':
      return mergeParts([classify(expr.left, ctx, depth + 1), classify(expr.right, ctx, depth + 1)], 'logical');

    case 'ConditionalExpression':
      return mergeParts(
        [classify(expr.consequent, ctx, depth + 1), classify(expr.alternate, ctx, depth + 1)],
        'ternary',
      );

    case 'CallExpression': {
      const callee = expr.callee;
      // esc/escJs/sanitizeHtml wrapping
      if (callee.type === 'Identifier' && SAFE_HELPERS.has(callee.name)) {
        return callee.name === 'sanitizeHtml'
          ? { kind: 'SANITIZED', via: callee.name }
          : { kind: 'ESC_WRAPPED', via: callee.name };
      }
      if (callee.type === 'MemberExpression' && SAFE_MEMBER_HELPERS.has(memberName(callee))) {
        return { kind: 'ESC_WRAPPED', via: memberName(callee) };
      }
      // (...).toFixed / .toString / .padStart / .padEnd → trusted
      if (callee.type === 'MemberExpression') {
        const meth = callee.property && callee.property.name;
        if (['toFixed', 'toString', 'padStart', 'padEnd'].includes(meth)) {
          return { kind: 'TRUSTED_EXPR', note: meth };
        }
        // arr.map(fn).join(...)  → classify fn's return
        if (
          meth === 'join' &&
          callee.object.type === 'CallExpression' &&
          callee.object.callee.type === 'MemberExpression' &&
          callee.object.callee.property.name === 'map' &&
          callee.object.arguments[0] &&
          /Function/.test(callee.object.arguments[0].type)
        ) {
          return classifyFnReturn(callee.object.arguments[0], ctx, depth + 1);
        }
        if (meth === 'join' && callee.object.type === 'ArrayExpression') {
          return mergeParts(
            callee.object.elements.filter(Boolean).map(e => classify(e, ctx, depth + 1)),
            'array.join',
          );
        }
      }
      // String(x), Number(x), parseInt(x), Boolean(x), Math.round/floor/...
      if (
        callee.type === 'Identifier' &&
        ['String', 'Number', 'parseInt', 'parseFloat', 'Boolean'].includes(callee.name)
      ) {
        return { kind: 'TRUSTED_EXPR', note: callee.name };
      }
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Math') {
        return { kind: 'TRUSTED_EXPR', note: 'Math.' + (callee.property.name || '?') };
      }
      // Local helper: look up in FN_INDEX
      let helperName = null;
      if (callee.type === 'Identifier') helperName = callee.name;
      else if (callee.type === 'MemberExpression' && callee.property.name) helperName = callee.property.name;

      if (helperName && FN_INDEX.has(helperName)) {
        const cands = FN_INDEX.get(helperName);
        if (ctx.visitedHelpers.has(helperName)) {
          return { kind: 'UNKNOWN', note: 'helper-cycle:' + helperName };
        }
        ctx.visitedHelpers.add(helperName);
        try {
          // classify each candidate's return, then merge (worst wins)
          const parts = cands.map(c =>
            c.reviewed
              ? { kind: 'REVIEWED', via: helperName }
              : classifyFnReturn(c.fnNode, { ...ctx, file: c.file, src: c.src }, depth + 1),
          );
          const merged = mergeParts(parts, 'helper:' + helperName);
          if (merged.kind !== 'UNKNOWN') return merged;
          return { kind: 'UNKNOWN', note: 'helper:' + helperName + (merged.note ? '|' + merged.note : '') };
        } finally {
          ctx.visitedHelpers.delete(helperName);
        }
      }
      return { kind: 'UNKNOWN', note: 'call:' + (helperName || '?') };
    }

    case 'Identifier': {
      if (isSafeIdentName(expr.name)) return { kind: 'TRUSTED_EXPR', note: 'ident:' + expr.name };
      // Trace binding in enclosing function
      if (ctx.fnNode && !ctx.tracedIdents.has(expr.name)) {
        ctx.tracedIdents.add(expr.name);
        try {
          const init = findBinding(ctx.fnNode, expr.name, ctx.sinkStart);
          if (init) return classify(init, ctx, depth + 1);
        } finally {
          ctx.tracedIdents.delete(expr.name);
        }
      }
      return { kind: 'UNKNOWN', note: 'ident:' + expr.name };
    }

    case 'MemberExpression': {
      const prop = expr.property && (expr.property.name || expr.property.value);
      if (prop && isSafeIdentName(String(prop))) return { kind: 'TRUSTED_EXPR', note: 'member:' + prop };
      return { kind: 'UNKNOWN', note: 'member:' + (prop || '?') };
    }

    case 'ArrayExpression':
      return mergeParts(
        expr.elements.filter(Boolean).map(e => classify(e, ctx, depth + 1)),
        'array',
      );

    case 'ObjectExpression':
      return { kind: 'UNKNOWN', note: 'object' };

    case 'AssignmentExpression':
      return classify(expr.right, ctx, depth + 1);

    case 'SequenceExpression':
      return classify(expr.expressions[expr.expressions.length - 1], ctx, depth + 1);

    default:
      return { kind: 'UNKNOWN', note: expr.type };
  }
}

function classifyFnReturn(fnNode, ctx, depth) {
  if (!fnNode) return { kind: 'UNKNOWN', note: 'no-fn' };
  if (fnNode.body.type !== 'BlockStatement') {
    // Arrow with expression body
    return classify(fnNode.body, { ...ctx, fnNode, sinkStart: fnNode.end }, depth + 1);
  }
  const rets = [];
  walkSimple(fnNode.body, {
    ReturnStatement(r) {
      if (r.argument) rets.push(r.argument);
    },
  });
  if (rets.length === 0) return { kind: 'UNKNOWN', note: 'no-return' };
  return mergeParts(
    rets.map(r => classify(r, { ...ctx, fnNode, sinkStart: r.end }, depth + 1)),
    'fn-return',
  );
}

function mergeParts(parts, tag) {
  if (parts.length === 0) return { kind: 'LITERAL' };
  const kinds = new Set(parts.map(p => p.kind));
  if (kinds.has('UNKNOWN')) {
    const unknowns = parts.filter(p => p.kind === 'UNKNOWN').slice(0, 3);
    return { kind: 'UNKNOWN', note: tag + ':' + unknowns.map(u => u.note || '?').join(',') };
  }
  if (kinds.has('REVIEWED')) return { kind: 'REVIEWED', note: tag };
  if (kinds.has('SANITIZED')) return { kind: 'SANITIZED', note: tag };
  if (kinds.has('ESC_WRAPPED')) return { kind: 'ESC_WRAPPED', note: tag };
  if (kinds.has('TRUSTED_EXPR')) return { kind: 'TRUSTED_EXPR', note: tag };
  return { kind: 'LITERAL', note: tag };
}

/* ─────────── Audit a parsed file ─────────── */

function auditFile(file, ast, src) {
  if (!ast) return [];
  const rel = path.relative(REPO, file);
  const sites = [];

  walkAncestor(ast, {
    AssignmentExpression(node, ancestors) {
      const L = node.left;
      if (L.type !== 'MemberExpression') return;
      const p = L.property && (L.property.name || L.property.value);
      if (p !== 'innerHTML' && p !== 'outerHTML') return;
      const fnNode = enclosingFunction(ancestors.slice(0, -1));
      const ctx = { file: rel, src, fnNode, sinkStart: node.end, visitedHelpers: new Set(), tracedIdents: new Set() };
      const cls = isMarked(file, node.loc.start.line)
        ? { kind: 'REVIEWED', note: 'marked at the sink' }
        : classify(node.right, ctx);
      sites.push({
        file: rel,
        line: node.loc.start.line,
        col: node.loc.start.column,
        sink: p,
        classification: cls.kind,
        note: cls.note || '',
        via: cls.via || '',
        snippet: snippet(src, node),
      });
    },
    CallExpression(node, ancestors) {
      const c = node.callee;
      if (c.type !== 'MemberExpression') return;
      const name = c.property && c.property.name;
      if (name !== 'insertAdjacentHTML') return;
      const htmlArg = node.arguments[1];
      if (!htmlArg) return;
      const fnNode = enclosingFunction(ancestors.slice(0, -1));
      const ctx = { file: rel, src, fnNode, sinkStart: node.end, visitedHelpers: new Set(), tracedIdents: new Set() };
      const cls = isMarked(file, node.loc.start.line)
        ? { kind: 'REVIEWED', note: 'marked at the sink' }
        : classify(htmlArg, ctx);
      sites.push({
        file: rel,
        line: node.loc.start.line,
        col: node.loc.start.column,
        sink: name,
        classification: cls.kind,
        note: cls.note || '',
        via: cls.via || '',
        snippet: snippet(src, node),
      });
    },
  });

  return sites;
}

/* ─────────── Main ─────────── */

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function main() {
  const files = [];
  for (const r of ROOTS) files.push(...collectFiles(r));
  files.sort();

  // Pass 1 — parse and index
  const parsed = [];
  const parseErrors = [];
  for (const f of files) {
    const { src, ast, parseError } = parseFile(f);
    if (parseError) parseErrors.push({ file: path.relative(REPO, f), error: parseError });
    parsed.push({ file: f, src, ast });
    indexFunctions(f, ast, src);
  }

  // Pass 2 — audit
  const allSites = [];
  for (const { file, src, ast } of parsed) allSites.push(...auditFile(file, ast, src));

  const unknownSites = allSites.filter(s => s.classification === 'UNKNOWN');
  if (MODE === 'check') return check(unknownSites, parseErrors);
  if (MODE === 'update-baseline') return updateBaseline(unknownSites);

  // CSV
  const rows = [['file', 'line', 'col', 'sink', 'classification', 'note', 'via', 'snippet']];
  for (const s of allSites) rows.push([s.file, s.line, s.col, s.sink, s.classification, s.note, s.via, s.snippet]);
  const csvPath = path.join(REPO, 'docs', 'xss-audit.csv');
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, rows.map(r => r.map(csvEscape).join(',')).join('\n') + '\n');

  // Summary
  const by = {};
  for (const s of allSites) by[s.classification] = (by[s.classification] || 0) + 1;
  const total = allSites.length;
  const unknowns = allSites.filter(s => s.classification === 'UNKNOWN');

  console.log('\n=== innerHTML / insertAdjacentHTML audit (v2, scope-aware) ===');
  console.log(`Files scanned:    ${files.length}`);
  console.log(`Helpers indexed:  ${FN_INDEX.size}`);
  console.log(`Sites found:      ${total}`);
  console.log('By classification:');
  for (const [k, v] of Object.entries(by).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${k.padEnd(14)} ${v}`);
  }
  console.log(`\nCSV written: ${path.relative(REPO, csvPath)}`);

  if (unknowns.length) {
    const byFile = {};
    for (const s of unknowns) (byFile[s.file] ||= []).push(s);
    console.log(`\n--- UNKNOWN sites (${unknowns.length}) by file ---`);
    for (const [f, ss] of Object.entries(byFile).sort(([, a], [, b]) => b.length - a.length)) {
      console.log(`\n${f}  (${ss.length})`);
      for (const s of ss) {
        console.log(`  ${String(s.line).padStart(5)}:${String(s.col).padEnd(3)} [${s.sink}]  ${s.note}`);
        console.log(`       ${s.snippet}`);
      }
    }
  }

  if (parseErrors.length) {
    console.log(`\n--- Parse errors (${parseErrors.length}) ---`);
    for (const p of parseErrors) console.log(`  ${p.file}: ${p.error}`);
  }

  process.exitCode = unknowns.length > 0 ? 1 : 0;
}

/* ─────────── Baseline (--check, --update-baseline) ─────────── */

function baselineKey(s) {
  return s.file + ' | ' + s.sink + ' | ' + s.snippet;
}

function countKeys(sites) {
  const counts = {};
  for (const s of sites) counts[baselineKey(s)] = (counts[baselineKey(s)] || 0) + 1;
  return counts;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')).unknown || {};
}

function updateBaseline(unknownSites) {
  const counts = countKeys(unknownSites);
  const sorted = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = counts[k];
  const doc = {
    note:
      'innerHTML sites the audit cannot prove safe (scripts/audit-innerhtml.mjs). ' +
      'CI fails on any site not listed here. Make a site safe (esc, textContent), ' +
      'then run: node scripts/audit-innerhtml.mjs --update-baseline',
    total: unknownSites.length,
    unknown: sorted,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n');
  console.log(`Baseline written: ${path.relative(REPO, BASELINE_PATH)} (${unknownSites.length} sites)`);
}

function check(unknownSites, parseErrors) {
  const baseline = readBaseline();
  const counts = countKeys(unknownSites);
  const fresh = [];
  for (const s of unknownSites) {
    const k = baselineKey(s);
    if ((baseline[k] || 0) < counts[k] && !fresh.some(f => baselineKey(f) === k)) fresh.push(s);
  }
  const gone = Object.keys(baseline).filter(k => !counts[k]).length;
  console.log(`innerHTML audit: ${unknownSites.length} unproven sites, ${Object.keys(baseline).length} baselined.`);
  if (gone) {
    console.log(`${gone} baselined site(s) are gone or now safe: run --update-baseline to shrink the list.`);
  }
  if (parseErrors.length) {
    for (const p of parseErrors) console.log(`Parse error: ${p.file}: ${p.error}`);
    process.exitCode = 1;
  }
  if (fresh.length) {
    console.log(`\n${fresh.length} new innerHTML site(s) the audit can't prove safe.`);
    console.log('Wrap the value in esc(...), use textContent, or build the element with the DOM:');
    for (const s of fresh) console.log(`  ${s.file}:${s.line}  [${s.sink}]  ${s.snippet}`);
    process.exitCode = 1;
  }
}

main();
