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

   PLACEHOLDER. The student page's real screens (S4-F1 to F3, in s/) are
   being built. Until they land, the device draws what a student has on
   main today: the class, Assignments, and one row per piece with its date
   and, once returned, its result, as s/assignments.js draws them. When
   the real screens land, drawPage() is the one function they replace: it
   is handed the view StudentView builds and draws the page inside the
   device.

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
  var DAY = { month: 'short', day: 'numeric' };
  var DUE_DAY = { weekday: 'short', month: 'short', day: 'numeric' };
  var SEP = ' · ';

  function _student(cid, sid) {
    return (getStudents(cid) || []).find(function (s) {
      return s && s.id === sid;
    });
  }

  // A date as the student page shows it (s/student.js, fmtDate).
  function fmtDate(iso, opts) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', opts || { month: 'long', day: 'numeric' });
  }

  // The class as the student page names it: "Science 9 · Block B" (s/student.js, className).
  function className(course) {
    var name = (course && course.name) || '';
    var b = String((course && course.block) || '').trim();
    if (!b) return name;
    var label = /^[A-Za-z0-9]{1,2}$/.test(b) ? 'Block ' + b.toUpperCase() : b;
    return name.toLowerCase().indexOf(label.toLowerCase()) >= 0 ? name : name + SEP + label;
  }

  /* ── The student's page (placeholder until S4-F1 to F3) ─────── */

  /* One row, as s/assignments.js words it: { kind, title, sub, result }. */
  function rowView(p) {
    var due = p.dueDate ? 'Due ' + fmtDate(p.dueDate, DUE_DAY) : p.date ? fmtDate(p.date, DAY) : '';
    var view = { kind: p.kind === 'excused' ? 'excused' : p.kind, title: p.title, sub: due, result: '' };
    if (p.kind === 'missing' || p.kind === 'excused') {
      view.sub = [p.kind === 'missing' ? 'Missing' : 'Excused', due].filter(Boolean).join(SEP);
      return view;
    }
    if (p.kind !== 'back') {
      if (p.late) view.sub = ['Late', due].filter(Boolean).join(SEP);
      return view;
    }
    var bits = ['Back ' + fmtDate(p.returnedAt, DAY)];
    if (p.result.word) bits.push(p.result.word);
    view.result = p.result.text;
    if (p.late) bits.push('Late');
    if (p.updated) bits.push('Updated');
    view.sub = bits.join(SEP);
    return view;
  }

  function rowHtml(v) {
    return (
      '<li class="ps-row"><span class="ps-dot ps-dot-' +
      esc(v.kind) +
      '" aria-hidden="true"></span><span class="ps-row-text"><span class="ps-row-title">' +
      esc(v.title) +
      '</span>' +
      (v.sub ? '<span class="ps-row-sub">' + esc(v.sub) + '</span>' : '') +
      '</span>' +
      (v.result ? '<span class="ps-row-result">' + esc(v.result) + '</span>' : '') +
      '</li>'
    );
  }

  /* The page inside the device, from StudentView's view. The real
     student page's screens replace this one function. */
  function drawPage(view) {
    /* The student page's own drawing (s/page-view.js, S4-F1): the same HTML
       the student's phone draws for this view, opened on All Assignments so
       every piece and its result is in sight. */
    return StudentPageView.html(view, { all: true });
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

  function _seesHtml(first, cid) {
    return (
      '<section class="ps-card" aria-labelledby="ps-sees-title"><h3 class="ps-card-title" id="ps-sees-title">' +
      esc(first + ' Sees') +
      '</h3><ul class="ps-items">' +
      _item(
        'Your Result',
        'Each returned piece, in this class’s grading style (' + STYLE_NAMES[courseGradeMode(cid)] + ').',
      ) +
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
      '</ul></section>'
    );
  }

  /* ── The preview ───────────────────────────────────────────── */

  // html-safe: every name, title, date line and result goes through esc() (rowHtml, drawPage, _item); the device and the rest are fixed markup
  function _previewHtml() {
    var cid = _open.cid;
    var sid = _open.sid;
    var st = _student(cid, sid) || {};
    var first = displayNameFirst(st) || 'The student';
    var full = displayNameWithLast(st) || first;
    var built = StudentView.fromCache(cid, sid);
    var screen = built.ready
      ? drawPage(built.view)
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
      _seesHtml(first, cid) +
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
    if (focusKey) {
      var again = el.querySelector(focusKey);
      if (again) again.focus();
    }
  }

  /* Opens the preview of student `sid` in class `cid`. `trigger` is the
     control that opened it; the focus goes back to `returnFocusId` (or the
     trigger) when it closes. */
  function open(cid, sid, trigger, returnFocusId) {
    if (!cid || !sid || !_student(cid, sid)) return false;
    close();
    _open = { cid: cid, sid: sid, device: 'phone', trigger: trigger || null, returnTo: returnFocusId || null };
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
      if (d) setDevice(d.dataset.psDevice);
    });
    _onKey = function (e) {
      if (!_open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        var box = _overlay();
        var all = box ? Array.prototype.slice.call(box.querySelectorAll('button')) : [];
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
    if (_onKey) document.removeEventListener('keydown', _onKey, true);
    if (_onLeave && typeof window.removeEventListener === 'function') window.removeEventListener('popstate', _onLeave);
    _onKey = _onLeave = null;
    if (el) el.remove();
    if (!was) return;
    var back = (was.returnTo && document.getElementById(was.returnTo)) || was.trigger;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
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
    // The one function the student page's real screens replace (see the top).
    drawPage: drawPage,
    _test: { rowView: rowView, className: className },
  };
})();
