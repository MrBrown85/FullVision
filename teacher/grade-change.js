// @ts-check
/* ── grade-change.js — a change that moves grades asks first ───────────
   Colin, Nov 16: "when doing things that change grade math, give teachers
   a warning prompt before making changes, provide undo as well."

   Which changes to an assessment move grades (shared/calc.js):
     Factor         always: the course % and the factored mean of levels.
     Category       in a Letter or Both class, and in any class when it
                    takes work into or out of a 0% category
                    (countsTowardGrades).
     Date Assigned  when it crosses the end of a reporting term: each
                    term's grade counts the work dated up to its end.
   DIBELS counts toward no grade, so it never asks. Nothing else here asks.

   The Assignments List (teacher/assign-list.js) asks through question()
   for one field on one row or many ticked rows. The assessment form
   (teacher/page-assignments.js, Save Changes) asks through askFirst() for
   everything one save changes, and offers Undo through offerUndo(). */
/** @type {any} */ (window).GradeChange = (function () {
  'use strict';

  var G = /** @type {any} */ (window);
  var TAIL = ' This changes students’ grades. You can undo it.';
  var TITLES = {
    factor: 'Change the Factor?',
    category: 'Change the Category?',
    date: 'Change the Date Assigned?',
  };
  var NAMES = { factor: 'Factor', category: 'Category', date: 'Date Assigned' };
  // The fields each change writes, so Undo can put them back.
  var KEYS = { factor: ['weight'], category: ['categoryId', 'category_id'], date: ['date', 'dateAssigned'] };

  /** @param {any} a */
  function dateOf(a) {
    return String((a && (a.date || a.dateAssigned || a.assigned_at || a.date_assigned)) || '').slice(0, 10);
  }
  /** @param {any} a */
  function categoryOf(a) {
    return (a && (a.categoryId || a.category_id)) || '';
  }
  /** @param {any} a @param {string} field */
  function valueOf(a, field) {
    if (field === 'factor') return G.getAssessmentWeight(a);
    if (field === 'category') return categoryOf(a);
    return dateOf(a);
  }

  /* The first reporting term whose end lies between two dates, and
     whether the move takes work out of it (later) or into it (earlier). */
  /** @param {string} cid @param {string} from @param {string} to */
  function termCrossed(cid, from, to) {
    if (!from || !to || from === to) return null;
    var terms = typeof G.getReportingTerms === 'function' ? G.getReportingTerms(cid) || [] : [];
    for (var i = 0; i < terms.length; i++) {
      var end = terms[i].ends_on;
      if (end && from <= end !== to <= end) return { label: terms[i].label || 'the term', out: to > end };
    }
    return null;
  }

  /* Whether setting `field` to `value` on `a` moves grades. */
  /** @param {string} cid @param {any} a @param {string} field @param {any} value */
  function moves(cid, a, field, value) {
    if (!a || G.isDibelsScored(a)) return false;
    if (field === 'factor') return Number(value) !== G.getAssessmentWeight(a);
    if (field === 'category') {
      if ((value || '') === categoryOf(a)) return false;
      if (G.courseGradeMode(cid) !== 'proficiency') return true;
      return G.countsTowardGrades(cid, a) !== G.countsTowardGrades(cid, { categoryId: value || '' });
    }
    if (field === 'date') return !!termCrossed(cid, dateOf(a), value);
    return false;
  }

  /** @param {string} cid @param {string} id */
  function _catName(cid, id) {
    var c = id ? G.getCategoryById(cid, id) : null;
    return c ? c.name || 'Untitled' : 'No Category';
  }
  /** @param {string} cid @param {any} a */
  function _sharePct(cid, a) {
    var info = G.assessmentCategoryShare(cid, a);
    return info && info.kind === 'share' ? G.formatShare(info.share, true) : '';
  }
  /** @param {number} n */
  function _plural(n) {
    return n === 1 ? '1 assessment' : n + ' assessments';
  }
  /** @param {any} a */
  function _quoted(a) {
    return '“' + ((a && a.title) || 'Untitled') + '”';
  }

  /* What one change does, in a sentence. `one` is the piece when there is
     one, else null and `n` pieces; `after` is the piece as it will be. */
  /** @param {string} cid @param {any} one @param {number} n @param {string} field @param {any} value @param {any} [after] */
  function _sentence(cid, one, n, field, value, after) {
    var name = one ? _quoted(one) : _plural(n);
    if (field === 'factor') {
      var msg = name + ' will count ' + G.formatFactor(value) + ' as much as work at Factor 1×.';
      var next = after || (one && Object.assign({}, one, { weight: Number(value) }));
      if (one && next && categoryOf(next) === categoryOf(one)) {
        var was = _sharePct(cid, one);
        var now = _sharePct(cid, next);
        if (was && now && was !== now) msg += ' Its share of its category goes from ' + was + ' to ' + now + '.';
      }
      return msg;
    }
    if (field === 'category') {
      var to = _catName(cid, value);
      var msg2 = one
        ? name + ' moves from ' + _catName(cid, categoryOf(one)) + ' to ' + to + '.'
        : name + ' move to ' + to + '.';
      if (!G.countsTowardGrades(cid, { categoryId: value || '' }))
        msg2 += ' ' + to + ' counts 0%, so ' + (one ? 'it' : 'they') + ' will count toward no grade.';
      else if (one && !G.countsTowardGrades(cid, one)) msg2 += ' It will start counting toward grades.';
      return msg2;
    }
    var crossed = termCrossed(cid, dateOf(one), value);
    return (
      name +
      (crossed && crossed.out ? ' moves out of ' : ' moves into ') +
      (crossed ? crossed.label : 'the term') +
      '’s grades.'
    );
  }

  /* The question before setting one field on `pieces` (the List), or null
     when no grade moves. `bulk`: the ticked rows, asked about together. */
  /** @param {string} cid @param {any[]} pieces @param {string} field @param {any} value @param {boolean} bulk */
  function question(cid, pieces, field, value, bulk) {
    var hit = pieces.filter(function (a) {
      return moves(cid, a, field, value);
    });
    if (!hit.length) return null;
    var one = hit.length === 1 && !bulk ? hit[0] : null;
    if (field === 'date' && !one) one = hit[0];
    return {
      title: TITLES[/** @type {'factor'} */ (field)],
      message: _sentence(cid, one, hit.length, field, value) + TAIL,
      ok: bulk
        ? 'Set ' + NAMES[/** @type {'factor'} */ (field)]
        : 'Change ' + (field === 'date' ? 'Date' : NAMES[/** @type {'factor'} */ (field)]),
    };
  }

  /* The fields a save from `before` to `after` changes that move grades. */
  /** @param {string} cid @param {any} before @param {any} after */
  function _formFields(cid, before, after) {
    return ['factor', 'category', 'date'].filter(function (f) {
      return moves(cid, before, f, valueOf(after, f));
    });
  }

  /* The question before the form saves `after` over `before`, or null. */
  /** @param {string} cid @param {any} before @param {any} after */
  function formQuestion(cid, before, after) {
    var fields = _formFields(cid, before, after);
    if (!fields.length) return null;
    return {
      title: fields.length === 1 ? TITLES[/** @type {'factor'} */ (fields[0])] : 'Change How This Counts?',
      message:
        fields
          .map(function (f) {
            return _sentence(cid, before, 1, f, valueOf(after, f), after);
          })
          .join(' ') + TAIL,
      ok: 'Save Changes',
    };
  }

  /* The form's guard, as its other guards: when the save moves grades and
     the teacher has not said yes to this change, ask, and on yes run
     `retry` (the save again). True when it took over the save. */
  /** @type {string | null} */
  var _approved = null;
  /** @param {string} cid @param {any} before @param {any} after @param {() => void} retry */
  function askFirst(cid, before, after, retry) {
    var q = formQuestion(cid, before, after);
    if (!q || typeof G.showConfirm !== 'function') return false;
    var said = cid + '|' + (before && before.id) + '|' + q.message;
    if (_approved === said) {
      _approved = null;
      return false;
    }
    G.showConfirm(q.title, q.message, q.ok, 'primary', function () {
      _approved = said;
      retry();
    });
    return true;
  }

  /* Puts back what moved grades on piece `aid`: the fields of `before`
     for each of `fields`. */
  /** @param {string} cid @param {string} aid @param {any} before @param {string[]} fields */
  function restore(cid, aid, before, fields) {
    var list = G.getAssessments(cid);
    var a = list.find(function (/** @type {any} */ x) {
      return x && x.id === aid;
    });
    if (!a) return false;
    fields.forEach(function (f) {
      KEYS[/** @type {'factor'} */ (f)].forEach(function (k) {
        if (k in before) a[k] = before[k];
        else delete a[k];
      });
    });
    G.saveAssessments(cid, list);
    return true;
  }

  /* After the form saved a change that moved grades: Undo, on the app's
     Undo toast, puts those fields back without asking; then `redraw`. */
  /** @param {string} cid @param {any} before @param {any} after @param {() => void} redraw */
  function offerUndo(cid, before, after, redraw) {
    var fields = _formFields(cid, before, after);
    if (!fields.length || typeof G.showUndoToast !== 'function') return;
    var text =
      fields.length === 1
        ? 'Changed the ' + NAMES[/** @type {'factor'} */ (fields[0])] + ' of ' + _quoted(before) + '.'
        : 'Changed how ' + _quoted(before) + ' counts.';
    G.showUndoToast(text, function () {
      if (restore(cid, before.id, before, fields)) redraw();
    });
  }

  return {
    moves: moves,
    question: question,
    formQuestion: formQuestion,
    askFirst: askFirst,
    offerUndo: offerUndo,
    restore: restore,
    termCrossed: termCrossed,
  };
})();
