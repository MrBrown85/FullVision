// @ts-check
/* ── add-work-split-stickers.js — Split the Scan: stickers name pieces (B4) ──
   A student sticks one of their stickers (teacher/scan-labels.js) on the
   first page of a paper. When Split the Scan has cut the pile, each piece's
   first page is read here, on this computer (ScanLabelRead, jsQR), and a
   sticker that reads cleanly names its piece. Pieces are still cut by Pages
   per Student, never by where stickers are: a sticker on a page that is not
   a piece's first page names no one.

   Only when the class has sticker codes: listScanLabels is asked once when
   the scan opens (for each class, with two classes on). Refused or empty,
   nothing is read, jsQR is never fetched and nothing is said.

   In the background: first pages are read one after another, each picture
   once (a page turned by hand is a new picture and is read again); the
   reader pauses between looks, so typing stays live. Match the Named
   Pieces never waits for it.

   What a read does (ScanLabelRead.resolve over the pieces' first pages,
   worked out again at every draw, so it follows the cuts):
   - names the piece, kept against the page it was read from (review rule
     5): a moved cut un-names it and moving back names it again;
   - never replaces a name the teacher typed, nor a box they emptied
     (unless they press Use Sticker);
   - never names a student typed on another piece: shown on both;
   - twice, retired, another class's, a student no longer in the class:
     shown on the piece, never taken;
   - a sticker read upside down marks its page through
     AddWorkSplitTurn.finders ("Upside down?"); nothing is turned.

   Nothing is sent but listScanLabels, and no code, page or name is logged.

   AddWorkSplitStickers.start(s, ctx)   once the pieces are cut.
   AddWorkSplitStickers.sync(s, ctx)    at every draw (pure, then reads on).
   AddWorkSplitStickers.html(s)         the line under the tally.
   AddWorkSplitStickers.cardHtml(s, p, ctx)  what a piece's sticker says.
   AddWorkSplitStickers.click(s, what, btn, ctx)  Use Sticker.
   AddWorkSplitStickers.line(s)         the line's words.
   AddWorkSplitStickers.configure({ list, read })  seams for tests. */
