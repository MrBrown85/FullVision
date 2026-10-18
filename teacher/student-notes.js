/* student-notes.js — Student page notes helpers */
window.StudentNotes = (function () {
  'use strict';

  /* Deleted notes stay in the data layer until their Undo toast closes. */
  var _pending = {};

  function renderNotes(cid, studentId) {
    var obs = getStudentQuickObs(cid, studentId).filter(function (n) {
      return !_pending[n.id];
    });
    var container = document.getElementById('notes-list');
    if (!container) return;

    if (obs.length === 0) {
      container.innerHTML =
        '<div class="notes-empty">' +
        'No notes or observations yet.<br>Add one below or capture from the <a href="#/observations?course=' +
        cid +
        '" style="color:var(--active);text-decoration:none">Observations</a> page.' +
        '</div>';
      return;
    }

    container.innerHTML = obs
      .map(function (n) {
        var d = new Date(n.created);
        var shortDate = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        var sent = n.sentiment && OBS_SENTIMENTS[n.sentiment];
        var ctx = n.context && OBS_CONTEXTS[n.context];
        var tagLabels = (n.dims || []).map(function (t) {
          return resolveTag(t).label;
        });
        return (
          '<div class="note-inline"' +
          (n.sentiment ? ' data-sentiment="' + n.sentiment + '"' : '') +
          ' data-text="' +
          esc((n.text + ' ' + tagLabels.join(' ')).toLowerCase()) +
          '">' +
          '<div class="note-inline-left">' +
          '<span class="note-inline-date">' +
          shortDate +
          '</span>' +
          '</div>' +
          '<div class="note-inline-body">' +
          '<div class="note-inline-text">' +
          esc(n.text) +
          '</div>' +
          '<div class="note-inline-dims">' +
          (sent
            ? '<span class="obs-pill obs-pill-type" data-sentiment="' + n.sentiment + '">' + esc(sent.label) + '</span>'
            : '') +
          (ctx ? '<span class="obs-pill">' + esc(ctx.label) + '</span>' : '') +
          (n.assignmentContext && n.assignmentContext.assessmentTitle
            ? '<span class="obs-pill obs-pill-assessment">' +
              esc(n.assignmentContext.assessmentTitle) +
              (n.assignmentContext.proficiencyLevel ? ' · ' + esc(n.assignmentContext.proficiencyLevel) : '') +
              '</span>'
            : '') +
          (n.dims || [])
            .map(function (t, i) {
              return (
                '<span class="obs-card-dim"><span class="dim-dot" style="background:' +
                obsTagColor(t) +
                '"></span>' +
                esc(tagLabels[i]) +
                '</span>'
              );
            })
            .join('') +
          '</div>' +
          '</div>' +
          '<button class="note-inline-del" data-action="deleteNote" data-noteid="' +
          n.id +
          '" title="Delete" aria-label="Delete note">&times;</button>' +
          '</div>'
        );
      })
      .join('');
  }

  function filterNotes(query) {
    var q = query.toLowerCase().trim();
    document.querySelectorAll('.note-inline').forEach(function (note) {
      var text = note.getAttribute('data-text') || note.textContent.toLowerCase();
      note.style.display = !q || text.includes(q) ? '' : 'none';
    });
  }

  function addNote(cid, studentId) {
    var input = document.getElementById('note-input');
    var text = (input.value || '').trim();
    if (!text) return false;
    addQuickOb(cid, studentId, text, []);
    input.value = '';
    input.focus();
    renderNotes(cid, studentId);
    return true;
  }

  /* One click hides the note and offers Undo for six seconds; the delete
     happens when the toast closes without Undo. */
  function deleteNote(cid, studentId, noteId) {
    if (_pending[noteId]) return;
    _pending[noteId] = true;
    renderNotes(cid, studentId);
    var settled = false;
    showUndoToast(
      'Observation deleted',
      function () {
        if (settled) return;
        settled = true;
        delete _pending[noteId];
        renderNotes(cid, studentId);
      },
      function () {
        if (settled) return;
        settled = true;
        delete _pending[noteId];
        deleteQuickOb(cid, studentId, noteId);
        renderNotes(cid, studentId);
      },
      6000,
    );
  }

  return {
    renderNotes: renderNotes,
    filterNotes: filterNotes,
    addNote: addNote,
    deleteNote: deleteNote,
  };
})();
