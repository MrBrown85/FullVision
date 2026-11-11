/* markup.js — Mark Up on the desktop (S9-F1).
 *
 * The board "Teacher: Mark Up": the teacher writes on a page of a student's
 * work with Pen, Highlight, Note, Tick, Cross and the Eraser, in red, green
 * or blue, with Undo and Redo, on a dark screen with labelled tool chips.
 * Each note's words sit on the page beside its pin, and the notes are listed
 * beside the page (Notes on This Page), with who sees the marks and the page
 * switcher under them. It opens from the grader's work pane (Mark Up, on
 * teacher/page-assignments.js) over everything, on the page that pane shows.
 *
 * Marks are data over the photo; the stored photo never changes. Each change
 * saves the page's whole set as the teacher's working copy
 * (saveMarkup in shared/data.js, "Mark Up"). The copy the student was given
 * is the data layer's: Return gives the working marks (returnWork, through
 * Grader.returnGrades), so a mark erased before Return never reaches the
 * student. Drawing and hit-testing are shared/markup-draw.js's, which the
 * phone can use too.
 *
 * Demo Mode, behind the build switch and Send Work: the work pane shows only
 * there. Signed in, saveMarkup answers not_available and nothing is kept.
 *
 * window.MarkUp: open({ cid, aid, sid, page, turn, onClose }), close(),
 * isOpen().
 */
