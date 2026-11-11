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

   A real student's page (S9-W1, S10-W1) asks the server's routes in their
   place (see "A real card" below): `feedback` once the class's work is in
   and it takes work, `markup` and `file-links` for See Your Work, `reflect`,
   `reply` and `answer-seen`; `feedback`'s revisions with their pages
   through `file-links` (S11-W1); `group-work` once `feedback` has answered
   and `group-links` for a group piece's pages (S12-W1). Everything it
   keeps is on the page's state, so it ends with the session, and every
   request names its own student
   (StudentPage.askClass refuses one made for someone else).

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

  /* ── Demo Mode's sample: revisions (S11-F2) ────────────────────
     At #demo-card-revise (Send Work on, a class graded by both). Ms.
     Rivera returned Cece's Cell Microscope Lab for revision yesterday,
     keeping its grade: Labelled Drawing, by the end of the week. How Vaccines
     Work came back for revision earlier; Cece sent her revision and its
     grade was returned two days ago: Developing + and Proficient before,
     Proficient and Proficient after (s/app.js has the grade returned, and
     this keeps the first version's). What Cece sends or unsends is kept in
     memory until Done. The stand-in answers as Batch C's student functions
     are written to (shared/data.js, "Revisions"): a revision only on an open
     request, Unsend and Replace only until grading starts, Late after
     Revise By. The grade is always kept: there is no Hide in this build
     (Colin, Nov 11). */
  function isoDay(offset) {
    var t = new Date(Date.now() + offset * 864e5);
    return (
      t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
    );
  }
  function demoRevisions() {
    return {
      'demo-lab': {
        what_to_fix: 'Write the magnification beside each drawing, then send it again.',
        revise_by: isoDay(3),
        criterion_ids: ['demo-crit-drawing'],
        asked_at: at(-1),
        first_sent_at: at(-15, 19),
        first_thumbs: [SAMPLE + 'cell-lab-cece-1-thumb.jpg'],
        first_grade: null, // the grade Cece has on the page, kept
        revision: null, // once sent: { at, note, late, pages: [{ url, thumbUrl }], grading }
        returned: false,
      },
      'demo-vaccine': {
        what_to_fix: 'Add a third example of how the body remembers a germ.',
        revise_by: isoDay(-3),
        criterion_ids: [],
        asked_at: at(-9),
        first_sent_at: at(-11, 19),
        first_thumbs: [SAMPLE + 'cell-lab-cece-1-thumb.jpg'],
        first_grade: {
          v: 1,
          value: null,
          modifier: 0,
          comment: 'Two clear examples. The task asks for three.',
          tags: {
            'demo-com': { value: 2, modifier: 1, comment: null },
            'demo-qp': { value: 3, modifier: 0, comment: null },
          },
          criteria: {},
          checks: [],
        },
        revision: {
          at: at(-3, 19),
          note: 'I added how a booster shot reminds the body about a germ it has met before.',
          late: false,
          pages: [{ url: SAMPLE + 'cell-lab-cece-1.jpg', thumbUrl: SAMPLE + 'cell-lab-cece-1-thumb.jpg' }],
          grading: true,
        },
        returned: true,
      },
    };
  }
  function revisions(state) {
    if (!state || !state.demo || !state.demoRevise) return null;
    if (!state.demoRevisions) state.demoRevisions = demoRevisions();
    return state.demoRevisions;
  }

  /* The student's revision on piece `id` as the server sends it
     (`feedback`'s `revision`, shared/data.js's _studentRevisionOf shape),
     or null: none on a piece not on the page, or with Missing or Excused on
     it. A regrade still a draft reads as sent. first_thumbs and thumbs are
     Demo Mode's own (the pages to show). */
  function revisionReply(state, id, r) {
    var row = rowOf(state, id);
    if (!row || row.status === 'NS' || row.status === 'EXC') return null;
    var rec = r.revision;
    var stateNow = r.returned && rec ? 'returned' : rec ? 'sent' : 'open';
    return {
      state: stateNow,
      what_to_fix: r.what_to_fix,
      revise_by: r.revise_by || null,
      criterion_ids: r.criterion_ids.slice(),
      keep_grade: true,
      grade_hidden: false,
      first_version: 1,
      first_sent_at: r.first_sent_at,
      first_grade: r.first_grade || row.grade || null,
      revision_version: rec ? 2 : null,
      revision_sent_at: rec ? rec.at : null,
      revision_note: rec ? rec.note || null : null,
      revision_late: rec ? !!rec.late : null,
      asked_at: r.asked_at,
      first_thumbs: r.first_thumbs.slice(),
      thumbs: rec
        ? rec.pages.map(function (pg) {
            return pg.thumbUrl || pg.url;
          })
        : [],
    };
  }

  /* ── The replies, in the contract's shapes ─────────────────── */

  /* `feedback` (Batch C): { ok, v, reflect_on_feedback, show_my_learning,
     assessments: [ { id, marks: { pages, notes }, revision, reflection } ],
     last_plan }. Mark Up (S9-F3) with Send Work on; reflections and the
     last plan (S10) with Reflect on Feedback on. null outside Demo Mode's
     #demo-card-send and #demo-card-reflect: the server does not send it
     yet. Revisions (S11-F2) at #demo-card-revise only. */
  function feedbackOf(state) {
    if (state && !state.demo) return realFeedbackOf(state);
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
    // Revisions (S11-F2), at #demo-card-revise only.
    var revs = revisions(state);
    if (revs) {
      Object.keys(revs).forEach(function (id) {
        var r = revisionReply(state, id, revs[id]);
        if (r) entry(id).revision = r;
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

  /* ── A real card (S9-W1, S10-W1) ───────────────────────────────
     The routes of migrations/2026111120_markup_reflect_revise.sql, through
     StudentPage.askClass, which adds the device's session. The reply is
     kept on the page's state (`realFeedback`, with the student it is for),
     so Done, another student or another class leaves nothing behind. */
  var REAL_ROUTES = {
    feedback: 1,
    markup: 1,
    'file-links': 1,
    reflect: 1,
    reply: 1,
    'answer-seen': 1,
    // Group work (S12-W1): the group's counts, and the group's pages of one piece.
    'group-work': 1,
    'group-links': 1,
  };
  var urls = []; // blob: addresses made here for a revision's pages, let go when the session ends

  function realAsk(route, body) {
    var ask = StudentPage.askClass;
    var student = body && typeof body.enrollment_id === 'string' ? body.enrollment_id : '';
    if (typeof ask !== 'function' || !student || !Object.prototype.hasOwnProperty.call(REAL_ROUTES, route)) {
      return Promise.resolve({ ok: false, error: 'network' });
    }
    // The student the ask is made for is named: someone else's session is never used for it.
    return ask(route, body, student);
  }

  function ownFeedback(state) {
    var f = state && state.realFeedback;
    return f && state.page && f.student === state.page.student.id ? f : null;
  }

  /* A revision as the page reads it (S11-W1): the contract's `revision`,
     in the shape Demo Mode's revisionReply gives. The server's `grading`
     (the revision in is being graded) reads as sent, as a draft regrade
     does in Demo Mode: a draft is never the student's to see. first_thumbs
     and thumbs are this device's blob: addresses of the two versions'
     pages (revisionPages), empty until they are fetched. */
  var REVISION_STATE = { open: 'open', sent: 'sent', grading: 'sent', returned: 'returned' };
  function realRevision(state, id, rv) {
    if (!rv || typeof rv !== 'object' || !REVISION_STATE[rv.state]) return null;
    var pages = ownRevisionPages(state, id, rv);
    return {
      state: REVISION_STATE[rv.state],
      what_to_fix: rv.what_to_fix,
      revise_by: rv.revise_by || null,
      criterion_ids: Array.isArray(rv.criterion_ids) ? rv.criterion_ids.slice() : [],
      keep_grade: true,
      grade_hidden: false,
      first_version: rv.first_version,
      first_sent_at: rv.first_sent_at,
      first_grade: rv.first_grade && typeof rv.first_grade === 'object' ? rv.first_grade : null,
      revision_version: rv.revision_version,
      revision_sent_at: rv.revision_sent_at,
      revision_note: rv.revision_note,
      revision_late: rv.revision_late,
      asked_at: rv.asked_at,
      first_thumbs: pages ? pages.first.slice() : [],
      thumbs: pages ? pages.revision.slice() : [],
    };
  }

  /* The `feedback` reply as the page reads it. Marks, reflections,
     revisions and Your Plan From Last Time. null while there is nothing to
     show: a class with no marks, no reflections and no revision asked for
     is drawn exactly as it was. */
  function realFeedbackOf(state) {
    var f = ownFeedback(state);
    if (!f) return null;
    var r = f.reply;
    var assessments = [];
    (Array.isArray(r.assessments) ? r.assessments : []).forEach(function (a) {
      if (!a || typeof a.id !== 'string') return;
      var marks =
        a.marks && typeof a.marks === 'object' ? { pages: a.marks.pages | 0, notes: a.marks.notes | 0 } : null;
      var reflection =
        r.reflect_on_feedback === true && a.reflection && typeof a.reflection === 'object' ? a.reflection : null;
      var revision = realRevision(state, a.id, a.revision);
      if (!marks && !reflection && !revision) return;
      assessments.push({ id: a.id, marks: marks, revision: revision, reflection: reflection });
    });
    return {
      ok: true,
      v: 1,
      reflect_on_feedback: r.reflect_on_feedback === true,
      show_my_learning: false,
      assessments: assessments,
      last_plan: r.reflect_on_feedback === true && r.last_plan && typeof r.last_plan === 'object' ? r.last_plan : null,
    };
  }

  // Worth keeping: something to show, or Reflect on Feedback on.
  function worthKeeping(r) {
    return (
      r.reflect_on_feedback === true ||
      r.assessments.some(function (a) {
        return a && (a.marks || (a.revision && typeof a.revision === 'object'));
      })
    );
  }

  /* ── Group work (S12-W1) ──────────────────────────────────────
     `group-work` once `feedback` has answered (both are Batch C's: a
     function without them is asked nothing more). The reply is kept on the
     page's state with the student it is for, only when it names a piece. */
  function ownGroups(state) {
    var g = state && state.realGroups;
    return g && state.page && g.student === state.page.student.id ? g : null;
  }
  function realGroupsOf(state) {
    var g = ownGroups(state);
    return g ? g.reply : null;
  }
  // Is piece `id` One per Group for this student? Its pages then come through `group-links`.
  function groupPiece(state, id) {
    var g = ownGroups(state);
    return !!(
      g &&
      g.reply.assessments.some(function (a) {
        return a && a.id === id;
      })
    );
  }
  function loadGroups(state, student) {
    return StudentPage.whileCurrent(answerOf('group-work', { enrollment_id: student })).then(function (res) {
      if (S !== state || !state.page || state.page.student.id !== student) return;
      var on = !!(
        res &&
        res.ok === true &&
        Array.isArray(res.assessments) &&
        res.assessments.some(function (a) {
          return a && typeof a.id === 'string';
        })
      );
      var had = !!ownGroups(state);
      state.realGroups = on ? { student: student, reply: res } : null;
      if (on || had) repaint();
    });
  }

  /* ── A revision's pages (S11-W1) ──────────────────────────────
     The first version's pages and the revision's, for Needs Revision and
     Before and After: `file-links` (`group-links` for a group piece) gives
     every handed-in page with its version; each thumbnail is fetched at
     once and shown from a blob: address, as s/send.js shows a Sent card's.
     Asked once for each version of a revision, and only for a piece with a
     revision asked for: a class with none is asked nothing. Kept on the
     page's state with the student they are for. */
  function revisionKey(rv) {
    return [rv.first_version || 1, rv.revision_version || '', rv.revision_sent_at || ''].join('|');
  }
  function ownRevisionPages(state, id, rv) {
    var all = state && state.realRevisionPages;
    if (!all || !state.page || all.student !== state.page.student.id) return null;
    var got = all.byId[id];
    return got && got.ready && got.key === revisionKey(rv) ? got : null;
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
  function loadRevisionPages(state, student) {
    var f = ownFeedback(state);
    if (!f) return Promise.resolve();
    if (!state.realRevisionPages || state.realRevisionPages.student !== student) {
      state.realRevisionPages = { student: student, byId: {} };
    }
    var byId = state.realRevisionPages.byId;
    var asks = [];
    (Array.isArray(f.reply.assessments) ? f.reply.assessments : []).forEach(function (a) {
      var rv = a && typeof a.id === 'string' && a.revision && typeof a.revision === 'object' ? a.revision : null;
      if (!rv || !REVISION_STATE[rv.state]) return;
      var key = revisionKey(rv);
      if (byId[a.id] && byId[a.id].key === key) return;
      var mine = { key: key, ready: false, first: [], revision: [] };
      byId[a.id] = mine;
      var route = groupPiece(state, a.id) ? 'group-links' : 'file-links';
      asks.push(
        StudentPage.whileCurrent(answerOf(route, { enrollment_id: student, assessment_id: a.id })).then(function (res) {
          if (byId[a.id] !== mine) return;
          var files = res && res.ok === true && Array.isArray(res.files) ? res.files : null;
          if (!files) {
            delete byId[a.id]; // asked again the next time
            return;
          }
          var first = Number(rv.first_version) || 1;
          var again = Number(rv.revision_version) || 0;
          var of = function (version) {
            return files
              .filter(function (x) {
                return (
                  x &&
                  typeof x.thumb_url === 'string' &&
                  /^https:\/\//.test(x.thumb_url) &&
                  Number(x.version) === version
                );
              })
              .sort(function (x, y) {
                return (Number(x.page) || 0) - (Number(y.page) || 0);
              });
          };
          var pick = of(first).concat(again ? of(again) : []);
          return StudentPage.whileCurrent(
            Promise.all(
              pick.map(function (x) {
                return picture(x.thumb_url);
              }),
            ),
          ).then(function (blobs) {
            if (byId[a.id] !== mine) return;
            pick.forEach(function (x, i) {
              var u = blobs[i] ? objectUrl(blobs[i]) : '';
              if (u) (Number(x.version) === first ? mine.first : mine.revision).push(u);
            });
            mine.ready = true;
            return true;
          });
        }),
      );
    });
    if (!asks.length) return Promise.resolve();
    return Promise.all(asks).then(function (done) {
      if (S !== state || !state.page || state.page.student.id !== student) return;
      if (
        done.some(function (x) {
          return x === true;
        })
      ) {
        repaint();
      }
    });
  }

  /* s/send.js, after a real card's revision went in or came back out, or
     pages were added to a group's work: what the page shows of it is asked
     again. A piece that is neither is asked nothing. `change` is what the
     route answered: the page's copy of the revision follows it at once. */
  function workChanged(id, change) {
    var state = S;
    if (!state || state.demo || !state.page) return Promise.resolve();
    var student = state.page.student.id;
    var f = ownFeedback(state);
    var a =
      f && Array.isArray(f.reply.assessments)
        ? f.reply.assessments.filter(function (x) {
            return x && x.id === id;
          })[0]
        : null;
    var rv = a && a.revision && typeof a.revision === 'object' ? a.revision : null;
    var asks = [];
    if (rv) {
      if (change && change.sent) {
        rv.state = 'sent';
        rv.revision_version = change.version || rv.revision_version || 2;
        rv.revision_sent_at = change.sent_at || rv.revision_sent_at;
        rv.revision_note = change.note || null;
        rv.revision_late = change.late === true;
      } else if (change && change.unsent) {
        rv.state = 'open';
        rv.revision_version = null;
        rv.revision_sent_at = null;
        rv.revision_note = null;
        rv.revision_late = null;
      }
      asks.push(loadFeedback(true));
    }
    if (groupPiece(state, id)) asks.push(loadGroups(state, student));
    return Promise.all(asks);
  }

  function repaint() {
    if (!S || S.screen !== 'assignments' || S.sendAsk) return;
    var el = typeof document !== 'undefined' ? document.activeElement : null;
    var sel = '';
    if (el && el.getAttribute && el.getAttribute('data-act')) {
      var piece = el.getAttribute('data-piece');
      sel =
        '[data-act="' +
        el.getAttribute('data-act') +
        '"]' +
        (piece ? '[data-piece="' + String(piece).replace(/["\\]/g, '') + '"]' : '');
    } else if (el && el.classList && el.classList.contains('sp-page-title')) {
      sel = '.sp-page-title';
    }
    StudentPage.paint();
    var back = sel && typeof document !== 'undefined' ? document.querySelector('#app ' + sel) : null;
    if (back && back.focus) back.focus({ preventScroll: true });
  }

  /* `feedback`, once the class's `work` has answered that it takes work
     (s/send.js's loadWork; Mark Up is a part of Send Work). A class that
     takes none, or a function without the route, is sent nothing more and
     the page stays as it was drawn. Once `feedback` has answered, the
     group's counts (`group-work`, S12-W1), then a revision's pages
     (S11-W1). `again`: only `feedback` and the pages, after a revision
     went in or came out. */
  function loadFeedback(again) {
    var state = S;
    if (!state || state.demo || !state.page) return Promise.resolve();
    var student = state.page.student.id;
    var work = state.realWork;
    if (!work || work.student !== student) return Promise.resolve();
    return StudentPage.whileCurrent(answerOf('feedback', { enrollment_id: student })).then(function (res) {
      if (S !== state || !state.page || state.page.student.id !== student) return;
      var on = !!(res && res.ok === true && Array.isArray(res.assessments) && worthKeeping(res));
      var had = !!ownFeedback(state);
      state.realFeedback = on ? { student: student, reply: res } : null;
      if (on || had) repaint();
      // A function from before Batch C (bad_request), or no answer: nothing more is asked.
      if (!res || res.ok !== true) return;
      return Promise.resolve(again === true ? null : loadGroups(state, student)).then(function () {
        if (S === state && on) return loadRevisionPages(state, student);
      });
    });
  }

  /* An answer the page has shown: `answer-seen` once, so the teacher's
     answer stops counting as new. Quiet: a failed ask is tried again the
     next time the answer is opened. */
  function feedbackSeen(ids) {
    var state = S;
    var f = ownFeedback(state);
    if (!f) return Promise.resolve();
    var student = f.student;
    var fresh = (Array.isArray(ids) ? ids : []).filter(function (id) {
      var a = (f.reply.assessments || []).filter(function (x) {
        return x && x.id === id;
      })[0];
      return !!(a && a.reflection && a.reflection.answer_new === true);
    });
    if (!fresh.length) return Promise.resolve();
    return StudentPage.whileCurrent(answerOf('answer-seen', { enrollment_id: student, assessment_ids: fresh })).then(
      function (res) {
        if (S !== state || ownFeedback(state) !== f || !res || res.ok !== true) return;
        f.reply.assessments.forEach(function (a) {
          if (a && a.reflection && fresh.indexOf(a.id) >= 0) a.reflection.answer_new = false;
        });
      },
    );
  }

  /* What `reflect` and `reply` answered, put into the page's copy so the
     screen shows it without asking again. Only while the page still
     belongs to the student the answer is for. */
  function keepReflection(state, student, id, route, res) {
    var f = ownFeedback(state);
    if (!f || f.student !== student || !res || res.ok !== true || !res.reflection) return;
    var list = f.reply.assessments;
    var a = list.filter(function (x) {
      return x && x.id === id;
    })[0];
    if (!a) list.push((a = { id: id, marks: null, revision: null, reflection: null }));
    var blank = {
      makes_sense: null,
      question: null,
      plan: null,
      went_well: null,
      sent_at: null,
      answer: null,
      answered_at: null,
      sense_now: null,
      follow_up: null,
      follow_up_answer: null,
      follow_up_answered_at: null,
      answer_new: false,
    };
    a.reflection = Object.assign(blank, a.reflection || {}, res.reflection);
    if (route === 'reflect' && a.reflection.plan) {
      f.reply.last_plan = { assessment_id: id, plan: a.reflection.plan, sent_at: a.reflection.sent_at };
    }
  }

  // A route's answer.
  function answerOf(route, body) {
    if (answerFn) return Promise.resolve(answerFn(route, body));
    if (!S) return Promise.resolve({ ok: false, error: 'network' });
    if (S.demo) return Promise.resolve(demoAnswer(route, body));
    var state = S;
    var student = body && body.enrollment_id;
    var id = body && body.assessment_id;
    return Promise.resolve(realAsk(route, body)).then(
      function (res) {
        if (route === 'reflect' || route === 'reply') keepReflection(state, student, id, route, res);
        return res;
      },
      function () {
        return { ok: false, error: 'network' };
      },
    );
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
    // The group's pages for a piece sent as One per Group (S12-W1); the student's own for any other.
    var links = !S.demo && groupPiece(S, id) ? 'group-links' : 'file-links';
    StudentPage.whileCurrent(Promise.all([answerOf(links, body), answerOf('markup', body)])).then(function (both) {
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
    });
  }

  function onClick(act, el) {
    if (!S) return;
    if (act === 'card-done' || act === 'class-open' || act === 'card-add') {
      S.work = '';
      S.workPages = null;
      S.realFeedback = null;
      S.realGroups = null;
      S.realRevisionPages = null;
      letGo();
      if (act === 'card-done') {
        S.demoReflections = null;
        S.demoRevisions = null;
      }
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

  /* `group_work` (Batch C; S12-F1): { ok, assessments: [ { id, members,
     sent, pages, you_sent, first_sent_at } ] } for each One per Group piece
     the student's group is on. Counts only: the server sends no group-mate's
     name, so neither does this. Demo Mode's (#demo-card-group): Cece's
     group of three on Cell Model Project, where a group-mate sent 4 photos
     yesterday; pages Cece sends are added to the group's. null otherwise.
     A real card's is what `group-work` answered (S12-W1), or null. */
  function groupOf(state) {
    if (state && !state.demo) return realGroupsOf(state);
    if (!state || !state.demo || !state.demoGroup || !rowOf(state, 'demo-cell-model')) return null;
    var mine = state.demoSent && state.demoSent['demo-cell-model'];
    return {
      ok: true,
      assessments: [
        {
          id: 'demo-cell-model',
          members: 3,
          sent: true,
          pages: 4 + (mine ? mine.pages.length : 0),
          you_sent: !!(mine && mine.pages.length),
          first_sent_at: at(-1, 19),
        },
      ],
    };
  }

  StudentPage.feedbackOf = feedbackOf;
  StudentPage.feedbackSeen = feedbackSeen;
  StudentPage.groupOf = groupOf;
  // s/send.js, after a real revision or group send went in or came out (S11-W1, S12-W1).
  StudentPage.workChanged = workChanged;
  // A real card's revision pages of piece `id`, as blob: addresses: { first, revision }, or null.
  StudentPage.revisionPages = function (state, id) {
    var f = ownFeedback(state);
    var a =
      f && Array.isArray(f.reply.assessments)
        ? f.reply.assessments.filter(function (x) {
            return x && x.id === id;
          })[0]
        : null;
    var got = a && a.revision ? ownRevisionPages(state, id, a.revision) : null;
    return got ? { first: got.first.slice(), revision: got.revision.slice() } : null;
  };
  // A real card's page opening: what the class takes (s/send.js), and then, if it takes work, `feedback`.
  var openedBefore = StudentPage.pageOpened;
  StudentPage.pageOpened = function () {
    var first = typeof openedBefore === 'function' ? openedBefore() : null;
    return Promise.resolve(first).then(loadFeedback);
  };
  // The sample's revisions, by piece (s/send.js sends a revision into them), or null off #demo-card-revise.
  StudentPage.demoRevisions = revisions;
  // The one way s/reflect.js asks `reflect` and `reply` (Demo Mode's answers until Batch C is wired).
  StudentPage.feedbackAsk = answerOf;

  StudentPage.addScreens({
    file: 'feedback',
    render: {},
    click: onClick,
    share: function (state) {
      // A new state is a sign-out: the last student's pictures go with it.
      if (state !== S) letGo();
      S = state;
    },
    test: {
      feedbackOf: feedbackOf,
      loadFeedback: loadFeedback,
      groupOf: groupOf,
      workChanged: workChanged,
      demoMarkup: function () {
        return DEMO_MARKUP;
      },
      demoReflections: function (state) {
        return reflections(state);
      },
      demoRevisions: revisions,
      // Tests answer `markup` and `file-links` themselves (to hold one, or fail it); null puts Demo Mode back.
      setFeedbackAnswer: function (fn) {
        answerFn = fn;
      },
    },
  });
})();
