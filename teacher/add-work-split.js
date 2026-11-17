// @ts-check
/* ── add-work-split.js — Add Work for the Class: Split the Scan (B2) ─────
   The photocopier emails one PDF of the whole pile. This page reads it on
   this computer, leaves out the blank backs, cuts it into one piece per
   student, and the teacher names each piece by typing a few letters while
   looking at the top of its first page. Match the Named Pieces hands the
   named pieces to Add Work for the Class (teacher/add-work-class.js), where
   nothing is saved until Add Work is pressed (docs/plans/
   add-work-for-class-plan.md, slice B2; DECISIONS "Add Work for the Class
   (2026-11-17)").

   Privacy. Nothing reads handwriting and nothing is sent anywhere: the
   scan is read here (PhotoShrink.prepare with pdf.js from vendor/), blank
   pages are found by how little the picture changes, and names are typed
   by the teacher. The scan is never kept or uploaded whole. Its file name
   is shown nowhere and kept nowhere: every page is renamed page-1.jpg,
   page-2.jpg … as soon as it is read.

   Two parts:
   - The model (teacher/add-work-split-model.js, AddWorkSplitModel): the
     scan's pages, which are blank, which are kept, where the cuts are, and
     the names. No HTML and no DOM.
   - This file: reading the scan, and the screen, a page over whatever is
     showing, like the class page.

   AddWorkSplit.takes(files)              true for exactly one PDF.
   AddWorkSplit.open(cid, aid, file, opts) the page, reading `file`; true
       when it opened. opts.onPieces([{ sid, from, pages }]) on Match the
       Named Pieces; opts.onClose() once the page has closed.
   AddWorkSplit.close()                   closes at once (no asking).
   AddWorkSplit.isOpen() */
