/* markup-draw.js — Mark Up's drawing and hit-testing (S9).
 *
 * Plain functions over a page's marks, with no screen of their own, so the
 * desktop's Mark Up (teacher/markup.js) and the phone's (S9-F2) draw and
 * erase the same way. Marks are data over the photo: the photo itself is
 * never changed (shared/data.js, "Mark Up").
 *
 * A page's marks are { v: 1, marks: [ … ] }. A place is a fraction of the
 * page from its top left, x and y from 0 to 1, as Demo Mode's sample has
 * them (shared/seed-data.js, DEMO_MARKUP):
 *   { id, type: 'pen' | 'highlight', color, width, points: [[x, y], …] }
 *     width is a fraction of the page's width;
 *   { id, type: 'note', x, y, text }  the pin's place; numbered in order;
 *   { id, type: 'tick' | 'cross', x, y, color }.
 * The Eraser takes marks out of the list; it is not a mark.
 *
 * What it exposes (window.MarkupDraw):
 *   COLORS, TOOLS, PEN_WIDTH, HIGHLIGHT_WIDTH
 *   empty()                       a page with no marks
 *   aspect(img)                   the page's height over its width
 *   svgHtml(marks, aspect, opts)  the marks as one <svg>, to lie over the
 *                                 page (opts.pending: a note pin not saved yet)
 *   notes(marks)                  the notes, numbered as their pins are
 *   toPage(x, y, box, turn)       a point on screen to a place on the page,
 *                                 for a page turned 0, 90, 180 or 270 degrees
 *   hitTest(marks, p, aspect, r)  the id of the top mark at place p, or null
 *   stroke / extend / place       make a mark
 *   without(marks, ids)           the marks with those taken out
 *   history(marks)                Undo and Redo over whole sets of marks
 */
