/* assign-collab.js — Collaboration panel (extracted from page-assignments.js) */
window.AssignCollab = (function () {
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

  function configure(cid) {
    _activeCourse = cid;
  }

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
    segSelect(document.querySelector('.af-collab-btn[data-collab="' + mode + '"]'));
    renderCollabPanel();
  }

  function renderCollabPanel() {
    var mount = document.getElementById('collab-panel-mount');
    if (!mount) return;
    var students = getCollabStudents();

    if (newCollaboration === 'individual') {
      var html =
        '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
        '<span class="collab-panel-title">Assign to Students</span>' +
        '<div class="collab-panel-actions">' +
        '<button class="collab-panel-btn" data-action="collabCheckAll">Check All</button>' +
        '<button class="collab-panel-btn" data-action="collabCheckNone">Check None</button>' +
        '</div>' +
        '</div>' +
        '<div class="collab-student-grid">';
      students.forEach(function (s) {
        var checked = !collabExcluded.has(s.id);
        html +=
          '<label class="collab-student-item' +
          (checked ? '' : ' excluded') +
          '">' +
          '<input type="checkbox" ' +
          (checked ? 'checked' : '') +
          ' data-action-change="collabToggleStudent" data-sid="' +
          s.id +
          '">' +
          '<span>' +
          esc(displayName(s)) +
          '</span>' +
          '</label>';
      });
      html +=
        '</div>' +
        '<div style="margin-top:8px;font-size:0.75rem;color:var(--text-3)">' +
        (students.length - collabExcluded.size) +
        ' of ' +
        students.length +
        ' students assigned' +
        '</div>' +
        '</div>';
      mount.innerHTML = html;
    } else if (newCollaboration === 'pair') {
      var html =
        '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
        '<span class="collab-panel-title">Pair Students</span>' +
        '<div class="collab-panel-actions">' +
        '<button class="collab-panel-btn' +
        (collabPairMode === 'random' ? ' active' : '') +
        '" data-action="collabRandomPairs">Random Pairs</button>' +
        '<button class="collab-panel-btn' +
        (collabPairMode === 'manual' ? ' active' : '') +
        '" data-action="collabManualPairs">Manual</button>' +
        '</div>' +
        '</div>';
      if (collabPairs.length === 0) {
        html +=
          '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:0.875rem">' +
          'Click <strong>Random Pairs</strong> to auto-pair, or <strong>Manual</strong> to drag students into pairs.' +
          '</div>';
      } else {
        html += _cardsHtml(collabPairs, 'Pair', students);
      }
      html += '</div>';
      mount.innerHTML = html; // html-safe: names go through esc() in _memberHtml
    } else if (newCollaboration === 'group') {
      var total = students.length;
      var perGroup = Math.floor(total / collabGroupCount);
      var remainder = total % collabGroupCount;
      var sizeDesc =
        remainder > 0
          ? collabGroupCount - remainder + ' groups of ' + perGroup + ', ' + remainder + ' of ' + (perGroup + 1)
          : collabGroupCount + ' groups of ' + perGroup;
      var html =
        '<div class="collab-panel">' +
        '<div class="collab-panel-header">' +
        '<span class="collab-panel-title">Group Students</span>' +
        '<div class="collab-panel-actions">' +
        '<button class="collab-panel-btn' +
        (collabGroupMode === 'random' ? ' active' : '') +
        '" data-action="collabRandomGroups">Randomize</button>' +
        '<button class="collab-panel-btn' +
        (collabGroupMode === 'manual' ? ' active' : '') +
        '" data-action="collabManualGroups">Manual</button>' +
        '</div>' +
        '</div>' +
        '<div class="collab-stepper">' +
        '<span class="collab-stepper-label">Number of groups</span>' +
        '<div class="collab-stepper-controls">' +
        '<button class="collab-stepper-btn" data-action="collabSetGroupCount" data-delta="-1">\u2212</button>' +
        '<div class="collab-stepper-val">' +
        collabGroupCount +
        '</div>' +
        '<button class="collab-stepper-btn" data-action="collabSetGroupCount" data-delta="1">+</button>' +
        '</div>' +
        '<span class="collab-stepper-info">' +
        sizeDesc +
        ' \u00B7 ' +
        total +
        ' students</span>' +
        '</div>';
      if (collabGroups.length === 0) {
        html +=
          '<div style="text-align:center;padding:20px;color:var(--text-3);font-size:0.875rem">' +
          'Click <strong>Randomize</strong> to auto-assign groups, or <strong>Manual</strong> to drag students.' +
          '</div>';
      } else {
        html += _cardsHtml(collabGroups, 'Group', students);
      }
      html += '</div>';
      mount.innerHTML = html; // html-safe: names go through esc() in _memberHtml
    }
  }

  /* One card per pair or group, then an Unassigned card for anyone not in
     one (everyone, right after Manual). The Unassigned card is drop target -1. */
  function _cardsHtml(arr, noun, students) {
    var placed = new Set();
    arr.forEach(function (g) {
      g.forEach(function (sid) {
        placed.add(sid);
      });
    });
    var html = '<div class="collab-groups-container">';
    arr.forEach(function (group, gi) {
      html += _cardHtml(noun + ' ' + (gi + 1), gi, group, students);
    });
    var unassigned = students
      .filter(function (s) {
        return !placed.has(s.id);
      })
      .map(function (s) {
        return s.id;
      });
    if (unassigned.length) html += _cardHtml('Unassigned', -1, unassigned, students);
    return html + '</div>';
  }

  function _cardHtml(title, gi, sids, students) {
    var html =
      '<div class="collab-group-card" data-group="' +
      gi +
      '" data-collab-drop="' +
      gi +
      '">' +
      '<div class="collab-group-header"><span>' +
      esc(title) +
      '</span><span>' +
      sids.length +
      ' student' +
      (sids.length !== 1 ? 's' : '') +
      '</span></div>';
    sids.forEach(function (sid) {
      var st = students.find(function (s) {
        return s.id === sid;
      });
      if (st) html += _memberHtml(st, gi);
    });
    return html + '</div>';
  }

  function _memberHtml(st, gi) {
    return (
      '<div class="collab-group-member" draggable="true" data-collab-drag-sid="' +
      esc(st.id) +
      '" data-collab-drag-group="' +
      gi +
      '">' +
      '<span class="member-avatar" style="background:' +
      _avatarColor(st.id) +
      '">' +
      esc(initials(st)) +
      '</span>' +
      '<span>' +
      esc(displayName(st)) +
      '</span>' +
      '</div>'
    );
  }

  function collabToggleStudent(sid, checked) {
    if (checked) collabExcluded.delete(sid);
    else collabExcluded.add(sid);
    renderCollabPanel();
  }
  function collabCheckAll() {
    collabExcluded.clear();
    renderCollabPanel();
  }
  function collabCheckNone() {
    getCollabStudents().forEach(function (s) {
      collabExcluded.add(s.id);
    });
    renderCollabPanel();
  }
  function collabRandomPairs() {
    var students = getCollabStudents();
    var shuffled = students.slice().sort(function () {
      return Math.random() - 0.5;
    });
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
    var shuffled = students.slice().sort(function () {
      return Math.random() - 0.5;
    });
    collabGroups = Array.from({ length: collabGroupCount }, function () {
      return [];
    });
    shuffled.forEach(function (s, i) {
      collabGroups[i % collabGroupCount].push(s.id);
    });
    collabGroupMode = 'random';
    renderCollabPanel();
  }
  /* Manual keeps any pairs already made; with none, it lays out empty pairs
     and every student starts in Unassigned. */
  function collabManualPairs() {
    if (collabPairs.length === 0) {
      var count = Math.max(1, Math.floor(getCollabStudents().length / 2));
      collabPairs = Array.from({ length: count }, function () {
        return [];
      });
    }
    collabPairMode = 'manual';
    renderCollabPanel();
  }
  function collabManualGroups() {
    if (collabGroups.length === 0) {
      collabGroups = Array.from({ length: collabGroupCount }, function () {
        return [];
      });
    }
    collabGroupMode = 'manual';
    renderCollabPanel();
  }
  function collabSetGroupCount(delta) {
    var students = getCollabStudents();
    var next = Math.max(2, Math.min(students.length, collabGroupCount + delta));
    if (next === collabGroupCount) return;
    collabGroupCount = next;
    if (collabGroups.length > 0 && collabGroupMode === 'manual') {
      // Manual groups stay put: add an empty group, or drop the last one and
      // send its students back to Unassigned.
      while (collabGroups.length < collabGroupCount) collabGroups.push([]);
      if (collabGroups.length > collabGroupCount) collabGroups = collabGroups.slice(0, collabGroupCount);
      renderCollabPanel();
    } else if (collabGroups.length > 0) collabRandomGroups();
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
    // -1 is the Unassigned card. Emptied pairs and groups stay so they can be
    // filled again.
    if ((_dragFromGroup !== -1 && !arr[_dragFromGroup]) || (toGroup !== -1 && !arr[toGroup])) return;
    if (_dragFromGroup !== -1) {
      var idx = arr[_dragFromGroup].indexOf(_dragSid);
      if (idx >= 0) arr[_dragFromGroup].splice(idx, 1);
    }
    if (toGroup !== -1) arr[toGroup].push(_dragSid);
    if (newCollaboration === 'pair') collabPairMode = 'manual';
    else collabGroupMode = 'manual';
    _dragSid = null;
    _dragFromGroup = null;
    renderCollabPanel();
  }
  function loadCollabData(assess) {
    collabExcluded = new Set(assess && assess.excludedStudents ? assess.excludedStudents : []);
    collabPairs = assess && assess.pairs ? structuredClone(assess.pairs) : [];
    collabGroups = assess && assess.groups ? structuredClone(assess.groups) : [];
    collabGroupCount = assess && assess.groupCount ? assess.groupCount : 4;
    // Emptied groups can drop out (a withdrawn student's group); keep the count.
    while (collabGroups.length > 0 && collabGroups.length < collabGroupCount) collabGroups.push([]);
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
    collabManualPairs: collabManualPairs,
    collabManualGroups: collabManualGroups,
    collabSetGroupCount: collabSetGroupCount,
    collabDragStart: collabDragStart,
    collabDrop: collabDrop,
    loadCollabData: loadCollabData,
    get collaboration() {
      return newCollaboration;
    },
    set collaboration(v) {
      newCollaboration = v;
    },
    get excluded() {
      return collabExcluded;
    },
    get pairs() {
      return collabPairs;
    },
    get groups() {
      return collabGroups;
    },
    get groupCount() {
      return collabGroupCount;
    },
  };
})();