/** @type {any} */ (window).AddWorkSplitStickers = (function () {
  'use strict';

  var W = /** @type {any} */ (window);
  function _defaultList(cid) {
    return W.listScanLabels(cid);
  }
  function _defaultRead(picture) {
    return W.ScanLabelRead.read(picture);
  }
  var _list = _defaultList;
  var _read = _defaultRead;
  // Each picture read: picture → { code, upsideDown, turn } or null. Pictures are let go with the scan.
  var _seen = new WeakMap();

  // A sticker read upside down says its page is: only that page, never turned.
  function _finder(page) {
    var r = page && typeof page === 'object' ? _seen.get(page) : null;
    return Promise.resolve(r && r.turn === 180 ? true : null);
  }
  function _addFinder() {
    var T = W.AddWorkSplitTurn;
    if (T && T.finders.indexOf(_finder) < 0) T.finders.push(_finder);
  }
  _addFinder();

  function _alive(s, ctx, m) {
    return ctx.state() === s && s.m === m && !!s.stk && !!s.stk.labels;
  }

  function start(s, ctx) {
    if (!s || !s.m || !W.ScanLabelRead) return Promise.resolve(false);
    if (_list === _defaultList && typeof W.listScanLabels !== 'function') return Promise.resolve(false);
    _addFinder();
    var m = s.m;
    var cids = Array.isArray(s.cids) && s.cids.length ? s.cids : [s.cid];
    s.stk = { labels: null, busy: false, done: 0, total: 0 };
    var stk = s.stk;
    return Promise.all(
      cids.map(function (cid) {
        return Promise.resolve()
          .then(function () {
            return _list(cid);
          })
          .then(null, function () {
            return null;
          });
      }),
    ).then(function (answers) {
      if (ctx.state() !== s || s.m !== m || s.stk !== stk) return false;
      var labels = [];
      var ok = answers.every(function (a) {
        if (!a || a.refused || a.error || !a.data || !Array.isArray(a.data.labels)) return false;
        labels = labels.concat(a.data.labels);
        return true;
      });
      // Refused (for either class) or no codes: nothing is read and nothing is said.
      if (!ok || !labels.length) {
        s.stk = null;
        return false;
      }
      stk.labels = labels;
      ctx.draw();
      return true;
    });
  }

  // The read of a piece's first page, or undefined while it has not been read.
  function _readOf(s, no) {
    var p = s.m.page(no);
    return p && _seen.has(p.page) ? _seen.get(p.page) : undefined;
  }

  // The stickers of the pieces' first pages, as the model keeps them, then the next read.
  function sync(s, ctx) {
    var stk = s && s.stk;
    if (!stk || !stk.labels || !s.m) return;
    var ps = s.m.pieces();
    var reads = ps.map(function (p) {
      var r = _readOf(s, p.first);
      return r || null;
    });
    var res = W.ScanLabelRead.resolve(reads, stk.labels, s.list);
    var map = {};
    res.pieces.forEach(function (r, i) {
      if (!r.code) return;
      var also = [];
      if (r.why === 'twice')
        res.pieces.forEach(function (o, j) {
          if (j !== i && o.code === r.code) also.push(ps[j].at);
        });
      map[ps[i].first] = { sid: r.sid || '', why: r.why || '', code: r.code, also: also };
    });
    s.m.setStickers(map);
    stk.total = ps.length;
    stk.done = ps.filter(function (p) {
      return _readOf(s, p.first) !== undefined;
    }).length;
    _next(s, ctx);
  }

  // The next first page not yet read, one at a time.
  function _next(s, ctx) {
    var stk = s.stk;
    var m = s.m;
    if (!stk || stk.busy || !m) return;
    var todo = m.pieces().find(function (p) {
      return _readOf(s, p.first) === undefined;
    });
    if (!todo) return;
    var pic = m.page(todo.first).page;
    stk.busy = true;
    Promise.resolve()
      .then(function () {
        return _read(pic);
      })
      .then(
        function (got) {
          _seen.set(pic, got && got.code ? got : null);
          return got;
        },
        function (err) {
          // jsQR could not be fetched: stickers are left alone for this scan, quietly.
          if (err && err.reason === 'no_reader') {
            if (s.stk === stk) s.stk = null;
            return null;
          }
          _seen.set(pic, null);
          return null;
        },
      )
      .then(function (got) {
        stk.busy = false;
        // The page closed, another scan opened, or the read was stopped: nothing is named.
        if (!_alive(s, ctx, m) || s.stk !== stk) return;
        if (got && got.turn === 180 && W.AddWorkSplitTurn) W.AddWorkSplitTurn.find(s, ctx);
        ctx.draw();
      });
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function line(s) {
    var stk = s && s.stk;
    if (!stk || !stk.labels || !s.m || !stk.total) return '';
    if (stk.done < stk.total) return 'Reading stickers: ' + stk.done + ' of ' + stk.total;
    var ps = s.m.pieces();
    var by = ps.filter(function (p) {
      return p.bySticker;
    }).length;
    var left = ps.filter(function (p) {
      return !p.sid;
    }).length;
    return _plural(by, 'piece', 'pieces') + ' named by sticker, ' + left + ' left to type.';
  }

  // html-safe: counts and fixed words, through esc
  function html(s) {
    var words = line(s);
    return words ? '<p class="aws-hint aws-stk-line" role="status">' + esc(words) + '</p>' : '';
  }

  function _nums(ats) {
    var nums = ats.map(function (at) {
      return String(at + 1);
    });
    if (nums.length < 2) return 'piece ' + nums[0];
    var last = nums.pop();
    return 'pieces ' + nums.join(', ') + ' and ' + last;
  }

  // What a piece's sticker says, in words; '' when there is nothing to say.
  function note(s, p, ctx) {
    var k = p.sticker;
    var call = function (sid) {
      return (ctx && ctx.call ? ctx.call(s, sid) : '') || 'a student';
    };
    if (p.clash >= 0) return 'The sticker says ' + call(k.sid) + ', who is typed on piece ' + (p.clash + 1) + '.';
    if (p.clashFrom && p.clashFrom.length)
      return 'The sticker on ' + _nums(p.clashFrom) + ' says ' + call(p.sid) + ' too.';
    if (!k) return '';
    if (k.why === 'twice') return 'The same sticker is on ' + _nums(k.also) + '. Type the name.';
    if (k.why === 'retired') return 'This sticker is from a sheet that was replaced.';
    if (k.why === 'other')
      return Array.isArray(s.cids) && s.cids.length > 1
        ? 'This sticker isn’t one of these classes’.'
        : 'This sticker isn’t one of this class’s.';
    if (k.why === 'gone') return 'This sticker is for a student no longer in the class.';
    if (k.sid && p.typed && k.sid !== p.sid) return 'The sticker says ' + call(k.sid) + '.';
    return '';
  }

  // html-safe: words through esc; numbers are ours (esc too)
  function cardHtml(s, p, ctx) {
    if (!s.stk || !s.stk.labels) return '';
    var words = note(s, p, ctx);
    var use = p.sticker && p.sticker.sid && p.typed && p.sticker.sid !== p.sid && p.clash < 0;
    if (!p.bySticker && !words) return '';
    return (
      '<div class="aws-stk">' +
      (p.bySticker ? '<span class="aws-by-sticker">By Sticker</span>' : '') +
      (words ? '<span class="aws-stk-note">' + esc(words) + '</span>' : '') +
      (use
        ? '<button type="button" class="aws-stk-use" data-aws="useSticker" data-at="' +
          esc(String(p.at)) +
          '" data-key="useSticker:' +
          esc(String(p.first)) +
          '" tabindex="-1">Use Sticker</button>'
        : '') +
      '</div>'
    );
  }

  function click(s, what, btn, ctx) {
    if (what !== 'useSticker') return false;
    if (s.m && s.m.useSticker(Number(btn.getAttribute('data-at')))) ctx.draw();
    return true;
  }

  function configure(opts) {
    opts = opts || {};
    if ('list' in opts) _list = opts.list || _defaultList;
    if ('read' in opts) _read = opts.read || _defaultRead;
  }

  return {
    start: start,
    sync: sync,
    line: line,
    html: html,
    note: note,
    cardHtml: cardHtml,
    click: click,
    configure: configure,
  };
})();
