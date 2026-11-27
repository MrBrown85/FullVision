// @ts-check
/* split-scan.js — Split a Scan on the phone (Add Work for the Class, B7).

   The photocopier emails one PDF of the whole pile. On the phone the teacher
   saves it from Mail to the phone, then chooses it here (Choose a File,
   opened from the Grade tab's row menu). This screen does what the
   desktop's Split the Scan and Add Work for the Class do, sized for a
   phone: the class and the assessment, Pages per Student, each piece with
   the top of its first page and a name box, blank pages left out and shown
   dimmed, Turn on a page, then Check the N Pieces and Add Work for N
   Students (docs/plans/add-work-for-class-plan.md, B2 and B7).

   The logic is the desktop's own (see teacher-mobile/split-scan-model.js
   for which module does what). This file is the screen.

   The plan's rules, here:
   - Nothing is saved until Add Work. The scan and its pages are held in
     this page's memory only, and let go when the screen closes.
   - File names never leave the phone: every page is renamed page-N.jpg as
     it is read (AddWorkSplit.read) and again when staged (AddWorkStage).
     The scan's own name is shown nowhere.
   - The whole scan is never uploaded: only each student's own pages, one
     student, one write (addStudentWorkPages, replaceStudentWorkPages).
   - A name is taken only when certain: Return takes a student only when the
     letters fit exactly one; otherwise the students who fit are buttons.
     Return in an empty box takes no one.
   - Add Work is not possible while pages are being read or turned.
   Upload trouble after a write is answered shows only on the sync dot.

   MSplitScan.configure({ onClass, onClose, nameFirst, read })
     onClass(cid)   the class was switched here (the shell redraws).
     onClose()      the screen closed.
     nameFirst(m, list)  the one place a later slice names pieces before
                    the teacher sees them (name labels, B4): called once
                    after the scan is read and cut; nothing uses it yet.
     read           tests' own AddWorkSplit.read.
   MSplitScan.open(cid, aid)        → true when it opened.
   MSplitScan.choose(file)          a file chosen on the screen.
   MSplitScan.close() / isOpen() */

