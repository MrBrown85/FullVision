/* Preview as Student (docs/plans/student-page-build-plan.md S4-F6; board
   "Teacher: Preview as Student").

   The teacher sees one student's page as that student sees it, on a Phone
   or a Chromebook, with what the student sees and does not see beside it.
   Opened from Class Settings › Student Page (teacher/cm-student-page.js),
   which has the tab only for a class whose student page is on (the build
   switch).

   What the student sees comes from shared/student-view.js alone
   (StudentView.fromCache): returned grades only, every result worked out by
   calc.js in the class's grading style. Nothing is sent and nothing is
   saved: the preview reads the cache and writes nothing, in Demo Mode or
   signed in.

   The device draws the student page itself: s/page-view.js
   (StudentPageView), the same code the student's phone runs, handed the
   same kind of view. Its tabs, To Do, Sent and Back, All Assignments with
   its search and filters, and each piece's card answer presses here as
   they do on the phone (StudentPageView.press); what the student chose to
   look at is kept while the preview is open. Nothing that would reach the
   network (Done, Your Classes) does anything here.

   Not ready: a signed-in class whose Draft and Returned rows have not
   loaded draws "Loading this class…" in the device. When the rows load the
   data layer redraws the page on screen; Class Settings, redrawn, calls
   refresh(cid) and the preview draws again, but only while it is still
   open on that class and student. */
