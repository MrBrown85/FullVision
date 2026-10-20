/* dash-class-manager.js — Class manager + curriculum wizard (extracted from page-dashboard.js) */
window.DashClassManager = (function () {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }
  function _removeAllListeners() {
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
  }

  /* ── Parent state injection ──────────────────────────────── */
  var _activeCourse = null;
  var _onRender = null;
  var _onCourseChange = null;
  // Set when the manager changes the active course itself (finishing the create
  // wizard, or archiving the class that was active). The parent page holds its
  // own copy of the active course for rendering and only learns about a change
  // through _onCourseChange, so the switch is deferred until the manager closes
  // — announcing it mid-wizard would tear down the panel the teacher is using.
  var _activeCourseChanged = false;

  function configure(opts) {
    // The parent is telling us which course it is on, so any pending switch of
    // ours is now reflected there and must not be replayed on close.
    _activeCourse = opts.activeCourse;
    _activeCourseChanged = false;
    _onRender = opts.onRender;
    _onCourseChange = opts.onCourseChange;
  }
  function _setActiveCourse(cid) {
    _activeCourse = cid;
  }

  var CM_COLORS = [
    '#dc2626',
    '#ea580c',
    '#d97706',
    '#ca8a04',
    '#16a34a',
    '#059669',
    '#0891b2',
    '#2563eb',
    '#7c3aed',
    '#c026d3',
    '#db2777',
    '#78716c',
    '#475569',
    '#1e3a5f',
    '#334155',
  ];

  // Single source of truth for calculation method options. Rendered by both
  // the create wizard (step 2) and the post-creation editor — keep order
  // identical across both surfaces. Value strings are persisted in
  // course.calcMethod and courseConfig.calcMethod; do not rename.
  var CALC_METHODS = [
    { value: 'mostRecent', label: 'Most Recent' },
    { value: 'highest', label: 'Highest' },
    { value: 'average', label: 'Mean' },
    { value: 'median', label: 'Median' },
    { value: 'mode', label: 'Mode' },
    { value: 'decayingAvg', label: 'Decaying Avg' },
  ];
  var GRADING_SYSTEMS = [
    { value: 'proficiency', label: 'Proficiency' },
    { value: 'letter', label: 'Letter' },
    { value: 'both', label: 'Both' },
  ];

  var classManagerOpen = false;
  var cmSelectedCourse = null;
  var cmMode = 'edit';

  // Curriculum Wizard state
  var cwStep = 1;
  var cwSelectedGrade = null;
  var cwSelectedSubject = null;
  var cwSelectedTags = [];
  var cwCurriculumLoaded = false;
  var cwLoadError = false;

  // Class Manager student editing
  var cmEditingStudentId = null;

  // Bulk edit
  var cmBulkMode = false;
  var cmBulkSelected = new Set();

  // Import preview
  var cmPendingImport = null;

  // Relink
  var cmRelinkCid = null;
  var cmRelinkStep = 0;

  // Standard folder collapse state
  var _cmCollapsedStdFolders = {};
  var _cmOpenStdCards = {};

  function _cmRenderStdCard(sec, lm, compGroups) {
    var tag = sec.tags[0] || {};
    var sub = (lm.subjects || []).find(function (s) {
      return s.id === sec.subject;
    });
    var subName = sub ? sub.name : '';
    var subColor = sub ? sub.color : 'var(--text-3)';
    var isOpen = _cmOpenStdCards[sec.id];
    var html =
      '<div class="cm-std-card' +
      (isOpen ? ' open' : '') +
      '" draggable="true" data-std-drag="' +
      sec.id +
      '" id="cm-std-' +
      sec.id +
      '">' +
      '<div class="cm-std-header" data-action="cmToggleStdCard" data-secid="' +
      sec.id +
      '">' +
      '<div class="cm-std-color-bar" style="background:' +
      sec.color +
      '"></div>' +
      '<span class="cm-std-tag">' +
      esc(tag.code || tag.shortName || '') +
      '</span>' +
      '<span class="cm-std-label">' +
      esc(tag.label || sec.shortName || sec.name) +
      '</span>' +
      '<span class="cm-std-subject"><span class="cm-std-subject-dot" style="background:' +
      subColor +
      '"></span>' +
      esc(subName) +
      '</span>' +
      '<span class="cm-std-chevron">\u25B8</span>' +
      '</div>' +
      '<div class="cm-std-body">' +
      '<div class="cm-std-edit-row-wide">' +
      '<div style="flex:1"><label class="cm-label">Standard name</label>' +
      '<input class="cm-input" value="' +
      esc(sec.name) +
      '" style="font-weight:600;font-size:0.875rem" data-stop-prop="true" data-action-blur="cmStdName" data-secid="' +
      sec.id +
      '"></div>' +
      '<div style="min-width:100px"><label class="cm-label">Subject</label>' +
      '<select class="cm-input" style="font-size:0.8125rem" data-stop-prop="true" data-action-change="cmStdSubject" data-secid="' +
      sec.id +
      '">' +
      (lm.subjects || [])
        .map(function (s) {
          return (
            '<option value="' + s.id + '"' + (s.id === sec.subject ? ' selected' : '') + '>' + esc(s.name) + '</option>'
          );
        })
        .join('') +
      '</select></div>' +
      (compGroups.length > 0
        ? '<div style="min-width:90px"><label class="cm-label">Group</label>' +
          '<select class="cm-input" style="font-size:0.8125rem" data-stop-prop="true" data-action-change="cmStdGroup" data-secid="' +
          sec.id +
          '">' +
          '<option value="">None</option>' +
          compGroups
            .map(function (g) {
              return (
                '<option value="' +
                g.id +
                '"' +
                (sec.groupId === g.id ? ' selected' : '') +
                '>' +
                esc(g.name) +
                '</option>'
              );
            })
            .join('') +
          '</select></div>'
        : '') +
      '<div><label class="cm-label">Colour</label>' +
      '<div style="position:relative;margin-top:2px;width:32px;height:32px">' +
      '<div class="cm-color-swatch-selected" style="background:' +
      sec.color +
      '" data-action="cmToggleColorPalette" data-target="section" data-secid="' +
      sec.id +
      '"></div>' +
      '<div class="cm-color-palette" id="cm-palette-section-' +
      sec.id +
      '"></div>' +
      '</div></div>' +
      '<button class="cm-delete-mini" data-action="cmDeleteStd" data-stop-prop="true" data-secid="' +
      sec.id +
      '" title="Delete standard" style="width:32px;height:32px;align-self:flex-end">\u2715</button>' +
      '</div>' +
      '<div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:8px">' +
      '<div style="flex:0 0 120px"><label class="cm-label">Tag code</label>' +
      '<input class="cm-input" value="' +
      esc(tag.code || tag.shortName || '') +
      '" placeholder="e.g. RD1" maxlength="10" style="padding:5px 8px;font-size:0.875rem;font-weight:600;font-family:monospace;text-transform:uppercase" data-stop-prop="true" data-action-blur="cmStdCode" data-secid="' +
      sec.id +
      '"></div>' +
      '<div style="flex:1"><label class="cm-label">Short label</label>' +
      '<input class="cm-input" value="' +
      esc(tag.label) +
      '" placeholder="Short label" style="padding:5px 8px;font-size:0.875rem;font-weight:500" data-action-blur="cmStdLabel" data-secid="' +
      sec.id +
      '"></div>' +
      '</div>' +
      '<label class="cm-label">I can\u2026 statement</label>' +
      '<textarea class="cm-textarea" placeholder="I can\u2026 statement" style="min-height:34px;padding:5px 8px;font-size:0.8125rem" data-action-blur="cmStdText" data-secid="' +
      sec.id +
      '">' +
      esc(tag.text || '') +
      '</textarea>' +
      '</div></div>';
    return html;
  }

  function cmToggleStdCard(secId) {
    _cmOpenStdCards[secId] = !_cmOpenStdCards[secId];
    var card = document.getElementById('cm-std-' + secId);
    if (card) card.classList.toggle('open', _cmOpenStdCards[secId]);
  }

  function cmToggleStdFolder(uid) {
    _cmCollapsedStdFolders[uid] = !_cmCollapsedStdFolders[uid];
    var folder = document.querySelector('.mod-folder[data-module-id="' + uid + '"]');
    if (folder) folder.classList.toggle('open', !_cmCollapsedStdFolders[uid]);
  }

  // Drag-and-drop for standards between group folders
  var _cmDragStdId = null;
  var _cmMergeTargetId = null;
  var _cmMergeHoverTimer = null;
  var _cmMergeAnimating = false;
  var CM_GROUP_COLORS = [
    '#6366f1',
    '#06b6d4',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
    '#f97316',
    '#64748b',
  ];

  var _UUID_RE_CM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // True unless the promise settles false within ms. A slow or offline save
  // is still queued in the outbox, so it isn't reported as a failure.
  function _resolvesTrueWithin(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).then(function (ok) {
        return ok !== false;
      }),
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve(true);
        }, ms);
      }),
    ]);
  }

  // Inputs rendered before a new row's server id came back still carry its
  // local id; look rows up by their current id.
  function _currentId(kind, id) {
    return cmSelectedCourse && id ? resolveLearningMapId(cmSelectedCourse, kind, id) : id;
  }

  function _isCanonicalId(id) {
    return typeof id === 'string' && _UUID_RE_CM.test(id);
  }

  // Wait for the create_course RPC fired by createCourse (shared/data.js)
  // to settle. createCourse returns a course object with a local id like
  // "c{ts}{rand}" before the canonical UUID is known; the rekey lands when
  // the RPC callback runs and replaces COURSES[localId] with
  // COURSES[canonicalId]. The canonical row keeps a __pendingLocalId tag so
  // we can find it after rekey.
  async function _awaitCanonicalCourse(localId, timeoutMs) {
    if (_isCanonicalId(localId)) return localId;
    var deadline = Date.now() + (timeoutMs || 10000);
    while (Date.now() < deadline) {
      if (!COURSES[localId]) {
        var keys = Object.keys(COURSES);
        for (var i = 0; i < keys.length; i++) {
          if (COURSES[keys[i]] && COURSES[keys[i]].__pendingLocalId === localId) {
            return keys[i];
          }
        }
      }
      // Nothing in flight and no canonical id in sight: either create_course
      // failed or we're offline / local-only, where the rekey never happens.
      // Bail rather than blocking the wizard for the full timeout — createCourse
      // clears the pending marker only after the rekey, so a successful create
      // is always caught by the lookup above first.
      if (typeof hasPendingLocalCid === 'function' && !hasPendingLocalCid(localId)) return null;
      await new Promise(function (r) {
        setTimeout(r, 75);
      });
    }
    return null;
  }

  function _cmClearMerge() {
    if (_cmMergeHoverTimer) {
      clearTimeout(_cmMergeHoverTimer);
      _cmMergeHoverTimer = null;
    }
    if (_cmMergeTargetId) {
      var el = document.getElementById('cm-std-' + _cmMergeTargetId);
      if (el) el.classList.remove('merge-target');
    }
    _cmMergeTargetId = null;
    _cmMergeAnimating = false;
  }

  function _cmMergeToNewGroup(draggedId, targetId) {
    draggedId = _currentId('section', draggedId);
    targetId = _currentId('section', targetId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    if (!map.competencyGroups) map.competencyGroups = [];
    var idx = map.competencyGroups.length;
    var grp = {
      id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: 'Group ' + (idx + 1),
      color: CM_GROUP_COLORS[idx % CM_GROUP_COLORS.length],
      sortOrder: idx,
    };
    map.competencyGroups.push(grp);
    [draggedId, targetId].forEach(function (sid) {
      var sec = (map.sections || []).find(function (s) {
        return s.id === sid;
      });
      if (sec) sec.groupId = grp.id;
    });
    saveLearningMap(cid, map);
    renderClassManager();
    setTimeout(function () {
      var input = document.querySelector('.mod-folder[data-module-id="' + grp.id + '"] .mod-folder-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  function _initCmStdDrag() {
    _addDocListener('dragstart', function (e) {
      var card = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (!card) return;
      _cmDragStdId = card.dataset.stdDrag;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _cmDragStdId);
    });
    _addDocListener('dragover', function (e) {
      if (!_cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard) {
        var targetId = targetCard.dataset.stdDrag;
        if (targetId !== _cmDragStdId) {
          var map = cmSelectedCourse ? getLearningMap(cmSelectedCourse) : null;
          var targetSec =
            map &&
            (map.sections || []).find(function (s) {
              return s.id === targetId;
            });
          if (targetSec && !targetSec.groupId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (_cmMergeTargetId === targetId) return;
            _cmClearMerge();
            _cmMergeTargetId = targetId;
            _cmMergeHoverTimer = setTimeout(function () {
              _cmMergeAnimating = true;
              var el = document.getElementById('cm-std-' + targetId);
              if (el) el.classList.add('merge-target');
            }, 300);
            return;
          }
        }
      } else {
        if (_cmMergeTargetId) _cmClearMerge();
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (!folder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      folder.classList.add('drag-over');
      if (!folder.classList.contains('open')) folder.classList.add('open');
    });
    _addDocListener('dragleave', function (e) {
      if (!_cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && !targetCard.contains(e.relatedTarget)) {
        if (_cmMergeTargetId === targetCard.dataset.stdDrag) _cmClearMerge();
        return;
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (folder && !folder.contains(e.relatedTarget)) folder.classList.remove('drag-over');
    });
    _addDocListener('drop', function (e) {
      if (!_cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && _cmMergeAnimating && _cmMergeTargetId === targetCard.dataset.stdDrag) {
        e.preventDefault();
        e.stopPropagation();
        _cmMergeToNewGroup(_cmDragStdId, targetCard.dataset.stdDrag);
        _cmClearMerge();
        _cmDragStdId = null;
        document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
          c.classList.remove('dragging');
        });
        return;
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (!folder) return;
      e.preventDefault();
      var targetGroupId = folder.dataset.folderDrop;
      if (targetGroupId === '__none__') targetGroupId = '';
      if (cmSelectedCourse) {
        var map = ensureCustomLearningMap(cmSelectedCourse);
        var dragId = _currentId('section', _cmDragStdId);
        if (targetGroupId) targetGroupId = _currentId('group', targetGroupId);
        var sec = (map.sections || []).find(function (s) {
          return s.id === dragId;
        });
        if (sec) {
          if (targetGroupId) sec.groupId = targetGroupId;
          else delete sec.groupId;
          saveLearningMap(cmSelectedCourse, map);
          renderClassManager();
        }
      }
      _cmDragStdId = null;
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
        c.classList.remove('dragging');
      });
    });
    _addDocListener('dragend', function () {
      _cmDragStdId = null;
      _cmClearMerge();
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
        c.classList.remove('dragging');
      });
    });
  }

  var cwStep2Name = '',
    cwStep2Grade = '',
    cwStep2Desc = '',
    cwStep2Block = '',
    cwStep2Span = 'full';
  // '' = not chosen yet; the wizard fills in the grade-level default.
  var cwStep2Grading = '',
    cwStep2Calc = '',
    cwStep2Decay = '65',
    cwStep2LatePolicy = '';

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
    var cid = cmSelectedCourse;
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
    if (!cmSelectedCourse) return;
    if (reenrolStudent(cmSelectedCourse, sid)) renderClassManager();
  }

  /* The second step: only a withdrawn student can be deleted, and the
     delete cannot be undone, so there is no Undo. */
  function cmDeleteWithdrawn(sid) {
    var cid = cmSelectedCourse;
    if (!cid) return;
    var entry = getWithdrawnStudents(cid).find(function (w) {
      return w && w.student && w.student.id === sid;
    });
    if (!entry) return;
    showConfirm(
      'Delete permanently',
      'Permanently delete ' +
        displayName(entry.student) +
        '? Their scores, observations, goals, reflections and reports in this class are deleted. This cannot be undone.',
      'Delete permanently',
      'danger',
      function () {
        if (deleteWithdrawnStudent(cid, sid)) renderClassManager();
      },
    );
  }

  /* Withdrawn students, under the roster: when they left, Re-enrol, and
     the permanent delete. */
  function renderWithdrawnList(cid) {
    var list = getWithdrawnStudents(cid).filter(function (w) {
      return w && w.student && w.student.id;
    });
    if (!list.length) return '';
    var html =
      '<div class="cm-withdrawn" id="cm-withdrawn">' +
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
        (when ? '<span class="cm-withdrawn-when">Withdrawn ' + esc(when) + '</span>' : '') +
        '<div class="cm-student-actions">' +
        '<button class="cm-add-link cm-withdrawn-btn" data-action="cmReenrolStudent" data-sid="' +
        esc(st.id) +
        '">Re-enrol</button>' +
        '<button class="cm-add-link cm-withdrawn-btn cm-withdrawn-delete" data-action="cmDeleteWithdrawn" data-sid="' +
        esc(st.id) +
        '">Delete permanently</button>' +
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

  /* ── Class Manager Student Functions ────────────────────── */
  function cmShowAddStudent() {
    var form = document.getElementById('cm-add-student-form');
    if (form) {
      form.style.display = 'block';
      var el = document.getElementById('cm-add-first');
      if (el) el.focus();
    }
  }

  function cmCancelStudent() {
    cmEditingStudentId = null;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'none';
    var btn = document.getElementById('cm-save-btn');
    if (btn) btn.textContent = 'Save';
    ['cm-add-first', 'cm-add-last', 'cm-add-pref', 'cm-add-num', 'cm-add-dob', 'cm-add-email'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var proEl = document.getElementById('cm-add-pro');
    if (proEl) proEl.value = '';
    document.querySelectorAll('.cm-desig-check').forEach(function (cb) {
      cb.checked = false;
    });
  }

  function cmSaveStudent() {
    if (!cmSelectedCourse) return;
    var firstName = (document.getElementById('cm-add-first')?.value || '').trim();
    var lastName = (document.getElementById('cm-add-last')?.value || '').trim();
    if (!firstName) {
      var el = document.getElementById('cm-add-first');
      if (el) {
        el.style.border = '2px solid var(--score-1)';
        el.placeholder = 'First name is required';
        el.oninput = function () {
          this.style.border = '';
        };
        el.focus();
      }
      return;
    }
    var preferred = (document.getElementById('cm-add-pref')?.value || '').trim();
    var pronouns = (document.getElementById('cm-add-pro')?.value || '').trim();
    var studentNumber = (document.getElementById('cm-add-num')?.value || '').trim();
    var dateOfBirth = (document.getElementById('cm-add-dob')?.value || '').trim();
    var email = (document.getElementById('cm-add-email')?.value || '').trim();
    var designations = Array.from(document.querySelectorAll('.cm-desig-check:checked')).map(function (cb) {
      return cb.value;
    });
    var students = getStudents(cmSelectedCourse);
    var sortName = ((lastName || '') + ' ' + firstName).trim();

    if (cmEditingStudentId) {
      var st = students.find(function (s) {
        return s.id === cmEditingStudentId;
      });
      if (st) {
        st.firstName = firstName;
        st.lastName = lastName;
        st.preferred = preferred;
        st.pronouns = pronouns;
        st.sortName = sortName;
        st.studentNumber = studentNumber;
        st.dateOfBirth = dateOfBirth;
        st.email = email;
        st.designations = designations;
        delete st.designation;
        if (!st.attendance) st.attendance = [];
      }
      cmEditingStudentId = null;
    } else {
      students.push({
        id: uid(),
        firstName: firstName,
        lastName: lastName,
        preferred: preferred,
        pronouns: pronouns,
        studentNumber: studentNumber,
        dateOfBirth: dateOfBirth,
        email: email,
        designations: designations,
        attendance: [],
        sortName: sortName,
        enrolledDate: new Date().toISOString().slice(0, 10),
      });
    }
    saveStudents(cmSelectedCourse, students);
    cmCancelStudent();
    renderClassManager();
    requestAnimationFrame(function () {
      var detail = document.querySelector('.cm-detail');
      if (detail) detail.scrollTop = 0;
    });
  }

  function cmEditStudent(sid) {
    if (!cmSelectedCourse) return;
    var students = getStudents(cmSelectedCourse);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;
    cmEditingStudentId = sid;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'block';
    var el = function (id) {
      return document.getElementById(id);
    };
    if (el('cm-add-first')) el('cm-add-first').value = st.firstName || '';
    if (el('cm-add-last')) el('cm-add-last').value = st.lastName || '';
    if (el('cm-add-pref')) el('cm-add-pref').value = st.preferred || '';
    if (el('cm-add-pro')) el('cm-add-pro').value = st.pronouns || '';
    if (el('cm-add-num')) el('cm-add-num').value = st.studentNumber || '';
    if (el('cm-add-dob')) el('cm-add-dob').value = st.dateOfBirth || '';
    if (el('cm-add-email')) el('cm-add-email').value = st.email || '';
    var desigs = st.designations || [];
    document.querySelectorAll('.cm-desig-check').forEach(function (cb) {
      cb.checked = desigs.indexOf(cb.value) >= 0;
    });
    var btn = el('cm-save-btn');
    if (btn) btn.textContent = 'Update';
    if (el('cm-add-first')) el('cm-add-first').focus();
  }

  function cmRemoveStudent(sid) {
    if (!cmSelectedCourse) return;
    withdrawStudentUI(sid);
  }

  /* ── Bulk Edit Mode ─────────────────────────────────────── */
  function cmToggleBulk() {
    cmBulkMode = !cmBulkMode;
    cmBulkSelected.clear();
    renderClassManager();
  }

  function cmBulkToggle(sid) {
    if (cmBulkSelected.has(sid)) cmBulkSelected.delete(sid);
    else cmBulkSelected.add(sid);
    renderClassManager();
  }

  function cmBulkSelectAll() {
    var students = getStudents(cmSelectedCourse);
    students.forEach(function (s) {
      cmBulkSelected.add(s.id);
    });
    renderClassManager();
  }

  function cmBulkDeselectAll() {
    cmBulkSelected.clear();
    renderClassManager();
  }

  function cmApplyBulk() {
    if (!cmSelectedCourse || cmBulkSelected.size === 0) return;
    var pronouns = (document.getElementById('cm-bulk-pro')?.value || '').trim();
    var attDate = (document.getElementById('cm-bulk-att-date')?.value || '').trim();
    var attStatus = (document.getElementById('cm-bulk-att-status')?.value || '').trim();
    var students = getStudents(cmSelectedCourse);
    students.forEach(function (st) {
      if (!cmBulkSelected.has(st.id)) return;
      if (pronouns) st.pronouns = pronouns;
      if (attDate && attStatus) {
        if (!st.attendance) st.attendance = [];
        st.attendance.push({ date: attDate, status: attStatus, note: '' });
        st.attendance.sort(function (a, b) {
          return b.date.localeCompare(a.date);
        });
      }
    });
    saveStudents(cmSelectedCourse, students);
    cmBulkMode = false;
    cmBulkSelected.clear();
    renderClassManager();
  }

  function cmImportRoster() {
    var el = document.getElementById('cm-csv-input');
    if (el) el.click();
  }

  function cmHandleCSV(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var lines = e.target.result
        .split('\n')
        .map(function (l) {
          return l.trim();
        })
        .filter(function (l) {
          return l;
        });
      var hdr = (lines[0] || '').toLowerCase();
      var hasHeader = hdr.includes('first') || hdr.includes('name') || hdr.includes('last');
      var start = hasHeader ? 1 : 0;
      var parsed = [];
      for (var i = start; i < lines.length; i++) {
        var parts = lines[i].split(',').map(function (p) {
          return p.trim();
        });
        if (!parts[0]) continue;
        if (hdr.includes('first') || parts.length >= 4) {
          parsed.push({
            firstName: parts[0],
            lastName: parts[1] || '',
            preferred: parts[2] || '',
            pronouns: parts[3] || '',
            studentNumber: parts[4] || '',
            dateOfBirth: parts[5] || '',
            email: parts[6] || '',
          });
        } else {
          var np = parts[0].split(/\s+/);
          parsed.push({
            firstName: np[0] || '',
            lastName: np.slice(1).join(' ') || '',
            preferred: parts[1] || '',
            pronouns: parts[2] || '',
          });
        }
      }
      cmShowImportPreview(parsed);
    };
    reader.readAsText(file);
    input.value = '';
  }

  function cmShowImportPreview(parsed) {
    cmPendingImport = parsed;
    var cid = cmSelectedCourse;
    var existing = getStudents(cid).map(function (s) {
      return fullName(s).toLowerCase();
    });
    var html =
      '<div style="border:1px solid var(--active);border-radius:var(--radius-sm);padding:10px 12px;margin-top:8px;background:rgba(0,122,255,0.02)">' +
      '<div class="cm-label" style="margin-bottom:6px">Import preview \u2014 ' +
      parsed.length +
      ' student' +
      (parsed.length !== 1 ? 's' : '') +
      ' found</div>' +
      '<div style="max-height:180px;overflow-y:auto;margin-bottom:8px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.8125rem">' +
      '<thead><tr style="border-bottom:1px solid var(--border)">' +
      '<th style="text-align:left;padding:3px 6px" class="cm-label">First</th>' +
      '<th style="text-align:left;padding:3px 6px" class="cm-label">Last</th>' +
      '<th style="text-align:left;padding:3px 6px" class="cm-label">Pronouns</th>' +
      '<th style="text-align:left;padding:3px 6px" class="cm-label">Status</th>' +
      '</tr></thead><tbody>';
    parsed.forEach(function (p) {
      var fn = ((p.firstName || '') + ' ' + (p.lastName || '')).trim().toLowerCase();
      var dupe = existing.includes(fn);
      html +=
        '<tr style="border-bottom:1px solid var(--divider-subtle)' +
        (dupe ? ';opacity:0.5' : '') +
        '">' +
        '<td style="padding:3px 6px">' +
        esc(p.firstName || '') +
        '</td>' +
        '<td style="padding:3px 6px">' +
        esc(p.lastName || '') +
        '</td>' +
        '<td style="padding:3px 6px">' +
        esc(p.pronouns || '') +
        '</td>' +
        '<td style="padding:3px 6px;font-size:0.75rem;font-weight:600;color:' +
        (dupe ? 'var(--priority)' : 'var(--score-3)') +
        '">' +
        (dupe ? 'SKIP' : 'NEW') +
        '</td>' +
        '</tr>';
    });
    html +=
      '</tbody></table></div>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-primary" style="font-size:0.8125rem;padding:6px 14px" data-action="cmConfirmImport">Import</button>' +
      '<button class="btn btn-ghost" style="font-size:0.8125rem;padding:6px 10px" data-action="cmCancelImport">Cancel</button>' +
      '</div>' +
      '</div>';
    var el = document.getElementById('cm-import-preview');
    if (el) el.innerHTML = html;
  }

  function cmConfirmImport() {
    if (!cmPendingImport || !cmSelectedCourse) return;
    var students = getStudents(cmSelectedCourse);
    var existingNames = students.map(function (s) {
      return fullName(s).toLowerCase();
    });
    cmPendingImport.forEach(function (p) {
      var fn = ((p.firstName || '') + ' ' + (p.lastName || '')).trim().toLowerCase();
      if (existingNames.includes(fn)) return;
      var sortName = ((p.lastName || '') + ' ' + (p.firstName || '')).trim();
      students.push({
        id: uid(),
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        preferred: p.preferred || '',
        pronouns: p.pronouns || '',
        studentNumber: p.studentNumber || '',
        dateOfBirth: p.dateOfBirth || '',
        email: p.email || '',
        attendance: [],
        sortName: sortName,
        enrolledDate: new Date().toISOString().slice(0, 10),
      });
    });
    saveStudents(cmSelectedCourse, students);
    cmPendingImport = null;
    renderClassManager();
  }

  function cmCancelImport() {
    cmPendingImport = null;
    var el = document.getElementById('cm-import-preview');
    if (el) el.innerHTML = '';
  }

  function openClassManager() {
    classManagerOpen = true;
    cmSelectedCourse = _activeCourse;
    cmMode = 'edit';
    renderClassManager();
  }
  function closeClassManager() {
    classManagerOpen = false;
    // Hand a course switch made in here back to the parent, so it re-syncs its
    // own activeCourse, loads that course's data and renders it. Without this
    // the parent falls back to whichever class was active before the manager
    // opened — and re-injects that stale id on the next configure().
    if (_activeCourseChanged && _onCourseChange) {
      _activeCourseChanged = false;
      _onCourseChange(_activeCourse);
      return;
    }
    if (_onRender) _onRender();
  }

  /* ── Block picker ──────────────────────────────────────────────
     None, A–E, X, or "Other" text. Used in Details, the new-class wizard
     and Duplicate Class. */
  function blockPickerHtml(id, value) {
    var v = normalizeCourseBlock(value);
    var isChoice = v === '' || COURSE_BLOCK_CHOICES.indexOf(v) >= 0;
    return (
      '<div class="cm-block-picker" id="' +
      id +
      '">' +
      '<div class="seg seg-sm cm-seg" role="radiogroup" aria-labelledby="' +
      id +
      '-label">' +
      ['']
        .concat(COURSE_BLOCK_CHOICES)
        .map(function (b) {
          var on = isChoice && v === b;
          return (
            '<button type="button" class="seg-btn cm-seg-btn' +
            (on ? ' active' : '') +
            '"' +
            segAttr(on, 'radio') +
            ' data-action="cmBlockChip" data-picker="' +
            id +
            '" data-val="' +
            b +
            '">' +
            (b || 'None') +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '<input class="cm-input cm-block-other" id="' +
      id +
      '-other" maxlength="' +
      COURSE_BLOCK_MAX +
      '" placeholder="Other, e.g. Lunch club" aria-label="Other block or group" value="' +
      (isChoice ? '' : esc(v)) +
      '" data-picker="' +
      id +
      '" data-action-input="cmBlockOtherInput"' +
      (id === 'cm-block' ? ' data-action-blur="cmBlockOtherBlur"' : '') +
      '>' +
      '</div>'
    );
  }
  function readBlockPicker(id) {
    var other = document.getElementById(id + '-other');
    var typed = other ? normalizeCourseBlock(other.value) : '';
    if (typed) return typed;
    var on = document.querySelector('#' + id + ' .seg-btn.active');
    return on ? on.dataset.val || '' : '';
  }
  function blockChipSelect(btn) {
    segSelect(btn);
    var other = document.getElementById(btn.dataset.picker + '-other');
    if (other) other.value = '';
  }
  // Typing an "Other" label clears the chips; clearing it selects None.
  function blockOtherInput(input) {
    var picker = document.getElementById(input.dataset.picker);
    if (!picker) return;
    var typed = input.value.trim();
    var none = picker.querySelector('.seg-btn[data-val=""]');
    picker.querySelectorAll('.seg-btn').forEach(function (b) {
      var on = !typed && b === none;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function renderClassManager() {
    var courseIds = Object.keys(COURSES);
    var html = '';

    // Top bar
    var detailTitle =
      cmMode === 'create'
        ? 'New Class'
        : cmSelectedCourse && COURSES[cmSelectedCourse]
          ? COURSES[cmSelectedCourse].name
          : 'Class Management';
    // Class Management belongs to the dashboard: its toolbar is a breadcrumb
    // back to it in place of the dashboard's own toolbar.
    var toolbarMount = document.getElementById('page-toolbar-mount');
    if (toolbarMount) {
      toolbarMount.innerHTML =
        '<div class="dash-toolbar cm-toolbar">' +
        renderBreadcrumb('Dashboard', '#/dashboard', 'Class Management', 'closeClassManager') +
        '<span class="dash-toolbar-spacer"></span>' +
        '<span class="cm-toolbar-detail">' +
        esc(detailTitle) +
        '</span>' +
        '</div>';
    }

    // Empty state
    if (courseIds.length === 0 && cmMode !== 'create') {
      html +=
        '<div class="cm-empty">' +
        '<div class="cm-empty-title">No classes yet</div>' +
        '<div class="cm-empty-text">Create your first class to get started with your gradebook.</div>' +
        '<button class="btn btn-primary" data-action="cmStartCreate" style="margin-top:16px">Create a Class</button>' +
        '</div>';
      document.getElementById('main').innerHTML = html;
      return;
    }

    html += '<div class="cm-layout">';
    html += renderCmSidebar(courseIds);
    html += '<div class="cm-detail">';

    if (cmMode === 'create') {
      html += renderCmCreateForm();
    } else if (cmRelinkStep > 0 && cmRelinkCid && COURSES[cmRelinkCid]) {
      html += renderCmRelinkPanel(cmRelinkCid);
    } else if (cmSelectedCourse && COURSES[cmSelectedCourse]) {
      html += renderCmDetail(cmSelectedCourse);
    }

    html += '</div></div>';
    // Preserve scroll position of the detail pane across re-renders
    var detailEl = document.querySelector('.cm-detail');
    var scrollTop = detailEl ? detailEl.scrollTop : 0;
    document.getElementById('main').innerHTML = html;
    if (scrollTop > 0) {
      var newDetail = document.querySelector('.cm-detail');
      if (newDetail) newDetail.scrollTop = scrollTop;
    }
    _cmStarterAfterRender();
  }

  function renderCmSidebar(courseIds) {
    var html =
      '<div class="cm-sidebar">' +
      '<div class="cm-sidebar-header">' +
      '<span class="cm-sidebar-label">' +
      courseIds.length +
      ' class' +
      (courseIds.length !== 1 ? 'es' : '') +
      '</span>' +
      '<button class="cm-new-btn" data-action="cmStartCreate">+ New</button>' +
      '</div>' +
      '<div class="cm-class-list">';
    if (cmMode === 'create') {
      html +=
        '<div class="cm-class-item cm-create-active">' +
        '<div class="cm-class-name" style="color:var(--link)">New Class</div>' +
        '<div class="cm-class-meta">Setting up\u2026</div>' +
        '</div>';
    }
    var activeCids = sortCoursesByBlock(
      courseIds
        .filter(function (cid) {
          return !isCourseArchived(cid);
        })
        .map(function (cid) {
          return Object.assign({}, COURSES[cid], { id: cid });
        }),
    ).map(function (c) {
      return c.id;
    });
    var archivedCids = courseIds.filter(function (cid) {
      return isCourseArchived(cid);
    });
    activeCids.forEach(function (cid) {
      var c = COURSES[cid];
      var sc = getStudents(cid).length;
      var sel = cid === cmSelectedCourse && cmMode === 'edit' ? ' selected' : '';
      var gs = c.gradingSystem === 'proficiency' ? 'Proficiency' : c.gradingSystem === 'letter' ? 'Letter' : 'Points';
      html +=
        '<div class="cm-class-item' +
        sel +
        '" data-action="cmSelectClass" data-cid="' +
        cid +
        '">' +
        '<div class="cm-class-name">' +
        esc(courseDisplayName(c)) +
        '</div>' +
        '<div class="cm-class-meta">' +
        gs +
        ' \u00B7 ' +
        sc +
        ' student' +
        (sc !== 1 ? 's' : '') +
        '</div>' +
        '</div>';
    });
    if (archivedCids.length > 0) {
      html +=
        '<div style="padding:8px 12px 4px;font-size:0.75rem;font-weight:600;color:var(--text-3);margin-top:8px;border-top:1px solid var(--border)">Archived</div>';
      archivedCids.forEach(function (cid) {
        var c = COURSES[cid];
        var sc = getStudents(cid).length;
        var sel = cid === cmSelectedCourse && cmMode === 'edit' ? ' selected' : '';
        html +=
          '<div class="cm-class-item' +
          sel +
          '" data-action="cmSelectClass" data-cid="' +
          cid +
          '" style="opacity:0.5">' +
          '<div class="cm-class-name">' +
          esc(courseDisplayName(c)) +
          '</div>' +
          '<div class="cm-class-meta">' +
          sc +
          ' student' +
          (sc !== 1 ? 's' : '') +
          ' \u00B7 archived</div>' +
          '</div>';
      });
    }
    html += '</div></div>';
    return html;
  }

  function renderCmDetail(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var method = cc.calcMethod || course.calcMethod || 'mostRecent';
    var dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
    var cw = cc.categoryWeights || { summative: 1.0, formative: 0.0 };
    var cwEnabled = cw.formative > 0;
    var lm = getLearningMap(cid);
    var studentCount = getStudents(cid).length;
    var assessCount = getAssessments(cid).length;
    var tagCount = getAllTags(cid).length;

    var html = '<div class="cm-detail-inner">';

    // LEFT COLUMN: Class Details + Students
    html += '<div class="cm-col">';

    // Section 1: Class Details
    html +=
      '<div class="cm-section">' +
      '<div class="cm-section-title">Class details</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Class name</label>' +
      '<input class="cm-input" id="cm-name" value="' +
      esc(course.name) +
      '" data-action-blur="cmUpdateName">' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label" id="cm-block-label">Block</label>' +
      blockPickerHtml('cm-block', course.block) +
      '</div>' +
      '<div class="cm-row">' +
      '<div class="cm-field">' +
      '<label class="cm-label">Grade level</label>' +
      '<input class="cm-input" id="cm-grade" value="' +
      esc(course.gradeLevel || '') +
      '" placeholder="e.g. 10-12" data-action-blur="cmUpdateGrade">' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Stats</label>' +
      '<div style="display:flex;gap:12px;padding:7px 0;font-size:0.8125rem;color:var(--text-2)">' +
      '<span><strong>' +
      studentCount +
      '</strong> student' +
      (studentCount !== 1 ? 's' : '') +
      '</span>' +
      '<span><strong>' +
      assessCount +
      '</strong> assessment' +
      (assessCount !== 1 ? 's' : '') +
      '</span>' +
      '<span><strong>' +
      tagCount +
      '</strong> standard' +
      (tagCount !== 1 ? 's' : '') +
      '</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Description</label>' +
      '<textarea class="cm-textarea" id="cm-desc" placeholder="Optional course description\u2026" data-action-blur="cmUpdateDesc">' +
      esc(course.description || '') +
      '</textarea>' +
      '</div>' +
      '</div>';

    // Section 2: Students (Roster)
    var students = getStudents(cid);
    html +=
      '<div class="cm-section">' +
      '<div class="cm-section-title" style="display:flex;align-items:center;justify-content:space-between">' +
      '<span>Students <span style="font-weight:400;color:var(--text-3);text-transform:none;letter-spacing:0">(' +
      students.length +
      ')</span></span>' +
      (students.length > 1
        ? '<button class="cm-add-link" data-action="cmToggleBulk" style="font-size:0.75rem;padding:2px 8px;border-radius:4px;' +
          (cmBulkMode ? 'background:var(--active);color:white' : '') +
          '">' +
          (cmBulkMode ? 'Exit Bulk Edit' : 'Bulk Edit') +
          '</button>'
        : '') +
      '</div>';
    if (students.length > 0) {
      html += '<div class="cm-student-list">';
      var sorted = sortStudents(students, 'lastName');
      sorted.forEach(function (st) {
        var pref = st.preferred && st.preferred !== st.firstName ? st.preferred : '';
        html +=
          '<div class="cm-student-row">' +
          (cmBulkMode
            ? '<input type="checkbox" class="cm-bulk-check" ' +
              (cmBulkSelected.has(st.id) ? 'checked' : '') +
              ' data-action="cmBulkToggleCheck" data-sid="' +
              st.id +
              '">'
            : '') +
          '<span class="cm-student-name">' +
          esc(fullName(st)) +
          '</span>' +
          (pref ? '<span class="cm-student-pref">"' + esc(pref) + '"</span>' : '') +
          (st.designations || [])
            .map(function (code) {
              var d = designationInfo(code);
              if (!d) return '';
              return (
                '<span class="cm-desig-badge' +
                (d.level > 0 ? ' low-inc' : '') +
                '" title="' +
                code +
                ' \u2014 ' +
                esc(d.name) +
                '">' +
                esc(code) +
                '</span>'
              );
            })
            .join('') +
          (function () {
            var ds = st.designations || [];
            var hasIep = ds.some(function (c) {
              return BC_DESIGNATIONS[c]?.iep;
            });
            var hasMod = ds.some(function (c) {
              return BC_DESIGNATIONS[c]?.modified;
            });
            return (
              (hasIep ? '<span class="cm-iep-tag">IEP</span>' : '') +
              (hasMod ? '<span class="cm-mod-tag">MOD</span>' : '')
            );
          })() +
          (st.pronouns ? '<span class="cm-student-pronouns">' + esc(st.pronouns) + '</span>' : '') +
          (st.studentNumber
            ? '<span style="font-size:0.75rem;color:var(--text-3);font-family:\'SF Mono\',monospace">#' +
              esc(st.studentNumber) +
              '</span>'
            : '') +
          '<div class="cm-student-actions">' +
          '<button class="cm-delete-mini" data-action="cmEditStudent" data-sid="' +
          st.id +
          '" title="Edit" style="font-size:0.75rem">\u270E</button>' +
          '<button class="cm-delete-mini" data-action="cmRemoveStudent" data-sid="' +
          st.id +
          '" title="Withdraw" aria-label="Withdraw ' +
          esc(fullName(st)) +
          '">\u2715</button>' +
          '</div>' +
          '</div>';
      });
      html += '</div>';
    } else {
      html +=
        '<div style="text-align:center;padding:16px;color:var(--text-3);font-size:0.875rem;border:1.5px dashed var(--border);border-radius:var(--radius-sm)">' +
        'No students yet. Add students individually or import a CSV roster.' +
        '</div>';
    }
    // Bulk edit panel
    if (cmBulkMode && students.length > 0) {
      html +=
        '<div class="cm-bulk-panel">' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
        '<button class="cm-add-link" data-action="cmBulkSelectAll" style="font-size:0.75rem">Select All</button>' +
        '<button class="cm-add-link" data-action="cmBulkDeselectAll" style="font-size:0.75rem">Deselect All</button>' +
        '<span style="font-size:0.75rem;color:var(--text-3);margin-left:auto">' +
        cmBulkSelected.size +
        ' selected</span>' +
        '</div>' +
        '<div class="cm-student-form" style="gap:8px 12px">' +
        '<div class="cm-field">' +
        '<label class="cm-label">Set pronouns</label>' +
        pronounsSelect('cm-bulk-pro', '') +
        '</div>' +
        '<div class="cm-field">' +
        '<label class="cm-label">Add attendance</label>' +
        '<div style="display:flex;gap:6px">' +
        '<input type="date" class="cm-input" id="cm-bulk-att-date" value="' +
        getTodayStr() +
        '" style="font-size:0.8125rem;flex:1">' +
        '<select class="cm-input" id="cm-bulk-att-status" style="font-size:0.8125rem;flex:1">' +
        '<option value="present">Present</option>' +
        '<option value="absent">Absent</option>' +
        '<option value="late">Late</option>' +
        '<option value="excused">Excused</option>' +
        '</select>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn btn-primary" data-action="cmApplyBulk" style="font-size:0.8125rem;padding:6px 14px" ' +
        (cmBulkSelected.size === 0 ? 'disabled' : '') +
        '>Apply to Selected</button>' +
        '</div>' +
        '</div>';
    }
    // Add/Edit student form
    html +=
      '<div id="cm-add-student-form" style="display:none" class="cm-add-student-form">' +
      '<div class="cm-student-form">' +
      '<div class="cm-field"><label class="cm-label">First name *</label><input class="cm-input" id="cm-add-first" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Last name</label><input class="cm-input" id="cm-add-last" placeholder="e.g. Osei" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Preferred name</label><input class="cm-input" id="cm-add-pref" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Pronouns</label>' +
      pronounsSelect('cm-add-pro', '') +
      '</div>' +
      '<div class="cm-field"><label class="cm-label">Student number</label><input class="cm-input" id="cm-add-num" placeholder="e.g. STU-101" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Email</label><input class="cm-input" id="cm-add-email" type="email" placeholder="student@school.edu" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Date of birth</label><input class="cm-input" id="cm-add-dob" type="date" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Designations</label>' +
      '<div class="desig-check-grid">' +
      Object.entries(BC_DESIGNATIONS)
        .map(function (entry) {
          var k = entry[0],
            v = entry[1];
          return (
            '<label class="desig-check-item" title="' +
            esc(v.desc) +
            '"><input type="checkbox" class="cm-desig-check" value="' +
            k +
            '"><span class="desig-check-code">' +
            k +
            '</span><span class="desig-check-name">' +
            esc(v.name) +
            '</span></label>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Language support</label>' +
      '<div class="desig-check-grid">' +
      Object.entries(SUPPORT_FLAGS)
        .map(function (entry) {
          var k = entry[0],
            v = entry[1];
          return (
            '<label class="desig-check-item" title="' +
            esc(v.desc) +
            '"><input type="checkbox" class="cm-desig-check" value="' +
            k +
            '"><span class="desig-check-code">' +
            k +
            '</span><span class="desig-check-name">' +
            esc(v.name) +
            '</span></label>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="cm-field" style="grid-column:1/-1;display:flex;align-items:flex-end;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn-ghost" data-action="cmCancelStudent" style="padding:6px 10px;font-size:0.8125rem">Cancel</button>' +
      '<button class="btn btn-primary" id="cm-save-btn" data-action="cmSaveStudent" style="padding:6px 14px;font-size:0.8125rem">Save</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="cm-roster-actions">' +
      '<button class="cm-add-link" data-action="cmShowAddStudent" style="padding:4px 0">+ Add Student</button>' +
      '<span style="color:var(--border)">|</span>' +
      '<button class="cm-add-link" data-action="cmImportRoster" style="padding:4px 0">Import Roster</button>' +
      '<input type="file" id="cm-csv-input" accept=".csv,.txt" style="display:none" data-action-change="cmCSV">' +
      '</div>' +
      '<div id="cm-import-preview"></div>' +
      renderWithdrawnList(cid) +
      '</div>';

    // Section 3: Grading & Calculation (still in left column)
    // T-UI-02 — grading_system segmented control. Three segments:
    //   proficiency / letter / both. Letter works without categories:
    //   getCourseLetterData falls back to total points across all work.
    var gs = course.gradingSystem || _cmDefaultGradingSystem(course);
    html +=
      '<div class="cm-section">' +
      '<div class="cm-section-title">Grading &amp; calculation</div>' +
      '<div class="cm-field">' +
      '<button class="cm-add-link" data-action="cmCopySetup">Copy grading setup\u2026</button>' +
      '<div class="cm-hint">Copy this class\u2019s grading system, categories and other settings to your other classes, or import them from one.</div>' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Grading system</label>' +
      '<div class="seg cm-seg" role="radiogroup" aria-label="Grading system">' +
      '<button class="seg-btn cm-seg-btn' +
      (gs === 'proficiency' ? ' active' : '') +
      '" role="radio" aria-checked="' +
      (gs === 'proficiency') +
      '" data-action="cmSetGradingSystem" data-value="proficiency">Proficiency</button>' +
      '<button class="seg-btn cm-seg-btn' +
      (gs === 'letter' ? ' active' : '') +
      '" role="radio" aria-checked="' +
      (gs === 'letter') +
      '" data-action="cmSetGradingSystem" data-value="letter">Letter</button>' +
      '<button class="seg-btn cm-seg-btn' +
      (gs === 'both' ? ' active' : '') +
      '" role="radio" aria-checked="' +
      (gs === 'both') +
      '" data-action="cmSetGradingSystem" data-value="both">Both</button>' +
      '</div>' +
      // Contextual grading-system description — mirrors the Phoneox React
      // pattern at src/components/courses/grading-config.tsx:56-70.
      '<div class="cm-hint" style="margin-top:6px">' +
      _cmGradingSystemDescription(gs) +
      '</div>' +
      '</div>' +
      _cmRenderCategoriesField(cmSelectedCourse) +
      _cmRenderRoundPercentField(cmSelectedCourse) +
      _cmRenderReportingTermsField(cmSelectedCourse) +
      '<div class="cm-field">' +
      '<label class="cm-label">Calculation method</label>' +
      '<div class="seg cm-seg" role="radiogroup" aria-label="Calculation method">' +
      CALC_METHODS.map(function (m) {
        return (
          '<button class="seg-btn cm-seg-btn' +
          (method === m.value ? ' active' : '') +
          '"' +
          segAttr(method === m.value, 'radio') +
          ' data-action="cmSetCalcMethod" data-value="' +
          m.value +
          '">' +
          m.label +
          '</button>'
        );
      }).join('') +
      '</div>' +
      // Contextual description beneath the selected method — copied verbatim
      // from Project Phoneox (src/components/courses/grading-config.tsx:100-115)
      // so explanatory copy stays consistent across the React and JS builds.
      '<div class="cm-hint" style="margin-top:6px">' +
      _cmCalcMethodDescription(method) +
      '</div>' +
      '</div>' +
      '<div class="cm-field" style="' +
      (method === 'decayingAvg' ? '' : 'display:none') +
      '">' +
      '<label class="cm-label">Decay weight</label>' +
      '<div class="cm-slider-row">' +
      '<input type="range" min="10" max="95" value="' +
      Math.round(dw * 100) +
      '" id="cm-decay-slider" data-action-input="cmDecaySlider" style="flex:1">' +
      '<span class="cm-slider-label" id="cm-decay-val">' +
      Math.round(dw * 100) +
      '%</span>' +
      '</div>' +
      '<div class="cm-hint">Higher values weight recent scores more heavily.</div>' +
      '</div>' +
      // Late Work Policy — free-text, optional. Copy adapted from Phoneox
      // src/components/courses/grading-config.tsx:204-222. Surfaced on the
      // Score Distribution section of printed progress reports when set.
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-late-policy">Late work policy</label>' +
      '<textarea class="cm-textarea" id="cm-late-policy" rows="2" placeholder="e.g. Late assignments lose 10% per day, up to 3 days." data-action-blur="cmLateWorkPolicy" aria-label="Late work policy">' +
      esc(course.lateWorkPolicy || '') +
      '</textarea>' +
      '<div class="cm-hint">Optional. If set, this text appears on the Score Distribution section of printed progress reports.</div>' +
      '</div>' +
      // T-UI-02 retired controls: the legacy "Category weights (summative vs
      // formative slider)" and "Report final grade as percentage" checkbox
      // were deleted 2026-04-21. Real category weighting lands in T-UI-12's
      // Category management row; percentage/letter display is driven entirely
      // by grading_system above.
      '</div>';

    html += '</div>'; // close left column

    // RIGHT COLUMN: Curriculum
    html += '<div class="cm-col-curriculum">';

    // Curriculum -- Subjects
    html +=
      '<div class="cm-section">' +
      '<div class="cm-section-title">Curriculum</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Subjects</label>';
    (lm.subjects || []).forEach(function (sub) {
      html +=
        '<div class="cm-subject-row">' +
        '<div class="cm-subject-color" style="background:' +
        sub.color +
        '">' +
        '<div class="cm-color-swatch-selected" style="background:' +
        sub.color +
        '" data-action="cmToggleColorPalette" data-target="subject" data-subid="' +
        sub.id +
        '"></div>' +
        '<div class="cm-color-palette" id="cm-palette-subject-' +
        sub.id +
        '"></div>' +
        '</div>' +
        '<input class="cm-input" value="' +
        esc(sub.name) +
        '" style="flex:1" data-action-blur="cmSubjectName" data-subid="' +
        sub.id +
        '">' +
        '<button class="cm-delete-mini" data-action="cmDeleteSubject" data-subid="' +
        sub.id +
        '" title="Delete subject" aria-label="Delete subject">\u2715</button>' +
        '</div>';
    });
    html += '<button class="cm-add-link" data-action="cmAddSubject">+ Add Subject</button></div>';

    // Learning Standards — folder-based UI (mirrors assignments page)
    var compGroups = lm.competencyGroups || [];
    var _cmGrouped = { groups: [], ungrouped: [] };
    var _cmGroupMap = {};
    compGroups.forEach(function (g) {
      _cmGroupMap[g.id] = { group: g, sections: [] };
    });
    (lm.sections || []).forEach(function (sec) {
      if (sec.groupId && _cmGroupMap[sec.groupId]) _cmGroupMap[sec.groupId].sections.push(sec);
      else _cmGrouped.ungrouped.push(sec);
    });
    _cmGrouped.groups = compGroups.map(function (g) {
      return _cmGroupMap[g.id];
    });

    html += '<div class="cm-field"><label class="cm-label">Learning standards</label>';

    if ((lm.sections || []).length === 0 && compGroups.length === 0) {
      html +=
        '<div class="cm-curriculum-empty">' +
        '<div class="cm-curriculum-empty-text">No learning standards yet. Add a standard to start defining your curriculum.</div>' +
        '</div>';
    }

    // Render group folders (reuses .mod-folder pattern from assignments page)
    _cmGrouped.groups.forEach(function (gi) {
      var grp = gi.group;
      var secs = gi.sections;
      var isOpen = !_cmCollapsedStdFolders[grp.id];
      html +=
        '<div class="mod-folder' +
        (isOpen ? ' open' : '') +
        '" data-module-id="' +
        grp.id +
        '" data-folder-drop="' +
        grp.id +
        '">' +
        '<div class="mod-folder-header" data-action="cmToggleStdFolder" data-uid="' +
        grp.id +
        '">' +
        '<span class="mod-folder-grip">\u2807</span>' +
        '<span class="mod-folder-chevron">\u25B6</span>' +
        '<span class="mod-folder-color" style="background:' +
        grp.color +
        '" title="Change colour" data-action="openColorPicker" data-stop-prop="true">' +
        '<input type="color" value="' +
        grp.color +
        '" data-action-change="cmCompGroupColor" data-grpid="' +
        grp.id +
        '">' +
        '</span>' +
        '<input class="mod-folder-name-input" value="' +
        esc(grp.name) +
        '" draggable="false" data-stop-prop="true" data-action-blur="cmCompGroupName" data-grpid="' +
        grp.id +
        '">' +
        '<span class="mod-folder-meta">' +
        secs.length +
        ' standard' +
        (secs.length !== 1 ? 's' : '') +
        '</span>' +
        '<div class="mod-folder-actions" data-stop-prop="true">' +
        '<button class="mod-folder-action delete" data-action="cmDeleteCompGroup" data-grpid="' +
        grp.id +
        '" data-count="' +
        secs.length +
        '" title="Delete group">\u2715</button>' +
        '</div>' +
        '</div>' +
        '<div class="mod-folder-body">';
      if (secs.length === 0) {
        html +=
          '<div class="mod-folder-empty">Drag standards here or use the group dropdown when editing a standard</div>';
      }
      secs.forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
      html += '</div></div>';
    });

    // Ungrouped standards
    if (_cmGrouped.ungrouped.length > 0 || compGroups.length > 0) {
      var ungOpen = !_cmCollapsedStdFolders['__none__'];
      html +=
        '<div class="mod-folder no-module' +
        (ungOpen ? ' open' : '') +
        '" data-module-id="__none__" data-folder-drop="__none__">' +
        '<div class="mod-folder-header" data-action="cmToggleStdFolder" data-uid="__none__">' +
        '<span class="mod-folder-chevron">\u25B6</span>' +
        '<span class="mod-folder-name" style="font-size:0.95rem;font-weight:500;color:var(--text-3)">Ungrouped</span>' +
        '<span class="mod-folder-meta">' +
        _cmGrouped.ungrouped.length +
        ' standard' +
        (_cmGrouped.ungrouped.length !== 1 ? 's' : '') +
        '</span>' +
        '</div>' +
        '<div class="mod-folder-body">';
      _cmGrouped.ungrouped.forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
      if (_cmGrouped.ungrouped.length === 0) {
        html += '<div class="mod-folder-empty">All standards are grouped</div>';
      }
      html += '</div></div>';
    } else {
      // No groups at all — render flat
      (lm.sections || []).forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
    }

    // Add buttons
    html += '<button class="add-module-btn" data-action="cmAddCompGroup">+ Add Group</button>';
    html += '<button class="cm-add-link" data-action="cmAddStd">+ Add Standard</button>';
    html += '</div></div>';

    // Section 4: BC Curriculum Link
    var linkedTags = course.curriculumTags || [];
    html += '<div class="cm-section">' + '<div class="cm-section-title">BC curriculum link</div>';
    if (linkedTags.length > 0) {
      linkedTags.forEach(function (tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        var courseName = courseData ? courseData.course_name : tag;
        html +=
          '<div class="cm-curric-link">' +
          '<span class="cm-curric-tag">' +
          esc(tag) +
          '</span>' +
          '<span class="cm-curric-name">' +
          esc(courseName) +
          '</span>' +
          '</div>';
      });
      html +=
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' + cid + '">Re-link Curriculum</button>';
    } else {
      html +=
        '<div class="cm-curric-unlinked">Not linked to BC Curriculum</div>' +
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' +
        cid +
        '">Link to BC Curriculum</button>';
    }
    html += '</div>';

    // Section 5: Sentence starters
    html += _cmRenderStarters(cid);

    html += '</div>'; // close right column (cm-col-curriculum)

    // Actions row
    var isArchived = isCourseArchived(cid);
    html +=
      '<div class="cm-actions-row">' +
      '<button class="cm-action-btn" data-action="cmDuplicateCourse" data-cid="' +
      cid +
      '">\u29C9 Duplicate Class</button>' +
      '<button class="cm-action-btn" data-action="cmToggleArchive" data-cid="' +
      cid +
      '">' +
      (isArchived ? 'Unarchive Class' : 'Archive Class') +
      '</button>' +
      (isArchived
        ? '<button class="cm-action-btn cm-action-btn-danger" data-action="cmDeleteCourse" data-cid="' +
          cid +
          '">Delete Class</button>'
        : '') +
      '</div>';

    html += '</div>'; // close cm-detail-inner
    return html;
  }

  /* ── Curriculum Wizard ──────────────────────────────────── */
  function renderCmCreateForm() {
    if (cwStep === 1) return renderCwStep1();
    if (cwStep === 2) return renderCwStep2();
    if (cwStep === 3) return renderCwStep3();
    return '';
  }

  function renderCwStepBar() {
    var labels = ['Choose Courses', 'Class Details', 'Review'];
    return (
      '<div class="cw-steps">' +
      labels
        .map(function (l, i) {
          var n = i + 1;
          var cls = n < cwStep ? 'done' : n === cwStep ? 'active' : '';
          return (
            (i > 0 ? '<span class="cw-step-arrow">\u203A</span>' : '') +
            '<div class="cw-step ' +
            cls +
            '">' +
            '<span class="cw-step-num">' +
            (n < cwStep ? '\u2713' : n) +
            '</span>' +
            '<span>' +
            l +
            '</span>' +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderCwStep1() {
    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    if (!cwCurriculumLoaded && !cwLoadError) {
      html += '<div class="cm-section"><div class="cw-empty-msg">Loading BC curriculum data\u2026</div></div>';
      html += '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button></div>';
      html += '</div>';
      return html;
    }

    if (cwLoadError) {
      html +=
        '<div class="cm-section"><div class="cw-empty-msg">Could not load BC Curriculum data.<br>You can still create a class with a custom learning map.</div></div>';
      html +=
        '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button><button class="btn btn-primary" data-action="cwSkipToCustom">Custom Class</button></div>';
      html += '</div>';
      return html;
    }

    // Grade selection
    html += '<div class="cm-section"><div class="cm-section-title">Grade</div><div class="cw-grade-row">';
    [8, 9, 10, 11, 12].forEach(function (g) {
      var active = cwSelectedGrade === g ? ' active' : '';
      html +=
        '<button class="cw-grade-btn' +
        active +
        '" data-action="cwSelectGrade" data-grade="' +
        g +
        '">Grade ' +
        g +
        '</button>';
    });
    html += '</div></div>';

    // Subject selection
    if (cwSelectedGrade !== null) {
      var allCourses = getCoursesByGrade(cwSelectedGrade);
      var bySubject = {};
      allCourses.forEach(function (c) {
        if (!bySubject[c.subject]) bySubject[c.subject] = [];
        bySubject[c.subject].push(c);
      });
      var subjectNames = Object.keys(bySubject).sort();

      html += '<div class="cm-section"><div class="cm-section-title">Subject</div><div class="cw-subject-row">';
      subjectNames.forEach(function (subj) {
        var active = cwSelectedSubject === subj ? ' active' : '';
        var color = SUBJECT_COLOURS[subj] || '#6366f1';
        html +=
          '<button class="cw-subject-btn' +
          active +
          '" data-action="cwSelectSubject" data-subject="' +
          esc(subj) +
          '">' +
          '<span class="cw-subject-dot" style="background:' +
          color +
          '"></span>' +
          esc(subj) +
          '</button>';
      });
      html += '</div></div>';

      // Course checklist
      if (cwSelectedSubject && bySubject[cwSelectedSubject]) {
        var courses = bySubject[cwSelectedSubject];
        html +=
          '<div class="cm-section"><div class="cm-section-title">Courses</div>' +
          '<div class="cm-hint" style="margin-bottom:8px">Select one or more courses. Multiple selections create a combined class.</div>' +
          '<div class="cw-course-list">';
        courses.forEach(function (c) {
          var sel = cwSelectedTags.includes(c.short_tag) ? ' selected' : '';
          var fullCourse = CURRICULUM_INDEX[c.short_tag];
          var compCount = 0,
            catCount = 0;
          if (fullCourse && fullCourse.categories) {
            catCount = fullCourse.categories.length;
            fullCourse.categories.forEach(function (cat) {
              compCount += (cat.competencies || []).length;
            });
          }
          html +=
            '<div class="cw-course-item' +
            sel +
            '" data-action="cwToggleCourse" data-tag="' +
            esc(c.short_tag) +
            '">' +
            '<span class="cw-course-check">' +
            (sel ? '\u2713' : '') +
            '</span>' +
            '<span class="cw-course-name">' +
            esc(c.course_name) +
            '</span>' +
            '<span class="cw-course-tag">' +
            esc(c.short_tag) +
            '</span>' +
            '<span class="cw-course-count">' +
            catCount +
            ' categories \u00B7 ' +
            compCount +
            ' standards</span>' +
            '</div>';
        });
        html += '</div>';

        if (cwSelectedTags.length > 0) {
          var totalComps = 0;
          cwSelectedTags.forEach(function (tag) {
            var full = CURRICULUM_INDEX[tag];
            if (full && full.categories) {
              full.categories.forEach(function (cat) {
                totalComps += (cat.competencies || []).length;
              });
            }
          });
          html +=
            '<div class="cw-selection-summary"><strong>' +
            cwSelectedTags.length +
            '</strong> course' +
            (cwSelectedTags.length !== 1 ? 's' : '') +
            ' selected \u00B7 <strong>' +
            totalComps +
            '</strong> competencies will become gradebook standards</div>';
        }
        html += '</div>';
      }
    }

    html +=
      '<button class="cw-custom-btn" data-action="cwSkipToCustom">\u270E Create a custom class without BC Curriculum</button>';
    html +=
      '<div class="cw-footer"><button class="btn btn-ghost" data-action="cmCancelCreate">Cancel</button>' +
      '<button class="btn btn-primary" data-action="cwGoToStep2" ' +
      (cwSelectedTags.length === 0 ? 'disabled style="opacity:0.4;pointer-events:none"' : '') +
      '>Next</button></div>';
    html += '</div>';
    return html;
  }

  function renderCwStep2() {
    var preName = '';
    var preGrade = '';
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var names = cwSelectedTags
        .map(function (tag) {
          return CURRICULUM_INDEX[tag];
        })
        .filter(Boolean)
        .map(function (c) {
          return c.course_name;
        });
      preName = names.join(' / ');
      preGrade = cwSelectedGrade ? String(cwSelectedGrade) : '';
    }
    if (cwStep2Grade) preGrade = cwStep2Grade;
    var grading = cwStep2Grading || _cmDefaultGradingSystem({ gradeLevel: preGrade });
    var calc = cwStep2Calc || _cmDefaultCalcMethod(preGrade);

    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    html +=
      '<div class="cm-section"><div class="cm-section-title">Class details</div>' +
      '<div class="cm-field"><label class="cm-label">Class name</label><input class="cm-input" id="cm-new-name" value="' +
      esc(preName) +
      '" placeholder="e.g. English 10" autofocus></div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-new-block-label">Block</label>' +
      blockPickerHtml('cm-new-block', cwStep2Block) +
      '</div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-cg-span-label">This class runs</label>' +
      '<div class="seg seg-sm cm-seg" id="cm-cg-span" role="radiogroup" aria-labelledby="cm-cg-span-label">' +
      TERM_SPANS.map(function (o) {
        var on = cwStep2Span === o.value;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (on ? ' active' : '') +
          '"' +
          segAttr(on, 'radio') +
          ' data-val="' +
          o.value +
          '" data-action="cmCreateToggle" data-group="cm-cg-span">' +
          o.label +
          '</button>'
        );
      }).join('') +
      '</div></div>' +
      '<div style="display:flex;gap:16px"><div class="cm-field" style="flex:1"><label class="cm-label">Grade level</label><input class="cm-input" id="cm-new-grade" value="' +
      esc(preGrade) +
      '" placeholder="e.g. 8, 10-12" data-action-input="cwGradeInput"></div></div>' +
      '<div class="cm-field"><label class="cm-label">Description</label><textarea class="cm-textarea" id="cm-new-desc" placeholder="Optional">' +
      esc(cwStep2Desc) +
      '</textarea></div></div>';

    html +=
      '<div class="cm-section"><div class="cm-section-title">Grading &amp; calculation</div>' +
      '<div class="cm-field"><label class="cm-label">Grading system</label>' +
      // T-UI-02 · wizard grading_system picker. Grades 10–12 default to
      // Letter; with no categories, letter grades use total points.
      '<div class="seg cm-seg" id="cm-cg-grading" role="radiogroup" aria-label="Grading system">' +
      GRADING_SYSTEMS.map(function (g) {
        return (
          '<button class="seg-btn cm-seg-btn' +
          (grading === g.value ? ' active' : '') +
          '"' +
          segAttr(grading === g.value, 'radio') +
          ' data-val="' +
          g.value +
          '" data-action="cmCreateToggle" data-group="cm-cg-grading">' +
          g.label +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="cm-hint" id="cm-cg-grading-desc" style="margin-top:6px">' +
      _cmGradingSystemDescription(grading) +
      '</div>' +
      '</div>' +
      '<div class="cm-field"><label class="cm-label">Calculation method</label>' +
      '<div class="seg cm-seg" id="cm-cg-calc" role="radiogroup" aria-label="Calculation method">' +
      CALC_METHODS.map(function (m) {
        var action = m.value === 'decayingAvg' ? 'cmCreateToggleDecay' : 'cmCreateToggle';
        var isActive = m.value === calc;
        return (
          '<button class="seg-btn cm-seg-btn' +
          (isActive ? ' active' : '') +
          '"' +
          segAttr(isActive, 'radio') +
          ' data-val="' +
          m.value +
          '" data-action="' +
          action +
          '" data-group="cm-cg-calc">' +
          m.label +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="cm-hint" id="cm-cg-calc-desc" style="margin-top:6px">' +
      _cmCalcMethodDescription(calc) +
      '</div></div>' +
      '<div id="cm-cg-decay" class="cm-field" style="' +
      (calc === 'decayingAvg' ? '' : 'display:none') +
      '"><label class="cm-label">Decay weight</label>' +
      '<div class="cm-slider-row"><input type="range" min="10" max="95" value="' +
      esc(cwStep2Decay) +
      '" id="cm-cg-decay-slider" data-action-input="cmCreateDecaySlider" style="flex:1"><span class="cm-slider-label" id="cm-cg-decay-val">' +
      esc(cwStep2Decay) +
      '%</span></div>' +
      '<div class="cm-hint">Higher values weight recent scores more heavily.</div></div>' +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-new-late-policy">Late work policy</label>' +
      '<textarea class="cm-textarea" id="cm-new-late-policy" rows="2" placeholder="e.g. Late assignments lose 10% per day, up to 3 days." aria-label="Late work policy">' +
      esc(cwStep2LatePolicy) +
      '</textarea>' +
      '<div class="cm-hint">Optional. If set, this text appears on the Score Distribution section of printed progress reports.</div>' +
      '</div>' +
      '</div>';

    html +=
      '<div class="cw-footer"><button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwGoToStep3">Next</button></div>';
    html += '</div>';
    return html;
  }

  function renderCwStep3() {
    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    var className = document.getElementById('cm-new-name')?.value || cwGetPreName();
    var gradeLevel = document.getElementById('cm-new-grade')?.value || (cwSelectedGrade ? String(cwSelectedGrade) : '');
    var gradingLabel = { proficiency: 'Proficiency', letter: 'Letter', both: 'Both' }[cwStep2Grading] || 'Proficiency';
    var calcLabel = (
      CALC_METHODS.find(function (m) {
        return m.value === cwStep2Calc;
      }) || CALC_METHODS[0]
    ).label;

    html +=
      '<div class="cm-section"><div class="cm-section-title">Review</div>' +
      '<div class="cm-field"><label class="cm-label">Class name</label><div style="font-size:var(--text-lg);font-weight:600;color:var(--text)">' +
      esc(className || 'Untitled') +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Block</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(courseBlockLabel({ block: cwStep2Block }) || '\u2014') +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Runs</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(
        (
          TERM_SPANS.find(function (o) {
            return o.value === cwStep2Span;
          }) || TERM_SPANS[0]
        ).label,
      ) +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Grade</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(gradeLevel || '\u2014') +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Grading system</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(gradingLabel) +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Calculation method</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(calcLabel) +
      (cwStep2Calc === 'decayingAvg' ? ' \u00B7 ' + esc(cwStep2Decay) + '% decay weight' : '') +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Late work policy</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(cwStep2LatePolicy.trim() || '\u2014') +
      '</div></div></div>';

    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var subjectColors = ['#0891b2', '#7c3aed', '#059669', '#d97706', '#dc2626', '#2563eb', '#db2777', '#4f46e5'];
      var colorIdx = 0;
      cwSelectedTags.forEach(function (tag) {
        var courseData = CURRICULUM_INDEX[tag];
        if (!courseData) return;
        var color = subjectColors[colorIdx % subjectColors.length];
        colorIdx++;
        var cats = courseData.categories || [];
        var totalComps = 0;
        cats.forEach(function (c) {
          totalComps += (c.competencies || []).length;
        });
        html +=
          '<div class="cw-review-card">' +
          '<div class="cw-review-title" style="color:' +
          color +
          '">' +
          esc(courseData.course_name) +
          '</div>' +
          '<div class="cw-review-meta">' +
          esc(tag) +
          ' \u00B7 ' +
          totalComps +
          ' competencies across ' +
          cats.length +
          ' categories</div>' +
          '<div class="cw-review-sections">';
        cats.forEach(function (cat) {
          var compCount = (cat.competencies || []).length;
          html +=
            '<div class="cw-review-sec"><span class="cw-review-sec-dot" style="background:' +
            color +
            '"></span>' +
            esc(cat.name) +
            '<span class="cw-review-sec-count">' +
            compCount +
            ' standard' +
            (compCount !== 1 ? 's' : '') +
            '</span></div>';
        });
        html += '</div></div>';
      });
    } else {
      html +=
        '<div class="cm-section"><div class="cw-empty-msg">Custom class \u2014 no curriculum data. You can add sections and tags manually after creation.</div></div>';
    }

    html +=
      '<div class="cw-footer"><button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwFinishCreate">Create Class</button></div>';
    html += '</div>';
    return html;
  }

  /* ── Wizard navigation ──────────────────────────────────── */
  function cwSelectGrade(g) {
    cwSelectedGrade = g;
    cwStep2Grade = '';
    cwStep2Grading = '';
    cwStep2Calc = '';
    cwSelectedSubject = null;
    cwSelectedTags = [];
    renderClassManager();
  }

  function cwSelectSubject(subj) {
    cwSelectedSubject = subj;
    renderClassManager();
  }

  function cwToggleCourse(tag) {
    var idx = cwSelectedTags.indexOf(tag);
    if (idx >= 0) cwSelectedTags.splice(idx, 1);
    else cwSelectedTags.push(tag);
    renderClassManager();
  }

  function cwSkipToCustom() {
    cwSelectedTags = [];
    cwStep = 2;
    renderClassManager();
  }

  function cwGoToStep2() {
    if (cwSelectedTags.length === 0) return;
    cwStep = 2;
    renderClassManager();
  }

  function cwGoToStep3() {
    cwStep2Name = document.getElementById('cm-new-name')?.value || '';
    cwStep2Block = readBlockPicker('cm-new-block');
    cwStep2Span = (document.querySelector('#cm-cg-span .cm-seg-btn.active') || {}).dataset?.val || 'full';
    cwStep2Grade = document.getElementById('cm-new-grade')?.value || '';
    cwStep2Desc = document.getElementById('cm-new-desc')?.value || '';
    cwStep2Grading =
      (document.querySelector('#cm-cg-grading .cm-seg-btn.active') || {}).dataset?.val ||
      _cmDefaultGradingSystem({ gradeLevel: cwStep2Grade });
    cwStep2Calc =
      (document.querySelector('#cm-cg-calc .cm-seg-btn.active') || {}).dataset?.val ||
      _cmDefaultCalcMethod(cwStep2Grade);
    cwStep2Decay = document.getElementById('cm-cg-decay-slider')?.value || '65';
    cwStep2LatePolicy = document.getElementById('cm-new-late-policy')?.value || '';
    cwStep = 3;
    renderClassManager();
  }

  function cwGoBack() {
    if (cwStep === 3) cwStep = 2;
    else if (cwStep === 2) cwStep = 1;
    renderClassManager();
  }

  function cwGetPreName() {
    if (cwStep2Name) return cwStep2Name;
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      return cwSelectedTags
        .map(function (tag) {
          return CURRICULUM_INDEX[tag];
        })
        .filter(Boolean)
        .map(function (c) {
          return c.course_name;
        })
        .join(' / ');
    }
    return '';
  }

  async function cwFinishCreate() {
    var name = cwStep2Name || cwGetPreName();
    if (!name.trim()) {
      cwStep = 2;
      renderClassManager();
      requestAnimationFrame(function () {
        var el = document.getElementById('cm-new-name');
        if (el) {
          el.style.border = '2px solid var(--score-1)';
          el.placeholder = 'Class name is required';
          el.oninput = function () {
            this.style.border = '';
          };
          el.focus();
        }
      });
      return;
    }

    var finishBtn = document.querySelector('[data-action="cwFinishCreate"]');
    if (finishBtn) {
      finishBtn.disabled = true;
      finishBtn.textContent = 'Creating…';
    }

    var course = createCourse({
      name: name.trim(),
      block: cwStep2Block,
      gradeLevel: (cwStep2Grade || (cwSelectedGrade ? String(cwSelectedGrade) : '')).trim(),
      description: (cwStep2Desc || '').trim(),
      gradingSystem: cwStep2Grading,
      calcMethod: cwStep2Calc,
      decayWeight: parseInt(cwStep2Decay, 10) / 100,
      lateWorkPolicy: cwStep2LatePolicy.trim() || null,
    });

    // createCourse fires create_course asynchronously and returns a course
    // object carrying a local placeholder id; the rekey to the canonical UUID
    // lands when the RPC resolves. Everything below needs the real id — the
    // course-config write, the learning-map dispatch, the class-manager
    // selection and the active-course pointer — so resolve it once, here,
    // before any of them run. Resolving outside the curriculum branch matters:
    // a class created with no curriculum tags used to skip the wait entirely
    // and carry the placeholder all the way to setActiveCourse.
    var canonicalCid = await _awaitCanonicalCourse(course.id, 10000);
    if (canonicalCid && canonicalCid !== course.id) course.id = canonicalCid;

    var cc = getCourseConfig(course.id);
    cc.calcMethod = cwStep2Calc;
    cc.decayWeight = parseInt(cwStep2Decay, 10) / 100;
    var defaultTerms = _cmDefaultReportingTerms(course.id, cwStep2Span);
    if (defaultTerms && !(Array.isArray(cc.reportingTerms) && cc.reportingTerms.length))
      cc.reportingTerms = defaultTerms;
    saveCourseConfig(course.id, cc);

    var dispatchOk = true;
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var map = buildLearningMapFromTags(cwSelectedTags);
      if (map) {
        var mapSaved = saveLearningMap(course.id, map);
        updateCourse(course.id, { curriculumTags: cwSelectedTags.slice() });
        // A class whose create never landed has no server id, so its
        // curriculum can't be sent yet. Otherwise wait for the map to reach
        // the server, within reason: offline, the outbox keeps it for later.
        // Demo Mode has no server, so its map is saved once it's cached.
        var localOnly = typeof _writesEnabled === 'function' && !_writesEnabled();
        dispatchOk = canonicalCid || localOnly ? await _resolvesTrueWithin(mapSaved, 15000) : false;
      }
    }

    cmSelectedCourse = course.id;
    cmMode = 'edit';
    _activeCourse = course.id;
    _activeCourseChanged = true;
    setActiveCourse(course.id);
    renderClassManager();

    if (!dispatchOk) {
      alert(
        'Class created, but curriculum competencies failed to sync. You can re-add them from the curriculum panel.',
      );
    }
  }

  /* ── CM Actions ─────────────────────────────────────────── */
  function cmSelectClass(cid) {
    cmSelectedCourse = cid;
    cmMode = 'edit';
    renderClassManager();
  }

  function cmStartCreate() {
    cmMode = 'create';
    cmSelectedCourse = null;
    cwStep = 1;
    cwSelectedGrade = null;
    cwSelectedSubject = null;
    cwSelectedTags = [];
    cwLoadError = false;
    cwStep2Name = '';
    cwStep2Grade = '';
    cwStep2Desc = '';
    cwStep2Block = '';
    cwStep2Span = 'full';
    cwStep2Grading = '';
    cwStep2Calc = '';
    cwStep2Decay = '65';
    cwStep2LatePolicy = '';
    loadCurriculumIndex().then(function (idx) {
      cwCurriculumLoaded = !!idx;
      cwLoadError = !idx;
      if (cmMode === 'create' && cwStep === 1) renderClassManager();
    });
    renderClassManager();
  }

  function cmCancelCreate() {
    cmMode = 'edit';
    cmSelectedCourse = _activeCourse;
    renderClassManager();
  }

  function cmCreateToggle(btn, containerId) {
    segSelect(btn);
    if (containerId === 'cm-cg-calc') {
      cwStep2Calc = btn.dataset.val;
      var desc = document.getElementById('cm-cg-calc-desc');
      if (desc) desc.innerHTML = _cmCalcMethodDescription(btn.dataset.val);
    }
    if (containerId === 'cm-cg-grading') {
      cwStep2Grading = btn.dataset.val;
      var gdesc = document.getElementById('cm-cg-grading-desc');
      if (gdesc) gdesc.innerHTML = _cmGradingSystemDescription(btn.dataset.val);
    }
  }

  // Typing a grade level re-applies the grade defaults to any picker the
  // teacher hasn't chosen yet.
  function cwGradeInput(value) {
    if (!cwStep2Grading) {
      var gs = _cmDefaultGradingSystem({ gradeLevel: value });
      var gbtn = document.querySelector('#cm-cg-grading .cm-seg-btn[data-val="' + gs + '"]');
      if (gbtn) {
        cmCreateToggle(gbtn, 'cm-cg-grading');
        cwStep2Grading = '';
      }
    }
    if (!cwStep2Calc) {
      var cbtn = document.querySelector('#cm-cg-calc .cm-seg-btn[data-val="' + _cmDefaultCalcMethod(value) + '"]');
      if (cbtn) {
        cmCreateToggle(cbtn, 'cm-cg-calc');
        cwStep2Calc = '';
        var dp = document.getElementById('cm-cg-decay');
        if (dp) dp.style.display = 'none';
      }
    }
  }

  /* ── CM Edit Actions ────────────────────────────────────── */
  function cmUpdateField(field, value, inputEl) {
    if (!cmSelectedCourse) return;
    if (field === 'name' && !value.trim()) {
      if (inputEl) {
        inputEl.style.border = '2px solid var(--score-1)';
        inputEl.placeholder = 'Class name is required';
        inputEl.oninput = function () {
          this.style.border = '';
        };
        inputEl.focus();
      }
      return;
    }
    updateCourse(cmSelectedCourse, { [field]: field === 'block' ? normalizeCourseBlock(value) : value.trim() });
    var nameEl = document.querySelector('.cm-class-item.selected .cm-class-name');
    if ((field === 'name' || field === 'block') && nameEl)
      nameEl.textContent = courseDisplayName(COURSES[cmSelectedCourse]);
  }

  // T-UI-02 helpers ──────────────────────────────────────────────────
  // Default grading_system by grade level: 8–9 → proficiency, 10–12 → letter.
  // Falls back to proficiency when the grade isn't a number we recognize.
  function _cmDefaultGradingSystem(course) {
    var gl = parseInt((course && course.gradeLevel) || '', 10);
    if (!isNaN(gl) && gl >= 10 && gl <= 12) return 'letter';
    return 'proficiency';
  }

  // Default calc_method by grade level: 10–12 → mean, otherwise most recent.
  function _cmDefaultCalcMethod(gradeLevel) {
    return _cmDefaultGradingSystem({ gradeLevel: gradeLevel }) === 'letter' ? 'average' : 'mostRecent';
  }

  // Calculation-method descriptions (verbatim from Project Phoneox React build
  // `src/components/courses/grading-config.tsx:100-115`). Keep these two copies
  // in sync — changes to one should land in the other.
  function _cmCalcMethodDescription(method) {
    // Mean / Median copy matches Phoneox src/components/courses/grading-config.tsx:107-109
    // (Phoneox labels the value 'mean'; we persist 'average' to match the backend CHECK
    // constraint — same concept, different internal string).
    var map = {
      mostRecent:
        'Only the latest score counts. If a student scores 2, then 3, then 4, their grade is 4. Earlier scores are ignored entirely. This is the BC standard for competency-based grading \u2014 it answers "where is the student now?" not "how did they do on average."',
      highest:
        'Only the best score counts. If a student scores 2, then 4, then 3, their grade is 4. This rewards students who demonstrate mastery at any point and removes the penalty for early struggles while learning new material.',
      average:
        'All scores are added up and divided equally. If a student scores 2, 3, and 4, their grade is 3. This is the traditional average \u2014 every assignment carries the same weight, so a low early score pulls the final grade down even after improvement.',
      median:
        'Scores are sorted and the middle value is used. If a student scores 1, 3, and 4, their grade is 3 (not 2.7 like the mean). This protects against one unusually low or high score skewing the result.',
      mode: 'The most repeated score is used. If a student scores 3, 3, 4, and 2, their grade is 3 because it appeared most often. This reflects the level a student performs at most consistently, filtering out one-off results.',
      decayingAvg:
        'A weighted average where recent scores count more than older ones. If a student scores 2, then 3, then 4, the grade will be closer to 4 than a simple average. Use the slider below to control how much more recent work matters.',
    };
    return esc(map[method] || map.mostRecent);
  }

  // Grading-system descriptions — proficiency + letter copy adapted from
  // Project Phoneox (grading-config.tsx:58-62). 'both' is original (FullVision
  // v2-only; INSTRUCTIONS.md:15 states it runs both pipelines side by side).
  function _cmGradingSystemDescription(gs) {
    var map = {
      proficiency:
        'Students are scored on a 1\u20134 scale: 1 (Beginning), 2 (Developing), 3 (Proficient), 4 (Extending). This is the standard scale used across BC K\u201312 classrooms and aligns directly with BC report card requirements.',
      letter:
        'Students receive letter grades (A, B, C+, C, C\u2013, F) using BC Ministry of Education percentage cutoffs and conversion tables. All calculations follow the official BC grading scale, so report cards are generated correctly without manual conversion.',
      both: 'Both pipelines run side by side: proficiency (1\u20134) drives the competency view and the dashboard overview; letter + percentage (from points earned, weighted by category if any, and the BC conversion tables) drive reports for grades 10\u201312. Useful when a teacher wants the competency lens day-to-day but the parent-facing report card still needs letter grades.',
    };
    return esc(map[gs] || map.proficiency);
  }

  // T-UI-12 · Category management inline row.
  // Per-course state: { rows: [{id?, name, weight, display_order}], loaded, loading }.
  // Rows without `id` are new (not yet persisted). `loaded` flips true after
  // list_categories resolves at least once for the course.
  var _cmCategoryState = {};

  function _cmCatState(cid) {
    if (!_cmCategoryState[cid]) _cmCategoryState[cid] = { rows: [], loaded: false, loading: null };
    return _cmCategoryState[cid];
  }

  // Push the class-manager's private category state into the shared
  // _cache.categories that getCategories / getCategoryById / page-assignments /
  // page-gradebook / shared/calc.js all read from. Without this, a category
  // added or deleted in the same session is invisible to those readers
  // until the next sign-in (which re-hydrates via get_gradebook).
  // The class manager is the one writer for its category edits; this only
  // brings the cache in line with what it already sent.
  function _cmMirrorCategoriesToCache(cid) {
    if (!cid || typeof adoptCategoriesFromServer !== 'function') return;
    var st = _cmCatState(cid);
    var camelRows = (st.rows || []).map(function (r) {
      return {
        id: r.id,
        name: r.name || '',
        weight: Number(r.weight) || 0,
        displayOrder: Number(r.display_order) || 0,
      };
    });
    adoptCategoriesFromServer(cid, camelRows);
  }

  function _cmLoadCategories(cid) {
    if (!cid) return;
    var st = _cmCatState(cid);
    if (st.loaded || st.loading) return;
    // Without a server (Demo Mode) the class's categories are the cached ones.
    if (!window.v2 || !window.v2.listCategories || !_useSupabase) {
      st.loaded = true;
      st.rows = (getCategories(cid) || []).map(function (c, i) {
        return {
          id: c.id,
          name: c.name || '',
          weight: Number(c.weight) || 0,
          display_order: c.displayOrder != null ? Number(c.displayOrder) : i,
        };
      });
      if (st.rows.length) renderClassManager();
      return;
    }
    st.loading = window.v2
      .listCategories(cid)
      .then(function (res) {
        st.loading = null;
        st.loaded = true;
        if (res && !res.error && Array.isArray(res.data)) {
          st.rows = res.data
            .map(function (r) {
              return {
                id: r.id,
                name: r.name || '',
                weight: Number(r.weight) || 0,
                display_order: Number(r.display_order) || 0,
              };
            })
            .sort(function (a, b) {
              return a.display_order - b.display_order;
            });
          _cmMirrorCategoriesToCache(cid);
          renderClassManager();
        }
      })
      .catch(function () {
        st.loading = null;
        st.loaded = true;
      });
  }

  function _cmCatSum(cid) {
    var rows = _cmCatState(cid).rows;
    var s = 0;
    for (var i = 0; i < rows.length; i++) s += Number(rows[i].weight) || 0;
    return s;
  }

  // Weights must total exactly 100, as in Teams (a class with no categories
  // counts all work by total points). Edits stay on this screen until Save
  // sends the whole list at once: going from 50/50 to 60/40 one row at a time
  // would pass through 110 or 90, which the server refuses.
  function _cmCatSumOk(cid) {
    var rows = _cmCatState(cid).rows;
    return rows.length === 0 || Math.abs(_cmCatSum(cid) - 100) < 1e-9;
  }

  function _cmCatNamesOk(cid) {
    return _cmCatState(cid).rows.every(function (r) {
      return (r.name || '').trim() !== '';
    });
  }

  function _cmCatCanSave(cid) {
    return !!_cmCatState(cid).dirty && _cmCatSumOk(cid) && _cmCatNamesOk(cid);
  }

  function _cmCatSumClass(cid) {
    return _cmCatSumOk(cid) ? 'cm-cat-sum' : 'cm-cat-sum cm-cat-sum-over';
  }

  function _cmCatSumHtml(cid) {
    var html = 'Total: <strong>' + _cmCatSum(cid) + '</strong> / 100%';
    if (!_cmCatSumOk(cid)) html += ' <span class="cm-cat-sum-warn">(weights must total 100)</span>';
    else if (!_cmCatNamesOk(cid)) html += ' <span class="cm-cat-sum-warn">(every category needs a name)</span>';
    return html;
  }

  // Update the total and the Save button without re-rendering, so typing
  // keeps focus.
  function _cmCatRefreshFooter(cid) {
    var sumEl = document.getElementById('cm-cat-sum-' + cid);
    if (sumEl) {
      sumEl.className = _cmCatSumClass(cid);
      sumEl.innerHTML = _cmCatSumHtml(cid);
    }
    var saveEl = document.getElementById('cm-cat-save-' + cid);
    if (saveEl) saveEl.disabled = !_cmCatCanSave(cid);
  }

  function _cmRenderCategoriesField(cid) {
    if (!cid) return '';
    var st = _cmCatState(cid);
    if (!st.loaded && !st.loading)
      setTimeout(function () {
        _cmLoadCategories(cid);
      }, 0);

    var rows = st.rows || [];
    var html =
      '<div class="cm-field cm-cat-field">' +
      '<label class="cm-label">Categories</label>' +
      '<div class="cm-cat-list">';
    if (rows.length === 0) {
      html +=
        '<div class="cm-hint" style="padding:6px 0">No categories yet. Letter grades use total points earned out of total points possible. Add categories to weight groups of assessments.</div>';
    }
    rows.forEach(function (row, idx) {
      if (st.moving && st.moving.idx === idx) {
        html += _cmRenderCatMove(cid, row, idx);
        return;
      }
      html +=
        '<div class="cm-cat-row"' +
        (row.id ? ' draggable="true" data-cat-drag="' + row.id + '"' : '') +
        '>' +
        '<span class="cm-cat-handle" aria-hidden="true">\u22EE\u22EE</span>' +
        '<input class="cm-input cm-cat-name" value="' +
        esc(row.name) +
        '" placeholder="Category name" data-action-input="cmCatNameLive" data-idx="' +
        idx +
        '">' +
        '<input class="cm-input cm-cat-weight" type="number" min="0" max="100" step="1" value="' +
        (row.weight != null ? row.weight : '') +
        '" data-action-input="cmCatWeightLive" data-idx="' +
        idx +
        '" aria-label="Weight percent">' +
        '<span class="cm-cat-pct">%</span>' +
        '<button class="cm-delete-mini" data-action="cmCatDelete" data-idx="' +
        idx +
        '" title="Delete category" aria-label="Delete category">\u2715</button>' +
        '</div>';
    });
    html +=
      '</div>' +
      _cmRenderUncategorized(cid) +
      '<div class="cm-cat-footer">' +
      '<button class="cm-add-link" data-action="cmCatAdd">+ Add category</button>' +
      '<button class="cm-add-link" data-action="cmCatCopyFrom">Copy from another class</button>' +
      '<div class="' +
      _cmCatSumClass(cid) +
      '" id="cm-cat-sum-' +
      cid +
      '">' +
      _cmCatSumHtml(cid) +
      '</div>' +
      '<button class="btn btn-primary cm-cat-save" id="cm-cat-save-' +
      cid +
      '" data-action="cmCatSave"' +
      (_cmCatCanSave(cid) ? '' : ' disabled') +
      '>Save categories</button>' +
      '</div>' +
      '</div>';
    return html;
  }

  function cmCatAdd() {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    st.rows.push({ id: null, name: '', weight: 0, display_order: st.rows.length });
    st.dirty = true;
    renderClassManager();
  }

  function cmCatNameLive(idx, value) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    row.name = value || '';
    st.dirty = true;
    _cmCatRefreshFooter(cmSelectedCourse);
  }

  function cmCatWeightLive(idx, value) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    var v = parseFloat(value);
    row.weight = isNaN(v) ? 0 : Math.max(0, v);
    st.dirty = true;
    _cmCatRefreshFooter(cmSelectedCourse);
  }

  function _cmAssessmentCategoryId(a) {
    return (a && (a.categoryId || a.category_id)) || '';
  }

  function _cmAssessmentsInCategory(cid, categoryId) {
    return getAssessments(cid).filter(function (a) {
      return _cmAssessmentCategoryId(a) === categoryId;
    });
  }

  // Assessments that count toward no letter grade: no category, or one that
  // no longer exists, in a class that has categories.
  function _cmUncategorizedAssessments(cid) {
    var ids = _cmCatState(cid)
      .rows.filter(function (r) {
        return r.id;
      })
      .map(function (r) {
        return r.id;
      });
    if (ids.length === 0) return [];
    return getAssessments(cid).filter(function (a) {
      return ids.indexOf(_cmAssessmentCategoryId(a)) < 0;
    });
  }

  function _cmCategoryOptions(cid, exceptId) {
    return _cmCatState(cid)
      .rows.filter(function (r) {
        return r.id && r.id !== exceptId;
      })
      .map(function (r) {
        return '<option value="' + r.id + '">' + esc(r.name || 'Unnamed') + '</option>';
      })
      .join('');
  }

  function _cmRenderCatMove(cid, row, idx) {
    var n = _cmAssessmentsInCategory(cid, row.id).length;
    return (
      '<div class="cm-cat-row cm-cat-move">' +
      '<span class="cm-hint">Move ' +
      n +
      (n === 1 ? ' assessment' : ' assessments') +
      ' in ' +
      esc(row.name || 'this category') +
      ' to</span>' +
      '<select class="cm-input" id="cm-cat-move-target" aria-label="Move to category">' +
      _cmCategoryOptions(cid, row.id) +
      '</select>' +
      '<button class="btn btn-ghost" data-action="cmCatMoveCancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="cmCatMoveDelete" data-idx="' +
      idx +
      '">Move and delete</button>' +
      '</div>'
    );
  }

  function _cmRenderUncategorized(cid) {
    var n = _cmUncategorizedAssessments(cid).length;
    if (n === 0) return '';
    return (
      '<div class="cm-cat-row cm-cat-move">' +
      '<span class="cm-hint">' +
      n +
      (n === 1 ? ' assessment has' : ' assessments have') +
      ' no category, so ' +
      (n === 1 ? 'it doesn\u2019t' : 'they don\u2019t') +
      ' count toward the letter grade. Move to</span>' +
      '<select class="cm-input" id="cm-cat-uncat-target" aria-label="Move to category">' +
      _cmCategoryOptions(cid, null) +
      '</select>' +
      '<button class="btn btn-primary" data-action="cmCatAssignUncategorized">Move</button>' +
      '</div>'
    );
  }

  // Give assessments a category and wait until the server has the change.
  function _cmMoveAssessments(cid, moving, categoryId) {
    var ids = moving.map(function (a) {
      return a.id;
    });
    var arr = getAssessments(cid).map(function (a) {
      if (ids.indexOf(a.id) < 0) return a;
      return Object.assign({}, a, { categoryId: categoryId, category_id: categoryId });
    });
    saveAssessments(cid, arr);
    if (typeof clearProfCache === 'function') clearProfCache();
    var pending = typeof _assessmentSaveQueue !== 'undefined' && _assessmentSaveQueue[cid];
    return Promise.resolve(pending);
  }

  // The row leaves the list; Save deletes it on the server.
  function _cmDeleteCategoryRow(cid, row) {
    var st = _cmCatState(cid);
    var i = st.rows.indexOf(row);
    if (i >= 0) st.rows.splice(i, 1);
    st.dirty = true;
    renderClassManager();
  }

  // A category whose work would be left with no category is moved first, as
  // Schoology requires. The last category can go: with none, the letter grade
  // counts all work by total points.
  function cmCatDelete(idx) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var st = _cmCatState(cid);
    var row = st.rows[idx];
    if (!row) return;
    var inUse = row.id ? _cmAssessmentsInCategory(cid, row.id).length : 0;
    var others = st.rows.filter(function (r) {
      return r !== row && r.id;
    });
    if (inUse > 0 && others.length > 0) {
      st.moving = { idx: idx };
      renderClassManager();
      return;
    }
    _cmDeleteCategoryRow(cid, row);
  }

  function cmCatMoveCancel() {
    if (!cmSelectedCourse) return;
    _cmCatState(cmSelectedCourse).moving = null;
    renderClassManager();
  }

  function cmCatMoveDelete(idx) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var st = _cmCatState(cid);
    var row = st.rows[idx];
    var target = (document.getElementById('cm-cat-move-target') || {}).value;
    st.moving = null;
    if (!row || !target) {
      renderClassManager();
      return;
    }
    _cmMoveAssessments(cid, _cmAssessmentsInCategory(cid, row.id), target);
    _cmDeleteCategoryRow(cid, row);
  }

  function cmCatAssignUncategorized() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var target = (document.getElementById('cm-cat-uncat-target') || {}).value;
    if (!target) return;
    _cmMoveAssessments(cid, _cmUncategorizedAssessments(cid), target);
    renderClassManager();
  }

  // Send the whole list in one call. Work moved out of a deleted category
  // must reach the server first, or the delete is refused.
  function cmCatSave() {
    if (!cmSelectedCourse) return Promise.resolve();
    var cid = cmSelectedCourse;
    var st = _cmCatState(cid);
    if (!_cmCatCanSave(cid)) {
      if (typeof showSyncToast === 'function' && !_cmCatSumOk(cid))
        showSyncToast('Category weights must total 100% to save.', 'info');
      return Promise.resolve();
    }
    var rows = st.rows.slice();
    rows.forEach(function (r, i) {
      r.name = (r.name || '').trim();
      r.display_order = i;
    });
    var pending = typeof _assessmentSaveQueue !== 'undefined' && _assessmentSaveQueue[cid];
    return Promise.resolve(pending)
      .then(function () {
        return window.v2.saveCategories(cid, rows);
      })
      .then(function (res) {
        if (res && res.error) {
          if (typeof showSyncToast === 'function')
            showSyncToast('Categories not saved: ' + (res.error.message || 'server error'), 'error');
          return;
        }
        var ids = (res && Array.isArray(res.data) && res.data) || [];
        rows.forEach(function (r, i) {
          // Without a server (Demo Mode) a new row keeps a local id.
          r.id = ids[i] || r.id || uid();
        });
        st.dirty = false;
        _cmMirrorCategoriesToCache(cid);
        renderClassManager();
      });
  }

  // Grading setup copied to or from another class (teacher/grading-setup-copy.js).
  // Unsaved category or term edits would be lost under the copy, so they
  // are saved or undone first.
  function cmOpenSetupCopy(opts) {
    if (!cmSelectedCourse || !window.GradingSetupCopy) return;
    var cid = cmSelectedCourse;
    if (_cmCatState(cid).dirty || (_cmTermState[cid] && _cmTermState[cid].dirty)) {
      if (typeof showSyncToast === 'function')
        showSyncToast('Save or undo your changes to categories and terms first.', 'info');
      return;
    }
    window.GradingSetupCopy.openDialog(
      cid,
      Object.assign({}, opts, {
        onDone: function (cids) {
          (cids || []).forEach(function (c) {
            delete _cmCategoryState[c];
            delete _cmTermState[c];
          });
          renderClassManager();
        },
      }),
    );
  }

  // Drag-reorder using delegated document listeners. Drop on another row → move.
  var _cmCatDragId = null;
  function _initCmCatDrag() {
    _addDocListener('dragstart', function (e) {
      var row = e.target.closest && e.target.closest('.cm-cat-row[data-cat-drag]');
      if (!row) return;
      _cmCatDragId = row.dataset.catDrag;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    _addDocListener('dragover', function (e) {
      if (!_cmCatDragId) return;
      var row = e.target.closest && e.target.closest('.cm-cat-row[data-cat-drag]');
      if (row && row.dataset.catDrag !== _cmCatDragId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    _addDocListener('drop', function (e) {
      if (!_cmCatDragId || !cmSelectedCourse) return;
      var row = e.target.closest && e.target.closest('.cm-cat-row[data-cat-drag]');
      if (!row) return;
      e.preventDefault();
      var st = _cmCatState(cmSelectedCourse);
      var fromIdx = st.rows.findIndex(function (r) {
        return r.id === _cmCatDragId;
      });
      var toIdx = st.rows.findIndex(function (r) {
        return r.id === row.dataset.catDrag;
      });
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
        _cmCatDragId = null;
        return;
      }
      var moved = st.rows.splice(fromIdx, 1)[0];
      st.rows.splice(toIdx, 0, moved);
      st.rows.forEach(function (r, i) {
        r.display_order = i;
      });
      _cmCatDragId = null;
      renderClassManager();
      if (window.v2 && window.v2.reorderCategories) {
        var ids = st.rows
          .map(function (r) {
            return r.id;
          })
          .filter(Boolean);
        window.v2.reorderCategories(ids);
      }
    });
    _addDocListener('dragend', function () {
      document.querySelectorAll('.cm-cat-row.dragging').forEach(function (el) {
        el.classList.remove('dragging');
      });
      _cmCatDragId = null;
    });
  }

  function cmSetGradingSystem(val) {
    if (!cmSelectedCourse) return;
    updateCourse(cmSelectedCourse, { gradingSystem: val });
    renderClassManager();
  }

  // D6: the course % as a whole number or to one decimal. The letter always
  // comes from the % shown.
  function _cmRenderRoundPercentField(cid) {
    var whole = getRoundWholePercent(cid);
    return (
      '<div class="cm-field">' +
      '<label class="cm-label">Course %</label>' +
      '<div class="seg cm-seg" role="radiogroup" aria-label="Course percentage">' +
      '<button class="seg-btn cm-seg-btn' +
      (whole ? ' active' : '') +
      '" role="radio" aria-checked="' +
      whole +
      '" data-action="cmSetRoundPercent" data-value="whole">Whole number (86%)</button>' +
      '<button class="seg-btn cm-seg-btn' +
      (whole ? '' : ' active') +
      '" role="radio" aria-checked="' +
      !whole +
      '" data-action="cmSetRoundPercent" data-value="decimal">One decimal (85.9%)</button>' +
      '</div>' +
      '<div class="cm-hint" style="margin-top:6px">BC report cards show a whole %. Grades 10\u201312 start with whole numbers.</div>' +
      '</div>'
    );
  }

  function cmSetRoundPercent(val) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.roundPercent = val === 'whole';
    saveCourseConfig(cmSelectedCourse, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
    renderClassManager();
  }

  /* ── Sentence starters ───────────────────────────────────────
     The class's bank for the capture strip's "/" menu and the phone's quick
     menu (docs/DECISIONS.md, "Observations (2026-10-18)"). A starter has
     text, an optional type and context, and tags. One row is edited at a
     time; the edit lives here until Save. */
  var _cmStarterEdit = null; // { cid, id ('new' or the starter's id), text, sentiment, context, dims }
  var _cmStarterError = '';
  var _cmStarterFocus = null; // selector to focus after the next render

  function _cmStarterSameId(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (typeof resolveObservationTemplateId !== 'function') return false;
    return resolveObservationTemplateId(cmSelectedCourse, a) === resolveObservationTemplateId(cmSelectedCourse, b);
  }

  function _cmStarterPillsHtml(t) {
    var h = '';
    var s = t.sentiment && OBS_SENTIMENTS[t.sentiment];
    if (s) h += '<span class="obs-pill obs-pill-type" data-sentiment="' + t.sentiment + '">' + esc(s.label) + '</span>';
    var c = t.context && OBS_CONTEXTS[t.context];
    if (c) h += '<span class="obs-pill obs-pill-context">' + esc(c.label) + '</span>';
    (t.dims || []).forEach(function (k) {
      var label = typeof resolveTag === 'function' ? resolveTag(k).label : k;
      var color = typeof obsTagColor === 'function' ? obsTagColor(k) : 'var(--text-3)';
      h +=
        '<span class="obs-card-dim"><span class="dim-dot" style="background:' +
        color +
        '"></span>' +
        esc(label) +
        '</span>';
    });
    return h ? '<div class="cm-starter-pills">' + h + '</div>' : '';
  }

  function _cmStarterEditorHtml(cid) {
    var ed = _cmStarterEdit;
    var isNew = ed.id === 'new';
    var h =
      '<div class="cm-starter-editor" id="cm-starter-editor">' +
      '<label class="cm-starter-editor-label" for="cm-starter-text">' +
      (isNew ? 'New starter' : 'Edit starter') +
      '</label>' +
      '<input class="cm-input" id="cm-starter-text" data-action-input="cmStarterText" value="' +
      esc(ed.text) +
      '" placeholder="e.g. Explained their thinking to a partner" autocomplete="off">' +
      '<div class="cm-starter-editor-row">' +
      '<select class="cm-input cm-starter-select" data-action-change="cmStarterType" aria-label="Type">' +
      '<option value="">No type</option>';
    Object.keys(OBS_SENTIMENTS).forEach(function (k) {
      h +=
        '<option value="' +
        k +
        '"' +
        (ed.sentiment === k ? ' selected' : '') +
        '>' +
        esc(OBS_SENTIMENTS[k].label) +
        '</option>';
    });
    h +=
      '</select>' +
      '<select class="cm-input cm-starter-select" data-action-change="cmStarterContext" aria-label="Context">' +
      '<option value="">No context</option>';
    Object.keys(OBS_CONTEXTS).forEach(function (k) {
      h +=
        '<option value="' +
        k +
        '"' +
        (ed.context === k ? ' selected' : '') +
        '>' +
        esc(OBS_CONTEXTS[k].label) +
        '</option>';
    });
    h += '</select></div>';
    var items = typeof ObsCapture !== 'undefined' ? ObsCapture.tagMenuItems(cid) : [];
    if (items.length) {
      h += '<div class="cm-starter-tags" role="group" aria-label="Tags">';
      items.forEach(function (it) {
        if (it.type === 'section') {
          h += '<div class="cm-starter-tags-head">' + esc(it.label) + '</div>';
          return;
        }
        var on = ed.dims.indexOf(it.key) >= 0;
        h +=
          '<button type="button" class="cm-starter-tag' +
          (on ? ' is-on' : '') +
          '" data-action="cmStarterTag" data-value="' +
          esc(it.key) +
          '" aria-pressed="' +
          on +
          '"><span class="dim-dot" style="background:' +
          it.color +
          '"></span>' +
          esc(it.label) +
          '</button>';
      });
      h += '</div>';
    }
    h +=
      '<div class="cm-starter-editor-actions">' +
      '<button class="btn btn-primary" data-action="cmStarterSave" id="cm-starter-save"' +
      (ed.text.trim() ? '' : ' disabled') +
      '>' +
      (isNew ? 'Add starter' : 'Save') +
      '</button>' +
      '<button class="btn btn-ghost" data-action="cmStarterCancel">Cancel</button>' +
      '</div></div>';
    return h;
  }

  function _cmStarterRowHtml(t, idx, count) {
    return (
      '<div class="cm-starter-row" data-tplid="' +
      esc(t.id) +
      '">' +
      '<div class="cm-starter-main"><div class="cm-starter-text">' +
      esc(t.text) +
      '</div>' +
      _cmStarterPillsHtml(t) +
      '</div>' +
      '<div class="cm-starter-actions">' +
      '<button class="cm-starter-btn" data-action="cmStarterMove" data-tplid="' +
      esc(t.id) +
      '" data-dir="-1" aria-label="Move up" title="Move up"' +
      (idx === 0 ? ' disabled' : '') +
      '>↑</button>' +
      '<button class="cm-starter-btn" data-action="cmStarterMove" data-tplid="' +
      esc(t.id) +
      '" data-dir="1" aria-label="Move down" title="Move down"' +
      (idx === count - 1 ? ' disabled' : '') +
      '>↓</button>' +
      '<button class="cm-starter-btn cm-starter-edit" data-action="cmStarterEdit" data-tplid="' +
      esc(t.id) +
      '">Edit</button>' +
      '<button class="cm-delete-mini" data-action="cmStarterDelete" data-tplid="' +
      esc(t.id) +
      '" aria-label="Delete starter" title="Delete starter">✕</button>' +
      '</div></div>'
    );
  }

  function _cmRenderStarters(cid) {
    var list = typeof getObservationTemplates === 'function' ? getObservationTemplates(cid) : [];
    var editing = _cmStarterEdit && _cmStarterEdit.cid === cid ? _cmStarterEdit : null;
    var html =
      '<div class="cm-section" id="cm-starters">' +
      '<div class="cm-section-title">Sentence starters' +
      (list.length ? ' <span class="cm-section-count">(' + list.length + ')</span>' : '') +
      '</div>';
    if (!list.length) {
      html +=
        '<div class="cm-hint cm-starter-intro">No sentence starters yet. A starter fills the observation box: type / in any observation box, or tap a student on the phone. Here are six to begin with.</div>' +
        '<div class="cm-starter-list cm-starter-suggestions">';
      (typeof OBS_STARTER_SUGGESTIONS !== 'undefined' ? OBS_STARTER_SUGGESTIONS : []).forEach(function (t) {
        html +=
          '<div class="cm-starter-row is-suggestion"><div class="cm-starter-main"><div class="cm-starter-text">' +
          esc(t.text) +
          '</div>' +
          _cmStarterPillsHtml(t) +
          '</div></div>';
      });
      html +=
        '</div>' +
        '<div class="cm-starter-empty-actions">' +
        '<button class="btn btn-primary" data-action="cmStarterAddSuggested">Add these to this class</button>' +
        (editing ? '' : '<button class="cm-add-link" data-action="cmStarterAdd">+ Write your own</button>') +
        '</div>';
    } else {
      html +=
        '<div class="cm-hint cm-starter-intro">Type / in any observation box to use one. On the phone, tap a student.</div>' +
        '<div class="cm-starter-list">';
      list.forEach(function (t, idx) {
        if (editing && _cmStarterSameId(editing.id, t.id)) html += _cmStarterEditorHtml(cid);
        else html += _cmStarterRowHtml(t, idx, list.length);
      });
      html += '</div>';
      if (!editing || editing.id !== 'new') {
        html += '<button class="cm-add-link" data-action="cmStarterAdd">+ Add starter</button>';
      }
    }
    if (editing && editing.id === 'new') html += _cmStarterEditorHtml(cid);
    if (_cmStarterError) html += '<div class="cm-starter-error" role="alert">' + esc(_cmStarterError) + '</div>';
    html += '</div>';
    return html;
  }

  function _cmStarterRender(focusSel) {
    _cmStarterFocus = focusSel || null;
    renderClassManager();
  }

  function _cmStarterSaved(ok) {
    _cmStarterError = ok === false || ok === null ? 'Couldn’t save on this device. Its storage is full.' : '';
  }

  function cmStarterAdd() {
    if (!cmSelectedCourse) return;
    _cmStarterError = '';
    _cmStarterEdit = { cid: cmSelectedCourse, id: 'new', text: '', sentiment: null, context: null, dims: [] };
    _cmStarterRender('#cm-starter-text');
  }

  function cmStarterEdit(id) {
    var cid = cmSelectedCourse;
    var t = getObservationTemplates(cid).find(function (x) {
      return _cmStarterSameId(x.id, id);
    });
    if (!t) return;
    _cmStarterError = '';
    _cmStarterEdit = {
      cid: cid,
      id: t.id,
      text: t.text,
      sentiment: t.sentiment || null,
      context: t.context || null,
      dims: (t.dims || []).slice(),
    };
    _cmStarterRender('#cm-starter-text');
  }

  function cmStarterCancel() {
    var id = _cmStarterEdit && _cmStarterEdit.id;
    _cmStarterEdit = null;
    _cmStarterError = '';
    _cmStarterRender(
      id && id !== 'new' ? '[data-action="cmStarterEdit"][data-tplid="' + id + '"]' : '[data-action="cmStarterAdd"]',
    );
  }

  function cmStarterSave() {
    var ed = _cmStarterEdit;
    if (!ed || !ed.text.trim()) return;
    var row = { text: ed.text.trim(), sentiment: ed.sentiment, context: ed.context, dims: ed.dims.slice() };
    var focusId;
    if (ed.id === 'new') {
      var added = addObservationTemplate(ed.cid, row);
      _cmStarterSaved(added);
      focusId = added && added.id;
    } else {
      _cmStarterSaved(updateObservationTemplate(ed.cid, ed.id, row));
      focusId = ed.id;
    }
    _cmStarterEdit = null;
    _cmStarterRender(focusId ? '[data-action="cmStarterEdit"][data-tplid="' + focusId + '"]' : null);
  }

  function cmStarterDelete(id) {
    var cid = cmSelectedCourse;
    var t = getObservationTemplates(cid).find(function (x) {
      return _cmStarterSameId(x.id, id);
    });
    if (!t) return;
    showConfirm(
      'Delete starter',
      'Delete “' + t.text + '”? Observations already written with it stay as they are.',
      'Delete',
      'danger',
      function () {
        _cmStarterSaved(removeObservationTemplate(cid, t.id));
        if (_cmStarterEdit && _cmStarterSameId(_cmStarterEdit.id, t.id)) _cmStarterEdit = null;
        _cmStarterRender('[data-action="cmStarterAdd"]');
      },
    );
  }

  function cmStarterMove(id, dir) {
    var cid = cmSelectedCourse;
    _cmStarterSaved(moveObservationTemplate(cid, id, dir));
    var cur = typeof resolveObservationTemplateId === 'function' ? resolveObservationTemplateId(cid, id) : id;
    var list = getObservationTemplates(cid);
    var idx = list.findIndex(function (x) {
      return _cmStarterSameId(x.id, cur);
    });
    // Keep focus on the arrow that moved it, or on the other one at an end.
    var atEnd = dir < 0 ? idx === 0 : idx === list.length - 1;
    var row = '[data-action="cmStarterMove"][data-tplid="' + (idx >= 0 ? list[idx].id : cur) + '"]';
    _cmStarterRender(row + '[data-dir="' + (atEnd ? -dir : dir) + '"]');
  }

  function cmStarterAddSuggested() {
    var cid = cmSelectedCourse;
    if (!cid || typeof OBS_STARTER_SUGGESTIONS === 'undefined') return;
    _cmStarterSaved(addObservationTemplates(cid, structuredClone(OBS_STARTER_SUGGESTIONS)));
    _cmStarterRender('[data-action="cmStarterAdd"]');
  }

  function cmStarterTag(key) {
    if (!_cmStarterEdit) return;
    var i = _cmStarterEdit.dims.indexOf(key);
    if (i >= 0) _cmStarterEdit.dims.splice(i, 1);
    else _cmStarterEdit.dims.push(key);
    var sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key;
    _cmStarterRender('[data-action="cmStarterTag"][data-value="' + sel + '"]');
  }

  function cmStarterText(val) {
    if (!_cmStarterEdit) return;
    _cmStarterEdit.text = val;
    var btn = document.getElementById('cm-starter-save');
    if (btn) btn.disabled = !val.trim();
  }

  function _cmStarterAfterRender() {
    if (!_cmStarterFocus) return;
    var sel = _cmStarterFocus;
    _cmStarterFocus = null;
    var el = document.querySelector(sel);
    if (!el || el.disabled) el = document.querySelector('[data-action="cmStarterAdd"]');
    if (el && typeof el.focus === 'function') el.focus();
  }

  /* "Edit starters…" in the capture strip lands here. */
  function openStarters(cid) {
    classManagerOpen = true;
    cmMode = 'edit';
    cmSelectedCourse = cid && COURSES[cid] ? cid : _activeCourse;
    renderClassManager();
    var sec = document.getElementById('cm-starters');
    if (sec && typeof sec.scrollIntoView === 'function') sec.scrollIntoView({ block: 'start' });
    var first =
      sec &&
      sec.querySelector(
        '[data-action="cmStarterEdit"], [data-action="cmStarterAddSuggested"], [data-action="cmStarterAdd"]',
      );
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
  }

  /* ── Reporting terms ─────────────────────────────────────────
     Up to six dated terms per class (docs/DECISIONS.md, "Reporting
     periods"). Edited like categories: rows change live, Save sends the
     whole list through saveReportingTerms, which numbers them by start
     date. */
  var _cmTermState = {}; // cid → { rows: [{ordinal?, label, starts_on, ends_on}], span, dirty }

  function _cmTermRows(cid) {
    if (!_cmTermState[cid]) {
      var saved = getReportingTerms(cid);
      _cmTermState[cid] = {
        rows: saved.map(function (t) {
          return { ordinal: t.ordinal, label: t.label, starts_on: t.starts_on, ends_on: t.ends_on };
        }),
        span: 'full',
        dirty: false,
      };
      var template = _cmTermTemplate(cid, _cmTermState[cid].rows);
      if (template) _cmTermState[cid].span = termSpanOf(saved, semesterTwoStart(template));
    }
    return _cmTermState[cid];
  }

  // The school year a class is in: September of this year from August on,
  // else September of last year.
  function _cmSchoolYearStart(cid) {
    var today = typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
    var y = parseInt(today.slice(0, 4), 10);
    var m = parseInt(today.slice(5, 7), 10);
    return m >= 8 ? y : y - 1;
  }

  var _CM_TERM_PRESETS = {
    quarters: [
      ['Term 1', '09-01', '11-15', 0, 0],
      ['Term 2', '11-16', '01-31', 0, 1],
      ['Term 3', '02-01', '04-15', 1, 1],
      ['Term 4', '04-16', '06-30', 1, 1],
    ],
    trimesters: [
      ['Term 1', '09-01', '11-30', 0, 0],
      ['Term 2', '12-01', '03-15', 0, 1],
      ['Term 3', '03-16', '06-30', 1, 1],
    ],
    semesters: [
      ['Term 1', '09-01', '01-31', 0, 1],
      ['Term 2', '02-01', '06-30', 1, 1],
    ],
  };

  function _cmTermPresetRows(cid, name) {
    var y = _cmSchoolYearStart(cid);
    return (_CM_TERM_PRESETS[name] || []).map(function (p, i) {
      return { ordinal: i + 1, label: p[0], starts_on: y + p[3] + '-' + p[1], ends_on: y + p[4] + '-' + p[2] };
    });
  }

  /* The whole-year terms the class's rows were cut from: a Surrey school's
     preset or a generic one, matched term by term on number and dates. Null
     for typed terms. Lets "This class runs" go back to Full year. */
  function _cmTermTemplate(cid, rows) {
    if (!rows.length) return null;
    var match = typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(rows) : null;
    if (match) {
      return match.school.terms.map(function (t, i) {
        return { ordinal: i + 1, label: t.label, starts_on: t.starts_on, ends_on: t.ends_on };
      });
    }
    var names = Object.keys(_CM_TERM_PRESETS);
    for (var k = 0; k < names.length; k++) {
      var full = _cmTermPresetRows(cid, names[k]);
      var fits = rows.every(function (r) {
        var t = full[Number(r.ordinal) - 1];
        return !!t && t.starts_on === r.starts_on && t.ends_on === r.ends_on;
      });
      if (fits) return full;
    }
    return null;
  }

  function _cmTermError(cid) {
    return reportingTermsError(normalizeTermOrdinals(_cmTermRows(cid).rows));
  }

  function _cmTermCanSave(cid) {
    return !!_cmTermRows(cid).dirty && !_cmTermError(cid);
  }

  function _cmTermFooterHtml(cid) {
    var err = _cmTermError(cid);
    if (err) return '<span class="cm-cat-sum cm-cat-sum-over">' + esc(err) + '</span>';
    var ords = normalizeTermOrdinals(_cmTermRows(cid).rows).map(function (t) {
      return t.ordinal;
    });
    if (ords.length === 0) return '<span class="cm-cat-sum">No terms: every page shows the whole year.</span>';
    var first = ords[0],
      last = ords[ords.length - 1];
    var contiguous = last - first === ords.length - 1;
    var nums = ords.length === 1 ? String(first) : contiguous ? first + '–' + last : ords.join(', ');
    return (
      '<span class="cm-cat-sum">Report ' +
      nums +
      ' on the Reports page ' +
      (ords.length === 1 ? 'matches' : 'match') +
      ' these terms.</span>'
    );
  }

  function _cmTermRefreshFooter(cid) {
    var foot = document.getElementById('cm-term-foot-' + cid);
    if (foot) foot.innerHTML = _cmTermFooterHtml(cid);
    var saveEl = document.getElementById('cm-term-save-' + cid);
    if (saveEl) saveEl.disabled = !_cmTermCanSave(cid);
  }

  // The Surrey secondary school whose published dates fill the rows
  // (shared/reporting-term-presets.js). Grandview Heights unless changed.
  var _cmTermSchool = null;

  function _cmTermSchoolId() {
    return (
      _cmTermSchool || (typeof REPORTING_TERM_PRESETS !== 'undefined' ? REPORTING_TERM_PRESETS.defaultSchool : null)
    );
  }

  function _cmRenderSchoolPreset(cid, hasRows) {
    if (typeof reportingTermSchools !== 'function') return '';
    var schools = reportingTermSchools();
    if (!schools.length) return '';
    var chosen = _cmTermSchoolId();
    var available = typeof reportingTermPreset === 'function' && !!reportingTermPreset(chosen, courseToday(cid));
    var school = schools.find(function (s) {
      return s.id === chosen;
    });
    var html = '<div class="cm-term-school">';
    html +=
      '<select class="cm-input cm-term-school-select" data-action-change="cmTermSchool" aria-label="Surrey secondary school">' +
      schools
        .map(function (s) {
          return (
            '<option value="' + esc(s.id) + '"' + (s.id === chosen ? ' selected' : '') + '>' + esc(s.name) + '</option>'
          );
        })
        .join('') +
      '</select>';
    if (available) {
      html +=
        '<button class="btn btn-primary cm-term-school-btn" data-action="cmTermSchoolPreset">' +
        (hasRows ? 'Replace with this school’s dates' : 'Use this school’s dates') +
        '</button>';
    }
    html += '</div>';
    if (!available) {
      html +=
        '<div class="cm-hint">School dates are loaded for ' +
        esc(REPORTING_TERM_PRESETS.schoolYear) +
        ' only. Use a generic preset or type the dates.</div>';
    } else if (school && school.assumed) {
      html +=
        '<div class="cm-hint">' +
        esc(school.name) +
        ' has not published its semester turnaround, so Semester 2 starts Feb 1. Adjust if yours differs.</div>';
    }
    return html;
  }

  function _cmRenderReportingTermsField(cid) {
    if (!cid) return '';
    var st = _cmTermRows(cid);
    var rows = st.rows;
    var html =
      '<div class="cm-field cm-cat-field">' +
      '<label class="cm-label">Reporting terms</label>' +
      '<div class="cm-hint" style="margin-bottom:8px">The gradebook, dashboard and student pages can show one term at a time. A term counts the assessments dated inside it. Up to six. Surrey secondary dates come from each school’s published calendar; a term ends on the day its report is published.</div>';
    html += _cmRenderTermSpan(cid);
    html += _cmRenderSchoolPreset(cid, rows.length > 0);
    if (rows.length === 0) {
      html +=
        '<div class="cm-term-presets">' +
        '<button class="cm-add-link" data-action="cmTermPreset" data-value="quarters">Quarters (4)</button>' +
        '<button class="cm-add-link" data-action="cmTermPreset" data-value="trimesters">Trimesters (3)</button>' +
        '<button class="cm-add-link" data-action="cmTermPreset" data-value="semesters">Semesters (2)</button>' +
        '<button class="cm-add-link" data-action="cmTermAdd">Custom</button>' +
        '</div>';
    }
    html += '<div class="cm-cat-list">';
    rows.forEach(function (row, idx) {
      html +=
        '<div class="cm-cat-row cm-term-row">' +
        '<input class="cm-input cm-term-label" value="' +
        esc(row.label) +
        '" placeholder="Term name" data-action-input="cmTermLive" data-field="label" data-idx="' +
        idx +
        '" aria-label="Term name">' +
        '<input class="cm-input cm-term-date" type="date" value="' +
        esc(row.starts_on) +
        '" data-action-input="cmTermLive" data-field="starts_on" data-idx="' +
        idx +
        '" aria-label="Start date">' +
        '<span class="cm-cat-pct">to</span>' +
        '<input class="cm-input cm-term-date" type="date" value="' +
        esc(row.ends_on) +
        '" data-action-input="cmTermLive" data-field="ends_on" data-idx="' +
        idx +
        '" aria-label="End date">' +
        '<button class="cm-delete-mini" data-action="cmTermDelete" data-idx="' +
        idx +
        '" title="Remove term" aria-label="Remove term">✕</button>' +
        '</div>';
    });
    html += '</div>';
    html +=
      '<div class="cm-cat-footer">' +
      (rows.length > 0 && rows.length < REPORTING_TERMS_MAX
        ? '<button class="cm-add-link" data-action="cmTermAdd">+ Add term</button>'
        : '<span></span>') +
      '<div id="cm-term-foot-' +
      cid +
      '">' +
      _cmTermFooterHtml(cid) +
      '</div>' +
      '<button class="btn btn-primary cm-cat-save" id="cm-term-save-' +
      cid +
      '" data-action="cmTermSave"' +
      (_cmTermCanSave(cid) ? '' : ' disabled') +
      '>Save terms</button>' +
      '</div>' +
      '</div>';
    return html;
  }

  /* "This class runs": Full year, Semester 1 or Semester 2. A semester class
     carries only that semester's terms and keeps their school numbers. */
  function _cmRenderTermSpan(cid) {
    var st = _cmTermRows(cid);
    // Typed terms are the class's own; the choice is for preset terms.
    if (st.rows.length > 0 && !_cmTermTemplate(cid, st.rows)) return '';
    var html =
      '<div class="cm-term-span"><span class="cm-term-span-label" id="cm-term-span-label-' +
      cid +
      '">This class runs</span>' +
      '<div class="seg seg-sm cm-seg" role="radiogroup" aria-labelledby="cm-term-span-label-' +
      cid +
      '">' +
      TERM_SPANS.map(function (o) {
        var on = st.span === o.value;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (on ? ' active' : '') +
          '"' +
          segAttr(on, 'radio') +
          ' data-action="cmTermSpan" data-value="' +
          o.value +
          '">' +
          o.label +
          '</button>'
        );
      }).join('') +
      '</div></div>';
    if (st.span !== 'full')
      html +=
        '<div class="cm-hint">A ' +
        (st.span === 's1' ? 'Semester 1' : 'Semester 2') +
        ' class keeps only that semester’s terms, with the school’s numbers' +
        (st.span === 's2' ? ' (Terms 3 and 4 stay Report 3 and 4)' : '') +
        '.</div>';
    return html;
  }

  function cmTermSpan(span) {
    if (!cmSelectedCourse || ['full', 's1', 's2'].indexOf(span) < 0) return;
    var cid = cmSelectedCourse;
    var st = _cmTermRows(cid);
    if (st.span === span) return;
    if (!st.rows.length) {
      // No terms yet: the choice applies when a preset fills them.
      st.span = span;
      renderClassManager();
      return;
    }
    var template = _cmTermTemplate(cid, st.rows);
    if (!template) return;
    var next = termsInSpan(template, span, semesterTwoStart(template));
    if (!next.length) return;
    st.rows = next.map(function (r) {
      return Object.assign({}, r);
    });
    st.span = span;
    st.dirty = true;
    renderClassManager();
  }

  function cmTermPreset(name) {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    var full = _cmTermPresetRows(cmSelectedCourse, name);
    st.rows = termsInSpan(full, st.span, semesterTwoStart(full));
    st.dirty = true;
    renderClassManager();
  }

  function cmTermSchool(id) {
    _cmTermSchool = id || null;
    renderClassManager();
  }

  function cmTermSchoolPreset() {
    if (!cmSelectedCourse || typeof reportingTermPreset !== 'function') return;
    var rows = reportingTermPreset(_cmTermSchoolId(), courseToday(cmSelectedCourse));
    if (!rows) return;
    var st = _cmTermRows(cmSelectedCourse);
    var full = rows.map(function (r) {
      return { ordinal: r.ordinal, label: r.label, starts_on: r.starts_on, ends_on: r.ends_on };
    });
    st.rows = termsInSpan(full, st.span, semesterTwoStart(full));
    st.dirty = true;
    renderClassManager();
  }

  /* A new class starts with the default Surrey secondary school's terms
     for the current school year, when the presets cover it: all four for a
     full-year class, or one semester's two, keeping their numbers. */
  function _cmDefaultReportingTerms(cid, span) {
    if (typeof reportingTermPreset !== 'function') return null;
    var full = reportingTermPreset(null, courseToday(cid));
    if (!full) return null;
    return termsInSpan(full, span || 'full', semesterTwoStart(full));
  }

  function cmTermAdd() {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    if (st.rows.length >= REPORTING_TERMS_MAX) return;
    var last = st.rows[st.rows.length - 1];
    st.rows.push({ label: 'Term ' + (st.rows.length + 1), starts_on: '', ends_on: '' });
    if (last && last.ends_on) {
      // Start the day after the previous term ends.
      var d = new Date(last.ends_on + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      st.rows[st.rows.length - 1].starts_on = d.toISOString().slice(0, 10);
    }
    st.dirty = true;
    renderClassManager();
  }

  function cmTermDelete(idx) {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    st.rows.splice(idx, 1);
    st.dirty = true;
    renderClassManager();
  }

  function cmTermLive(idx, field, value) {
    if (!cmSelectedCourse) return;
    var st = _cmTermRows(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row || ['label', 'starts_on', 'ends_on'].indexOf(field) < 0) return;
    row[field] = value;
    st.dirty = true;
    _cmTermRefreshFooter(cmSelectedCourse);
  }

  function cmTermSave() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var st = _cmTermRows(cid);
    if (!_cmTermCanSave(cid)) return;
    var err = saveReportingTerms(cid, st.rows);
    if (err) {
      if (typeof showSyncToast === 'function') showSyncToast('Terms not saved: ' + err, 'error');
      return;
    }
    delete _cmTermState[cid];
    renderClassManager();
  }

  function cmSetCalcMethod(val) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.calcMethod = val;
    saveCourseConfig(cmSelectedCourse, cc);
    updateCourse(cmSelectedCourse, { calcMethod: val });
    renderClassManager();
  }

  function cmUpdateDecay(val) {
    if (!cmSelectedCourse) return;
    document.getElementById('cm-decay-val').textContent = val + '%';
    var cc = getCourseConfig(cmSelectedCourse);
    cc.decayWeight = parseInt(val, 10) / 100;
    saveCourseConfig(cmSelectedCourse, cc);
    updateCourse(cmSelectedCourse, { decayWeight: parseInt(val, 10) / 100 });
  }

  // T-UI-02 retired: cmToggleReportPct (U16 replaced by grading_system),
  // cmToggleCatWeights + cmUpdateCatWeights (legacy binary summative/formative
  // slider, replaced by T-UI-12 Category management). Deleted 2026-04-21.

  /* ── Re-link Curriculum ─────────────────────────────────── */
  function cmStartRelink(cid) {
    cmRelinkCid = cid;
    cmRelinkStep = 1;
    cwSelectedGrade = null;
    cwSelectedSubject = null;
    var course = COURSES[cid];
    cwSelectedTags = course && course.curriculumTags ? course.curriculumTags.slice() : [];
    cwLoadError = false;
    loadCurriculumIndex().then(function (idx) {
      cwCurriculumLoaded = !!idx;
      cwLoadError = !idx;
      renderClassManager();
    });
    renderClassManager();
  }

  function cmRelinkCancel() {
    cmRelinkCid = null;
    cmRelinkStep = 0;
    cwSelectedTags = [];
    renderClassManager();
  }

  function cmRelinkNext() {
    if (cwSelectedTags.length === 0) return;
    cmRelinkStep = 2;
    renderClassManager();
  }

  function cmRelinkConfirm(mode) {
    if (!cmRelinkCid || cwSelectedTags.length === 0) return;
    var cid = cmRelinkCid;

    if (mode === 'replace') {
      var map = buildLearningMapFromTags(cwSelectedTags);
      if (map) {
        saveLearningMap(cid, map);
        updateCourse(cid, { curriculumTags: cwSelectedTags.slice() });
      }
    } else if (mode === 'merge') {
      var existing = getLearningMap(cid);
      var newMap = buildLearningMapFromTags(cwSelectedTags);
      if (newMap) {
        var existingSubIds = new Set(
          (existing.subjects || []).map(function (s) {
            return s.id;
          }),
        );
        (newMap.subjects || []).forEach(function (s) {
          if (!existingSubIds.has(s.id)) existing.subjects.push(s);
        });
        var existingSecIds = new Set(
          (existing.sections || []).map(function (s) {
            return s.id;
          }),
        );
        (newMap.sections || []).forEach(function (s) {
          if (!existingSecIds.has(s.id)) {
            existing.sections.push(s);
          } else {
            var existingSec = existing.sections.find(function (es) {
              return es.id === s.id;
            });
            var existingTagIds = new Set(
              existingSec.tags.map(function (t) {
                return t.id;
              }),
            );
            s.tags.forEach(function (t) {
              if (!existingTagIds.has(t.id)) existingSec.tags.push(t);
            });
          }
        });
        existing._customized = true;
        saveLearningMap(cid, existing);
        var allTags = new Set((COURSES[cid].curriculumTags || []).concat(cwSelectedTags));
        updateCourse(cid, { curriculumTags: Array.from(allTags) });
      }
    }

    cmRelinkCid = null;
    cmRelinkStep = 0;
    cwSelectedTags = [];
    renderClassManager();
  }

  function renderCmRelinkPanel(cid) {
    var html = '';

    if (cmRelinkStep === 1) {
      html += '<div class="cm-section"><div class="cm-section-title">Re-link to BC curriculum</div>';

      if (!cwCurriculumLoaded && !cwLoadError) {
        html += '<div class="cw-empty-msg">Loading BC curriculum data\u2026</div>';
      } else if (cwLoadError) {
        html += '<div class="cw-empty-msg">Could not load BC Curriculum data.</div>';
      } else {
        html += '<div class="cm-field"><label class="cm-label">Grade</label><div class="cw-grade-row">';
        [8, 9, 10, 11, 12].forEach(function (g) {
          html +=
            '<button class="cw-grade-btn' +
            (cwSelectedGrade === g ? ' active' : '') +
            '" data-action="cwSelectGrade" data-grade="' +
            g +
            '">Grade ' +
            g +
            '</button>';
        });
        html += '</div></div>';

        if (cwSelectedGrade) {
          var subjects = getSubjectsByGrade(cwSelectedGrade);
          html += '<div class="cm-field"><label class="cm-label">Subject</label><div class="cw-subject-row">';
          subjects.forEach(function (s) {
            html +=
              '<button class="cw-subject-btn' +
              (cwSelectedSubject === s ? ' active' : '') +
              '" data-action="cwSelectSubject" data-subject="' +
              esc(s) +
              '">' +
              esc(s) +
              '</button>';
          });
          html += '</div></div>';

          var courses = getCoursesByGrade(cwSelectedGrade);
          if (cwSelectedSubject)
            courses = courses.filter(function (c) {
              return c.subject === cwSelectedSubject;
            });

          if (courses.length > 0) {
            html += '<div class="cm-field"><label class="cm-label">Courses</label><div class="cw-course-list">';
            courses.forEach(function (c) {
              var sel = cwSelectedTags.includes(c.short_tag) ? ' selected' : '';
              var fullCourse = CURRICULUM_INDEX[c.short_tag];
              var compCount = 0,
                catCount = 0;
              if (fullCourse && fullCourse.categories) {
                catCount = fullCourse.categories.length;
                fullCourse.categories.forEach(function (cat) {
                  compCount += (cat.competencies || []).length;
                });
              }
              html +=
                '<div class="cw-course-item' +
                sel +
                '" data-action="cwToggleCourse" data-tag="' +
                esc(c.short_tag) +
                '">' +
                '<span class="cw-course-check">' +
                (sel ? '\u2713' : '') +
                '</span>' +
                '<span class="cw-course-name">' +
                esc(c.course_name) +
                '</span>' +
                '<span class="cw-course-tag">' +
                esc(c.short_tag) +
                '</span>' +
                '<span class="cw-course-count">' +
                catCount +
                ' categories \u00B7 ' +
                compCount +
                ' standards</span>' +
                '</div>';
            });
            html += '</div></div>';
          }
        }

        if (cwSelectedTags.length > 0) {
          var totalComps = 0;
          cwSelectedTags.forEach(function (tag) {
            var full = CURRICULUM_INDEX[tag];
            if (full && full.categories) {
              full.categories.forEach(function (cat) {
                totalComps += (cat.competencies || []).length;
              });
            }
          });
          html +=
            '<div class="cw-selection-summary"><strong>' +
            cwSelectedTags.length +
            '</strong> course' +
            (cwSelectedTags.length !== 1 ? 's' : '') +
            ' selected \u00B7 <strong>' +
            totalComps +
            '</strong> competencies</div>';
        }
      }

      html +=
        '<div class="cm-relink-actions">' +
        '<button class="btn btn-ghost" data-action="cmRelinkCancel">Cancel</button>' +
        '<button class="btn btn-primary" data-action="cmRelinkNext"' +
        (cwSelectedTags.length === 0 ? ' disabled style="opacity:0.5;pointer-events:none"' : '') +
        '>Next</button>' +
        '</div></div>';
    } else if (cmRelinkStep === 2) {
      var course = COURSES[cid];
      var existingTags = course.curriculumTags || [];
      var tagCount = getAllTags(cid).length;

      html += '<div class="cm-section"><div class="cm-section-title">Confirm curriculum change</div>';

      html += '<div class="cm-field"><label class="cm-label">New curriculum link</label>';
      cwSelectedTags.forEach(function (tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        html +=
          '<div class="cm-curric-link"><span class="cm-curric-tag">' +
          esc(tag) +
          '</span><span class="cm-curric-name">' +
          esc(courseData ? courseData.course_name : tag) +
          '</span></div>';
      });
      html += '</div>';

      if (tagCount > 0) {
        html +=
          '<div class="cm-relink-warning">This class currently has <strong>' +
          tagCount +
          '</strong> learning standards with existing score data. Choose how to handle the change:</div>';
      }

      html += '<div class="cm-relink-actions" style="flex-direction:column;gap:8px">';
      if (tagCount > 0) {
        html +=
          '<button class="btn btn-primary" data-action="cmRelinkConfirm" data-mode="merge" style="width:100%;text-align:left;padding:12px 16px"><strong>Merge</strong> \u2014 Add new standards, keep existing ones and all scores</button>' +
          '<button class="cm-relink-btn" data-action="cmRelinkConfirm" data-mode="replace" style="width:100%;text-align:left;padding:12px 16px;border-color:var(--score-2);color:var(--score-2)"><strong>Replace</strong> \u2014 Remove current standards and replace with curriculum. Existing scores may be orphaned.</button>';
      } else {
        html +=
          '<button class="btn btn-primary" data-action="cmRelinkConfirm" data-mode="replace">Apply Curriculum</button>';
      }
      html += '<button class="btn btn-ghost" data-action="cmRelinkBack">Back</button></div></div>';
    }

    return html;
  }

  /* ── CM Delete / Archive / Duplicate ────────────────────── */
  function cmToggleArchive(cid) {
    var nextArchived = !isCourseArchived(cid);
    updateCourse(cid, { archived: nextArchived });
    if (nextArchived && _activeCourse === cid) {
      var nextActive = Object.keys(COURSES).find(function (courseId) {
        return courseId !== cid && !isCourseArchived(courseId);
      });
      if (nextActive) {
        _activeCourse = nextActive;
        _activeCourseChanged = true;
        setActiveCourse(nextActive);
      }
    }
    renderClassManager();
  }

  // Only archived classes can be deleted, so a class is always archived (and
  // out of every class menu) before it can go. delete_course hides it now and
  // fv_retention_cleanup erases it 30 days later.
  function cmDeleteCourse(cid) {
    var course = COURSES[cid];
    if (!course || !isCourseArchived(cid)) return;
    showConfirm(
      'Delete Class',
      'Permanently delete ' +
        course.name +
        ' with all its students, assessments, and scores? It disappears now and is erased for good after 30 days.',
      'Delete Class',
      'danger',
      async function () {
        try {
          await deleteCourseData(cid);
        } catch (err) {
          console.error('deleteCourseData failed:', err);
          showSyncToast('Delete class failed. Try again.', 'error');
          return;
        }
        if (_activeCourse === cid) {
          var nextActive = getActiveCourse();
          _activeCourse = nextActive;
          if (nextActive) _activeCourseChanged = true;
        }
        if (cmSelectedCourse === cid) cmSelectedCourse = _activeCourse;
        renderClassManager();
      },
    );
  }

  // Duplicate Class asks which block the copy is for. With a block, the copy
  // keeps the class name ("Philosophy 12", Block B); without one it is
  // "Philosophy 12 (Copy)" as before.
  function cmDuplicateCourse(sourceCid) {
    var src = COURSES[sourceCid];
    if (!src) return;
    var triggerEl = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cm-dup-title');
    overlay.innerHTML =
      '<div class="confirm-card cm-dup-card">' +
      '<div class="confirm-title" id="cm-dup-title">Duplicate ' +
      esc(courseDisplayName(src)) +
      '</div>' +
      '<div class="confirm-message">Settings, curriculum, categories and sentence starters are copied. Students, assessments and rubrics are not.</div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-dup-block-label">Block for the new class</label>' +
      blockPickerHtml('cm-dup-block', '') +
      '</div>' +
      '<div class="confirm-actions">' +
      '<button class="confirm-cancel" id="cm-dup-cancel">Cancel</button>' +
      '<button class="confirm-ok primary" id="cm-dup-ok">Duplicate</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      try {
        if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
      } catch (e) {
        /* the trigger may be gone after a re-render */
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.id === 'cm-dup-cancel') return close();
      var chip = e.target.closest('[data-action="cmBlockChip"]');
      if (chip) {
        e.stopPropagation();
        blockChipSelect(chip);
        return;
      }
      if (e.target.id === 'cm-dup-ok') {
        var block = readBlockPicker('cm-dup-block');
        close();
        _cmDuplicateCourse(sourceCid, block);
      }
    });
    overlay.addEventListener('input', function (e) {
      if (e.target.classList.contains('cm-block-other')) blockOtherInput(e.target);
    });
    var first = overlay.querySelector('.cm-block-picker .seg-btn');
    if (first) first.focus();
  }

  function _cmDuplicateCourse(sourceCid, block) {
    var src = COURSES[sourceCid];
    if (!src) return;
    var newCourse = createCourse({
      block: block,
      name: block ? src.name : src.name + ' (Copy)',
      gradeLevel: src.gradeLevel || '',
      description: src.description || '',
      gradingSystem: src.gradingSystem || 'proficiency',
      calcMethod: src.calcMethod || 'mostRecent',
      decayWeight: src.decayWeight || 0.65,
    });
    // Reporting terms stay behind: their dates belong to one school year
    // (DECISIONS, Reporting periods 6).
    var cc = structuredClone(getCourseConfig(sourceCid));
    delete cc.reportingTerms;
    if (Object.keys(cc).length > 0) saveCourseConfig(newCourse.id, cc);
    // Categories and weights, as new rows. They go up through save_categories
    // once the class has its server id.
    var cats = getCategories(sourceCid)
      .filter(Boolean)
      .slice()
      .sort(function (a, b) {
        return (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0);
      })
      .map(function (c, i) {
        return { id: uid(), name: c.name, weight: c.weight, displayOrder: i };
      });
    if (cats.length) saveCategories(newCourse.id, cats);
    var srcMap = getLearningMap(sourceCid);
    if (srcMap && (srcMap.subjects?.length || srcMap.sections?.length)) {
      // Fresh local ids: the copy is new rows for the new class, not an
      // update of the source class's rows.
      var clone = withFreshLearningMapIds(srcMap);
      clone._customized = true;
      clone._version = 1;
      saveLearningMap(newCourse.id, clone);
    }
    // Starters are class setup, so the copy gets them as new rows.
    if (typeof copyObservationTemplates === 'function') copyObservationTemplates(sourceCid, newCourse.id);
    cmSelectedCourse = newCourse.id;
    cmMode = 'edit';
    renderClassManager();
  }

  /* ── CM Curriculum Editing ──────────────────────────────── */
  function cmAddSubject() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var id = 'subj' + Date.now().toString(36);
    map.subjects.push({ id: id, name: 'New Subject', color: '#6366f1' });
    saveLearningMap(cid, map);
    renderClassManager();
  }

  function cmUpdateSubjectName(subId, val) {
    subId = _currentId('subject', subId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sub = map.subjects.find(function (s) {
      return s.id === subId;
    });
    if (sub) {
      sub.name = val.trim();
      saveLearningMap(cid, map);
    }
  }

  function cmUpdateSubjectColor(subId, color) {
    subId = _currentId('subject', subId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sub = map.subjects.find(function (s) {
      return s.id === subId;
    });
    if (sub) {
      sub.color = color;
      saveLearningMap(cid, map);
      renderClassManager();
    }
  }

  function cmToggleColorPalette(el) {
    var target = el.dataset.target;
    var id = target === 'subject' ? el.dataset.subid : el.dataset.secid;
    var paletteId = 'cm-palette-' + target + '-' + id;
    var palette = document.getElementById(paletteId);
    if (!palette) return;
    // Close any other open palettes
    document.querySelectorAll('.cm-color-palette.open').forEach(function (p) {
      if (p.id !== paletteId) p.classList.remove('open');
      p.innerHTML = '';
    });
    if (palette.classList.contains('open')) {
      palette.classList.remove('open');
      palette.innerHTML = '';
      return;
    }
    var html = '';
    CM_COLORS.forEach(function (c) {
      html +=
        '<div class="cm-color-dot" data-action="cmPickColor" data-target="' +
        target +
        '" data-id="' +
        id +
        '" data-color="' +
        c +
        '" style="background:' +
        c +
        '"></div>';
    });
    palette.innerHTML = html;
    palette.classList.add('open');
  }

  function cmPickColor(el) {
    var target = el.dataset.target;
    var id = _currentId(el.dataset.target === 'subject' ? 'subject' : 'section', el.dataset.id);
    var color = el.dataset.color;
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    if (target === 'subject') {
      var sub = map.subjects.find(function (s) {
        return s.id === id;
      });
      if (sub) {
        sub.color = color;
      }
    } else {
      var sec = map.sections.find(function (s) {
        return s.id === id;
      });
      if (sec) {
        sec.color = color;
      }
    }
    saveLearningMap(cmSelectedCourse, map);
    renderClassManager();
  }

  function cmDeleteSubject(subId) {
    subId = _currentId('subject', subId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sectionCount = map.sections.filter(function (s) {
      return s.subject === subId;
    }).length;
    if (sectionCount > 0) {
      showConfirm(
        'Delete Subject',
        'This subject has ' + sectionCount + ' section(s). Delete them too?',
        'Delete All',
        'danger',
        function () {
          map.subjects = map.subjects.filter(function (s) {
            return s.id !== subId;
          });
          map.sections = map.sections.filter(function (s) {
            return s.subject !== subId;
          });
          saveLearningMap(cid, map);
          renderClassManager();
        },
      );
    } else {
      map.subjects = map.subjects.filter(function (s) {
        return s.id !== subId;
      });
      saveLearningMap(cid, map);
      renderClassManager();
    }
  }

  // ── Competency Group CRUD ──────────────────────────────────
  function cmAddCompGroup() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    if (!map.competencyGroups) map.competencyGroups = [];
    var idx = map.competencyGroups.length;
    var colors = [
      '#6366f1',
      '#06b6d4',
      '#10b981',
      '#f59e0b',
      '#ef4444',
      '#8b5cf6',
      '#ec4899',
      '#14b8a6',
      '#f97316',
      '#64748b',
    ];
    var grpLocalId = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var grpName = 'Group ' + (idx + 1);
    var grpColor = colors[idx % colors.length];
    map.competencyGroups.push({ id: grpLocalId, name: grpName, color: grpColor, sortOrder: idx });
    saveLearningMap(cid, map);
    renderClassManager();
  }

  function cmUpdateCompGroupName(grpId, val) {
    grpId = _currentId('group', grpId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var g = (map.competencyGroups || []).find(function (x) {
      return x.id === grpId;
    });
    if (g && val.trim()) {
      g.name = val.trim();
      saveLearningMap(cid, map);
    }
  }

  function cmUpdateCompGroupColor(grpId, color) {
    grpId = _currentId('group', grpId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var g = (map.competencyGroups || []).find(function (x) {
      return x.id === grpId;
    });
    if (g) {
      g.color = color;
      saveLearningMap(cid, map);
      _cmRenderWithScroll();
    }
  }

  function cmDeleteCompGroup(grpId) {
    grpId = _currentId('group', grpId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var count = (map.sections || []).filter(function (s) {
      return s.groupId === grpId;
    }).length;
    var doDelete = function () {
      map.competencyGroups = (map.competencyGroups || []).filter(function (g) {
        return g.id !== grpId;
      });
      (map.sections || []).forEach(function (s) {
        if (s.groupId === grpId) delete s.groupId;
      });
      saveLearningMap(cid, map);
      _cmRenderWithScroll();
    };
    if (count > 0) {
      showConfirm(
        'Delete Group',
        count + ' standard(s) will become ungrouped. Delete anyway?',
        'Delete',
        'danger',
        doDelete,
      );
    } else {
      doDelete();
    }
  }

  function cmUpdateStdGroup(secId, groupId) {
    secId = _currentId('section', secId);
    groupId = _currentId('group', groupId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = (map.sections || []).find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    if (groupId) sec.groupId = groupId;
    else delete sec.groupId;
    saveLearningMap(cid, map);
    _cmRenderWithScroll();
  }

  // Re-render class manager preserving scroll position
  function _cmRenderWithScroll() {
    var container = document.querySelector('.cm-detail');
    var scrollY = container ? container.scrollTop : window.scrollY;
    renderClassManager();
    requestAnimationFrame(function () {
      var c = document.querySelector('.cm-detail');
      if (c) c.scrollTop = scrollY;
      else window.scrollTo(0, scrollY);
    });
  }

  // ── Flat Learning Standard CRUD ──────────────────────────────
  function cmAddStd() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    if (map.subjects.length === 0) {
      map.subjects.push({ id: 'subj1', name: 'General', color: '#6366f1' });
    }
    var subId = map.subjects[0].id;
    var stdId = 'S' + Date.now().toString(36).slice(-4).toUpperCase();
    var colour =
      map.subjects.find(function (s) {
        return s.id === subId;
      })?.color || '#6366f1';
    map.sections.push({
      id: stdId,
      subject: subId,
      name: 'New Standard',
      shortName: 'New',
      color: colour,
      tags: [
        {
          id: stdId,
          label: 'New Standard',
          text: '',
          color: colour,
          subject: subId,
          name: 'New Standard',
          shortName: 'New',
        },
      ],
    });
    map._flatVersion = 2;
    saveLearningMap(cid, map);
    renderClassManager();
    requestAnimationFrame(function () {
      var el = document.getElementById('cm-sec-' + stdId);
      if (el) {
        el.classList.add('open');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function cmUpdateStdName(secId, val) {
    secId = _currentId('section', secId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    var trimmed = val.trim();
    sec.name = trimmed;
    sec.shortName = trimmed.split(' ')[0];
    if (sec.tags[0]) {
      sec.tags[0].name = trimmed;
      sec.tags[0].shortName = sec.shortName;
    }
    saveLearningMap(cid, map);
  }

  function cmUpdateStdSubject(secId, subId) {
    secId = _currentId('section', secId);
    subId = _currentId('subject', subId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    sec.subject = subId;
    if (sec.tags[0]) sec.tags[0].subject = subId;
    saveLearningMap(cid, map);
  }

  function cmUpdateStdColor(secId, color) {
    secId = _currentId('section', secId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec) return;
    sec.color = color;
    if (sec.tags[0]) sec.tags[0].color = color;
    saveLearningMap(cid, map);
    renderClassManager();
  }

  function cmDeleteStd(secId) {
    showConfirm(
      'Delete Standard',
      'Delete this learning standard? Existing scores are preserved.',
      'Delete',
      'danger',
      function () {
        var cid = cmSelectedCourse;
        var map = ensureCustomLearningMap(cid);
        // Resolved now: the id may have been re-keyed while the dialog was open.
        var currentId = _currentId('section', secId);
        map.sections = map.sections.filter(function (s) {
          return s.id !== currentId;
        });
        saveLearningMap(cid, map);
        renderClassManager();
      },
    );
  }

  function cmUpdateStdLabel(secId, val) {
    secId = _currentId('section', secId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (sec && sec.tags[0]) {
      sec.tags[0].label = val.trim();
      saveLearningMap(cid, map);
    }
  }

  function cmUpdateStdText(secId, val) {
    secId = _currentId('section', secId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (sec && sec.tags[0]) {
      sec.tags[0].text = val.trim();
      saveLearningMap(cid, map);
    }
  }

  // Updates the user-facing tag.code (e.g. "RD1", "ENG10A") for a standard.
  // Pre-V2 this used to rename the section/tag local IDs, fanning out updates
  // to assessment.tagIds and score.tagId references; post-V2 those IDs are
  // server-owned UUIDs that the database authoritatively holds, and the
  // user-visible code is its own column. This implementation just updates
  // tag.code locally; saveLearningMap sends the changed tag.
  function cmUpdateStdCode(secId, val) {
    secId = _currentId('section', secId);
    if (!cmSelectedCourse) return;
    var newCode = val
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9._\-]/g, '')
      .slice(0, 10);
    if (!newCode) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return;
    var tag = sec.tags[0];
    if (newCode === tag.code) return;
    tag.code = newCode;
    saveLearningMap(cmSelectedCourse, map);
    renderClassManager();
  }

  // Legacy aliases
  function cmAddSec() {
    cmAddStd();
  }
  function cmUpdateSecName(secId, val) {
    cmUpdateStdName(secId, val);
  }
  function cmUpdateSecSubject(secId, subId) {
    cmUpdateStdSubject(secId, subId);
  }
  function cmUpdateSecColor(secId, color) {
    cmUpdateStdColor(secId, color);
  }
  function cmDeleteSec(secId) {
    cmDeleteStd(secId);
  }
  function cmToggleSec(headerEl) {
    headerEl.closest('.cm-sec-group').classList.toggle('open');
  }
  function cmAddTag(secId) {
    /* no-op in flat mode */
  }
  function cmUpdateTagLabel(secId, tagId, val) {
    cmUpdateStdLabel(secId, val);
  }
  function cmUpdateTagText(secId, tagId, val) {
    cmUpdateStdText(secId, val);
  }
  function cmDeleteTag(secId, tagId) {
    cmDeleteStd(secId);
  }

  /* ── Action dispatcher (called from parent's _handleClick) ── */
  function handleAction(action, el, e) {
    var handlers = {
      openClassManager: function () {
        openClassManager();
      },
      closeClassManager: function () {
        closeClassManager();
      },
      cmStartCreate: function () {
        cmStartCreate();
      },
      cmCancelCreate: function () {
        cmCancelCreate();
      },
      cmSelectClass: function () {
        cmSelectClass(el.dataset.cid);
      },
      cmEditStudent: function () {
        cmEditStudent(el.dataset.sid);
      },
      cmRemoveStudent: function () {
        cmRemoveStudent(el.dataset.sid);
      },
      cmReenrolStudent: function () {
        cmReenrolStudent(el.dataset.sid);
      },
      cmDeleteWithdrawn: function () {
        cmDeleteWithdrawn(el.dataset.sid);
      },
      cmCancelStudent: function () {
        cmCancelStudent();
      },
      cmSaveStudent: function () {
        cmSaveStudent();
      },
      cmShowAddStudent: function () {
        cmShowAddStudent();
      },
      cmImportRoster: function () {
        cmImportRoster();
      },
      cmConfirmImport: function () {
        cmConfirmImport();
      },
      cmCancelImport: function () {
        cmCancelImport();
      },
      cmToggleBulk: function () {
        cmToggleBulk();
      },
      cmBulkSelectAll: function () {
        cmBulkSelectAll();
      },
      cmBulkDeselectAll: function () {
        cmBulkDeselectAll();
      },
      cmApplyBulk: function () {
        cmApplyBulk();
      },
      cmSetGradingSystem: function () {
        cmSetGradingSystem(el.dataset.value);
      },
      cmSetCalcMethod: function () {
        cmSetCalcMethod(el.dataset.value);
      },
      cmSetRoundPercent: function () {
        cmSetRoundPercent(el.dataset.value);
      },
      cmTermSpan: function () {
        cmTermSpan(el.dataset.value);
      },
      cmTermPreset: function () {
        cmTermPreset(el.dataset.value);
      },
      cmTermSchoolPreset: function () {
        cmTermSchoolPreset();
      },
      cmTermAdd: function () {
        cmTermAdd();
      },
      cmTermDelete: function () {
        cmTermDelete(parseInt(el.dataset.idx, 10));
      },
      cmTermSave: function () {
        cmTermSave();
      },
      cmCatAdd: function () {
        cmCatAdd();
      },
      cmCatCopyFrom: function () {
        cmOpenSetupCopy({ mode: 'from', only: 'categories' });
      },
      cmCopySetup: function () {
        cmOpenSetupCopy({});
      },
      cmCatSave: function () {
        cmCatSave();
      },
      cmCatDelete: function () {
        cmCatDelete(parseInt(el.dataset.idx, 10));
      },
      cmCatMoveCancel: function () {
        cmCatMoveCancel();
      },
      cmCatMoveDelete: function () {
        cmCatMoveDelete(parseInt(el.dataset.idx, 10));
      },
      cmCatAssignUncategorized: function () {
        cmCatAssignUncategorized();
      },
      cmToggleColorPalette: function () {
        cmToggleColorPalette(el);
      },
      cmPickColor: function () {
        cmPickColor(el);
      },
      cmDeleteSubject: function () {
        cmDeleteSubject(el.dataset.subid);
      },
      cmAddSubject: function () {
        cmAddSubject();
      },
      cmToggleSec: function () {
        cmToggleSec(el);
      },
      cmDeleteSec: function () {
        cmDeleteSec(el.dataset.secid);
      },
      cmDeleteStd: function () {
        cmDeleteStd(el.dataset.secid);
      },
      cmDeleteTag: function () {
        cmDeleteTag(el.dataset.secid, el.dataset.tagid);
      },
      cmAddTag: function () {
        cmAddTag(el.dataset.secid);
      },
      cmAddSec: function () {
        cmAddSec();
      },
      cmAddStd: function () {
        cmAddStd();
      },
      cmStartRelink: function () {
        cmStartRelink(el.dataset.cid);
      },
      cmDuplicateCourse: function () {
        cmDuplicateCourse(el.dataset.cid);
      },
      cmStarterAdd: function () {
        cmStarterAdd();
      },
      cmStarterEdit: function () {
        cmStarterEdit(el.dataset.tplid);
      },
      cmStarterCancel: function () {
        cmStarterCancel();
      },
      cmStarterSave: function () {
        cmStarterSave();
      },
      cmStarterDelete: function () {
        cmStarterDelete(el.dataset.tplid);
      },
      cmStarterMove: function () {
        cmStarterMove(el.dataset.tplid, parseInt(el.dataset.dir, 10));
      },
      cmStarterAddSuggested: function () {
        cmStarterAddSuggested();
      },
      cmStarterTag: function () {
        cmStarterTag(el.dataset.value);
      },
      cmToggleArchive: function () {
        cmToggleArchive(el.dataset.cid);
      },
      cmDeleteCourse: function () {
        cmDeleteCourse(el.dataset.cid);
      },
      cwSelectGrade: function () {
        cwSelectGrade(parseInt(el.dataset.grade, 10));
      },
      cwSelectSubject: function () {
        cwSelectSubject(el.dataset.subject);
      },
      cwToggleCourse: function () {
        cwToggleCourse(el.dataset.tag);
      },
      cwSkipToCustom: function () {
        cwSkipToCustom();
      },
      cwGoToStep2: function () {
        cwGoToStep2();
      },
      cwGoToStep3: function () {
        cwGoToStep3();
      },
      cwGoBack: function () {
        cwGoBack();
      },
      cwFinishCreate: function () {
        cwFinishCreate();
      },
      cmAddCompGroup: function () {
        cmAddCompGroup();
      },
      cmDeleteCompGroup: function () {
        cmDeleteCompGroup(el.dataset.grpid);
      },
      cmToggleStdCard: function () {
        cmToggleStdCard(el.dataset.secid);
      },
      cmToggleStdFolder: function () {
        cmToggleStdFolder(el.dataset.uid);
      },
      openColorPicker: function () {
        var inp = el.querySelector('input[type="color"]');
        if (inp) inp.click();
      },
      cmBlockChip: function () {
        blockChipSelect(el);
        if (el.dataset.picker === 'cm-block') cmUpdateField('block', el.dataset.val || '');
      },
      cmCreateToggle: function () {
        cmCreateToggle(el, el.dataset.group);
        var dp = document.getElementById('cm-cg-decay');
        if (dp) dp.style.display = 'none';
      },
      cmCreateToggleDecay: function () {
        cmCreateToggle(el, el.dataset.group);
        document.getElementById('cm-cg-decay').style.display =
          el.classList.contains('active') && el.dataset.val === 'decayingAvg' ? '' : 'none';
      },
      cmRelinkCancel: function () {
        cmRelinkCancel();
      },
      cmRelinkNext: function () {
        cmRelinkNext();
      },
      cmRelinkConfirm: function () {
        cmRelinkConfirm(el.dataset.mode);
      },
      cmRelinkBack: function () {
        cmRelinkStep = 1;
        renderClassManager();
      },
    };
    if (handlers[action]) {
      if (el.tagName !== 'SELECT' && e) e.preventDefault();
      handlers[action]();
      return true;
    }
    return false;
  }

  function handleInput(el) {
    if (el.dataset.actionInput === 'cmBlockOtherInput') {
      blockOtherInput(el);
      return true;
    }
    if (el.dataset.actionInput === 'cmDecaySlider') {
      cmUpdateDecay(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cwGradeInput') {
      cwGradeInput(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmCreateDecaySlider') {
      var dv = document.getElementById('cm-cg-decay-val');
      if (dv) dv.textContent = el.value + '%';
      return true;
    }
    if (el.dataset.actionInput === 'cmCatWeightLive') {
      cmCatWeightLive(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmCatNameLive') {
      cmCatNameLive(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmTermLive') {
      cmTermLive(parseInt(el.dataset.idx, 10), el.dataset.field, el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmStarterText') {
      cmStarterText(el.value);
      return true;
    }
    // T-UI-02 retired: cmCwRange (legacy summative/formative slider).
    return false;
  }

  function handleChange(el) {
    if (el.dataset.actionChange === 'cmCSV') {
      cmHandleCSV(el);
      return true;
    }
    if (el.dataset.actionChange === 'cmTermSchool') {
      cmTermSchool(el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmStarterType' && _cmStarterEdit) {
      _cmStarterEdit.sentiment = el.value || null;
      return true;
    }
    if (el.dataset.actionChange === 'cmStarterContext' && _cmStarterEdit) {
      _cmStarterEdit.context = el.value || null;
      return true;
    }
    // T-UI-02 retired: cmCwEnabled + cmReportPct (deleted 2026-04-21).
    if (el.dataset.actionChange === 'cmSubjectColor') {
      cmUpdateSubjectColor(el.dataset.subid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmStdSubject') {
      cmUpdateStdSubject(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmStdColor') {
      cmUpdateStdColor(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompGroupColor') {
      cmUpdateCompGroupColor(el.dataset.grpid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmStdGroup') {
      cmUpdateStdGroup(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmSecSubject') {
      cmUpdateSecSubject(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmSecColor') {
      cmUpdateSecColor(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.action === 'cmBulkToggleCheck') {
      cmBulkToggle(el.dataset.sid);
      return true;
    }
    return false;
  }

  // Enter in an Add/Edit Student field saves, as the Save button does.
  // In the starter editor Enter saves and Escape cancels.
  function handleKeydown(e) {
    var el = e.target;
    if (el && el.id === 'cm-starter-text' && !e.isComposing) {
      if (e.key === 'Enter') {
        e.preventDefault();
        cmStarterSave();
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cmStarterCancel();
        return true;
      }
    }
    if (e.key !== 'Enter' || e.isComposing) return false;
    if (!el || el.tagName !== 'INPUT' || el.type === 'checkbox') return false;
    if (!el.closest || !el.closest('#cm-add-student-form')) return false;
    e.preventDefault();
    cmSaveStudent();
    return true;
  }

  function handleBlur(el) {
    if (el.dataset.actionBlur === 'cmBlockOtherBlur') {
      var typed = normalizeCourseBlock(el.value);
      var cur = normalizeCourseBlock(COURSES[cmSelectedCourse] && COURSES[cmSelectedCourse].block);
      var isChip = COURSE_BLOCK_CHOICES.indexOf(cur) >= 0;
      // Leaving the box empty keeps a chosen chip; a typed label replaces it.
      if (typed) cmUpdateField('block', typed);
      else if (!isChip && cur) cmUpdateField('block', '');
      return true;
    }
    if (el.dataset.actionBlur === 'cmUpdateName') {
      cmUpdateField('name', el.value, el);
      return true;
    }
    if (el.dataset.actionBlur === 'cmUpdateGrade') {
      cmUpdateField('gradeLevel', el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmUpdateDesc') {
      cmUpdateField('description', el.value);
      return true;
    }
    // Late Work Policy — empty becomes null (matches Phoneox `value || null`
    // pattern, so blanking the textarea clears the server-side column).
    if (el.dataset.actionBlur === 'cmLateWorkPolicy') {
      var _lp = (el.value || '').trim();
      cmUpdateField('lateWorkPolicy', _lp || null);
      return true;
    }
    if (el.dataset.actionBlur === 'cmCompGroupName') {
      cmUpdateCompGroupName(el.dataset.grpid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmSubjectName') {
      cmUpdateSubjectName(el.dataset.subid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdCode') {
      cmUpdateStdCode(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdName') {
      cmUpdateStdName(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdLabel') {
      cmUpdateStdLabel(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmStdText') {
      cmUpdateStdText(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmSecName') {
      cmUpdateSecName(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmTagLabel') {
      cmUpdateTagLabel(el.dataset.secid, el.dataset.tagid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmTagText') {
      cmUpdateTagText(el.dataset.secid, el.dataset.tagid, el.value);
      return true;
    }
    return false;
  }

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    configure: configure,
    setActiveCourse: _setActiveCourse,
    get classManagerOpen() {
      return classManagerOpen;
    },
    set classManagerOpen(v) {
      classManagerOpen = v;
    },
    openClassManager: openClassManager,
    openStarters: openStarters,
    closeClassManager: closeClassManager,
    renderClassManager: renderClassManager,
    // The copy step behind the Duplicate Class dialog (block '' = none).
    duplicateCourse: _cmDuplicateCourse,
    handleAction: handleAction,
    // The reporting terms draft as the editor holds it (tests).
    reportingTermsDraft: function (cid) {
      var st = _cmTermRows(cid || cmSelectedCourse);
      return { rows: st.rows.slice(), dirty: st.dirty, error: _cmTermError(cid || cmSelectedCourse) };
    },
    handleInput: handleInput,
    handleChange: handleChange,
    handleBlur: handleBlur,
    handleKeydown: handleKeydown,
    initDrag: function () {
      _initCmStdDrag();
      _initCmCatDrag();
    },
    destroy: _removeAllListeners,
    resetState: function () {
      classManagerOpen = false;
      cmMode = 'edit';
      cmSelectedCourse = _activeCourse;
      _activeCourseChanged = false;
      cmEditingStudentId = null;
      cmBulkMode = false;
      cmBulkSelected = new Set();
      cmPendingImport = null;
      cmRelinkCid = null;
      cmRelinkStep = 0;
      cwStep = 1;
      cwSelectedGrade = null;
      cwSelectedSubject = null;
      cwSelectedTags = [];
      cwStep2Name = '';
      cwStep2Grade = '';
      cwStep2Desc = '';
      cwStep2Block = '';
      cwStep2Span = 'full';
      cwStep2Grading = '';
      cwStep2Calc = '';
      cwStep2Decay = '65';
      cwStep2LatePolicy = '';
      _cmCollapsedStdFolders = {};
      _cmOpenStdCards = {};
      _cmCategoryState = {};
      _cmStarterEdit = null;
      _cmStarterError = '';
    },
  };
})();
