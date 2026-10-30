/* report-feedback.js — the data behind the Quick Report's Feedback Pages.

   After the grade sheet, the Quick Report can print every assessment that
   has a rubric or written feedback as a card, in date order (the Full
   Record canvas, layout B). This file only gathers what each card shows;
   the cards and pages are drawn elsewhere. Pure: data in, plain objects
   out, nothing touches the DOM.

   forStudent(cid, student, opts): one item per assessment in the active
   term that has something to show, oldest first (opts.order 'newest'
   flips it), in GradeReport.rows' order:
     { id, title, date ("Oct 6"), dateIso, category, kind, grade, status,
       feedback, rubric }
   plus { score, outOf, percent } on points work and { mark } on
   Complete/Incomplete work.
   - kind: 'rubric' (the teacher's own: standard, advanced, single-point),
     'tags' (a Tag Rubric, a row per competency), 'general' (one Overall
     row), 'points' or 'complete'.
   - grade: { text, word, letter } for the pill, or null with no score (or
     Missing / Excused). A Proficiency class shows the proficiency word, a
     Letter class the letter and %, a Both class both. calc.js works out
     every part (assessmentCellValue, levelWord, assessmentGroupGrade).
   - status: 'Late', 'Missing', 'Excused' or ''.
   - feedback: the assignment comments, oldest first, then the score's
     comment ([{ text, date, dateIso }]; RubricPrint.feedbackItems).
   - rubric: { name, style, levelOrder, rows } on rubric, tags and general
     work, read from RubricPrint.sheetData so the cards match Print Rubrics.

   Left out: points and Complete/Incomplete work with no written feedback,
   Missing or Excused work with nothing written, unscored work with nothing
   written, and DIBELS (ELA only, not in this build).

   observations(cid, student, termId): the student's observations in the
   term, oldest first, without the assignment comments (they print on their
   assessment's card). termComment(cid, student, termId): the Term
   Questionnaire's comment as plain text. */
