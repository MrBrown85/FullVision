// @ts-check
/* report-one-words.js — the reflections' and the Parent / Guardian
   Response's wording, edited where it prints in One Report's One Student
   view. Click any words and type; drag ⠿ to move a statement or a heading;
   point at the line between two rows and a + adds one there; ⋯ beside a
   row has the rest (Move To, Remove, Use This Wording in My Other
   Classes). Every change is the class's (ReportOne.setWording), named on
   an Undo toast, and ⌘Z steps back through them (page-reports.js).

   What prints is the block's own HTML: report-blocks.js marks each word it
   prints (data-wt="items.3.label"), each row (data-wrow="items.3") and each
   heading (data-whead="4", its first statement). Everything this file adds
   is no-print and carries report-one-page.js's class (one-pg), so its
   _clear takes it off before each decorate.
   docs/plans/edit-on-page-mockup.html. */
window.ReportOneWords = (function () {
  'use strict';

  var MINE = 'one-pg';
  var WORDED = ['student-reflection-learning', 'student-reflection-habits', 'parent-response'];
  var TIP_KEY = 'fv-one-words-tip';
  var GAP = 32; // screen px the rows part by under the + (so its choices cover nothing)

  /** @type {any} */
  var _apiFn = null;
  /** @type {any} */
  var _preview = null;
  /** @type {any} */
  var _then = null; // run once after the next decorate (focus, glide)
  /** @type {any} */
  var _edit = null; // the words being typed in: { el, key, path, orig }
  /** @type {any} */
  var _menu = null; // { el, btn }
  /** @type {any} */
  var _drag = null;
  /** @type {any} */
  var _ins = null; // the + between rows: { el, sheet, spot, parted: [] }
  /** @type {any} */
  var _hotRow = null;

  /* ── The wording, changed (pure; the tests call these) ─────────────── */

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

  /* ── Small helpers ──────────────────────────────────────────────── */

  function _api() {
    return _apiFn && _apiFn();
  }
  function _el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _each(list, fn) {
    Array.prototype.forEach.call(list || [], fn);
  }
  function _reduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function _keyOf(el) {
    var c = el && el.closest && el.closest('.sheet-cell[data-part]');
    var k = c && c.getAttribute('data-part');
    return WORDED.indexOf(k) >= 0 ? k : null;
  }
  function _label(api, key) {
    return ReportOne.label(key, api.cid);
  }
  function _wording(api, key) {
    return ReportOne.wordingOf(api.model(), key) || {};
  }
  function _zoomOf(sheet) {
    var r = sheet.getBoundingClientRect();
    return sheet.offsetWidth ? r.width / sheet.offsetWidth || 1 : 1;
  }
  function _layer(sheet) {
    var layer = /** @type {any} */ (null);
    _each(sheet.children, function (x) {
      if (x.classList.contains('one-wl')) layer = x;
    });
    if (!layer) {
      layer = _el('div', MINE + ' no-print one-wl');
      sheet.appendChild(layer);
    }
    return layer;
  }
  function _cells(preview, key) {
    return Array.prototype.slice.call(preview.querySelectorAll('.sheet-cell[data-part]')).filter(function (c) {
      var k = c.getAttribute('data-part');
      return key ? k === key : WORDED.indexOf(k) >= 0;
    });
  }
  function _find(preview, key, sel) {
    var hit = /** @type {any} */ (null);
    _cells(preview, key).forEach(function (c) {
      if (!hit) hit = c.querySelector(sel);
    });
    return hit;
  }
  function _caretEnd(el) {
    if (!el || !window.getSelection || !document.createRange) return;
    var r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    var s = window.getSelection();
    if (!s) return;
    s.removeAllRanges();
    s.addRange(r);
  }
  function _selectAll(el) {
    if (!el || !window.getSelection || !document.createRange) return;
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    if (!s) return;
    s.removeAllRanges();
    s.addRange(r);
  }
  /* After the next draw: the words at path in key's part get focus. */
  function _focusLater(key, path, selectAll) {
    _then = function (preview) {
      var el = _find(preview, key, '[data-wt="' + path + '"]');
      if (!el) return;
      el.focus({ preventScroll: false });
      if (selectAll) _selectAll(el);
      else _caretEnd(el);
    };
  }
  function _name(w, path) {
    var t = textAt(w, path).trim();
    return t ? '“' + t + '”' : 'a blank line';
  }
  function _pathName(path) {
    var f = path.split('.')[0];
    return (
      {
        items: 'Statement',
        head: 'Heading in the table',
        scale: 'Scale word',
        open: 'Question',
        checks: 'Item to tick',
        fields: 'Line to fill in',
        intro: 'Instructions',
        checkHead: 'Heading over the items to tick',
      }[f] || 'Words'
    );
  }

  /* ── Saving a change ─────────────────────────────────────────────── */

  /* The class's wording for key becomes w: the original wording saved is
     no wording. Returns false when nothing changed. */
  function _save(api, key, w, label) {
    var m = api.model();
    var cw = clean(w);
    var same = JSON.stringify(cw) === JSON.stringify(clean(ReportBlocks.wordingOf(key)));
    var next = same ? null : cw;
    var cur = (m.wording && m.wording[key]) || null;
    if (JSON.stringify(cur) === JSON.stringify(next)) return false;
    api.set(ReportOne.setWording(m, key, next), label + ' for everyone');
    return true;
  }

  /* ── After each draw of the pages ────────────────────────────────── */

  function mount(preview, apiFn) {
    _apiFn = apiFn;
    if (!preview || preview._oneWords) return;
    preview._oneWords = true;
    preview.addEventListener('focusin', _onFocusIn);
    preview.addEventListener('focusout', _onFocusOut);
    preview.addEventListener('keydown', _onKey);
    preview.addEventListener('paste', _onPaste);
    preview.addEventListener('click', _onClick);
    preview.addEventListener('pointerdown', _onPointerDown);
    preview.addEventListener('mousemove', _onMove);
    preview.addEventListener('mouseleave', _onLeave);
  }

  /* Only in One Student view: Everyone's pages are for looking over. */
  function decorate(preview, api) {
    _preview = preview;
    _closeMenu(false);
    _ins = null;
    _hotRow = null;
    if (!preview || !api || api.view() !== 'one' || !api.student()) {
      _then = null;
      return;
    }
    var cells = _cells(preview);
    var sheets = [];
    cells.forEach(function (cell) {
      var key = cell.getAttribute('data-part');
      var w = _wording(api, key);
      _each(cell.querySelectorAll('[data-wt]'), function (el) {
        _editable(el);
      });
      // The line under a statement that has none: there to type in, on screen only.
      _each(cell.querySelectorAll('tr[data-wrow^="items."]'), function (tr) {
        var i = tr.getAttribute('data-wrow').split('.')[1];
        var td = tr.querySelector('td');
        if (!td || td.querySelector('[data-wt="items.' + i + '.prompt"]')) return;
        var ph = _el('span', MINE + ' no-print report-habit-desc one-w-ph');
        ph.setAttribute('data-wt', 'items.' + i + '.prompt');
        ph.setAttribute('data-ph', 'Add the line under it');
        td.appendChild(ph);
        _editable(ph);
      });
      // A heading with no statement yet: a dashed row to drop or click into.
      _each(cell.querySelectorAll('tr[data-whead]'), function (tr) {
        var i = +tr.getAttribute('data-whead');
        var b = blockAt(w, i);
        if (b.end - b.start !== 1 || String(_item(w.items[i]).label || '').trim()) return;
        var row = _el('tr', MINE + ' no-print one-w-empty');
        row.setAttribute('data-wadd', String(i));
        var td = _el('td', '', 'Drag a statement here, or click to add one.');
        td.colSpan = tr.firstElementChild ? tr.firstElementChild.colSpan || 5 : 5;
        row.appendChild(td);
        tr.parentNode.insertBefore(row, tr.nextSibling);
      });
      var sheet = cell.closest('.report-sheet');
      if (sheet && sheets.indexOf(sheet) < 0) sheets.push(sheet);
    });
    // Every rect read, then every button placed: the page is laid out once.
    var jobs = sheets.map(function (sheet) {
      var rows = [];
      _cells(preview).forEach(function (cell) {
        if (cell.closest('.report-sheet') !== sheet) return;
        _each(cell.querySelectorAll('[data-wrow], tr[data-whead]'), function (r) {
          rows.push({ el: r, cell: cell });
        });
      });
      return /** @type {any} */ ({ sheet: sheet, rows: rows });
    });
    jobs.forEach(function (job) {
      job.sr = job.sheet.getBoundingClientRect();
      job.zoom = _zoomOf(job.sheet);
      job.rows.forEach(function (r) {
        r.rect = r.el.getBoundingClientRect();
        r.cr = r.cell.getBoundingClientRect();
      });
    });
    jobs.forEach(_placeButtons);
    if (_blank) _putBlank(preview);
    if (_then) {
      var fn = _then;
      _then = null;
      fn(preview);
    }
  }
  function _editable(el) {
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('role', 'textbox');
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', _pathName(el.getAttribute('data-wt')));
    el.classList.add('one-wt');
  }
  /* Beside each row: ⋯ in the right margin (in the tab order, as the −
     buttons are), and for the rated rows a ⠿ grip in the left margin. A
     cell of two side by side (the response's lines, the habits' ticks) has
     its ⋯ just before it. */
  function _placeButtons(job) {
    var layer = _layer(job.sheet);
    var z = job.zoom;
    var px = function (v) {
      return v + 'px';
    };
    job.rows.forEach(function (r) {
      var el = r.el;
      var key = r.cell.getAttribute('data-part');
      var path = el.hasAttribute('data-whead') ? 'head.' + el.getAttribute('data-whead') : el.getAttribute('data-wrow');
      var name = el.querySelector('[data-wt]');
      var label = (name && name.textContent.trim()) || _pathName(path);
      var rated = el.tagName === 'TR';
      var top = (r.rect.top - job.sr.top) / z;
      var mid = top + r.rect.height / z / 2;
      var more = _el('button', MINE + ' no-print one-w-more', '⋯');
      more.type = 'button';
      more.setAttribute('data-wmore', path);
      more.setAttribute('data-wkey', key);
      more.setAttribute('aria-haspopup', 'menu');
      more.setAttribute('aria-expanded', 'false');
      more.setAttribute('aria-label', 'More for ' + label);
      if (rated || path.indexOf('open.') === 0) {
        more.style.left = px((r.cr.right - job.sr.left) / z);
        more.style.top = px(rated && path.indexOf('head.') === 0 ? top + r.rect.height / z : mid);
        if (path.indexOf('head.') === 0) more.classList.add('one-w-at-foot');
      } else {
        more.classList.add('one-w-before');
        more.style.left = px((r.rect.left - job.sr.left) / z);
        more.style.top = px(mid);
      }
      el._oneMore = more;
      layer.appendChild(more);
      if (!rated) return;
      var grip = _el('button', MINE + ' no-print one-w-grip', '⠿');
      grip.type = 'button';
      grip.tabIndex = -1; // the keyboard moves rows with ⌥↑ ⌥↓ and the ⋯ menu
      grip.setAttribute('data-wgrip', path);
      grip.setAttribute('data-wkey', key);
      grip.setAttribute('aria-hidden', 'true');
      grip.style.left = px((r.cr.left - job.sr.left) / z);
      grip.style.top = px(path.indexOf('head.') === 0 ? top + r.rect.height / z : mid);
      if (path.indexOf('head.') === 0) grip.classList.add('one-w-at-foot');
      el._oneGrip = grip;
      layer.appendChild(grip);
    });
  }

  /* ── Typing ──────────────────────────────────────────────────────── */

  function _onFocusIn(e) {
    var el = e.target;
    var key = el && el.getAttribute && el.getAttribute('data-wt') ? _keyOf(el) : null;
    if (el && el.getAttribute && el.getAttribute('data-wt') === 'new' && _blank) key = _blank.key;
    _showRow(el && el.closest ? el.closest('[data-wrow], tr[data-whead]') : null);
    if (!key) return;
    var path = el.getAttribute('data-wt');
    var raw = el.getAttribute('data-wraw');
    // The instructions show {name} while they are typed in; the name otherwise.
    if (raw != null) {
      el._oneShown = el.textContent;
      el.textContent = raw;
      _caretEnd(el);
    }
    _edit = { el: el, key: key, path: path, orig: raw != null ? raw : el.textContent };
  }
  function _onFocusOut(e) {
    if (!_edit || e.target !== _edit.el) return;
    _commit(false);
  }
  /* Saves the words being typed in, if they changed. `revert` puts them
     back instead. Returns true when the page will be drawn again. */
  function _commit(revert) {
    var ed = _edit;
    _edit = null;
    if (!ed) return false;
    var el = ed.el;
    var text = String(el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    var api = _api();
    if (ed.path === 'new') return revert ? (_dropBlank(), false) : _commitBlank(text);
    if (revert || !api || text === String(ed.orig).replace(/\s+/g, ' ').trim()) {
      if (el._oneShown != null) el.textContent = el._oneShown;
      else if (revert) el.textContent = ed.orig;
      return false;
    }
    var w = setText(_wording(api, ed.key), ed.path, text);
    return _save(api, ed.key, w, text ? 'Changed ' + _name(w, ed.path) : 'Cleared ' + _pathName(ed.path).toLowerCase());
  }

  function _onKey(e) {
    var t = e.target;
    if (_menu && _menu.el.contains(t)) return;
    var path = t.getAttribute && t.getAttribute('data-wt');
    if (!path || !_edit || _edit.el !== t) return;
    // Every key belongs to the words while they are typed in.
    e.stopPropagation();
    var api = _api();
    var key = _edit.key;
    var p = path.split('.');
    var row = p[0] === 'head' || p[0] === 'items' || p[0] === 'open' || p[0] === 'checks' || p[0] === 'fields';
    if (e.key === 'Escape') {
      e.preventDefault();
      _commit(true);
      t.blur();
      return;
    }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && row) {
      e.preventDefault();
      _commit(false);
      _move(api, key, p[0] === 'head' ? 'head.' + p[1] : p[0] + '.' + p[1], e.key === 'ArrowUp' ? -1 : 1, path);
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    // (A save draws the page again at once: what follows acts on the new page.)
    if (path === 'new') {
      var b = _blank;
      var saved = _commit(false);
      if (!saved || !b) return;
      if (b.field === 'items') _focusNow(key, 'items.' + b.at + '.prompt');
      else _add(api, key, b.field, b.at + 1);
      return;
    }
    var drew = _commit(false);
    var w = _wording(api, key);
    var i = +p[1];
    // Enter: a statement to the line under it, that line to a new statement;
    // a question, item or line to a new one below it.
    if (p[0] === 'items' && p[2] !== 'prompt') _focusNow(key, 'items.' + i + '.prompt');
    else if (p[0] === 'items') _add(api, key, 'items', i + 1, groupOf(w, i));
    else if (p[0] === 'head') _focusNow(key, 'items.' + i + '.label');
    else if (p[0] === 'open' || p[0] === 'checks' || p[0] === 'fields') _add(api, key, p[0], i + 1);
    else if (!drew) t.blur();
  }
  function _focusNow(key, path) {
    var el = _preview && _find(_preview, key, '[data-wt="' + path + '"]');
    if (el) {
      el.focus();
      _caretEnd(el);
    }
  }

  function _onPaste(e) {
    var t = e.target;
    var path = t.getAttribute && t.getAttribute('data-wt');
    if (!path || !/^items\.\d+\.label$/.test(path) || !_edit) return;
    var text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    if (text.split(/\r?\n/).filter(Boolean).length < 2) return;
    e.preventDefault();
    var api = _api();
    var key = _edit.key;
    _edit = null;
    var i = +path.split('.')[1];
    var w = _wording(api, key);
    var blank = !String(t.textContent || '').trim();
    var r = pasteItems(w, blank ? i : i + 1, groupOf(w, i), text, blank);
    _focusLater(key, 'items.' + ((blank ? i : i + 1) + r.n - 1) + '.label');
    _save(api, key, r.w, 'Added ' + r.n + ' statements');
  }

  /* ── Adding, moving, removing ────────────────────────────────────── */

  /* A new row is not saved blank: a row to type in is put on the page
     (screen only) where it will go, and the first words typed save it.
     Left blank, it goes away. */
  /** @type {any} */
  var _blank = null; // { key, field, at, g, el }
  function _add(api, key, field, at, g) {
    _dropBlank();
    _blank = { key: key, field: field, at: at, g: g || '' };
    if (_preview) _putBlank(_preview);
  }
  function _dropBlank() {
    var b = _blank;
    _blank = null;
    if (b && b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
  }
  function _putBlank(preview) {
    var b = _blank;
    var api = _api();
    if (!b || !api) return;
    var w = _wording(api, b.key);
    var cells = _cells(preview, b.key);
    var findIn = function (sel) {
      var hit = /** @type {any} */ (null);
      cells.forEach(function (c) {
        if (!hit) hit = c.querySelector(sel);
      });
      return hit;
    };
    var row;
    var text = _el('span', 'one-wt one-w-new');
    text.setAttribute('data-wt', 'new');
    if (b.field === 'items') {
      row = _el('tr', MINE + ' no-print one-w-newrow');
      var td = _el('td', 'report-habit-k');
      td.colSpan = 1 + ((w.scale && w.scale.length) || 4);
      text.className += ' report-habit-name';
      text.setAttribute('data-ph', 'Type a statement');
      td.appendChild(text);
      row.appendChild(td);
      var head = b.at < (w.items || []).length && blockAt(w, b.at).start === b.at && blockAt(w, b.at).group === b.g;
      var after = head ? findIn('tr[data-whead="' + b.at + '"]') : null;
      if (!after && b.at > 0)
        after = findIn('tr[data-wrow="items.' + (b.at - 1) + '"]') || findIn('tr[data-wadd="' + (b.at - 1) + '"]');
      if (after) after.parentNode.insertBefore(row, after.nextSibling);
      else {
        var first = findIn('tr[data-wrow], tr[data-whead]');
        if (!first) return;
        first.parentNode.insertBefore(row, first);
      }
    } else {
      var prevEl = b.at > 0 ? findIn('[data-wrow="' + b.field + '.' + (b.at - 1) + '"]') : null;
      var nextEl = findIn('[data-wrow="' + b.field + '.' + b.at + '"]');
      row = _el('div', MINE + ' no-print one-w-newrow one-w-new-' + b.field);
      text.setAttribute(
        'data-ph',
        { open: 'Type a question', checks: 'Type an item', fields: 'Type a label' }[b.field] || '',
      );
      row.appendChild(text);
      if (b.field === 'open') row.appendChild(_el('div', 'report-write-lines one-w-newlines'));
      if (prevEl) prevEl.parentNode.insertBefore(row, prevEl.nextSibling);
      else if (nextEl) nextEl.parentNode.insertBefore(row, nextEl);
      else {
        // An empty list: under the table (questions) or at the part's foot.
        var tbl = findIn('table');
        var cell = cells[cells.length - 1];
        if (b.field === 'open' && tbl) tbl.parentNode.insertBefore(row, tbl.nextSibling);
        else if (cell) (cell.querySelector('.report-block-box') || cell).appendChild(row);
        else return;
      }
    }
    b.el = row;
    _editable(text);
    text.setAttribute('aria-label', 'New ' + _pathName(b.field + '.0').toLowerCase());
    text.focus();
  }
  /* The words typed in the new row: saved where it was put. */
  function _commitBlank(text) {
    var b = _blank;
    var api = _api();
    _dropBlank();
    if (!b || !api || !text) return false;
    var w = _wording(api, b.key);
    var next;
    var path;
    if (b.field === 'items') {
      next = setText(addItem(w, b.at, b.g), 'items.' + b.at + '.label', text);
      path = 'items.' + b.at + '.label';
    } else {
      next = addAt(w, b.field, b.at, text);
      path = b.field + '.' + b.at;
    }
    _focusLater(b.key, path);
    return _save(api, b.key, next, 'Added “' + text + '”') ? path : false;
  }

  function _move(api, key, rowPath, dir, refocus) {
    var p = rowPath.split('.');
    var w = _wording(api, key);
    var i = +p[1];
    var next;
    var what;
    if (p[0] === 'head') {
      next = moveBlockBy(w, i, dir);
      what = 'the heading ' + _name(w, rowPath);
    } else if (p[0] === 'items') {
      next = moveItemBy(w, i, dir);
      what = _name(w, 'items.' + i + '.label');
    } else {
      next = moveAt(w, p[0], i, dir);
      what = _name(w, rowPath);
    }
    if (JSON.stringify(next) === JSON.stringify(w)) return;
    if (refocus) {
      var np = _newPath(w, next, refocus);
      if (np) _focusLater(key, np);
    }
    _save(api, key, next, 'Moved ' + what);
  }
  /* Where the words at path in w are in next (they moved). */
  function _newPath(w, next, path) {
    var p = path.split('.');
    if (p[0] === 'items') {
      // The same words (its heading may have changed).
      var it = _item(w.items[+p[1]]);
      var same = function (x) {
        x = _item(x);
        return x.label === it.label && (x.prompt || '') === (it.prompt || '');
      };
      var j = -1;
      next.items.forEach(function (x, k) {
        if (j < 0 && same(x)) j = k;
      });
      return j < 0 ? null : 'items.' + j + (p[2] ? '.' + p[2] : '');
    }
    if (p[0] === 'head') {
      var g = groupOf(w, +p[1]);
      var hit = /** @type {any} */ (null);
      blocks(next).forEach(function (b) {
        if (hit == null && b.group === g) hit = b.start;
      });
      return hit == null ? null : 'head.' + hit;
    }
    var list = next[p[0]] || [];
    var v = (w[p[0]] || [])[+p[1]];
    var at = list.indexOf(v);
    return at < 0 ? null : p[0] + '.' + at;
  }

  /* ── The ⋯ menu ──────────────────────────────────────────────────── */

  function _menuItems(api, key, path) {
    var w = _wording(api, key);
    var p = path.split('.');
    var i = +p[1];
    var out = [];
    var m = api.model();
    if (p[0] === 'items') {
      var b = blockAt(w, i);
      out.push(['addBelow', 'Add a Statement Below']);
      if (i > b.start) out.push(['split', 'Start a New Heading Here']);
      out.push(null, ['up', 'Move Up'], ['down', 'Move Down']);
      var others = blocks(w).filter(function (x) {
        return x.start !== b.start;
      });
      if (others.length) {
        out.push(['sub', 'Move To']);
        others.forEach(function (x) {
          out.push(['to:' + x.start, x.group || 'No Heading']);
        });
      }
      out.push(null, ['remove', 'Remove Statement', 'danger']);
    } else if (p[0] === 'head') {
      var hb = blockAt(w, i);
      out.push(['up', 'Move Heading Up'], ['down', 'Move Heading Down'], null);
      out.push([
        'unhead',
        hb.end - hb.start > 1 || String(_item(w.items[i]).label || '').trim()
          ? 'Remove Heading, Keep Its Statements'
          : 'Remove Heading',
        'danger',
      ]);
    } else {
      var noun = { open: 'Question', checks: 'Item', fields: 'Line' }[p[0]] || 'Line';
      out.push(['addBelow', 'Add a' + (noun === 'Item' ? 'n ' : ' ') + noun + ' Below'], null);
      out.push(['up', 'Move Up'], ['down', 'Move Down'], null, ['remove', 'Remove ' + noun, 'danger']);
    }
    out.push(null);
    if (typeof ReportOneCopy !== 'undefined' && ReportOneCopy.classes(api.cid, key).length)
      out.push(['copy', 'Use This Wording in My Other Classes…']);
    if (m.wording && m.wording[key]) out.push(['reset', 'Reset to Original Wording']);
    while (out.length && out[out.length - 1] === null) out.pop();
    return out;
  }
  function _openMenu(btn) {
    var api = _api();
    if (!api) return;
    _closeMenu(false);
    var key = btn.getAttribute('data-wkey');
    var path = btn.getAttribute('data-wmore');
    var box = _el('div', MINE + ' no-print one-w-menu');
    box.setAttribute('role', 'menu');
    _menuItems(api, key, path).forEach(function (x) {
      if (!x) return box.appendChild(_el('hr', ''));
      if (x[0] === 'sub') return box.appendChild(_el('div', 'one-w-menu-sub', x[1]));
      var b = _el('button', x[2] === 'danger' ? 'danger' : '', x[1]);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.setAttribute('data-wdo', x[0]);
      box.appendChild(b);
    });
    document.body.appendChild(box);
    var r = btn.getBoundingClientRect();
    var left = Math.min(r.right - box.offsetWidth, window.innerWidth - box.offsetWidth - 8);
    var top = r.bottom + 4;
    if (top + box.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - box.offsetHeight - 4);
    box.style.left = Math.max(8, left) + 'px';
    box.style.top = top + 'px';
    btn.setAttribute('aria-expanded', 'true');
    _menu = { el: box, btn: btn, key: key, path: path };
    box.addEventListener('click', _onMenuClick);
    box.addEventListener('keydown', _onMenuKey);
    document.addEventListener('pointerdown', _onOutside, true);
    var first = box.querySelector('button');
    if (first) first.focus();
  }
  function _closeMenu(focusBack) {
    var m = _menu;
    if (!m) return;
    _menu = null;
    document.removeEventListener('pointerdown', _onOutside, true);
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
    if (m.btn.isConnected) {
      m.btn.setAttribute('aria-expanded', 'false');
      if (focusBack) m.btn.focus();
    }
  }
  function _onOutside(e) {
    if (_menu && !_menu.el.contains(e.target) && e.target !== _menu.btn) _closeMenu(false);
  }
  function _onMenuKey(e) {
    e.stopPropagation();
    var items = Array.prototype.slice.call(_menu.el.querySelectorAll('button'));
    var at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      _closeMenu(true);
    } else if (e.key === 'Tab') _closeMenu(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var n = items.length;
      items[(at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1].focus();
    }
  }
  function _onMenuClick(e) {
    var b = e.target.closest ? e.target.closest('[data-wdo]') : null;
    if (!b || !_menu) return;
    var m = _menu;
    _closeMenu(false);
    _do(_api(), m.key, m.path, b.getAttribute('data-wdo'));
  }
  function _do(api, key, path, what) {
    if (!api) return;
    var w = _wording(api, key);
    var p = path.split('.');
    var i = +p[1];
    if (what === 'up' || what === 'down') return _move(api, key, path, what === 'up' ? -1 : 1);
    if (what === 'addBelow') {
      if (p[0] === 'items') return _add(api, key, 'items', i + 1, groupOf(w, i));
      return _add(api, key, p[0], i + 1);
    }
    if (what === 'split') return _addHeading(api, key, i);
    if (what.indexOf('to:') === 0) {
      var into = blockAt(w, +what.slice(3));
      var name = _name(w, 'items.' + i + '.label');
      _then = _flashLater(key, textAt(w, 'items.' + i + '.label'));
      return _save(api, key, moveItem(w, i, into.end, into.group), 'Moved ' + name);
    }
    if (what === 'remove') {
      var gone = _name(w, p[0] === 'items' ? 'items.' + i + '.label' : path);
      return _save(api, key, removeAt(w, p[0], i), 'Removed ' + gone);
    }
    if (what === 'unhead') return _save(api, key, removeHeading(w, i), 'Removed the heading ' + _name(w, path));
    if (what === 'copy') return ReportOneCopy.dialog(api, key);
    if (what === 'reset') {
      var m = api.model();
      api.set(ReportOne.setWording(m, key, null), 'Put back the original wording of ' + _label(api, key));
    }
  }
  function _addHeading(api, key, at) {
    var w = _wording(api, key);
    var name = uniqueName(w, 'New Heading');
    var next = addHeading(w, at, name);
    _focusLater(key, 'head.' + at, true);
    _save(api, key, next, 'Added the heading “' + name + '”');
  }
  function _flashLater(key, label) {
    return function (preview) {
      _cells(preview, key).forEach(function (c) {
        _each(c.querySelectorAll('tr[data-wrow]'), function (tr) {
          var n = tr.querySelector('.report-habit-name');
          if (n && n.textContent.trim() === String(label).trim()) {
            tr.classList.add('one-w-flash');
            if (tr.scrollIntoView) tr.scrollIntoView({ block: 'nearest', behavior: _reduced() ? 'auto' : 'smooth' });
          }
        });
      });
    };
  }

  /* ── Pointer on the page ─────────────────────────────────────────── */

  function _showRow(row) {
    if (_hotRow === row) return;
    if (_hotRow) {
      if (_hotRow._oneMore) _hotRow._oneMore.classList.remove('one-w-on');
      if (_hotRow._oneGrip) _hotRow._oneGrip.classList.remove('one-w-on');
    }
    _hotRow = row && row._oneMore ? row : null;
    if (_hotRow) {
      _hotRow._oneMore.classList.add('one-w-on');
      if (_hotRow._oneGrip) _hotRow._oneGrip.classList.add('one-w-on');
    }
  }
  function _onClick(e) {
    var t = e.target;
    if (!t.closest) return;
    var more = t.closest('[data-wmore]');
    if (more) {
      e.preventDefault();
      e.stopPropagation();
      if (_menu && _menu.btn === more) return _closeMenu(true);
      var mk = more.getAttribute('data-wkey');
      var mp = more.getAttribute('data-wmore');
      // Words being typed are saved first; the page is drawn again, so the ⋯ is found again.
      if (_edit && _commit(false)) more = _preview && _find(_preview, mk, '[data-wmore="' + mp + '"]');
      if (!more) {
        _cells(_preview, mk).forEach(function (c) {
          var sheet = c.closest('.report-sheet');
          var hit = sheet && sheet.querySelector('.one-wl [data-wmore="' + mp + '"][data-wkey="' + mk + '"]');
          if (hit && !more) more = hit;
        });
      }
      if (more) _openMenu(more);
      return;
    }
    var empty = t.closest('tr[data-wadd]');
    if (empty) {
      var api = _api();
      var key = _keyOf(empty);
      var at = +empty.getAttribute('data-wadd');
      if (api && key) _add(api, key, 'items', at, groupOf(_wording(api, key), at));
    }
  }
  /* The + and its choices act on pointer down, before the words being typed
     lose focus (saving them draws the page again). */
  function _onInsDown(e) {
    var act = e.target.closest ? e.target.closest('[data-wins]') : null;
    if (!act || !_ins) return false;
    e.preventDefault();
    e.stopPropagation();
    var what = act.getAttribute('data-wins');
    if (act.classList.contains('one-w-ins-plus') && _ins.spot.acts.length > 1 && !_ins.open) {
      _part(true);
      return true;
    }
    var spot = _ins.spot;
    _hideIns();
    if (_edit) _commit(false);
    _insertAt(spot, what);
    return true;
  }
  function _insertAt(s, what) {
    var api = _api();
    if (!api || !s) return;
    if (what === 's') _add(api, s.key, 'items', s.at, s.g);
    else if (what === 'h') _addHeading(api, s.key, s.at);
    else _add(api, s.key, 'open', s.q);
  }

  /* The + between rows. Spots: under each rated row and heading, and under
     each question. */
  function _spots(sheet) {
    var api = _api();
    var out = [];
    if (!api) return out;
    _cells(_preview).forEach(function (cell) {
      if (cell.closest('.report-sheet') !== sheet) return;
      var key = cell.getAttribute('data-part');
      if (key === 'parent-response') return;
      var w = _wording(api, key);
      var cr = cell.getBoundingClientRect();
      var trs = cell.querySelectorAll('tr[data-wrow], tr[data-whead]');
      var lastItems = (w.items || []).length;
      _each(trs, function (tr) {
        var y = tr.getBoundingClientRect().bottom;
        if (tr.hasAttribute('data-whead')) {
          var h = +tr.getAttribute('data-whead');
          if (String(_item(w.items[h]).label || '').trim())
            out.push({ key: key, y: y, cr: cr, at: h, g: groupOf(w, h), acts: ['s'] });
          return;
        }
        var i = +tr.getAttribute('data-wrow').split('.')[1];
        var acts = ['s', 'h'];
        if (i === lastItems - 1 && !(w.open || []).length && Array.isArray(w.open)) acts.push('q');
        out.push({ key: key, y: y, cr: cr, at: i + 1, g: groupOf(w, i), q: 0, acts: acts });
      });
      _each(cell.querySelectorAll('[data-wrow^="open."]'), function (q) {
        var j = +q.getAttribute('data-wrow').split('.')[1];
        out.push({ key: key, y: q.getBoundingClientRect().bottom, cr: cr, q: j + 1, acts: ['q'] });
      });
    });
    return out;
  }
  var _moveFrame = 0;
  function _onMove(e) {
    var t = e.target;
    if (_drag || _menu || !t.closest) return;
    _showRow(t.closest('[data-wrow], tr[data-whead]') || (t.closest('.one-w-more, .one-w-grip') && _hotRow));
    if (t.closest('.one-w-ins')) return;
    var x = e.clientX;
    var y = e.clientY;
    if (_moveFrame) return;
    _moveFrame = requestAnimationFrame(function () {
      _moveFrame = 0;
      _placeIns(t, x, y);
    });
  }
  function _placeIns(t, x, y) {
    var sheet = t.closest && t.closest('.report-sheet');
    var api = _api();
    if (!sheet || !api || api.view() !== 'one' || _edit) return _hideIns();
    var zoom = _zoomOf(sheet);
    var best = /** @type {any} */ (null);
    _spots(sheet).forEach(function (s) {
      var d = Math.abs(y - s.y);
      if (d <= 8 && x >= s.cr.left - 56 * zoom && x <= s.cr.right && (!best || d < best.d)) {
        best = s;
        best.d = d;
      }
    });
    if (!best) {
      if (_ins && !_ins.open) _hideIns();
      return;
    }
    if (_ins && _ins.spot && _ins.sheet === sheet && Math.abs(_ins.spot.y - best.y) < 0.5) return;
    _hideIns();
    var sr = sheet.getBoundingClientRect();
    var box = _el('div', MINE + ' no-print one-w-ins');
    box.style.left = (best.cr.left - sr.left) / zoom + 'px';
    box.style.top = (best.y - sr.top) / zoom + 'px';
    box.style.width = best.cr.width / zoom + 'px';
    var plus = _el('button', 'one-w-ins-plus', '+');
    plus.type = 'button';
    plus.setAttribute('data-wins', best.acts[0]);
    plus.setAttribute('aria-label', 'Add here');
    plus.tabIndex = -1;
    box.appendChild(_el('div', 'one-w-ins-line'));
    box.appendChild(plus);
    var acts = _el('div', 'one-w-ins-acts');
    best.acts.forEach(function (a) {
      var b = _el('button', '', { s: 'Add a Statement', h: 'Add a Heading', q: 'Add a Question' }[a]);
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('data-wins', a);
      acts.appendChild(b);
    });
    box.appendChild(acts);
    _layer(sheet).appendChild(box);
    _ins = { el: box, sheet: sheet, spot: best, zoom: zoom, parted: [], open: false };
    plus.addEventListener('mouseenter', function () {
      _part(true);
    });
    box.addEventListener('mouseleave', function () {
      _part(false);
    });
  }
  /* Pointing at the + parts the rows under it, so its choices sit in the gap. */
  function _part(open) {
    if (!_ins || _ins.open === open) return;
    _ins.open = open;
    _ins.el.classList.toggle('open', open);
    var dy = GAP / _ins.zoom;
    if (open) {
      var y = _ins.spot.y;
      _cells(_preview).forEach(function (cell) {
        if (cell.closest('.report-sheet') !== _ins.sheet) return;
        _each(cell.querySelectorAll('tr, .report-reflect-q, .report-reflect-checks'), function (el) {
          if (el.getBoundingClientRect().top >= y - 1) {
            el.classList.add('one-w-parting');
            el.style.transform = 'translateY(' + dy + 'px)';
            _ins.parted.push(el);
          }
        });
      });
    } else {
      _ins.parted.forEach(function (el) {
        el.style.transform = '';
      });
      _ins.parted = [];
    }
  }
  function _hideIns() {
    if (!_ins) return;
    _ins.parted.forEach(function (el) {
      el.style.transform = '';
    });
    if (_ins.el.parentNode) _ins.el.parentNode.removeChild(_ins.el);
    _ins = null;
  }
  function _onLeave() {
    _showRow(null);
    if (_ins && !_ins.open) _hideIns();
  }

  /* ── Dragging a statement or a heading ───────────────────────────────
     The row lifts and follows the pointer; the rows it passes move out of
     its way; on the drop the wording is saved and every row glides from
     where it was to where it lands. */
  function _onPointerDown(e) {
    if (e.button !== 0) return;
    if (_onInsDown(e)) return;
    var g = e.target.closest ? e.target.closest('[data-wgrip]') : null;
    if (!g) {
      // Pressing ⋯ keeps the words being typed focused until its click saves them.
      if (e.target.closest && e.target.closest('[data-wmore]')) e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    var api = _api();
    if (!api) return;
    _closeMenu(false);
    _hideIns();
    var key = g.getAttribute('data-wkey');
    var path = g.getAttribute('data-wgrip');
    if (_edit) _commit(false);
    var all = [];
    _cells(_preview, key).forEach(function (cell) {
      _each(cell.querySelectorAll('tr[data-wrow^="items."], tr[data-whead], tr[data-wadd]'), function (tr) {
        var head = tr.hasAttribute('data-whead');
        var empty = tr.hasAttribute('data-wadd');
        var sheet = tr.closest('.report-sheet');
        all.push({
          el: tr,
          head: head,
          empty: empty,
          i: +(head
            ? tr.getAttribute('data-whead')
            : empty
              ? tr.getAttribute('data-wadd')
              : tr.getAttribute('data-wrow').split('.')[1]),
          sheet: sheet,
          table: tr.closest('table'),
          rect: tr.getBoundingClientRect(),
          zoom: _zoomOf(sheet),
        });
      });
    });
    var isHead = path.indexOf('head.') === 0;
    var idx = +path.split('.')[1];
    var w = _wording(api, key);
    var dragged;
    if (isHead) {
      var b = blockAt(w, idx);
      dragged = all.filter(function (r) {
        return r.i >= b.start && r.i < b.end;
      });
    } else
      dragged = all.filter(function (r) {
        return !r.head && !r.empty && r.i === idx;
      });
    if (!dragged.length) return;
    var top = dragged[0].rect.top;
    var bottom = dragged[dragged.length - 1].rect.bottom;
    _drag = {
      api: api,
      key: key,
      w: w,
      isHead: isHead,
      idx: idx,
      all: all,
      dragged: dragged,
      cands: all.filter(function (r) {
        return dragged.indexOf(r) < 0;
      }),
      y0: e.clientY,
      grab: e.clientY - top,
      h: bottom - top,
      b: -1,
    };
    dragged.forEach(function (r) {
      r.el.classList.add('one-w-lift');
    });
    document.body.classList.add('one-w-dragging');
    window.addEventListener('pointermove', _onDragMove);
    window.addEventListener('pointerup', _onDragEnd);
    window.addEventListener('pointercancel', _onDragEnd);
  }
  /* The boundary the pointer is over: an index into the rows not dragged
     (cands), the dragged rows going before cands[b]. A heading lands only
     between runs. */
  function _boundary(x, y) {
    var d = _drag;
    var c = d.cands;
    if (!c.length) return 0;
    var sheets = [];
    c.forEach(function (r) {
      if (sheets.indexOf(r.sheet) < 0) sheets.push(r.sheet);
    });
    var sheet = /** @type {any} */ (null);
    var bestD = Infinity;
    sheets.forEach(function (s) {
      var r = s.getBoundingClientRect();
      var dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      var dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      var dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        sheet = s;
      }
    });
    var center = y - d.grab + Math.min(d.h, 60) / 2;
    var b = -1;
    var firstHere = -1;
    c.forEach(function (r, k) {
      if (r.sheet !== sheet) return;
      if (firstHere < 0) firstHere = k;
      if (r.rect.top + r.rect.height / 2 < center) b = k + 1;
    });
    if (b < 0) b = firstHere < 0 ? 0 : firstHere;
    if (!d.isHead) return b;
    // Snap to the nearest place between runs.
    var best = b;
    var bestGap = Infinity;
    for (var k = 0; k <= c.length; k++) {
      if (k < c.length && !c[k].head) continue;
      var gap = Math.abs(k - b);
      if (gap < bestGap) {
        bestGap = gap;
        best = k;
      }
    }
    return best;
  }
  function _onDragMove(e) {
    var d = _drag;
    if (!d) return;
    var dy = e.clientY - d.y0;
    d.dragged.forEach(function (r) {
      r.el.style.transform = 'translateY(' + dy / r.zoom + 'px)';
    });
    var b = _boundary(e.clientX, e.clientY);
    if (b === d.b) return;
    d.b = b;
    // The rows after the dragged ones close up in their table; the rows from
    // the boundary on open a gap in theirs.
    var from = d.dragged[0].table;
    var lastDragged = d.all.indexOf(d.dragged[d.dragged.length - 1]);
    var into = d.cands[b] ? d.cands[b].table : d.cands[b - 1] ? d.cands[b - 1].table : from;
    d.cands.forEach(function (r, k) {
      var shift = 0;
      if (r.table === from && d.all.indexOf(r) > lastDragged) shift -= d.h;
      if (r.table === into && k >= b) shift += d.h;
      r.el.classList.add('one-w-shift');
      r.el.style.transform = shift ? 'translateY(' + shift / r.zoom + 'px)' : '';
    });
  }
  function _onDragEnd() {
    var d = _drag;
    window.removeEventListener('pointermove', _onDragMove);
    window.removeEventListener('pointerup', _onDragEnd);
    window.removeEventListener('pointercancel', _onDragEnd);
    document.body.classList.remove('one-w-dragging');
    _drag = null;
    if (!d) return;
    // Where every row is on screen now, by its words, to glide from.
    var from = {};
    d.all.forEach(function (r) {
      from[_rowKey(r.el)] = r.el.getBoundingClientRect().top;
    });
    var w = d.w;
    var next = w;
    if (d.b >= 0) {
      var c = d.cands;
      var before = d.b < c.length ? c[d.b].i : w.items.length;
      if (d.b < c.length && c[d.b].empty) before = c[d.b].i;
      if (d.isHead) next = moveBlock(w, d.idx, before);
      else {
        var prev = c[d.b - 1];
        var g = prev ? groupOf(w, prev.i) : '';
        next = moveItem(w, d.idx, before, g);
      }
    }
    var reset = function () {
      d.all.forEach(function (r) {
        r.el.classList.remove('one-w-lift', 'one-w-shift');
        r.el.style.transform = '';
      });
    };
    if (JSON.stringify(next) === JSON.stringify(w)) {
      d.all.forEach(function (r) {
        r.el.classList.remove('one-w-shift');
        r.el.style.transform = '';
      });
      setTimeout(reset, 200);
      return;
    }
    _then = function (preview) {
      _glide(preview, d.key, from);
    };
    var what = d.isHead ? 'the heading ' + _name(w, 'head.' + d.idx) : _name(w, 'items.' + d.idx + '.label');
    if (!_save(d.api, d.key, next, 'Moved ' + what)) {
      _then = null;
      reset();
    }
  }
  function _rowKey(tr) {
    var t = tr.querySelector('[data-wt]');
    return (tr.hasAttribute('data-whead') ? 'h:' : 'r:') + (t ? t.textContent.trim() : '');
  }
  /* FLIP: each row starts where it was and glides to where it is, ~200 ms. */
  function _glide(preview, key, from) {
    if (_reduced()) return;
    _cells(preview, key).forEach(function (cell) {
      _each(cell.querySelectorAll('tr[data-wrow], tr[data-whead]'), function (tr) {
        var was = from[_rowKey(tr)];
        if (was == null) return;
        var zoom = _zoomOf(tr.closest('.report-sheet'));
        var dy = (was - tr.getBoundingClientRect().top) / zoom;
        if (!dy) return;
        tr.style.transition = 'none';
        tr.style.transform = 'translateY(' + dy + 'px)';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            tr.style.transition = 'transform 200ms cubic-bezier(.2,.7,.3,1)';
            tr.style.transform = '';
          });
        });
      });
    });
  }

  /* ── Edit Questions in the panel ─────────────────────────────────── */

  /* Takes the teacher to the part on the page: One Student view, the
     first statement (or words) with the cursor in it, and once, how it
     works. False when there is no student to show the part for (the
     dialog stays for that). */
  function open(api, key) {
    var student = api.student && api.student();
    var list = api.students ? api.students() : [];
    if (!student && !list.length) return false;
    var go = function (preview) {
      var el =
        _find(preview, key, '[data-wt^="items."][data-wt$=".label"]') ||
        _find(preview, key, '[data-wt^="fields."]') ||
        _find(preview, key, '[data-wt]');
      if (!el) {
        api.announce(_label(api, key) + ' has nothing to print for this student.');
        return;
      }
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: _reduced() ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
      _caretEnd(el);
      _tip(el);
    };
    if (api.view() === 'one' && student && _preview && _preview.isConnected) {
      go(_preview);
      return true;
    }
    _then = go;
    api.goStudent((student || list[0]).id);
    return true;
  }
  /* Once, under the row the cursor is put in: how it works. */
  function _tip(el) {
    var seen = false;
    try {
      seen = localStorage.getItem(TIP_KEY) === '1';
      localStorage.setItem(TIP_KEY, '1');
    } catch (e) {
      seen = false;
    }
    var cell = el && el.closest('.sheet-cell');
    var sheet = el && el.closest('.report-sheet');
    if (seen || !cell || !sheet) return;
    var row = el.closest('tr, [data-wrow]') || el;
    var z = _zoomOf(sheet);
    var sr = sheet.getBoundingClientRect();
    var tip = _el('div', MINE + ' no-print one-w-tip');
    tip.setAttribute('role', 'status');
    tip.style.left = (cell.getBoundingClientRect().left - sr.left) / z + 'px';
    tip.style.top = (row.getBoundingClientRect().bottom - sr.top) / z + 'px';
    tip.appendChild(
      document.createTextNode(
        'Click any words to change them. Drag ⠿ to move a row. Point between two rows to add one. Changes are for the whole class.',
      ),
    );
    var ok = _el('button', '', 'Got It');
    ok.type = 'button';
    ok.addEventListener('click', function () {
      if (tip.parentNode) tip.parentNode.removeChild(tip);
    });
    tip.appendChild(ok);
    _layer(sheet).appendChild(tip);
  }

  /* Print Reports asks first: words still being typed in are saved. */
  function beforePrint() {
    if (_edit) _commit(false);
    return true;
  }

  return {
    mount: mount,
    decorate: decorate,
    open: open,
    beforePrint: beforePrint,
    // The wording, changed: pure, for the tests.
    ops: {
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
    },
  };
})();
