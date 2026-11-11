/* drafts-before-print.js — asked before a family or a student is handed
   paper with grades on it (student page build plan, S2-F1).

   In a class that holds grades (its student page on and Return Grades set
   to When I Return Them), a Progress Report and a rubric handout print
   returned grades only (teacher/report-scores.js). When a student in the
   print has a draft on work the print would show, Print asks first, once,
   before anything prints (the board "Teacher: Printing Reports With
   Drafts"; DECISIONS, "Student page build rulings (2026-11-10)" 6):

     4 Grades Aren't Returned Yet
     each piece, and the drafts line for it
     Return Them, Then Print | Print Without Them | Cancel

   The rubric handout's buttons say It: Return It, Then Print; Print
   Without It.

   Nothing here decides Draft or Returned, works out a grade or writes one:
   which grades are drafts and who a Return returns are GradeState's
   (draftsReturned, which counts a pair or group partner with them, and
   draftsSentence), and the Return is Grader.returnGrades. So the count,
   the names and what Return returns are one answer.

   THE QUESTION BELONGS TO THE DIALOG IT IS ASKED OVER (its owner: the
   Print dialog, or Print Rubrics). It goes when the owner goes: the owner
   closes it (close()) when it closes, when its page is left and when the
   class changes, and the question also closes itself if the owner's
   dialog leaves the page by any other way. An answer that comes after the
   owner has gone does nothing. And an answer is acted on only while the
   owner says it still stands (owner.still()). */
