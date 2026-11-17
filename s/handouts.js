/* A teacher's handout, opened on the student's page (Handouts and Links;
   the board "What the Student Sees (Phone)").

   The card's For This Assignment (s/page-view.js) lists the piece's
   handout and links. A link opens in a new tab and needs nothing here. The
   handout opens in the page, one page at a time, as See Your Work does
   (s/feedback.js): app.js has already opened it (StudentPageView.press);
   this file fetches its pages.

   A real card asks `handout-links` (supabase/functions/student-submit/
   handout-routes.ts, student_submit.handout_links) through
   StudentPage.askClass, which adds the device's session: { ok, pages: [ {
   page, url } ] }, each url a link signed for 60 seconds. Each page is
   fetched at once and shown from a blob: address (the Content Security
   Policy allows blob: and not the storage host); the addresses are let go
   on Log Out, another class or another card. Demo Mode's sample handout
   (Disease Research Poster's Poster Checklist) is the site's own pictures,
   so it asks nothing.

   Every answer is checked against the screen that asked before it draws:
   the handout must still be open, for the same student, from the same ask. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var S = null; // the page's state (student.js)
  var asked = 0; // each fetch, so an older answer never draws over a newer one
  var urls = []; // blob: addresses made here
  var answerFn = null; // tests answer the route themselves

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

  function objectUrl(blob) {
    try {
      var u = blob && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : '';
      if (u) urls.push(u);
      return u;
    } catch (e) {
      return '';
    }
  }

  // One page's picture from its link, or null. The link carries its own key: nothing else is sent.
  function picture(url) {
    if (typeof fetch !== 'function' || !/^https:\/\//.test(String(url || ''))) return Promise.resolve(null);
    return fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }).then(
      function (res) {
        return res && res.ok ? res.blob() : null;
      },
      function () {
        return null;
      },
    );
  }

  function answerOf(body) {
    if (answerFn) return Promise.resolve(answerFn('handout-links', body));
    if (!S || S.demo || typeof StudentPage.askClass !== 'function') {
      return Promise.resolve({ ok: false, error: 'not_found' });
    }
    return Promise.resolve(StudentPage.askClass('handout-links', body, body.enrollment_id)).then(null, function () {
      return { ok: false, error: 'network' };
    });
  }

  /* Fast (Colin, 2026-11-16: "it should be extremely fast and snappy").
     A handout's pages are kept for the session once fetched, so opening it
     again is instant; its first page shows as soon as it lands, the rest
     filling in behind it; and once the page is up, the handouts on the
     student's Outstanding and Upcoming cards are fetched ahead (up to
     WARM_MAX), so a tap usually finds them here. kept: resource id →
     { student, state: 'loading' | 'ready' | 'failed', pages: [ { url } ],
     done }. */
  var kept = {};
  var WARM_MAX = 4;

  // Demo Mode's sample handout: its pages are the site's own pictures.
  var DEMO_PAGES = {
    'demo-res-checklist': [
      '../assets/sample-handouts/poster-checklist-1.jpg',
      '../assets/sample-handouts/poster-checklist-2.jpg',
    ],
  };

  // Is the handout still open on resource `id`, for this student?
  function showing(id, student) {
    return !!S && S.screen === 'assignments' && S.handout === id && !!S.page && S.page.student.id === student;
  }

  // The open handout drawn from what is kept: a page that landed shows at once.
  function show(id, student) {
    var k = kept[id];
    if (!k || !showing(id, student)) return;
    var first = k.pages[0] && k.pages[0].url;
    var state = k.state === 'failed' ? 'failed' : first || k.done ? 'ready' : 'loading';
    var had = S.handoutPages;
    S.handoutPages = { id: id, state: state, pages: k.pages.slice(), asked: asked };
    // Drawn again only when what shows changes, so the keyboard stays where it is.
    if (!had || had.id !== id || had.state !== state || state === 'ready') StudentPage.paint('#sp-handout-title');
  }

  /* Fetch handout `id` into kept (or reuse it). `open`: the student is
     looking at it, so each page that lands is drawn. */
  function fetchHandout(id, piece, student, open) {
    var k = kept[id];
    if (k && k.student === student && k.state !== 'failed') {
      if (open) show(id, student);
      return;
    }
    if (S.demo) {
      var demoPages = DEMO_PAGES[id] || [];
      kept[id] = {
        student: student,
        state: demoPages.length ? 'ready' : 'failed',
        pages: demoPages.map(function (u) {
          return { url: u };
        }),
        done: true,
      };
      if (open) show(id, student);
      return;
    }
    k = kept[id] = { student: student, state: 'loading', pages: [], done: false };
    if (open) show(id, student);
    var body = { enrollment_id: student, assessment_id: piece, resource_id: id };
    StudentPage.whileCurrent(answerOf(body)).then(function (res) {
      if (kept[id] !== k) return;
      var list =
        res && res.ok === true && Array.isArray(res.pages)
          ? res.pages
              .filter(function (pg) {
                return pg && typeof pg.url === 'string';
              })
              .slice(0, 20)
              .sort(function (x, y) {
                return (Number(x.page) || 0) - (Number(y.page) || 0);
              })
          : null;
      if (!list || !list.length) {
        k.state = 'failed';
        k.done = true;
        if (showing(id, student)) show(id, student);
        return;
      }
      k.pages = list.map(function () {
        return { url: '' };
      });
      var left = list.length;
      var got = 0;
      list.forEach(function (pg, i) {
        picture(pg.url).then(function (blob) {
          if (kept[id] !== k) return;
          var u = blob ? objectUrl(new Blob([blob], { type: 'image/jpeg' })) : '';
          if (u) {
            k.pages[i] = { url: u };
            got += 1;
          }
          left -= 1;
          if (!left) {
            k.done = true;
            k.state = got ? 'ready' : 'failed';
          } else if (got) {
            k.state = 'ready';
          }
          if (showing(id, student)) show(id, student);
        });
      });
    });
  }

  function load(id, piece) {
    if (!S || !S.page || !id) return;
    asked += 1;
    var student = S.page.student.id;
    // Try Again starts over.
    if (kept[id] && kept[id].state === 'failed') delete kept[id];
    S.handoutPages = { id: id, state: 'loading', pages: [], asked: asked };
    fetchHandout(id, piece, student, true);
    if (S.handoutPages && S.handoutPages.state === 'loading') StudentPage.paint('#sp-handout-title');
  }

  // The handouts on the student's cards still to do, fetched ahead (a real card; Demo Mode's are on the device).
  function warm() {
    if (!S || !S.page || S.demo || typeof StudentPage.viewOf !== 'function') return;
    var view = StudentPage.viewOf(S);
    if (!view) return;
    var student = S.page.student.id;
    var n = 0;
    view.work.forEach(function (p) {
      if (!/^(due|missing|revise)$/.test(p.kind)) return;
      (p.resources || []).forEach(function (r) {
        if (r.kind !== 'handout' || n >= WARM_MAX || kept[r.id]) return;
        n += 1;
        fetchHandout(r.id, p.id, student, false);
      });
    });
  }
  StudentPage.warmHandouts = warm;

  // Everything kept goes: a sign-out, another class or another card.
  function forgetAll() {
    kept = {};
    letGo();
  }

  function onClick(act, el) {
    if (!S) return;
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') {
      S.handout = '';
      S.handoutPiece = '';
      S.handoutPages = null;
      forgetAll();
      return;
    }
    // app.js has opened the handout (StudentPageView.press); its pages come from what is kept, or are fetched.
    if (act === 'handout' && S.handout) return load(S.handout, S.handoutPiece);
    if (act === 'handout-retry' && S.handout && S.handout === ((el && el.getAttribute('data-resource')) || '')) {
      return load(S.handout, S.handoutPiece);
    }
  }

  StudentPage.addScreens({
    file: 'handouts',
    render: {},
    click: onClick,
    share: function (state) {
      // A new state is a sign-out: the last student's pictures go with it.
      if (state !== S) forgetAll();
      S = state;
    },
    test: {
      // Tests answer `handout-links` themselves (to hold one, or fail it); null puts the real route back.
      setHandoutAnswer: function (fn) {
        answerFn = fn;
      },
    },
  });
})();
