/* Preview as Student (docs/plans/student-page-build-plan.md S4-F6; board
   "Teacher: Preview as Student").

   The teacher sees one student's page as that student sees it, on a Phone
   or a Chromebook, in a dialog over the page.
   Opened from Class Settings › Student Page (teacher/cm-student-page.js),
   which has the tab only for a class whose student page is on (the build
   switch).

   What the student sees comes from shared/student-view.js alone
   (StudentView.fromCache): returned grades only, every result worked out by
   calc.js in the class's grading style. Nothing is sent and nothing is
   saved: the preview reads the cache and writes nothing, in Demo Mode or
   signed in.

   The device draws the student page itself: s/page-view.js
   (StudentPageView), the same code the student's phone runs, handed the
   same kind of view. Its three tabs, Outstanding and Upcoming, My
   Learning's list and each piece's card answer presses here as they do on
   the phone (StudentPageView.press); what the student chose to look at is
   kept while the preview is open. Settings (the gear) opens as it does
   on the phone, and its Text Size draws the page bigger here too; nothing
   that would reach the network (Log Out, Add Another Card) does anything
   here, and Switch Class is not listed (a preview is one class).

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

  // What a student reads when their card does not open their page (s/student.js, card_closed).
  var CLOSED_LINE = 'The student page is turned off for this class. Ask your teacher.';

  /* The view the device draws. Opened by See What They'd See (S13-F1),
     My Learning is worked out as if the class showed it, for this preview
     only: nothing is saved, and every other screen reads the class as it is. */
  function _fromCache(cid, sid) {
    var built = StudentView.fromCache(cid, sid, { learning: !!(_open && _open.learning) });
    var bulletins = built && built.ready && built.view ? _bulletinsOf(cid) : null;
    if (bulletins) built.view.bulletins = bulletins;
    if (built && built.ready) _markQuizzes(cid, built.view, sid);
    return built;
  }

  /* Bulletins (docs/plans/bulletins-plan.md B1d), with the build switch on
     and the class's bulletins read (shared/data-bulletins.js): the ones
     students are sent, oldest first, in the shape s/bulletins-view.js draws,
     with nothing of the class's Seen counts or reactions. The preview sends
     nothing, a Seen mark included, so every bulletin is drawn as seen (no
     New line) and the reactions as nobody's. */
  function _bulletinsOf(cid) {
    if (typeof BuildFlags === 'undefined' || !BuildFlags.on('bulletins')) return null;
    if (typeof StudentBulletinsView === 'undefined' || typeof getBulletins !== 'function') return null;
    if (typeof bulletinsOffered !== 'function' || !bulletinsOffered(cid)) return null;
    var list = (getBulletins(cid) || [])
      .filter(function (b) {
        return b && b.visible && b.posted_at && !isNaN(Date.parse(b.posted_at));
      })
      .sort(function (a, b) {
        return Date.parse(a.posted_at) - Date.parse(b.posted_at) || (a.id < b.id ? -1 : 1);
      })
      .map(function (b) {
        return {
          id: b.id,
          kind: b.kind,
          body: b.body,
          link_url: b.link_url,
          link_title: b.link_title,
          pinned: b.pinned,
          pinned_until: b.pinned_until,
          assessment_id: b.assessment_id,
          reactions_on: b.reactions_on,
          posted_at: b.posted_at,
          edited_at: b.edited_at,
          files: (b.files || [])
            .filter(function (f) {
              return f.status === 'ready';
            })
            .map(function (f) {
              return { id: f.id, kind: f.kind, title: f.title, page_count: f.page_count };
            }),
          seen: true,
          fresh: false,
          reaction: null,
        };
      });
    return { list: list, pictures: (_open && _open.bltPictures) || {}, now: Date.now(), preview: true };
  }

  // A bulletin's file as the class's store holds it, for its pictures.
  function _bulletinFile(cid, fid) {
    var out = null;
    (typeof getBulletins === 'function' ? getBulletins(cid) : []).forEach(function (b) {
      (b.files || []).forEach(function (f) {
        if (f.id === fid) out = f;
      });
    });
    return out;
  }

  /* A bulletin file's pages as the student sees them: getBulletinPage, the
     teacher's own reader (Demo Mode's pictures, or a signed link). Kept
     while the preview is open, let go when it closes. */
  var _bltSource = {
    known: function (fid, i) {
      var p = _open && _open.bltPictures && _open.bltPictures[fid];
      return (p && p[i]) || '';
    },
    load: function (fid, i) {
      var mine = _open;
      var f = mine ? _bulletinFile(mine.cid, fid) : null;
      if (!f || typeof getBulletinPage !== 'function') return Promise.resolve('');
      return Promise.resolve(getBulletinPage(mine.cid, f, Number(i) || 0)).then(
        function (o) {
          if (!o || !o.url || _open !== mine) return '';
          mine.bltPictures = mine.bltPictures || {};
          (mine.bltPictures[fid] = mine.bltPictures[fid] || [])[i] = o.url;
          return o.url;
        },
        function () {
          return '';
        },
      );
    },
  };

  function _student(cid, sid) {
    return (getStudents(cid) || []).find(function (s) {
      return s && s.id === sid;
    });
  }

  /* ── The student's page ────────────────────────────────────── */

  /* The page inside the device: the student page's own drawing
     (s/page-view.js), the same HTML the student's device draws for this
     view and these choices (`ui`: the tab, Outstanding or Upcoming, the
     piece open). */
  function drawPage(view, ui) {
    return StudentPageView.html(view, ui || {});
  }

  /* ── A quiz (docs/plans/quizzes-plan.md Q3b) ───────────────── */

  /* With the quizzes switch on, a piece the class has a quiz for gets Start the Quiz, as it does for the
     student; its questions come from the teacher's own quiz, with no key, in the teacher's order. The
     preview saves and sends nothing: answers are kept here, in the device, until it closes. */
  function _quizzesOn(cid) {
    return (
      typeof BuildFlags !== 'undefined' &&
      BuildFlags.on('quizzes') &&
      typeof getQuiz === 'function' &&
      typeof quizzesOffered === 'function' &&
      quizzesOffered(cid) &&
      typeof StudentQuizView !== 'undefined'
    );
  }

  function _markQuizzes(cid, view, sid) {
    if (!view || !_quizzesOn(cid)) return;
    (view.work || []).forEach(function (p) {
      // A returned quiz: See Your Quiz, as the student has it once `quiz-result` says it is back.
      if (p.kind === 'back') {
        if (_quizResult(cid, sid, p.id, view)) p.quizReturned = true;
        return;
      }
      if (p.kind !== 'due' && p.kind !== 'missing') return;
      var held = getQuiz(cid, p.id);
      if (held && held.quiz && (held.questions || []).length) p.quiz = true;
    });
  }

  // The quiz as the student's route would send it: the questions' prompts and choices, never a key.
  function _quizModel(cid, aid) {
    var held = getQuiz(cid, aid);
    if (!held || !held.quiz) return null;
    var tries = held.quiz.tries === 0 || held.quiz.tries === 2 ? held.quiz.tries : 1;
    return StudentQuizModel.fromReply({
      ok: true,
      quiz: { tries: tries, tries_left: tries ? tries - 1 : null, closed: false, closes_on: null },
      try: { number: 1, sent: false, started_at: null, sent_at: null, reopened: false },
      sent_tries: 0,
      can_answer: true,
      can_try_again: false,
      questions: (held.questions || []).map(function (q, i) {
        return {
          id: q.id,
          number: i + 1,
          kind: q.kind,
          prompt: q.prompt,
          points: q.points,
          multiple: !!q.multiple,
          choices: Array.isArray(q.choices)
            ? q.choices.map(function (c) {
                return { id: c.id, text: c.text };
              })
            : null,
        };
      }),
      answers: {},
    });
  }

  /* What `quiz-result` would answer this student, worked out from the teacher's own quiz, tries and confirmed
     marking (nothing is asked of a server), and read by the student page's own reader. Null while it would answer
     `returned: false`: no confirmed try, a try or tries still open to the student, or the grade not back. The
     piece being a returned grade is the view's own (`back`); the key's answers are read only as `shows` allows. */
  function _quizResult(cid, sid, aid, view) {
    if (typeof getQuiz !== 'function' || typeof getQuizTries !== 'function') return null;
    var held = getQuiz(cid, aid);
    var tries = getQuizTries(cid, aid);
    if (!held || !held.quiz || !tries) return null;
    var mine = (tries.students || []).filter(function (s) {
      return s.enrollment_id === sid;
    })[0];
    if (!mine) return null;
    var counted = (mine.tries || []).filter(function (t) {
      return t.marked;
    })[0];
    if (!counted) return null;
    /* The server's rules (migrations/2026112407_quiz_returned.sql, quiz_result), one for one. */
    var q = held.quiz;
    var piece = ((view && view.work) || []).filter(function (p) {
      return p.id === aid;
    })[0];
    var today = (view && view.today) || '';
    var closes = q.after_due === 'until' ? q.accept_until : q.after_due === 'stop' && piece ? piece.dueDate : null;
    var closed = !!closes && !!today && String(closes) < today;
    // Rule 2: no unsent try the student may still answer (a reopened one, or an ordinary one while the quiz is open),
    // and the quiz closed or no ordinary tries left. Tries are counted as quiz counts them: reopened_at null only.
    var unsentOpen = mine.reopened === true || (mine.in_progress === true && !closed);
    if (unsentOpen) return null;
    var ordinary = (mine.tries || []).filter(function (t) {
      return !t.reopened_at;
    }).length;
    // An unsent ordinary try (started, not reopened) is a try used.
    if (mine.in_progress === true && mine.reopened !== true) ordinary += 1;
    var left = q.tries === 0 ? null : Math.max((q.tries === 2 ? 2 : 1) - ordinary, 0);
    if (!(closed || left === 0)) return null;
    // Rule 1 and 3: returned with a grade shown (the view's own 'back'), and the confirmed try returned since: where
    // saves wait for Return, its marked_at is not after returned_at; else no draft is waiting.
    var row = typeof getGradeReturn === 'function' ? getGradeReturn(cid, sid, aid) : null;
    if (!row || !row.returned_at) return null;
    var holds =
      typeof GradeState !== 'undefined' && typeof getReturnSettings === 'function'
        ? GradeState.holds(getReturnSettings(cid))
        : false;
    if (holds) {
      var markedAt = Date.parse(counted.marked_at || '');
      var returnedAt = Date.parse(row.returned_at);
      if (!isFinite(markedAt) || !isFinite(returnedAt) || markedAt > returnedAt) return null;
    } else if (row.is_draft) {
      return null;
    }
    var order = counted.question_order || {};
    var all = (held.questions || []).slice();
    var rank = (order.questions || []).slice();
    all.sort(function (a, b) {
      var i = rank.indexOf(a.id);
      var j = rank.indexOf(b.id);
      if (i < 0 && j < 0) return (a.position || 0) - (b.position || 0);
      return i < 0 ? 1 : j < 0 ? -1 : i - j;
    });
    var by = {};
    (counted.answers || []).forEach(function (a) {
      by[a.question_id] = a.answer;
    });
    var marked = counted.marked;
    var shows = q.shows;
    var out = { ok: true, returned: true, shows: shows };
    if (q.add_total && marked) out.total = { earned: marked.earned, possible: marked.possible };
    if (shows !== 'grade') {
      out.questions = all.map(function (qu, i) {
        var kept = (order.choices && order.choices[qu.id]) || [];
        var choices = Array.isArray(qu.choices)
          ? qu.choices.slice().sort(function (a, b) {
              var x = kept.indexOf(a.id);
              var y = kept.indexOf(b.id);
              return x < 0 && y < 0 ? 0 : x < 0 ? 1 : y < 0 ? -1 : x - y;
            })
          : null;
        var m = marked && marked.questions ? marked.questions[qu.id] : null;
        var item = {
          id: qu.id,
          number: i + 1,
          kind: qu.kind,
          prompt: qu.prompt,
          points: qu.points,
          multiple: !!qu.multiple,
          choices: choices,
          your_answer: by[qu.id] === undefined ? null : by[qu.id],
          result: m ? m.result : null,
        };
        // A question the marking never saw (added since) was never returned: no answer, no why.
        if (shows === 'answers') {
          item.answer = m && qu.key ? qu.key.answer : null;
          item.why = m && qu.key ? qu.key.why : null;
        }
        return item;
      });
    }
    return StudentQuizModel.resultFrom(out);
  }

  function _quizCtx(view, quiz) {
    var piece = (view.work || []).filter(function (p) {
      return p.id === quiz.aid;
    })[0];
    var course = view.course || {};
    return {
      mode: quiz.mode,
      course: course.name || '',
      title: piece ? piece.title : '',
      due: quiz.back && piece ? StudentPageView.returnedOn(piece) : '',
      back: quiz.back || null,
      top:
        quiz.back && piece && typeof StudentPageView.quizTopHtml === 'function'
          ? StudentPageView.quizTopHtml(piece)
          : '',
      m: quiz.m,
      answers: quiz.answers,
      message: quiz.message,
      status: { kind: 'idle', at: 0 },
      preview: true,
    };
  }

  // The device's screen: the page, the quiz open on it, or Send My Work's own screens (preview-send.js).
  function _screenHtml(built) {
    var quiz = _open.quiz && (_open.quiz.m || _open.quiz.back);
    if (quiz) return StudentQuizView.html(_quizCtx(built.view, _open.quiz));
    if (PreviewSend.showing()) return PreviewSend.screenHtml(built.view);
    return drawPage(built.view, _open.ui) + PreviewSend.dialogHtml(built.view);
  }

  // A press inside an open quiz. Nothing is sent.
  function _pressQuiz(act, el, built) {
    var quiz = _open.quiz;
    var screen = _overlay() && _overlay().querySelector('.ps-screen');
    if (act === 'quiz-back') {
      var aid = quiz.aid;
      _open.quiz = null;
      return _drawScreen('[data-act="quiz-open"][data-piece="' + String(aid).replace(/["\\]/g, '') + '"]');
    }
    if (act === 'quiz-look' && screen) {
      var row = screen.querySelector(
        '.sp-quiz-ra[data-pos="' + (Number(el && el.getAttribute('data-pos')) || 1) + '"]',
      );
      if (row) {
        if (row.scrollIntoView) row.scrollIntoView({ block: 'start' });
        row.focus({ preventScroll: true });
      }
      return;
    }
    if (act === 'quiz-pick' && screen) {
      var hit = StudentQuizView.pressed(quiz.m, quiz.answers, el);
      if (!hit) return;
      if (hit.value == null) delete quiz.answers[hit.q.id];
      else quiz.answers[hit.q.id] = hit.value;
      StudentQuizView.setChoices(screen, hit.q, hit.value);
      return StudentQuizView.refresh(screen, _quizCtx(built.view, quiz));
    }
    if (act === 'quiz-next' && screen) {
      var n = StudentQuizModel.counts(quiz.m, quiz.answers).next;
      var card = screen.querySelector('[data-pos="' + n + '"]');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
      return;
    }
    if (act === 'quiz-send-ask') {
      quiz.message = 'This is a preview. Nothing is sent.';
      return _drawScreen('#sp-quiz-msg');
    }
  }

  function _typedQuiz(el) {
    var quiz = _open && _open.quiz;
    var built = quiz ? _fromCache(_open.cid, _open.sid) : null;
    var screen = _overlay() && _overlay().querySelector('.ps-screen');
    var hit = quiz && built && built.ready && screen ? StudentQuizView.typed(quiz.m, el) : null;
    if (!hit) return;
    if (hit.value == null) delete quiz.answers[hit.q.id];
    else quiz.answers[hit.q.id] = hit.value;
    var note = screen.querySelector('#q-' + String(hit.q.id).replace(/[^A-Za-z0-9-]/g, '') + '-hint');
    if (note) note.textContent = hit.hint;
    StudentQuizView.refresh(screen, _quizCtx(built.view, quiz));
  }

  // True when this student's page is paused (per-student options).
  function _pausedFor(cid, sid) {
    var own = typeof getStudentPageOptions === 'function' ? getStudentPageOptions(cid)[sid] : null;
    return !!(own && own.paused_at);
  }

  /* ── The preview ───────────────────────────────────────────── */

  // html-safe: every name goes through esc() (_item and here); drawPage is s/page-view.js, which escapes every title, date line and result; the device and the rest are fixed markup
  function _previewHtml() {
    var cid = _open.cid;
    var sid = _open.sid;
    var st = _student(cid, sid) || {};
    var first = displayNameFirst(st) || 'The student';
    var full = displayNameWithLast(st) || first;
    var built = _fromCache(cid, sid);
    // A paused student's card opens nothing: the phone shows what the student reads (s/student.js, card_closed).
    var screen = _pausedFor(cid, sid)
      ? '<div class="ps-closed" role="status"><p class="ps-closed-line">' + esc(CLOSED_LINE) + '</p></div>'
      : built.ready
        ? _screenHtml(built)
        : // html-safe: fixed markup
          '<div class="ps-waiting" role="status">Loading this class…</div>';
    var device = _open.device;
    var seg = ['phone', 'chromebook']
      .map(function (d) {
        var on = d === device;
        return (
          '<button type="button" class="seg-btn" role="radio" aria-checked="' +
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
      '<div class="ps-dialog">' +
      '<div class="ps-head">' +
      '<h2 class="ps-title" id="ps-title">' +
      esc('Previewing as ' + full) +
      '</h2>' +
      '<span class="ps-head-space"></span>' +
      '<div class="seg" role="radiogroup" aria-label="Device">' +
      seg +
      '</div>' +
      '<button type="button" class="ps-close" data-ps-close aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ps-body">' +
      '<div class="ps-stage"><div class="ps-device ps-device-' +
      device +
      '"><div class="ps-screen" aria-label="' +
      esc(first + '’s page') +
      '" role="region">' +
      screen +
      '</div></div></div>' +
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
    // A handout file open over the device goes with it: the device is drawn again.
    if (typeof HandoutViewer !== 'undefined') HandoutViewer.close();
    el.innerHTML = _previewHtml();
    _settle(el.querySelector('.ps-screen'));
    if (focusKey) {
      var again = el.querySelector(focusKey);
      if (again) again.focus();
    }
  }

  /* Opens the preview of student `sid` in class `cid`. `trigger` is the
     control that opened it; the focus goes back to `returnFocusId` (or the
     trigger) when it closes. `opts.tab` is the tab it opens on;
     `opts.learning` shows My Learning before the class turns it on (S13-F1); `opts.ui` is the page's whole start
     (as on the phone, it opens on Assignments, Outstanding). */
  function open(cid, sid, trigger, returnFocusId, opts) {
    if (!cid || !sid || !_student(cid, sid)) return false;
    close();
    _open = {
      cid: cid,
      sid: sid,
      device: 'phone',
      trigger: trigger || null,
      returnTo: returnFocusId || null,
      ui: opts && opts.ui ? opts.ui : opts && opts.tab ? { tab: opts.tab } : {},
      learning: !!(opts && opts.learning),
    };
    var el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.className = 'ps-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'ps-title');
    el.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      if (t === el || t.closest('[data-ps-close]')) return close();
      var d = t.closest('[data-ps-device]');
      if (d) return setDevice(d.dataset.psDevice);
      var a = t.closest('.ps-screen [data-act]');
      if (a) _press(a.getAttribute('data-act'), a);
    });
    el.addEventListener('input', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('.ps-screen [data-q]') : null;
      if (t) _typedQuiz(t);
    });
    PreviewSend.listen(el, sid, _drawScreen);
    _onKey = function (e) {
      if (!_open) return;
      if (e.key === 'Escape') {
        // Escape over a handout file closes the file (shared/handout-viewer.js), not the preview.
        if (typeof HandoutViewer !== 'undefined' && HandoutViewer.isOpen()) return;
        // Escape over a bulletin link's question closes the question (shared/website-ask.js).
        if (document.querySelector('.sp-bulletin-ask')) return;
        e.preventDefault();
        e.stopPropagation();
        // Escape over the student page's Settings or Log Out? closes that, as on the student's device.
        var ui = _open.ui || {};
        if (ui.logout || ui.settings) return _press(ui.logout ? 'logout-cancel' : 'settings-close', null);
        // Escape over Save or Print closes the sheet, not the preview.
        if (ui.handoutMenu) return _press('handout-out-close', null);
        close();
      } else if (e.key === 'Tab') {
        var box = _overlay();
        var all = box ? Array.prototype.slice.call(box.querySelectorAll('button, input, textarea')) : [];
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
    // Bulletins, with the build switch on: the class's are read, and the device drawn again when they are.
    if (typeof BuildFlags !== 'undefined' && BuildFlags.on('bulletins') && typeof refreshBulletins === 'function') {
      var opened = _open;
      Promise.resolve(refreshBulletins(cid)).then(function () {
        if (_open === opened) _drawScreen();
      });
    }
    _readQuizzes(cid);
    var start = el.querySelector('[data-ps-close]');
    if (start) start.focus();
    return true;
  }

  /* Signed in, the class's quizzes are read (the teacher's own read) so the pieces that are quizzes
     show Start the Quiz; the device is drawn again when they are. Demo Mode has them on the device already. */
  function _readQuizzes(cid) {
    if (typeof BuildFlags === 'undefined' || !BuildFlags.on('quizzes') || typeof probeQuizzes !== 'function') return;
    var opened = _open;
    Promise.resolve(probeQuizzes(cid))
      .then(function (ok) {
        var built = ok && _open === opened ? _fromCache(cid, opened.sid) : null;
        if (!built || !built.ready) return null;
        var todo = (built.view.work || []).filter(function (p) {
          return (p.kind === 'due' || p.kind === 'missing' || p.kind === 'back') && !getQuiz(cid, p.id);
        });
        return Promise.all(
          todo.map(function (p) {
            return loadQuiz(cid, p.id);
          }),
        )
          .then(function () {
            // A returned piece that is a quiz also needs the tries the teacher confirmed (the
            // teacher's own read): asked only for the quiz pieces.
            var backs = (built.view.work || []).filter(function (p) {
              var held = getQuiz(cid, p.id);
              return (
                p.kind === 'back' &&
                typeof loadQuizTries === 'function' &&
                !!held &&
                !!held.quiz &&
                !getQuizTries(cid, p.id)
              );
            });
            return Promise.all(
              backs.map(function (p) {
                return loadQuizTries(cid, p.id);
              }),
            );
          })
          .then(function () {
            if (_open === opened && !opened.quiz) _drawScreen();
          });
      })
      .then(null, function () {
        /* the pieces stay as they were */
      });
  }

  function close() {
    var el = _overlay();
    var was = _open;
    _open = null;
    PreviewSend.end();
    if (typeof HandoutViewer !== 'undefined') HandoutViewer.close();
    if (typeof WebsiteAsk !== 'undefined') WebsiteAsk.close();
    if (was) {
      _letGo(was);
      (was.carReleases || []).forEach(function (release) {
        try {
          release();
        } catch (e) {
          /* already gone */
        }
      });
    }
    if (_onKey) document.removeEventListener('keydown', _onKey, true);
    if (_onLeave && typeof window.removeEventListener === 'function') window.removeEventListener('popstate', _onLeave);
    _onKey = _onLeave = null;
    if (el) el.remove();
    if (!was) return;
    var back = (was.returnTo && document.getElementById(was.returnTo)) || was.trigger;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  /* A press on the student's page inside the device: what it changes is
     the student page's own answer (StudentPageView.press). Only the page
     inside the device is drawn again. */
  function _press(act, el) {
    if (!_open) return;
    var built = _fromCache(_open.cid, _open.sid);
    if (!built.ready) return;
    if (act === 'work-retry') return _open.ui.work && _loadWork(_open.ui.work);
    if (act === 'handout-retry') return _open.ui.handout && _loadHandout(_open.ui.handout);
    if (act === 'handout-file') return _openFile(el);
    if (act === 'handout-out-open' || act === 'handout-out-close') {
      var opening = act === 'handout-out-open';
      var gotP = _open.ui.handoutPages;
      if (opening && gotP && gotP.out && gotP.out.state === 'failed') {
        _open.ui = Object.assign({}, _open.ui, { handoutPages: Object.assign({}, gotP, { out: null }) });
      }
      _open.ui = Object.assign({}, _open.ui, { handoutMenu: opening });
      _drawScreen(opening ? '#sp-out-title' : '.sp-handout-outbtn');
      if (opening && _overlay()) StudentPageView.slideIn(_overlay());
      return;
    }
    if (act === 'handout-print' || act === 'handout-save') return _handoutOut(act === 'handout-print');
    if (PreviewSend.press(act, el, built.view)) return;
    if (act === 'quiz-open') return _openQuiz(el && el.getAttribute('data-piece'));
    if (_open.quiz && /^quiz-/.test(act)) return _pressQuiz(act, el, built);
    // A bulletin's link asks first, as on the student's phone (shared/website-ask.js); a reaction sends nothing here.
    if (act === 'bulletin-link') return _askLink(built.view, el);
    var out = StudentPageView.press(_open.ui, built.view, act, el);
    if (!out) return;
    _open.ui = out.ui;
    var have = out.ui.workPages;
    if (out.work && !(have && have.id === out.work && have.state === 'ready')) return _loadWork(out.work);
    var got = out.ui.handoutPages;
    if (out.handout && !(got && got.id === out.handout.resource && got.state === 'ready')) {
      return _loadHandout(out.handout.resource);
    }
    _drawScreen(out.focus);
    // Settings slides in on the drawing that opens it, as on the student's device.
    if (out.slide && _overlay()) StudentPageView.slideIn(_overlay());
  }

  function _openQuiz(aid) {
    if (!aid || !_quizzesOn(_open.cid)) return;
    var built = _fromCache(_open.cid, _open.sid);
    var piece =
      built && built.ready
        ? (built.view.work || []).filter(function (p) {
            return p.id === aid;
          })[0]
        : null;
    if (piece && piece.kind === 'back') {
      var result = _quizResult(_open.cid, _open.sid, aid, built.view);
      if (!result) return;
      _open.quiz = { aid: aid, m: null, back: result, answers: {}, mode: 'returned', message: '' };
      return _drawScreen('#sp-quiz-title');
    }
    var m = _quizModel(_open.cid, aid);
    if (!m || !m.questions.length) return;
    _open.quiz = { aid: aid, m: m, answers: {}, mode: 'take', message: '' };
    _drawScreen('#sp-quiz-title');
  }

  function _askLink(view, el) {
    var id = (el && el.getAttribute('data-bulletin')) || '';
    var b = ((view && view.bulletins && view.bulletins.list) || []).filter(function (x) {
      return x.id === id;
    })[0];
    var l = b && typeof StudentBulletinsView !== 'undefined' ? StudentBulletinsView.linkOf(b.link_url) : null;
    if (!l || typeof WebsiteAsk === 'undefined') return;
    var box = WebsiteAsk.open({
      host: document.body,
      url: l.href,
      cls: 'sp-bulletin-ask',
      backdrop: true,
      cancelFirst: true,
      focus: 'no',
      returnTo: el,
    });
    if (box) StudentBulletinsView.placeAsk(box, el);
  }

  /* ── A handout file (a web page, a text file or an EPUB) ───── */

  /* Opened over the device's screen by the viewer the student page uses
     (shared/handout-viewer.js), from the class's store
     (openAssessmentHandoutFile: this device's photo queue in Demo Mode, a
     signed link otherwise). A web page or a book runs sealed, as it does
     for the student. */
  function _openFile(el) {
    var mine = _open;
    if (!mine || typeof HandoutViewer === 'undefined') return;
    var rid = (el && el.getAttribute('data-resource')) || '';
    var piece = (el && el.getAttribute('data-piece')) || '';
    var row = (
      typeof getAssessmentResources === 'function' ? getAssessmentResources(mine.cid, piece, { ready: true }) : []
    ).filter(function (r) {
      return r.id === rid;
    })[0];
    var device = _overlay() && _overlay().querySelector('.ps-device');
    if (!row || !device) return;
    HandoutViewer.open({
      host: device,
      title: row.title,
      kind: row.kind,
      returnTo: el,
      load: function () {
        if (typeof openAssessmentHandoutFile !== 'function') return Promise.resolve(null);
        return Promise.resolve(openAssessmentHandoutFile(mine.cid, rid)).then(function (got) {
          return got && _open === mine ? got.blob : null;
        });
      },
    });
  }

  /* ── A handout (Handouts and Links) ────────────────────────── */

  /* The pages of handout `rid` as the student sees them, in order, from
     the class's store (openAssessmentHandoutPage: this device's photo
     queue in Demo Mode, a signed link otherwise). The answer draws only
     while the preview is still open on this student with the handout open. */
  /* Print or Save to Phone on the open handout (shared/handout-out.js), as on
     the student's phone. The preview holds every page when it shows any. */
  function _handoutOut(print) {
    var mine = _open;
    var got = mine && mine.ui.handoutPages;
    if (!got || got.state !== 'ready' || typeof HandoutOut === 'undefined') return;
    var how = print ? 'print' : 'save';
    var heading = document.getElementById('sp-handout-title');
    var title = heading ? heading.textContent || '' : '';
    var pages = (got.pages || []).filter(function (pg) {
      return pg && pg.url;
    });
    // `menu`: whether the Save or Print sheet is open after this change; `focus`: where the keyboard goes.
    function mark(out, menu, focus) {
      if (_open !== mine || !mine.ui.handoutPages || mine.ui.handoutPages.id !== got.id) return;
      mine.ui = Object.assign({}, mine.ui, {
        handoutMenu: menu,
        handoutPages: Object.assign({}, mine.ui.handoutPages, { out: out }),
      });
      _drawScreen(focus);
    }
    var row = '.sp-handout-sheet [data-act="handout-' + how + '"]';
    if (!pages.length || pages.length < (got.pages || []).length) return mark({ state: 'failed', how: how }, true, row);
    // Every page is here: the sheet closes and the print sheet or share sheet opens.
    mark(null, false, '.sp-handout-outbtn');
    Promise.resolve(print ? HandoutOut.print(pages) : HandoutOut.save(pages, title)).then(null, function () {
      mark({ state: 'failed', how: how }, true, row);
    });
  }

  function _loadHandout(rid) {
    var mine = _open;
    if (!mine) return;
    var cid = mine.cid;
    _letGo(mine);
    mine.ui = Object.assign({}, mine.ui, { handoutPages: { id: rid, state: 'loading', pages: [] } });
    _drawScreen('#sp-handout-title');
    var row = (
      typeof getAssessmentResources === 'function'
        ? getAssessmentResources(cid, mine.ui.handoutPiece, { ready: true })
        : []
    ).filter(function (r) {
      return r.id === rid;
    })[0];
    var count = row ? row.pageCount : 0;
    var opening = [];
    for (var i = 0; i < count; i++) {
      opening.push(
        typeof openAssessmentHandoutPage === 'function'
          ? Promise.resolve(openAssessmentHandoutPage(cid, rid, i)).then(null, function () {
              return null;
            })
          : Promise.resolve(null),
      );
    }
    Promise.all(opening).then(function (opened) {
      var still = _open === mine && mine.ui.handout === rid;
      if (!still) {
        opened.forEach(function (o) {
          if (o && typeof o.release === 'function') o.release();
        });
        return;
      }
      var pages = [];
      mine.releases = [];
      opened.forEach(function (o) {
        if (!o || !o.url) return;
        if (typeof o.release === 'function') mine.releases.push(o.release);
        pages.push({ url: o.url });
      });
      mine.ui = Object.assign({}, mine.ui, {
        handoutPages: { id: rid, state: !pages.length ? 'failed' : 'ready', pages: pages },
      });
      _drawScreen('#sp-handout-title');
    });
  }

  /* ── See Your Work (S9-F3) ─────────────────────────────────── */

  // The pictures this preview holds open (a photo still in the photo queue holds its bytes until let go).
  function _letGo(open) {
    (open.releases || []).forEach(function (release) {
      try {
        release();
      } catch (e) {
        /* already gone */
      }
    });
    open.releases = [];
  }

  /* The pages of piece `aid` as the student sees them: the newest work
     handed in, sent by the student or added by the teacher, in page order
     (on a One per Group piece each member's newest work in turn, as
     group-links gives the student's page), each with the marks the student
     was given on it (getStudentMarkup: the given copy only, none while the
     piece hides its Mark Up or Missing or Excused is on it). The pictures
     come through openStudentWorkPage. The answer draws only while the
     preview is still open on this student with See Your Work on this piece. */
  function _loadWork(aid) {
    var mine = _open;
    if (!mine) return;
    var cid = mine.cid;
    var sid = mine.sid;
    _letGo(mine);
    mine.ui = Object.assign({}, mine.ui, { workPages: { id: aid, state: 'loading', pages: [] } });
    _drawScreen('#sp-work-title');
    var group = typeof getStudentWorkGroup === 'function' ? getStudentWorkGroup(cid, sid, aid) : null;
    var subs =
      group && typeof getGroupSubmissions === 'function'
        ? getGroupSubmissions(cid, sid, aid)
        : typeof getStudentSubmission === 'function'
          ? [getStudentSubmission(cid, sid, aid)]
          : [];
    var files = [];
    (subs || []).forEach(function (sub) {
      if (!sub || sub.on_paper) return;
      files = files.concat(
        (sub.files || []).filter(Boolean).sort(function (x, y) {
          return (Number(x.page) || 0) - (Number(y.page) || 0);
        }),
      );
    });
    var given = typeof getStudentMarkup === 'function' ? getStudentMarkup(cid, sid, aid) : null;
    var byFile = {};
    ((given && given.ok && given.files) || []).forEach(function (f) {
      if (f && f.file_id) byFile[f.file_id] = f.marks || null;
    });
    var opening = files.map(function (f) {
      return typeof openStudentWorkPage === 'function'
        ? Promise.resolve(openStudentWorkPage(cid, f, 'page')).then(null, function () {
            return null;
          })
        : Promise.resolve(null);
    });
    Promise.all(opening).then(function (opened) {
      var still = _open === mine && mine.ui.work === aid;
      if (!still) {
        opened.forEach(function (o) {
          if (o && typeof o.release === 'function') o.release();
        });
        return;
      }
      var pages = [];
      mine.releases = [];
      opened.forEach(function (o, i) {
        if (!o || !o.url) return;
        if (typeof o.release === 'function') mine.releases.push(o.release);
        pages.push({ url: o.url, marks: byFile[files[i].id] || null });
      });
      mine.ui = Object.assign({}, mine.ui, {
        workPages: { id: aid, state: files.length && !pages.length ? 'failed' : 'ready', pages: pages },
      });
      _drawScreen('#sp-work-title');
    });
  }

  function _drawScreen(focus) {
    var box = _overlay();
    var screen = box && box.querySelector('.ps-screen');
    if (!screen || !_open) return;
    var built = _fromCache(_open.cid, _open.sid);
    if (!built.ready) return _draw();
    // html-safe: drawPage is s/page-view.js, which escapes every title, date line and result
    screen.innerHTML = _screenHtml(built);
    _settle(screen);
    var to = focus ? screen.querySelector(focus) : null;
    if (to && typeof to.focus === 'function') to.focus();
  }

  // On the phone, a card picked from elsewhere is brought into view; the cards' carousels fetch their pages.
  function _settle(screen) {
    if (!screen || !_open) return;
    StudentPageView.settle(screen);
    if (typeof StudentPageCarousel !== 'undefined') {
      StudentPageCarousel.attach(screen, _carSource, { scrollRoot: screen });
    }
    if (typeof StudentBulletinsView !== 'undefined') {
      StudentBulletinsView.attach(screen, _bltSource, { scrollRoot: screen });
      StudentBulletinsView.fitViewer(screen, { scrollRoot: screen });
      StudentBulletinsView.fitTabs(screen);
      // A bulletin's page open full size: drawn again once its picture is here.
      var ui = _open.ui || {};
      if (ui.bulletinFile && !screen.querySelector('.sp-bulletin-viewer-img')) {
        var mine = _open;
        var fid = ui.bulletinFile;
        var pg = Number(ui.bulletinPage) || 0;
        _bltSource.load(fid, pg).then(function (url) {
          if (url && _open === mine && mine.ui.bulletinFile === fid && Number(mine.ui.bulletinPage) === pg) {
            _drawScreen('#sp-bulletin-viewer-title');
          }
        });
      }
    }
  }

  /* The pages a card's carousel shows (s/page-carousel.js), as the student
     sees them: openAssessmentHandoutPage, as the open handout uses. Kept
     while the preview is open on this student, let go when it closes. */
  var _carSource = {
    known: function (rid, i) {
      var got = _open && _open.car && _open.car[rid + ':' + i];
      return got && typeof got === 'string' ? got : '';
    },
    load: function (piece, rid, i) {
      var mine = _open;
      if (!mine || typeof openAssessmentHandoutPage !== 'function') return Promise.resolve('');
      var key = rid + ':' + i;
      mine.car = mine.car || {};
      if (mine.car[key]) return Promise.resolve(mine.car[key]);
      var asking = Promise.resolve(openAssessmentHandoutPage(mine.cid, rid, Number(i) || 0)).then(
        function (o) {
          if (!o || !o.url) {
            delete mine.car[key];
            return '';
          }
          if (_open !== mine) {
            if (typeof o.release === 'function') o.release();
            return '';
          }
          mine.carReleases = mine.carReleases || [];
          if (typeof o.release === 'function') mine.carReleases.push(o.release);
          mine.car[key] = o.url;
          return o.url;
        },
        function () {
          delete mine.car[key];
          return '';
        },
      );
      mine.car[key] = asking;
      return asking;
    },
  };

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
    isOpen: function () {
      return !!_open;
    },
    // The student page's own drawing, as the device draws it.
    drawPage: drawPage,
  };
})();
