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
  // The last move between pairs or groups, for its Undo line: { sid, from, to }.
  var _lastMove = null;
  // What the panel showed last, so it slides in only when it first opens.
  var _shownKind = '';

  function configure(cid) {
    _activeCourse = cid;
  }

  // Whether the Students card's checkbox list is open (Choose Students).
  var _chooseOpen = false;

  function resetState() {
    _chooseOpen = false;
    _lastMove = null;
    _shownKind = '';
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
  // The students it's for: pairs and groups are made from these only.
  function _includedStudents() {
    return getCollabStudents().filter(function (s) {
      return !collabExcluded.has(s.id);
    });
  }
  // A student left out after the pairs or groups were made leaves them.
  function _pruneExcluded() {
    var drop = function (arr) {
      arr.forEach(function (g, i) {
        arr[i] = g.filter(function (sid) {
          return !collabExcluded.has(sid);
        });
      });
    };
    drop(collabPairs);
    drop(collabGroups);
  }

  function setCollaboration(mode) {
    newCollaboration = mode;
    _lastMove = null;
    segSelect(document.querySelector('.af-collab-btn[data-collab="' + mode + '"]'));
    renderCollabPanel();
  }

  /* Moves glide (Colin, Nov 11; board "Assessment Form" 3d): note where each
     student's chip is, change the panel, then slide each chip from its old
     place to its new one in about a fifth of a second. Nothing fades in at
     the new spot. Reduce Motion skips the slide. */
  function _capture() {
    var snap = {};
    document.querySelectorAll('#collab-panel-mount [data-collab-drag-sid]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      snap[el.dataset.collabDragSid] = { x: r.left, y: r.top };
    });
    return snap;
  }
  function _glide(snap) {
    if (!snap || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var moving = [];
    document.querySelectorAll('#collab-panel-mount [data-collab-drag-sid]').forEach(function (el) {
      var was = snap[el.dataset.collabDragSid];
      if (!was) return;
      var r = el.getBoundingClientRect();
      var dx = was.x - r.left;
      var dy = was.y - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      el.classList.add('is-gliding');
      moving.push(el);
    });
    if (!moving.length) return;
    void document.body.offsetHeight;
    moving.forEach(function (el) {
      el.style.transition = '';
      el.style.transform = '';
    });
    setTimeout(function () {
      moving.forEach(function (el) {
        el.classList.remove('is-gliding');
      });
    }, 260);
  }
  function _renderGliding() {
    var snap = _capture();
    renderCollabPanel();
    _glide(snap);
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* The Students card's line: who it's assigned to, and Choose Students to
     open the list (individual work only; pairs and groups show their
     builder). */
  function _renderStudentsSummary(students) {
    var line = document.getElementById('af-students-summary');
    var chosen = students.filter(function (s) {
      return !collabExcluded.has(s.id);
    });
    if (line) {
      line.textContent =
        chosen.length === students.length
          ? 'All ' + _plural(students.length, 'Student', 'Students')
          : _plural(chosen.length, 'Student', 'Students');
    }
    var btn = document.getElementById('af-choose-students');
    if (btn) btn.setAttribute('aria-expanded', String(_chooseOpen));
    // With some students chosen, their names under the button (learning support's ask).
    var names = document.getElementById('af-students-names');
    if (names) {
      var some = chosen.length < students.length && !_chooseOpen;
      names.hidden = !some;
      if (some) {
        var shown = chosen.slice(0, 6).map(displayName);
        names.textContent = chosen.length
          ? shown.join(', ') + (chosen.length > 6 ? ' and ' + (chosen.length - 6) + ' more.' : '.')
          : 'No students chosen.';
      }
    }
  }

  function toggleChooseStudents() {
    _chooseOpen = !_chooseOpen;
    if (!_chooseOpen) _pruneExcluded();
    renderCollabPanel();
  }

  function renderCollabPanel() {
    var mount = document.getElementById('collab-panel-mount');
    if (!mount) return;
    var students = getCollabStudents();
    _renderStudentsSummary(students);

    var kind = _chooseOpen ? 'choose' : newCollaboration;
    if (kind === 'individual') {
      mount.innerHTML = '';
      _shownKind = '';
      return;
    }
    // The panel slides in when it opens, never on a change inside it.
    var panelClass = 'collab-panel' + (kind !== _shownKind ? ' is-opening' : '');
    _shownKind = kind;
    if (kind === 'choose') {
      var html =
        '<div class="' +
        panelClass +
        '">' +
        '<div class="collab-panel-header">' +
        '<span class="collab-panel-heading"><span class="collab-panel-title">Choose Students</span>' +
        '<span class="collab-choose-count" id="collab-choose-count">' +
        _chosenCountText(students) +
        '</span></span>' +
        '<div class="collab-panel-actions">' +
        '<button type="button" class="collab-panel-btn" data-action="collabCheckAll">Choose All</button>' +
        '<button type="button" class="collab-panel-btn" data-action="collabCheckNone">Choose None</button>' +
        '<button type="button" class="collab-panel-btn primary" data-action="toggleChooseStudents">Done</button>' +
        '</div>' +
        '</div>' +
        '<div class="collab-choose-grid">' +
        students.map(_chooseChipHtml).join('') +
        '</div>' +
        '</div>';
      mount.innerHTML = html; // html-safe: names go through esc() in _chooseChipHtml
    } else if (newCollaboration === 'pair') {
      students = _includedStudents();
      var html =
        '<div class="' +
        panelClass +
        '">' +
        '<div class="collab-panel-header">' +
        '<span class="collab-panel-heading"><span class="collab-panel-title">Pair Students</span>' +
        _movedHtml(students, 'Pair') +
        '</span>' +
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
      students = _includedStudents();
      var total = students.length;
      var perGroup = Math.floor(total / collabGroupCount);
      var remainder = total % collabGroupCount;
      var sizeDesc =
        remainder > 0
          ? _plural(collabGroupCount - remainder, 'group', 'groups') +
            ' of ' +
            perGroup +
            ', ' +
            remainder +
            ' of ' +
            (perGroup + 1)
          : _plural(collabGroupCount, 'group', 'groups') + ' of ' + perGroup;
      var html =
        '<div class="' +
        panelClass +
        '">' +
        '<div class="collab-panel-header">' +
        '<span class="collab-panel-heading"><span class="collab-panel-title">Group Students</span>' +
        _movedHtml(students, 'Group') +
        '</span>' +
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
        '<span class="collab-stepper-label">Number of Groups</span>' +
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

  function _chosenCountText(students) {
    return students.length - collabExcluded.size + ' of ' + students.length + ' chosen';
  }

  // One student in Choose Students: a chip like the group cards' members (Colin, Nov 11).
  function _chooseChipHtml(st) {
    var on = !collabExcluded.has(st.id);
    return (
      '<button type="button" class="collab-choose-chip" aria-pressed="' +
      on +
      '" data-action="collabToggleStudent" data-sid="' +
      esc(st.id) +
      '">' +
      '<span class="member-avatar" style="--avatar:' +
      _avatarColor(st.id) +
      '">' +
      esc(initials(st)) +
      '</span>' +
      '<span class="collab-choose-name">' +
      esc(displayName(st)) +
      '</span>' +
      '<span class="collab-choose-mark" aria-hidden="true"></span>' +
      '</button>'
    );
  }

  // "Leo Martineau moved to Group 3. Undo", after a drag between pairs or groups.
  function _movedHtml(students, noun) {
    if (!_lastMove) return '';
    var st = students.find(function (s) {
      return s.id === _lastMove.sid;
    });
    if (!st) return '';
    var where = _lastMove.to === -1 ? 'Unassigned' : noun + ' ' + (_lastMove.to + 1);
    return (
      '<span class="collab-moved" role="status">' +
      esc(displayName(st) + ' moved to ' + where + '.') +
      ' <button type="button" class="collab-undo" data-action="collabUndoMove">Undo</button></span>'
    );
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

  /* A click changes that one chip, the count and the button: the list is
     not drawn again (Colin, Nov 11: it redrew on every click). */
  function _syncChoose() {
    var students = getCollabStudents();
    document.querySelectorAll('#collab-panel-mount .collab-choose-chip').forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(!collabExcluded.has(chip.dataset.sid)));
    });
    var count = document.getElementById('collab-choose-count');
    if (count) count.textContent = _chosenCountText(students);
    _renderStudentsSummary(students);
  }
  function collabToggleStudent(sid, checked) {
    var on = checked === undefined ? collabExcluded.has(sid) : checked;
    if (on) collabExcluded.delete(sid);
    else collabExcluded.add(sid);
    if (document.querySelector('#collab-panel-mount .collab-choose-chip')) _syncChoose();
    else renderCollabPanel();
  }
  function collabCheckAll() {
    collabExcluded.clear();
    _syncChoose();
  }
  function collabCheckNone() {
    getCollabStudents().forEach(function (s) {
      collabExcluded.add(s.id);
    });
    _syncChoose();
  }
  function collabUndoMove() {
    var m = _lastMove;
    if (!m) return;
    var arr = newCollaboration === 'pair' ? collabPairs : collabGroups;
    if (m.to !== -1 && arr[m.to]) {
      var i = arr[m.to].indexOf(m.sid);
      if (i >= 0) arr[m.to].splice(i, 1);
    }
    if (m.from !== -1 && arr[m.from]) arr[m.from].push(m.sid);
    _lastMove = null;
    _renderGliding();
  }
  function collabRandomPairs() {
    var students = _includedStudents();
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
    _lastMove = null;
    _renderGliding();
  }
  function collabRandomGroups() {
    var students = _includedStudents();
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
    _lastMove = null;
    _renderGliding();
  }
  /* Manual keeps any pairs already made; with none, it lays out empty pairs
     and every student starts in Unassigned. */
  function collabManualPairs() {
    if (collabPairs.length === 0) {
      var count = Math.max(1, Math.floor(_includedStudents().length / 2));
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
    var students = _includedStudents();
    var next = Math.max(2, Math.min(students.length, collabGroupCount + delta));
    if (next === collabGroupCount) return;
    collabGroupCount = next;
    if (collabGroups.length > 0 && collabGroupMode === 'manual') {
      // Manual groups stay put: add an empty group, or drop the last one and
      // send its students back to Unassigned.
      while (collabGroups.length < collabGroupCount) collabGroups.push([]);
      if (collabGroups.length > collabGroupCount) collabGroups = collabGroups.slice(0, collabGroupCount);
      _renderGliding();
    } else if (collabGroups.length > 0) collabRandomGroups();
    else renderCollabPanel();
  }
  function collabDragStart(e, sid, fromGroup) {
    _dragSid = sid;
    _dragFromGroup = fromGroup;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sid);
    var el = e.target && e.target.closest ? e.target.closest('[data-collab-drag-sid]') : null;
    // After the browser has taken its drag picture.
    if (el)
      setTimeout(function () {
        el.classList.add('is-dragging');
      }, 0);
  }
  function collabDragEnd() {
    document.querySelectorAll('#collab-panel-mount .is-dragging').forEach(function (el) {
      el.classList.remove('is-dragging');
    });
    document.querySelectorAll('#collab-panel-mount .drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
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
    _lastMove = { sid: _dragSid, from: _dragFromGroup, to: toGroup };
    var moved = _dragSid;
    _dragSid = null;
    _dragFromGroup = null;
    _renderGliding();
    var landed = document.querySelector('#collab-panel-mount [data-collab-drag-sid="' + moved + '"]');
    if (landed) {
      landed.classList.add('just-moved');
      setTimeout(function () {
        landed.classList.remove('just-moved');
      }, 500);
    }
  }
  function loadCollabData(assess) {
    _chooseOpen = false;
    _lastMove = null;
    _shownKind = '';
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
    toggleChooseStudents: toggleChooseStudents,
    collabToggleStudent: collabToggleStudent,
    collabCheckAll: collabCheckAll,
    collabCheckNone: collabCheckNone,
    collabRandomPairs: collabRandomPairs,
    collabRandomGroups: collabRandomGroups,
    collabManualPairs: collabManualPairs,
    collabManualGroups: collabManualGroups,
    collabSetGroupCount: collabSetGroupCount,
    collabDragStart: collabDragStart,
    collabDragEnd: collabDragEnd,
    collabDrop: collabDrop,
    collabUndoMove: collabUndoMove,
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
