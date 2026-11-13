/**
 * Compares what build A and build B left after one step of a differential
 * run, and says what differs in words a person can read.
 *
 * Three things are compared:
 * - the device's saved copy: every localStorage key, as the exact text
 *   stored (so a change in key order counts), and the IndexedDB records;
 * - the calls sent to the server, in order, endpoint and parameters;
 * - the text of the screens a teacher and a student see.
 *
 * Nothing here is normalised: page-init.js makes ids, keys and times the
 * same in A and B. NORMALISE below is where a value that cannot be made the
 * same would be listed; docs/differential-run.md lists the same.
 */

/* Values left out of the comparison: [kind, test, why]. Empty: nothing has
   needed it. */
export const NORMALISE = [];

const MAX_SHOWN = 12;

function short(value, max = 160) {
  let s;
  try {
    s = value === undefined ? 'nothing' : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s === undefined) s = String(value);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function isObject(v) {
  return v !== null && typeof v === 'object';
}

/* A list's entries by their id, when every entry is an object with its own
   id (score entries, students, pieces); else null. */
function byId(list) {
  const map = new Map();
  for (const x of list) {
    if (!isObject(x) || Array.isArray(x)) return null;
    if (typeof x.id !== 'string' && typeof x.id !== 'number') return null;
    if (map.has(x.id)) return null;
    map.set(x.id, x);
  }
  return map;
}

/* How many of two entries' fields differ, their ids aside. */
function fieldsApart(x, y) {
  let n = 0;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (k !== 'id' && JSON.stringify(x[k]) !== JSON.stringify(y[k])) n++;
  }
  return n;
}

/* Two lists of entries with ids, compared entry by entry and not place by
   place: one entry more or fewer, or one whose key changed, is named, where
   a place-by-place comparison would report every entry after it. An entry
   only A has and one only B has that are alike but for a field or two are
   shown as one entry whose key changed. */
function diffById(a, b, ia, ib, path, out, limit) {
  const start = out.length;
  const at = id => path + '[' + id + ']';
  let onlyA = a.filter(x => !ib.has(x.id));
  const onlyB = b.filter(x => !ia.has(x.id));
  for (const y of onlyB.slice()) {
    let best = null;
    for (const x of onlyA) {
      const apart = fieldsApart(x, y);
      if (apart <= 2 && Object.keys(x).length >= 4 && (!best || apart < best.apart)) best = { x, apart };
    }
    if (!best) continue;
    onlyA = onlyA.filter(x => x !== best.x);
    onlyB.splice(onlyB.indexOf(y), 1);
    diffValues(best.x, y, path + '[' + best.x.id + ' in A, ' + y.id + ' in B]', out, limit);
  }
  for (const x of onlyA) if (out.length < limit) out.push({ path: at(x.id), a: x, b: undefined });
  for (const y of onlyB) if (out.length < limit) out.push({ path: at(y.id), a: undefined, b: y });
  for (const x of a) {
    if (out.length >= limit) break;
    if (ib.has(x.id)) diffValues(x, ib.get(x.id), at(x.id), out, limit);
  }
  if (out.length === start) {
    // The same entries: only their order can differ.
    const i = a.findIndex((x, n) => !b[n] || b[n].id !== x.id);
    if (i >= 0)
      out.push({
        path: path + ' (the order of its entries, from place ' + (i + 1) + ')',
        a: a[i].id,
        b: b[i] && b[i].id,
      });
  }
  return out;
}

/* Every place two JSON values differ, as { path, a, b }, at most `limit`.
   Lists of entries with ids are compared by id (diffById). */