window.MarkUp = (function () {
  'use strict';

  var D = window.MarkupDraw;
  var _s = null;

  var TOOL_NAMES = {
    pen: 'Pen',
    highlight: 'Highlight',
    note: 'Note',
    tick: 'Tick',
    cross: 'Cross',
    eraser: 'Eraser',
  };
  var COLOR_NAMES = { red: 'Red', green: 'Green', blue: 'Blue' };
  var NOTE_MAX = typeof MARKUP_NOTE_MAX === 'number' ? MARKUP_NOTE_MAX : 500;

  // Small line icons for the tools, drawn in the button's own colour.
  var ICONS = {
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/>',
    highlight: '<path d="M5 19h6M9 15l-2 2 2 2 2-2M9 15l7-7 3 3-7 7"/>',
    note: '<path d="M5 5h14v10H10l-5 4V5z"/>',
    tick: '<path d="M5 12l4 4 10-10"/>',
    cross: '<path d="M6 6l12 12M18 6L6 18"/>',
    eraser: '<path d="M8 20h12M5 15l8-8 6 6-5 5H9l-4-3z"/>',
    undo: '<path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-3"/>',
    redo: '<path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h3"/>',
  };
  function _icon(name) {
    return (
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      ICONS[name] +
      '</svg>'
    );
  }

  function isOpen() {
    return !!_s;
  }

  function _student(cid, sid) {
    return (
      (getStudents(cid) || []).find(function (x) {
        return x.id === sid;
      }) || null
    );
  }
  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (x) {
        return x && x.id === aid;
      }) || null
    );
  }
  // The pages: the group's on a One per Group piece (S12-F2), else the student's own.
  function _files(s) {
    if (typeof getStudentWorkGroup === 'function' && getStudentWorkGroup(s.cid, s.sid, s.aid))
      return getGroupWorkFiles(s.cid, s.sid, s.aid);
    var sub = getStudentSubmission(s.cid, s.sid, s.aid);
    return (sub && sub.files) || [];
  }
  function _file(s) {
    return _files(s)[s.at] || null;
  }

  // A key made once per save and sent again on a retry (saveMarkup).
  function _key() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'mk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  /* ── Open and close ──────────────────────────────────────── */

  function open(opts) {
    if (!D || !opts || !opts.cid || !opts.aid || !opts.sid) return false;
    close();
    var s = {
      cid: opts.cid,
      aid: opts.aid,
      sid: opts.sid,
      at: Math.max(0, opts.page || 0),
      turn: opts.turn || {},
      onClose: opts.onClose || null,
      tool: 'pen',
      color: 'red',
      hist: null,
      revs: {},
      gens: {},
      chain: {},
      pending: null,
      drag: null,
      msg: '',
      img: { key: null, url: null, release: null },
      trigger: document.activeElement,
    };
    var files = _files(s);
    if (!files.length) return false;
    s.at = Math.min(s.at, files.length - 1);
    _s = s;
    var overlay = document.createElement('div');
    overlay.className = 'markup-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'markup-title');
    // html-safe: the shell is fixed words and icons; the parts with names are drawn by _draw
    overlay.innerHTML = _shellHtml();
    document.body.appendChild(overlay);
    s.overlay = overlay;
    overlay.addEventListener('click', _onClick);
    overlay.addEventListener('keydown', _onKey);
    var stage = overlay.querySelector('.markup-surface');
    stage.addEventListener('pointerdown', _onDown);
    stage.addEventListener('pointermove', _onMove);
    stage.addEventListener('pointerup', _onUp);
    stage.addEventListener('pointercancel', _onUp);
    overlay.querySelector('.markup-img').addEventListener('load', function () {
      if (_s === s) _drawLayer();
    });
    _loadPage();
    var pen = overlay.querySelector('[data-mk-tool="pen"]');
    if (pen) pen.focus({ preventScroll: true });
    return true;
  }

  function _release(s) {
    if (s.img.release) s.img.release();
    s.img = { key: null, url: null, release: null };
  }

  /* Done. The marks are already saved, each change as it was made. */
  function close() {
    if (!_s) return;
    var s = _s;
    _s = null;
    _release(s);
    if (s.overlay) s.overlay.remove();
    if (s.trigger && s.trigger.isConnected && s.trigger.focus) s.trigger.focus({ preventScroll: true });
    if (s.onClose) s.onClose();
  }

  /* ── The page shown ──────────────────────────────────────── */

  function _loadPage() {
    var s = _s;
    var file = _file(s);
    s.pending = null;
    s.drag = null;
    s.msg = '';
    var row = file ? getPageMarkup(s.cid, file.id) : null;
    s.revs[file && file.id] = row ? row.rev : 0;
    s.hist = D.history(row ? row.marks : D.empty());
    _draw();
    var img = s.overlay.querySelector('.markup-img');
    if (!file) return;
    var key = [s.cid, s.aid, s.sid, file.id, file.path].join('|');
    if (s.img.key === key) return;
    _release(s);
    s.img.key = key;
    img.removeAttribute('src');
    openStudentWorkPage(s.cid, file, 'page').then(function (res) {
      // Mark Up closed, or moved to another page, before the picture came.
      if (_s !== s || s.img.key !== key) {
        if (res) res.release();
        return;
      }
      if (!res) return;
      s.img.url = res.url;
      s.img.release = res.release;
      img.src = res.url;
    });
  }

  function _step(dir) {
    var s = _s;
    var n = _files(s).length;
    var to = s.at + dir;
    if (to < 0 || to >= n) return;
    s.at = to;
    _loadPage();
  }

  /* ── Drawing the screen ──────────────────────────────────── */

  // html-safe: fixed words, icons and tool names
  function _shellHtml() {
    var tools = D.TOOLS.map(function (t) {
      return (
        '<button type="button" class="markup-tool" data-mk-tool="' +
        t +
        '" title="' +
        TOOL_NAMES[t] +
        '" aria-pressed="false">' +
        _icon(t) +
        '<span>' +
        TOOL_NAMES[t] +
        '</span></button>'
      );
    }).join('');
    var colors = Object.keys(D.COLORS)
      .map(function (c) {
        return (
          '<button type="button" class="markup-color markup-color-' +
          c +
          '" data-mk-color="' +
          c +
          '" aria-label="' +
          COLOR_NAMES[c] +
          '" title="' +
          COLOR_NAMES[c] +
          '" aria-pressed="false"></button>'
        );
      })
      .join('');
    return (
      '<div class="markup-screen">' +
      '<header class="markup-bar">' +
      '<div class="markup-heading"><h2 id="markup-title" class="markup-title">Mark Up</h2>' +
      '<p class="markup-sub"></p></div>' +
      '<div class="markup-tools" role="toolbar" aria-label="Mark Up tools">' +
      tools +
      '<span class="markup-sep" aria-hidden="true"></span>' +
      '<span class="markup-colors" role="group" aria-label="Colour">' +
      colors +
      '</span>' +
      '<span class="markup-sep" aria-hidden="true"></span>' +
      '<button type="button" class="markup-tool markup-icon" data-mk="undo" aria-label="Undo" title="Undo">' +
      _icon('undo') +
      '</button>' +
      '<button type="button" class="markup-tool markup-icon" data-mk="redo" aria-label="Redo" title="Redo">' +
      _icon('redo') +
      '</button>' +
      '</div>' +
      '<button type="button" class="btn btn-primary markup-done" data-mk="done">Done</button>' +
      '</header>' +
      '<div class="markup-body">' +
      '<div class="markup-stage"><div class="markup-surface">' +
      '<img class="markup-img" alt="" draggable="false">' +
      '<div class="markup-layer-host"></div>' +
      '</div></div>' +
      '<aside class="markup-side" aria-label="Notes on This Page">' +
      '<h3 class="markup-side-title">Notes on This Page</h3>' +
      '<div class="markup-notes"></div>' +
      '<p class="markup-msg" role="status"></p>' +
      '<p class="markup-sees"></p>' +
      '<span class="markup-pages">' +
      '<button type="button" class="btn btn-secondary markup-page" data-mk="page" data-dir="-1"></button>' +
      '<button type="button" class="btn btn-secondary markup-page" data-mk="page" data-dir="1"></button>' +
      '</span>' +
      '</aside>' +
      '</div>' +
      '</div>'
    );
  }

  /* "Jordan sees these marks and notes when you return the work." The
     piece's Students See Your Mark Up, and whether the class holds its
     grades for a Return, decide the line. */
  function _seesLine(s) {
    var st = _student(s.cid, s.sid);
    var first = st ? displayNameFirst(st) : 'The student';
    var work = typeof getAssessmentStudentWork === 'function' ? getAssessmentStudentWork(s.cid, s.aid) : null;
    if (work && work.students_see_markup === false)
      return first + ' won’t see these marks. Students See Your Mark Up is off for this piece.';
    var held = typeof GradeState !== 'undefined' && GradeState.holds(getReturnSettings(s.cid));
    return held
      ? first + ' sees these marks and notes when you return the work.'
      : first + ' sees these marks and notes as soon as you make them.';
  }

  function _draw() {
    var s = _s;
    var o = s.overlay;
    var files = _files(s);
    var st = _student(s.cid, s.sid);
    var a = _piece(s.cid, s.aid);
    var file = _file(s);
    o.querySelector('.markup-sub').textContent =
      (st ? displayNameWithLast(st) : '') +
      (a && a.title ? ' · ' + a.title : '') +
      ' · Page ' +
      (s.at + 1) +
      ' of ' +
      files.length;
    var img = o.querySelector('.markup-img');
    img.alt = 'Page ' + (s.at + 1) + ' of ' + (st ? displayNameFirst(st) + '’s work' : 'the work');
    var turn = (file && s.turn[file.id]) || 0;
    o.querySelector('.markup-stage').className = 'markup-stage turn-' + turn + ' tool-' + s.tool;
    o.querySelectorAll('[data-mk-tool]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mkTool === s.tool));
    });
    o.querySelectorAll('[data-mk-color]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mkColor === s.color));
    });
    o.querySelector('[data-mk="undo"]').disabled = !s.hist.canUndo();
    o.querySelector('[data-mk="redo"]').disabled = !s.hist.canRedo();
    var prev = o.querySelector('[data-mk="page"][data-dir="-1"]');
    var next = o.querySelector('[data-mk="page"][data-dir="1"]');
    prev.textContent = '‹ Page ' + Math.max(1, s.at);
    prev.disabled = s.at === 0;
    next.textContent = 'Page ' + Math.min(files.length, s.at + 2) + ' ›';
    next.disabled = s.at >= files.length - 1;
    o.querySelector('.markup-pages').hidden = files.length < 2;
    o.querySelector('.markup-sees').textContent = _seesLine(s);
    o.querySelector('.markup-msg').textContent = s.msg || '';
    _drawLayer();
    _drawNotes();
  }

  /* The marks over the page: what is saved, plus a line being drawn or a
     note being written. */
  function _drawLayer(live) {
    var s = _s;
    var host = s.overlay.querySelector('.markup-layer-host');
    var marks = live || s.hist.now();
    if (s.drag && s.drag.erased && s.drag.erased.length) marks = D.without(marks, s.drag.erased);
    var file = _file(s);
    var turn = (file && s.turn[file.id]) || 0;
    // html-safe: built by MarkupDraw.svgHtml, which escapes a note's words, and _calloutsHtml, which escapes them through esc
    host.innerHTML =
      D.svgHtml(marks, D.aspect(s.overlay.querySelector('.markup-img')), { pending: s.pending }) +
      _calloutsHtml(marks, turn);
  }

  /* Each note's words on the page beside its pin (the board's callouts),
     in the pin's colour: the number sits on the pin and the words run
     toward the middle of the page. On a turned page they stay upright.
     The list beside the page says the same, so a screen reader hears it
     once, there. */
  // html-safe: a note's words go through esc; places and numbers are ours
  function _calloutsHtml(marks, turn) {
    var notes = D.notes(marks);
    if (!notes.length) return '';
    var t = (((turn || 0) % 360) + 360) % 360;
    return (
      '<div class="markup-callouts" aria-hidden="true">' +
      notes
        .map(function (n) {
          var x = Math.min(1, Math.max(0, Number(n.x) || 0));
          var y = Math.min(1, Math.max(0, Number(n.y) || 0));
          // Where the pin falls across the screen, once the page is turned.
          var across = t === 90 ? 1 - y : t === 180 ? 1 - x : t === 270 ? y : x;
          return (
            '<span class="markup-callout' +
            (across > 0.6 ? ' is-left' : '') +
            '" style="left:' +
            Math.round(x * 10000) / 100 +
            '%;top:' +
            Math.round(y * 10000) / 100 +
            '%"><span class="markup-callout-box"><span class="markup-callout-n">' +
            n.n +
            '</span><span class="markup-callout-text">' +
            esc(n.text) +
            '</span></span></span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // html-safe: a note's words go through esc; numbers are ours; labels are fixed words
  function _drawNotes() {
    var s = _s;
    var box = s.overlay.querySelector('.markup-notes');
    var notes = D.notes(s.hist.now());
    var html = '';
    if (notes.length) {
      html +=
        '<ol class="markup-note-list">' +
        notes
          .map(function (n) {
            return (
              '<li class="markup-note"><span class="markup-note-n" aria-hidden="true">' +
              n.n +
              '</span><p class="markup-note-text">' +
              esc(n.text) +
              '</p><button type="button" class="markup-note-remove" data-mk="remove-note" data-id="' +
              esc(n.id) +
              '" aria-label="' +
              esc('Remove note ' + n.n) +
              '" title="Remove">×</button></li>'
            );
          })
          .join('') +
        '</ol>';
    } else if (!s.pending) {
      html += '<p class="markup-notes-none">No notes on this page yet.</p>';
    }
    if (s.pending) {
      html +=
        '<div class="markup-note-new">' +
        '<label class="markup-note-label" for="markup-note-text">' +
        esc('Note ' + (notes.length + 1)) +
        '</label>' +
        '<textarea id="markup-note-text" class="markup-note-input" rows="3" maxlength="' +
        NOTE_MAX +
        '"></textarea>' +
        '<div class="markup-note-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-mk="note-save">Save Note</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-mk="note-cancel">Cancel</button>' +
        '</div></div>';
    } else if (s.tool === 'note') {
      html += '<p class="markup-notes-hint">Click the page where the note goes.</p>';
    }
    var typed = s.overlay.querySelector('.markup-note-input');
    var keep = typed ? typed.value : '';
    box.innerHTML = html;
    var input = box.querySelector('.markup-note-input');
    if (input) {
      input.value = keep;
      input.focus({ preventScroll: true });
    }
  }

  /* ── Changes, each saved as made ─────────────────────────── */

  function _commit(next) {
    var s = _s;
    s.hist.push(next);
    _changed();
  }

  function _changed() {
    var s = _s;
    s.msg = '';
    _draw();
    _save(s, _file(s), s.hist.now());
  }

  function _answerLine(res) {
    if (res.result === 'not_available') return 'Mark Up is not ready for signed-in classes yet.';
    if (res.result === 'not_found') return 'This page is no longer handed in, so its marks can’t be saved.';
    return 'These marks couldn’t be saved. Try again.';
  }

  /* One save at a time for each page, in order, each with the rev the last
     one answered. Another save that came first (changed) wins: its marks
     are shown, and saves queued behind on the old marks are dropped. */
  function _save(s, file, marks) {
    if (!file) return;
    var id = file.id;
    var gen = s.gens[id] || 0;
    s.chain[id] = (s.chain[id] || Promise.resolve()).then(function () {
      if ((s.gens[id] || 0) !== gen) return;
      return saveMarkup(s.cid, id, marks, s.revs[id] == null ? 0 : s.revs[id], _key()).then(function (res) {
        if (!res) return;
        if (res.result === 'saved') {
          s.revs[id] = res.rev;
          return;
        }
        if (res.result === 'changed') {
          s.revs[id] = res.rev;
          s.gens[id] = gen + 1;
        }
        // Said, and redrawn, only while this page is the one on screen.
        if (_s !== s) return;
        var on = _file(s);
        if (!on || on.id !== id) return;
        if (res.result === 'changed') {
          s.hist.reset(res.marks);
          s.pending = null;
          s.msg = 'These marks were changed somewhere else. The newest are shown.';
        } else {
          s.msg = _answerLine(res);
        }
        _draw();
      });
    });
  }

  function _undo() {
    var s = _s;
    if (s.hist.undo()) _changed();
  }
  function _redo() {
    var s = _s;
    if (s.hist.redo()) _changed();
  }

  function _saveNote() {
    var s = _s;
    var input = s.overlay.querySelector('.markup-note-input');
    var text = input ? input.value.trim().slice(0, NOTE_MAX) : '';
    if (!s.pending || !text) {
      if (input) input.focus({ preventScroll: true });
      return;
    }
    var at = s.pending;
    s.pending = null;
    if (input) input.value = '';
    _commit(D.plus(s.hist.now(), D.place('note', s.color, at, text)));
  }

  function _cancelNote() {
    var s = _s;
    s.pending = null;
    var input = s.overlay.querySelector('.markup-note-input');
    if (input) input.value = '';
    _draw();
  }

  /* ── Pointer on the page ─────────────────────────────────── */

  function _place(e) {
    var s = _s;
    var el = s.overlay.querySelector('.markup-surface');
    var r = el.getBoundingClientRect();
    var file = _file(s);
    var turn = (file && s.turn[file.id]) || 0;
    var side = turn % 180 !== 0;
    var w = el.offsetWidth || (side ? r.height : r.width);
    var h = el.offsetHeight || (side ? r.width : r.height);
    return D.toPage(e.clientX, e.clientY, { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: w, h: h }, turn);
  }

  function _aspect() {
    return D.aspect(_s.overlay.querySelector('.markup-img'));
  }

  function _onDown(e) {
    var s = _s;
    if (!s || (e.button != null && e.button !== 0)) return;
    var p = _place(e);
    e.preventDefault();
    if (s.tool === 'pen' || s.tool === 'highlight') {
      s.drag = { line: D.stroke(s.tool, s.color, p) };
    } else if (s.tool === 'eraser') {
      var hit = D.hitTest(s.hist.now(), p, _aspect());
      s.drag = { erased: hit ? [hit] : [] };
      _drawLayer();
    } else if (s.tool === 'note') {
      s.pending = p;
      _draw();
      return;
    } else {
      _commit(D.plus(s.hist.now(), D.place(s.tool, s.color, p)));
      return;
    }
    if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId != null) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {
        // A pointer the browser no longer knows: the drag still works.
      }
    }
  }

  function _onMove(e) {
    var s = _s;
    if (!s || !s.drag) return;
    var p = _place(e);
    if (s.drag.line) {
      if (D.extend(s.drag.line, p)) _drawLayer(D.plus(s.hist.now(), s.drag.line));
    } else if (s.drag.erased) {
      var hit = D.hitTest(D.without(s.hist.now(), s.drag.erased), p, _aspect());
      if (hit) {
        s.drag.erased.push(hit);
        _drawLayer();
      }
    }
  }

  function _onUp() {
    var s = _s;
    if (!s || !s.drag) return;
    var d = s.drag;
    s.drag = null;
    if (d.line) _commit(D.plus(s.hist.now(), d.line));
    else if (d.erased && d.erased.length) _commit(D.without(s.hist.now(), d.erased));
    else _drawLayer();
  }

  /* ── Buttons and keys ────────────────────────────────────── */

  function _onClick(e) {
    // Mark Up's clicks are its own: the grader under it hears none.
    e.stopPropagation();
    var s = _s;
    if (!s) return;
    var b = e.target.closest('button');
    if (!b || b.disabled || !s.overlay.contains(b)) return;
    if (b.dataset.mkTool) {
      s.tool = b.dataset.mkTool;
      if (s.tool !== 'note') s.pending = null;
      _draw();
      b.focus({ preventScroll: true });
      return;
    }
    if (b.dataset.mkColor) {
      s.color = b.dataset.mkColor;
      _draw();
      return;
    }
    var what = b.dataset.mk;
    if (what === 'done') close();
    else if (what === 'undo') _undo();
    else if (what === 'redo') _redo();
    else if (what === 'page') _step(parseInt(b.dataset.dir, 10) || 0);
    else if (what === 'note-save') _saveNote();
    else if (what === 'note-cancel') _cancelNote();
    else if (what === 'remove-note') _commit(D.without(s.hist.now(), [b.dataset.id]));
    // A button redrawn under the press gets the keys back.
    var again =
      what === 'page'
        ? '[data-mk="page"][data-dir="' + b.dataset.dir + '"]'
        : what === 'undo' || what === 'redo'
          ? '[data-mk="' + what + '"]'
          : null;
    var to = again && _s && _s.overlay.querySelector(again);
    if (to && !to.disabled) to.focus({ preventScroll: true });
  }

  function _focusables(o) {
    return Array.prototype.filter.call(o.querySelectorAll('button, textarea'), function (el) {
      return !el.disabled && !el.closest('[hidden]');
    });
  }

  function _onKey(e) {
    // The grader's keys (arrows, levels, Escape) stay off while Mark Up is open.
    e.stopPropagation();
    var s = _s;
    if (!s) return;
    var typing = e.target && e.target.tagName === 'TEXTAREA';
    if (e.key === 'Escape') {
      e.preventDefault();
      if (s.pending) _cancelNote();
      else close();
      return;
    }
    if (typing) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _saveNote();
      }
      return;
    }
    var mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) _redo();
      else _undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      _redo();
      return;
    }
    if (e.key === 'Tab') {
      var list = _focusables(s.overlay);
      if (!list.length) return;
      var i = list.indexOf(document.activeElement);
      var to = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i < 0 || i === list.length - 1 ? 0 : i + 1;
      e.preventDefault();
      list[to].focus();
    }
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
  };
})();
