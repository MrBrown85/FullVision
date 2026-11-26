// scripts/split/analyze.mjs — reads one browser script and says what each
// top-level statement declares and which of the file's own names it reads,
// assigns or changes in place. map.mjs prints it; cut.mjs and prove.mjs use it.
//
// A file is either one closure (`window.Name = (function () { … })();`, the
// page files) or plain top-level code (`shared/data.js`). In a closure the
// "module" is the closure's body; in plain code it is the whole program.
import fs from 'node:fs';
import * as acorn from 'acorn';
import { analyze as scopes } from 'eslint-scope';

const MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);

export function parse(src) {
  const comments = [];
  const ast = acorn.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    ranges: true,
    locations: true,
    onComment: comments,
  });
  return { ast, comments };
}

/* The closure a file is made of, if it is one: the function in
   `window.Name = (function () { … })();` when that statement is most of the
   file. */
export function closureOf(ast) {
  for (const st of ast.body) {
    if (st.type !== 'ExpressionStatement') continue;
    let e = st.expression;
    let name = null;
    if (e.type === 'AssignmentExpression') {
      if (e.left.type === 'MemberExpression' && !e.left.computed) name = e.left.property.name;
      e = e.right;
    }
    if (e.type !== 'CallExpression') continue;
    const fn = e.callee;
    if (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression') continue;
    if (fn.body.type !== 'BlockStatement') continue;
    // Most of the file's code, comments above and below it aside.
    const code = ast.body[ast.body.length - 1].end - ast.body[0].start;
    if (st.end - st.start < code * 0.8) continue;
    return { fn, name, statement: st };
  }
  return null;
}

export function setParents(node, parent) {
  if (!node || typeof node.type !== 'string') return;
  node.parent = parent;
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach(c => setParents(c, node));
    else if (v && typeof v.type === 'string') setParents(v, node);
  }
}

/* Is this identifier the root of something changed in place:
   `x.a = …`, `x[k]++`, `delete x.a`, `x.list.push(…)`? */
function changedInPlace(id) {
  let n = id;
  let depth = 0;
  while (n.parent && n.parent.type === 'MemberExpression' && n.parent.object === n) {
    const m = n.parent;
    const p = m.parent;
    if (!p) break;
    if (p.type === 'AssignmentExpression' && p.left === m) return true;
    if (p.type === 'UpdateExpression' && p.argument === m) return true;
    if (p.type === 'UnaryExpression' && p.operator === 'delete' && p.argument === m) return true;
    if (
      p.type === 'CallExpression' &&
      p.callee === m &&
      !m.computed &&
      m.property.type === 'Identifier' &&
      MUTATORS.has(m.property.name)
    )
      return true;
    n = m;
    if (++depth > 12) break;
  }
  return false;
}

function insideFunction(node, stop) {
  for (let n = node.parent; n && n !== stop; n = n.parent) {
    if (/Function/.test(n.type)) return true;
  }
  return false;
}

export function analyzeFile(file) {
  return analyzeSource(fs.readFileSync(file, 'utf8'), file);
}

