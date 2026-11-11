/* Sending work from the student's page (S5-F2 and S5-F3; the artboard's
   "Camera", "Check and Send", "Sent", "Sending Late", "Closed Assignment",
   "Not Sent Yet", "One Page Didn't Send", "Blurry Photo, Retake", "Sent,
   Being Graded" and "Unsend or Replace").

   Demo Mode only, behind three switches: the class's student page (the
   build switch), Send Work (Demo Mode's #demo-card-send; off at
   #demo-card, as in every class), and Students Send on the piece. Nothing
   is sent anywhere: the server's side (migrations/local-test/
   batch-b-contract.md: `work`, `send_start`, `send_finish`, `unsend`,
   `replace`) is not applied, and the routes that will call it (S5-F4) are
   not built. Here Demo Mode answers as those functions are written to:
   what each piece takes (workOf, the shape of `work`), a send that is
   finished only once every page is up, Late judged at the finish, a send
   that can be finished for two hours from its first start, no Unsend or
   Replace once grading has started. Photos stay on this device, in memory,
   for as long as the sample runs.

   Every photo and PDF goes through shared/photo-shrink.js (one path for
   every upload): JPEG pages under 2 MB, a PDF turned into pages (30 pages
   at most in one send), the blurry check. A real send will hand the pages
   to shared/photo-queue.js; Demo Mode hands nothing to it.

   Any answer from anything asynchronous (a file being shrunk, a send)
   draws only if the same send is still on screen for the same student:
   StudentPage.whileCurrent drops it after Done, a new card or another
   class, and the send it belongs to must still be the one showing. */