window.PreviewStudent = (function () {
  'use strict';

  var OVERLAY_ID = 'preview-student';
  // What is open: { cid, sid, device: 'phone' | 'chromebook', trigger }, or null.
  var _open = null;
  var _onKey = null;
  var _onLeave = null;

  var STYLE_NAMES = { proficiency: 'Proficiency', letter: 'Letter', both: 'Both' };

  /* The view the device draws. Opened by See What They'd See (S13-F1),
     My Learning is worked out as if the class showed it, for this preview
     only: nothing is saved, and every other screen reads the class as it is. */
  function _fromCache(cid, sid) {
    return StudentView.fromCache(cid, sid, { learning: !!(_open && _open.learning) });
  }

  function _student(cid, sid) {
    return (getStudents(cid) || []).find(function (s) {
      return s && s.id === sid;
    });
  }

  /* ── The student's page ────────────────────────────────────── */

  /* The page inside the device: the student page's own drawing
     (s/page-view.js), the same HTML the student's device draws for this
     view and these choices (`ui`: the tab, To Do, Sent or Back, All
     Assignments, the card showing). */
  function drawPage(view, ui) {
    return StudentPageView.html(view, ui || {});
  }

  /* ── The two lists ─────────────────────────────────────────── */

  function _item(title, line) {
    return (
      '<li class="ps-item"><span class="ps-item-title">' +
      esc(title) +
      '</span><span class="ps-item-line">' +
      esc(line) +
      '</span></li>'
    );
  }

  // How many of this student's grades wait as drafts: the cells a screen shows as Draft (GradeState.stateOf).
  function _draftsFor(cid, sid) {
    if (typeof GradeState === 'undefined') return 0;
    return (getAssessments(cid) || []).filter(function (a) {
      return a && GradeState.stateOf(cid, sid, a.id) === GradeState.DRAFT;
    }).length;
  }

  /* The teacher's Mark Up the student sees: the notes on returned work,
     over every piece the student was given marks on ("3 notes on his
     work", the board's, by the student's name here), or null. */
  function _marksSeen(view) {
    var pages = 0;
    var notes = 0;
    ((view && view.work) || []).forEach(function (p) {
      if (p && p.marks) {
        pages += p.marks.pages;
        notes += p.marks.notes;
      }
    });
    return pages ? { pages: pages, notes: notes } : null;
  }

  /* Whether any returned piece came back with words from the teacher: the
     piece's comment, or a comment on one of its competencies or rubric
     criteria (shared/student-view.js sets them only from a returned grade). */
  function _commentsSeen(view) {
    function said(row) {
      return !!(row && row.comment);
    }
    return ((view && view.work) || []).some(function (p) {
      return !!p && (said(p) || (p.competencies || []).some(said) || ((p.rubric && p.rubric.rows) || []).some(said));
    });
  }

  function _seesHtml(first, cid, view) {
    var marks = _marksSeen(view);
    return (
      '<section class="ps-card" aria-labelledby="ps-sees-title"><h3 class="ps-card-title" id="ps-sees-title">' +
      esc(first + ' Sees') +
      '</h3><ul class="ps-items">' +
      _item(
        'Your Result',
        'Each returned piece, in this class’s grading style (' + STYLE_NAMES[courseGradeMode(cid)] + ').',
      ) +
      (StudentView.learningOn(cid) || (_open && _open.learning)
        ? _item('My Learning', 'Their level on each skill and their grade, only from work you’ve returned.')
        : '') +
      (_commentsSeen(view) ? _item('Your comment and criterion comments', 'Word for word, as you wrote them.') : '') +
      (marks
        ? _item(
            marks.notes
              ? (marks.notes === 1 ? '1 note' : marks.notes + ' notes') + ' on ' + first + '’s work'
              : 'Your Mark Up',
            marks.notes ? 'Your Mark Up, on the photos.' : 'On the photos of work you’ve returned.',
          )
        : '') +
      '</ul></section>'
    );
  }

  function _notSeenHtml(first, cid, sid, ready) {
    var n = ready ? _draftsFor(cid, sid) : 0;
    var drafts =
      'Drafts never reach the student page.' +
      (n === 1
        ? ' 1 grade is waiting for you to return it.'
        : n > 1
          ? ' ' + n + ' grades are waiting for you to return them.'
          : '');
    return (
      '<section class="ps-card" aria-labelledby="ps-not-title"><h3 class="ps-card-title" id="ps-not-title">' +
      esc(first + ' Doesn’t See') +
      '</h3><ul class="ps-items">' +
      _item('Grades you haven’t returned', drafts) +
      _item('Other students', 'No class average, no one else’s work.') +
      _item('Your private notes', 'Observations marked Private stay with you.') +
      (StudentView.learningOn(cid) || (_open && _open.learning)
        ? ''
        : _item('My Learning', 'Off for this class. Turn it on in Class Settings › Student Page.')) +
      '</ul></section>'
    );
  }

  /* ── The preview ───────────────────────────────────────────── */

  // html-safe: every name goes through esc() (_item and here); drawPage is s/page-view.js, which escapes every title, date line and result; the device and the rest are fixed markup
  function _previewHtml() {
    var cid = _open.cid;
    var sid = _open.sid;
    var st = _student(cid, sid) || {};
    var first = displayNameFirst(st) || 'The student';
    var full = displayNameWithLast(st) || first;
    var built = _fromCache(cid, sid);
    var screen = built.ready
      ? drawPage(built.view, _open.ui)
      : // html-safe: fixed markup
        '<div class="ps-waiting" role="status">Loading this class…</div>';
    var device = _open.device;
    var seg = ['phone', 'chromebook']
      .map(function (d) {
        var on = d === device;
        return (
          '<button type="button" class="ps-seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-ps-device="' +
          d +
          '">' +
          (d === 'phone' ? 'Phone' : 'Chromebook') +
          '</button>'
        );
      })
      .join('');
    return (
      '<div class="ps-bar">' +
      '<h2 class="ps-title" id="ps-title">' +
      esc('Previewing as ' + full) +
      '</h2>' +
      '<span class="ps-bar-line" id="ps-line">' +
      esc('This is ' + first + '’s page now. Nothing is sent.') +
      '</span>' +
      '<span class="ps-bar-space"></span>' +
      '<div class="ps-seg" role="radiogroup" aria-label="Device">' +
      seg +
      '</div>' +
      '<button type="button" class="ps-back" data-ps-close>Back to Class Settings</button>' +
      '</div>' +
      '<div class="ps-body">' +
      '<div class="ps-side ps-side-left">' +
      _seesHtml(first, cid, built.ready ? built.view : null) +
      '</div>' +
      '<div class="ps-stage"><div class="ps-device ps-device-' +
      device +
      '"><div class="ps-screen" aria-label="' +
      esc(first + '’s page') +
      '" role="region">' +
      screen +
      '</div></div></div>' +
      '<div class="ps-side ps-side-right">' +
      _notSeenHtml(first, cid, sid, built.ready) +
      '</div>' +
      '</div>'
    );
  }

  function _overlay() {
    return typeof document !== 'undefined' ? document.getElementById(OVERLAY_ID) : null;
  }

  function _draw() {
    var el = _overlay();
    if (!el || !_open) return;
    var had = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
    var focusKey = had
      ? had.hasAttribute('data-ps-close')
        ? '[data-ps-close]'
        : had.dataset && had.dataset.psDevice
          ? '[data-ps-device="' + had.dataset.psDevice + '"]'
          : null
      : null;
    el.innerHTML = _previewHtml();
    _settle(el.querySelector('.ps-screen'));
    if (focusKey) {
      var again = el.querySelector(focusKey);
      if (again) again.focus();
    }
  }

  /* Opens the preview of student `sid` in class `cid`. `trigger` is the
     control that opened it; the focus goes back to `returnFocusId` (or the
     trigger) when it closes. `opts.tab` is the tab it opens on;
     `opts.learning` shows My Learning before the class turns it on (S13-F1). */
  function open(cid, sid, trigger, returnFocusId, opts) {
    if (!cid || !sid || !_student(cid, sid)) return false;
    close();
    _open = {
      cid: cid,
      sid: sid,
      device: 'phone',
      trigger: trigger || null,
      returnTo: returnFocusId || null,
      // What the student looks at, as on the phone: the page opens on Assignments, To Do.
      ui: opts && opts.tab ? { tab: opts.tab } : {},
      learning: !!(opts && opts.learning),
    };
    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'ps-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'ps-title');
    el.setAttribute('aria-describedby', 'ps-line');
    el.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t.closest('[data-ps-close]')) return close();
      var d = t.closest('[data-ps-device]');
      if (d) return setDevice(d.dataset.psDevice);
      var a = t.closest('.ps-screen [data-act]');
      if (a) _press(a.getAttribute('data-act'), a);
    });
    // All Assignments' search, as on the phone.
    el.addEventListener('input', function (e) {
      var t = e.target;
      if (!_open || !t || t.id !== 'sp-search') return;
      _open.ui = Object.assign({}, _open.ui, { search: String(t.value || '').slice(0, 100) });
      var at = typeof t.selectionStart === 'number' ? t.selectionStart : 0;
      _drawScreen('#sp-search');
      var box = _overlay() && _overlay().querySelector('#sp-search');
      if (box && typeof box.setSelectionRange === 'function') box.setSelectionRange(at, at);
    });
    _onKey = function (e) {
      if (!_open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        var box = _overlay();
        var all = box ? Array.prototype.slice.call(box.querySelectorAll('button, input')) : [];
        if (!all.length) return;
        var first = all[0];
        var last = all[all.length - 1];
        var at = document.activeElement;
        if (!box.contains(at)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && at === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // Leaving the page (Back, a link) closes it: the preview belongs to Class Settings.
    _onLeave = function () {
      close();
    };
    document.addEventListener('keydown', _onKey, true);
    if (typeof window.addEventListener === 'function') window.addEventListener('popstate', _onLeave);
    document.body.appendChild(el);
    _draw();
    var start = el.querySelector('[data-ps-close]');
    if (start) start.focus();
    return true;
  }

  function close() {
    var el = _overlay();
    var was = _open;
    _open = null;
    if (was) _letGo(was);
    if (_onKey) document.removeEventListener('keydown', _onKey, true);
    if (_onLeave && typeof window.removeEventListener === 'function') window.removeEventListener('popstate', _onLeave);
    _onKey = _onLeave = null;
    if (el) el.remove();
    if (!was) return;
    var back = (was.returnTo && document.getElementById(was.returnTo)) || was.trigger;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  /* A press on the student's page inside the device: what it changes is
     the student page's own answer (StudentPageView.press). Only the page
     inside the device is drawn again. */
  function _press(act, el) {
    if (!_open) return;
    var built = _fromCache(_open.cid, _open.sid);
    if (!built.ready) return;
    if (act === 'work-retry') {
      if (_open.ui.work) _loadWork(_open.ui.work);
      return;
    }
    var out = StudentPageView.press(_open.ui, built.view, act, el);
    if (!out) return;
    _open.ui = out.ui;
    var have = out.ui.workPages;
    if (out.work && !(have && have.id === out.work && have.state === 'ready')) return _loadWork(out.work);
    _drawScreen(out.focus);
  }

  /* ── See Your Work (S9-F3) ─────────────────────────────────── */

  // The pictures this preview holds open (a photo still in the photo queue holds its bytes until let go).
  function _letGo(open) {
    (open.releases || []).forEach(function (release) {
      try {
        release();
      } catch (e) {
        /* already gone */
      }
    });
    open.releases = [];
  }

  /* The pages of piece `aid` as the student sees them: the newest work
     handed in, in page order, each with the marks the student was given
     on it (getStudentMarkup: the given copy only, none while the piece
     hides its Mark Up or Missing or Excused is on it). The pictures come
     through openStudentWorkPage. The answer draws only while the preview
     is still open on this student with See Your Work on this piece. */
  function _loadWork(aid) {
    var mine = _open;
    if (!mine) return;
    var cid = mine.cid;
    var sid = mine.sid;
    _letGo(mine);
    mine.ui = Object.assign({}, mine.ui, { workPages: { id: aid, state: 'loading', pages: [] } });
    _drawScreen('#sp-work-title');
    var sub = typeof getStudentSubmission === 'function' ? getStudentSubmission(cid, sid, aid) : null;
    var files = ((sub && sub.files) || []).filter(Boolean).slice();
    files.sort(function (x, y) {
      return (Number(x.page) || 0) - (Number(y.page) || 0);
    });
    var given = typeof getStudentMarkup === 'function' ? getStudentMarkup(cid, sid, aid) : null;
    var byFile = {};
    ((given && given.ok && given.files) || []).forEach(function (f) {
      if (f && f.file_id) byFile[f.file_id] = f.marks || null;
    });
    var opening = files.map(function (f) {
      return typeof openStudentWorkPage === 'function'
        ? Promise.resolve(openStudentWorkPage(cid, f, 'page')).then(null, function () {
            return null;
          })
        : Promise.resolve(null);
    });
    Promise.all(opening).then(function (opened) {
      var still = _open === mine && mine.ui.work === aid;
      if (!still) {
        opened.forEach(function (o) {
          if (o && typeof o.release === 'function') o.release();
        });
        return;
      }
      var pages = [];
      mine.releases = [];
      opened.forEach(function (o, i) {
        if (!o || !o.url) return;
        if (typeof o.release === 'function') mine.releases.push(o.release);
        pages.push({ url: o.url, marks: byFile[files[i].id] || null });
      });
      mine.ui = Object.assign({}, mine.ui, {
        workPages: { id: aid, state: files.length && !pages.length ? 'failed' : 'ready', pages: pages },
      });
      _drawScreen('#sp-work-title');
    });
  }

  function _drawScreen(focus) {
    var box = _overlay();
    var screen = box && box.querySelector('.ps-screen');
    if (!screen || !_open) return;
    var built = _fromCache(_open.cid, _open.sid);
    if (!built.ready) return _draw();
    // html-safe: drawPage is s/page-view.js, which escapes every title, date line and result
    screen.innerHTML = drawPage(built.view, _open.ui);
    _settle(screen);
    var to = focus ? screen.querySelector(focus) : null;
    if (to && typeof to.focus === 'function') to.focus();
  }

  // The phone's cards start at the one picked, and the count follows the swipe.
  function _settle(screen) {
    if (!screen || !_open) return;
    var mine = _open;
    StudentPageView.settle(screen, function (id) {
      if (_open === mine) _open.ui = Object.assign({}, _open.ui, { pick: id });
    });
  }

  function setDevice(device) {
    if (!_open || (device !== 'phone' && device !== 'chromebook') || _open.device === device) return;
    _open.device = device;
    _draw();
  }

  /* Class Settings drew class `cid` again (a change, or rows that loaded):
     the preview draws again from the cache, if it is still open on that
     class and its student is still in it. On another class, or with the
     student gone, it closes. */
  function refresh(cid) {
    if (!_open || !_overlay()) return;
    if (cid !== _open.cid || !_student(_open.cid, _open.sid)) return close();
    _draw();
  }

  return {
    open: open,
    close: close,
    refresh: refresh,
    setDevice: setDevice,
    isOpen: function () {
      return !!_open;
    },
    // The student page's own drawing, as the device draws it.
    drawPage: drawPage,
  };
})();
