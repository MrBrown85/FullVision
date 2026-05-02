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

  function configure(opts) {
    _activeCourse = opts.activeCourse;
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
      '<div style="flex:1"><label class="cm-label">Standard Name</label>' +
      '<input class="cm-input" value="' +
      esc(sec.name) +
      '" style="font-weight:600;font-size:0.82rem" data-stop-prop="true" data-action-blur="cmStdName" data-secid="' +
      sec.id +
      '"></div>' +
      '<div style="min-width:100px"><label class="cm-label">Subject</label>' +
      '<select class="cm-input" style="font-size:0.78rem" data-stop-prop="true" data-action-change="cmStdSubject" data-secid="' +
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
          '<select class="cm-input" style="font-size:0.78rem" data-stop-prop="true" data-action-change="cmStdGroup" data-secid="' +
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
      '<div style="flex:0 0 120px"><label class="cm-label">Tag Code</label>' +
      '<input class="cm-input" value="' +
      esc(tag.code || tag.shortName || '') +
      '" placeholder="e.g. RD1" maxlength="10" style="padding:5px 8px;font-size:0.82rem;font-weight:600;font-family:monospace;text-transform:uppercase" data-stop-prop="true" data-action-blur="cmStdCode" data-secid="' +
      sec.id +
      '"></div>' +
      '<div style="flex:1"><label class="cm-label">Short Label</label>' +
      '<input class="cm-input" value="' +
      esc(tag.label) +
      '" placeholder="Short label" style="padding:5px 8px;font-size:0.82rem;font-weight:500" data-action-blur="cmStdLabel" data-secid="' +
      sec.id +
      '"></div>' +
      '</div>' +
      '<label class="cm-label">I can\u2026 Statement</label>' +
      '<textarea class="cm-textarea" placeholder="I can\u2026 statement" style="min-height:34px;padding:5px 8px;font-size:0.78rem" data-action-blur="cmStdText" data-secid="' +
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
      await new Promise(function (r) {
        setTimeout(r, 75);
      });
    }
    return null;
  }

  // Patch a single entity-kind's id from local → canonical. Scoping is
  // required: buildLearningMapFromTags assigns the same baseId to a section
  // and the tag inside it, so a kind-blind walk would rewrite the tag's id
  // to the section's UUID and the next upsert_tag would 500 with
  // "tag not found".
  function _patchMapId(cid, map, kind, localId, canonicalId) {
    if (!localId || !canonicalId || localId === canonicalId) return;
    if (kind === 'subject') {
      (map.subjects || []).forEach(function (s) {
        if (s.id === localId) s.id = canonicalId;
      });
      (map.sections || []).forEach(function (s) {
        if (s.subject === localId) s.subject = canonicalId;
        (s.tags || []).forEach(function (t) {
          if (t.subject === localId) t.subject = canonicalId;
        });
      });
    } else if (kind === 'section') {
      (map.sections || []).forEach(function (s) {
        if (s.id === localId) s.id = canonicalId;
      });
    } else if (kind === 'tag') {
      (map.sections || []).forEach(function (s) {
        (s.tags || []).forEach(function (t) {
          if (t.id === localId) t.id = canonicalId;
        });
      });
    } else if (kind === 'group') {
      (map.competencyGroups || []).forEach(function (g) {
        if (g.id === localId) g.id = canonicalId;
      });
      (map.sections || []).forEach(function (s) {
        if (s.groupId === localId) s.groupId = canonicalId;
      });
    }
    saveLearningMap(cid, map);
  }

  async function _dispatchMapToV2(cid, map, forceNewIds) {
    if (!_isCanonicalId(cid)) return true;
    try {
      var subjects = map.subjects || [];
      for (var si = 0; si < subjects.length; si++) {
        var sub = subjects[si];
        var oldSubId = sub.id;
        var subRes = await window.v2.upsertSubject({
          id: forceNewIds ? null : oldSubId,
          courseId: cid,
          name: sub.name,
          color: sub.color || null,
          displayOrder: si,
        });
        if (subRes && subRes.data && subRes.data !== oldSubId) {
          _patchMapId(cid, map, 'subject', oldSubId, subRes.data);
        }
      }
      var sections = map.sections || [];
      for (var si = 0; si < sections.length; si++) {
        var sec = sections[si];
        var oldSecId = sec.id;
        var secRes = await window.v2.upsertSection({
          id: forceNewIds ? null : oldSecId,
          subjectId: sec.subject,
          name: sec.name,
          color: sec.color || null,
          displayOrder: si,
        });
        if (secRes && secRes.data && secRes.data !== oldSecId) {
          _patchMapId(cid, map, 'section', oldSecId, secRes.data);
        }
        var tags = sec.tags || [];
        for (var ti = 0; ti < tags.length; ti++) {
          var tag = tags[ti];
          var oldTagId = tag.id;
          var tagRes = await window.v2.upsertTag({
            id: forceNewIds ? null : oldTagId,
            sectionId: sec.id,
            label: tag.name || tag.label || '',
            code: tag.shortName || tag.code || '',
            iCanText: tag.text || tag.i_can_statements || '',
            displayOrder: ti,
          });
          if (tagRes && tagRes.data && tagRes.data !== oldTagId) {
            _patchMapId(cid, map, 'tag', oldTagId, tagRes.data);
          }
        }
      }
      return true;
    } catch (err) {
      console.error('[_dispatchMapToV2] dispatch failed for course', cid, err);
      return false;
    }
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
    var grpLocalId = grp.id;
    window.v2
      .upsertCompetencyGroup({ id: grpLocalId, courseId: cid, name: grp.name, color: grp.color, displayOrder: idx })
      .then(function (res) {
        var canonicalId = res && res.data ? res.data : null;
        if (canonicalId && canonicalId !== grpLocalId) {
          var m = getLearningMap(cid);
          _patchMapId(cid, m, 'group', grpLocalId, canonicalId);
        }
      });
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
        var sec = (map.sections || []).find(function (s) {
          return s.id === _cmDragStdId;
        });
        if (sec) {
          if (targetGroupId) sec.groupId = targetGroupId;
          else delete sec.groupId;
          saveLearningMap(cmSelectedCourse, map);
          renderClassManager();
          window.v2.upsertSection({ id: _cmDragStdId, competencyGroupId: targetGroupId || null });
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
    cwStep2Desc = '';
  var cwStep2Grading = 'proficiency',
    cwStep2Calc = 'mostRecent',
    cwStep2Decay = '65';

  function deleteStudentUI(sid) {
    var students = getStudents(_activeCourse);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;
    var dname = displayName(st);
    showConfirm(
      'Delete Student',
      'Permanently delete ' + dname + ' and all their data? This cannot be undone.',
      'Delete',
      'danger',
      function () {
        var snapshot = deleteStudent(_activeCourse, sid);
        renderClassManager();
        showUndoToast('Student deleted', function () {
          var cid = _activeCourse;
          var sts = getStudents(cid);
          sts.push(snapshot.student);
          saveStudents(cid, sts);
          var sc = getScores(cid);
          sc[sid] = snapshot.scores;
          saveScores(cid, sc);
          if (snapshot.goals !== undefined) {
            var g = getGoals(cid);
            g[sid] = snapshot.goals;
            saveGoals(cid, g);
          }
          if (snapshot.reflections !== undefined) {
            var r = getReflections(cid);
            r[sid] = snapshot.reflections;
            saveReflections(cid, r);
          }
          if (snapshot.notes !== undefined) {
            var n = getNotes(cid);
            n[sid] = snapshot.notes;
            saveNotes(cid, n);
          }
          if (snapshot.flagged) {
            var f = getFlags(cid);
            f[sid] = true;
            saveFlags(cid, f);
          }
          if (snapshot.statuses) {
            var s = getAssignmentStatuses(cid);
            Object.assign(s, snapshot.statuses);
            saveAssignmentStatuses(cid, s);
          }
          renderClassManager();
        });
      },
    );
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
    deleteStudentUI(sid);
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
      '<div class="cm-label" style="margin-bottom:6px">Import Preview \u2014 ' +
      parsed.length +
      ' student' +
      (parsed.length !== 1 ? 's' : '') +
      ' found</div>' +
      '<div style="max-height:180px;overflow-y:auto;margin-bottom:8px">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">' +
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
        '<td style="padding:3px 6px;font-size:0.65rem;font-weight:600;color:' +
        (dupe ? 'var(--priority)' : 'var(--score-3)') +
        '">' +
        (dupe ? 'SKIP' : 'NEW') +
        '</td>' +
        '</tr>';
    });
    html +=
      '</tbody></table></div>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-primary" style="font-size:0.78rem;padding:6px 14px" data-action="cmConfirmImport">Import</button>' +
      '<button class="btn btn-ghost" style="font-size:0.78rem;padding:6px 10px" data-action="cmCancelImport">Cancel</button>' +
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
    if (_onRender) _onRender();
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
    html +=
      '<div class="cm-topbar">' +
      '<button class="cm-back-btn" data-action="closeClassManager">\u2190 Dashboard</button>' +
      '<span class="cm-topbar-title">Class Management</span>' +
      '<span class="cm-topbar-spacer"></span>' +
      '<span style="font-size:0.75rem;color:var(--text-3)">' +
      esc(detailTitle) +
      '</span>' +
      '</div>';

    // Empty state
    if (courseIds.length === 0 && cmMode !== 'create') {
      html +=
        '<div class="cm-empty">' +
        '<div class="cm-empty-icon">\uD83D\uDCDA</div>' +
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
  }

  function renderCmSidebar(courseIds) {
    var html =
      '<div class="cm-sidebar">' +
      '<div class="cm-sidebar-header">' +
      '<span class="cm-sidebar-label">' +
      courseIds.length +
      ' Class' +
      (courseIds.length !== 1 ? 'es' : '') +
      '</span>' +
      '<button class="cm-new-btn" data-action="cmStartCreate">+ New</button>' +
      '</div>' +
      '<div class="cm-class-list">';
    if (cmMode === 'create') {
      html +=
        '<div class="cm-class-item cm-create-active">' +
        '<div class="cm-class-name" style="color:var(--active)">New Class</div>' +
        '<div class="cm-class-meta">Setting up\u2026</div>' +
        '</div>';
    }
    var activeCids = courseIds.filter(function (cid) {
      return !isCourseArchived(cid);
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
        esc(c.name) +
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
        '<div style="padding:8px 12px 4px;font-size:0.6rem;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-top:8px;border-top:1px solid var(--border)">Archived</div>';
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
          esc(c.name) +
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
      '<div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Class Name</label>' +
      '<input class="cm-input" id="cm-name" value="' +
      esc(course.name) +
      '" data-action-blur="cmUpdateName">' +
      '</div>' +
      '<div class="cm-row">' +
      '<div class="cm-field">' +
      '<label class="cm-label">Grade Level</label>' +
      '<input class="cm-input" id="cm-grade" value="' +
      esc(course.gradeLevel || '') +
      '" placeholder="e.g. 8, 10-12" data-action-blur="cmUpdateGrade">' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Stats</label>' +
      '<div style="display:flex;gap:12px;padding:7px 0;font-size:0.78rem;color:var(--text-2)">' +
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
        ? '<button class="cm-add-link" data-action="cmToggleBulk" style="font-size:0.7rem;padding:2px 8px;border-radius:4px;' +
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
              var d = BC_DESIGNATIONS[code];
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
            ? '<span style="font-size:0.65rem;color:var(--text-3);font-family:\'SF Mono\',monospace">#' +
              esc(st.studentNumber) +
              '</span>'
            : '') +
          '<div class="cm-student-actions">' +
          '<button class="cm-delete-mini" data-action="cmEditStudent" data-sid="' +
          st.id +
          '" title="Edit" style="font-size:0.65rem">\u270E</button>' +
          '<button class="cm-delete-mini" data-action="cmRemoveStudent" data-sid="' +
          st.id +
          '" title="Remove">\u2715</button>' +
          '</div>' +
          '</div>';
      });
      html += '</div>';
    } else {
      html +=
        '<div style="text-align:center;padding:16px;color:var(--text-3);font-size:0.82rem;border:1.5px dashed var(--border);border-radius:var(--radius-sm)">' +
        'No students yet. Add students individually or import a CSV roster.' +
        '</div>';
    }
    // Bulk edit panel
    if (cmBulkMode && students.length > 0) {
      html +=
        '<div class="cm-bulk-panel">' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
        '<button class="cm-add-link" data-action="cmBulkSelectAll" style="font-size:0.7rem">Select All</button>' +
        '<button class="cm-add-link" data-action="cmBulkDeselectAll" style="font-size:0.7rem">Deselect All</button>' +
        '<span style="font-size:0.7rem;color:var(--text-3);margin-left:auto">' +
        cmBulkSelected.size +
        ' selected</span>' +
        '</div>' +
        '<div class="cm-student-form" style="gap:8px 12px">' +
        '<div class="cm-field">' +
        '<label class="cm-label">Set Pronouns</label>' +
        pronounsSelect('cm-bulk-pro', '') +
        '</div>' +
        '<div class="cm-field">' +
        '<label class="cm-label">Add Attendance</label>' +
        '<div style="display:flex;gap:6px">' +
        '<input type="date" class="cm-input" id="cm-bulk-att-date" value="' +
        getTodayStr() +
        '" style="font-size:0.78rem;flex:1">' +
        '<select class="cm-input" id="cm-bulk-att-status" style="font-size:0.78rem;flex:1">' +
        '<option value="present">Present</option>' +
        '<option value="absent">Absent</option>' +
        '<option value="late">Late</option>' +
        '<option value="excused">Excused</option>' +
        '</select>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn btn-primary" data-action="cmApplyBulk" style="font-size:0.78rem;padding:6px 14px" ' +
        (cmBulkSelected.size === 0 ? 'disabled' : '') +
        '>Apply to Selected</button>' +
        '</div>' +
        '</div>';
    }
    // Add/Edit student form
    html +=
      '<div id="cm-add-student-form" style="display:none" class="cm-add-student-form">' +
      '<div class="cm-student-form">' +
      '<div class="cm-field"><label class="cm-label">First Name *</label><input class="cm-input" id="cm-add-first" placeholder="e.g. Amara" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Last Name</label><input class="cm-input" id="cm-add-last" placeholder="e.g. Osei" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Preferred Name</label><input class="cm-input" id="cm-add-pref" placeholder="e.g. Amara" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Pronouns</label>' +
      pronounsSelect('cm-add-pro', '') +
      '</div>' +
      '<div class="cm-field"><label class="cm-label">Student Number</label><input class="cm-input" id="cm-add-num" placeholder="e.g. STU-101" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Email</label><input class="cm-input" id="cm-add-email" type="email" placeholder="student@school.edu" style="font-size:0.82rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Date of Birth</label><input class="cm-input" id="cm-add-dob" type="date" style="font-size:0.82rem;padding:6px 10px"></div>' +
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
      '<div class="cm-field" style="grid-column:1/-1;display:flex;align-items:flex-end;gap:8px;justify-content:flex-end">' +
      '<button class="btn btn-ghost" data-action="cmCancelStudent" style="padding:6px 10px;font-size:0.78rem">Cancel</button>' +
      '<button class="btn btn-primary" id="cm-save-btn" data-action="cmSaveStudent" style="padding:6px 14px;font-size:0.78rem">Save</button>' +
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
      '</div>';

    // Section 3: Grading & Calculation (still in left column)
    // T-UI-02 — grading_system segmented control. Three segments:
    //   proficiency / letter / both. letter+both require at least one
    //   assessment Category (T-UI-12) — disabled with tooltip otherwise.
    var gs = course.gradingSystem || _cmDefaultGradingSystem(course);
    var hasCats = _cmHasCategories(cmSelectedCourse);
    var gradeLockReason = hasCats ? '' : 'Create a category first \u2192';
    html +=
      '<div class="cm-section">' +
      '<div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Grading System</label>' +
      '<div class="cm-seg" role="radiogroup" aria-label="Grading system">' +
      '<button class="cm-seg-btn' +
      (gs === 'proficiency' ? ' active' : '') +
      '" role="radio" aria-checked="' +
      (gs === 'proficiency') +
      '" data-action="cmSetGradingSystem" data-value="proficiency">Proficiency</button>' +
      '<button class="cm-seg-btn' +
      (gs === 'letter' ? ' active' : '') +
      (hasCats ? '' : ' cm-seg-btn-disabled') +
      '" role="radio" aria-checked="' +
      (gs === 'letter') +
      '" aria-disabled="' +
      !hasCats +
      '"' +
      (hasCats ? '' : ' title="' + gradeLockReason + '"') +
      ' data-action="cmSetGradingSystem" data-value="letter">Letter</button>' +
      '<button class="cm-seg-btn' +
      (gs === 'both' ? ' active' : '') +
      (hasCats ? '' : ' cm-seg-btn-disabled') +
      '" role="radio" aria-checked="' +
      (gs === 'both') +
      '" aria-disabled="' +
      !hasCats +
      '"' +
      (hasCats ? '' : ' title="' + gradeLockReason + '"') +
      ' data-action="cmSetGradingSystem" data-value="both">Both</button>' +
      '</div>' +
      (hasCats ? '' : '<div class="cm-hint cm-seg-hint-locked">' + esc(gradeLockReason) + '</div>') +
      // Contextual grading-system description — mirrors the Phoneox React
      // pattern at src/components/courses/grading-config.tsx:56-70.
      '<div class="cm-hint" style="margin-top:6px">' +
      _cmGradingSystemDescription(gs) +
      '</div>' +
      '</div>' +
      _cmRenderCategoriesField(cmSelectedCourse) +
      '<div class="cm-field">' +
      '<label class="cm-label">Calculation Method</label>' +
      '<div class="cm-seg">' +
      CALC_METHODS.map(function (m) {
        return (
          '<button class="cm-seg-btn' +
          (method === m.value ? ' active' : '') +
          '" data-action="cmSetCalcMethod" data-value="' +
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
      '<label class="cm-label">Decay Weight</label>' +
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
      '<label class="cm-label" for="cm-late-policy">Late Work Policy</label>' +
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

    html += '<div class="cm-field"><label class="cm-label">Learning Standards</label>';

    if ((lm.sections || []).length === 0 && compGroups.length === 0) {
      html +=
        '<div class="cm-curriculum-empty">' +
        '<div class="cm-curriculum-empty-icon">\uD83D\uDCD0</div>' +
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
        '<span style="font-size:0.88rem;color:var(--text-3)">\uD83D\uDCC1</span>' +
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
    html += '<div class="cm-section">' + '<div class="cm-section-title">BC Curriculum Link</div>';
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
      (isArchived ? '\uD83D\uDCE6 Unarchive Class' : '\uD83D\uDCE6 Archive Class') +
      '</button>' +
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
      html += '<div class="cm-section"><div class="cw-empty-msg">Loading BC Curriculum data\u2026</div></div>';
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

    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    html +=
      '<div class="cm-section"><div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field"><label class="cm-label">Class Name</label><input class="cm-input" id="cm-new-name" value="' +
      esc(preName) +
      '" placeholder="e.g. English 10" autofocus></div>' +
      '<div style="display:flex;gap:16px"><div class="cm-field" style="flex:1"><label class="cm-label">Grade Level</label><input class="cm-input" id="cm-new-grade" value="' +
      esc(preGrade) +
      '" placeholder="e.g. 8, 10-12"></div></div>' +
      '<div class="cm-field"><label class="cm-label">Description</label><textarea class="cm-textarea" id="cm-new-desc" placeholder="Optional"></textarea></div></div>';

    html +=
      '<div class="cm-section"><div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field"><label class="cm-label">Grading System</label>' +
      // T-UI-02 · wizard grading_system picker. Letter/Both are hidden in
      // the create wizard (no categories exist yet) — teacher picks them
      // later in Course Settings after adding at least one category.
      '<div class="cm-seg" id="cm-cg-grading">' +
      '<button class="cm-seg-btn active" data-val="proficiency" data-action="cmCreateToggle" data-group="cm-cg-grading">Proficiency</button>' +
      '<button class="cm-seg-btn cm-seg-btn-disabled" data-val="letter" disabled title="Add a category in Course Settings first \u2192">Letter</button>' +
      '<button class="cm-seg-btn cm-seg-btn-disabled" data-val="both" disabled title="Add a category in Course Settings first \u2192">Both</button>' +
      '</div>' +
      '<div class="cm-hint cm-seg-hint-locked">Create categories in Course Settings to unlock Letter and Both.</div>' +
      '</div>' +
      '<div class="cm-field"><label class="cm-label">Calculation Method</label>' +
      '<div class="cm-seg" id="cm-cg-calc">' +
      CALC_METHODS.map(function (m) {
        var action = m.value === 'decayingAvg' ? 'cmCreateToggleDecay' : 'cmCreateToggle';
        var isActive = m.value === (cwStep2Calc || 'mostRecent');
        return (
          '<button class="cm-seg-btn' +
          (isActive ? ' active' : '') +
          '" data-val="' +
          m.value +
          '" data-action="' +
          action +
          '" data-group="cm-cg-calc">' +
          m.label +
          '</button>'
        );
      }).join('') +
      '</div></div>' +
      '<div id="cm-cg-decay" class="cm-field" style="display:none"><label class="cm-label">Decay Weight</label>' +
      '<div class="cm-slider-row"><input type="range" min="10" max="95" value="65" id="cm-cg-decay-slider" style="flex:1"><span class="cm-slider-label">65%</span></div>' +
      '<div class="cm-hint">Higher values weight recent scores more heavily.</div></div>' +
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

    html +=
      '<div class="cm-section"><div class="cm-section-title">Review</div>' +
      '<div class="cm-field"><label class="cm-label">Class Name</label><div style="font-size:var(--text-lg);font-weight:600;color:var(--text)">' +
      esc(className || 'Untitled') +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Grade</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(gradeLevel || '\u2014') +
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
    cwStep2Grade = document.getElementById('cm-new-grade')?.value || '';
    cwStep2Desc = document.getElementById('cm-new-desc')?.value || '';
    cwStep2Grading = (document.querySelector('#cm-cg-grading .cm-seg-btn.active') || {}).dataset?.val || 'proficiency';
    cwStep2Calc = (document.querySelector('#cm-cg-calc .cm-seg-btn.active') || {}).dataset?.val || 'mostRecent';
    cwStep2Decay = document.getElementById('cm-cg-decay-slider')?.value || '65';
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
      gradeLevel: (cwStep2Grade || (cwSelectedGrade ? String(cwSelectedGrade) : '')).trim(),
      description: (cwStep2Desc || '').trim(),
      gradingSystem: cwStep2Grading,
      calcMethod: cwStep2Calc,
      decayWeight: parseInt(cwStep2Decay, 10) / 100,
    });

    var cc = getCourseConfig(course.id);
    cc.calcMethod = cwStep2Calc;
    cc.decayWeight = parseInt(cwStep2Decay, 10) / 100;
    saveCourseConfig(course.id, cc);

    var dispatchOk = true;
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var map = buildLearningMapFromTags(cwSelectedTags);
      if (map) {
        saveLearningMap(course.id, map);
        updateCourse(course.id, { curriculumTags: cwSelectedTags.slice() });
        // _dispatchMapToV2 short-circuits on a non-canonical course id
        // (createCourse fires create_course async; the rekey to a UUID
        // hasn't landed yet at this point). Wait for the canonical id,
        // mirror the learning map under it, then dispatch.
        var canonicalCid = await _awaitCanonicalCourse(course.id, 10000);
        if (canonicalCid && canonicalCid !== course.id) {
          saveLearningMap(canonicalCid, map);
          course.id = canonicalCid;
        }
        if (canonicalCid) {
          dispatchOk = await _dispatchMapToV2(canonicalCid, map, false);
        } else {
          dispatchOk = false;
        }
      }
    }

    cmSelectedCourse = course.id;
    cmMode = 'edit';
    _activeCourse = course.id;
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
    document.querySelectorAll('#' + containerId + ' .cm-seg-btn').forEach(function (b) {
      b.classList.remove('active');
    });
    btn.classList.add('active');
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
    updateCourse(cmSelectedCourse, { [field]: value.trim() });
    var nameEl = document.querySelector('.cm-class-item.selected .cm-class-name');
    if (field === 'name' && nameEl) nameEl.textContent = value.trim();
  }

  // T-UI-02 helpers ──────────────────────────────────────────────────
  // Default grading_system by grade level: 8–9 → proficiency, 10–12 → letter.
  // Falls back to proficiency when the grade isn't a number we recognize.
  function _cmDefaultGradingSystem(course) {
    var gl = parseInt((course && course.gradeLevel) || '', 10);
    if (!isNaN(gl) && gl >= 10 && gl <= 12) return 'letter';
    return 'proficiency';
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
      both: 'Both pipelines run side by side: proficiency (1\u20134) drives the competency view and the dashboard overview; letter + percentage (derived from categories and the BC conversion tables) drive reports for grades 10\u201312. Useful when a teacher wants the competency lens day-to-day but the parent-facing report card still needs letter grades.',
    };
    return esc(map[gs] || map.proficiency);
  }

  // Does the course have at least one assessment Category (T-UI-12)?
  // After T-UI-12, _cmCategoryState is the source of truth. Falls back to
  // _cache.v2Gradebook.categories / assessment.category_id so the disabled
  // state is correct even before list_categories has resolved.
  function _cmHasCategories(cid) {
    if (!cid) return false;
    try {
      // Only count SAVED rows (rows with a server-issued id). Transient
      // blank rows from a recent "+ Add category" click don't count —
      // otherwise the Letter/Both segments would enable immediately on
      // click, before the teacher has typed anything meaningful.
      var rows = (_cmCategoryState[cid] && _cmCategoryState[cid].rows) || [];
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].id && (rows[j].name || '').trim()) return true;
      }
      var gb = (typeof _cache !== 'undefined' && _cache.v2Gradebook && _cache.v2Gradebook[cid]) || null;
      if (gb && Array.isArray(gb.categories) && gb.categories.length > 0) return true;
      var assArr = typeof getAssessments === 'function' ? getAssessments(cid) : [];
      for (var i = 0; i < (assArr || []).length; i++) {
        if (assArr[i] && assArr[i].category_id) return true;
      }
    } catch (e) {
      /* best-effort detection */
    }
    return false;
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
  function _cmMirrorCategoriesToCache(cid) {
    if (!cid || typeof saveCategories !== 'function') return;
    var st = _cmCatState(cid);
    var camelRows = (st.rows || []).map(function (r) {
      return {
        id: r.id,
        name: r.name || '',
        weight: Number(r.weight) || 0,
        displayOrder: Number(r.display_order) || 0,
      };
    });
    saveCategories(cid, camelRows);
  }

  function _cmLoadCategories(cid) {
    if (!cid) return;
    var st = _cmCatState(cid);
    if (st.loaded || st.loading) return;
    if (!window.v2 || !window.v2.listCategories || !_useSupabase) {
      st.loaded = true;
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

  function _cmRenderCategoriesField(cid) {
    if (!cid) return '';
    var st = _cmCatState(cid);
    if (!st.loaded && !st.loading)
      setTimeout(function () {
        _cmLoadCategories(cid);
      }, 0);

    var rows = st.rows || [];
    var sum = _cmCatSum(cid);
    var over = sum > 100;
    var sumClass = over ? 'cm-cat-sum cm-cat-sum-over' : 'cm-cat-sum';
    var html =
      '<div class="cm-field cm-cat-field">' +
      '<label class="cm-label">Categories</label>' +
      '<div class="cm-cat-list">';
    if (rows.length === 0) {
      html +=
        '<div class="cm-hint" style="padding:6px 0">No categories yet. Add one to weight assessments and unlock Letter / Both grading.</div>';
    }
    rows.forEach(function (row, idx) {
      html +=
        '<div class="cm-cat-row"' +
        (row.id ? ' draggable="true" data-cat-drag="' + row.id + '"' : '') +
        '>' +
        '<span class="cm-cat-handle" aria-hidden="true">\u22EE\u22EE</span>' +
        '<input class="cm-input cm-cat-name" value="' +
        esc(row.name) +
        '" placeholder="Category name" data-action-blur="cmCatName" data-idx="' +
        idx +
        '">' +
        '<input class="cm-input cm-cat-weight" type="number" min="0" max="100" step="1" value="' +
        (row.weight != null ? row.weight : '') +
        '" data-action-blur="cmCatWeight" data-action-input="cmCatWeightLive" data-idx="' +
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
      '<div class="cm-cat-footer">' +
      '<button class="cm-add-link" data-action="cmCatAdd">+ Add category</button>' +
      '<div class="' +
      sumClass +
      '" id="cm-cat-sum-' +
      cid +
      '">' +
      'Sum: <strong>' +
      sum +
      '</strong> / 100%' +
      (over ? ' <span class="cm-cat-sum-warn">(reduce weights to save)</span>' : '') +
      '</div>' +
      '</div>' +
      '</div>';
    return html;
  }

  function cmCatAdd() {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    st.rows.push({ id: null, name: '', weight: 0, display_order: st.rows.length });
    renderClassManager();
  }

  function cmCatName(idx, value) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    var name = (value || '').trim();
    if (!name) return;
    row.name = name;
    _cmCatPersist(cmSelectedCourse, row);
  }

  function cmCatWeightLive(idx, value) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    var v = parseFloat(value);
    row.weight = isNaN(v) ? 0 : Math.max(0, v); // no hard-clamp to 100 per §12.7
    var sumEl = document.getElementById('cm-cat-sum-' + cmSelectedCourse);
    if (sumEl) {
      var sum = _cmCatSum(cmSelectedCourse);
      var over = sum > 100;
      sumEl.className = over ? 'cm-cat-sum cm-cat-sum-over' : 'cm-cat-sum';
      sumEl.innerHTML =
        'Sum: <strong>' +
        sum +
        '</strong> / 100%' +
        (over ? ' <span class="cm-cat-sum-warn">(reduce weights to save)</span>' : '');
    }
  }

  function cmCatWeight(idx /* , value */) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row || !row.name) return;
    if (_cmCatSum(cmSelectedCourse) > 100) {
      if (typeof showSyncToast === 'function')
        showSyncToast('Category weights exceed 100% — reduce before saving.', 'info');
      return;
    }
    _cmCatPersist(cmSelectedCourse, row);
  }

  function cmCatDelete(idx) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    st.rows.splice(idx, 1);
    if (row.id && window.v2 && window.v2.deleteCategory) window.v2.deleteCategory(row.id);
    _cmMirrorCategoriesToCache(cmSelectedCourse);
    renderClassManager();
  }

  function _cmCatPersist(cid, row) {
    if (!window.v2 || !window.v2.upsertCategory) {
      renderClassManager();
      return;
    }
    window.v2
      .upsertCategory({
        id: row.id,
        courseId: cid,
        name: row.name,
        weight: row.weight,
        displayOrder: row.display_order,
      })
      .then(function (res) {
        if (res && !res.error) {
          if (!row.id && res.data) row.id = res.data;
          _cmMirrorCategoriesToCache(cid);
          renderClassManager();
        }
      });
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
    // Block letter / both when the course has no assessment categories —
    // INSTRUCTIONS.md §12.9 / §2.1 U2 / Q11=A. Proficiency always writes.
    if ((val === 'letter' || val === 'both') && !_cmHasCategories(cmSelectedCourse)) {
      if (typeof showSyncToast === 'function') {
        showSyncToast('Create a category first — Letter and Both require at least one assessment category.', 'info');
      }
      return;
    }
    updateCourse(cmSelectedCourse, { gradingSystem: val });
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
        _dispatchMapToV2(cid, map, false);
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
        _dispatchMapToV2(cid, existing, false);
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
      html += '<div class="cm-section"><div class="cm-section-title">Re-link to BC Curriculum</div>';

      if (!cwCurriculumLoaded && !cwLoadError) {
        html += '<div class="cw-empty-msg">Loading BC Curriculum data\u2026</div>';
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

      html += '<div class="cm-section"><div class="cm-section-title">Confirm Curriculum Change</div>';

      html += '<div class="cm-field"><label class="cm-label">New Curriculum Link</label>';
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
        setActiveCourse(nextActive);
      }
    }
    renderClassManager();
  }

  function cmDuplicateCourse(sourceCid) {
    var src = COURSES[sourceCid];
    if (!src) return;
    var newCourse = createCourse({
      name: src.name + ' (Copy)',
      gradeLevel: src.gradeLevel || '',
      description: src.description || '',
      gradingSystem: src.gradingSystem || 'proficiency',
      calcMethod: src.calcMethod || 'mostRecent',
      decayWeight: src.decayWeight || 0.65,
    });
    var srcCC = getCourseConfig(sourceCid);
    if (Object.keys(srcCC).length > 0) {
      saveCourseConfig(newCourse.id, structuredClone(srcCC));
    }
    var srcMap = getLearningMap(sourceCid);
    if (srcMap && (srcMap.subjects?.length || srcMap.sections?.length)) {
      var clone = structuredClone(srcMap);
      clone._customized = true;
      clone._version = 1;
      saveLearningMap(newCourse.id, clone);
      _dispatchMapToV2(newCourse.id, clone, true);
    }
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
    var displayOrder = map.subjects.length - 1;
    saveLearningMap(cid, map);
    renderClassManager();
    window.v2
      .upsertSubject({ id: id, courseId: cid, name: 'New Subject', color: '#6366f1', displayOrder: displayOrder })
      .then(function (res) {
        var canonicalId = res && res.data ? res.data : null;
        if (canonicalId && canonicalId !== id) {
          var m = getLearningMap(cid);
          _patchMapId(cid, m, 'subject', id, canonicalId);
        }
      });
  }

  function cmUpdateSubjectName(subId, val) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sub = map.subjects.find(function (s) {
      return s.id === subId;
    });
    if (sub) {
      sub.name = val.trim();
      saveLearningMap(cid, map);
      window.v2.upsertSubject({ id: subId, courseId: cid, name: val.trim() });
    }
  }

  function cmUpdateSubjectColor(subId, color) {
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
      if (_isCanonicalId(sub.id)) {
        window.v2.upsertSubject({ id: sub.id, courseId: cid, name: sub.name, color: color });
      }
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
    var id = el.dataset.id;
    var color = el.dataset.color;
    if (!cmSelectedCourse) return;
    var map = ensureCustomLearningMap(cmSelectedCourse);
    if (target === 'subject') {
      var sub = map.subjects.find(function (s) {
        return s.id === id;
      });
      if (sub) {
        sub.color = color;
        if (_isCanonicalId(sub.id)) {
          window.v2.upsertSubject({ id: sub.id, courseId: cmSelectedCourse, name: sub.name, color: color });
        }
      }
    } else {
      var sec = map.sections.find(function (s) {
        return s.id === id;
      });
      if (sec) {
        sec.color = color;
        if (_isCanonicalId(sec.id)) {
          window.v2.upsertSection({
            id: sec.id,
            subjectId: sec.subject,
            name: sec.name,
            color: color,
            competencyGroupId: sec.groupId || null,
          });
        }
      }
    }
    saveLearningMap(cmSelectedCourse, map);
    renderClassManager();
  }

  function cmDeleteSubject(subId) {
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
          var deletedSectionIds = map.sections
            .filter(function (s) {
              return s.subject === subId;
            })
            .map(function (s) {
              return s.id;
            });
          map.subjects = map.subjects.filter(function (s) {
            return s.id !== subId;
          });
          map.sections = map.sections.filter(function (s) {
            return s.subject !== subId;
          });
          saveLearningMap(cid, map);
          renderClassManager();
          if (_isCanonicalId(subId)) window.v2.deleteSubject(subId);
          deletedSectionIds.forEach(function (sid) {
            if (_isCanonicalId(sid)) {
              window.v2.deleteSection(sid);
              window.v2.deleteTag(sid);
            }
          });
        },
      );
    } else {
      map.subjects = map.subjects.filter(function (s) {
        return s.id !== subId;
      });
      saveLearningMap(cid, map);
      renderClassManager();
      if (_isCanonicalId(subId)) window.v2.deleteSubject(subId);
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
    window.v2
      .upsertCompetencyGroup({ id: grpLocalId, courseId: cid, name: grpName, color: grpColor, displayOrder: idx })
      .then(function (res) {
        var canonicalId = res && res.data ? res.data : null;
        if (canonicalId && canonicalId !== grpLocalId) {
          var m = getLearningMap(cid);
          _patchMapId(cid, m, 'group', grpLocalId, canonicalId);
        }
      });
  }

  function cmUpdateCompGroupName(grpId, val) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var g = (map.competencyGroups || []).find(function (x) {
      return x.id === grpId;
    });
    if (g && val.trim()) {
      g.name = val.trim();
      saveLearningMap(cid, map);
      window.v2.upsertCompetencyGroup({ id: grpId, courseId: cid, name: val.trim() });
    }
  }

  function cmUpdateCompGroupColor(grpId, color) {
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
      window.v2.upsertCompetencyGroup({ id: grpId, courseId: cid, color: color });
    }
  }

  function cmDeleteCompGroup(grpId) {
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
      if (_isCanonicalId(grpId)) window.v2.deleteCompetencyGroup(grpId);
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
    window.v2.upsertSection({ id: secId, competencyGroupId: groupId || null });
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
    var displayOrder = map.sections.length - 1;
    saveLearningMap(cid, map);
    renderClassManager();
    requestAnimationFrame(function () {
      var el = document.getElementById('cm-sec-' + stdId);
      if (el) {
        el.classList.add('open');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    // Ensure subject is canonical before inserting section (subjectId FK must be UUID)
    var subjObj = map.subjects.find(function (s) {
      return s.id === subId;
    });
    var subjectRpc = _isCanonicalId(subId)
      ? Promise.resolve({ data: subId })
      : window.v2
          .upsertSubject({ id: subId, courseId: cid, name: subjObj ? subjObj.name : 'General', displayOrder: 0 })
          .then(function (res) {
            var canon = res && res.data ? res.data : null;
            if (canon && canon !== subId) _patchMapId(cid, getLearningMap(cid), 'subject', subId, canon);
            return res;
          });
    subjectRpc
      .then(function (subRes) {
        var canonicalSubjectId = subRes && subRes.data ? subRes.data : subId;
        return window.v2.upsertSection({
          id: stdId,
          subjectId: canonicalSubjectId,
          name: 'New Standard',
          color: colour,
          displayOrder: displayOrder,
        });
      })
      .then(function (secRes) {
        var canonicalSectionId = secRes && secRes.data ? secRes.data : null;
        if (canonicalSectionId && canonicalSectionId !== stdId) {
          _patchMapId(cid, getLearningMap(cid), 'section', stdId, canonicalSectionId);
        }
        var finalSectionId = canonicalSectionId || stdId;
        return window.v2.upsertTag({
          id: stdId,
          sectionId: finalSectionId,
          label: 'New Standard',
          code: stdId,
          iCanText: '',
          displayOrder: 0,
        });
      });
  }

  function cmUpdateStdName(secId, val) {
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
    window.v2.upsertSection({ id: secId, name: trimmed });
    var tag = sec.tags[0];
    if (tag) window.v2.upsertTag({ id: tag.id, sectionId: secId, label: tag.label || trimmed });
  }

  function cmUpdateStdSubject(secId, subId) {
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
    window.v2.upsertSection({ id: secId, subjectId: subId });
  }

  function cmUpdateStdColor(secId, color) {
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
    if (_isCanonicalId(sec.id)) {
      window.v2.upsertSection({
        id: sec.id,
        subjectId: sec.subject,
        name: sec.name,
        color: color,
        competencyGroupId: sec.groupId || null,
      });
    }
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
        map.sections = map.sections.filter(function (s) {
          return s.id !== secId;
        });
        saveLearningMap(cid, map);
        renderClassManager();
        if (_isCanonicalId(secId)) {
          window.v2.deleteSection(secId);
          window.v2.deleteTag(secId);
        }
      },
    );
  }

  function cmUpdateStdLabel(secId, val) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (sec && sec.tags[0]) {
      sec.tags[0].label = val.trim();
      saveLearningMap(cid, map);
      window.v2.upsertTag({ id: sec.tags[0].id, sectionId: secId, label: val.trim() });
    }
  }

  function cmUpdateStdText(secId, val) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (sec && sec.tags[0]) {
      sec.tags[0].text = val.trim();
      saveLearningMap(cid, map);
      window.v2.upsertTag({ id: sec.tags[0].id, sectionId: secId, iCanText: val.trim() });
    }
  }

  // Updates the user-facing tag.code (e.g. "RD1", "ENG10A") for a standard.
  // Pre-V2 this used to rename the section/tag local IDs, fanning out updates
  // to assessment.tagIds and score.tagId references; post-V2 those IDs are
  // server-owned UUIDs that the database authoritatively holds, and the
  // user-visible code is its own column. This implementation just updates
  // tag.code locally and pushes that single column change via upsert_tag.
  function cmUpdateStdCode(secId, val) {
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
    if (window.v2 && window.v2.upsertTag && _isCanonicalId(tag.id) && _isCanonicalId(sec.id)) {
      window.v2.upsertTag({
        id: tag.id,
        sectionId: sec.id,
        label: tag.label || tag.name || newCode,
        code: newCode,
        iCanText: tag.text || '',
        displayOrder: tag.displayOrder != null ? tag.displayOrder : 0,
      });
    }
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
      cmCatAdd: function () {
        cmCatAdd();
      },
      cmCatDelete: function () {
        cmCatDelete(parseInt(el.dataset.idx, 10));
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
      cmToggleArchive: function () {
        cmToggleArchive(el.dataset.cid);
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
    if (el.dataset.actionInput === 'cmDecaySlider') {
      cmUpdateDecay(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmCatWeightLive') {
      cmCatWeightLive(parseInt(el.dataset.idx, 10), el.value);
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

  function handleBlur(el) {
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
    if (el.dataset.actionBlur === 'cmCatName') {
      cmCatName(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmCatWeight') {
      cmCatWeight(parseInt(el.dataset.idx, 10), el.value);
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
    closeClassManager: closeClassManager,
    renderClassManager: renderClassManager,
    handleAction: handleAction,
    handleInput: handleInput,
    handleChange: handleChange,
    handleBlur: handleBlur,
    initDrag: function () {
      _initCmStdDrag();
      _initCmCatDrag();
    },
    destroy: _removeAllListeners,
    resetState: function () {
      classManagerOpen = false;
      cmMode = 'edit';
      cmSelectedCourse = _activeCourse;
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
      cwStep2Grading = 'proficiency';
      cwStep2Calc = 'mostRecent';
      cwStep2Decay = '65';
      _cmCollapsedStdFolders = {};
      _cmOpenStdCards = {};
    },
  };
})();
