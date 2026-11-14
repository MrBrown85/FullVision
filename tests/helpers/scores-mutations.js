/* Where the app's source changes a class's scores in memory in place.

   A class's scores live in memory at _cache.scores[cid], the object
   getScores(cid) hands back (shared/data.js). The Draft and Returned rule
   trusts that memory and the saved copy agree while _scoresApart is down
   (_savedScoresAreMine), so every place that changes that object must save
   the whole list or raise _scoresApart. tests/scores-memory-guard.test.js
   holds each place to that; this file finds the places.

   It follows the object through the source, read with acorn:
   - Live (the object itself, or a part of it): getScores(…), _cache.scores
     and anything read from them (scores[sid], an entry a find gives), a
     variable or parameter given one, the item a forEach / map / find /
     some / every / reduce / for…of over one hands its callback, and what a
     function answers when it hands back one (its own, or the one it was
     given: _migrateRubricScoreKeys answers the object it took).
   - Items live (a new list or object holding live parts): what filter,
     slice or concat answers on a live list, and Object.assign / Object.values
     of a live object. Changing the new list itself changes nothing in
     memory; changing one of its items does.
   - A copy (structuredClone, _cloneValue, JSON.parse, a map that makes new
     objects) is not followed.
   A parameter is followed when a call passes it a live value: f(…) calls
   every function named f, Module.f(…) the f in the file that makes Module,
   and any other x.f(…) the one function named f when only one has that
   name. A name is looked up through the functions around it, so the finder
   may see more than is there, never less, for the shapes it follows.

   A change in place is: an assignment into a live object (x[k] = …,
   x.k = …, x.k += …, x.k++) or into _cache.scores, delete x[k], a live
   list's push, pop, shift, unshift, splice, sort, reverse, fill or
   copyWithin, and Object.assign or Object.defineProperty onto a live
   object. Each is reported under the nearest named function around it. */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'acorn';

const LIVE = 2;
const ITEMS = 1;

const FIND = new Set(['find', 'findLast', 'at', 'pop', 'shift']);
const NEW_LIST = new Set(['filter', 'slice', 'concat', 'flat', 'values', 'reverse', 'sort', 'splice']);
// A loop method, and which of its callback's parameters is the item.
const EACH = {
  forEach: 0,
  map: 0,
  filter: 0,
  find: 0,
  findIndex: 0,
  findLast: 0,
  some: 0,
  every: 0,
  flatMap: 0,
  reduce: 1,
  reduceRight: 1,
};
const CHANGES_LIST = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

function children(node, visit) {
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(c => c && typeof c.type === 'string' && visit(c));
    else if (value && typeof value.type === 'string') visit(value);
  }
}
const isFn = n =>
  n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression';
const propName = m =>
  m.computed ? (m.property.type === 'Literal' ? String(m.property.value) : null) : m.property.name;
const calleeName = c =>
  c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed ? c.property.name : null;
const isCacheScores = m =>
  m.type === 'MemberExpression' &&
  m.object.type === 'Identifier' &&
  m.object.name === '_cache' &&
  propName(m) === 'scores';
const isObjectCall = (c, name) =>
  c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'Object' && propName(c) === name;

// The name a function goes by: declared, given to a variable, a property or a member.
function nameOf(fn) {
  if (fn.id) return fn.id.name;
  const p = fn.parent;
  if (!p) return null;
  if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  if (p.type === 'Property' && !p.computed) return p.key.name || String(p.key.value);
  if (p.type === 'AssignmentExpression' && p.right === fn) {
    if (p.left.type === 'Identifier') return p.left.name;
    if (p.left.type === 'MemberExpression') return propName(p.left);
  }
  return null;
}

function each(ast, visit) {
  (function walk(n) {
    visit(n);
    children(n, walk);
  })(ast);
}

/* `files`: paths under `root`, or { file, source } to read a source as
   given. Answers the changes found, and the finder's own readers for the
   guard's checks: whether an expression is live, the functions a call may
   run, each file's tree, and a function's name. */
