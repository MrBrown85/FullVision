/* markup.js — Mark Up a photo on the phone (S9-F2; board "Phone: Mark Up a
   Photo").

   A full-screen view of one page of a student's work. The teacher draws on
   it with one finger and moves or zooms the page with two. Six tools: Pen,
   Highlight, Note, Tick, Cross and Eraser; red, green or blue for the Pen
   and Highlight; Undo and Redo; Done. The notes' words show in a card
   above the tools, each by its number on the page.

   Marks are data over the photo, never burned into it (DECISIONS, "Grades,
   photos and sign-in" 4): the page's picture is only shown, and the marks
   are a list kept by shared/data.js's Mark Up block (getPageMarkup,
   saveMarkup). A mark sits where it was drawn as fractions of the page from
   its top left (x, y from 0 to 1; a stroke's points [[x, y], …]), the
   shape the Demo Mode sample uses.

   The page's marks are saved only when the teacher leaves the page (Done,
   or another page), as the whole set, so a mark made and erased while the
   screen is open is never saved at all. In a class that holds grades the
   student is given the saved marks only at Return (returnWork); in any
   other class each save gives them at once, as a grade is.

   Shown only where MGradePhotos.on() holds (the build switch and Send Work).
   Demo Mode only: signed in, getPageMarkup answers null and the screen does
   not open. The screen is one overlay over the app; it is not on the nav
   stack. */

