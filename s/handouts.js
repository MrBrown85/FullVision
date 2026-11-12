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
   on Done, another class, or another handout. Demo Mode's sample has no
   handout, so it asks nothing.

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

  // Is the handout still open on resource `id`, for this student, from this ask?
  function current(id, student, mine) {
    return (
      !!S &&
      S.screen === 'assignments' &&
      S.handout === id &&
      !!S.page &&
      S.page.student.id === student &&
      !!S.handoutPages &&
      S.handoutPages.asked === mine
    );
  }

  function load(id, piece) {
    if (!S || !S.page || !id) return;
    asked += 1;
    var mine = asked;
    var student = S.page.student.id;
    letGo();
    S.handoutPages = { id: id, state: 'loading', pages: [], asked: mine };
    StudentPage.paint('#sp-handout-title');
    var body = { enrollment_id: student, assessment_id: piece, resource_id: id };
    StudentPage.whileCurrent(answerOf(body))
      .then(function (res) {
        if (!current(id, student, mine)) return null;
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
        if (!list) return { failed: true };
        return Promise.all(
          list.map(function (pg) {
            return picture(pg.url);
          }),
        ).then(function (blobs) {
          return { blobs: blobs };
        });
      })
      .then(function (got) {
        if (!got || !current(id, student, mine)) return;
        var pages = got.failed
          ? []
          : got.blobs
              .map(function (b) {
                return b ? objectUrl(new Blob([b], { type: 'image/jpeg' })) : '';
              })
              .filter(Boolean)
              .map(function (u) {
                return { url: u };
              });
        var failed = got.failed || (got.blobs.length > 0 && !pages.length);
        S.handoutPages = failed
          ? { id: id, state: 'failed', pages: [], asked: mine }
          : { id: id, state: 'ready', pages: pages, asked: mine };
        StudentPage.paint('#sp-handout-title');
      });
  }

  function onClick(act, el) {
    if (!S) return;
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') {
      S.handout = '';
      S.handoutPiece = '';
      S.handoutPages = null;
      letGo();
      return;
    }
    // app.js has opened the handout (StudentPageView.press); fetch its pages unless they are here.
    if (
      act === 'handout' &&
      S.handout &&
      !(S.handoutPages && S.handoutPages.id === S.handout && S.handoutPages.state === 'ready')
    ) {
      return load(S.handout, S.handoutPiece);
    }
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
      if (state !== S) letGo();
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
