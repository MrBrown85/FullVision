/* student-overrides.js — Student page override helpers */
window.StudentOverrides = (function () {
  'use strict';

  function toggleOverridePanel(opts) {
    var activeCourse = opts.activeCourse;
    var studentId = opts.studentId;
    var secId = opts.secId;
    var setSelectedLevel = opts.setSelectedLevel;
    var getSelectedLevel = opts.getSelectedLevel;
    var panel = document.getElementById('override-panel-' + secId);
    if (!panel) return;
    document.querySelectorAll('.override-panel').forEach(function (p) {
      if (p.id !== 'override-panel-' + secId) p.style.display = 'none';
    });
    if (panel.style.display !== 'none') {
      panel.style.display = 'none';
      return;
    }
    var override = getSectionOverride(activeCourse, studentId, secId);
    var rawProf = getSectionProficiencyRaw(activeCourse, studentId, secId);
    var rawRounded = Math.round(rawProf);
    setSelectedLevel(override ? override.level : 0);

    var html =
      '<div class="override-panel-header">' +
      '<span class="override-panel-title">Override Proficiency</span>' +
      '<button class="override-panel-close" data-action="closeOverridePanel" data-secid="' +
      secId +
      '">&times;</button>' +
      '</div>' +
      '<div class="override-calculated">Calculated: <strong>' +
      (rawProf > 0 ? rawProf.toFixed(1) : '—') +
      ' ' +
      (rawProf > 0 ? PROF_LABELS[rawRounded] : '') +
      '</strong></div>' +
      '<div class="override-levels">' +
      '<button class="override-level-btn' +
      (getSelectedLevel() === 4 ? ' selected' : '') +
      '" data-level="4" data-action="selectOverrideLevel" data-value="4">4 Extending</button>' +
      '<button class="override-level-btn' +
      (getSelectedLevel() === 3 ? ' selected' : '') +
      '" data-level="3" data-action="selectOverrideLevel" data-value="3">3 Proficient</button>' +
      '<button class="override-level-btn' +
      (getSelectedLevel() === 2 ? ' selected' : '') +
      '" data-level="2" data-action="selectOverrideLevel" data-value="2">2 Developing</button>' +
      '<button class="override-level-btn' +
      (getSelectedLevel() === 1 ? ' selected' : '') +
      '" data-level="1" data-action="selectOverrideLevel" data-value="1">1 Emerging</button>' +
      '</div>' +
      '<label class="override-reason-label">Reason (required)</label>' +
      '<textarea class="override-reason" id="override-reason-' +
      secId +
      '" placeholder="Professional judgment — what evidence supports this override?">' +
      (override ? esc(override.reason) : '') +
      '</textarea>' +
      '<div class="override-actions">' +
      (override
        ? '<button class="btn btn-ghost" style="color:var(--score-1)" data-action="clearOverride" data-secid="' +
          secId +
          '">Clear Override</button>'
        : '') +
      '<button class="btn btn-ghost" data-action="closeOverridePanel" data-secid="' +
      secId +
      '">Cancel</button>' +
      '<button class="btn btn-primary" data-action="saveOverride" data-secid="' +
      secId +
      '">Save Override</button>' +
      '</div>';
    panel.innerHTML = html;
    panel.style.display = '';
  }

  function selectOverrideLevel(level, currentLevel, setSelectedLevel, getSelectedLevel) {
    setSelectedLevel(currentLevel === level ? 0 : level);
    document.querySelectorAll('.override-level-btn').forEach(function (btn) {
      btn.classList.toggle('selected', parseInt(btn.dataset.level, 10) === getSelectedLevel());
    });
  }

  function saveOverride(activeCourse, studentId, secId, selectedLevel, onSaved) {
    var reasonEl = document.getElementById('override-reason-' + secId);
    var reason = (reasonEl ? reasonEl.value : '').trim();
    if (selectedLevel === 0) {
      alert('Select a proficiency level.');
      return false;
    }
    if (!reason) {
      if (reasonEl) {
        reasonEl.style.border = '2px solid var(--score-1)';
        reasonEl.focus();
        reasonEl.placeholder = 'Reason is required';
      }
      return false;
    }
    setSectionOverride(activeCourse, studentId, secId, selectedLevel, reason);
    if (typeof onSaved === 'function') onSaved();
    return true;
  }

  function clearOverride(activeCourse, studentId, secId, onSaved) {
    setSectionOverride(activeCourse, studentId, secId, 0, '');
    if (typeof onSaved === 'function') onSaved();
  }

  function closeOverridePanel(secId) {
    var panel = document.getElementById('override-panel-' + secId);
    if (panel) panel.style.display = 'none';
  }

  return {
    toggleOverridePanel: toggleOverridePanel,
    selectOverrideLevel: selectOverrideLevel,
    saveOverride: saveOverride,
    clearOverride: clearOverride,
    closeOverridePanel: closeOverridePanel,
  };
})();