export function findScoreMutations(root, files) {
  const programs = files.map(entry => {
    const file = typeof entry === 'string' ? entry : entry.file;
    const source = typeof entry === 'string' ? readFileSync(resolve(root, file), 'utf-8') : entry.source;
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
    (function link(node, parent) {
      node.parent = parent;
      children(node, c => link(c, node));
    })(ast, null);
    return { file, ast };
  });

  const scopeOf = node => {
    for (let n = node.parent; n; n = n.parent) if (isFn(n) || n.type === 'Program') return n;
    return null;
  };
  const paramIndex = (s, name) => (isFn(s) ? s.params.findIndex(p => p.type === 'Identifier' && p.name === name) : -1);

  const byName = new Map(); // function name → [function nodes]
  const fileOf = new Map(); // function node → file
  const moduleFile = new Map(); // Grader → the file that makes it
  programs.forEach(({ file, ast }) => {
    each(ast, n => {
      if (!isFn(n)) return;
      fileOf.set(n, file);
      const name = nameOf(n);
      if (name) (byName.get(name) || (byName.set(name, []), byName.get(name))).push(n);
    });
    ast.body.forEach(st => {
      if (st.type === 'VariableDeclaration')
        st.declarations.forEach(
          d => d.id.type === 'Identifier' && /^[A-Z]/.test(d.id.name) && moduleFile.set(d.id.name, file),
        );
      const e = st.type === 'ExpressionStatement' && st.expression;
      if (
        e &&
        e.type === 'AssignmentExpression' &&
        e.left.type === 'MemberExpression' &&
        e.left.object.name === 'window'
      )
        moduleFile.set(propName(e.left), file);
    });
  });
  const called = c => {
    if (c.type === 'Identifier') return byName.get(c.name) || [];
    if (c.type !== 'MemberExpression' || c.computed) return [];
    const list = byName.get(c.property.name) || [];
    const o = c.object;
    if (o.type === 'Identifier' && o.name === 'window') return list;
    if (o.type === 'Identifier' && moduleFile.has(o.name))
      return list.filter(fn => fileOf.get(fn) === moduleFile.get(o.name));
    return list.length === 1 ? list : [];
  };

  /* Two passes over the same rules. The first, with no parameter followed,
     learns what each function answers: its own live value (ownReturn), and
     which parameters it can hand back (paramReturn, from `paths`, the
     parameters each name may hold). The second follows parameters from the
     calls, and reads a call's answer from those two, call by call. */
  const ownReturn = new Map(); // function → level
  const paramReturn = new Map(); // function → Set(index)
  const paths = new Map(); // scope → Map(name → Set('<fn id>:<index>'))
  const fnId = new Map();
  let nextId = 0;
  const idOf = fn => (fnId.has(fn) ? fnId.get(fn) : (fnId.set(fn, nextId++), fnId.get(fn)));
  let taint = new Map(); // scope → Map(name → level)
  const table = (map, s) => map.get(s) || (map.set(s, new Map()), map.get(s));

  const levelOfName = (name, at) => {
    for (let s = scopeOf(at); s; s = scopeOf(s)) {
      const v = table(taint, s).get(name);
      if (v) return v;
      if (paramIndex(s, name) >= 0) return 0;
    }
    return 0;
  };
  function level(e) {
    if (!e) return 0;
    switch (e.type) {
      case 'Identifier':
        return levelOfName(e.name, e);
      case 'MemberExpression':
        if (isCacheScores(e)) return LIVE;
        return level(e.object) ? LIVE : 0;
      case 'ChainExpression':
        return level(e.expression);
      case 'LogicalExpression':
        return Math.max(level(e.left), level(e.right));
      case 'ConditionalExpression':
        return Math.max(level(e.consequent), level(e.alternate));
      case 'SequenceExpression':
        return level(e.expressions[e.expressions.length - 1]);
      case 'AssignmentExpression':
        return level(e.right);
      case 'CallExpression': {
        const c = e.callee;
        const name = calleeName(c);
        if (name === 'getScores') return LIVE;
        if (isObjectCall(c, 'assign')) return e.arguments.some(a => level(a)) ? ITEMS : 0;
        if (isObjectCall(c, 'values')) return level(e.arguments[0]) ? ITEMS : 0;
        if (c.type === 'MemberExpression' && !c.computed && level(c.object)) {
          if (FIND.has(name)) return LIVE;
          if (NEW_LIST.has(name)) return ITEMS;
        }
        let lv = 0;
        called(c).forEach(fn => {
          lv = Math.max(lv, ownReturn.get(fn) || 0);
          (paramReturn.get(fn) || new Set()).forEach(i => (lv = Math.max(lv, level(e.arguments[i]))));
        });
        return lv;
      }
      default:
        return 0;
    }
  }
  const union = (...sets) => {
    const out = new Set();
    sets.forEach(s => s && s.forEach(x => out.add(x)));
    return out;
  };
  const pathsOfName = (name, at) => {
    for (let s = scopeOf(at); s; s = scopeOf(s)) {
      const v = table(paths, s).get(name);
      const i = paramIndex(s, name);
      if (i >= 0) return union(v, new Set([idOf(s) + ':' + i]));
      if (v) return v;
    }
    return new Set();
  };
  function pathsOf(e) {
    if (!e) return new Set();
    switch (e.type) {
      case 'Identifier':
        return pathsOfName(e.name, e);
      case 'MemberExpression':
        return pathsOf(e.object);
      case 'ChainExpression':
        return pathsOf(e.expression);
      case 'LogicalExpression':
        return union(pathsOf(e.left), pathsOf(e.right));
      case 'ConditionalExpression':
        return union(pathsOf(e.consequent), pathsOf(e.alternate));
      case 'SequenceExpression':
        return pathsOf(e.expressions[e.expressions.length - 1]);
      case 'AssignmentExpression':
        return pathsOf(e.right);
      case 'CallExpression': {
        const c = e.callee;
        const name = calleeName(c);
        if (isObjectCall(c, 'assign') || isObjectCall(c, 'values')) return union(...e.arguments.map(pathsOf));
        if (c.type === 'MemberExpression' && !c.computed && (FIND.has(name) || NEW_LIST.has(name)))
          return pathsOf(c.object);
        const out = new Set();
        called(c).forEach(fn =>
          (paramReturn.get(fn) || new Set()).forEach(i => pathsOf(e.arguments[i]).forEach(x => out.add(x))),
        );
        return out;
      }
      default:
        return new Set();
    }
  }

  const markLevel = (scope, name, lv) => {
    if (!scope || !lv) return false;
    const m = table(taint, scope);
    if ((m.get(name) || 0) >= lv) return false;
    m.set(name, lv);
    return true;
  };
  const markPaths = (scope, name, set) => {
    if (!scope || !set.size) return false;
    const m = table(paths, scope);
    const had = m.get(name) || new Set();
    const next = union(had, set);
    if (next.size === had.size) return false;
    m.set(name, next);
    return true;
  };
  const declaredIn = (name, at) => {
    for (let s = scopeOf(at); s; s = scopeOf(s))
      if (table(taint, s).has(name) || table(paths, s).has(name) || paramIndex(s, name) >= 0) return s;
    return scopeOf(at);
  };
  const raiseReturn = (fn, lv, set) => {
    let changed = false;
    if (lv > (ownReturn.get(fn) || 0)) {
      ownReturn.set(fn, lv);
      changed = true;
    }
    const mine = paramReturn.get(fn) || new Set();
    set.forEach(x => {
      const [id, i] = x.split(':');
      if (Number(id) === idOf(fn) && !mine.has(Number(i))) {
        mine.add(Number(i));
        changed = true;
      }
    });
    paramReturn.set(fn, mine);
    return changed;
  };

  function pass(followParams) {
    for (let changed = true; changed; ) {
      changed = false;
      const bind = (scope, name, value) => {
        changed = markLevel(scope, name, level(value)) || changed;
        if (!followParams) changed = markPaths(scope, name, pathsOf(value)) || changed;
      };
      programs.forEach(({ ast }) =>
        each(ast, n => {
          if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init)
            bind(scopeOf(n), n.id.name, n.init);
          if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && n.operator === '=')
            bind(declaredIn(n.left.name, n), n.left.name, n.right);
          if (n.type === 'ForOfStatement') {
            const decl = n.left.type === 'VariableDeclaration';
            const left = decl ? n.left.declarations[0].id : n.left;
            if (left.type === 'Identifier') {
              const s = decl ? scopeOf(n) : declaredIn(left.name, n);
              changed = markLevel(s, left.name, level(n.right) ? LIVE : 0) || changed;
              if (!followParams) changed = markPaths(s, left.name, pathsOf(n.right)) || changed;
            }
          }
          if (!followParams && n.type === 'ReturnStatement' && n.argument && isFn(scopeOf(n)))
            changed = raiseReturn(scopeOf(n), level(n.argument), pathsOf(n.argument)) || changed;
          if (!followParams && n.type === 'ArrowFunctionExpression' && n.expression)
            changed = raiseReturn(n, level(n.body), pathsOf(n.body)) || changed;
          if (n.type !== 'CallExpression') return;
          const c = n.callee;
          const name = calleeName(c);
          // A loop over a live list hands its callback a live item.
          if (c.type === 'MemberExpression' && !c.computed && name in EACH) {
            const cb = n.arguments[0];
            const p = cb && isFn(cb) && cb.params[EACH[name]];
            if (p && p.type === 'Identifier') {
              changed = markLevel(cb, p.name, level(c.object) ? LIVE : 0) || changed;
              if (!followParams) changed = markPaths(cb, p.name, pathsOf(c.object)) || changed;
            }
          }
          // A call that passes a live value: the parameter is live.
          if (followParams)
            n.arguments.forEach((a, i) => {
              const lv = level(a);
              if (!lv) return;
              called(c).forEach(fn => {
                const p = fn.params[i];
                if (p && p.type === 'Identifier') changed = markLevel(fn, p.name, lv) || changed;
              });
            });
        }),
      );
    }
  }
  pass(false);
  taint = new Map();
  pass(true);

  // The changes in place.
  const found = [];
  programs.forEach(({ file, ast }) => {
    const where = n => {
      for (let s = scopeOf(n); s && s.type !== 'Program'; s = scopeOf(s)) {
        const name = nameOf(s);
        if (name) return name;
      }
      return '(top level)';
    };
    const add = (n, what) => found.push({ file, fn: where(n), line: n.loc.start.line, what, node: n });
    const liveTarget = m => m.type === 'MemberExpression' && level(m.object) === LIVE;
    each(ast, n => {
      if (n.type === 'AssignmentExpression' && (liveTarget(n.left) || isCacheScores(n.left))) add(n, 'assignment');
      if (n.type === 'UpdateExpression' && liveTarget(n.argument)) add(n, 'update');
      if (n.type === 'UnaryExpression' && n.operator === 'delete' && liveTarget(n.argument)) add(n, 'delete');
      if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.computed) return;
      const name = propName(n.callee);
      if (CHANGES_LIST.has(name) && level(n.callee.object) === LIVE) add(n, name);
      if (
        (isObjectCall(n.callee, 'assign') || isObjectCall(n.callee, 'defineProperty')) &&
        level(n.arguments[0]) === LIVE
      )
        add(n, 'Object.' + name);
    });
  });
  return { found, isLive: e => level(e) > 0, called, programs };
}

export { isFn, nameOf, calleeName, each };

// The nearest named function around a node: where a change is reported.
export function namedFunctionAround(node) {
  for (let n = node.parent; n; n = n.parent) if (isFn(n) && nameOf(n)) return n;
  return null;
}