(function () {
  'use strict';

  var S = null; // the page's state (student.js)
  var MAX_PAGES = 30; // in one send (Colin's ruling 88)
  var PDF_PAGES = 20; // in one PDF (ruling 18; PhotoShrink.MAX_PDF_PAGES)
  var HOLD_MS = 2 * 60 * 60 * 1000; // a started send can be finished for two hours (ruling 93)
  var NOTE_MAX = 1000;
  var urls = []; // object addresses made for pages on this device, let go after Done
  var prepareFn = null; // tests pass their own PhotoShrink.prepare
  var clock = function () {
    return Date.now();
  };

  /* ── Demo Mode's sample: what each piece takes ───────────────
     Science 8's three pieces still to do: the Science Fair Proposal takes
     photos or files and is open; the Disease Research Poster takes photos
     and is past its due date (late work is taken and marked Late, ruling
     85); the Immune System Quick Check stops taking work on its due day.
     The poster already has a draft grade, so work sent for it is locked at
     once (ruling 84). */
  var DEMO_TAKES = {
    'demo-fair': { students_send: 'photos_files', after: 'keep' },
    'demo-poster': { students_send: 'photos', after: 'keep', graded: true },
    'demo-quick': { students_send: 'photos', after: 'stop' },
    // #demo-card-group only (S12-F1): a group piece; a group-mate's pages are in, Cece's are not.
    'demo-cell-model': { students_send: 'photos', after: 'keep' },
  };

  function today() {
    var t = new Date(clock());
    return (
      t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
    );
  }

  /* The `work` reply for the class on screen, as the contract gives it, or
     null: Demo Mode with Send Work on only. */
  function workOf(state) {
    if (!state || !state.demo || !state.demoSend || !state.reply) return null;
    var day = today();
    var sentFor = state.demoSent || {};
    return {
      ok: true,
      v: 1,
      send_work: true,
      assessments: (state.reply.assessments || [])
        .filter(function (a) {
          return a && (DEMO_TAKES[a.id] || sentFor[a.id]);
        })
        .map(function (a) {
          var takes = DEMO_TAKES[a.id] || {};
          var due = a.due_date ? String(a.due_date).slice(0, 10) : '';
          var closes = takes.after === 'stop' && due ? due : null;
          var open = !closes || day <= closes;
          var rec = sentFor[a.id] || null;
          return {
            id: a.id,
            students_send: takes.students_send || 'nothing',
            open: open,
            closes_on: closes,
            late_now: !!due && day > due,
            sent: rec
              ? {
                  submission_id: rec.id,
                  sent_at: rec.at,
                  sent_by: rec.teacherOnly ? 'teacher' : 'student',
                  on_paper: false,
                  is_late: rec.late,
                  note: rec.note,
                  pages: rec.pages.length + (rec.teacherPages || 0),
                  grading: !!takes.graded || !!rec.grading,
                  can_change: open && !takes.graded && !rec.grading && !rec.teacherOnly,
                  // Demo Mode's own: the pages to show here, and how many the teacher added.
                  thumbs: rec.pages.map(function (pg) {
                    return pg.thumbUrl || pg.url;
                  }),
                  teacher_pages: rec.teacherPages || 0,
                }
              : null,
            sending: null,
          };
        }),
    };
  }

  /* ── Helpers ─────────────────────────────────────────────────── */

  function view() {
    return S && typeof StudentPage.viewOf === 'function' ? StudentPage.viewOf(S) : null;
  }
  function pieceOf(id) {
    var v = view();
    return (
      (v &&
        v.work.filter(function (p) {
          return p.id === id;
        })[0]) ||
      null
    );
  }
  function objectUrl(blob) {
    try {
      var u = blob && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
      if (u) urls.push(u);
      return u;
    } catch (e) {
      return '';
    }
  }
  function letGo() {
    urls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {
        /* already gone */
      }
    });
    urls = [];
  }
  var DAY = { month: 'short', day: 'numeric' };
  function fmtDay(iso, opts) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', opts || DAY);
  }
  // A clock time, "11:40" (Colin's approved line has no a.m. or p.m.).
  function clockTime(ms) {
    var t = new Date(ms);
    var h = t.getHours() % 12 || 12;
    return h + ':' + String(t.getMinutes()).padStart(2, '0');
  }
  // "Thursday, Nov 5 · 8:12 pm" (the Sent board's).
  function sentWhen(ms) {
    var t = new Date(ms);
    var day = t.toLocaleDateString('en-CA', { weekday: 'long' }) + ', ' + fmtDay(t.toISOString(), DAY);
    return day + ' · ' + clockTime(ms) + ' ' + (t.getHours() < 12 ? 'am' : 'pm');
  }
  function plural(n, one, many) {
    return n === 1 ? one : many;
  }
  // Page numbers as words: "Page 1", "Pages 1 and 2", "Pages 1, 2 and 3".
  function pagesWord(nums) {
    if (nums.length === 1) return 'Page ' + nums[0];
    return 'Pages ' + nums.slice(0, -1).join(', ') + ' and ' + nums[nums.length - 1];
  }

  /* ── Starting a send ─────────────────────────────────────────── */

  // Is this send still the one on screen, for the student on screen?
  function current(send) {
    return !!S && S.send === send && S.screen === 'send' && !!S.page && S.page.student.id === send.student;
  }

  function open(id, replace) {
    var p = pieceOf(id);
    if (!p || !p.send || !p.send.takes) return;
    if (replace ? !(p.send.sent && p.send.sent.canChange) : !p.send.open) return;
    S.send = {
      id: p.id,
      student: S.page.student.id,
      replace: !!replace,
      pages: [], // { key, blob, thumb, hash, url, thumbUrl, blurry, from, sent }
      note: '',
      followed: '', // Did You Do It? (S10-F2): '' | yes | partly | no (Batch B's followed_plan)
      step: 'check', // check | blurry | sending | notsent | pagefailed | expired | sent
      message: '',
      busy: false,
      startedAt: 0, // the send's first start: the two hours run from here
      failed: -1, // the page that didn't send
      sentAt: 0,
      seq: 0,
    };
    S.sendAsk = null;
    S.screen = 'send';
    whenShrinkIsIn();
    StudentPage.paint('#sp-send-title');
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  function back() {
    var id = S.send ? S.send.id : '';
    S.send = null;
    S.screen = 'assignments';
    StudentPage.paint(
      id ? '[data-piece="' + String(id).replace(/["\\]/g, '') + '"] .sp-piece-title' : '.sp-segment-on',
    );
  }

  /* ── Adding pages ────────────────────────────────────────────── */

  // What a refused file says. "Save it as a PDF first" is the plan's; the rest are mine.
  function refusal(res) {
    // PhotoShrink.REASONS' values, named here so the words do not wait on the file.
    var R = {
      OFFICE: 'office',
      NO_DECODER: 'no_decoder',
      UNREADABLE: 'unreadable',
      TOO_MANY_PAGES: 'too_many_pages',
      PDF_TOO_LARGE: 'pdf_too_large',
    };
    if (res.reason === R.OFFICE) return 'Save it as a PDF first, then choose the PDF.';
    if (res.kind === 'pdf' && res.reason === R.UNREADABLE && res.locked) {
      return 'This PDF has a password. Save a copy without one, then choose it here.';
    }
    if (res.kind === 'pdf' && res.reason === R.NO_DECODER) {
      return 'That PDF couldn’t be opened. Check your internet and try again.';
    }
    // A PDF over its own limit (20 pages, ruling 18), when more than that would still fit in the send.
    if (res.reason === R.TOO_MANY_PAGES && res.kind === 'pdf' && res.limit === PDF_PAGES) {
      return 'A PDF can have ' + PDF_PAGES + ' pages at most.';
    }
    if (res.reason === R.TOO_MANY_PAGES) return 'You can send ' + MAX_PAGES + ' pages at most.';
    if (res.reason === R.PDF_TOO_LARGE) return 'That PDF is too big to send. It can be 20 MB at most.';
    return 'That file couldn’t be used. Try another photo.';
  }

  /* shared/photo-shrink.js and shared/photo-readers.js are fetched only
     when a send opens, so a slip or a page that sends nothing never loads
     them. photo-readers.js fetches pdf.js (vendor/pdfjs/) itself, and only
     when a PDF is chosen. → Promise. */
  var fetching = null;
  function load(src) {
    return new Promise(function (done) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = el.onerror = function () {
        done();
      };
      document.head.appendChild(el);
    });
  }
  function whenShrinkIsIn() {
    var shrink = prepareFn || typeof PhotoShrink !== 'undefined';
    var readers = typeof PhotoReaders !== 'undefined';
    if ((shrink && readers) || typeof document === 'undefined') return Promise.resolve();
    if (fetching) return fetching;
    fetching = Promise.all([
      shrink ? null : load('../shared/photo-shrink.js'),
      readers ? null : load('../shared/photo-readers.js'),
    ]).then(function () {
      fetching = null;
    });
    return fetching;
  }
  // What reads a PDF (shared/photo-readers.js), or none while it is not in: PhotoShrink then refuses the PDF.
  function openPdf() {
    return typeof PhotoReaders !== 'undefined' && PhotoReaders.openPdf ? PhotoReaders.openPdf : null;
  }

  /* Shrink each file and keep its pages, in order. `at` puts them in place
     of the page at that index (Retake). → Promise. */
  function addFiles(files, at) {
    var send = S && S.send;
    if (!send || !files.length || send.busy) return Promise.resolve();
    send.busy = true;
    send.message = '';
    StudentPage.paint();
    return StudentPage.whileCurrent(whenShrinkIsIn()).then(function () {
      if (!current(send)) return;
      var prepare = prepareFn || (typeof PhotoShrink !== 'undefined' && PhotoShrink.prepare);
      if (typeof prepare !== 'function') {
        send.busy = false;
        send.message = 'Photos can’t be added on this page.';
        StudentPage.paint();
        return;
      }
      return shrink(send, files, at, prepare);
    });
  }

  function shrink(send, files, at, prepare) {
    var room = function () {
      return MAX_PAGES - send.pages.length + (at >= 0 ? 1 : 0);
    };
    var out = [];
    var why = '';
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        if (why) return null;
        // A PDF is asked for no more pages than fit in the send, and never more than 20.
        var fit = Math.max(1, Math.min(PDF_PAGES, room() - out.length));
        return Promise.resolve(prepare(file, { maxPages: fit, openPdf: openPdf() })).then(function (res) {
          if (!res || !res.ok) {
            why = refusal(res || {});
            return;
          }
          if (out.length + res.pages.length > room()) {
            why = 'You can send ' + MAX_PAGES + ' pages at most.';
            return;
          }
          res.pages.forEach(function (pg) {
            out.push({ pg: pg, from: res.kind });
          });
        });
      });
    });
    return StudentPage.whileCurrent(
      chain.then(
        function () {
          return true;
        },
        function () {
          why = why || 'That file couldn’t be used. Try another photo.';
          return true;
        },
      ),
    ).then(function () {
      // The student left, or another send started, while the files were shrunk.
      if (!current(send)) return;
      send.busy = false;
      send.message = why;
      var made = out.map(function (o) {
        return {
          key: 'pg' + (send.seq += 1),
          blob: o.pg.blob,
          thumb: o.pg.thumb,
          hash: o.pg.hash,
          url: objectUrl(o.pg.blob),
          thumbUrl: objectUrl(o.pg.thumb),
          // Only a photo is checked for blur: a PDF's page is as sharp as it was made.
          blurry: o.from !== 'pdf' && !!o.pg.blurry,
          from: o.from,
          sent: false,
        };
      });
      if (made.length) {
        if (at >= 0 && at < send.pages.length) send.pages.splice.apply(send.pages, [at, 1].concat(made));
        else Array.prototype.push.apply(send.pages, made);
      }
      // A blurry photo is shown before anything else (the Blurry Photo board).
      var blurry = made.filter(function (m) {
        return m.blurry;
      })[0];
      if (blurry) {
        send.step = 'blurry';
        send.blurryKey = blurry.key;
        StudentPage.paint('#sp-send-blurry-title');
        return;
      }
      if (send.step === 'pagefailed' && at >= 0) return go(true);
      send.step = 'check';
      StudentPage.paint('#sp-send-title');
    });
  }

  function remove(key) {
    var send = S.send;
    if (!send || send.busy) return;
    send.pages = send.pages.filter(function (pg) {
      return pg.key !== key;
    });
    send.message = '';
    StudentPage.paint(send.pages.length ? '.sp-send-add' : '#sp-send-title');
  }

  /* ── Sending ─────────────────────────────────────────────────── */

  /* Hand the pages in. Demo Mode answers as send_start and send_finish
     will: nothing is handed in until every page is up (ruling 17); a page
     that does not go stops the send there, the pages before it kept up;
     past two hours from the first start the send is dropped (ruling 93);
     Late is judged at the finish (ruling 85). Offline, nothing goes: Not
     Sent Yet, and the pages stay on this device. `again`: carry on from
     the page that didn't send. */
  function go(again) {
    var send = S.send;
    if (!send || send.busy || !send.pages.length) return Promise.resolve();
    var now = clock();
    if (again && send.startedAt && now > send.startedAt + HOLD_MS) {
      send.step = 'expired';
      StudentPage.paint('#sp-send-title');
      return Promise.resolve();
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      send.step = 'notsent';
      StudentPage.paint('#sp-send-title');
      return Promise.resolve();
    }
    if (!again || !send.startedAt) {
      send.startedAt = now;
      send.pages.forEach(function (pg) {
        pg.sent = false;
      });
    }
    send.busy = true;
    send.step = 'sending';
    StudentPage.paint();
    var fail = typeof S.demoFail === 'function' ? S.demoFail : null;
    var chain = Promise.resolve(-1);
    send.pages.forEach(function (pg, i) {
      chain = chain.then(function (stopped) {
        if (stopped >= 0 || pg.sent) return stopped;
        // Demo Mode's upload: nothing leaves the device. A test can make a page fail.
        if (fail && fail(i + 1, send)) return i;
        pg.sent = true;
        return -1;
      });
    });
    return StudentPage.whileCurrent(chain).then(function (stopped) {
      if (!current(send)) return;
      send.busy = false;
      if (stopped >= 0) {
        send.step = 'pagefailed';
        send.failed = stopped;
        StudentPage.paint('#sp-send-title');
        return;
      }
      finish(send);
    });
  }

  function finish(send) {
    var p = pieceOf(send.id);
    var due = p && p.dueDate ? p.dueDate : '';
    var now = clock();
    var old = S.demoSent[send.id];
    S.demoSent[send.id] = {
      id: 'demo-sub-' + send.id + '-' + now.toString(36),
      at: new Date(now).toISOString(),
      late: !!due && today() > due,
      note: send.note.slice(0, NOTE_MAX),
      // The student's word on their plan, as send_start takes it (p_followed_plan): null when not asked or not answered.
      followedPlan: p && p.plan && FOLLOWED[send.followed] ? send.followed : null,
      pages: send.pages.map(function (pg) {
        return { url: pg.url, thumbUrl: pg.thumbUrl };
      }),
      // A Replace keeps the pages the teacher added (ruling 92).
      teacherPages: (old && old.teacherPages) || 0,
    };
    send.sentAt = now;
    send.step = 'sent';
    StudentPage.paint('#sp-send-title');
  }

  /* ── Unsend and Replace (S5-F3), asked over the card ─────────── */

  function ask(kind, id) {
    var p = pieceOf(id);
    if (!p || !p.send || !p.send.sent || !p.send.sent.canChange) return;
    S.sendAsk = { kind: kind, id: id };
    StudentPage.paint('#sp-send-ask-title');
  }

  function answer(yes) {
    var q = S.sendAsk;
    S.sendAsk = null;
    if (!q || !yes) {
      StudentPage.paint(
        q ? '[data-act="send-' + q.kind + '"][data-piece="' + String(q.id).replace(/["\\]/g, '') + '"]' : null,
      );
      return;
    }
    var p = pieceOf(q.id);
    // Asked again at the press: grading may have started, or the piece closed, since the card was drawn.
    if (!p || !p.send || !p.send.sent || !p.send.sent.canChange) {
      StudentPage.paint();
      return;
    }
    if (q.kind === 'replace') {
      open(q.id, true);
      return;
    }
    var rec = S.demoSent[q.id];
    if (rec && rec.teacherPages > 0) {
      // The teacher's pages stay, and the work stays handed in, as the teacher's (ruling 92).
      rec.pages = [];
      rec.teacherOnly = true;
      rec.note = '';
    } else {
      delete S.demoSent[q.id];
    }
    StudentPage.paint('.sp-segment-on');
  }

  /* The question over the card: Unsend Your Work? or Replace Your Photos?
     The words are Colin's (ruling 102, s8-f1-wording-draft.md items 3 and
     4). */
  function dialogHtml(state) {
    var q = state && state.sendAsk;
    if (!q || state.screen !== 'assignments') return '';
    var p = pieceOf(q.id);
    if (!p || !p.send || !p.send.sent) return '';
    var sent = p.send.sent;
    // The page never names the teacher (Colin's ruling 112).
    var teacher = 'your teacher';
    var mine = sent.pages - sent.teacherPages;
    var photos = mine === 1 ? 'Your photo is' : 'Your ' + mine + ' photos are';
    var title;
    var body;
    var yes;
    var no;
    if (q.kind === 'unsend') {
      title = 'Unsend Your Work?';
      body =
        sent.teacherPages > 0
          ? photos +
            ' deleted. ' +
            (sent.teacherPages === 1
              ? 'The page ' + teacher + ' added stays.'
              : 'The ' + sent.teacherPages + ' pages ' + teacher + ' added stay.') +
            ' Deleted photos can’t come back.'
          : photos +
            ' deleted and ' +
            p.title +
            ' goes back to To Do. Deleted photos can’t come back. After grading starts, ask ' +
            teacher +
            ' instead.';
      yes = 'Unsend';
      no = 'Keep It Sent';
    } else {
      title = 'Replace Your Photos?';
      body =
        photos +
        ' deleted when the new ones are sent. Deleted photos can’t come back.' +
        (p.send.lateNow ? ' It’s past the due date, so your new photos are marked Late.' : '');
      yes = 'Replace Photos';
      no = 'Cancel';
    }
    return (
      '<button type="button" class="sp-sheet-back" data-act="send-ask-no" aria-label="Close" tabindex="-1"></button>' +
      '<div class="sp-sheet sp-send-ask" role="alertdialog" aria-modal="true" aria-labelledby="sp-send-ask-title" aria-describedby="sp-send-ask-body">' +
      '<h2 class="sp-sheet-title" id="sp-send-ask-title" tabindex="-1">' +
      esc(title) +
      '</h2><p class="sp-send-ask-body" id="sp-send-ask-body">' +
      esc(body) +
      '</p><div class="sp-send-ask-buttons"><button type="button" class="sp-btn ' +
      (q.kind === 'unsend' ? 'sp-btn-danger' : 'sp-btn-primary') +
      '" data-act="send-ask-yes">' +
      esc(yes) +
      '</button><button type="button" class="sp-btn sp-btn-quiet" data-act="send-ask-no">' +
      esc(no) +
      '</button></div></div>'
    );
  }

  /* ── Drawing ─────────────────────────────────────────────────── */

  var BACK =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';

  /* A button that opens the camera or the file chooser: a label around a
     file input, so the browser's own chooser opens. `capture` asks a phone
     for its camera; `retake` puts the photo in place of that page. */
  function pickHtml(label, cls, accept, opts) {
    opts = opts || {};
    return (
      '<label class="sp-btn ' +
      cls +
      '">' +
      esc(label) +
      '<input type="file" class="sp-send-input" accept="' +
      esc(accept) +
      '"' +
      (opts.capture ? ' capture="environment"' : '') +
      (opts.multiple ? ' multiple' : '') +
      (opts.retake ? ' data-retake="' + esc(opts.retake) + '"' : '') +
      '></label>'
    );
  }

  function acceptFor(p) {
    return p.send && p.send.takes === 'photos_files' ? 'image/*,application/pdf' : 'image/*';
  }

  function head(title, sub) {
    return (
      '<header class="sp-send-head"><button type="button" class="sp-head-icon" data-act="send-back" aria-label="Back">' +
      BACK +
      '</button><h1 class="sp-send-title" id="sp-send-title" tabindex="-1">' +
      esc(title) +
      '</h1></header>' +
      (sub ? '<p class="sp-send-piece">' + esc(sub) + '</p>' : '')
    );
  }

  function pagesHtml(send, removable) {
    return (
      '<ol class="sp-send-pages">' +
      send.pages
        .map(function (pg, i) {
          var n = i + 1;
          return (
            '<li class="sp-send-page' +
            (send.step === 'pagefailed' && send.failed === i ? ' sp-send-page-failed' : '') +
            '"><img class="sp-send-page-img" src="' +
            esc(pg.thumbUrl || pg.url) +
            '" alt="' +
            esc('Photo of page ' + n) +
            '"><span class="sp-send-page-n" aria-hidden="true">' +
            n +
            '</span>' +
            (removable
              ? '<button type="button" class="sp-send-page-x" data-act="send-remove" data-page="' +
                esc(pg.key) +
                '" aria-label="' +
                esc('Remove page ' + n) +
                '">×</button>'
              : '') +
            '</li>'
          );
        })
        .join('') +
      '</ol>'
    );
  }

  /* Your Plan From Last Time and Did You Do It? on Check and Send (S10-F2,
     the board "Check and Send, Did You Follow Your Plan?"), when the piece
     carries the student's plan. The answer is the student's word ("Followed
     it" is the student's, Nov 8, decision 11): Yes, Partly or Not This
     Time, or none. */
  var FOLLOWED = { yes: 'Yes', partly: 'Partly', no: 'Not This Time' };
  function planAskHtml(send, p) {
    if (!p.plan || !p.plan.text) return '';
    return (
      '<section class="sp-send-plan" aria-labelledby="sp-send-plan-title"><h2 class="sp-plan-title" id="sp-send-plan-title">Your Plan From Last Time</h2><p class="sp-plan-words">' +
      esc(p.plan.text) +
      '</p><h3 class="sp-send-plan-ask" id="sp-send-plan-ask">Did You Do It?</h3><div class="sp-seg sp-seg-3" role="radiogroup" aria-label="Did you follow your plan?">' +
      Object.keys(FOLLOWED)
        .map(function (k) {
          var on = send.followed === k;
          return (
            '<button type="button" class="sp-seg-btn' +
            (on ? ' sp-seg-on' : '') +
            '" role="radio" aria-checked="' +
            on +
            '" tabindex="' +
            (on || (!send.followed && k === 'yes') ? '0' : '-1') +
            '" data-act="send-followed" data-value="' +
            k +
            '">' +
            esc(FOLLOWED[k]) +
            '</button>'
          );
        })
        .join('') +
      '</div></section>'
    );
  }

  // Check and Send, and Sending Late (the boards): the pages, Add Page or File, the note, Send.
  function checkHtml(send, p) {
    var n = send.pages.length;
    var late = p.send.lateNow;
    var accept = acceptFor(p);
    var full = n >= MAX_PAGES;
    return (
      head('Check and Send', p.title) +
      (late
        ? '<p class="sp-send-due">' +
          esc(p.dueDate ? 'Due ' + fmtDay(p.dueDate, { weekday: 'short', month: 'short', day: 'numeric' }) : '') +
          '</p><p class="sp-send-late" role="note">This will be marked Late.</p>'
        : '') +
      (n ? pagesHtml(send, !send.busy) : '') +
      (send.busy ? '<p class="sp-send-msg" role="status">Getting your photos ready…</p>' : '') +
      (send.message ? '<p class="sp-send-msg sp-msg" role="alert">' + esc(send.message) + '</p>' : '') +
      (full
        ? '<p class="sp-send-hint">You can send ' + MAX_PAGES + ' pages at most.</p>'
        : n
          ? '<div class="sp-send-add">' +
            pickHtml('Add Page or File', 'sp-btn-tint', accept, { multiple: true }) +
            '</div>'
          : '<div class="sp-send-add sp-send-start">' +
            pickHtml('Use the Camera', 'sp-btn-primary', 'image/*', { capture: true }) +
            pickHtml('Choose a File', 'sp-btn-tint', accept, { multiple: true }) +
            '<p class="sp-send-hint">' +
            esc(
              p.send.takes === 'photos_files'
                ? 'Photos or PDFs. Working in Word, PowerPoint or Google? Save it as a PDF, then choose it here.'
                : 'Take a photo of each page.',
            ) +
            '</p></div>') +
      planAskHtml(send, p) +
      '<label class="sp-send-note-label" for="sp-send-note">' +
      'Note for Your Teacher' +
      '</label><textarea id="sp-send-note" class="sp-send-note" maxlength="' +
      NOTE_MAX +
      '" rows="3">' +
      esc(send.note) +
      '</textarea>' +
      '<button type="button" class="sp-btn sp-btn-primary sp-btn-big sp-send-go" data-act="send-go"' +
      (!n || send.busy ? ' disabled' : '') +
      '>' +
      esc(
        send.step === 'sending' ? 'Sending…' : late ? 'Send Late' : 'Send ' + n + ' ' + plural(n, 'Photo', 'Photos'),
      ) +
      '</button>'
    );
  }

  // Blurry Photo, Retake (the board's words, with "your teacher" for "Mr. Brown": ruling 112).
  function blurryHtml(send, p) {
    var i = -1;
    send.pages.forEach(function (pg, k) {
      if (pg.key === send.blurryKey) i = k;
    });
    var pg = send.pages[i];
    if (!pg) return checkHtml(send, p);
    return (
      '<header class="sp-send-head"><button type="button" class="sp-btn sp-btn-quiet sp-btn-small" data-act="send-blur-cancel">Cancel</button>' +
      '<div class="sp-send-head-words"><span class="sp-send-head-piece">' +
      esc(p.title) +
      '</span><span class="sp-send-head-page">' +
      esc('Page ' + (i + 1)) +
      '</span></div></header>' +
      '<img class="sp-send-blurry-img" src="' +
      esc(pg.url) +
      '" alt="' +
      esc('Page ' + (i + 1) + ', blurry') +
      '">' +
      '<section class="sp-send-panel"><h1 class="sp-send-title" id="sp-send-blurry-title" tabindex="-1">This photo looks blurry</h1><p class="sp-send-line">' +
      'Your teacher may not be able to read it. Hold the phone still, right above the page.' +
      '</p><div class="sp-send-row">' +
      pickHtml('Retake', 'sp-btn-primary', 'image/*', { capture: true, retake: pg.key }) +
      '<button type="button" class="sp-btn sp-btn-tint" data-act="send-blur-keep">Use It Anyway</button></div></section>'
    );
  }

  /* One Page Didn't Send. Colin's words (ruling 102, item 5): the pages up
     are sent, the rest is still on this phone, and the send can be finished
     until two hours after it started. Ruling 17: Try Again or Remove the
     Page. */
  function failedHtml(send, p) {
    var i = send.failed;
    var n = i + 1;
    var who = 'Your teacher';
    var up = [];
    var waiting = [];
    send.pages.forEach(function (pg, k) {
      (pg.sent ? up : waiting).push(k + 1);
    });
    var all = send.pages.length;
    var line =
      (up.length ? pagesWord(up) + plural(up.length, ' is', ' are') + ' sent. ' : '') +
      pagesWord(waiting) +
      plural(waiting.length, ' is', ' are') +
      ' still on this phone. Finish by ' +
      clockTime(send.startedAt + HOLD_MS) +
      ', or you’ll need to send ' +
      (all === 2 ? 'both pages' : all === 1 ? 'it' : 'all ' + all + ' pages') +
      ' again. ' +
      who +
      ' sees your work once every page is sent.';
    return (
      head('Page ' + n + ' didn’t send', '') +
      pagesHtml(send, false) +
      '<p class="sp-send-line" role="alert">' +
      esc(line) +
      '</p><div class="sp-send-col"><button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="send-again">' +
      esc('Send Page ' + n + ' Again') +
      '</button>' +
      pickHtml('Retake Page ' + n, 'sp-btn-tint', 'image/*', { capture: true, retake: send.pages[i].key }) +
      '<button type="button" class="sp-btn sp-btn-quiet" data-act="send-drop" data-page="' +
      esc(send.pages[i].key) +
      '">' +
      esc('Remove Page ' + n) +
      '</button></div><p class="sp-send-hint">' +
      'If it keeps failing, show your teacher this screen.' +
      '</p>'
    );
  }

  // After the two hours (Colin's words, ruling 102, item 5).
  function expiredHtml(send, p) {
    return (
      head('Not sent', p.title) +
      pagesHtml(send, false) +
      '<p class="sp-send-line" role="alert">This send took too long and was stopped. Your photos are still on this phone. Send them again.</p>' +
      '<button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="send-restart">Send Again</button>'
    );
  }

  // Not Sent Yet (the board's words).
  function notSentHtml(send) {
    var n = send.pages.length;
    return (
      '<section class="sp-send-center"><h1 class="sp-send-title" id="sp-send-title" tabindex="-1">Not sent yet</h1><p class="sp-send-line">' +
      esc(
        (n === 1 ? 'Your photo is' : 'Your ' + n + ' photos are') +
          ' saved on this phone. They’ll send when you’re back online.',
      ) +
      '</p>' +
      pagesHtml(send, false) +
      '<div class="sp-send-col"><button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="send-again">Try Again Now</button>' +
      '<button type="button" class="sp-btn sp-btn-quiet" data-act="send-done">Back to My Work</button></div></section>'
    );
  }

  // Sent (the board's words, with "Your Teacher" for "Mr. Brown": ruling 112).
  function sentHtml(send, p) {
    return (
      '<section class="sp-send-center"><span class="sp-send-tick" aria-hidden="true">✓</span><h1 class="sp-send-title" id="sp-send-title" tabindex="-1">' +
      'Sent to Your Teacher' +
      '</h1><p class="sp-send-piece">' +
      esc(p.title) +
      '</p>' +
      StudentPageView.thumbsHtml(
        send.pages.map(function (pg) {
          return pg.thumbUrl || pg.url;
        }),
        'Page',
      ) +
      '<p class="sp-send-when">' +
      esc(sentWhen(send.sentAt)) +
      '</p><button type="button" class="sp-btn sp-btn-primary sp-btn-big" data-act="send-done">Back to My Work</button></section>'
    );
  }

  function renderSend(state) {
    var send = state.send;
    var p = send && state.page && state.page.student.id === send.student ? pieceOf(send.id) : null;
    if (!p || !p.send) {
      return '<main class="sp-main sp-main-center"><p class="sp-lead" role="status">Opening your page…</p></main>';
    }
    var body =
      send.step === 'sent'
        ? sentHtml(send, p)
        : send.step === 'notsent'
          ? notSentHtml(send)
          : send.step === 'pagefailed'
            ? failedHtml(send, p)
            : send.step === 'expired'
              ? expiredHtml(send, p)
              : send.step === 'blurry'
                ? blurryHtml(send, p)
                : checkHtml(send, p);
    return (
      '<main class="sp-main sp-send">' +
      body +
      (state.demo ? '<p class="sp-fine">This is Demo Mode. Nothing is sent anywhere.</p>' : '') +
      '</main>'
    );
  }

  /* ── Presses ─────────────────────────────────────────────────── */

  function onClick(act, el) {
    if (!S) return;
    var attr = function (n) {
      return (el && el.getAttribute && el.getAttribute(n)) || '';
    };
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') {
      // Leaving the student or the class: the send and its photos go.
      S.send = null;
      S.sendAsk = null;
      if (act === 'card-done') {
        S.demoSent = {};
        letGo();
      }
      return;
    }
    if (act === 'send-open') return open(attr('data-piece'), false);
    if (act === 'send-unsend') return ask('unsend', attr('data-piece'));
    if (act === 'send-replace') return ask('replace', attr('data-piece'));
    if (act === 'send-ask-yes') return answer(true);
    if (act === 'send-ask-no') return answer(false);
    if (S.screen !== 'send' || !S.send) return;
    if (act === 'send-back' || act === 'send-done') return back();
    if (act === 'send-remove') return remove(attr('data-page'));
    if (act === 'send-go') return go(false);
    if (act === 'send-again') return go(true);
    if (act === 'send-restart') {
      S.send.startedAt = 0;
      return go(false);
    }
    if (act === 'send-drop') {
      S.send.pages = S.send.pages.filter(function (pg) {
        return pg.key !== attr('data-page');
      });
      if (!S.send.pages.length) {
        S.send.step = 'check';
        S.send.startedAt = 0;
        return StudentPage.paint('#sp-send-title');
      }
      return go(true);
    }
    if (act === 'send-followed') {
      var v = attr('data-value');
      if (!FOLLOWED[v] || S.send.busy) return;
      S.send.followed = v;
      return StudentPage.paint('[data-act="send-followed"][data-value="' + v + '"]');
    }
    if (act === 'send-blur-keep') {
      S.send.step = 'check';
      S.send.blurryKey = '';
      return StudentPage.paint('#sp-send-title');
    }
    if (act === 'send-blur-cancel') {
      remove(S.send.blurryKey);
      S.send.step = 'check';
      S.send.blurryKey = '';
      return StudentPage.paint('#sp-send-title');
    }
  }

  function onInput(el) {
    if (!el || el.id !== 'sp-send-note' || !S || !S.send) return;
    S.send.note = String(el.value || '').slice(0, NOTE_MAX);
  }

  function onChange(el) {
    if (!el || !el.classList || !el.classList.contains('sp-send-input') || !S || !S.send) return;
    var files = Array.prototype.slice.call(el.files || []);
    var retake = el.getAttribute('data-retake') || '';
    el.value = '';
    var at = -1;
    if (retake) {
      S.send.pages.forEach(function (pg, k) {
        if (pg.key === retake) at = k;
      });
      if (S.send.step === 'blurry') S.send.step = 'check';
    }
    return addFiles(files, at);
  }

  // Not Sent Yet: back online, the pages waiting on this device go (the board's "They'll send when you're back online").
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', function () {
      if (S && S.screen === 'send' && S.send && S.send.step === 'notsent') go(true);
    });
  }

  StudentPage.workOf = workOf;
  StudentPage.sendDialog = dialogHtml;

  StudentPage.addScreens({
    file: 'send',
    render: { send: renderSend },
    click: onClick,
    input: onInput,
    change: onChange,
    share: function (state) {
      S = state;
    },
    test: {
      workOf: workOf,
      sendFiles: addFiles,
      sendChange: onChange,
      sendDialog: dialogHtml,
      // Tests hand in their own shrinking and clock (no real milliseconds).
      setPrepare: function (fn) {
        prepareFn = fn;
      },
      setClock: function (fn) {
        clock = fn;
      },
      madeUrls: function () {
        return urls.slice();
      },
      HOLD_MS: HOLD_MS,
      MAX_PAGES: MAX_PAGES,
    },
  });
})();
