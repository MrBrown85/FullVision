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

   Words used here:
   - to grade: a student sent work (or handed it in on paper) and grading
     has not started (studentWorkGradingStarted: a draft or returned grade or
     an Overall Comment for that student);
   - not in: nothing sent, and not Excused. */

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
    if (!cid || typeof getReturnSettings !== 'function' || typeof getCourseSendWork !== 'function') return false;
    return !!getReturnSettings(cid).student_page && !!getCourseSendWork(cid).send_work;
  }

  // The piece takes work: Students Send is Photos, or Photos and Files.
  function takes(cid, a) {
    if (!on(cid) || !a || typeof getAssessmentStudentWork !== 'function') return false;
    return getAssessmentStudentWork(cid, a.id).students_send !== 'nothing';
  }

  function submission(cid, sid, aid) {
    return typeof getStudentSubmission === 'function' ? getStudentSubmission(cid, sid, aid) : null;
  }

  function isToGrade(cid, a, sid) {
    if (!takes(cid, a)) return false;
    return !!submission(cid, sid, a.id) && !studentWorkGradingStarted(cid, sid, a.id);
  }

  function _roster(cid) {
    return sortStudents(getStudents(cid).slice(), 'alpha');
  }

  // The students whose work waits to be graded, in the grader's order.
  function toGrade(cid, a) {
    if (!takes(cid, a)) return [];
    return _roster(cid)
      .map(function (st) {
        return st.id;
      })
      .filter(function (sid) {
        return isToGrade(cid, a, sid);
      });
  }

  // The students with nothing in, in the grader's order. An Excused piece is not owed.
  function notIn(cid, a) {
    if (!takes(cid, a)) return [];
    return _roster(cid)
      .map(function (st) {
        return st.id;
      })
      .filter(function (sid) {
        return !submission(cid, sid, a.id) && getAssignmentStatus(cid, sid, a.id) !== 'EXC';
      });
  }

  // Every student's to-grade count across the class: the Grade tab's badge.
  function classToGrade(cid) {
    if (!on(cid)) return 0;
    return (getAssessments(cid) || []).reduce(function (n, a) {
      return n + toGrade(cid, a).length;
    }, 0);
  }

  // The pieces `sid` has to grade, then the ones not in, newest first.
  function studentList(cid, sid) {
    if (!on(cid)) return [];
    var rows = [];
    (getAssessments(cid) || []).forEach(function (a) {
      if (!takes(cid, a)) return;
      if (isToGrade(cid, a, sid)) rows.push({ a: a, kind: 'grade', sub: submission(cid, sid, a.id) });
      else if (!submission(cid, sid, a.id) && getAssignmentStatus(cid, sid, a.id) !== 'EXC')
        rows.push({ a: a, kind: 'notin' });
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
  function sentLine(sub, verb) {
    if (!sub) return '';
    if (sub.on_paper) return 'Handed in on paper';
    var day = _day(sub.sent_at || sub.created_at);
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
    if (!st || (unit && unit.view) || !takes(cid, a)) return '';
    var sub = submission(cid, st.id, a.id);
    if (!sub) return '';
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
      MC.esc(sentLine(sub, 'Submitted')) +
      '</span></div>';
    if (files.length) {
      html +=
        '<div class="m-work-pin" aria-hidden="true">' +
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
        MC.esc(displayName(st)) +
        '</span>' +
        UP_SVG +
        '</button></div>' +
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

  /* The pages' pictures, once their addresses are known. Each answer is
     drawn only if the same student's work for the same piece is still the
     one on that element (the screen may have changed meanwhile). */
  function hydrate(root, cid) {
    if (!root || !on(cid) || typeof studentWorkPageUrl !== 'function') return;
    root.querySelectorAll('.m-work').forEach(function (box) {
      var sid = box.getAttribute('data-sid');
      var aid = box.getAttribute('data-aid');
      var sub = submission(cid, sid, aid);
      if (!sub) return;
      box.querySelectorAll('img[data-fv-page]').forEach(function (img) {
        if (img.getAttribute('src')) return;
        var file = (sub.files || [])[Number(img.getAttribute('data-fv-page'))];
        var which = img.getAttribute('data-fv-which');
        var asked = sub.id;
        studentWorkPageUrl(cid, file, which).then(function (url) {
          if (!url || !img.isConnected) return;
          var now = submission(cid, sid, aid);
          if (!now || now.id !== asked || box.getAttribute('data-sid') !== sid) return;
          img.setAttribute('src', url);
        });
      });
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
        var past = t.scrollTop > pages.offsetTop + pages.offsetHeight - 8;
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
    var sub = submission(cid, sid, aid);
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
            return (
              '<img class="m-work-sheet-page" alt="' +
              MC.esc('Page ' + (i + 1) + ' of ' + first + '’s work') +
              '" data-fv-page="' +
              i +
              '" data-fv-which="page">'
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
    isToGrade: isToGrade,
    toGrade: toGrade,
    notIn: notIn,
    classToGrade: classToGrade,
    studentList: studentList,
    photosText: photosText,
    sentLine: sentLine,
    notInLine: notInLine,
    cardHtml: cardHtml,
    hydrate: hydrate,
    wire: wire,
    toTop: toTop,
    openFull: openFull,
  };
})();
