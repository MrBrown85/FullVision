// @ts-check
/* report-wc-look.js — Write Comments: the student list says who needs a
   look and why (docs/plans/write-comments-plan.md, decision 10). The
   reasons come only from what the page already knows: the approve checks
   (an IE with no deadline, a sentence that no longer matches the
   gradebook), a habit sentence that disagrees with the missing work, four
   or more sentences shared with a classmate's comment, no next step in the
   comment, and Needs Approval. A student's reason is worked out once and
   kept until their comment, ratings or marks change; the others are filled
   in one at a time after the page is drawn. */
window.ReportWcLook = (function () {
  'use strict';

  var rq = /** @type {any} */ (null);
  var _seen = {};
  var _queue = [];
  var _timer = /** @type {any} */ (null);
  var _shared = { key: '', who: {} };

  function configure(host) {
    rq = host;
  }

  var NEXT_STEPS = /^(nextStep|goWords|home)$/;

  /* The classmate each student shares four or more sentences with. */
  function sharedWith() {
    var cid = rq.cid();
    var termId = rq.termId();
    var students = rq.students();
    var docs = students
      .map(function (s) {
        var r = getStudentTermRating(cid, s.id, termId) || {};
        return { sid: s.id, text: rq.plainComment(r.narrative || ''), names: rq.namesOf(s) };
      })
      .filter(function (d) {
        return d.text.trim();
      });
    var key = docs
      .map(function (d) {
        return d.sid + ':' + d.text.length + ':' + d.text.slice(-12);
      })
      .join('|');
    if (_shared.key === key) return _shared.who;
    var who = {};
    CommentBank.nearIdentical(docs, { cid: cid, min: 4 }).forEach(function (p) {
      var a = students.find(function (s) {
        return s.id === p.a;
      });
      var b = students.find(function (s) {
        return s.id === p.b;
      });
      if (a && b) {
        who[p.a] = who[p.a] || rq.firstName(b);
        who[p.b] = who[p.b] || rq.firstName(a);
      }
    });
    _shared = { key: key, who: who };
    return who;
  }

  /* The one reason a student needs a look, most pressing first; '' for none. */
  function work(st) {
    var cid = rq.cid();
    var termId = rq.termId();
    var r = getStudentTermRating(cid, st.id, termId) || {};
    var text = rq.plainComment(r.narrative || '').trim();
    var approved = !!r.approvedAt;
    if (!text) return '';
    var f = CommentBank.facts(cid, st, termId);
    if (CommentBank.reportPath(f) === 'ie' && !CommentBank.deadlineOk(cid, r.ieDeadline, rq.today()))
      return 'IE Needs a Date';
    if (approved && rq.flagged(st.id)) return 'Sentence Out of Date';
    var done = ((r.habits || {}).completes || 0) >= 3 && f.notHandedIn && f.notHandedIn.count > 0;
    if (done && /\bhands?\s+in\b/i.test(text)) return 'Habits and Missing Work Disagree';
    var twin = sharedWith()[st.id];
    if (twin) return 'Same as ' + twin;
    var meta = r.draftMeta;
    if (meta && Array.isArray(meta.sentences) && meta.sentences.length) {
      var has = meta.sentences.some(function (x) {
        return NEXT_STEPS.test(x.step || '');
      });
      if (!has) return 'No Next Step';
    }
    return '';
  }

  function keyOf(st) {
    var cid = rq.cid();
    var r = getStudentTermRating(cid, st.id, rq.termId()) || {};
    return [
      st.id,
      rq.termId(),
      String(r.narrative || '').length,
      r.approvedAt || '',
      JSON.stringify(r.habits || {}),
      rq.scoreKey(),
      _shared.key,
    ].join('|');
  }

  function drain() {
    _timer = null;
    var st = _queue.shift();
    if (st) {
      try {
        _seen[st.id] = { key: keyOf(st), v: work(st) };
      } catch (e) {
        // The class or report changed under it: the next drawing asks again.
      }
    }
    if (_queue.length) _timer = setTimeout(drain, 0);
    else {
      try {
        rq.syncRoster();
      } catch (e) {
        // The page is gone: nothing to draw.
      }
    }
  }

  /* What is known now for a student; an unknown one is worked out soon. */
  function reason(st) {
    var hit = _seen[st.id];
    var k = keyOf(st);
    if (hit && hit.key === k) return hit.v;
    if (
      !_queue.some(function (x) {
        return x.id === st.id;
      })
    )
      _queue.push(st);
    if (!_timer) _timer = setTimeout(drain, 0);
    return hit ? hit.v : '';
  }

  /* The plain state under a name when there is no reason to look: no comment, or not yet approved. */
  function basic(sid) {
    var r = getStudentTermRating(rq.cid(), sid, rq.termId()) || {};
    if (!rq.plainComment(r.narrative || '').trim()) return 'No Comment';
    return r.approvedAt ? '' : 'Needs Approval';
  }

  function reset() {
    _seen = {};
    _queue = [];
  }

  return { configure: configure, reason: reason, basic: basic, reset: reset };
})();
