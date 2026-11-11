/* add-work.js — Add Work on the phone (S7-F3).

   The teacher photographs a student's paper work and it is filed as that
   student's work for the piece, the way a student's own send is. Two ways in:
   - from a not-in card in the grader: Save and Next walks the students with
     nothing in (Add Work, Then the Next Student Not In), Done ends it;
   - from a student's To Grade list (card or View Profile): one student, then
     Save and Grade opens the grader on that work (Add Work, Then Grade It).
   When the student already has work in, the teacher chooses Add as More
   Pages, Replace Them or Skip (Adding Work for a Student Who Already Sent
   Some).

   Every photo is made smaller by shared/photo-shrink.js, as a student's is,
   and kept on the phone in the photo queue (shared/photo-queue.js) by
   shared/data.js's addStudentWorkPages / replaceStudentWorkPages. In Demo
   Mode nothing is ever sent. Signed in, those answer not_available until
   the server side is wired (S7-W1), and Add Work does not show: it is drawn
   only where MGradePhotos.on() (the build switch and Send Work) holds.

   The screen is one overlay over the app; it is not on the nav stack. */

window.MAddWork = (function () {
  'use strict';

  var MC = window.MComponents;
  var MAX_PAGES = 30;
  var _s = null; // the open screen's state
  var _seq = 0; // goes up whenever the screen closes or moves to another student
  var _prepare = null; // tests pass their own PhotoShrink.prepare
  var _onGrade = null; // (aid, sid): open the grader on that work

  var SHUTTER_SVG =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  function configure(opts) {
    opts = opts || {};
    if ('prepare' in opts) _prepare = typeof opts.prepare === 'function' ? opts.prepare : null;
    if ('onGrade' in opts) _onGrade = typeof opts.onGrade === 'function' ? opts.onGrade : null;
  }

  /* ── Who and what ───────────────────────────────────────────── */

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

  // "Olivia M."
  function _short(st) {
    if (!st) return '';
    var last = String(st.lastName || '').trim();
    return _first(st) + (last ? ' ' + last.charAt(0) + '.' : '');
  }

  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (a) {
        return a.id === aid;
      }) || null
    );
  }

  // "Oct 30, 8:41 pm"
  function _when(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var h = d.getHours();
    var m = d.getMinutes();
    var day = formatShortDate(
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
    );
    return day + ', ' + (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm');
  }

  /* ── Opening and closing ────────────────────────────────────── */

  /* then 'grade': one student, Save and Grade. Otherwise the students with
     nothing in, from `sid` on, Save and Next. */
  function open(cid, aid, sid, opts) {
    var a = _piece(cid, aid);
    if (!a || !_student(cid, sid) || !window.MGradePhotos || !MGradePhotos.takes(cid, a)) return false;
    close();
    var then = opts && opts.then === 'grade' ? 'grade' : 'next';
    var pile = [sid];
    if (then === 'next') {
      pile = MGradePhotos.notIn(cid, a);
      if (pile.indexOf(sid) < 0) pile.unshift(sid);
    }
    _s = {
      cid: cid,
      aid: aid,
      then: then,
      pile: pile,
      idx: pile.indexOf(sid),
      pages: [],
      thumbs: [],
      msg: '',
      busy: false,
      conflict: null,
      shown: [],
    };
    var root = document.createElement('div');
    root.id = 'm-addwork';
    root.className = 'm-addwork';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'm-addwork-title');
    document.body.appendChild(root);
    root.addEventListener('click', _onClick);
    root.addEventListener('change', _onChange);
    document.addEventListener('keydown', _onKey);
    _draw();
    var shutter = root.querySelector('.m-addwork-shutter');
    if (shutter) shutter.focus();
    return true;
  }

  function _forgetPages() {
    if (!_s) return;
    _s.thumbs.forEach(function (url) {
      URL.revokeObjectURL(url);
    });
    _s.thumbs = [];
    _s.pages = [];
  }

  function _letGoShown() {
    if (!_s) return;
    _s.shown.forEach(function (p) {
      p.release();
    });
    _s.shown = [];
  }

  function close() {
    _seq++;
    if (!_s) return;
    _forgetPages();
    _letGoShown();
    var root = document.getElementById('m-addwork');
    if (root) root.remove();
    document.removeEventListener('keydown', _onKey);
    _s = null;
  }

  function isOpen() {
    return !!_s;
  }

  /* ── Drawing ────────────────────────────────────────────────── */

  function _sid() {
    return _s.pile[_s.idx];
  }

  // The next student in the pile who still has nothing in, or null.
  function _nextIdx() {
    var a = _piece(_s.cid, _s.aid);
    for (var i = _s.idx + 1; i < _s.pile.length; i++) {
      if (a && !MGradePhotos.submission(_s.cid, _s.pile[i], a.id)) return i;
    }
    return null;
  }

  // html-safe: names, the title and messages go through MC.esc; urls are blob: or ours
  function _draw() {
    var root = document.getElementById('m-addwork');
    if (!root || !_s) return;
    var a = _piece(_s.cid, _s.aid);
    var st = _student(_s.cid, _sid());
    if (!a || !st) return close();
    var head =
      '<div class="m-addwork-top">' +
      '<button type="button" class="m-addwork-close" data-aw="close">' +
      (_s.then === 'grade' ? 'Cancel' : 'Done') +
      '</button>' +
      '<div class="m-addwork-title" id="m-addwork-title">' +
      MC.esc(a.title) +
      '</div></div>' +
      '<div class="m-addwork-who"><span class="m-addwork-name">' +
      MC.esc(displayName(st)) +
      '</span>' +
      (_s.then === 'next' && !_s.conflict
        ? '<span class="m-addwork-count">' + (_s.idx + 1) + ' of ' + _s.pile.length + '</span>'
        : '') +
      '</div>';
    var body = _s.conflict ? _conflictHtml(st) : _cameraHtml(a, st);
    // html-safe: built above from escaped parts
    root.innerHTML = head + body;
    if (_s.conflict) _hydrateConflict(root);
  }

  // html-safe: names and messages go through MC.esc; thumbs are blob: addresses this file made
  function _cameraHtml(a, st) {
    var pile = '';
    if (_s.then === 'next' && _s.pile.length > 1) {
      pile =
        '<div class="m-addwork-pile" aria-label="Students to do next">' +
        _s.pile
          .map(function (sid, i) {
            var who = _student(_s.cid, sid);
            return (
              '<span class="m-addwork-pile-name' +
              (i === _s.idx ? ' is-now' : '') +
              (i < _s.idx ? ' is-done' : '') +
              '">' +
              MC.esc(_short(who)) +
              '</span>'
            );
          })
          .join('') +
        '</div>';
    }
    var n = _s.pages.length;
    var taken = _s.thumbs
      .map(function (url, i) {
        return (
          '<span class="m-addwork-taken"><img src="' +
          url +
          '" alt="' +
          MC.esc('Page ' + (i + 1) + ', taken') +
          '"><span class="m-addwork-taken-n">' +
          (i + 1) +
          '</span></span>'
        );
      })
      .join('');
    var next = _s.then === 'next' ? _nextIdx() : null;
    var save =
      _s.then === 'grade'
        ? 'Save and Grade'
        : next != null
          ? 'Save and Next: ' + _short(_student(_s.cid, _s.pile[next]))
          : 'Save';
    return (
      pile +
      '<div class="m-addwork-view">' +
      (n
        ? '<div class="m-addwork-pages">' + taken + '</div>'
        : '<div class="m-addwork-empty">Take a photo of each page.</div>') +
      (n < MAX_PAGES
        ? '<label class="m-addwork-shutter" tabindex="0" aria-label="' +
          MC.esc('Take page ' + (n + 1)) +
          '">' +
          SHUTTER_SVG +
          '<input type="file" class="m-addwork-input" accept="image/*,application/pdf" capture="environment" multiple' +
          (_s.busy ? ' disabled' : '') +
          '></label>'
        : '') +
      '</div>' +
      '<div class="m-addwork-msg" role="status">' +
      MC.esc(_s.msg) +
      '</div>' +
      '<button type="button" class="m-addwork-save" data-aw="save"' +
      (n && !_s.busy ? '' : ' disabled') +
      '>' +
      MC.esc(save) +
      '</button>'
    );
  }

  // html-safe: names go through MC.esc; the pictures are filled in by _hydrateConflict
  function _conflictHtml(st) {
    var sub = _s.conflict;
    var first = _first(st);
    var files = sub.files || [];
    var line = sub.on_paper
      ? first + ' handed it in on paper'
      : first + ' already sent ' + MGradePhotos.photosText(files.length);
    // A white sheet over the camera; only Add as More Pages is the blue
    // button, Replace Them and Skip grey side by side (the board "Adding Work
    // for a Student Who Already Sent Some").
    return (
      '<div class="m-addwork-stage" aria-hidden="true"></div>' +
      '<div class="m-addwork-conflict" role="group" aria-labelledby="m-addwork-conflict-line">' +
      '<div class="m-addwork-grabber" aria-hidden="true"></div>' +
      '<div class="m-addwork-conflict-line" id="m-addwork-conflict-line">' +
      MC.esc(line) +
      '</div>' +
      '<div class="m-addwork-conflict-row">' +
      (files.length
        ? '<div class="m-addwork-conflict-pages">' +
          files
            .slice(0, 6)
            .map(function (f, i) {
              return (
                '<span class="m-addwork-conflict-page"><img alt="' +
                MC.esc(first + '’s page ' + (i + 1)) +
                '" data-aw-page="' +
                i +
                '"></span>'
              );
            })
            .join('') +
          '</div>'
        : '') +
      '<div class="m-addwork-conflict-when">' +
      MC.esc(_when(sub.sent_at || sub.created_at)) +
      '</div></div>' +
      '<div class="m-addwork-msg" role="status">' +
      MC.esc(_s.msg) +
      '</div>' +
      '<div class="m-addwork-conflict-acts">' +
      (sub.on_paper
        ? ''
        : '<button type="button" class="m-addwork-choice" data-aw="add"' +
          (_s.busy ? ' disabled' : '') +
          '>Add as More Pages</button>') +
      '<div class="m-addwork-conflict-more">' +
      '<button type="button" class="m-addwork-choice m-addwork-replace" data-aw="replace"' +
      (_s.busy ? ' disabled' : '') +
      '>Replace Them</button>' +
      '<button type="button" class="m-addwork-choice m-addwork-skip" data-aw="skip"' +
      (_s.busy ? ' disabled' : '') +
      '>' +
      MC.esc('Skip ' + first) +
      '</button></div></div></div>'
    );
  }

  // The pages already in, as small pictures. Each answer is used only if the
  // screen still shows the same work.
  function _hydrateConflict(root) {
    if (typeof openStudentWorkPage !== 'function') return;
    var seq = _seq;
    var sub = _s.conflict;
    root.querySelectorAll('img[data-aw-page]').forEach(function (img) {
      var file = (sub.files || [])[Number(img.getAttribute('data-aw-page'))];
      openStudentWorkPage(_s.cid, file, 'thumb').then(function (page) {
        if (!page) return;
        if (seq !== _seq || !_s || _s.conflict !== sub || !img.isConnected) return page.release();
        img.setAttribute('src', page.url);
        _s.shown.push(page);
      });
    });
  }

  /* ── Taking photos ──────────────────────────────────────────── */

  // What a refused file says. Mine except "Save it as a PDF first." (the plan's).
  function _refusal(res) {
    var R = (window.PhotoShrink && PhotoShrink.REASONS) || {};
    if (res.reason === R.OFFICE) return 'Save it as a PDF first.';
    if (res.locked) return 'This PDF has a password. Save a copy without one, then choose it.';
    // The PDF reader could not load (offline, on a phone that never fetched it).
    if (res.kind === 'pdf' && res.reason === R.NO_DECODER)
      return "PDFs can't be opened right now. Try again when you're online, or take a photo of each page.";
    if (res.reason === R.TOO_MANY_PAGES || res.reason === R.PDF_TOO_LARGE) return 'That PDF is too long to add here.';
    return "That file couldn't be used. Try another photo.";
  }

  function _onChange(e) {
    var input = e.target;
    if (!_s || !input || !input.classList || !input.classList.contains('m-addwork-input')) return;
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!files.length || _s.busy) return;
    addFiles(files);
  }

  /* Shrink each file and keep its pages, in order. → Promise. */
  function addFiles(files) {
    if (!_s) return Promise.resolve();
    var prepare = _prepare || (window.PhotoShrink && PhotoShrink.prepare);
    if (typeof prepare !== 'function') {
      _s.msg = "Photos can't be added on this page.";
      _draw();
      return Promise.resolve();
    }
    var seq = _seq;
    var state = _s;
    state.busy = true;
    state.msg = '';
    _draw();
    var said = '';
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        if (seq !== _seq) return;
        return Promise.resolve()
          .then(function () {
            // A PDF becomes pages through shared/photo-readers.js (pdf.js, fetched the first time).
            return prepare(file, { openPdf: window.PhotoReaders && PhotoReaders.openPdf });
          })
          .then(
            function (res) {
              if (seq !== _seq) return;
              if (!res || !res.ok) {
                said = _refusal(res || {});
                return;
              }
              res.pages.forEach(function (p) {
                if (state.pages.length >= MAX_PAGES) {
                  said = 'A piece of work can have 30 pages at most.';
                  return;
                }
                state.pages.push(p);
                state.thumbs.push(URL.createObjectURL(p.thumb));
              });
            },
            function () {
              said = "That file couldn't be used. Try another photo.";
            },
          );
      });
    });
    return chain.then(function () {
      if (seq !== _seq) return;
      state.busy = false;
      state.msg = said;
      _draw();
    });
  }

  /* ── Saving ─────────────────────────────────────────────────── */

  function _answerText(res, st) {
    if (res.result === 'too_many_pages') {
      return res.room > 0
        ? 'Only ' +
            res.room +
            (res.room === 1 ? ' more page fits' : ' more pages fit') +
            '. Work can have 30 pages at most.'
        : 'This work already has 30 pages, the most it can have.';
    }
    if (res.result === 'storage_full') return 'This phone is full. Free some space, then try again.';
    if (res.result === 'not_available') return "Adding work isn't ready for this class yet.";
    if (res.result === 'not_found') return _first(st) + ' is no longer in this class.';
    return "The photos couldn't be kept. Try again.";
  }

  // After work is filed: the grader, the Grade tab's count and the lists follow.
  function _filed(cid, aid) {
    if (window.MGrade && MGrade.refreshSwiper) MGrade.refreshSwiper(cid, aid);
    if (window.MGradePhotos) MGradePhotos.syncTabBadge(cid);
  }

  function _advance() {
    _forgetPages();
    _letGoShown();
    _s.conflict = null;
    _s.msg = '';
    if (_s.then === 'grade') {
      var cid = _s.cid;
      var aid = _s.aid;
      var sid = _sid();
      close();
      if (_onGrade) _onGrade(cid, aid, sid);
      return;
    }
    var next = _nextIdx();
    if (next == null) return close();
    _seq++;
    _s.idx = next;
    _draw();
  }

  /* mode: 'new' (Save), 'add' or 'replace' (the already-sent choice). */
  function save(mode) {
    if (!_s || _s.busy || !_s.pages.length) return Promise.resolve();
    var state = _s;
    var seq = _seq;
    var cid = state.cid;
    var aid = state.aid;
    var sid = _sid();
    var st = _student(cid, sid);
    state.busy = true;
    state.msg = '';
    _draw();
    var call =
      mode === 'replace'
        ? replaceStudentWorkPages(cid, sid, aid, state.pages)
        : addStudentWorkPages(cid, sid, aid, state.pages, { mode: mode === 'add' ? 'add' : 'new' });
    return call.then(function (res) {
      res = res || {};
      if (res.result === 'sent') _filed(cid, aid);
      if (seq !== _seq || _s !== state) return res;
      state.busy = false;
      if (res.result === 'sent') {
        _advance();
      } else if (res.result === 'already_sent' || res.result === 'on_paper') {
        state.conflict = res.submission;
        state.msg = '';
        _draw();
      } else if (res.result === 'nothing_sent') {
        // The work was taken away meanwhile: file these as new.
        state.conflict = null;
        _draw();
        return save('new');
      } else {
        state.msg = _answerText(res, st);
        _draw();
      }
      return res;
    });
  }

  function skip() {
    if (!_s || _s.busy) return;
    _advance();
  }

  // Done with photos taken and not saved: they are saved first.
  function done() {
    if (!_s || _s.busy) return Promise.resolve();
    if (_s.then === 'grade' || !_s.pages.length || _s.conflict) {
      close();
      return Promise.resolve();
    }
    var state = _s;
    return save('new').then(function (res) {
      if (_s === state && res && res.result === 'sent') close();
    });
  }

  /* ── Events ─────────────────────────────────────────────────── */

  function _onClick(e) {
    var btn = e.target.closest('[data-aw]');
    if (!btn || btn.disabled) return;
    var what = btn.getAttribute('data-aw');
    if (what === 'close') done();
    else if (what === 'save') save('new');
    else if (what === 'add') save('add');
    else if (what === 'replace') save('replace');
    else if (what === 'skip') skip();
  }

  function _onKey(e) {
    if (!_s) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    // The shutter is a label: Enter and Space open the camera from the keyboard.
    var t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.classList && t.classList.contains('m-addwork-shutter')) {
      e.preventDefault();
      var input = t.querySelector('input');
      if (input && !input.disabled) input.click();
    }
  }

  return {
    configure: configure,
    open: open,
    close: close,
    isOpen: isOpen,
    addFiles: addFiles,
    save: save,
    skip: skip,
    done: done,
    _state: function () {
      return _s;
    },
  };
})();
