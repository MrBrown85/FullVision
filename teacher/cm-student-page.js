/* Class Settings → Student Page tab (docs/plans/student-page-build-plan.md,
   S1; board "Teacher: Class Settings, Student Page").

   Every class has the tab. Its first card is the Student Page switch
   (course.student_page_enabled, read through getReturnSettings), off for
   every class until its teacher turns it on; the rest of the tab shows only
   while it is on.

   What is on it:

   - S1-F4: Return Grades (When I Return Them, As Soon As I Save).
   - S0-W1, S3-W1, S3-F2: Student Cards, the list (no code shown) with
     Make and Print, Print Again, Print New Card, New Codes for This Class,
     Unlock and Unlock All (teacher/student-cards.js).
   - S0-W1: the Student Page switch itself.
   - S4-F6: Preview as Student, a student list and Preview
     (teacher/preview-student.js).

   What later PRs add, none of which needs to change dash-class-manager.js:

   - S3-F1: the rest of Student Cards (filters, Cards Work Until).
   - S5-F1: Send Work, in Demo Mode (below), and the sentence on how long
     photos stay (Nov 17 2026: Keep Photos Until and its reminder are gone).
   - S13-F1: Show My Learning and See What They'd See (below), in Demo
     Mode and, since S13-W2, for a signed-in class.
   - S10 follow-up: the Reflect on Feedback switch, in Demo Mode (below).
   - Per-student options (docs/plans/per-student-options-plan.md, Nov 17
     2026): the card list is the Students list, with a side panel for each
     student, and Show Overall Grade's row names its exceptions
     (teacher/student-page-students.js).

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

   THE SWITCH is the class's student_page_enabled, off for every class
   until its teacher turns it on. It is drawn for every class, as a Student
   Page switch in a card of its own above the rest; a class whose student
   page is off has the switch alone on its tab. It used to be offered only
   at a build address (?build=student-page); Colin ruled on Nov 13 that it
   shows for every teacher, off by default. Turning the switch off is
   leaving When I Return Them: with grades waiting it asks first, in the
   same words.

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

  function _settings(cid) {
    return typeof getReturnSettings === 'function' && cid ? getReturnSettings(cid) : null;
  }

  // Whether this class has the tab: every class there is, on or off (the
  // switch turns it on).
  function isShown(cid) {
    // Class Settings asks this of the class it is on, each time it draws.
    _classOnScreen = cid || null;
    var s = _settings(cid);
    if (!s) return false;
    return s.student_page === true || (typeof COURSES !== 'undefined' && !!COURSES[cid]);
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
    return row === 'switch' ? true : _settings(cid).student_page === true;
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

  /* ── Send Work (S5-F1) ─────────────────────────────────────────
     Send Work is the class's switch for students sending photos or files
     (course.send_work, off). Under it, while Send Work is on or the class
     has photos kept (classHasPhotos), one sentence says how long photos stay
     (DECISIONS, "Photos stay with the class", Nov 17 2026): there is no
     choice to make.

     Drawn in Demo Mode and for a signed-in class whose student page the
     server has on (studentWorkLive, S5-W1). Read through workSettings
     (getCourseSendWork) and saved through setCourseSendWork in
     shared/data.js: Demo Mode keeps it with its sample work, a signed-in
     class sends set_course_send_work. */
  var PHOTOS_STAY =
    "Photos stay as long as this class exists. They're deleted when the class is deleted, or after a year without being opened.";

  function _demo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }
  // Demo Mode, or a signed-in class whose student work is the server's.
  function _workHere(cid) {
    return _demo() || (typeof studentWorkLive === 'function' && studentWorkLive(cid));
  }

  /* The class's Send Work, as the screens read it: { offered, send_work },
     from getCourseSendWork (shared/data.js, S5-F5). `offered` is false where
     the rows are not drawn (a signed-in teacher, or the student page off),
     and then send_work is false too: nothing about student work shows
     anywhere. */
  function workSettings(cid) {
    var s = _settings(cid);
    var offered = !!s && s.student_page === true && _workHere(cid) && typeof getCourseSendWork === 'function';
    var w = offered ? getCourseSendWork(cid) : { send_work: false };
    return { offered: offered, send_work: offered && w.send_work === true };
  }

  // The one writer of the class's Send Work (setCourseSendWork).
  function _saveWork(cid, change) {
    setCourseSendWork(cid, change);
    _rerender();
  }

  function _sendWorkRows(cid) {
    var w = workSettings(cid);
    if (!w.offered) return '';
    var stay =
      w.send_work || classHasPhotos(cid)
        ? '<div class="cm-hint sp-photos-stay" id="sp-photos-stay">' + esc(PHOTOS_STAY) + '</div>'
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
      stay +
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

  /* Who in class `cid` has photos of their work kept, { enrollment_id: true },
     from the read side in shared/data.js (getCourseSubmissions): a submission
     with at least one page, whoever sent it; for one assessment when `aid` is
     given. Empty while the class's build switch is off. Send Work is not
     asked: photos sent before it was turned off are still kept. The one
     question the delete warnings (dash-class-manager.js, page-gradebook.js)
     and the sentence above ask. */
  function studentsWithPhotos(cid, aid) {
    var who = {};
    if (!cid || typeof getCourseSubmissions !== 'function') return who;
    var s = _settings(cid);
    if (!s || s.student_page !== true) return who;
    (getCourseSubmissions(cid).submissions || []).forEach(function (sub) {
      if (!sub || !Array.isArray(sub.files) || !sub.files.length) return;
      if (aid && sub.assessment_id !== aid) return;
      who[sub.enrollment_id] = true;
    });
    return who;
  }

  // True when the class has photos of student work kept.
  function classHasPhotos(cid) {
    return Object.keys(studentsWithPhotos(cid)).length > 0;
  }

  /* ── Reflect on Feedback (S10 follow-up) ───────────────────────
     The class's switch for Reflect on Feedback (courseConfig.
     reflect_on_feedback, off until the teacher turns it on): after work
     comes back, students say if it made sense, ask a question and make a
     plan. The screens built in S10 read it through getReflectOnFeedback.

     Drawn in Demo Mode and in a signed-in class the server keeps
     student-page rows for (S10-W1). Its one writer is
     setCourseFeedbackOptions (shared/data.js): in Demo Mode it keeps the
     switch in the class's settings and sends nothing; signed in it is
     set_course_feedback_options through the outbox, and getCourseFeedbackOptions
     reads it. */

  // { offered, on }: offered in Demo Mode, or a signed-in class the server keeps rows for, with the student page on; on only where offered.
  function reflectSettings(cid) {
    var s = _settings(cid);
    var live = typeof studentWorkLive === 'function' && studentWorkLive(cid);
    var offered =
      !!s &&
      s.student_page === true &&
      (_demo() || live) &&
      typeof setCourseFeedbackOptions === 'function' &&
      typeof getCourseFeedbackOptions === 'function';
    return { offered: offered, on: offered && getCourseFeedbackOptions(cid).reflect_on_feedback === true };
  }

  function _reflectRow(cid) {
    var r = reflectSettings(cid);
    if (!r.offered) return '';
    return (
      // Drawn as Send Work's row is: Class Settings' own switch row.
      '<div class="sp-row sp-send sp-reflect">' +
      '<div class="cm-recent-limit sp-send-row">' +
      '<span class="cm-recent-text"><label class="sp-row-title" for="sp-reflect-switch">Reflect on Feedback</label>' +
      '<span class="cm-hint" id="sp-reflect-hint">' +
      esc(
        'After you return work, students can say if it made sense, ask you a question and make a plan for next time.',
      ) +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="sp-reflect-switch" data-action-change="spReflect" aria-describedby="sp-reflect-hint"' +
      (r.on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>' +
      '</div>'
    );
  }

  function _turnReflect(cid, el) {
    if (!cid || !reflectSettings(cid).offered) return;
    var on = !!(el && el.checked);
    if (on === reflectSettings(cid).on) return;
    var key =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'rf-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    var done = function () {
      // Drawn again only while Class Settings is still on this class.
      if (!_stillHere(cid)) return;
      _rerender();
      _focus('sp-reflect-switch');
    };
    setCourseFeedbackOptions(cid, { reflect_on_feedback: on }, key).then(done, done);
  }

  /* ── Show My Learning (S13-F1, S13-W2) ────────────────────────
     Show My Learning is the class's switch for the student page's My
     Learning tab (DECISIONS, My Learning on the student page 1), off until
     the teacher turns it on: course.show_my_learning (Batch C), which
     student_submit.page reads to send a student's card My Learning
     (Batch E, E9).

     Offered where Reflect on Feedback is, under the same rule: Demo Mode,
     or a signed-in class the server keeps student-page rows for
     (studentWorkLive), with the student page on. Its one writer is
     setCourseFeedbackOptions, as Reflect's is: in Demo Mode it keeps the
     switch in the class's settings and sends nothing; signed in it is
     set_course_feedback_options through the outbox, and
     getCourseFeedbackOptions reads it. A save the server refuses puts the
     switch back when the row is drawn again; the sync dot says the rest.

     See What They'd See opens Preview as Student on My Learning for the
     student chosen under Preview as Student (the first by last name until
     one is chosen), as My Learning would be with the switch on. Nothing is
     saved. A student's card shows the same: page sends this student's own
     hand-set levels with the rest (E9), and the edge function adds the
     Next Step sentences. */
  var STYLE_NAMES = { proficiency: 'Proficiency', letter: 'Letter', both: 'Both' };

  // { offered, on }: offered where Reflect on Feedback is (reflectSettings); on only where offered.
  function learningSettings(cid) {
    var offered = reflectSettings(cid).offered;
    return { offered: offered, on: offered && getCourseFeedbackOptions(cid).show_my_learning === true };
  }

  function _learningRow(cid) {
    var l = learningSettings(cid);
    if (!l.offered) return '';
    var style = STYLE_NAMES[typeof courseGradeMode === 'function' ? courseGradeMode(cid) : ''] || 'Proficiency';
    return (
      // Drawn as Send Work's row is (assignments.css, .sp-send): Class Settings' own switch row.
      '<div class="sp-row sp-send sp-learning">' +
      '<div class="cm-recent-limit sp-send-row">' +
      '<span class="cm-recent-text"><label class="sp-row-title" for="sp-learning-switch">Show Overall Grade</label>' +
      '<span class="cm-hint" id="sp-learning-hint">' +
      esc(
        'Students see their overall grade, from work you’ve returned, at the top of My Learning. Off, they still see each piece’s result.',
      ) +
      '</span>' +
      // The students who see otherwise than the class (per-student options): narrows the list to Exceptions.
      (typeof StudentPageStudents !== 'undefined' ? StudentPageStudents.exceptionsHtml(cid) : '') +
      '</span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="sp-learning-switch" data-action-change="spShowLearning" aria-describedby="sp-learning-hint"' +
      (l.on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>' +
      // The board's grey panel: what they would see, and See What They'd See after it as a link.
      '<div class="sp-learning-panel">' +
      '<span id="sp-learning-would">' +
      esc(
        'Students would see their grade in this class’s grading style (' + style + "), only from work you've returned.",
      ) +
      '</span> ' +
      '<button type="button" class="sp-link-btn" id="sp-learning-see" data-action="spSeeLearning" aria-describedby="sp-learning-would">' +
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
    var key =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'ml-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    var done = function () {
      // Drawn again only while Class Settings is still on this class: a refused save shows the switch back as it was.
      if (!_stillHere(cid)) return;
      _rerender();
      _focus('sp-learning-switch');
    };
    var sent = setCourseFeedbackOptions(cid, { show_my_learning: on }, key);
    // The change shows at once (Demo Mode keeps it; signed in it is laid over the server's until answered).
    _rerender();
    _focus('sp-learning-switch');
    sent.then(done, done);
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

  /* ── The Student Page switch ───────────────────────────────── */

  // The switch's card, on every class's tab. The row is Class Settings'
  // own switch row (Folders Count as One).
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
          ? 'On for this class: grades are Draft or Returned, and students can have cards.'
          : 'Off for this class. Turn it on to give students a card that opens their own page.',
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
      '<button type="button" class="btn sp-tint-btn" id="sp-preview-open" data-action="spPreview">Open Preview</button>' +
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

  /* ── Reflections ────────────────────────────────────────────── */

  // Nothing to choose here: the row says where they are set up (the board's last row).
  function _questionnairesRow() {
    return (
      '<div class="sp-row sp-questionnaires">' +
      '<div class="sp-row-head">' +
      '<div class="sp-row-title">Reflections</div>' +
      '<div class="cm-hint">' +
      esc(
        'Students answer them on their page’s Reflect tab, with the same card. Turn them on under Reflect, here in Class Settings.',
      ) +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* ── The panel ─────────────────────────────────────────────── */

  // The panel's HTML for a class: nothing for a class without the tab.
  // A preview that is open draws again with the class (rows that loaded,
  // a change); on another class, or one whose page is off, it closes. Class
  // Settings asks this on every draw, on this tab or another.
  function followPreview(cid) {
    if (typeof PreviewStudent !== 'undefined' && PreviewStudent.isOpen()) {
      if (isShown(cid) && _settings(cid).student_page === true) PreviewStudent.refresh(cid);
      else PreviewStudent.close();
    }
  }

  function render(cid) {
    followPreview(cid);
    if (!isShown(cid)) return '';
    var on = _settings(cid).student_page;
    return (
      _buildSwitchCard(cid) +
      (on
        ? '<div class="sp-layout"><div class="sp-main">' +
          '<div class="cm-section sp-card" data-cid="' +
          esc(cid) +
          '">' +
          '<h2 class="cm-grade-title">Student Page</h2>' +
          '<div class="cm-hint sp-intro">' +
          esc('What students can do when they open their page with their card. Each one is off until you turn it on.') +
          '</div>' +
          _returnGradesRow(cid) +
          _sendWorkRows(cid) +
          _reflectRow(cid) +
          _learningRow(cid) +
          _questionnairesRow() +
          '</div>' +
          (typeof StudentCards !== 'undefined' ? StudentCards.render(cid) : '') +
          '</div>' +
          // The board's right column: the cards in short, and Preview as Student.
          '<div class="sp-aside">' +
          (typeof StudentCards !== 'undefined' ? StudentCards.summaryHtml(cid) : '') +
          _previewCard(cid) +
          '</div>' +
          '</div>'
        : _stickersCard(cid))
    );
  }

  /* With the student page off there are no cards, and no card to hold Print
     Sticker Sheets: its row stands on its own (Add Work for the Class, and
     with it the stickers, is in every class). */
  // html-safe: the row is StudentCards.stickersHtml's fixed words; the id goes through esc
  function _stickersCard(cid) {
    var row = typeof StudentCards !== 'undefined' && StudentCards.stickersHtml ? StudentCards.stickersHtml(cid) : '';
    if (!row) return '';
    return (
      '<div class="cm-section sp-stickers" data-cid="' +
      esc(cid) +
      '"><h2 class="cm-grade-title">Sticker Sheets for Scanning</h2>' +
      row +
      '</div>'
    );
  }

  // Each returns true when the click, change or blur was this tab's.
  function handleAction(action, el) {
    // Print Sticker Sheets: in every class, student page on or off.
    if (action === 'spCardsStickers') {
      var at = _cid(el);
      if (at && typeof ScanLabels !== 'undefined') ScanLabels.open(at);
      return true;
    }
    // The Students list's ticks, bar and side panel (teacher/student-page-students.js).
    if (/^spStudent/.test(action)) {
      var at2 = _cid(el);
      if (typeof StudentPageStudents === 'undefined' || !at2 || _settings(at2).student_page !== true) return false;
      return StudentPageStudents.handleAction(action, el);
    }
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
    if (action !== 'spReturnGrades') return false;
    _chooseReturnGrades(_cid(el), el && el.dataset ? el.dataset.value : null);
    return true;
  }

  function handleChange(el) {
    if (el && el.dataset && /^spStudent/.test(el.dataset.actionChange || '')) {
      var at = _cid(el);
      if (typeof StudentPageStudents === 'undefined' || !at || _settings(at).student_page !== true) return false;
      return StudentPageStudents.handleChange(el);
    }
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
    if (el && el.dataset && el.dataset.actionChange === 'spReflect') {
      _turnReflect(_cid(el), el);
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

  // Put the tab back with nothing under way (tests).
  function _reset() {
    _state = {};
    _classOnScreen = null;
    _previewFor = {};
  }
  return {
    followPreview: followPreview,
    isShown: isShown,
    render: render,
    workSettings: workSettings,
    learningSettings: learningSettings,
    reflectSettings: reflectSettings,
    classHasPhotos: classHasPhotos,
    studentsWithPhotos: studentsWithPhotos,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.CmStudentPage = CmStudentPage;
