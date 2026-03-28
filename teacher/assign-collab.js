/* assign-collab.js — Collaboration panel (extracted from page-assignments.js) */
window.AssignCollab = (function() {
  'use strict';

  /* ── State ──────────────────────────────────────────────── */
  var _activeCourse = null;
  var newCollaboration = 'individual';
  var collabExcluded = new Set();
  var collabPairs = [];
  var collabGroups = [];
  var collabGroupCount = 4;
  var collabPairMode = 'random';
  var collabGroupMode = 'random';
  var _dragSid = null;
  var _dragFromGroup = null;

  function configure(cid) { _activeCourse = cid; }

  function resetState() {
    newCollaboration = 'individual';
    collabExcluded = new Set();
    collabPairs = [];
    collabGroups = [];
    collabGroupCount = 4;
    collabPairMode = 'random';
    collabGroupMode = 'random';
  }

  function getCollabStudents() {
    return sortStudents(getStudents(_activeCourse), 'lastName');
  }

  function setCollaboration(mode) {
    newCollaboration = mode;
    document.querySelectorAll('.af-collab-btn').forEach(function(b) {
      b.className = 'af-type-btn af-collab-btn' + (b.dataset.collab === mode ? ' active' : '');
    });
    renderCollabPanel();
  }

  function getCollabStudents() {
    return sortStudents(getStudents(activeCourse), 'lastName');
  }

  function renderCollabPanel() {
    var mount = document.getElementById('collab-panel-mount');
    if (!mount) return;
    var students = getCollabStudents();

    if (newCollaboration === 'individual') {
      var html = '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
          '<span class="collab-panel-title">Assign to Students</span>' +
          '<div class="collab-panel-actions">' +
            '<button class="collab-panel-btn" data-action="collabCheckAll">Check All</button>' +
            '<button class="collab-panel-btn" data-action="collabCheckNone">Check None</button>' +
          '</div>' +
        '</div>' +
        '<div class="collab-student-grid">';
      students.forEach(function(s) {
        var checked = !collabExcluded.has(s.id);
        html += '<label class="collab-student-item' + (checked ? '' : ' excluded') + '">' +
          '<input type="checkbox" ' + (checked ? 'checked' : '') + ' data-action-change="collabToggleStudent" data-sid="' + s.id + '">' +
          '<span>' + esc(displayName(s)) + '</span>' +
        '</label>';
      });
      html += '</div>' +
        '<div style="margin-top:8px;font-family:\'SF Mono\',monospace;font-size:0.6rem;color:var(--text-3)">' +
          (students.length - collabExcluded.size) + ' of ' + students.length + ' students assigned' +
        '</div>' +
      '</div>';
      mount.innerHTML = html;

    } else if (newCollaboration === 'pair') {
      var html = '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
          '<span class="collab-panel-title">Pair Students</span>' +
          '<div class="collab-panel-actions">' +
            '<button class="collab-panel-btn' + (collabPairMode==='random'?' active':'') + '" data-action="collabRandomPairs">Random Pairs</button>' +
            '<button class="collab-panel-btn' + (collabPairMode==='manual'?' active':'') + '" data-action="collabManualPairs">Manual</button>' +
          '</div>' +
        '</div>';
      if (collabPairs.length === 0) {
        html += '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:0.82rem">' +
          'Click <strong>Random Pairs</strong> to auto-pair, or <strong>Manual</strong> to drag students into pairs.' +
        '</div>';
      } else {
        html += '<div class="collab-groups-container">';
        collabPairs.forEach(function(pair, gi) {
          html += '<div class="collab-group-card" data-group="' + gi + '" data-collab-drop="' + gi + '">' +
            '<div class="collab-group-header"><span>Pair ' + (gi + 1) + '</span><span>' + pair.length + ' student' + (pair.length !== 1 ? 's' : '') + '</span></div>';
          pair.forEach(function(sid) {
            var st = students.find(function(s) { return s.id === sid; });
            if (!st) return;
            html += '<div class="collab-group-member" draggable="true" data-collab-drag-sid="' + sid + '" data-collab-drag-group="' + gi + '">' +
              '<span class="member-avatar" style="background:' + _avatarColor(sid) + '">' + initials(st) + '</span>' +
              '<span>' + esc(displayName(st)) + '</span>' +
            '</div>';
          });
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      mount.innerHTML = html;

    } else if (newCollaboration === 'group') {
      var total = students.length;
      var perGroup = Math.floor(total / collabGroupCount);
      var remainder = total % collabGroupCount;
      var sizeDesc = remainder > 0
        ? (collabGroupCount - remainder) + ' groups of ' + perGroup + ', ' + remainder + ' of ' + (perGroup + 1)
        : collabGroupCount + ' groups of ' + perGroup;
      var html = '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
          '<span class="collab-panel-title">Group Students</span>' +
          '<div class="collab-panel-actions">' +
            '<button class="collab-panel-btn' + (collabGroupMode==='random'?' active':'') + '" data-action="collabRandomGroups">Randomize</button>' +
            '<button class="collab-panel-btn' + (collabGroupMode==='manual'?' active':'') + '" data-action="collabManualGroups">Manual</button>' +
          '</div>' +
        '</div>' +
        '<div class="collab-stepper">' +
          '<span class="collab-stepper-label">Number of groups</span>' +
          '<div class="collab-stepper-controls">' +
            '<button class="collab-stepper-btn" data-action="collabSetGroupCount" data-delta="-1">\u2212</button>' +
            '<div class="collab-stepper-val">' + collabGroupCount + '</div>' +
            '<button class="collab-stepper-btn" data-action="collabSetGroupCount" data-delta="1">+</button>' +
          '</div>' +
          '<span class="collab-stepper-info">' + sizeDesc + ' \u00B7 ' + total + ' students</span>' +
        '</div>';
      if (collabGroups.length === 0) {
        html += '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:0.82rem">' +
          'Click <strong>Randomize</strong> to auto-assign groups, or <strong>Manual</strong> to drag students.' +
        '</div>';
      } else {
        html += '<div class="collab-groups-container">';
        collabGroups.forEach(function(group, gi) {
          html += '<div class="collab-group-card" data-group="' + gi + '" data-collab-drop="' + gi + '">' +
            '<div class="collab-group-header"><span>Group ' + (gi + 1) + '</span><span>' + group.length + ' student' + (group.length !== 1 ? 's' : '') + '</span></div>';
          group.forEach(function(sid) {
            var st = students.find(function(s) { return s.id === sid; });
            if (!st) return;
            html += '<div class="collab-group-member" draggable="true" data-collab-drag-sid="' + sid + '" data-collab-drag-group="' + gi + '">' +
              '<span class="member-avatar" style="background:' + _avatarColor(sid) + '">' + initials(st) + '</span>' +
              '<span>' + esc(displayName(st)) + '</span>' +
            '</div>';
          });
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      mount.innerHTML = html;
    }
  }

  function collabToggleStudent(sid, checked) {
    if (checked) collabExcluded.delete(sid);
    else collabExcluded.add(sid);
    renderCollabPanel();
  }
  function collabCheckAll() { collabExcluded.clear(); renderCollabPanel(); }
  function collabCheckNone() {
    getCollabStudents().forEach(function(s) { collabExcluded.add(s.id); });
    renderCollabPanel();
  }
  function collabRandomPairs() {
    var students = getCollabStudents();
    var shuffled = students.slice().sort(function() { return Math.random() - 0.5; });
    collabPairs = [];
    for (var i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) {
        collabPairs.push([shuffled[i].id, shuffled[i + 1].id]);
      } else {
        if (collabPairs.length > 0) collabPairs[collabPairs.length - 1].push(shuffled[i].id);
        else collabPairs.push([shuffled[i].id]);
      }
    }
    collabPairMode = 'random';
    renderCollabPanel();
  }
  function collabRandomGroups() {
    var students = getCollabStudents();
    var shuffled = students.slice().sort(function() { return Math.random() - 0.5; });
    collabGroups = Array.from({ length: collabGroupCount }, function() { return []; });
    shuffled.forEach(function(s, i) { collabGroups[i % collabGroupCount].push(s.id); });
    collabGroupMode = 'random';
    renderCollabPanel();
  }
  function collabSetGroupCount(delta) {
    var students = getCollabStudents();
    collabGroupCount = Math.max(2, Math.min(students.length, collabGroupCount + delta));
    if (collabGroups.length > 0) collabRandomGroups();
    else renderCollabPanel();
  }
  function collabDragStart(e, sid, fromGroup) {
    _dragSid = sid;
    _dragFromGroup = fromGroup;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sid);
  }
  function collabDrop(e, toGroup) {
    e.preventDefault();
    var dropEl = e.target.closest('[data-collab-drop]');
    if (dropEl) dropEl.classList.remove('drag-over');
    if (_dragSid == null || _dragFromGroup === toGroup) return;
    var arr = newCollaboration === 'pair' ? collabPairs : collabGroups;
    if (!arr[_dragFromGroup] || !arr[toGroup]) return;
    var idx = arr[_dragFromGroup].indexOf(_dragSid);
    if (idx >= 0) arr[_dragFromGroup].splice(idx, 1);
    arr[toGroup].push(_dragSid);
    if (newCollaboration === 'pair') collabPairs = collabPairs.filter(function(g) { return g.length > 0; });
    else collabGroups = collabGroups.filter(function(g) { return g.length > 0; });
    _dragSid = null;
    _dragFromGroup = null;
    renderCollabPanel();
  }
  function loadCollabData(assess) {
    collabExcluded = new Set(assess && assess.excludedStudents ? assess.excludedStudents : []);
    collabPairs = assess && assess.pairs ? structuredClone(assess.pairs) : [];
    collabGroups = assess && assess.groups ? structuredClone(assess.groups) : [];
    collabGroupCount = assess && assess.groupCount ? assess.groupCount : 4;
    collabPairMode = collabPairs.length > 0 ? 'manual' : 'random';
    collabGroupMode = collabGroups.length > 0 ? 'manual' : 'random';
  }

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    configure: configure,
    resetState: resetState,
    setCollaboration: setCollaboration,
    renderCollabPanel: renderCollabPanel,
    collabToggleStudent: collabToggleStudent,
    collabCheckAll: collabCheckAll,
    collabCheckNone: collabCheckNone,
    collabRandomPairs: collabRandomPairs,
    collabRandomGroups: collabRandomGroups,
    collabSetGroupCount: collabSetGroupCount,
    collabDragStart: collabDragStart,
    collabDrop: collabDrop,
    loadCollabData: loadCollabData,
    get collaboration() { return newCollaboration; },
    set collaboration(v) { newCollaboration = v; },
    get excluded() { return collabExcluded; },
    get pairs() { return collabPairs; },
    get groups() { return collabGroups; },
    get groupCount() { return collabGroupCount; },
  };
})();
