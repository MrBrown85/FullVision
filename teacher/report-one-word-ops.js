// @ts-check
/* report-one-word-ops.js — a reflection's or the response's wording,
   changed: move a statement or a heading, add, remove, rename, paste.
   Pure: each takes the wording and gives a new one. The page that calls
   them is report-one-words.js; the tests call them through
   ReportOneWords.ops. The wording's shape is in report-blocks.js
   ("Reworded questions"). */
window.ReportOneWordOps = (function () {
  'use strict';

  function clone(w) {
    return JSON.parse(JSON.stringify(w || {}));
  }
  function _item(x) {
    return x && typeof x === 'object' ? x : { label: x == null ? '' : String(x) };
  }
  function groupOf(w, i) {
    var it = w.items && w.items[i];
    return it && typeof it === 'object' && it.group != null ? String(it.group) : '';
  }
  /* The run of statements under one heading: [start, end). */
  function blockAt(w, i) {
    var g = groupOf(w, i);
    var s = i;
    var e = i + 1;
    while (s > 0 && groupOf(w, s - 1) === g) s--;
    while (e < w.items.length && groupOf(w, e) === g) e++;
    return { start: s, end: e, group: g };
  }
  function blocks(w) {
    var out = [];
    for (var i = 0; i < (w.items || []).length;) {
      var b = blockAt(w, i);
      out.push(b);
      i = b.end;
    }
    return out;
  }
  /* A statement that has to carry a heading becomes an object; one that
     doesn't keeps the shape it had. */
  function _setGroup(w, i, g) {
    var it = w.items[i];
    if (typeof it === 'object' && it) it.group = g;
    else if (g) w.items[i] = { label: it == null ? '' : String(it), group: g };
  }
  function uniqueName(w, base) {
    var names = blocks(w).map(function (b) {
      return b.group;
    });
    var n = base;
    for (var k = 2; names.indexOf(n) >= 0; k++) n = base + ' ' + k;
    return n;
  }
  /* The text at a path ("items.3.label", "head.4", "scale.1", "intro"). */
  function textAt(w, path) {
    var p = path.split('.');
    if (p[0] === 'head') return groupOf(w, +p[1]);
    if (p[0] === 'items') {
      var it = _item(w.items[+p[1]]);
      return String((p[2] === 'prompt' ? it.prompt : it.label) || '');
    }
    if (p.length > 1) return String((w[p[0]] || [])[+p[1]] || '');
    return String(w[p[0]] == null ? '' : w[p[0]]);
  }
  function setText(w, path, text) {
    w = clone(w);
    var p = path.split('.');
    var i = +p[1];
    if (p[0] === 'head') {
      // Renames this heading's run only: two headings may share a name.
      var b = blockAt(w, i);
      for (var k = b.start; k < b.end; k++) _setGroup(w, k, text);
    } else if (p[0] === 'items') {
      var it = w.items[i];
      if (p[2] === 'prompt') {
        it = _item(it);
        it.prompt = text;
        w.items[i] = it;
      } else if (typeof it === 'object' && it) it.label = text;
      else w.items[i] = text;
    } else if (p.length > 1) w[p[0]][i] = text;
    else w[p[0]] = text;
    return w;
  }
  /* A blank statement, at `at`, under heading g. */
  function addItem(w, at, g) {
    w = clone(w);
    var objs = (w.items || []).some(function (x) {
      return x && typeof x === 'object';
    });
    w.items.splice(at, 0, objs || g ? { label: '', prompt: '', group: g || '' } : '');
    return w;
  }
  /* A new heading before statement `at`: it takes the statements from `at`
     to the end of their run. At the end of a run it starts with one blank
     statement, so it is kept. */
  function addHeading(w, at, name) {
    w = clone(w);
    var prev = at > 0 ? blockAt(w, at - 1) : null;
    var end = prev ? prev.end : 0;
    if (at >= end) w.items.splice(at, 0, { label: '', prompt: '', group: name });
    else for (var k = at; k < end; k++) _setGroup(w, k, name);
    return w;
  }
  /* Moves statement `from` to sit before statement `before` (items.length:
     the end), under heading g. */
  function moveItem(w, from, before, g) {
    w = clone(w);
    var it = w.items.splice(from, 1)[0];
    var to = before > from ? before - 1 : before;
    w.items.splice(to, 0, it);
    _setGroup(w, to, g);
    return _dropBlankStrays(w);
  }
  /* Moves the run that starts at `start` to sit before statement `before`. */
  function moveBlock(w, start, before) {
    w = clone(w);
    var b = blockAt(w, start);
    if (before > b.start && before <= b.end) return w;
    var run = w.items.splice(b.start, b.end - b.start);
    var to = before > b.start ? before - run.length : before;
    Array.prototype.splice.apply(w.items, [to, 0].concat(run));
    return w;
  }
  function moveBlockBy(w, start, dir) {
    var all = blocks(w);
    var at = -1;
    all.forEach(function (b, k) {
      if (b.start === start) at = k;
    });
    var other = all[at + dir];
    if (at < 0 || !other) return clone(w);
    return dir < 0 ? moveBlock(w, start, other.start) : moveBlock(w, start, other.end);
  }
  /* One step up or down; past the edge of its run it joins the run next to it. */
  function moveItemBy(w, i, dir) {
    var b = blockAt(w, i);
    var j = i + dir;
    if (j < 0 || j >= w.items.length) return clone(w);
    if (j >= b.start && j < b.end) return moveItem(w, i, dir < 0 ? j : j + 1, b.group);
    var into = blockAt(w, j);
    return moveItem(w, i, dir < 0 ? into.end : into.start, into.group);
  }
  /* The heading goes; its statements join the run above (or, the first,
     the one below). */
  function removeHeading(w, start) {
    w = clone(w);
    var b = blockAt(w, start);
    var g = b.start > 0 ? groupOf(w, b.start - 1) : b.end < w.items.length ? groupOf(w, b.end) : '';
    for (var k = b.start; k < b.end; k++) _setGroup(w, k, g);
    return _dropBlankStrays(w);
  }
  /* A blank statement is kept only as the one statement under a heading. */
  function _dropBlankStrays(w) {
    w.items = w.items.filter(function (x, i) {
      if (String(_item(x).label || '').trim()) return true;
      var b = blockAt(w, i);
      return b.group && b.end - b.start === 1;
    });
    return w;
  }
  function addAt(w, field, at, value) {
    w = clone(w);
    w[field].splice(at, 0, value == null ? '' : value);
    return w;
  }
  function removeAt(w, field, i) {
    w = clone(w);
    w[field].splice(i, 1);
    return field === 'items' ? _dropBlankStrays(w) : w;
  }
  function moveAt(w, field, i, dir) {
    w = clone(w);
    var j = i + dir;
    if (j < 0 || j >= w[field].length) return w;
    var x = w[field].splice(i, 1)[0];
    w[field].splice(j, 0, x);
    return w;
  }
  /* Lines pasted into a statement: one statement a line. "Name – the line
     under it" or a tab splits a line into the two. */
  function pasteItems(w, at, g, text, replace) {
    w = clone(w);
    var lines = String(text || '')
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    var fresh = lines.map(function (l) {
      var p = l.split(/\t|\s+[–—-]\s+/);
      return { label: p[0].trim(), prompt: (p.slice(1).join(' – ') || '').trim(), group: g || '' };
    });
    Array.prototype.splice.apply(w.items, [at, replace ? 1 : 0].concat(fresh));
    return { w: w, n: fresh.length };
  }
  /* What is saved: blank lines left out (a blank statement kept as the one
     statement under a heading); a blank heading or instructions print the
     original. */
  function clean(w) {
    var out = {};
    Object.keys(w || {}).forEach(function (f) {
      var v = w[f];
      if (typeof v === 'string') {
        if (v.trim()) out[f] = v;
      } else if (Array.isArray(v)) {
        if (f === 'items') out[f] = _dropBlankStrays({ items: v.slice() }).items;
        else if (f === 'scale') out[f] = v.slice();
        else
          out[f] = v.filter(function (x) {
            return String(x == null ? '' : x).trim();
          });
      } else out[f] = v;
    });
    return out;
  }

  return {
    clone: clone,
    item: _item,
    groupOf: groupOf,
    blockAt: blockAt,
    blocks: blocks,
    textAt: textAt,
    setText: setText,
    addItem: addItem,
    addHeading: addHeading,
    moveItem: moveItem,
    moveItemBy: moveItemBy,
    moveBlock: moveBlock,
    moveBlockBy: moveBlockBy,
    removeHeading: removeHeading,
    addAt: addAt,
    removeAt: removeAt,
    moveAt: moveAt,
    pasteItems: pasteItems,
    uniqueName: uniqueName,
    clean: clean,
  };
})();
