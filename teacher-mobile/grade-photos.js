/* grade-photos.js — the student's work on the phone's grading card.

   The speed grader (teacher-mobile/tab-grade.js) asks this file what to draw
   between a card's name and its levels: the photos of the work a student
   sent for that piece. It is the one place the phone reads student work,
   so the counts on the Grade tab (To Grade, not in), the card's photos, the
   strip pinned at the top while a card scrolls and the full-screen view all
   come from here.

   Student work shows only in a class whose student page is on (the build
   switch) and whose Send Work is on, and only on a piece whose Students
   Send is not Nothing (shared/data.js, "Student work: the client's read
   side"). Anywhere else on() is false, every count is empty, cardHtml is ''
   and the phone is exactly what it was. Nothing here writes or sends.

   Every count and list of sent work here is GraderWork's (shared/grader.js:
   workOn, workStateOf, workCounts, classWorkCounts), the one count the
   dashboard, the gradebook, the Assignments page, the desktop grader and
   the Work Wall use, so the phone gives the same numbers (S6/S7). Its
   words: a student is in exactly one state on a piece:
   - to grade: work is in (their own, or on a One per Group piece a
     group-mate's) and grading has not started;
   - to return: a draft grade; returned: a returned grade, so a student
     graded from paper with nothing sent is neither to grade nor not in;
   - not in: nothing in, no grade, and not Excused (Missing counts).
   A pair or group still graded together is one piece to grade. */