export function analyzeSource(src, file = '') {
  const { ast, comments } = parse(src);
  setParents(ast, null);
  const manager = scopes(ast, { ecmaVersion: 2026, sourceType: 'script', range: true });
  const closure = closureOf(ast, src);
  const moduleNode = closure ? closure.fn : ast;
  const body = closure ? closure.fn.body.body : ast.body;
  const scope = manager.acquire(moduleNode);
  const lineOf = pos => acorn.getLineInfo(src, pos).line;

  /* Each statement owns the lines after the one before it, so its comment
     and blank lines travel with it. */
  const firstLine = closure ? lineOf(closure.fn.body.start) + 1 : 1;
  const statements = body.map((node, i) => {
    const prevEnd = i === 0 ? firstLine - 1 : lineOf(body[i - 1].end);
    return {
      i,
      type: node.type,
      from: Math.max(prevEnd + 1, 1),
      own: lineOf(node.start),
      to: lineOf(node.end),
      start: node.start,
      end: node.end,
      declares: [],
      reads: new Set(),
      assigns: new Set(),
      changes: new Set(),
      loadReads: new Set(),
      runsAtLoad: false,
    };
  });
  const indexAt = pos => {
    let lo = 0;
    let hi = statements.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pos < statements[mid].start) hi = mid - 1;
      else if (pos >= statements[mid].end) lo = mid + 1;
      else return mid;
    }
    return -1;
  };

  const names = {};
  for (const v of scope.variables) {
    if (v.name === 'arguments' || !v.defs.length) continue;
    const def = v.defs[0];
    const at = indexAt(def.name.range[0]);
    if (at < 0) continue; // a parameter of the closure
    const kind =
      def.type === 'FunctionName' ? 'function' : def.type === 'ClassName' ? 'class' : def.parent.kind || 'var';
    const info = {
      name: v.name,
      kind,
      declaredIn: at,
      reassignedIn: new Set(),
      readIn: new Set(),
      changedIn: new Set(),
    };
    names[v.name] = info;
    statements[at].declares.push(v.name);
    for (const ref of v.references) {
      const id = ref.identifier;
      const si = indexAt(id.range[0]);
      if (si < 0) continue;
      const st = statements[si];
      const atLoad = !insideFunction(id, body[si]) && !(body[si].type === 'FunctionDeclaration');
      if (ref.isWrite() && !(ref.init && si === at)) {
        st.assigns.add(v.name);
        info.reassignedIn.add(si);
      }
      if (ref.isRead() || (!ref.isWrite() && !ref.isRead())) {
        st.reads.add(v.name);
        info.readIn.add(si);
        if (atLoad && si !== at) st.loadReads.add(v.name);
      }
      if (changedInPlace(id)) {
        st.changes.add(v.name);
        info.changedIn.add(si);
      }
    }
  }
  body.forEach((node, i) => {
    const t = node.type;
    statements[i].runsAtLoad = !(
      t === 'FunctionDeclaration' ||
      t === 'ClassDeclaration' ||
      t === 'VariableDeclaration' ||
      t === 'ReturnStatement' ||
      (t === 'ExpressionStatement' && node.directive)
    );
  });

  /* Banner comments between statements name the sections:
     a comment holding a run of ─, ═, = or - three or more long. */
  const banners = comments
    .filter(c => /[─═]{3,}|={4,}|-{6,}/.test(c.value) && indexAt(c.start) < 0)
    .filter(c => !closure || (c.start > closure.fn.body.start && c.end < closure.fn.body.end))
    .map(c => ({
      line: lineOf(c.start),
      title: c.value
        .split('\n')[0]
        .replace(/[─═=*]+/g, ' ')
        .replace(/^[\s-]+|[\s-]+$/g, '')
        .trim(),
    }));
  const sections = [];
  let current = { title: '(top)', line: firstLine, statements: [] };
  let b = 0;
  for (const st of statements) {
    while (b < banners.length && banners[b].line <= st.own) {
      if (current.statements.length) sections.push(current);
      current = { title: banners[b].title, line: banners[b].line, statements: [] };
      b++;
    }
    current.statements.push(st.i);
  }
  if (current.statements.length) sections.push(current);
  sections.forEach((s, k) => {
    s.id = 'S' + k;
    s.from = statements[s.statements[0]].from;
    s.to = statements[s.statements[s.statements.length - 1]].to;
  });

  return {
    file,
    src,
    lines: src.split('\n').length - 1,
    closure: closure ? { name: closure.name } : null,
    body,
    statements,
    names,
    sections,
    globalsRead: [...new Set(manager.globalScope.through.map(r => r.identifier.name))].sort(),
  };
}

/* What moving a set of statements to their own file would take.
   `fn`: a function declaration no one reassigns: a one-line stand-in works.
   `fixed`: a variable set once, at its declaration: it can be handed over once.
   `moving`: a variable someone reassigns later: no stand-in can follow it. */
export function pieceReport(a, picked) {
  const inPiece = new Set(picked);
  const needs = { fn: [], fixed: [], moving: [], assigns: [] };
  const gives = { fn: [], fixed: [], moving: [] };
  const atLoad = [];
  const stable = n => n.reassignedIn.size === 0;
  for (const info of Object.values(a.names)) {
    const mine = inPiece.has(info.declaredIn);
    const usedInside = [...info.readIn, ...info.reassignedIn, ...info.changedIn].some(i => inPiece.has(i));
    const usedOutside = [...info.readIn, ...info.reassignedIn, ...info.changedIn].some(i => !inPiece.has(i));
    if (!mine && usedInside) {
      if ([...info.reassignedIn].some(i => inPiece.has(i))) needs.assigns.push(info.name);
      else if (info.kind === 'function' && stable(info)) needs.fn.push(info.name);
      else if (stable(info)) needs.fixed.push(info.name);
      else needs.moving.push(info.name);
    }
    if (mine && usedOutside) {
      if (info.kind === 'function' && stable(info)) gives.fn.push(info.name);
      else if (stable(info)) gives.fixed.push(info.name);
      else gives.moving.push(info.name);
    }
  }
  for (const i of picked) {
    const st = a.statements[i];
    if (st.runsAtLoad) atLoad.push('statement at line ' + st.own + ' runs when the file loads');
    for (const n of st.loadReads) {
      if (!inPiece.has(a.names[n].declaredIn))
        atLoad.push('line ' + st.own + ' reads ' + n + ' while loading, before the main file exists');
    }
  }
  /* The main file reading a moved name while it loads is fine (the piece
     loads first), unless the piece's name is itself set from the main file. */
  const lines = picked.reduce((sum, i) => sum + (a.statements[i].to - a.statements[i].from + 1), 0);
  const blockers = [
    ...needs.moving.map(n => 'reads ' + n + ', which the main file reassigns'),
    ...needs.assigns.map(n => 'assigns ' + n + ', which the main file owns'),
    ...gives.moving.map(n => 'owns ' + n + ', which is reassigned and used by the main file'),
    ...atLoad,
  ];
  return { lines, needs, gives, blockers };
}
