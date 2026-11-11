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
    setSelectedLevel(override ? override.level : 0);
    // Each level's one-line descriptor beside its button, and the calculated
    // level marked (Nov 2 mockup, batch 2).
    var sec = (getSections(activeCourse) || []).find(function (x) {
      return x.id === secId;
    });
    var tag = sec && sec.tags ? sec.tags[0] : null;
    var calcLevel = rawProf > 0 ? Math.max(1, Math.min(4, roundLevel(rawProf))) : 0;
    var calcText = [formatLevel(activeCourse, rawProf), levelWord(activeCourse, rawProf)].filter(Boolean).join(' ');
    var wording = function (l) {
      var w = window.CompetencyWording && tag ? CompetencyWording.lines(tag, l) : null;
      return w ? w.descriptor : '';
    };

    var html =
      '<div class="override-panel-header">' +
      '<span class="override-panel-title">Override Proficiency</span>' +
      '<button class="override-panel-close" data-action="closeOverridePanel" data-secid="' +
      secId +
      '">&times;</button>' +
      '</div>' +
      '<div class="override-calculated">Calculated: <strong>' +
      esc(calcText) +
      '</strong></div>' +
      '<div class="override-levels has-wording">' +
      // In the class's Rubric Levels order.
      levelOrderFor(activeCourse)
        .map(function (l) {
          return (
            '<div class="override-level-row' +
            (l === calcLevel ? ' is-calc' : '') +
            '"><button class="override-level-btn' +
            (getSelectedLevel() === l ? ' selected' : '') +
            '" data-level="' +
            l +
            '" data-action="selectOverrideLevel" data-value="' +
            l +
            '">' +
            l +
            ' ' +
            PROF_LABELS[l] +
            '</button><span class="override-level-desc" data-level="' +
            l +
            '">' +
            esc(wording(l)) +
            (l === calcLevel ? '<span class="override-level-calc">Calculated: ' + esc(calcText) + '</span>' : '') +
            '</span></div>'
          );
        })
        .join('') +
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
    // html-safe: the reason and calculated level are escaped; secId is our section id; levels and labels are fixed.
    panel.innerHTML = html;
    panel.style.display = '';
    // A bank competency's wording loads late: the descriptors fill in place once it is here.
    var first = window.CompetencyWording && tag ? CompetencyWording.lines(tag, 1) : null;
    if (first && !first.ready && window.RubricPrint && RubricPrint.loadBankLevels)
      RubricPrint.loadBankLevels().then(function (ok) {
        if (!ok) return;
        panel.querySelectorAll('.override-level-desc').forEach(function (d) {
          var l = parseInt(d.dataset.level, 10);
          var calc = d.querySelector('.override-level-calc');
          d.textContent = wording(l);
          if (calc) d.appendChild(calc);
        });
      });
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
