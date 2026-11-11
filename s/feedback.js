/* The teacher's feedback beyond the grade, on the student's page (S9-F3:
   See Your Work, with Show Marks; the artboard's "Student: Returned Photo
   With Marks" and the See Your Work row on Your Feedback).

   Demo Mode only, at #demo-card-send (the sample class with Send Work on;
   #demo-card keeps it off, as every class starts). Nothing is asked of the
   server: Batch C (migrations/local-test/batch-c-contract.md on
   batch-c-markup-reflect-revise, PR 1043) is built but not reviewed or
   applied, and the routes that will call it are not built. Here Demo Mode
   answers as its functions are written to, each reply's shape made in one
   function below so the wiring PR changes one place:

     feedbackOf(state)  the `feedback` reply the page will carry beside
                        `page` and `work`: for each piece, the marks the
                        student was given ({ pages, notes }).
     answerOf(route)    `markup` (the given marks on the student's pages)
                        and `file-links` (the student's pages to show).

   The rules the stand-in keeps, as the server does: the student is given
   the teacher's marks only when the work is returned, and only the copy
   given then; a mark made or erased since waits on the teacher's working
   copy, which no student reads. No marks on a piece set not to show them
   (Students See Your Mark Up off), never returned, or with Missing or
   Excused on it.

   Every answer is checked against the screen that asked before it draws:
   StudentPage.whileCurrent drops it after Done, a new card or another
   class, and See Your Work must still be open on the same piece, for the
   same student, from the same ask. */
