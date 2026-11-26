// @ts-check
/* cm-withdrawn.js — Class Settings: withdrawn students. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmWithdrawn = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var renderClassManager, state;
  function configure(h) {
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
  }

  function withdrawStudentUI(sid) {
    // The roster is rendered for cmSelectedCourse, which is not always the
    // dashboard's active course: cmSelectClass moves the manager's selection
    // on its own, and page-dashboard re-injects its own activeCourse through
    // CM.configure. Looking the student up in _activeCourse therefore searched
    // the wrong course, found nothing and returned here — the X button did
    // nothing at all. Every other roster action (add, edit, bulk, CSV import)
    // already keys off cmSelectedCourse; this was the lone outlier.
    // Capture the id once so the confirm and undo callbacks stay pinned to the
    // course the row belonged to even if the selection moves meanwhile.
    var cid = state.cmSelectedCourse;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;
    var dname = displayName(st);
    showConfirm(
      'Withdraw student',
      'Withdraw ' +
        dname +
        ' from this class? They leave the roster, gradebook and reports. Their scores, observations and reports are kept, and you can re-enrol them from the Withdrawn list.',
      'Withdraw',
      'primary',
      function () {
        if (!withdrawStudent(cid, sid)) return;
        renderClassManager();
        showUndoToast(dname + ' withdrawn', function () {
          reenrolStudent(cid, sid);
          renderClassManager();
        });
      },
    );
  }

  function cmReenrolStudent(sid) {
    if (!state.cmSelectedCourse) return;
    if (reenrolStudent(state.cmSelectedCourse, sid)) renderClassManager();
  }

  /* S8-F1: who in class `cid` has photos of their work sent, { sid: true }
     (CmStudentPage.studentsWithPhotos, the one question). Empty, so every
     delete reads as it always has, while the class's build switch is off or
     nothing has been sent. Send Work is not asked: photos sent before it was
     turned off still go. */
  function _cmStudentsWithPhotos(cid) {
    return typeof CmStudentPage !== 'undefined' && CmStudentPage.studentsWithPhotos
      ? CmStudentPage.studentsWithPhotos(cid)
      : {};
  }

  /* The same, read from the server first when this session has not read the
     class's work (readStudentWorkForDelete; Send Work off reads nothing
     else), then then(who, maybe): maybe is true when that read failed, and
     the warning says photos go rather than miss them. At once when nothing
     needs reading. */
  function _cmPhotosBeforeDelete(cid, then) {
    var read = typeof readStudentWorkForDelete === 'function' ? readStudentWorkForDelete(cid) : null;
    if (!read) return then(_cmStudentsWithPhotos(cid), false);
    return read.then(function (res) {
      return then(_cmStudentsWithPhotos(cid), !(res && res.known));
    });
  }

  /* The second step: only a withdrawn student can be deleted, and the
     delete cannot be undone, so there is no Undo. */
  function cmDeleteWithdrawn(sid) {
    var cid = state.cmSelectedCourse;
    if (!cid) return;
    // Photos of their work go too (S8-F1, Colin's ruling 102).
    return _cmPhotosBeforeDelete(cid, function (who, maybe) {
      if (state.cmSelectedCourse !== cid) return;
      _cmConfirmDeleteWithdrawn(cid, sid, maybe || !!who[sid]);
    });
  }

  function _cmConfirmDeleteWithdrawn(cid, sid, photos) {
    var entry = getWithdrawnStudents(cid).find(function (w) {
      return w && w.student && w.student.id === sid;
    });
    if (!entry) return;
    var name = fullName(entry.student);
    showConfirm(
      'Delete ' + name + ' Permanently?',
      photos
        ? 'Their scores, observations, goals, reflections, reports and photos of their work in this class are deleted. This cannot be undone.'
        : 'Their scores, observations, goals, reflections and reports in this class are deleted. This cannot be undone.',
      'Delete Permanently',
      'danger',
      function () {
        if (deleteWithdrawnStudent(cid, sid)) renderClassManager();
      },
    );
    // Keep a copy first: a CSV of their scores and observations, offered
    // inside the dialog before the delete.
    var overlays = document.querySelectorAll('.confirm-overlay');
    var card = overlays.length && overlays[overlays.length - 1].querySelector('.confirm-card');
    var actions = card && card.querySelector('.confirm-actions');
    if (!actions) return;
    var keep = document.createElement('div');
    keep.className = 'cm-keep-copy';
    keep.innerHTML =
      '<span class="cm-keep-copy-text"><strong>Keep a copy first</strong><span>A CSV of ' +
      esc(name) +
      '’s scores and observations in ' +
      esc((COURSES[cid] && COURSES[cid].name) || 'this class') +
      '.</span>' +
      (photos ? '<span>Photos of their work are not in this file.</span>' : '') +
      '</span>' +
      '<button type="button" class="cm-action-btn" id="cm-keep-copy-btn">Download Records</button>';
    /** @type {any} */ (card).insertBefore(keep, actions);
    /** @type {any} */ (keep.querySelector('#cm-keep-copy-btn')).addEventListener('click', function (e) {
      e.preventDefault();
      _cmDownloadWithdrawnRecords(cid, entry, e.currentTarget);
    });
  }

  /* The withdrawn student's records as CSV rows. This device's copy when it
     has one (it withdrew them, or Demo Mode); else the server's. */
  /* A score as the download shows it, the same whichever way the records
     came: "8 / 10", "Complete" or "Incomplete", or a proficiency ("3+"). */
  function _cmRecordScoreText(mode, value, maxPoints, mod) {
    if (value == null || value === '') return '';
    if (mode === 'complete') return Number(value) > 0 ? 'Complete' : 'Incomplete';
    if (mode === 'points') return value + ' / ' + (maxPoints != null ? maxPoints : '');
    return formatScoreLevel(Number(value), mod) || String(value);
  }

  function _cmWithdrawnRecordRows(cid, entry) {
    var rec = entry.records || {};
    var hasLocal = (rec.scores && rec.scores.length) || (rec.observations && rec.observations.length);
    if (hasLocal || !window.v2 || !window.v2.getWithdrawnStudentRecords) {
      var assess = {};
      getAssessments(cid).forEach(function (a) {
        assess[a.id] = a;
      });
      var tags = {};
      getAllTags(cid).forEach(function (t) {
        tags[t.id] = t;
      });
      var rows = (rec.scores || []).map(function (sc) {
        var a = assess[sc.assessmentId] || {};
        var t = tags[sc.tagId] || {};
        var status = rec.statuses ? rec.statuses[entry.student.id + ':' + sc.assessmentId] : '';
        return [
          'Score',
          sc.date || a.dueDate || a.date || '',
          a.title || '',
          t.label || '',
          _cmRecordScoreText(a.scoreMode || a.score_mode || 'proficiency', sc.score, a.maxPoints, sc.mod),
          status || '',
          sc.comment || '',
        ];
      });
      (rec.observations || []).forEach(function (o) {
        rows.push([
          'Observation',
          o.date || (o.created || '').slice(0, 10),
          '',
          '',
          '',
          o.sentiment || '',
          o.text || '',
        ]);
      });
      return Promise.resolve(rows);
    }
    return /** @type {any} */ (window.v2).getWithdrawnStudentRecords(entry.student.id).then(function (res) {
      if (res.error || !res.data) throw res.error || new Error('No records came back.');
      var d = res.data;
      var day = function (v) {
        return v ? String(v).slice(0, 10) : '';
      };
      var rows = [];
      (d.scores || []).forEach(function (r) {
        rows.push([
          'Score',
          day(r.date),
          r.assessment || '',
          '',
          _cmRecordScoreText(r.score_mode || 'proficiency', r.value, r.max_points, r.modifier),
          r.status || '',
          r.comment || '',
        ]);
      });
      (d.tag_scores || []).forEach(function (r) {
        rows.push([
          'Competency Score',
          day(r.date),
          r.assessment || '',
          r.competency || '',
          formatScoreLevel(r.value, r.modifier),
          '',
          '',
        ]);
      });
      (d.rubric_scores || []).forEach(function (r) {
        rows.push([
          'Rubric Score',
          day(r.date),
          r.assessment || '',
          r.criterion || '',
          formatScoreLevel(r.value, r.modifier),
          '',
          r.comment || '',
        ]);
      });
      (d.observations || []).forEach(function (r) {
        rows.push(['Observation', day(r.date), '', '', '', r.sentiment || '', r.body || '']);
      });
      return rows;
    });
  }

  function _cmDownloadWithdrawnRecords(cid, entry, btn) {
    if (btn) btn.disabled = true;
    _cmWithdrawnRecordRows(cid, entry)
      .then(function (rows) {
        var header = [
          'Record',
          'Date',
          'Assessment',
          'Competency or Criterion',
          'Score',
          'Status or Type',
          'Comment or Text',
        ];
        var csv = [header]
          .concat(rows)
          .map(function (r) {
            return r
              .map(function (c) {
                return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"';
              })
              .join(',');
          })
          .join('\n');
        var blob = new Blob([csv], { type: 'text/csv' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download =
          (fullName(entry.student) + '_' + ((COURSES[cid] && COURSES[cid].name) || 'class')).replace(/[^\w-]+/g, '_') +
          '_records.csv';
        a.click();
        URL.revokeObjectURL(url);
        if (btn) btn.textContent = 'Downloaded';
      })
      .catch(function () {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Try Again';
        }
      });
  }

  /* Withdrawn students, under the roster: when they left, Re-enrol, and
     the permanent delete. */
  function renderWithdrawnList(cid) {
    var list = getWithdrawnStudents(cid).filter(function (w) {
      return w && w.student && w.student.id;
    });
    if (!list.length) return '';
    var html =
      '<div class="cm-section cm-withdrawn" id="cm-withdrawn">' +
      '<div class="cm-withdrawn-title">Withdrawn <span class="cm-section-count">(' +
      list.length +
      ')</span></div>' +
      '<p class="cm-withdrawn-help">Their scores, observations and reports are kept. Re-enrol brings everything back.</p>' +
      '<div class="cm-student-list">';
    list.forEach(function (w) {
      var st = w.student;
      var when = w.withdrawnAt ? _cmWithdrawnDate(w.withdrawnAt) : '';
      html +=
        '<div class="cm-student-row cm-withdrawn-row" data-withdrawn-sid="' +
        esc(st.id) +
        '">' +
        '<span class="cm-student-name">' +
        esc(fullName(st)) +
        '</span>' +
        (st.studentNumber ? '<span class="cm-roster-num">' + esc(st.studentNumber) + '</span>' : '') +
        (when ? '<span class="cm-withdrawn-when">Withdrawn ' + esc(when) + '</span>' : '') +
        '<div class="cm-student-actions">' +
        '<button class="cm-add-link cm-withdrawn-btn" data-action="cmReenrolStudent" data-sid="' +
        esc(st.id) +
        '">Re-enrol</button>' +
        '<button class="cm-add-link cm-withdrawn-btn cm-withdrawn-delete" data-action="cmDeleteWithdrawn" data-sid="' +
        esc(st.id) +
        '">Delete Permanently\u2026</button>' +
        '</div>' +
        '</div>';
    });
    return html + '</div></div>';
  }

  function _cmWithdrawnDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return {
    configure: configure,
    _cmPhotosBeforeDelete: _cmPhotosBeforeDelete,
    _cmWithdrawnRecordRows: _cmWithdrawnRecordRows,
    cmDeleteWithdrawn: cmDeleteWithdrawn,
    cmReenrolStudent: cmReenrolStudent,
    renderWithdrawnList: renderWithdrawnList,
    withdrawStudentUI: withdrawStudentUI,
  };
})();
