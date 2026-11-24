/* A teacher's handout, opened on the student's page (Handouts and Links;
   the board "What the Student Sees (Phone)").

   On a card still to do, the handout's pages show in the card to swipe
   through (s/page-carousel.js); on a Needs Revision card, For This
   Assignment (s/page-view.js) lists the handout. Either way a tap opens it
   in the page, one page at a time, as See Your Work does (s/feedback.js):
   app.js has already opened it (StudentPageView.press); this file fetches
   its pages, for the open handout and for the carousels.

   A real card asks `handout-links` (supabase/functions/student-submit/
   handout-routes.ts, student_submit.handout_links) through
   StudentPage.askClass, which adds the device's session: { ok, pages: [ {
   page, url } ] }, each url a link signed for 60 seconds. A page is fetched
   when it is wanted and shown from a blob: address (the Content Security
   Policy allows blob: and not the storage host); the addresses are let go
   on Log Out, another class or another card. Demo Mode's sample handouts
   are the site's own pictures, so they ask nothing.

   Every answer is checked against the screen that asked before it draws:
   the handout must still be open, for the same student, from the same ask.

   A handout file (a web page, a text file or an EPUB; Colin's call of Nov
   17 2026) is a row in For This Assignment (data-act="handout-file"). A
   tap asks `handout-file` (student_submit.handout_file): { ok, kind,
   bytes, title, url }, one link signed for 60 seconds; the file is fetched
   and opened over the page by shared/handout-viewer.js, a web page or a
   book only in its sealed frame. A file fetched is kept for the session,
   like a handout's pages, and let go on Log Out, another class or another
   card. */
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

  function answerOf(body, route) {
    var r = route || 'handout-links';
    if (answerFn) return Promise.resolve(answerFn(r, body));
    if (!S || S.demo || typeof StudentPage.askClass !== 'function') {
      return Promise.resolve({ ok: false, error: 'not_found' });
    }
    return Promise.resolve(StudentPage.askClass(r, body, body.enrollment_id)).then(null, function () {
      return { ok: false, error: 'network' };
    });
  }

  /* ── A handout file ── */
  var files = {}; // resource id → { student, blob } once fetched, for the session

  // The file's bytes, from what is kept or through `handout-file`; null when it did not come.
  function fileBlob(rid, piece, student) {
    var k = files[rid];
    if (k && k.student === student) return Promise.resolve(k.blob);
    if (!S || S.demo) return Promise.resolve(null);
    var body = { enrollment_id: student, assessment_id: piece, resource_id: rid };
    return StudentPage.whileCurrent(answerOf(body, 'handout-file')).then(function (res) {
      if (!res || res.ok !== true || !/^https:\/\//.test(String(res.url || ''))) return null;
      return picture(res.url).then(function (blob) {
        if (!blob || !S || !S.page || S.page.student.id !== student) return null;
        files[rid] = { student: student, blob: blob };
        return blob;
      });
    });
  }

  // A tap on a handout file's row: it opens over the page.
  function openFile(el) {
    if (!S || !S.page || typeof HandoutViewer === 'undefined' || typeof StudentPage.viewOf !== 'function') return;
    var rid = (el && el.getAttribute('data-resource')) || '';
    var piece = (el && el.getAttribute('data-piece')) || '';
    var view = StudentPage.viewOf(S);
    var p =
      view &&
      (view.work || []).filter(function (x) {
        return x && x.id === piece;
      })[0];
    var r =
      p &&
      (p.resources || []).filter(function (x) {
        return x && x.kind === 'file' && x.id === rid;
      })[0];
    if (!r) return;
    var student = S.page.student.id;
    HandoutViewer.open({
      title: r.title,
      kind: r.type,
      returnTo: el,
      load: function () {
        return fileBlob(r.id, piece, student);
      },
    });
  }

  /* Fast (Colin, 2026-11-16: "it should be extremely fast and snappy").
     A handout's pages are kept for the session once fetched, so opening it
     again is instant, and each page shows as soon as it lands. kept:
     resource id → { student, piece, links (the route's addresses, by page),
     linksAt (when they were signed), asking (the route's answer on its
     way), getting (page → its picture on its way), pages: [ { url } ],
     missed (pages that did not come), count, failed }.

     The pages on a card still to do come from here too, one at a time
     (s/page-carousel.js asks for the page a card shows as it comes near the
     screen, and the next once the student is looking): `handout-links` is
     asked once per handout, and again only when its links have run out.
     Each link is signed for 60 seconds (send-routes.ts LINK_SECONDS), so a
     page wanted after LINK_FRESH ms asks for new links first, and a page
     whose link fails is asked for again once, with new links, quietly. The
     route has no rate limit of its own (student_submit.handout_links reads
     and counts nothing), so a student scrolling a long list cannot run into
     one. */
  var kept = {};
  var WARM_MAX = 4;
  var LINK_FRESH = 45000;
  var RETRY_AFTER = 15000;

  // Demo Mode's sample handouts: their pages are the site's own pictures.
  var DEMO_PAGES = {
    'demo-res-checklist': [
      '../assets/sample-handouts/poster-checklist-1.jpg',
      '../assets/sample-handouts/poster-checklist-2.jpg',
    ],
    'demo-res-study': ['../assets/sample-handouts/study-guide-1.svg', '../assets/sample-handouts/study-guide-2.svg'],
    'demo-res-planner': [
      '../assets/sample-handouts/proposal-planner-1.svg',
      '../assets/sample-handouts/proposal-planner-2.svg',
    ],
    'demo-res-safety': ['../assets/sample-handouts/safety-checklist-1.svg'],
  };

  /* #demo-card-feed (s/app.js): a long list still to do, so the cards'
     carousels can be seen fetching their pages only as they come near the
     screen: five more pieces Missing after the Quick Check, then one due
     today with the Proposal Planner. isoDay: app.js's day `n` from today. */
  StudentPage.demoFeed = function (isoDay) {
    var names = [
      'Body Systems Vocabulary',
      'Digestion Diagram',
      'Heart Rate Lab',
      'Lung Capacity Data',
      'Nerve Signal Quiz',
    ];
    return names
      .map(function (title, i) {
        return { id: 'demo-feed-' + (i + 1), title: title, date: isoDay(-6), due_date: isoDay(-4), status: 'NS' };
      })
      .concat({
        id: 'demo-feed-review',
        title: 'Body Systems Review',
        date: isoDay(-3),
        due_date: isoDay(0),
        about: 'Plan a short review of one body system for the class.',
        resources: [{ id: 'demo-res-planner', kind: 'pdf', title: 'Proposal Planner', url: null, page_count: 2 }],
      });
  };

  // Is the handout still open on resource `id`, for this student?
  function showing(id, student) {
    return !!S && S.screen === 'assignments' && S.handout === id && !!S.page && S.page.student.id === student;
  }

  // What the open handout shows: loading until a page is here, failed when none can come.
  function stateOf(k) {
    if (k.failed) return 'failed';
    var got = k.pages.some(function (pg) {
      return pg && pg.url;
    });
    if (got) return 'ready';
    if (k.count && Object.keys(k.missed).length >= k.count) return 'failed';
    return 'loading';
  }

  // The open handout drawn from what is kept: a page that landed shows at once.
  function show(id, student) {
    var k = kept[id];
    if (!k || !showing(id, student)) return;
    var state = stateOf(k);
    var had = S.handoutPages;
    S.handoutPages = {
      id: id,
      state: state,
      pages: k.pages.slice(),
      asked: asked,
      missed: Object.keys(k.missed).length,
      out: k.out,
    };
    // Drawn again only when what shows changes, so the keyboard stays where it is.
    if (!had || had.id !== id || had.state !== state || state === 'ready') {
      // Over the Save or Print sheet the keyboard stays in it, on the row that was chosen.
      var focus = '#sp-handout-title';
      if (S.handoutMenu) focus = k.out ? '.sp-handout-sheet [data-act="handout-' + k.out.how + '"]' : '';
      StudentPage.paint(focus);
    }
  }

  // What is kept of handout `id` for this student, started if need be.
  function entry(id, piece, student) {
    var k = kept[id];
    if (k && k.student === student) return k;
    k = kept[id] = {
      student: student,
      piece: piece,
      links: null,
      linksAt: 0,
      asking: null,
      getting: {},
      pages: [],
      missed: {},
      count: 0,
      failed: false,
      failedAt: 0,
      out: null, // Print or Save to Phone: { state: 'working' | 'failed' }
    };
    if (S && S.demo) {
      var demoPages = DEMO_PAGES[id] || [];
      k.count = demoPages.length;
      k.failed = !demoPages.length;
      k.pages = demoPages.map(function (u) {
        return { url: u };
      });
    }
    return k;
  }

  /* The handout's links, by page (null when the route refused or failed):
     the ones kept while they are fresh, or asked for (`again`: asked for
     anew whatever is kept). One ask at a time. */
  function linksOf(k, id, again) {
    if (!again && k.links && Date.now() - k.linksAt < LINK_FRESH) return Promise.resolve(k.links);
    if (k.asking) return k.asking;
    var body = { enrollment_id: k.student, assessment_id: k.piece, resource_id: id };
    k.asking = StudentPage.whileCurrent(answerOf(body)).then(function (res) {
      k.asking = null;
      if (kept[id] !== k) return null;
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
        // Links that came once still stand for the pages already here.
        if (!k.links) {
          k.failed = true;
          k.failedAt = Date.now();
        }
        return null;
      }
      k.links = list.map(function (pg) {
        return pg.url;
      });
      k.linksAt = Date.now();
      k.count = list.length;
      for (var n = k.pages.length; n < k.count; n++) k.pages.push({ url: '' });
      return k.links;
    });
    return k.asking;
  }

  // Page i kept as this device's own copy, or marked as one that did not come.
  function keep(k, id, i, blob) {
    var u = blob ? objectUrl(new Blob([blob], { type: 'image/jpeg' })) : '';
    if (u) {
      for (var n = k.pages.length; n <= i; n++) k.pages.push({ url: '' });
      k.pages[i] = { url: u, blob: blob };
      delete k.missed[i];
    } else {
      k.missed[i] = true;
    }
    if (showing(id, k.student)) show(id, k.student);
    return u;
  }

  /* Page i of handout `id` (from 0): its address on this device, or ''
     when it did not come. A link that fails is asked for again once. */
  function pageOf(k, id, i) {
    if (k.pages[i] && k.pages[i].url) return Promise.resolve(k.pages[i].url);
    if (S && S.demo) return Promise.resolve('');
    if (k.getting[i]) return k.getting[i];
    var mine = linksOf(k, id, false)
      .then(function (links) {
        if (!links || !links[i]) return null;
        return picture(links[i]).then(function (blob) {
          if (blob || kept[id] !== k) return blob;
          return linksOf(k, id, true).then(function (again) {
            return again && again[i] ? picture(again[i]) : null;
          });
        });
      })
      .then(function (blob) {
        if (k.getting[i] === mine) delete k.getting[i];
        return kept[id] === k ? keep(k, id, i, blob) : '';
      });
    k.getting[i] = mine;
    return mine;
  }

  /* Fetch every page of handout `id` into kept (or reuse it). `open`: the
     student is looking at it, so each page that lands is drawn. */
  function fetchHandout(id, piece, student, open) {
    var k = entry(id, piece, student);
    if (open) show(id, student);
    if (S.demo) return;
    linksOf(k, id, false).then(function (links) {
      if (kept[id] !== k) return;
      if (!links) {
        if (showing(id, student)) show(id, student);
        return;
      }
      links.forEach(function (u, i) {
        pageOf(k, id, i);
      });
    });
  }

  /* The pages a card's carousel shows (s/page-carousel.js): known gives
     what is already here, load fetches one page. Quiet: a page that does
     not come is ''. */
  var source = {
    known: function (id, i) {
      var k = S && S.page ? kept[id] : null;
      return k && k.student === S.page.student.id && k.pages[i] && k.pages[i].url ? k.pages[i].url : '';
    },
    load: function (piece, id, i) {
      if (!S || !S.page || !id) return Promise.resolve('');
      var k = entry(id, piece, S.page.student.id);
      if (k.failed && !k.links) {
        // The route did not answer: tried again when the card comes back, at most every RETRY_AFTER ms.
        if (S.demo || Date.now() - k.failedAt < RETRY_AFTER) return Promise.resolve('');
        k.failed = false;
      }
      return pageOf(k, id, Number(i) || 0);
    },
  };

  /* Print or Save to Phone (shared/handout-out.js): every page first,
     asking again for any that did not come. Nothing goes out if one is
     missing; the pane says so. `how`: 'print' or 'save'. */
  function output(how, id, piece) {
    var student = S && S.page ? S.page.student.id : '';
    var k = kept[id];
    if (!k || k.student !== student || (k.out && k.out.state === 'working') || typeof HandoutOut === 'undefined')
      return;
    var heading = typeof document !== 'undefined' ? document.getElementById('sp-handout-title') : null;
    var title = heading ? heading.textContent || '' : '';
    k.out = { state: 'working', how: how === 'print' ? 'print' : 'save' };
    show(id, student);
    var all = [];
    for (var i = 0; i < k.count; i++) all.push(pageOf(k, id, i));
    Promise.all(all)
      .then(function () {
        if (kept[id] !== k) return null;
        var pages = k.pages.slice(0, k.count);
        if (
          !pages.length ||
          pages.length < k.count ||
          !pages.every(function (pg) {
            return pg && pg.url;
          })
        )
          throw new Error('pages');
        return pages;
      })
      .then(function (pages) {
        if (!pages) return;
        // Every page is here: the sheet closes and the print sheet or share sheet opens.
        k.out = null;
        S.handoutMenu = false;
        show(id, student);
        StudentPage.paint('.sp-handout-outbtn');
        return how === 'print' ? HandoutOut.print(pages) : HandoutOut.save(pages, title);
      })
      .then(null, function () {
        if (kept[id] !== k) return;
        k.out = { state: 'failed', how: how === 'print' ? 'print' : 'save' };
        // The sheet is open again, to say so in the row.
        S.handoutMenu = true;
        show(id, student);
      });
  }

  function load(id, piece) {
    if (!S || !S.page || !id) return;
    asked += 1;
    var student = S.page.student.id;
    // Try Again starts over.
    if (kept[id] && stateOf(kept[id]) === 'failed') delete kept[id];
    S.handoutMenu = false;
    S.handoutPages = { id: id, state: 'loading', pages: [], asked: asked };
    fetchHandout(id, piece, student, true);
    if (S.handoutPages && S.handoutPages.state === 'loading') StudentPage.paint('#sp-handout-title');
  }

  /* The handouts on Needs Revision cards, fetched ahead (a real card; Demo
     Mode's are on the device). A card still to do shows its pages in its
     carousel, which fetches them as the card comes near the screen. */
  function warm() {
    if (!S || !S.page || S.demo || typeof StudentPage.viewOf !== 'function') return;
    var view = StudentPage.viewOf(S);
    if (!view) return;
    var student = S.page.student.id;
    var n = 0;
    view.work.forEach(function (p) {
      if (p.kind !== 'revise') return;
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
    files = {};
    letGo();
    if (typeof HandoutViewer !== 'undefined') HandoutViewer.close();
  }

  function onClick(act, el) {
    if (!S) return;
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') {
      S.handoutMenu = false;
      S.handout = '';
      S.handoutPiece = '';
      S.handoutPages = null;
      forgetAll();
      return;
    }
    if (act === 'handout-file') return openFile(el);
    if (act === 'handout-out-open' && S.handout) {
      var open = kept[S.handout];
      if (open && open.out && open.out.state === 'failed') open.out = null;
      S.handoutMenu = true;
      show(S.handout, S.page.student.id);
      // The sheet slides up on the drawing that opens it (page-view.js).
      if (typeof StudentPageView !== 'undefined' && typeof document !== 'undefined') StudentPageView.slideIn(document);
      var title = typeof document !== 'undefined' ? document.getElementById('sp-out-title') : null;
      if (title && title.focus) title.focus();
      return;
    }
    if (act === 'handout-out-close') {
      S.handoutMenu = false;
      StudentPage.paint('.sp-handout-outbtn');
      return;
    }
    if ((act === 'handout-print' || act === 'handout-save') && S.handout) {
      return output(act === 'handout-print' ? 'print' : 'save', S.handout, S.handoutPiece);
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
    // Once the page is drawn: the cards' carousels are watched, and fetch their pages as they come near.
    drawn: function (root, state) {
      if (state.screen !== 'assignments' || typeof StudentPageCarousel === 'undefined') return;
      StudentPageCarousel.attach(root, source);
    },
    share: function (state) {
      // A new state is a sign-out: the last student's pictures go with it.
      if (state !== S) forgetAll();
      S = state;
    },
    test: {
      // Tests answer `handout-links` themselves (to hold one, or fail it); null puts the real route back.
      handoutSource: source,
      setHandoutAnswer: function (fn) {
        answerFn = fn;
      },
    },
  });
})();