window.ReportFeedback = (function () {
  'use strict';

  var LEVELS = [4, 3, 2, 1];

  function _when(iso) {
    if (!iso) return '';
    var d = parseLocalDate(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _statusLabel(status) {
    return status === 'NS' ? 'Missing' : status === 'EXC' ? 'Excused' : status === 'LATE' ? 'Late' : '';
  }

  /* The pill: the proficiency word unless the class is Letter, the letter
     and % unless it is Proficiency. Null when the cell has no score. */
  function _grade(cid, sid, assessment) {
    var cv = assessmentCellValue(cid, sid, assessment);
    if (cv.kind === 'complete') {
      return { text: cv.mark === 'complete' ? 'Complete' : 'Incomplete', word: '', letter: '' };
    }
    if (cv.kind !== 'points' && cv.kind !== 'level') return null;
    var mode = courseGradeMode(cid);
    // cv.level is the 1-4 band the gradebook cell takes its colour from
    // (points work on the class's grading scale).
    var word = mode === 'letter' ? '' : levelWord(cid, cv.level);
    var g = mode === 'proficiency' ? null : assessmentGroupGrade(cid, sid, [assessment]);
    var letter = (g && g.letter) || '';
    var text = mode === 'letter' ? letter : mode === 'both' ? [word, letter].filter(Boolean).join(' · ') : word;
    return text ? { text: text, word: word, letter: letter } : null;
  }

  function _feedback(cid, sid, aid) {
    return RubricPrint.feedbackItems(cid, sid, aid).map(function (f) {
      return { text: f.text, date: _when(f.date), dateIso: f.date };
    });
  }

  /* An Advanced Rubric's checkboxes at every level, ticked or not. */
  function _checks(criterion, ticked) {
    var out = {};
    LEVELS.forEach(function (lv) {
      out[lv] = RubricChecks.checksAt(criterion, lv).map(function (check) {
        return { id: check.id, label: check.label || '', ticked: ticked.indexOf(check.id) >= 0 };
      });
    });
    return out;
  }

  function _rubric(cid, sheet) {
    var r = sheet.rubric;
    var style = r.kind ? 'standard' : rubricStyle(r);
    return {
      name: r.name || '',
      style: style,
      levelOrder: levelOrderFor(cid),
      rows: sheet.rows.map(function (row) {
        var c = row.criterion;
        var levels = {};
        LEVELS.forEach(function (lv) {
          levels[lv] = (c.levels && (c.levels[lv] || c.levels[String(lv)])) || '';
        });
        return {
          criterionId: c.id,
          name: c.name || '',
          codes: row.codes.slice(),
          levels: levels,
          level: row.level,
          mod: row.mod,
          mixed: row.mixed,
          comment: row.comment || '',
          beyond: style === 'single_point' ? row.beyond || '' : '',
          checks: style === 'advanced' ? _checks(c, sheet.ticked || []) : null,
        };
      }),
    };
  }

  /* The item for one assessment, or null when it has nothing to show. */
  function _item(cid, student, a, dateIso, cats) {
    var sid = student.id;
    var status = getAssignmentStatus(cid, sid, a.id);
    var feedback = _feedback(cid, sid, a.id);
    var item = {
      id: a.id,
      title: a.title || '',
      date: _when(dateIso),
      dateIso: dateIso,
      category: cats[a.categoryId || a.category_id] || '',
      kind: '',
      grade: null,
      status: _statusLabel(status),
      feedback: feedback,
      rubric: null,
    };
    var off = status === 'NS' || status === 'EXC';
    if (isPointsScored(a)) {
      if (!feedback.length) return null;
      if (isCompletionScored(a)) {
        item.kind = 'complete';
        item.mark = off ? null : getCompletionMark(cid, sid, a.id);
      } else {
        item.kind = 'points';
        var points = off ? null : getPointsScore(cid, sid, a.id);
        var max = Number(a.maxPoints) || 100;
        item.score = points == null ? '' : formatPoints(points);
        item.outOf = formatPoints(max);
        item.percent = points == null ? '' : formatPointsPercent(points, max);
      }
      item.grade = off ? null : _grade(cid, sid, a);
      return item;
    }
    var sheet = RubricPrint.sheetData(cid, a.id, sid);
    var rows = sheet ? sheet.rows : [];
    var written =
      feedback.length > 0 ||
      rows.some(function (r) {
        return r.comment || r.beyond;
      });
    var scored = rows.some(function (r) {
      return r.level > 0;
    });
    if (!written && (off || !scored)) return null;
    item.kind = sheet ? sheet.rubric.kind || 'rubric' : 'general';
    item.rubric = sheet ? _rubric(cid, sheet) : null;
    item.grade = off ? null : _grade(cid, sid, a);
    return item;
  }

  /* One student's feedback items this term. opts.order: 'oldest'
     (default) or 'newest'. */
  function forStudent(cid, student, opts) {
    if (!student) return [];
    var cats = {};
    (getCategories(cid) || []).forEach(function (c) {
      cats[c.id] = c.name;
    });
    var list = getAssessments(cid)
      .filter(function (a) {
        return a && !isDibelsScored(a) && assessmentInActiveTerm(cid, a);
      })
      .map(function (a) {
        return { a: a, d: _assessmentDate(a) || '' };
      })
      .sort(function (x, y) {
        return x.d.localeCompare(y.d) || String(x.a.title || '').localeCompare(String(y.a.title || ''));
      });
    if (opts && opts.order === 'newest') list.reverse();
    return list
      .map(function (x) {
        return _item(cid, student, x.a, x.d, cats);
      })
      .filter(Boolean);
  }

  /* The dates a report term covers: the class's reporting term for
     'term-N', else the term in view, else all time (null). */
  function _termRange(cid, termId) {
    var m = String(termId || '').match(/^term-(\d+)$/);
    if (m) {
      var n = Number(m[1]);
      var term = getReportingTerms(cid).find(function (t) {
        return t.ordinal === n;
      });
      if (term && term.starts_on && term.ends_on) return { from: term.starts_on, to: term.ends_on };
    }
    var active = getActiveTerm(cid);
    return active ? { from: active.startsOn, to: active.endsOn } : null;
  }

  /* The labels an observation is tagged with: its linked competency, then
     its tags (dispositions, Core Competencies, the teacher's own). */
  function _obsTags(cid, ob) {
    var out = [];
    if (ob.competencyId) {
      var tag = getTagById(cid, ob.competencyId);
      if (tag && (tag.label || tag.name)) out.push(tag.label || tag.name);
    }
    (ob.dims || []).forEach(function (d) {
      var label = resolveTag(d).label;
      if (label && out.indexOf(label) < 0) out.push(label);
    });
    return out;
  }

  /* The student's observations in the term, oldest first:
     [{ id, date ("Oct 6"), dateIso, text, tags }]. Comments on an
     assessment are left out: they are that card's feedback. */
  function observations(cid, student, termId) {
    if (!student) return [];
    var range = _termRange(cid, termId);
    return getStudentQuickObs(cid, student.id)
      .map(function (ob) {
        return { ob: ob, day: ob ? String(ob.date || ob.created || '').slice(0, 10) : '' };
      })
      .filter(function (x) {
        if (!x.ob || x.ob.assignmentContext || !String(x.ob.text || '').trim()) return false;
        return !range || (!!x.day && x.day >= range.from && x.day <= range.to);
      })
      .sort(function (x, y) {
        return x.day.localeCompare(y.day) || String(x.ob.created || '').localeCompare(String(y.ob.created || ''));
      })
      .map(function (x) {
        return {
          id: x.ob.id,
          date: _when(x.day),
          dateIso: x.day,
          text: String(x.ob.text).trim(),
          tags: _obsTags(cid, x.ob),
        };
      });
  }

  var ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

  /* The Term Questionnaire's comment for the student as plain text, a
     paragraph per line, or ''. The questionnaire saves plain text; a
     comment from the old editor is HTML until it is next edited
     (renderBlockTeacherNarrative's rule). */
  function termComment(cid, student, termId) {
    if (!student) return '';
    var rating = getStudentTermRating(cid, student.id, termId);
    var narrative = rating && rating.narrative ? String(rating.narrative) : '';
    if (!narrative.trim()) return '';
    if (/<\/?(p|div|br|ul|ol|li|b|i|u|strong|em|span)\b[^>]*>/i.test(narrative)) {
      narrative = narrative
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li)>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, function (e) {
          return ENTITIES[e];
        });
    }
    return narrative
      .split(/\n+/)
      .map(function (p) {
        return p.trim();
      })
      .filter(Boolean)
      .join('\n');
  }

  return {
    forStudent: forStudent,
    observations: observations,
    termComment: termComment,
  };
})();
