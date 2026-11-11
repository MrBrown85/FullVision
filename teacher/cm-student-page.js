/* Class Settings → Student Page tab (docs/plans/student-page-build-plan.md,
   S1; board "Teacher: Class Settings, Student Page").

   The tab is there only for a class whose student page is on (the build
   switch, course.student_page_enabled, read through getReturnSettings). For
   every other class it has no button, no address and no panel, unless the
   app was opened at the build address (below).

   What is on it:

   - S1-F4: Return Grades (When I Return Them, As Soon As I Save).
   - S0-W1, S3-W1, S3-F2: Student Cards, the list (no code shown) with
     Make and Print, Print Again, Print New Card, New Codes for This Class,
     Unlock and Unlock All (teacher/student-cards.js).
   - S0-W1: the build switch itself, at the build address only.
   - S4-F6: Preview as Student, a student list and Preview
     (teacher/preview-student.js).

   What later PRs add, none of which needs to change dash-class-manager.js:

   - S3-F1: the rest of Student Cards (filters, Cards Work Until).
   - S5-F1: Send Work and Keep Photos Until, in Demo Mode (below).
   - S8-F1: the "photos go for good" line on Keep Photos Until, and the
     one-week reminder (below), here and on the Dashboard.
   - S13-F1: Show My Learning and See What They'd See, in Demo Mode (below).
   - Then Reflect on Feedback (S10).

   DashClassManager asks isShown(cid) before it draws the tab, opens it or
   builds its panel, and while the tab is shown hands over every sp* action,
   change and blur.

   RETURN GRADES is the class's return_grades setting: 'on_return' (When I
   Return Them), 'on_save' (As Soon As I Save), or no choice made, which
   works as As Soon As I Save.

   - No choice made (a class from before the setting): When I Return Them is
     the first choice offered, neither is marked as chosen, and a line says
     what the class does until the teacher picks. Opening the tab saves
     nothing: a class never changes how it returns grades because its
     teacher looked.
   - Leaving When I Return Them returns every grade that waits (DECISIONS,
     Student page build rulings 8). With grades waiting the tab asks first
     and names how many; Cancel leaves the setting and every one of them as
     they were.

   THE BUILD SWITCH is the class's student_page_enabled, off for every class
   until its teacher turns it on. Nothing in the app offers it. It shows, as
   a Student Page switch in a card of its own above the rest, only when the
   app was opened at an address that carries ?build=student-page, for
   example
     /dashboard?manage=student-page&build=student-page
   The address is read once, when this file loads (the app tidies its
   address afterwards), and holds until the page is reloaded without it.
   Opened that way, a class whose student page is off has the tab too, with
   the switch alone on it. Turning the switch off is leaving When I Return
   Them: with grades waiting it asks first, in the same words.

   BOTH ARE SAVED through saveReturnSettings (shared/data.js), the one
   writer of the two settings, and through nothing else: a change of either
   sends that one setting, never this device's copy of the other. In Demo
   Mode every change is made at once. For a signed-in teacher:

   - A change that starts the class holding grades (the switch turned on;
     When I Return Them chosen) is asked of the server first and shows here
     only when the server has answered. Offline or refused, a line under the
     control says it could not be changed, and nothing has changed.
   - A change that stops it (As Soon As I Save; the switch off) first asks
     the server how many grades wait (the count on this device can be
     short: draftsWaitingToReturn says why). If that cannot be read the
     change is not made, and a line says so: a class never returns its
     drafts without the teacher having been asked about the true number.
     Then it is made here at once and sent. */
