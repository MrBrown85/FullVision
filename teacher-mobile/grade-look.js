// @ts-check
/* grade-look.js — the phone grader's frame: who is on screen in the top bar,
   the class list behind that name (hold a name to peek at the paper), the ⋯
   sheet, the return held seven seconds for Undo, All Caught Up, and the
   comment a teacher last wrote on a criterion waiting as a suggestion
   (docs/plans/phone-look-plan.md).

   tab-grade.js draws the screen and asks this file for those pieces as it
   does; the taps on them are heard here. */
/** @type {any} */ (window).MGradeLook = (function () {
  'use strict';

  /** @type {any} */
  var W = window;

  // The grading screen's class, piece and cards, as renderSwiper last drew them.
  /** @type {string | null} */
  var _cid = null;
  /** @type {string | null} */
  var _aid = null;
  /** @type {any[]} */
  var _units = [];

  /* look.css still styles the Students, Observe and Bulletins screens under
     this class, until each is drawn natively and its rules leave that file.
     It was set here when the switch was on; the switch is on for everyone. */
  if (document.documentElement) document.documentElement.classList.add('m-look');

  /** @param {string} s */
  function _esc(s) {
    return W.MComponents.esc(s);
  }
  /** @param {any} st */
  function _first(st) {
    return displayNameFirst(st) || displayName(st);
  }

  /* Who a card is: the student; a pair by its two first names; a bigger
     group by its label ("Group 2"). */
  /** @param {string} cid @param {any} unit */
  function unitName(cid, unit) {
    if (!unit.view) return displayName(unit.st);
    var students = getStudents(cid);
    var firsts = unit.view.members.map(function (/** @type {string} */ m) {
      var st = students.find(function (x) {
        return x.id === m;
      });
      return st ? _first(st) : '';
    });
    return firsts.length === 2 && firsts[0] && firsts[1] ? firsts[0] + ' and ' + firsts[1] : unit.label;
  }

  /* What the grading screen's top bar takes: the first card's name as a title
     that opens the class list, and ⋯. One student's work has a bar that names
     the student already; it takes only ⋯. */
  // html-safe: fixed markup
  /** @param {string} cid @param {string} aid @param {any[]} units @param {boolean} oneStudent */
  function bar(cid, aid, units, oneStudent) {
    _cid = cid;
    _aid = aid;
    _units = units;
    var named = !oneStudent && units.length > 0;
    return {
      title: named ? unitName(cid, units[0]) : '',
      titleAction: named ? 'm-grade-roster' : '',
      more:
        '<button type="button" class="m-grade-more" data-action="m-grade-more" aria-label="More">' +
        W.MComponents.ICONS.more +
        '</button>',
    };
  }

  // The bar names the card now on screen.
  /** @param {number} idx */
  function show(idx) {
    var el = document.querySelector('#m-nav-bar-grade-swiper .m-nav-title-text');
    if (el && _cid && _units[idx]) el.textContent = unitName(_cid, _units[idx]);
  }

  // "Comment for Maya": the Overall Comment, named for who it is to.
  /** @param {string} cid @param {any} st @param {any} unit */
  function commentLabel(cid, st, unit) {
    if (unit && unit.view) return 'Comment for ' + (unit.view.members.length === 2 ? 'Both' : 'the Group');
    return 'Comment for ' + _first(st);
  }

  /* The class list, from the name in the bar: the cards in their order, each
     by its name, a tick on each one the progress line has as graded. A tap
     goes to that card (m-grade-jump); a name held shows that student's paper. */
  // html-safe: names go through esc; the index is a number
  function openRoster() {
    if (!_cid) return;
    var cid = _cid;
    var segs = document.querySelectorAll('#m-grade-progress .m-prog-seg');
    var at = W.MGrade.getCurrentIndex();
    var rows = _units
      .map(function (unit, idx) {
        var graded = !!segs[idx] && segs[idx].classList.contains('is-graded');
        return (
          '<button type="button" class="m-roster-row" data-action="m-grade-jump" data-idx="' +
          idx +
          '" data-sid="' +
          unit.st.id +
          '"' +
          (idx === at ? ' aria-current="true"' : '') +
          '><span>' +
          _esc(unitName(cid, unit)) +
          '</span>' +
          (graded
            ? '<span class="m-roster-graded"><span aria-hidden="true">✓</span><span class="m-sr">Graded</span></span>'
            : '') +
          '</button>'
        );
      })
      .join('');
    if (rows) W.MComponents.presentSheet('<div class="m-roster">' + rows + '</div>');
  }

  /* Peek: a name held in the class list shows that student's paper while the
     finger is down, and the list stays as it was. The tap that ends a peek is
     not a choice. */
  var PEEK_MS = 450;
  /** @type {any} */
  var _peekTimer = null;
  var _peeked = false;

  /** @param {Element} row */
  function _peek(row) {
    var sid = row.getAttribute('data-sid');
    var idx = Number(row.getAttribute('data-idx'));
    var unit = _units[idx];
    if (!_cid || !_aid || !sid || !unit) return;
    var sub = W.MGradePhotos.work(_cid, sid, _aid);
    var files = (sub && sub.files) || [];
    if (!files.length) return;
    _peeked = true;
    var el = document.createElement('div');
    el.className = 'm-peek';
    el.id = 'm-peek';
    // html-safe: the name goes through esc; ids are ours
    el.innerHTML =
      '<div class="m-peek-card m-work" data-sid="' +
      _esc(sid) +
      '" data-aid="' +
      _esc(_aid) +
      '"><img alt="' +
      _esc(unitName(_cid, unit) + '’s paper') +
      '" data-work-pic data-work-which="page" data-fv-page="0"></div>';
    document.body.appendChild(el);
    W.MGradePhotos.hydrate(el, _cid);
  }

  function _unpeek() {
    clearTimeout(_peekTimer);
    var el = document.getElementById('m-peek');
    if (el) el.remove();
    if (_peeked)
      setTimeout(function () {
        _peeked = false;
      }, 350);
  }

  document.addEventListener('pointerdown', function (e) {
    var row = e.target instanceof Element ? e.target.closest('.m-roster-row') : null;
    if (!row) return;
    var held = row;
    clearTimeout(_peekTimer);
    _peekTimer = setTimeout(function () {
      _peek(held);
    }, PEEK_MS);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (!(e.target instanceof Element) || e.target.closest('.m-roster-row') || type === 'pointerup') _unpeek();
    });
  });
  // The list is the sheet's; a touch held on it would open the phone's own menu.
  document.addEventListener('contextmenu', function (e) {
    if (e.target instanceof Element && e.target.closest('.m-roster-row')) e.preventDefault();
  });
  // The tap that ends a peek chooses nobody.
  document.addEventListener(
    'click',
    function (e) {
      if (!_peeked || !(e.target instanceof Element) || !e.target.closest('.m-roster-row')) return;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );

  /* ⋯ in the bar: what the card on screen rarely needs, drawn from the
     card's own data. A status for the student, or for each member of a pair
     or group (with Grade Separately); Back to Group Grade on a member graded
     on their own; Grade by Competencies or Rubric; Unsubmit. A choice
     closes the sheet. */
  // html-safe: names go through esc; ids are ours; labels are fixed words
  /** @param {string} cid @param {any} a @param {string} sid @param {boolean} single */
  function _statusHtml(cid, a, sid, single) {
    var status = getAssignmentStatus(cid, sid, a.id);
    var may = canSetAssignmentStatus(cid, sid, a.id, 'NS');
    var ids = ' data-sid="' + sid + '" data-aid="' + a.id + '"';
    var pill = function (/** @type {string} */ val, /** @type {string} */ label) {
      var locked = val !== 'LATE' && !may;
      return (
        '<button type="button" class="m-status-pill' +
        (status === val ? ' m-status-active' : '') +
        '" data-action="m-grade-status" data-val="' +
        val +
        '"' +
        ids +
        (locked ? ' disabled' : '') +
        ' aria-pressed="' +
        (status === val) +
        '">' +
        label +
        '</button>'
      );
    };
    return (
      '<div class="m-status-row" role="group" aria-label="Status">' +
      pill('LATE', 'Late') +
      pill('NS', 'Missing') +
      pill('EXC', 'Excused') +
      '</div>' +
      // Why Missing and Excused can't be picked, where they can't.
      (single && !may ? '<div class="m-more-hint">Clear the score and comment to mark Missing or Excused.</div>' : '')
    );
  }

  function openMore() {
    var ctx = W.MGrade.moreContext();
    if (!ctx) return;
    var cid = ctx.cid;
    var a = ctx.a;
    var unit = ctx.unit;
    var students = getStudents(cid);
    var html = '<div class="m-group-sheet-title">' + _esc(unitName(cid, unit)) + '</div>';
    if (unit.view) {
      unit.view.members.forEach(function (/** @type {string} */ m) {
        var st = students.find(function (/** @type {any} */ x) {
          return x.id === m;
        });
        if (!st || isGradedSeparately(a, m)) return;
        html +=
          '<div class="m-more-member"><div class="m-more-member-head"><span class="m-more-member-name">' +
          _esc(displayNameWithLast(st)) +
          '</span><button type="button" class="m-more-chip" data-action="m-grade-separate" data-sid="' +
          m +
          '" data-aid="' +
          a.id +
          '">Grade Separately</button></div>' +
          _statusHtml(cid, a, m, false) +
          '</div>';
      });
    } else {
      html += _statusHtml(cid, a, unit.st.id, true);
      if (unit.separateFrom)
        html +=
          '<button type="button" class="m-more-btn" data-action="m-grade-rejoin" data-sid="' +
          unit.st.id +
          '" data-aid="' +
          a.id +
          '">Back to Group Grade</button>';
    }
    if (ctx.scoredBy)
      html +=
        '<button type="button" class="m-more-btn" data-action="m-grade-view" data-view="' +
        (ctx.scoredBy === 'rubric' ? 'tags' : 'rubric') +
        '" data-aid="' +
        a.id +
        '">' +
        (ctx.scoredBy === 'rubric' ? 'Grade by Competencies' : 'Grade by Rubric') +
        '</button>';
    if (ctx.canUnsubmit)
      html +=
        '<button type="button" class="m-more-btn m-more-danger" data-action="m-work-unsubmit" data-sid="' +
        unit.st.id +
        '" data-aid="' +
        a.id +
        '">Unsubmit</button>';
    W.MComponents.presentSheet('<div class="m-more-sheet">' + html + '</div>', { half: true });
  }

  /* All Caught Up: the last card is done. What went back, what is not in,
     and the next piece with work waiting. */
  // html-safe: the title goes through esc; the counts are numbers; ids are ours
  /** @param {{ done: number, verb: string, notIn: number, next: ({ id: string, title: string } | null) }} info */
  function caughtUp(info) {
    var line = info.done + ' ' + info.verb + (info.notIn ? ' · ' + info.notIn + ' not handed in' : '');
    return (
      '<div class="m-grade-done" id="m-grade-done"><div class="m-grade-done-card">' +
      '<div class="m-grade-done-tick" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
      '<h2 class="m-grade-done-title">All Caught Up</h2>' +
      '<p class="m-grade-done-line">' +
      _esc(line) +
      '</p>' +
      (info.next
        ? '<button type="button" class="m-grade-done-next" data-action="m-grade-next-piece" data-aid="' +
          _esc(info.next.id) +
          '">Grade ' +
          _esc(info.next.title) +
          '</button>'
        : '') +
      '<button type="button" class="m-grade-done-end" data-action="m-back">Done</button>' +
      '</div></div>'
    );
  }

  /* Return and Next, held for Undo (Colin, Nov 24): the return waits seven
     seconds and is sent when the toast goes, so Undo never has to take a
     grade back from a student. The toast sits over the tab bar, where it
     covers nothing the next student is graded with. One return is held at
     a time: the next one, or leaving the grading screen, sends it at once.
     If the app closes first, the grade is still a draft, in To Return. */
  var HOLD_MS = 7000;
  /** @type {{ cid: string, aid: string, sid: string, send: (late: boolean) => void, timer: any } | null} */
  var _held = null;

  /** @param {string} cid @param {string} aid @param {any} unit @param {(late: boolean) => void} send */
  function hold(cid, aid, unit, send) {
    flush();
    var h = { cid: cid, aid: aid, sid: unit.st.id, send: send, timer: 0 };
    h.timer = setTimeout(function () {
      if (_held === h) flush();
    }, HOLD_MS);
    _held = h;
    W.MComponents.showToast('Returned to ' + (unit.view ? unitName(cid, unit) : _first(unit.st)), {
      onUndo: undo,
      duration: HOLD_MS,
      low: true,
    });
  }

  // The held return is this card's.
  /** @param {string} cid @param {string} aid @param {string} sid */
  function held(cid, aid, sid) {
    return !!_held && _held.cid === cid && _held.aid === aid && _held.sid === sid;
  }

  // Send the held return now.
  function flush() {
    var h = _held;
    if (!h) return;
    _held = null;
    clearTimeout(h.timer);
    h.send(true);
    W.MComponents.hideToast();
    // The Grade tab's To Return list, if it is the screen showing by now.
    W.MGrade.refreshToReturn(h.cid);
  }

  // Undo: nothing is sent, and the card comes back with its grade still a draft.
  function undo() {
    var h = _held;
    if (!h) return;
    _held = null;
    clearTimeout(h.timer);
    var grade = W.MGrade;
    grade.hideCaughtUp();
    if (grade.studentWork()) {
      // One student's work: back to that piece.
      grade.showStudentPiece(h.cid, h.aid);
      grade.jumpToStudent(grade.getCurrentIndex(), true);
      return;
    }
    var idx = grade.studentCardIndex(h.cid, h.aid, h.sid);
    if (idx >= 0) grade.jumpToStudent(idx);
  }

  // Leaving the app sends a held return first ("Yes, send it", Colin,
  // Nov 24). Leaving the grading screen does too: shell.js calls flush.
  if (W.addEventListener) W.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) flush();
  });

  /* The comment a teacher last wrote on a criterion waits under the next
     student's empty comment box as a suggestion. It is kept on this phone, by
     class and criterion; nothing leaves it. */
  /** @param {string} cid @param {string} critId */
  function _commentKey(cid, critId) {
    return 'fv-crit-last:' + cid + ':' + critId;
  }
  /** @param {string} cid @param {string} aid @param {string} critId @param {string} text */
  function rememberComment(cid, aid, critId, text) {
    try {
      localStorage.setItem(_commentKey(cid, critId), text);
    } catch (e) {
      /* a private window keeps nothing: the suggestion is a convenience */
    }
  }
  /** @param {string} cid @param {string} aid @param {string} critId */
  function suggestion(cid, aid, critId) {
    try {
      return localStorage.getItem(_commentKey(cid, critId)) || '';
    } catch (e) {
      return '';
    }
  }

  document.addEventListener('click', function (e) {
    var target = e.target instanceof Element ? e.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'm-grade-roster') return openRoster();
    if (action === 'm-grade-more') return openMore();
    if (action === 'm-grade-next-student') return W.MGrade.nextStudent();
    if (action === 'm-grade-next-piece') return W.MGrade.gradeNextPiece(target.getAttribute('data-aid'));
    if (action === 'm-grade-suggest') return W.MGrade.useSuggestion(target);
    // A choice made in the ⋯ sheet or the class list is done: the sheet goes,
    // and shell.js acts on the tap as it does on the card's own.
    if (
      (action === 'm-grade-view' || action === 'm-grade-status' || action === 'm-grade-jump') &&
      target.closest('.m-more-sheet, .m-roster')
    )
      W.MComponents.dismissSheet();
  });

  return {
    bar: bar,
    show: show,
    commentLabel: commentLabel,
    unitName: unitName,
    caughtUp: caughtUp,
    openMore: openMore,
    openRoster: openRoster,
    hold: hold,
    held: held,
    flush: flush,
    suggestion: suggestion,
    rememberComment: rememberComment,
  };
})();
