/* Class Settings → Student Page tab (docs/plans/student-page-build-plan.md,
   S1; board "Teacher: Class Settings, Student Page").

   The tab is there only for a class whose student page is on (the build
   switch, course.student_page_enabled, read through getReturnSettings). For
   every other class it has no button, no address and no panel, unless the
   app was opened at the build address (below).

   What is on it:

   - S1-F4: Return Grades (When I Return Them, As Soon As I Save).
   - S0-W1: Student Cards, a bare list with Make Cards and Print All
     (teacher/student-cards.js).
   - S0-W1: the build switch itself, at the build address only.

   What later PRs add, none of which needs to change dash-class-manager.js:

   - S3: the rest of Student Cards (filters, Unlock, Reissue, Cards Work
     Until).
   - S5-F1: Send Work and Keep Photos Until.
   - S8-F1: the reminder and the "photos go for good" line on Keep Photos
     Until.
   - Then Preview as Student (S4), Reflect on Feedback (S10) and Show My
     Learning (S13).

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
    var s = _settings(cid);
    if (!s) return false;
    return s.student_page === true || (_buildFlag && typeof COURSES !== 'undefined' && !!COURSES[cid]);
  }

  function _rerender() {
    if (typeof DashClassManager !== 'undefined' && DashClassManager.renderClassManager) {
      DashClassManager.renderClassManager();
    }
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

  // The line under a row: what it is waiting on, or why it did not change.
  function _lineFor(cid, row) {
    var st = _st(cid);
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
      st.note = out && out.ok ? null : { row: row, text: COULD_NOT_CHANGE };
      _rerender();
      _focus(focusId);
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

  /* ── The panel ─────────────────────────────────────────────── */

  // The panel's HTML for a class: nothing for a class without the tab.
  function render(cid) {
    if (!isShown(cid)) return '';
    var on = _settings(cid).student_page;
    return (
      (_buildFlag ? _buildSwitchCard(cid) : '') +
      (on
        ? '<div class="cm-section sp-card" data-cid="' +
          esc(cid) +
          '">' +
          '<h2 class="cm-grade-title">Student Page</h2>' +
          _returnGradesRow(cid) +
          '</div>' +
          (typeof StudentCards !== 'undefined' ? StudentCards.render(cid) : '')
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
    if (action !== 'spReturnGrades') return false;
    _chooseReturnGrades(_cid(el), el && el.dataset ? el.dataset.value : null);
    return true;
  }

  function handleChange(el) {
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
  }
  // Tests: as if the app had been opened at the build address, or not.
  function _setBuildFlag(on) {
    _buildFlag = !!on;
  }

  return {
    isShown: isShown,
    render: render,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _reset: _reset,
    _setBuildFlag: _setBuildFlag,
  };
})();
if (typeof window !== 'undefined') window.CmStudentPage = CmStudentPage;