var CmStudentPage = (function () {
  'use strict';

  var RETURN_CHOICES = [
    { value: 'on_return', label: 'When I Return Them' },
    { value: 'on_save', label: 'As Soon As I Save' },
  ];

  // True when the app was opened at the build address (see the top).
  function _addressHasBuildFlag() {
    try {
      return new URLSearchParams(window.location.search).get('build') === 'student-page';
    } catch (e) {
      return false;
    }
  }
  var _buildFlag = _addressHasBuildFlag();

  function _settings(cid) {
    return typeof getReturnSettings === 'function' && cid ? getReturnSettings(cid) : null;
  }

  // Whether this class has the tab: with its student page on, or, at the
  // build address, any class (to turn it on).
  function isShown(cid) {
    // Class Settings asks this of the class it is on, each time it draws.
    _classOnScreen = cid || null;
    var s = _settings(cid);
    if (!s) return false;
    return s.student_page === true || (_buildFlag && typeof COURSES !== 'undefined' && !!COURSES[cid]);
  }

  // The class Class Settings last asked this tab about: the one it is on.
  var _classOnScreen = null;

  function _rerender() {
    if (typeof DashClassManager === 'undefined' || !DashClassManager.renderClassManager) return;
    // An answer that comes after Class Settings has closed draws nothing:
    // drawing it would put Class Settings back over the page the teacher
    // went to.
    if (DashClassManager.classManagerOpen) DashClassManager.renderClassManager();
  }

  // True while Class Settings is open on this class.
  function _stillHere(cid) {
    return (
      typeof DashClassManager !== 'undefined' && DashClassManager.classManagerOpen === true && _classOnScreen === cid
    );
  }

  function _cid(el) {
    var box = el && el.closest ? el.closest('[data-cid]') : null;
    return box ? box.dataset.cid : null;
  }

  /* ── Changing one of the two settings ──────────────────────── */

  var COULD_NOT_CHANGE = 'Could not change this. Check the connection and try again.';
  var COULD_NOT_COUNT = 'Could not check for grades waiting to be returned. Check the connection and try again.';

  // What the tab is in the middle of, by class: { busy: { row, want }, note: { row, text } }.
  var _state = {};
  function _st(cid) {
    return _state[cid] || (_state[cid] = { busy: null, note: null });
  }

  function _focus(id) {
    var el = typeof document !== 'undefined' && id ? document.getElementById(id) : null;
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  // True when the class already has what a change asked for.
  function _inEffect(cid, change) {
    var now = _settings(cid);
    if (!now || !change) return false;
    if ('student_page_enabled' in change && now.student_page !== change.student_page_enabled) return false;
    if ('return_grades' in change && now.return_grades !== change.return_grades) return false;
    return true;
  }

  // The line under a row: what it is waiting on, or why it did not change.
  function _lineFor(cid, row) {
    var st = _st(cid);
    // "Could not change this" goes once the class has the change after all
    // (the server made it and only its answer was lost; the class has been
    // read again since).
    if (st.note && st.note.want && _inEffect(cid, st.note.want)) st.note = null;
    if (st.busy && st.busy.row === row) {
      return '<div class="cm-hint sp-note" id="sp-' + row + '-note" role="status">Changing…</div>';
    }
    if (st.note && st.note.row === row) {
      return '<div class="cm-hint sp-note" id="sp-' + row + '-note" role="status">' + esc(st.note.text) + '</div>';
    }
    return '';
  }

  // Still this tab's to change? The class may have lost the tab while a
  // question was up or the server was answering.
  function _mayChange(cid, row) {
    if (!isShown(cid)) return false;
    return row === 'switch' ? _buildFlag : _settings(cid).student_page === true;
  }

  /* The tab's one writer. `change` is what saveReturnSettings takes: the
     one setting the click changes. Made at once (Demo Mode, and a change
     that stops the class holding), the tab is redrawn with it. Asked of
     the server first, the row says Changing… until it answers. */
  function _make(cid, row, change, focusId) {
    if (!_mayChange(cid, row)) return;
    var st = _st(cid);
    var done = function (out) {
      st.busy = null;
      st.note = out && out.ok ? null : { row: row, text: COULD_NOT_CHANGE, want: change };
      _rerender();
      if (_stillHere(cid)) _focus(focusId);
    };
    var asked = saveReturnSettings(cid, change);
    if (asked.now) {
      done(asked.now);
      return;
    }
    st.busy = { row: row, want: change };
    st.note = null;
    _rerender();
    asked.then(done, function () {
      done({ ok: false });
    });
  }

  // The question asked before a class stops holding grades with `n`
  // waiting. The message is ruling 8's.
  function _leaveQuestion(n) {
    return n === 1
      ? {
          title: 'Return 1 Grade Now?',
          message: '1 grade is waiting as a draft. Changing this returns it to the student now.',
        }
      : {
          title: 'Return ' + n + ' Grades Now?',
          message: n + ' grades are waiting as drafts. Changing this returns them to students now.',
        };
  }

  /* A change that stops the class holding grades: how many wait is found
     first (draftsWaitingToReturn: this device's count in Demo Mode, the
     server's for a signed-in teacher). With any waiting the tab asks; with
     the number not known the change is not made. */
  function _askThenMake(cid, row, change, focusId) {
    if (!_mayChange(cid, row)) return;
    var st = _st(cid);
    var waited = false;
    var counted = function (out) {
      st.busy = null;
      // The count took a moment and the teacher has closed Class Settings,
      // or opened another class in it: the question is not put up over
      // whatever is on screen now. Nothing was changed; nothing is returned.
      if (waited && !_stillHere(cid)) {
        st.note = null;
        return;
      }
      var n = out ? out.count : null;
      if (n == null) {
        st.note = { row: row, text: COULD_NOT_COUNT };
        _rerender();
        _focus(focusId);
        return;
      }
      st.note = null;
      if (!n) {
        _make(cid, row, change, focusId);
        return;
      }
      // The row said Changing… while the count was fetched: it is drawn as
      // it was again before the question goes up, so Cancel leaves a
      // control that can be pressed.
      if (waited) {
        _rerender();
        _focus(focusId);
      }
      var q = _leaveQuestion(n);
      showConfirm(q.title, q.message, 'Return and Change', 'primary', function () {
        _make(cid, row, change, focusId);
      });
    };
    var asked = draftsWaitingToReturn(cid);
    if (asked.now) {
      counted(asked.now);
      return;
    }
    waited = true;
    st.busy = { row: row, want: null };
    st.note = null;
    _rerender();
    asked.then(counted, function () {
      counted(null);
    });
  }

  /* ── Return Grades ─────────────────────────────────────────── */

  function _returnGradesRow(cid) {
    var chosen = _settings(cid).return_grades;
    return (
      '<div class="sp-row">' +
      '<div class="sp-row-head">' +
      '<div class="sp-row-title" id="sp-return-label">Return Grades</div>' +
      '<div class="cm-hint" id="sp-return-hint">' +
      esc("When a grade shows on a student's page. Until then it's a draft only you can see.") +
      '</div>' +
      '</div>' +
      '<div class="seg cm-seg" role="radiogroup" aria-labelledby="sp-return-label" aria-describedby="sp-return-hint">' +
      RETURN_CHOICES.map(function (c) {
        var on = c.value === chosen;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (on ? ' active' : '') +
          '" id="sp-return-' +
          c.value +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="spReturnGrades" data-value="' +
          c.value +
          '">' +
          esc(c.label) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      _lineFor(cid, 'return') +
      (chosen
        ? ''
        : '<div class="cm-hint" id="sp-return-unset">' +
          esc("You haven't chosen yet. Until you do, a grade shows as soon as you save it.") +
          '</div>') +
      '<div class="cm-hint">' +
      esc('A change to a returned grade follows the same rule, and the student sees it marked Updated.') +
      '</div>' +
      '</div>'
    );
  }

  function _chooseReturnGrades(cid, value) {
    if (!_mayChange(cid, 'return') || _st(cid).busy) return;
    var known = RETURN_CHOICES.some(function (c) {
      return c.value === value;
    });
    if (!known || _settings(cid).return_grades === value) return;
    var change = { return_grades: value };
    // The redraw makes the chosen button a new element: the focus goes back to it.
    if (value === 'on_return') _make(cid, 'return', change, 'sp-return-' + value);
    else _askThenMake(cid, 'return', change, 'sp-return-' + value);
  }

  /* ── Send Work and Keep Photos Until (S5-F1) ───────────────────
     Send Work is the class's switch for students sending photos or files
     (course.send_work, off), and Keep Photos Until when they are deleted
     (course.keep_photos_until: End of Year, the default, or End of Term;
     DECISIONS, Grades, photos and sign-in 5). Keep Photos Until shows only
     while Send Work is on.

     Demo Mode first: the server's columns come with Batch B, which is not
     applied. So the two rows are drawn in Demo Mode only; for a signed-in
     teacher they are not drawn at all and nothing is asked of the server.
     They are kept with Demo Mode's student work (getCourseSendWork,
     saveDemoStudentWork in shared/data.js), read through workSettings. The line under Keep Photos Until and the
     Delete Photos Now? question are Colin's (ruling 102); the reminder it
     promises and the deleting itself come with S8. */
  var KEEP_CHOICES = [
    { value: 'end_of_term', label: 'End of Term' },
    { value: 'end_of_year', label: 'End of Year' },
  ];

  // Demo Mode: the one place the two rows are drawn until S5-W1.
  function _demo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }

  /* The class's Send Work and Keep Photos Until, as the screens read them:
     { offered, send_work, keep_photos_until }, from getCourseSendWork
     (shared/data.js, S5-F5). `offered` is false where the rows are not
     drawn (a signed-in teacher, or the student page off), and then
     send_work is false too: nothing about student work shows anywhere. */
  function workSettings(cid) {
    var s = _settings(cid);
    var offered = !!s && s.student_page === true && _demo() && typeof getCourseSendWork === 'function';
    var w = offered ? getCourseSendWork(cid) : { send_work: false, keep_photos_until: 'end_of_year' };
    return {
      offered: offered,
      send_work: offered && w.send_work === true,
      keep_photos_until: w.keep_photos_until === 'end_of_term' ? 'end_of_term' : 'end_of_year',
    };
  }

  /* The day photos are deleted for a choice, 'YYYY-MM-DD'. End of Year is
     June 30 of the school year the class is in today. End of Term is the
     last day of the reporting term the class is in today, else the next
     to end; with every term past, the last one (a day already gone); with
     no reporting terms, June 30. */
  function _today(cid) {
    return typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
  }
  function keepPhotosDate(cid, choice, onDay) {
    var today = onDay || _today(cid);
    var y = parseInt(today.slice(0, 4), 10);
    var june = (parseInt(today.slice(5, 7), 10) >= 8 ? y + 1 : y) + '-06-30';
    if (choice !== 'end_of_term') return june;
    var ends = (typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [])
      .map(function (t) {
        return t.ends_on;
      })
      .filter(function (d) {
        return /^\d{4}-\d{2}-\d{2}$/.test(d);
      })
      .sort();
    if (!ends.length) return june;
    var ahead = ends.filter(function (d) {
      return d >= today;
    });
    return ahead.length ? ahead[0] : ends[ends.length - 1];
  }
  function _day(iso, month) {
    var d = new Date(iso + 'T12:00:00Z');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: month, day: 'numeric', timeZone: 'UTC' });
  }
  function _longDay(iso) {
    return _day(iso, 'long');
  }

  // Demo Mode's one writer of student work (saveDemoStudentWork), with the
  // class's two settings changed and everything else as it was.
  function _saveWork(cid, change) {
    var work = getCourseSubmissions(cid);
    work.course = Object.assign({}, work.course, change);
    saveDemoStudentWork(cid, work);
    _rerender();
  }

  function _sendWorkRows(cid) {
    var w = workSettings(cid);
    if (!w.offered) return '';
    var keep = w.send_work
      ? '<div class="sp-row-head">' +
        '<div class="sp-row-title sp-keep-title" id="sp-keep-label">Keep Photos Until</div>' +
        '</div>' +
        '<div class="seg cm-seg" role="radiogroup" aria-labelledby="sp-keep-label" aria-describedby="sp-keep-hint">' +
        KEEP_CHOICES.map(function (c) {
          var on = c.value === w.keep_photos_until;
          return (
            '<button type="button" class="seg-btn cm-seg-btn' +
            (on ? ' active' : '') +
            '" id="sp-keep-' +
            c.value +
            '" role="radio" aria-checked="' +
            on +
            '" data-action="spKeepPhotos" data-value="' +
            c.value +
            '">' +
            esc(c.label) +
            '</button>'
          );
        }).join('') +
        '</div>' +
        '<div class="cm-hint" id="sp-keep-hint">' +
        esc(
          'Photos of student work in this class are deleted on ' +
            _longDay(keepPhotosDate(cid, w.keep_photos_until)) +
            ". Grades, comments and Mark Up stay. Deleted photos can't come back. You'll get a reminder a week before.",
        ) +
        '</div>'
      : '';
    return (
      '<div class="sp-row sp-send">' +
      '<div class="cm-recent-limit sp-send-row">' +
      '<span class="cm-recent-text"><label class="sp-row-title" for="sp-send-switch">Send Work</label>' +
      '<span class="cm-hint" id="sp-send-hint">' +
      esc('Students send photos or files for an assignment you set to take student work.') +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="sp-send-switch" data-action-change="spSendWork" aria-describedby="sp-send-hint"' +
      (w.send_work ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>' +
      keep +
      '</div>'
    );
  }

  function _turnSendWork(cid, el) {
    if (!cid || !workSettings(cid).offered) return;
    var on = !!(el && el.checked);
    if (on === workSettings(cid).send_work) return;
    _saveWork(cid, { send_work: on });
    _focus('sp-send-switch');
  }

  function _chooseKeepPhotos(cid, value) {
    var w = cid ? workSettings(cid) : null;
    if (!w || !w.send_work) return;
    var known = KEEP_CHOICES.some(function (c) {
      return c.value === value;
    });
    if (!known || w.keep_photos_until === value) return;
    var choose = function () {
      _saveWork(cid, { keep_photos_until: value });
      _focus('sp-keep-' + value);
    };
    var on = keepPhotosDate(cid, value);
    // A day already gone deletes the photos tonight: ask first (ruling 102).
    if (on >= _today(cid)) return choose();
    var name = typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name ? COURSES[cid].name : 'this class';
    showConfirm(
      'Delete Photos Now?',
      'End of Term was ' +
        _day(on, 'short') +
        ', so this deletes the photos of student work in ' +
        name +
        " tonight. Deleted photos can't come back.",
      'Delete Photos',
      'danger',
      choose,
    );
  }

  /* ── The one-week reminder (S8-F1) ─────────────────────────────
     Colin's words (ruling 102, s8-f1-wording-draft.md item 2), in the app
     only: a line at the top of the class's Dashboard and of this tab, from
     one week before the class's Keep Photos Until date until that date, or
     until the teacher presses Dismiss. Change the Date opens this tab at
     Keep Photos Until.

     Shown only where it is true: the class's build switch on, Send Work on
     (Keep Photos Until, which Change the Date opens, shows only then), and
     photos of student work kept for the class (classHasPhotos). The job
     that deletes them (S8-M1) is not built, so until it is no signed-in
     class has photos here and the line never shows for one.

     Dismiss is kept on this device, for the class and the date: a new date
     brings the line back. It sends nothing; DashOverview keeps it (this tab
     writes only through saveReturnSettings and Demo Mode's student work). `today` is an argument (tests pass it); the screens
     pass nothing and get the class's own day (courseToday). */
  var REMIND_DAYS = 7;

  /* True when the class has photos of student work that would be deleted:
     with its build switch on, a submission with at least one page. The same
     question the delete warnings ask (dash-class-manager.js,
     _cmStudentsWithPhotos; page-gradebook.js, _studentsWithSentPhotos). */
  function classHasPhotos(cid) {
    if (!cid || typeof getCourseSubmissions !== 'function') return false;
    var s = _settings(cid);
    if (!s || s.student_page !== true) return false;
    return (getCourseSubmissions(cid).submissions || []).some(function (sub) {
      return !!sub && Array.isArray(sub.files) && sub.files.length > 0;
    });
  }

  function _dismissedOn(cid) {
    return typeof DashOverview !== 'undefined' && DashOverview.photoReminderDismissed
      ? DashOverview.photoReminderDismissed(cid)
      : null;
  }

  function _daysBetween(fromIso, toIso) {
    var a = Date.parse(fromIso + 'T12:00:00Z');
    var b = Date.parse(toIso + 'T12:00:00Z');
    return isNaN(a) || isNaN(b) ? NaN : Math.round((b - a) / 86400000);
  }

  /* The reminder for class `cid` on `today` ('YYYY-MM-DD'), or null:
     { date, text }. */
  function photoReminder(cid, today) {
    if (!classHasPhotos(cid)) return null;
    var day = today || _today(cid);
    var w = workSettings(cid);
    if (!w.send_work) return null;
    var date = keepPhotosDate(cid, w.keep_photos_until, day);
    var left = _daysBetween(day, date);
    if (!(left >= 0 && left <= REMIND_DAYS)) return null;
    if (_dismissedOn(cid) === date) return null;
    var name = typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name ? COURSES[cid].name : 'this class';
    return {
      date: date,
      text:
        'Photos of student work in ' +
        name +
        ' are deleted on ' +
        _longDay(date) +
        ". Grades, comments and Mark Up stay. Deleted photos can't come back.",
    };
  }

  // Dismiss: remembered for the class and that date only.
  function dismissPhotoReminder(cid, date) {
    if (!cid || !date || typeof DashOverview === 'undefined' || !DashOverview.dismissPhotoReminder) return;
    DashOverview.dismissPhotoReminder(cid, date);
  }

  /* The line and its two buttons. `where` is 'dash' (the Dashboard, whose
     actions page-dashboard.js handles) or 'sp' (this tab). */
  function photoReminderHtml(cid, where, today) {
    var r = photoReminder(cid, today);
    if (!r) return '';
    var pre = where === 'sp' ? 'sp' : 'dash';
    return (
      '<div class="photo-reminder" id="' +
      pre +
      '-photo-reminder" data-cid="' +
      esc(cid) +
      '">' +
      '<p class="photo-reminder-text">' +
      esc(r.text) +
      '</p>' +
      '<div class="photo-reminder-actions">' +
      '<button type="button" class="btn btn-secondary" data-action="' +
      pre +
      'PhotoReminderChange" data-cid="' +
      esc(cid) +
      '">Change the Date</button>' +
      '<button type="button" class="btn btn-ghost" data-action="' +
      pre +
      'PhotoReminderDismiss" data-cid="' +
      esc(cid) +
      '" data-date="' +
      esc(r.date) +
      '">Dismiss</button>' +
      '</div>' +
      '</div>'
    );
  }

  // Change the Date: Keep Photos Until's chosen button, in view and focused.
  function focusKeepPhotos(cid) {
    var w = workSettings(cid);
    var el = typeof document !== 'undefined' ? document.getElementById('sp-keep-' + w.keep_photos_until) : null;
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  /* ── Show My Learning (S13-F1) ─────────────────────────────────
     Show My Learning is the class's switch for the student page's My
     Learning tab (DECISIONS, My Learning on the student page 1), off until
     the teacher turns it on. The screens read courseConfig.show_my_learning
     (StudentView.learningOn); this row is its one writer.

     Demo Mode first, as Send Work: the server's column comes with Batch C,
     which is not applied. So the row is drawn in Demo Mode only; for a
     signed-in teacher it is not drawn and nothing is asked of the server.
     It is kept in the class's settings on this device (saveCourseConfig,
     which sends nothing in Demo Mode).

     See What They'd See opens Preview as Student on My Learning for the
     student chosen under Preview as Student (the first by last name until
     one is chosen), as My Learning would be with the switch on. Nothing is
     saved. A student's own device cannot show My Learning yet (the server
     does not send what the calculation needs), and a line says so. */
  var STYLE_NAMES = { proficiency: 'Proficiency', letter: 'Letter', both: 'Both' };

  // { offered, on }: offered only in Demo Mode with the student page on; on only where offered.
  function learningSettings(cid) {
    var s = _settings(cid);
    var offered = !!s && s.student_page === true && _demo() && typeof saveCourseConfig === 'function';
    var cfg = offered ? getCourseConfig(cid) || {} : {};
    return { offered: offered, on: offered && cfg.show_my_learning === true };
  }

  function _learningRow(cid) {
    var l = learningSettings(cid);
    if (!l.offered) return '';
    var style = STYLE_NAMES[typeof courseGradeMode === 'function' ? courseGradeMode(cid) : ''] || 'Proficiency';
    return (
      // Drawn as Send Work's row is (assignments.css, .sp-send): Class Settings' own switch row.
      '<div class="sp-row sp-send sp-learning">' +
      '<div class="cm-recent-limit sp-send-row">' +
      '<span class="cm-recent-text"><label class="sp-row-title" for="sp-learning-switch">Show My Learning</label>' +
      '<span class="cm-hint" id="sp-learning-hint">' +
      esc('Students see their skills, their grade and how it changes over the term.') +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="sp-learning-switch" data-action-change="spShowLearning" aria-describedby="sp-learning-hint"' +
      (l.on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>' +
      '<div class="cm-hint" id="sp-learning-would">' +
      esc(
        'Students would see their level on each skill and their grade in this class’s grading style (' +
          style +
          "), only from work you've returned.",
      ) +
      '</div>' +
      '<div class="cm-hint" id="sp-learning-device">' +
      esc(
        "Students' own phones and Chromebooks can't show My Learning yet, even with this on. For now only Preview as Student shows it.",
      ) +
      '</div>' +
      '<div class="sp-learning-see">' +
      '<button type="button" class="btn btn-secondary" id="sp-learning-see" data-action="spSeeLearning" aria-describedby="sp-learning-would">' +
      esc("See What They'd See") +
      '</button>' +
      '</div>' +
      '</div>'
    );
  }

  function _turnLearning(cid, el) {
    if (!cid || !learningSettings(cid).offered) return;
    var on = !!(el && el.checked);
    if (on === learningSettings(cid).on) return;
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid) || {}, { show_my_learning: on }));
    _rerender();
    _focus('sp-learning-switch');
  }

  // The student Preview as Student's list shows: the one chosen there, else the first.
  function _previewStudent(cid) {
    var students = typeof sortStudents === 'function' ? sortStudents(getStudents(cid) || [], 'lastName') : [];
    var chosen = _previewFor[cid];
    var found = students.some(function (s) {
      return s.id === chosen;
    });
    return found ? chosen : students.length ? students[0].id : null;
  }

  function _seeLearning(cid, el) {
    if (!cid || !learningSettings(cid).offered || typeof PreviewStudent === 'undefined') return;
    var sid = _previewStudent(cid);
    if (!sid) return;
    PreviewStudent.open(cid, sid, el, 'sp-learning-see', { tab: 'learning', learning: true });
  }

  /* ── The build switch ──────────────────────────────────────── */

  // The switch's card: only at the build address. The row is Class
  // Settings' own switch row (Folders Count as One).
  function _buildSwitchCard(cid) {
    var on = _settings(cid).student_page;
    var busy = _st(cid).busy;
    var waiting = !!busy && busy.row === 'switch';
    // While the server is asked to turn it on, the switch shows what was asked.
    var shown = waiting && busy.want && busy.want.student_page_enabled === true ? true : on;
    return (
      '<div class="cm-section sp-build" data-cid="' +
      esc(cid) +
      '">' +
      '<div class="cm-recent-limit sp-build-row">' +
      '<span class="cm-recent-text"><label class="cm-label" for="sp-build-switch">Student Page</label>' +
      '<span class="cm-hint">' +
      esc(
        on
          ? 'On for this class: grades are Draft or Returned, and students can have cards. Still being built.'
          : 'Off for this class. Still being built: turn it on only for a class you are testing with.',
      ) +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="sp-build-switch" data-action-change="spBuildSwitch"' +
      (shown ? ' checked' : '') +
      (waiting ? ' disabled' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>' +
      _lineFor(cid, 'switch') +
      '</div>'
    );
  }

  function _turnBuildSwitch(cid, el) {
    if (!_mayChange(cid, 'switch')) return;
    var on = !!(el && el.checked);
    if (_st(cid).busy) {
      // One thing at a time: the switch stays as it was drawn.
      if (el) el.checked = !on;
      return;
    }
    if (on === _settings(cid).student_page) return;
    if (on) {
      _make(cid, 'switch', { student_page_enabled: true }, 'sp-build-switch');
      return;
    }
    // Still on until the count is known and the teacher has answered;
    // Cancel leaves it so.
    el.checked = true;
    _askThenMake(cid, 'switch', { student_page_enabled: false }, 'sp-build-switch');
  }

  /* ── Preview as Student ────────────────────────────────────── */

  // The student the list shows, by class: the last one previewed.
  var _previewFor = {};

  function _previewCard(cid) {
    if (typeof PreviewStudent === 'undefined') return '';
    var students = typeof sortStudents === 'function' ? sortStudents(getStudents(cid) || [], 'lastName') : [];
    if (!students.length) return '';
    var chosen = _previewFor[cid];
    if (
      !students.some(function (s) {
        return s.id === chosen;
      })
    )
      chosen = students[0].id;
    return (
      '<div class="cm-section sp-preview" data-cid="' +
      esc(cid) +
      '">' +
      '<h2 class="cm-grade-title">Preview as Student</h2>' +
      '<div class="cm-hint" id="sp-preview-hint">' +
      esc('See the page exactly as one student sees it. Nothing is sent.') +
      '</div>' +
      '<div class="sp-preview-row">' +
      '<select class="cm-input sp-preview-select" id="sp-preview-student" data-action-change="spPreviewStudent" aria-label="Student" aria-describedby="sp-preview-hint">' +
      students
        .map(function (s) {
          return (
            '<option value="' +
            esc(s.id) +
            '"' +
            (s.id === chosen ? ' selected' : '') +
            '>' +
            esc(displayNameWithLast(s)) +
            '</option>'
          );
        })
        .join('') +
      '</select>' +
      '<button type="button" class="btn btn-secondary" id="sp-preview-open" data-action="spPreview">Open Preview</button>' +
      '</div>' +
      '</div>'
    );
  }

  function _openPreview(cid, el) {
    if (!cid || _settings(cid).student_page !== true || typeof PreviewStudent === 'undefined') return;
    var box = el && el.closest ? el.closest('.sp-preview') : null;
    var select = box ? box.querySelector('#sp-preview-student') : null;
    var sid = (select && select.value) || _previewFor[cid];
    if (!sid) return;
    _previewFor[cid] = sid;
    PreviewStudent.open(cid, sid, el, 'sp-preview-open');
  }

  /* ── The panel ─────────────────────────────────────────────── */

  // The panel's HTML for a class: nothing for a class without the tab.
  function render(cid) {
    // A preview that is open draws again with the class (rows that loaded,
    // a change); on another class, or one whose page is off, it closes.
    if (typeof PreviewStudent !== 'undefined' && PreviewStudent.isOpen()) {
      if (isShown(cid) && _settings(cid).student_page === true) PreviewStudent.refresh(cid);
      else PreviewStudent.close();
    }
    if (!isShown(cid)) return '';
    var on = _settings(cid).student_page;
    return (
      (_buildFlag ? _buildSwitchCard(cid) : '') +
      (on
        ? '<div class="cm-section sp-card" data-cid="' +
          esc(cid) +
          '">' +
          '<h2 class="cm-grade-title">Student Page</h2>' +
          photoReminderHtml(cid, 'sp') +
          _returnGradesRow(cid) +
          _sendWorkRows(cid) +
          _learningRow(cid) +
          '</div>' +
          (typeof StudentCards !== 'undefined' ? StudentCards.render(cid) : '') +
          _previewCard(cid)
        : '')
    );
  }

  // Each returns true when the click, change or blur was this tab's.
  function handleAction(action, el) {
    if (/^spCards/.test(action)) {
      var cid = _cid(el);
      if (typeof StudentCards === 'undefined' || !cid || _settings(cid).student_page !== true) return false;
      return StudentCards.handleAction(action, el);
    }
    if (action === 'spPreview') {
      _openPreview(_cid(el), el);
      return true;
    }
    if (action === 'spSeeLearning') {
      _seeLearning(_cid(el), el);
      return true;
    }
    if (action === 'spPhotoReminderChange') {
      focusKeepPhotos(_cid(el));
      return true;
    }
    if (action === 'spPhotoReminderDismiss') {
      var on = _cid(el);
      dismissPhotoReminder(on, el && el.dataset ? el.dataset.date : null);
      _rerender();
      if (_stillHere(on)) _focus('sp-keep-' + workSettings(on).keep_photos_until);
      return true;
    }
    if (action === 'spKeepPhotos') {
      _chooseKeepPhotos(_cid(el), el && el.dataset ? el.dataset.value : null);
      return true;
    }
    if (action !== 'spReturnGrades') return false;
    _chooseReturnGrades(_cid(el), el && el.dataset ? el.dataset.value : null);
    return true;
  }

  function handleChange(el) {
    if (el && el.dataset && /^spCards/.test(el.dataset.actionChange || '')) {
      var cid = _cid(el);
      if (typeof StudentCards === 'undefined' || !cid || _settings(cid).student_page !== true) return false;
      return StudentCards.handleChange(el);
    }
    if (el && el.dataset && el.dataset.actionChange === 'spPreviewStudent') {
      var on = _cid(el);
      if (on) _previewFor[on] = el.value;
      return true;
    }
    if (el && el.dataset && el.dataset.actionChange === 'spShowLearning') {
      _turnLearning(_cid(el), el);
      return true;
    }
    if (el && el.dataset && el.dataset.actionChange === 'spSendWork') {
      _turnSendWork(_cid(el), el);
      return true;
    }
    if (!el || !el.dataset || el.dataset.actionChange !== 'spBuildSwitch') return false;
    _turnBuildSwitch(_cid(el), el);
    return true;
  }

  function handleBlur(el) {
    return false;
  }

  // Put the tab back as the address has it, with nothing under way (tests).
  function _reset() {
    _buildFlag = _addressHasBuildFlag();
    _state = {};
    _classOnScreen = null;
    _previewFor = {};
  }
  // Tests: as if the app had been opened at the build address, or not.
  function _setBuildFlag(on) {
    _buildFlag = !!on;
  }

  return {
    isShown: isShown,
    render: render,
    workSettings: workSettings,
    learningSettings: learningSettings,
    keepPhotosDate: keepPhotosDate,
    classHasPhotos: classHasPhotos,
    photoReminder: photoReminder,
    photoReminderHtml: photoReminderHtml,
    dismissPhotoReminder: dismissPhotoReminder,
    focusKeepPhotos: focusKeepPhotos,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _reset: _reset,
    _setBuildFlag: _setBuildFlag,
  };
})();
if (typeof window !== 'undefined') window.CmStudentPage = CmStudentPage;