export function diffValues(a, b, path = '', out = [], limit = MAX_SHOWN) {
  if (out.length >= limit) return out;
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    const ia = byId(a);
    const ib = byId(b);
    if (ia && ib) return diffById(a, b, ia, ib, path, out, limit);
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n && out.length < limit; i++) diffValues(a[i], b[i], path + '[' + i + ']', out, limit);
    return out;
  }
  if (isObject(a) && isObject(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      if (out.length >= limit) break;
      diffValues(a[k], b[k], path ? path + '.' + k : k, out, limit);
    }
    return out;
  }
  if (Number.isNaN(a) && Number.isNaN(b)) return out;
  out.push({ path: path || '(the whole value)', a, b });
  return out;
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* Storage: { key: raw text }. Answers a list of readable lines, empty when
   the two are the same byte for byte. */
export function compareStorage(sa, sb, label = 'localStorage') {
  const lines = [];
  const keys = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].sort();
  for (const key of keys) {
    const a = sa[key];
    const b = sb[key];
    if (a === b) continue;
    if (a === undefined) {
      lines.push(label + ' ' + key + ': only in B: ' + short(parse(b)));
      continue;
    }
    if (b === undefined) {
      lines.push(label + ' ' + key + ': only in A: ' + short(parse(a)));
      continue;
    }
    const diffs = diffValues(parse(a), parse(b));
    if (!diffs.length) {
      lines.push(label + ' ' + key + ': the same values, saved in a different order');
      continue;
    }
    lines.push(label + ' ' + key + ':');
    for (const d of diffs) lines.push('  ' + d.path + '  A: ' + short(d.a) + '  B: ' + short(d.b));
  }
  return lines;
}

/* Calls: [{ tab, name, params }] in the order they were made. */
export function compareCalls(ca, cb) {
  const n = Math.max(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const a = ca[i];
    const b = cb[i];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const lines = ['server call ' + (i + 1) + ' of this step differs:'];
    if (!a) lines.push('  A made no call here; B called ' + b.name + ' ' + short(b.params, 300));
    else if (!b) lines.push('  B made no call here; A called ' + a.name + ' ' + short(a.params, 300));
    else if (a.name !== b.name || a.tab !== b.tab) {
      lines.push('  A called ' + a.name + ' (tab ' + a.tab + ') ' + short(a.params, 200));
      lines.push('  B called ' + b.name + ' (tab ' + b.tab + ') ' + short(b.params, 200));
    } else {
      lines.push('  both called ' + a.name + ', with different parameters:');
      for (const d of diffValues(a.params, b.params))
        lines.push('    ' + d.path + '  A: ' + short(d.a) + '  B: ' + short(d.b));
    }
    lines.push('  calls this step: A ' + ca.map(c => c.name).join(', ') + ' | B ' + cb.map(c => c.name).join(', '));
    return lines;
  }
  return [];
}

/* Screens: { name: text }. The first differing line of each, with the line
   before it. */
export function compareScreens(xa, xb) {
  const lines = [];
  const names = [...new Set([...Object.keys(xa), ...Object.keys(xb)])];
  for (const name of names) {
    const a = xa[name];
    const b = xb[name];
    if (a === b) continue;
    if (a == null || b == null) {
      lines.push('screen ' + name + ': drawn only in ' + (a == null ? 'B' : 'A'));
      continue;
    }
    const la = a.split('\n');
    const lb = b.split('\n');
    let i = 0;
    while (i < la.length && i < lb.length && la[i] === lb[i]) i++;
    lines.push('screen ' + name + ', line ' + (i + 1) + ':');
    if (i > 0) lines.push('  before: ' + la[i - 1].slice(0, 200));
    lines.push('  A: ' + (i < la.length ? la[i].slice(0, 200) : '(ends)'));
    lines.push('  B: ' + (i < lb.length ? lb[i].slice(0, 200) : '(ends)'));
  }
  return lines;
}

/* What the next action is picked from (probe.mjs readView), read from both
   builds. Lines, empty when the two are the same. */
export function compareViews(va, vb) {
  if (JSON.stringify(va) === JSON.stringify(vb)) return [];
  const lines = ['the class as the app gives it differs:'];
  for (const d of diffValues(va, vb)) lines.push('  ' + d.path + '  A: ' + short(d.a) + '  B: ' + short(d.b));
  return lines;
}