window.DraftsBeforePrint = (function () {
  'use strict';

  var OVERLAY_ID = 'drafts-print-overlay';
  var FAILED_CLASS = 'drafts-print-failed';
  var _closeOpen = null; // closes the question that is open, answering nothing

  // True when the class holds grades until the teacher returns them.
  function holds(cid) {
    return typeof getReturnSettings === 'function' && GradeState.holds(getReturnSettings(cid));
  }

  /* The drafts a print of `sids` on the pieces `aids` would leave out, and
     what returning them returns: { cid, total, pieces: [{ aid, title, sids }] },
     the pieces in the order given. null when the class does not hold
     grades or nothing in the print is a draft. */
  function find(cid, aids, sids) {
    if (!cid || !holds(cid)) return null;
    var assessments = getAssessments(cid) || [];
    var pieces = [];
    var total = 0;
    (aids || []).forEach(function (aid) {
      var drafts = GradeState.draftsReturned(cid, aid, sids || []);
      if (!drafts.length) return;
      var a = assessments.find(function (x) {
        return x && x.id === aid;
      });
      pieces.push({ aid: aid, title: (a && a.title) || 'Untitled', sids: drafts });
      total += drafts.length;
    });
    return total ? { cid: cid, total: total, pieces: pieces } : null;
  }

  /* Returns every draft `found` names, through the one grader, and says
     whether it worked: { all, left }. `left` counts the named drafts that
     are still drafts afterwards (the rule failed, or the outbox had no room
     and the Return was put back): `all` is true only when it is 0. */
  function returnAll(found) {
    var left = 0;
    ((found && found.pieces) || []).forEach(function (p) {
      Grader.returnGrades(found.cid, p.aid, p.sids);
      left += GradeState.draftsIn(found.cid, p.aid, p.sids).length;
    });
    return { all: !!found && left === 0, left: left };
  }

  // "4 Grades Aren't Returned Yet", "1 Grade Isn't Returned Yet".
  function title(n) {
    return n === 1 ? '1 Grade Isn’t Returned Yet' : n + ' Grades Aren’t Returned Yet';
  }

  var WORDS = {
    reports: {
      why: 'A progress report shows grades to families, so it leaves drafts out unless you return them.',
      give: 'Return Them, Then Print',
      without: 'Print Without Them',
    },
    handout: {
      why: 'A rubric handout shows grades to students, so it leaves drafts out unless you return them.',
      give: 'Return It, Then Print',
      without: 'Print Without It',
    },
    // Said in the owner's dialog when Return Them, Then Print could not return every draft it named.
    failed: 'Those grades couldn’t be returned, so nothing printed. Try again.',
  };

  // html-safe: every piece's title and the drafts line esc()'d; the count is a number; the rest is fixed markup
  function _html(found, words) {
    var html = '<div class="confirm-card drafts-print-card">';
    html += '<div class="confirm-title" id="drafts-print-title">' + esc(title(found.total)) + '</div>';
    html += '<ul class="drafts-print-list" aria-label="Drafts">';
    found.pieces.forEach(function (p) {
      html +=
        '<li><span class="drafts-print-piece">' +
        esc(p.title) +
        '</span><span class="drafts-print-who">' +
        esc(GradeState.draftsSentence(found.cid, p.sids)) +
        '</span></li>';
    });
    html += '</ul>';
    html += '<div class="confirm-message" id="drafts-print-why">' + esc(words.why) + '</div>';
    html += '<div class="drafts-print-actions">';
    html += '<button type="button" class="drafts-print-give" data-choice="return">' + esc(words.give) + '</button>';
    html +=
      '<button type="button" class="drafts-print-without" data-choice="without">' + esc(words.without) + '</button>';
    html += '<button type="button" class="drafts-print-cancel" data-choice="cancel">Cancel</button>';
    html += '</div></div>';
    return html;
  }

  function _ownerHere(owner) {
    if (!owner) return false;
    if (owner.el && !owner.el.isConnected) return false;
    return typeof owner.still === 'function' ? !!owner.still() : true;
  }

  /* Asks over `owner` ({ el: the owner's dialog, still(): whether what was
     asked about still stands }). `kind` is 'reports' or 'handout'.
     `choose(choice)` is called once with 'return', 'without' or 'cancel'
     after the question has closed, and only while the owner is still there;
     Escape and a click outside the card are Cancel. If the owner goes first,
     the question closes and `choose` is never called. With nothing found it
     is 'without' at once: there is nothing to ask. */
  function ask(found, kind, choose, owner) {
    close();
    if (!found || !found.total) {
      choose('without');
      return;
    }
    var words = WORDS[kind] || WORDS.reports;
    var trigger = document.activeElement;
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'confirm-overlay drafts-print-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'drafts-print-title');
    overlay.setAttribute('aria-describedby', 'drafts-print-why');
    overlay.innerHTML = _html(found, words);
    var done = false;
    var watch = null;
    var shut = function () {
      if (done) return false;
      done = true;
      _closeOpen = null;
      document.removeEventListener('keydown', onKey, true);
      if (watch) watch.disconnect();
      overlay.remove();
      return true;
    };
    var finish = function (choice) {
      if (!shut()) return;
      // The owner went while the question was open: nothing is done.
      if (!_ownerHere(owner)) return;
      try {
        if (trigger && typeof trigger.focus === 'function' && choice === 'cancel') trigger.focus();
      } catch (e) {
        /* the trigger may be gone */
      }
      choose(choice);
    };
    var onKey = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish('cancel');
      } else if (e.key === 'Tab') {
        // The dialog under this one (Print, Print Rubrics) keeps its own Tab inside it: not while this is open.
        e.stopPropagation();
        var buttons = Array.prototype.slice.call(overlay.querySelectorAll('button'));
        var first = buttons[0];
        var last = buttons[buttons.length - 1];
        var at = document.activeElement;
        if (!overlay.contains(at)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && at === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && at === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) return finish('cancel');
      var b = e.target.closest ? e.target.closest('[data-choice]') : null;
      if (b) finish(b.dataset.choice);
    });
    document.addEventListener('keydown', onKey, true);
    _closeOpen = shut;
    document.body.appendChild(overlay);
    // The owner's dialog taken off the page by any way at all closes the question with it.
    if (owner && owner.el && typeof MutationObserver === 'function') {
      watch = new MutationObserver(function () {
        if (!owner.el.isConnected) shut();
      });
      watch.observe(document.body, { childList: true, subtree: true });
    }
    // A Return cannot be undone: the keyboard starts on Cancel.
    overlay.querySelector('[data-choice="cancel"]').focus();
  }

  // Closes the question that is open, if any, answering nothing. The owner calls it when it goes.
  function close() {
    if (_closeOpen) _closeOpen();
  }

  /* Says in the owner's dialog that Return Them, Then Print could not
     return every draft, so nothing printed. The dialog stays open. */
  // html-safe: a fixed sentence, set as text
  function showFailed(ownerEl) {
    var card = ownerEl && ownerEl.querySelector ? ownerEl.querySelector('.confirm-card') || ownerEl : null;
    if (!card) return;
    var line = card.querySelector('.' + FAILED_CLASS);
    if (!line) {
      line = document.createElement('div');
      line.className = FAILED_CLASS;
      line.setAttribute('role', 'alert');
      var actions = card.querySelector('.confirm-actions');
      if (actions) actions.parentNode.insertBefore(line, actions);
      else card.appendChild(line);
    }
    line.textContent = WORDS.failed;
  }

  return {
    holds: holds,
    find: find,
    returnAll: returnAll,
    ask: ask,
    close: close,
    showFailed: showFailed,
    title: title,
    WORDS: WORDS,
  };
})();
