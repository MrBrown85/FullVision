// @ts-check
/* cm-pts-save.js — Points and Proficiency: Save, and what Check With a Student adds.

   Save takes the draft CmPtsEdit holds. When any student's course % as shown
   would change it asks first, with the app's own question ("Change the Course
   %?"): a row for each step that moved (its pill, old → new), a line for each
   band start that moved, how many students get a new letter grade, and, only
   when a reporting term has already ended, the sentence that says every term
   changes. When no course % moves it saves at once. It goes through
   saveCourseConfig as before, and offers Undo, which puts the previous scale
   back. No grade is worked out here: CmPtsModel.gradeEffects asks calc.js,
   under the draft scale (withGradingScale). */
window.CmPtsSave = (function () {
  'use strict';

  var M = CmPtsModel;
  var E = CmPtsEdit;

  function commit(cid, scale) {
    // What was stored before; a class that never saved a scale has none.
    var was = getCourseConfig(cid).gradingScale;
    var before = was ? structuredClone(was) : null;
    var wrote = structuredClone(scale);
    write(cid, wrote);
    E.clearNotice();
    E.drop();
    E.focusOn('#cm-pts-edit-btn');
    E.host().render();
    showUndoToast('Markers saved', function () {
      // Only while what is saved is still exactly what this Save wrote: a scale
      // that arrived from another device since is never put back over.
      if (M.stored(getGradingScale(cid)) !== M.stored(wrote)) return;
      // No scale saved before: the defaults, as a copy of their own (the server
      // takes a scale, not "none"; Reset to Defaults saves the same).
      write(cid, before || structuredClone(DEFAULT_GRADING_SCALE));
      E.host().render();
    });
  }
  function write(cid, scale) {
    var cc = getCourseConfig(cid);
    cc.gradingScale = scale;
    saveCourseConfig(cid, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
  }

  // html-safe: fixed markup; every step label, level and percent through esc
  // One row for each step that moved and a line for each band start.
  function askRows(c) {
    var rows = c.steps
      .map(function (s) {
        return (
          '<div class="cm-pts-ask-row"><span class="cm-pts-ask-pill lv-' +
          esc(s.level) +
          '">' +
          esc(s.label) +
          '</span><span><span class="cm-pts-ask-from">' +
          esc(s.from) +
          ' →</span> <strong>' +
          esc(s.to) +
          '</strong></span></div>'
        );
      })
      .concat(
        c.edges.map(function (e) {
          return (
            '<div class="cm-pts-ask-row is-wide"><span><span class="cm-pts-ask-from">' +
            esc(e.name + ' starts at ' + e.from) +
            ' →</span> <strong>' +
            esc(e.to) +
            '</strong></span></div>'
          );
        }),
      );
    return '<div class="cm-pts-ask">' + rows.join('') + '</div>';
  }
  function askMessage(cid, fx) {
    var n = fx.moves.length;
    var ended = E.host().endedTerm(cid);
    return [
      n ? (n === 1 ? '1 student gets' : n + ' students get') + ' a new letter grade.' : '',
      ended
        ? 'This changes the course % for every term, including ' +
          (ended.label || 'Term ' + ended.ordinal) +
          ', which has already ended. Report cards printed before today won’t match.'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /* Saves the draft. When any student's course % would change, asks first and
     names each step and band start that moved; otherwise saves at once. */
  function save() {
    var cid = E.selected();
    var d = cid && E.draft(cid);
    if (!cid || !d) return;
    // A scale from another device since Edit: nothing is written over it.
    if (E.reconcile(cid)) return E.host().render();
    d = E.draft(cid);
    if (!d || !E.dirty(cid)) return;
    var fx = M.gradeEffects(cid, getGradingScale(cid), d);
    if (!fx.pctMoves) return commit(cid, d);
    showConfirm(
      'Change the Course %?',
      askMessage(cid, fx),
      'Save',
      'primary',
      function () {
        // The question was open a while: look again before writing.
        if (E.reconcile(cid)) return E.host().render();
        if (E.editing(cid) && E.dirty(cid)) commit(cid, E.draft(cid));
      },
      'Cancel',
    );
    var title = document.getElementById('confirm-title');
    var msg = title && title.parentElement && title.parentElement.querySelector('.confirm-message');
    if (msg) {
      msg.insertAdjacentHTML('beforebegin', askRows(M.changes(getGradingScale(cid), d)));
      if (title && title.parentElement) title.parentElement.classList.add('cm-pts-ask-card');
    }
  }

  /* What Check With a Student adds while editing: under Overall Grade, "Was B
     78.9%" when the draft changes it, and the students whose letter changes
     (the first six, then "and N more"). The grades are calc.js's, worked out
     under the saved scale and under the draft; nothing is saved. */
  function checkNotes(cid, sid, nowText) {
    var none = { was: '', moves: '' };
    var shown = E.shownScale(cid);
    var saved = getGradingScale(cid);
    if (!shown || !M.differs(saved, shown)) return none;
    var wasText = withGradingScale(cid, saved, function () {
      return studentGradeSummary(cid, sid).text || 'No scores yet';
    });
    var fx = M.gradeEffects(cid, saved, shown);
    var rows = fx.moves.slice(0, 6).map(function (m) {
      return (
        '<div class="cm-check-move"><span>' +
        esc(m.name) +
        '</span><span class="cm-check-move-to">' +
        esc(m.from + ' → ' + m.to) +
        '</span></div>'
      );
    });
    if (fx.moves.length > 6) rows.push('<div class="cm-check-move-more">and ' + (fx.moves.length - 6) + ' more</div>');
    return {
      was: wasText === nowText ? '' : '<span class="cm-check-was">Was ' + esc(wasText) + '</span>',
      moves: fx.moves.length
        ? '<div class="cm-check-group"><div class="cm-label">Letter Grades That Change <span class="cm-check-sub">· ' +
          fx.moves.length +
          ' of ' +
          getStudents(cid).length +
          '</span></div>' +
          rows.join('') +
          '</div>'
        : '',
    };
  }

  /* The one line beside the box under the ruler while editing: the student
     picked in Check With a Student under the draft and as saved, and how many
     letter grades change. Empty when the draft moves no grade shown. */
  // html-safe: the name and every grade through esc
  function previewHtml(cid) {
    var shown = E.shownScale(cid);
    var saved = getGradingScale(cid);
    var st = CmGrading.checkStudent(cid);
    if (!shown || !st || !M.differs(saved, shown)) return '';
    var read = function (scale) {
      return readAsOfTerm(cid, null, function () {
        return withGradingScale(cid, scale, function () {
          return studentGradeSummary(cid, st.id).text || 'No scores yet';
        });
      });
    };
    var now = read(shown);
    var was = read(saved);
    var n = M.gradeEffects(cid, saved, shown).moves.length;
    var out = '';
    if (now !== was) out += '<span>' + esc(fullName(st) + ' ' + now + ', was ' + was) + '</span>';
    if (n) out += '<span>' + n + (n === 1 ? ' letter grade changes' : ' letter grades change') + '</span>';
    return out;
  }

  return { save: save, checkNotes: checkNotes, previewHtml: previewHtml };
})();
