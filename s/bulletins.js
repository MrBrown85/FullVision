// @ts-check
/* Bulletins on the student's page (docs/plans/bulletins-plan.md, slice B1d):
   the screen. s/bulletins-view.js draws the tab; this file asks the server,
   keeps what it answered, and sends the student's two writes, Seen and a
   reaction. Everything here is behind the build switch `bulletins`
   (shared/build-flags.js): with it off nothing here asks, keeps, watches or
   draws anything, and the page is the three tabs it was.

   The routes (supabase/functions/student-submit/bulletin-routes.ts; the
   contract is migrations/local-test/bulletins-contract.md, "For B1b"), each
   through StudentPage.askClass, which adds the device's session:
     bulletins       { ok, bulletins: [...], new: [ { enrollment_id, count } ] }
     bulletin-seen   { bulletin_ids } -> { ok, seen }
     bulletin-react  { bulletin_id, word: got_it | done | question | null } -> { ok, reaction }
     bulletin-files  { bulletin_file_id } -> { ok, pages: [ { page, url } ] },
                     links signed for 60 seconds
   Only the keys named here are read from an answer: one the page does not
   know is left where it is. A time is parsed before it is compared (the
   server writes its own offset).

   When it asks `bulletins` (the plan, "How it is built"): with `page` when
   a class opens (s/app.js openPage, bulletinsWith), waited for one second
   at most; when the Bulletins tab is pressed and what is here is over 20
   seconds old (Reflect's rule); when the student comes back to this browser
   tab while Bulletins shows; and every 30 seconds while Bulletins is the tab
   showing in a browser tab someone is looking at. Never in Demo Mode, whose
   answers come from this device (StudentData.demoBulletins, read only, or
   the board's samples).

   Until the server has the route, the page offers nothing (plan rule 7): an
   answer that is not a list (an unknown route's bad_request, a 404, a 500,
   no answer) leaves the page with no Bulletins tab. A refusal that says the
   session or the class is over is the page's own (StudentPage.sessionRefused).

   Seen is s/seen-watch.js's rule, the one returned work uses: a bulletin the
   server said this student has not seen (seen_at null), on screen in a tab
   someone is looking at, for a moment; sent once, never empty, never on a
   timer, never from the preview (which does not load this file) nor in
   Demo Mode to any server. A Seen or a reaction that does not land (no
   connection, a 500, too many this hour) is kept and sent again at the next
   natural moment: the next answer to `bulletins`, the next Seen, or the
   browser coming back online. Nothing is ever shown about it: no banner, no
   message (CLAUDE.md rule 5). Nothing here is a grade. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var FRESH_MS = 20000; // the tab pressed: asked again when what is here is older
  var EVERY_MS = 30000; // while the tab is showing
  var BACK_MS = 5000; // the browser tab shown again: asked again when older
  var WAIT_MS = 1000; // how long a class's first draw waits for `bulletins` after `page`
  var LINK_FRESH = 45000; // a file's links last 60 seconds; asked again after this
  var MAX_SEEN = 100;
  var SESSION_OVER = { signed_out: 1, card_stopped: 1, card_expired: 1, closed: 1 };
  var WORD_IDS = { got_it: 1, done: 1, question: 1 };
  var UUIDISH = /^[A-Za-z0-9-]{1,64}$/;

  var S = null; // the page's state (student.js)
  var B = null; // what is held for the class open; see blank()
  var asked = 0; // each `bulletins` ask, so an older answer never replaces a newer one
  var ticking = 0;
  var answerFn = null; // tests answer the routes themselves
  var watcher = null; // StudentSeenWatch's, on the Bulletins tab
  var demoMemory = { seen: {}, reactions: {} }; // Demo Mode's Seen and reactions: this tab's memory only

  function on() {
    return typeof BuildFlags !== 'undefined' && BuildFlags.on('bulletins');
  }
  function has(map, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key);
  }
  function tabHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /* What is held for one student's class: state '' (asking), 'ok' or
     'missing' (no tab); list, the bulletins as last answered; fresh, the ids
     not seen when the class was opened (the New line); told, the ids whose
     Seen has been sent; retry, ones to send again; want, a reaction chosen
     and not yet landed; news, "2 new" by class; pictures and links, a file's
     pages on this device; drawn, the ids drawn on the tab (a new one glides
     in). */
  function blank(student) {
    return {
      student: student,
      state: '',
      list: [],
      fresh: {},
      told: {},
      retry: {},
      want: {},
      sending: {},
      news: {},
      at: 0,
      error: '',
      pictures: {},
      links: {},
      urls: [],
      drawn: null,
    };
  }

  function letGo(b) {
    if (!b) return;
    b.urls.forEach(function (u) {
      try {
        URL.revokeObjectURL(u);
      } catch (e) {
        /* already gone */
      }
    });
    b.urls = [];
  }
  function forget() {
    if (watcher) watcher.stop();
    watcher = null;
    letGo(B);
    B = null;
    if (typeof WebsiteAsk !== 'undefined') WebsiteAsk.close();
  }

  /* ── Demo Mode: answered on this device ────────────────────── */

  function isoAt(daysBack, hour, minute) {
    var d = new Date();
    d.setDate(d.getDate() - daysBack);
    d.setHours(hour, minute, 0, 0);
    // Never in the future: a sample "today at 10:15" read at 8 a.m. is five minutes ago.
    return new Date(Math.min(d.getTime(), Date.now() - 5 * 60000)).toISOString();
  }
  function isoDay(ahead) {
    var d = new Date();
    d.setDate(d.getDate() + ahead);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }
  function sample(n, more) {
    return Object.assign(
      {
        id: 'demo-bulletin-' + n,
        kind: 'announcement',
        body: '',
        link_url: null,
        link_title: null,
        pinned: false,
        pinned_until: null,
        assessment_id: null,
        reactions_on: false,
        edited_at: null,
        files: [],
        seen_at: null,
        reaction: null,
      },
      more,
    );
  }
  /* The board's samples (C1, C2), for the sample class when the teacher's Demo
     Mode has written none on this device: a reminder linked to the Science
     Fair Proposal, a link, a photo of the board and a reading with
     Reactions, the last two not seen yet. */
  function demoSamples() {
    return [
      sample(1, {
        kind: 'reminder',
        body: 'Science Fair Proposal is due on Saturday. Bring the question you want to test.',
        pinned: true,
        pinned_until: isoDay(4),
        assessment_id: 'demo-fair',
        posted_at: isoAt(2, 8, 42),
        seen_at: isoAt(2, 9, 0),
      }),
      sample(2, {
        body: 'Watch the first 6 minutes before class tomorrow. We’ll use it to start the cell model.',
        link_url: 'https://www.youtube.com/watch?v=inside-a-cell',
        link_title: 'Inside a Cell (video)',
        posted_at: isoAt(1, 14, 30),
        seen_at: isoAt(1, 15, 0),
      }),
      sample(3, {
        files: [
          {
            id: 'demo-bulletin-file-board',
            kind: 'photo',
            title: 'Photo',
            page_count: 1,
            position: 1,
            paths: ['/assets/sample-bulletins/cell-board-1.svg'],
          },
        ],
        posted_at: isoAt(0, 9, 58),
      }),
      sample(4, {
        body: 'Read the Cell Theory pages before Thursday’s lab. Bring one question.',
        reactions_on: true,
        files: [
          {
            id: 'demo-bulletin-file-reading',
            kind: 'pdf',
            title: 'Cell Theory Reading',
            page_count: 2,
            position: 1,
            paths: ['/assets/sample-bulletins/cell-theory-1.svg', '/assets/sample-bulletins/cell-theory-2.svg'],
          },
        ],
        posted_at: isoAt(0, 10, 15),
      }),
    ];
  }
  // The sample class's bulletins (the second sample class has none, so it opens on Assignments).
  function demoList(student) {
    if (student !== 'demo-cece') return [];
    var kept = null;
    try {
      kept =
        typeof StudentData !== 'undefined' && StudentData.demoBulletins
          ? StudentData.demoBulletins(localStorage)
          : null;
    } catch (e) {
      kept = null;
    }
    return (kept && kept.length ? kept : demoSamples()).map(function (b) {
      var out = Object.assign({}, b);
      if (has(demoMemory.seen, b.id)) out.seen_at = demoMemory.seen[b.id];
      if (has(demoMemory.reactions, b.id)) out.reaction = demoMemory.reactions[b.id];
      return out;
    });
  }
  function demoFile(student, fid) {
    var f = null;
    demoList(student).forEach(function (b) {
      (b.files || []).forEach(function (x) {
        if (x.id === fid) f = x;
      });
    });
    return f;
  }
  function demoAnswer(route, body, student) {
    if (route === 'bulletins') {
      var list = demoList(student);
      var count = list.filter(function (b) {
        return !b.seen_at;
      }).length;
      return { ok: true, bulletins: list, new: [{ enrollment_id: student, count: count }] };
    }
    if (route === 'bulletin-seen') {
      (body.bulletin_ids || []).forEach(function (id) {
        if (!has(demoMemory.seen, id)) demoMemory.seen[id] = new Date().toISOString();
      });
      return { ok: true, seen: (body.bulletin_ids || []).length };
    }
    if (route === 'bulletin-react') {
      demoMemory.reactions[body.bulletin_id] = body.word;
      return { ok: true, reaction: body.word };
    }
    return { ok: false, error: 'not_found' };
  }

  /* ── Asking ────────────────────────────────────────────────── */

  function askRoute(route, body, student) {
    if (answerFn) return Promise.resolve(answerFn(route, body)).then(null, network);
    if (!S || S.demo)
      return Promise.resolve(S && S.demo ? demoAnswer(route, body, student) : { ok: false, error: 'signed_out' });
    return Promise.resolve(StudentPage.askClass(route, body, student)).then(null, network);
  }
  function network() {
    return { ok: false, error: 'network' };
  }
  function errorOf(res) {
    return res && res.ok === false && typeof res.error === 'string' ? res.error : 'network';
  }

  function text(v, max) {
    return typeof v === 'string' ? v.slice(0, max) : '';
  }
  function timeOk(v) {
    return typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v));
  }
  // One file, from the keys the contract names.
  function readFile(f) {
    if (!f || typeof f !== 'object' || typeof f.id !== 'string' || !UUIDISH.test(f.id)) return null;
    var n = Number(f.page_count);
    return {
      id: f.id,
      kind: f.kind === 'pdf' ? 'pdf' : 'photo',
      title: text(f.title, 200),
      page_count: n >= 1 && n <= 20 && Math.floor(n) === n ? n : 1,
      position: Number(f.position) || 0,
      // Demo Mode's pictures only; a server's answer has no paths.
      paths: S && S.demo && Array.isArray(f.paths) ? f.paths.map(String) : [],
    };
  }
  /* One bulletin, from the keys the contract names and no others. A kind this
     page does not draw yet (a poll, a whiteboard: later stages) is left out. */
  function readBulletin(x) {
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !UUIDISH.test(x.id)) return null;
    if (x.kind !== 'announcement' && x.kind !== 'reminder') return null;
    if (!timeOk(x.posted_at)) return null;
    return {
      id: x.id,
      kind: x.kind,
      body: text(x.body, 2000),
      link_url: text(x.link_url, 2000) || null,
      link_title: text(x.link_title, 200) || null,
      pinned: x.pinned === true,
      pinned_until: /^\d{4}-\d{2}-\d{2}$/.test(String(x.pinned_until || '')) ? x.pinned_until : null,
      assessment_id: typeof x.assessment_id === 'string' && UUIDISH.test(x.assessment_id) ? x.assessment_id : null,
      reactions_on: x.reactions_on === true,
      posted_at: x.posted_at,
      edited_at: timeOk(x.edited_at) ? x.edited_at : null,
      files: (Array.isArray(x.files) ? x.files : [])
        .map(readFile)
        .filter(Boolean)
        .sort(function (a, b) {
          return a.position - b.position;
        })
        .slice(0, 20),
      seen_at: timeOk(x.seen_at) ? x.seen_at : null,
      reaction: has(WORD_IDS, x.reaction) ? x.reaction : null,
    };
  }

  // Where the student is: the class open, for the student `student`.
  function forThis(student) {
    return !!S && !!B && B.student === student && (!S.page || S.page.student.id === student);
  }

  /* An answer to `bulletins` for `student`, kept. The list as the server
     orders it (oldest first; one shown again and not seen sits at the end). */
  function apply(student, res) {
    if (!forThis(student)) return;
    if (!(res && res.ok === true && Array.isArray(res.bulletins))) {
      var e = errorOf(res);
      if (
        has(SESSION_OVER, e) &&
        S.page &&
        S.screen === 'assignments' &&
        typeof StudentPage.sessionRefused === 'function'
      ) {
        StudentPage.sessionRefused({ ok: false, error: e });
        return;
      }
      // No list yet: the page offers nothing. A list already here stays as it was, quietly.
      if (B.state !== 'ok') {
        B.state = 'missing';
        B.error = e;
      }
      return;
    }
    var list = res.bulletins.slice(0, 100).map(readBulletin).filter(Boolean);
    var wanted = {};
    list.forEach(function (b) {
      if (!b.seen_at) B.fresh[b.id] = true;
      b.seen = !!b.seen_at || has(B.told, b.id);
      b.fresh = has(B.fresh, b.id);
      b.server = b.reaction;
      if (has(B.want, b.id)) b.reaction = B.want[b.id];
      wanted[b.id] = b;
    });
    // A Seen to send again for a bulletin gone (deleted) or seen by now is let go.
    Object.keys(B.retry).forEach(function (id) {
      if (!wanted[id] || wanted[id].seen_at) delete B.retry[id];
    });
    Object.keys(B.want).forEach(function (id) {
      if (!wanted[id] || !wanted[id].reactions_on) delete B.want[id];
    });
    var news = {};
    (Array.isArray(res.new) ? res.new : []).forEach(function (n) {
      var c = n && Number(n.count);
      if (n && typeof n.enrollment_id === 'string' && c >= 0 && Math.floor(c) === c) news[n.enrollment_id] = c;
    });
    var before = signature();
    B.list = list;
    B.news = news;
    B.state = 'ok';
    B.at = Date.now();
    if (S.page && signature() !== before) redraw();
    // The next natural moment for what did not land.
    sendSeen([]);
    Object.keys(B.want).forEach(sendReaction);
  }

  // What the tab draws from, as a string: drawn again only when it changes.
  function signature() {
    return JSON.stringify([
      B.list.map(function (b) {
        return [
          b.id,
          b.body,
          b.link_url,
          b.link_title,
          b.pinned,
          b.pinned_until,
          b.assessment_id,
          b.reactions_on,
          b.edited_at,
          b.files.length,
          b.seen,
          b.reaction,
        ];
      }),
      B.news,
    ]);
  }

  // Ask `bulletins` for `student`; resolves once it is answered and kept.
  function read(student) {
    var mine = ++asked;
    if (B && B.student === student) B.at = Date.now();
    startTicking();
    return askRoute('bulletins', {}, student).then(function (res) {
      if (mine !== asked) return;
      apply(student, res);
    });
  }

  function startTicking() {
    if (ticking || (S && S.demo) || typeof setInterval !== 'function') return;
    ticking = setInterval(function () {
      if (showing() && !tabHidden() && !S.demo) read(S.page.student.id);
    }, EVERY_MS);
  }

  // Bulletins is the tab on screen.
  function showing() {
    return on() && !!S && !!S.page && S.screen === 'assignments' && S.tab === 'bulletins' && !!B && B.state === 'ok';
  }

  /* ── The page drawn again ──────────────────────────────────── */

  // Drawn again where the student is, the keyboard kept where it was.
  function redraw() {
    if (!S || S.screen !== 'assignments' || S.sendAsk || S.settings || S.logout || typeof document === 'undefined')
      return;
    var el = document.activeElement;
    var sel = '';
    if (el && el.getAttribute && el.getAttribute('data-act')) {
      var keys = ['data-act', 'data-tab', 'data-bulletin', 'data-word', 'data-file', 'data-page', 'data-piece'];
      sel = keys
        .filter(function (k) {
          return el.getAttribute(k) != null;
        })
        .map(function (k) {
          return '[' + k + '="' + String(el.getAttribute(k)).replace(/["\\]/g, '') + '"]';
        })
        .join('');
    }
    StudentPage.paint();
    var back = sel ? document.querySelector('#app ' + sel) : null;
    if (back && back.focus) back.focus({ preventScroll: true });
  }

  /* The red counts on screen, put right in place after a Seen (no redraw,
     so nothing under the student's finger moves). */
  function recount() {
    if (typeof document === 'undefined' || !B) return;
    var n = B.list.filter(function (b) {
      return !b.seen;
    }).length;
    Array.prototype.forEach.call(document.querySelectorAll('#app .sp-tab[data-tab="bulletins"]'), function (tab) {
      var badge = tab.querySelector('.sp-tab-badge');
      var words = tab.querySelector('.sp-hidden-title');
      if (n) {
        if (badge) badge.textContent = String(n);
        if (words) words.textContent = n + ' new';
      } else {
        if (badge) badge.remove();
        if (words) words.remove();
      }
    });
  }

  /* The Bulletins tab opens at its New line, or at the newest bulletin when
     nothing is new: the New line just under the header, or the foot of the
     feed. */
  function place() {
    if (!showing() || typeof document === 'undefined' || S.bulletinFile) return;
    var line = document.getElementById('sp-bulletin-new');
    var head = document.querySelector('#app .sp-head');
    var bar = document.querySelector('#app .sp-bulletin-pinbar');
    if (line && typeof line.getBoundingClientRect === 'function') {
      var top = line.getBoundingClientRect().top;
      var under =
        (head && head.getBoundingClientRect ? head.getBoundingClientRect().bottom : 0) +
        (bar ? bar.getBoundingClientRect().height : 0);
      if (typeof window.scrollBy === 'function') window.scrollBy(0, top - under - 8);
      return;
    }
    var root = document.scrollingElement || document.documentElement;
    if (root && typeof window.scrollTo === 'function') window.scrollTo(0, root.scrollHeight || 0);
  }

  /* ── Seen ──────────────────────────────────────────────────── */

  function watch() {
    if (watcher) watcher.stop();
    watcher = null;
    if (!showing() || S.bulletinFile || typeof StudentSeenWatch === 'undefined') return;
    var state = S;
    var page = S.page;
    var held = B;
    watcher = StudentSeenWatch.watch({
      attr: 'data-bulletin-unseen',
      max: MAX_SEEN,
      live: function () {
        return S === state && S.page === page && B === held && showing() && !S.bulletinFile;
      },
      ready: function () {
        return S === state && S.page === page && B === held;
      },
      // Only bulletins the server said this student has not seen, each once.
      unseen: function () {
        return held.list
          .filter(function (b) {
            return !b.seen_at && !has(held.told, b.id);
          })
          .map(function (b) {
            return b.id;
          });
      },
      mark: function (ids) {
        ids.forEach(function (id) {
          held.told[id] = true;
        });
        held.list.forEach(function (b) {
          if (ids.indexOf(b.id) >= 0) b.seen = true;
        });
        recount();
      },
      send: sendSeen,
    });
  }

  /* Tells the server which bulletins were seen, with any that did not land
     before. Never an empty call: each one spends one of the student's writes. */
  function sendSeen(ids) {
    var held = B;
    if (!held || held.state !== 'ok') return Promise.resolve();
    var all = (ids || []).concat(Object.keys(held.retry)).filter(function (id, i, list) {
      return list.indexOf(id) === i;
    });
    all = all.slice(0, MAX_SEEN);
    if (!all.length) return Promise.resolve();
    all.forEach(function (id) {
      delete held.retry[id];
      held.sending[id] = true;
    });
    return askRoute('bulletin-seen', { bulletin_ids: all }, held.student).then(function (res) {
      all.forEach(function (id) {
        delete held.sending[id];
      });
      if (B !== held) return;
      if (res && res.ok === true) return;
      var e = errorOf(res);
      if (has(SESSION_OVER, e) && S && S.page && typeof StudentPage.sessionRefused === 'function') {
        StudentPage.sessionRefused({ ok: false, error: e });
        return;
      }
      // A request the server could not read is not sent again; anything else is, later.
      if (e === 'bad_request' || e === 'other_student') return;
      all.forEach(function (id) {
        held.retry[id] = true;
      });
    });
  }

  /* ── Reactions ─────────────────────────────────────────────── */

  // The group's buttons put right in place, as the student chose.
  function showReaction(b) {
    if (typeof document === 'undefined') return;
    var sel = '#app .sp-bulletin-react[data-bulletin="' + String(b.id).replace(/["\\]/g, '') + '"]';
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (btn) {
      var mine = btn.getAttribute('data-word') === b.reaction;
      btn.setAttribute('aria-pressed', mine ? 'true' : 'false');
      btn.classList.toggle('sp-bulletin-react-on', mine);
    });
  }

  function react(el) {
    if (!showing()) return;
    var id = (el && el.getAttribute('data-bulletin')) || '';
    var word = (el && el.getAttribute('data-word')) || '';
    var b = B.list.filter(function (x) {
      return x.id === id;
    })[0];
    if (!b || !b.reactions_on || !has(WORD_IDS, word)) return;
    // One tap chooses it; a tap on the one chosen takes it back.
    b.reaction = b.reaction === word ? null : word;
    B.want[id] = b.reaction;
    showReaction(b);
    sendReaction(id);
  }

  function sendReaction(id) {
    var held = B;
    if (!held || !has(held.want, id) || held.sending['r:' + id]) return;
    var word = held.want[id];
    held.sending['r:' + id] = true;
    askRoute('bulletin-react', { bulletin_id: id, word: word }, held.student).then(function (res) {
      delete held.sending['r:' + id];
      if (B !== held) return;
      var b = held.list.filter(function (x) {
        return x.id === id;
      })[0];
      if (res && res.ok === true) {
        var landed = has(WORD_IDS, res.reaction) ? res.reaction : null;
        if (b) b.server = landed;
        // Changed again while this one was on its way: the newest is sent.
        if (held.want[id] !== word) return sendReaction(id);
        delete held.want[id];
        if (b && b.reaction !== landed) {
          b.reaction = landed;
          showReaction(b);
        }
        return;
      }
      var e = errorOf(res);
      if (has(SESSION_OVER, e) && S && S.page && typeof StudentPage.sessionRefused === 'function') {
        StudentPage.sessionRefused({ ok: false, error: e });
        return;
      }
      // Reactions turned off, the bulletin gone, a word not taken: back to what the server holds.
      if (e === 'reactions_off' || e === 'not_found' || e === 'bad_request' || e === 'other_student') {
        delete held.want[id];
        if (b) {
          b.reaction = b.server || null;
          showReaction(b);
        }
      }
      // Anything else (no connection, a 500, too many this hour): kept, and sent again later.
    });
  }

  /* ── A file's pages ────────────────────────────────────────── */

  function fileOf(fid) {
    var f = null;
    (B ? B.list : []).forEach(function (b) {
      (b.files || []).forEach(function (x) {
        if (x.id === fid) f = x;
      });
    });
    return f;
  }

  // A file's links, by page: the ones here while fresh, or asked again.
  function linksOf(fid, again) {
    var held = B;
    var k = held.links[fid] || (held.links[fid] = { urls: null, at: 0, asking: null });
    if (!again && k.urls && Date.now() - k.at < LINK_FRESH) return Promise.resolve(k.urls);
    if (k.asking) return k.asking;
    k.asking = askRoute('bulletin-files', { bulletin_file_id: fid }, held.student).then(function (res) {
      k.asking = null;
      if (!(res && res.ok === true && Array.isArray(res.pages))) return null;
      var urls = [];
      res.pages.forEach(function (pg) {
        var n = pg && Number(pg.page);
        if (n >= 1 && n <= 20 && typeof pg.url === 'string' && /^https:\/\//.test(pg.url)) urls[n - 1] = pg.url;
      });
      k.urls = urls;
      k.at = Date.now();
      return urls;
    });
    return k.asking;
  }

  // A page's picture from its link, or null. The link carries its own key: nothing else is sent.
  function picture(url) {
    if (typeof fetch !== 'function' || !url) return Promise.resolve(null);
    return fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }).then(
      function (res) {
        return res && res.ok ? res.blob() : null;
      },
      function () {
        return null;
      },
    );
  }

  function keep(held, fid, i, url) {
    (held.pictures[fid] || (held.pictures[fid] = []))[i] = url;
    return url;
  }

  /* Page i (from 0) of file `fid`: its address on this device, or '' when it
     did not come. Demo Mode's are the site's own pictures. A link that has
     run out is asked for again, once. */
  function load(fid, i) {
    var held = B;
    if (!held || held.state !== 'ok') return Promise.resolve('');
    var have = held.pictures[fid] && held.pictures[fid][i];
    if (have) return Promise.resolve(have);
    var f = fileOf(fid);
    if (!f || i < 0 || i >= f.page_count) return Promise.resolve('');
    if (S && S.demo) {
      var path = (demoFile(held.student, fid) || f).paths[i] || '';
      return Promise.resolve(StudentBulletinsView.PAGE_URL.test(path) ? keep(held, fid, i, path) : '');
    }
    return linksOf(fid, false)
      .then(function (urls) {
        if (!urls || !urls[i]) return null;
        return picture(urls[i]).then(function (blob) {
          if (blob || B !== held) return blob;
          return linksOf(fid, true).then(function (again) {
            return again && again[i] ? picture(again[i]) : null;
          });
        });
      })
      .then(function (blob) {
        if (!blob || B !== held || typeof URL === 'undefined' || !URL.createObjectURL) return '';
        // Always a picture: what comes back is shown in an <img> and nothing else.
        var url = URL.createObjectURL(new Blob([blob], { type: 'image/jpeg' }));
        held.urls.push(url);
        return keep(held, fid, i, url);
      });
  }

  var source = {
    known: function (fid, i) {
      var p = B && B.pictures[fid];
      return (p && p[i]) || '';
    },
    load: load,
  };

  // The page open full size: its picture, drawn once it is here.
  function fillViewer() {
    if (!showing() || !S.bulletinFile || typeof document === 'undefined') return;
    if (document.querySelector('#app .sp-bulletin-viewer-img')) return;
    var fid = S.bulletinFile;
    var page = Number(S.bulletinPage) || 0;
    load(fid, page).then(function (url) {
      if (url && showing() && S.bulletinFile === fid && Number(S.bulletinPage) === page) {
        StudentPage.paint('#sp-bulletin-viewer-title');
      }
    });
  }

  /* ── A link ────────────────────────────────────────────────── */

  /* The card asks before anything opens (shared/website-ask.js), over the
     page, in the half of the screen away from the card that was tapped, so
     Open Website is never under the finger that opened the question. */
  function askLink(el) {
    if (!showing() || typeof WebsiteAsk === 'undefined' || typeof StudentBulletinsView === 'undefined') return;
    var id = (el && el.getAttribute('data-bulletin')) || '';
    var b = B.list.filter(function (x) {
      return x.id === id;
    })[0];
    var l = b && b.link_url ? StudentBulletinsView.linkOf(b.link_url) : null;
    if (!l) return;
    var r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    var mid = r ? r.top + r.height / 2 : 0;
    var h = typeof window.innerHeight === 'number' ? window.innerHeight : 0;
    WebsiteAsk.open({
      host: document.body,
      url: l.href,
      cls: 'sp-bulletin-ask',
      backdrop: true,
      cancelFirst: true,
      focus: 'no',
      place: h && mid > h / 2 ? 'top' : 'bottom',
      returnTo: el,
    });
  }

  /* ── The page's hooks ──────────────────────────────────────── */

  /* s/app.js openPage: `bulletins` asked beside `page`, and the page's first
     draw waits for it one second at most after `page` has answered. Off,
     the page's own ask is handed back as it came. */
  StudentPage.bulletinsWith = function (mine, pageAsked) {
    if (!on() || !mine || !mine.enrollment) return pageAsked;
    forget();
    B = blank(mine.enrollment);
    var got = read(mine.enrollment);
    return StudentPage.whileCurrent(
      Promise.resolve(pageAsked).then(function (res) {
        return new Promise(function (done) {
          var t = setTimeout(function () {
            done(res);
          }, WAIT_MS);
          got.then(function () {
            clearTimeout(t);
            done(res);
          });
        });
      }),
    );
  };

  /* The opening rule (the plan's, and the board's C1 and C3). Asked once, by
     s/app.js, when a class is opened afresh, before its first draw: a class
     with a bulletin opens on Bulletins; a class with none, or whose answer
     has not come (or never will), on Assignments exactly as before. An
     answer that comes after this never moves the tab: the student may
     already be touching the page. Coming back to an open class keeps the tab
     (app.js never asks again then). */
  StudentPage.openingTab = function (student) {
    return on() && B && B.student === student && B.state === 'ok' && B.list.length ? 'bulletins' : 'assignments';
  };

  // s/app.js, once the class's page is drawn: Bulletins opens at its New line.
  StudentPage.bulletinsPlace = function () {
    if (showing()) place();
  };

  // What s/bulletins-view.js draws from (s/assignments.js puts it on the view), or null: no tab.
  StudentPage.bulletinsOf = function (state) {
    if (!on() || !state || !state.page || !B || B.student !== state.page.student.id || B.state !== 'ok') return null;
    var drawn = B.drawn;
    return {
      list: B.list.map(function (b) {
        return Object.assign({}, b, { glide: !!drawn && !has(drawn, b.id) });
      }),
      pictures: B.pictures,
      now: Date.now(),
      preview: false,
    };
  };

  // "2 new" beside each class in Switch Class: the server's count, this class's as it stands here.
  StudentPage.bulletinNews = function (state) {
    if (!StudentPage.bulletinsOf(state)) return null;
    var out = Object.assign({}, B.news);
    out[B.student] = B.list.filter(function (b) {
      return !b.seen;
    }).length;
    return out;
  };

  function onClick(act, el) {
    if (!S) return;
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') return forget();
    if (!on()) return;
    if (act === 'bulletin-link') return askLink(el);
    if (act === 'bulletin-react') return react(el);
    if (act === 'tab' && showing()) {
      // Bulletins pressed (app.js has drawn it): asked again when what is here is old; opened at the New line.
      if (Date.now() - B.at >= FRESH_MS && !S.demo) read(B.student);
      place();
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible' || !showing() || S.demo) return;
      if (Date.now() - B.at >= BACK_MS) read(B.student);
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', function () {
      if (!B || B.state !== 'ok' || !on()) return;
      sendSeen([]);
      Object.keys(B.want).forEach(sendReaction);
    });
  }

  StudentPage.addScreens({
    file: 'bulletins',
    render: {},
    click: onClick,
    // Once the page is drawn: on the Bulletins tab, the strips are wired and what is on screen is watched.
    drawn: function (root, state) {
      if (!on()) return;
      if (!showing() || state !== S) {
        if (watcher) watcher.stop();
        watcher = null;
        return;
      }
      if (!B.drawn) B.drawn = {};
      B.list.forEach(function (b) {
        B.drawn[b.id] = true;
      });
      if (typeof StudentBulletinsView !== 'undefined') StudentBulletinsView.attach(root, source);
      watch();
      fillViewer();
    },
    share: function (state) {
      // A new state is a sign-out: the last student's bulletins go with it.
      if (state !== S) forget();
      S = state;
    },
    test: {
      bulletins: function () {
        return B;
      },
      bulletinSource: source,
      // Tests answer the bulletin routes themselves; null puts the real ones back.
      setBulletinAnswer: function (fn) {
        answerFn = fn;
      },
      tellBulletinsSeen: function () {
        return watcher ? watcher.tell() : Promise.resolve();
      },
    },
  });
})();
