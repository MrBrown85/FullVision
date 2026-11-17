/* split-scan-model.js — Split a Scan on the phone: the parts with no DOM (B7).

   The phone's Split a Scan (teacher-mobile/split-scan.js) does what the
   desktop's Split the Scan and Add Work for the Class do. The scan's model,
   the name matching, the staging and the run are the desktop's own
   modules, loaded on the phone as they are:
   - AddWorkSplitModel (teacher/add-work-split-model.js): the pages, the
     blank ones, the cuts, the names, matches() for the name box;
   - AddWorkSplit.read and .refusal (teacher/add-work-split.js): the scan
     read into pages, each renamed page-N.jpg and measured for blankness;
   - AddWorkClass.offered and .students (teacher/add-work-class.js): which
     pieces offer it, and who is listed;
   - AddWorkStage (teacher/add-work-stage.js): one student, one write.
   This file holds only what the phone adds: which assessment comes first,
   what Return in a name box takes, the stage built from the named pieces,
   and the pieces taken off the scan once their students' work is added.

   MSplitScanModel.assessments(cid)          the pieces offered, most Not In first.
   MSplitScanModel.typed(list, text)         what Return takes.
   MSplitScanModel.stageFor(cid, aid, m, list, choices)  the named pieces staged.
   MSplitScanModel.settle(m, sent)           the added students' pieces leave the scan. */

window.MSplitScanModel = (function () {
  'use strict';

  function _offered(cid, a) {
    return !!window.AddWorkClass && AddWorkClass.offered(cid, a);
  }

  function _students(cid, a) {
    return window.AddWorkClass ? AddWorkClass.students(cid, a) : sortStudents(getStudents(cid) || [], 'lastName');
  }

  function _sub(cid, sid, aid) {
    return typeof getStudentSubmission === 'function' ? getStudentSubmission(cid, sid, aid) : null;
  }

  /* The assessments this class offers Add Work for the Class on, as the
     desktop offers it (AddWorkClass.offered), each with how many of its
     listed students have nothing in. Most Not In first; then the latest
     due date; then the title. → [{ a, notIn, students }]. */
  function assessments(cid) {
    if (!cid || typeof getAssessments !== 'function') return [];
    var out = [];
    (getAssessments(cid) || []).forEach(function (a, i) {
      if (!_offered(cid, a)) return;
      var list = _students(cid, a) || [];
      var notIn = list.filter(function (st) {
        return !_sub(cid, st.id, a.id);
      }).length;
      out.push({ a: a, notIn: notIn, students: list.length, i: i });
    });
    out.sort(function (x, y) {
      if (y.notIn !== x.notIn) return y.notIn - x.notIn;
      var dx = String(x.a.date || '');
      var dy = String(y.a.date || '');
      if (dx !== dy) return dx < dy ? 1 : -1;
      return x.i - y.i;
    });
    return out.map(function (r) {
      return { a: r.a, notIn: r.notIn, students: r.students };
    });
  }

  /* Return in a name box: a student only when the letters fit exactly one
     listed student (a match is taken only when it is certain; anything
     else is offered as buttons to tap). Empty text takes no one. → the
     student's id, or ''. */
  function typed(list, text) {
    var all = AddWorkSplitModel.matches(list || [], text, {});
    return all.length === 1 ? all[0].id : '';
  }

  function _had(sub) {
    if (!sub) return 'none';
    return sub.on_paper ? 'paper' : 'work';
  }

  /* The named pieces of the scan, placed on their students in a new stage
     (AddWorkStage.stage), in the class list's order. choices: sid → the
     teacher's choice for a student who already has work ('add', 'replace',
     'skip'), kept while the screen is open. → { stage, placed: [sid],
     refused: [sid], firsts: { staged piece id: its first page's number } }:
     refused when a student's pieces would pass 30 pages. */
  function stageFor(cid, aid, m, list, choices) {
    choices = choices || {};
    var stage = AddWorkStage.stage(
      (list || []).map(function (st) {
        return { id: st.id, had: _had(_sub(cid, st.id, aid)) };
      }),
    );
    var placed = [];
    var refused = [];
    var firsts = {};
    m.pieces().forEach(function (p) {
      if (!p.sid) return;
      var res = stage.place(p.sid, {
        from: 'Scan, ' + (p.first === p.last ? 'page ' + p.first : 'pages ' + p.first + '–' + p.last),
        pages: p.nos.map(function (no) {
          return m.page(no).page;
        }),
      });
      if (res.ok) {
        firsts[res.piece.id] = p.first;
        if (placed.indexOf(p.sid) < 0) placed.push(p.sid);
      } else if (refused.indexOf(p.sid) < 0) refused.push(p.sid);
    });
    placed.forEach(function (sid) {
      var c = choices[sid];
      if (c && stage.choices(sid).indexOf(c) >= 0) stage.choose(sid, c);
    });
    return { stage: stage, placed: placed, refused: refused, firsts: firsts };
  }

  /* After Add Work: the pieces of the students whose work was added
     (sent: sid → true) leave the scan, with the blank pages between them;
     every other piece keeps its name. → the page numbers that left. */
  function settle(m, sent) {
    sent = sent || {};
    var keep = [];
    var any = false;
    m.pieces().forEach(function (p) {
      if (!p.sid) return;
      if (sent[p.sid]) any = true;
      else keep.push({ first: p.first, sid: p.sid });
    });
    if (!any) return [];
    var before = m.pages().map(function (pg) {
      return pg.no;
    });
    // Only the added students' pieces are named while they are taken.
    keep.forEach(function (k) {
      var p = _pieceAt(m, k.first);
      if (p) m.name(p.at, '');
    });
    m.take();
    keep.forEach(function (k) {
      var p = _pieceAt(m, k.first);
      if (p) m.name(p.at, k.sid);
    });
    var now = {};
    m.pages().forEach(function (pg) {
      now[pg.no] = true;
    });
    return before.filter(function (no) {
      return !now[no];
    });
  }

  function _pieceAt(m, first) {
    return (
      m.pieces().find(function (p) {
        return p.first === first;
      }) || null
    );
  }

  return { assessments: assessments, typed: typed, stageFor: stageFor, settle: settle };
})();
