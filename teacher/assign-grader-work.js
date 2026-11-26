// @ts-check
/* assign-grader-work.js — The student's work in the grader. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignGraderWork = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var _formWorkDemo,
    _graderFootHtml,
    _graderGroupView,
    _graderHeadHtml,
    _graderPanelHtml,
    _graderToTop,
    _graderToolbarHtml,
    _graderUnits,
    _rowFillOptionsHtml,
    _setEveryonePlan,
    _showFillUndo,
    _unitIds,
    pageState,
    render,
    _graderRevisionOf,
    _revisionFirstDay,
    _revisionFirstSub,
    _revisionIn,
    _revisionWhen;
  function configure(h) {
    if ('_formWorkDemo' in h) _formWorkDemo = h._formWorkDemo;
    if ('_graderFootHtml' in h) _graderFootHtml = h._graderFootHtml;
    if ('_graderGroupView' in h) _graderGroupView = h._graderGroupView;
    if ('_graderHeadHtml' in h) _graderHeadHtml = h._graderHeadHtml;
    if ('_graderPanelHtml' in h) _graderPanelHtml = h._graderPanelHtml;
    if ('_graderToTop' in h) _graderToTop = h._graderToTop;
    if ('_graderToolbarHtml' in h) _graderToolbarHtml = h._graderToolbarHtml;
    if ('_graderUnits' in h) _graderUnits = h._graderUnits;
    if ('_rowFillOptionsHtml' in h) _rowFillOptionsHtml = h._rowFillOptionsHtml;
    if ('_setEveryonePlan' in h) _setEveryonePlan = h._setEveryonePlan;
    if ('_showFillUndo' in h) _showFillUndo = h._showFillUndo;
    if ('_unitIds' in h) _unitIds = h._unitIds;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_graderRevisionOf' in h) _graderRevisionOf = h._graderRevisionOf;
    if ('_revisionFirstDay' in h) _revisionFirstDay = h._revisionFirstDay;
    if ('_revisionFirstSub' in h) _revisionFirstSub = h._revisionFirstSub;
    if ('_revisionIn' in h) _revisionIn = h._revisionIn;
    if ('_revisionWhen' in h) _revisionWhen = h._revisionWhen;
  }

  /* ── The student's work in the dialog (S6-F1 to F3) ────────
     In a class whose student page (the build switch) and Send Work are on,
     on a piece whose Students Send is not Nothing (Grader.workOn), the
     dialog grows a work pane beside the scoring panel:
     - under the student's name, what came in ("Submitted Oct 30, 8:41 pm
       · 2 photos", "Not In · 7 days late"), "Same photo as Mia K." when a
       page is byte for byte another student's, and a strip of the students
       whose work waits;
     - every page the student sent, one under the other, each with its
       own bar (its number, Rotate, the view only, and Mark Up); over them
       Whole Page and Fit Width and Focus on Work; under them the
       student's note and Unsubmit;
     - with nothing in: Add Work (Choose Files, shrunk as a student's are,
       shared/photo-shrink.js) and Grade From Paper's Set Logan To.
     Focus on Work gives the page the room and narrows the scoring to a
     column with short level names (EMG, DEV, PRF, EXT).
     Demo Mode only for now: signed in, the data layer answers nothing is in
     and Add Work answers not_available (S6-W1 wires it). Every answer from
     the photo store, a file shrink or a confirm checks that the dialog
     still shows the same piece and student before it draws. */
  var _WORK_ROTATE_ICON =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  var _WORK_SHORT = { 1: 'EMG', 2: 'DEV', 3: 'PRF', 4: 'EXT' };

  // html-safe: the parts' fixed markup
  function _graderWorkShellHtml() {
    return (
      // The Show bar sits in the top bar here, beside Print Rubrics, not in a row of its own.
      _graderToolbarHtml().replace(
        '<div class="grader-toolbar-start"></div>',
        '<div class="grader-toolbar-lead"><div class="grader-toolbar-start"></div><div class="grader-show-slot"></div></div>',
      ) +
      '<div class="grader-scroll grader-scroll-work">' +
      // One row over the work and the scoring (Colin, Nov 13): the name,
      // when the work came in, how the pages show, and the status.
      _graderHeadHtml().replace(
        '<span class="grader-spacer"></span>',
        '<div class="grader-work-line"></div><div class="grader-work-view"></div><span class="grader-spacer"></span>',
      ) +
      '<div class="grader-split">' +
      '<section class="grader-work" aria-label="Student work"></section>' +
      '<div class="grader-panel-col">' +
      _graderPanelHtml() +
      '</div></div></div>' +
      _graderFootHtml()
    );
  }

  // The shell changed under a drawn dialog: what it remembers drawing is gone.
  function _graderForgetDrawn() {
    [
      'statusHtml',
      'markHtml',
      'membersHtml',
      'lineHtml',
      'returnHtml',
      'showHtml',
      'workHtml',
      'workLineHtml',
      'workToolsHtml',
      'reflectHtml',
      'revisionHtml',
    ].forEach(function (k) {
      pageState._grader[k] = null;
    });
    _graderReleasePage(pageState._grader);
  }

  // A photo's address holds its bytes until it is let go (openStudentWorkPage).
  function _graderReleasePage(g) {
    if (!g || !g.work) return;
    var pics = g.work.pics || {};
    g.work.pics = {};
    Object.keys(pics).forEach(function (key) {
      if (pics[key].release) pics[key].release();
    });
  }

  function _workStudent(cid, sid) {
    return (
      getStudents(cid).find(function (x) {
        return x.id === sid;
      }) || null
    );
  }

  // "Oct 30, 8:41 pm"
  function _workWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var day = formatShortDate(String(ts).slice(0, 10));
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    return day + ', ' + time;
  }

  function _workPhotos(n) {
    return n + (n === 1 ? ' photo' : ' photos');
  }
  // "2 photos", "1 link", "2 photos · 1 link": a submission's pages and the links added to it (Demo Mode).
  function _workPhotosAndLinks(sub) {
    var n = ((sub && sub.files) || []).length;
    var links = ((sub && sub.links) || []).length;
    if (!links) return _workPhotos(n);
    var said = links + (links === 1 ? ' link' : ' links');
    return n ? _workPhotos(n) + ' · ' + said : said;
  }

  /* The work the grader shows for `sid` (S12-F2): on a One per Group
     piece the group's, whoever sent it (getGroupWorkFiles), as one
     submission-like answer { group: true, sender, sent_at, note, noteBy,
     files, own }; otherwise the student's own submission, as before. */
  function _workSubOf(cid, sid, aid) {
    var own = getStudentSubmission(cid, sid, aid);
    var group = typeof getStudentWorkGroup === 'function' ? getStudentWorkGroup(cid, sid, aid) : null;
    if (!group) return own;
    var subs = getGroupSubmissions(cid, sid, aid);
    if (!subs.length) return null;
    var first = subs.slice().sort(function (x, y) {
      return String(x.sent_at || x.created_at) < String(y.sent_at || y.created_at) ? -1 : 1;
    })[0];
    var noted = subs.find(function (x) {
      return x.note;
    });
    return {
      group: true,
      sender: first.enrollment_id,
      sent_by: first.sent_by,
      sent_at: first.sent_at,
      created_at: first.created_at,
      on_paper: subs.every(function (x) {
        return x.on_paper;
      }),
      note: noted ? noted.note : null,
      noteBy: noted ? noted.enrollment_id : null,
      files: getGroupWorkFiles(cid, sid, aid),
      own: own,
    };
  }

  /* The line under the name: what came in, or that nothing has. */
  function _workLineText(cid, a, sid, sub) {
    if (sub && sub.group && !sub.on_paper) {
      // "Sent by Priya S. for the group, Nov 3 · 4 photos"
      var by = sub.sent_by === 'teacher' ? null : _workStudent(cid, sub.sender);
      var day =
        sub.sent_at || sub.created_at ? formatShortDate(String(sub.sent_at || sub.created_at).slice(0, 10)) : '';
      return (
        (by ? 'Sent by ' + _workShortName(by) + ' for the group' : 'Added by you for the group') +
        (day ? ', ' + day : '') +
        ' · ' +
        _workPhotos((sub.files || []).length)
      );
    }
    if (sub) {
      // A revision in (S11-F3): "Revised Nov 9, 7:12 pm · 1 new page".
      var rv = _graderRevisionOf(cid, a, sid);
      if (_revisionIn(rv) && rv.revision_submission_id === sub.id) {
        var n = (sub.files || []).length;
        var at = _revisionWhen(rv.revision_sent_at);
        return 'Revised' + (at ? ' ' + at : '') + ' · ' + n + (n === 1 ? ' new page' : ' new pages');
      }
      if (sub.on_paper) return 'Handed in on paper';
      var when = _workWhen(sub.sent_at || sub.created_at);
      var verb = sub.sent_by === 'teacher' ? 'Added by you' : 'Submitted';
      return verb + (when ? ' ' + when : '') + ' · ' + _workPhotosAndLinks(sub);
    }
    var status = getAssignmentStatus(cid, sid, a.id);
    if (status === 'EXC') return 'Excused';
    var head = status === 'NS' ? 'Missing' : 'Not In';
    var due = a.dueDate || a.due_date || null;
    if (!due) return head;
    var days = Math.round((Date.parse(courseToday(cid)) - Date.parse(String(due).slice(0, 10))) / 86400000);
    if (days > 0) return head + ' · ' + days + (days === 1 ? ' day late' : ' days late');
    return head + ' · Due ' + formatShortDate(String(due).slice(0, 10));
  }

  // "Mia K."
  function _workShortName(st) {
    if (!st) return '';
    var last = String(st.lastName || '').trim();
    return displayNameFirst(st) + (last ? ' ' + last.charAt(0) + '.' : '');
  }

  /* The line: what came in, Same photo as, and the strip of the students
     whose work waits (up to five, then "+2"). Redrawn only when it changes. */
  // html-safe: names go through esc; ids are ours; labels are fixed words
  function _workLineHtml(cid, a, sid) {
    var sub = _workSubOf(cid, sid, a.id);
    var html = '<span class="grader-work-what">' + esc(_workLineText(cid, a, sid, sub)) + '</span>';
    GraderWork.samePhotoAs(cid, a.id, sid, pageState._grader.studentIds).forEach(function (other) {
      var st = _workStudent(cid, other);
      if (!st) return;
      html +=
        '<button type="button" class="grader-work-same" data-grader="work-open" data-sid="' +
        other +
        '" title="' +
        esc('A page of this work is the same photo, byte for byte, as one of ' + displayNameWithLast(st) + '’s.') +
        '">' +
        esc('Same photo as ' + _workShortName(st)) +
        '</button>';
    });
    var waiting = GraderWork.workCounts(cid, a.id, pageState._grader.studentIds).ids.tograde;
    // Group work (S12-F2): one button a group, "Groups to grade".
    var units = waiting.length ? _graderUnits(cid, a) : null;
    if (units) {
      var on = _graderGroupView(cid, a, sid);
      var shownUnits = units.filter(function (u) {
        return _unitIds(u).some(function (id) {
          return waiting.indexOf(id) >= 0;
        });
      });
      var firstUnits = shownUnits.slice(0, 5);
      var moreUnits = shownUnits.length - firstUnits.length;
      return (
        html +
        '<span class="grader-work-strip" role="group" aria-label="Groups to grade">' +
        firstUnits
          .map(function (u) {
            var to = u.source || u.sid;
            var here = on ? !!u.linked && u.linked.indexOf(sid) >= 0 : u.sid === sid;
            var st = u.linked ? null : _workStudent(cid, u.sid);
            var name = u.linked ? collabGroupLabel(u.group) : st ? displayNameWithLast(st) : '';
            var face = u.linked ? String(u.group.index + 1) : st ? initials(st) : '';
            return (
              '<button type="button" class="grader-work-who' +
              (here ? ' is-on' : '') +
              '" data-grader="work-open" data-sid="' +
              to +
              '" aria-label="' +
              esc(name) +
              '" title="' +
              esc(name) +
              '"' +
              (here ? ' aria-current="true"' : '') +
              '>' +
              esc(face) +
              '</button>'
            );
          })
          .join('') +
        (moreUnits
          ? '<button type="button" class="grader-work-who grader-work-more" data-grader="show" data-show="tograde" aria-label="' +
            moreUnits +
            ' more to grade">+' +
            moreUnits +
            '</button>'
          : '') +
        '</span>'
      );
    }
    if (waiting.length) {
      var shown = waiting.slice(0, 5);
      var more = waiting.length - shown.length;
      html +=
        '<span class="grader-work-strip" role="group" aria-label="Students to grade">' +
        shown
          .map(function (id) {
            var st = _workStudent(cid, id);
            var name = st ? displayNameWithLast(st) : '';
            return (
              '<button type="button" class="grader-work-who' +
              (id === sid ? ' is-on' : '') +
              '" data-grader="work-open" data-sid="' +
              id +
              '" aria-label="' +
              esc(name) +
              '" title="' +
              esc(name) +
              '"' +
              (id === sid ? ' aria-current="true"' : '') +
              '>' +
              esc(st ? initials(st) : '') +
              '</button>'
            );
          })
          .join('') +
        (more
          ? '<button type="button" class="grader-work-who grader-work-more" data-grader="show" data-show="tograde" aria-label="' +
            more +
            ' more to grade">+' +
            more +
            '</button>'
          : '') +
        '</span>';
    }
    return html;
  }

  function _refreshGraderWorkLine(dialog, cid, a, sid) {
    var line = dialog.querySelector('.grader-work-line');
    if (!line) return;
    var html = _workLineHtml(cid, a, sid);
    if (pageState._grader.workLineHtml === html) return;
    pageState._grader.workLineHtml = html;
    // html-safe: built by _workLineHtml
    line.innerHTML = html;
  }

  /* The work the pane shows: _workSubOf's, or, while a revision is in and
     First is chosen (S11-F3), the first version. */
  function _workPaneSubOf(cid, sid, aid) {
    var sub = _workSubOf(cid, sid, aid);
    var w = pageState._grader && pageState._grader.work;
    if (!w || w.version !== 'first' || !sub || sub.group) return sub;
    var a = _assessmentById(cid, aid);
    var r = _graderRevisionOf(cid, a, sid);
    if (!_revisionIn(r) || r.revision_submission_id !== sub.id) return sub;
    return _revisionFirstSub(cid, a, sid, r) || sub;
  }

  /* New and First, while a revision is in (S11-F3): which version's pages
     the pane shows. '' otherwise. */
  // html-safe: dates from formatShortDate through esc; labels are fixed words
  function _workVersionsHtml(cid, a, sid) {
    var r = _graderRevisionOf(cid, a, sid);
    var sub = _workSubOf(cid, sid, a.id);
    if (!_revisionIn(r) || !sub || r.revision_submission_id !== sub.id) return '';
    var firstSub = _revisionFirstSub(cid, a, sid, r);
    if (!firstSub || firstSub.id === sub.id) return '';
    var first = pageState._grader.work.version === 'first';
    var newDay = r.revision_sent_at ? formatShortDate(r.revision_sent_at) : '';
    var firstDay = _revisionFirstDay(cid, a, sid, r);
    return (
      '<div class="seg seg-sm grader-work-versions" role="group" aria-label="Version">' +
      '<button type="button" class="seg-btn"' +
      segAttr(!first) +
      ' data-grader="work-version" data-version="new">' +
      esc('New' + (newDay ? ' · ' + newDay : '')) +
      '</button><button type="button" class="seg-btn"' +
      segAttr(first) +
      ' data-grader="work-version" data-version="first">' +
      esc('First' + (firstDay ? ' · ' + firstDay : '')) +
      '</button></div>'
    );
  }

  // Mark Up is kept for the student to read: only where the student page's rows are kept.
  function _markUpHere(cid) {
    return _formWorkDemo() || (typeof studentWorkLive === 'function' && studentWorkLive(cid));
  }

  /* All Pages: the columns and rows that show `n` pages at once, as large
     as a portrait page can be in a pane about as tall as it is wide: side
     by side up to three, then two or three rows (four at most across). */
  function _workGrid(n) {
    var cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4;
    return { cols: Math.max(1, cols), rows: Math.min(3, Math.ceil(n / Math.max(1, cols))) };
  }

  /* How the pages are shown, in the student row beside the name (Colin,
     Nov 13: fewer rows of buttons over the page): New and First while a
     revision is in, All Pages, Whole Page and Fit Width, and Focus on
     Work. '' with no pages. */
  // html-safe: fixed labels; the versions' dates go through esc
  // `sub` and `versions` are worked out once a draw, in _drawGraderWork.
  function _workToolsHtml(sub, versions) {
    var w = pageState._grader.work;
    var files = (sub && sub.files) || [];
    if (!files.length) return '';
    var fit = _workFit(w, files.length);
    return (
      versions +
      '<div class="seg seg-sm grader-work-fit" role="group" aria-label="Show">' +
      // Two choices (the review council, Nov 13: three read alike): every
      // page side by side, or each page the column's full width, one under
      // the other. One page: the whole page, or full width.
      (files.length > 1 ? ['all', 'width'] : ['page', 'width'])
        .map(function (f) {
          return (
            '<button type="button" class="seg-btn"' +
            segAttr(fit === f) +
            ' data-grader="work-fit" data-fit="' +
            f +
            '">' +
            (f === 'all' ? 'Side by Side' : f === 'page' ? 'Whole Page' : 'Full Width') +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<button type="button" class="grader-work-tool grader-work-focus" data-grader="work-focus" aria-pressed="' +
      !!w.focus +
      '">Focus on Work</button>'
    );
  }

  // Side by Side (every page in view at once) or Full Width; one page shows whole or full width.
  function _workFit(w, n) {
    if (w.fit === 'width') return 'width';
    return n > 1 ? 'all' : 'page';
  }

  // The teacher's choice of Side by Side or Full Width, kept on this device for the next dialog.
  var _WORK_FIT_KEY = 'fv-grader-work-fit';
  function _workFitSaved() {
    try {
      return localStorage.getItem(_WORK_FIT_KEY) === 'width' ? 'width' : 'all';
    } catch (e) {
      return 'all';
    }
  }

  /* The pane for `st`: their pages, or Add Work when nothing is in. */
  // html-safe: names and the note go through esc; ids are ours; labels are fixed words
  function _workPaneHtml(cid, a, st, view, sub, versions) {
    var w = pageState._grader.work;
    // The first version is for looking at: Mark Up and Unsubmit are the new one's.
    var onFirst = !!versions && w.version === 'first';
    var first = view ? view.label : displayNameFirst(st);
    var files = (sub && sub.files) || [];
    if (!sub) return _addWorkHtml(cid, a, st, first);
    // Unsubmit puts one student's own piece back to not handed in; a group's is not offered here.
    var foot =
      sub.group || onFirst
        ? ''
        : '<div class="grader-work-foot"><button type="button" class="grader-work-unsubmit" data-grader="work-unsubmit">Unsubmit</button></div>';
    var links = _workLinksHtml(sub);
    if (!files.length && !links)
      return '<div class="grader-work-empty"><p>Handed in on paper. Grade it from the paper.</p></div>' + foot;
    var fit = _workFit(w, files.length);
    var grid = _workGrid(files.length);
    var markUp = !!(window.MarkUp && !onFirst && _markUpHere(cid));
    var html = !files.length
      ? ''
      : // Every page the student sent at once (Colin, Nov 13: "I shouldn't
        // have to switch pages"). On each page's corner: its number, Rotate
        // (the view only) and Mark Up (S9-F1, teacher/markup.js).
        '<div class="grader-work-pages fit-' +
        fit +
        (fit === 'all' ? ' cols-' + grid.cols + ' rows-' + grid.rows : '') +
        '">' +
        files
          .map(function (file, at) {
            var turn = w.turns[file.id] || 0;
            var what = 'Page ' + (at + 1) + ' of ' + files.length;
            var size =
              file.width > 0 && file.height > 0
                ? ' width="' + Math.round(file.width) + '" height="' + Math.round(file.height) + '"'
                : '';
            return (
              '<section class="grader-work-sheet" aria-label="' +
              esc(what) +
              '"><div class="grader-work-corner"><span class="grader-work-at">' +
              esc(what) +
              '</span><span class="grader-spacer"></span>' +
              '<button type="button" class="grader-work-tool grader-work-rotate" data-grader="work-rotate" data-at="' +
              at +
              '" aria-label="' +
              esc('Rotate ' + what) +
              '" title="Rotate">' +
              _WORK_ROTATE_ICON +
              '</button>' +
              (markUp
                ? '<button type="button" class="grader-work-tool grader-work-markup" data-grader="work-markup" data-at="' +
                  at +
                  '">Mark Up</button>'
                : '') +
              '</div>' +
              '<div class="grader-work-page fit-' +
              fit +
              ' turn-' +
              turn +
              (fit === 'all' ? '" title="Click to see this page full width' : '') +
              // The page's surface (S9-T1): the picture, and whatever is drawn
              // over it (Mark Up), turn and fit together inside it.
              '"><div class="grader-work-surface" data-file-id="' +
              esc(file.id) +
              '" data-page="' +
              (at + 1) +
              '"><img class="grader-work-img" alt="' +
              esc('Page ' + (at + 1) + ' of ' + (a.title || 'the work')) +
              '"' +
              size +
              '></div></div></section>'
            );
          })
          .join('') +
        '</div>';
    // Links the teacher attached from the row's + (Demo Mode), under the pages.
    html += links;
    // A revision's note is on its Revision card (S11-F3).
    if (sub.note && !(versions && !onFirst)) {
      var noteBy = sub.group ? _workStudent(cid, sub.noteBy) : null;
      html +=
        '<div class="grader-work-note"><h3 class="grader-work-note-title">' +
        esc(
          sub.group
            ? (noteBy ? displayNameFirst(noteBy) : 'The group') + '’s Note, Sent for the Group'
            : first + '’s Note, Sent With the Work',
        ) +
        '</h3><p>' +
        esc(sub.note) +
        '</p></div>';
    }
    return html + foot;
  }

  /* The links on a submission, each opening in a new tab. Only http(s)
     addresses are drawn (addStudentWorkLink checked them as they came in). */
  // html-safe: the address, its site and its name go through esc; the icon is fixed
  function _workLinksHtml(sub) {
    var links = ((sub && sub.links) || []).filter(function (l) {
      return l && /^https?:\/\//i.test(String(l.url || ''));
    });
    if (!links.length) return '';
    return (
      '<div class="grader-work-links"><h3 class="grader-work-note-title">' +
      (links.length === 1 ? 'Link' : 'Links') +
      '</h3><ul class="grader-work-link-list">' +
      links
        .map(function (l) {
          return (
            '<li><a class="grader-work-link" href="' +
            esc(l.url) +
            '" target="_blank" rel="noopener noreferrer" title="' +
            esc(l.url) +
            '">' +
            LINE_ICONS.link +
            '<span class="grader-work-link-name">' +
            esc(l.title || l.url) +
            '</span><span class="grader-work-link-host">' +
            esc(l.host || '') +
            '</span></a></li>'
          );
        })
        .join('') +
      '</ul></div>'
    );
  }

  /* Nothing in: Add Work, and Grade From Paper's Set Logan To. */
  // html-safe: the name goes through esc; labels are fixed words; levels are numbers
  function _addWorkHtml(cid, a, st, first) {
    var w = pageState._grader.work;
    var levels = !isPointsScored(a) && !isCompletionScored(a) && _setEveryonePlan(cid, a.id).perStudent > 0;
    var open = w.setTo === st.id;
    return (
      '<div class="grader-addwork">' +
      '<h3 class="grader-addwork-title">' +
      esc('Add Work for ' + first) +
      '</h3>' +
      '<p class="grader-addwork-hint">Photos or PDFs. Photos are made smaller before they upload.</p>' +
      '<label class="grader-addwork-choose' +
      (w.busy ? ' is-busy' : '') +
      '"><input type="file" class="grader-work-files" multiple accept="image/*,.heic,.heif,application/pdf"' +
      (w.busy ? ' disabled' : '') +
      '>' +
      (w.busy ? 'Adding…' : 'Choose Files') +
      '</label>' +
      '<p class="grader-addwork-msg" role="status">' +
      esc(w.msg || '') +
      '</p>' +
      (levels
        ? '<h3 class="grader-addwork-title">Grade From Paper</h3>' +
          '<div class="grader-setto"><button type="button" class="grader-setto-btn" data-grader="work-setto-menu" aria-haspopup="menu" aria-expanded="' +
          open +
          '">' +
          esc('Set ' + first + ' To') +
          '</button>' +
          '<div class="grader-setto-menu" role="menu"' +
          (open ? '' : ' hidden') +
          '>' +
          // The same options as a grid row's fill: a dot and the level's name.
          _rowFillOptionsHtml(cid, 'graderSetTo', a.id, st.id) +
          '</div></div>'
        : '') +
      '</div>'
    );
  }

  /* The pane, drawn only when it changes; every page's picture is fetched
     once, and let go when its page is no longer shown. Where the pages had
     been scrolled to is kept when the pane is drawn again. */
  function _drawGraderWork(dialog, cid, a, st, view) {
    var pane = dialog.querySelector('.grader-work');
    if (!pane) return;
    // The submission and its versions, read once for the whole draw.
    var sub = _workPaneSubOf(cid, st.id, a.id);
    var versions = view ? '' : _workVersionsHtml(cid, a, st.id);
    var tools = dialog.querySelector('.grader-work-view');
    var toolsHtml = _workToolsHtml(sub, versions);
    if (tools && pageState._grader.workToolsHtml !== toolsHtml) {
      pageState._grader.workToolsHtml = toolsHtml;
      // html-safe: built by _workToolsHtml
      tools.innerHTML = toolsHtml;
    }
    var html = _workPaneHtml(cid, a, st, view, sub, versions);
    if (pageState._grader.workHtml !== html) {
      pageState._grader.workHtml = html;
      var was = pane.querySelector('.grader-work-pages');
      var top = was ? was.scrollTop : 0;
      // html-safe: built by _workPaneHtml
      pane.innerHTML = html;
      var now = pane.querySelector('.grader-work-pages');
      if (now && top) now.scrollTop = top;
    }
    var files = (sub && sub.files) || [];
    var surfaces = pane.querySelectorAll('.grader-work-surface');
    if (!surfaces.length || !files.length) return _graderReleasePage(pageState._grader);
    var w = pageState._grader.work;
    if (!w.pics) w.pics = {};
    var g = pageState._grader;
    var keep = {};
    Array.prototype.forEach.call(surfaces, function (surface) {
      var file = files.find(function (f) {
        return f && String(f.id) === surface.dataset.fileId;
      });
      var img = surface.querySelector('.grader-work-img');
      if (!file || !img) return;
      _drawGraderMarks(surface, cid, file);
      var key = [cid, a.id, st.id, file.id, file.path].join('|');
      keep[key] = true;
      var pic = w.pics[key];
      if (pic) {
        // The pane was drawn again: a picture already fetched goes back in.
        if (pic.url && img.getAttribute('src') !== pic.url) img.src = pic.url;
        return;
      }
      pic = w.pics[key] = { url: null, release: null };
      openStudentWorkPage(cid, file, 'page').then(function (res) {
        // The dialog moved on (another student, version or piece, or closed).
        if (pageState._grader !== g || g.work.pics[key] !== pic) {
          if (res) res.release();
          return;
        }
        if (!res) return;
        pic.url = res.url;
        pic.release = res.release;
        Array.prototype.forEach.call(g.overlay.querySelectorAll('.grader-work-surface'), function (el) {
          var shown = el.dataset.fileId === String(file.id) && el.querySelector('.grader-work-img');
          if (shown) shown.src = res.url;
        });
      });
    });
    // Pictures of pages no longer shown are let go.
    Object.keys(w.pics).forEach(function (key) {
      if (keep[key]) return;
      if (w.pics[key].release) w.pics[key].release();
      delete w.pics[key];
    });
  }

  /* The teacher's marks on a page (S9-F1), over the picture on its
     surface: the working copy, what Return gives the student. Drawn
     again only when the marks or the page's shape change; the shape is the
     picture's, once it has loaded. */
  function _drawGraderMarks(surface, cid, file) {
    var img = surface && surface.querySelector('.grader-work-img');
    if (!surface || !img || !window.MarkupDraw) return;
    if (!img._markupLoad) {
      img._markupLoad = true;
      var g = pageState._grader;
      img.addEventListener('load', function () {
        if (pageState._grader === g && img.isConnected) _drawGraderMarks(surface, cid, file);
      });
    }
    var row = typeof getPageMarkup === 'function' ? getPageMarkup(cid, file.id) : null;
    var marks = row && row.marks && row.marks.marks && row.marks.marks.length ? row.marks : null;
    var html = marks ? MarkupDraw.svgHtml(marks, MarkupDraw.aspect(img)) : '';
    var layer = surface.querySelector('.markup-layer');
    if (layer && layer._html === html) return;
    if (layer) layer.remove();
    if (!html) return;
    // html-safe: built by MarkupDraw.svgHtml, which escapes a note's words
    img.insertAdjacentHTML('afterend', html);
    surface.querySelector('.markup-layer')._html = html;
  }

  /* The page on screen in the work pane, for a layer drawn over it (S9-T1,
     Mark Up): { el, img, cid, aid, sid, fileId, page, turn }, or null when
     no page shows. `el` is the surface: the picture fills it, it turns and
     fits with the picture, and a child placed over it with position:
     absolute and inset: 0 lies exactly on the page. */
  function workSurface() {
    if (!pageState._grader || !pageState._grader.workShell) return null;
    // The page last acted on (Rotate or Mark Up on its bar), else the first.
    var el =
      pageState._grader.overlay.querySelector(
        '.grader-work-surface[data-page="' + (pageState._grader.work.page + 1) + '"]',
      ) || pageState._grader.overlay.querySelector('.grader-work-surface');
    if (!el) return null;
    var a = _assessmentById(pageState.activeCourse, pageState._grader.aid);
    var sub = a && _workPaneSubOf(pageState.activeCourse, pageState.focusStudentId, a.id);
    var file =
      sub &&
      (sub.files || []).find(function (f) {
        return f && String(f.id) === el.dataset.fileId;
      });
    if (!file) return null;
    return {
      el: el,
      img: el.querySelector('.grader-work-img'),
      cid: pageState.activeCourse,
      aid: a.id,
      sid: pageState.focusStudentId,
      fileId: file.id,
      page: parseInt(el.dataset.page, 10),
      turn: pageState._grader.work.turns[file.id] || 0,
    };
  }

  /* In Focus on Work the scoring's level buttons show EMG, DEV, PRF and
     EXT, and keep their whole names for a screen reader and the hover. */
  function _graderShortLevels(dialog) {
    if (!dialog.classList.contains('is-focus')) return;
    dialog.querySelectorAll('.grader-panel-col button[data-level]').forEach(function (b) {
      var short = _WORK_SHORT[b.dataset.level];
      var name = b.textContent.trim();
      if (!short || !name || b.children.length) return;
      b.setAttribute('aria-label', name);
      b.title = name;
      // html-safe: fixed short names and the level's fixed name
      b.innerHTML =
        '<span class="lvl-full">' +
        esc(name) +
        '</span><span class="lvl-short" aria-hidden="true">' +
        short +
        '</span>';
    });
  }

  function _graderWorkAction(what, btn) {
    if (!pageState._grader) return;
    var cid = pageState.activeCourse;
    var a = _assessmentById(cid, pageState._grader.aid);
    var sid = pageState.focusStudentId;
    if (!a || !sid) return;
    var w = pageState._grader.work;
    /** @type {any} */ var again = null;
    // The page a page's own button acts on (its bar's data-at).
    var at = parseInt(btn.dataset.at, 10);
    if (at >= 0) w.page = at;
    if (what === 'work-fit') {
      w.fit = btn.dataset.fit === 'width' ? 'width' : 'all';
      try {
        localStorage.setItem(_WORK_FIT_KEY, w.fit);
      } catch (e) {
        /* the choice lasts this dialog only */
      }
      again = '[data-grader="work-fit"][data-fit="' + w.fit + '"]';
    } else if (what === 'work-version') {
      // New or First (S11-F3): the chosen version opens on its first page.
      var version = btn.dataset.version === 'first' ? 'first' : null;
      if (w.version !== version) w.page = 0;
      w.version = version;
      again = '[data-grader="work-version"][data-version="' + (version || 'new') + '"]';
    } else if (what === 'work-rotate') {
      var sub = _workPaneSubOf(cid, sid, a.id);
      var file = sub && (sub.files || [])[w.page];
      if (file) w.turns[file.id] = ((w.turns[file.id] || 0) + 90) % 360;
      again = '[data-grader="work-rotate"][data-at="' + w.page + '"]';
    } else if (what === 'work-focus') {
      w.focus = !w.focus;
      // The page fills the width it is given, as the board draws it.
      if (w.focus) w.fit = 'width';
      again = '[data-grader="work-focus"]';
    } else if (what === 'work-open') {
      if (!btn.dataset.sid || pageState._grader.studentIds.indexOf(btn.dataset.sid) < 0) return;
      pageState._grader.menuSid = null;
      pageState.focusStudentId = btn.dataset.sid;
      _graderToTop();
    } else if (what === 'work-setto-menu') {
      w.setTo = w.setTo === sid ? null : sid;
      again = '[data-grader="work-setto-menu"]';
    } else if (what === 'work-setto') {
      w.setTo = null;
      _graderSetTo(cid, a, sid, parseInt(btn.dataset.score, 10), btn.textContent.replace(/^\s*\d\s*/, '').trim());
    } else if (what === 'work-unsubmit') {
      return _graderAskUnsubmit(cid, a, sid, btn);
    } else if (what === 'work-markup') {
      return _graderOpenMarkUp(cid, a, sid);
    } else return;
    render();
    var to = again && pageState._grader && pageState._grader.overlay.querySelector(again);
    if (to && !to.disabled) to.focus({ preventScroll: true });
  }

  /* A page clicked in Side by Side: every page full width, this one at the
     top of the column. Not kept as the teacher's choice. */
  function _graderWorkEnlarge(tile) {
    var surface = tile.querySelector('.grader-work-surface');
    var at = surface ? parseInt(surface.dataset.page, 10) - 1 : 0;
    pageState._grader.work.fit = 'width';
    pageState._grader.work.page = Math.max(0, at);
    render();
    var pages = pageState._grader && pageState._grader.overlay.querySelector('.grader-work-pages');
    var sheet = pages && pages.querySelectorAll('.grader-work-sheet')[pageState._grader.work.page];
    if (sheet) pages.scrollTop = sheet.offsetTop - pages.offsetTop;
  }

  /* Mark Up (S9-F1), on the page the pane shows. Done comes back here with
     the marks drawn over the page and the Return row up to date. */
  function _graderOpenMarkUp(cid, a, sid) {
    var g = pageState._grader;
    var w = g.work;
    MarkUp.open({
      cid: cid,
      aid: a.id,
      sid: sid,
      page: w.page,
      turn: Object.assign({}, w.turns),
      onClose: function () {
        if (
          pageState._grader !== g ||
          pageState.activeCourse !== cid ||
          g.aid !== a.id ||
          pageState.focusStudentId !== sid
        )
          return;
        render();
        var b = g.overlay.querySelector('[data-grader="work-markup"][data-at="' + w.page + '"]');
        if (b) b.focus({ preventScroll: true });
      },
    });
  }

  /* A new student opens on their first page. */
  function _graderWorkStudentChanged() {
    var w = pageState._grader && pageState._grader.work;
    if (!w || w.sid === pageState.focusStudentId) return;
    w.sid = pageState.focusStudentId;
    w.page = 0;
    w.msg = '';
    w.setTo = null;
    w.version = null;
    pageState._grader.revisionMsg = null;
  }

  /* Grade From Paper: Set Logan To (GraderWork.setToFromPaper, which the
     phone's not-in card can call too). Undo puts the levels back. */
  function _graderSetTo(cid, a, sid, level, label) {
    var before = structuredClone(getScores(cid));
    var done = GraderWork.setToFromPaper(cid, a.id, sid, level);
    refreshSidebarGrades(sid);
    var after = structuredClone(getScores(cid));
    var st = _workStudent(cid, sid);
    var g = pageState._grader;
    done.paper.then(function () {
      if (pageState._grader === g && pageState.activeCourse === cid && g.aid === a.id) render();
    });
    if (!done.set) return;
    _showFillUndo((st ? displayNameFirst(st) : 'Student') + ' set to ' + label, function () {
      Grader.undo(cid, before, after);
      render();
      refreshSidebarGrades();
    });
  }

  /* Add Work's Choose Files: the files are shrunk and their pages kept in
     order by AddWorkFiles (shared/add-work-files.js), then recorded as the
     teacher's work (addStudentWorkPages). */
  function _graderAddWorkFiles(input) {
    if (!pageState._grader || pageState._grader.work.busy) return;
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!files.length || !window.PhotoShrink) return;
    var cid = pageState.activeCourse;
    var aid = pageState._grader.aid;
    var sid = pageState.focusStudentId;
    var g = pageState._grader;
    var same = function () {
      return (
        pageState._grader === g && pageState.activeCourse === cid && g.aid === aid && pageState.focusStudentId === sid
      );
    };
    g.work.busy = true;
    g.work.msg = '';
    render();
    var said = '';
    AddWorkFiles.prepare(files)
      .then(function (got) {
        said = got.said;
        if (said || !got.pages.length) return { result: 'refused' };
        return addStudentWorkPages(cid, sid, aid, got.pages, { mode: 'new' });
      })
      .then(null, function () {
        return { result: 'store_failed' };
      })
      .then(function (res) {
        g.work.busy = false;
        if (pageState._grader !== g) return;
        // A line about this student's files is said only on their screen.
        if (same()) {
          g.work.msg = res.result === 'sent' ? '' : said || AddWorkFiles.answer(res);
          g.work.page = 0;
        }
        render();
      });
  }

  /* Unsubmit (was Delete Work, Colin's ruling 87; Nov 17 2026): the work
     goes, the piece is back to not handed in, the grade and comments stay.
     The words are GraderWork.unsubmitAsk's, the phone's too. */
  function _graderAskUnsubmit(cid, a, sid, button) {
    var st = _workStudent(cid, sid);
    var sub = getStudentSubmission(cid, sid, a.id);
    if (!st || !sub) return;
    var g = pageState._grader;
    var ask = GraderWork.unsubmitAsk(a, st, sub);
    if (button && button.focus) button.focus({ preventScroll: true });
    showConfirm(
      ask.title,
      ask.message,
      'Unsubmit',
      ask.danger ? 'danger' : 'primary',
      function () {
        if (pageState._grader !== g || pageState.activeCourse !== cid || pageState.focusStudentId !== sid) return;
        GraderWork.deleteWork(cid, sid, a.id).then(function () {
          if (pageState._grader !== g || pageState.activeCourse !== cid) return;
          if (pageState.focusStudentId === sid) g.work.page = 0;
          render();
        });
      },
      'Keep It',
    );
  }

  return {
    configure: configure,
    _drawGraderWork: _drawGraderWork,
    _graderAddWorkFiles: _graderAddWorkFiles,
    _graderForgetDrawn: _graderForgetDrawn,
    _graderReleasePage: _graderReleasePage,
    _graderShortLevels: _graderShortLevels,
    _graderWorkAction: _graderWorkAction,
    _graderWorkEnlarge: _graderWorkEnlarge,
    _graderWorkShellHtml: _graderWorkShellHtml,
    _graderWorkStudentChanged: _graderWorkStudentChanged,
    _refreshGraderWorkLine: _refreshGraderWorkLine,
    _workFitSaved: _workFitSaved,
    _workLineText: _workLineText,
    _workShortName: _workShortName,
    _workStudent: _workStudent,
    _workSubOf: _workSubOf,
    workSurface: workSurface,
  };
})();
