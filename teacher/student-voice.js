/* What a student has told their teacher through questionnaires
   (docs/STUDENT-VOICE-PLAN.md, PR 8): About Me, the reporting-period
   reflections and the Goal Check-Ins, read for the Learner Profile.

   A signed-in class reads list_course_responses alongside its
   questionnaires (teacher/questionnaires.js). Demo Mode reads the same
   shapes from this device (gb-responses-<cid>, seeded by
   shared/seed-data.js). entries() gives one student's submissions, newest
   first, each with every question in order and the answer to it (or none),
   so a blank shows as "No answer" rather than vanishing. profile() picks out
   what the Learner Profile places by name: how to say their name, the
   languages, how they learn best, the course goal, the private note. */
var StudentVoice = (function () {
  'use strict';

  var _resp = {}; // cid -> {questionnaire id: {enrollment id: [response]}}
  var _loading = {};

  function _demo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }

  function _readLocal(cid) {
    try {
      var v = JSON.parse(localStorage.getItem('gb-responses-' + cid) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }

  /* Demo Mode reads this device every time (nothing to wait for, and the
     demo seed may land after the first draw). */
  function loaded(cid) {
    if (_demo()) {
      Questionnaires.load(cid);
      return true;
    }
    return Object.prototype.hasOwnProperty.call(_resp, cid) && Questionnaires.loaded(cid);
  }

  /* Reads the class's questionnaires and answers once; onChange when they
     arrive. */
  function load(cid, onChange) {
    if (!cid) return Promise.resolve();
    if (_demo()) {
      return Questionnaires.load(cid).then(function () {
        _resp[cid] = _readLocal(cid);
      });
    }
    if (_loading[cid]) return _loading[cid];
    var v2 = window.v2 || {};
    _loading[cid] = Promise.all([
      Questionnaires.load(cid),
      v2.listCourseResponses
        ? v2.listCourseResponses(cid).then(function (res) {
            _resp[cid] = (res && res.data) || {};
          })
        : Promise.resolve(),
    ]).then(function () {
      delete _loading[cid];
      if (!Object.prototype.hasOwnProperty.call(_resp, cid)) _resp[cid] = {};
      if (onChange) onChange(cid);
    });
    return _loading[cid];
  }

  function _has(v) {
    if (!v) return false;
    if (v.num != null) return true;
    if (v.text != null && String(v.text).trim() !== '') return true;
    var j = v.json;
    if (Array.isArray(j))
      return j.some(function (x) {
        return String(x || '').trim() !== '';
      });
    return !!(j && typeof j === 'object' && Object.keys(j).length);
  }

  /* One student's submissions, newest first: {qid, kind, title, theme,
     report_period, at, items: [{q, v}]} with every live question in order
     (v null when skipped), then any answer to a question since removed. */
  function entries(cid, enrollmentId) {
    if (_demo()) Questionnaires.load(cid);
    var byQ = _demo() ? _readLocal(cid) : _resp[cid] || {};
    var out = [];
    Questionnaires.list(cid).forEach(function (q) {
      var mine = (byQ[q.id] && byQ[q.id][enrollmentId]) || [];
      mine.forEach(function (r) {
        var answers = r.answers || {};
        var seen = {};
        var items = (q.questions || []).map(function (x) {
          seen[x.id] = true;
          var v = answers[x.id];
          return { q: x, v: _has(v) ? v : null };
        });
        Object.keys(answers).forEach(function (id) {
          if (seen[id] || !_has(answers[id])) return;
          items.push({
            q: { id: id, prompt: 'A question since removed', kind: 'text', options: {}, core_ids: [] },
            v: answers[id],
          });
        });
        out.push({
          qid: q.id,
          rid: r.id,
          kind: q.kind,
          title: q.title,
          theme: q.theme,
          report_period: q.report_period,
          at: r.submitted_at,
          items: items,
        });
      });
    });
    return out.sort(function (a, b) {
      return String(b.at || '').localeCompare(String(a.at || ''));
    });
  }

  function _find(items, pred) {
    for (var i = 0; i < items.length; i++) if (pred(items[i].q)) return items[i];
    return null;
  }

  /* The Goal Check-In's parts by position, as the phone groups them: the
     goal status and the question after it (the next step); the Core
     Competency pick and the two after it (the goal, this week's step). */
  function _checkin(entry) {
    if (!entry) return null;
    var items = entry.items;
    var out = { at: entry.at, status: null, next: null, core: null, coreGoal: null, coreStep: null };
    for (var i = 0; i < items.length; i++) {
      var k = items[i].q.kind;
      if (k === 'goal_status') {
        out.status = items[i];
        if (items[i + 1] && items[i + 1].q.kind === 'text') out.next = items[i + 1];
      } else if (k === 'core_pick') {
        out.core = items[i];
        if (items[i + 1] && items[i + 1].q.kind === 'text') out.coreGoal = items[i + 1];
        if (items[i + 2] && items[i + 2].q.kind === 'text') out.coreStep = items[i + 2];
      }
    }
    return out;
  }

  /* What the Learner Profile places by name. Everything else in About Me
     comes back in `about.rest` so no answer goes unshown. */
  function profile(list) {
    var about = list.find(function (e) {
      return e.kind === 'about_me';
    });
    var a = null;
    if (about) {
      var items = about.items;
      var used = {};
      var take = function (pred) {
        var it = _find(items, function (q) {
          return !used[q.id] && pred(q);
        });
        if (it) used[it.q.id] = true;
        return it;
      };
      a = {
        at: about.at,
        say: take(function (q) {
          return q.kind === 'text' && /say your name/i.test(q.prompt || '');
        }),
        languages: take(function (q) {
          return q.kind === 'choice' && (q.options || {}).other;
        }),
        learns: take(function (q) {
          return q.kind === 'choice' && (q.options || {}).multiple === false;
        }),
        goodAt: take(function (q) {
          return q.repeated_key === 'good_at';
        }),
        hard: take(function (q) {
          return q.repeated_key === 'hard';
        }),
        goal: take(function (q) {
          return q.repeated_key === 'better_at';
        }),
        outside: take(function (q) {
          return q.kind === 'text' && /outside school/i.test(q.prompt || '');
        }),
        note: take(function (q) {
          return q.teacher_only;
        }),
      };
      a.rest = items.filter(function (it) {
        return !used[it.q.id];
      });
    }
    var checkins = list.filter(function (e) {
      return e.kind === 'goal_checkin';
    });
    // The latest reply to a report: kept or changed their goal, and the next step.
    var replyEntry = list.find(function (e) {
      return e.kind === 'report_reply';
    });
    var reply = null;
    if (replyEntry) {
      reply = { at: replyEntry.at, title: replyEntry.title, rid: replyEntry.rid, choice: null, next: null };
      replyEntry.items.forEach(function (it) {
        if (it.q.kind === 'choice' && /goal/i.test(it.q.prompt || '')) reply.choice = it;
        else if (it.q.kind === 'text' && /before the next report/i.test(it.q.prompt || '')) reply.next = it;
      });
    }
    return {
      about: a,
      checkin: _checkin(checkins[0]),
      reply: reply,
      reflections: list.filter(function (e) {
        return e.kind === 'core_reflection' || e.kind === 'report_reply';
      }),
      last: list[0] ? list[0].at : null,
    };
  }

  function _reset() {
    _resp = {};
    _loading = {};
  }

  return { load: load, loaded: loaded, entries: entries, profile: profile, _reset: _reset };
})();
if (typeof window !== 'undefined') window.StudentVoice = StudentVoice;
