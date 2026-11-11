/* Sending work from the student's page (S5-F2 and S5-F3; the artboard's
   "Camera", "Check and Send", "Sent", "Sending Late", "Closed Assignment",
   "Not Sent Yet", "One Page Didn't Send", "Blurry Photo, Retake", "Sent,
   Being Graded" and "Unsend or Replace").

   Behind three switches: the class's student page (the build switch),
   Send Work, and Students Send on the piece.

   Demo Mode (#demo-card-send; Send Work is off at #demo-card, as in every
   class) answers on the device as the server's functions are written to
   (migrations/local-test/batch-b-contract.md): what each piece takes
   (workOf, the shape of `work`), a send that is finished only once every
   page is up, Late judged at the finish, a send that can be finished for
   two hours from its first start, no Unsend or Replace once grading has
   started. Photos stay on this device, in memory, for as long as the
   sample runs. Nothing is sent anywhere.

   A real card (S5-W1) asks the student-submit function's routes
   (supabase/functions/student-submit/send-routes.ts) through app.js's
   askClass, which adds the device's session: `work` once the page is in,
   and only a class whose `work` says Send Work is on shows anything about
   sending. Any other class's page is drawn exactly as before. A send is
   `send-start` (or `replace`), each page and its thumbnail put to the
   one-time upload link the start gave for it, then `send-finish`; Unsend
   is `unsend`; the student's own pages come through `file-links` and are
   shown from blob: addresses. A send's pages are kept on the device
   (IndexedDB, through shared/photo-queue.js's store) from the press of
   Send until the server has them, so a reload or a dropped connection
   finishes the send within its two hours; after that the student sends
   again. Done empties that store. Mark Up, reflections, revisions and
   group work stay Demo Mode's.

   Every photo and PDF goes through shared/photo-shrink.js (one path for
   every upload): JPEG pages under 2 MB, a PDF turned into pages (30 pages
   at most in one send), the blurry check.

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
     null: Demo Mode with Send Work on, or a real card whose class has it on. */
  function workOf(state) {
    if (state && !state.demo) return realWorkOf(state);
    if (!state || !state.demo || !state.demoSend || !state.reply) return null;
    var day = today();
    var sentFor = state.demoSent || {};
    // #demo-card-revise (S11-F2): the pieces returned for revision (s/feedback.js).
    var revs = typeof StudentPage.demoRevisions === 'function' ? StudentPage.demoRevisions(state) : null;
    return {
      ok: true,
      v: 1,
      send_work: true,
      assessments: (state.reply.assessments || [])
        .filter(function (a) {
          return a && (DEMO_TAKES[a.id] || sentFor[a.id] || (revs && revs[a.id]));
        })
        .map(function (a) {
          if (revs && revs[a.id]) return revisionWork(a, revs[a.id], day);
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

  /* A piece returned for revision, in `work`'s shape (S11-F2): it takes
     photos while the request is open, and what is in is the newest version,
     as the contract's `sent` is: the revision once sent, the first version
     until then. The first version is being graded (it has its grade), so it
     can't be changed; a revision can be until the teacher starts grading it.
     Late is judged by Revise By. */
  function revisionWork(a, r, day) {
    var rec = r.revision;
    var open = !r.returned;
    return {
      id: a.id,
      students_send: 'photos',
      open: open,
      closes_on: null,
      late_now: !!r.revise_by && day > r.revise_by,
      sent: rec
        ? {
            submission_id: 'demo-rev-' + a.id,
            sent_at: rec.at,
            sent_by: 'student',
            on_paper: false,
            is_late: !!rec.late,
            note: rec.note,
            pages: rec.pages.length,
            grading: !!rec.grading || !open,
            can_change: open && !rec.grading,
            thumbs: rec.pages.map(function (pg) {
              return pg.thumbUrl || pg.url;
            }),
            teacher_pages: 0,
          }
        : {
            submission_id: 'demo-sub-' + a.id,
            sent_at: r.first_sent_at,
            sent_by: 'student',
            on_paper: false,
            is_late: false,
            note: null,
            pages: r.first_thumbs.length,
            grading: true,
            can_change: false,
            thumbs: [],
            teacher_pages: 0,
          },
      sending: null,
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
    // A real send of this piece still going up, or waiting: its own screen, as it stands.
    var going = !S.demo && !replace ? running[S.page.student.id + ':' + id] : null;
    if (going) return show(going);
    if (replace ? !(p.send.sent && p.send.sent.canChange) : !p.send.open) return;
    // Send My Revision (S11-F2): a piece returned for revision, or replacing the revision sent.
    var revision = !!p.revision && (replace ? p.kind === 'sent' : p.kind === 'revise');
    if (!replace && p.revision && !revision) return;
    // Sending onto the pages the teacher added (ruling 107): the new pages go first, and 30 fit in all.
    var joins = !replace && p.send.sent && p.send.sent.byTeacher ? p.send.sent.pages : 0;
    S.send = {
      id: p.id,
      student: S.page.student.id,
      replace: !!replace,
      revision: revision,
      real: !S.demo,
      room: Math.max(0, MAX_PAGES - joins), // pages this send may hold
      request: '', // a real send's request id: the same on every try, so the server makes it once
      submission: '',
      finishBy: 0, // when the server stops holding it (ms)
      pages: [], // { key, id, blob, thumb, hash, width, height, url, thumbUrl, blurry, from, sent, fileId, landed }
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
    show(S.send);
  }

  function show(send) {
    S.send = send;
    S.sendAsk = null;
    S.screen = 'send';
    whenShrinkIsIn();
    StudentPage.paint('#sp-send-title');
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  function back() {
    var send = S.send;
    var id = send ? send.id : '';
    // A real send the student leaves after it stopped for good is not kept for next time.
    if (send && send.real && send.step === 'expired') forget(send);
    S.send = null;
    S.screen = 'assignments';
    StudentPage.paint(
      id ? '[data-piece="' + String(id).replace(/["\\]/g, '') + '"] .sp-piece-title' : '.sp-segment-on',
    );
    // Sent: another send waiting on this device, if there is one, goes next.
    if (send && send.real && send.step === 'sent') resume();
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
      return send.room - send.pages.length + (at >= 0 ? 1 : 0);
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
            why = 'You can send ' + send.room + ' pages at most.';
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
        return pageOf(send, o.pg, o.from);
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

  // One page as the send keeps it: the shrunk JPEG and thumbnail, and what a real send knows of it.
  function pageOf(send, pg, from) {
    return {
      key: 'pg' + (send.seq += 1),
      id: newId(), // its own id where the device keeps it
      blob: pg.blob,
      thumb: pg.thumb,
      hash: pg.hash,
      width: pg.width,
      height: pg.height,
      url: objectUrl(pg.blob),
      thumbUrl: objectUrl(pg.thumb),
      // Only a photo is checked for blur: a PDF's page is as sharp as it was made.
      blurry: from !== 'pdf' && !!pg.blurry,
      from: from,
      sent: false,
      fileId: '', // the server's id for it, once a start has named it
      landed: { photo: false, thumb: false }, // which of its two files the server has
    };
  }

  function remove(key) {
    var send = S.send;
    if (!send || send.busy) return;
    dropPage(send, key);
    send.message = '';
    StudentPage.paint(send.pages.length ? '.sp-send-add' : '#sp-send-title');
  }

  // A page taken out of the send, and off the device.
  function dropPage(send, key) {
    var gone = send.pages.filter(function (pg) {
      return pg.key === key;
    });
    send.pages = send.pages.filter(function (pg) {
      return pg.key !== key;
    });
    if (send.real && gone.length) {
      onDevice(function (st) {
        return st.remove([gone[0].id]);
      });
    }
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
    if (send.real) return goReal(send);
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
    if (send.revision) return finishRevision(send);
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

  /* A revision handed in (S11-F2), as revision_finish answers: only on a
     request still open, never once grading of the revision in has started;
     sent after Revise By it is Late (a label). */
  function finishRevision(send) {
    var revs = typeof StudentPage.demoRevisions === 'function' ? StudentPage.demoRevisions(S) : null;
    var r = revs && revs[send.id];
    if (!r || r.returned || (r.revision && r.revision.grading)) {
      send.step = 'check';
      send.message = 'Your teacher has started grading this. Ask your teacher instead.';
      StudentPage.paint('#sp-send-title');
      return;
    }
    var now = clock();
    r.revision = {
      at: new Date(now).toISOString(),
      note: send.note.slice(0, NOTE_MAX),
      late: !!r.revise_by && today() > r.revise_by,
      pages: send.pages.map(function (pg) {
        return { url: pg.url, thumbUrl: pg.thumbUrl };
      }),
      grading: false,
    };
    send.sentAt = now;
    send.step = 'sent';
    StudentPage.paint('#sp-send-title');
  }

  /* ── A real card (S5-W1) ─────────────────────────────────────── */

  var running = {}; // 'student:piece' → a real send started and not handed in, on screen or not
  var thumbs = {}; // submission id → the blob: addresses of its pages' thumbnails, in order
  var thumbsAsked = {}; // submission id → true once its links were asked for
  var realSeen = false; // a real card's page has opened in this tab: Done empties the device's store
  var DAY_MS = 24 * 60 * 60 * 1000;

  // The routes, for the class on screen. app.js adds the session; Demo Mode never comes here.
  function askRoute(route, body) {
    return typeof StudentPage.askClass === 'function'
      ? StudentPage.askClass(route, body)
      : Promise.resolve({ ok: false, error: 'network' });
  }

  function list(v) {
    return Array.isArray(v) ? v : [];
  }

  function newId() {
    var c = typeof crypto !== 'undefined' && crypto ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var b = [];
    for (var i = 0; i < 16; i++) b.push(Math.floor(Math.random() * 256));
    if (c && typeof c.getRandomValues === 'function')
      b = Array.prototype.slice.call(c.getRandomValues(new Uint8Array(16)));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = b
      .map(function (x) {
        return (x < 16 ? '0' : '') + x.toString(16);
      })
      .join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  function offline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  /* `work`, once the class's page is drawn. A class that takes no work
     (or a function that does not know the route yet) gets nothing: the
     page stays exactly as it was drawn, and nothing is drawn again. */
  function loadWork() {
    if (!S || S.demo || !S.page) return Promise.resolve();
    realSeen = true;
    var student = S.page.student.id;
    return askRoute('work', {}).then(function (res) {
      if (!S || !S.page || S.page.student.id !== student) return;
      var on = !!(res && res.ok === true && res.send_work === true);
      var had = !!(S.realWork && S.realWork.student === student);
      S.realWork = on ? { student: student, reply: res } : null;
      if (!on && !had) return;
      repaint();
      if (!on) return;
      loadThumbs(res, student);
      if (!S.send) resume();
    });
  }

  /* The reply as the route gave it, each piece with work in given the
     thumbnails this device has fetched for it. */
  function realWorkOf(state) {
    var w = state && state.realWork;
    if (!w || !state.page || w.student !== state.page.student.id) return null;
    return Object.assign({}, w.reply, {
      assessments: list(w.reply.assessments).map(function (a) {
        if (!a || !a.sent || typeof a.sent !== 'object') return a;
        var mine = thumbs[a.sent.submission_id] || [];
        return Object.assign({}, a, { sent: Object.assign({}, a.sent, { thumbs: mine }) });
      }),
    });
  }

  // The page again with what came back, the focus left where it was. Only the Assignments list.
  function repaint() {
    if (!S || S.screen !== 'assignments' || S.sendAsk) return;
    var el = typeof document !== 'undefined' ? document.activeElement : null;
    var sel = '';
    if (el && el.getAttribute && el.getAttribute('data-act')) {
      var piece = el.getAttribute('data-piece');
      sel = '[data-act="' + el.getAttribute('data-act') + '"]' + (piece ? '[data-piece="' + cssId(piece) + '"]' : '');
    } else if (el && el.classList && el.classList.contains('sp-page-title')) {
      sel = '.sp-page-title';
    }
    StudentPage.paint();
    var back = sel && typeof document !== 'undefined' ? document.querySelector('#app ' + sel) : null;
    if (back && back.focus) back.focus({ preventScroll: true });
  }

  function cssId(id) {
    return String(id).replace(/["\\]/g, '');
  }

  /* The student's own pages of each piece with work in and not back yet
     (the Sent card's pictures): `file-links` gives a link to each page and
     its thumbnail that lives five minutes; each thumbnail is fetched at
     once and shown from a blob: address, so the page needs nothing of the
     Content Security Policy it does not have. Asked once a submission. */
  function loadThumbs(reply, student) {
    var back = {};
    list(S.reply && S.reply.assessments).forEach(function (a) {
      if (a && a.returned_at) back[a.id] = true;
    });
    list(reply.assessments).forEach(function (a) {
      var sent = a && a.sent && typeof a.sent === 'object' ? a.sent : null;
      var sub = sent && typeof sent.submission_id === 'string' ? sent.submission_id : '';
      if (!sub || thumbsAsked[sub] || !(sent.pages > 0) || back[a.id]) return;
      thumbsAsked[sub] = true;
      askRoute('file-links', { assessment_id: a.id }).then(function (res) {
        var files = res && res.ok === true ? list(res.files) : null;
        if (!files) {
          delete thumbsAsked[sub];
          return;
        }
        files = files
          .filter(function (f) {
            return f && typeof f.thumb_url === 'string' && /^https:\/\//.test(f.thumb_url);
          })
          .sort(function (x, y) {
            return (Number(x.version) || 0) - (Number(y.version) || 0) || (Number(x.page) || 0) - (Number(y.page) || 0);
          });
        return StudentPage.whileCurrent(
          Promise.all(
            files.map(function (f) {
              return picture(f.thumb_url);
            }),
          ),
        ).then(function (blobs) {
          thumbs[sub] = blobs.filter(Boolean).map(objectUrl).filter(Boolean);
          if (S && S.realWork && S.realWork.student === student) repaint();
        });
      });
    });
  }

  // One page's picture from its link, or null. The link carries its own key: nothing else is sent.
  function picture(url) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }).then(
      function (res) {
        return res && res.ok ? res.blob() : null;
      },
      function () {
        return null;
      },
    );
  }

  /* One file to its one-time upload link: PUT, the JPEG as the body, its
     type and nothing else. → 'up' (the server has it; a file already there
     is an earlier try that landed), 'refused', or 'network'. */
  function put(url, blob) {
    if (typeof fetch !== 'function' || typeof url !== 'string' || !/^https:\/\//.test(url)) {
      return Promise.resolve('refused');
    }
    return fetch(url, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    }).then(
      function (res) {
        if (res.ok || res.status === 409) return 'up';
        if (res.status >= 500) return 'network';
        // Storage answers a file that is already there with 400 and a body that says 409.
        return Promise.resolve(res.json()).then(
          function (b) {
            return b && (String(b.statusCode) === '409' || /duplicate|already exists/i.test(String(b.error || '')))
              ? 'up'
              : 'refused';
          },
          function () {
            return 'refused';
          },
        );
      },
      function () {
        return 'network';
      },
    );
  }

  /* ── Where a real send's pages wait (IndexedDB) ──
     Each page is one record, with the send's own facts beside it: the
     class (its enrollment id), the piece, the request id, the server's
     ids once a start has named them, which of the two files are up, and
     the note. No name, no token, no link. */
  var DB_NAME = 'fv-s-send';
  var storeFn = null; // tests hand in their own
  var device = null; // a promise of the store, or of null where the browser keeps nothing
  function deviceStore() {
    if (storeFn) return Promise.resolve(storeFn);
    if (device) return device;
    var have = typeof PhotoQueue !== 'undefined' && PhotoQueue && PhotoQueue.indexedDbStore;
    device = (have || typeof document === 'undefined' ? Promise.resolve() : load('../shared/photo-queue.js'))
      .then(function () {
        if (typeof PhotoQueue === 'undefined' || !PhotoQueue || !PhotoQueue.indexedDbStore) return null;
        // Only the queue's store is used here: its own sending is the teacher apps'.
        if (!have && typeof PhotoQueue.release === 'function') PhotoQueue.release();
        var st = PhotoQueue.indexedDbStore(DB_NAME);
        return st.list().then(
          function () {
            return st;
          },
          function () {
            return null;
          },
        );
      })
      .then(null, function () {
        return null;
      });
    return device;
  }
  // fn(store), or nothing where there is no store. Never throws: a send goes on in memory without one.
  function onDevice(fn) {
    return deviceStore()
      .then(function (st) {
        return st ? fn(st) : null;
      })
      .then(null, function () {
        return null;
      });
  }

  function recordOf(send, pg, i) {
    return {
      id: pg.id,
      kind: 'send',
      enrollment: send.student,
      piece: send.id,
      replace: send.replace,
      request: send.request,
      submission: send.submission,
      finish_by: send.finishBy,
      note: send.note,
      followed: send.followed,
      order: i,
      file_id: pg.fileId,
      landed: { photo: !!pg.landed.photo, thumb: !!pg.landed.thumb },
      from: pg.from,
      width: pg.width || null,
      height: pg.height || null,
      saved_at: clock(),
    };
  }

  // The whole send kept again: every page of it, and nothing left of an earlier send of the same piece.
  function saveAll(send) {
    send.kept = send.pages.length > 0;
    return onDevice(function (st) {
      return st
        .list()
        .then(function (rows) {
          var old = list(rows)
            .filter(function (r) {
              return r && r.kind === 'send' && r.enrollment === send.student && r.piece === send.id;
            })
            .map(function (r) {
              return r.id;
            });
          return old.length ? st.remove(old) : null;
        })
        .then(function () {
          return st.putAll(
            send.pages.map(function (pg, i) {
              return { meta: recordOf(send, pg, i), photo: pg.blob, thumb: pg.thumb };
            }),
          );
        });
    });
  }

  // What the server said, written into the records the send already has.
  function savePatch(send, only) {
    return onDevice(function (st) {
      return Promise.all(
        send.pages.map(function (pg, i) {
          if (only && only !== pg) return null;
          var r = recordOf(send, pg, i);
          delete r.id;
          return st.update(pg.id, r);
        }),
      );
    });
  }

  function forget(send) {
    delete running[send.student + ':' + send.id];
    send.kept = false;
    return saveAll(Object.assign({}, send, { pages: [] }));
  }

  function wipeDevice() {
    device = null;
    if (storeFn) return storeFn.clear();
    try {
      if (typeof indexedDB !== 'undefined' && indexedDB) indexedDB.deleteDatabase(DB_NAME);
    } catch (e) {
      /* nothing kept */
    }
    return Promise.resolve();
  }

  /* The class's page has opened: a send this device kept for it carries
     on, on its own screen. The newest one; the next after it is sent.
     Kept sends of a class this session has not opened, or more than a day
     old, are let go: on a shared device they are someone else's. Past its
     two hours, the screen says the send stopped and the photos are still
     here; Send Again starts it over. */
  function resume() {
    if (!S || S.demo || !S.page || S.send || S.screen !== 'assignments') return Promise.resolve();
    var student = S.page.student.id;
    var classes = list(S.page.classes)
      .map(function (c) {
        return c && c.enrollmentId;
      })
      .concat([student]);
    return onDevice(function (st) {
      return st.list().then(function (rows) {
        var sends = list(rows).filter(function (r) {
          return r && r.kind === 'send';
        });
        var stale = sends.filter(function (r) {
          return classes.indexOf(r.enrollment) < 0 || clock() - (Number(r.saved_at) || 0) > DAY_MS;
        });
        if (stale.length) {
          st.remove(
            stale.map(function (r) {
              return r.id;
            }),
          );
        }
        var mine = sends
          .filter(function (r) {
            // A send still going in this tab (left on Not Sent Yet) is not opened twice.
            return stale.indexOf(r) < 0 && r.enrollment === student && !running[student + ':' + r.piece];
          })
          .sort(function (a, b) {
            return (Number(b.saved_at) || 0) - (Number(a.saved_at) || 0);
          });
        if (!mine.length) return null;
        var first = mine[0];
        var pages = mine
          .filter(function (r) {
            return r.piece === first.piece && r.request === first.request;
          })
          .sort(function (a, b) {
            return a.order - b.order;
          });
        return Promise.all(
          pages.map(function (r) {
            return st.blobs(r.id);
          }),
        ).then(function (blobs) {
          return { rows: pages, blobs: blobs };
        });
      });
    }).then(function (kept) {
      if (!kept || !S || !S.page || S.page.student.id !== student || S.send || S.screen !== 'assignments') return;
      var first = kept.rows[0];
      var p = pieceOf(first.piece);
      if (!p || !p.send || !p.send.takes) return;
      var send = {
        id: first.piece,
        student: student,
        replace: !!first.replace,
        revision: false,
        real: true,
        kept: true, // these pages are on the device already
        room: MAX_PAGES,
        request: String(first.request || ''),
        submission: String(first.submission || ''),
        finishBy: Number(first.finish_by) || 0,
        pages: [],
        note: String(first.note || '').slice(0, NOTE_MAX),
        followed: FOLLOWED[first.followed] ? first.followed : '',
        step: 'sending',
        message: '',
        busy: false,
        startedAt: Number(first.finish_by) ? Number(first.finish_by) - HOLD_MS : 0,
        failed: -1,
        sentAt: 0,
        seq: 0,
      };
      kept.rows.forEach(function (r, i) {
        var b = kept.blobs[i];
        if (!b || !b.photo || !b.thumb) return;
        var pg = pageOf(send, { blob: b.photo, thumb: b.thumb, width: r.width, height: r.height }, r.from);
        pg.id = r.id;
        pg.fileId = String(r.file_id || '');
        pg.landed = { photo: !!(r.landed && r.landed.photo), thumb: !!(r.landed && r.landed.thumb) };
        pg.blurry = false;
        send.pages.push(pg);
      });
      if (!send.pages.length) return;
      show(send);
      return goReal(send);
    });
  }

  // How big each page is, for the start: only what the route takes, and only whole numbers.
  function sizeOf(pg) {
    var out = {};
    // Pixels and bytes, as whole numbers.
    var put1 = function (k, size) {
      if (typeof size === 'number' && isFinite(size) && size >= 1) out[k] = Math.round(size);
    };
    put1('width', pg.width);
    put1('height', pg.height);
    put1('bytes', pg.blob && pg.blob.size);
    put1('thumb_bytes', pg.thumb && pg.thumb.size);
    return out;
  }

  // Draw the send if it is the one on screen.
  function draw(send, focus) {
    if (current(send)) StudentPage.paint(focus);
  }

  function stop(send, step, message) {
    send.busy = false;
    send.step = step;
    send.message = message || '';
    draw(send, '#sp-send-title');
  }

  /* Hand the pages in: the start (the same request id each try, so the
     server makes the send once, holds it two hours from the first try, and
     gives fresh upload links each time), every page and thumbnail not up
     yet, then the finish. A page the server named stays named: a new page
     (a Retake, Add Page) makes a new send. The pages are kept on the device
     first. */
  function goReal(send) {
    running[send.student + ':' + send.id] = send;
    // A new send: none yet, or a page added since the server named this one's. A start whose answer never
    // came keeps its request id, so the server, if it got it, hands back the same send.
    var named = send.pages.some(function (pg) {
      return !!pg.fileId;
    });
    var fresh =
      !send.request ||
      (named &&
        send.pages.some(function (pg) {
          return !pg.fileId;
        }));
    if (fresh) {
      send.request = newId();
      send.submission = '';
      send.finishBy = 0;
      send.startedAt = 0;
      send.pages.forEach(function (pg) {
        pg.fileId = '';
        pg.landed = { photo: false, thumb: false };
        pg.sent = false;
      });
    }
    if (send.finishBy && clock() > send.finishBy) return Promise.resolve(expire(send));
    send.busy = true;
    send.step = 'sending';
    send.message = '';
    send.failed = -1;
    draw(send);
    return (fresh || !send.kept ? saveAll(send) : Promise.resolve()).then(function () {
      if (offline()) return stop(send, 'notsent');
      return startReal(send);
    });
  }

  function startReal(send) {
    var p = pieceOf(send.id);
    var body = {
      assessment_id: send.id,
      request_id: send.request,
      pages: send.pages.map(sizeOf),
      note: send.note.slice(0, NOTE_MAX) || null,
      followed_plan: p && p.plan && FOLLOWED[send.followed] ? send.followed : null,
    };
    return askRoute(send.replace ? 'replace' : 'send-start', body).then(function (res) {
      if (!res || res.ok !== true) return refused(send, res);
      // Handed in already: an earlier try's finish went through and its answer was lost.
      if (res.state === 'sent') return handedIn(send, clock());
      var by = {};
      list(res.files).forEach(function (f) {
        if (f && typeof f.file_id === 'string') by[f.file_id] = f;
      });
      send.pages.forEach(function (pg, i) {
        if (pg.fileId) return;
        var named = list(res.files).filter(function (f) {
          return f && f.page === i + 1;
        })[0];
        pg.fileId = named ? named.file_id : '';
      });
      // The server had this request from before a page was added: it holds fewer pages. A new send.
      if (
        res.replayed === true &&
        !send.pages.every(function (pg) {
          return !!pg.fileId;
        })
      ) {
        send.request = '';
        return goReal(send);
      }
      var whole = send.pages.every(function (pg) {
        return by[pg.fileId] && by[pg.fileId].upload_url && by[pg.fileId].thumb_upload_url;
      });
      // An answer the page cannot use is a server's trouble: the pages wait here, as offline.
      if (!whole || typeof res.submission_id !== 'string') return stop(send, 'notsent');
      send.pages.forEach(function (pg) {
        pg.up = by[pg.fileId].upload_url;
        pg.thumbUp = by[pg.fileId].thumb_upload_url;
      });
      send.submission = res.submission_id;
      send.finishBy = Date.parse(String(res.finish_by || '').replace(/(\.\d{3})\d+/, '$1')) || 0;
      send.startedAt = send.finishBy ? send.finishBy - HOLD_MS : clock();
      savePatch(send);
      return upload(send, 0);
    });
  }

  // Each page, then its thumbnail, in order; a page already up is not sent again.
  function upload(send, i) {
    if (i >= send.pages.length) return finishReal(send);
    var pg = send.pages[i];
    return part(send, pg, 'photo')
      .then(function (got) {
        return got === 'up' ? part(send, pg, 'thumb') : got;
      })
      .then(function (got) {
        if (got !== 'up') {
          if (got === 'network' && offline()) return stop(send, 'notsent');
          send.failed = i;
          return stop(send, 'pagefailed');
        }
        pg.sent = true;
        return upload(send, i + 1);
      });
  }

  function part(send, pg, which) {
    if (pg.landed[which]) return Promise.resolve('up');
    return StudentPage.whileCurrent(
      put(which === 'photo' ? pg.up : pg.thumbUp, which === 'photo' ? pg.blob : pg.thumb),
    ).then(function (got) {
      if (got === 'up') {
        pg.landed[which] = true;
        savePatch(send, pg);
      }
      return got;
    });
  }

  function finishReal(send) {
    var body = {
      submission_id: send.submission,
      files: send.pages.map(function (pg) {
        return pg.fileId;
      }),
    };
    return askRoute('send-finish', body).then(function (res) {
      if (res && res.ok === true) return handedIn(send, Date.parse(String(res.sent_at || '')) || clock());
      if (res && res.error === 'missing_pages') {
        // The server does not have these yet: they go again.
        var missing = list(res.missing);
        var at = -1;
        send.pages.forEach(function (pg, i) {
          if (missing.indexOf(pg.fileId) < 0) return;
          pg.landed = { photo: false, thumb: false };
          pg.sent = false;
          if (at < 0) at = i;
        });
        if (at >= 0) {
          savePatch(send);
          send.failed = at;
          return stop(send, 'pagefailed');
        }
      }
      return refused(send, res);
    });
  }

  function handedIn(send, at) {
    forget(send);
    send.busy = false;
    send.sentAt = at;
    send.step = 'sent';
    draw(send, '#sp-send-title');
    loadWork();
  }

  function expire(send) {
    send.request = '';
    stop(send, 'expired');
  }

  /* A start or a finish the server did not take. Words for each, mine.
     A refusal that will not change on a retry lets the device's copy go;
     the pages stay on screen until the student leaves. One that means the
     session is over is app.js's. Anything else (no answer, a server error)
     leaves the pages waiting on the device: Not Sent Yet. */
  var FOR_GOOD = {
    send_off: 'Your teacher has turned off sending work in this class.',
    not_taking_work: 'Your teacher isn’t taking work for this one.',
    already_sent: 'Your work for this one is already in.',
    nothing_sent: 'There’s nothing sent to replace. Go back and send it.',
    cannot_change: 'Your teacher added this work, so it can’t be changed here. Ask your teacher.',
    grading_started: 'Your teacher has started grading this. Ask your teacher instead.',
    class_full: 'Your class can’t take any more photos right now. Ask your teacher.',
  };
  var SESSION_OVER = { signed_out: 1, card_stopped: 1, card_expired: 1, closed: 1 };
  function refused(send, res) {
    var e = (res && res.ok === false && typeof res.error === 'string' && res.error) || 'network';
    if (has(SESSION_OVER, e)) {
      send.busy = false;
      if (typeof StudentPage.sessionRefused === 'function') StudentPage.sessionRefused({ ok: false, error: e });
      return;
    }
    if (e === 'expired') return expire(send);
    if (e === 'work_closed') {
      forget(send);
      return stop(
        send,
        'check',
        (res.closed_on ? 'This one closed ' + fmtDay(res.closed_on) + '.' : 'This one is closed.') +
          ' Hand it in on paper.',
      );
    }
    if (has(FOR_GOOD, e)) {
      forget(send);
      stop(send, 'check', FOR_GOOD[e]);
      return loadWork();
    }
    if (e === 'too_many_pages') {
      // The send keeps its place: with `room` pages left in it, the next press finishes it.
      var room = typeof res.room === 'number' && res.room >= 0 ? Math.floor(res.room) : 0;
      if (room > 0) send.room = room;
      return stop(
        send,
        'check',
        room > 0
          ? 'Only ' +
              room +
              ' ' +
              plural(room, 'page fits', 'pages fit') +
              ' with the pages your teacher added. Remove some, then send again.'
          : 'No more pages fit with the pages your teacher added. Ask your teacher.',
      );
    }
    if (e === 'too_many') {
      var mins = Math.max(1, Math.ceil((Number(res.retry_after_s) || 60) / 60));
      return stop(
        send,
        'check',
        'You’ve sent a lot this hour. Try again in ' + mins + ' ' + plural(mins, 'minute', 'minutes') + '.',
      );
    }
    if (e === 'card_locked') return stop(send, 'check', StudentPage.MESSAGES.card_locked);
    if (e === 'bad_file' || e === 'not_found') {
      // The server will not take this send as it is: the next press starts a new one.
      send.request = '';
      return stop(send, 'check', 'One of your pages couldn’t be sent. Check your pages, then send again.');
    }
    return stop(send, 'notsent');
  }

  function has(map, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  }

  // Unsend, asked of the server. The question stays up, its buttons held, until the answer.
  function unsendReal(id) {
    S.sendAsk = { kind: 'unsend', id: id, busy: true };
    StudentPage.paint('#sp-send-ask-title');
    var student = S.page.student.id;
    return askRoute('unsend', { assessment_id: id }).then(function (res) {
      if (!S || !S.page || S.page.student.id !== student) return;
      var e = res && res.ok === false && typeof res.error === 'string' ? res.error : res && res.ok ? '' : 'network';
      if (has(SESSION_OVER, e)) {
        S.sendAsk = null;
        if (typeof StudentPage.sessionRefused === 'function') StudentPage.sessionRefused({ ok: false, error: e });
        return;
      }
      if (!e) {
        S.sendAsk = null;
        return loadWork().then(function () {
          if (S && S.screen === 'assignments') StudentPage.paint('.sp-segment-on');
        });
      }
      S.sendAsk = {
        kind: 'said',
        id: id,
        title: 'Not Unsent',
        text:
          e === 'grading_started'
            ? 'Your teacher has started grading this. Ask your teacher instead.'
            : e === 'work_closed'
              ? 'This one is closed now, so it stays sent. Ask your teacher.'
              : has(FOR_GOOD, e)
                ? FOR_GOOD[e]
                : e === 'card_locked'
                  ? StudentPage.MESSAGES.card_locked
                  : 'Couldn’t reach FullVision. Check your internet and try again.',
      };
      StudentPage.paint('#sp-send-ask-title');
      if (e !== 'network' && e !== 'server') loadWork();
    });
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
    // An Unsend on its way to the server: its buttons wait for the answer.
    if (q && q.busy) return;
    S.sendAsk = null;
    if (!q || !yes || q.kind === 'said') {
      var piece = q ? '[data-piece="' + String(q.id).replace(/["\\]/g, '') + '"]' : '';
      StudentPage.paint(
        !q ? null : q.kind === 'said' ? piece + ' .sp-piece-title' : '[data-act="send-' + q.kind + '"]' + piece,
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
    if (!S.demo) return unsendReal(q.id);
    // Unsend My Revision (S11-F2): the revision goes, and the piece needs its revision again.
    var revs = p.revision && typeof StudentPage.demoRevisions === 'function' ? StudentPage.demoRevisions(S) : null;
    if (revs && revs[q.id] && revs[q.id].revision) {
      revs[q.id].revision = null;
      StudentPage.paint('.sp-segment-on');
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
    // What a real Unsend's refusal says, over the card, with one way out.
    if (p && q.kind === 'said') return sheetHtml(q.title, q.text, '', 'OK', false);
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
    // A real Unsend on its way: the same question, its buttons held until the answer.
    if (q.busy) yes = 'Unsending…';
    return sheetHtml(title, body, yes, no, q.kind === 'unsend', q.busy);
  }

  // The sheet over the card. `yes` '' draws only the way out.
  function sheetHtml(title, body, yes, no, danger, busy) {
    var held = busy ? ' disabled' : '';
    return (
      '<button type="button" class="sp-sheet-back" data-act="send-ask-no" aria-label="Close" tabindex="-1"></button>' +
      '<div class="sp-sheet sp-send-ask" role="alertdialog" aria-modal="true" aria-labelledby="sp-send-ask-title" aria-describedby="sp-send-ask-body">' +
      '<h2 class="sp-sheet-title" id="sp-send-ask-title" tabindex="-1">' +
      esc(title) +
      '</h2><p class="sp-send-ask-body" id="sp-send-ask-body">' +
      esc(body) +
      '</p><div class="sp-send-ask-buttons">' +
      (yes
        ? '<button type="button" class="sp-btn ' +
          (danger ? 'sp-btn-danger' : 'sp-btn-primary') +
          '" data-act="send-ask-yes"' +
          held +
          '>' +
          esc(yes) +
          '</button>'
        : '') +
      '<button type="button" class="sp-btn ' +
      (yes ? 'sp-btn-quiet' : 'sp-btn-primary') +
      '" data-act="send-ask-no"' +
      held +
      '>' +
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
  var PLAN_ARROW =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  function planAskHtml(send, p) {
    if (!p.plan || !p.plan.text) return '';
    return (
      '<section class="sp-send-plan" aria-labelledby="sp-send-plan-title"><h2 class="sp-plan-title" id="sp-send-plan-title">' +
      PLAN_ARROW +
      'Your Plan From Last Time</h2><p class="sp-plan-words">' +
      esc(p.plan.text) +
      '</p><h3 class="sp-send-plan-ask" id="sp-send-plan-ask">Did You Do It?</h3><div class="sp-choices" role="radiogroup" aria-label="Did you follow your plan?">' +
      Object.keys(FOLLOWED)
        .map(function (k) {
          var on = send.followed === k;
          return (
            // Yes green when chosen, as the board; Partly and Not This Time blue.
            '<button type="button" class="sp-choice' +
            (k === 'yes' ? ' sp-choice-green' : '') +
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
    var full = n >= send.room;
    return (
      head('Check and Send', p.title) +
      (late
        ? '<p class="sp-send-due">' +
          esc(
            send.revision
              ? p.revision && p.revision.reviseBy
                ? 'Revise by ' + fmtDay(p.revision.reviseBy, { weekday: 'short', month: 'short', day: 'numeric' })
                : ''
              : p.dueDate
                ? 'Due ' + fmtDay(p.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })
                : '',
          ) +
          '</p><p class="sp-send-late" role="note">This will be marked Late.</p>'
        : '') +
      (n ? pagesHtml(send, !send.busy) : '') +
      (send.busy ? '<p class="sp-send-msg" role="status">Getting your photos ready…</p>' : '') +
      (send.message ? '<p class="sp-send-msg sp-msg" role="alert">' + esc(send.message) + '</p>' : '') +
      (full
        ? '<p class="sp-send-hint">You can send ' + send.room + ' pages at most.</p>'
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
      // Leaving the student or the class: the send and its photos go. A real send's pages stay on the
      // device for the next time this class opens, until Done.
      S.send = null;
      S.sendAsk = null;
      running = {};
      if (act === 'card-done') {
        S.demoSent = {};
        letGo();
        thumbs = {};
        thumbsAsked = {};
        if (realSeen) wipeDevice();
      }
      return;
    }
    if (act === 'send-open' || act === 'revise-open') return open(attr('data-piece'), false);
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
      S.send.request = ''; // a new send, with two hours of its own
      return go(false);
    }
    if (act === 'send-drop') {
      dropPage(S.send, attr('data-page'));
      if (!S.send.pages.length) {
        if (S.send.real) forget(S.send);
        S.send.step = 'check';
        S.send.startedAt = 0;
        S.send.request = '';
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
      // A real send the student left on Not Sent Yet goes too, off screen.
      Object.keys(running).forEach(function (k) {
        var send = running[k];
        if (send !== (S && S.send) && send.step === 'notsent' && !send.busy) goReal(send);
      });
    });
  }

  StudentPage.workOf = workOf;
  StudentPage.sendDialog = dialogHtml;
  // app.js, once a real card's page for a class is drawn: ask what the class takes.
  StudentPage.pageOpened = loadWork;

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
      // A store for a real send's pages in place of IndexedDB (shared/photo-queue.js's store's shape).
      setSendStore: function (store) {
        storeFn = store;
        device = null;
      },
      loadWork: loadWork,
      HOLD_MS: HOLD_MS,
      MAX_PAGES: MAX_PAGES,
    },
  });
})();
