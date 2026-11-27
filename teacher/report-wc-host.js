// @ts-check
/* report-wc-host.js — Write Comments: what the page asks of the main file
   (teacher/report-questionnaire.js). The main file keeps the comment's
   rows, saves them and checks them; it hands over the few of its own
   functions this file needs (make), and gets back the host the page's
   modules (ReportWc, ReportWcDraw, ReportWcComment) are configured with.
   What a press does to the rows is here: put a sentence in, take one out,
   move one, word it another way. Nothing here words a grade or reads a
   mark. */
window.ReportWcHost = (function () {
  'use strict';

  var P = ReportWcParts;

  /* What the main file already has, passed through. */
  function passThrough(rq, h) {
    h.current = rq.current;
    h.facts = rq.facts;
    h.box = rq.box;
    h.fitBox = rq.fitBox;
    h.rows = rq.rowsFor;
    h.isBest = rq.isBest;
    h.isRequired = rq.isRequired;
    h.justAdded = rq.justAdded;
    h.rowFromSentence = rq.rowFromSentence;
    h.insertRow = rq.insertRow;
    h.typedRow = rq.typedRow;
    h.snapshot = rq.snapshot;
    h.undoToast = rq.undoToast;
    h.saveNarrative = rq.saveNarrative;
    h.openBrowse = rq.openBrowse;
    h.claimHtml = rq.claimHtml;
    h.pieces = rq.pieces;
    h.glanceChange = rq.glanceChange;
    h.glanceRows = rq.glanceRows;
    h.habitValue = rq.habitValue;
    h.voiceRows = rq.voiceRows;
    h.wordsAnswers = rq.wordsAnswers;
    h.wordsSentence = rq.wordsSentence;
    h.wordsRow = function (st, a, frame) {
      return rq.wordsRow(st, a, frame);
    };
    h.addClose = rq.addClose;
    h.meetingRowAt = rq.meetingRowAt;
    h.first = rq.first;
    h.closeNext = rq.closeNext;
    h.pieceMark = rq.pieceMark;
  }

  /* What the facts and the class have, read for one student. */
  function readers(rq, h) {
    var cid = rq.cid;
    h.cid = cid;
    h.ctx = function (st, f) {
      return rq.ctx(cid(), st, f);
    };
    h.alternatives = function (row, ctx, usage, taken, n) {
      return rq.alternatives(row, ctx, usage, taken, null, n);
    };
    h.picks = function (st, f) {
      return rq.picks(cid(), st, f);
    };
    h.usageMap = function (st) {
      return rq.usage(cid(), st);
    };
    h.lastIds = function (st) {
      var s = st || rq.current();
      return s ? rq.lastTermIds(cid(), s.id, rq.termId()) : [];
    };
    h.claims = function (st) {
      return rq.claimChanges(st);
    };
    h.ownBox = function (ri) {
      var o = rq.own();
      return o && o.where === 'row' && o.index === ri ? rq.ownBoxHtml(rq.current()) : '';
    };
    h.pronounNote = function (row, ri) {
      var st = rq.current();
      var note = st ? rq.pronounNote(row, rq.pronounCheckFor(st, rq.facts(st))) : false;
      return note
        ? `<span class="qn-pron-note" title="The student’s pronouns changed after you wrote this sentence. Check its pronouns.">Pronouns changed · <button type="button" class="qn-thin-link" data-action="tqSentences" data-do="pronounOk" data-row="${ri}">Dismiss</button></span>`
        : '';
    };
  }

  /* What the gradebook and the record have. */
  function record(rq, h) {
    var cid = rq.cid;
    h.gradeText = function (st, f) {
      return rq.headerGrade(cid(), st.id, f, rq.termId()).big;
    };
    h.gradeNote = function (st, f) {
      return rq.headerGrade(cid(), st.id, f, rq.termId()).small || '';
    };
    h.habitsStored = function (st) {
      return (getStudentTermRating(cid(), st.id, rq.termId()) || {}).habits || {};
    };
    h.attendance = function (st) {
      return getTermAttendance(cid(), st.id, rq.termId());
    };
    h.studentObs = function (st) {
      return rq.studentObs(cid(), st.id);
    };
    h.missingAndLate = function (st) {
      return rq.missingAndLate(cid(), st.id);
    };
    h.fitCount = function (partId, ctx) {
      var part = rq.PARTS.find(function (p) {
        return p.id === partId;
      });
      return part ? rq.fitCount(part, ctx) : 0;
    };
    h.factsKey = function () {
      var st = rq.current();
      return st
        ? [rq.termId(), rq.scoreKey(), JSON.stringify(h.habitsStored(st)), JSON.stringify(h.attendance(st))].join('|')
        : '';
    };
    h.sentenceCount = function (t) {
      return rq.sentencesOf(t).length || 1;
    };
    h.nothingFits = function () {
      if (typeof showUndoToast === 'function')
        showUndoToast('No other sentence fits.', function () {}, undefined, 3000);
    };
    h.savePick = function (patch) {
      var st = rq.current();
      if (st) upsertTermRating(cid(), st.id, rq.termId(), patch);
    };
  }

  /* ── Changing the rows ───────────────────────────────────── */
  function changers(rq, h) {
    /* The rows set, written to the comment and saved. mark: a row to tint
       as just added; toast: an Undo for the change (the comment as it was). */
    h.setRows = function (st, rows, mark, toast) {
      rq.saveNow();
      var snap = toast ? rq.snapshot(st) : null;
      rq.setRows(st, rows, !!mark || !!toast);
      if (mark) rq.markAdded(st, mark);
      rq.writeRows(st);
      if (toast) rq.undoToast(st, toast, snap);
    };
    h.pickPiece = function (st, ri, aid) {
      var snap = rq.snapshot(st);
      rq.repick(st, ri, { mentionAssessments: [aid] });
      rq.undoToast(st, 'Named instead.', snap);
    };
    h.useWording = function (st, ri, id, ctx) {
      rq.saveNow();
      var rows = rq.rowsFor(st, rq.facts(st)).slice();
      var row = rows[ri];
      var m = /^words:(\w+):([01])$/.exec(String(id));
      var next = null;
      if (m) {
        var a = rq.wordsAnswers(rq.facts(st)).find(function (x) {
          return x.key === (m || [])[1];
        });
        next = a ? rq.wordsRow(st, a, Number(m[2])) : null;
      } else {
        var s = rq.bankById(id);
        next = s && row ? rq.rowFromSentence(s, ctx, row.step, ri === 0) : null;
      }
      if (!next || !row) return;
      rows[ri] = next;
      h.setRows(st, rows, null, '');
    };
    h.applyEdit = function (st, orig, next) {
      rq.applyEdit(st, orig, next);
    };
    h.alignNow = function () {
      rq.alignNow(true);
    };

    /* A row for a class line: the support line the student has, the class's
       closing sentence or late-work line, as typed. */
  }

  /* Class lines and the wordings of a row. */
  function wordings(rq, h) {
    var cid = rq.cid;
    h.classLineRow = function (st, f, kind) {
      var text = '';
      var step = { support: 'support', closing: 'closer', late: 'lateWork', lang: 'languageGoals' }[kind];
      var ctx = rq.ctx(rq.cid(), st, f);
      if (kind === 'support') text = ctx.supportLine;
      else if (kind === 'closing') text = ctx.closingLine;
      else if (kind === 'late') text = ctx.lateLine;
      else if (kind === 'lang')
        text = ctx.languageGoalLine ? CommentBank.fill({ text: ctx.languageGoalLine }, ctx) : '';
      return text && step ? rq.classRow(step, text) : null;
    };

    /* Another wording of row i that opens with a different word, used for
       Vary Them; null when the bank has none. */
    h.otherOpening = function (st, f, rows, i, word) {
      var row = rows[i];
      if (!row || !row.s || row.edited || !row.step) return null;
      var ctx = rq.ctx(rq.cid(), st, f);
      var taken = {};
      rows.forEach(function (r) {
        taken[r.id] = true;
      });
      var alts = h.alternatives(row, ctx, rq.usage(cid(), st), taken, 12);
      for (var k = 0; k < alts.length; k++) {
        var made = rq.rowFromSentence(alts[k], ctx, row.step, false);
        if (P.firstWord(made.text) !== word) return made;
      }
      return null;
    };
  }

  /* The pieces beside the boxes and the class's lines. */
  function pieces(rq, h) {
    h.headerHtml = function (st, f, q) {
      return ReportWcCard.header(rq, st, f, q);
    };
    h.habitSlider = function (key) {
      return ReportWcCard.slider(rq, key);
    };
    h.attFields = function () {
      var st = rq.current();
      return (
        '<span class="wc-fact-main"><span class="wc-fact-name">Attendance So Far This Year</span></span>' +
        ReportWcCard.attendance(rq, st, rq.facts(st))
      );
    };
    h.obsHtml = function () {
      var st = rq.current();
      return ReportWcCard.observations(rq, st, rq.facts(st));
    };
    h.commentParts = function (c, st, f) {
      return ReportWcCard.parts(rq, c, st, f);
    };
    h.habitNote = function (st, rows) {
      return ReportWcCard.habitNote(rq, st, rows);
    };
    h.keepHabitNote = function () {
      rq.keepHabitNote(rq.current());
    };
    h.classFacts = function (st, f, mine, line) {
      return ReportWcClass.facts(rq, st, f, mine, line);
    };
    h.requiredHtml = function (st, f, rows, path, key) {
      return ReportWcClass.required(rq, st, f, rows, path, key);
    };
  }

  function make(rq) {
    var h = {};
    passThrough(rq, h);
    readers(rq, h);
    record(rq, h);
    changers(rq, h);
    wordings(rq, h);
    pieces(rq, h);
    return h;
  }

  return { make: make };
})();