window.MarkupDraw = (function () {
  'use strict';

  var COLORS = { red: '#d93025', green: '#188038', blue: '#1a73e8' };
  var TOOLS = ['pen', 'highlight', 'note', 'tick', 'cross', 'eraser'];
  var PEN_WIDTH = 0.004;
  var HIGHLIGHT_WIDTH = 0.03;
  // The viewBox is 1000 wide; a page's height follows its own shape.
  var VIEW = 1000;
  // A letter page, until the photo says otherwise.
  var LETTER = 11 / 8.5;
  // A mark's size on the page, as a fraction of its width.
  var PIN = 0.018;
  var SIGN = 0.022;

  var _seq = 0;
  function _id() {
    _seq = (_seq + 1) % 1e6;
    return 'mk' + Date.now().toString(36) + _seq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }

  function _num(v, lo, hi) {
    var n = Number(v);
    if (!isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }
  function _f(n) {
    return String(Math.round(n * 10) / 10);
  }
  function _color(c) {
    return COLORS[c] || COLORS.red;
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function empty() {
    return { v: 1, marks: [] };
  }

  function _list(marks) {
    return (marks && Array.isArray(marks.marks) ? marks.marks : []).filter(function (m) {
      return m && typeof m === 'object';
    });
  }

  /* The page's height over its width, from the picture once it has loaded;
     a letter page before then. */
  function aspect(img) {
    var w = img && img.naturalWidth;
    var h = img && img.naturalHeight;
    return w > 0 && h > 0 ? h / w : LETTER;
  }

  /* The notes in the order they were made, each with its number. */
  function notes(marks) {
    var n = 0;
    return _list(marks)
      .filter(function (m) {
        return m.type === 'note';
      })
      .map(function (m) {
        n++;
        return { n: n, id: m.id, x: m.x, y: m.y, text: m.text };
      });
  }

  function _pin(x, y, n, cls, title) {
    var r = PIN * VIEW;
    return (
      '<g class="markup-pin' +
      (cls ? ' ' + cls : '') +
      '">' +
      (title != null ? '<title>' + _esc(title) + '</title>' : '') +
      '<circle cx="' +
      _f(x) +
      '" cy="' +
      _f(y) +
      '" r="' +
      _f(r) +
      '"></circle>' +
      '<text x="' +
      _f(x) +
      '" y="' +
      _f(y + r * 0.36) +
      '" text-anchor="middle" font-size="' +
      _f(r * 1.1) +
      '">' +
      _esc(n) +
      '</text></g>'
    );
  }

  /* The marks as one SVG, sized to lie exactly over the page (position it
     with inset: 0). Numbers only, never a note's words, appear on the page;
     a pin's words are its <title>. `opts.pending` is a pin for a note being
     written: { x, y }. */
  // html-safe: every number is formatted by _f; a note's text goes through _esc
  function svgHtml(marks, asp, opts) {
    var o = opts || {};
    var H = VIEW * (asp > 0 ? asp : LETTER);
    var out = '';
    var n = 0;
    _list(marks).forEach(function (m) {
      var id = ' data-mark="' + _esc(m.id || '') + '"';
      if (m.type === 'pen' || m.type === 'highlight') {
        var pts = (Array.isArray(m.points) ? m.points : [])
          .map(function (p) {
            return Array.isArray(p) ? _f(_num(p[0], 0, 1) * VIEW) + ',' + _f(_num(p[1], 0, 1) * H) : null;
          })
          .filter(Boolean);
        if (!pts.length) return;
        if (pts.length === 1) pts.push(pts[0]);
        var hi = m.type === 'highlight';
        var w = _num(m.width, 0.001, 0.08) * VIEW;
        out +=
          '<polyline class="markup-' +
          m.type +
          '"' +
          id +
          ' points="' +
          pts.join(' ') +
          '" fill="none" stroke="' +
          _color(m.color) +
          '" stroke-width="' +
          _f(w) +
          '" stroke-linecap="round" stroke-linejoin="round"' +
          (hi ? ' stroke-opacity="0.35"' : '') +
          '></polyline>';
        return;
      }
      var x = _num(m.x, 0, 1) * VIEW;
      var y = _num(m.y, 0, 1) * H;
      var s = SIGN * VIEW;
      if (m.type === 'note') {
        n++;
        out += '<g' + id + '>' + _pin(x, y, n, '', m.text) + '</g>';
      } else if (m.type === 'tick') {
        out +=
          '<path class="markup-tick"' +
          id +
          ' d="M' +
          _f(x - s) +
          ' ' +
          _f(y) +
          ' L' +
          _f(x - s * 0.3) +
          ' ' +
          _f(y + s * 0.7) +
          ' L' +
          _f(x + s) +
          ' ' +
          _f(y - s * 0.8) +
          '" fill="none" stroke="' +
          _color(m.color) +
          '" stroke-width="' +
          _f(s * 0.28) +
          '" stroke-linecap="round" stroke-linejoin="round"></path>';
      } else if (m.type === 'cross') {
        out +=
          '<path class="markup-cross"' +
          id +
          ' d="M' +
          _f(x - s * 0.8) +
          ' ' +
          _f(y - s * 0.8) +
          ' L' +
          _f(x + s * 0.8) +
          ' ' +
          _f(y + s * 0.8) +
          ' M' +
          _f(x + s * 0.8) +
          ' ' +
          _f(y - s * 0.8) +
          ' L' +
          _f(x - s * 0.8) +
          ' ' +
          _f(y + s * 0.8) +
          '" fill="none" stroke="' +
          _color(m.color) +
          '" stroke-width="' +
          _f(s * 0.28) +
          '" stroke-linecap="round"></path>';
      }
    });
    if (o.pending) {
      out += _pin(_num(o.pending.x, 0, 1) * VIEW, _num(o.pending.y, 0, 1) * H, n + 1, 'is-pending', null);
    }
    return (
      '<svg class="markup-layer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      VIEW +
      ' ' +
      _f(H) +
      '" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
      out +
      '</svg>'
    );
  }

  /* A point on screen (clientX, clientY) to a place on the page. `box` is
     the page as laid out before it turns: { cx, cy } its centre on screen
     (the centre of its bounding box, which turning does not move) and
     { w, h } its own width and height. `turn` is the CSS rotation, 0, 90,
     180 or 270 degrees clockwise. Answers { x, y }, each 0 to 1. */
  function toPage(clientX, clientY, box, turn) {
    var dx = clientX - box.cx;
    var dy = clientY - box.cy;
    var t = (((turn || 0) % 360) + 360) % 360;
    var lx = dx;
    var ly = dy;
    // Undo the turn: a page turned clockwise by t is read back by -t.
    if (t === 90) {
      lx = dy;
      ly = -dx;
    } else if (t === 180) {
      lx = -dx;
      ly = -dy;
    } else if (t === 270) {
      lx = -dy;
      ly = dx;
    }
    return {
      x: _num((lx + box.w / 2) / (box.w || 1), 0, 1),
      y: _num((ly + box.h / 2) / (box.h || 1), 0, 1),
    };
  }

  // Distance from p to the segment a-b, in page widths (y scaled by aspect).
  function _segDist(p, a, b, asp) {
    var px = p.x;
    var py = p.y * asp;
    var ax = a[0];
    var ay = a[1] * asp;
    var bx = b[0];
    var by = b[1] * asp;
    var vx = bx - ax;
    var vy = by - ay;
    var len = vx * vx + vy * vy;
    var t = len ? ((px - ax) * vx + (py - ay) * vy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    var qx = ax + t * vx - px;
    var qy = ay + t * vy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }

  /* The id of the top mark (the last drawn) within `radius` (a fraction of
     the page's width; 0.015 when left out) of place p, or null. */
  function hitTest(marks, p, asp, radius) {
    var a = asp > 0 ? asp : LETTER;
    var r = radius > 0 ? radius : 0.015;
    var list = _list(marks);
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m.type === 'pen' || m.type === 'highlight') {
        var pts = Array.isArray(m.points) ? m.points : [];
        var reach = r + _num(m.width, 0, 0.08) / 2;
        for (var j = 0; j < pts.length; j++) {
          var b = pts[j + 1] || pts[j];
          if (_segDist(p, pts[j], b, a) <= reach) return m.id || null;
        }
      } else {
        var dx = _num(m.x, 0, 1) - p.x;
        var dy = (_num(m.y, 0, 1) - p.y) * a;
        var size = m.type === 'note' ? PIN : SIGN;
        if (Math.sqrt(dx * dx + dy * dy) <= r + size) return m.id || null;
      }
    }
    return null;
  }

  function _r(n) {
    return Math.round(n * 10000) / 10000;
  }

  /* A new pen or highlight line, started at p. */
  function stroke(type, color, p) {
    return {
      id: _id(),
      type: type === 'highlight' ? 'highlight' : 'pen',
      color: COLORS[color] ? color : 'red',
      width: type === 'highlight' ? HIGHLIGHT_WIDTH : PEN_WIDTH,
      points: [[_r(p.x), _r(p.y)]],
    };
  }

  /* The line goes on to p, unless p is too close to its last point to
     matter. Answers true when a point was added. */
  function extend(line, p) {
    var last = line.points[line.points.length - 1];
    if (last && Math.abs(last[0] - p.x) < 0.002 && Math.abs(last[1] - p.y) < 0.002) return false;
    line.points.push([_r(p.x), _r(p.y)]);
    return true;
  }

  /* A note, tick or cross at p. A note takes its words. */
  function place(type, color, p, text) {
    var m = { id: _id(), type: type, x: _r(p.x), y: _r(p.y) };
    if (type === 'note') m.text = String(text || '');
    else m.color = COLORS[color] ? color : type === 'tick' ? 'green' : 'red';
    return m;
  }

  function _copy(marks) {
    return JSON.parse(JSON.stringify(marks && marks.v === 1 ? marks : empty()));
  }

  /* The marks with the marks `ids` taken out (a new set). */
  function without(marks, ids) {
    var out = _copy(marks);
    var gone = {};
    (ids || []).forEach(function (id) {
      gone[id] = true;
    });
    out.marks = out.marks.filter(function (m) {
      return !(m && gone[m.id]);
    });
    return out;
  }

  /* With one more mark (a new set). */
  function plus(marks, mark) {
    var out = _copy(marks);
    out.marks.push(JSON.parse(JSON.stringify(mark)));
    return out;
  }

  /* Undo and Redo over whole sets of marks. `now()` is the set on screen;
     `push(next)` makes `next` the set and forgets what was undone. */
  function history(start) {
    var past = [];
    var future = [];
    var cur = _copy(start);
    return {
      now: function () {
        return _copy(cur);
      },
      push: function (next) {
        past.push(cur);
        if (past.length > 200) past.shift();
        cur = _copy(next);
        future = [];
        return _copy(cur);
      },
      undo: function () {
        if (!past.length) return null;
        future.push(cur);
        cur = past.pop();
        return _copy(cur);
      },
      redo: function () {
        if (!future.length) return null;
        past.push(cur);
        cur = future.pop();
        return _copy(cur);
      },
      canUndo: function () {
        return past.length > 0;
      },
      canRedo: function () {
        return future.length > 0;
      },
      reset: function (marks) {
        past = [];
        future = [];
        cur = _copy(marks);
      },
    };
  }

  return {
    COLORS: COLORS,
    TOOLS: TOOLS,
    PEN_WIDTH: PEN_WIDTH,
    HIGHLIGHT_WIDTH: HIGHLIGHT_WIDTH,
    empty: empty,
    aspect: aspect,
    svgHtml: svgHtml,
    notes: notes,
    toPage: toPage,
    hitTest: hitTest,
    stroke: stroke,
    extend: extend,
    place: place,
    without: without,
    plus: plus,
    history: history,
  };
})();
