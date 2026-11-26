// @ts-check
/* rubric-comments.js: the Comment Bank per rubric (docs/plans/comment-bank-plan.md).
 *
 * A criterion keeps comments per level (criterion.comments: [{ level, text }]) and a
 * rubric keeps overall comments (rubric.overallComments: [text]). A text may hold the
 * slot [Name], filled with the student's first name when used.
 *
 * Most of this is pure: it reads the class through the existing data functions and
 * changes nothing. The two writes at the end, addCriterionComment and
 * addOverallComment, keep one comment in the bank (Add to Bank in the grader).
 * Nothing here is gated by the commentBank switch; the screens are.
 */
window.RubricComments = (function () {
  'use strict';

  var MAX_TEXT = 500;
  var MAX_COMMENTS = 40;
  var SLOT = '[Name]';

  /** @param {unknown} v */
  function _str(v) {
    return v == null ? '' : String(v);
  }
  /** @param {string} s */
  function _escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* The texts a criterion keeps at one level, in order. */
  function at(criterion, level) {
    return all(criterion)
      .filter(function (c) {
        return c.level === Number(level);
      })
      .map(function (c) {
        return c.text;
      });
  }

  /* Every comment a criterion keeps, in the order shown. */
  function all(criterion) {
    var list = criterion && Array.isArray(criterion.comments) ? criterion.comments : [];
    return list
      .filter(function (c) {
        return c && typeof c.text === 'string' && c.text !== '' && Number(c.level) >= 1;
      })
      .map(function (c) {
        return { level: Number(c.level), text: c.text };
      });
  }

  /* The text with [Name] filled with the student's first name. With no name the slot stays. */
  function fill(text, firstName) {
    var name = _str(firstName).trim();
    var t = _str(text);
    if (!name) return t;
    return t.split(SLOT).join(name);
  }

  /* The text with the first name (a whole word, so "Al" inside "Also" stays) put back to [Name]. */
  function slot(text, firstName) {
    var name = _str(firstName).trim();
    var t = _str(text);
    if (!name) return t;
    var re = new RegExp('(?<![\\p{L}\\p{N}_])' + _escapeRe(name) + '(?![\\p{L}\\p{N}_])', 'gu');
    return t.replace(re, SLOT);
  }

  /* What is left of the text once every banked text (filled) is taken out, trimmed. */
  function newPart(text, bankTexts, firstName) {
    var rest = _str(text);
    var pieces = (bankTexts || [])
      .map(function (b) {
        return fill(b, firstName).trim();
      })
      .filter(function (b) {
        return b !== '';
      })
      .sort(function (a, b) {
        return b.length - a.length;
      });
    pieces.forEach(function (piece) {
      rest = rest.split(piece).join(' ');
    });
    return rest.replace(/\s+/g, ' ').trim();
  }

  function _rubricAssessments(cid, rubricId) {
    return (getAssessments(cid) || []).filter(function (a) {
      return a && a.rubricId === rubricId;
    });
  }

  /* How many students in the class have a criterion comment, on any assessment using this
     rubric, that contains the text (filled with their first name): { '<level>|<text>': n }.
     One pass over the class. A student counts once per bank comment, however often it appears. */
  function uses(cid, rubricId, criterion) {
    var bank = all(criterion);
    /** @type {Record<string, number>} */
    var out = {};
    bank.forEach(function (c) {
      out[c.level + '|' + c.text] = 0;
    });
    if (!bank.length) return out;
    var assessments = _rubricAssessments(cid, rubricId);
    (getStudents(cid) || []).forEach(function (st) {
      var first = displayNameFirst(st);
      var notes = [];
      assessments.forEach(function (a) {
        var note = getRubricCriterionComment(cid, st.id, a.id, criterion);
        if (note) notes.push(note);
      });
      if (!notes.length) return;
      bank.forEach(function (c) {
        var want = fill(c.text, first);
        if (
          notes.some(function (n) {
            return n.indexOf(want) >= 0;
          })
        ) {
          out[c.level + '|' + c.text]++;
        }
      });
    });
    return out;
  }

  /* The same for the rubric's overall comments, from each student's overall comment: { '<text>': n }. */
  function overallUses(cid, rubricId) {
    var rubric = getRubricById(cid, rubricId);
    var bank = rubric && Array.isArray(rubric.overallComments) ? rubric.overallComments : [];
    /** @type {Record<string, number>} */
    var out = {};
    bank.forEach(function (t) {
      out[t] = 0;
    });
    if (!bank.length) return out;
    var assessments = _rubricAssessments(cid, rubricId);
    (getStudents(cid) || []).forEach(function (st) {
      var first = displayNameFirst(st);
      var notes = [];
      assessments.forEach(function (a) {
        var note = getScoreComment(cid, st.id, a.id);
        if (note) notes.push(note);
      });
      if (!notes.length) return;
      bank.forEach(function (t) {
        var want = fill(t, first);
        if (
          notes.some(function (n) {
            return n.indexOf(want) >= 0;
          })
        ) {
          out[t]++;
        }
      });
    });
    return out;
  }

  /* The student's most recent non-empty comment on this criterion's competencies, from an
     EARLIER assessment (its date is before this one's; undated ones are ignored): { text, title }
     or null. A criterion with no competencies has none. */
  function lastTime(cid, sid, aid, criterion) {
    var tags = criterion && Array.isArray(criterion.tagIds) ? criterion.tagIds : [];
    if (!tags.length) return null;
    var assessments = getAssessments(cid) || [];
    var here = assessments.find(function (a) {
      return a && a.id === aid;
    });
    var hereDate = here && here.date ? String(here.date) : '';
    if (!hereDate) return null;
    /** @type {any} */
    var best = null;
    assessments.forEach(function (a) {
      if (!a || a.id === aid || !a.rubricId || !a.date) return;
      var date = String(a.date);
      if (date >= hereDate) return;
      if (best && date < best.date) return;
      var rubric = getRubricById(cid, a.rubricId);
      if (!rubric) return;
      var text = '';
      (rubric.criteria || []).forEach(function (crit) {
        if (text || !crit) return;
        var shared = (crit.tagIds || []).some(function (t) {
          return tags.indexOf(t) >= 0;
        });
        if (!shared) return;
        text = getRubricCriterionComment(cid, sid, a.id, crit);
      });
      if (!text) return;
      best = { date: date, text: text, title: a.title || a.name || '' };
    });
    return best ? { text: best.text, title: best.title } : null;
  }

  /* ── The two writes ─────────────────────────────────────────── */

  function _cleanText(text) {
    var t = _str(text).trim();
    return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT).trim() : t;
  }

  /* Apply a change to the rubric in the cache and in the server baseline; the baseline moves
     with it so the next saveRubrics does not see an unsent rubric edit. Returns the changed
     rubric (the cached one) or null when nothing changed. */
  function _keep(cid, rubricId, change) {
    var rubrics = getRubrics(cid);
    var idx = rubrics.findIndex(function (r) {
      return r && r.id === rubricId;
    });
    if (idx < 0) return null;
    var next = _clone(rubrics[idx]);
    if (!change(next)) return null;
    var list = rubrics.slice();
    list[idx] = next;
    _saveCourseField('rubrics', cid, list);
    if (_hasServerState('rubrics', cid)) {
      var held = _serverStateOr('rubrics', cid, []).find(function (r) {
        return r && r.id === rubricId;
      });
      if (held) change(held);
    }
    return next;
  }
  function _clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  /* Keep one comment on a criterion at a level. No empty text, no duplicate, at most 40. */
  function addCriterionComment(cid, rubricId, criterionId, level, text) {
    var clean = _cleanText(text);
    var lvl = Number(level);
    if (!clean || !(lvl >= 1)) return false;
    var added = false;
    _keep(cid, rubricId, function (rubric) {
      var crit = (rubric.criteria || []).find(function (c) {
        return c && c.id === criterionId;
      });
      if (!crit) return false;
      var list = Array.isArray(crit.comments) ? crit.comments : (crit.comments = []);
      var dup = list.some(function (c) {
        return c && Number(c.level) === lvl && c.text === clean;
      });
      if (dup || list.length >= MAX_COMMENTS) return false;
      list.push({ level: lvl, text: clean });
      added = true;
      return true;
    });
    if (!added) return false;
    // A criterion with a local id and no queued create is sent with its rubric's next save.
    if (_writesEnabled() && _isUuid(cid) && _isSendableId(criterionId) && _isSendableId(rubricId)) {
      var key = _newEntryId();
      // The two new functions are not in types/database.d.ts until it is regenerated after
      // the database change; _writeRpc takes any name.
      _writeRpc(
        'add_criterion_comment',
        { p_criterion_id: criterionId, p_level: lvl, p_text: clean, p_idempotency_key: key },
        { entryId: key },
      );
    }
    return true;
  }

  /* Keep one overall comment on a rubric. No empty text, no duplicate, at most 40. */
  function addOverallComment(cid, rubricId, text) {
    var clean = _cleanText(text);
    if (!clean) return false;
    var added = false;
    _keep(cid, rubricId, function (rubric) {
      var list = Array.isArray(rubric.overallComments) ? rubric.overallComments : (rubric.overallComments = []);
      if (list.indexOf(clean) >= 0 || list.length >= MAX_COMMENTS) return false;
      list.push(clean);
      added = true;
      return true;
    });
    if (!added) return false;
    if (_writesEnabled() && _isUuid(cid) && _isSendableId(rubricId)) {
      var key = _newEntryId();
      _writeRpc(
        'add_rubric_overall_comment',
        { p_rubric_id: rubricId, p_text: clean, p_idempotency_key: key },
        { entryId: key },
      );
    }
    return true;
  }

  return {
    at: at,
    all: all,
    fill: fill,
    slot: slot,
    newPart: newPart,
    uses: uses,
    overallUses: overallUses,
    lastTime: lastTime,
    addCriterionComment: addCriterionComment,
    addOverallComment: addOverallComment,
    MAX_TEXT: MAX_TEXT,
    MAX_COMMENTS: MAX_COMMENTS,
  };
})();