window.MMarkUp = (function () {
  'use strict';

  var MC = window.MComponents;
  var TOOLS = ['pen', 'highlight', 'note', 'tick', 'cross', 'eraser'];
  var TOOL_NAMES = {
    pen: 'Pen',
    highlight: 'Highlight',
    note: 'Note',
    tick: 'Tick',
    cross: 'Cross',
    eraser: 'Eraser',
  };
  // The pen's and highlighter's colours, as the desktop's (shared/markup-draw.js COLORS).
  var COLORS = ['red', 'green', 'blue'];
  var COLOR_NAMES = { red: 'Red', green: 'Green', blue: 'Blue' };
  var MAX_MARKS = 500;
  var MAX_NOTE = 500;
  var TAP_SLOP = 10; // screen pixels a tap may move
  var HIT = 16; // screen pixels the Eraser reaches
  var MIN_SCALE = 1;
  var MAX_SCALE = 5;

  var _s = null; // the open screen
  var _seq = 0; // goes up whenever the page shown changes or the screen closes
  var _ids = 0;

  var ICONS = {
    undo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
    redo: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/></svg>',
    pen: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1L19 8l-3-3L5 16z"/></svg>',
    highlight:
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 15l-2 5h5l1-3"/><path d="M8 14l8-10 4 3-8 10z"/></svg>',
    note: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H10l-5 4v-4H4z"/></svg>',
    tick: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
    cross:
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    eraser:
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 20h12"/><path d="M4 15l9-10 7 7-8 8H8z"/></svg>',
  };

  /* ── Who and what ───────────────────────────────────────────── */

  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (a) {
        return a.id === aid;
      }) || null
    );
  }

  function _student(cid, sid) {
    return (
      getStudents(cid).find(function (s) {
        return s.id === sid;
      }) || null
    );
  }

  function _first(st) {
    return (st && (displayNameFirst(st) || displayName(st))) || '';
  }

  // The pages the card shows: the group's on a One per Group piece (S12-F2), else the student's own.
  function _files(cid, sid, aid) {
    var sub = window.MGradePhotos
      ? MGradePhotos.work(cid, sid, aid)
      : typeof getStudentSubmission === 'function'
        ? getStudentSubmission(cid, sid, aid)
        : null;
    return ((sub && sub.files) || []).filter(function (f) {
      return f && f.id;
    });
  }

  // Can this page be marked up here? The switches, the work, and a page the data layer keeps marks for.
  function can(cid, aid, sid, page) {
    var a = _piece(cid, aid);
    if (!a || !_student(cid, sid) || !window.MGradePhotos || !MGradePhotos.takes(cid, a)) return false;
    if (typeof getPageMarkup !== 'function' || typeof saveMarkup !== 'function') return false;
    var file = _files(cid, sid, aid)[page || 0];
    return !!file && !!getPageMarkup(cid, file.id);
  }

  /* ── Opening and closing ────────────────────────────────────── */

  function open(cid, aid, sid, page) {
    page = Math.max(0, parseInt(page, 10) || 0);
    if (!can(cid, aid, sid, page)) return false;
    close();
    _s = {
      cid: cid,
      aid: aid,
      sid: sid,
      page: page,
      tool: 'pen',
      color: 'red',
      marks: [],
      rev: 0,
      undo: [],
      redo: [],
      dirty: false,
      busy: false,
      msg: '',
      editing: null, // a note being written: { id } of an existing one, or { x, y } for a new one
      view: { x: 0, y: 0, s: 1 },
      size: { w: 1000, h: 1294 }, // the page's own shape; the picture's, once it has loaded
      img: null, // { url, release, key }
      ptrs: {},
      gesture: null,
    };
    var root = document.createElement('div');
    root.id = 'm-markup';
    root.className = 'm-markup';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'm-markup-title');
    document.body.appendChild(root);
    root.addEventListener('click', _onClick);
    root.addEventListener('pointerdown', _onDown);
    root.addEventListener('pointermove', _onMove);
    root.addEventListener('pointerup', _onUp);
    root.addEventListener('pointercancel', _onCancel);
    document.addEventListener('keydown', _onKey);
    _loadPage();
    var done = root.querySelector('.m-markup-done');
    if (done) done.focus();
    return true;
  }

  function _releaseImg() {
    if (_s && _s.img) {
      _s.img.release();
      _s.img = null;
    }
  }

  function close() {
    _seq++;
    if (!_s) return;
    _releaseImg();
    if (_ro) _ro.disconnect();
    _ro = null;
    var root = document.getElementById('m-markup');
    if (root) root.remove();
    document.removeEventListener('keydown', _onKey);
    _s = null;
  }

  function isOpen() {
    return !!_s;
  }

  function _file() {
    return _s ? _files(_s.cid, _s.sid, _s.aid)[_s.page] || null : null;
  }

  // The page's saved marks, read fresh; the picture asked for.
  function _loadPage() {
    _seq++;
    var file = _file();
    var row = file ? getPageMarkup(_s.cid, file.id) : null;
    if (!row) return close();
    _s.marks = _copy((row.marks && row.marks.marks) || []);
    _s.rev = row.rev || 0;
    _s.undo = [];
    _s.redo = [];
    _s.dirty = false;
    _s.editing = null;
    _s.view = { x: 0, y: 0, s: 1 };
    if (file.width > 0 && file.height > 0) _s.size = { w: 1000, h: Math.round((1000 * file.height) / file.width) };
    _releaseImg();
    _draw();
    var seq = _seq;
    var key = file.id;
    openStudentWorkPage(_s.cid, file, 'page').then(function (res) {
      // The page shown changed, or the screen closed, while it was fetched.
      if (!_s || _seq !== seq || !_file() || _file().id !== key) {
        if (res) res.release();
        return;
      }
      if (!res) return;
      _s.img = { url: res.url, release: res.release, key: key };
      var img = document.querySelector('#m-markup .m-markup-img');
      if (img) {
        img.onload = function () {
          if (!_s || _seq !== seq || !img.naturalWidth || !img.naturalHeight) return;
          _s.size = { w: 1000, h: Math.round((1000 * img.naturalHeight) / img.naturalWidth) };
          _drawPage();
          var box = document.getElementById('m-markup');
          if (box) box.setAttribute('data-page-shown', key);
        };
        img.setAttribute('src', res.url);
      }
    });
  }

  function _copy(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /* ── Saving ─────────────────────────────────────────────────── */

  function _key() {
    return 'mk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* The page's whole set, saved once, when the teacher leaves the page.
     Answers a Promise of true when the screen may move on. */
  function _save() {
    if (!_s || !_s.dirty) return Promise.resolve(true);
    var file = _file();
    if (!file) return Promise.resolve(true);
    var s = _s;
    var seq = _seq;
    s.busy = true;
    return saveMarkup(s.cid, file.id, { v: 1, marks: _copy(s.marks) }, s.rev, _key()).then(function (res) {
      // The screen closed or moved on meanwhile: nothing here to change.
      if (_s !== s || _seq !== seq) return false;
      s.busy = false;
      if (res && res.result === 'saved') {
        s.rev = res.rev;
        s.dirty = false;
        return true;
      }
      if (res && res.result === 'changed') {
        // Another save came first: show what is there now, and stay.
        s.marks = _copy((res.marks && res.marks.marks) || []);
        s.rev = res.rev || 0;
        s.undo = [];
        s.redo = [];
        s.dirty = false;
        s.msg = 'These marks were changed somewhere else. The newest are shown.';
        _draw();
        return false;
      }
      s.msg = "These marks couldn't be saved. Try again.";
      _draw();
      return false;
    });
  }

  function done() {
    if (!_s || _s.busy) return Promise.resolve(false);
    var s = _s;
    return _save().then(function (ok) {
      if (ok && _s === s) close();
      return ok;
    });
  }

  function goPage(dir) {
    if (!_s || _s.busy) return Promise.resolve(false);
    var s = _s;
    var to = s.page + dir;
    if (to < 0 || to >= _files(s.cid, s.sid, s.aid).length) return Promise.resolve(false);
    return _save().then(function (ok) {
      if (!ok || _s !== s) return false;
      s.page = to;
      s.msg = '';
      _loadPage();
      return true;
    });
  }

  /* ── Changing the marks ─────────────────────────────────────── */

  function _change(next) {
    _s.undo.push(_s.marks);
    if (_s.undo.length > 100) _s.undo.shift();
    _s.redo = [];
    _s.marks = next;
    _s.dirty = true;
    _s.msg = '';
  }

  function _add(mark) {
    if (_s.marks.length >= MAX_MARKS) {
      _s.msg = 'A page can have ' + MAX_MARKS + ' marks at most.';
      _drawChrome();
      return false;
    }
    mark.id = 'mk' + Date.now().toString(36) + (++_ids).toString(36);
    _change(_s.marks.concat([mark]));
    _drawPage();
    _drawChrome();
    return true;
  }

  function undo() {
    if (!_s || !_s.undo.length) return;
    _s.redo.push(_s.marks);
    _s.marks = _s.undo.pop();
    _s.dirty = true;
    _drawPage();
    _drawChrome();
  }

  function redo() {
    if (!_s || !_s.redo.length) return;
    _s.undo.push(_s.marks);
    _s.marks = _s.redo.pop();
    _s.dirty = true;
    _drawPage();
    _drawChrome();
  }

  // The pen's and highlighter's colour.
  function setColor(color) {
    if (!_s || COLORS.indexOf(color) < 0) return;
    _s.color = color;
    _drawChrome();
  }

  function setTool(tool) {
    if (!_s || TOOLS.indexOf(tool) < 0) return;
    _s.tool = tool;
    _s.editing = null;
    _drawChrome();
  }

  // The notes, in the order they were made: their numbers on the page.
  function _notes() {
    return _s.marks.filter(function (m) {
      return m.type === 'note';
    });
  }

  function saveNote(text) {
    if (!_s || !_s.editing) return false;
    var t = String(text || '').trim();
    var ed = _s.editing;
    _s.editing = null;
    if (!t) {
      _drawChrome();
      return false;
    }
    t = t.slice(0, MAX_NOTE);
    if (ed.id) {
      _change(
        _s.marks.map(function (m) {
          return m.id === ed.id ? Object.assign({}, m, { text: t }) : m;
        }),
      );
      _drawPage();
      _drawChrome();
      return true;
    }
    return _add({ type: 'note', x: ed.x, y: ed.y, text: t });
  }

  /* ── Where a finger is on the page ──────────────────────────── */

  // The page's box on screen before the view moves it: fitted to the stage, centred.
  function _base() {
    var stage = document.querySelector('#m-markup .m-markup-stage');
    var r = stage ? stage.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var ratio = _s.size.h / _s.size.w;
    var w = r.width || 340;
    var h = w * ratio;
    if (r.height && h > r.height) {
      h = r.height;
      w = h / ratio;
    }
    return { left: r.left, top: r.top, ox: ((r.width || w) - w) / 2, oy: ((r.height || h) - h) / 2, w: w, h: h };
  }

  // A point on screen as fractions of the page.
  function _toPage(cx, cy) {
    var b = _base();
    var v = _s.view;
    return [_round((cx - b.left - b.ox - v.x) / v.s / b.w), _round((cy - b.top - b.oy - v.y) / v.s / b.h)];
  }

  function _round(n) {
    return Math.round(n * 10000) / 10000;
  }

  // Screen pixels per page width, as the page is shown now.
  function _pxPerWidth() {
    return _base().w * _s.view.s;
  }

  /* The marks a point touches, top first, within `reach` (a fraction of the
     page's width): shared/markup-draw.js's hit test, the desktop's, asked
     again without each mark it finds. Answers their ids. */
  function hitTest(marks, pt, reach, ratio) {
    var left = marks.slice();
    var out = [];
    for (;;) {
      var id = MarkupDraw.hitTest({ v: 1, marks: left }, { x: pt[0], y: pt[1] }, ratio, reach);
      if (!id) return out;
      out.push(id);
      left = left.filter(function (m) {
        return m.id !== id;
      });
    }
  }

  /* ── Fingers: one draws, two move the page ──────────────────── */

  function _onDown(e) {
    if (!_s || !e.target.closest || !e.target.closest('.m-markup-stage')) return;
    if (_s.editing) return;
    // The stage changed size since the page was laid out (the bar below it,
    // the phone turned): lay it out again, so a finger lands where it looks.
    var b = _base();
    if (!_s.laid || _s.laid.w !== b.w || _s.laid.h !== b.h || _s.laid.ox !== b.ox || _s.laid.oy !== b.oy) _drawPage();
    if (e.target.setPointerCapture && e.pointerId != null) {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {
        /* a synthetic pointer cannot be captured */
      }
    }
    _s.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(_s.ptrs);
    if (ids.length === 1) {
      _s.gesture = { kind: 'one', id: String(e.pointerId), x0: e.clientX, y0: e.clientY, moved: false };
      _startTool(e.clientX, e.clientY);
    } else if (ids.length === 2) {
      // A second finger: whatever the first was drawing is dropped, and the page moves.
      _s.stroke = null;
      _s.erasing = null;
      var a = _s.ptrs[ids[0]];
      var b = _s.ptrs[ids[1]];
      _s.gesture = {
        kind: 'two',
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        v0: { x: _s.view.x, y: _s.view.y, s: _s.view.s },
      };
      _drawPage();
    }
    e.preventDefault();
  }

  function _onMove(e) {
    if (!_s || !_s.ptrs[e.pointerId]) return;
    _s.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var g = _s.gesture;
    if (!g) return;
    if (g.kind === 'two') {
      var ids = Object.keys(_s.ptrs);
      if (ids.length < 2) return;
      var a = _s.ptrs[ids[0]];
      var b = _s.ptrs[ids[1]];
      var s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (g.v0.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0));
      var m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      var base = _base();
      // The point under the fingers' middle stays under it.
      var px = (g.m0.x - base.left - base.ox - g.v0.x) / g.v0.s;
      var py = (g.m0.y - base.top - base.oy - g.v0.y) / g.v0.s;
      _s.view = { s: s, x: m.x - base.left - base.ox - px * s, y: m.y - base.top - base.oy - py * s };
      _applyView();
      return;
    }
    if (Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0) > TAP_SLOP) g.moved = true;
    if (_s.stroke) {
      var p = _toPage(e.clientX, e.clientY);
      var last = _s.stroke.points[_s.stroke.points.length - 1];
      if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= 0.002) {
        _s.stroke.points.push(p);
        _drawPage();
      }
    } else if (_s.erasing) {
      _erase(e.clientX, e.clientY);
    }
  }

  function _onUp(e) {
    if (!_s || !_s.ptrs[e.pointerId]) return;
    delete _s.ptrs[e.pointerId];
    var g = _s.gesture;
    if (Object.keys(_s.ptrs).length) return; // a finger is still down
    _s.gesture = null;
    if (!g || g.kind !== 'one') return _drawPage();
    _endTool(e.clientX, e.clientY, g.moved);
  }

  function _onCancel(e) {
    if (!_s) return;
    delete _s.ptrs[e.pointerId];
    if (Object.keys(_s.ptrs).length) return;
    _s.gesture = null;
    _s.stroke = null;
    _s.erasing = null;
    _drawPage();
  }

  function _startTool(cx, cy) {
    var t = _s.tool;
    if (t === 'pen' || t === 'highlight') {
      _s.stroke = { type: t, points: [_toPage(cx, cy)] };
      _s.stroke.color = _s.color;
      _s.stroke.width = t === 'pen' ? MarkupDraw.PEN_WIDTH : MarkupDraw.HIGHLIGHT_WIDTH;
    } else if (t === 'eraser') {
      _s.erasing = {};
      _erase(cx, cy);
    }
  }

  // The Eraser's touch: the marks it reaches are hidden now and go on lift.
  function _erase(cx, cy) {
    var hit = hitTest(_s.marks, _toPage(cx, cy), HIT / _pxPerWidth(), _s.size.h / _s.size.w);
    var more = false;
    hit.forEach(function (id) {
      if (!_s.erasing[id]) more = _s.erasing[id] = true;
    });
    if (more) _drawPage();
  }

  function _endTool(cx, cy, moved) {
    var t = _s.tool;
    if (_s.stroke) {
      var stroke = _s.stroke;
      _s.stroke = null;
      _add(stroke);
      return;
    }
    if (_s.erasing) {
      var gone = _s.erasing;
      _s.erasing = null;
      if (Object.keys(gone).length) {
        _change(
          _s.marks.filter(function (m) {
            return !gone[m.id];
          }),
        );
        _drawChrome();
      }
      _drawPage();
      return;
    }
    if (moved) return;
    var p = _toPage(cx, cy);
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return;
    if (t === 'tick') _add({ type: 'tick', x: p[0], y: p[1], color: 'green' });
    else if (t === 'cross') _add({ type: 'cross', x: p[0], y: p[1], color: 'red' });
    else if (t === 'note') {
      // A note already there opens to be changed; elsewhere a new one starts.
      var on = hitTest(_notes(), p, HIT / _pxPerWidth(), _s.size.h / _s.size.w)[0];
      _s.editing = on ? { id: on } : { x: p[0], y: p[1] };
      _drawChrome();
      var box = document.querySelector('#m-markup .m-markup-note-text');
      if (box) box.focus();
    }
  }

  /* ── Drawing the screen ─────────────────────────────────────── */

  function _applyView() {
    var layer = document.querySelector('#m-markup .m-markup-layer');
    if (!layer) return;
    var v = _s.view;
    layer.style.transform = 'translate(' + v.x + 'px, ' + v.y + 'px) scale(' + v.s + ')';
  }

  // html-safe: names, the title and messages go through MC.esc; ids and numbers are ours
  function _draw() {
    var root = document.getElementById('m-markup');
    if (!root || !_s) return;
    var st = _student(_s.cid, _s.sid);
    var n = _files(_s.cid, _s.sid, _s.aid).length;
    if (!st) return close();
    var first = _first(st);
    // html-safe: the name goes through MC.esc; the rest is fixed words and numbers
    root.innerHTML =
      '<div class="m-markup-top">' +
      '<button type="button" class="m-markup-done" data-mk="done">Done</button>' +
      '<div class="m-markup-head"><div class="m-markup-title" id="m-markup-title">Mark Up</div>' +
      '<div class="m-markup-sub">' +
      MC.esc(displayName(st) + ' · Page ' + (_s.page + 1) + ' of ' + n) +
      '</div></div>' +
      '<button type="button" class="m-markup-icon" data-mk="undo" aria-label="Undo">' +
      ICONS.undo +
      '</button>' +
      '<button type="button" class="m-markup-icon" data-mk="redo" aria-label="Redo">' +
      ICONS.redo +
      '</button></div>' +
      '<div class="m-markup-stage"><div class="m-markup-layer">' +
      '<img class="m-markup-img" alt="' +
      MC.esc('Page ' + (_s.page + 1) + ' of ' + first + '’s work') +
      '">' +
      '<div class="m-markup-marks"></div></div></div>' +
      '<div class="m-markup-chrome"></div>';
    if (_s.img) root.querySelector('.m-markup-img').setAttribute('src', _s.img.url);
    // The bars first: the page is fitted to the room they leave.
    _drawChrome();
    _drawPage();
    _watchStage(root.querySelector('.m-markup-stage'));
  }

  // The page is laid out again whenever the stage changes size.
  var _ro = null;
  function _watchStage(stage) {
    if (_ro) _ro.disconnect();
    _ro = null;
    if (!stage || typeof ResizeObserver !== 'function') return;
    _ro = new ResizeObserver(function () {
      if (_s && !_s.gesture) _drawPage();
    });
    _ro.observe(stage);
  }

  /* The marks as shared/markup-draw.js draws them for the desktop and the
     student (the same SVG): a note is its numbered pin. Its words are in the
     white card above the tools (_notesCardHtml), never on the page, where a
     note near the edge was cut off. */
  // html-safe: MarkupDraw.svgHtml escapes a note's words
  function _marksHtml() {
    var hidden = _s.erasing || {};
    var shown = _s.marks.filter(function (m) {
      return !hidden[m.id];
    });
    if (_s.stroke) shown = shown.concat([_s.stroke]);
    return MarkupDraw.svgHtml({ v: 1, marks: shown }, _s.size.h / _s.size.w);
  }

  /* The page's notes, each by its number, and what the student sees, in a
     white card above the tools (the board "Phone: Mark Up a Photo"). */
  // html-safe: note words and the line go through MC.esc; numbers are ours
  function _notesCardHtml() {
    var list = MarkupDraw.notes({ v: 1, marks: _s.marks });
    if (!list.length) return '<p class="m-markup-sees">' + MC.esc(_seesLine()) + '</p>';
    return (
      '<div class="m-markup-card"><ol class="m-markup-card-notes">' +
      list
        .map(function (n) {
          return (
            '<li class="m-mk-note"><span class="m-mk-note-n" aria-hidden="true">' +
            n.n +
            '</span><span class="m-mk-note-text">' +
            MC.esc(n.text) +
            '</span></li>'
          );
        })
        .join('') +
      '</ol><p class="m-markup-sees">' +
      MC.esc(_seesLine()) +
      '</p></div>'
    );
  }

  function _drawPage() {
    var box = document.querySelector('#m-markup .m-markup-marks');
    var layer = document.querySelector('#m-markup .m-markup-layer');
    if (!box || !layer) return;
    var b = _base();
    _s.laid = { w: b.w, h: b.h, ox: b.ox, oy: b.oy };
    layer.style.left = b.ox + 'px';
    layer.style.top = b.oy + 'px';
    layer.style.width = b.w + 'px';
    layer.style.height = b.h + 'px';
    // html-safe: _marksHtml escapes note text; the rest is numbers and fixed words
    box.innerHTML = _marksHtml();
    _applyView();
  }

  // What the student sees of these marks, and when.
  function _seesLine() {
    var st = _student(_s.cid, _s.sid);
    var first = _first(st);
    var sw = typeof getAssessmentStudentWork === 'function' ? getAssessmentStudentWork(_s.cid, _s.aid) : null;
    if (sw && sw.students_see_markup === false)
      return first + ' doesn’t see these marks. Students See Your Mark Up is off for this work.';
    if (window.MGrade && MGrade.holdsGrades && MGrade.holdsGrades(_s.cid))
      return first + ' sees these marks and notes when you return the work.';
    return first + ' sees these marks and notes once you tap Done.';
  }

  // html-safe: tool names are fixed; note text and messages go through MC.esc
  function _drawChrome() {
    var box = document.querySelector('#m-markup .m-markup-chrome');
    if (!box || !_s) return;
    var n = _files(_s.cid, _s.sid, _s.aid).length;
    var html = '';
    if (_s.editing) {
      var was = _s.editing.id
        ? (
            _s.marks.find(function (m) {
              return m.id === _s.editing.id;
            }) || {}
          ).text || ''
        : '';
      html =
        '<div class="m-markup-note-edit">' +
        '<label class="m-markup-note-label" for="m-markup-note">Note</label>' +
        '<textarea id="m-markup-note" class="m-markup-note-text" rows="3" maxlength="' +
        MAX_NOTE +
        '">' +
        MC.esc(was) +
        '</textarea>' +
        '<div class="m-markup-note-btns"><button type="button" class="m-markup-btn" data-mk="note-cancel">Cancel</button>' +
        '<button type="button" class="m-markup-btn is-main" data-mk="note-save">' +
        (_s.editing.id ? 'Save Note' : 'Add Note') +
        '</button></div></div>';
    } else {
      html =
        _notesCardHtml() +
        (_s.msg ? '<p class="m-markup-msg" role="status">' + MC.esc(_s.msg) + '</p>' : '') +
        (n > 1
          ? '<div class="m-markup-pages">' +
            (_s.page > 0
              ? '<button type="button" class="m-markup-btn" data-mk="prev">‹ Page ' + _s.page + '</button>'
              : '<span></span>') +
            (_s.page < n - 1
              ? '<button type="button" class="m-markup-btn" data-mk="next">Page ' + (_s.page + 2) + ' ›</button>'
              : '<span></span>') +
            '</div>'
          : '') +
        '<div class="m-markup-tools" role="toolbar" aria-label="Mark Up tools">' +
        TOOLS.map(function (t) {
          var on = _s.tool === t;
          return (
            '<button type="button" class="m-markup-tool' +
            (on ? ' is-on' : '') +
            '" data-mk="tool" data-tool="' +
            t +
            '" aria-label="' +
            TOOL_NAMES[t] +
            '" aria-pressed="' +
            on +
            '">' +
            ICONS[t] +
            '</button>'
          );
        }).join('') +
        '</div>' +
        '<div class="m-markup-foot"><span class="m-markup-colors" role="group" aria-label="Colour">' +
        COLORS.map(function (c) {
          return (
            '<button type="button" class="m-markup-color m-markup-color-' +
            c +
            (_s.color === c ? ' is-on' : '') +
            '" data-mk="color" data-color="' +
            c +
            '" aria-label="' +
            COLOR_NAMES[c] +
            '" aria-pressed="' +
            (_s.color === c) +
            '"></button>'
          );
        }).join('') +
        '</span><p class="m-markup-hint">One finger draws. Two fingers move the page.</p></div>';
    }
    // html-safe: built above from escaped parts
    box.innerHTML = html;
    var u = document.querySelector('#m-markup [data-mk="undo"]');
    var r = document.querySelector('#m-markup [data-mk="redo"]');
    if (u) u.disabled = !_s.undo.length;
    if (r) r.disabled = !_s.redo.length;
  }

  /* ── Taps and keys ──────────────────────────────────────────── */

  function _onClick(e) {
    var btn = e.target.closest && e.target.closest('[data-mk]');
    if (!btn || !_s || btn.disabled) return;
    var what = btn.getAttribute('data-mk');
    if (what === 'done') done();
    else if (what === 'undo') undo();
    else if (what === 'redo') redo();
    else if (what === 'tool') setTool(btn.getAttribute('data-tool'));
    else if (what === 'color') setColor(btn.getAttribute('data-color'));
    else if (what === 'prev') goPage(-1);
    else if (what === 'next') goPage(1);
    else if (what === 'note-cancel') {
      _s.editing = null;
      _drawChrome();
    } else if (what === 'note-save') {
      var box = document.querySelector('#m-markup .m-markup-note-text');
      saveNote(box ? box.value : '');
    }
  }

  function _onKey(e) {
    if (!_s || e.key !== 'Escape') return;
    e.preventDefault();
    if (_s.editing) {
      _s.editing = null;
      _drawChrome();
    } else done();
  }

  return {
    can: can,
    open: open,
    close: close,
    isOpen: isOpen,
    view: function () {
      return _s ? _copy(_s.view) : null;
    },
    done: done,
    goPage: goPage,
    undo: undo,
    redo: redo,
    setTool: setTool,
    setColor: setColor,
    saveNote: saveNote,
    hitTest: hitTest,
    // For tests: the marks on screen now, not saved yet.
    marks: function () {
      return _s ? _copy(_s.marks) : null;
    },
  };
})();
