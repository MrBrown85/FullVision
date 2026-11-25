// @ts-check
/* Students in Class Settings › Student Page: per-student options and
   facts (docs/plans/per-student-options-plan.md, Layout A; Colin chose it
   on Nov 17 2026).

   The Student Cards list (teacher/student-cards.js) is the Students list.
   This file adds to it, and to nothing else:

   - The columns Feedback Opened ("12 of 14"), Work Sent ("5 · 1 late") and
     Overall Grade (Shown · Class, Hidden · Class, Hidden, Shown, Page
     Paused), and the filters Feedback Not Opened, Questions and Exceptions.
   - A box to tick on each row, and the bar the ticked rows get: Hide
     Overall Grade (Show, Hide, Use Class Setting), Student Page (Pause,
     Resume), Replace Card (asks first) and Clear Selection.
   - The side panel a student's name opens: when they last opened their
     page, Preview as <first name>, What <first name> Sees (Overall Grade,
     Student Page), What <first name> Has Done, and the Card.
   - The line under Show Overall Grade naming its exceptions
     (teacher/cm-student-page.js draws it), which narrows the list to
     Exceptions.

   The two options are the data layer's (shared/data-reflect.js,
   getStudentPageOptions, setStudentPageOptions): Demo Mode keeps them on
   this device; a signed-in class reads list_student_page_options when the
   list is drawn, and until the server has that function the options are
   not drawn (no column, filter, panel section or bar button) and nothing
   is sent. Every change shows a toast with Undo for 5 seconds. A change the
   server refuses shows only on the sync dot.

   What a student has done is read from what is already on this device:
   the grade returns and their seen_at (a piece is opened once seen_at is at
   or after its returned_at), the work sent (getCourseSubmissions), the
   questions waiting (getQuestionsWaiting) and the class's reflections
   (Questionnaires). Nothing is read from the server for it. */