/** @type {any} */ (window).MSplitScan = (function () {
  'use strict';

  var MC = window.MComponents;
  var esc = MC.esc;
  var GLIDE_MS = 200;
  var CROP_WIDTH = 640;
  var CROP_ASPECT = 1.8;
  var TOO_BIG =
    'This scan is too big to split here: 150 pages or 20 MB at most. Scan the pile in two halves and split each one.';

  /** @type {any} */
  var _cfg = { onClass: null, onClose: null, nameFirst: null, read: null };
  /** @type {any} */
  var _s = null; // the open screen's state

  var TURN_ICON =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"></path><path d="M21 4v5h-5"></path></svg>';

  function configure(opts) {
    opts = opts || {};
    ['onClass', 'onClose', 'nameFirst', 'read'].forEach(function (k) {
      if (k in opts) _cfg[k] = typeof opts[k] === 'function' ? opts[k] : null;
    });
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _pagesWord(a, b) {
    return a === b ? 'Page ' + a : 'Pages ' + a + '–' + b;
  }

  function _url(blob) {
    try {
      return blob ? URL.createObjectURL(blob) : '';
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

  function _assessment(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (a) {
        return a && a.id === aid;
      }) || null
    );
  }

  function _day(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  /* ── Opening ────────────────────────────────────────────────── */

  // Whether the class has an assessment to split a scan into.
  function offeredIn(cid) {
    return MSplitScanModel.assessments(cid).length > 0;
  }

  function open(cid, aid) {
    close(true);
    var root = document.createElement('div');
    root.id = 'm-splitscan';
    root.className = 'm-ss';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'm-ss-title');
    document.body.appendChild(root);
    _s = {
      cid: cid,
      aid: aid || '',
      phase: 'pick',
      file: null,
      said: '',
      read: 0,
      total: 0,
      step: 'read',
      m: null,
      list: [],
      byId: {},
      thumbs: {},
      crops: {},
      turning: {},
      choices: {},
      stage: null,
      firsts: {},
      run: null,
      added: 0,
      note: '',
      asking: false,
      root: root,
    };
    _pickAssessment(_s);
    root.addEventListener('click', _onClick);
    root.addEventListener('pointerdown', _onPointerDown);
    root.addEventListener('change', _onChange);
    root.addEventListener('input', _onInput);
    root.addEventListener('keydown', _onKeyIn);
    root.addEventListener('focusout', _onFocusOut);
    document.addEventListener('keydown', _onKey);
    window.addEventListener('beforeunload', _beforeUnload);
    _draw();
    var first = /** @type {any} */ (root).querySelector('.m-ss-cancel');
    if (first) first.focus();
    return true;
  }

  // The assessment asked for, when it is offered; else the one with the most Not In.
  function _pickAssessment(s) {
    var offered = MSplitScanModel.assessments(s.cid);
    var asked = offered.some(function (r) {
      return r.a.id === s.aid;
    });
    if (!asked) s.aid = offered.length ? offered[0].a.id : '';
  }

  function _letGoPictures(s, nos) {
    (nos || Object.keys(s.thumbs).concat(Object.keys(s.crops))).forEach(function (no) {
      if (s.thumbs[no]) _revoke(s.thumbs[no].url);
      if (s.crops[no]) _revoke(s.crops[no].url);
      delete s.thumbs[no];
      delete s.crops[no];
    });
  }

  function close(quiet) {
    var s = _s;
    if (!s) return;
    _s = null;
    _letGoPictures(s);
    s.m = null;
    s.file = null;
    s.stage = null;
    document.removeEventListener('keydown', _onKey);
    window.removeEventListener('beforeunload', _beforeUnload);
    s.root.remove();
    if (!quiet && _cfg.onClose) _cfg.onClose();
  }

  function isOpen() {
    return !!_s;
  }

  /* ── Reading the scan ───────────────────────────────────────── */

  function choose(file) {
    var s = _s;
    // While another class loads, the class on screen is not the one asked for.
    if (!s || s.phase !== 'pick' || !file || s.switching) return false;
    if (!AddWorkSplit.takes([file])) {
      s.said = 'Only a PDF can be split. Choose the scan’s PDF.';
      _draw();
      return false;
    }
    s.file = file;
    s.said = '';
    return _start(s);
  }

  function _start(s) {
    if (s.switching) return false;
    var a = _assessment(s.cid, s.aid);
    if (!a || !s.file) return false;
    var list = AddWorkClass.students(s.cid, a) || [];
    s.list = list;
    s.byId = {};
    list.forEach(function (st) {
      s.byId[st.id] = st;
    });
    s.phase = 'reading';
    s.read = 0;
    s.total = 0;
    s.step = 'read';
    _draw();
    var file = s.file;
    var read = _cfg.read || AddWorkSplit.read;
    read(file, {
      alive: function () {
        return _s === s;
      },
      onProgress: function (p) {
        if (_s !== s) return;
        s.step = p.step;
        s.total = p.pages;
        if (p.step === 'read') s.read = p.page;
        var line = /** @type {any} */ (s.root).querySelector('.m-ss-wait-line');
        if (line) line.textContent = _readingWords(s);
        var fill = /** @type {any} */ (s.root).querySelector('.m-ss-fill');
        if (fill) fill.style.transform = 'scaleX(' + (s.total ? (s.step === 'blank' ? 1 : s.read / s.total) : 0) + ')';
      },
    }).then(function (res) {
      if (_s !== s) return;
      // The scan itself is let go: only its pages are kept, in memory.
      s.file = null;
      if (!res || !res.ok) {
        s.phase = 'pick';
        s.said = (res && res.said) || "That file couldn't be used. Try another.";
        return _draw();
      }
      var m = AddWorkSplitModel.model(res.pages, s.list);
      m.setPer(AddWorkSplitModel.startPer(m.counts().kept, s.list.length));
      // The one place names can be given before the teacher sees the
      // pieces (a later slice: name labels). Nothing is named here yet.
      if (_cfg.nameFirst) {
        try {
          _cfg.nameFirst(m, s.list);
        } catch (e) {
          /* the pieces stay unnamed */
        }
      }
      s.m = m;
      s.phase = 'split';
      _draw();
      _crops(s);
      var input = _nameInput(s, 0);
      if (input) input.focus({ preventScroll: true });
    });
    return true;
  }

  function _readingWords(s) {
    if (s.step === 'blank') return 'Looking for Blank Pages…';
    return s.read ? 'Reading Page ' + s.read + ' of ' + s.total + '…' : 'Opening the Scan…';
  }

  /* ── Pictures: thumbnails, the top of each piece, a turned page ── */

  function _thumbOf(s, no) {
    var p = s.m && s.m.page(no);
    if (!p) return '';
    var held = s.thumbs[no];
    if (held && held.page === p.page) return held.url;
    if (held) _revoke(held.url);
    var url = _url(p.page.thumb);
    s.thumbs[no] = { page: p.page, url: url };
    return url;
  }

  /* The top left of a page, where a name is written, as the desktop crops
     it (teacher/add-work-split.js keeps its own copy private). */
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

  // Each piece's first page, one at a time; a card drawn meanwhile shows the thumbnail.
  function _crops(s) {
    if (_s !== s || s.cropping || !s.m) return;
    var want = s.m.pieces().find(function (p) {
      var c = s.crops[p.first];
      return !(c && (c.page === s.m.page(p.first).page || c.failed === s.m.page(p.first).page));
    });
    if (!want) return;
    var no = want.first;
    var page = s.m.page(no).page;
    s.cropping = true;
    _makeCrop(page)
      .then(null, function () {
        return null;
      })
      .then(function (blob) {
        s.cropping = false;
        if (_s !== s || !s.m) return;
        var now = s.m.page(no);
        if (!now || now.page !== page) return _crops(s);
        if (s.crops[no]) _revoke(s.crops[no].url);
        s.crops[no] = blob ? { page: page, url: _url(blob) } : { page: null, failed: page, url: '' };
        var img = /** @type {any} */ (s.root).querySelector('img[data-crop="' + no + '"]');
        if (img && blob) {
          img.setAttribute('src', s.crops[no].url);
          img.classList.remove('is-thumb');
        }
        _crops(s);
      });
  }

  /* A page turned a quarter turn clockwise, redrawn and shrunk again
     through PhotoShrink, as the desktop's Turn does. */
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
        p.blurry = false;
        p.sharpness = page.sharpness;
        return p;
      });
  }

  function _turn(no) {
    var s = _s;
    if (!s || s.phase !== 'split' || s.turning[no]) return;
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
        if (_s !== s || !s.m) return;
        delete s.turning[no];
        var now = s.m.page(no);
        if (page && now && now.page === was) {
          s.m.setPage(no, page);
          _letGoPictures(s, [String(no)]);
        } else if (!page) s.note = 'That page couldn’t be turned. Try again.';
        _draw();
        _crops(s);
      });
  }

  /* ── Drawing ────────────────────────────────────────────────── */

  // html-safe: every word goes through esc; icons are fixed
  function _topHtml(s) {
    var back =
      s.phase === 'check' && !s.run
        ? '<button type="button" class="m-ss-cancel" data-ss="toSplit">Back</button>'
        : '<button type="button" class="m-ss-cancel" data-ss="cancel">' +
          (s.phase === 'done' ? 'Done' : 'Cancel') +
          '</button>';
    var title = s.phase === 'check' || s.phase === 'done' ? 'Add Work' : 'Split the Scan';
    return (
      '<div class="m-ss-top">' +
      back +
      '<h1 class="m-ss-title" id="m-ss-title">' +
      esc(title) +
      '</h1><span class="m-ss-top-end" aria-hidden="true"></span></div>'
    );
  }

  function _draw() {
    var s = _s;
    if (!s) return;
    var body = '';
    if (s.phase === 'pick') body = _pickHtml(s);
    else if (s.phase === 'reading') body = _readingHtml(s);
    else if (s.phase === 'split') body = _splitHtml(s);
    else body = _checkHtml(s);
    var scroller = /** @type {any} */ (s.root).querySelector('.m-ss-body');
    var keep = scroller ? scroller.scrollTop : 0;
    // html-safe: every part escapes its own text
    s.root.innerHTML = _topHtml(s) + body + (s.asking ? _askHtml(s) : '');
    var again = /** @type {any} */ (s.root).querySelector('.m-ss-body');
    if (again && s.drawnPhase === s.phase) again.scrollTop = keep;
    s.drawnPhase = s.phase;
  }

  // html-safe: class and assessment names go through esc
  function _pickHtml(s) {
    var classes = typeof getPickerCourses === 'function' ? getPickerCourses(s.cid) : [];
    var offered = MSplitScanModel.assessments(s.cid);
    var html = '<div class="m-ss-body">';
    if (s.said) html += '<p class="m-ss-said" role="alert">' + esc(s.said) + '</p>';
    if (classes.length > 1) {
      html +=
        '<h2 class="m-ss-h" id="m-ss-class-h">Class</h2><div class="m-ss-options" role="group" aria-labelledby="m-ss-class-h">' +
        classes
          .map(function (c) {
            var on = c.id === s.cid;
            return (
              '<button type="button" class="m-ss-option' +
              (on ? ' is-on' : '') +
              '" data-ss="class" data-cid="' +
              esc(c.id) +
              '" aria-pressed="' +
              on +
              '"><span class="m-ss-option-name">' +
              esc(c.name) +
              '</span></button>'
            );
          })
          .join('') +
        '</div>';
    }
    html += '<h2 class="m-ss-h" id="m-ss-piece-h">Assessment</h2>';
    if (!offered.length) {
      html += '<p class="m-ss-hint">No assessment in this class takes work yet.</p>';
    } else {
      html +=
        '<div class="m-ss-options" role="group" aria-labelledby="m-ss-piece-h">' +
        offered
          .map(function (r) {
            var on = r.a.id === s.aid;
            var sub = [r.notIn + ' Not In', _day(r.a.date) ? 'Due ' + _day(r.a.date) : ''].filter(Boolean).join(' · ');
            return (
              '<button type="button" class="m-ss-option' +
              (on ? ' is-on' : '') +
              '" data-ss="piece" data-aid="' +
              esc(r.a.id) +
              '" aria-pressed="' +
              on +
              '"><span class="m-ss-option-name">' +
              esc(r.a.title || 'Untitled') +
              '</span><span class="m-ss-option-sub">' +
              esc(sub) +
              '</span></button>'
            );
          })
          .join('') +
        '</div>';
    }
    html += '<p class="m-ss-privacy">The scan is split on this phone. Only each student’s own pages upload.</p></div>';
    var can = !!s.aid && offered.length > 0 && !s.switching;
    var foot = '<div class="m-ss-foot">';
    foot +=
      '<label class="m-ss-primary m-ss-choose' +
      (can ? '' : ' is-off') +
      '">Choose a File<input type="file" class="m-ss-input" accept="application/pdf,.pdf"' +
      (can ? '' : ' disabled') +
      '></label>' +
      '';
    return html + foot + '</div>';
  }

  // html-safe: fixed words and numbers through esc
  function _readingHtml(s) {
    var at = s.total ? (s.step === 'blank' ? 1 : s.read / s.total) : 0;
    return (
      '<div class="m-ss-body m-ss-wait">' +
      '<p class="m-ss-wait-line" role="status">' +
      esc(_readingWords(s)) +
      '</p><div class="m-ss-track" aria-hidden="true"><span class="m-ss-fill" style="transform:scaleX(' +
      esc(String(at)) +
      ')"></span></div>' +
      '<p class="m-ss-hint">The scan is read on this phone and is not uploaded whole.</p></div>'
    );
  }

  function _busy(s) {
    return Object.keys(s.turning).length > 0;
  }

  function _full(st) {
    return st ? AddWorkSplitModel.full(st) : '';
  }

  // "Avery is on pieces 5 and 9"
  function _twiceLine(s, sid, ats) {
    var nums = ats.map(function (at) {
      return String(at + 1);
    });
    var last = nums.pop();
    var st = s.byId[sid];
    return AddWorkSplitModel.first(st) + ' is on pieces ' + nums.join(', ') + ' and ' + last;
  }

  // html-safe: names and words go through esc; numbers and urls are ours (esc too)
  function _splitHtml(s) {
    var m = s.m;
    var c = m.counts();
    var per = m.per();
    var on = m.leaveOut();
    var twice = m.twice();
    var blankLine = !c.blank
      ? ''
      : on
        ? _plural(c.left, 'blank page', 'blank pages') +
          ' left out' +
          (c.blank > c.left ? ', ' + (c.blank - c.left) + ' kept' : '')
        : _plural(c.blank, 'page looks', 'pages look') + ' blank, all kept';
    var html =
      '<div class="m-ss-body">' +
      (s.note ? '<p class="m-ss-said" role="status">' + esc(s.note) + '</p>' : '') +
      '<div class="m-ss-set">' +
      '<span class="m-ss-set-label" id="m-ss-per-h">Pages per Student</span>' +
      '<div class="m-ss-stepper" role="group" aria-labelledby="m-ss-per-h">' +
      '<button type="button" class="m-ss-step" data-ss="per" data-d="-1" aria-label="One fewer page per student"' +
      (per <= 1 ? ' disabled' : '') +
      '>−</button><span class="m-ss-per">' +
      esc(String(per)) +
      '</span><button type="button" class="m-ss-step" data-ss="per" data-d="1" aria-label="One more page per student"' +
      (per >= AddWorkSplitModel.maxPiece() ? ' disabled' : '') +
      '>+</button></div></div>' +
      '<button type="button" class="m-ss-switch" role="switch" data-ss="leaveOut" aria-checked="' +
      on +
      '"><span class="m-ss-switch-label">Leave Out Blank Pages</span><span class="m-ss-switch-track" aria-hidden="true"><span class="m-ss-switch-knob"></span></span></button>' +
      (blankLine ? '<p class="m-ss-tally">' + esc(blankLine) + '</p>' : '') +
      '<p class="m-ss-tally"><b>' +
      esc(String(c.named)) +
      '</b> named · <b>' +
      esc(String(c.unnamed)) +
      '</b> to name' +
      (c.twice ? ' · <b class="is-bad">' + esc(_plural(c.twice, 'student', 'students')) + ' twice</b>' : '') +
      '</p>' +
      '<div class="m-ss-pieces" role="list" aria-label="Pieces">';
    var ps = m.pieces();
    if (!ps.length)
      html +=
        '<div class="m-ss-card" role="listitem"><p class="m-ss-hint">Every page is left out as blank. Keep a page, or turn off Leave Out Blank Pages.</p><div class="m-ss-strip">' +
        m
          .pages()
          .map(function (p) {
            return _tileHtml(s, p.no);
          })
          .join('') +
        '</div></div>';
    ps.forEach(function (p) {
      html += _cardHtml(s, p, twice, ps.length);
    });
    html += '</div></div>';
    var n = c.named;
    var can = m.canMatch() && !_busy(s);
    return (
      html +
      '<div class="m-ss-foot">' +
      (c.twice ? '<p class="m-ss-hint is-bad">Change one of the names on two pieces first.</p>' : '') +
      '<button type="button" class="m-ss-primary" data-ss="check"' +
      (can ? '' : ' disabled') +
      '>' +
      esc(n === 1 ? 'Check the 1 Piece' : 'Check the ' + n + ' Pieces') +
      '</button></div>'
    );
  }

  // html-safe: names go through esc; numbers and urls are ours (esc too)
  function _cardHtml(s, p, twice, count) {
    var n = p.at + 1;
    var crop = s.crops[p.first];
    var first = s.m.page(p.first);
    var sharp = crop && crop.url && crop.page === first.page;
    var src = sharp ? crop.url : _thumbOf(s, p.first);
    var bad = p.sid && twice[p.sid];
    var note = '';
    if (bad) note = _twiceLine(s, p.sid, bad);
    else if (p.sid && getStudentSubmission(s.cid, p.sid, s.aid)) note = 'Already has work in';
    var size = p.nos.length;
    var at = esc(String(p.at));
    return (
      '<div class="m-ss-card' +
      (bad ? ' is-twice' : '') +
      (p.sid ? ' is-named' : '') +
      '" role="listitem" data-at="' +
      at +
      '" data-first="' +
      esc(String(p.first)) +
      '">' +
      '<div class="m-ss-crop">' +
      (src
        ? '<img class="m-ss-crop-img' +
          (sharp ? '' : ' is-thumb') +
          '" data-crop="' +
          esc(String(p.first)) +
          '" src="' +
          esc(src) +
          '" alt="' +
          esc('Top of page ' + p.first) +
          '">'
        : '') +
      '<span class="m-ss-range">' +
      esc('Piece ' + n + ' · ' + _pagesWord(p.first, p.last)) +
      '</span></div>' +
      '<label class="m-ss-sr" for="m-ss-name-' +
      at +
      '">' +
      esc('Who is on piece ' + n) +
      '</label>' +
      '<input id="m-ss-name-' +
      at +
      '" class="m-ss-name' +
      (bad ? ' is-twice' : '') +
      '" type="text" enterkeyhint="next" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Type a name" value="' +
      esc(p.sid ? _full(s.byId[p.sid]) : '') +
      '" data-at="' +
      at +
      '" aria-describedby="m-ss-note-' +
      at +
      '">' +
      '<div class="m-ss-fits" id="m-ss-fits-' +
      at +
      '" role="group" aria-label="Students who fit" hidden></div>' +
      '<p class="m-ss-card-note' +
      (bad ? ' is-bad' : '') +
      '" id="m-ss-note-' +
      at +
      '">' +
      esc(note) +
      '</p>' +
      '<div class="m-ss-strip" role="group" aria-label="' +
      esc('Pages of piece ' + n) +
      '">' +
      p.all
        .map(function (no) {
          return _tileHtml(s, no);
        })
        .join('') +
      '</div>' +
      '<div class="m-ss-size">' +
      '<button type="button" class="m-ss-small" data-ss="fewer" data-at="' +
      at +
      '"' +
      (size < 2 ? ' disabled' : '') +
      '>One Page Fewer</button><span class="m-ss-count">' +
      esc(_plural(size, 'page', 'pages')) +
      '</span><button type="button" class="m-ss-small" data-ss="more" data-at="' +
      at +
      '"' +
      (p.at === count - 1 || size >= AddWorkSplitModel.maxPiece() ? ' disabled' : '') +
      '>One Page More</button></div></div>'
    );
  }

  // html-safe: numbers and urls are ours (esc too); words are fixed
  function _tileHtml(s, no) {
    var p = s.m.page(no);
    var url = _thumbOf(s, no);
    var img = url ? '<img src="' + esc(url) + '" alt="">' : '';
    var num = esc(String(no));
    if (s.m.out(p))
      return (
        '<button type="button" class="m-ss-tile is-out" data-ss="keep" data-no="' +
        num +
        '" aria-label="' +
        esc('Page ' + no + ', blank, left out. Keep it.') +
        '">' +
        img +
        '<span class="m-ss-out-label">Blank · Left Out</span></button>'
      );
    var busy = !!s.turning[no];
    return (
      '<div class="m-ss-tile' +
      (p.blank ? ' is-kept' : '') +
      '" data-no="' +
      num +
      '">' +
      img +
      '<span class="m-ss-tile-no" aria-hidden="true">' +
      num +
      '</span><button type="button" class="m-ss-turn" data-ss="turn" data-no="' +
      num +
      '" aria-label="' +
      esc((busy ? 'Turning page ' : 'Turn page ') + no) +
      '"' +
      (busy ? ' aria-disabled="true"' : '') +
      '>' +
      TURN_ICON +
      '</button>' +
      (p.blank && s.m.leaveOut()
        ? '<button type="button" class="m-ss-leave" data-ss="leaveOne" data-no="' +
          num +
          '" aria-label="' +
          esc('Leave out page ' + no + ', blank') +
          '">Leave Out</button>'
        : '') +
      '</div>'
    );
  }

  function _alreadyText(sub) {
    if (!sub) return 'Nothing in';
    if (sub.on_paper) return 'Handed in on paper';
    var n = (sub.files || []).length;
    var what = n ? _plural(n, 'photo', 'photos') + ' in' : 'Handed in';
    var day = _day(sub.sent_at || sub.created_at);
    return what + (day ? ', ' + day : '');
  }

  var CHOICE_WORDS = { add: 'Add as More Pages', replace: 'Replace Them', skip: 'Skip' };

  // html-safe: names and words go through esc; urls are ours (esc too)
  function _checkHtml(s) {
    var stage = s.stage;
    var rows = stage
      ? stage.rows().filter(function (r) {
          return r.pieces.length;
        })
      : [];
    var html = '<div class="m-ss-body">';
    if (s.note) html += '<p class="m-ss-said" role="status">' + esc(s.note) + '</p>';
    if (s.run && s.run.said) html += '<p class="m-ss-said" role="alert">' + esc(s.run.said) + '</p>';
    if (s.added)
      html +=
        '<p class="m-ss-done" role="status">' +
        esc('Work added for ' + _plural(s.added, 'student', 'students') + '.') +
        '</p>';
    var left = s.m ? s.m.counts().unnamed : 0;
    if (rows.length) {
      html += '<div class="m-ss-rows" role="list" aria-label="Students">';
      rows.forEach(function (r) {
        var st = s.byId[r.sid];
        var sub = getStudentSubmission(s.cid, r.sid, s.aid);
        var pages = r.pieces.reduce(function (k, pc) {
          return k + pc.pages.length;
        }, 0);
        var from = r.pieces
          .map(function (pc) {
            return pc.from.replace(/^Scan, /, '');
          })
          .join(', ');
        var firstNo = s.firsts[r.pieces[0].id];
        var crop = firstNo && s.crops[firstNo];
        var src = crop && crop.url ? crop.url : firstNo ? _thumbOf(s, firstNo) : '';
        var choices = stage.choices(r.sid);
        html +=
          '<div class="m-ss-row" role="listitem" data-sid="' +
          esc(r.sid) +
          '">' +
          (src ? '<img class="m-ss-row-img" src="' + esc(src) + '" alt="">' : '') +
          '<div class="m-ss-row-text"><span class="m-ss-row-name">' +
          esc(_full(st)) +
          '</span><span class="m-ss-row-sub">' +
          esc(_plural(pages, 'page', 'pages') + ' · ' + from) +
          '</span><span class="m-ss-row-sub">' +
          esc(_alreadyText(sub)) +
          '</span></div>' +
          (choices.length
            ? '<div class="m-ss-choices" role="group" aria-label="' +
              esc('What to do with ' + AddWorkSplitModel.first(st) + '’s work') +
              '">' +
              choices
                .map(function (c) {
                  var on = r.choice === c;
                  return (
                    '<button type="button" class="m-ss-choice' +
                    (on ? ' is-on' : '') +
                    '" data-ss="choice" data-sid="' +
                    esc(r.sid) +
                    '" data-choice="' +
                    c +
                    '" aria-pressed="' +
                    on +
                    '"' +
                    (s.run && s.run.busy ? ' disabled' : '') +
                    '>' +
                    esc(CHOICE_WORDS[c]) +
                    '</button>'
                  );
                })
                .join('') +
              '</div>'
            : '') +
          (r.choice === 'replace' ? '<p class="m-ss-row-note is-bad">Deleted photos can’t come back.</p>' : '') +
          (r.note ? '<p class="m-ss-row-note">' + esc(r.note) + '</p>' : '') +
          '</div>';
      });
      html += '</div>';
    }
    if (left)
      html +=
        '<p class="m-ss-hint">' +
        esc(_plural(left, 'piece has', 'pieces have') + ' no name yet. They stay on the scan.') +
        '</p>' +
        (s.phase === 'done' || (s.run && !s.run.busy)
          ? '<button type="button" class="m-ss-secondary" data-ss="toSplit">Back to the Pieces</button>'
          : '');
    html += '</div>';
    var foot = '<div class="m-ss-foot">';
    if (s.run && s.run.busy) {
      foot += '<p class="m-ss-wait-line" role="status">' + esc(s.run.line || 'Adding…') + '</p>';
    } else if (rows.length) {
      var c = stage.counts();
      foot +=
        '<button type="button" class="m-ss-primary" data-ss="add"' +
        (c.ready && !(s.run && s.run.stopped) ? '' : ' disabled') +
        '>' +
        esc(stage.buttonLabel()) +
        '</button>';
    } else {
      foot += '<button type="button" class="m-ss-primary" data-ss="cancel">Done</button>';
    }
    return html + foot + '</div>';
  }

  // html-safe: counts through esc
  function _askHtml(s) {
    return (
      '<div class="m-ss-ask" role="alertdialog" aria-modal="true" aria-labelledby="m-ss-ask-title" aria-describedby="m-ss-ask-text">' +
      '<div class="m-ss-ask-card"><h2 class="m-ss-ask-title" id="m-ss-ask-title">Leave without using this scan?</h2>' +
      '<p class="m-ss-ask-text" id="m-ss-ask-text">' +
      esc(_waitingLine(s)) +
      '</p><button type="button" class="m-ss-primary is-danger" data-ss="leave">Leave</button>' +
      '<button type="button" class="m-ss-secondary" data-ss="stay">Stay</button></div></div>'
    );
  }

  function _waitingLine(s) {
    if (s.phase === 'reading') return _plural(s.read, 'page has', 'pages have') + ' been read.';
    var n = s.m ? s.m.counts().pieces : 0;
    return n === 1 ? '1 piece is waiting.' : n + ' pieces are waiting.';
  }

  /* ── Names ──────────────────────────────────────────────────── */

  function _nameInput(s, at) {
    return /** @type {any} */ (s.root).querySelector('#m-ss-name-' + at);
  }

  function _used(s, exceptAt) {
    var used = {};
    s.m.pieces().forEach(function (p) {
      if (p.sid && p.at !== exceptAt) used[p.sid] = p.at;
    });
    return used;
  }

  // The students who fit the letters typed, as buttons under the box.
  // html-safe: names go through esc; ids are ours (esc too)
  function _drawFits(s, input) {
    var at = Number(input.getAttribute('data-at'));
    var box = /** @type {any} */ (s.root).querySelector('#m-ss-fits-' + at);
    if (!box) return;
    var p = s.m.pieces()[at];
    var shown = p && p.sid ? _full(s.byId[p.sid]) : '';
    var text = input.value;
    var used = _used(s, at);
    var fits =
      AddWorkSplitModel.fold(text) && text !== shown ? AddWorkSplitModel.matches(s.list, text, used).slice(0, 5) : [];
    if (!fits.length) {
      box.hidden = true;
      // html-safe: empty
      box.innerHTML = '';
      return;
    }
    // html-safe: names go through esc; ids are ours (esc too)
    box.innerHTML = fits
      .map(function (st) {
        var on = used[st.id];
        return (
          '<button type="button" class="m-ss-fit' +
          (on !== undefined ? ' is-used' : '') +
          '" data-ss="fit" data-at="' +
          esc(String(at)) +
          '" data-sid="' +
          esc(st.id) +
          '">' +
          esc(_full(st)) +
          (on !== undefined ? '<span class="m-ss-fit-on">' + esc(' · on piece ' + (on + 1)) + '</span>' : '') +
          '</button>'
        );
      })
      .join('');
    box.hidden = false;
  }

  // The next piece after `at` with no name (from the top again), else the button.
  function _focusNextUnnamed(s, at) {
    var ps = s.m.pieces();
    var order = ps.slice(at + 1).concat(ps.slice(0, at + 1));
    var next = order.find(function (p) {
      return !p.sid;
    });
    var el = next ? _nameInput(s, next.at) : /** @type {any} */ (s.root).querySelector('.m-ss-primary:not(:disabled)');
    if (el) {
      el.focus({ preventScroll: true });
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
  }

  function _commit(s, at, sid) {
    s.m.name(at, sid);
    s.note = '';
    _draw();
    _focusNextUnnamed(s, at);
  }

  /* ── Steps ──────────────────────────────────────────────────── */

  // The pieces' cards glide to their new places when pages move between them.
  function _glide(s, change) {
    var before = {};
    s.root.querySelectorAll('.m-ss-tile[data-no], .m-ss-tile.is-out').forEach(function (el) {
      before[el.getAttribute('data-no')] = el.getBoundingClientRect();
    });
    change();
    _draw();
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    s.root.querySelectorAll('.m-ss-tile').forEach(function (el) {
      var was = before[el.getAttribute('data-no')];
      if (!was || !el.animate) return;
      var now = el.getBoundingClientRect();
      var dx = was.left - now.left;
      var dy = was.top - now.top;
      if (!dx && !dy) return;
      el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], {
        duration: GLIDE_MS,
        easing: 'ease-out',
      });
    });
  }

  function _toCheck(s) {
    if (s.phase !== 'split' || !s.m.canMatch() || _busy(s)) return;
    var built = MSplitScanModel.stageFor(s.cid, s.aid, s.m, s.list, s.choices);
    s.stage = built.stage;
    s.firsts = built.firsts;
    s.run = null;
    s.added = 0;
    s.phase = 'check';
    s.note = built.refused.length ? 'A piece of work can have 30 pages at most. Some pieces were not checked.' : '';
    _draw();
    var b = /** @type {any} */ (s.root).querySelector('.m-ss-primary');
    if (b) b.focus({ preventScroll: true });
  }

  function _toSplit(s) {
    if (!s.m || (s.run && s.run.busy)) return;
    s.stage = null;
    s.run = null;
    s.note = '';
    s.phase = s.m.counts().pieces ? 'split' : 'done';
    _draw();
    if (s.phase === 'split') _focusNextUnnamed(s, -1);
  }

  function _filed(cid, aid) {
    if (window.MGrade && MGrade.refreshSwiper) MGrade.refreshSwiper(cid, aid);
    if (window.MGradePhotos && MGradePhotos.syncTabBadge) MGradePhotos.syncTabBadge(cid);
  }

  // Add Work for N Students: one student, one write, one after another.
  function _add(s) {
    if (s.phase !== 'check' || !s.stage || (s.run && s.run.busy)) return;
    if (!s.stage.counts().ready) return;
    var cid = s.cid;
    var aid = s.aid;
    var sent = {};
    var keep = function (sid) {
      return function (res) {
        if (res && res.result === 'sent') sent[sid] = true;
        return res;
      };
    };
    s.run = { busy: true, line: 'Adding…', said: '', stopped: null };
    _draw();
    AddWorkStage.run(
      s.stage,
      {
        add: function (sid, pages, mode) {
          return addStudentWorkPages(cid, sid, aid, pages, { mode: mode }).then(keep(sid));
        },
        replace: function (sid, pages) {
          return replaceStudentWorkPages(cid, sid, aid, pages).then(keep(sid));
        },
        paper: function () {
          return Promise.resolve({ result: 'sent', marked: 0, submissions: [] });
        },
      },
      {
        alive: function () {
          return _s === s;
        },
        progress: function (done, total) {
          if (_s !== s) return;
          s.run.line = 'Adding ' + done + ' of ' + total + '…';
          var line = /** @type {any} */ (s.root).querySelector('.m-ss-foot .m-ss-wait-line');
          if (line) line.textContent = s.run.line;
        },
      },
    ).then(function (out) {
      if (Object.keys(sent).length) _filed(cid, aid);
      if (_s !== s || !s.m) return;
      s.added += out.added;
      s.run = { busy: false, said: out.said || '', stopped: out.stopped };
      // The added students' pieces leave the scan; their pictures are let go.
      _letGoPictures(s, MSplitScanModel.settle(s.m, sent).map(String));
      // A student no longer in the class: their piece has no name again.
      s.m.pieces().forEach(function (p) {
        if (p.sid && !s.stage.row(p.sid)) s.m.name(p.at, '');
      });
      var rows = s.stage.rows().filter(function (r) {
        return r.pieces.length;
      });
      if (!rows.length && !out.stopped) s.phase = 'done';
      _draw();
    });
  }

  function _cancel(s) {
    if (s.run && s.run.busy) return;
    var waiting = (s.phase === 'reading' && s.read) || (s.m && s.m.counts().pieces);
    if (waiting && !s.asking) {
      s.asking = true;
      _draw();
      var stay = /** @type {any} */ (s.root).querySelector('[data-ss="stay"]');
      if (stay) stay.focus();
      return;
    }
    close();
  }

  /* ── Events ─────────────────────────────────────────────────── */

  function _onClick(e) {
    var s = _s;
    var btn = e.target.closest('[data-ss]');
    if (!s || !btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    var what = btn.getAttribute('data-ss');
    if (s.asking) {
      if (what === 'leave') return close();
      if (what === 'stay') {
        s.asking = false;
        return _draw();
      }
      return;
    }
    if (what === 'cancel') return _cancel(s);
    // A class still loading: nothing on the pick screen answers until it is in.
    if (s.phase === 'pick' && s.switching) return;
    if (what === 'class' && s.phase === 'pick') return _switchClass(s, btn.getAttribute('data-cid'));
    if (what === 'piece' && s.phase === 'pick') {
      s.aid = btn.getAttribute('data-aid');
      return _draw();
    }
    if (s.phase === 'split') {
      var at = Number(btn.getAttribute('data-at'));
      var no = Number(btn.getAttribute('data-no'));
      if (what === 'per')
        return _glide(s, function () {
          s.m.setPer(s.m.per() + Number(btn.getAttribute('data-d')));
        });
      if (what === 'leaveOut')
        return _glide(s, function () {
          s.m.setLeaveOut(!s.m.leaveOut());
        });
      if (what === 'fewer')
        return _glide(s, function () {
          s.m.fewer(at);
        });
      if (what === 'more')
        return _glide(s, function () {
          s.m.more(at);
        });
      if (what === 'keep')
        return _glide(s, function () {
          s.m.keep(no, true);
        });
      if (what === 'leaveOne')
        return _glide(s, function () {
          s.m.keep(no, false);
        });
      if (what === 'turn') return _turn(no);
      if (what === 'fit') return _commit(s, at, btn.getAttribute('data-sid'));
      if (what === 'check') return _toCheck(s);
    }
    if (what === 'toSplit') return _toSplit(s);
    if (what === 'choice' && s.phase === 'check' && s.stage) {
      var sid = btn.getAttribute('data-sid');
      var c = btn.getAttribute('data-choice');
      if (s.stage.choose(sid, c)) s.choices[sid] = c;
      return _draw();
    }
    if (what === 'add') return _add(s);
  }

  // A student button under a name box keeps the box's focus, so the tap lands.
  function _onPointerDown(e) {
    if (e.target.closest && e.target.closest('.m-ss-fit')) e.preventDefault();
  }

  function _switchClass(s, cid) {
    if (!cid || cid === s.cid || s.switching) return;
    s.switching = true;
    _draw();
    switchActiveCourse(cid).then(
      function (current) {
        if (_s !== s) return;
        s.switching = false;
        if (!current) return _draw();
        s.cid = cid;
        s.aid = '';
        s.choices = {};
        _pickAssessment(s);
        if (_cfg.onClass) _cfg.onClass(cid);
        _draw();
      },
      function () {
        if (_s !== s) return;
        s.switching = false;
        s.said = "That class couldn't be opened. Try again.";
        _draw();
      },
    );
  }

  function _onChange(e) {
    var input = e.target;
    if (!_s || !input || !input.classList || !input.classList.contains('m-ss-input')) return;
    var file = (input.files || [])[0];
    input.value = '';
    if (file) choose(file);
  }

  function _onInput(e) {
    var s = _s;
    var t = e.target;
    if (!s || s.phase !== 'split' || !t.classList.contains('m-ss-name')) return;
    _drawFits(s, t);
  }

  // Return in a name box: the one student the letters fit, or no one.
  function _onKeyIn(e) {
    var s = _s;
    var t = e.target;
    if (!s || s.phase !== 'split' || e.key !== 'Enter' || !t.classList || !t.classList.contains('m-ss-name')) return;
    e.preventDefault();
    var at = Number(t.getAttribute('data-at'));
    var p = s.m.pieces()[at];
    if (!p) return;
    var shown = p.sid ? _full(s.byId[p.sid]) : '';
    var text = t.value;
    if (!text.trim()) {
      if (p.sid) return _commit(s, at, '');
      return _focusNextUnnamed(s, at);
    }
    if (text === shown) return _focusNextUnnamed(s, at);
    var sid = MSplitScanModel.typed(s.list, text);
    if (sid) return _commit(s, at, sid);
    // Not certain: the students who fit stay as buttons to tap.
    _drawFits(s, t);
  }

  // Leaving a box half typed puts back the name it had.
  function _onFocusOut(e) {
    var s = _s;
    var t = e.target;
    if (!s || s.phase !== 'split' || !t.classList || !t.classList.contains('m-ss-name')) return;
    var card = t.closest('.m-ss-card');
    var to = e.relatedTarget;
    if (card && to && card.contains(to)) return;
    var p = s.m.pieces()[Number(t.getAttribute('data-at'))];
    t.value = p && p.sid ? _full(s.byId[p.sid]) : '';
    var box = card && card.querySelector('.m-ss-fits');
    if (box) {
      box.hidden = true;
      // html-safe: empty
      box.innerHTML = '';
    }
  }

  function _onKey(e) {
    var s = _s;
    if (!s || e.key !== 'Escape') return;
    e.preventDefault();
    if (s.asking) {
      s.asking = false;
      return _draw();
    }
    _cancel(s);
  }

  function _beforeUnload(e) {
    var s = _s;
    if (!s || !(s.m || (s.phase === 'reading' && s.read))) return;
    e.preventDefault();
    e.returnValue = '';
  }

  return {
    configure: configure,
    offeredIn: offeredIn,
    open: open,
    choose: choose,
    close: function () {
      close();
    },
    isOpen: isOpen,
    _state: function () {
      return _s;
    },
  };
})();