(function () {
  'use strict';

  if (typeof StudentPage === 'undefined' || !StudentPage.addScreens) return;

  var S = null; // the page's state (student.js)
  var asked = 0; // each fetch of a piece's pages, so an older answer never draws over a newer one
  var answerFn = null; // tests answer the routes themselves, to hold or fail them

  /* ── Demo Mode's sample: Cece's pages and the marks on them ────
     Cell Microscope Lab came back with Ms. Rivera's marks. Since then she
     added a note and erased the highlight: that waits on her working copy,
     and Cece still has what she was given. Energy Transfer Investigation
     has marks too, on a piece set not to show them. The Disease Research
     Poster is a draft never returned: its marks are the teacher's only. */
  var SAMPLE = '../assets/sample-work/';
  var LAB_GIVEN = {
    v: 1,
    marks: [
      { id: 'm1', type: 'tick', x: 0.08, y: 0.25, color: 'green' },
      { id: 'm2', type: 'note', x: 0.46, y: 0.47, text: 'Careful drawing: the rows show each cell wall.' },
      { id: 'm3', type: 'note', x: 0.83, y: 0.42, text: 'Label the membrane on one more cell.' },
      {
        id: 'm4',
        type: 'pen',
        color: 'red',
        width: 0.004,
        points: [
          [0.42, 0.785],
          [0.5, 0.788],
          [0.565, 0.784],
        ],
      },
      {
        id: 'm5',
        type: 'highlight',
        color: 'blue',
        width: 0.02,
        points: [
          [0.11, 0.812],
          [0.52, 0.812],
        ],
      },
      { id: 'm6', type: 'note', x: 0.6, y: 0.82, text: 'Good: you said why the nucleus was easier to see.' },
    ],
  };
  function labWorking() {
    var marks = LAB_GIVEN.marks.filter(function (m) {
      return m.id !== 'm5';
    });
    return {
      v: 1,
      marks: marks.concat([{ id: 'm7', type: 'note', x: 0.8, y: 0.09, text: 'Add the date you did the lab.' }]),
    };
  }
  var DEMO_MARKUP = {
    'demo-lab': {
      see: true,
      pages: [{ file_id: 'demo-file-lab-1', page: 1, image: 'cell-lab-cece-1.jpg', given: LAB_GIVEN, working: null }],
    },
    'demo-energy': {
      see: false, // Students See Your Mark Up is off on this piece
      pages: [
        {
          file_id: 'demo-file-energy-1',
          page: 1,
          image: 'cell-lab-cece-1.jpg',
          given: { v: 1, marks: [{ id: 'm1', type: 'note', x: 0.5, y: 0.5, text: 'Show the arrows.' }] },
          working: null,
        },
      ],
    },
    'demo-poster': {
      see: true,
      pages: [
        {
          file_id: 'demo-file-poster-1',
          page: 1,
          image: 'cell-lab-cece-1.jpg',
          given: null, // never returned
          working: { v: 1, marks: [{ id: 'm1', type: 'note', x: 0.5, y: 0.3, text: 'Two sources are missing.' }] },
        },
      ],
    },
  };
  DEMO_MARKUP['demo-lab'].pages[0].working = labWorking();

  // The page's row for piece `id`, or null.
  function rowOf(state, id) {
    var list = (state && state.reply && state.reply.assessments) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /* The copy of the marks the student has on piece `id`, page by page, as
     the server's reader gives it: the given copy only, and nothing at all
     when the piece hides its marks, was never returned, or has Missing or
     Excused on it. */
  function givenPages(state, id) {
    var sample = DEMO_MARKUP[id];
    var row = rowOf(state, id);
    if (!sample || !row || !sample.see || !row.returned_at) return [];
    if (row.status === 'NS' || row.status === 'EXC') return [];
    return sample.pages.filter(function (pg) {
      return pg.given && pg.given.marks && pg.given.marks.length;
    });
  }

  function demoOn(state) {
    return !!(state && state.demo && (state.demoSend || state.demoReflect) && state.reply && state.page);
  }

  /* ── Demo Mode's sample: Cece's reflections (S10) ──────────────
     At #demo-card-reflect the class has Reflect on Feedback on. Cece asked
     about Energy Transfer Investigation and Ms. Rivera answered; she made
     a plan on the KMT lab yesterday, which goes on her next piece to do;
     on the Cell Structure Quiz Ms. Rivera wrote herself a note, which is
     hers alone and never sent. Cell Microscope Lab is hers to reflect on.
     What she sends is kept in memory until Done. */
  function at(days, hour) {
    var t = new Date(Date.now() + days * 864e5);
    t.setHours(hour || 15, 10, 0, 0);
    return t.toISOString();
  }
  function blank(fields) {
    return Object.assign(
      {
        makes_sense: 'yes',
        question: null,
        plan: null,
        went_well: null,
        sent_at: null,
        answer: null,
        answered_at: null,
        only_me: false,
        sense_now: null,
        sense_now_at: null,
        follow_up: null,
        follow_up_answer: null,
        follow_up_answered_at: null,
      },
      fields,
    );
  }
  function demoReflections() {
    return {
      'demo-energy': blank({
        makes_sense: 'not_sure',
        question: 'What counts as a pattern? I thought one number going up was one.',
        sent_at: at(-5),
        answer:
          'A pattern is what keeps happening across your whole table. Here, every transfer loses some energy as heat. One number going up is a single result.',
        answered_at: at(-4),
      }),
      'demo-kmt': blank({
        plan: 'Next time I’ll write down what I predict before I heat anything.',
        went_well: 'I’m proud of my particle drawings.',
        sent_at: at(-1),
      }),
      'demo-quiz': blank({
        makes_sense: 'not_sure',
        question: 'Why was number 4 wrong?',
        sent_at: at(-8),
        // The teacher's note to herself: hers alone (the stand-in sends no answer marked for her only).
        answer: 'Go over question 4 with the whole class on Monday.',
        answered_at: at(-7),
        only_me: true,
      }),
    };
  }
  function reflections(state) {
    if (!state.demoReflections) state.demoReflections = demoReflections();
    return state.demoReflections;
  }

  /* The student's reflection as the server sends it (`feedback`'s
     `reflection`): their own words, and the teacher's answers once sent.
     An answer the teacher kept for herself is never sent. */
  function reflectionReply(r) {
    var mine = !r.only_me;
    return {
      makes_sense: r.makes_sense,
      question: r.question,
      plan: r.plan,
      went_well: r.went_well,
      sent_at: r.sent_at,
      answer: mine ? r.answer : null,
      answered_at: mine ? r.answered_at : null,
      sense_now: r.sense_now,
      follow_up: r.follow_up,
      follow_up_answer: r.follow_up_answer,
      follow_up_answered_at: r.follow_up_answered_at,
    };
  }

  // A reflection the student can see: Reflect on Feedback on, and the piece on the page and returned.
  function reflectionSeen(state, id) {
    var row = rowOf(state, id);
    var r = state.demoReflect ? reflections(state)[id] : null;
    if (!r || !row || !row.returned_at || row.status === 'NS' || row.status === 'EXC') return null;
    return r;
  }

  /* ── The replies, in the contract's shapes ─────────────────── */

  /* `feedback` (Batch C): { ok, v, reflect_on_feedback, show_my_learning,
     assessments: [ { id, marks: { pages, notes }, revision, reflection } ],
     last_plan }. Mark Up (S9-F3) with Send Work on; reflections and the
     last plan (S10) with Reflect on Feedback on. null outside Demo Mode's
     #demo-card-send and #demo-card-reflect: the server does not send it
     yet. Revisions (S11) are not built. */
  function feedbackOf(state) {
    if (!demoOn(state)) return null;
    var byId = {};
    var entry = function (id) {
      return (byId[id] = byId[id] || { id: id, marks: null, revision: null, reflection: null });
    };
    if (state.demoSend) {
      Object.keys(DEMO_MARKUP).forEach(function (id) {
        var pages = givenPages(state, id);
        if (!pages.length) return;
        var notes = 0;
        pages.forEach(function (pg) {
          pg.given.marks.forEach(function (m) {
            if (m.type === 'note') notes += 1;
          });
        });
        entry(id).marks = { pages: pages.length, notes: notes };
      });
    }
    var lastPlan = null;
    if (state.demoReflect) {
      var all = reflections(state);
      Object.keys(all).forEach(function (id) {
        var r = reflectionSeen(state, id);
        if (!r) return;
        entry(id).reflection = reflectionReply(r);
        if (r.plan && (!lastPlan || r.sent_at > lastPlan.sent_at)) {
          lastPlan = { assessment_id: id, plan: r.plan, sent_at: r.sent_at };
        }
      });
    }
    return {
      ok: true,
      v: 1,
      reflect_on_feedback: !!state.demoReflect,
      show_my_learning: false,
      assessments: Object.keys(byId).map(function (id) {
        return byId[id];
      }),
      last_plan: lastPlan,
    };
  }

  /* `reflect` and `reply` (Batch C), as the student functions are written
     to answer: a reflection only while the class has Reflect on Feedback
     on, only on a piece of this class returned to the student, and only
     until the teacher answers it (sent again before then, it takes the
     place of the first); "Does It Make Sense Now?" only once answered, and
     a follow-up question once. The student's words go in as typed. */
  var LIMIT = 1000;
  function words(v) {
    return typeof v === 'string' && v.trim() && v.length <= LIMIT ? v : null;
  }
  function demoReflect(body) {
    var id = body && body.assessment_id;
    var row = rowOf(S, id);
    var r = body && body.reflection;
    if (!S.demoReflect) return { ok: false, error: 'reflect_off' };
    if (!row) return { ok: false, error: 'not_found' };
    if (!row.returned_at) return { ok: false, error: 'not_returned' };
    var sense = r && (r.makes_sense === 'yes' || r.makes_sense === 'not_sure') ? r.makes_sense : '';
    var bad =
      !sense ||
      (sense === 'not_sure' && !words(r.question)) ||
      (sense === 'yes' && !words(r.plan)) ||
      (r.went_well != null && r.went_well !== '' && !words(r.went_well));
    if (bad) return { ok: false, error: 'bad_shape' }; // the server RAISES 22023: the caller's bug
    var all = reflections(S);
    var had = all[id];
    if (had && (had.answer || had.answered_at)) return { ok: false, error: 'already_answered' };
    all[id] = blank({
      makes_sense: sense,
      question: sense === 'not_sure' ? r.question : null,
      plan: sense === 'yes' ? r.plan : null,
      went_well: sense === 'yes' && words(r.went_well) ? r.went_well : null,
      sent_at: new Date().toISOString(),
    });
    return { ok: true, reflection: reflectionReply(all[id]) };
  }
  function demoReply(body) {
    var id = body && body.assessment_id;
    var r = reflectionSeen(S, id);
    var a = body && body.reply;
    if (!r) return { ok: false, error: 'not_found' };
    if (!r.answer || r.only_me) return { ok: false, error: 'not_answered' };
    if (r.follow_up) return { ok: false, error: 'already_asked' };
    var sense = a && (a.sense_now === 'yes' || a.sense_now === 'not_sure') ? a.sense_now : '';
    if (!sense || (sense === 'not_sure' && !words(a.follow_up)) || (sense === 'yes' && a.follow_up)) {
      return { ok: false, error: 'bad_shape' };
    }
    r.sense_now = sense;
    r.sense_now_at = new Date().toISOString();
    if (sense === 'not_sure') r.follow_up = a.follow_up;
    return { ok: true, reflection: reflectionReply(r) };
  }

  /* `markup` (Batch C): { ok, files: [ { file_id, marks, given_at } ] }, the
     given marks on the student's pages of one piece. `file-links` (Batch B's
     file_links, with the links the function makes): { ok, files: [ {
     file_id, page, url } ] }. The phone's shape of that route is not fixed
     by the contract ("send the phone links, not paths"); this is the shape
     the page reads, with url a link the page can fetch. Demo Mode's are
     the shipped sample pages. */
  function demoAnswer(route, body) {
    var id = body && body.assessment_id;
    var sample = DEMO_MARKUP[id];
    if (route === 'reflect') return demoReflect(body);
    if (route === 'reply') return demoReply(body);
    if (!rowOf(S, id)) return { ok: false, error: 'not_found' };
    if (route === 'markup') {
      return {
        ok: true,
        files: givenPages(S, id).map(function (pg) {
          return { file_id: pg.file_id, marks: pg.given, given_at: rowOf(S, id).returned_at };
        }),
      };
    }
    if (route === 'file-links') {
      return {
        ok: true,
        files: (sample ? sample.pages : []).map(function (pg) {
          return { file_id: pg.file_id, page: pg.page, url: SAMPLE + pg.image };
        }),
      };
    }
    return { ok: false, error: 'not_found' };
  }

  // A route's answer. Outside Demo Mode nothing is asked: Batch C's routes do not exist yet.
  function answerOf(route, body) {
    if (answerFn) return Promise.resolve(answerFn(route, body));
    if (!S || !S.demo) return Promise.resolve({ ok: false, error: 'network' });
    return Promise.resolve(demoAnswer(route, body));
  }

  /* ── See Your Work: fetching a piece's pages ───────────────── */

  // The pages to show, in order, each with the given marks on it (or none).
  function pagesFrom(links, marks) {
    var byFile = {};
    ((marks && marks.files) || []).forEach(function (f) {
      if (f && typeof f.file_id === 'string') byFile[f.file_id] = f.marks || null;
    });
    return ((links && links.files) || [])
      .filter(function (f) {
        return f && typeof f.file_id === 'string' && typeof f.url === 'string';
      })
      .slice()
      .sort(function (x, y) {
        return (Number(x.page) || 0) - (Number(y.page) || 0);
      })
      .map(function (f) {
        return { url: f.url, marks: byFile[f.file_id] || null };
      });
  }

  // Is See Your Work still open on piece `id`, for this student, from this ask?
  function current(id, student, mine) {
    return (
      !!S &&
      S.screen === 'assignments' &&
      S.work === id &&
      !!S.page &&
      S.page.student.id === student &&
      !!S.workPages &&
      S.workPages.asked === mine
    );
  }

  function load(id) {
    if (!S || !S.page || !id) return;
    asked += 1;
    var mine = asked;
    var student = S.page.student.id;
    S.workPages = { id: id, state: 'loading', pages: [], asked: mine };
    StudentPage.paint('#sp-work-title');
    var body = { enrollment_id: student, assessment_id: id };
    StudentPage.whileCurrent(Promise.all([answerOf('file-links', body), answerOf('markup', body)])).then(
      function (both) {
        if (!current(id, student, mine)) return;
        var links = both[0];
        var marks = both[1];
        // A reply of the wrong kind is a failed fetch, never a stuck screen.
        var ok =
          links &&
          links.ok === true &&
          Array.isArray(links.files) &&
          marks &&
          marks.ok === true &&
          Array.isArray(marks.files);
        S.workPages = ok
          ? { id: id, state: 'ready', pages: pagesFrom(links, marks), asked: mine }
          : { id: id, state: 'failed', pages: [], asked: mine };
        StudentPage.paint('#sp-work-title');
      },
    );
  }

  function onClick(act, el) {
    if (!S) return;
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') {
      S.work = '';
      S.workPages = null;
      if (act === 'card-done') S.demoReflections = null;
      return;
    }
    // app.js has opened See Your Work (StudentPageView.press); fetch its pages unless they are here.
    if (act === 'work' && S.work && !(S.workPages && S.workPages.id === S.work && S.workPages.state === 'ready')) {
      return load(S.work);
    }
    if (act === 'work-retry' && S.work && S.work === ((el && el.getAttribute('data-piece')) || '')) {
      return load(S.work);
    }
  }

  StudentPage.feedbackOf = feedbackOf;
  // The one way s/reflect.js asks `reflect` and `reply` (Demo Mode's answers until Batch C is wired).
  StudentPage.feedbackAsk = answerOf;

  StudentPage.addScreens({
    file: 'feedback',
    render: {},
    click: onClick,
    share: function (state) {
      S = state;
    },
    test: {
      feedbackOf: feedbackOf,
      demoMarkup: function () {
        return DEMO_MARKUP;
      },
      demoReflections: function (state) {
        return reflections(state);
      },
      // Tests answer `markup` and `file-links` themselves (to hold one, or fail it); null puts Demo Mode back.
      setFeedbackAnswer: function (fn) {
        answerFn = fn;
      },
    },
  });
})();