var StudentPageStudents = (function () {
  'use strict';

  var STALE_MS = 60000; // a signed-in class's options are read again when drawn after this long
  var NOT_OPENED_SHOWN = 5; // the returned pieces not opened the panel names
  /* Whether the teacher sees what a student has opened: the Feedback Opened
     column, the Feedback Not Opened filter and the panel's not-opened list.
     Off until Colin rules on it (DECISIONS, "Per-student options on the
     Student Page" 3): the server sends a teacher no seen_at, and Demo Mode
     matches the real app. factsOf still counts it, for when it comes back. */
  var TEACHER_SEES_OPENED = false;
  var MAX_IDS = 500; // the most students one change takes (set_student_page_options)

  /* cid → { picked: { student id: true }, open: student id or null, fresh:
     true for the one draw that slides the panel in, looking, asked }. */
  var _state = {};
  /** @type {((e: KeyboardEvent) => void) | null} */
  var _onKey = null;

  function _st(cid) {
    return _state[cid] || (_state[cid] = { picked: {}, open: null, fresh: false, looking: false, asked: false });
  }

  function _rerender() {
    _memo = {};
    if (typeof DashClassManager === 'undefined' || !DashClassManager.renderClassManager) return;
    if (DashClassManager.classManagerOpen) DashClassManager.renderClassManager();
  }

  function _focus(selector) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    var el = document.querySelector(selector);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
  }

  // The element with the focus, or null when nothing on the page has it.
  function _active() {
    if (typeof document === 'undefined') return null;
    var a = document.activeElement;
    return !a || a === document.body ? null : a;
  }

  // True when this class's Students list is on the page.
  function _onScreen(cid) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    var card = /** @type {HTMLElement | null} */ (document.querySelector('.sc-card'));
    return !!card && !!card.dataset && card.dataset.cid === cid;
  }

  // A value for a [data-…="…"] selector.
  function _attr(v) {
    var s = String(v == null ? '' : v);
    return typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function'
      ? CSS.escape(s)
      : s.replace(/["\\]/g, '\\$&');
  }

  function _fmtDay(iso) {
    var t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso + 'T12:00:00' : iso);
    return isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _time(iso) {
    var t = iso ? Date.parse(iso) : NaN;
    return isNaN(t) ? null : t;
  }

  function _first(s) {
    return ((s && (s.preferred || s.firstName)) || '').trim();
  }
  function _name(s) {
    return (_first(s) + ' ' + ((s && s.lastName) || '')).trim();
  }

  function _roster(cid) {
    return typeof sortStudents === 'function' ? sortStudents(getStudents(cid) || [], 'lastName') : [];
  }

  function _student(cid, sid) {
    return (
      (getStudents(cid) || []).filter(function (s) {
        return s && s.id === sid;
      })[0] || null
    );
  }

  /* ── The options ───────────────────────────────────────────── */

  /* True where the options are drawn: Demo Mode, or a signed-in class whose
     list_student_page_options has been read. A signed-in class's list is
     read a moment after a draw that shows the Students list. */
  function offered(cid) {
    if (typeof studentPageOptionsOffered !== 'function') return false;
    _readIfShown(cid);
    return studentPageOptionsOffered(cid);
  }

  /* True where Show and Hide are offered: the options are, and so is the
     class's own Show Overall Grade row (CmStudentPage.learningSettings), so a
     student's grade is never shown or hidden against a switch the teacher
     can't see. */
  function gradeOffered(cid) {
    if (!offered(cid)) return false;
    return typeof CmStudentPage === 'undefined' || !CmStudentPage.learningSettings
      ? true
      : CmStudentPage.learningSettings(cid).offered === true;
  }

  function _readIfShown(cid) {
    if (typeof loadStudentPageOptions !== 'function') return;
    var st = _st(cid);
    if (st.looking) return;
    if (st.asked && Date.now() - st.asked < STALE_MS) return;
    st.looking = true;
    setTimeout(function () {
      st.looking = false;
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
      var card = /** @type {HTMLElement | null} */ (document.querySelector('.sc-card'));
      if (!card || !card.dataset || card.dataset.cid !== cid) return;
      st.asked = Date.now();
      var was = studentPageOptionsOffered(cid) + JSON.stringify(getStudentPageOptions(cid));
      loadStudentPageOptions(cid).then(function () {
        _memo = {};
        // Drawn again only when the read changed what is drawn: the options offered now, or new values.
        if (was !== studentPageOptionsOffered(cid) + JSON.stringify(getStudentPageOptions(cid))) _rerender();
      });
    }, 0);
  }

  /* The class's options, read once a turn: a draw asks for them on every
     row. Forgotten at the end of the turn, and at once after a change. */
  var _memo = {};
  var _memoClearing = false;
  function _options(cid) {
    if (typeof getStudentPageOptions !== 'function') return {};
    if (!_memo[cid]) {
      _memo[cid] = getStudentPageOptions(cid);
      if (!_memoClearing) {
        _memoClearing = true;
        Promise.resolve().then(function () {
          _memoClearing = false;
          _memo = {};
        });
      }
    }
    return _memo[cid];
  }

  // { grade: 'class'|'show'|'hide', paused: boolean, paused_at } for one student.
  function optionsOf(cid, sid) {
    var own = _options(cid)[sid];
    return {
      grade: own ? own.show_overall_grade : 'class',
      paused: !!(own && own.paused_at),
      paused_at: own ? own.paused_at : null,
    };
  }

  function _classShows(cid) {
    if (typeof StudentView !== 'undefined' && StudentView.learningOn) return StudentView.learningOn(cid) === true;
    return typeof getCourseFeedbackOptions === 'function' && getCourseFeedbackOptions(cid).show_my_learning === true;
  }

  function _shows(cid, sid) {
    return typeof effectiveShowOverallGrade === 'function' ? effectiveShowOverallGrade(cid, sid) : _classShows(cid);
  }

  // A student whose options are not the class's: their own Show or Hide, or their page paused.
  function isException(cid, sid) {
    var o = optionsOf(cid, sid);
    return o.grade !== 'class' || o.paused;
  }

  /* The Overall Grade column's words, and their colour: Page Paused, Hidden
     or Shown for a student's own choice, else what the class does. */
  function gradeWord(cid, sid) {
    var o = optionsOf(cid, sid);
    if (o.paused) return { text: 'Page Paused', tone: 'paused' };
    if (o.grade === 'hide') return { text: 'Hidden', tone: 'hidden' };
    if (o.grade === 'show') return { text: 'Shown', tone: 'shown' };
    return { text: (_classShows(cid) ? 'Shown' : 'Hidden') + ' · Class', tone: 'class' };
  }

  // "Jordan and Priya", "Jordan, Priya and Liam", "Jordan, Priya, Liam and 2 more".
  function _names(list) {
    if (list.length <= 3) {
      return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    }
    return list.slice(0, 3).join(', ') + ' and ' + (list.length - 3) + ' more';
  }

  /* The line under Show Overall Grade: who sees otherwise than the class
     ("Hidden for Jordan and Priya" with the switch on, "Shown for Liam"
     with it off), by first name (full name where two share one). '' with
     none, or where the options are not offered. */
  function exceptionsLine(cid) {
    if (!offered(cid)) return '';
    var on = _classShows(cid);
    var roster = _roster(cid);
    var firsts = {};
    roster.forEach(function (s) {
      var f = _first(s);
      firsts[f] = (firsts[f] || 0) + 1;
    });
    var who = roster
      .filter(function (s) {
        var g = optionsOf(cid, s.id).grade;
        return on ? g === 'hide' : g === 'show';
      })
      .map(function (s) {
        var f = _first(s);
        return firsts[f] > 1 || !f ? _name(s) : f;
      });
    if (!who.length) return '';
    return (on ? 'Hidden for ' : 'Shown for ') + _names(who);
  }

  // The line as a button under Show Overall Grade's hint.
  function exceptionsHtml(cid) {
    var line = exceptionsLine(cid);
    if (!line) return '';
    return (
      '<button type="button" class="sp-link-btn sps-except" id="sps-except" data-action="spStudentExceptions"' +
      ' aria-describedby="sp-learning-hint">' +
      esc(line) +
      '</button>'
    );
  }

  /* ── What a student has done ───────────────────────────────── */

  function _pieces(cid) {
    var list = typeof getAssignedAssessments === 'function' ? getAssignedAssessments(cid) : getAssessments(cid);
    return (list || []).filter(function (a) {
      return a && a.id;
    });
  }

  // A piece the student has been given a grade on: returned, or a draft over a grade returned before.
  function _back(cid, sid, aid, row) {
    if (row && row.returned_at) return true;
    if (row) return false;
    return typeof GradeState !== 'undefined' && GradeState.stateOf(cid, sid, aid) === GradeState.RETURNED;
  }

  // The class's work sent, by student: { student id: [submission] }.
  function _sentByStudent(cid) {
    var out = {};
    if (typeof getCourseSubmissions !== 'function') return out;
    ((getCourseSubmissions(cid) || {}).submissions || []).forEach(function (s) {
      if (!s || !s.enrollment_id || !s.assessment_id) return;
      (out[s.enrollment_id] = out[s.enrollment_id] || []).push(s);
    });
    return out;
  }

  // The class's reflections students see now (Reflect), or null when they have not been read here.
  function _reflections(cid) {
    if (typeof Questionnaires === 'undefined' || !Questionnaires.loaded || !Questionnaires.loaded(cid)) return null;
    return Questionnaires.list(cid).filter(function (q) {
      return Questionnaires.visible(q);
    });
  }

  /* What one student has done: { returned, opened, notOpened: [{ title,
     back }], sent, late, questions: [reflection], reflections: { answered,
     of } or null }. `sent` is the student's work sent, by piece. */
  function factsOf(cid, sid, sent, reflections) {
    var returned = 0;
    var opened = 0;
    var notOpened = [];
    _pieces(cid).forEach(function (a) {
      var row = typeof getGradeReturn === 'function' ? getGradeReturn(cid, sid, a.id) : null;
      if (!_back(cid, sid, a.id, row)) return;
      // Missing or Excused: the student is shown no grade or feedback on it, so there is nothing to open.
      var status = typeof getAssignmentStatus === 'function' ? getAssignmentStatus(cid, sid, a.id) : null;
      if (status === 'NS' || status === 'EXC') return;
      returned += 1;
      var seen = row ? _time(row.seen_at) : null;
      var back = row ? _time(row.returned_at) : null;
      if (seen !== null && back !== null && seen >= back) opened += 1;
      else notOpened.push({ title: a.title || 'Untitled', back: row ? row.returned_at : null });
    });
    notOpened.sort(function (x, y) {
      return String(y.back || '') < String(x.back || '') ? -1 : String(y.back || '') > String(x.back || '') ? 1 : 0;
    });
    // One piece, one count: a revision is the same piece. Late is the newest version's, as the grader reads it.
    var byPiece = {};
    (sent || []).forEach(function (s) {
      var was = byPiece[s.assessment_id];
      if (!was || Number(s.version || 1) > Number(was.version || 1)) byPiece[s.assessment_id] = s;
    });
    var pieces = Object.keys(byPiece);
    var questions = typeof getQuestionsWaiting === 'function' ? getQuestionsWaiting(cid, sid) : [];
    return {
      returned: returned,
      opened: opened,
      notOpened: notOpened,
      sent: pieces.length,
      late: pieces.filter(function (aid) {
        return !!byPiece[aid].is_late;
      }).length,
      questions: questions || [],
      reflections: reflections
        ? {
            of: reflections.length,
            answered: reflections.filter(function (q) {
              return (q.answered || []).indexOf(sid) >= 0;
            }).length,
          }
        : null,
    };
  }

  // Every student's facts, read once for a draw: { student id: facts }.
  function classFacts(cid, students) {
    var sent = _sentByStudent(cid);
    var refl = _reflections(cid);
    var out = {};
    (students || []).forEach(function (s) {
      out[s.id] = factsOf(cid, s.id, sent[s.id] || [], refl);
    });
    return out;
  }

  /* ── The list: filters, columns, ticks ─────────────────────── */

  /* The filters this file adds, in the order after All: each { value,
     label, tone, empty, shows(card, student, facts) }. Exceptions only where
     the options are offered; Questions only with Reflect on Feedback on. */
  function filters(cid) {
    var out = [];
    var opened = {
      value: 'not_opened',
      label: 'Feedback Not Opened',
      tone: 'info',
      empty: 'Every student has opened the feedback you returned.',
      shows: function (card, s, f) {
        return !!f && f.returned > f.opened;
      },
    };
    if (TEACHER_SEES_OPENED) out.push(opened);
    var reflect = typeof getReflectOnFeedback === 'function' && getReflectOnFeedback(cid);
    if (reflect) {
      out.push({
        value: 'questions',
        label: 'Questions',
        tone: 'info',
        empty: 'No questions are waiting for you.',
        shows: function (card, s, f) {
          return !!f && f.questions.length > 0;
        },
      });
    }
    if (offered(cid)) {
      out.push({
        value: 'exceptions',
        label: 'Grade Exceptions',
        tone: 'warn',
        empty: 'Every student follows the class.',
        shows: function (card, s) {
          return isException(cid, s.id);
        },
      });
    }
    return out;
  }

  // html-safe: fixed words only
  function headHtml(cid, shownIds) {
    var st = _st(cid);
    var all =
      shownIds.length > 0 &&
      shownIds.every(function (id) {
        return st.picked[id];
      });
    return {
      pick:
        '<th scope="col" class="sps-pick"><label class="sps-pick-box"><input type="checkbox" class="sps-check"' +
        ' data-action-change="spStudentPickAll" aria-label="Select every student shown"' +
        (all ? ' checked' : '') +
        '></label></th>',
      rest:
        (TEACHER_SEES_OPENED ? '<th scope="col" class="sps-num">Feedback Opened</th>' : '') +
        '<th scope="col" class="sps-num">Work Sent</th>' +
        (offered(cid) ? '<th scope="col">Overall Grade</th>' : ''),
    };
  }

  // The box to tick, at the start of a row.
  function pickHtml(cid, s) {
    var on = !!_st(cid).picked[s.id];
    return (
      '<td class="sps-pick"><label class="sps-pick-box"><input type="checkbox" class="sps-check"' +
      ' data-action-change="spStudentPick" data-student="' +
      esc(s.id) +
      '" aria-label="' +
      esc('Select ' + _name(s)) +
      '"' +
      (on ? ' checked' : '') +
      '></label></td>'
    );
  }

  // The student's name: the button that opens their panel.
  function nameHtml(cid, s) {
    var open = _st(cid).open === s.id;
    return (
      '<button type="button" class="sps-name" data-action="spStudentOpen" data-student="' +
      esc(s.id) +
      '" aria-haspopup="dialog" aria-expanded="' +
      open +
      '">' +
      esc(_name(s)) +
      '</button>'
    );
  }

  function _feedbackText(f) {
    return f.returned ? f.opened + ' of ' + f.returned : 'None';
  }
  function _sentText(f) {
    return f.sent ? f.sent + (f.late ? ' · ' + f.late + ' late' : '') : '0';
  }

  // The columns after Status: Feedback Opened, Work Sent, Overall Grade.
  function cellsHtml(cid, s, f) {
    var g = gradeWord(cid, s.id);
    return (
      (TEACHER_SEES_OPENED
        ? '<td class="sps-num' + (f.returned ? '' : ' sps-muted') + '">' + esc(_feedbackText(f)) + '</td>'
        : '') +
      '<td class="sps-num' +
      (f.sent ? '' : ' sps-muted') +
      '">' +
      esc(_sentText(f)) +
      '</td>' +
      (offered(cid) ? '<td><span class="sps-grade sps-grade-' + g.tone + '">' + esc(g.text) + '</span></td>' : '')
    );
  }

  // The ticked students still in the class, A to Z.
  function picked(cid) {
    var st = _st(cid);
    return _roster(cid)
      .filter(function (s) {
        return st.picked[s.id];
      })
      .map(function (s) {
        return s.id;
      });
  }

  /* The bar for the ticked rows (Colin, Nov 24 2026: the old black bar and its
     names, "Print New Cards", "Same as Class", "Pause Pages", left him unsure
     what they did). In FullVision's selection colours (the Assignments list's
     bar), its buttons in named groups: Overall Grade (Show, Hide, Use Class
     Setting), Student Page (Pause, Resume), and Replace Card, which says the old
     card stops (it asks first). Each button's hover says what it does. Replace
     Card and Clear Selection always; the options where they are offered. `off`
     while a press is out or the list is being read. */
  // html-safe: the count is a number; the rest fixed words
  function barHtml(cid, off) {
    var ids = picked(cid);
    if (!ids.length) return '';
    var dis = off ? ' disabled' : '';
    var btn = function (value, label, full, hint) {
      return (
        '<button type="button" class="cm-action-btn sps-bar-btn" data-action="spStudentBulk" data-value="' +
        value +
        '" aria-label="' +
        full +
        '" title="' +
        hint +
        '"' +
        (value === 'print' || value === 'showcards' ? dis : '') +
        '>' +
        label +
        '</button>'
      );
    };
    var group = function (name, buttons) {
      return (
        '<div class="sps-bar-group" role="group" aria-label="' +
        name +
        '"><span class="sps-bar-label" aria-hidden="true">' +
        name +
        '</span>' +
        buttons +
        '</div>'
      );
    };
    var one = ids.length === 1;
    return (
      '<div class="sps-bar" role="toolbar" aria-label="Selected students">' +
      '<span class="sps-bar-count" role="status">' +
      ids.length +
      ' Selected</span>' +
      (gradeOffered(cid)
        ? group(
            'Overall Grade',
            btn('show', 'Show', 'Show Overall Grade', 'They see their overall grade on their page.') +
              btn('hide', 'Hide', 'Hide Overall Grade', 'They don\u2019t see their overall grade.') +
              btn(
                'class',
                'Use Class Setting',
                'Overall Grade: Use Class Setting',
                'They follow the class\u2019s Show Overall Grade setting.',
              ),
          )
        : '') +
      (offered(cid)
        ? group(
            'Student Page',
            btn('pause', 'Pause', 'Pause Student Page', 'Their page is turned off until you resume it.') +
              btn('open', 'Resume', 'Resume Student Page', 'Their page is turned back on.'),
          )
        : '') +
      group(
        'Card',
        btn(
          'showcards',
          'Replace and Show',
          one ? 'Replace Card and Show on Screen' : 'Replace Cards and Show on Screen',
          'Makes a new card for each and shows it here, one at a time, to scan or type. Their old card stops working at once.',
        ) +
          btn(
            'print',
            'Replace and Print',
            one ? 'Replace Card and Print' : 'Replace Cards and Print',
            'Makes a new card for each and prints it. Their old card stops working at once.',
          ),
      ) +
      '<button type="button" class="cm-action-btn sps-bar-btn sps-bar-clear" data-action="spStudentClear">Clear Selection</button>' +
      '</div>'
    );
  }

  /* ── The side panel ────────────────────────────────────────── */

  function _seg(label, id, choices, value) {
    return (
      '<div class="seg cm-seg sps-seg" role="radiogroup" aria-labelledby="' +
      id +
      '-label" aria-describedby="' +
      id +
      '-hint">' +
      choices
        .map(function (c) {
          var on = c.value === value;
          return (
            '<button type="button" class="seg-btn cm-seg-btn' +
            (on ? ' active' : '') +
            '" id="' +
            id +
            '-' +
            c.value +
            '" role="radio" aria-checked="' +
            on +
            '" data-action="' +
            c.action +
            '" data-value="' +
            c.value +
            '">' +
            esc(c.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function _fact(label, valueHtml) {
    return (
      '<li><span class="sps-fact-label">' + esc(label) + '</span><span class="sps-fact">' + valueHtml + '</span></li>'
    );
  }

  // The sentence under Overall Grade: what this student sees.
  function _gradeHint(cid, sid, first) {
    return _shows(cid, sid)
      ? first + ' sees their overall grade at the top of My Learning.'
      : first + '’s overall grade stays off their page. Each piece’s result and feedback still show.';
  }
  function _pageHint(paused, first) {
    return paused
      ? first +
          '’s card doesn’t open their page until you choose Open. Nothing is reprinted, and nothing they sent is lost.'
      : first + '’s card opens their page.';
  }

  // The panel's Overall Grade control: Same as Class, Show, Hide, and what it does for this student.
  function _gradeCtl(cid, sid, first, o) {
    return (
      '<div class="sps-ctl"><span class="sp-row-title" id="sps-grade-label">Overall Grade</span>' +
      _seg(
        'Overall Grade',
        'sps-grade',
        [
          {
            value: 'class',
            label: 'Use Class Setting (' + (_classShows(cid) ? 'Shown' : 'Hidden') + ')',
            action: 'spStudentGrade',
          },
          { value: 'show', label: 'Show', action: 'spStudentGrade' },
          { value: 'hide', label: 'Hide', action: 'spStudentGrade' },
        ],
        o.grade,
      ) +
      '<span class="cm-hint" id="sps-grade-hint">' +
      esc(_gradeHint(cid, sid, first)) +
      '</span></div>'
    );
  }

  /* The panel for the student open, or ''. `card` is what the Students
     list knows of their card: { card, cardText, status, until, off }. */
  // html-safe: every name, title, question and date goes through esc(); the rest is fixed markup
  function panelHtml(cid, card) {
    var st = _st(cid);
    if (!st.open) return '';
    var s = _student(cid, st.open);
    if (!s) {
      st.open = null;
      return '';
    }
    var first = _first(s) || _name(s);
    var full = _name(s);
    var f = factsOf(cid, s.id, _sentByStudent(cid)[s.id] || [], _reflections(cid));
    var c = (card && card.card) || null;
    var opened = c && c.last_opened_at ? _fmtDay(c.last_opened_at) : '';
    var sub = !c ? 'No card yet.' : opened ? 'Last opened their page ' + opened + '.' : 'Hasn’t opened their page yet.';
    var sees = '';
    if (offered(cid)) {
      var o = optionsOf(cid, s.id);
      sees =
        '<section class="sps-sec" aria-labelledby="sps-sees-title"><h3 class="sps-sec-title" id="sps-sees-title">' +
        esc('What ' + first + ' Sees') +
        '</h3>' +
        (gradeOffered(cid) ? _gradeCtl(cid, s.id, first, o) : '') +
        '<div class="sps-ctl"><span class="sp-row-title" id="sps-page-label">Student Page</span>' +
        _seg(
          'Student Page',
          'sps-page',
          [
            { value: 'open', label: 'Open', action: 'spStudentPage' },
            { value: 'paused', label: 'Paused', action: 'spStudentPage' },
          ],
          o.paused ? 'paused' : 'open',
        ) +
        '<span class="cm-hint" id="sps-page-hint">' +
        esc(_pageHint(o.paused, first)) +
        '</span></div></section>';
    }
    var done = [];
    if (TEACHER_SEES_OPENED) {
      done.push(
        _fact(
          'Feedback Opened',
          esc(f.returned ? f.opened + ' of ' + f.returned + ' returned pieces' : 'Nothing returned yet') +
            (f.notOpened.length
              ? '<span class="sps-unopened">' +
                // The newest five, then how many more.
                f.notOpened
                  .slice(0, NOT_OPENED_SHOWN)
                  .map(function (p) {
                    return (
                      '<span>' + esc('Not opened: ' + p.title + (p.back ? ', back ' + _fmtDay(p.back) : '')) + '</span>'
                    );
                  })
                  .join('') +
                (f.notOpened.length > NOT_OPENED_SHOWN
                  ? '<span>' + esc('And ' + (f.notOpened.length - NOT_OPENED_SHOWN) + ' more not opened.') + '</span>'
                  : '') +
                '</span>'
              : ''),
        ),
      );
    }
    done.push(
      _fact(
        'Work Sent',
        esc(
          f.sent ? (f.sent === 1 ? '1 piece' : f.sent + ' pieces') + (f.late ? ', ' + f.late + ' late' : '') : 'None',
        ),
      ),
    );
    if (f.reflections && f.reflections.of) {
      done.push(_fact('Reflections', esc(f.reflections.answered + ' of ' + f.reflections.of + ' answered')));
    }
    if (f.questions.length) {
      done.push(
        _fact(
          f.questions.length === 1 ? 'Question' : 'Questions',
          f.questions
            .map(function (q) {
              var a = (getAssessments(cid) || []).filter(function (x) {
                return x && x.id === q.assessment_id;
              })[0];
              var words = q.follow_up && !q.follow_up_answer ? q.follow_up : q.question;
              return (
                '<span class="sps-question"><span>' +
                esc('“' + (words || 'A reflection waiting for your answer') + '”') +
                '</span><span class="cm-hint">' +
                esc((a ? 'On ' + (a.title || 'Untitled') : 'Waiting') + (q.sent_at ? ' · ' + _fmtDay(q.sent_at) : '')) +
                '</span></span>'
              );
            })
            .join(''),
        ),
      );
    }
    var cardFacts = [];
    cardFacts.push(_fact('Card', esc((card && card.cardText) || 'No Card Yet')));
    if (c && card.status) cardFacts.push(_fact('Status', esc(card.status)));
    if (c && card.until) cardFacts.push(_fact('Works Until', esc(card.until)));
    var dis = card && card.off ? ' disabled' : '';
    var cardBtns =
      (c && c.locked_at
        ? '<button type="button" class="cm-action-btn" data-action="spCardsUnlock" data-card="' +
          esc(c.id) +
          '" aria-label="' +
          esc('Unlock ' + full + '’s Card') +
          '"' +
          dis +
          '>Unlock</button>'
        : '') +
      // Show on Screen for a student beside the teacher; Print for paper. Only once they have a card.
      (c ? ['1', ''] : [])
        .map(function (show) {
          var verb = (c ? 'Replace and ' : 'Make and ') + (show ? 'Show' : 'Print');
          return (
            '<button type="button" class="cm-action-btn" data-action="spCardsNewCard" data-student="' +
            esc(s.id) +
            '"' +
            (show ? ' data-show="1"' : '') +
            ' aria-label="' +
            esc(c ? verb.replace(' and ', ' ' + full + '\u2019s Card and ') : verb + ' a Card for ' + full) +
            '" title="' +
            (show
              ? 'Makes a new card and shows it here to scan or type. Nothing is printed.'
              : 'Makes a new card and prints it.') +
            (c ? ' The old card stops working at once.' : '') +
            '"' +
            dis +
            '>' +
            verb +
            '</button>'
          );
        })
        .join('');
    var fresh = st.fresh;
    st.fresh = false;
    return (
      '<aside class="sps-panel' +
      (fresh ? ' sps-panel-in' : '') +
      '" id="sps-panel" data-cid="' +
      esc(cid) +
      '" role="dialog" aria-modal="false" aria-labelledby="sps-panel-name">' +
      '<div class="sps-head"><div class="sps-head-row"><h2 class="sps-name-title" id="sps-panel-name" tabindex="-1">' +
      esc(full) +
      '</h2><button type="button" class="cm-action-btn sps-close" id="sps-close" data-action="spStudentClose" aria-label="' +
      esc('Close ' + full) +
      '">Close</button></div>' +
      '<span class="cm-hint">' +
      esc(sub) +
      '</span>' +
      (typeof PreviewStudent !== 'undefined'
        ? '<div><button type="button" class="btn sp-tint-btn" id="sps-preview" data-action="spStudentPreview" data-student="' +
          esc(s.id) +
          '">' +
          esc('Preview as ' + first) +
          '</button></div>'
        : '') +
      '</div>' +
      '<div class="sps-body">' +
      sees +
      '<section class="sps-sec" aria-labelledby="sps-done-title"><h3 class="sps-sec-title" id="sps-done-title">' +
      esc('What ' + first + ' Has Done') +
      '</h3><ul class="sps-facts">' +
      done.join('') +
      '</ul></section>' +
      '<section class="sps-sec" aria-labelledby="sps-card-title"><h3 class="sps-sec-title" id="sps-card-title">Card</h3>' +
      '<ul class="sps-facts">' +
      cardFacts.join('') +
      '</ul>' +
      (cardBtns ? '<div class="sps-card-btns">' + cardBtns + '</div>' : '') +
      '</section></div></aside>'
    );
  }

  function _open(cid, sid) {
    var st = _st(cid);
    if (!_student(cid, sid)) return;
    if (st.open === sid) {
      close(cid);
      return;
    }
    st.open = sid;
    st.fresh = true;
    // The reflections a student has answered are counted once the class's are read.
    if (typeof Questionnaires !== 'undefined' && Questionnaires.load && !Questionnaires.loaded(cid)) {
      Questionnaires.load(cid, function () {
        if (_st(cid).open) _rerender();
      });
    }
    _listen();
    _rerender();
    _focus('#sps-panel-name');
  }

  // Close the panel; the focus goes back to the student's name on the list.
  function close(cid) {
    var st = _st(cid);
    var sid = st.open;
    if (!sid) return false;
    st.open = null;
    st.fresh = false;
    _unlisten();
    _rerender();
    _focus('.sps-name[data-student="' + _attr(sid) + '"]');
    return true;
  }

  function _openCid() {
    /** @type {string | null} */
    var out = null;
    Object.keys(_state).forEach(function (cid) {
      if (_state[cid].open) out = cid;
    });
    return out;
  }

  // Escape closes the panel, unless a question or Preview as Student is over it.
  function _listen() {
    if (_onKey || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    _onKey = function (e) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.confirm-overlay')) return;
      if (typeof PreviewStudent !== 'undefined' && PreviewStudent.isOpen && PreviewStudent.isOpen()) return;
      var cid = _openCid();
      if (!cid || !document.getElementById('sps-panel')) return;
      e.preventDefault();
      close(cid);
    };
    document.addEventListener('keydown', _onKey);
  }
  function _unlisten() {
    if (!_onKey) return;
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('keydown', _onKey);
    }
    _onKey = null;
  }

  /* ── Changing the options ──────────────────────────────────── */

  var GRADE_WORDS = {
    hide: ['’s overall grade is hidden.', 'Overall grade hidden for '],
    show: ['’s overall grade is shown.', 'Overall grade shown for '],
    class: [' follows the class for Show Overall Grade.', 'Class setting for '],
  };

  function _toastText(cid, ids, change) {
    var one = ids.length === 1 ? _student(cid, ids[0]) : null;
    var first = one ? _first(one) || _name(one) : '';
    var many = ids.length + ' students.';
    if ('paused' in change) {
      if (one) return first + (change.paused ? '’s page is paused.' : '’s page is open again.');
      return (change.paused ? 'Pages paused for ' : 'Pages open again for ') + many;
    }
    var w = GRADE_WORDS[change.show_overall_grade];
    return one ? first + w[0] : w[1] + many;
  }

  function _key() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'spo-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /* Change `ids`' options (one change: { show_overall_grade } or
     { paused }), then a toast with Undo, which puts each student back as
     they were. `focus` is the control to give the focus back to. A Promise
     of setStudentPageOptions' answer. */
  function change(cid, ids, what, focus) {
    if (typeof setStudentPageOptions !== 'function' || !offered(cid)) {
      return Promise.resolve({ result: 'not_available' });
    }
    // Only the students it changes: a second press changes nobody, and shows no toast whose Undo would undo nothing.
    var before = {};
    ids = ids.filter(function (sid) {
      var o = optionsOf(cid, sid);
      var same = 'paused' in what ? o.paused === what.paused : o.grade === what.show_overall_grade;
      if (!same) before[sid] = o;
      return !same;
    });
    if (!ids.length || ids.length > MAX_IDS) return Promise.resolve({ result: 'nothing' });
    var sent = setStudentPageOptions(cid, ids, what, _key());
    _memo = {};
    // Shown at once (Demo Mode keeps it; signed in it is laid over the server's until answered).
    _rerender();
    if (focus) _focus(focus);
    var pressed = _active();
    sent.then(function () {
      // A late answer (offline, slow) draws again, and gives the focus back only if the teacher has not moved on.
      var stay = _active() === pressed || _active() === null;
      _rerender();
      if (focus && stay && _onScreen(cid)) _focus(focus);
    });
    if (typeof showUndoToast === 'function') {
      showUndoToast(_toastText(cid, ids, what), function () {
        _undo(cid, before, what);
      });
    }
    return sent;
  }

  // Undo: each student back as they were, one change for each value they had.
  function _undo(cid, before, what) {
    var groups = {};
    Object.keys(before).forEach(function (sid) {
      var v = 'paused' in what ? String(before[sid].paused) : before[sid].grade;
      (groups[v] = groups[v] || []).push(sid);
    });
    var sends = Object.keys(groups).map(function (v) {
      var back = 'paused' in what ? { paused: v === 'true' } : { show_overall_grade: v };
      return setStudentPageOptions(cid, groups[v], back, _key());
    });
    _rerender();
    Promise.all(sends).then(_rerender);
  }

  var BULK = {
    hide: { show_overall_grade: 'hide' },
    show: { show_overall_grade: 'show' },
    class: { show_overall_grade: 'class' },
    pause: { paused: true },
    open: { paused: false },
  };

  // Narrow the list to Exceptions and bring it into view (the line under Show Overall Grade).
  function _showExceptions(cid) {
    if (typeof StudentCards !== 'undefined' && StudentCards.setFilter) StudentCards.setFilter(cid, 'exceptions');
    _rerender();
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    var title = document.getElementById('sc-title');
    if (!title) return;
    if (typeof title.scrollIntoView === 'function') title.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (typeof title.focus === 'function') title.focus({ preventScroll: true });
  }

  function _cidOf(el) {
    var box = el && el.closest ? el.closest('[data-cid]') : null;
    return box ? box.dataset.cid : null;
  }

  // True when the click was this file's.
  function handleAction(action, el) {
    var cid = _cidOf(el);
    var data = (el && el.dataset) || {};
    if (!cid) return /^spStudent/.test(action);
    var st = _st(cid);
    switch (action) {
      case 'spStudentOpen':
        if (data.student) _open(cid, data.student);
        return true;
      case 'spStudentClose':
        close(cid);
        return true;
      case 'spStudentPreview':
        if (data.student && typeof PreviewStudent !== 'undefined') {
          PreviewStudent.open(cid, data.student, el, 'sps-preview');
        }
        return true;
      case 'spStudentGrade':
        if (gradeOffered(cid) && st.open && BULK[data.value] && 'show_overall_grade' in BULK[data.value]) {
          if (optionsOf(cid, st.open).grade !== data.value) {
            change(cid, [st.open], { show_overall_grade: data.value }, '#sps-grade-' + data.value);
          }
        }
        return true;
      case 'spStudentPage':
        if (st.open && (data.value === 'open' || data.value === 'paused')) {
          var pause = data.value === 'paused';
          if (optionsOf(cid, st.open).paused !== pause)
            change(cid, [st.open], { paused: pause }, '#sps-page-' + data.value);
        }
        return true;
      case 'spStudentBulk': {
        var ids = picked(cid);
        if (!ids.length) return true;
        if (data.value === 'print' || data.value === 'showcards') {
          // Once the cards are asked for, the ticks go: a second press would make them again.
          if (typeof StudentCards !== 'undefined' && StudentCards.printNewCards) {
            StudentCards.printNewCards(
              cid,
              ids,
              function () {
                clearPicked(cid);
              },
              data.value === 'showcards',
            );
          }
          return true;
        }
        if (BULK[data.value] && ('paused' in BULK[data.value] || gradeOffered(cid)))
          change(cid, ids, BULK[data.value], '.sps-bar [data-value="' + data.value + '"]');
        return true;
      }
      case 'spStudentClear':
        st.picked = {};
        _rerender();
        _focus('.sc-filters .active');
        return true;
      case 'spStudentExceptions':
        _showExceptions(cid);
        return true;
    }
    return false;
  }

  /* True when the change was one of this file's ticks. `shownIds` for Select
     Every Student Shown comes from the list on the page. */
  function handleChange(el) {
    var act = el && el.dataset ? el.dataset.actionChange : '';
    if (act !== 'spStudentPick' && act !== 'spStudentPickAll') return false;
    var cid = _cidOf(el);
    if (!cid) return true;
    var st = _st(cid);
    if (act === 'spStudentPick') {
      var sid = el.dataset.student;
      if (sid && el.checked) st.picked[sid] = true;
      else if (sid) delete st.picked[sid];
      _rerender();
      if (sid) _focus('.sps-check[data-student="' + _attr(sid) + '"]');
      return true;
    }
    var table = el.closest ? el.closest('table') : null;
    var boxes = table ? Array.prototype.slice.call(table.querySelectorAll('[data-action-change="spStudentPick"]')) : [];
    boxes.forEach(function (b) {
      var id = b.dataset.student;
      if (!id) return;
      if (el.checked) st.picked[id] = true;
      else delete st.picked[id];
    });
    _rerender();
    _focus('[data-action-change="spStudentPickAll"]');
    return true;
  }

  /* The filter changed: the ticks go, so the bar acts only on students the
     teacher can see. */
  function clearPicked(cid) {
    _st(cid).picked = {};
  }

  // Class Settings closed: every panel closes and its Escape goes, with nothing drawn.
  function closeAll() {
    Object.keys(_state).forEach(function (id) {
      _state[id].open = null;
      _state[id].fresh = false;
    });
    _unlisten();
  }

  // Another class is drawn: this one's ticks and panel go.
  function leave(cid) {
    Object.keys(_state).forEach(function (id) {
      if (id === cid) return;
      _state[id].picked = {};
      _state[id].open = null;
    });
    if (!_openCid()) _unlisten();
  }

  function _reset() {
    _unlisten();
    _state = {};
  }

  return {
    offered: offered,
    gradeOffered: gradeOffered,
    optionsOf: optionsOf,
    isException: isException,
    gradeWord: gradeWord,
    exceptionsLine: exceptionsLine,
    exceptionsHtml: exceptionsHtml,
    factsOf: factsOf,
    classFacts: classFacts,
    filters: filters,
    headHtml: headHtml,
    pickHtml: pickHtml,
    nameHtml: nameHtml,
    cellsHtml: cellsHtml,
    barHtml: barHtml,
    panelHtml: panelHtml,
    picked: picked,
    change: change,
    close: close,
    leave: leave,
    clearPicked: clearPicked,
    closeAll: closeAll,
    // The student whose panel is open in class `cid`, or null.
    openStudent: function (cid) {
      return _st(cid).open;
    },
    handleAction: handleAction,
    handleChange: handleChange,
    // Tests: turn what the teacher sees of what a student opened on or off (off by default).
    _setTeacherSeesOpened: function (on) {
      TEACHER_SEES_OPENED = !!on;
    },
    // Tests: open (or close, with null) a student's panel without drawing.
    _setOpen: function (cid, sid) {
      _st(cid).open = sid || null;
    },
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.StudentPageStudents = StudentPageStudents;
