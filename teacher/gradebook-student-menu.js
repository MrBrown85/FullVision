// @ts-check
/* ── gradebook-student-menu.js — the menu on a student's name ──────────
   A click (or a right-click) on a name in the Gradebook opens it, as a click
   on a column's title opens the column's menu. On top, what a teacher does
   with one student: open their page, show only their row, add an
   observation, copy the list of their missing work. Under those, three
   lists that act on the student's whole row:

   - Mark Missing: the blank cells, all of them or a category's or a month's.
   - Excuse: the blank cells, the Missing ones, or both, narrowed the same way.
   - Clear: every Missing, Excused or Late off the row.

   Each line says how many cells it changes; a line with none is greyed, and
   a category or month with none is left out. A cell is blank when it has no
   score, mark, status or feedback and its work is due by today, so work not
   due yet is never touched. Only the columns on screen count, as the
   column's Mark Blank Cells counts only the rows on screen. Scored work is
   never changed (canSetAssignmentStatus).

   One use is undone by its toast, by Cmd+Z, or by Undo Last Marking in the
   same menu, which is kept on this device: each cell goes back to what it
   held, where it still holds what the use left.

   teacher/page-gradebook.js opens it and passes its own menu pieces
   (`h`): item, place, wire, dismiss, undoStack, redraw, showOnly, only. */
