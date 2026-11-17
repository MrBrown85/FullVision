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
  var _at = {}; // cid -> when the answers were last read

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
      _at[cid] = Date.now();
      if (!Object.prototype.hasOwnProperty.call(_resp, cid)) _resp[cid] = {};
      if (onChange) onChange(cid);
    });
    return _loading[cid];
  }

  /* Reads the answers again when they are older than `ms`, so a student's
     answer sent since shows when the teacher opens the page again. */
  function refreshIfStale(cid, ms, onChange) {
    if (!cid || _demo() || _loading[cid] || !loaded(cid)) return false;
    if (_at[cid] && Date.now() - _at[cid] < ms) return false;
    // load() reads the questionnaires again too, with their answered lists.
    load(cid, onChange);
    return true;
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

  /* A class's answers to one questionnaire: {enrollment id: the student's
     newest submission}, as list_course_responses gives them (Demo Mode:
     this device). See Answers counts these. */
  function responses(cid, qid) {
    if (_demo()) Questionnaires.load(cid);
    var byQ = _demo() ? _readLocal(cid) : _resp[cid] || {};
    var mine = byQ[qid] || {};
    var out = {};
    Object.keys(mine).forEach(function (eid) {
      var subs = (Array.isArray(mine[eid]) ? mine[eid] : []).slice().sort(function (a, b) {
        return String(b.submitted_at || '').localeCompare(String(a.submitted_at || ''));
      });
      if (subs[0]) out[eid] = subs[0];
    });
    return out;
  }

  /* One student's submissions, newest first: {qid, kind, title, theme,
     report_period, at, items: [{q, v}]} with every live question in order
     (v null when skipped), then any answer to a question since removed
     (with its words when the list still carries it, archived). */
  function entries(cid, enrollmentId) {
    if (_demo()) Questionnaires.load(cid);
    var byQ = _demo() ? _readLocal(cid) : _resp[cid] || {};
    var out = [];
    Questionnaires.list(cid).forEach(function (q) {
      var mine = (byQ[q.id] && byQ[q.id][enrollmentId]) || [];
      mine.forEach(function (r) {
        var answers = r.answers || {};
        var seen = {};
        var gone = {};
        var items = [];
        (q.questions || []).forEach(function (x) {
          if (x.archived) {
            gone[x.id] = x;
            return;
          }
          seen[x.id] = true;
          var v = answers[x.id];
          items.push({ q: x, v: _has(v) ? v : null });
        });
        Object.keys(answers).forEach(function (id) {
          if (seen[id] || !_has(answers[id])) return;
          items.push({
            q: gone[id] || { id: id, prompt: 'A question since removed', kind: 'text', options: {}, core_ids: [] },
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
          period: _period(cid, q),
          at: r.submitted_at,
          items: items,
        });
      });
    });
    return out.sort(function (a, b) {
      return String(b.at || '').localeCompare(String(a.at || ''));
    });
  }

  // A Goal Check-In belongs to the reporting period of the reflection it follows.
  function _period(cid, q) {
    if (q.report_period != null) return q.report_period;
    if (!q.parent_id) return null;
    var parent = Questionnaires.list(cid).find(function (p) {
      return p.id === q.parent_id;
    });
    return parent && parent.report_period != null ? parent.report_period : null;
  }

  /* The Core Competencies as the student answered them for one reporting
     period: {COL: {level, text, goal, at}}. The step and why come from the
     reflection's self-assessment, the goal from the Goal Check-In's
     competency pick; a newer answer replaces an older one. */
  function coreSelf(list, period) {
    var out = {};
    var slot = function (k, at) {
      if (!out[k]) out[k] = { level: null, text: '', goal: '', at: at, fromStudent: true };
      if (String(at || '') > String(out[k].at || '')) out[k].at = at;
      return out[k];
    };
    list
      .filter(function (e) {
        return e.period === period && (e.kind === 'core_reflection' || e.kind === 'goal_checkin');
      })
      .slice()
      .reverse()
      .forEach(function (e) {
        if (e.kind === 'core_reflection') {
          e.items.forEach(function (it) {
            if (it.q.kind !== 'scale4' || !it.v) return;
            var j = it.v.json || {};
            var levels = j.levels || {};
            var why = j.why && typeof j.why === 'object' ? j.why : {};
            (it.q.core_ids || []).forEach(function (k) {
              if (!levels[k] && !why[k]) return;
              var o = slot(k, e.at);
              if (levels[k]) o.level = Number(levels[k]);
              if (why[k]) o.text = String(why[k]);
            });
          });
        } else {
          var c = _checkin(e);
          var pick = c && c.core && c.core.v ? String(c.core.v.text || '').trim() : '';
          var goal = c && c.coreGoal && c.coreGoal.v ? String(c.coreGoal.v.text || '').trim() : '';
          if (pick && goal) slot(pick, e.at).goal = goal;
        }
      });
    return out;
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
    return {
      about: a,
      checkin: _checkin(checkins[0]),
      // The Core Competency reflections and the ones a teacher built.
      reflections: list.filter(function (e) {
        return e.kind === 'core_reflection' || e.kind === 'custom';
      }),
      last: list[0] ? list[0].at : null,
    };
  }

  /* ── An answer in words (docs/plans/reflect-plan.md, the data contract) ──
     The reflection a teacher builds asks in kinds the ready-made ones don't:
     a rating, a date, a ranking, a grid of statements. answerText says any
     answer as plain text, one line per part: "4 of 5 (Could Teach It)",
     "November 20, 2026", "1. Labs" on its own line, "statement: choice" per
     statement. A kind it doesn't know says whatever was stored. These are
     the student's own words and self-ratings, never a grade. */

  function dateWords(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return String(iso || '');
    var t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return isNaN(t) ? String(iso) : t.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function _str(x) {
    return x == null ? '' : String(x).trim();
  }

  // The levels a rating has: a whole number 2 to 10, 5 when absent.
  function ratingLevels(q) {
    var n = Number(((q && q.options) || {}).levels);
    return Number.isInteger(n) && n >= 2 && n <= 10 ? n : 5;
  }

  // A rating's number: value_num, or the stored text when it is one.
  function ratingOf(v) {
    if (!v) return null;
    var n = v.num != null ? Number(v.num) : Number(_str(v.text));
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  // A ranking's order: value_json, or "1. A · 2. B" read back.
  function rankingOf(v) {
    if (!v) return [];
    if (Array.isArray(v.json)) return v.json.map(_str).filter(Boolean);
    return _str(v.text)
      .split(/\s*·\s*/)
      .map(function (p) {
        return p.replace(/^\d+\.\s*/, '').trim();
      })
      .filter(Boolean);
  }

  // A grid's answers, {statement: choice}: value_json, or "s: c · …" read back.
  function likertOf(v) {
    if (!v) return {};
    var j = v.json;
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    var out = {};
    _str(v.text)
      .split(/\s*·\s*/)
      .forEach(function (p) {
        var at = p.lastIndexOf(':');
        if (at > 0) out[p.slice(0, at).trim()] = p.slice(at + 1).trim();
      });
    return out;
  }

  function _anyText(v) {
    if (!v) return '';
    if (v.text != null && _str(v.text)) return String(v.text);
    var j = v.json;
    if (Array.isArray(j)) return j.map(_str).filter(Boolean).join(', ');
    if (j && typeof j === 'object')
      return Object.keys(j)
        .map(function (k) {
          var x = j[k];
          return k + ': ' + (x && typeof x === 'object' ? JSON.stringify(x) : _str(x));
        })
        .join('\n');
    return v.num != null ? String(v.num) : '';
  }

  function answerText(q, v) {
    if (!v || !q) return '';
    var o = q.options || {};
    switch (q.kind) {
      case 'section':
        return '';
      case 'rating': {
        var n = ratingOf(v);
        if (n == null) return _anyText(v);
        var levels = ratingLevels(q);
        var end = n === levels ? _str(o.high) : n === 1 ? _str(o.low) : '';
        return n + ' of ' + levels + (end ? ' (' + end + ')' : '');
      }
      case 'date':
        return dateWords(_str(v.text));
      case 'ranking':
        return rankingOf(v)
          .map(function (c, i) {
            return i + 1 + '. ' + c;
          })
          .join('\n');
      case 'likert': {
        var got = likertOf(v);
        var order = (Array.isArray(o.statements) ? o.statements : []).filter(function (s) {
          return Object.prototype.hasOwnProperty.call(got, s);
        });
        Object.keys(got).forEach(function (s) {
          if (order.indexOf(s) < 0) order.push(s);
        });
        return order
          .map(function (s) {
            return s + ': ' + _str(got[s]);
          })
          .join('\n');
      }
      case 'choice':
        if (Array.isArray(v.json)) return v.json.map(_str).filter(Boolean).join(', ');
        return _anyText(v);
      default:
        return _anyText(v);
    }
  }

  function _reset() {
    _resp = {};
    _loading = {};
    _at = {};
  }

  return {
    load: load,
    loaded: loaded,
    refreshIfStale: refreshIfStale,
    entries: entries,
    responses: responses,
    hasAnswer: _has,
    answerText: answerText,
    dateWords: dateWords,
    ratingLevels: ratingLevels,
    ratingOf: ratingOf,
    rankingOf: rankingOf,
    likertOf: likertOf,
    profile: profile,
    coreSelf: coreSelf,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.StudentVoice = StudentVoice;