/** @type {any} */ (window).AddWorkSplit = (function () {
  'use strict';

  // The model and the name box's matching (teacher/add-work-split-model.js).
  var M = AddWorkSplitModel;
  var MAX_SCAN_PAGES = M.MAX_SCAN_PAGES;
  var model = M.model;
  var matches = M.matches;
  var fold = M.fold;
  var _first = M.first;
  var _full = M.full;
  var startPer = M.startPer;
  var isBlank = M.isBlank;
  var _maxPiece = M.maxPiece;
  /* B5's touches, each in a file of its own and used when it is there:
     Set Up Like Last Time (add-work-split-setup.js), a page moved onto
     another piece (add-work-split-move.js), Turn Every Page
     (add-work-split-turn.js), a page full size (add-work-page-view.js).
     B4's stickers name pieces (add-work-split-stickers.js). */
  function _t(name) {
    return /** @type {any} */ (window)[name] || null;
  }
  function _turningAll(s) {
    return !!(_t('AddWorkSplitTurn') && AddWorkSplitTurn.busy(s));
  }
  /* ── Reading the scan ───────────────────────────────────────── */

  var TOO_BIG =
    'This scan is too big to split here: 150 pages or 20 MB at most. Scan the pile in two halves and split each one.';

  function takes(files) {
    var list = files && typeof files.length === 'number' ? files : [];
    if (list.length !== 1 || !list[0]) return false;
    var f = list[0];
    var type = String(f.type || '').toLowerCase();
    return type === 'application/pdf' || type === 'application/x-pdf' || /\.pdf$/i.test(String(f.name || ''));
  }

  function refusal(res) {
    var R = (window.PhotoShrink && PhotoShrink.REASONS) || {};
    if (res && (res.reason === R.TOO_MANY_PAGES || res.reason === R.PDF_TOO_LARGE)) return TOO_BIG;
    return window.AddWorkFiles ? AddWorkFiles.refusal(res) : "That file couldn't be used. Try another photo.";
  }

  /* How much a page's picture changes, from its thumbnail: PhotoShrink's
     sharpness figure. A PDF's pages come from PhotoShrink without it. */
  function _measure(page) {
    if (!page || !page.thumb || typeof createImageBitmap !== 'function') return Promise.resolve(null);
    return createImageBitmap(page.thumb).then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      var v = /** @type {any} */ (PhotoShrink).sharpness(
        ctx.getImageData(0, 0, c.width, c.height).data,
        c.width,
        c.height,
      );
      c.width = 0;
      c.height = 0;
      return v;
    });
  }

  /* The scan read into pages, renamed page-1.jpg … as they arrive, and each
     measured for blankness. → Promise of { ok: true, pages: [{ page,
     sharpness, blank }] } or { ok: false, said }. opts: onProgress({ page,
     pages, step: 'read' | 'blank' }), alive() (false once the page has
     closed: the reading stops), and seams for tests: shrink (PhotoShrink.
     prepare), openPdf (PhotoReaders.openPdf), measure(page). */
  function read(file, opts) {
    opts = opts || {};
    var alive =
      opts.alive ||
      function () {
        return true;
      };
    var progress = opts.onProgress || function () {};
    var openPdf = opts.openPdf || (window.PhotoReaders && PhotoReaders.openPdf) || null;
    var shrink = opts.shrink || PhotoShrink.prepare;
    var measure = opts.measure || _measure;
    // A page closed mid-read stops asking pdf.js for pages.
    var guarded =
      typeof openPdf === 'function'
        ? function (blob, o) {
            return openPdf(blob, o).then(function (doc) {
              return {
                pages: doc.pages,
                page: function (n) {
                  return alive() ? doc.page(n) : Promise.reject(new Error('The page closed'));
                },
                close: function () {
                  if (doc.close) doc.close();
                },
              };
            });
          }
        : null;
    return Promise.resolve()
      .then(function () {
        return shrink(file, {
          openPdf: guarded,
          maxPages: MAX_SCAN_PAGES,
          onProgress: function (p) {
            progress({ page: p.page, pages: p.pages, step: 'read' });
          },
        });
      })
      .then(null, function () {
        return { ok: false, reason: 'failed' };
      })
      .then(function (res) {
        if (!res || !res.ok || !res.pages || !res.pages.length) return { ok: false, said: refusal(res) };
        var pages = res.pages.map(function (p, i) {
          p.name = 'page-' + (i + 1) + '.jpg';
          return p;
        });
        var out = [];
        return pages
          .reduce(function (chain, p, i) {
            return chain.then(function () {
              if (!alive()) return;
              progress({ page: i + 1, pages: pages.length, step: 'blank' });
              return Promise.resolve()
                .then(function () {
                  return measure(p);
                })
                .then(null, function () {
                  return null;
                })
                .then(function (v) {
                  out.push({ page: p, sharpness: v, blank: isBlank(v) });
                });
            });
          }, Promise.resolve())
          .then(function () {
            return { ok: true, pages: out };
          });
      });
  }

  /* ── The page's pictures ── */
  // The top of a page, where the name is written, as the board crops it: the
  // left 62% of the width, a band as tall as the card's window.
  var CROP_WIDTH = 640;
  var CROP_ASPECT = 1.8;

  function _url(blob) {
    if (!blob || typeof URL === 'undefined' || !URL.createObjectURL) return '';
    try {
      return URL.createObjectURL(blob);
    } catch (e) {
      return '';
    }
  }
  function _revoke(url) {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      /* nothing held */
    }
  }

  function _makeCrop(page) {
    if (!page || !page.blob || typeof createImageBitmap !== 'function') return Promise.resolve(null);
    var w = page.width;
    var h = page.height;
    var sx = Math.round(w * 0.025);
    var sw = Math.round(w * 0.625);
    var sh = Math.min(h, Math.round(sw / CROP_ASPECT));
    return createImageBitmap(page.blob, sx, 0, sw, sh, {
      resizeWidth: Math.min(CROP_WIDTH, sw),
      resizeQuality: 'high',
    }).then(function (bmp) {
      var c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      var ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return new Promise(function (resolve) {
        c.toBlob(
          function (b) {
            c.width = 0;
            c.height = 0;
            resolve(b);
          },
          'image/jpeg',
          0.8,
        );
      });
    });
  }

  /* A page turned a quarter turn clockwise, redrawn on a canvas and shrunk
     again through PhotoShrink, so it keeps every guarantee a page has. */
  function _turned(page) {
    return createImageBitmap(page.blob)
      .then(function (bmp) {
        var c = document.createElement('canvas');
        c.width = bmp.height;
        c.height = bmp.width;
        var ctx = c.getContext('2d');
        if (!ctx) throw new Error('No canvas');
        ctx.translate(c.width, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
        return new Promise(function (resolve, reject) {
          c.toBlob(
            function (b) {
              c.width = 0;
              c.height = 0;
              if (b) resolve(b);
              else reject(new Error('No JPEG'));
            },
            'image/jpeg',
            0.92,
          );
        });
      })
      .then(function (blob) {
        return PhotoShrink.prepare(blob);
      })
      .then(function (res) {
        if (!res || !res.ok || !res.pages || !res.pages[0]) throw new Error('Not shrunk');
        var p = res.pages[0];
        p.name = page.name;
        // A scan's page is never called blurry; turning changes nothing else.
        p.blurry = false;
        p.sharpness = page.sharpness;
        return p;
      });
  }

  /* ── The screen ─────────────────────────────────────────────── */
  var GLIDE_MS = 200;
  /** @type {any} */
  var _s = null; // the open page's state

  var BACK_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>';
  var LESS_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>';
  var MORE_ICON =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>';
  var TURN_ICON =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path></svg>';

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _student(s, sid) {
    return s.byId[sid] || null;
  }
  function _fullOf(s, sid) {
    var st = _student(s, sid);
    return st ? _full(st) : '';
  }
  // A first name, or the full name when two listed students share it.
  function _callOf(s, sid) {
    var st = _student(s, sid);
    if (!st) return '';
    var first = fold(_first(st));
    var shared = s.list.filter(function (o) {
      return fold(_first(o)) === first;
    }).length;
    return shared > 1 ? _full(st) : _first(st);
  }

  // "Avery is on pieces 5 and 9"
  function _twiceLine(s, sid, ats) {
    var nums = ats.map(function (at) {
      return String(at + 1);
    });
    var last = nums.pop();
    return _callOf(s, sid) + ' is on pieces ' + nums.join(', ') + ' and ' + last;
  }

  function _thumbOf(s, no) {
    var p = s.m.page(no);
    if (!p) return '';
    var held = s.thumbs[no];
    if (held && held.page === p.page) return held.url;
    if (held) _revoke(held.url);
    var url = _url(p.page.thumb);
    s.thumbs[no] = { page: p.page, url: url };
    return url;
  }

  // html-safe: every name and word goes through esc; numbers and ids are ours (esc too); icons are fixed
  function _pageHtml(s) {
    var split = s.phase === 'split';
    var course = (typeof COURSES !== 'undefined' && COURSES[s.cid]) || {};
    var sub = [
      split ? _plural(s.total, 'page', 'pages') : '',
      s.a.title || '',
      course.name || '',
      _plural(s.list.length, 'student', 'students'),
    ]
      .filter(Boolean)
      .join(' · ');
    var html =
      '<div class="aws-page" role="dialog" aria-modal="true" aria-labelledby="aws-title">' +
      '<div class="aws-bar">' +
      '<button type="button" class="aws-back" data-aws="leave" data-key="back" aria-label="Back to Add Work for the Class">' +
      BACK_ICON +
      '</button>' +
      '<div class="aws-titles"><h2 class="aws-title" id="aws-title">Split the Scan</h2>' +
      '<span class="aws-sub">' +
      esc(sub) +
      '</span></div>' +
      '<p class="aws-note" role="status">' +
      esc(s.headNote || '') +
      '</p>' +
      '<span class="aws-gap"></span>' +
      '<button type="button" class="aws-cancel" data-aws="leave" data-key="cancel">Cancel</button>';
    if (split)
      html +=
        '<button type="button" class="aws-primary" data-aws="match" data-key="match"' +
        (s.m.canMatch() && !_turningAll(s) ? '' : ' disabled') +
        '>Match the Named Pieces</button>';
    html += '</div>';
    if (s.phase === 'reading') html += _readingHtml(s);
    else if (s.phase === 'refused') html += _refusedHtml(s);
    else html += '<div class="aws-body">' + _sideHtml(s) + _gridHtml(s) + '</div>' + _footHtml();
    return html + '</div>';
  }

  function _readingWords(s) {
    if (s.step === 'blank') return 'Looking for Blank Pages…';
    return s.read ? 'Reading Page ' + s.read + ' of ' + s.total + '…' : 'Opening the Scan…';
  }

  // html-safe: words are fixed or numbers, through esc
  function _readingHtml(s) {
    return (
      '<div class="aws-wait">' +
      '<p class="aws-wait-line" role="status">' +
      esc(_readingWords(s)) +
      '</p>' +
      '<div class="aws-track" aria-hidden="true"><span class="aws-fill"></span></div>' +
      '<p class="aws-hint">The scan is read on this computer and is not uploaded whole.</p>' +
      '</div>'
    );
  }

  // html-safe: the refusal's words go through esc
  function _refusedHtml(s) {
    return (
      '<div class="aws-wait">' +
      '<p class="aws-refused" role="alert">' +
      esc(s.said) +
      '</p>' +
      '<button type="button" class="aws-primary" data-aws="close" data-key="close">Back</button>' +
      '</div>'
    );
  }

  // html-safe: counts and fixed words, through esc
  function _sideHtml(s) {
    var m = s.m;
    var c = m.counts();
    var per = m.per();
    var order = m.order();
    var on = m.leaveOut();
    var blankLine = !c.blank
      ? 'No blank pages found.'
      : on
        ? _plural(c.left, 'blank page', 'blank pages') +
          ' left out. Click one to keep it.' +
          (c.blank > c.left ? ' ' + (c.blank - c.left) + ' kept.' : '')
        : _plural(c.blank, 'page looks', 'pages look') + ' blank. All are kept.';
    var orderBtn = function (id, label) {
      var pressed = order === id;
      return (
        '<button type="button" class="aws-order-btn' +
        (pressed ? ' is-on' : '') +
        '" data-aws="order" data-order="' +
        id +
        '" data-key="order:' +
        id +
        '" aria-pressed="' +
        pressed +
        '">' +
        esc(label) +
        '</button>'
      );
    };
    var tally =
      '<div class="aws-tally">' +
      '<span><b>' +
      esc(String(c.named)) +
      '</b> named</span>' +
      '<span><b>' +
      esc(String(c.unnamed)) +
      '</b> to name</span>' +
      (c.twice
        ? '<span class="is-bad"><b>' +
          esc(String(c.twice)) +
          '</b> ' +
          (c.twice === 1 ? 'student' : 'students') +
          ' twice</span>'
        : '') +
      (c.left ? '<span class="is-quiet"><b>' + esc(String(c.left)) + '</b> blank, left out</span>' : '') +
      '<span class="aws-tally-hint">' +
      esc(
        c.twice
          ? 'Change one of the names on two pieces before matching.'
          : 'Named pieces go to their students on the class page. Pieces with no name stay here.',
      ) +
      '</span></div>';
    return (
      '<aside class="aws-side" aria-label="How to Split">' +
      (_t('AddWorkSplitSetup') ? AddWorkSplitSetup.html(s) : '') +
      '<section class="aws-sec">' +
      '<h3 class="aws-h" id="aws-per-label">Pages per Student</h3>' +
      '<div class="aws-stepper" role="group" aria-labelledby="aws-per-label">' +
      '<button type="button" class="aws-step" data-aws="per" data-d="-1" data-key="per:-" aria-label="One fewer page per student"' +
      (per <= 1 ? ' disabled' : '') +
      '>−</button>' +
      '<span class="aws-per">' +
      esc(String(per)) +
      '</span>' +
      '<button type="button" class="aws-step" data-aws="per" data-d="1" data-key="per:+" aria-label="One more page per student"' +
      (per >= _maxPiece() ? ' disabled' : '') +
      '>+</button>' +
      '</div>' +
      '<p class="aws-line" role="status">' +
      esc(m.line()) +
      '</p>' +
      '<p class="aws-hint">To change one piece, use the arrows on it. The pieces after it are cut again.</p>' +
      '</section>' +
      '<section class="aws-sec">' +
      '<button type="button" class="aws-switch" role="switch" data-aws="leaveOut" data-key="leaveOut" aria-checked="' +
      on +
      '"><span class="aws-switch-track" aria-hidden="true"><span class="aws-switch-knob"></span></span>' +
      '<span class="aws-switch-label">Leave Out Blank Pages</span></button>' +
      '<p class="aws-hint">' +
      esc(blankLine) +
      '</p>' +
      '</section>' +
      (_t('AddWorkSplitTurn') ? AddWorkSplitTurn.html(s) : '') +
      '<section class="aws-sec">' +
      '<h3 class="aws-h" id="aws-order-label">The Pile Is in</h3>' +
      '<div class="aws-order" role="group" aria-labelledby="aws-order-label">' +
      // Two classes (B6): one pile can't be in two lists' order.
      (s.noListOrder ? '' : orderBtn('list', 'Class List Order')) +
      orderBtn('typed', 'No Order: I’ll Type Names') +
      '</div>' +
      (s.noListOrder ? '<p class="aws-hint">With two classes, every name is typed.</p>' : '') +
      '<p class="aws-hint' +
      (order === 'list' && !m.listFits() ? ' is-bad' : '') +
      '">' +
      esc(_orderHint(m, c)) +
      '</p>' +
      (order === 'list' && m.listFits()
        ? '<p class="aws-hint">Check the first and last pieces against their pages.</p>'
        : '') +
      '</section>' +
      tally +
      (_t('AddWorkSplitStickers') ? AddWorkSplitStickers.html(s) : '') +
      '<p class="aws-privacy">FullVision does not read the handwriting. The scan is split on this computer and is not uploaded whole; each student’s pages upload on their own.</p>' +
      '</aside>'
    );
  }

  // The words under The Pile Is in.
  function _orderHint(m, c) {
    if (m.order() !== 'list')
      return 'Each piece shows the top of its first page. Type two or three letters and press Return; the next piece is ready.';
    if (!m.listFits())
      return (
        'Class List Order needs one piece for each student: ' +
        _plural(m.students(), 'student', 'students') +
        ', ' +
        _plural(c.pieces, 'piece', 'pieces') +
        '. Type the names instead.'
      );
    return 'Each piece gets the next student on the class list. Type a name on a piece to change it.';
  }

  // html-safe: names go through esc; numbers and urls are ours (esc too)
  function _gridHtml(s) {
    var ps = s.m.pieces();
    var twice = s.m.twice();
    var html = '<div class="aws-scroll"><div class="aws-grid" role="list" aria-label="Pieces">';
    if (!ps.length)
      html +=
        '<div class="aws-card is-loose" role="listitem"><p class="aws-hint">Every page is left out as blank. Keep a page, or turn off Leave Out Blank Pages.</p>' +
        '<div class="aws-strip">' +
        s.m
          .pages()
          .map(function (p) {
            return _tileHtml(s, p.no);
          })
          .join('') +
        '</div></div>';
    ps.forEach(function (p) {
      html += _cardHtml(s, p, twice);
    });
    return html + '</div></div>';
  }

  // html-safe: names go through esc; numbers and urls are ours (esc too); icons are fixed
  function _cardHtml(s, p, twice) {
    var n = p.at + 1;
    var crop = s.crops[p.first];
    var first = s.m.page(p.first);
    var sharp = crop && crop.page === first.page;
    var src = sharp ? crop.url : _thumbOf(s, p.first);
    var bad = p.sid && twice[p.sid];
    var note = '';
    if (bad) note = _twiceLine(s, p.sid, bad);
    else if (p.sid && s.subs[p.sid]) note = 'Already has work in';
    var name = p.sid ? _fullOf(s, p.sid) : '';
    var listed = p.sid && !p.typed && !p.bySticker;
    var size = p.nos.length;
    var last = p.at === s.m.pieces().length - 1;
    return (
      '<div class="aws-card' +
      (bad ? ' is-twice' : '') +
      (p.sid ? ' is-named' : '') +
      '" role="listitem" data-at="' +
      esc(String(p.at)) +
      '">' +
      '<div class="aws-crop">' +
      (src
        ? '<img class="aws-crop-img' +
          (sharp ? '' : ' is-thumb') +
          '" data-crop="' +
          esc(String(p.first)) +
          '" src="' +
          esc(src) +
          '" alt="' +
          esc('Top of page ' + p.first) +
          '">'
        : '') +
      '<span class="aws-range">' +
      esc('Piece ' + n + ' · ' + M.pagesText(p.spans)) +
      '</span></div>' +
      '<div class="aws-who">' +
      '<label class="aws-sr" for="aws-name-' +
      esc(String(p.at)) +
      '">' +
      esc('Who is on piece ' + n) +
      '</label>' +
      '<input id="aws-name-' +
      esc(String(p.at)) +
      '" class="aws-name' +
      (bad ? ' is-twice' : '') +
      (listed ? ' is-listed' : '') +
      '" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="aws-list-' +
      esc(String(p.at)) +
      '" autocomplete="off" spellcheck="false" placeholder="Type a name" value="' +
      esc(name) +
      '" data-at="' +
      esc(String(p.at)) +
      '" data-key="name:' +
      esc(String(p.first)) +
      '"' +
      (note ? ' aria-describedby="aws-note-' + esc(String(p.at)) + '"' : '') +
      '>' +
      '<div class="aws-list" id="aws-list-' +
      esc(String(p.at)) +
      '" role="listbox" aria-label="Students" hidden></div>' +
      '<p class="aws-card-note' +
      (bad ? ' is-bad' : '') +
      '" id="aws-note-' +
      esc(String(p.at)) +
      '">' +
      esc(note) +
      '</p>' +
      (_t('AddWorkSplitStickers') ? AddWorkSplitStickers.cardHtml(s, p, _ctx) : '') +
      '</div>' +
      (_t('AddWorkSplitMove') ? AddWorkSplitMove.dropHtml() : '') +
      '<div class="aws-strip" role="group" aria-label="' +
      esc('Pages of piece ' + n) +
      '">' +
      p.all
        .map(function (no) {
          return _tileHtml(s, no);
        })
        .join('') +
      '</div>' +
      (_t('AddWorkSplitMove') ? AddWorkSplitMove.menuHtml(s, p, _ctx) : '') +
      '<div class="aws-size">' +
      '<button type="button" class="aws-arrow" data-aws="fewer" data-at="' +
      esc(String(p.at)) +
      '" data-key="fewer:' +
      esc(String(p.first)) +
      '" tabindex="-1" aria-label="' +
      esc('Give piece ' + n + ' one page fewer') +
      '" title="One page fewer"' +
      (size < 2 ? ' disabled' : '') +
      '>' +
      LESS_ICON +
      '</button>' +
      '<span class="aws-count">' +
      esc(_plural(size, 'page', 'pages')) +
      '</span>' +
      '<button type="button" class="aws-arrow" data-aws="more" data-at="' +
      esc(String(p.at)) +
      '" data-key="more:' +
      esc(String(p.first)) +
      '" tabindex="-1" aria-label="' +
      esc('Give piece ' + n + ' one more page') +
      '" title="One more page"' +
      (last || size >= _maxPiece() ? ' disabled' : '') +
      '>' +
      MORE_ICON +
      '</button></div></div>'
    );
  }

  // html-safe: numbers and urls are ours (esc too); words are fixed; icons are fixed
  function _tileHtml(s, no) {
    var p = s.m.page(no);
    var url = _thumbOf(s, no);
    var img = url ? '<img src="' + esc(url) + '" alt="" draggable="false">' : '';
    var num = esc(String(no));
    if (s.m.out(p))
      return (
        '<button type="button" class="aws-tile is-out" data-aws="keep" data-no="' +
        num +
        '" data-key="keep:' +
        num +
        '" tabindex="-1" aria-label="' +
        esc('Page ' + no + ', blank, left out. Keep it.') +
        '" title="Keep this page">' +
        img +
        '<span class="aws-out-label">Blank · Left Out</span></button>'
      );
    var busy = !!s.turning[no];
    var move = _t('AddWorkSplitMove');
    var upside = _t('AddWorkSplitTurn') && AddWorkSplitTurn.marked(s, no);
    return (
      '<div class="aws-tile' +
      (p.blank ? ' is-kept' : '') +
      (upside ? ' is-upside' : '') +
      '" data-no="' +
      num +
      '"' +
      (move ? ' draggable="true"' : '') +
      '>' +
      img +
      '<span class="aws-tile-no" aria-hidden="true">' +
      num +
      '</span>' +
      '<button type="button" class="aws-turn" data-aws="turn" data-no="' +
      num +
      '" data-key="turn:' +
      num +
      '" tabindex="-1" aria-label="' +
      esc((busy ? 'Turning page ' : 'Turn page ') + no) +
      '" title="Turn a quarter turn"' +
      (busy ? ' aria-disabled="true"' : '') +
      '>' +
      TURN_ICON +
      '</button>' +
      (move ? AddWorkSplitMove.tileHtml(s, no) : '') +
      (upside ? '<span class="aws-upside">Upside down?</span>' : '') +
      (p.blank && s.m.leaveOut()
        ? '<button type="button" class="aws-leave" data-aws="leaveOne" data-no="' +
          num +
          '" data-key="keep:' +
          num +
          '" tabindex="-1" aria-label="' +
          esc('Leave out page ' + no + ', blank') +
          '">Leave Out</button>'
        : '') +
      '</div>'
    );
  }

  function _footHtml() {
    var key = function (k, what) {
      return '<span class="aws-key"><kbd>' + k + '</kbd>' + what + '</span>';
    };
    return (
      '<div class="aws-foot">' +
      '<span class="aws-foot-title">No Mouse Needed</span>' +
      key('Tab', 'Next piece') +
      key('li', 'Type a few letters') +
      key('Return', 'Name it, go to the next') +
      key('[</kbd><kbd>]', 'One page fewer or more') +
      (_t('AddWorkPageView') ? key('Space', 'See the page full size') : '') +
      key('↓', 'This piece’s pages') +
      '</div>'
    );
  }

  /* Draw the page again: scroll, focus (by data-key), a name being typed,
     and a glide for each page that moved to another piece. */
  function _draw(opts) {
    var s = _s;
    if (!s) return;
    opts = opts || {};
    if (s.m && _t('AddWorkSplitStickers')) AddWorkSplitStickers.sync(s, _ctx);
    // The pieces scroll; in a narrow window the whole body does.
    var tops = ['.aws-scroll', '.aws-body'].map(function (sel) {
      var el = s.overlay.querySelector(sel);
      return el ? el.scrollTop : 0;
    });
    var active = /** @type {any} */ (document.activeElement);
    var key = opts.focus || (active && s.overlay.contains(active) ? active.getAttribute('data-key') : null);
    var typing =
      !opts.focus && active && active.classList && active.classList.contains('aws-name') && s.combo
        ? { value: active.value, a: active.selectionStart, b: active.selectionEnd }
        : null;
    var before = {};
    if (opts.glide && !_reducedMotion())
      s.overlay.querySelectorAll('.aws-tile[data-no]').forEach(function (el) {
        before[el.getAttribute('data-no')] = el.getBoundingClientRect();
      });
    // html-safe: _pageHtml escapes every name and word; the rest is fixed markup
    s.overlay.innerHTML = _pageHtml(s);
    ['.aws-scroll', '.aws-body'].forEach(function (sel, i) {
      var el = s.overlay.querySelector(sel);
      if (el) el.scrollTop = tops[i];
    });
    _fill(s);
    if (key) {
      var el = /** @type {any} */ (s.overlay.querySelector('[data-key="' + key + '"]'));
      if (!el || el.disabled) el = opts.fallback ? s.overlay.querySelector(opts.fallback) : null;
      if (el && !el.disabled) {
        el.focus({ preventScroll: !opts.focus });
        if (typing && el.classList.contains('aws-name')) {
          el.value = typing.value;
          el.setSelectionRange(typing.a, typing.b);
          _drawCombo(s, el);
        }
      }
    }
    if (opts.glide) _glide(s, before);
    _crops(s);
  }

  function _fill(s) {
    var fill = /** @type {HTMLElement | null} */ (s.overlay.querySelector('.aws-fill'));
    if (!fill) return;
    var done = s.step === 'blank' ? 1 : s.total ? s.read / s.total : 0;
    fill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, done)) + ')';
  }

  function _reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  // FLIP: a page that moved to another piece starts where it was and glides.
  function _glide(s, before) {
    Object.keys(before).forEach(function (no) {
      var el = s.overlay.querySelector('.aws-tile[data-no="' + no + '"]');
      if (!el || !el.animate) return;
      var now = el.getBoundingClientRect();
      var dx = before[no].left - now.left;
      var dy = before[no].top - now.top;
      if ((!dx && !dy) || Math.abs(dy) > 900) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], {
        duration: GLIDE_MS,
        easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
      });
    });
  }

  /* The sharp tops of first pages, one at a time, in the pieces' order. */
  function _crops(s) {
    if (s.phase !== 'split' || s.cropping) return;
    /** @type {any} */
    var next = null;
    s.m.pieces().some(function (p) {
      var page = s.m.page(p.first).page;
      var held = s.crops[p.first];
      if (held && held.page === page) return false;
      if (s.cropFailed[p.first] === page) return false;
      next = { no: p.first, page: page };
      return true;
    });
    if (!next) return;
    var want = next;
    s.cropping = true;
    _makeCrop(want.page)
      .then(null, function () {
        return null;
      })
      .then(function (blob) {
        if (_s !== s) return;
        s.cropping = false;
        var p = s.m.page(want.no);
        if (!blob || !p || p.page !== want.page) {
          if (!blob) s.cropFailed[want.no] = want.page;
          return _crops(s);
        }
        var old = s.crops[want.no];
        if (old) _revoke(old.url);
        s.crops[want.no] = { page: want.page, url: _url(blob) };
        var img = s.overlay.querySelector('img[data-crop="' + want.no + '"]');
        if (img) {
          img.src = s.crops[want.no].url;
          img.classList.remove('is-thumb');
        }
        _crops(s);
      });
  }

  /* ── Names: the box on each piece ── */
  function _used(s, exceptAt) {
    var used = {};
    s.m.pieces().forEach(function (p) {
      if (p.sid && p.at !== exceptAt) used[p.sid] = p.at;
    });
    return used;
  }

  function _options(s, at, text) {
    var used = _used(s, at);
    return matches(s.list, text, used)
      .slice(0, 6)
      .map(function (st) {
        return { sid: st.id, on: used[st.id] };
      });
  }

  // html-safe: names go through esc; ids are ours (esc too)
  function _drawCombo(s, input) {
    var at = Number(input.getAttribute('data-at'));
    var listEl = s.overlay.querySelector('#aws-list-' + at);
    if (!listEl) return;
    var text = input.value;
    var p = s.m.pieces()[at];
    var shown = p && p.sid ? _fullOf(s, p.sid) : '';
    var opts = fold(text) && text !== shown ? _options(s, at, text) : [];
    if (!s.combo || s.combo.at !== at || s.combo.text !== text) s.combo = { at: at, text: text, active: 0 };
    s.combo.opts = opts;
    if (s.combo.active >= opts.length) s.combo.active = 0;
    if (!opts.length) {
      listEl.hidden = true;
      // html-safe: empty
      listEl.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      return;
    }
    // html-safe: names go through esc; ids are ours (esc too)
    listEl.innerHTML = opts
      .map(function (o, i) {
        var on = i === s.combo.active;
        return (
          '<div class="aws-option' +
          (on ? ' is-on' : '') +
          (o.on !== undefined ? ' is-used' : '') +
          '" role="option" id="aws-opt-' +
          esc(String(at)) +
          '-' +
          esc(String(i)) +
          '" aria-selected="' +
          on +
          '" data-aws="option" data-at="' +
          esc(String(at)) +
          '" data-sid="' +
          esc(o.sid) +
          '">' +
          esc(_fullOf(s, o.sid) + (s.label ? s.label(o.sid) : '')) +
          (o.on !== undefined ? '<span class="aws-option-on">' + esc('· on piece ' + (o.on + 1)) + '</span>' : '') +
          '</div>'
        );
      })
      .join('');
    listEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', 'aws-opt-' + at + '-' + s.combo.active);
  }

  // Whether another option has the same full name as option `i`.
  function _sameName(s, opts, i) {
    var name = fold(_fullOf(s, opts[i].sid));
    return opts.some(function (o, j) {
      return j !== i && fold(_fullOf(s, o.sid)) === name;
    });
  }

  function _closeCombo(s, input, revert) {
    s.combo = null;
    if (!input) return;
    var at = Number(input.getAttribute('data-at'));
    var listEl = s.overlay.querySelector('#aws-list-' + at);
    if (listEl) {
      listEl.hidden = true;
      // html-safe: empty
      listEl.innerHTML = '';
    }
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (revert) {
      var p = s.m.pieces()[at];
      input.value = p && p.sid ? _fullOf(s, p.sid) : '';
    }
  }

  function _nameInput(s, at) {
    return /** @type {any} */ (s.overlay.querySelector('#aws-name-' + at));
  }

  // The next piece after `at` with no name (from the top again), else Match.
  function _focusNextUnnamed(s, at) {
    var ps = s.m.pieces();
    var order = ps.slice(at + 1).concat(ps.slice(0, at + 1));
    var next = order.find(function (p) {
      return !p.sid;
    });
    var el = next ? _nameInput(s, next.at) : s.overlay.querySelector('.aws-primary:not(:disabled)');
    if (!el) el = _nameInput(s, at);
    if (el) {
      el.focus();
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }

  function _commit(s, at, sid, then) {
    s.m.name(at, sid);
    s.combo = null;
    s.headNote = '';
    _draw({ focus: '__none' });
    if (then === 'next') _focusNextUnnamed(s, at);
    else if (typeof then === 'number') {
      var el = _nameInput(s, then);
      if (el) el.focus();
    }
  }

  /* ── Actions ── */
  function _turn(no) {
    var s = _s;
    if (!s || s.phase !== 'split' || s.turning[no] || _turningAll(s)) return;
    var p = s.m.page(no);
    if (!p) return;
    var was = p.page;
    s.turning[no] = true;
    _draw();
    _turned(was)
      .then(null, function () {
        return null;
      })
      .then(function (page) {
        if (_s !== s) return;
        delete s.turning[no];
        var now = s.m.page(no);
        if (page && now && now.page === was) {
          s.m.setPage(no, page);
          var held = s.thumbs[no];
          if (held) _revoke(held.url);
          delete s.thumbs[no];
        } else if (!page) s.headNote = 'That page couldn’t be turned. Try again.';
        _draw();
      });
  }

  function _match() {
    var s = _s;
    if (!s || s.phase !== 'split' || !s.m.canMatch() || _turningAll(s)) return;
    // The choices used, for Set Up Like Last Time: no student data.
    if (_t('AddWorkSplitSetup')) AddWorkSplitSetup.save(s.cid, s.aid, s.m);
    var before = {};
    s.m.pages().forEach(function (p) {
      before[p.no] = true;
    });
    var pieces = s.m.take();
    if (!pieces.length) return;
    s.m.pages().forEach(function (p) {
      delete before[p.no];
    });
    // The pages that left: their pictures here are let go.
    Object.keys(before).forEach(function (no) {
      if (s.thumbs[no]) _revoke(s.thumbs[no].url);
      if (s.crops[no]) _revoke(s.crops[no].url);
      delete s.thumbs[no];
      delete s.crops[no];
    });
    var onPieces = s.onPieces;
    var left = s.m.counts().pieces;
    s.headNote =
      _plural(pieces.length, 'piece', 'pieces') +
      ' went to the class page.' +
      (left ? ' ' + _plural(left, 'piece has', 'pieces have') + ' no name yet.' : '');
    if (onPieces) {
      try {
        onPieces(pieces);
      } catch (e) {
        /* the class page's trouble is its own */
      }
    }
    if (_s !== s) return;
    if (!left) return close();
    _draw({ focus: '__none' });
    _focusNextUnnamed(s, -1);
  }

  /* ── Leaving ── */
  function _waitingLine(s) {
    if (s.phase === 'reading') return _plural(s.read, 'page has', 'pages have') + ' been read.';
    var n = s.m.counts().pieces;
    return n === 1 ? '1 piece is waiting.' : n + ' pieces are waiting.';
  }

  function _leave() {
    var s = _s;
    if (!s) return;
    var read = s.phase === 'split' ? s.m.counts().pages > 0 : s.phase === 'reading' && s.read > 0;
    if (!read || typeof showConfirm !== 'function') return close();
    showConfirm(
      'Leave without using this scan?',
      _waitingLine(s),
      'Leave',
      'danger',
      function () {
        if (_s === s) close();
      },
      'Keep Splitting',
    );
  }

  /* ── Events ── */
  function _click(e) {
    var s = _s;
    if (!s) return;
    var btn = e.target && e.target.closest ? e.target.closest('[data-aws]') : null;
    if (!btn || btn.disabled) return;
    var what = btn.getAttribute('data-aws');
    var at = Number(btn.getAttribute('data-at'));
    var no = Number(btn.getAttribute('data-no'));
    if (what === 'leave') return _leave();
    if (what === 'close') return close();
    if (s.phase !== 'split') return;
    var touched = ['AddWorkSplitMove', 'AddWorkSplitSetup', 'AddWorkSplitTurn', 'AddWorkSplitStickers'].some(
      function (name) {
        return _t(name) && _t(name).click(s, what, btn, _ctx);
      },
    );
    if (touched) return;
    if (what === 'match') return _match();
    if (what === 'option') return _commit(s, at, btn.getAttribute('data-sid'), 'next');
    if (what === 'per') {
      s.m.setPer(s.m.per() + Number(btn.getAttribute('data-d')));
      return _draw({ glide: true });
    }
    if (what === 'leaveOut') {
      s.m.setLeaveOut(!s.m.leaveOut());
      return _draw({ glide: true });
    }
    if (what === 'order') {
      if (s.noListOrder) return;
      s.m.setOrder(btn.getAttribute('data-order'));
      return _draw();
    }
    if (what === 'fewer' || what === 'more') {
      if (what === 'fewer') s.m.fewer(at);
      else s.m.more(at);
      return _draw({ glide: true, fallback: '#aws-name-' + at });
    }
    if (what === 'keep' || what === 'leaveOne') {
      s.m.keep(no, what === 'keep');
      return _draw({ glide: true });
    }
    if (what === 'turn') return _turn(no);
  }

  // A click on a name in the list keeps the box's focus.
  function _mouseDown(e) {
    var opt = e.target && e.target.closest ? e.target.closest('.aws-option') : null;
    if (opt) e.preventDefault();
  }

  function _input(e) {
    var s = _s;
    var input = e.target;
    if (!s || !input || !input.classList || !input.classList.contains('aws-name')) return;
    _drawCombo(s, input);
  }

  function _focusIn(e) {
    var s = _s;
    var input = e.target;
    if (!s || !input || !input.classList || !input.classList.contains('aws-name')) return;
    if (input.select) input.select();
  }

  function _focusOut(e) {
    var s = _s;
    var input = e.target;
    if (!s || !input || !input.classList || !input.classList.contains('aws-name')) return;
    if (!input.isConnected) return;
    // Letters typed and never taken: the box shows its name again.
    _closeCombo(s, input, true);
  }

  // The buttons of the piece holding `el`, in order.
  function _cardButtons(el) {
    var card = el.closest ? el.closest('.aws-card') : null;
    if (!card) return [];
    return Array.prototype.slice.call(card.querySelectorAll('button')).filter(function (b) {
      return !b.disabled;
    });
  }

  function _nameKey(s, e, input) {
    var at = Number(input.getAttribute('data-at'));
    var combo = s.combo && s.combo.at === at ? s.combo : null;
    var opts = (combo && combo.opts) || [];
    var key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      if (opts.length) {
        combo.active = (combo.active + (key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length;
        combo.picked = true;
        _drawCombo(s, input);
      } else if (key === 'ArrowDown') {
        var btns = _cardButtons(input);
        if (btns[0]) btns[0].focus();
      }
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      // Two students with this very name (one in each class, or twins): the
      // teacher picks one with the arrows; Return alone takes neither (rule 6).
      if (opts.length && !combo.picked && _sameName(s, opts, combo.active)) {
        var note = s.overlay.querySelector('.aws-note');
        if (note)
          note.textContent =
            'Two students are named ' + _fullOf(s, opts[combo.active].sid) + '. Choose one with the arrow keys.';
        return;
      }
      if (opts.length) return _commit(s, at, opts[combo.active].sid, 'next');
      var p = s.m.pieces()[at];
      var shown = p && p.sid ? _fullOf(s, p.sid) : '';
      if (!input.value.trim() && p && p.sid) return _commit(s, at, '', 'next');
      if (input.value === shown || !input.value.trim()) return _focusNextUnnamed(s, at);
      return;
    }
    if (key === 'Tab') {
      var to = at + (e.shiftKey ? -1 : 1);
      var target = _nameInput(s, to);
      // A unique start is taken on the way out.
      var typed = input.value;
      var p2 = s.m.pieces()[at];
      var shown2 = p2 && p2.sid ? _fullOf(s, p2.sid) : '';
      var all = fold(typed) && typed !== shown2 ? matches(s.list, typed, {}) : [];
      if (all.length === 1) {
        e.preventDefault();
        return _commit(s, at, all[0].id, target ? to : 'next');
      }
      if (!typed.trim() && p2 && p2.sid) {
        e.preventDefault();
        return _commit(s, at, '', target ? to : 'next');
      }
      if (target) {
        e.preventDefault();
        _closeCombo(s, input, true);
        target.focus();
        if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    // Space, while no name is being typed: the piece's pages full size.
    if (key === ' ' && _t('AddWorkSplitMove')) {
      var p3 = s.m.pieces()[at];
      if (p3 && (!input.value.trim() || input.value === (p3.sid ? _fullOf(s, p3.sid) : ''))) {
        e.preventDefault();
        _closeCombo(s, input, true);
        return AddWorkSplitMove.view(s, at, p3.first, _ctx);
      }
    }
    if (key === '[' || key === ']') {
      e.preventDefault();
      if (key === '[') s.m.fewer(at);
      else s.m.more(at);
      _closeCombo(s, input, true);
      return _draw({ glide: true, focus: input.getAttribute('data-key') });
    }
  }

  // Inside a piece: the arrows move among its buttons; up from the first is its name.
  function _cardKey(s, e, btn) {
    var key = e.key;
    var back = key === 'ArrowLeft' || key === 'ArrowUp';
    if (!back && key !== 'ArrowRight' && key !== 'ArrowDown') return;
    var btns = _cardButtons(btn);
    var i = btns.indexOf(btn);
    if (i < 0) return;
    e.preventDefault();
    var next = btns[i + (back ? -1 : 1)];
    if (next) return next.focus();
    if (back) {
      var card = btn.closest('.aws-card');
      var input = card && card.querySelector('.aws-name');
      if (input) input.focus();
    }
  }

  function _keyIn(e) {
    var s = _s;
    if (!s || e.defaultPrevented || s.phase !== 'split') return;
    var t = e.target;
    if (t && t.classList && t.classList.contains('aws-name')) return _nameKey(s, e, t);
    if (_t('AddWorkSplitMove') && AddWorkSplitMove.key(s, e)) return;
    if (t && t.closest && t.closest('.aws-card') && t.tagName === 'BUTTON') return _cardKey(s, e, t);
  }

  // Escape: the open list of names first, then the page (asking when read).
  // The class page underneath stands aside while this page is open.
  function _keydown(e) {
    var s = _s;
    if (!s || e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('.confirm-overlay')) return;
    e.preventDefault();
    e.stopPropagation();
    var active = /** @type {any} */ (document.activeElement);
    if (
      active &&
      active.classList &&
      active.classList.contains('aws-name') &&
      s.combo &&
      s.combo.opts &&
      s.combo.opts.length
    )
      return _closeCombo(s, active, false);
    if (_t('AddWorkSplitMove') && AddWorkSplitMove.escape(s, _ctx)) return;
    _leave();
  }

  // A file dropped here is not taken, and never opens in the browser.
  function _noDrop(e) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  }

  function _beforeUnload(e) {
    var s = _s;
    if (!s || !(s.phase === 'split' || (s.phase === 'reading' && s.read))) return;
    e.preventDefault();
    e.returnValue = '';
  }

  function _assessment(cid, aid) {
    return (
      ((typeof getAssessments === 'function' && getAssessments(cid)) || []).find(function (a) {
        return a && a.id === aid;
      }) || null
    );
  }

  function _students(cid, a) {
    var awc = /** @type {any} */ (window).AddWorkClass;
    if (awc && typeof awc.students === 'function') return awc.students(cid, a);
    return sortStudents(getStudents(cid) || [], 'lastName');
  }

  // What the touches' files may use of this page.
  var _ctx = {
    state: function () {
      return _s;
    },
    draw: function (o) {
      _draw(o);
    },
    busy: function () {
      return !_s || _turningAll(_s);
    },
    full: _fullOf,
    call: _callOf,
  };

  function open(cid, aid, file, opts) {
    var a = _assessment(cid, aid);
    if (!a || !takes([file]) || !window.PhotoShrink) return false;
    close(true);
    opts = opts || {};
    // opts.list (two classes, B6): both classes' students; opts.had(sid)
    // says who has work in their own class; opts.label(sid) their class.
    var list = (Array.isArray(opts.list) && opts.list) || _students(cid, a) || [];
    var byId = {};
    var subs = {};
    list.forEach(function (st) {
      byId[st.id] = st;
      var had =
        typeof opts.had === 'function'
          ? opts.had(st.id)
          : typeof getStudentSubmission === 'function' && getStudentSubmission(cid, st.id, aid);
      if (had) subs[st.id] = true;
    });
    var overlay = document.createElement('div');
    overlay.id = 'add-work-split-overlay';
    overlay.className = 'aws-overlay';
    document.body.appendChild(overlay);
    /** @type {any} */
    var s = {
      cid: cid,
      aid: aid,
      a: a,
      list: list,
      byId: byId,
      subs: subs,
      phase: 'reading',
      step: 'read',
      read: 0,
      total: 0,
      said: '',
      m: null,
      thumbs: {},
      crops: {},
      cropFailed: {},
      cropping: false,
      turning: {},
      combo: null,
      headNote: '',
      overlay: overlay,
      opener: document.activeElement,
      onPieces: typeof opts.onPieces === 'function' ? opts.onPieces : null,
      onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
      label: typeof opts.label === 'function' ? opts.label : null,
      noListOrder: !!opts.noListOrder,
      cids: Array.isArray(opts.cids) ? opts.cids : null, // two classes (B6): both, for their sticker codes
    };
    _s = s;
    overlay.addEventListener('click', _click);
    overlay.addEventListener('mousedown', _mouseDown);
    overlay.addEventListener('input', _input);
    overlay.addEventListener('focusin', _focusIn);
    overlay.addEventListener('focusout', _focusOut);
    overlay.addEventListener('keydown', _keyIn);
    // A page dragged onto another piece, before "nothing dropped here".
    if (_t('AddWorkSplitMove')) AddWorkSplitMove.listen(overlay, _ctx);
    overlay.addEventListener('dragover', _noDrop);
    overlay.addEventListener('drop', _noDrop);
    document.addEventListener('keydown', _keydown, true);
    if (window.addEventListener) window.addEventListener('beforeunload', _beforeUnload);
    _draw({ focus: 'cancel' });
    read(file, {
      alive: function () {
        return _s === s;
      },
      onProgress: function (p) {
        if (_s !== s) return;
        s.step = p.step;
        s.total = p.pages;
        if (p.step === 'read') s.read = p.page;
        var line = s.overlay.querySelector('.aws-wait-line');
        if (line) line.textContent = _readingWords(s);
        _fill(s);
      },
    }).then(function (res) {
      if (_s !== s) return;
      if (!res.ok) {
        s.phase = 'refused';
        s.said = res.said;
        return _draw({ focus: 'close' });
      }
      s.total = res.pages.length;
      var m = model(res.pages, list);
      m.setPer(startPer(m.counts().kept, list.length));
      s.m = m;
      s.phase = 'split';
      var fresh = { per: m.per(), order: m.order(), leaveOut: m.leaveOut() };
      if (_t('AddWorkSplitSetup')) AddWorkSplitSetup.apply(s, fresh);
      if (_t('AddWorkSplitTurn')) AddWorkSplitTurn.find(s, _ctx);
      if (_t('AddWorkSplitStickers')) AddWorkSplitStickers.start(s, _ctx);
      _draw({ focus: '__none' });
      var first = _nameInput(s, 0);
      if (first) first.focus();
      else {
        var cancel = /** @type {HTMLElement | null} */ (s.overlay.querySelector('.aws-cancel'));
        if (cancel) cancel.focus();
      }
    });
    return true;
  }

  function close(quiet) {
    var s = _s;
    if (!s) return;
    _s = null;
    document.removeEventListener('keydown', _keydown, true);
    if (window.removeEventListener) window.removeEventListener('beforeunload', _beforeUnload);
    if (_t('AddWorkPageView')) AddWorkPageView.close();
    if (_t('AddWorkSplitMove')) AddWorkSplitMove.unlisten();
    // The scan and its pages are let go.
    Object.keys(s.thumbs).forEach(function (no) {
      _revoke(s.thumbs[no].url);
    });
    Object.keys(s.crops).forEach(function (no) {
      _revoke(s.crops[no].url);
    });
    s.thumbs = {};
    s.crops = {};
    s.m = null;
    s.overlay.remove();
    if (quiet) return;
    if (s.opener && s.opener.isConnected && typeof s.opener.focus === 'function') s.opener.focus();
    if (s.onClose) s.onClose();
  }

  return {
    takes: takes,
    open: open,
    close: function () {
      close();
    },
    isOpen: function () {
      return !!_s;
    },
    // Reading the scan, with seams for tests.
    read: read,
    refusal: refusal,
  };
})();