/** @type {any} */ (window).GradebookStudentMenu = (function () {
  'use strict';

  var G = /** @type {any} */ (window); // the app's globals that have no types yet

  var MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  var CHEVRON =
    '<svg class="gb-ctx-chevron" aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>';
  var RULE = '<div class="gb-ctx-divider"></div>';

  /** @type {any} */
  var _toast = null; // the use the Undo toast on screen is for

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* The last use on one student's row, kept on this device for Undo Last
     Marking: [{ aid, was, now }]. */
  function _stored(cid, sid) {
    try {
      return JSON.parse(localStorage.getItem('gb_rowStatus_' + cid + '_' + sid) || '[]');
    } catch (e) {
      return [];
    }
  }
  function _store(cid, sid, changes) {
    try {
      if (changes.length) localStorage.setItem('gb_rowStatus_' + cid + '_' + sid, JSON.stringify(changes));
      else localStorage.removeItem('gb_rowStatus_' + cid + '_' + sid);
    } catch (e) {}
  }

  function _due(a) {
    return String(a.dueDate || a.date || '').slice(0, 10);
  }

  /* The student's cells in the columns on screen, by what they hold:
     { blank, missing, both, excused, late }, each a list of assessments in
     the columns' order. */
  function _cells(cid, sid) {
    /** @type {Record<string, boolean>} */
    var shown = {};
    document.querySelectorAll('#gb-data tr[data-sid="' + sid + '"] td[data-aid]').forEach(function (td) {
      shown[/** @type {HTMLElement} */ (td).dataset.aid || ''] = true;
    });
    var today = courseToday(cid);
    /** @type {Record<string, any[]>} */
    var out = { blank: [], missing: [], both: [], excused: [], late: [] };
    getAssessments(cid).forEach(function (a) {
      if (!shown[a.id]) return;
      var status = getAssignmentStatus(cid, sid, a.id);
      if (status === 'NS') {
        out.missing.push(a);
        out.both.push(a);
      } else if (status === 'EXC') out.excused.push(a);
      else if (status === 'LATE') out.late.push(a);
      else if (
        assessmentCellValue(cid, sid, a).kind === 'none' &&
        _due(a) <= today &&
        canSetAssignmentStatus(cid, sid, a.id, 'NS')
      ) {
        out.blank.push(a);
        out.both.push(a);
      }
    });
    return out;
  }

  /* ── One use, and its undo ──────────────────────────────────── */

  function _holds(statuses, sid, change) {
    return (statuses[sid + ':' + change.aid] || null) === change.now;
  }

  /* Puts back what one use changed, where the cell still holds what the use
     left, from the toast, Cmd+Z or Undo Last Marking. */
  function _undo(h, use) {
    var i = h.undoStack.indexOf(use);
    if (i >= 0) h.undoStack.splice(i, 1);
    var statuses = getAssignmentStatuses(use.cid);
    use.changes.forEach(function (c) {
      if (!_holds(statuses, use.sid, c)) return;
      if (c.was) statuses[use.sid + ':' + c.aid] = c.was;
      else delete statuses[use.sid + ':' + c.aid];
    });
    G.Grader.undoMarkStudentCells(use.cid, use.sid, statuses);
    _store(use.cid, use.sid, []);
    if (_toast === use) {
      _toast = null;
      if (typeof G.dismissUndoToast === 'function') G.dismissUndoToast();
    }
    clearProfCache();
    h.redraw(use.cid);
  }

  /* The cells of `list` become `to` ('NS', 'EXC', or null for none), with an
     Undo toast and Cmd+Z; `say(n)` words the toast. */
  function _mark(h, cid, student, list, to, say) {
    var sid = student.id;
    var statuses = getAssignmentStatuses(cid);
    var changes = [];
    list.forEach(function (a) {
      var key = sid + ':' + a.id;
      var was = statuses[key] || null;
      if (was === to) return;
      if (to) statuses[key] = to;
      else delete statuses[key];
      changes.push({ aid: a.id, was: was, now: to });
    });
    if (!changes.length) return;
    G.Grader.markStudentCells(cid, sid, statuses);
    _store(cid, sid, changes);
    clearProfCache();
    h.redraw(cid);
    var use = {
      cid: cid,
      sid: sid,
      statuses: [], // page-gradebook.js reads a use with `statuses` as a bulk one
      changes: changes,
      still: function () {
        var st = getAssignmentStatuses(cid);
        return changes.every(function (c) {
          return _holds(st, sid, c);
        });
      },
      back: function () {
        _undo(h, use);
      },
    };
    h.undoStack.push(use);
    while (h.undoStack.length > 50) h.undoStack.shift();
    _toast = use;
    showUndoToast(
      say(changes.length) + ' for ' + displayName(student),
      use.back,
      function () {
        if (_toast === use) _toast = null;
      },
      10000,
    );
  }

  /* Undo Last Marking: this session's use when it is still on the stack,
     else the one kept on this device. */
  function _undoLast(h, cid, sid) {
    for (var i = h.undoStack.length - 1; i >= 0; i--) {
      var use = h.undoStack[i];
      if (use.back && use.cid === cid && use.sid === sid) return _undo(h, use);
    }
    _undo(h, { cid: cid, sid: sid, changes: _stored(cid, sid) });
  }

  /* The student's missing work as lines to paste into a message: who and
     which class, then a line a piece with its day. */
  function _copyMissing(cid, student, missing) {
    var lines = [displayName(student) + ': missing work in ' + ((COURSES[cid] || {}).name || 'this class')].concat(
      missing.map(function (a) {
        var day = formatShortDate(_due(a));
        return (a.title || 'Assessment') + (day ? ' (' + day + ')' : '');
      }),
    );
    var done = function (ok) {
      showSyncToast(ok ? 'Missing work list copied' : 'The list could not be copied', 'info');
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) return done(false);
    navigator.clipboard.writeText(lines.join('\n')).then(
      function () {
        done(true);
      },
      function () {
        done(false);
      },
    );
  }

  /* ── The menu ───────────────────────────────────────────────── */

  // html-safe: every label is fixed text or goes through esc; counts are numbers; icons are fixed markup.
  function open(at, name, h) {
    h.dismiss();
    var cid = h.cid;
    var sid = name.dataset.sid;
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!student) return;
    var c = _cells(cid, sid);
    var acts = {};
    var n = 0;
    var hint = function (count) {
      return count ? '<span class="gb-ctx-hint">' + count + '</span>' : '';
    };
    // One line of a list: its label, how many cells it changes, and what it does.
    var line = function (label, list, to, say) {
      var key = 'row' + n++;
      acts[key] = function () {
        _mark(h, cid, student, list, to, say);
      };
      return {
        n: list.length,
        html: h.item(key, '', esc(label), list.length ? '' : 'is-disabled', '', hint(list.length)),
      };
    };
    // The same cells a category at a time, then a month at a time.
    var narrowed = function (list, to, say) {
      var cats = (getCategories(cid) || [])
        .map(function (cat) {
          return line(
            'In ' + cat.name,
            list.filter(function (a) {
              return (a.categoryId || a.category_id || null) === cat.id;
            }),
            to,
            say,
          );
        })
        .filter(function (l) {
          return l.n > 0;
        });
      var months = [];
      list.forEach(function (a) {
        var m = _due(a).slice(0, 7);
        if (m && months.indexOf(m) < 0) months.push(m);
      });
      var byMonth = months.sort().map(function (m) {
        return line(
          'Due in ' + MONTHS[Number(m.slice(5, 7)) - 1],
          list.filter(function (a) {
            return _due(a).slice(0, 7) === m;
          }),
          to,
          say,
        );
      });
      var html = function (lines) {
        return lines.length
          ? RULE +
              lines
                .map(function (l) {
                  return l.html;
                })
                .join('')
          : '';
      };
      return html(cats) + html(byMonth.length > 1 ? byMonth : []);
    };
    var sayMissing = function (count) {
      return _plural(count, 'blank cell', 'blank cells') + ' marked Missing';
    };
    var sayExcused = function (count) {
      return _plural(count, 'cell', 'cells') + ' marked Excused';
    };
    var sayCleared = function (what) {
      return function (count) {
        return what + ' cleared from ' + _plural(count, 'cell', 'cells');
      };
    };
    var list = function (key, label, html) {
      return '<div class="gb-ctx-sub" data-sub="' + key + '" aria-label="' + label + '" hidden>' + html + '</div>';
    };
    var parent = function (key, icon, label) {
      return h.item('sub:' + key, icon, label, 'gb-ctx-parent', '', CHEVRON);
    };
    var only = h.only.length === 1 && h.only[0] === sid;

    var menu = document.createElement('div');
    menu.className = 'gb-ctx-menu';
    // html-safe: h.item gets fixed actions, icons and labels; a line's label goes through esc, its count is a number.
    menu.innerHTML =
      h.item('openStudent', LINE_ICONS.student, 'Open Student Page') +
      h.item('showOnly', LINE_ICONS.filter, only ? 'Show All Students' : 'Show Only This Student') +
      h.item('observe', LINE_ICONS.observe, 'Add Observation') +
      h.item(
        'copyMissing',
        LINE_ICONS.copy,
        'Copy Missing Work List',
        c.missing.length ? '' : 'is-disabled',
        c.missing.length ? '' : 'This student has no missing work.',
        hint(c.missing.length),
      ) +
      RULE +
      parent('missing', LINE_ICONS.missing, 'Mark Missing') +
      parent('excuse', LINE_ICONS.excused, 'Excuse') +
      parent('clear', LINE_ICONS.clear, 'Clear') +
      (_stored(cid, sid).length ? h.item('undoLast', LINE_ICONS.undo, 'Undo Last Marking') : '') +
      list(
        'missing',
        'Mark Missing',
        line('All Blank Cells', c.blank, 'NS', sayMissing).html + narrowed(c.blank, 'NS', sayMissing),
      ) +
      list(
        'excuse',
        'Excuse',
        line('Blank Cells', c.blank, 'EXC', sayExcused).html +
          line('Missing Cells', c.missing, 'EXC', sayExcused).html +
          line('Blank and Missing Cells', c.both, 'EXC', sayExcused).html +
          narrowed(c.both, 'EXC', sayExcused),
      ) +
      list(
        'clear',
        'Clear',
        line('All Missing', c.missing, null, sayCleared('Missing')).html +
          line('All Excused', c.excused, null, sayCleared('Excused')).html +
          line('All Late', c.late, null, sayCleared('Late')).html,
      );

    // The row stays lit while its menu is open, as a column does (dismiss clears it).
    var head = name.closest('.gb-grid-rowhead');
    if (head) head.classList.add('gb-col-menu');
    document.querySelectorAll('#gb-data tr[data-sid="' + sid + '"]').forEach(function (tr) {
      tr.classList.add('gb-col-menu');
    });

    // From the keyboard the click has no pointer position: under the name.
    var rect = name.getBoundingClientRect();
    var keyboard = !at.clientX && !at.clientY;
    h.place(menu, keyboard ? rect.left : at.clientX, keyboard ? rect.bottom : at.clientY);
    h.wire(menu, name);
    menu.querySelectorAll('.gb-ctx-sub').forEach(function (sub) {
      sub.setAttribute('role', 'menu');
    });
    menu.querySelectorAll('.gb-ctx-parent').forEach(function (p) {
      p.setAttribute('aria-haspopup', 'menu');
      p.setAttribute('aria-expanded', 'false');
    });

    /* One list open at a time, beside its line: to the left when the window
       has no room on the right, and never past the window's foot. */
    function openSub(key) {
      menu.querySelectorAll('.gb-ctx-sub').forEach(function (/** @type {any} */ sub) {
        sub.hidden = sub.dataset.sub !== key;
      });
      menu.querySelectorAll('.gb-ctx-parent').forEach(function (/** @type {any} */ p) {
        var on = p.dataset.ctx === 'sub:' + key;
        p.classList.toggle('is-open', on);
        p.setAttribute('aria-expanded', on ? 'true' : 'false');
      });
      var sub = /** @type {any} */ (key && menu.querySelector('.gb-ctx-sub[data-sub="' + key + '"]'));
      if (!sub) return null;
      var from = /** @type {Element} */ (menu.querySelector('[data-ctx="sub:' + key + '"]')).getBoundingClientRect();
      var box = menu.getBoundingClientRect();
      var left = box.right - 4;
      if (left + sub.offsetWidth > window.innerWidth - 8) left = Math.max(8, box.left - sub.offsetWidth + 4);
      var top = from.top - 5;
      if (top + sub.offsetHeight > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - sub.offsetHeight);
      sub.style.left = left + 'px';
      sub.style.top = top + 'px';
      return sub;
    }
    var subOf = function (item) {
      var ctx = (item && item.dataset.ctx) || '';
      return ctx.indexOf('sub:') === 0 ? ctx.slice(4) : null;
    };
    var choices = function (box) {
      return Array.prototype.filter.call(box.children, function (el) {
        return el.classList.contains('gb-ctx-item') && !el.classList.contains('is-disabled');
      });
    };

    // The pointer on a line of the menu opens its list, or closes the open one.
    menu.addEventListener('mouseover', function (ev) {
      var item = /** @type {any} */ (ev.target).closest('.gb-ctx-item');
      if (item && item.parentNode === menu) openSub(subOf(item));
    });

    /* Arrow keys move through the list the focus is in; → opens a line's
       list and ← or Escape goes back to the line; Return or Space picks. */
    menu.addEventListener(
      'keydown',
      function (ev) {
        var on = /** @type {any} */ (document.activeElement);
        var box = on && on.classList.contains('gb-ctx-item') ? on.parentNode : menu;
        var items = choices(box);
        var i = items.indexOf(on);
        var key = ev.key;
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
          if (!items.length) return;
          var next =
            key === 'Home'
              ? 0
              : key === 'End'
                ? items.length - 1
                : key === 'ArrowDown'
                  ? (i + 1) % items.length
                  : i <= 0
                    ? items.length - 1
                    : i - 1;
          if (box === menu) openSub(null);
          items[next].focus();
        } else if ((key === 'ArrowRight' || key === 'Enter' || key === ' ') && subOf(on)) {
          var first = choices(openSub(subOf(on)))[0];
          if (first) first.focus();
        } else if ((key === 'ArrowLeft' || key === 'Escape') && box !== menu) {
          var line = /** @type {any} */ (menu.querySelector('[data-ctx="sub:' + box.dataset.sub + '"]'));
          openSub(null);
          line.focus();
        } else if ((key === 'Enter' || key === ' ') && i >= 0) on.click();
        else if (key === 'Escape' || key === 'Tab') h.dismiss(true);
        else return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
      },
      true,
    );

    menu.addEventListener('click', function (ev) {
      var item = /** @type {any} */ (ev.target).closest('[data-ctx]');
      if (!item || item.classList.contains('is-disabled')) return;
      var ctx = item.dataset.ctx;
      // A tap on a line with a list opens it, and a second tap closes it.
      if (subOf(item)) return void openSub(item.classList.contains('is-open') ? null : subOf(item));
      h.dismiss(true);
      if (ctx === 'openStudent') G.Router.navigate(name.dataset.href);
      else if (ctx === 'showOnly') h.showOnly(only ? null : sid);
      else if (ctx === 'observe')
        G.ObsCapture.openDialog({
          cid: cid,
          title: 'Add Observation',
          subtitle: displayName(student),
          students: [sid],
          lockStudents: true,
          draftKey: 'gb-row|' + sid,
        });
      else if (ctx === 'copyMissing') _copyMissing(cid, student, c.missing);
      else if (ctx === 'undoLast') _undoLast(h, cid, sid);
      else if (acts[ctx]) acts[ctx]();
    });

    // Opened from the keyboard, the first line has the focus.
    if (keyboard) choices(menu)[0].focus();
  }

  return { open: open };
})();