window.MGradePhotos = (function () {
  'use strict';

  var MC = window.MComponents;
  var CAMERA_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  var FULL_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  var NOTE_SVG =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
  var UP_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';

  /* ── What is in ─────────────────────────────────────────────── */

  // The build switch and Send Work, both on for the class.
  function on(cid) {
    return !!window.GraderWork && GraderWork.workOnInClass(cid);
  }

  // The piece takes work: Students Send is Photos, or Photos and Files.
  function takes(cid, a) {
    return !!a && !!window.GraderWork && GraderWork.workOn(cid, a);
  }

  function submission(cid, sid, aid) {
    return typeof getStudentSubmission === 'function' ? getStudentSubmission(cid, sid, aid) : null;
  }

  /* The work shown for `sid` on `aid`, as the desktop grader shows it
     (S12-F2): on a One per Group piece the group's, whoever sent it, as one
     submission-like answer { group: true, id, sender, sent_by, sent_at,
     created_at, on_paper, note, files } with every page of the group's work
     (getGroupWorkFiles); otherwise the student's own submission, or null. */
  function work(cid, sid, aid) {
    var own = submission(cid, sid, aid);
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
      // Changes whenever a member's work does, so a picture asked for
      // before the change is let go (hydrate).
      id: subs
        .map(function (x) {
          return x.id;
        })
        .join('|'),
      sender: first.enrollment_id,
      sent_by: first.sent_by,
      sent_at: first.sent_at,
      created_at: first.created_at,
      on_paper: subs.every(function (x) {
        return x.on_paper;
      }),
      note: noted ? noted.note : null,
      files: getGroupWorkFiles(cid, sid, aid),
    };
  }

  // The card a group is graded on together shows the group's work, on a
  // One per Group piece only; anywhere else a group card shows none, as before.
  function _cardWork(cid, a, st, unit) {
    if (!st || !takes(cid, a)) return { skip: true };
    var sub = work(cid, st.id, a.id);
    if (unit && unit.view && !(sub && sub.group)) return { skip: true };
    return { sub: sub };
  }

  // The card shows work: the camera on its circle in the strip.
  function hasWork(cid, a, st, unit) {
    var w = _cardWork(cid, a, st, unit);
    return !w.skip && !!w.sub;
  }

  function isToGrade(cid, a, sid) {
    return takes(cid, a) && GraderWork.workStateOf(cid, a.id, sid) === 'tograde';
  }

  // The class in the grader's order.
  function _roster(cid) {
    return sortStudents(getStudents(cid).slice(), 'alpha').map(function (st) {
      return st.id;
    });
  }

  // GraderWork's counts for the piece, its lists in the grader's order; null when it takes no work.
  function counts(cid, a) {
    if (!takes(cid, a)) return null;
    return GraderWork.workCounts(cid, a.id, _roster(cid));
  }

  // The students whose work waits to be graded, in the grader's order (a group's members each).
  function toGrade(cid, a) {
    var c = counts(cid, a);
    return c ? c.ids.tograde : [];
  }

  // How many pieces of work wait: a pair or group graded together counts once.
  function toGradeCount(cid, a) {
    var c = counts(cid, a);
    return c ? c.tograde : 0;
  }

  // The students with nothing in, in the grader's order.
  function notIn(cid, a) {
    var c = counts(cid, a);
    return c ? c.ids.notin : [];
  }

  // The work waiting across the class: the Grade tab's badge and its To Grade count.
  function classToGrade(cid) {
    if (!on(cid)) return 0;
    return GraderWork.classWorkCounts(cid, _roster(cid)).tograde;
  }

  // The pieces `sid` has to grade, then the ones not in, newest first.
  function studentList(cid, sid) {
    if (!on(cid)) return [];
    var rows = [];
    (getAssessments(cid) || []).forEach(function (a) {
      if (!takes(cid, a)) return;
      var state = GraderWork.workStateOf(cid, a.id, sid);
      if (state === 'tograde') rows.push({ a: a, kind: 'grade', sub: work(cid, sid, a.id) });
      else if (state === 'notin') rows.push({ a: a, kind: 'notin' });
    });
    return rows.sort(function (x, y) {
      if (x.kind !== y.kind) return x.kind === 'grade' ? -1 : 1;
      return String(y.a.date || '').localeCompare(String(x.a.date || ''));
    });
  }

  /* ── Words ──────────────────────────────────────────────────── */

  function _day(ts) {
    return ts ? formatShortDate(String(ts).slice(0, 10)) : '';
  }

  // "2 photos", "1 photo"
  function photosText(n) {
    return n + (n === 1 ? ' photo' : ' photos');
  }

  // "Sent Oct 30 · 2 photos" (or Submitted, on the grading card); on paper, "Handed in on paper".
  // A group's work: the desktop grader's line, "Sent by Priya S. for the group, Nov 3 · 4 photos".
  function sentLine(sub, verb, cid) {
    if (!sub) return '';
    if (sub.on_paper) return 'Handed in on paper';
    var day = _day(sub.sent_at || sub.created_at);
    if (sub.group) {
      var by =
        sub.sent_by === 'teacher' || !cid
          ? null
          : (getStudents(cid) || []).find(function (s) {
              return s.id === sub.sender;
            });
      var last = by ? String(by.lastName || '').trim() : '';
      return (
        (by ? 'Sent by ' + displayNameFirst(by) + (last ? ' ' + last.charAt(0) + '.' : '') : 'Added by you') +
        ' for the group' +
        (day ? ', ' + day : '') +
        ' · ' +
        photosText((sub.files || []).length)
      );
    }
    return (verb || 'Sent') + (day ? ' ' + day : '') + ' · ' + photosText((sub.files || []).length);
  }

  // "Missing · Due Oct 26", or "Not In · Due Oct 26".
  function notInLine(cid, a, sid) {
    var due = a.dueDate || a.due_date || a.date;
    var head = getAssignmentStatus(cid, sid, a.id) === 'NS' ? 'Missing' : 'Not In';
    return head + (due ? ' · Due ' + _day(due) : '');
  }

  /* ── The card ───────────────────────────────────────────────── */

  // html-safe: the note, names and dates go through MC.esc; ids and counts are ours or numbers
  function cardHtml(cid, a, st, unit) {
    var w = _cardWork(cid, a, st, unit);
    if (w.skip) return '';
    var sub = w.sub;
    if (!sub) return notInHtml(cid, a, st);
    var files = sub.files || [];
    var first = displayNameFirst(st) || displayName(st);
    var html =
      '<div class="m-work" data-sid="' +
      st.id +
      '" data-aid="' +
      a.id +
      '">' +
      '<div class="m-work-sent">' +
      CAMERA_SVG +
      '<span>' +
      MC.esc(sentLine(sub, 'Submitted', cid)) +
      '</span></div>';
    if (files.length) {
      html +=
        '<div class="m-work-pages" data-action="m-work-full">' +
        '<div class="m-work-scroller">' +
        files
          .map(function (f, i) {
            return (
              '<div class="m-work-page"><img alt="' +
              MC.esc('Page ' + (i + 1) + ' of ' + first + '’s work') +
              '" data-fv-page="' +
              i +
              '" data-fv-which="page"></div>'
            );
          })
          .join('') +
        '</div>' +
        '<button type="button" class="m-work-full" data-action="m-work-full" aria-label="Open the photos full screen">' +
        FULL_SVG +
        '</button></div>' +
        (files.length > 1
          ? '<div class="m-work-dots" aria-label="' +
            MC.esc('Page 1 of ' + files.length) +
            '">' +
            files
              .map(function (f, i) {
                return '<span class="m-work-dot' + (i === 0 ? ' is-on' : '') + '"></span>';
              })
              .join('') +
            '</div>'
          : '');
    }
    if (sub.note) html += '<div class="m-work-note">' + NOTE_SVG + '<span>' + MC.esc(sub.note) + '</span></div>';
    return html + '</div>';
  }

  // Days past the due date, by the class's own day; 0 when not late.
  function daysLate(cid, a) {
    var due = a && (a.dueDate || a.due_date);
    if (!due || typeof courseToday !== 'function') return 0;
    var d0 = Date.parse(String(due).slice(0, 10) + 'T00:00:00Z');
    var d1 = Date.parse(String(courseToday(cid)).slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(d0) || !isFinite(d1) || d1 <= d0) return 0;
    return Math.round((d1 - d0) / 86400000);
  }

  // "Not In · 7 days late", "Not In · 1 day late", or "Not In".
  function notInState(cid, a) {
    var n = daysLate(cid, a);
    return 'Not In' + (n ? ' · ' + n + (n === 1 ? ' day late' : ' days late') : '');
  }

  /* A card with nothing in: where it stands, and Add Work for the student
     (S7-F3). Not on an Excused piece, which is not owed. */
  // html-safe: the name goes through MC.esc; ids are ours
  function notInHtml(cid, a, st) {
    if (getAssignmentStatus(cid, st.id, a.id) === 'EXC') return '';
    var first = displayNameFirst(st) || displayName(st);
    return (
      '<div class="m-work m-work-notin" data-sid="' +
      st.id +
      '" data-aid="' +
      a.id +
      '">' +
      '<div class="m-work-sent">' +
      CAMERA_SVG +
      '<span>' +
      MC.esc(notInState(cid, a)) +
      '</span></div>' +
      '<button type="button" class="m-work-add" data-action="m-add-work" data-sid="' +
      st.id +
      '" data-aid="' +
      a.id +
      '">' +
      MC.esc('Add Work for ' + first) +
      '</button>' +
      '<div class="m-work-add-hint">Photos or PDFs. Photos are made smaller before they upload.</div>' +
      paperHtml(cid, a, st) +
      '</div>'
    );
  }

  /* Grade From Paper (S7-F3 follow-up): Set Logan To, on a piece scored by
     level. The rule is the desktop's, GraderWork.setToFromPaper in
     shared/grader.js; this only says whether there is anything it could set
     (a criterion or competency on the piece). Off under Missing, as the
     levels are. */
  function paperLevels(cid, a) {
    if (!a || isPointsScored(a) || isCompletionScored(a) || isDibelsScored(a)) return 0;
    if (a.rubricId) {
      var rubric = getRubricById(cid, a.rubricId);
      return rubric ? (rubric.criteria || []).length : 0;
    }
    return scoreTagIds(a, cid).length;
  }

  // html-safe: the name goes through MC.esc; ids are ours
  function paperHtml(cid, a, st) {
    if (!paperLevels(cid, a)) return '';
    var first = displayNameFirst(st) || displayName(st);
    return (
      '<div class="m-work-paper"><div class="m-work-paper-head">Grade From Paper</div>' +
      '<button type="button" class="m-work-setto" data-action="m-work-setto-menu" aria-haspopup="dialog" data-sid="' +
      st.id +
      '" data-aid="' +
      a.id +
      '"' +
      (isScoreLocked(cid, st.id, a.id) ? ' disabled' : '') +
      '>' +
      MC.esc('Set ' + first + ' To') +
      '</button></div>'
    );
  }

  /* One student's To Grade list (S7-F4): the work waiting, with Grade, then
     the pieces not in, with Add Work. On the student card and View Profile.
     '' when there is nothing, or the class takes no work. */
  // html-safe: titles and lines go through MC.esc; ids are ours
  function studentListHtml(cid, st) {
    if (!st) return '';
    // Empty unless the class takes work (studentList asks on()).
    var rows = studentList(cid, st.id);
    if (!rows.length) return '';
    return (
      '<div class="m-scard-tograde"><div class="m-scard-return-head">To Grade</div>' +
      rows
        .map(function (r) {
          var grade = r.kind === 'grade';
          return (
            '<button type="button" class="m-scard-tograde-row" data-action="' +
            (grade ? 'm-assess-grade' : 'm-add-work') +
            '" data-sid="' +
            st.id +
            '" data-aid="' +
            r.a.id +
            '"' +
            (grade ? ' data-only="student"' : ' data-then="grade"') +
            '><span class="m-scard-return-body"><span class="m-scard-return-title">' +
            MC.esc(r.a.title) +
            '</span><span class="m-scard-return-sub">' +
            MC.esc(grade ? sentLine(r.sub, null, cid) : notInLine(cid, r.a, st.id)) +
            '</span></span><span class="m-scard-tograde-act">' +
            (grade ? 'Grade' : 'Add Work') +
            '</span></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* The red count on the Grade tab's button: every piece of work waiting in
     the class. Hidden at 0, and in a class that takes no work. */
  function syncTabBadge(cid) {
    var tab = document.querySelector('.m-tab-item[data-tab="grade"]');
    if (!tab) return;
    var n = on(cid) ? classToGrade(cid) : 0;
    var badge = tab.querySelector('.m-tab-badge');
    if (!n) {
      if (badge) badge.remove();
      tab.removeAttribute('aria-description');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'm-tab-badge';
      badge.setAttribute('aria-hidden', 'true');
      tab.appendChild(badge);
    }
    badge.textContent = n > 99 ? '99+' : String(n);
    tab.setAttribute('aria-description', n + ' to grade');
  }

  /* The strip pinned at the top of a card once its pages have scrolled
     past: drawn first in the card, so it can stick to the card's top. */
  // html-safe: the name goes through MC.esc; ids are ours
  function pinHtml(cid, a, st, unit) {
    var w = _cardWork(cid, a, st, unit);
    if (w.skip) return '';
    var sub = w.sub;
    var files = (sub && sub.files) || [];
    if (!files.length) return '';
    var first = displayNameFirst(st) || displayName(st);
    return (
      '<div class="m-work-pin" aria-hidden="true" data-sid="' +
      st.id +
      '" data-aid="' +
      a.id +
      '">' +
      '<button type="button" class="m-work-pin-btn" data-action="m-work-top" tabindex="-1" aria-label="' +
      MC.esc('Show ' + first + '’s photos') +
      '">' +
      files
        .slice(0, 3)
        .map(function (f, i) {
          return '<span class="m-work-pin-thumb"><img alt="" data-fv-page="' + i + '" data-fv-which="thumb"></span>';
        })
        .join('') +
      '<span class="m-work-pin-name">' +
      MC.esc(unit && unit.view && unit.label ? unit.label : displayName(st)) +
      '</span>' +
      UP_SVG +
      '</button></div>'
    );
  }

  /* The pages' pictures, once their addresses are known. Each answer is
     drawn only if the same student's work for the same piece is still the
     one on that element (the screen may have changed meanwhile). */
  function hydrate(root, cid) {
    if (!root || !on(cid) || typeof openStudentWorkPage !== 'function') return;
    root.querySelectorAll('.m-work, .m-work-pin').forEach(function (box) {
      var sid = box.getAttribute('data-sid');
      var aid = box.getAttribute('data-aid');
      var sub = work(cid, sid, aid);
      if (!sub) return;
      box.querySelectorAll('img[data-fv-page]').forEach(function (img) {
        if (img.getAttribute('src')) return;
        var file = (sub.files || [])[Number(img.getAttribute('data-fv-page'))];
        var which = img.getAttribute('data-fv-which');
        var asked = sub.id;
        var askedFile = file && file.id;
        openStudentWorkPage(cid, file, which).then(function (page) {
          if (!page) return;
          var now = work(cid, sid, aid);
          var nowFile = now && (now.files || [])[Number(img.getAttribute('data-fv-page'))];
          if (
            !img.isConnected ||
            !now ||
            now.id !== asked ||
            !nowFile ||
            nowFile.id !== askedFile ||
            box.getAttribute('data-sid') !== sid
          ) {
            page.release();
            return;
          }
          img.setAttribute('src', page.url);
          _held.push({ img: img, page: page });
        });
      });
    });
    _letGo();
  }

  /* A photo still on the device is shown from an address that holds its
     bytes: let it go once its picture has left the page. */
  var _held = [];
  function _letGo() {
    _held = _held.filter(function (h) {
      if (h.img.isConnected) return true;
      h.page.release();
      return false;
    });
  }

  /* While a card scrolls, the work's strip stays pinned at its top once the
     pages have gone past, and the page dots follow the pages. */
  function wire(swiper, cid) {
    if (!swiper || !on(cid)) return;
    hydrate(swiper, cid);
    swiper.addEventListener(
      'scroll',
      function (e) {
        var t = e.target;
        if (t && t.classList && t.classList.contains('m-work-scroller')) return _syncDots(t);
        if (!t || !t.classList || !t.classList.contains('m-swiper-card')) return;
        var pages = t.querySelector('.m-work-pages');
        var pin = t.querySelector('.m-work-pin');
        if (!pages || !pin) return;
        var past = pages.getBoundingClientRect().bottom < t.getBoundingClientRect().top + 8;
        if (pin.classList.contains('is-on') === past) return;
        pin.classList.toggle('is-on', past);
        pin.setAttribute('aria-hidden', past ? 'false' : 'true');
        var btn = pin.querySelector('button');
        if (btn) btn.tabIndex = past ? 0 : -1;
      },
      { capture: true, passive: true },
    );
  }

  function _syncDots(scroller) {
    var box = scroller.closest('.m-work');
    var dots = box && box.querySelectorAll('.m-work-dot');
    if (!dots || !dots.length || !scroller.clientWidth) return;
    var i = Math.round(scroller.scrollLeft / scroller.clientWidth);
    dots.forEach(function (d, k) {
      d.classList.toggle('is-on', k === i);
    });
    var wrap = box.querySelector('.m-work-dots');
    if (wrap) wrap.setAttribute('aria-label', 'Page ' + (i + 1) + ' of ' + dots.length);
  }

  // The pinned strip's tap: back to the top of the card, to the pages.
  function toTop(btn) {
    var card = btn && btn.closest('.m-swiper-card');
    if (card) card.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Every page, large, in a sheet that scrolls.
  function openFull(cid, el) {
    var box = el && el.closest('.m-work');
    if (!box) return;
    var sid = box.getAttribute('data-sid');
    var aid = box.getAttribute('data-aid');
    var sub = work(cid, sid, aid);
    var st = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!sub || !st) return;
    var first = displayNameFirst(st) || displayName(st);
    MC.presentSheet(
      '<div class="m-work m-work-sheet" data-sid="' +
        sid +
        '" data-aid="' +
        aid +
        '"><div class="m-work-sheet-title">' +
        MC.esc(displayName(st)) +
        '</div>' +
        (sub.files || [])
          .map(function (f, i) {
            // Mark Up on each page (S9-F2), where the page can keep marks.
            var mark =
              window.MMarkUp && MMarkUp.can(cid, aid, sid, i)
                ? '<button type="button" class="m-work-markup" data-action="m-markup-open" data-sid="' +
                  sid +
                  '" data-aid="' +
                  aid +
                  '" data-page="' +
                  i +
                  '"' +
                  ((sub.files || []).length > 1 ? ' aria-label="' + MC.esc('Mark Up page ' + (i + 1)) + '"' : '') +
                  '>Mark Up</button>'
                : '';
            return (
              '<img class="m-work-sheet-page" alt="' +
              MC.esc('Page ' + (i + 1) + ' of ' + first + '’s work') +
              '" data-fv-page="' +
              i +
              '" data-fv-which="page">' +
              mark
            );
          })
          .join('') +
        '</div>',
    );
    hydrate(document.getElementById('m-sheet-container'), cid);
  }

  return {
    on: on,
    takes: takes,
    submission: submission,
    work: work,
    hasWork: hasWork,
    isToGrade: isToGrade,
    toGrade: toGrade,
    toGradeCount: toGradeCount,
    notIn: notIn,
    classToGrade: classToGrade,
    studentList: studentList,
    photosText: photosText,
    sentLine: sentLine,
    notInLine: notInLine,
    notInState: notInState,
    daysLate: daysLate,
    paperLevels: paperLevels,
    studentListHtml: studentListHtml,
    syncTabBadge: syncTabBadge,
    releaseUnused: _letGo,
    cardHtml: cardHtml,
    pinHtml: pinHtml,
    hydrate: hydrate,
    wire: wire,
    toTop: toTop,
    openFull: openFull,
  };
})();
