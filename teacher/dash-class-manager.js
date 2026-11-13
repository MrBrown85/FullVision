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
    closeColorPop();
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
  // details | students | questionnaires | grading | terms | competencies,
  // and student-page where that tab is shown (CM_TABS).
  var cmTab = 'details';

  // Curriculum Wizard state
  var cwStep = 1;
  var cwSelectedGrade = null;
  var cwSelectedSubject = null;
  var cwSelectedTags = [];
  var cwCurriculumLoaded = false;
  var cwLoadError = false;

  // Class Manager student editing
  var cmEditingStudentId = null;

  // Students tab roster: sort, search, and each class's guardians by enrollment
  var cmRosterSortMode = 'lastName';
  var cmRosterQuery = '';
  var _cmGuardians = {};
  var _cmGuardiansLoaded = {};
  var _cmGuardiansReady = {};
  var _cmGuardiansLoading = {};

  // Import preview
  var cmPendingImport = null;
  var cmImportFormatOpen = false; // Import Roster's strip, for a class with students
  var cmImportError = null; // { kind: 'excel' | 'empty', fileName }
  var cmImportDone = null; // the Done panel: { cid, added, blanks, counts, undone }
  var cmRosterOnly = null; // Show Them: the roster shows only these students

  // Relink
  var cmRelinkCid = null;
  var cmRelinkStep = 0;

  // Standard folder collapse state
  var _cmCollapsedStdFolders = {};
  var _cmOpenStdCards = {};

  // Card state that lives outside the learning map: which cards are editing
  // their wording, and the I Can statement being dragged.
  var _cmWordingEdit = {};
  // Cards whose Levels are open for Write Your Own, by section id.
  var _cmLevelsEdit = {};
  var _cmLevelsBankAsked = false;
  var _cmIcanDrag = null;

  // The same code the gradebook heads the column with.
  function _cmStdCode(tag) {
    if (!tag) return '';
    return tag.code || (tag.id && !_UUID_RE_CM.test(tag.id) ? tag.id : '') || tag.shortName || '';
  }

  function _cmStdIsEdited(tag) {
    return !!(tag && tag.source_text && (tag.text || '').trim() !== tag.source_text.trim());
  }

  /* The read-only line under a competency's wording: where it came from.
     From the rebuilt bank, the course and the Ministry's own headings,
     looked up by its bank id ("BC Curriculum · Drafting 10 · Applied
     Design › Prototyping"); the bank loads the first time it's needed. From
     the old bank, its heading; hand-made, its category. */
  function _cmStdSource(sec, tag, subName) {
    if (tag.bank_id) {
      var place = _cmBankPlace(tag.bank_id);
      if (place)
        return ['BC Curriculum', place.course]
          .concat(place.path.length ? [place.path.join(' \u203A ')] : [])
          .join(' · ');
      return 'BC Curriculum' + (subName ? ' · ' + subName : '');
    }
    return (tag.source_text ? 'BC Curriculum' : 'Category') + (sec.name ? ' · ' + sec.name : '');
  }

  var _cmBankPlaces = null;
  var _cmBankPlacesOf = null;
  var _cmBankLoading = false;
  function _cmBankPlace(bankId) {
    if (!CURRICULUM_INDEX) {
      if (!_cmBankLoading && typeof loadCurriculumIndex === 'function') {
        _cmBankLoading = true;
        loadCurriculumIndex().then(function (idx) {
          _cmBankLoading = false;
          if (idx && classManagerOpen && cmMode === 'edit') _cmRenderWithScroll();
        });
      }
      return null;
    }
    if (!_cmBankPlaces || _cmBankPlacesOf !== CURRICULUM_INDEX) {
      _cmBankPlaces = {};
      _cmBankPlacesOf = CURRICULUM_INDEX;
      Object.keys(CURRICULUM_INDEX).forEach(function (key) {
        var course = CURRICULUM_INDEX[key];
        (course.categories || []).forEach(function (cat) {
          var path = Array.isArray(cat.path) ? cat.path : cat.folder ? [cat.name] : [];
          (cat.competencies || []).forEach(function (comp) {
            if (comp.id) _cmBankPlaces[comp.id] = { course: course.course_name, path: path };
          });
        });
      });
    }
    return _cmBankPlaces[bankId] || null;
  }

  function _cmRenderStdCard(sec, lm, compGroups) {
    if (cmCompSelect) return _cmRenderStdSelectRow(sec);
    var tag = sec.tags[0] || {};
    var subs = lm.subjects || [];
    var sub = subs.find(function (s) {
      return s.id === sec.subject;
    });
    var subName = sub ? sub.name : '';
    var subColor = sub ? sub.color : 'var(--text-3)';
    // A card opened under its local id stays open once the id is re-keyed.
    var isOpen = _cmStdCardOpen(sec.id);
    var title = tag.label || sec.shortName || sec.name || '';
    var code = _cmStdCode(tag);
    var icans = tag.i_can_statements || [];
    var edited = _cmStdIsEdited(tag);
    var editing = !!_cmWordingEdit[sec.id];
    var chipColor = sec.color || subColor;
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
      // Always present (hidden when empty) so typing a code can fill it in.
      '<span class="cm-std-code" style="--chip:' +
      chipColor +
      '" data-fallback="' +
      esc(code) +
      '"' +
      (code ? '' : ' hidden') +
      '>' +
      esc(code) +
      '</span>' +
      '<span class="cm-std-titles"><span class="cm-std-label" data-fallback="' +
      esc(sec.shortName || sec.name || '') +
      '">' +
      esc(title) +
      '</span>' +
      // The wording's first line, so names that sound alike can be told
      // apart without opening the card.
      (tag.text ? '<span class="cm-std-line">' + esc(tag.text) + '</span>' : '') +
      '</span>' +
      '<span class="cm-std-meta">' +
      (edited ? '<span class="cm-std-flag">Wording Edited</span>' : '') +
      (icans.length ? '<span class="cm-std-count">' + icans.length + ' I Can</span>' : '') +
      '</span>' +
      '<span class="cm-std-tools" data-stop-prop="true">' +
      '<button type="button" class="cm-std-help-btn" data-action="cmStdHelp" data-secid="' +
      sec.id +
      '"><span class="cm-std-help-icon" aria-hidden="true">?</span>Where These Appear</button>' +
      '<span class="cm-std-menu-wrap">' +
      '<button type="button" class="cm-std-icon-btn" data-action="cmStdMenu" data-secid="' +
      sec.id +
      '" aria-label="More actions for ' +
      esc(title) +
      '" aria-haspopup="menu" aria-expanded="false">⋯</button>' +
      '<div class="cm-std-menu" role="menu" hidden>' +
      (edited
        ? '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmStdRestoreWording" data-secid="' +
          sec.id +
          '">Restore Original Wording</button>'
        : '') +
      '<button type="button" role="menuitem" class="cm-std-menu-item danger" data-action="cmDeleteStd" data-secid="' +
      sec.id +
      '">Remove from Class…</button>' +
      '</div>' +
      '</span>' +
      '</span>' +
      '<span class="cm-std-chevron" aria-hidden="true">▸</span>' +
      '</div>' +
      '<div class="cm-std-body">' +
      '<div class="cm-std-row">' +
      '<div class="cm-std-field"><label class="cm-label" for="cm-std-title-' +
      sec.id +
      '">Title</label>' +
      '<input class="cm-input cm-std-title-input" id="cm-std-title-' +
      sec.id +
      '" value="' +
      esc(title) +
      '" data-stop-prop="true" data-action-input="cmStdLabelLive" data-action-blur="cmStdLabel" data-secid="' +
      sec.id +
      '"></div>' +
      '<div class="cm-std-field cm-std-field-code"><label class="cm-label" for="cm-std-code-' +
      sec.id +
      '">Code</label>' +
      '<input class="cm-input cm-std-code-input" id="cm-std-code-' +
      sec.id +
      '" value="' +
      esc(code) +
      '" maxlength="6" style="--chip:' +
      chipColor +
      '" data-stop-prop="true" data-action-input="cmStdCodeLive" data-action-blur="cmStdCode" data-secid="' +
      sec.id +
      '"></div>' +
      '</div>' +
      '<div class="cm-std-section">' +
      '<div class="cm-std-section-head">' +
      '<span class="cm-label cm-std-section-label" id="cm-std-wording-label-' +
      sec.id +
      '">Curricular Competency</span>' +
      (editing
        ? ''
        : '<button type="button" class="cm-std-link" data-action="cmStdEditWording" data-secid="' +
          sec.id +
          '">Edit Wording</button>') +
      '</div>' +
      (editing
        ? '<textarea class="cm-textarea cm-std-wording-input" aria-labelledby="cm-std-wording-label-' +
          sec.id +
          '" data-stop-prop="true" data-action-blur="cmStdText" data-secid="' +
          sec.id +
          '">' +
          esc(tag.text || '') +
          '</textarea>'
        : '<div class="cm-std-wording">' +
          (tag.text ? '<p>' + esc(tag.text) + '</p>' : '<p class="cm-std-wording-empty">No wording yet.</p>') +
          '<span class="cm-std-source">' +
          esc(_cmStdSource(sec, tag, subName)) +
          (edited ? ' · Edited' : '') +
          '</span>' +
          '</div>') +
      '</div>' +
      '<div class="cm-std-section">' +
      '<div class="cm-std-section-head"><span class="cm-label cm-std-section-label">I Can Statements</span></div>' +
      '<div class="cm-ican-list" data-secid="' +
      sec.id +
      '">' +
      icans
        .map(function (stmt, i) {
          return (
            '<div class="cm-ican-row" data-idx="' +
            i +
            '">' +
            '<span class="cm-ican-grip" draggable="true" data-secid="' +
            sec.id +
            '" data-idx="' +
            i +
            '" title="Drag to reorder" aria-hidden="true">⠿</span>' +
            '<textarea class="cm-ican-text" rows="' +
            Math.max(1, Math.ceil(String(stmt).length / 80)) +
            '" aria-label="I Can statement ' +
            (i + 1) +
            '" data-stop-prop="true" data-action-blur="cmIcanEdit" data-secid="' +
            sec.id +
            '" data-idx="' +
            i +
            '">' +
            esc(stmt) +
            '</textarea>' +
            '<button type="button" class="cm-ican-delete" data-action="cmIcanDelete" data-secid="' +
            sec.id +
            '" data-idx="' +
            i +
            '" aria-label="Delete this statement">✕</button>' +
            '</div>'
          );
        })
        .join('') +
      '<div class="cm-ican-row cm-ican-add">' +
      '<span class="cm-ican-plus" aria-hidden="true">+</span>' +
      '<input class="cm-ican-new" placeholder="Add a statement, then press Enter" aria-label="Add an I Can statement" data-stop-prop="true" data-action-blur="cmIcanAdd" data-secid="' +
      sec.id +
      '">' +
      '</div>' +
      '</div>' +
      _cmLevelsHtml(sec, tag) +
      // Where the statements print today: reports show the first one.
      (icans.length
        ? '<div class="cm-std-shown"><span class="cm-std-shown-label">Shown in:</span>' +
          '<span class="cm-std-shown-chip">Printed Reports \u00B7 first statement</span>' +
          '<span class="cm-std-shown-chip">Rubric Drafts</span>'
        : '<div class="cm-std-shown"><span class="cm-std-ican-none">No I Can statements yet. Reports print nothing for this competency until you add one.</span>') +
      '<button type="button" class="cm-add-link" data-action="cmStdHelp" data-secid="' +
      sec.id +
      '">Where These Appear</button></div>' +
      '</div>' +
      '<div class="cm-std-foot">' +
      (compGroups.length > 0
        ? '<label class="cm-label cm-std-foot-label" for="cm-std-folder-' +
          sec.id +
          '">Folder</label>' +
          '<select class="cm-input cm-std-foot-select" id="cm-std-folder-' +
          sec.id +
          '" data-stop-prop="true" data-action-change="cmStdGroup" data-secid="' +
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
          '</select>'
        : '') +
      (subs.length > 1
        ? '<label class="cm-label cm-std-foot-label" for="cm-std-course-' +
          sec.id +
          '">Course</label>' +
          '<select class="cm-input cm-std-foot-select" id="cm-std-course-' +
          sec.id +
          '" data-stop-prop="true" data-action-change="cmStdSubject" data-secid="' +
          sec.id +
          '">' +
          subs
            .map(function (s) {
              return (
                '<option value="' +
                s.id +
                '"' +
                (s.id === sec.subject ? ' selected' : '') +
                '>' +
                esc(s.name) +
                '</option>'
              );
            })
            .join('') +
          '</select>'
        : '') +
      '<span class="cm-label cm-std-foot-label">Colour</span>' +
      '<div class="cm-std-swatch-wrap">' +
      '<div class="cm-color-swatch-selected cm-std-swatch" style="background:' +
      sec.color +
      '" role="button" tabindex="0" aria-label="Change colour" data-action="cmToggleColorPalette" data-target="section" data-secid="' +
      sec.id +
      '"></div>' +
      '<div class="cm-color-palette" id="cm-palette-section-' +
      sec.id +
      '"></div>' +
      '</div>' +
      '</div>' +
      '</div></div>';
    return html;
  }

  /* ── Where These Appear: teacher/cm-std-help.js ── */
  CmStdHelp.configure({
    selectedCourse: function () {
      return cmSelectedCourse;
    },
    stdCode: _cmStdCode,
    currentId: _currentId,
  });
  var cmShowStdHelp = CmStdHelp.cmShowStdHelp;

  function _cmStdCardOpen(secId) {
    return (
      !!_cmOpenStdCards[secId] ||
      Object.keys(_cmOpenStdCards).some(function (k) {
        return _cmOpenStdCards[k] && k !== secId && _currentId('section', k) === secId;
      })
    );
  }

  function cmToggleStdCard(secId) {
    var open = !_cmStdCardOpen(secId);
    // Forget the key it was opened under before its id was re-keyed.
    Object.keys(_cmOpenStdCards).forEach(function (k) {
      if (_currentId('section', k) === secId) delete _cmOpenStdCards[k];
    });
    _cmOpenStdCards[secId] = open;
    var card = document.getElementById('cm-std-' + secId);
    if (card) card.classList.toggle('open', open);
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
    _addDocListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.cm-std-menu-wrap')) _cmCloseStdMenus();
    });
    // A class list dropped on Import Roster's drop place reads like Choose
    // File. Files dropped anywhere else are left to the browser.
    var dropZone = function (e) {
      var files = e.dataTransfer && e.dataTransfer.types;
      if (!files || Array.prototype.indexOf.call(files, 'Files') < 0) return null;
      return e.target.closest ? e.target.closest('.cm-import-drop') : null;
    };
    _addDocListener('dragover', function (e) {
      var zone = dropZone(e);
      if (!zone) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      zone.classList.add('is-over');
    });
    _addDocListener('dragleave', function (e) {
      var zone = e.target.closest && e.target.closest('.cm-import-drop');
      if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('is-over');
    });
    _addDocListener('drop', function (e) {
      var zone = dropZone(e);
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('is-over');
      var file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) cmHandleCSV({ files: [file], value: '' });
    });
    // The column menu: ↑ ↓ move through the choices, Escape closes it.
    _addDocListener('keydown', function (e) {
      var menu = e.target.closest && e.target.closest('.cm-import-field-menu');
      if (!menu) return;
      var items = Array.prototype.slice.call(menu.querySelectorAll('.cm-std-menu-item'));
      var at = items.indexOf(e.target);
      var to = -1;
      if (e.key === 'ArrowDown') to = (at + 1) % items.length;
      else if (e.key === 'ArrowUp') to = (at - 1 + items.length) % items.length;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = items.length - 1;
      else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        var btn = menu.parentElement.querySelector('[aria-haspopup="menu"]');
        _cmCloseStdMenus();
        if (btn) btn.focus();
        return;
      }
      if (to < 0) return;
      e.preventDefault();
      items[to].focus();
    });
    _addDocListener('dragstart', function (e) {
      // An I Can statement's grip reorders it within its own card.
      var grip = e.target.closest && e.target.closest('.cm-ican-grip');
      if (grip) {
        _cmIcanDrag = { secId: grip.dataset.secid, idx: Number(grip.dataset.idx) };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'ican');
        var row = grip.closest('.cm-ican-row');
        if (row) row.classList.add('dragging');
        return;
      }
      var card = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (!card) return;
      _cmDragStdId = card.dataset.stdDrag;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _cmDragStdId);
    });
    _addDocListener('dragover', function (e) {
      if (_cmIcanDrag) {
        var over = e.target.closest && e.target.closest('.cm-ican-row[data-idx]');
        var list = over && over.closest('.cm-ican-list');
        document.querySelectorAll('.cm-ican-row.drop-target').forEach(function (r) {
          if (r !== over) r.classList.remove('drop-target');
        });
        if (over && list && list.dataset.secid === _cmIcanDrag.secId) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          over.classList.add('drop-target');
        }
        return;
      }
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
      if (_cmIcanDrag) {
        var onto = e.target.closest && e.target.closest('.cm-ican-row[data-idx]');
        var drag = _cmIcanDrag;
        _cmIcanDrag = null;
        if (!onto) return;
        e.preventDefault();
        cmIcanMove(drag.secId, drag.idx, Number(onto.dataset.idx));
        return;
      }
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
      _cmIcanDrag = null;
      document.querySelectorAll('.cm-ican-row.dragging, .cm-ican-row.drop-target').forEach(function (r) {
        r.classList.remove('dragging', 'drop-target');
      });
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

  // Choose Competencies: bank ids the teacher unticked, the preset picked
  // in Choose Courses (Humanities 8), and the review's grading switches
  // (null: the default for one course or a combined class).
  var cwSkipped = {},
    cwPreset = null,
    cwFoldersOn = null,
    cwCoursesEqual = null;
  // Presets that tick more than one course, in Choose Courses.
  var CW_PRESETS = [{ id: 'HUM8', name: 'Humanities 8', grade: 8, tags: ['ELA8', 'SS8'] }];

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
    var cid = cmSelectedCourse;
    if (!cid) return;
    // Photos of their work go too (S8-F1, Colin's ruling 102).
    return _cmPhotosBeforeDelete(cid, function (who, maybe) {
      if (cmSelectedCourse !== cid) return;
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
    card.insertBefore(keep, actions);
    keep.querySelector('#cm-keep-copy-btn').addEventListener('click', function (e) {
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
    return window.v2.getWithdrawnStudentRecords(entry.student.id).then(function (res) {
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

  /* ── Class Manager Student Functions ────────────────────── */
  function cmShowAddStudent(added) {
    var form = document.getElementById('cm-add-student-form');
    if (form) {
      form.style.display = 'block';
      var status = document.getElementById('cm-add-status');
      if (status)
        status.textContent = added ? 'Added ' + added + '. Type the next student, or press Escape to close.' : '';
      var el = document.getElementById('cm-add-first');
      if (el) el.focus();
    }
  }

  // Cancel or Escape closes the form and puts the focus back on Add Student.
  function cmCloseAddStudent() {
    var form = document.getElementById('cm-add-student-form');
    if (!form || form.style.display === 'none') return false;
    cmCancelStudent();
    var btn = document.querySelector('.cm-roster-add');
    if (btn) btn.focus();
    return true;
  }

  function cmCancelStudent() {
    cmEditingStudentId = null;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'none';
    var status = document.getElementById('cm-add-status');
    if (status) status.textContent = '';
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

  /* Save closes the form; Save and Add Another (and Enter in a field) keeps
     it open, empty, with the focus in First Name for the next student. */
  function cmSaveStudent(another) {
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
    var adding = !cmEditingStudentId;

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
    // Save and Add Another leaves the form open with the focus in First Name,
    // so a roster can be typed one student after another without the mouse.
    if (adding && another) {
      cmShowAddStudent(((preferred || firstName) + ' ' + lastName).trim());
      return;
    }
    if (adding) {
      var addBtn = document.querySelector('.cm-roster-add');
      if (addBtn) addBtn.focus();
      return;
    }
    requestAnimationFrame(function () {
      var detail = document.querySelector('.cm-detail');
      if (detail) detail.scrollTop = 0;
    });
  }

  function cmRemoveStudent(sid) {
    if (!cmSelectedCourse) return;
    withdrawStudentUI(sid);
  }

  /* ── Students tab: the roster, edited in place ──────────────
     Every field is a box in its row. Enter or ↓ moves down a column, ↑ up,
     Tab across, Escape leaves. A field saves when it loses focus, through
     saveStudents (only the changed fields go to the server), so moving down
     a column saves as it goes. Parent Email and Parent Email 2 are the
     student's first two guardian rows. */
  var ROSTER_COLS = ['last', 'first', 'pref', 'pron', 'num', 'dob', 'email', 'g0', 'g1', 'desig', 'ell'];

  function _cmRosterStudents(cid) {
    return sortStudents(getStudents(cid), cmRosterSortMode === 'firstName' ? 'firstName' : 'lastName');
  }

  function _cmGuardiansFor(cid, sid) {
    var byStudent = _cmGuardians[cid] || {};
    return byStudent[sid] || [];
  }

  /* Loads the class's guardians once per visit to the tab, then fills in
     the Parent Email boxes in place, so a box being typed in keeps focus. */
  function _cmLoadGuardians(cid) {
    if (_cmGuardiansLoaded[cid] || !(window.v2 && window.v2.listCourseGuardians))
      return _cmGuardiansLoading[cid] || Promise.resolve();
    _cmGuardiansLoaded[cid] = true;
    return (_cmGuardiansLoading[cid] = window.v2.listCourseGuardians(cid).then(function (res) {
      // With no server rows (Demo Mode, a failed read) the emails still
      // waiting on the students are all there is; keep what is in memory.
      var rows = res && res.data;
      if (rows) _cmGuardiansReady[cid] = true;
      var byStudent = rows ? {} : _cmGuardians[cid] || {};
      (rows || []).forEach(function (g) {
        var sid = g.enrollment_id;
        if (!byStudent[sid]) byStudent[sid] = [];
        byStudent[sid].push(g);
      });
      Object.keys(byStudent).forEach(function (sid) {
        byStudent[sid].sort(function (a, b) {
          return String(a.created_at || '').localeCompare(String(b.created_at || ''));
        });
      });
      getStudents(cid).forEach(function (st) {
        (st.pendingGuardianEmails || []).forEach(function (email) {
          var mine = (byStudent[st.id] = byStudent[st.id] || []);
          if (
            !mine.some(function (g) {
              return g.email === email;
            })
          )
            mine.push({ name: 'Parent / Guardian', email: email });
        });
      });
      _cmGuardians[cid] = byStudent;
      _cmFlushPendingGuardians(cid);
      if (cmSelectedCourse !== cid) return;
      document
        .querySelectorAll('.cm-rs-row input[data-col="g0"], .cm-rs-row input[data-col="g1"]')
        .forEach(function (inp) {
          if (inp === document.activeElement) return;
          var g = _cmGuardiansFor(cid, inp.dataset.sid)[inp.dataset.col === 'g0' ? 0 : 1];
          inp.value = (g && g.email) || '';
        });
      var sum = document.getElementById('cm-rs-summary');
      if (sum) sum.textContent = _cmRosterSummary(cid);
    }));
  }

  /* A student's first two parent emails ('' for none), once the class's
     guardians are loaded. The Edit Student dialog shows them. */
  function _cmGuardianEmails(cid, sid) {
    return _cmLoadGuardians(cid).then(function () {
      var mine = _cmGuardiansFor(cid, sid);
      return [0, 1].map(function (i) {
        return (mine[i] && mine[i].email) || '';
      });
    });
  }

  function _cmRosterSummary(cid) {
    var students = getStudents(cid);
    var desig = 0,
      ell = 0,
      noParent = 0;
    students.forEach(function (st) {
      var ds = st.designations || [];
      if (
        ds.some(function (c) {
          return !!BC_DESIGNATIONS[c];
        })
      )
        desig++;
      if (ds.indexOf('ELL') >= 0) ell++;
      if (
        _cmGuardiansReady[cid] &&
        !_cmGuardiansFor(cid, st.id).some(function (g) {
          return g.email;
        })
      )
        noParent++;
    });
    var parts = [students.length + (students.length === 1 ? ' student' : ' students')];
    if (desig) parts.push(desig + ' with designations');
    if (ell) parts.push(ell + ' ELL');
    if (noParent) parts.push(noParent + ' missing a parent email');
    return parts.join(' · ');
  }

  function _cmRosterInput(st, col, value, label, extra) {
    return (
      '<input class="cm-rs-in' +
      (col === 'last' || col === 'first' ? ' cm-rs-strong' : '') +
      '" data-col="' +
      col +
      '" data-sid="' +
      esc(st.id) +
      '" data-action-blur="cmRosterField" value="' +
      esc(value || '') +
      '" aria-label="' +
      esc(label + ', ' + fullName(st)) +
      '"' +
      (extra || '') +
      '>'
    );
  }

  function _cmRosterDesigCell(st) {
    var ds = st.designations || [];
    var chips = ds
      .filter(function (code) {
        return !!BC_DESIGNATIONS[code];
      })
      .map(function (code) {
        var d = BC_DESIGNATIONS[code];
        return (
          '<button type="button" class="cm-rs-chip" data-action="cmRosterDesigRemove" data-sid="' +
          esc(st.id) +
          '" data-code="' +
          esc(code) +
          '" title="' +
          esc(code + ' — ' + d.name) +
          '" aria-label="Remove ' +
          esc(code + ' ' + d.name) +
          '"><strong>' +
          esc(code) +
          '</strong> ' +
          esc(d.name) +
          ' <span aria-hidden="true">×</span></button>'
        );
      })
      .join('');
    var hasIep = ds.some(function (c) {
      return BC_DESIGNATIONS[c] && BC_DESIGNATIONS[c].iep;
    });
    var hasMod = ds.some(function (c) {
      return BC_DESIGNATIONS[c] && BC_DESIGNATIONS[c].modified;
    });
    return (
      '<span class="cm-rs-desig">' +
      chips +
      (hasIep ? '<span class="cm-iep-tag">IEP</span>' : '') +
      (hasMod ? '<span class="cm-mod-tag">MOD</span>' : '') +
      '<span class="cm-rs-desig-wrap">' +
      '<button type="button" class="cm-rs-add" data-col="desig" data-sid="' +
      esc(st.id) +
      '" data-action="cmRosterDesigOpen" aria-haspopup="true" aria-expanded="false" aria-label="Add a designation, ' +
      esc(fullName(st)) +
      '">+</button>' +
      '</span>' +
      '</span>'
    );
  }

  function _cmRosterRowHtml(cid, st, i, marks) {
    var g = _cmGuardiansFor(cid, st.id);
    var ell = (st.designations || []).indexOf('ELL') >= 0;
    var name = ((st.firstName || '') + ' ' + (st.lastName || '') + ' ' + (st.preferred || '')).toLowerCase();
    marks = marks || {};
    var isNew = marks.added && marks.added[st.id];
    var out = marks.only && !marks.only[st.id];
    return (
      '<div class="cm-rs-grid cm-rs-row' +
      (i % 2 ? ' cm-rs-alt' : '') +
      (isNew ? ' cm-rs-new' : '') +
      '" data-sid="' +
      esc(st.id) +
      '" data-name="' +
      esc(name) +
      '"' +
      (out || (cmRosterQuery && name.indexOf(cmRosterQuery) < 0) ? ' hidden' : '') +
      '>' +
      '<span class="cm-rs-stick1">' +
      _cmRosterInput(st, 'last', st.lastName, 'Last name') +
      (isNew ? '<span class="cm-rs-new-tag">New</span>' : '') +
      '</span>' +
      '<span class="cm-rs-stick2">' +
      _cmRosterInput(st, 'first', st.firstName, 'First name', ' required') +
      '</span>' +
      _cmRosterInput(st, 'pref', st.preferred, 'Preferred name', ' placeholder="—"') +
      _cmRosterInput(st, 'pron', st.pronouns, 'Pronouns', ' list="cm-rs-pronouns"') +
      _cmRosterInput(st, 'num', st.studentNumber, 'Student number') +
      _cmRosterInput(st, 'dob', st.dateOfBirth, 'Date of birth', ' type="date"') +
      _cmRosterInput(st, 'email', st.email, 'Student email', ' type="email" placeholder="+ Add"') +
      _cmRosterInput(st, 'g0', g[0] && g[0].email, 'Parent email', ' type="email" placeholder="+ Add"') +
      _cmRosterInput(st, 'g1', g[1] && g[1].email, 'Second parent email', ' type="email" placeholder="+ Add"') +
      _cmRosterDesigCell(st) +
      '<span class="cm-rs-check"><input type="checkbox" data-col="ell" data-sid="' +
      esc(st.id) +
      '" data-action-change="cmRosterEll"' +
      (ell ? ' checked' : '') +
      ' aria-label="English language learner, ' +
      esc(fullName(st)) +
      '"></span>' +
      '<span class="cm-std-menu-wrap cm-rs-menu-wrap">' +
      '<button type="button" class="cm-rs-menu" data-action="cmStdMenu" aria-haspopup="menu" aria-expanded="false" aria-label="More for ' +
      esc(fullName(st)) +
      '">⋯</button>' +
      '<div class="cm-std-menu" role="menu" hidden>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmOpenStudentPage" data-sid="' +
      esc(st.id) +
      '">Open Student Page</button>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item danger" data-action="cmRemoveStudent" data-sid="' +
      esc(st.id) +
      '">Withdraw</button>' +
      '</div>' +
      '</span>' +
      '</div>'
    );
  }

  function _cmRosterHtml(cid) {
    var students = _cmRosterStudents(cid);
    var sortBtn = function (mode, label) {
      var on = cmRosterSortMode === mode;
      return (
        '<button type="button" class="cm-rs-sort" data-action="cmRosterSort" data-sort="' +
        mode +
        '" aria-pressed="' +
        on +
        '">' +
        label +
        (on ? ' <span aria-hidden="true">↑</span>' : '') +
        '</button>'
      );
    };
    var html =
      '<datalist id="cm-rs-pronouns">' +
      PRONOUNS_OPTIONS.map(function (p) {
        return '<option value="' + esc(p) + '">';
      }).join('') +
      '</datalist>' +
      '<div class="cm-section cm-roster-section cm-rs-section">' +
      '<div class="cm-rs-scroll cm-student-list">' +
      '<div class="cm-rs-grid cm-rs-head">' +
      '<span class="cm-rs-stick1">' +
      sortBtn('lastName', 'Last Name') +
      '</span>' +
      '<span class="cm-rs-stick2">' +
      sortBtn('firstName', 'First Name') +
      '</span>' +
      '<span>Preferred</span><span>Pronouns</span><span>Student Number</span><span>Date of Birth</span>' +
      '<span>Student Email</span><span>Parent Email</span><span>Parent Email 2</span><span>Designations</span>' +
      '<span>ELL</span><span></span>' +
      '</div>';
    var marks = { added: _cmImportNewIds(cid), only: _cmRosterOnlyIds() };
    var shown = 0;
    students.forEach(function (st) {
      var hide = marks.only && !marks.only[st.id];
      html += _cmRosterRowHtml(cid, st, hide ? 0 : shown++, marks);
    });
    html += '</div></div>';
    return html;
  }

  function cmRosterSort(mode) {
    cmRosterSortMode = mode === 'firstName' ? 'firstName' : 'lastName';
    renderClassManager();
  }

  function cmRosterSearch(q) {
    cmRosterQuery = String(q || '')
      .trim()
      .toLowerCase();
    var n = 0;
    document.querySelectorAll('.cm-rs-row').forEach(function (row) {
      var only = _cmRosterOnlyIds();
      var hit =
        (!only || only[row.dataset.sid]) && (!cmRosterQuery || (row.dataset.name || '').indexOf(cmRosterQuery) >= 0);
      row.hidden = !hit;
      if (hit) row.classList.toggle('cm-rs-alt', n++ % 2 === 1);
    });
  }

  var ROSTER_FIELD = {
    last: 'lastName',
    first: 'firstName',
    pref: 'preferred',
    pron: 'pronouns',
    num: 'studentNumber',
    dob: 'dateOfBirth',
    email: 'email',
  };

  /* A roster box lost focus: save it if it changed. First name can't be
     blank and an email must look like one; either puts the old value back. */
  function cmRosterField(el) {
    var cid = cmSelectedCourse;
    if (!cid) return;
    var col = el.dataset.col;
    var value = (el.value || '').trim();
    if (col === 'g0' || col === 'g1') return _cmSaveGuardianEmail(cid, el, value);
    var key = ROSTER_FIELD[col];
    if (!key) return;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === el.dataset.sid;
    });
    if (!st) return;
    var old = st[key] || '';
    if (value === old) return;
    if ((col === 'first' && !value) || (col === 'email' && value && !el.checkValidity())) {
      el.value = old;
      el.classList.add('cm-rs-bad');
      setTimeout(function () {
        el.classList.remove('cm-rs-bad');
      }, 1600);
      return;
    }
    st[key] = value;
    if (col === 'first' || col === 'last') st.sortName = ((st.lastName || '') + ' ' + (st.firstName || '')).trim();
    saveStudents(cid, students);
    var row = el.closest('.cm-rs-row');
    if (row)
      row.dataset.name = ((st.firstName || '') + ' ' + (st.lastName || '') + ' ' + (st.preferred || '')).toLowerCase();
    var sum = document.getElementById('cm-rs-summary');
    if (sum) sum.textContent = _cmRosterSummary(cid);
  }

  /* What a roster box holds on record now, or null when it isn't a field. */
  function _cmRosterSavedValue(el) {
    var cid = cmSelectedCourse;
    var col = el.dataset.col;
    if (!cid) return null;
    if (col === 'g0' || col === 'g1') {
      var g = _cmGuardiansFor(cid, el.dataset.sid)[col === 'g0' ? 0 : 1];
      return g ? g.email || '' : '';
    }
    var key = ROSTER_FIELD[col];
    if (!key) return null;
    var st = getStudents(cid).find(function (s) {
      return s.id === el.dataset.sid;
    });
    return st ? st[key] || '' : null;
  }

  function _cmSaveGuardianEmail(cid, el, email) {
    var idx = el.dataset.col === 'g0' ? 0 : 1;
    var g = _cmGuardiansFor(cid, el.dataset.sid)[idx];
    if ((g ? g.email || '' : '') === email) return;
    if (email && !el.checkValidity()) {
      el.value = g ? g.email || '' : '';
      el.classList.add('cm-rs-bad');
      setTimeout(function () {
        el.classList.remove('cm-rs-bad');
      }, 1600);
      return;
    }
    _cmSetGuardianEmail(cid, el.dataset.sid, idx, email);
  }

  /* Sets a student's first (idx 0) or second (idx 1) parent email; blank
     removes that guardian. The roster and the Edit Student dialog both save
     through here. */
  function _cmSetGuardianEmail(cid, sid, idx, email) {
    var list = (_cmGuardians[cid] = _cmGuardians[cid] || {});
    var mine = (list[sid] = list[sid] || []);
    var g = mine[idx];
    if ((g ? g.email || '' : '') === email) return;
    var st = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!email) {
      if (g && g.id && window.v2 && window.v2.deleteGuardian) window.v2.deleteGuardian(g.id);
      mine.splice(idx, 1);
    } else if (g) {
      g.email = email;
      if (g.id && _isServerPerson(st))
        window.v2.upsertGuardian({
          id: g.id,
          studentId: st.personId,
          name: g.name,
          relationship: g.relationship,
          email: email,
          phone: g.phone,
          language: g.language,
        });
    } else if (st) {
      // A guardian needs a name; the roster only asks for an address.
      _cmAddGuardianEmail(cid, st, email);
    }
    // A student not on the server yet (or in Demo Mode) keeps its unsent
    // emails on the record, in step with the change.
    if (st && !_isServerPerson(st)) {
      st.pendingGuardianEmails = mine
        .filter(function (x) {
          return !x.id;
        })
        .map(function (x) {
          return x.email;
        });
      if (!st.pendingGuardianEmails.length) delete st.pendingGuardianEmails;
      saveStudents(cid, getStudents(cid));
    }
    var sum = document.getElementById('cm-rs-summary');
    if (sum) sum.textContent = _cmRosterSummary(cid);
  }

  function cmRosterEll(el) {
    var cid = cmSelectedCourse;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === el.dataset.sid;
    });
    if (!st) return;
    var ds = (st.designations || []).filter(function (c) {
      return c !== 'ELL';
    });
    if (el.checked) ds.push('ELL');
    st.designations = ds;
    saveStudents(cid, students);
    var sum = document.getElementById('cm-rs-summary');
    if (sum) sum.textContent = _cmRosterSummary(cid);
  }

  function _cmSetDesignations(sid, ds) {
    var cid = cmSelectedCourse;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;
    st.designations = ds;
    delete st.designation;
    saveStudents(cid, students);
    renderClassManager();
    var add = document.querySelector('.cm-rs-add[data-sid="' + sid + '"]');
    if (add) add.focus();
  }

  function cmRosterDesigRemove(sid, code) {
    var st = getStudents(cmSelectedCourse).find(function (s) {
      return s.id === sid;
    });
    if (!st) return;
    _cmSetDesignations(
      sid,
      (st.designations || []).filter(function (c) {
        return c !== code;
      }),
    );
  }

  /* The + in Designations opens the BC codes under it; picking one adds it. */
  function cmRosterDesigOpen(btn) {
    var wrap = btn.parentElement;
    var open = wrap.querySelector('.cm-rs-picker');
    _cmCloseRosterPicker();
    if (open) return;
    var st = getStudents(cmSelectedCourse).find(function (s) {
      return s.id === btn.dataset.sid;
    });
    if (!st) return;
    var have = st.designations || [];
    var picker = document.createElement('div');
    picker.className = 'cm-rs-picker';
    picker.setAttribute('role', 'menu');
    picker.innerHTML = Object.keys(BC_DESIGNATIONS)
      .filter(function (code) {
        return have.indexOf(code) < 0;
      })
      .map(function (code) {
        return (
          '<button type="button" role="menuitem" class="cm-rs-pick" data-action="cmRosterDesigAdd" data-sid="' +
          esc(st.id) +
          '" data-code="' +
          esc(code) +
          '"><strong>' +
          esc(code) +
          '</strong> ' +
          esc(BC_DESIGNATIONS[code].name) +
          '</button>'
        );
      })
      .join('');
    wrap.appendChild(picker);
    btn.setAttribute('aria-expanded', 'true');
    _cmFloatOverScroll(picker, btn);
    var first = picker.querySelector('button');
    if (first) first.focus();
  }

  function _cmCloseRosterPicker() {
    var any = false;
    document.querySelectorAll('.cm-rs-picker').forEach(function (p) {
      var btn = p.parentElement.querySelector('.cm-rs-add');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      p.remove();
      any = true;
    });
    return any;
  }

  function cmRosterDesigAdd(sid, code) {
    var st = getStudents(cmSelectedCourse).find(function (s) {
      return s.id === sid;
    });
    if (!st) return;
    _cmCloseRosterPicker();
    _cmSetDesignations(sid, (st.designations || []).concat([code]));
  }

  /* Enter or ↓ to the same box one row down, ↑ one row up; Escape leaves.
     Rows hidden by the search are skipped. */
  function _cmRosterKeydown(e) {
    var el = e.target;
    if (!el || !el.dataset || !el.dataset.col || !el.closest('.cm-rs-row')) return false;
    if (e.isComposing) return false;
    var k = e.key;
    if (k === 'Escape') {
      if (_cmCloseRosterPicker()) {
        e.preventDefault();
        return true;
      }
      // Escape cancels, as in the gradebook: the box goes back to what is
      // saved before it loses focus, so the blur has nothing to save.
      if (el.type !== 'checkbox') {
        var saved = _cmRosterSavedValue(el);
        if (saved !== null) el.value = saved;
      }
      el.blur();
      return true;
    }
    if (el.type === 'checkbox' && k === 'Enter') {
      e.preventDefault();
      el.checked = !el.checked;
      cmRosterEll(el);
      return true;
    }
    var dir = k === 'Enter' || k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0;
    if (!dir || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false;
    if (el.type === 'date' && k !== 'Enter') return false;
    var rows = Array.prototype.filter.call(document.querySelectorAll('.cm-rs-row'), function (r) {
      return !r.hidden;
    });
    var at = rows.indexOf(el.closest('.cm-rs-row'));
    var next = rows[at + dir];
    if (!next) return false;
    var target = next.querySelector('[data-col="' + el.dataset.col + '"]');
    if (!target) return false;
    e.preventDefault();
    target.focus();
    if (target.select) target.select();
    return true;
  }

  /* A menu opened inside the roster's sideways-scrolling table would be cut
     off by it, so it floats over the page under its button instead, and
     closes if the table or page scrolls. */
  function _cmFloatOverScroll(menu, btn) {
    var box = btn.closest('.cm-rs-scroll, .cm-import-cols-scroll');
    if (!box) return;
    var r = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    // Below the button, or above it when there's more room there; never
    // taller than the room it has, so every item can be reached.
    var below = window.innerHeight - r.bottom - 12;
    var above = r.top - 12;
    var up = menu.offsetHeight > below && above > below;
    menu.style.maxHeight = Math.max(120, up ? above : below) + 'px';
    menu.style.overflowY = 'auto';
    menu.style.top = Math.round(up ? Math.max(8, r.top - 4 - menu.offsetHeight) : r.bottom + 4) + 'px';
    var w = menu.offsetWidth;
    var left = menu.classList.contains('cm-std-menu') ? r.right - w : r.left;
    menu.style.left = Math.max(8, Math.min(Math.round(left), window.innerWidth - w - 8)) + 'px';
    menu.style.right = 'auto';
    // Close when the table or page really scrolls away, not on the scroll
    // that brought the button into view as it was clicked.
    var detail = btn.closest('.cm-detail');
    var at = function () {
      return box.scrollLeft + ',' + box.scrollTop + ',' + (detail ? detail.scrollTop : 0);
    };
    var start = null;
    var onScroll = function () {
      if (start === null || at() === start) return;
      box.removeEventListener('scroll', onScroll);
      if (detail) detail.removeEventListener('scroll', onScroll);
      if (!menu.isConnected || menu.hidden) return;
      _cmCloseStdMenus();
      _cmCloseRosterPicker();
    };
    box.addEventListener('scroll', onScroll);
    if (detail) detail.addEventListener('scroll', onScroll);
    setTimeout(function () {
      start = at();
    }, 150);
  }

  function cmOpenStudentPage(sid) {
    var cid = cmSelectedCourse;
    if (!cid || !sid) return;
    classManagerOpen = false;
    if (typeof setActiveCourse === 'function') setActiveCourse(cid);
    Router.navigate('/student?course=' + encodeURIComponent(cid) + '&id=' + encodeURIComponent(sid));
  }

  /* ── Import Roster ───────────────────────────────────────────
     Board: Import Roster (canvas, Nov 11 2026). An empty class's Students
     tab is the place to drop a class list; a class with students opens a
     one-line strip from Import Roster. Choose File reads the file on this
     computer (nothing is uploaded), then:
       - a file whose every column is recognised (a MyEd class list, the
         template) goes straight to Ready to Add, with no matching;
       - any other file opens Check How Your File Was Read: FullVision's
         choice above each column's first rows, best guesses marked, and the
         rows that need a look;
       - a class with students sees What This File Will Change.
     Problems never block: a student is added with that field blank and the
     Done panel names who to fill in. A row with no name stays out until a
     name is typed. Nothing changes until the teacher adds or saves. */
  function cmImportRoster() {
    if (cmPendingImport || !cmSelectedCourse || !getStudents(cmSelectedCourse).length) {
      cmChooseRosterFile();
      return;
    }
    cmImportFormatOpen = true;
    cmImportError = null;
    renderClassManager();
    var choose = document.querySelector('[data-action="cmChooseRosterFile"]');
    _cmFocus(choose);
  }

  function _cmFocus(el) {
    if (el && typeof el.focus === 'function') el.focus();
  }

  function cmChooseRosterFile() {
    var el = document.getElementById('cm-csv-input');
    if (el) el.click();
  }

  function cmCloseImportFormat() {
    cmImportFormatOpen = false;
    cmImportError = null;
    renderClassManager();
    var btn = document.querySelector('[data-action="cmImportRoster"]');
    _cmFocus(btn);
  }

  var _CM_FILE_ICON =
    '<svg class="cm-import-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M12 17v-6"></path><path d="M9.5 13.5 12 11l2.5 2.5"></path></svg>';

  /* The empty class: drop the class list here, with MyEd's three steps. */
  function cmImportEmptyHtml() {
    return (
      '<div class="cm-section cm-import-empty" role="region" aria-labelledby="cm-import-empty-title">' +
      '<div class="cm-import-drop cm-import-drop-big">' +
      _CM_FILE_ICON +
      '<h2 class="cm-import-drop-title" id="cm-import-empty-title">Add Your Students</h2>' +
      '<p class="cm-import-drop-text">Drop your class list here. A class list from MyEducation BC goes in as it is, and so does any spreadsheet saved as CSV.</p>' +
      '<button type="button" class="btn btn-primary" data-action="cmChooseRosterFile">Choose File</button>' +
      '<p class="cm-hint">The file isn\'t uploaded. FullVision reads it on this computer and saves only the students you add.</p>' +
      '</div>' +
      '<div class="cm-import-side">' +
      '<div class="cm-import-side-part">' +
      '<h3>Get the List From MyEducation BC</h3>' +
      '<ol class="cm-import-steps">' +
      '<li>In MyEd, open <strong>Gradebook</strong> and choose this class.</li>' +
      '<li>Choose <strong>Roster</strong> on the left.</li>' +
      '<li>Select the printer icon, then <strong>CSV</strong>. It goes to your Downloads folder.</li>' +
      '</ol>' +
      '<a href="/help/get-a-class-list-from-myeducation-bc" data-action="openHelpArticle" data-slug="get-a-class-list-from-myeducation-bc">Show Me With Pictures</a>' +
      '</div>' +
      '<div class="cm-import-side-part">' +
      '<h3>No Class List?</h3>' +
      '<p>Start from the template: a blank spreadsheet with a column for everything FullVision keeps.</p>' +
      '<a class="cm-action-btn" href="/roster-template.csv" download="roster-template.csv">Download Template</a>' +
      '</div>' +
      '<div class="cm-import-side-part cm-import-side-row">' +
      '<span>Only a few students? Type them in.</span>' +
      '<button type="button" class="cm-action-btn cm-roster-add" data-action="cmShowAddStudent">Add Student</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* A class with students: Import Roster opens this strip. */
  function cmImportFormatHtml() {
    return (
      '<div class="cm-section cm-import-drop cm-import-strip" role="region" aria-label="Import Roster">' +
      _CM_FILE_ICON +
      '<div class="cm-import-strip-text"><strong>Drop a class list here to update this class</strong>' +
      '<span class="cm-hint">Students already here are matched by student number, so no one is added twice. You\'ll see every change before anything is saved. ' +
      '<a href="/help/get-a-class-list-from-myeducation-bc" data-action="openHelpArticle" data-slug="get-a-class-list-from-myeducation-bc">Get a Class List From MyEducation BC</a></span></div>' +
      '<a class="cm-import-link" href="/roster-template.csv" download="roster-template.csv">Download Template</a>' +
      '<button type="button" class="cm-action-btn" data-action="cmCloseImportFormat">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmChooseRosterFile">Choose File</button>' +
      '</div>'
    );
  }

  /* An Excel file, or a file with nothing in it. */
  function _cmImportErrorHtml(err) {
    var title, text, hint;
    if (err.kind === 'excel') {
      title = 'This Is an Excel File';
      text =
        '<strong>' +
        esc(err.fileName) +
        '</strong> needs to be saved as CSV first. In Excel, choose File, then Save As, and pick CSV.';
      hint = 'Downloading from MyEd? Choose CSV, not Excel, after the printer icon.';
    } else {
      title = 'This File Is Empty';
      text = '<strong>' + esc(err.fileName) + '</strong> has no rows to read.';
      hint = 'Choose the class list again, or another file.';
    }
    return (
      '<div class="cm-section cm-import-card" role="alert">' +
      '<div class="cm-import-card-head"><span class="cm-import-card-mark" aria-hidden="true">!</span><h2>' +
      title +
      '</h2></div>' +
      '<p class="cm-import-card-text">' +
      text +
      '</p><p class="cm-hint">' +
      esc(hint) +
      '</p>' +
      '<div class="cm-import-buttons"><button type="button" class="btn btn-primary" data-action="cmChooseRosterFile">Choose Another File</button>' +
      '<button type="button" class="cm-action-btn" data-action="cmCloseImportFormat">Cancel</button></div>' +
      '</div>'
    );
  }

  /* ── Import Roster: reading the file: teacher/cm-roster-file.js ── */
  var ROSTER_IMPORT_FIELDS = CmRosterFile.ROSTER_IMPORT_FIELDS;
  var ROSTER_FIELD_MENU = CmRosterFile.ROSTER_FIELD_MENU;
  var ROSTER_SKIPPED_HEADERS = CmRosterFile.ROSTER_SKIPPED_HEADERS;
  var _ROSTER_NUM_DATE = CmRosterFile._ROSTER_NUM_DATE;
  var _rosterHeaderKey = CmRosterFile._rosterHeaderKey;
  var parseRosterCsv = CmRosterFile.parseRosterCsv;
  var _rosterDate = CmRosterFile._rosterDate;
  var rosterDateOrder = CmRosterFile.rosterDateOrder;
  var _rosterCodes = CmRosterFile._rosterCodes;
  var rosterImportTable = CmRosterFile.rosterImportTable;
  var _rosterColumn = CmRosterFile._rosterColumn;
  var rosterImportReady = CmRosterFile.rosterImportReady;
  var rosterRowsFromTable = CmRosterFile.rosterRowsFromTable;

  /* ── Guardian addresses from the roster and the import ──────
     Stored on the server's guardian table; nothing is emailed from
     FullVision (families are emailed from the teacher's Outlook). A student
     the server hasn't created yet has no person id to attach a guardian to,
     so the address is kept on the student record and saved to the guardian
     table once the id arrives. */
  function _cmAddGuardianEmail(cid, st, email) {
    var list = (_cmGuardians[cid] = _cmGuardians[cid] || {});
    var mine = (list[st.id] = list[st.id] || []);
    if (
      mine.some(function (g) {
        return (g.email || '').toLowerCase() === email.toLowerCase();
      })
    )
      return;
    var fresh = { name: 'Parent / Guardian', email: email };
    mine.push(fresh);
    if (_isServerPerson(st)) _cmSendGuardian(st, fresh);
    else st.pendingGuardianEmails = (st.pendingGuardianEmails || []).concat([email]);
  }

  function _isServerPerson(st) {
    return !!(st && /^[0-9a-f-]{36}$/i.test(st.personId || '') && window.v2 && window.v2.upsertGuardian);
  }

  function _cmSendGuardian(st, g) {
    return window.v2.upsertGuardian({ studentId: st.personId, name: g.name, email: g.email }).then(function (res) {
      var row = res && res.data;
      if (row && row.id) g.id = row.id;
    });
  }

  function _cmFlushPendingGuardians(cid) {
    var students = getStudents(cid);
    var changed = false;
    students.forEach(function (st) {
      if (!st.pendingGuardianEmails || !st.pendingGuardianEmails.length || !_isServerPerson(st)) return;
      var mine = _cmGuardiansFor(cid, st.id);
      st.pendingGuardianEmails.forEach(function (email) {
        var g = mine.find(function (x) {
          return x.email === email && !x.id;
        }) || { name: 'Parent / Guardian', email: email };
        _cmSendGuardian(st, g);
      });
      delete st.pendingGuardianEmails;
      changed = true;
    });
    if (changed) saveStudents(cid, students);
  }

  function cmHandleCSV(input) {
    var file = input.files[0];
    if (!file) return;
    var name = file.name || 'the file';
    cmImportDone = null;
    cmRosterOnly = null;
    if (/\.(xlsx|xlsm|xls|ods|numbers)$/i.test(name)) {
      input.value = '';
      _cmImportFail('excel', name);
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = String(e.target.result || '');
      if (/^PK\u0003\u0004/.test(text) || text.indexOf('\u0000') >= 0) {
        _cmImportFail('excel', name);
        return;
      }
      var table = rosterImportTable(text);
      if (!table.body.length) {
        _cmImportFail('empty', name);
        return;
      }
      cmImportFormatOpen = false;
      cmImportError = null;
      cmStartImport(table, name);
    };
    reader.readAsText(file);
    input.value = '';
  }

  function _cmImportFail(kind, fileName) {
    cmPendingImport = null;
    cmImportFormatOpen = false;
    cmImportError = { kind: kind, fileName: fileName };
    renderClassManager();
    var btn = document.querySelector('.cm-import-card [data-action="cmChooseRosterFile"]');
    _cmFocus(btn);
  }

  /* A file read: plan it. A file with no column of names asks first. */
  function cmStartImport(table, fileName) {
    cmImportError = null;
    cmImportFormatOpen = false;
    var plan = { fileName: fileName || '', table: table, fixes: {}, keep: {}, showColumns: false, showAll: false };
    plan.nonames = !table.map.some(_cmIsNameField);
    _cmPlanImport(plan);
    var head = document.getElementById('cm-import-title');
    _cmFocus(head);
  }

  function _cmIsNameField(f) {
    return f === 'firstName' || f === 'lastName' || f === 'fullName';
  }

  /* For tests and callers with rows already read. */
  function cmShowImportPreview(parsed, fileName, table, skipped) {
    var plan = { fileName: fileName || '', table: table || null, fixes: {}, keep: {}, showColumns: false };
    if (!table) plan.parsed = { rows: parsed || [], problems: [], unnamed: [], waiting: {}, skipped: skipped || {} };
    _cmPlanImport(plan);
  }

  /* Import review. Rows are matched to the roster by student number, then
     by name: a matched number with a different name is a name change, and a
     student the file leaves out is offered for withdrawal (off by default).
     What the teacher ticked stays ticked when the file is read again. */
  function _cmImportKey(v) {
    return String(v || '')
      .trim()
      .toLowerCase();
  }

  function _cmPlanImport(plan) {
    var cid = cmSelectedCourse;
    if (!cid) return;
    var read = plan.table ? rosterRowsFromTable(plan.table, plan.fixes) : plan.parsed;
    var roster = getStudents(cid);
    var byNum = {};
    var byName = {};
    roster.forEach(function (s) {
      if (_cmImportKey(s.studentNumber)) byNum[_cmImportKey(s.studentNumber)] = s;
      byName[_cmImportKey(fullName(s))] = s;
    });
    var on = function (key, dflt) {
      return plan.keep[key] === undefined ? dflt : plan.keep[key];
    };
    var matched = {};
    plan.read = read;
    plan.total = read.rows.length;
    plan.added = [];
    plan.renamed = [];
    plan.updated = [];
    plan.missing = [];
    plan.same = 0;
    read.rows.forEach(function (p, i) {
      var name = _cmImportKey((p.firstName || '') + ' ' + (p.lastName || ''));
      var hit = (_cmImportKey(p.studentNumber) && byNum[_cmImportKey(p.studentNumber)]) || byName[name];
      if (!hit || matched[hit.id]) {
        if (!hit) {
          var key = 'a' + (p.line || 'i' + i);
          plan.added.push({ row: p, key: key, on: on(key, true) });
        }
        return;
      }
      matched[hit.id] = true;
      var sameName =
        _cmImportKey(hit.firstName) === _cmImportKey(p.firstName) &&
        _cmImportKey(hit.lastName) === _cmImportKey(p.lastName);
      if (!sameName && p.firstName)
        plan.renamed.push({ sid: hit.id, row: p, key: 'r' + hit.id, on: on('r' + hit.id, true) });
      var fields = _cmImportChanges(cid, hit, p);
      if (fields.length)
        plan.updated.push({ sid: hit.id, row: p, fields: fields, key: 'u' + hit.id, on: on('u' + hit.id, true) });
      else if (sameName || !p.firstName) plan.same++;
    });
    sortStudents(roster, 'lastName').forEach(function (s) {
      if (!matched[s.id]) plan.missing.push({ sid: s.id, key: 'm' + s.id, on: on('m' + s.id, false) });
    });
    cmPendingImport = plan;
    renderClassManager();
  }

  /* What a matched row would change, as [{ label, from, to }]: a field the
     file fills and the roster has differently, a designation the student
     doesn't have yet, a parent email not on file. Blank cells change
     nothing. */
  var IMPORT_FIELD_LABELS = {
    preferred: 'Preferred Name',
    pronouns: 'Pronouns',
    studentNumber: 'Student Number',
    dateOfBirth: 'Date of Birth',
    email: 'Student Email',
  };
  function _cmImportChanges(cid, st, p) {
    var out = [];
    Object.keys(IMPORT_FIELD_LABELS).forEach(function (k) {
      if (p[k] && String(p[k]) !== String(st[k] || ''))
        out.push({ label: IMPORT_FIELD_LABELS[k], from: st[k] || '', to: String(p[k]) });
    });
    var have = st.designations || [];
    var newCodes = (p.designations || []).filter(function (c) {
      return have.indexOf(c) < 0;
    });
    if (newCodes.length) out.push({ label: 'Designations', from: '', to: '+ ' + newCodes.join(', '), add: true });
    var known = _cmGuardiansFor(cid, st.id).map(function (g) {
      return (g.email || '').toLowerCase();
    });
    var newParents = (p.parentEmails || []).filter(function (e) {
      return known.indexOf(e.toLowerCase()) < 0;
    });
    if (newParents.length)
      out.push({
        label: newParents.length === 1 ? 'Parent Email' : 'Parent Emails',
        from: '',
        to: '+ ' + newParents.join(', '),
        add: true,
      });
    return out;
  }

  var _CM_FIELD_LABEL = {};
  ROSTER_IMPORT_FIELDS.forEach(function (f) {
    _CM_FIELD_LABEL[f[0]] = f[1];
  });

  function _cmRowName(p) {
    return ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
  }

  function _cmJoinWords(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  function _cmPlural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* What a column holds, in a line under its choice. */
  function _cmColumnNote(t, i) {
    var f = t.map[i];
    var vals = _rosterColumn(t, i);
    var header = _rosterHeaderKey(t.headers[i]);
    if (!f) {
      if (t.suggest[i] === 'designations') {
        var codes = {};
        vals.forEach(function (v) {
          _rosterCodes(v).forEach(function (c) {
            codes[c] = true;
          });
        });
        return (
          'Looks like designations (' + _cmJoinWords(Object.keys(codes).slice(0, 3)) + '). Left out unless you choose.'
        );
      }
      if (!vals.length) return 'Empty.';
      if (ROSTER_SKIPPED_HEADERS.indexOf(header) >= 0) return "FullVision doesn't keep this.";
      if (/note|comment/.test(header)) return 'FullVision has no place for notes. Add them as observations.';
      var distinct = {};
      vals.forEach(function (v) {
        distinct[v] = true;
      });
      var one = Object.keys(distinct);
      if (one.length === 1 && vals.length > 1) return one[0] + ' in every row.';
      return 'FullVision leaves this column out.';
    }
    if (f === 'fullName') {
      var commas = vals.filter(function (v) {
        return v.indexOf(',') >= 0;
      }).length;
      return commas >= vals.length / 2 ? 'Read as Last, First.' : 'Read as First Last.';
    }
    if (f === 'dateOfBirth') {
      var order = t.dateOrder[i];
      var sample = vals.find(function (v) {
        var m = _ROSTER_NUM_DATE.exec(v);
        return m && (order === 'mdy' ? +m[2] > 12 : +m[1] > 12);
      });
      if (order === 'mdy')
        return (
          'Read as month/day/year' + (sample ? ': ' + sample + ' can only be ' + _cmSayDate(sample, 'mdy') + '.' : '.')
        );
      if (order === 'dmy')
        return (
          'Read as day/month/year' + (sample ? ': ' + sample + ' can only be ' + _cmSayDate(sample, 'dmy') + '.' : '.')
        );
      if (order === 'ask') return '';
      return 'Year first, or written out.';
    }
    if (t.how[i] !== 'guess') return '';
    if (f === 'studentNumber') {
      var lens = {};
      vals.forEach(function (v) {
        lens[v.replace(/\D/g, '').length] = true;
      });
      var k = Object.keys(lens);
      return (k.length === 1 ? k[0] + '-digit numbers' : 'Numbers') + ", like MyEd's Pupil #.";
    }
    if (f === 'parentEmail' || f === 'parentEmail2')
      return 'Every cell is an email address. Kept for you; FullVision never emails families.';
    if (f === 'email') return 'Every cell is an address at ' + (vals[0] || '').split('@')[1] + '.';
    if (f === 'pronouns') return 'Every cell is pronouns.';
    return '';
  }

  function _cmSayDate(v, order) {
    var d = _rosterDate(v, order);
    if (!d) return v;
    var p = d.split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[+p[1] - 1] + ' ' + +p[2];
  }

  /* A column's problems, said once on the column. */
  function _cmColumnIssue(plan, i) {
    var t = plan.table;
    var f = t.map[i];
    var read = plan.read;
    var count = function (kind) {
      return read.problems.filter(function (pr) {
        return pr.kind === kind;
      }).length;
    };
    if (_cmIsNameField(f) && read.unnamed.length)
      return _cmPlural(read.unnamed.length, 'row has', 'rows have') + ' no name';
    if (f === 'studentNumber' && count('number'))
      return _cmPlural(count('number'), 'number is', 'numbers are') + ' used twice';
    if (f === 'dateOfBirth' && count('date')) return _cmPlural(count('date'), "date isn't real", "dates can't be read");
    if ((f === 'email' || f === 'parentEmail' || f === 'parentEmail2') && count('email'))
      return _cmPlural(count('email'), "cell isn't an email address", "cells aren't email addresses");
    if (f === 'designations' && count('code'))
      return _cmPlural(count('code'), "code isn't a BC code", "codes aren't BC codes");
    return '';
  }

  /* The column menu, on the column's button: each choice says what it takes
     and which column already uses it (choosing it swaps the two). */
  function _cmFieldMenuHtml(t, i) {
    var cur = t.map[i] || '';
    var usedBy = {};
    t.map.forEach(function (f, j) {
      if (f && j !== i && !usedBy[f]) usedBy[f] = t.headers[j] || 'Column ' + (j + 1);
    });
    var item = function (field, hint) {
      var on = field === cur;
      return (
        '<button type="button" role="menuitemradio" aria-checked="' +
        on +
        '" class="cm-std-menu-item cm-import-field-item' +
        (on ? ' is-on' : '') +
        '" data-action="cmImportPick" data-col="' +
        i +
        '" data-field="' +
        field +
        '"><span class="cm-import-item-top"><span>' +
        (on ? '✓ ' : '') +
        esc(field ? _CM_FIELD_LABEL[field] : "Don't Import") +
        '</span>' +
        (on && t.how[i] === 'guess'
          ? '<span class="cm-import-item-guess">Best Guess</span>'
          : usedBy[field]
            ? '<span class="cm-import-item-used">Used by ' + esc(usedBy[field]) + '</span>'
            : '') +
        '</span><span class="cm-import-item-hint">' +
        esc(hint) +
        '</span></button>'
      );
    };
    return (
      '<div class="cm-std-menu cm-import-field-menu" role="menu" aria-label="' +
      esc('What ' + (t.headers[i] || 'column ' + (i + 1)) + ' holds') +
      '" hidden>' +
      ROSTER_FIELD_MENU.map(function (g) {
        return (
          '<div role="group" aria-label="' +
          esc(g[0]) +
          '"><div class="cm-import-menu-group" aria-hidden="true">' +
          esc(g[0]) +
          '</div>' +
          g[1]
            .map(function (it) {
              return item(it[0], it[1]);
            })
            .join('') +
          '</div>'
        );
      }).join('') +
      '<div role="group" aria-label="Leave Out">' +
      item('', 'FullVision leaves this column out.') +
      '</div></div>'
    );
  }

  /* The columns, each with FullVision's choice above the first rows. */
  function _cmImportColumnsHtml(plan) {
    var t = plan.table;
    var cols = t.headers.map(function (h, i) {
      return i;
    });
    var tracks = cols
      .map(function (i) {
        return t.map[i] ? 'minmax(150px, 1.4fr)' : 'minmax(132px, 0.9fr)';
      })
      .join(' ');
    var head = cols
      .map(function (i) {
        var f = t.map[i] || '';
        var label = t.headers[i] || 'Column ' + (i + 1);
        var tag =
          t.how[i] === 'header'
            ? '<span class="cm-import-tag is-read">Read</span>'
            : t.how[i] === 'guess' || t.how[i] === 'order'
              ? '<span class="cm-import-tag is-guess">Best Guess</span>'
              : '';
        var note = _cmColumnNote(t, i);
        var issue = _cmColumnIssue(plan, i);
        var ask =
          t.dateOrder[i] === 'ask'
            ? '<div class="cm-import-ask" role="group" aria-label="' +
              esc('Which comes first in ' + label) +
              '"><span>Which comes first? Every date here could be either.</span>' +
              '<span class="cm-import-ask-btns"><button type="button" class="cm-action-btn" data-action="cmImportDateOrder" data-col="' +
              i +
              '" data-order="mdy">Month</button><button type="button" class="cm-action-btn" data-action="cmImportDateOrder" data-col="' +
              i +
              '" data-order="dmy">Day</button></span></div>'
            : '';
        var suggest =
          !f && t.suggest[i]
            ? '<button type="button" class="cm-import-suggest" data-action="cmImportPick" data-col="' +
              i +
              '" data-field="' +
              t.suggest[i] +
              '">Import as ' +
              esc(_CM_FIELD_LABEL[t.suggest[i]]) +
              '</button>'
            : '';
        return (
          '<div class="cm-import-col-head' +
          (f ? '' : ' is-out') +
          '"><strong class="cm-import-col-name">' +
          esc(label) +
          '</strong>' +
          '<span class="cm-std-menu-wrap cm-import-field-wrap">' +
          '<button type="button" class="cm-import-field-btn" data-action="cmStdMenu" data-col="' +
          i +
          '" aria-haspopup="menu" aria-expanded="false" aria-label="' +
          esc('What ' + label + ' holds: ' + (f ? _CM_FIELD_LABEL[f] : "Don't Import")) +
          '">' +
          esc(f ? _CM_FIELD_LABEL[f] : "Don't Import") +
          '<span aria-hidden="true">▾</span></button>' +
          _cmFieldMenuHtml(t, i) +
          '</span>' +
          tag +
          (note ? '<span class="cm-import-col-note">' + esc(note) + '</span>' : '') +
          ask +
          (issue ? '<span class="cm-import-col-issue">' + esc(issue) + '</span>' : '') +
          suggest +
          '</div>'
        );
      })
      .join('');
    var rows = t.body
      .slice(0, 4)
      .map(function (r) {
        return cols
          .map(function (i) {
            return '<span class="cm-import-cell' + (t.map[i] ? '' : ' is-out') + '">' + esc(r[i] || '') + '</span>';
          })
          .join('');
      })
      .join('');
    var more =
      t.body.length > 4
        ? '<div class="cm-import-more">and ' + _cmPlural(t.body.length - 4, 'more row', 'more rows') + '</div>'
        : '';
    return (
      '<div class="cm-import-cols-scroll">' +
      '<div class="cm-import-cols" style="grid-template-columns:' +
      tracks +
      '">' +
      head +
      rows +
      '</div>' +
      more +
      '</div>'
    );
  }

  /* What FullVision needs from the file: names, and student numbers so a
     second import updates instead of adding everyone again. */
  function _cmImportNeedsHtml(t) {
    var from = function (test) {
      return t.headers
        .map(function (h, i) {
          return test(t.map[i]) ? h || 'Column ' + (i + 1) : '';
        })
        .filter(Boolean);
    };
    var names = from(_cmIsNameField);
    var nums = from(function (f) {
      return f === 'studentNumber';
    });
    return (
      '<div class="cm-import-needs">' +
      (names.length
        ? '<span class="cm-import-need is-ok"><strong>✓ Names</strong> from ' +
          esc(_cmJoinWords(names)) +
          ' · needed</span>'
        : '<span class="cm-import-need is-missing"><strong>Names</strong> · choose the column that holds them</span>') +
      (nums.length
        ? '<span class="cm-import-need is-ok"><strong>✓ Student Numbers</strong> from ' +
          esc(_cmJoinWords(nums)) +
          ' · so importing again updates students instead of adding them twice</span>'
        : '<span class="cm-import-need"><strong>No Student Numbers</strong> · importing again will match students by name</span>') +
      '</div>'
    );
  }

  /* The rows that need a look, each with what will happen and a box to fix
     it. Nothing here stops the import. */
  function _cmImportProblemsHtml(plan) {
    var read = plan.read;
    var addedRows = plan.added.map(function (a) {
      return a.row;
    });
    var items = read.problems
      .map(function (pr) {
        return { line: pr.line, pr: pr };
      })
      .concat(
        read.unnamed.map(function (u) {
          return { line: u.line, unnamed: u };
        }),
      )
      .sort(function (a, b) {
        return a.line - b.line;
      });
    if (!items.length) return '';
    var lines = {};
    items.forEach(function (it) {
      lines[it.line] = true;
    });
    var count = Object.keys(lines).length;
    var fix = function (line, field, label, placeholder, value) {
      return (
        '<label class="cm-import-fix"><span>' +
        esc(label) +
        '</span><input class="cm-input" type="text" data-action-change="cmImportFix" data-line="' +
        line +
        '" data-field="' +
        field +
        '" placeholder="' +
        esc(placeholder) +
        '" value="' +
        esc(value || '') +
        '"></label>'
      );
    };
    var html = items
      .map(function (it) {
        var line = it.line;
        var typed = plan.fixes[line] || {};
        var label = '<span class="cm-import-rownum">Row ' + line + '</span>';
        if (it.unnamed) {
          return (
            '<div class="cm-import-problem">' +
            label +
            '<strong class="cm-import-problem-name is-missing">No name</strong>' +
            '<span>This row has no name, so it will be left out. <span class="cm-hint">' +
            esc(it.unnamed.cells.join(' · ')) +
            '</span></span>' +
            fix(line, 'name', 'Type a name to add them', 'Last, First', typed.name) +
            '</div>'
          );
        }
        var pr = it.pr;
        var p = pr.p;
        var first = p.preferred || p.firstName || _cmRowName(p);
        var isNew = addedRows.indexOf(p) >= 0;
        var text, then, box;
        if (pr.kind === 'date') {
          text = _rosterYmdLike(pr.value)
            ? 'Birthday “' + pr.value + "” isn't a real date."
            : 'Birthday “' + pr.value + "” can't be read.";
          then = isNew ? first + ' will be added without a birthday.' : first + "'s birthday isn't changed.";
          box = fix(line, 'dateOfBirth', 'Birthday', 'Like 2012-09-30', typed.dateOfBirth);
        } else if (pr.kind === 'number') {
          text =
            'Student number ' + pr.value + ' is also ' + _cmRowName(pr.other) + "'s, in row " + pr.other.line + '.';
          then = isNew
            ? first + ' will be added without one. MyEd has the right number.'
            : first + "'s number isn't changed.";
          box = fix(line, 'studentNumber', 'Student Number', 'Their number', typed.studentNumber);
        } else if (pr.kind === 'email') {
          text = '“' + pr.value + "” isn't an email address, so it's left out.";
          then = '';
          box = '';
        } else {
          text = '“' + pr.value + "” isn't a BC designation code, so it's left out.";
          then = '';
          box = '';
        }
        return (
          '<div class="cm-import-problem">' +
          label +
          '<strong class="cm-import-problem-name">' +
          esc(_cmRowName(p)) +
          '</strong><span>' +
          esc(text) +
          (then ? ' <span class="cm-hint">' + esc(then) + '</span>' : '') +
          '</span>' +
          box +
          '</div>'
        );
      })
      .join('');
    return (
      '<div class="cm-import-problems-head"><h3>' +
      (count === 1 ? '1 Row Needs a Look' : count + ' Rows Need a Look') +
      '</h3><span class="cm-hint">Nothing here stops the import. Fix what you can now, or later in the student table.</span></div>' +
      '<div class="cm-import-problems">' +
      html +
      '</div>'
    );
  }

  function _rosterYmdLike(v) {
    return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v) || _ROSTER_NUM_DATE.test(v) || /[a-z]{3}/i.test(v);
  }

  /* The students a first import adds, under FullVision's column names. */
  function _cmImportStudentListHtml(plan) {
    var t = plan.table;
    var cols = [
      ['lastName', 'Last Name'],
      ['firstName', 'First Name'],
    ];
    ['preferred', 'pronouns', 'studentNumber', 'dateOfBirth', 'email'].forEach(function (f) {
      if (
        !t ||
        plan.added.some(function (a) {
          return a.row[f];
        })
      )
        cols.push([f, f === 'preferred' ? 'Preferred' : _CM_FIELD_LABEL[f]]);
    });
    var shown = plan.showAll ? plan.added : plan.added.slice(0, 10);
    var allOn = plan.added.every(function (a) {
      return a.on;
    });
    var tracks =
      '36px ' +
      cols
        .map(function (c) {
          return c[0] === 'email' ? 'minmax(0, 2fr)' : 'minmax(0, 1fr)';
        })
        .join(' ');
    return (
      '<div class="cm-import-list" style="--cm-import-cols:' +
      tracks +
      '">' +
      '<div class="cm-import-list-row is-head"><input type="checkbox" data-action-change="cmImportToggleAll"' +
      (allOn ? ' checked' : '') +
      ' aria-label="All students in the file">' +
      cols
        .map(function (c) {
          return '<span>' + esc(c[1]) + '</span>';
        })
        .join('') +
      '</div>' +
      shown
        .map(function (a, i) {
          return (
            '<label class="cm-import-list-row"><input type="checkbox" data-action-change="cmImportToggle" data-kind="added" data-idx="' +
            i +
            '"' +
            (a.on ? ' checked' : '') +
            ' aria-label="' +
            esc('Add ' + _cmRowName(a.row)) +
            '">' +
            cols
              .map(function (c) {
                return (
                  '<span' +
                  (c[0] === 'lastName' || c[0] === 'firstName' ? ' class="is-name"' : '') +
                  '>' +
                  esc(a.row[c[0]] || '') +
                  '</span>'
                );
              })
              .join('') +
            '</label>'
          );
        })
        .join('') +
      '</div>' +
      (plan.added.length > shown.length
        ? '<button type="button" class="cm-import-link" data-action="cmImportShowAll">Show All ' +
          plan.added.length +
          '</button>'
        : '')
    );
  }

  /* A class with students: what the file will change, in groups. */
  function _cmImportGroupsHtml(cid, plan) {
    var byId = {};
    getStudents(cid).forEach(function (s) {
      byId[s.id] = s;
    });
    function group(title, kind, items, render, note) {
      if (!items.length) return '';
      return (
        '<div class="cm-import-group"><div class="cm-import-group-head"><h3>' +
        title +
        '</h3><span>' +
        items.length +
        '</span></div>' +
        items
          .map(function (it, i) {
            return (
              '<label class="cm-import-row"><input type="checkbox"' +
              (it.on ? ' checked' : '') +
              ' data-action-change="cmImportToggle" data-kind="' +
              kind +
              '" data-idx="' +
              i +
              '">' +
              render(it) +
              '</label>'
            );
          })
          .join('') +
        (note ? '<div class="cm-hint">' + note + '</div>' : '') +
        '</div>'
      );
    }
    var num = function (n) {
      return '<span class="cm-roster-num">' + esc(n || '') + '</span>';
    };
    var left =
      group('New to This Class', 'added', plan.added, function (a) {
        return (
          '<span class="cm-import-name"><strong>' +
          esc(_cmRowName(a.row)) +
          '</strong></span>' +
          num(a.row.studentNumber)
        );
      }) +
      group(
        'Name Changed',
        'renamed',
        plan.renamed,
        function (r) {
          var st = byId[r.sid] || {};
          return (
            '<span class="cm-import-name"><span class="cm-import-old">' +
            esc(fullName(st)) +
            '</span> → <strong>' +
            esc(_cmRowName(r.row)) +
            '</strong></span>' +
            num(st.studentNumber)
          );
        },
        'Same student number, so their scores and observations stay with them.',
      ) +
      group(
        'In Your Class, Not in This File',
        'missing',
        plan.missing,
        function (m) {
          var st = byId[m.sid] || {};
          return (
            '<span class="cm-import-name"><strong>' +
            esc(fullName(st)) +
            '</strong> · Withdraw from this class</span>' +
            num(st.studentNumber)
          );
        },
        'Left unticked, they stay. A withdrawn student keeps their scores and can be enrolled again.',
      );
    var right =
      group(
        'Details Updated',
        'updated',
        plan.updated,
        function (u) {
          var st = byId[u.sid] || {};
          return (
            '<span class="cm-import-name"><strong>' +
            esc(fullName(st)) +
            '</strong></span><span class="cm-import-changes">' +
            u.fields
              .map(function (c) {
                return (
                  '<span>' +
                  esc(c.label) +
                  ' ' +
                  (c.add
                    ? esc(c.to)
                    : '<span class="cm-import-old">' + esc(c.from || 'blank') + ' →</span> ' + esc(c.to)) +
                  '</span>'
                );
              })
              .join('') +
            '</span>'
          );
        },
        'A blank cell never clears anything. Designations and parent emails are added, never removed.',
      ) +
      (plan.same
        ? '<div class="cm-import-group cm-import-same"><h3>Already Up to Date</h3><span>' +
          _cmPlural(plan.same, 'student', 'students') +
          ', no changes</span></div>'
        : '');
    return '<div class="cm-import-groups"><div>' + left + '</div><div>' + right + '</div></div>';
  }

  function _cmImportCounts(plan) {
    var n = function (list) {
      return list.filter(function (x) {
        return x.on;
      }).length;
    };
    return { added: n(plan.added), renamed: n(plan.renamed), updated: n(plan.updated), withdrawn: n(plan.missing) };
  }

  /* Rows added with a blank to fill in: a date or number that needs a look. */
  function _cmImportBlanks(plan) {
    var rows = plan.added
      .filter(function (a) {
        return a.on;
      })
      .map(function (a) {
        return a.row;
      });
    return plan.read.problems.filter(function (pr) {
      return (pr.kind === 'date' || pr.kind === 'number') && rows.indexOf(pr.p) >= 0;
    });
  }

  function _cmRenderImportReview(cid) {
    var plan = cmPendingImport;
    if (!plan) return '';
    var t = plan.table;
    if (plan.nonames && t) {
      var heads = t.headers.filter(Boolean);
      return (
        '<div class="cm-section cm-import-card" role="region" aria-labelledby="cm-import-title">' +
        '<div class="cm-import-card-head"><span class="cm-import-card-mark" aria-hidden="true">!</span><h2 id="cm-import-title" tabindex="-1">No Names Found</h2></div>' +
        '<p class="cm-import-card-text">FullVision couldn\'t find a column of student names in <strong>' +
        esc(plan.fileName) +
        '</strong>.' +
        (heads.length ? ' Its columns are ' + esc(_cmJoinWords(heads)) + '.' : '') +
        '</p><p class="cm-hint">If one of them holds the names, choose it. If this is the wrong file, choose another.</p>' +
        '<div class="cm-import-buttons"><button type="button" class="btn btn-primary" data-action="cmImportChooseNames">Choose the Name Column</button>' +
        '<button type="button" class="cm-action-btn" data-action="cmChooseRosterFile">Choose Another File</button>' +
        '<button type="button" class="cm-action-btn" data-action="cmCancelImport">Cancel</button></div>' +
        '</div>'
      );
    }
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var className = course.name || 'this class';
    var first = !getStudents(cid).length;
    var ready = !plan.showColumns && (!t || rosterImportReady(t));
    var counts = _cmImportCounts(plan);
    var left = t
      ? t.headers.filter(function (h, i) {
          return h && !t.map[i] && _rosterColumn(t, i).length;
        })
      : [];
    var title, sub;
    if (first) {
      title = ready
        ? 'Ready to Add ' + _cmPlural(plan.added.length, 'Student', 'Students')
        : 'Check How Your File Was Read';
      sub = ready
        ? 'From <strong>' + esc(plan.fileName) + '</strong>'
        : '<strong>' +
          esc(plan.fileName) +
          '</strong> · ' +
          _cmPlural(t ? t.body.length : plan.total, 'row', 'rows') +
          ". Above each of your columns is what FullVision will do with it. Change any that's wrong.";
    } else {
      title = 'What This File Will Change';
      var said = [];
      if (plan.added.length) said.push(_cmPlural(plan.added.length, 'new student', 'new students'));
      if (plan.renamed.length) said.push(_cmPlural(plan.renamed.length, 'new name', 'new names'));
      if (plan.updated.length) said.push(_cmPlural(plan.updated.length, 'updated detail', 'updated details'));
      sub =
        '<strong>' +
        esc(said.length ? _cmJoinWords(said) + '.' : 'No changes.') +
        '</strong>' +
        (plan.missing.length
          ? ' ' +
            esc(
              _cmPlural(plan.missing.length, 'student', 'students') +
                " in your class aren't in the file; they stay unless you tick them.",
            )
          : '') +
        '<span class="cm-import-file-line"><strong>' +
        esc(plan.fileName) +
        '</strong>' +
        (ready && t && t.myEd
          ? ' · a MyEducation BC class list, every column read'
          : ready && t
            ? ' · every column read'
            : '') +
        ' · matched by student number, then by name</span>';
    }
    var band =
      ready && t && first
        ? '<div class="cm-import-band"><span class="cm-import-band-mark" aria-hidden="true">✓</span><div><strong>' +
          (t.myEd
            ? "This is a class list from MyEducation BC. Every column was read, so there's nothing to match."
            : "Every column was read, so there's nothing to match.") +
          '</strong><span>' +
          (left.length ? esc('Left out: ' + _cmJoinWords(left) + ". FullVision doesn't keep them.") + ' ' : '') +
          '<button type="button" class="cm-import-link" data-action="cmImportShowColumns">Change What\'s Kept</button></span></div></div>'
        : '';
    var columns = !ready && t ? _cmImportNeedsHtml(t) + _cmImportColumnsHtml(plan) : '';
    var named = !t || t.map.some(_cmIsNameField);
    var body = first ? (ready ? _cmImportStudentListHtml(plan) : '') : _cmImportGroupsHtml(cid, plan);
    var foot, button, canGo;
    if (first) {
      var blanks = _cmImportBlanks(plan).length;
      var unnamed = plan.read.unnamed.length;
      foot =
        '<strong>' +
        esc(_cmPlural(counts.added, 'student', 'students') + ' will be added to ' + className + '.') +
        '</strong>' +
        (blanks
          ? ' ' + esc(_cmPlural(blanks, 'with a blank birthday or number.', 'with a blank birthday or number.'))
          : '') +
        (unnamed
          ? ' ' +
            esc(
              unnamed === 1
                ? 'Row ' + plan.read.unnamed[0].line + ' is left out until it has a name.'
                : unnamed + ' rows are left out until they have names.',
            )
          : '') +
        (ready && counts.added ? ' <span class="cm-hint">Untick anyone who isn\'t in this class.</span>' : '');
      button = 'Add ' + _cmPlural(counts.added, 'Student', 'Students');
      canGo = counts.added > 0 && named;
    } else {
      var parts = [];
      if (counts.added) parts.push('add ' + counts.added);
      if (counts.renamed) parts.push('rename ' + counts.renamed);
      if (counts.updated) parts.push('update ' + counts.updated);
      if (counts.withdrawn) parts.push('withdraw ' + counts.withdrawn);
      var sentence = parts.join(', ');
      foot = parts.length
        ? '<strong>' +
          esc(sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.') +
          '</strong>' +
          (counts.withdrawn ? '' : ' No one is withdrawn.') +
          ' Nothing changes until you choose Save Changes.'
        : 'Nothing to change.';
      button = 'Save Changes';
      canGo = parts.length > 0 && named;
    }
    return (
      '<div class="cm-section cm-import-review" role="region" aria-labelledby="cm-import-title">' +
      '<div class="cm-import-head"><div><h2 class="cm-grade-title" id="cm-import-title" tabindex="-1">' +
      esc(title) +
      '</h2><div class="cm-import-sub">' +
      sub +
      '</div></div>' +
      '<button type="button" class="cm-import-link" data-action="cmChooseRosterFile">Choose a Different File</button></div>' +
      band +
      columns +
      _cmImportProblemsHtml(plan) +
      body +
      '<div class="cm-import-foot"><span>' +
      foot +
      '</span>' +
      '<span class="cm-import-buttons"><button type="button" class="cm-action-btn" data-action="cmCancelImport">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmConfirmImport"' +
      (canGo ? '' : ' disabled') +
      '>' +
      esc(button) +
      '</button></span></div>' +
      '</div>'
    );
  }

  function cmImportToggle(kind, idx, on) {
    var plan = cmPendingImport;
    var list = plan && plan[kind];
    if (!list || !list[idx]) return;
    list[idx].on = !!on;
    plan.keep[list[idx].key] = !!on;
    _cmRenderAndFocus(
      '[data-action-change="cmImportToggle"][data-kind=' + _cmAttr(kind) + '][data-idx=' + _cmAttr(idx) + ']',
    );
  }

  function cmImportToggleAll(on) {
    var plan = cmPendingImport;
    if (!plan) return;
    plan.added.forEach(function (a) {
      a.on = !!on;
      plan.keep[a.key] = !!on;
    });
    _cmRenderAndFocus('[data-action-change="cmImportToggleAll"]');
  }

  /* A column's choice changed: read the file again. Choosing a field
     another column has swaps the two. */
  function cmImportPick(col, field) {
    var plan = cmPendingImport;
    if (!plan || !plan.table) return;
    var t = plan.table;
    col = Number(col);
    field = field || '';
    var old = t.map[col] || '';
    if (field) {
      t.map.forEach(function (f, j) {
        if (j === col || f !== field) return;
        t.map[j] = old;
        t.how[j] = old ? 'chosen' : '';
        t.dateOrder[j] = old === 'dateOfBirth' ? rosterDateOrder(_rosterColumn(t, j)) : '';
      });
      t.suggest[col] = '';
    }
    t.map[col] = field;
    t.how[col] = field ? 'chosen' : '';
    t.dateOrder[col] = field === 'dateOfBirth' ? rosterDateOrder(_rosterColumn(t, col)) : '';
    plan.showColumns = true;
    _cmPlanImport(plan);
    var btn = document.querySelector('.cm-import-field-btn[data-col="' + col + '"]');
    _cmFocus(btn);
  }

  function cmImportMap(col, field) {
    cmImportPick(col, field);
  }

  function cmImportDateOrder(col, order) {
    var plan = cmPendingImport;
    if (!plan || !plan.table) return;
    plan.table.dateOrder[Number(col)] = order === 'dmy' ? 'dmy' : 'mdy';
    plan.showColumns = true;
    _cmPlanImport(plan);
    var btn = document.querySelector('.cm-import-field-btn[data-col="' + Number(col) + '"]');
    _cmFocus(btn);
  }

  /* A fix typed on a row: read the file again with it. Focus goes to the
     next row's box. */
  function cmImportFix(line, field, value) {
    var plan = cmPendingImport;
    if (!plan || !plan.table || ['dateOfBirth', 'studentNumber', 'name'].indexOf(field) < 0) return;
    line = Number(line);
    var fix = (plan.fixes[line] = plan.fixes[line] || {});
    var v = String(value || '').trim();
    if (v) fix[field] = v;
    else delete fix[field];
    _cmPlanImport(plan);
    var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-action-change="cmImportFix"]'));
    var next = boxes.find(function (b) {
      return Number(b.dataset.line) > line || (Number(b.dataset.line) === line && b.dataset.field !== field);
    });
    var target = next || document.querySelector('[data-action="cmConfirmImport"]');
    _cmFocus(target);
  }

  function cmImportShowColumns() {
    if (!cmPendingImport) return;
    cmPendingImport.showColumns = true;
    _cmRenderAndFocus('.cm-import-field-btn');
  }

  function cmImportShowAll() {
    if (!cmPendingImport) return;
    cmPendingImport.showAll = true;
    _cmRenderAndFocus('.cm-import-list-row:nth-child(12) input');
  }

  function cmImportChooseNames() {
    if (!cmPendingImport) return;
    cmPendingImport.nonames = false;
    cmPendingImport.showColumns = true;
    _cmRenderAndFocus('.cm-import-field-btn');
  }

  function cmConfirmImport() {
    var plan = cmPendingImport;
    var cid = cmSelectedCourse;
    if (!plan || !cid) return;
    var counts = _cmImportCounts(plan);
    var blanks = plan.read ? _cmImportBlanks(plan) : [];
    var students = getStudents(cid);
    plan.renamed.forEach(function (r) {
      if (!r.on) return;
      var st = students.find(function (s) {
        return s.id === r.sid;
      });
      if (!st) return;
      st.firstName = r.row.firstName || st.firstName;
      st.lastName = r.row.lastName || '';
      st.sortName = (st.lastName + ' ' + st.firstName).trim();
    });
    (plan.updated || []).forEach(function (u) {
      if (!u.on) return;
      var st = students.find(function (s) {
        return s.id === u.sid;
      });
      if (!st) return;
      Object.keys(IMPORT_FIELD_LABELS).forEach(function (k) {
        if (u.row[k]) st[k] = u.row[k];
      });
      (u.row.designations || []).forEach(function (c) {
        st.designations = st.designations || [];
        if (st.designations.indexOf(c) < 0) st.designations.push(c);
      });
      (u.row.parentEmails || []).forEach(function (e) {
        _cmAddGuardianEmail(cid, st, e);
      });
    });
    var newGuardians = [];
    var addedIds = [];
    var blankIds = [];
    plan.added.forEach(function (a) {
      if (!a.on) return;
      var p = a.row;
      var fresh = {
        id: uid(),
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        preferred: p.preferred || '',
        pronouns: p.pronouns || '',
        studentNumber: p.studentNumber || '',
        dateOfBirth: p.dateOfBirth || '',
        email: p.email || '',
        designations: (p.designations || []).slice(),
        attendance: [],
        sortName: ((p.lastName || '') + ' ' + (p.firstName || '')).trim(),
        enrolledDate: new Date().toISOString().slice(0, 10),
      };
      students.push(fresh);
      addedIds.push(fresh.id);
      blanks.forEach(function (pr) {
        if (pr.p === p)
          blankIds.push({
            sid: fresh.id,
            name: _cmRowName(p),
            what: pr.kind === 'date' ? 'birthday' : 'student number',
          });
      });
      (p.parentEmails || []).forEach(function (e) {
        newGuardians.push([fresh, e]);
      });
    });
    newGuardians.forEach(function (pair) {
      _cmAddGuardianEmail(cid, pair[0], pair[1]);
    });
    saveStudents(cid, students);
    // New students get their person id when their create lands; their
    // parent addresses are saved to the guardian table then.
    if (newGuardians.length)
      [4000, 15000].forEach(function (ms) {
        setTimeout(function () {
          _cmFlushPendingGuardians(cid);
        }, ms);
      });
    plan.missing.forEach(function (m) {
      if (m.on) withdrawStudent(cid, m.sid);
    });
    cmPendingImport = null;
    cmImportDone = { cid: cid, added: addedIds, blanks: blankIds, counts: counts, undone: null };
    cmRosterOnly = null;
    renderClassManager();
    var head = document.getElementById('cm-import-done-title');
    _cmFocus(head);
  }

  function cmCancelImport() {
    cmPendingImport = null;
    cmImportError = null;
    renderClassManager();
    var btn = document.querySelector(
      '[data-action="cmImportRoster"], .cm-import-empty [data-action="cmChooseRosterFile"]',
    );
    _cmFocus(btn);
  }

  /* ── After an import: the Done panel ────────────────────────
     It says what happened, names the students left with a blank (Show Them
     filters the roster to them), offers the next step, and marks the new
     rows New until the teacher leaves Class Settings or the class. Undo This
     Import deletes the students it added, for good: only while this panel
     is open, and only students with nothing recorded yet (no scores,
     observations, notes, goals, reflections or ratings). Renames and
     updated details stay as they are. */
  function _cmStudentIdNow(id) {
    return typeof _resolveKnownId === 'function' ? _resolveKnownId('student', id) || id : id;
  }

  function _cmImportNewIds(cid) {
    var done = cmImportDone;
    var ids = {};
    if (!done || done.cid !== cid || done.undone) return ids;
    done.added.forEach(function (id) {
      ids[id] = true;
      ids[_cmStudentIdNow(id)] = true;
    });
    return ids;
  }

  function _cmRosterOnlyIds() {
    if (!cmRosterOnly) return null;
    var ids = {};
    cmRosterOnly.forEach(function (id) {
      ids[id] = true;
      ids[_cmStudentIdNow(id)] = true;
    });
    return ids;
  }

  var _CM_RECORD_GETTERS = [
    'getScores',
    'getQuickObs',
    'getNotes',
    'getGoals',
    'getReflections',
    'getFlags',
    'getTermRatings',
    'getOverrides',
    'getStudentProfileSummaries',
  ];

  /* Anything recorded for this student in this class yet. */
  function _cmStudentHasWork(cid, sid) {
    var has = _CM_RECORD_GETTERS.some(function (name) {
      var get = typeof globalThis !== 'undefined' ? globalThis[name] : undefined;
      if (typeof get !== 'function') return false;
      var v = (get(cid) || {})[sid];
      if (v === undefined || v === null || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    });
    if (has) return true;
    var statuses = typeof getAssignmentStatuses === 'function' ? getAssignmentStatuses(cid) || {} : {};
    return Object.keys(statuses).some(function (k) {
      return k.indexOf(sid + ':') === 0;
    });
  }

  function _cmImportDoneHtml(cid) {
    var done = cmImportDone;
    if (!done || done.cid !== cid) return '';
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var c = done.counts;
    var title,
      lines = '';
    if (done.undone) {
      title = 'Import Undone';
      lines =
        '<p>' +
        esc(
          _cmPlural(done.undone.removed, 'student was', 'students were') +
            ' removed.' +
            (done.undone.kept.length
              ? ' ' +
                _cmJoinWords(done.undone.kept) +
                (done.undone.kept.length === 1 ? ' stays: they already have' : ' stay: they already have') +
                ' scores or observations.'
              : ''),
        ) +
        '</p>';
    } else {
      var only = c.added && !c.renamed && !c.updated && !c.withdrawn;
      if (only) title = _cmPlural(c.added, 'Student', 'Students') + ' Added to ' + (course.name || 'This Class');
      else {
        title = 'Roster Updated';
        var said = [];
        if (c.added) said.push(c.added + ' added');
        if (c.renamed) said.push(c.renamed + ' renamed');
        if (c.updated) said.push(c.updated + ' updated');
        if (c.withdrawn) said.push(c.withdrawn + ' withdrawn');
        lines += '<p>' + esc(said.length ? said.join(', ') + '.' : 'Nothing changed.') + '</p>';
      }
      var roster = getStudents(cid);
      var here = {};
      roster.forEach(function (s) {
        here[s.id] = true;
      });
      var blanks = done.blanks.filter(function (b) {
        return here[_cmStudentIdNow(b.sid)] || here[b.sid];
      });
      if (blanks.length) {
        var who = {};
        blanks.forEach(function (b) {
          who[b.sid] = true;
        });
        var n = Object.keys(who).length;
        var detail =
          blanks.length <= 3
            ? ': ' +
              _cmJoinWords(
                blanks.map(function (b) {
                  return b.name + "'s " + b.what;
                }),
              ) +
              '.'
            : '.';
        lines +=
          '<p>' +
          esc((n === 1 ? '1 has a blank' : n + ' have a blank') + ' to fill in' + detail) +
          ' <button type="button" class="cm-import-link" data-action="cmImportShowBlanks">' +
          (cmRosterOnly ? 'Show All Students' : 'Show Them') +
          '</button></p>';
      }
      var next = [];
      if (_cmTabShown('student-page', cid))
        next.push(
          '<button type="button" class="cm-import-next" data-action="cmSetTab" data-tab="student-page">Print Student Cards</button>',
        );
      next.push(
        '<button type="button" class="cm-import-next" data-action="cmSetTab" data-tab="grading">Set Up Grading</button>',
      );
      lines += '<div class="cm-import-next-row"><span class="cm-hint">Next:</span>' + next.join('') + '</div>';
    }
    return (
      '<div class="cm-section cm-import-done" role="region" aria-labelledby="cm-import-done-title">' +
      '<span class="cm-import-band-mark" aria-hidden="true">✓</span>' +
      '<div class="cm-import-done-body"><h2 id="cm-import-done-title" tabindex="-1">' +
      esc(title) +
      '</h2>' +
      lines +
      '</div>' +
      '<div class="cm-import-done-actions">' +
      (!done.undone && done.added.length
        ? '<button type="button" class="cm-import-link" data-action="cmUndoImport">Undo This Import</button>'
        : '') +
      '<button type="button" class="cm-import-close" data-action="cmCloseImportDone" aria-label="Close">×</button>' +
      '</div></div>'
    );
  }

  function cmImportShowBlanks() {
    var done = cmImportDone;
    if (!done) return;
    cmRosterOnly = cmRosterOnly
      ? null
      : done.blanks.map(function (b) {
          return b.sid;
        });
    _cmRenderAndFocus('[data-action="cmImportShowBlanks"]');
  }

  function cmCloseImportDone() {
    cmImportDone = null;
    cmRosterOnly = null;
    renderClassManager();
    var btn = document.querySelector('[data-action="cmImportRoster"]');
    _cmFocus(btn);
  }

  /* Delete the students this import added, for good, unless something has
     been recorded for them. Renames and details stay. */
  function cmUndoImport() {
    var done = cmImportDone;
    var cid = cmSelectedCourse;
    if (!done || done.cid !== cid || done.undone) return;
    var removed = 0;
    var kept = [];
    done.added.forEach(function (id) {
      var sid = _cmStudentIdNow(id);
      var st = getStudents(cid).find(function (s) {
        return s.id === sid || s.id === id;
      });
      if (!st) return;
      if (_cmStudentHasWork(cid, st.id)) {
        kept.push(fullName(st));
        return;
      }
      if (withdrawStudent(cid, st.id) && deleteWithdrawnStudent(cid, st.id)) {
        removed++;
        if (_cmGuardians[cid]) delete _cmGuardians[cid][st.id];
      }
    });
    done.undone = { removed: removed, kept: kept };
    cmRosterOnly = null;
    renderClassManager();
    var head = document.getElementById('cm-import-done-title');
    _cmFocus(head);
  }

  /* ── Other classes' data ─────────────────────────────────────
     The data layer loads every class at sign-in (preloadClasses). A class
     picked here before its turn is loaded first; until its data is in, it
     shows "Loading", so nothing is edited against an empty copy. The
     sidebar's counts fill in as each class arrives. */
  function _cmClassReady(cid) {
    return !cid || cid === _activeCourse || typeof isClassLoaded !== 'function' || isClassLoaded(cid);
  }

  // The sidebar alone, so a background load never redraws a field the
  // teacher is typing in.
  function _cmRefreshSidebar() {
    var el = document.querySelector('.cm-sidebar');
    if (el && classManagerOpen) el.outerHTML = renderCmSidebar(Object.keys(COURSES));
  }

  function _cmAfterLoad(cid) {
    if (!classManagerOpen) return;
    if (cid === cmSelectedCourse && cmMode === 'edit') renderClassManager();
    else _cmRefreshSidebar();
  }

  // Load the picked class, then show it if it is still the one picked.
  function _cmShowWhenLoaded(cid) {
    if (_cmClassReady(cid)) return;
    loadClass(cid).then(function () {
      _cmAfterLoad(cid);
    });
  }

  // Follow the classes still loading, in the order the data layer loads
  // them, and fill each in as it lands.
  function _cmFollowLoads() {
    if (typeof classesToPreload !== 'function') return;
    preloadClasses();
    classesToPreload().reduce(function (chain, cid) {
      return chain.then(function () {
        if (!classManagerOpen) return;
        return loadClass(cid).then(function () {
          _cmAfterLoad(cid);
        });
      });
    }, Promise.resolve());
  }

  /* `tab` opens the manager on that tab (a link from another page). */
  // tab: a Class Settings tab, or 'new' for the New Class wizard. cid: a
  // class to show other than the open one (from the address's &class=).
  function openClassManager(tab, cid) {
    classManagerOpen = true;
    cmSelectedCourse = cid && COURSES[cid] ? cid : _activeCourse;
    cmMode = 'edit';
    if (_cmTabShown(tab, cmSelectedCourse)) cmTab = tab;
    if (tab === 'new') {
      cmStartCreate();
      return;
    }
    renderClassManager();
    _cmFollowLoads();
  }

  /* Class Settings' own address, kept in step as it changes, so a reload
     or Back returns to the same tab and class (or the New Class wizard):
     /dashboard?manage=grading&class=… . The dashboard opens it from there. */
  function _cmSyncUrl() {
    if (!classManagerOpen || typeof Router === 'undefined' || !Router.setUrl) return;
    if (location.pathname !== '/dashboard') return;
    var url = '/dashboard?manage=' + (cmMode === 'create' ? 'new' : cmTab);
    if (cmMode !== 'create' && cmSelectedCourse && cmSelectedCourse !== _activeCourse && COURSES[cmSelectedCourse])
      url += '&class=' + encodeURIComponent(cmSelectedCourse);
    Router.setUrl(url);
    document.title = 'FullVision \u2014 Class Settings';
  }

  function closeClassManager() {
    classManagerOpen = false;
    // The Done panel and its New marks last until Class Settings closes.
    cmImportDone = null;
    cmRosterOnly = null;
    closeColorPop();
    if (typeof Router !== 'undefined' && Router.setUrl && location.pathname === '/dashboard') {
      Router.setUrl('/dashboard');
      document.title = 'FullVision \u2014 Dashboard';
    }
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

  /* ── Block picker and the empty state: teacher/cm-block-picker.js ── */
  var blockPickerHtml = CmBlockPicker.blockPickerHtml;
  var readBlockPicker = CmBlockPicker.readBlockPicker;
  var blockChipSelect = CmBlockPicker.blockChipSelect;
  var blockOtherInput = CmBlockPicker.blockOtherInput;
  var _cmEmptyStateHtml = CmBlockPicker._cmEmptyStateHtml;
  var cmOpenDemoMode = CmBlockPicker.cmOpenDemoMode;

  // A class for dashboard.css on el (the body, or #main).
  function _cmMark(el, name, on) {
    if (el && el.classList) el.classList.toggle(name, on);
  }

  function renderClassManager() {
    var courseIds = Object.keys(COURSES);
    // Class Settings reads the year so far for every class: its previews
    // (calculation method, Folders Count as One) and Check With a Student
    // never count as of a report left in view on the Reports page.
    if (typeof setActiveTerm === 'function') {
      courseIds.forEach(function (c) {
        setActiveTerm(c, null);
      });
    }
    var html = '';
    // A remembered tab this class doesn't show opens Details instead.
    if (!_cmTabShown(cmTab, cmSelectedCourse)) cmTab = 'details';
    _cmSyncUrl();

    // Top bar
    var detailTitle =
      cmMode === 'create'
        ? 'New Class'
        : cmSelectedCourse && COURSES[cmSelectedCourse]
          ? COURSES[cmSelectedCourse].name
          : 'Class Settings';
    // Class Settings belongs to the dashboard: its toolbar is a breadcrumb
    // back to it in place of the dashboard's own toolbar.
    // dashboard.css keys Class Settings' layout on these two classes.
    _cmMark(document.body, 'cm-open', true);
    var toolbarMount = document.getElementById('page-toolbar-mount');
    if (toolbarMount) {
      toolbarMount.innerHTML =
        '<div class="page-toolbar dash-toolbar cm-toolbar">' +
        renderBreadcrumb('Dashboard', '/dashboard', 'Class Settings', 'closeClassManager') +
        '<span class="dash-toolbar-spacer"></span>' +
        // The tabbed view names the class in its own header.
        (cmMode === 'create' || cmRelinkStep > 0
          ? '<span class="cm-toolbar-detail">' + esc(detailTitle) + '</span>'
          : '') +
        '</div>';
    }

    // The class list takes the student list's place beside the page; the
    // dashboard puts the roster back when Class Settings closes.
    var sideMount = document.getElementById('sidebar-mount');
    if (sideMount) {
      sideMount.removeAttribute('data-cid');
      sideMount.style.display = courseIds.length === 0 && cmMode !== 'create' ? 'none' : '';
    }

    // Empty state
    if (courseIds.length === 0 && cmMode !== 'create') {
      html += _cmEmptyStateHtml();
      _cmMark(document.getElementById('main'), 'cm-listing', false);
      document.getElementById('main').innerHTML = html;
      return;
    }
    _cmMark(document.getElementById('main'), 'cm-listing', true);

    html += '<div class="cm-layout">';
    if (sideMount) sideMount.innerHTML = renderCmSidebar(courseIds);
    else html += renderCmSidebar(courseIds);
    html += '<div class="cm-detail">';

    if (cmMode === 'create') {
      html += renderCmCreateForm();
    } else if (cmRelinkStep > 0 && cmRelinkCid && COURSES[cmRelinkCid]) {
      html += renderCmRelinkPanel(cmRelinkCid);
    } else if (cmCompReview && cmCompReview.kind === 'file' && COURSES[cmCompReview.cid]) {
      html += _cmRenderCompReview(cmCompReview.cid);
    } else if (cmSelectedCourse && COURSES[cmSelectedCourse] && !_cmClassReady(cmSelectedCourse)) {
      html +=
        '<div class="cm-detail-inner cm-tabbed"><div class="cm-head"><div class="cm-head-text">' +
        '<h1 class="cm-head-title">' +
        esc(COURSES[cmSelectedCourse].name) +
        '</h1><div class="cm-head-meta" role="status">Loading this class\u2026</div></div></div></div>';
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
    _cmRosterScrollCue();
    _cmRestoreKeptFocus();
  }

  /* The roster is wider than most windows (twelve columns). While columns
     are hidden off its right edge, the edge fades and a line says to scroll
     sideways, so the scrolling is plain to see. */
  function _cmRosterScrollCue() {
    var scroller = document.querySelector('.cm-rs-scroll');
    if (!scroller || !scroller.addEventListener) return;
    var section = scroller.closest('.cm-rs-section');
    var note = document.getElementById('cm-rs-more');
    function update() {
      var more = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
      if (section) section.classList.toggle('cm-rs-more-right', more);
      if (note) note.hidden = scroller.scrollWidth <= scroller.clientWidth + 1;
    }
    scroller.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* The badge on a class row: its block ("A"), or the name's initials
     when the block is a longer label or there is none. */
  function _cmClassBadge(c) {
    var b = normalizeCourseBlock(c && c.block);
    if (/^[A-Z0-9]{1,2}$/.test(b)) return b;
    var words = String((c && c.name) || '')
      .split(/\s+/)
      .filter(Boolean);
    return ((words[0] || '?').charAt(0) + (words[1] ? words[1].charAt(0) : '')).toUpperCase();
  }

  // html-safe: badge and name are escaped; meta is built by renderCmSidebar from esc(label) and counts.
  function _cmClassItemHtml(cid, meta, extraClass) {
    var c = COURSES[cid];
    var sel = cid === cmSelectedCourse && cmMode === 'edit' ? ' selected' : '';
    return (
      '<div class="cm-class-item' +
      sel +
      (extraClass || '') +
      '" data-action="cmSelectClass" data-cid="' +
      cid +
      '">' +
      '<span class="cm-class-avatar" aria-hidden="true" style="background:' +
      (typeof _avatarColor === 'function' ? _avatarColor(cid) : 'var(--text-3)') +
      '">' +
      esc(_cmClassBadge(c)) +
      '</span>' +
      '<span class="cm-class-text">' +
      '<span class="cm-class-name">' +
      esc(c.name || '') +
      '</span>' +
      '<span class="cm-class-meta">' +
      meta +
      '</span>' +
      '</span>' +
      '</div>'
    );
  }

  function _cmStudentCount(n) {
    return n + ' Student' + (n !== 1 ? 's' : '');
  }

  // html-safe: counts and fixed markup; block labels are escaped; rows come from _cmClassItemHtml.
  function renderCmSidebar(courseIds) {
    var html =
      '<aside class="cm-sidebar" aria-label="Classes">' +
      '<div class="cm-sidebar-header">' +
      '<span class="cm-sidebar-title">Classes</span>' +
      // New Class sits at the top of the class list, as a button (in place
      // of the class count, which the list itself shows).
      '<button type="button" class="cm-action-btn cm-new-class-btn" data-action="cmStartCreate">' +
      '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/></svg>' +
      'New Class</button>' +
      '</div>' +
      '<div class="cm-class-list">';
    if (cmMode === 'create') {
      html +=
        '<div class="cm-class-item cm-create-active">' +
        '<span class="cm-class-avatar cm-class-avatar-new" aria-hidden="true">+</span>' +
        '<span class="cm-class-text">' +
        '<span class="cm-class-name">New Class</span>' +
        '<span class="cm-class-meta">Setting up…</span>' +
        '</span>' +
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
      var ready = _cmClassReady(cid);
      var label = courseBlockLabel(COURSES[cid]);
      var meta = (label ? esc(label) + ' · ' : '') + (ready ? _cmStudentCount(getStudents(cid).length) : 'Loading…');
      html += _cmClassItemHtml(cid, meta);
    });
    if (archivedCids.length > 0) {
      html += '<div class="cm-class-group">Archived</div>';
      archivedCids.forEach(function (cid) {
        html += _cmClassItemHtml(cid, _cmStudentCount(getStudents(cid).length) + ' · Archived', ' archived');
      });
    }
    html +=
      '</div>' +
      '<div class="cm-sidebar-foot">' +
      '<button type="button" class="cm-new-btn" data-action="cmRestoreBackup">Restore from Backup</button>' +
      '</div>' +
      '</aside>';
    return html;
  }

  function renderCmDetail(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var lm = getLearningMap(cid);
    var studentCount = getStudents(cid).length;
    var assessCount = getAssessments(cid).length;
    var tagCount = getAllTags(cid).length;
    var panels = {};

    var html = '';

    // Details tab: Class Details
    html +=
      '<div class="cm-section">' +
      '<div class="cm-section-title">Class Details</div>' +
      '<div class="cm-details-row">' +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-name">Class Name</label>' +
      '<input class="cm-input" id="cm-name" value="' +
      esc(course.name) +
      '" data-action-blur="cmUpdateName">' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-grade">Grade Level</label>' +
      '<input class="cm-input" id="cm-grade" value="' +
      esc(course.gradeLevel || '') +
      '" placeholder="e.g. 10-12" data-action-blur="cmUpdateGrade">' +
      '</div>' +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label" id="cm-block-label">Block</label>' +
      blockPickerHtml('cm-block', course.block) +
      '</div>' +
      '<div class="cm-field">' +
      '<label class="cm-label">Description</label>' +
      '<textarea class="cm-textarea" id="cm-desc" placeholder="Optional course description\u2026" data-action-blur="cmUpdateDesc">' +
      esc(course.description || '') +
      '</textarea>' +
      '</div>' +
      // Late Work Policy: free text, optional. Printed reports show it in
      // the Score Distribution block.
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-late-policy">Late Work Policy</label>' +
      '<textarea class="cm-textarea" id="cm-late-policy" rows="2" placeholder="e.g. Late assignments lose 10% per day, up to 3 days." data-action-blur="cmLateWorkPolicy">' +
      esc(course.lateWorkPolicy || '') +
      '</textarea>' +
      '<div class="cm-hint">Optional. Printed reports with a Score Distribution block show it.</div>' +
      '</div>' +
      '</div>';
    panels.details = html;
    html = '';

    // Students tab: a toolbar, the roster edited in place, then Withdrawn
    var students = getStudents(cid);
    _cmLoadGuardians(cid);
    // An empty class shows where the class list goes (cmImportEmptyHtml)
    // in place of the toolbar.
    html +=
      _cmImportDoneHtml(cid) +
      (students.length
        ? '<div class="cm-roster-bar">' +
          '<div class="cm-rs-tools">' +
          '<label class="cm-rs-search"><span class="cm-rs-sr">Find a student</span>' +
          '<input class="cm-input" type="search" placeholder="Find a student" data-action-input="cmRosterSearch" value="' +
          esc(cmRosterQuery) +
          '"></label>' +
          '<span class="cm-hint cm-rs-summary">Click any field to edit. Enter or ↓ moves down a column, Tab moves across.' +
          '<span id="cm-rs-more" hidden> Scroll sideways for more columns.</span></span>' +
          '<span class="cm-hint cm-rs-summary" id="cm-rs-summary">' +
          esc(_cmRosterSummary(cid)) +
          '</span>' +
          '</div>' +
          '<div class="cm-roster-buttons">' +
          '<button type="button" class="cm-action-btn" data-action="cmImportRoster">Import Roster</button>' +
          '<button type="button" class="btn btn-primary cm-roster-add" data-action="cmShowAddStudent">Add Student</button>' +
          '</div>' +
          '</div>'
        : '') +
      '<input type="file" id="cm-csv-input" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden data-action-change="cmCSV">' +
      '<div id="cm-import-preview">' +
      (cmImportError
        ? _cmImportErrorHtml(cmImportError)
        : cmPendingImport
          ? _cmRenderImportReview(cid)
          : cmImportFormatOpen && students.length
            ? cmImportFormatHtml()
            : !students.length
              ? cmImportEmptyHtml()
              : '') +
      '</div>';
    var rosterHtml = students.length ? _cmRosterHtml(cid) : '';
    // Add/Edit student form
    html +=
      '<div id="cm-add-student-form" style="display:none" class="cm-add-student-form">' +
      '<div class="cm-student-form">' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-first">First Name *</label><input class="cm-input" id="cm-add-first" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-last">Last Name</label><input class="cm-input" id="cm-add-last" placeholder="e.g. Osei" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-pref">Preferred Name</label><input class="cm-input" id="cm-add-pref" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      // Pronouns take the same list and free text as the roster's box.
      '<div class="cm-field"><label class="cm-label" for="cm-add-pro">Pronouns</label>' +
      '<input class="cm-input" id="cm-add-pro" list="cm-add-pronouns" autocomplete="off" style="font-size:0.875rem;padding:6px 10px">' +
      '<datalist id="cm-add-pronouns">' +
      PRONOUNS_OPTIONS.map(function (p) {
        return '<option value="' + esc(p) + '">';
      }).join('') +
      '</datalist>' +
      '</div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-num">Student Number</label><input class="cm-input" id="cm-add-num" placeholder="e.g. STU-101" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-email">Email</label><input class="cm-input" id="cm-add-email" type="email" placeholder="student@school.edu" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-add-dob">Date of Birth</label><input class="cm-input" id="cm-add-dob" type="date" style="font-size:0.875rem;padding:6px 10px"></div>' +
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
      '<div class="cm-field" style="grid-column:1/-1"><label class="cm-label">Language Support</label>' +
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
      '<span class="cm-hint" id="cm-add-status" role="status" aria-live="polite" style="margin-right:auto;align-self:center"></span>' +
      '<button class="btn btn-ghost" data-action="cmCancelStudent" style="padding:6px 10px;font-size:0.8125rem">Cancel</button>' +
      '<button class="btn btn-ghost" id="cm-save-another-btn" data-action="cmSaveStudentAndAnother" style="padding:6px 14px;font-size:0.8125rem">Save and Add Another</button>' +
      '<button class="btn btn-primary" id="cm-save-btn" data-action="cmSaveStudent" style="padding:6px 14px;font-size:0.8125rem">Save</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      rosterHtml +
      renderWithdrawnList(cid);
    panels.students = html;
    html = '';

    // Questionnaires tab (teacher/cm-questionnaires.js)
    if (typeof CmQuestionnaires !== 'undefined') panels.questionnaires = CmQuestionnaires.render(cid);

    // Student Page tab (teacher/cm-student-page.js), built only where shown
    if (_cmTabShown('student-page', cid)) panels['student-page'] = CmStudentPage.render(cid);

    // Grading tab
    panels.grading = _cmRenderGradingTab(cid);

    // Reporting Terms tab
    panels.terms = '<div class="cm-section">' + _cmRenderReportingTermsField(cmSelectedCourse) + '</div>';
    html = '';

    // Competencies tab: a toolbar and the competencies, beside the BC
    // Curriculum link and the subjects.
    html += '<div class="cm-section cm-comp-side-card">' + '<h2 class="cm-grade-title">Subjects</h2>';
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
    var subjectsHtml = html;
    html = '';

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

    html += _cmRenderCompToolbar(cid, lm, compGroups) + '<div class="cm-section cm-comp-list">';

    if ((lm.sections || []).length === 0 && compGroups.length === 0) {
      html +=
        '<div class="cm-curriculum-empty">' +
        '<div class="cm-curriculum-empty-text">No competencies yet. Add one to start building this class\u2019s curriculum.</div>' +
        '</div>';
    }

    // Each folder's Counts as One only matters while the class counts
    // folders as one, so with that off the switches go and this says why.
    var foldersCount = getFoldersCountAsOne(cid);
    if (!foldersCount && compGroups.length > 0) {
      html +=
        '<div class="cm-hint cm-folder-count-off">Folders Count as One is off in Grading, so every competency counts the same in the overall.</div>';
    }

    // Competencies outside folders sit where their order puts them among
    // the folders (Ministry order for an imported class: Understanding
    // Context before Defining), each run a drop target for "no folder".
    var _cmSecIndex = {};
    (lm.sections || []).forEach(function (sec, i) {
      _cmSecIndex[sec.id] = i;
    });
    var _cmLoose = _cmGrouped.ungrouped.slice();
    function _cmLooseRun(before) {
      var run = [];
      while (_cmLoose.length && (before == null || _cmSecIndex[_cmLoose[0].id] < before)) run.push(_cmLoose.shift());
      if (!run.length) return '';
      return (
        '<div class="mod-folder no-module open cm-loose-run" data-folder-drop="__none__"><div class="mod-folder-body">' +
        run
          .map(function (sec) {
            return _cmRenderStdCard(sec, lm, compGroups);
          })
          .join('') +
        '</div></div>'
      );
    }

    // Render group folders (reuses .mod-folder pattern from assignments page)
    _cmGrouped.groups.forEach(function (gi) {
      var grp = gi.group;
      var secs = gi.sections;
      if (secs.length)
        html += _cmLooseRun(
          Math.min.apply(
            null,
            secs.map(function (s) {
              return _cmSecIndex[s.id];
            }),
          ),
        );
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
        '<button type="button" class="mod-folder-color" style="background:' +
        cssColor(grp.color) +
        '" title="Change colour" aria-label="Change colour" aria-haspopup="dialog" draggable="false"' +
        ' data-action="cmOpenGroupColorPop" data-grpid="' +
        grp.id +
        '" data-stop-prop="true"></button>' +
        '<input class="mod-folder-name-input" value="' +
        esc(grp.name) +
        '" draggable="false" data-stop-prop="true" data-action-blur="cmCompGroupName" data-grpid="' +
        grp.id +
        '">' +
        '<span class="mod-folder-meta">' +
        secs.length +
        (secs.length !== 1 ? ' Competencies' : ' Competency') +
        '</span>' +
        '<div class="mod-folder-actions" data-stop-prop="true">' +
        (foldersCount
          ? '<label class="cm-folder-count" title="On: this folder is averaged first and counts as one competency in the overall. Off: each competency in it counts on its own.">' +
            '<span class="cm-folder-count-text">Counts as One</span>' +
            '<span class="gpd-switch"><input type="checkbox" role="switch" aria-label="' +
            esc(grp.name + ' Counts as One') +
            '" data-action-change="cmFolderCountsAsOne" data-grpid="' +
            grp.id +
            '"' +
            (grp.countsAsOne !== false ? ' checked' : '') +
            '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
            '</label>'
          : '') +
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
          '<div class="mod-folder-empty">Drag competencies here, or choose this folder on a competency\u2019s card.</div>';
      }
      secs.forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
      html += '</div></div>';
    });

    // The rest of the competencies outside folders, after the last folder.
    // With none, the Ungrouped drop target stays so a card can leave its
    // folder.
    if (compGroups.length > 0 && _cmGrouped.ungrouped.length > 0) {
      html += _cmLooseRun(null);
    } else if (compGroups.length > 0) {
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
        (_cmGrouped.ungrouped.length !== 1 ? ' Competencies' : ' Competency') +
        '</span>' +
        '</div>' +
        '<div class="mod-folder-body">';
      _cmGrouped.ungrouped.forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
      if (_cmGrouped.ungrouped.length === 0) {
        html += '<div class="mod-folder-empty">Every competency is in a folder</div>';
      }
      html += '</div></div>';
    } else {
      // No groups at all — render flat
      (lm.sections || []).forEach(function (sec) {
        html += _cmRenderStdCard(sec, lm, compGroups);
      });
    }

    html += '</div>';
    var compHtml = html;
    html = '';

    // BC Curriculum Link
    var linkedTags = course.curriculumTags || [];
    html += '<div class="cm-section cm-comp-side-card">' + '<h2 class="cm-grade-title">BC Curriculum Link</h2>';
    if (linkedTags.length > 0) {
      linkedTags.forEach(function (tag) {
        var courseData = CURRICULUM_INDEX ? CURRICULUM_INDEX[tag] : null;
        var tagSubject = (lm.subjects || []).find(function (sub) {
          return sub.id === tag;
        });
        var courseName = courseData ? courseData.course_name : tagSubject ? tagSubject.name : tag;
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
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' +
        cid +
        '">Re-link Curriculum</button>' +
        '<div class="cm-hint">You\u2019ll see what changes before anything is applied. Nothing you edited is overwritten.</div>';
    } else {
      html +=
        '<div class="cm-curric-unlinked">Not linked to BC Curriculum</div>' +
        '<button class="cm-relink-btn" data-action="cmStartRelink" data-cid="' +
        cid +
        '">Link to BC Curriculum</button>';
    }
    html += '</div>';
    // Select mode is the list alone.
    panels.competencies = cmCompSelect
      ? '<div class="cm-comp-layout cm-comp-selecting"><div class="cm-comp-main">' + compHtml + '</div></div>'
      : '<div class="cm-comp-layout"><div class="cm-comp-main">' +
        compHtml +
        '</div><div class="cm-comp-side">' +
        html +
        subjectsHtml +
        '</div></div>';

    var tab = panels[cmTab] != null ? cmTab : 'details';
    return (
      '<div class="cm-detail-inner cm-tabbed' +
      (tab === 'students' ? ' cm-tabbed-wide' : '') +
      '">' +
      _cmRenderHeader(cid, studentCount, assessCount, tagCount) +
      _cmRenderTabs(tab, studentCount, tagCount) +
      '<div class="cm-tab-panel cm-tab-panel-' +
      tab +
      '" role="tabpanel" id="cm-tabpanel" aria-labelledby="cm-tab-' +
      tab +
      '">' +
      panels[tab] +
      '</div>' +
      '</div>'
    );
  }

  /* \u2500\u2500 Class header and tabs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
     The class's name and counts, Open Gradebook, and Class Actions
     (Duplicate, Archive, and Delete once archived) in a menu. */
  function _cmRenderHeader(cid, studentCount, assessCount, tagCount) {
    var course = COURSES[cid];
    var isArchived = isCourseArchived(cid);
    var meta = [];
    var block = typeof courseBlockLabel === 'function' ? courseBlockLabel(course) : '';
    if (block) meta.push(block);
    if (course.gradeLevel) meta.push('Grade ' + course.gradeLevel);
    meta.push(studentCount + ' Student' + (studentCount !== 1 ? 's' : ''));
    meta.push(assessCount + ' Assessment' + (assessCount !== 1 ? 's' : ''));
    meta.push(tagCount + ' Competenc' + (tagCount !== 1 ? 'ies' : 'y'));
    return (
      '<div class="cm-head">' +
      '<div class="cm-head-text">' +
      '<h1 class="cm-head-title">' +
      esc(course.name) +
      '</h1>' +
      '<div class="cm-head-meta">' +
      esc(meta.join(' \u00B7 ')) +
      (isArchived ? ' \u00B7 Archived' : '') +
      '</div>' +
      '</div>' +
      '<div class="cm-head-actions">' +
      '<button type="button" class="cm-action-btn" data-action="cmOpenGradebook" data-cid="' +
      cid +
      '">Open Gradebook</button>' +
      '<div class="cm-std-menu-wrap">' +
      '<button type="button" class="cm-action-btn" data-action="cmStdMenu" aria-haspopup="menu" aria-expanded="false">Class Actions \u25BE</button>' +
      '<div class="cm-std-menu cm-class-actions-menu" role="menu" hidden>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmDuplicateCourse" data-cid="' +
      cid +
      '">Duplicate Class</button>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmDownloadBackup" data-cid="' +
      cid +
      '">Download Class Backup</button>' +
      '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmToggleArchive" data-cid="' +
      cid +
      '">' +
      (isArchived ? 'Unarchive Class' : 'Archive Class') +
      '</button>' +
      (isArchived
        ? '<button type="button" role="menuitem" class="cm-std-menu-item danger" data-action="cmDeleteCourse" data-cid="' +
          cid +
          '">Delete Class</button>'
        : '<div class="cm-class-actions-note">Delete Class appears here once a class is archived.</div>') +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* A tab marked `hidden` is not there: no button in the tab bar, no way in
     by click, arrow key, address or remembered tab, and its panel is never
     built. `hidden` is true, or a function of the class id for a tab some
     classes show. Student Page (teacher/cm-student-page.js) decides its own
     and is hidden for every class until S1-F4
     (docs/plans/student-page-build-plan.md). */
  var CM_TABS = [
    { id: 'details', label: 'Details' },
    { id: 'students', label: 'Students' },
    { id: 'questionnaires', label: 'Questionnaires' },
    {
      id: 'student-page',
      label: 'Student Page',
      hidden: function (cid) {
        return typeof CmStudentPage === 'undefined' || CmStudentPage.isShown(cid) !== true;
      },
    },
    { id: 'grading', label: 'Grading' },
    { id: 'terms', label: 'Reporting Terms' },
    { id: 'competencies', label: 'Competencies' },
  ];

  function _cmTabHidden(t, cid) {
    return !!(typeof t.hidden === 'function' ? t.hidden(cid) : t.hidden);
  }

  // The tabs a class shows, in order.
  function _cmShownTabs(cid) {
    return CM_TABS.filter(function (t) {
      return !_cmTabHidden(t, cid);
    });
  }

  function _cmTabShown(tab, cid) {
    return _cmShownTabs(cid).some(function (t) {
      return t.id === tab;
    });
  }

  function _cmRenderTabs(active, studentCount, tagCount) {
    var counts = { students: studentCount, competencies: tagCount };
    if (typeof CmQuestionnaires !== 'undefined') counts.questionnaires = CmQuestionnaires.countOn(cmSelectedCourse);
    return (
      '<div class="cm-tabs" role="tablist" aria-label="Class settings">' +
      CM_TABS.map(function (t) {
        if (_cmTabHidden(t, cmSelectedCourse)) return '';
        var on = t.id === active;
        return (
          '<button type="button" class="cm-tab' +
          (on ? ' active' : '') +
          '" role="tab" id="cm-tab-' +
          t.id +
          '" aria-selected="' +
          on +
          '" aria-controls="cm-tabpanel" tabindex="' +
          (on ? '0' : '-1') +
          '" data-action="cmSetTab" data-tab="' +
          t.id +
          '">' +
          t.label +
          (counts[t.id] != null ? ' <span class="cm-tab-count">' + counts[t.id] + '</span>' : '') +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function cmSetTab(tab) {
    if (!_cmTabShown(tab, cmSelectedCourse)) return;
    cmTab = tab;
    // A school picked but not used goes back to the class's own.
    if (cmSelectedCourse) delete _cmTermSchool[cmSelectedCourse];
    renderClassManager();
    var detail = document.querySelector('.cm-detail');
    if (detail) detail.scrollTop = 0;
    var btn = document.getElementById('cm-tab-' + tab);
    if (btn && typeof btn.focus === 'function') btn.focus({ preventScroll: true });
  }

  function cmOpenGradebook(cid) {
    if (!cid || !COURSES[cid]) return;
    classManagerOpen = false;
    if (typeof setActiveCourse === 'function') setActiveCourse(cid);
    if (typeof Router !== 'undefined' && Router.navigate) Router.navigate('/gradebook');
  }

  /* ── Grading tab ────────────────────────────────────────────
     Grading System on top; under it two lanes, Competency Proficiency (the
     calculation method) and Course Percentage (categories and rounding), and
     beside them Check With a Student, one real student's grade under the
     current settings. A lane the grading system doesn't use is greyed with a
     line saying so. */
  var CM_GRADING_SYSTEMS = [
    { value: 'proficiency', label: 'Proficiency', desc: 'Emerging to Extending, out of 4', sample: '3.0 · Proficient' },
    { value: 'letter', label: 'Letter', desc: 'Letter grade and %', sample: 'B 82%' },
    { value: 'both', label: 'Both', desc: 'Proficiency day to day, letter and % on reports', sample: '3.0 · B 82%' },
  ];
  var CM_METHOD_TEXT = {
    mostRecent: { label: 'Most Recent Score', desc: 'Only the latest score counts.' },
    highest: { label: 'Highest Score', desc: 'The best score counts.' },
    decayingAvg: { label: 'Decaying Average', desc: 'Every score counts; newer ones count more.' },
    average: { label: 'Mean', desc: 'Every score counts the same.' },
    median: { label: 'Median', desc: 'The middle score.' },
    mode: { label: 'Mode', desc: 'The score that comes up most.' },
  };
  var CM_METHOD_ORDER = ['mostRecent', 'highest', 'decayingAvg', 'average', 'median', 'mode'];
  var CM_EXAMPLE_SCORES = [1, 2, 2, 3, 4];
  var _cmCheckSid = {}; // cid -> the student Check With a Student shows

  function _cmMethodRule(method, dw) {
    var w = Math.round(dw * 100);
    switch (method) {
      case 'highest':
        return 'The highest score counts, whenever it was earned.';
      case 'decayingAvg':
        return (
          'Start with the oldest score. Each newer score moves the average: new average = old average × ' +
          (100 - w) +
          '% + new score × ' +
          w +
          '%.'
        );
      case 'average':
        return 'Add the scores and divide by how many there are. An assessment with a higher weight counts more.';
      case 'median':
        return 'Sort the scores and take the middle one. With an even number of scores, take the halfway point between the two middle scores.';
      case 'mode':
        return 'The proficiency that comes up most, counted by whole level, so 3+ and 3 both count as 3. A tie goes to the most recent of the tied scores, keeping its + or −.';
      default:
        return 'The score with the latest date counts. Earlier scores are ignored.';
    }
  }

  function _cmRenderGradingTab(cid) {
    var course = COURSES[cid];
    var cc = getCourseConfig(cid);
    var gs = course.gradingSystem || _cmDefaultGradingSystem(course);
    var method = cc.calcMethod || course.calcMethod || 'average';
    // calc.js counts any method it doesn't know as Most Recent; show that.
    if (!CM_METHOD_TEXT[method]) method = 'mostRecent';
    var dw = cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65;
    var lastN = getRecentScoreLimit(cid);

    var html =
      '<div class="cm-section">' +
      '<div class="cm-grade-head">' +
      '<div><h2 class="cm-grade-title">Grading System</h2>' +
      '<div class="cm-hint">What students and families see as the grade.</div></div>' +
      '<button type="button" class="cm-action-btn" data-action="cmCopySetup">Copy Grading Setup…</button>' +
      '</div>' +
      '<div class="cm-gs-cards" role="radiogroup" aria-label="Grading system">' +
      CM_GRADING_SYSTEMS.map(function (g) {
        var on = g.value === gs;
        return (
          '<button type="button" class="cm-gs-card' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="cmSetGradingSystem" data-value="' +
          g.value +
          '">' +
          '<span class="cm-gs-name">' +
          g.label +
          '</span>' +
          '<span class="cm-gs-desc">' +
          g.desc +
          '</span>' +
          '<span class="cm-gs-sample">Students see <strong>' +
          g.sample +
          '</strong></span>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      _cmRenderLevelOrderField(cid) +
      '</div>';

    var profNote =
      gs === 'letter'
        ? '<div class="cm-lane-note">In a Letter class this sets the competency views only. It does not change the %.</div>'
        : '';
    var prof =
      '<div class="cm-section cm-lane">' +
      '<h2 class="cm-grade-title">Competency Proficiency</h2>' +
      '<div class="cm-hint">How each competency’s proficiency comes from a student’s scores.</div>' +
      profNote +
      '<div class="cm-method-head"><span class="cm-label" id="cm-method-label">Calculation Method</span>' +
      '<span class="cm-hint">Example scores, oldest first: ' +
      CM_EXAMPLE_SCORES.join(', ') +
      (lastN && lastN < CM_EXAMPLE_SCORES.length ? ' (the last ' + lastN + ' count)' : '') +
      '</span></div>' +
      '<div class="cm-method-list" role="radiogroup" aria-labelledby="cm-method-label">' +
      CM_METHOD_ORDER.map(function (m) {
        var on = m === method;
        var t = CM_METHOD_TEXT[m];
        return (
          '<button type="button" class="cm-method' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="cmSetCalcMethod" data-value="' +
          m +
          '">' +
          '<span class="cm-method-dot" aria-hidden="true"></span>' +
          '<span class="cm-method-text"><span class="cm-method-name">' +
          t.label +
          '</span><span class="cm-method-desc">' +
          t.desc +
          '</span></span>' +
          '<span class="cm-method-example">' +
          formatLevelAs(null, calcMethodExample(CM_EXAMPLE_SCORES, m, dw, lastN), 'proficiency') +
          '</span>' +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (method === 'decayingAvg'
        ? '<div class="cm-field"><label class="cm-label" for="cm-decay-slider">How Much Newer Work Counts</label>' +
          '<div class="cm-slider-row">' +
          '<input type="range" min="10" max="95" value="' +
          Math.round(dw * 100) +
          '" id="cm-decay-slider" data-action-input="cmDecaySlider" data-action-change="cmDecayCommit" style="flex:1">' +
          '<span class="cm-slider-label" id="cm-decay-val">' +
          Math.round(dw * 100) +
          '%</span></div></div>'
        : '') +
      '<div class="cm-rule-box">' +
      '<div class="cm-rule-title">Exactly How ' +
      CM_METHOD_TEXT[method].label +
      ' Works</div>' +
      '<div class="cm-rule-text" id="cm-method-rule">' +
      esc(_cmMethodRule(method, dw)) +
      '</div>' +
      (lastN && method !== 'mostRecent'
        ? '<div class="cm-rule-text">Only the most recent ' + lastN + ' scores count.</div>'
        : '') +
      '<div class="cm-hint">Every method skips work that hasn’t been scored.</div>' +
      '</div>' +
      _cmRenderRecentLimit(method, lastN) +
      _cmRenderFoldersCountAsOne(cid) +
      _cmRenderCoursesCountEqually(cid) +
      _cmRenderPointsScale(cid) +
      '</div>';

    var pctOff = gs === 'proficiency';
    var whole = getRoundWholePercent(cid);
    var pct =
      '<div class="cm-section cm-lane' +
      (pctOff ? ' cm-lane-off' : '') +
      '">' +
      '<h2 class="cm-grade-title">Course Percentage</h2>' +
      '<div class="cm-hint">How the letter grade and % come from points and proficiency.</div>' +
      (pctOff
        ? '<div class="cm-lane-note">Not used in a Proficiency class. Choose Letter or Both to turn it on. Your categories stay saved.</div>'
        : '') +
      _cmRenderWeightBar(cid) +
      _cmRenderCategoriesField(cid) +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-round-percent">Show the % As</label>' +
      '<select class="cm-input" id="cm-round-percent" data-action-change="cmRoundPercentSelect">' +
      '<option value="whole"' +
      (whole ? ' selected' : '') +
      '>Whole Number (86%)</option>' +
      '<option value="decimal"' +
      (whole ? '' : ' selected') +
      '>One Decimal (85.9%)</option>' +
      '</select>' +
      '<div class="cm-hint">BC report cards for grades 10–12 show a whole %.</div>' +
      '</div>' +
      '<div class="cm-rule-box">' +
      '<div class="cm-rule-title">Exactly How the % Works</div>' +
      '<div class="cm-rule-text">With no categories, the % is total points earned out of total points possible.</div>' +
      '<div class="cm-rule-text">A category with no marked work for a student is left out, and the other categories share its weight.</div>' +
      '<div class="cm-rule-text">A category set to Average of Percentages turns each assessment into a percent first, so each counts the same however many points it has.</div>' +
      '<div class="cm-rule-text">Proficiency work counts as the percent set under Counts As in Points and Proficiency. Proficient counts as ' +
      _cmPctText(_cmStepValues(getGradingScale(cid))['3']) +
      '% now.</div>' +
      '<div class="cm-rule-text">The letter comes from the % as shown. Shown as a whole number, 85.5% becomes 86% and an A. Shown to one decimal, 85.94% stays 85.9% and a B.</div>' +
      '</div>' +
      '</div>';

    html +=
      '<div class="cm-grade-body">' +
      '<div class="cm-grade-lanes">' +
      prof +
      pct +
      '</div>' +
      _cmRenderCheckStudent(cid, gs, method) +
      '</div>';
    return html;
  }

  var CM_RECENT_LIMITS = [3, 5];

  /* "Count Only the Most Recent": All Scores, or a competency's last 3 or 5.
     Most Recent Score already counts one, so there it does nothing. */
  function _cmRenderRecentLimit(method, lastN) {
    var off = method === 'mostRecent';
    var opts = [{ value: '', label: 'All Scores' }].concat(
      CM_RECENT_LIMITS.map(function (n) {
        return { value: String(n), label: n + ' Scores' };
      }),
    );
    // A limit saved elsewhere that the menu doesn't list still shows.
    if (lastN && CM_RECENT_LIMITS.indexOf(lastN) < 0) opts.push({ value: String(lastN), label: lastN + ' Scores' });
    return (
      '<div class="cm-recent-limit' +
      (off ? ' off' : '') +
      '">' +
      '<span class="cm-recent-text"><label class="cm-label" for="cm-recent-limit">Count Only the Most Recent</label>' +
      '<span class="cm-hint">' +
      (off ? 'Not used with Most Recent Score.' : 'Older scores beyond this number are left out.') +
      '</span></span>' +
      '<select class="cm-input cm-recent-select" id="cm-recent-limit" data-action-change="cmRecentLimit"' +
      (off ? ' disabled' : '') +
      '>' +
      opts
        .map(function (o) {
          return (
            '<option value="' +
            o.value +
            '"' +
            (String(lastN || '') === o.value ? ' selected' : '') +
            '>' +
            o.label +
            '</option>'
          );
        })
        .join('') +
      '</select>' +
      '</div>'
    );
  }

  /* "Folders Count as One": on, each folder is averaged first and counts as
     one competency in the overall; off, every competency counts the same.
     Each folder's own Counts as One is on its header in Competencies. */
  function _cmRenderFoldersCountAsOne(cid) {
    var on = getFoldersCountAsOne(cid);
    var hasFolders = getGroupedSections(cid).groups.some(function (gi) {
      return gi.sections.length > 0;
    });
    var hint = !hasFolders
      ? 'This class has no folders with competencies yet.'
      : on
        ? 'Each folder is averaged first and counts as one competency in the overall.'
        : 'Every competency counts the same in the overall. Folders only group them.';
    return (
      '<div class="cm-recent-limit cm-folder-count-row">' +
      '<span class="cm-recent-text"><label class="cm-label" for="cm-folders-count">Folders Count as One</label>' +
      '<span class="cm-hint">' +
      hint +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="cm-folders-count" data-action-change="cmFoldersCountAsOne"' +
      (on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>'
    );
  }

  /* "Each Course Counts Equally": on, each course in a combined class is
     rolled up on its own and the courses are averaged; off, one roll-up
     across every competency. Shown only when the class has two or more
     courses with competencies. */
  function _cmRenderCoursesCountEqually(cid) {
    var subjectIds = courseSubjectIds(cid);
    if (subjectIds.length < 2) return '';
    var on = getCoursesCountEqually(cid);
    var names = getSubjects(cid)
      .filter(function (s) {
        return subjectIds.indexOf(s.id) >= 0;
      })
      .map(function (s) {
        return s.name;
      });
    var hint = on
      ? names.length === 2
        ? esc(names[0]) + ' and ' + esc(names[1]) + ' each make up half of the overall.'
        : 'Each of the ' + names.length + ' courses makes up an equal share of the overall.'
      : 'A course with more competencies or folders counts for more in the overall.';
    return (
      '<div class="cm-recent-limit cm-folder-count-row">' +
      '<span class="cm-recent-text"><label class="cm-label" for="cm-courses-equal">Each Course Counts Equally</label>' +
      '<span class="cm-hint">' +
      hint +
      '</span></span>' +
      '<span class="gpd-switch"><input type="checkbox" role="switch" id="cm-courses-equal" data-action-change="cmCoursesCountEqually"' +
      (on ? ' checked' : '') +
      '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
      '</div>'
    );
  }

  /* Points and Proficiency as one 0–100% ruler (Colin, 2026-11-06: the old
     two-column grid didn't speak for itself). Behind it, Points to
     Proficiency: four bands split where each proficiency starts, with a
     handle at each start. Above it, Counts As: a marker for every step (1 to
     4 with + and −) at the percent it counts as in the course %
     (docs/DECISIONS.md, "Proficiency percents" and "Counts As by step"). A
     step with no value of its own sits a third of the way between its whole
     levels and is drawn there. Picking a marker or handle opens one line to
     type its percent; Left and Right nudge it; a drag moves it. */
  var _cmPtsError = null;
  // The marker or handle picked: { cid, kind: 'step', key: '3+' } or
  // { cid, kind: 'edge', level: 2–4 } (where that proficiency starts).
  var _cmPtsPick = null;
  // What was typed when it was refused, shown back in the box.
  var _cmPtsTyped = null;
  // Markers closer than this (in % of the ruler) go on two rows: a pill's
  // width on the narrowest ruler (.cm-pts-ruler's min-width, 420px).
  var CM_PTS_CLOSE = 7.6;
  var CM_PTS_TICKS = [0, 25, 50, 75, 100];

  function _cmStepId(key) {
    return key.replace('+', 'p').replace('-', 'm');
  }
  // 2- reads 2−.
  function _cmStepLabel(key) {
    return key.replace('-', '−');
  }
  // Every step's percent, keyed as COUNTS_AS_STEPS.
  function _cmStepValues(scale) {
    var list = countsAsStepPercents(scale && scale.percents);
    var out = {};
    COUNTS_AS_STEPS.forEach(function (step, i) {
      out[step.key] = list[i];
    });
    return out;
  }
  function _cmHasOwnStep(scale, key) {
    var p = scale && scale.percents;
    return !!p && p[key] != null && p[key] !== '';
  }
  // The percents a save writes: every whole level, and each + or − that has
  // a value of its own.
  function _cmOwnPercents(scale) {
    var saved = _cmStepValues(scale);
    var out = {};
    COUNTS_AS_STEPS.forEach(function (step) {
      if (step.key.length === 1 || _cmHasOwnStep(scale, step.key)) out[step.key] = saved[step.key];
    });
    return out;
  }
  // Where each proficiency starts on a points score: { 1: 0, 2: 50, 3: 73, 4: 86 }.
  function _cmStarts(scale) {
    var at = { 1: 0 };
    ((scale && scale.boundaries) || DEFAULT_GRADING_SCALE.boundaries).forEach(function (row) {
      if (row.proficiency > 1) at[row.proficiency] = Number(row.min) || 0;
    });
    return at;
  }
  // One decimal at most: 91.7, 86.
  function _cmPctText(v) {
    return String(Math.round(v * 10) / 10);
  }
  function _cmPtsLeft(v) {
    return Math.max(0, Math.min(100, v)) + '%';
  }

  // Row 0 or 1 for each marker, lowest first: one too close to the last
  // marker on the top row drops to the second.
  function _cmPtsRows(values) {
    var last = [-Infinity, -Infinity];
    return values.map(function (v) {
      var row = v - last[0] >= CM_PTS_CLOSE ? 0 : v - last[1] >= CM_PTS_CLOSE ? 1 : last[0] <= last[1] ? 0 : 1;
      last[row] = v;
      return row;
    });
  }

  function _cmPtsPicked(cid) {
    return _cmPtsPick && _cmPtsPick.cid === cid ? _cmPtsPick : null;
  }
  function _cmPtsSame(a, b) {
    return !!a && !!b && a.kind === b.kind && (a.kind === 'step' ? a.key === b.key : a.level === b.level);
  }
  function _cmPtsPickId(p) {
    return p.kind === 'step' ? 'cm-pts-step-' + _cmStepId(p.key) : 'cm-pts-edge-' + p.level;
  }
  // The marker or handle a button stands for, or null.
  function _cmPtsFromEl(cid, el) {
    var d = (el && el.dataset) || {};
    if (d.kind === 'step') {
      var ok = COUNTS_AS_STEPS.some(function (s) {
        return s.key === d.key;
      });
      return ok ? { cid: cid, kind: 'step', key: d.key } : null;
    }
    var level = parseInt(d.level, 10);
    return d.kind === 'edge' && level >= 2 && level <= 4 ? { cid: cid, kind: 'edge', level: level } : null;
  }
  function _cmPtsValue(cid, p) {
    var scale = getGradingScale(cid);
    return p.kind === 'step' ? _cmStepValues(scale)[p.key] : _cmStarts(scale)[p.level];
  }
  // How far a drag can take it: between its neighbours.
  function _cmPtsRange(cid, p) {
    var scale = getGradingScale(cid);
    if (p.kind === 'edge') {
      var at = _cmStarts(scale);
      return [at[p.level - 1] + 1, p.level === 4 ? 99 : at[p.level + 1] - 1];
    }
    var list = countsAsStepPercents(scale.percents);
    var i = COUNTS_AS_STEPS.findIndex(function (s) {
      return s.key === p.key;
    });
    var lo = i > 0 ? list[i - 1] + 0.1 : 0;
    var hi = i < list.length - 1 ? list[i + 1] - 0.1 : 100;
    return [Math.ceil(lo * 10) / 10, Math.floor(hi * 10) / 10];
  }

  function _cmRenderPointsScale(cid) {
    var scale = getGradingScale(cid);
    var steps = _cmStepValues(scale);
    var at = _cmStarts(scale);
    var pick = _cmPtsPicked(cid);
    // The scale's own legend: each band and handle names its proficiency.
    var names = {};
    [1, 2, 3, 4].forEach(function (l) {
      names[l] = PROF_LABELS[l];
    });
    var values = COUNTS_AS_STEPS.map(function (s) {
      return steps[s.key];
    });
    var rows = _cmPtsRows(values);
    var markers = COUNTS_AS_STEPS.map(function (s, i) {
      var key = s.key;
      var v = values[i];
      var on = !!pick && pick.kind === 'step' && pick.key === key;
      var name = _cmStepLabel(key) + ' counts as ' + _cmPctText(v) + '%';
      // A whole level that reads back as another level is flagged, not
      // blocked (DECISIONS, "Proficiency percents"): its marker sits over
      // that level's band, and its name says so.
      if (key.length === 1) {
        var readsAs = pointsToProf(v, 100, scale);
        if (readsAs !== Number(key)) name += ', which shows as ' + names[readsAs];
      }
      return (
        '<div class="cm-pts-marker lv-' +
        key.charAt(0) +
        (rows[i] ? ' is-low' : '') +
        (on ? ' is-on' : '') +
        '" data-key="' +
        esc(key) +
        '" style="left:' +
        _cmPtsLeft(v) +
        '">' +
        '<button type="button" class="cm-pts-pill' +
        (on ? ' is-on' : '') +
        '" id="cm-pts-step-' +
        _cmStepId(key) +
        '" data-action="cmPtsPick" data-kind="step" data-key="' +
        esc(key) +
        '" aria-pressed="' +
        on +
        '" aria-label="' +
        esc(name) +
        '" title="' +
        esc(name) +
        '">' +
        esc(_cmStepLabel(key)) +
        '</button><span class="cm-pts-stem" aria-hidden="true"></span></div>'
      );
    }).join('');
    var cuts = [0, at[2], at[3], at[4], 100];
    var bands = [1, 2, 3, 4]
      .map(function (l) {
        return (
          '<span class="cm-pts-band lv-' +
          l +
          '" data-lv="' +
          l +
          '" style="width:' +
          Math.max(0, cuts[l] - cuts[l - 1]) +
          '%">' +
          esc(names[l]) +
          '</span>'
        );
      })
      .join('');
    var edges = [2, 3, 4]
      .map(function (l) {
        var on = !!pick && pick.kind === 'edge' && pick.level === l;
        var name = names[l] + ' starts at ' + at[l] + '%';
        return (
          '<div class="cm-pts-edge' +
          (on ? ' is-on' : '') +
          '" data-level="' +
          l +
          '" style="left:' +
          _cmPtsLeft(at[l]) +
          '"><span class="cm-pts-edge-line" aria-hidden="true"></span>' +
          '<button type="button" class="cm-pts-handle' +
          (on ? ' is-on' : '') +
          '" id="cm-pts-edge-' +
          l +
          '" data-action="cmPtsPick" data-kind="edge" data-level="' +
          l +
          '" aria-pressed="' +
          on +
          '" aria-label="' +
          esc(name) +
          '" title="' +
          esc(name) +
          '">' +
          esc(at[l] + '%') +
          '</button></div>'
        );
      })
      .join('');
    var ticks = CM_PTS_TICKS.map(function (t) {
      return '<span style="left:' + t + '%">' + t + '%</span>';
    }).join('');
    var edit = '';
    if (pick) {
      var isStep = pick.kind === 'step';
      var value = _cmPtsTyped != null ? _cmPtsTyped : isStep ? _cmPctText(steps[pick.key]) : String(at[pick.level]);
      edit =
        '<label class="cm-pts-edit-label" for="cm-pts-input"><span class="cm-pts-edit-name">' +
        esc(isStep ? _cmStepLabel(pick.key) : names[pick.level]) +
        '</span> ' +
        (isStep ? 'counts as' : 'starts at') +
        '</label>' +
        '<input class="cm-input cm-pts-input" type="number" id="cm-pts-input" ' +
        (isStep ? 'min="0" max="100" step="0.1"' : 'min="1" max="99" step="1"') +
        ' value="' +
        esc(value) +
        '" data-action-change="cmPointsScale" data-action-input="cmPtsLive"' +
        (_cmPtsError ? ' aria-invalid="true" aria-describedby="cm-pts-error"' : '') +
        '><span class="cm-pts-unit">%</span>';
    }
    return (
      '<div class="cm-pts-scale">' +
      '<span class="cm-label" id="cm-pts-label">Points and Proficiency</span>' +
      '<div class="cm-pts-scroll"><div class="cm-pts-ruler' +
      (rows.indexOf(1) >= 0 ? ' is-two-rows' : '') +
      '" id="cm-pts-ruler" role="group" aria-labelledby="cm-pts-label">' +
      markers +
      '<div class="cm-pts-bands" aria-hidden="true">' +
      bands +
      '</div>' +
      edges +
      '<div class="cm-pts-ticks" aria-hidden="true">' +
      ticks +
      '</div>' +
      '</div></div>' +
      '<div class="cm-pts-edit">' +
      edit +
      '</div>' +
      (_cmPtsError ? '<div class="cm-pts-error" id="cm-pts-error" role="alert">' + esc(_cmPtsError) + '</div>' : '') +
      '<div class="cm-pts-actions">' +
      '<button type="button" class="cm-action-btn" data-action="cmPointsScaleBc">BC Letter Bands</button>' +
      '<button type="button" class="cm-action-btn" data-action="cmPointsScaleMatch">Match Columns</button>' +
      '<button type="button" class="cm-action-btn cm-pts-reset" data-action="cmPointsScaleReset">Reset to Defaults</button>' +
      '</div>' +
      '</div>'
    );
  }

  /* Counts As from the Points to Proficiency column: Extending halfway from
     its start to 100, Proficient and Developing at their own starts, and
     Emerging at 50, the C- floor, so a Developing student with one Emerging
     still passes (half of Developing's start when that is 50 or lower). */
  function _cmMatchedPercents(boundaries) {
    var at = {};
    boundaries.forEach(function (row) {
      at[row.proficiency] = row.min;
    });
    return {
      4: Math.round(at[4] + (100 - at[4]) / 2),
      3: at[3],
      2: at[2],
      1: at[2] > 50 ? 50 : Math.round(at[2] / 2),
    };
  }

  // The first reporting term that has already ended, or null.
  function _cmEndedTerm(cid) {
    var today = typeof courseToday === 'function' ? courseToday(cid) : '';
    if (!today) return null;
    return (
      getReportingTerms(cid).find(function (t) {
        return t.ends_on && t.ends_on < today;
      }) || null
    );
  }

  function _cmSamePercents(a, b) {
    var x = countsAsStepPercents(a);
    var y = countsAsStepPercents(b);
    return x.every(function (v, i) {
      return Math.abs(v - y[i]) < 1e-9;
    });
  }

  /* Saves the scale. A change to Counts As moves the course % of every
     term, so with a term already ended the teacher confirms first. */
  function _cmApplyPointsScale(cid, scale) {
    var before = getGradingScale(cid).percents;
    function save() {
      var cc = getCourseConfig(cid);
      cc.gradingScale = scale;
      saveCourseConfig(cid, cc);
      if (typeof clearProfCache === 'function') clearProfCache();
      renderClassManager();
    }
    var ended = _cmSamePercents(before, scale.percents) ? null : _cmEndedTerm(cid);
    if (!ended) return save();
    renderClassManager();
    showConfirm(
      'Change the Course %?',
      'This changes the course % for every term, including ' +
        (ended.label || 'Term ' + ended.ordinal) +
        ', which has already ended. Report cards printed before today won’t match.',
      'Change',
      'primary',
      save,
    );
  }

  /* Saves one marker's or handle's percent, typed, nudged or dragged, with
     the rules the old boxes had: a whole level always has a value; a + or −
     keeps its own, or is left in between when it is cleared or still shows
     its in-between value; each step counts for more than the one below;
     each proficiency starts higher than the one below it. */
  function _cmPtsSave(cid, pick, raw) {
    var scale = getGradingScale(cid);
    var saved = _cmStepValues(scale);
    var at = _cmStarts(scale);
    var percents = _cmOwnPercents(scale);
    var text = String(raw == null ? '' : raw).trim();
    var v = parseFloat(text);
    _cmPtsPick = Object.assign({}, pick, { cid: cid });
    function refuse(msg) {
      _cmPtsError = msg;
      _cmPtsTyped = text;
      renderClassManager();
    }
    if (pick.kind === 'edge') {
      // Blank or not a number: back to what is saved.
      if (!isFinite(v)) {
        _cmPtsError = null;
        _cmPtsTyped = null;
        renderClassManager();
        return;
      }
      at[pick.level] = Math.max(0, Math.min(99, parseInt(text, 10) || 0));
      if (!(at[2] > at[1] && at[3] > at[2] && at[4] > at[3]))
        return refuse('Each proficiency must start higher than the one below it.');
    } else {
      var whole = pick.key.length === 1;
      if (text === '' || !isFinite(v)) {
        if (whole || text !== '') {
          _cmPtsError = null;
          _cmPtsTyped = null;
          renderClassManager();
          return;
        }
        delete percents[pick.key];
      } else {
        var r = Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
        if (!whole && !_cmHasOwnStep(scale, pick.key) && _cmPctText(r) === _cmPctText(saved[pick.key]))
          delete percents[pick.key];
        else percents[pick.key] = r;
      }
      var ladder = countsAsStepPercents(percents);
      if (
        !ladder.every(function (x, i) {
          return i === 0 || x > ladder[i - 1];
        })
      )
        return refuse('Each step must count for more than the one below it.');
    }
    var boundaries = DEFAULT_GRADING_SCALE.boundaries.map(function (db) {
      return { min: db.proficiency === 1 ? 0 : at[db.proficiency], proficiency: db.proficiency };
    });
    _cmPtsError = null;
    _cmPtsTyped = null;
    var before = JSON.stringify([_cmStarts(scale), _cmOwnPercents(scale)]);
    if (before === JSON.stringify([at, percents])) return renderClassManager();
    // Labels saved before the scale moved here are kept as they were.
    _cmApplyPointsScale(cid, { boundaries: boundaries, percents: percents, labels: scale.labels || null });
  }

  // The box under the scale changed (typed, then Enter or leaving it).
  function cmSavePointsScale(el) {
    if (!cmSelectedCourse) return;
    var pick = _cmPtsPicked(cmSelectedCourse);
    if (!pick || !el) return;
    _cmPtsSave(cmSelectedCourse, pick, el.value);
  }

  // A marker or handle clicked: it is picked, or, picked already, let go.
  var _cmPtsDragEnd = 0;
  function cmPtsPick(el) {
    if (!cmSelectedCourse) return;
    // The click that ends a drag: the drag has picked it already.
    if (Date.now() - _cmPtsDragEnd < 500) return;
    var p = _cmPtsFromEl(cmSelectedCourse, el);
    if (!p) return;
    var was = _cmPtsPicked(cmSelectedCourse);
    _cmPtsPick = _cmPtsSame(was, p) ? null : p;
    _cmPtsError = null;
    _cmPtsTyped = null;
    _cmKeepFocusSel = '#' + _cmPtsPickId(p);
    renderClassManager();
  }

  /* Keys on the scale: Left and Right nudge a marker by 0.1 (Shift: 1) and
     a handle by 1 (Shift: 5) and save; Enter in the box saves; Escape lets
     go and puts the focus back on what was picked. */
  function _cmPtsKeydown(e) {
    var el = e.target;
    var cid = cmSelectedCourse;
    if (!cid || !el || !el.closest || !el.closest('.cm-pts-scale')) return false;
    var pick = _cmPtsPicked(cid);
    if (e.key === 'Escape' && pick) {
      e.preventDefault();
      _cmPtsPick = null;
      _cmPtsError = null;
      _cmPtsTyped = null;
      _cmKeepFocusSel = '#' + _cmPtsPickId(pick);
      renderClassManager();
      return true;
    }
    if (el.id === 'cm-pts-input' && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (!pick) return true;
      _cmKeepFocusSel = '#cm-pts-input';
      _cmPtsSave(cid, pick, el.value);
      return true;
    }
    var btn = el.closest('[data-action="cmPtsPick"]');
    if (!btn || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.metaKey || e.ctrlKey) return false;
    var p = _cmPtsFromEl(cid, btn);
    if (!p) return false;
    e.preventDefault();
    var by = p.kind === 'edge' ? (e.shiftKey ? 5 : 1) : e.shiftKey ? 1 : 0.1;
    var next = Math.round((_cmPtsValue(cid, p) + (e.key === 'ArrowRight' ? by : -by)) * 10) / 10;
    _cmKeepFocusSel = '#' + _cmPtsPickId(p);
    _cmPtsSave(cid, p, String(next));
    return true;
  }

  /* While typing or dragging, the marker or handle (and the bands either
     side of a handle) move before anything is saved. */
  function _cmPtsPreview(p, v, fromInput) {
    var ruler = document.getElementById('cm-pts-ruler');
    if (!ruler || !ruler.querySelector || typeof CSS === 'undefined' || !CSS.escape) return;
    if (p.kind === 'step') {
      var m = ruler.querySelector('.cm-pts-marker[data-key="' + CSS.escape(p.key) + '"]');
      if (m) m.style.left = _cmPtsLeft(v);
    } else {
      var edge = ruler.querySelector('.cm-pts-edge[data-level="' + p.level + '"]');
      if (!edge) return;
      edge.style.left = _cmPtsLeft(v);
      var handle = edge.querySelector('.cm-pts-handle');
      if (handle) handle.textContent = v + '%';
      var cuts = [0];
      [2, 3, 4].forEach(function (l) {
        var e2 = ruler.querySelector('.cm-pts-edge[data-level="' + l + '"]');
        cuts.push(e2 ? parseFloat(e2.style.left) || 0 : 0);
      });
      cuts.push(100);
      [1, 2, 3, 4].forEach(function (l) {
        var band = ruler.querySelector('.cm-pts-band[data-lv="' + l + '"]');
        if (band) band.style.width = Math.max(0, cuts[l] - cuts[l - 1]) + '%';
      });
    }
    var inp = document.getElementById('cm-pts-input');
    if (inp && !fromInput && _cmPtsSame(_cmPtsPicked(cmSelectedCourse), p)) inp.value = String(v);
  }

  function cmPtsLive(el) {
    var p = cmSelectedCourse && _cmPtsPicked(cmSelectedCourse);
    var v = parseFloat(el.value);
    if (p && isFinite(v)) _cmPtsPreview(p, Math.max(0, Math.min(100, v)), true);
  }

  /* Dragging a marker or handle along the ruler: it snaps to 0.1 (a handle
     to 1), stays between its neighbours, and saves when let go. A press
     that doesn't move is a click. */
  var _cmPtsDrag = null;
  function _initCmPtsDrag() {
    _addDocListener('pointerdown', function (e) {
      if (e.button !== 0 || !cmSelectedCourse) return;
      var btn = e.target.closest && e.target.closest('.cm-pts-ruler [data-action="cmPtsPick"]');
      var ruler = btn && btn.closest('.cm-pts-ruler');
      var p = btn && _cmPtsFromEl(cmSelectedCourse, btn);
      if (!p || !ruler) return;
      var range = _cmPtsRange(cmSelectedCourse, p);
      _cmPtsDrag = {
        cid: cmSelectedCourse,
        pick: p,
        pointer: e.pointerId,
        rect: ruler.getBoundingClientRect(),
        x0: e.clientX,
        moved: false,
        value: _cmPtsValue(cmSelectedCourse, p),
        lo: range[0],
        hi: range[1],
      };
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {
        // No capture: the drag still follows the document's pointer events.
      }
    });
    _addDocListener('pointermove', function (e) {
      var d = _cmPtsDrag;
      if (!d || e.pointerId !== d.pointer || !d.rect.width) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
      d.moved = true;
      e.preventDefault();
      var snap = d.pick.kind === 'edge' ? 1 : 0.1;
      var v = Math.round(((e.clientX - d.rect.left) / d.rect.width) * 100 * (1 / snap)) / (1 / snap);
      d.value = Math.max(d.lo, Math.min(d.hi, v));
      _cmPtsPreview(d.pick, d.value);
    });
    function end(e) {
      var d = _cmPtsDrag;
      if (!d || e.pointerId !== d.pointer) return;
      _cmPtsDrag = null;
      if (!d.moved) return;
      _cmPtsDragEnd = Date.now();
      if (e.type === 'pointercancel' || d.cid !== cmSelectedCourse) return renderClassManager();
      _cmKeepFocusSel = '#' + _cmPtsPickId(d.pick);
      _cmPtsSave(d.cid, d.pick, String(d.value));
    }
    _addDocListener('pointerup', end);
    _addDocListener('pointercancel', end);
  }

  function cmMatchPointsScale() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var scale = getGradingScale(cid);
    _cmPtsError = null;
    _cmPtsTyped = null;
    _cmApplyPointsScale(cid, {
      boundaries: scale.boundaries,
      percents: _cmMatchedPercents(scale.boundaries),
      labels: scale.labels || null,
    });
  }

  // The BC Letter Bands preset: Counts As only; Points to Proficiency stays.
  function cmBcPointsScale() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var scale = getGradingScale(cid);
    _cmPtsError = null;
    _cmPtsTyped = null;
    _cmApplyPointsScale(cid, {
      boundaries: scale.boundaries,
      percents: Object.assign({}, BC_LETTER_BAND_PERCENTS),
      labels: scale.labels || null,
    });
  }

  function cmResetPointsScale() {
    if (!cmSelectedCourse) return;
    _cmPtsError = null;
    _cmPtsTyped = null;
    // Saved, not deleted: other devices only take a scale the server has.
    _cmApplyPointsScale(cmSelectedCourse, structuredClone(DEFAULT_GRADING_SCALE));
  }

  /* The categories' weights as one bar, so a teacher sees the split. */
  function _cmRenderWeightBar(cid) {
    var rows = (_cmCatState(cid).rows || []).filter(function (r) {
      return Number(r.weight) > 0;
    });
    if (!rows.length) return '';
    var shades = ['var(--active)', '#5a9be6', '#a9c9f2', '#2f6fb8', '#7fb0ec', '#cfe0f7'];
    return (
      '<div class="cm-weight-bar" aria-hidden="true">' +
      rows
        .map(function (r, i) {
          return '<span style="flex:' + Number(r.weight) + ';background:' + shades[i % shades.length] + '"></span>';
        })
        .join('') +
      '</div>'
    );
  }

  /* One student's grade with the settings on the left, from the class's own
     scores: the year so far, as the gradebook shows it, even when Class
     Management opens over a report (Colin, 2026-11-03). */
  function _cmRenderCheckStudent(cid, gs, method) {
    return readAsOfTerm(cid, null, function () {
      return _cmRenderCheckStudentNow(cid, gs, method);
    });
  }
  function _cmRenderCheckStudentNow(cid, gs, method) {
    var students = sortStudents(getStudents(cid), 'lastName');
    var head =
      '<aside class="cm-section cm-check" aria-label="Check with a student">' +
      '<h2 class="cm-grade-title">Check With a Student</h2>' +
      '<div class="cm-hint">One student’s grade with the settings on the left. Change a setting and it updates.</div>';
    if (!students.length) return head + '<div class="cm-hint">Add students to see a grade here.</div></aside>';
    var sid = _cmCheckSid[cid];
    if (
      !students.some(function (s) {
        return s.id === sid;
      })
    )
      sid = students[0].id;
    var summary = studentGradeSummary(cid, sid);
    var html =
      head +
      '<div class="cm-field"><label class="cm-label" for="cm-check-student">Student</label>' +
      '<select class="cm-input" id="cm-check-student" data-action-change="cmCheckStudent">' +
      students
        .map(function (s) {
          return (
            '<option value="' + s.id + '"' + (s.id === sid ? ' selected' : '') + '>' + esc(fullName(s)) + '</option>'
          );
        })
        .join('') +
      '</select></div>' +
      '<div class="cm-check-overall"><span class="cm-check-label">Overall Grade</span>' +
      '<span class="cm-check-value">' +
      esc(summary.text || 'No scores yet') +
      '</span></div>';

    var lm = getLearningMap(cid);
    // With "Count Only the Most Recent N", only those N count, so only
    // those are listed (Most Recent Score already counts one).
    var lastN = method !== 'mostRecent' ? getRecentScoreLimit(cid) : null;
    var rows = (lm.sections || [])
      .map(function (sec) {
        var tag = sec.tags && sec.tags[0];
        if (!tag) return '';
        var scores = getCountedTagScores(cid, sid, tag.id)
          .filter(function (s) {
            return s.score > 0;
          })
          .slice()
          .sort(function (a, b) {
            return (a.date || '').localeCompare(b.date || '');
          })
          .map(function (s) {
            if (s.level != null) return formatScoreLevel(s.level, s.mod);
            return Number.isInteger(s.score) ? String(s.score) : formatLevelAs(cid, s.score, 'proficiency');
          });
        // The latest few, oldest first, so the method's rule can be followed.
        var shownScores = scores.length > 6 ? ['\u2026'].concat(scores.slice(-6)) : scores;
        var listed = !scores.length
          ? 'No scores yet'
          : lastN && scores.length > lastN
            ? 'Last ' + lastN + ' of ' + scores.length + ' scores: ' + scores.slice(-lastN).join(', ')
            : (scores.length > 6 ? scores.length + ' scores: ' : 'Scores ') + shownScores.join(', ');
        return (
          '<div class="cm-check-row"><span class="cm-check-code">' +
          esc(_cmStdCode(tag)) +
          '</span><span class="cm-check-scores">' +
          esc(listed) +
          '</span><strong class="cm-check-num">' +
          esc(formatLevel(cid, getSectionProficiency(cid, sid, sec.id))) +
          '</strong></div>'
        );
      })
      .join('');
    html +=
      '<div class="cm-check-group"><div class="cm-label">Competencies <span class="cm-check-sub">· ' +
      CM_METHOD_TEXT[method].label +
      '</span></div>' +
      (gs === 'letter' ? '<div class="cm-hint">Shown on competency views, not in the %.</div>' : '') +
      (rows || '<div class="cm-hint">No competencies yet.</div>') +
      '</div>';

    if (gs === 'proficiency') {
      html += '<div class="cm-check-group cm-hint">No course % in a Proficiency class.</div>';
    } else {
      var cats = getCategories(cid) || [];
      var scoped = _scopedAssessments(cid);
      var letter = getCourseLetterData(cid, sid);
      var catRows = cats
        .map(function (c) {
          var p = getAssessmentGroupPercentage(
            cid,
            sid,
            scoped.filter(function (a) {
              return (a.categoryId || a.category_id || null) === c.id;
            }),
            categoryCalcMode(c),
          );
          return (
            '<span>' +
            esc(c.name) +
            '</span><span class="cm-check-num">' +
            (p ? formatCoursePercent(cid, p.pct) : '—') +
            '</span><span class="cm-check-num cm-check-weight">' +
            Number(c.weight || 0) +
            '%</span>'
          );
        })
        .join('');
      html +=
        '<div class="cm-check-group"><div class="cm-label">Course % <span class="cm-check-sub">· ' +
        (cats.length ? 'Weighted Categories' : 'Points Earned of Possible') +
        '</span></div>' +
        (cats.length
          ? '<div class="cm-check-cats"><span class="cm-check-colhead">Category</span><span class="cm-check-colhead cm-check-num">Earned</span><span class="cm-check-colhead cm-check-num">Weight</span>' +
            catRows +
            '</div>'
          : '') +
        '<div class="cm-check-total"><strong>Course %</strong><strong>' +
        (letter && letter.R != null
          ? esc((letter.S ? letter.S + ' ' : '') + formatCoursePercent(cid, letter.R))
          : '—') +
        '</strong></div>' +
        '</div>';
    }
    return html + '</aside>';
  }

  function cmCheckStudent(sid) {
    if (!cmSelectedCourse) return;
    _cmCheckSid[cmSelectedCourse] = sid;
    renderClassManager();
  }

  function cmRoundPercentSelect(value) {
    cmSetRoundPercent(value === 'decimal' ? 'decimal' : 'whole');
  }

  /* ── Curriculum Wizard ──────────────────────────────────── */
  /* The wizard's steps, by number: 1 Choose Courses, 2 Choose
     Competencies, 3 Class Details, 4 Review. A custom class (no courses)
     skips Choose Competencies, and its bar leaves it out. */
  function renderCmCreateForm() {
    if (cwStep === 1) return renderCwStep1();
    if (cwStep === 2) return renderCwCompetencies();
    if (cwStep === 3) return renderCwStep2();
    if (cwStep === 4) return renderCwStep3();
    return '';
  }

  function renderCwStepBar() {
    var steps = [
      [1, 'Choose Courses'],
      [2, 'Choose Competencies'],
      [3, 'Class Details'],
      [4, 'Review'],
    ].filter(function (s) {
      return s[0] !== 2 || cwStep === 1 || cwSelectedTags.length > 0;
    });
    return (
      '<div class="cw-steps">' +
      steps
        .map(function (s, i) {
          var l = s[1];
          var n = i + 1;
          var cls = s[0] < cwStep ? 'done' : s[0] === cwStep ? 'active' : '';
          return (
            (i > 0 ? '<span class="cw-step-arrow">\u203A</span>' : '') +
            '<div class="cw-step ' +
            cls +
            '">' +
            '<span class="cw-step-num">' +
            (s[0] < cwStep ? '\u2713' : n) +
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
    var html = '<div class="cm-detail-inner cw-wizard">';
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
        '" aria-pressed="' +
        (cwSelectedGrade === g) +
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
          '" aria-pressed="' +
          (cwSelectedSubject === subj) +
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

      // Course checklist. A preset (Humanities 8) sits first and, while
      // ticked, stands in for the courses it ticks.
      if (cwSelectedSubject && bySubject[cwSelectedSubject]) {
        var courses = bySubject[cwSelectedSubject];
        var presets = _cwPresetsFor(cwSelectedGrade, courses);
        var preset = _cwActivePreset();
        html +=
          '<div class="cm-section"><div class="cm-section-title">Courses</div>' +
          '<div class="cm-hint" style="margin-bottom:8px">Select one or more courses. Multiple selections create a combined class.</div>' +
          '<div class="cw-course-list">';
        presets.forEach(function (p) {
          var on = !!preset && preset.id === p.id;
          html += _cwCourseRow({
            action: 'cwTogglePreset',
            key: p.id,
            on: on,
            name: p.name,
            tag: p.tags.join(' + '),
            counts: _cwCourseCounts(p.tags),
          });
        });
        courses.forEach(function (c) {
          if (preset && preset.tags.indexOf(c.short_tag) >= 0) return;
          // The old bank's own HUM8 course gives way to the preset.
          if (
            presets.some(function (p) {
              return p.id === c.short_tag;
            })
          )
            return;
          html += _cwCourseRow({
            action: 'cwToggleCourse',
            key: c.short_tag,
            on: cwSelectedTags.includes(c.short_tag),
            name: c.course_name,
            tag: c.short_tag,
            counts: _cwCourseCounts([c.short_tag]),
          });
        });
        html += '</div>';

        if (cwSelectedTags.length > 0) {
          var totalComps = _cwCourseCounts(cwSelectedTags).competencies;
          var lead =
            preset && cwSelectedTags.length === preset.tags.length
              ? '<strong>' +
                esc(preset.name) +
                '</strong>: ' +
                esc(
                  preset.tags
                    .map(function (tag) {
                      return CURRICULUM_INDEX[tag].course_name;
                    })
                    .join(' and '),
                )
              : '<strong>' +
                cwSelectedTags.length +
                '</strong> course' +
                (cwSelectedTags.length !== 1 ? 's' : '') +
                ' selected';
          html +=
            '<div class="cw-selection-summary">' +
            lead +
            ' \u00B7 <strong>' +
            totalComps +
            '</strong> competencies</div>';
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

  /* Choose Competencies: each ticked course as a card, its competencies in
     Ministry order with their full wording, all ticked to start. A Ministry
     folder is a heading with its figure and Select All / Clear. */
  function renderCwCompetencies() {
    var html = '<div class="cm-detail-inner cw-wizard">' + renderCwStepBar();
    html +=
      '<div class="cw-cc-intro">The BC curriculum expects every competency to be taught. Untick only what you won\u2019t assess in this class.</div>';
    var total = 0;
    var on = 0;
    cwSelectedTags.forEach(function (tag) {
      var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
      if (!course) return;
      var color = SUBJECT_COLOURS[course.subject] || '#6366f1';
      var cats = (course.categories || []).filter(function (cat) {
        return (cat.competencies || []).length;
      });
      var n = 0;
      var nOn = 0;
      var body = '';
      cats.forEach(function (cat, ci) {
        var rows = cat.competencies
          .map(function (comp) {
            var key = curriculumCompKey(tag, comp);
            var ticked = !cwSkipped[key];
            n++;
            if (ticked) nOn++;
            return (
              '<label class="cw-cc-row' +
              (ticked ? '' : ' off') +
              '"><input type="checkbox" class="cw-cc-check"' +
              (ticked ? ' checked' : '') +
              ' data-action-change="cwCompToggle" data-key="' +
              esc(key) +
              '"><span class="cm-std-code" style="--chip:' +
              color +
              '">' +
              esc(comp.tag || '') +
              '</span><span class="cw-cc-text"><span class="cw-cc-name">' +
              esc(comp.short_label || comp.tag || '') +
              '</span><span class="cw-cc-wording">' +
              esc(comp.raw || '') +
              '</span></span></label>'
            );
          })
          .join('');
        if (cat.folder !== true) {
          body += '<div class="cw-cc-loose"><div class="cw-cc-rows">' + rows + '</div></div>';
          return;
        }
        var fOn = cat.competencies.filter(function (comp) {
          return !cwSkipped[curriculumCompKey(tag, comp)];
        }).length;
        body +=
          '<div class="cw-cc-folder" role="group" aria-label="' +
          esc(cat.name) +
          '"><div class="cw-cc-folder-head"><span class="cw-cc-folder-name">' +
          esc(cat.name) +
          '</span><span class="cw-cc-folder-fig">' +
          fOn +
          ' of ' +
          cat.competencies.length +
          '</span><span class="cw-cc-folder-acts">' +
          '<button type="button" class="cw-cc-btn" data-action="cwFolderAll" data-tag="' +
          esc(tag) +
          '" data-idx="' +
          ci +
          '">Select All</button><button type="button" class="cw-cc-btn" data-action="cwFolderNone" data-tag="' +
          esc(tag) +
          '" data-idx="' +
          ci +
          '">Clear</button></span></div><div class="cw-cc-rows">' +
          rows +
          '</div></div>';
      });
      total += n;
      on += nOn;
      html +=
        '<div class="cm-section cw-cc-course"><div class="cw-cc-course-head"><span class="cw-cc-course-name">' +
        esc(course.course_name) +
        '</span><span class="cw-course-tag">' +
        esc(tag) +
        '</span><span class="cw-cc-course-fig">' +
        nOn +
        ' of ' +
        n +
        ' Competencies</span></div>' +
        body +
        '</div>';
    });
    html +=
      '<div class="cw-selection-summary"><strong>' +
      on +
      '</strong> of <strong>' +
      total +
      '</strong> competencies selected</div>';
    html +=
      '<div class="cw-footer">' +
      _cwCancelBtn() +
      '<button class="btn btn-ghost" data-action="cwGoBack">Back</button>' +
      '<button class="btn btn-primary" data-action="cwCompsNext"' +
      (on === 0 ? ' disabled style="opacity:0.4;pointer-events:none"' : '') +
      '>Next</button></div></div>';
    return html;
  }

  /* The review's grading switches, worded as the Grading tab words them:
     Each Course Counts Equally for a combined class, and Folders Count as
     One. Both can change later in Grading. */
  function _cwRenderGradingRows(anyFolder) {
    var g = _cwGrading();
    var later = ' You can change this later in Grading.';
    function row(key, id, label, hint, on) {
      return (
        '<div class="cm-recent-limit cm-folder-count-row">' +
        '<span class="cm-recent-text"><label class="cm-label" for="' +
        id +
        '">' +
        label +
        '</label><span class="cm-hint">' +
        hint +
        later +
        '</span></span>' +
        '<span class="gpd-switch"><input type="checkbox" role="switch" id="' +
        id +
        '" data-action-change="cwRollup" data-key="' +
        key +
        '"' +
        (on ? ' checked' : '') +
        '><span class="gpd-switch-ui" aria-hidden="true"></span></span>' +
        '</div>'
      );
    }
    var names = cwSelectedTags
      .map(function (tag) {
        return CURRICULUM_INDEX[tag] && CURRICULUM_INDEX[tag].course_name;
      })
      .filter(Boolean);
    var html = '<div class="cm-section cw-grading-rows">';
    if (names.length > 1)
      html += row(
        'courses',
        'cw-courses-equal',
        'Each Course Counts Equally',
        g.coursesCountEqually
          ? names.length === 2
            ? esc(names[0]) + ' and ' + esc(names[1]) + ' each make up half of the overall.'
            : 'Each of the ' + names.length + ' courses makes up an equal share of the overall.'
          : 'A course with more competencies or folders counts for more in the overall.',
        g.coursesCountEqually,
      );
    html += row(
      'folders',
      'cw-folders-count',
      'Folders Count as One',
      !anyFolder
        ? 'This class has no folders with competencies yet.'
        : g.foldersCountAsOne
          ? 'Each folder is averaged first and counts as one competency in the overall.'
          : 'Every competency counts the same in the overall. Folders only group them.',
      g.foldersCountAsOne,
    );
    return html + '</div>';
  }

  /* One row in Choose Courses: a course, or a preset that ticks several. */
  function _cwCourseRow(r) {
    return (
      '<div class="cw-course-item' +
      (r.on ? ' selected' : '') +
      '" role="checkbox" tabindex="0" aria-checked="' +
      (r.on ? 'true' : 'false') +
      '" data-action="' +
      r.action +
      '" data-tag="' +
      esc(r.key) +
      '">' +
      '<span class="cw-course-check">' +
      (r.on ? '\u2713' : '') +
      '</span>' +
      '<span class="cw-course-name">' +
      esc(r.name) +
      '</span>' +
      '<span class="cw-course-tag">' +
      esc(r.tag) +
      '</span>' +
      '<span class="cw-course-count">' +
      r.counts.competencies +
      (r.counts.competencies === 1 ? ' Competency' : ' Competencies') +
      (r.counts.folders ? ' \u00B7 ' + r.counts.folders + (r.counts.folders === 1 ? ' Folder' : ' Folders') : '') +
      '</span>' +
      '</div>'
    );
  }

  /* Competencies and Ministry folders in these courses (the old bank has
     no folders). */
  function _cwCourseCounts(tags) {
    var out = { competencies: 0, folders: 0 };
    tags.forEach(function (tag) {
      var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
      (course ? course.categories || [] : []).forEach(function (cat) {
        var n = (cat.competencies || []).length;
        out.competencies += n;
        if (cat.folder === true && n) out.folders++;
      });
    });
    return out;
  }

  /* The presets for this grade whose courses are all in the bank and one of
     which is in the subject showing. */
  function _cwPresetsFor(grade, courses) {
    var here = courses.map(function (c) {
      return c.short_tag;
    });
    return CW_PRESETS.filter(function (p) {
      return (
        p.grade === grade &&
        p.tags.every(function (tag) {
          return CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
        }) &&
        p.tags.some(function (tag) {
          return here.indexOf(tag) >= 0;
        })
      );
    });
  }

  /* The ticked preset, while all its courses are still ticked. */
  function _cwActivePreset() {
    var p = CW_PRESETS.find(function (x) {
      return x.id === cwPreset;
    });
    if (!p) return null;
    return p.tags.every(function (tag) {
      return cwSelectedTags.indexOf(tag) >= 0;
    })
      ? p
      : null;
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
      preName = names.length ? _cwDefaultName() : '';
      preGrade = cwSelectedGrade ? String(cwSelectedGrade) : '';
    }
    // A name the teacher typed stays when they come back from Review.
    if (cwStep2Name) preName = cwStep2Name;
    if (cwStep2Grade) preGrade = cwStep2Grade;
    var grading = cwStep2Grading || _cmDefaultGradingSystem({ gradeLevel: preGrade });
    var calc = cwStep2Calc || _cmDefaultCalcMethod();

    var html = '<div class="cm-detail-inner cw-wizard">';
    html += renderCwStepBar();

    html +=
      '<div class="cm-section"><div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-new-name">Class Name</label><input class="cm-input" id="cm-new-name" value="' +
      esc(preName) +
      '" placeholder="e.g. English 10" required aria-describedby="cm-new-name-hint" data-action-input="cwNameInput" autofocus>' +
      // Next waits for a name, so a slip can't make a class called Untitled.
      '<div class="cm-hint" id="cm-new-name-hint"' +
      (preName.trim() ? ' hidden' : '') +
      '>Enter a Class Name to continue.</div></div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-new-block-label">Block</label>' +
      blockPickerHtml('cm-new-block', cwStep2Block) +
      '</div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-cg-span-label">This Class Runs</label>' +
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
      '<div style="display:flex;gap:16px"><div class="cm-field" style="flex:1"><label class="cm-label" for="cm-new-grade">Grade Level</label><input class="cm-input" id="cm-new-grade" value="' +
      esc(preGrade) +
      '" placeholder="e.g. 8, 10-12" data-action-input="cwGradeInput"></div></div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-new-desc">Description</label><textarea class="cm-textarea" id="cm-new-desc" placeholder="Optional">' +
      esc(cwStep2Desc) +
      '</textarea></div></div>';

    html +=
      '<div class="cm-section"><div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-cg-grading-label">Grading System</label>' +
      // T-UI-02 · wizard grading_system picker. Grades 10–12 default to
      // Letter; with no categories, letter grades use total points.
      '<div class="seg cm-seg" id="cm-cg-grading" role="radiogroup" aria-labelledby="cm-cg-grading-label" aria-describedby="cm-cg-grading-desc">' +
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
      '<div class="cm-field"><label class="cm-label" id="cm-cg-calc-label">Calculation Method</label>' +
      '<div class="seg cm-seg" id="cm-cg-calc" role="radiogroup" aria-labelledby="cm-cg-calc-label" aria-describedby="cm-cg-calc-desc">' +
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
      '"><label class="cm-label" for="cm-cg-decay-slider">Decay Weight</label>' +
      '<div class="cm-slider-row"><input type="range" min="10" max="95" value="' +
      esc(cwStep2Decay) +
      '" id="cm-cg-decay-slider" data-action-input="cmCreateDecaySlider" style="flex:1"><span class="cm-slider-label" id="cm-cg-decay-val">' +
      esc(cwStep2Decay) +
      '%</span></div>' +
      '<div class="cm-hint">Higher values weight recent scores more heavily.</div></div>' +
      '<div class="cm-field">' +
      '<label class="cm-label" for="cm-new-late-policy">Late Work Policy</label>' +
      '<textarea class="cm-textarea" id="cm-new-late-policy" rows="2" placeholder="e.g. Late assignments lose 10% per day, up to 3 days." aria-label="Late work policy">' +
      esc(cwStep2LatePolicy) +
      '</textarea>' +
      '<div class="cm-hint">Optional. If set, this text appears on the Score Distribution section of printed progress reports.</div>' +
      '</div>' +
      '</div>';

    html +=
      '<div class="cw-footer">' +
      _cwCancelBtn() +
      '<button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwGoToStep3"' +
      (preName.trim() ? '' : ' disabled') +
      '>Next</button></div>';
    html += '</div>';
    return html;
  }

  function renderCwStep3() {
    var html = '<div class="cm-detail-inner cw-wizard">';
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
      '<div class="cm-field"><label class="cm-label">Class Name</label><div style="font-size:var(--text-lg);font-weight:600;color:var(--text)">' +
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
      '<div class="cm-field"><label class="cm-label">Grading System</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(gradingLabel) +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Calculation Method</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(calcLabel) +
      (cwStep2Calc === 'decayingAvg' ? ' \u00B7 ' + esc(cwStep2Decay) + '% decay weight' : '') +
      '</div></div>' +
      '<div class="cm-field"><label class="cm-label">Late Work Policy</label><div style="font-size:var(--text-md);color:var(--text-2)">' +
      esc(cwStep2LatePolicy.trim() || '\u2014') +
      '</div></div>' +
      _cwReviewSetupRows(cwStep2Grade || gradeLevel) +
      '</div>';

    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      var anyFolder = false;
      cwSelectedTags.forEach(function (tag) {
        var courseData = CURRICULUM_INDEX[tag];
        if (!courseData) return;
        var color = SUBJECT_COLOURS[courseData.subject] || '#6366f1';
        var cats = courseData.categories || [];
        var isNew = cats.some(function (c) {
          return 'folder' in c;
        });
        // Ministry order: a folder row, or one "Not in a Folder" row for each
        // run of competencies outside folders. The old bank lists its headings.
        var rows = [];
        var total = 0;
        var folders = 0;
        cats.forEach(function (cat) {
          var n = (cat.competencies || []).filter(function (comp) {
            return !cwSkipped[curriculumCompKey(tag, comp)];
          }).length;
          if (!n) return;
          total += n;
          if (cat.folder === true) {
            folders++;
            rows.push({ name: cat.name, n: n, dot: color });
          } else if (!isNew) rows.push({ name: cat.name, n: n, dot: color });
          else if (rows.length && rows[rows.length - 1].loose) rows[rows.length - 1].n += n;
          else rows.push({ name: 'Not in a Folder', n: n, dot: '#aeaeb2', loose: true });
        });
        if (folders) anyFolder = true;
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
          total +
          (total === 1 ? ' Competency' : ' Competencies') +
          (folders ? ' \u00B7 ' + folders + (folders === 1 ? ' Folder' : ' Folders') : '') +
          '</div>' +
          '<div class="cw-review-sections">' +
          rows
            .map(function (r) {
              return (
                '<div class="cw-review-sec"><span class="cw-review-sec-dot" style="background:' +
                r.dot +
                '"></span>' +
                esc(r.name) +
                '<span class="cw-review-sec-count">' +
                r.n +
                (r.n === 1 ? ' Competency' : ' Competencies') +
                '</span></div>'
              );
            })
            .join('') +
          '</div></div>';
      });
      html += _cwRenderGradingRows(anyFolder);
    } else {
      html +=
        '<div class="cm-section"><div class="cw-empty-msg">This class has no BC curriculum. Folders and competencies can be added in the Competencies tab after the class is created.</div></div>';
    }

    html +=
      '<div class="cw-footer">' +
      _cwCancelBtn() +
      '<button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwFinishCreate"' +
      (className.trim() ? '' : ' disabled') +
      '>Create Class</button></div>';
    html += '</div>';
    return html;
  }

  /* What Create Class sets without asking, shown on the review so a teacher
     at another school knows to change it: the reporting terms (the default
     school's, for the chosen span) and, for a Letter class, Counts As. */
  function _cwReviewSetupRows(gradeLevel) {
    var val = function (text) {
      return '<div style="font-size:var(--text-md);color:var(--text-2)">' + text + '</div>';
    };
    var terms = _cmDefaultReportingTerms(null, cwStep2Span);
    var school = terms && typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(terms) : null;
    var html =
      '<div class="cm-field"><label class="cm-label">Reporting Terms</label>' +
      (terms && terms.length
        ? val(
            esc(school ? school.school.name : '') +
              (school ? ': ' : '') +
              terms
                .map(function (t) {
                  return esc(t.label + ' ' + _cmTermDay(t.starts_on) + ' \u2013 ' + _cmTermDay(t.ends_on));
                })
                .join(' \u00B7 '),
          ) + '<div class="cm-hint">Another school? Change the school or the dates later in Reporting Terms.</div>'
        : val('None. You can add them later in Reporting Terms.')) +
      '</div>';
    if (_cmDefaultGradingScale(gradeLevel))
      html +=
        '<div class="cm-field"><label class="cm-label">Counts As</label>' +
        val('BC Letter Bands') +
        '<div class="cm-hint">Each proficiency counts as a percent in the course % from the BC letter bands. You can change this later in Grading.</div>' +
        '</div>';
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
    cwSkipped = {};
    cwPreset = null;
    cwFoldersOn = null;
    cwCoursesEqual = null;
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
    cwFoldersOn = null;
    cwCoursesEqual = null;
    renderClassManager();
  }

  // A preset ticks its courses together and unticks them together.
  function cwTogglePreset(id) {
    var p = CW_PRESETS.find(function (x) {
      return x.id === id;
    });
    if (!p) return;
    var on = !!_cwActivePreset() && cwPreset === id;
    cwSelectedTags = cwSelectedTags.filter(function (tag) {
      return p.tags.indexOf(tag) < 0;
    });
    if (on) cwPreset = null;
    else {
      cwPreset = id;
      cwSelectedTags = p.tags.concat(cwSelectedTags);
    }
    renderClassManager();
  }

  function cwCompToggle(key, ticked) {
    if (ticked) delete cwSkipped[key];
    else cwSkipped[key] = true;
    _cmRenderWithScroll();
  }

  // Select All / Clear for one Ministry folder.
  function cwFolderSet(tag, idx, ticked) {
    var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
    var cat =
      course &&
      (course.categories || []).filter(function (c) {
        return (c.competencies || []).length;
      })[idx];
    if (!cat) return;
    cat.competencies.forEach(function (comp) {
      var key = curriculumCompKey(tag, comp);
      if (ticked) delete cwSkipped[key];
      else cwSkipped[key] = true;
    });
    _cmRenderWithScroll();
  }

  // Cancel on every step, as on the first.
  function _cwCancelBtn() {
    return '<button class="btn btn-ghost cw-cancel" data-action="cmCancelCreate">Cancel</button>';
  }

  /* A new step opens at its top, with the step bar in view, whatever the
     last step was scrolled to (the Class Name box's autofocus included). */
  function _cwShowStep(step) {
    cwStep = step;
    renderClassManager();
    var top = function () {
      var detail = document.querySelector('.cm-detail');
      if (detail) detail.scrollTop = 0;
    };
    top();
    requestAnimationFrame(top);
  }

  function cwSkipToCustom() {
    cwSelectedTags = [];
    cwPreset = null;
    _cwShowStep(3);
  }

  function cwGoToStep2() {
    if (cwSelectedTags.length === 0) return;
    _cwShowStep(2);
  }

  function cwCompsNext() {
    _cwShowStep(3);
  }

  // The review's grading switches. They don't touch any class until Finish.
  function cwSetRollup(key, on) {
    if (key === 'courses') cwCoursesEqual = !!on;
    else cwFoldersOn = !!on;
    renderClassManager();
  }

  /* The wizard's grading switches: what the teacher set on the review, else
     the default for one course or a combined class. */
  function _cwGrading() {
    var d = curriculumGradingDefaults(cwSelectedTags);
    return {
      foldersCountAsOne: cwFoldersOn != null ? cwFoldersOn : d.foldersCountAsOne,
      coursesCountEqually: cwCoursesEqual != null ? cwCoursesEqual : d.coursesCountEqually,
    };
  }

  // Class Details: Next comes on once the class has a name.
  function cwNameInput(el) {
    var named = !!(el.value || '').trim();
    var next = document.querySelector('[data-action="cwGoToStep3"]');
    if (next) next.disabled = !named;
    var hint = document.getElementById('cm-new-name-hint');
    if (hint) hint.hidden = named;
  }

  function cwGoToStep3() {
    if (!(document.getElementById('cm-new-name')?.value || '').trim()) return;
    cwStep2Name = document.getElementById('cm-new-name')?.value || '';
    cwStep2Block = readBlockPicker('cm-new-block');
    cwStep2Span = (document.querySelector('#cm-cg-span .cm-seg-btn.active') || {}).dataset?.val || 'full';
    cwStep2Grade = document.getElementById('cm-new-grade')?.value || '';
    cwStep2Desc = document.getElementById('cm-new-desc')?.value || '';
    cwStep2Grading =
      (document.querySelector('#cm-cg-grading .cm-seg-btn.active') || {}).dataset?.val ||
      _cmDefaultGradingSystem({ gradeLevel: cwStep2Grade });
    cwStep2Calc =
      (document.querySelector('#cm-cg-calc .cm-seg-btn.active') || {}).dataset?.val || _cmDefaultCalcMethod();
    cwStep2Decay = document.getElementById('cm-cg-decay-slider')?.value || '65';
    cwStep2LatePolicy = document.getElementById('cm-new-late-policy')?.value || '';
    _cwShowStep(4);
  }

  function cwGoBack() {
    if (cwStep === 4) _cwShowStep(3);
    else if (cwStep === 3) _cwShowStep(cwSelectedTags.length ? 2 : 1);
    else if (cwStep === 2) _cwShowStep(1);
    else renderClassManager();
  }

  function cwGetPreName() {
    if (cwStep2Name) return cwStep2Name;
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      return _cwDefaultName();
    }
    return '';
  }

  /* A new class's name: the preset's (Humanities 8) while only its courses
     are ticked, else the course names. */
  function _cwDefaultName() {
    var p = _cwActivePreset();
    if (p && cwSelectedTags.length === p.tags.length) return p.name;
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

  async function cwFinishCreate() {
    var name = cwStep2Name || cwGetPreName();
    if (!name.trim()) {
      // Back to Class Details, where the name is typed.
      cwStep = 3;
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
    cc.levelOrder = _cmDefaultLevelOrder(course.gradeLevel);
    var startScale = _cmDefaultGradingScale(course.gradeLevel);
    if (startScale) cc.gradingScale = startScale;
    var defaultTerms = _cmDefaultReportingTerms(course.id, cwStep2Span);
    if (defaultTerms && !(Array.isArray(cc.reportingTerms) && cc.reportingTerms.length))
      cc.reportingTerms = defaultTerms;
    // The review's grading switches: by default one course counts its
    // folders as one, and a combined class counts each course equally.
    if (cwSelectedTags.length > 0) Object.assign(cc, _cwGrading());
    saveCourseConfig(course.id, cc);

    var dispatchOk = true;
    if (cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      // Fresh local ids: the built map names rows after the course and its
      // codes, the same for every class, and a second class made from the
      // same course in this sitting would otherwise save onto the first's.
      var map = withFreshLearningMapIds(buildLearningMapFromTags(cwSelectedTags, { skip: Object.keys(cwSkipped) }));
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
    // A new class has no students yet, so it opens where they are added.
    cmTab = 'students';
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
    if (cid !== cmSelectedCourse) {
      // A review or a selection belongs to its class.
      cmPendingImport = null;
      cmImportFormatOpen = false;
      cmImportError = null;
      cmImportDone = null;
      cmRosterOnly = null;
      if (cmCompReview && cmCompReview.kind === 'file') cmCompReview = null;
      cmCompSelect = false;
      cmCompSelected = {};
    }
    cmSelectedCourse = cid;
    cmMode = 'edit';
    renderClassManager();
    _cmShowWhenLoaded(cid);
  }

  function cmStartCreate() {
    cmMode = 'create';
    cmSelectedCourse = null;
    cwStep = 1;
    cwSelectedGrade = null;
    cwSelectedSubject = null;
    cwSelectedTags = [];
    cwSkipped = {};
    cwPreset = null;
    cwFoldersOn = null;
    cwCoursesEqual = null;
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
      var cbtn = document.querySelector('#cm-cg-calc .cm-seg-btn[data-val="' + _cmDefaultCalcMethod() + '"]');
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
    // A cleared optional field (Late Work Policy) arrives as null.
    var clean = field === 'block' ? normalizeCourseBlock(value) : value == null ? null : String(value).trim();
    updateCourse(cmSelectedCourse, { [field]: clean });
    if (field === 'name' || field === 'block') _cmRefreshSidebar();
  }

  // T-UI-02 helpers ──────────────────────────────────────────────────
  // Default grading_system by grade level: 8–9 → proficiency, 10–12 → letter.
  // Every new class defaults to Mean (_cmDefaultCalcMethod).
  // Falls back to proficiency when the grade isn't a number we recognize.
  function _cmDefaultGradingSystem(course) {
    var gl = parseInt((course && course.gradeLevel) || '', 10);
    if (!isNaN(gl) && gl >= 10 && gl <= 12) return 'letter';
    return 'proficiency';
  }

  // A new class always calculates competencies by Mean.
  function _cmDefaultCalcMethod() {
    return 'average';
  }

  // Default Rubric Levels: Emerging First where the class grades by
  // proficiency (grades 8–9), Extending First otherwise.
  // Grades 10–12 report a %, so their Counts As starts on the BC Letter
  // Bands (Colin, 2026-10-29); other grades keep the default scale (null).
  function _cmDefaultGradingScale(gradeLevel) {
    if (_cmDefaultGradingSystem({ gradeLevel: gradeLevel }) !== 'letter') return null;
    return {
      boundaries: structuredClone(DEFAULT_GRADING_SCALE.boundaries),
      percents: Object.assign({}, BC_LETTER_BAND_PERCENTS),
      labels: null,
    };
  }

  function _cmDefaultLevelOrder(gradeLevel) {
    return _cmDefaultGradingSystem({ gradeLevel: gradeLevel }) === 'proficiency' ? 'asc' : 'desc';
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
        'Only the latest score counts. If a student scores 2, then 3, then 4, their grade is 4. Earlier scores are ignored entirely. It answers "where is the student now?" rather than "how did they do on average?"',
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
        'Students are scored on the BC proficiency scale: 1 Emerging, 2 Developing, 3 Proficient, 4 Extending.',
      letter:
        'A letter grade and % on the BC scale: A, B, C+, C and C\u2013. Under 50% shows IE (Insufficient Evidence) until the course ends, then F.',
      both: 'Proficiency day to day, and a letter grade and % on reports. Useful in grades 10\u201312, where report cards need a letter and %.',
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

  /* The list as the server gave it or last took it: what this form was
     opened with. Before anything is saved over the class's whole list, the
     server's list is read again and compared with this (saveCategoriesNow
     in shared/data.js). A copy, since the rows on screen change as the
     teacher types. `inOrder`: the rows were just saved in this order, so
     their place in the list is their display order; otherwise each keeps
     the display order the server gave it (two rows can share one). */
  function _cmCatSnapshot(rows, inOrder) {
    return (rows || []).map(function (r, i) {
      var row = {
        id: r.id || null,
        name: r.name || '',
        weight: Number(r.weight) || 0,
        display_order: inOrder || r.display_order == null ? i : Number(r.display_order) || 0,
        calc_mode: categoryCalcMode(r),
      };
      // A new row in a list sent with no answer: which row it is, so the id
      // the server gave it can be found again after the tab is closed.
      if (!row.id && r.key) row.key = r.key;
      return row;
    });
  }
  function _cmCatRemember(st, rows, inOrder) {
    st.opened = _cmCatSnapshot(rows, inOrder);
  }
  // Rows for the form from a list in cache shape (the server's, as read).
  function _cmCatRowsFrom(list) {
    return (list || []).map(function (r, i) {
      var order = r.displayOrder != null ? r.displayOrder : r.display_order;
      return {
        id: r.id || null,
        name: r.name || '',
        weight: Number(r.weight) || 0,
        display_order: order != null ? Number(order) || 0 : i,
        calc_mode: categoryCalcMode(r),
      };
    });
  }

  /* The one line shown above the categories when a save was not made, or
     when something was kept for the teacher. With `typed`, what the teacher
     had typed is listed under it to copy from. */
  var CM_CAT_NOTICES = {
    changed: 'The categories changed on another device, so nothing was saved. These are the current ones.',
    changedTyped:
      'The categories changed on another device, so nothing was saved. These are the current ones. What you typed is below.',
    offline:
      'Categories need a connection to save. Your changes are kept on this computer. Save again when you are online.',
    offlineOrder: 'Categories need a connection to save. Nothing was saved. Try again when you are online.',
    kept: 'Your unsaved category changes were kept on this computer. Save Categories to send them.',
    // After Discard My Changes: a save whose answer never came had landed.
    landed: 'Your earlier save went through after all. These are the saved categories.',
    // Online, but other changes from this computer had not gone yet.
    waiting:
      'Other changes from this computer are still being sent, so nothing was saved. Your changes are kept on this computer. Save again in a moment.',
    waitingOrder: 'Other changes from this computer are still being sent, so nothing was saved. Try again in a moment.',
  };
  var CM_CAT_REST = ' Everything else was copied.';
  function _cmCatNoticeText(st) {
    var n = st.notice;
    if (!n) return null;
    if (n.kind === 'copyChanged') {
      return (
        'The categories were not copied from ' +
        (n.from || 'the other class') +
        ': they changed on another device first. These are the current ones.' +
        (n.rest ? CM_CAT_REST : '')
      );
    }
    if (n.kind === 'copyOffline') {
      return (
        'The categories were not copied from ' +
        (n.from || 'the other class') +
        ': there was no connection.' +
        (n.rest ? CM_CAT_REST : '')
      );
    }
    if (n.kind === 'changed') return st.typed && st.typed.length ? CM_CAT_NOTICES.changedTyped : CM_CAT_NOTICES.changed;
    return CM_CAT_NOTICES[n.kind] || null;
  }
  // The button beside the line: what it does, and its label.
  function _cmCatNoticeAction(st) {
    var n = st.notice;
    if (!n) return null;
    if (n.kind === 'offline' || n.kind === 'kept' || n.kind === 'waiting') return 'Discard My Changes';
    if (n.kind === 'offlineOrder' || n.kind === 'waitingOrder') return null;
    return 'Dismiss';
  }
  var CM_CAT_MODE_LABELS = { points: 'Total Points', percent: 'Average of Percentages' };
  function _cmCatTypedLine(r) {
    return (r.name || 'Unnamed') + ' · ' + (Number(r.weight) || 0) + '% · ' + CM_CAT_MODE_LABELS[categoryCalcMode(r)];
  }
  // html-safe: the line and each typed row through esc; the label is a constant
  function _cmCatNoticeHtml(st) {
    var text = _cmCatNoticeText(st);
    if (!text) return '';
    var action = _cmCatNoticeAction(st);
    var typed = st.notice.kind === 'changed' && st.typed && st.typed.length ? st.typed : null;
    return (
      '<div class="cm-cat-notice" role="status">' +
      '<div class="cm-cat-notice-text">' +
      esc(text) +
      '</div>' +
      (typed
        ? '<div class="cm-cat-typed"><div class="cm-cat-typed-label">What You Typed</div><ul>' +
          typed
            .map(function (r) {
              return '<li>' + esc(_cmCatTypedLine(r)) + '</li>';
            })
            .join('') +
          '</ul></div>'
        : '') +
      (action ? '<button class="cm-add-link" data-action="cmCatNoticeDone">' + action + '</button>' : '') +
      '</div>'
    );
  }

  /* What is kept on this device for the class's categories while a save
     has not been made (shared/data.js getCategoryDraft): the edits that
     could not be saved, or what was typed when the list turned out to have
     changed. Written when a save is refused and after every edit from
     then on; removed when a save is made or the teacher discards it. */
  function _cmCatKeep(cid) {
    var st = _cmCatState(cid);
    if (typeof saveCategoryDraft !== 'function') return;
    var draft = {};
    if (st.keeping) {
      draft.rows = _cmCatSnapshot(st.rows, true);
      draft.opened = st.opened || [];
      if (st.tried) draft.tried = st.tried.snap;
    }
    if (st.typed && st.typed.length) draft.typed = st.typed;
    if (st.notice && (st.notice.kind === 'copyChanged' || st.notice.kind === 'copyOffline')) {
      draft.note = {
        why: st.notice.kind === 'copyChanged' ? 'changed' : 'offline',
        from: st.notice.from,
        rest: st.notice.rest,
      };
    }
    saveCategoryDraft(cid, draft);
  }
  // After an edit: the kept copy follows what is on screen.
  function _cmCatEdited(cid) {
    var st = _cmCatState(cid);
    st.dirty = true;
    if (st.keeping) _cmCatKeep(cid);
  }
  /* The form has just been filled with the class's list (`opened` set).
     Lay over it what this device kept from before. */
  function _cmCatApplyKept(cid, st) {
    var draft = typeof getCategoryDraft === 'function' ? getCategoryDraft(cid) : null;
    if (!draft) return;
    if (draft.note) {
      st.notice = {
        kind: draft.note.why === 'changed' ? 'copyChanged' : 'copyOffline',
        from: draft.note.from,
        rest: !!draft.note.rest,
      };
    }
    if (Array.isArray(draft.typed) && draft.typed.length) {
      st.typed = draft.typed;
      st.notice = { kind: 'changed' };
    }
    if (!Array.isArray(draft.rows)) return;
    var same = function (a, b) {
      return typeof _categoryListsMatch === 'function' && _categoryListsMatch(a, b);
    };
    if (same(st.opened, draft.rows)) {
      // The save had landed after all (its answer never came): nothing is unsaved.
      saveCategoryDraft(cid, draft.note ? { note: draft.note } : null);
      return;
    }
    if (Array.isArray(draft.tried) && same(st.opened, draft.tried) && !same(st.opened, draft.opened || [])) {
      // The server holds the list this computer sent and never heard back
      // about: its own save landed, not a change made on another device.
      // What was typed after it is unsaved, made over that list.
      var rows = _cmCatWithLandedIds(draft.rows, draft.tried, st.opened);
      if (same(st.opened, rows)) {
        saveCategoryDraft(cid, draft.note ? { note: draft.note } : null);
        return;
      }
      st.rows = _cmCatRowsFrom(rows);
      st.dirty = true;
      st.keeping = true;
      st.notice = { kind: 'kept' };
      _cmCatKeep(cid);
      return;
    }
    if (same(st.opened, draft.opened || [])) {
      st.rows = _cmCatRowsFrom(draft.rows);
      st.dirty = true;
      st.keeping = true;
      st.notice = { kind: 'kept' };
      return;
    }
    // The list changed on another device while the edits waited here.
    st.typed = draft.rows;
    st.keeping = false;
    st.notice = { kind: 'changed' };
    _cmCatKeep(cid);
  }
  /* Kept rows typed over a list that was sent with no answer and then
     found on the server (`landed`, in its order): a new row of that list
     takes the id the server gave it, found by its key. */
  function _cmCatWithLandedIds(rows, tried, landed) {
    var byOrder = function (list) {
      return (list || [])
        .map(function (r, i) {
          return { r: r, i: i };
        })
        .sort(function (a, b) {
          return (Number(a.r.display_order) || 0) - (Number(b.r.display_order) || 0) || a.i - b.i;
        })
        .map(function (x) {
          return x.r;
        });
    };
    var sent = byOrder(tried);
    var there = byOrder(landed);
    var idOf = {};
    sent.forEach(function (r, i) {
      if (!r.id && r.key && there[i] && there[i].id) idOf[r.key] = there[i].id;
    });
    return (rows || []).map(function (r) {
      if (r.id || !r.key || !idOf[r.key]) return r;
      var row = Object.assign({}, r, { id: idOf[r.key] });
      delete row.key;
      return row;
    });
  }
  /* The button beside the line. Discard My Changes puts the form back to
     the class's list as the server has it; Dismiss takes the line away. */
  function cmCatNoticeDone() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var st = _cmCatState(cid);
    var discard =
      st.notice && (st.notice.kind === 'offline' || st.notice.kind === 'kept' || st.notice.kind === 'waiting');
    if (typeof saveCategoryDraft === 'function') saveCategoryDraft(cid, null);
    if (discard) {
      // Back to the list the changes were made over: the server's, as this
      // form last had it. The next save checks it again in any case.
      st.rows = _cmCatRowsFrom(st.opened || []).sort(function (a, b) {
        return a.display_order - b.display_order;
      });
      st.dirty = false;
      st.keeping = false;
      st.moving = null;
      // st.tried stays: a list sent with no answer may still be what the
      // server holds, and the next save must know it for this computer's own.
    }
    st.notice = null;
    st.typed = null;
    renderClassManager();
    // A save's answer never came: the opened list may not be the server's
    // any more. The form shows what the server holds, read now, or once it
    // can be read (_cmCatFollowServer).
    if (discard && st.tried) _cmCatFollowServer(cid);
  }

  /* After Discard My Changes with a save whose answer never came: read the
     server's list and show it. If it is the list that save sent, the save
     had landed ('landed'); if it is neither that nor the opened list, it
     changed on another device ('changed'). With no connection, or with new
     edits typed meanwhile, it waits for the next time Class Settings draws
     the categories (st.followServer). */
  function _cmCatFollowServer(cid) {
    var st = _cmCatState(cid);
    st.followServer = false;
    if (!st.tried || typeof _readServerCategories !== 'function') return Promise.resolve();
    if (typeof _isOffline === 'function' && _isOffline()) {
      st.followServer = true;
      return Promise.resolve();
    }
    var same = function (a, b) {
      return typeof _categoryListsMatch === 'function' && _categoryListsMatch(a, b);
    };
    return _cmCatInTurn(cid, function () {
      if (!st.tried) return;
      var tried = st.tried.snap;
      return Promise.resolve(_readServerCategories(cid)).then(function (rows) {
        if (!rows || st.dirty || !st.tried) {
          if (st.tried) st.followServer = true;
          return;
        }
        st.tried = null;
        if (same(rows, st.opened || [])) return; // it never landed: the form is right
        st.rows = _cmCatRowsFrom(rows);
        _cmCatRemember(st, st.rows);
        st.typed = null;
        st.notice = { kind: same(rows, tried) ? 'landed' : 'changed' };
        _cmMirrorCategoriesToCache(cid);
        _cmCatRedraw(cid);
      });
    });
  }

  /* A redraw after something the category code waited for (a read, a
     save's or a drag's answer, a copy). Only while Class Settings is still
     open on that class: drawn after the teacher left, it would put Class
     Settings back over the page they went to, or show this class's line on
     another class. The state is updated either way, so the class shows the
     right list and line when it is next opened. */
  function _cmCatRedraw(cid) {
    if (classManagerOpen && cmMode === 'edit' && cmSelectedCourse === cid) renderClassManager();
  }

  /* One save of the list at a time, in the order asked: each one's check
     reads the list the one before it left. */
  function _cmCatInTurn(cid, fn) {
    var st = _cmCatState(cid);
    var next = Promise.resolve(st.saving).then(fn, fn);
    st.saving = next.catch(function (e) {
      console.warn('Category save failed:', e);
    });
    return st.saving;
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
        calcMode: categoryCalcMode(r),
      };
    });
    adoptCategoriesFromServer(cid, camelRows);
  }

  // Without a server (Demo Mode) the class's categories are the cached ones.
  function _cmCatsLocalOnly() {
    return !window.v2 || !window.v2.listCategories || !_useSupabase;
  }
  function _cmCatFillLocal(cid, st) {
    st.loaded = true;
    st.rows = (getCategories(cid) || []).map(function (c, i) {
      return {
        id: c.id,
        name: c.name || '',
        weight: Number(c.weight) || 0,
        display_order: c.displayOrder != null ? Number(c.displayOrder) : i,
        calc_mode: categoryCalcMode(c),
      };
    });
    _cmCatRemember(st, st.rows);
    _cmCatApplyKept(cid, st);
  }

  function _cmLoadCategories(cid) {
    if (!cid) return;
    var st = _cmCatState(cid);
    if (st.loaded || st.loading) return;
    if (_cmCatsLocalOnly()) {
      _cmCatFillLocal(cid, st);
      if (st.rows.length) _cmCatRedraw(cid);
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
                calc_mode: categoryCalcMode(r),
              };
            })
            .sort(function (a, b) {
              return a.display_order - b.display_order;
            });
          _cmCatRemember(st, st.rows);
          _cmMirrorCategoriesToCache(cid);
          _cmCatApplyKept(cid, st);
          _cmCatRedraw(cid);
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
    // Cached categories are read now, so opening Class Settings draws it
    // once; a server's answer redraws it when it comes.
    if (!st.loaded && !st.loading && _cmCatsLocalOnly()) _cmCatFillLocal(cid, st);
    if (!st.loaded && !st.loading)
      setTimeout(function () {
        _cmLoadCategories(cid);
      }, 0);
    // Discarded with a save's answer outstanding and no connection then:
    // the server's list is read now.
    if (st.loaded && st.followServer && !st.dirty) {
      st.followServer = false;
      setTimeout(function () {
        _cmCatFollowServer(cid);
      }, 0);
    }

    var rows = st.rows || [];
    var html =
      '<div class="cm-field cm-cat-field">' +
      '<label class="cm-label">Categories</label>' +
      _cmCatNoticeHtml(st) +
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
        _cmCatModeSelect(row, idx) +
        '<button class="cm-delete-mini" data-action="cmCatDelete" data-idx="' +
        idx +
        '" title="Delete category" aria-label="Delete category">\u2715</button>' +
        '</div>';
    });
    html +=
      '</div>' +
      (rows.length
        ? '<div class="cm-hint cm-cat-mode-hint">Total Points adds up every assessment’s points, so a rubric with more criteria counts more. Average of Percentages makes each assessment count the same. Factor still counts an assessment more than once.</div>'
        : '') +
      _cmRenderUncategorized(cid) +
      '<div class="cm-cat-footer">' +
      '<button class="cm-add-link" data-action="cmCatAdd">+ Add Category</button>' +
      '<button class="cm-add-link" data-action="cmCatCopyFrom">Copy From Another Class</button>' +
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
      '>Save Categories</button>' +
      '</div>' +
      '</div>';
    return html;
  }

  function cmCatAdd() {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    st.rows.push({ id: null, name: '', weight: 0, display_order: st.rows.length });
    _cmCatEdited(cmSelectedCourse);
    renderClassManager();
  }

  function cmCatNameLive(idx, value) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    row.name = value || '';
    _cmCatEdited(cmSelectedCourse);
    _cmCatRefreshFooter(cmSelectedCourse);
  }

  /* A category's Calculation: Total Points or Average of Percentages
     (category.calc_mode, docs/DECISIONS.md "Category calculation"). */
  var CM_CAT_MODES = [
    ['points', 'Total Points'],
    ['percent', 'Average of Percentages'],
  ];
  function _cmCatModeSelect(row, idx) {
    var mode = categoryCalcMode(row);
    return (
      '<select class="cm-input cm-cat-mode" data-action-change="cmCatMode" data-idx="' +
      idx +
      '" aria-label="' +
      esc((row.name || 'Category') + ' calculation') +
      '">' +
      CM_CAT_MODES.map(function (m) {
        return '<option value="' + m[0] + '"' + (mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
      }).join('') +
      '</select>'
    );
  }

  function cmCatMode(idx, value) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    row.calc_mode = value === 'percent' ? 'percent' : 'points';
    _cmCatEdited(cmSelectedCourse);
    _cmCatRefreshFooter(cmSelectedCourse);
  }

  function cmCatWeightLive(idx, value) {
    if (!cmSelectedCourse) return;
    var st = _cmCatState(cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    var v = parseFloat(value);
    row.weight = isNaN(v) ? 0 : Math.max(0, v);
    _cmCatEdited(cmSelectedCourse);
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
      // Nothing is chosen for the teacher (docs/DECISIONS.md, "A category on
      // every assessment"). This row appears where Save Categories was, so a
      // second click on Save would otherwise move the work to the first one.
      '<select class="cm-input" id="cm-cat-uncat-target" aria-label="Move to category">' +
      '<option value="" selected>Choose a Category</option>' +
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
    _cmCatEdited(cid);
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
    var sel = document.getElementById('cm-cat-uncat-target');
    var target = (sel || {}).value;
    if (!target) {
      if (sel && typeof sel.focus === 'function') sel.focus();
      return;
    }
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
    // A changed Calculation moves the course % of every term, so with a
    // term already ended the teacher confirms first.
    var savedModes = {};
    (getCategories(cid) || []).forEach(function (c) {
      savedModes[c.id] = categoryCalcMode(c);
    });
    var modeChanged = rows.some(function (r) {
      return r.id && savedModes[r.id] && savedModes[r.id] !== categoryCalcMode(r);
    });
    var ended = modeChanged ? _cmEndedTerm(cid) : null;
    if (ended) {
      showConfirm(
        'Change the Course %?',
        'This changes the course % for every term, including ' +
          (ended.label || 'Term ' + ended.ordinal) +
          ', which has already ended. Report cards printed before today won’t match.',
        'Change',
        'primary',
        function () {
          _cmCatSaveRows(cid, rows);
        },
      );
      return Promise.resolve();
    }
    return _cmCatSaveRows(cid, rows);
  }

  function _cmCatSaveRows(cid, rows) {
    return _cmCatInTurn(cid, function () {
      return _cmCatSaveNow(cid, rows, 0);
    });
  }
  /* The server's list is read, compared with the one this form was opened
     with, and the save sent, in one online moment or not at all
     (saveCategoriesNow in shared/data.js). Nothing is left in the outbox
     to go out later over a change made elsewhere. */
  function _cmCatSaveNow(cid, rows, again) {
    var st = _cmCatState(cid);
    var tried = st.tried ? st.tried.snap : null;
    return Promise.resolve(saveCategoriesNow(cid, rows, st.opened || [], tried)).then(function (res) {
      res = res || { ok: false, why: 'offline' };
      if (res.ok && res.landed) {
        // An earlier try had reached the server; its answer never came.
        var landed = _cmCatRowsFrom(res.rows);
        (st.tried ? st.tried.rows : []).forEach(function (r, i) {
          if (landed[i] && !r.id) r.id = landed[i].id;
        });
        _cmCatRemember(st, landed);
        var same = typeof _categoryListsMatch === 'function' && _categoryListsMatch(landed, _cmCatSnapshot(rows, true));
        st.tried = null;
        if (!same && !again) return _cmCatSaveNow(cid, rows, 1);
        res = {
          ok: true,
          ids: landed.map(function (r) {
            return r.id;
          }),
        };
      }
      if (res.ok) {
        var ids = res.ids || [];
        rows.forEach(function (r, i) {
          // Without a server (Demo Mode) a new row keeps a local id.
          r.id = ids[i] || r.id || uid();
        });
        st.dirty = false;
        st.notice = null;
        st.typed = null;
        st.tried = null;
        st.keeping = false;
        _cmCatRemember(st, rows, true);
        _cmCatKeep(cid);
        _cmMirrorCategoriesToCache(cid);
        _cmCatRedraw(cid);
        return;
      }
      if (res.why === 'changed') {
        // Nothing was saved. The current list shows; what the teacher had
        // typed is kept beside it, on this device too.
        st.typed = _cmCatSnapshot(rows, true);
        st.rows = _cmCatRowsFrom(res.rows);
        _cmCatRemember(st, st.rows);
        st.dirty = false;
        st.moving = null;
        st.tried = null;
        st.keeping = false;
        st.notice = { kind: 'changed' };
        _cmCatKeep(cid);
        _cmMirrorCategoriesToCache(cid);
        _cmCatRedraw(cid);
        return;
      }
      if (res.why === 'refused') {
        if (typeof showSyncToast === 'function')
          showSyncToast('Categories not saved: ' + ((res.error && res.error.message) || 'server error'), 'error');
        return;
      }
      // No connection, or this computer's other changes had not gone:
      // nothing was saved, and what was typed stays, on screen and on this
      // device. Sent with no answer: it may have landed, and the next check
      // knows it for this computer's own if it did.
      if (res.unknown) _cmCatTried(st, rows);
      st.keeping = true;
      st.notice = { kind: res.why === 'waiting' ? 'waiting' : 'offline' };
      _cmCatKeep(cid);
      _cmCatRedraw(cid);
    });
  }
  /* A list sent whose answer never came. Its new rows get a key, kept with
     them on this device, so the ids the server gave them can be found again
     after the tab is closed (_cmCatWithLandedIds). */
  function _cmCatTried(st, rows) {
    rows.forEach(function (r) {
      if (!r.id && !r.key) r.key = uid();
    });
    st.tried = { rows: rows.slice(), snap: _cmCatSnapshot(rows, true) };
  }

  // Grading setup copied to or from another class (teacher/grading-setup-copy.js).
  // Unsaved category or term edits would be lost under the copy, so they
  // are saved or undone first.
  // grading-setup-copy.js loads the first time this is pressed (router.js _onDemand).
  function cmOpenSetupCopy(opts) {
    window.Router.withScripts('gradingSetupCopy', function () {
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
            // A class whose categories were left as they were says so above
            // them when it is next shown here (noteCategoriesNotCopied).
            (cids || []).forEach(function (c) {
              delete _cmCategoryState[c];
              delete _cmTermState[c];
            });
            _cmCatRedraw(cid);
          },
        }),
      );
    });
  }

  /* A row dragged to a new place. It moves on screen at once. With nothing
     else unsaved, the new order is checked and sent in one online moment
     (reorderCategoriesNow in shared/data.js): the list changed elsewhere,
     the current one shows; no connection, the row goes back where it was;
     sent with no answer, it stays, as a change not yet saved. */
  function _cmCatReorder(cid, fromIdx, toIdx) {
    var st = _cmCatState(cid);
    var before = st.rows.slice();
    var moved = st.rows.splice(fromIdx, 1)[0];
    st.rows.splice(toIdx, 0, moved);
    st.rows.forEach(function (r, i) {
      r.display_order = i;
    });
    // With other changes not yet saved (a row deleted or added here, a
    // weight typed), the new order goes up with Save Categories, which
    // numbers the whole list. reorder_categories numbers only the rows it
    // is sent: sent without a row deleted on screen, it would leave that
    // row tied with another on the server, in an order this form cannot
    // know, and the next save would take it for a change made elsewhere.
    var unsaved =
      st.dirty ||
      st.rows.some(function (r) {
        return !r.id;
      });
    if (unsaved) _cmCatEdited(cid);
    renderClassManager();
    if (unsaved || !window.v2 || !window.v2.reorderCategories) return Promise.resolve();
    var ids = st.rows.map(function (r) {
      return r.id;
    });
    function undo() {
      // Only if the list on screen is still the dragged one.
      if (st.rows.length !== before.length || st.rows.some(r => before.indexOf(r) < 0)) return;
      st.rows = before;
      st.rows.forEach(function (r, i) {
        r.display_order = i;
      });
    }
    return _cmCatInTurn(cid, function () {
      return Promise.resolve(reorderCategoriesNow(cid, ids, st.opened || [])).then(function (res) {
        res = res || { ok: false, why: 'offline' };
        if (res.ok) {
          // Every row was sent, so the server holds them in this order.
          if (!res.local) _cmCatRemember(st, st.rows, true);
          return;
        }
        if (res.why === 'changed') {
          st.rows = _cmCatRowsFrom(res.rows);
          _cmCatRemember(st, st.rows);
          st.dirty = false;
          st.moving = null;
          st.typed = null;
          st.notice = { kind: 'changed' };
          _cmMirrorCategoriesToCache(cid);
        } else if (res.why === 'refused') {
          undo();
        } else if (res.unknown) {
          // Sent, and no answer came: the new order may be on the server or
          // not. The row stays where it was put, as a change not yet saved,
          // kept like any other; the next Save sends it, or finds it landed.
          _cmCatTried(st, st.rows);
          st.dirty = true;
          st.keeping = true;
          st.notice = { kind: 'offline' };
          _cmCatKeep(cid);
        } else {
          // Not sent: the row goes back where it was.
          undo();
          st.notice = { kind: res.why === 'waiting' ? 'waitingOrder' : 'offlineOrder' };
        }
        _cmCatRedraw(cid);
      });
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
      _cmCatDragId = null;
      _cmCatReorder(cmSelectedCourse, fromIdx, toIdx);
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

  // Rubric Levels: the order the class draws the four levels, everywhere
  // (levelOrderFor in shared/constants.js). A new class starts Emerging First
  // in grades 8–9, Extending First in 10–12 (_cmDefaultLevelOrder).
  var CM_LEVEL_ORDERS = [
    { value: 'asc', label: 'Emerging First' },
    { value: 'desc', label: 'Extending First' },
  ];
  function _cmRenderLevelOrderField(cid) {
    var current = levelOrderFor(cid)[0] === 1 ? 'asc' : 'desc';
    return (
      '<div class="cm-field" style="margin-top:14px">' +
      '<label class="cm-label" id="cm-level-order-label">Rubric Levels</label>' +
      '<div class="seg cm-seg" id="cm-level-order" role="radiogroup" aria-labelledby="cm-level-order-label">' +
      CM_LEVEL_ORDERS.map(function (o) {
        var on = o.value === current;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="cmSetLevelOrder" data-value="' +
          o.value +
          '">' +
          o.label +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="cm-hint" style="margin-top:6px">Decides the order of the four levels on scoring cards, rubrics, printouts and reports in this class.</div>' +
      '</div>'
    );
  }
  function cmSetLevelOrder(val) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.levelOrder = val === 'asc' ? 'asc' : 'desc';
    saveCourseConfig(cmSelectedCourse, cc);
    renderClassManager();
  }

  function cmSetRoundPercent(val) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.roundPercent = val === 'whole';
    saveCourseConfig(cmSelectedCourse, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
    renderClassManager();
  }

  /* ── Reporting terms: teacher/cm-terms.js ── */
  CmTerms.configure({
    selectedCourse: function () {
      return cmSelectedCourse;
    },
    renderClassManager: renderClassManager,
  });
  var _cmTermState = CmTerms._cmTermState;
  var _cmTermSchool = CmTerms._cmTermSchool;
  var _cmTermRows = CmTerms._cmTermRows;
  var _cmTermError = CmTerms._cmTermError;
  var _cmTermDay = CmTerms._cmTermDay;
  var _cmDefaultReportingTerms = CmTerms._cmDefaultReportingTerms;
  var _cmRenderReportingTermsField = CmTerms._cmRenderReportingTermsField;
  var cmTermEdit = CmTerms.cmTermEdit;
  var cmTermCancel = CmTerms.cmTermCancel;
  var cmTermSpan = CmTerms.cmTermSpan;
  var cmTermPreset = CmTerms.cmTermPreset;
  var cmTermSchool = CmTerms.cmTermSchool;
  var cmTermSchoolPreset = CmTerms.cmTermSchoolPreset;
  var cmTermAdd = CmTerms.cmTermAdd;
  var cmTermDelete = CmTerms.cmTermDelete;
  var cmTermLive = CmTerms.cmTermLive;
  var cmTermSave = CmTerms.cmTermSave;

  // A new method moves grades that already exist, so the change says how
  // many students it moves before it is made.
  function cmSetCalcMethod(val) {
    if (!cmSelectedCourse || !CM_METHOD_TEXT[val]) return;
    var cid = cmSelectedCourse;
    var course = COURSES[cid];
    var current = getCourseConfig(cid).calcMethod || course.calcMethod || 'average';
    if (!CM_METHOD_TEXT[current]) current = 'mostRecent';
    if (val === current) return;
    var preview = previewCalcMethodChange(cid, val);
    if (!preview.changed) return _cmApplyCalcMethod(val);
    showConfirm(
      'Change Calculation Method to ' + CM_METHOD_TEXT[val].label + '?',
      _cmGradeChangeMessage(cid, preview),
      'Change Method',
      'primary',
      function () {
        _cmApplyCalcMethod(val);
      },
    );
  }

  /* What a grading change does to the class, for its confirm. */
  function _cmGradeChangeMessage(cid, preview) {
    var letterOnly = courseGradeMode(cid) === 'letter';
    return (
      'This changes the ' +
      (letterOnly ? 'competency proficiency' : 'overall proficiency') +
      ' for ' +
      preview.changed +
      ' of your ' +
      preview.total +
      ' students.' +
      (preview.example
        ? ' For example, ' +
          preview.example.name +
          ' goes from ' +
          preview.example.before +
          ' to ' +
          preview.example.after +
          '.'
        : '') +
      (letterOnly ? ' It does not change the %.' : '') +
      ' Marks you\u2019ve already copied into MyEd won\u2019t change there.'
    );
  }

  // Like a new method, a new limit moves existing grades, so it says how
  // many students first. The menu shows the saved choice until confirmed.
  function cmSetRecentLimit(val) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var next = parseInt(val, 10) >= 1 ? parseInt(val, 10) : null;
    if (next === getRecentScoreLimit(cid)) return;
    var course = COURSES[cid];
    var method = getCourseConfig(cid).calcMethod || course.calcMethod || 'average';
    var preview = previewCalcMethodChange(cid, method, undefined, next);
    if (!preview.changed) return _cmApplyRecentLimit(next);
    renderClassManager();
    showConfirm(
      next ? 'Count Only the Most Recent ' + next + ' Scores?' : 'Count All Scores?',
      _cmGradeChangeMessage(cid, preview),
      'Change',
      'primary',
      function () {
        _cmApplyRecentLimit(next);
      },
    );
  }

  // Folders Count as One moves the overall, so like a new method it says
  // how many students first. The switch shows the saved value until confirmed.
  function cmSetFoldersCountAsOne(on) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    on = !!on;
    if (on === getFoldersCountAsOne(cid)) return;
    var preview = previewFolderCountChange(cid, { on: on });
    if (!preview.changed) return _cmApplyFoldersCountAsOne(on);
    renderClassManager();
    showConfirm(
      on ? 'Count Each Folder as One?' : 'Count Every Competency the Same?',
      _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
      'Change',
      'primary',
      function () {
        _cmApplyFoldersCountAsOne(on);
      },
    );
  }

  var CM_FOLDER_COUNT_SENT = ' Reports already printed or sent and approved comments keep what they say.';

  function _cmApplyFoldersCountAsOne(on) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.foldersCountAsOne = on;
    saveCourseConfig(cmSelectedCourse, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
    renderClassManager();
  }

  // Each Course Counts Equally moves the overall too, so it asks the same way.
  function cmSetCoursesCountEqually(on) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    on = !!on;
    if (on === getCoursesCountEqually(cid)) return;
    var preview = previewCoursesEqualChange(cid, on);
    if (!preview.changed) return _cmApplyCoursesCountEqually(on);
    renderClassManager();
    showConfirm(
      on ? 'Count Each Course Equally?' : 'Count Courses by Their Competencies?',
      _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
      'Change',
      'primary',
      function () {
        _cmApplyCoursesCountEqually(on);
      },
    );
  }

  function _cmApplyCoursesCountEqually(on) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.coursesCountEqually = on;
    saveCourseConfig(cmSelectedCourse, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
    renderClassManager();
  }

  // One folder's Counts as One, from its header in Competencies.
  function cmSetFolderCountsAsOne(grpId, on) {
    grpId = _currentId('group', grpId);
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    on = !!on;
    var current = getCompetencyGroupById(cid, grpId);
    if (!current || (current.countsAsOne !== false) === on) return;
    var preview = previewFolderCountChange(cid, { groupId: grpId, on: on });
    if (!preview.changed) return _cmApplyFolderCountsAsOne(grpId, on);
    _cmRenderWithScroll();
    showConfirm(
      on ? 'Count ' + current.name + ' as One?' : 'Count Each Competency in ' + current.name + '?',
      _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
      'Change',
      'primary',
      function () {
        _cmApplyFolderCountsAsOne(grpId, on);
      },
    );
  }

  function _cmApplyFolderCountsAsOne(grpId, on) {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var g = (map.competencyGroups || []).find(function (x) {
      return x.id === grpId;
    });
    if (!g) return;
    g.countsAsOne = on;
    saveLearningMap(cid, map);
    if (typeof clearProfCache === 'function') clearProfCache();
    _cmRenderWithScroll();
  }

  function _cmApplyRecentLimit(n) {
    if (!cmSelectedCourse) return;
    var cc = getCourseConfig(cmSelectedCourse);
    cc.recentScoreLimit = n;
    saveCourseConfig(cmSelectedCourse, cc);
    renderClassManager();
  }

  function _cmApplyCalcMethod(val) {
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
    var rule = document.getElementById('cm-method-rule');
    if (rule) rule.textContent = _cmMethodRule('decayingAvg', parseInt(val, 10) / 100);
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
    Promise.all([loadCurriculumIndex(), _cmLoadCrosswalk()]).then(function (got) {
      var idx = got[0];
      cwCurriculumLoaded = !!idx;
      cwLoadError = !idx;
      if (idx) cwSelectedTags = _cmRelinkTags(cwSelectedTags, got[1]);
      renderClassManager();
    });
    renderClassManager();
  }

  /* The courses Re-link starts with: the class's own, less any the bank
     dropped. A dropped course whose successors are settled (Humanities 8 →
     ELA 8 + SS 8) brings them in; the others are listed for the teacher. */
  function _cmRelinkTags(tags, cw) {
    var out = [];
    tags.forEach(function (k) {
      var note = cw && cw.courses && cw.courses[k];
      if (CURRICULUM_INDEX[k] || !note || !note.dropped) {
        if (CURRICULUM_INDEX[k] && out.indexOf(k) < 0) out.push(k);
        return;
      }
      if (note.decided)
        note.successors.forEach(function (s) {
          if (CURRICULUM_INDEX[s] && out.indexOf(s) < 0) out.push(s);
        });
    });
    return out;
  }

  /* The class's courses the bank no longer has, with what replaces them. */
  function _cmDroppedCourses(cid) {
    var cw = window._CURRICULUM_CROSSWALK || _cmCrosswalk;
    var tags = (COURSES[cid] && COURSES[cid].curriculumTags) || [];
    return tags
      .filter(function (k) {
        return CURRICULUM_INDEX && !CURRICULUM_INDEX[k] && cw && cw.courses && cw.courses[k] && cw.courses[k].dropped;
      })
      .map(function (k) {
        return Object.assign({ key: k }, cw.courses[k]);
      });
  }

  function cmRelinkCancel() {
    cmRelinkCid = null;
    cmRelinkStep = 0;
    cwSelectedTags = [];
    renderClassManager();
  }

  function cmRelinkNext() {
    if (!cmRelinkCid || cwSelectedTags.length === 0) return;
    cmRelinkStep = 2;
    _cmOpenCompReview(cmRelinkCid, _cmCurriculumCands(cwSelectedTags), {
      kind: 'curriculum',
      tags: cwSelectedTags.slice(),
    });
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
        _cmDroppedCourses(cid).forEach(function (d) {
          var names = d.successors
            .filter(function (k) {
              return CURRICULUM_INDEX[k];
            })
            .map(function (k) {
              return CURRICULUM_INDEX[k].course_name;
            });
          html +=
            '<div class="cm-hint cm-relink-dropped">' +
            esc(d.name) +
            ' is no longer a BC curriculum course. ' +
            (d.decided
              ? 'Its courses are ticked below: ' + esc(names.join(' and ')) + '.'
              : names.length
                ? 'The courses that replace it: ' + esc(names.join(', ')) + '. Tick the ones this class teaches.'
                : '') +
            '</div>';
        });
        html += '<div class="cm-field"><label class="cm-label">Grade</label><div class="cw-grade-row">';
        [8, 9, 10, 11, 12].forEach(function (g) {
          html +=
            '<button class="cw-grade-btn' +
            (cwSelectedGrade === g ? ' active' : '') +
            '" aria-pressed="' +
            (cwSelectedGrade === g) +
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
              '" aria-pressed="' +
              (cwSelectedSubject === s) +
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
              // Counted and named as the New Class wizard's course rows.
              var counts = _cwCourseCounts([c.short_tag]);
              html +=
                '<div class="cw-course-item' +
                sel +
                '" role="checkbox" tabindex="0" aria-checked="' +
                (sel ? 'true' : 'false') +
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
                counts.competencies +
                (counts.competencies === 1 ? ' Competency' : ' Competencies') +
                (counts.folders ? ' \u00B7 ' + counts.folders + (counts.folders === 1 ? ' Folder' : ' Folders') : '') +
                '</span>' +
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
      html += _cmRenderCompReview(cid);
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
    // Photos of student work go too (S8-F1, Colin's ruling 102).
    return _cmPhotosBeforeDelete(cid, function (who, maybe) {
      if (!COURSES[cid] || !isCourseArchived(cid)) return;
      _cmConfirmDeleteCourse(cid, COURSES[cid], maybe || Object.keys(who).length > 0);
    });
  }

  function _cmConfirmDeleteCourse(cid, course, photos) {
    showConfirm(
      'Delete Class',
      photos
        ? 'Permanently delete ' +
            course.name +
            " with all its students, assessments, scores and photos of student work? It disappears now and is erased for good after 30 days. Deleted photos can't come back."
        : 'Permanently delete ' +
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
  /* Everything the class holds, as one JSON file the teacher keeps.
     Restore Class from Backup (shared/backup-restore.js) reads it back.
     courseInfo and rubricChecks are in backups from Nov 2026 on. */
  function cmDownloadBackup(cid) {
    if (!COURSES[cid]) return;
    var data = {
      course: cid,
      savedAt: new Date().toISOString(),
      // "Photos of student work are not in this file." once the class's student page is on (S8-F2).
      photos: typeof FVBackupRestore !== 'undefined' ? FVBackupRestore.photosNote(cid) : undefined,
      courseInfo: structuredClone(COURSES[cid]),
      students: getStudents(cid),
      categories: getCategories(cid),
      assessments: getAssessments(cid),
      scores: getScores(cid),
      overrides: getOverrides(cid),
      notes: getNotes(cid),
      config: getCourseConfig(cid),
      learningMap: getLearningMap(cid),
      modules: getModules(cid),
      rubrics: getRubrics(cid),
      rubricChecks: getRubricChecks(cid),
      statuses: getAssignmentStatuses(cid),
      flags: getFlags(cid),
      goals: getGoals(cid),
      reflections: getReflections(cid),
      observations: getQuickObs(cid),
      termRatings: getTermRatings(cid),
      customTags: getCustomTags(cid),
      reportConfig: getReportConfig(cid),
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gradebook-' + cid + '-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
  }

  /* Restore Class from Backup: a backup file becomes a new class. Nothing
     in another class changes (shared/backup-restore.js). */
  // html-safe: fixed markup; the backup's class name and counts go in through esc().
  function cmRestoreBackup() {
    var triggerEl = document.activeElement;
    var backup = null;
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cm-restore-title');
    overlay.innerHTML =
      '<div class="confirm-card cm-restore-card">' +
      '<div class="confirm-title" id="cm-restore-title">Restore Class from Backup</div>' +
      '<div class="confirm-message">Choose a file saved by Download Class Backup. It becomes a new class with its students, competencies, assessments, scores and reports. ' +
      // Fixed text, said once any class takes work (S8-F2; wording approved, ruling 102).
      (typeof FVBackupRestore !== 'undefined' && FVBackupRestore.anyClassTakesWork()
        ? esc(FVBackupRestore.PHOTOS_NOT_IN_BACKUP) + ' '
        : '') +
      'Your other classes are not changed.</div>' +
      '<div class="cm-field"><label class="cm-label" for="cm-restore-file">Backup File</label>' +
      '<input type="file" id="cm-restore-file" accept=".json,application/json"></div>' +
      '<div class="cm-restore-summary" id="cm-restore-summary" role="status"></div>' +
      '<div class="cm-field" id="cm-restore-name-field" hidden><label class="cm-label" for="cm-restore-name">Class Name</label>' +
      '<input type="text" class="cm-input" id="cm-restore-name" maxlength="120"></div>' +
      '<div class="confirm-actions">' +
      '<button class="confirm-cancel" id="cm-restore-cancel">Cancel</button>' +
      '<button class="confirm-ok primary" id="cm-restore-ok" disabled>Restore</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    var fileInput = overlay.querySelector('#cm-restore-file');
    var summary = overlay.querySelector('#cm-restore-summary');
    var nameField = overlay.querySelector('#cm-restore-name-field');
    var nameInput = overlay.querySelector('#cm-restore-name');
    var okBtn = overlay.querySelector('#cm-restore-ok');
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
    function plural(n, word) {
      return n + ' ' + word + (n === 1 ? '' : 's');
    }
    function showFile(text) {
      try {
        backup = FVBackupRestore.parseBackup(text);
      } catch (err) {
        backup = null;
        summary.textContent = err.message;
        nameField.hidden = true;
        okBtn.disabled = true;
        return;
      }
      var info = backup.courseInfo || {};
      var students = (backup.students || []).length;
      var assessments = (backup.assessments || []).length;
      var saved = backup.savedAt ? new Date(backup.savedAt) : null;
      var line = plural(students, 'Student') + ' · ' + plural(assessments, 'Assessment');
      if (saved && !isNaN(saved.getTime()))
        line += ' · Saved ' + saved.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
      summary.innerHTML =
        '<div>' +
        esc(line) +
        '</div>' +
        (backup.courseInfo
          ? ''
          : '<div class="cm-restore-note">This backup is from before November 2026 and has no class settings. Set the grade and grading style in Class Details after restoring.</div>');
      nameInput.value = info.name || '';
      nameField.hidden = false;
      okBtn.disabled = false;
      nameInput.focus();
    }
    function restore() {
      if (!backup) return;
      var name = nameInput.value.trim() || 'Restored Class';
      var restored;
      try {
        restored = FVBackupRestore.restoreClassFromBackup(backup, { name: name });
      } catch (err) {
        console.error('Restore from backup failed:', err);
        summary.textContent = "This backup couldn't be restored.";
        return;
      }
      close();
      cmSelectedCourse = restored.cid;
      cmMode = 'edit';
      renderClassManager();
      showSyncToast('Restored ' + name + '.', 'success');
      restored.sent.catch(function (err) {
        console.error('import_json_restore failed:', err);
        if (window.Sentry && typeof window.Sentry.captureException === 'function') window.Sentry.captureException(err);
        if (cmSelectedCourse === restored.cid) cmSelectedCourse = getActiveCourse();
        renderClassManager();
        showSyncToast("Couldn't restore " + name + '. The backup file is unchanged; try again.', 'info');
      });
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.id === 'cm-restore-cancel') return close();
      if (e.target.id === 'cm-restore-ok') restore();
    });
    nameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') restore();
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      file.text().then(showFile, function () {
        showFile('');
      });
    });
    fileInput.focus();
  }

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
      '<div class="confirm-message">Settings, curriculum and categories are copied. Students, assessments and rubrics are not.</div>' +
      '<div class="cm-field"><label class="cm-label" id="cm-dup-block-label">Block for the New Class</label>' +
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
      calcMethod: src.calcMethod || 'average',
      decayWeight: src.decayWeight || 0.65,
    });
    // Reporting terms stay behind: their dates belong to one school year
    // (DECISIONS, Reporting periods 6).
    var cc = structuredClone(getCourseConfig(sourceCid));
    delete cc.reportingTerms;
    // The copy's Student Page starts off; its Return Grades choice
    // (return_grades) comes along (DECISIONS, Student page build rulings 12).
    delete cc.student_page_enabled;
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
        return { id: uid(), name: c.name, weight: c.weight, displayOrder: i, calcMode: categoryCalcMode(c) };
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
    // html-safe: CM_COLORS are fixed; target and id are our own data attributes ('section'/'subject' and ids).
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

  /* Competency group colour: the swatch opens the shared colour popover (ui.js). */
  function cmOpenGroupColorPop(swatch) {
    var grpId = swatch.dataset.grpid;
    var map = cmSelectedCourse && getLearningMap(cmSelectedCourse);
    var g = ((map && map.competencyGroups) || []).find(function (x) {
      return x.id === _currentId('group', grpId);
    });
    if (!g) return;
    openColorPop(swatch, {
      key: 'group:' + grpId,
      colors: CM_GROUP_COLORS,
      current: g.color,
      label: 'Group colour',
      findSwatch: function () {
        return document.querySelector('.mod-folder-color[data-grpid="' + grpId + '"]');
      },
      onPick: function (color) {
        cmUpdateCompGroupColor(grpId, color);
      },
    });
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
        count + ' competencies will leave this folder. Delete anyway?',
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

  // Redraw, then put keyboard focus back on the control that caused it: a
  // checkbox or radio is a new element after the redraw, and focus would
  // otherwise fall back to the page.
  function _cmAttr(v) {
    return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function _cmRenderAndFocus(sel) {
    renderClassManager();
    var el = sel && document.querySelector(sel);
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
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
      name: 'New Competency',
      shortName: 'New',
      color: colour,
      tags: [
        {
          id: stdId,
          label: 'New Competency',
          text: '',
          color: colour,
          subject: subId,
          name: 'New Competency',
          shortName: 'New',
        },
      ],
    });
    map._flatVersion = 2;
    saveLearningMap(cid, map);
    // The new card opens with its Title ready to type over.
    _cmOpenStdCards[stdId] = true;
    renderClassManager();
    requestAnimationFrame(function () {
      var id = _currentId('section', stdId);
      var card = document.getElementById('cm-std-' + id);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var title = document.getElementById('cm-std-title-' + id);
      if (title) {
        title.focus({ preventScroll: true });
        if (typeof title.select === 'function') title.select();
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

  /* ── Competencies toolbar, select mode, CSV ─────────────────
     Select picks several competencies to move into a folder or remove
     (scores kept). Import / Export writes the list as a CSV and reads one
     back through the same review Re-link uses, so nothing is added twice. */
  var cmCompSelect = false;
  var cmCompSelected = {};
  var cmCompReview = null;

  var CM_COMP_CSV_HEADER = ['Code', 'Title', 'Curricular Competency', 'I Can Statements', 'Folder'];

  function _cmRenderCompToolbar(cid, lm, compGroups) {
    var secs = lm.sections || [];
    if (cmCompSelect) {
      var n = secs.filter(function (s) {
        return cmCompSelected[s.id];
      }).length;
      var off = n === 0 ? ' disabled' : '';
      return (
        '<div class="cm-comp-toolbar cm-comp-selectbar">' +
        '<span class="cm-comp-selected">' +
        n +
        ' Selected</span>' +
        '<button type="button" class="cm-add-link" data-action="cmCompSelectAll">Select All</button>' +
        '<div class="cm-comp-buttons">' +
        (compGroups.length
          ? '<div class="cm-std-menu-wrap">' +
            '<button type="button" class="cm-action-btn" data-action="cmStdMenu" aria-haspopup="menu" aria-expanded="false"' +
            off +
            '>Move to Folder \u25BE</button>' +
            '<div class="cm-std-menu" role="menu" hidden>' +
            compGroups
              .map(function (g) {
                return (
                  '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmCompMove" data-grpid="' +
                  g.id +
                  '">' +
                  esc(g.name) +
                  '</button>'
                );
              })
              .join('') +
            '<button type="button" role="menuitem" class="cm-std-menu-item" data-action="cmCompMove" data-grpid="">Ungrouped</button>' +
            '</div>' +
            '</div>'
          : '') +
        '<button type="button" class="cm-action-btn cm-comp-remove" data-action="cmCompRemoveSelected"' +
        off +
        '>Remove\u2026</button>' +
        '<button type="button" class="cm-action-btn" data-action="cmCompSelectDone">Done</button>' +
        '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="cm-comp-toolbar">' +
      '<div class="cm-hint">' +
      (secs.length
        ? 'Drag a competency to reorder it or move it into a folder.'
        : 'Add competencies one at a time, import a CSV, or link the class to the BC Curriculum.') +
      '</div>' +
      '<div class="cm-comp-buttons">' +
      (secs.length
        ? '<button type="button" class="cm-action-btn" data-action="cmCompSelectStart">Select</button>'
        : '') +
      '<div class="cm-std-menu-wrap">' +
      '<button type="button" class="cm-action-btn" data-action="cmStdMenu" aria-haspopup="menu" aria-expanded="false">Import / Export \u25BE</button>' +
      '<div class="cm-std-menu cm-comp-io-menu" role="menu" hidden>' +
      (secs.length
        ? '<button type="button" role="menuitem" class="cm-std-menu-item cm-comp-io-item" data-action="cmCompExport">' +
          '<span class="cm-comp-io-name">Export Competencies</span>' +
          '<span class="cm-comp-io-desc">A CSV file with Code, Title, Curricular Competency, I Can Statements and Folder.</span>' +
          '</button>'
        : '') +
      '<button type="button" role="menuitem" class="cm-std-menu-item cm-comp-io-item" data-action="cmCompImport">' +
      '<span class="cm-comp-io-name">Import From CSV\u2026</span>' +
      '<span class="cm-comp-io-desc">Same columns. You\u2019ll see what changes before anything is added, so nothing is duplicated.</span>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '<button type="button" class="cm-action-btn" data-action="cmAddCompGroup">Add Folder</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmAddStd">Add Competency</button>' +
      '<input type="file" id="cm-comp-csv-input" accept=".csv,.txt" style="display:none" data-action-change="cmCompCSV">' +
      '</div>' +
      '</div>'
    );
  }

  function _cmRenderStdSelectRow(sec) {
    var tag = sec.tags[0] || {};
    var title = tag.label || sec.shortName || sec.name || '';
    var code = _cmStdCode(tag);
    var icans = (tag.i_can_statements || []).length;
    var on = !!cmCompSelected[sec.id];
    return (
      '<label class="cm-comp-select-row' +
      (on ? ' selected' : '') +
      '">' +
      '<input type="checkbox"' +
      (on ? ' checked' : '') +
      ' aria-label="Select ' +
      esc(title) +
      '" data-action-change="cmCompToggle" data-secid="' +
      sec.id +
      '">' +
      (code ? '<span class="cm-std-code" style="--chip:' + sec.color + '">' + esc(code) + '</span>' : '') +
      '<span class="cm-std-label">' +
      esc(title) +
      '</span>' +
      (icans ? '<span class="cm-std-count">' + icans + ' I Can</span>' : '') +
      '</label>'
    );
  }

  function _cmCompTitle(sec) {
    var tag = (sec && sec.tags && sec.tags[0]) || {};
    return tag.label || sec.shortName || sec.name || '';
  }

  // "A", "A and B", "A, B and C"; past three, a count.
  function _cmJoinNames(names, noun) {
    if (names.length > 3) return names.length + ' ' + noun;
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function cmCompSelectStart() {
    cmCompSelect = true;
    cmCompSelected = {};
    renderClassManager();
  }

  function cmCompSelectDone() {
    cmCompSelect = false;
    cmCompSelected = {};
    renderClassManager();
  }

  function cmCompSelectAll() {
    (getLearningMap(cmSelectedCourse).sections || []).forEach(function (s) {
      cmCompSelected[s.id] = true;
    });
    _cmRenderAndFocus('[data-action="cmCompSelectAll"]');
  }

  function cmCompToggle(secId, on) {
    if (on) cmCompSelected[secId] = true;
    else delete cmCompSelected[secId];
    _cmRenderAndFocus('[data-action-change="cmCompToggle"][data-secid=' + _cmAttr(secId) + ']');
  }

  function _cmCompSelectedSections() {
    return (getLearningMap(cmSelectedCourse).sections || []).filter(function (s) {
      return cmCompSelected[s.id];
    });
  }

  function cmCompMove(groupId) {
    var cid = cmSelectedCourse;
    if (!cid) return;
    groupId = groupId ? _currentId('group', groupId) : '';
    var ids = {};
    _cmCompSelectedSections().forEach(function (s) {
      ids[s.id] = true;
    });
    var map = ensureCustomLearningMap(cid);
    (map.sections || []).forEach(function (sec) {
      if (!ids[sec.id]) return;
      if (groupId) sec.groupId = groupId;
      else delete sec.groupId;
    });
    saveLearningMap(cid, map);
    _cmRenderWithScroll();
  }

  function cmCompRemoveSelected() {
    var secs = _cmCompSelectedSections();
    if (!secs.length) return;
    var names = secs.map(_cmCompTitle);
    showConfirm(
      secs.length === 1 ? 'Remove 1 Competency' : 'Remove ' + secs.length + ' Competencies',
      _cmRemoveMessage(
        cmSelectedCourse,
        secs.map(function (s) {
          return s.id;
        }),
        'Remove ' + _cmJoinNames(names, 'competencies') + ' from the class?',
      ),
      'Remove',
      'danger',
      function () {
        removeCompetencies(
          cmSelectedCourse,
          secs.map(function (s) {
            return _currentId('section', s.id);
          }),
        );
        cmCompSelected = {};
        if (!(getLearningMap(cmSelectedCourse).sections || []).length) cmCompSelect = false;
        renderClassManager();
      },
    );
  }

  function _cmCsvCell(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  /* Rows of a CSV file. Quoted cells may hold commas, quotes ("") and line
     breaks. */
  function _cmParseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    text = String(text || '').replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (c) {
        return String(c).trim();
      });
    });
  }

  function _cmSplitIcans(v) {
    return String(v || '')
      .split(/\r?\n/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
  }

  function cmCompExport() {
    var cid = cmSelectedCourse;
    if (!cid) return;
    var lm = getLearningMap(cid);
    var groups = {};
    (lm.competencyGroups || []).forEach(function (g) {
      groups[g.id] = g.name;
    });
    var rows = [CM_COMP_CSV_HEADER].concat(
      (lm.sections || []).map(function (sec) {
        var tag = sec.tags[0] || {};
        return [
          _cmStdCode(tag),
          _cmCompTitle(sec),
          tag.text || '',
          (tag.i_can_statements || []).join('\n'),
          (sec.groupId && groups[sec.groupId]) || '',
        ];
      }),
    );
    var csv = rows
      .map(function (r) {
        return r.map(_cmCsvCell).join(',');
      })
      .join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = ((COURSES[cid] && COURSES[cid].name) || 'class').replace(/[^\w-]+/g, '_') + '_competencies.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function cmCompImport() {
    var el = document.getElementById('cm-comp-csv-input');
    if (el) el.click();
  }

  /* A CSV's rows as competencies to review. Columns are found by their
     headers (the export's); a file without them is read in the export's
     order. */
  function cmCompRowsFromCsv(text) {
    var rows = _cmParseCsv(text);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) {
      return String(h).trim().toLowerCase();
    });
    function col(test) {
      return head.findIndex(test);
    }
    var at = {
      code: col(function (h) {
        return h === 'code';
      }),
      title: col(function (h) {
        return h === 'title' || h === 'name';
      }),
      text: col(function (h) {
        return h.indexOf('competency') >= 0 || h === 'wording';
      }),
      icans: col(function (h) {
        return h.indexOf('i can') >= 0;
      }),
      folder: col(function (h) {
        return h === 'folder' || h === 'group';
      }),
    };
    var hasHeader = at.title >= 0 || at.text >= 0;
    if (!hasHeader) at = { code: 0, title: 1, text: 2, icans: 3, folder: 4 };
    return rows
      .slice(hasHeader ? 1 : 0)
      .map(function (r) {
        function get(k) {
          return at[k] >= 0 ? String(r[at[k]] == null ? '' : r[at[k]]).trim() : '';
        }
        return {
          code: get('code'),
          label: get('title'),
          text: get('text'),
          icans: _cmSplitIcans(at.icans >= 0 ? r[at.icans] : ''),
          folder: get('folder'),
        };
      })
      .filter(function (c) {
        return c.label || c.text;
      });
  }

  function cmCompCSV(input) {
    var file = input.files && input.files[0];
    if (!file || !cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var reader = new FileReader();
    reader.onload = function (e) {
      input.value = '';
      var cands = cmCompRowsFromCsv(e.target.result);
      if (!cands.length) {
        showConfirm(
          'Nothing to Import',
          'No competencies were found in ' + file.name + '. The file needs a Title or Curricular Competency column.',
          'OK',
          'primary',
          function () {},
        );
        return;
      }
      _cmOpenCompReview(cid, cands, { kind: 'file', fileName: file.name });
    };
    reader.readAsText(file);
  }

  /* ── Review: Re-link and CSV import ─────────────────────────
     Each incoming competency is matched to the class by curriculum wording,
     then code, then title. Matched and identical: stays. Matched and
     different: the teacher picks Keep Mine (the default) or the incoming
     version. Not in the class: added, or put back with its scores if the
     teacher removed it earlier. In the class but not incoming: kept unless
     the teacher picks Remove (scores kept either way). */
  function _cmNorm(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Wording compared without its closing full stop or curly quotes.
  function _cmLoose(s) {
    return _cmNorm(s)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[.\s]+$/, '');
  }

  function _cmSameList(a, b) {
    a = (a || []).map(_cmNorm);
    b = (b || []).map(_cmNorm);
    return (
      a.length === b.length &&
      a.every(function (x, i) {
        return x === b[i];
      })
    );
  }

  function _cmScoredAssessments(cid, tagId) {
    var seen = {};
    var scores = getScores(cid) || {};
    Object.keys(scores).forEach(function (sid) {
      (scores[sid] || []).forEach(function (s) {
        if (s && s.tagId === tagId && s.score > 0) seen[s.assessmentId] = true;
      });
    });
    return Object.keys(seen).length;
  }

  function _cmScoresNote(cid, tag) {
    var n = tag ? _cmScoredAssessments(cid, tag.id) : 0;
    return n ? 'Has scores in ' + n + (n === 1 ? ' assessment.' : ' assessments.') : 'No scores yet.';
  }

  function _cmIcanNote(n) {
    return n + (n === 1 ? ' I Can statement' : ' I Can statements');
  }

  // Pair incoming competencies with sections, one pass per key so a
  // wording match is never taken by an earlier code or title match.
  function _cmMatch(cands, secs, keys, start) {
    var pairs = start ? start.pairs : {};
    var used = start ? start.used : {};
    keys.forEach(function (key) {
      cands.forEach(function (c, ci) {
        if (pairs[ci] != null) return;
        var want = key.cand(c);
        if (!want) return;
        var si = secs.findIndex(function (s, i) {
          if (used[i]) return false;
          return key.sec(s).indexOf(want) >= 0;
        });
        if (si >= 0) {
          pairs[ci] = si;
          used[si] = true;
        }
      });
    });
    return { pairs: pairs, used: used };
  }

  var CM_MATCH_KEYS = [
    // The bank's own id: a class built from the rebuilt bank.
    {
      cand: function (c) {
        return c.bank_id || '';
      },
      sec: function (s) {
        var t = s.tags[0] || {};
        return t.bank_id ? [t.bank_id] : [];
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.source_text || c.text);
      },
      sec: function (s) {
        var t = s.tags[0] || {};
        return [_cmNorm(t.source_text), _cmNorm(t.text)].filter(Boolean);
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.code);
      },
      sec: function (s) {
        var code = _cmNorm(_cmStdCode(s.tags[0] || {}));
        return code ? [code] : [];
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.label);
      },
      sec: function (s) {
        var t = _cmNorm(_cmCompTitle(s));
        return t ? [t] : [];
      },
    },
  ];

  function _cmBuildCompReview(cid, cands, opts) {
    var secs = (getLearningMap(cid).sections || []).filter(function (s) {
      return s.tags && s.tags[0];
    });
    var removed = getRemovedSections(cid).filter(function (r) {
      return r && r.section && r.section.tags && r.section.tags[0];
    });
    // Bank ids first; then, for an older class, the crosswalk from the old
    // bank (its competencies match their old wording there, and the
    // curriculum's version is a replacement, not the teacher's edit); then
    // wording, code and title.
    var live = _cmMatch(cands, secs, CM_MATCH_KEYS.slice(0, 1));
    var crosswalk =
      opts.kind === 'curriculum' ? _cmCrosswalkPairs(cid, secs, live, cands, opts.tags || []) : { by: {}, exact: {} };
    var replacedBy = crosswalk.by;
    Object.keys(crosswalk.match).forEach(function (si) {
      live.used[si] = true;
      live.pairs[crosswalk.match[si]] = Number(si);
    });
    var takenCand = {};
    Object.keys(replacedBy).forEach(function (si) {
      live.used[si] = true;
      replacedBy[si].forEach(function (ci) {
        takenCand[ci] = true;
        live.pairs[ci] = -1;
      });
    });
    _cmMatch(cands, secs, CM_MATCH_KEYS.slice(1), live);
    var rest = [];
    cands.forEach(function (c, ci) {
      if (live.pairs[ci] == null) rest.push(ci);
    });
    var back = _cmMatch(
      rest.map(function (ci) {
        return cands[ci];
      }),
      removed.map(function (r) {
        return r.section;
      }),
      CM_MATCH_KEYS,
    );
    var review = {
      cid: cid,
      kind: opts.kind,
      fileName: opts.fileName || '',
      tags: opts.tags || [],
      add: [],
      changed: [],
      replaced: [],
      fill: [],
      onlyMine: [],
      same: [],
      showSame: false,
    };
    // A class built from the rebuilt bank left out what it doesn't have on
    // purpose, so new competencies start unticked there.
    var builtFromBank = secs.some(function (s) {
      return s.tags[0].bank_id;
    });
    cands.forEach(function (c, ci) {
      if (takenCand[ci]) return;
      var si = live.pairs[ci];
      if (si == null) {
        var ri = back.pairs[rest.indexOf(ci)];
        var removedSec = ri != null ? removed[ri].section : null;
        review.add.push({ cand: c, removed: removedSec, on: !!removedSec || !builtFromBank });
        return;
      }
      var sec = secs[si];
      var tag = sec.tags[0];
      var sameNameAndWording =
        _cmNorm(_cmCompTitle(sec)) === _cmNorm(c.label) &&
        // A competency with no wording yet differs only if the rest does.
        (!_cmNorm(tag.text) || _cmNorm(tag.text) === _cmNorm(c.text));
      // An older class's competency whose wording the Ministry kept already
      // matches, whatever name the old bank gave it.
      if (crosswalk.exact[si] && _cmLoose(tag.text) === _cmLoose(c.text)) sameNameAndWording = true;
      if (
        sameNameAndWording &&
        (crosswalk.exact[si] || _cmSameList(tag.i_can_statements, c.icans)) &&
        (tag.i_can_statements || []).length
      )
        review.same.push({ sec: sec });
      else if (sameNameAndWording && _cmSameList(tag.i_can_statements, c.icans)) review.same.push({ sec: sec });
      // No I Can statements yet, and the curriculum has some: an update.
      else if (sameNameAndWording && !(tag.i_can_statements || []).length && c.icans.length)
        review.fill.push({ sec: sec, cand: c });
      else review.changed.push({ sec: sec, cand: c, pick: 'mine' });
    });
    secs.forEach(function (sec, i) {
      if (replacedBy[i])
        // An older class's competency and the curriculum's replacement.
        review.replaced.push({
          sec: sec,
          cands: replacedBy[i].map(function (ci) {
            return cands[ci];
          }),
          pick: 'mine',
        });
      else if (!live.used[i]) review.onlyMine.push({ sec: sec, pick: 'keep' });
    });
    return review;
  }

  /* The crosswalk from the old bank (curriculum_crosswalk.json), loaded
     with the curriculum for Re-link. */
  var _cmCrosswalk = null;
  function _cmLoadCrosswalk() {
    if (window._CURRICULUM_CROSSWALK) return Promise.resolve((_cmCrosswalk = window._CURRICULUM_CROSSWALK));
    if (_cmCrosswalk) return Promise.resolve(_cmCrosswalk);
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch('/curriculum_crosswalk.json')
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        _cmCrosswalk = data;
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  /* For each class competency no match took, the incoming competencies the
     crosswalk says replace it: by section index, a list of candidate
     indexes in the crosswalk's order. Matched by the old wording, else by
     the old code when only one old competency and only one of the class's
     has it. An old competency whose wording the Ministry kept (an "exact"
     row) isn't a replacement: the wording match takes it, and it's listed
     in exact so the review treats it as already matching. */
  function _cmCrosswalkPairs(cid, secs, live, cands, tags) {
    var cw = window._CURRICULUM_CROSSWALK || _cmCrosswalk;
    var out = { by: {}, exact: {}, match: {} };
    if (!cw || !cw.pairs) return out;
    var olds = ((COURSES[cid] && COURSES[cid].curriculumTags) || []).concat(tags);
    var rows = [];
    olds.forEach(function (k) {
      if (cw.pairs[k] && rows.indexOf(cw.pairs[k]) < 0) rows.push(cw.pairs[k]);
    });
    if (!rows.length) return out;
    rows = [].concat.apply([], rows);
    var freeCand = {};
    cands.forEach(function (c, ci) {
      if (live.pairs[ci] == null && c.bank_id) freeCand[c.bank_id] = ci;
    });
    function wordsOf(sec) {
      var tag = sec.tags[0];
      return [_cmNorm(tag.source_text), _cmNorm(tag.text)].filter(Boolean);
    }
    function codeOf(sec) {
      return _cmNorm(_cmStdCode(sec.tags[0]));
    }
    var byWording = secs.map(function (sec) {
      var words = wordsOf(sec);
      return (
        rows.find(function (r) {
          return words.indexOf(_cmNorm(r.raw)) >= 0;
        }) || null
      );
    });
    var codeCount = {};
    secs.forEach(function (sec) {
      var code = codeOf(sec);
      if (code) codeCount[code] = (codeCount[code] || 0) + 1;
    });
    secs.forEach(function (sec, si) {
      if (live.used[si]) return;
      var row = byWording[si];
      if (!row) {
        var code = codeOf(sec);
        var byCode = rows.filter(function (r) {
          return code && _cmNorm(r.code) === code;
        });
        if (byCode.length === 1 && codeCount[code] === 1 && byWording.indexOf(byCode[0]) < 0) row = byCode[0];
      }
      if (!row) return;
      var words = wordsOf(sec);
      var got = row.to
        .map(function (id) {
          return freeCand[id];
        })
        .filter(function (ci) {
          return ci != null;
        });
      if (!got.length) return;
      // The Ministry kept the wording: the same competency, matched here so
      // a trailing full stop can't split them.
      var same = got.find(function (ci) {
        return words.some(function (w) {
          return _cmLoose(w) === _cmLoose(cands[ci].text);
        });
      });
      if (same != null && (row.kind === 'exact' || row.to.length === 1)) {
        out.exact[si] = true;
        out.match[si] = same;
        delete freeCand[cands[same].bank_id];
        return;
      }
      got.forEach(function (ci) {
        delete freeCand[cands[ci].bank_id];
      });
      out.by[si] = got;
    });
    return out;
  }

  /* Open the review. A signed-in teacher's removed competencies come from
     the server too, so one removed on another device is offered back. */
  function _cmOpenCompReview(cid, cands, opts) {
    cmCompReview = _cmBuildCompReview(cid, cands, opts);
    cmCompReview.cands = cands;
    cmCompReview.opts = opts;
    renderClassManager();
    var opened = cmCompReview;
    if (window.v2 && typeof window.v2.listRemovedSections === 'function') {
      Promise.resolve(window.v2.listRemovedSections(cid))
        .then(function (res) {
          if (!res || !Array.isArray(res.data) || !res.data.length) return;
          var before = getRemovedSections(cid).length;
          mergeRemovedSectionsFromServer(cid, res.data);
          if (cmCompReview !== opened || getRemovedSections(cid).length === before) return;
          cmCompReview = _cmBuildCompReview(cid, cands, opts);
          cmCompReview.cands = cands;
          cmCompReview.opts = opts;
          renderClassManager();
        })
        .catch(function () {});
    }
  }

  function _cmCurriculumCands(tags) {
    var built = buildLearningMapFromTags(tags) || { subjects: [], sections: [] };
    return (built.sections || []).map(function (sec) {
      var tag = sec.tags[0] || {};
      var group = (built.competencyGroups || []).find(function (g) {
        return g.id === sec.groupId;
      });
      return {
        code: tag.code || '',
        label: tag.label || '',
        text: tag.text || '',
        source_text: tag.source_text || '',
        icans: (tag.i_can_statements || []).slice(),
        bank_id: tag.bank_id || '',
        // Its Ministry folder, by name: the class's folder of that name
        // takes it.
        folder: group ? group.name : '',
        section: sec,
        subject: (built.subjects || []).find(function (s) {
          return s.id === sec.subject;
        }),
      };
    });
  }

  function _cmIcanDiffNote(mine, theirs) {
    var t = {};
    (theirs || []).forEach(function (s) {
      t[_cmNorm(s)] = true;
    });
    var m = {};
    (mine || []).forEach(function (s) {
      m[_cmNorm(s)] = true;
    });
    var added = (mine || []).filter(function (s) {
      return !t[_cmNorm(s)];
    }).length;
    var dropped = (theirs || []).filter(function (s) {
      return !m[_cmNorm(s)];
    }).length;
    var parts = [];
    if (added) parts.push('you added ' + added);
    if (dropped) parts.push('you removed ' + dropped);
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }

  function _cmRenderCompReview(cid) {
    var r = cmCompReview;
    if (!r) return '';
    var file = r.kind === 'file';
    var course = COURSES[cid];
    var linked = (r.tags || [])
      .map(function (t) {
        var c = CURRICULUM_INDEX ? CURRICULUM_INDEX[t] : null;
        return c ? c.course_name : t;
      })
      .join(', ');
    function chip(sec, code) {
      var color = (sec && sec.color) || (getLearningMap(cid).subjects || [{}])[0].color || 'var(--active)';
      return code ? '<span class="cm-std-code" style="--chip:' + color + '">' + esc(code) + '</span>' : '';
    }
    function group(title, items, body) {
      if (!items.length) return '';
      return (
        '<section class="cm-section cm-cr-group">' +
        '<div class="cm-import-group-head"><h3>' +
        title +
        '</h3><span>' +
        items.length +
        '</span></div>' +
        items.map(body).join('') +
        '</section>'
      );
    }
    var html =
      '<div class="cm-comp-review">' +
      '<button type="button" class="cm-back-link" data-action="cmCompReviewCancel">\u2039 Back to Competencies</button>' +
      '<div class="cm-cr-head">' +
      '<h1 class="cm-head-title">' +
      (file
        ? 'Import Competencies'
        : (course.curriculumTags || []).length
          ? 'Re-link Curriculum'
          : 'Link to BC Curriculum') +
      ': Review Changes</h1>' +
      '<div class="cm-cr-sub">' +
      esc(file ? r.fileName : linked) +
      '. Competencies are matched by code and curriculum wording, so nothing is added twice. Nothing changes until you press Apply.</div>' +
      '</div>';

    // An older class's competency and the curriculum's replacement for it.
    html += group('Replaced in the Curriculum', r.replaced, function (x, i) {
      var tag = x.sec.tags[0];
      var many = x.cands.length > 1;
      var note = !many ? 'Your scores stay with it.' : _cmReplacedNote(cid, x);
      function option(pick, label, inner) {
        return (
          '<label class="cm-cr-option' +
          (x.pick === pick ? ' on' : '') +
          '">' +
          '<input type="radio" name="cm-cr-replaced-' +
          i +
          '"' +
          (x.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="replaced" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          '<span class="cm-cr-text"><span class="cm-cr-pick">' +
          label +
          '</span>' +
          inner +
          '</span>' +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-changed">' +
        '<div class="cm-cr-changed-head">' +
        chip(x.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-note">' +
        _cmScoresNote(cid, tag) +
        (_cmScoredAssessments(cid, tag.id) ? ' Scores stay either way.' : '') +
        '</span></div>' +
        '<div class="cm-cr-options" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(x.sec)) +
        '">' +
        option(
          'mine',
          'Keep Mine',
          '<span class="cm-cr-name">' +
            esc(_cmCompTitle(x.sec)) +
            '</span>' +
            (tag.text ? '<span class="cm-cr-wording">' + esc(tag.text) + '</span>' : ''),
        ) +
        option(
          'theirs',
          many ? 'Add the Curriculum Version' : 'Use the Curriculum Version',
          '<span class="cm-cr-note">' +
            esc(note) +
            '</span><span class="cm-cr-repl-list">' +
            x.cands
              .map(function (c) {
                return (
                  '<span class="cm-cr-repl-item">' +
                  chip(x.sec, c.code) +
                  '<span class="cm-cr-text"><span class="cm-cr-name">' +
                  esc(c.label || c.text) +
                  '</span><span class="cm-cr-wording">' +
                  esc(c.text) +
                  '</span></span></span>'
                );
              })
              .join('') +
            '</span>',
        ) +
        '</div>' +
        '</div>'
      );
    });

    html += group(
      file ? 'In the File, Not in Your Class' : 'In the Curriculum, Not in Your Class',
      r.add,
      function (a, i) {
        var src = a.removed || a.cand.section || {};
        var code = a.removed ? _cmStdCode(a.removed.tags[0]) : a.cand.code;
        var n = a.removed ? (a.removed.tags[0].i_can_statements || []).length : a.cand.icans.length;
        return (
          '<label class="cm-cr-row">' +
          '<input type="checkbox"' +
          (a.on ? ' checked' : '') +
          ' data-action-change="cmCompReviewToggle" data-idx="' +
          i +
          '">' +
          chip(src, code) +
          '<span class="cm-cr-text"><span class="cm-cr-name">' +
          esc(a.removed ? _cmCompTitle(a.removed) : a.cand.label || a.cand.text) +
          '</span>' +
          (a.removed
            ? '<span class="cm-cr-note">You removed this from the class earlier. ' + _cmIcanNote(n) + '.</span>'
            : a.cand.text && a.cand.text !== a.cand.label
              ? '<span class="cm-cr-wording">' + esc(a.cand.text) + '</span>'
              : '<span class="cm-cr-note">' + _cmIcanNote(n) + '.</span>') +
          '</span>' +
          '<span class="cm-cr-verb">' +
          (a.removed ? 'Add Back' : 'Add') +
          '</span>' +
          '</label>'
        );
      },
    );

    html += group('You Changed These', r.changed, function (c, i) {
      var tag = c.sec.tags[0];
      var mineIcans = tag.i_can_statements || [];
      var wording =
        _cmNorm(tag.text) === _cmNorm(c.cand.text) ? '' : tag.text ? ' \u00B7 wording edited' : ' \u00B7 no wording';
      function option(pick, label, name, note) {
        return (
          '<label class="cm-cr-option' +
          (c.pick === pick ? ' on' : '') +
          '">' +
          '<input type="radio" name="cm-cr-changed-' +
          i +
          '"' +
          (c.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="changed" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          '<span class="cm-cr-text"><span class="cm-cr-pick">' +
          label +
          '</span><span class="cm-cr-name">' +
          esc(name) +
          '</span><span class="cm-cr-note">' +
          note +
          '</span></span>' +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-changed">' +
        '<div class="cm-cr-changed-head">' +
        chip(c.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-note">' +
        _cmScoresNote(cid, tag) +
        (_cmScoredAssessments(cid, tag.id) ? ' Scores stay either way.' : '') +
        '</span></div>' +
        '<div class="cm-cr-options" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(c.sec)) +
        '">' +
        option(
          'mine',
          'Keep Mine',
          _cmCompTitle(c.sec),
          _cmIcanNote(mineIcans.length) + _cmIcanDiffNote(mineIcans, c.cand.icans) + wording,
        ) +
        option(
          'theirs',
          file ? 'Use the File\u2019s Version' : 'Use the Curriculum Version',
          c.cand.label || c.cand.text,
          _cmIcanNote(c.cand.icans.length),
        ) +
        '</div>' +
        '</div>'
      );
    });

    html += group('Only in Your Class', r.onlyMine, function (o, i) {
      var tag = o.sec.tags[0];
      var why = file ? 'Not in the file.' : tag.source_text ? 'Not in this curriculum.' : 'One of your own.';
      function seg(pick, label) {
        return (
          '<label class="cm-cr-seg' +
          (o.pick === pick ? ' on' : '') +
          '"><input type="radio" name="cm-cr-only-' +
          i +
          '"' +
          (o.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="onlyMine" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          label +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-row">' +
        chip(o.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-text"><span class="cm-cr-name">' +
        esc(_cmCompTitle(o.sec)) +
        '</span><span class="cm-cr-note">' +
        why +
        ' ' +
        _cmScoresNote(cid, tag) +
        '</span></span>' +
        '<div class="cm-cr-segs" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(o.sec)) +
        '">' +
        seg('keep', 'Keep') +
        seg('remove', 'Remove') +
        '</div>' +
        '</div>'
      );
    });

    if (r.same.length) {
      var codes = r.same.map(function (s) {
        return _cmStdCode(s.sec.tags[0]) || _cmCompTitle(s.sec);
      });
      html +=
        '<section class="cm-section cm-cr-same">' +
        '<div class="cm-cr-same-head"><div class="cm-cr-text"><h3>' +
        (file ? 'Already Match the File' : 'Already Match the Curriculum') +
        ' <span>' +
        r.same.length +
        '</span></h3><span class="cm-cr-note">' +
        esc(
          codes.length > 8 ? codes.slice(0, 8).join(', ') + ' and ' + (codes.length - 8) + ' more' : codes.join(', '),
        ) +
        (codes.length === 1 ? ' stays as it is.' : ' stay as they are.') +
        '</span></div>' +
        '<button type="button" class="cm-add-link" data-action="cmCompReviewShowSame" aria-expanded="' +
        r.showSame +
        '">' +
        (r.showSame ? 'Hide' : 'Show') +
        '</button></div>' +
        (r.showSame
          ? '<div class="cm-cr-same-list">' +
            r.same
              .map(function (s) {
                return (
                  '<div class="cm-cr-same-row">' +
                  chip(s.sec, _cmStdCode(s.sec.tags[0])) +
                  '<span>' +
                  esc(_cmCompTitle(s.sec)) +
                  '</span></div>'
                );
              })
              .join('') +
            '</div>'
          : '') +
        '</section>';
    }

    var s = _cmCompReviewSummary(r);
    html +=
      '<div class="cm-import-foot">' +
      '<div>' +
      s +
      '</div>' +
      '<div class="cm-import-buttons">' +
      '<button type="button" class="cm-action-btn" data-action="cmCompReviewCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmCompReviewApply"' +
      (_cmCompReviewCount(r) === 0 && !_cmCompReviewLinkChanges(r) ? ' disabled' : '') +
      '>Apply Changes</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    return html;
  }

  function _cmCompReviewLinkChanges(r) {
    if (r.kind === 'file') return false;
    var now = (COURSES[r.cid] && COURSES[r.cid].curriculumTags) || [];
    return now.slice().sort().join('|') !== (r.tags || []).slice().sort().join('|');
  }

  function _cmCompReviewParts(r) {
    var file = r.kind === 'file';
    return {
      back: r.add.filter(function (a) {
        return a.on && a.removed;
      }),
      add: r.add.filter(function (a) {
        return a.on && !a.removed;
      }),
      theirs: r.changed.filter(function (c) {
        return c.pick === 'theirs';
      }),
      replaced: (r.replaced || []).filter(function (x) {
        return x.pick === 'theirs';
      }),
      fill: r.fill || [],
      remove: r.onlyMine.filter(function (o) {
        return o.pick === 'remove';
      }),
      versionOf: file ? 'use the file\u2019s version of ' : 'use the curriculum version of ',
    };
  }

  function _cmCompReviewCount(r) {
    var p = _cmCompReviewParts(r);
    return p.back.length + p.add.length + p.theirs.length + p.replaced.length + p.fill.length + p.remove.length;
  }

  function _cmCompReviewSummary(r) {
    var p = _cmCompReviewParts(r);
    var n = _cmCompReviewCount(r);
    if (!n) {
      return _cmCompReviewLinkChanges(r)
        ? '<strong>No competency changes.</strong> Apply saves the new curriculum link.'
        : '<strong>No changes.</strong>';
    }
    function names(list, fn) {
      return list.map(fn);
    }
    var phrases = [];
    if (p.back.length)
      phrases.push(
        'add back ' +
          _cmJoinNames(
            names(p.back, function (a) {
              return _cmCompTitle(a.removed);
            }),
            'competencies',
          ),
      );
    if (p.add.length)
      phrases.push(
        'add ' +
          _cmJoinNames(
            names(p.add, function (a) {
              return a.cand.label || a.cand.text;
            }),
            'competencies',
          ),
      );
    if (p.theirs.length)
      phrases.push(
        p.versionOf +
          _cmJoinNames(
            names(p.theirs, function (c) {
              return _cmCompTitle(c.sec);
            }),
            'competencies',
          ),
      );
    var replacedOne = p.replaced.filter(function (x) {
      return x.cands.length === 1;
    });
    var replacedMany = p.replaced.filter(function (x) {
      return x.cands.length > 1;
    });
    if (replacedOne.length)
      phrases.push(
        'use the curriculum version of ' +
          _cmJoinNames(
            names(replacedOne, function (x) {
              return _cmCompTitle(x.sec);
            }),
            'competencies',
          ),
      );
    if (replacedMany.length)
      phrases.push(
        'add the curriculum version of ' +
          _cmJoinNames(
            names(replacedMany, function (x) {
              return _cmCompTitle(x.sec) + ' (' + x.cands.length + ' competencies)';
            }),
            'competencies',
          ),
      );
    if (p.fill.length)
      phrases.push(
        'add I Can statements to ' +
          _cmJoinNames(
            names(p.fill, function (x) {
              return _cmCompTitle(x.sec);
            }),
            'competencies',
          ),
      );
    if (p.remove.length)
      phrases.push(
        'remove ' +
          _cmJoinNames(
            names(p.remove, function (o) {
              return _cmCompTitle(o.sec);
            }),
            'competencies',
          ),
      );
    var tail =
      p.theirs.length || p.replaced.length || p.remove.length
        ? ' Scores are kept.'
        : r.onlyMine.length
          ? ' Your edits and your own competencies stay.'
          : ' Your edits stay.';
    // Removing one moves grades, as the Remove confirm says.
    if (p.remove.length) {
      var moved = previewCompetencyRemoval(
        r.cid,
        p.remove.map(function (o) {
          return _currentId('section', o.sec.id);
        }),
      );
      if (moved.changed)
        tail += ' The removals change the grade for ' + moved.changed + ' of your ' + moved.total + ' students.';
    }
    return '<strong>' + n + (n === 1 ? ' change:' : ' changes:') + '</strong> ' + esc(phrases.join('; ')) + '.' + tail;
  }

  function cmCompReviewToggle(idx, on) {
    if (!cmCompReview || !cmCompReview.add[idx]) return;
    cmCompReview.add[idx].on = !!on;
    _cmRenderAndFocus('[data-action-change="cmCompReviewToggle"][data-idx=' + _cmAttr(idx) + ']');
  }

  function cmCompReviewPick(group, idx, pick) {
    var list = cmCompReview && cmCompReview[group];
    if (!list || !list[idx]) return;
    list[idx].pick = pick;
    _cmRenderAndFocus(
      '[data-action-change="cmCompReviewPick"][data-group=' +
        _cmAttr(group) +
        '][data-idx=' +
        _cmAttr(idx) +
        '][data-pick=' +
        _cmAttr(pick) +
        ']',
    );
  }

  function cmCompReviewShowSame() {
    if (!cmCompReview) return;
    cmCompReview.showSame = !cmCompReview.showSame;
    _cmRenderAndFocus('[data-action="cmCompReviewShowSame"]');
  }

  function _cmCloseCompReview() {
    cmCompReview = null;
    cmRelinkCid = null;
    cmRelinkStep = 0;
    cwSelectedTags = [];
  }

  function cmCompReviewCancel() {
    _cmCloseCompReview();
    cmTab = 'competencies';
    renderClassManager();
  }

  /* Apply the review. Changes to the learning map that would move any
     student's overall proficiency ask first, with the count, as the
     grading settings do. */
  function cmCompReviewApply(confirmed) {
    var r = cmCompReview;
    if (!r) return;
    var cid = r.cid;
    var p = _cmCompReviewParts(r);
    var touchesMap = p.add.length || p.theirs.length || p.replaced.length || p.fill.length;
    var removeIds = p.remove.map(function (o) {
      return _currentId('section', o.sec.id);
    });

    if ((touchesMap || p.back.length || p.remove.length) && confirmed !== true) {
      // The copy gets the whole Apply, in its order: put back, map edits, removals.
      var preview = previewLearningMapChange(cid, function (copy) {
        if (!copy.sections) copy.sections = [];
        p.back.forEach(function (a) {
          var id = a.removed.id;
          if (
            !copy.sections.some(function (s) {
              return s.id === id;
            })
          )
            copy.sections.push(structuredClone(a.removed));
        });
        if (touchesMap) _cmApplyReviewToMap(cid, copy, p);
        var drop = {};
        removeIds.forEach(function (id) {
          drop[resolveLearningMapId(cid, 'section', id)] = true;
        });
        copy.sections = copy.sections.filter(function (s) {
          return !drop[s.id];
        });
      });
      if (preview.changed) {
        showConfirm(
          'Change Grades?',
          _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
          'Apply Changes',
          'primary',
          function () {
            cmCompReviewApply(true);
          },
        );
        return;
      }
    }

    // Put removed competencies back first: each brings its scores with it.
    p.back.forEach(function (a) {
      restoreCompetency(cid, a.removed.id);
    });

    if (touchesMap) {
      var map = ensureCustomLearningMap(cid);
      _cmApplyReviewToMap(cid, map, p);
      saveLearningMap(cid, map);
    }

    if (p.remove.length) removeCompetencies(cid, removeIds);

    if (r.kind !== 'file' && _cmCompReviewLinkChanges(r)) updateCourse(cid, { curriculumTags: r.tags.slice() });

    _cmCloseCompReview();
    cmTab = 'competencies';
    renderClassManager();
  }

  /* The review's changes to a learning map: Replaced in the Curriculum
     first (it makes the Ministry folders), then the additions, the I Can
     fills and the curriculum versions. */
  function _cmApplyReviewToMap(cid, map, p) {
    if (!map.subjects) map.subjects = [];
    if (!map.sections) map.sections = [];
    if (!map.competencyGroups) map.competencyGroups = [];
    var taken = {};
    map.sections.forEach(function (s) {
      taken[s.id] = true;
    });
    getRemovedSections(cid).forEach(function (x) {
      if (x && x.section) taken[x.section.id] = true;
    });
    function freshId(base) {
      var id = base && !taken[base] ? base : (base ? base + '_' : '') + uid();
      taken[id] = true;
      return id;
    }
    function findSec(id) {
      return map.sections.find(function (s) {
        return s.id === _currentId('section', id);
      });
    }
    // The class's folder with a Ministry folder's name, made if missing.
    function folderFor(name, color) {
      if (!name) return null;
      var grp = _cmFolderNamed(map, name);
      if (!grp) {
        grp = {
          id: 'grp_' + uid(),
          name: name,
          color: color || '#6366f1',
          sortOrder: map.competencyGroups.length,
        };
        map.competencyGroups.push(grp);
      }
      return grp;
    }
    // A curriculum competency as a new row of this class.
    function addFromCurriculum(c, grp) {
      var add = structuredClone(c.section);
      add.id = freshId('');
      add.tags[0].id = add.id;
      var subjectId = _cmClassSubjectFor(map, c.subject);
      if (subjectId) add.subject = add.tags[0].subject = subjectId;
      delete add.groupId;
      if (grp) add.groupId = grp.id;
      map.sections.push(add);
    }

    // Replaced in the Curriculum. One for one: the competency takes the
    // curriculum's name, code, wording and course in place, keeping its
    // scores. One for several: each statement goes in its own Ministry
    // folder, and the competency moves, unchanged, into the folder most of
    // them go to.
    p.replaced.forEach(function (x) {
      var sec = findSec(x.sec.id);
      if (!sec || !sec.tags[0]) return;
      var tag = sec.tags[0];
      var lead = x.cands[0];
      var subjectId = _cmClassSubjectFor(map, lead.subject);
      if (subjectId && sec.subject !== subjectId) {
        sec.subject = tag.subject = subjectId;
        sec.color = tag.color = lead.section.color;
      }
      if (x.cands.length === 1) {
        tag.label = lead.label;
        tag.code = lead.code;
        tag.text = lead.text;
        tag.source_text = lead.source_text;
        tag.i_can_statements = lead.icans.slice();
        tag.bank_id = lead.bank_id || null;
        sec.name = tag.name = lead.label;
        sec.shortName = tag.shortName = lead.section.shortName;
        return;
      }
      var home = _cmReplacedHome(x);
      if (home) sec.groupId = folderFor(home, sec.color).id;
      x.cands.forEach(function (c) {
        addFromCurriculum(c, folderFor(c.folder, c.section.color));
      });
    });

    p.add.forEach(function (a) {
      var c = a.cand;
      if (c.section) {
        // From the curriculum: the class's folder with its Ministry
        // folder's name takes it.
        addFromCurriculum(c, c.folder ? _cmFolderNamed(map, c.folder) : null);
        return;
      }
      if (!map.subjects.length) map.subjects.push({ id: 'subj1', name: 'General', color: '#6366f1' });
      var sub = map.subjects[0];
      var id = freshId('');
      var label = c.label || c.text.slice(0, 40);
      var short = label.split(' ')[0];
      var sec = {
        id: id,
        subject: sub.id,
        name: label,
        shortName: short,
        color: sub.color,
        tags: [
          {
            id: id,
            code: c.code || undefined,
            label: label,
            text: c.text,
            i_can_statements: c.icans.slice(),
            color: sub.color,
            subject: sub.id,
            name: label,
            shortName: short,
          },
        ],
      };
      if (!sec.tags[0].code) delete sec.tags[0].code;
      if (c.folder) sec.groupId = folderFor(c.folder, '#6366f1').id;
      map.sections.push(sec);
    });

    // No I Can statements yet: the curriculum's.
    p.fill.forEach(function (x) {
      var sec = findSec(x.sec.id);
      if (sec && sec.tags[0] && !(sec.tags[0].i_can_statements || []).length)
        sec.tags[0].i_can_statements = x.cand.icans.slice();
    });

    p.theirs.forEach(function (ch) {
      var sec = findSec(ch.sec.id);
      if (!sec || !sec.tags[0]) return;
      var tag = sec.tags[0];
      if (ch.cand.label) tag.label = ch.cand.label;
      tag.text = ch.cand.text;
      tag.i_can_statements = ch.cand.icans.slice();
      if (ch.cand.source_text) tag.source_text = ch.cand.source_text;
    });
    map._flatVersion = 2;
  }

  /* The class's course for a curriculum candidate's: the one with its id
     or its name, else a new one with a fresh id. */
  function _cmClassSubjectFor(map, subject) {
    if (!subject) return null;
    var own = (map.subjects || []).find(function (s) {
      return s.id === subject.id || _cmNorm(s.name) === _cmNorm(subject.name);
    });
    if (own) return own.id;
    var add = structuredClone(subject);
    add.id = uid();
    map.subjects.push(add);
    return add.id;
  }

  /* Where Add the Curriculum Version puts things, in words: each Ministry
     folder the statements go to, and where the old competency goes. */
  function _cmReplacedNote(cid, x) {
    var map = getLearningMap(cid);
    var folders = [];
    x.cands.forEach(function (c) {
      if (c.folder && folders.indexOf(c.folder) < 0) folders.push(c.folder);
    });
    var where = folders.map(function (name) {
      return _cmFolderNamed(map, name) ? 'your ' + name + ' folder' : 'a new folder, ' + name;
    });
    var home = _cmReplacedHome(x);
    return (
      'Adds these ' +
      x.cands.length +
      (where.length ? ' in ' + where.join(' and ') : '') +
      '. Your ' +
      (_cmStdCode(x.sec.tags[0]) || _cmCompTitle(x.sec)) +
      (home
        ? (where.length === 1 ? ' moves into the same folder' : ' moves into the ' + home + ' folder') +
          ' and keeps its scores.'
        : ' keeps its scores.') +
      ' Nothing is renamed.'
    );
  }

  // The Ministry folder most of a merged line's statements go to.
  function _cmReplacedHome(x) {
    var count = {};
    var best = '';
    x.cands.forEach(function (c) {
      if (!c.folder) return;
      count[c.folder] = (count[c.folder] || 0) + 1;
      if (!best || count[c.folder] > count[best]) best = c.folder;
    });
    return best;
  }

  function _cmFolderNamed(map, name) {
    return (map.competencyGroups || []).find(function (g) {
      return _cmNorm(g.name) === _cmNorm(name);
    });
  }

  /* The Remove confirm: what it does to grades, then that the scores are
     kept for putting it back. */
  function _cmRemoveMessage(cid, secIds, lead) {
    var preview = previewCompetencyRemoval(cid, secIds);
    var moves = preview.changed
      ? ' This changes the grade for ' +
        preview.changed +
        ' of your ' +
        preview.total +
        ' students' +
        (preview.example
          ? '. For example, ' +
            preview.example.name +
            ' goes from ' +
            preview.example.before +
            ' to ' +
            preview.example.after +
            '.'
          : '.') +
        ' Marks you\u2019ve already copied into MyEd won\u2019t change there.'
      : '';
    return (
      lead +
      moves +
      (secIds.length === 1
        ? ' Its scores are kept, so Re-link can put it back.'
        : ' Their scores are kept, so Re-link can put them back.')
    );
  }

  function cmDeleteStd(secId) {
    var current = _currentId('section', secId);
    showConfirm(
      'Remove Competency',
      _cmRemoveMessage(cmSelectedCourse, [current], 'Remove this competency from the class?'),
      'Remove',
      'danger',
      function () {
        // Resolved now: the id may have been re-keyed while the dialog was open.
        removeCompetencies(cmSelectedCourse, [_currentId('section', secId)]);
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

  /* Typing a title renames the card header as you go; blur saves it. */
  function cmStdLabelLive(secId, val) {
    var card = document.getElementById('cm-std-' + secId);
    if (!card) return;
    var label = card.querySelector('.cm-std-label');
    if (!label) return;
    var title = val.trim() || label.dataset.fallback || '';
    label.textContent = title;
    var menuBtn = card.querySelector('.cm-std-icon-btn');
    if (menuBtn) menuBtn.setAttribute('aria-label', 'More actions for ' + title);
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

  /* The card's own competency, from a fresh copy of the map. */
  function _cmStdEntry(secId) {
    if (!cmSelectedCourse) return null;
    secId = _currentId('section', secId);
    var map = ensureCustomLearningMap(cmSelectedCourse);
    var sec = (map.sections || []).find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return null;
    return { map: map, sec: sec, tag: sec.tags[0] };
  }

  function _cmStdSave(entry, focusSel) {
    saveLearningMap(cmSelectedCourse, entry.map);
    renderClassManager();
    if (!focusSel) return;
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + entry.sec.id + ' ' + focusSel);
      if (el) el.focus();
    });
  }

  /* The card's Levels (Nov 2 mockup, batch 2): each level's descriptor and
     next step, read-only, by the printed rubric's rule (CompetencyWording:
     the teacher's own, else the bank's, else the BC general wording). Write
     Your Own opens the four levels for the teacher's own wording, saved to
     the descriptor bank printed rubrics read; a level left empty keeps the
     other wording. */
  function _cmLevelsHtml(sec, tag) {
    if (!tag || !tag.id || !window.CompetencyWording || !window.RubricPrint) return '';
    var levels = [1, 2, 3, 4];
    var lines = levels.map(function (l) {
      var x = CompetencyWording.lines(tag, l);
      // The BC general wording reads in full here, "The student
      // demonstrates …", as the printed Tag Rubric has it.
      var raw = CompetencyWording.levelWording(tag, l).text;
      if (x && raw === CompetencyWording.GENERAL[l]) x.descriptor = raw;
      return x;
    });
    if (lines[0] && !lines[0].ready && !_cmLevelsBankAsked && RubricPrint.loadBankLevels) {
      _cmLevelsBankAsked = true;
      // Only the Competencies tab shows the Levels: on another tab the
      // next draw picks them up, so opening Class Settings draws it once.
      RubricPrint.loadBankLevels().then(function (ok) {
        if (ok && classManagerOpen && cmMode === 'edit' && cmTab === 'competencies') renderClassManager();
      });
    }
    // The open form: { drafts: { level: text }, base: { level: text the field was filled with } }.
    var editing = _cmLevelsEdit[sec.id] || null;
    var own = (typeof RubricDraft !== 'undefined' && getCompetencyDescriptor(RubricDraft.competencyKey(tag))) || {};
    var head =
      '<div class="cm-std-section-head"><span class="cm-label cm-std-section-label" id="cm-std-levels-label-' +
      sec.id +
      '">Levels</span>' +
      (editing
        ? ''
        : '<button type="button" class="cm-std-link" data-action="cmLevelsEdit" data-secid="' +
          sec.id +
          '">Write Your Own</button>') +
      '</div>';
    var body = editing
      ? '<div class="cm-levels-edit">' +
        levels
          .map(function (l, i) {
            if (!(l in editing.base)) editing.base[l] = own[l] || lines[i].descriptor;
            var val = l in editing.drafts ? editing.drafts[l] : editing.base[l];
            return (
              '<label class="cm-levels-edit-row"><span class="cm-levels-word">' +
              esc(lines[i].word) +
              '</span><textarea class="cm-textarea cm-levels-input" rows="2" data-level="' +
              l +
              '" data-secid="' +
              sec.id +
              '" data-stop-prop="true" data-action-input="cmLevelsDraft">' +
              esc(val) +
              '</textarea></label>'
            );
          })
          .join('') +
        '<p class="cm-levels-hint">Leave a level empty to use the curriculum wording.</p>' +
        '<div class="cm-levels-actions"><button type="button" class="btn btn-ghost" data-action="cmLevelsCancel" data-secid="' +
        sec.id +
        '">Cancel</button><button type="button" class="btn btn-primary" data-action="cmLevelsSave" data-secid="' +
        sec.id +
        '">Save</button></div></div>'
      : '<div class="cm-levels-list">' +
        lines
          .map(function (x) {
            return (
              '<div class="cm-level-row"><span class="cm-levels-word">' +
              esc(x.word) +
              '</span><span class="cm-level-desc">' +
              esc(x.descriptor) +
              (x.next ? '<span class="cm-level-next">Next step: ' + esc(x.next) + '</span>' : '') +
              '</span></div>'
            );
          })
          .join('') +
        '</div>';
    return '<div class="cm-std-levels" aria-labelledby="cm-std-levels-label-' + sec.id + '">' + head + body + '</div>';
  }

  function cmLevelsEdit(secId) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    _cmLevelsEdit[entry.sec.id] = { drafts: {}, base: {} };
    renderClassManager();
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + entry.sec.id + ' .cm-levels-input');
      if (el) el.focus();
    });
  }
  function cmLevelsCancel(secId) {
    delete _cmLevelsEdit[_currentId('section', secId)];
    delete _cmLevelsEdit[secId];
    renderClassManager();
  }
  // What the teacher types is kept as they type, so a redraw of the card
  // (another field's save) keeps it.
  function cmLevelsDraft(secId, level, val) {
    var form = _cmLevelsEdit[secId] || _cmLevelsEdit[_currentId('section', secId)];
    if (form) form.drafts[level] = val;
  }
  /* Saves each level the teacher changed: its text as their own, or, emptied,
     back to the curriculum wording. A level left as it was filled is not
     saved, so wording shown before the bank loaded never becomes their own. */
  function cmLevelsSave(secId) {
    var entry = _cmStdEntry(secId);
    var form = entry && _cmLevelsEdit[entry.sec.id];
    if (!form || typeof RubricDraft === 'undefined') return;
    var key = RubricDraft.competencyKey(entry.tag);
    var entries = [];
    Object.keys(form.drafts).forEach(function (l) {
      var level = Number(l);
      var text = String(form.drafts[l] || '').trim();
      if (text === String(form.base[l] || '').trim()) return;
      var base = RubricPrint.levelWording(entry.tag, level, true).text;
      var baseLine = window.CompetencyWording ? CompetencyWording.sentence(base) : base;
      if (text === baseLine || text === base) text = '';
      entries.push({ key: key, level: level, text: text });
    });
    if (key) saveCompetencyDescriptors(entries);
    delete _cmLevelsEdit[entry.sec.id];
    renderClassManager();
  }

  function cmStdEditWording(secId) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    _cmWordingEdit[entry.sec.id] = true;
    renderClassManager();
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + entry.sec.id + ' .cm-std-wording-input');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  function cmStdFinishWording(secId, val) {
    cmUpdateStdText(secId, val);
    delete _cmWordingEdit[_currentId('section', secId)];
    delete _cmWordingEdit[secId];
    renderClassManager();
  }

  function cmStdRestoreWording(secId) {
    var entry = _cmStdEntry(secId);
    if (!entry || !entry.tag.source_text) return;
    entry.tag.text = entry.tag.source_text;
    delete _cmWordingEdit[entry.sec.id];
    _cmStdSave(entry);
  }

  function cmStdToggleMenu(btn) {
    var menu = btn.parentElement.querySelector('.cm-std-menu');
    if (!menu) return;
    var open = menu.hidden;
    _cmCloseStdMenus();
    if (open) {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      _cmFloatOverScroll(menu, btn);
      var first =
        menu.querySelector('.cm-std-menu-item[aria-checked="true"]') || menu.querySelector('.cm-std-menu-item');
      if (first) first.focus();
    }
  }

  function _cmCloseStdMenus() {
    var any = false;
    document.querySelectorAll('.cm-std-menu:not([hidden])').forEach(function (m) {
      m.hidden = true;
      var btn = m.parentElement.querySelector('[aria-haspopup="menu"]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      any = true;
    });
    return any;
  }

  function cmIcanAdd(secId, val) {
    var text = String(val || '').trim();
    if (!text) return;
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    entry.tag.i_can_statements = (entry.tag.i_can_statements || []).concat([text]);
    _cmStdSave(entry, '.cm-ican-new');
  }

  function cmIcanEdit(secId, idx, val) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    var list = (entry.tag.i_can_statements || []).slice();
    if (idx < 0 || idx >= list.length) return;
    var text = String(val || '').trim();
    if (text === list[idx]) return;
    if (text) list[idx] = text;
    else list.splice(idx, 1);
    entry.tag.i_can_statements = list;
    _cmStdSave(entry);
  }

  function cmIcanDelete(secId, idx) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    var list = (entry.tag.i_can_statements || []).slice();
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    entry.tag.i_can_statements = list;
    _cmStdSave(entry);
  }

  function cmIcanMove(secId, from, to) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    var list = (entry.tag.i_can_statements || []).slice();
    if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return;
    var moved = list.splice(from, 1)[0];
    list.splice(to, 0, moved);
    entry.tag.i_can_statements = list;
    _cmStdSave(entry);
  }

  // Updates the user-facing tag.code (e.g. "RD1", "ENG10A") for a standard.
  // Pre-V2 this used to rename the section/tag local IDs, fanning out updates
  // to assessment.tagIds and score.tagId references; post-V2 those IDs are
  // server-owned UUIDs that the database authoritatively holds, and the
  // user-visible code is its own column. This implementation just updates
  // tag.code locally; saveLearningMap sends the changed tag.
  function _cmCleanCode(val) {
    return val
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9._\-]/g, '')
      .slice(0, 6);
  }

  /* Typing a code updates the header chip as you go; blur saves it. A blank
     box shows the saved code, since saving ignores a blank code. */
  function cmStdCodeLive(secId, val) {
    var card = document.getElementById('cm-std-' + secId);
    var chip = card && card.querySelector('.cm-std-code');
    if (!chip) return;
    var code = _cmCleanCode(val) || chip.dataset.fallback || '';
    chip.textContent = code;
    chip.hidden = !code;
  }

  function cmUpdateStdCode(secId, val) {
    secId = _currentId('section', secId);
    if (!cmSelectedCourse) return;
    var newCode = _cmCleanCode(val);
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
    _cmKeepFocusSel = null;
    // Any click other than on a card's More button closes its open menu.
    if (action !== 'cmStdMenu') _cmCloseStdMenus();
    if (action !== 'cmRosterDesigOpen') _cmCloseRosterPicker();
    if (/^sq[A-Z]/.test(action) && typeof CmQuestionnaires !== 'undefined')
      return CmQuestionnaires.handleAction(action, el);
    if (/^sp[A-Z]/.test(action) && _cmTabShown('student-page', cmSelectedCourse))
      return CmStudentPage.handleAction(action, el);
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
      cmOpenDemoMode: function () {
        cmOpenDemoMode();
      },
      cmCancelCreate: function () {
        cmCancelCreate();
      },
      cmSelectClass: function () {
        cmSelectClass(el.dataset.cid);
      },
      cmRemoveStudent: function () {
        cmRemoveStudent(el.dataset.sid);
      },
      cmOpenStudentPage: function () {
        cmOpenStudentPage(el.dataset.sid);
      },
      cmRosterSort: function () {
        cmRosterSort(el.dataset.sort);
      },
      cmRosterDesigOpen: function () {
        cmRosterDesigOpen(el);
      },
      cmRosterDesigAdd: function () {
        cmRosterDesigAdd(el.dataset.sid, el.dataset.code);
      },
      cmRosterDesigRemove: function () {
        cmRosterDesigRemove(el.dataset.sid, el.dataset.code);
      },
      cmReenrolStudent: function () {
        cmReenrolStudent(el.dataset.sid);
      },
      cmDeleteWithdrawn: function () {
        cmDeleteWithdrawn(el.dataset.sid);
      },
      cmCancelStudent: function () {
        cmCloseAddStudent();
      },
      cmSaveStudent: function () {
        cmSaveStudent(false);
      },
      cmSaveStudentAndAnother: function () {
        cmSaveStudent(true);
      },
      cmShowAddStudent: function () {
        cmShowAddStudent();
      },
      cmImportRoster: function () {
        cmImportRoster();
      },
      cmChooseRosterFile: function () {
        cmChooseRosterFile();
      },
      cmCloseImportFormat: function () {
        cmCloseImportFormat();
      },
      cmConfirmImport: function () {
        cmConfirmImport();
      },
      cmCancelImport: function () {
        cmCancelImport();
      },
      cmImportPick: function () {
        _cmCloseStdMenus();
        cmImportPick(el.dataset.col, el.dataset.field);
      },
      cmImportDateOrder: function () {
        cmImportDateOrder(el.dataset.col, el.dataset.order);
      },
      cmImportShowColumns: function () {
        cmImportShowColumns();
      },
      cmImportShowAll: function () {
        cmImportShowAll();
      },
      cmImportChooseNames: function () {
        cmImportChooseNames();
      },
      cmImportShowBlanks: function () {
        cmImportShowBlanks();
      },
      cmCloseImportDone: function () {
        cmCloseImportDone();
      },
      cmUndoImport: function () {
        cmUndoImport();
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
      cmSetLevelOrder: function () {
        cmSetLevelOrder(el.dataset.value);
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
      cmTermEdit: function () {
        cmTermEdit();
      },
      cmTermCancel: function () {
        cmTermCancel();
      },
      cmTermSave: function () {
        cmTermSave();
      },
      cmCatAdd: function () {
        cmCatAdd();
      },
      cmCatNoticeDone: function () {
        cmCatNoticeDone();
      },
      cmCatCopyFrom: function () {
        cmOpenSetupCopy({ mode: 'from', only: 'categories' });
      },
      cmCopySetup: function () {
        cmOpenSetupCopy({});
      },
      cmPointsScaleReset: function () {
        cmResetPointsScale();
      },
      cmPointsScaleMatch: function () {
        cmMatchPointsScale();
      },
      cmPointsScaleBc: function () {
        cmBcPointsScale();
      },
      cmPtsPick: function () {
        cmPtsPick(el);
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
      cmDeleteStd: function () {
        cmDeleteStd(el.dataset.secid);
      },
      cmDeleteTag: function () {
        cmDeleteTag(el.dataset.secid, el.dataset.tagid);
      },
      cmAddTag: function () {
        cmAddTag(el.dataset.secid);
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
      cmDownloadBackup: function () {
        cmDownloadBackup(el.dataset.cid);
      },
      cmRestoreBackup: function () {
        cmRestoreBackup();
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
      cwTogglePreset: function () {
        cwTogglePreset(el.dataset.tag);
      },
      cwCompsNext: function () {
        cwCompsNext();
      },
      cwFolderAll: function () {
        cwFolderSet(el.dataset.tag, parseInt(el.dataset.idx, 10), true);
      },
      cwFolderNone: function () {
        cwFolderSet(el.dataset.tag, parseInt(el.dataset.idx, 10), false);
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
      cmStdHelp: function () {
        cmShowStdHelp(el.dataset.secid);
      },
      cmStdMenu: function () {
        cmStdToggleMenu(el);
      },
      cmSetTab: function () {
        cmSetTab(el.dataset.tab);
      },
      cmOpenGradebook: function () {
        cmOpenGradebook(el.dataset.cid);
      },
      cmStdEditWording: function () {
        cmStdEditWording(el.dataset.secid);
      },
      cmLevelsEdit: function () {
        cmLevelsEdit(el.dataset.secid);
      },
      cmLevelsCancel: function () {
        cmLevelsCancel(el.dataset.secid);
      },
      cmLevelsSave: function () {
        cmLevelsSave(el.dataset.secid);
      },
      cmStdRestoreWording: function () {
        cmStdRestoreWording(el.dataset.secid);
      },
      cmIcanDelete: function () {
        cmIcanDelete(el.dataset.secid, Number(el.dataset.idx));
      },
      cmToggleStdFolder: function () {
        cmToggleStdFolder(el.dataset.uid);
      },
      cmOpenGroupColorPop: function () {
        cmOpenGroupColorPop(el);
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
      cmCompSelectStart: function () {
        cmCompSelectStart();
      },
      cmCompSelectDone: function () {
        cmCompSelectDone();
      },
      cmCompSelectAll: function () {
        cmCompSelectAll();
      },
      cmCompMove: function () {
        cmCompMove(el.dataset.grpid);
      },
      cmCompRemoveSelected: function () {
        cmCompRemoveSelected();
      },
      cmCompExport: function () {
        cmCompExport();
      },
      cmCompImport: function () {
        cmCompImport();
      },
      cmCompReviewShowSame: function () {
        cmCompReviewShowSame();
      },
      cmCompReviewCancel: function () {
        cmCompReviewCancel();
      },
      cmCompReviewApply: function () {
        cmCompReviewApply();
      },
    };
    // A folder's Counts as One switch sits on its header. A click there is
    // the switch's own: the folder stays as it is, and the click isn't
    // cancelled, which would undo the switch.
    if (action === 'cmToggleStdFolder' && e && e.target && e.target.closest && e.target.closest('.cm-folder-count'))
      return true;
    if (handlers[action]) {
      if (el.tagName !== 'SELECT' && e) e.preventDefault();
      handlers[action]();
      return true;
    }
    return false;
  }

  function handleInput(el) {
    if (el.dataset.actionInput === 'cwNameInput') {
      cwNameInput(el);
      return true;
    }
    if (el.dataset.actionInput === 'cmRosterSearch') {
      cmRosterSearch(el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmBlockOtherInput') {
      blockOtherInput(el);
      return true;
    }
    if (el.dataset.actionInput === 'cmPtsLive') {
      cmPtsLive(el);
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
    if (el.dataset.actionInput === 'cmStdCodeLive') {
      cmStdCodeLive(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmLevelsDraft') {
      cmLevelsDraft(el.dataset.secid, Number(el.dataset.level), el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmStdLabelLive') {
      cmStdLabelLive(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionInput === 'cmTermLive') {
      cmTermLive(parseInt(el.dataset.idx, 10), el.dataset.field, el.value);
      return true;
    }
    // T-UI-02 retired: cmCwRange (legacy summative/formative slider).
    return false;
  }

  /* A switch, checkbox, radio or menu changed with the keyboard keeps the
     focus: most changes redraw Class Settings, which made the control a
     new element and dropped the focus to the page. Until the next click or
     change, a redraw that leaves the focus nowhere gives it back to the same
     control (by id, else by its data attributes), including the redraws
     around a "Change Grades?" question and its answer. */
  var _cmKeepFocusSel = null;

  function handleChange(el) {
    _cmKeepFocusSel = _cmControlSelector(el);
    return _handleChange(el);
  }

  function _cmRestoreKeptFocus() {
    if (!_cmKeepFocusSel) return;
    var active = document.activeElement;
    if (active && active !== document.body) return;
    var again = document.querySelector(_cmKeepFocusSel);
    if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
  }

  function _cmControlSelector(el) {
    if (!el || !el.tagName || typeof CSS === 'undefined' || !CSS.escape) return null;
    var keep = el.tagName === 'SELECT' || (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio'));
    if (!keep) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    var attrs = el.attributes || [];
    var parts = [];
    for (var i = 0; i < attrs.length; i++) {
      var n = attrs[i].name;
      if (n.indexOf('data-') === 0 || n === 'name' || (n === 'value' && el.type === 'radio'))
        parts.push('[' + n + '="' + CSS.escape(attrs[i].value) + '"]');
    }
    return parts.length ? el.tagName.toLowerCase() + parts.join('') : null;
  }

  function _handleChange(el) {
    if (typeof CmQuestionnaires !== 'undefined' && CmQuestionnaires.handleChange(el)) return true;
    if (_cmTabShown('student-page', cmSelectedCourse) && CmStudentPage.handleChange(el)) return true;
    if (el.dataset.actionChange === 'cmCSV') {
      cmHandleCSV(el);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompCSV') {
      cmCompCSV(el);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompToggle') {
      cmCompToggle(el.dataset.secid, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompReviewToggle') {
      cmCompReviewToggle(Number(el.dataset.idx), el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCompReviewPick') {
      cmCompReviewPick(el.dataset.group, Number(el.dataset.idx), el.dataset.pick);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportToggle') {
      cmImportToggle(el.dataset.kind, Number(el.dataset.idx), el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportToggleAll') {
      cmImportToggleAll(el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportFix') {
      cmImportFix(el.dataset.line, el.dataset.field, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmCheckStudent') {
      cmCheckStudent(el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmRoundPercentSelect') {
      cmRoundPercentSelect(el.value);
      return true;
    }
    // Letting go of the decay slider redraws the examples and the student check.
    if (el.dataset.actionChange === 'cmDecayCommit') {
      renderClassManager();
      return true;
    }
    if (el.dataset.actionChange === 'cmTermSchool') {
      cmTermSchool(el.value);
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
    if (el.dataset.actionChange === 'cmRecentLimit') {
      cmSetRecentLimit(el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmFoldersCountAsOne') {
      cmSetFoldersCountAsOne(el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cwCompToggle') {
      cwCompToggle(el.dataset.key, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cwRollup') {
      cwSetRollup(el.dataset.key, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCoursesCountEqually') {
      cmSetCoursesCountEqually(el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmFolderCountsAsOne') {
      cmSetFolderCountsAsOne(el.dataset.grpid, el.checked);
      return true;
    }
    if (el.dataset.actionChange === 'cmCatMode') {
      cmCatMode(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmPointsScale') {
      cmSavePointsScale(el);
      return true;
    }
    if (el.dataset.actionChange === 'cmStdGroup') {
      cmUpdateStdGroup(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmImportMap') {
      cmImportMap(el.dataset.col, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmRosterEll') {
      cmRosterEll(el);
      return true;
    }
    return false;
  }

  // Enter in an Add/Edit Student field saves, as the Save button does.
  // In the starter editor Enter saves and Escape cancels.
  function handleKeydown(e) {
    var el = e.target;
    if (e.key === 'Escape' && _cmCloseStdMenus()) {
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape' && _cmCloseRosterPicker()) {
      e.preventDefault();
      return true;
    }
    if (e.key === 'Escape' && el && el.closest && el.closest('#cm-add-student-form') && cmCloseAddStudent()) {
      e.preventDefault();
      return true;
    }
    if (_cmRosterKeydown(e)) return true;
    if (_cmPtsKeydown(e)) return true;
    // A course row in New Class or Re-link ticks with Space or Enter, and
    // keeps the focus through the redraw so the next row is one Tab away.
    if (
      el &&
      el.classList &&
      el.classList.contains('cw-course-item') &&
      (e.key === ' ' || e.key === 'Enter') &&
      !e.isComposing
    ) {
      e.preventDefault();
      var courseTag = el.dataset.tag;
      el.click();
      var again = document.querySelector('.cw-course-item[data-tag="' + CSS.escape(courseTag) + '"]');
      if (again) again.focus();
      return true;
    }
    // Arrow keys move between the class tabs, as in any tab list.
    if (el && el.classList && el.classList.contains('cm-tab') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var ids = _cmShownTabs(cmSelectedCourse).map(function (t) {
        return t.id;
      });
      var at = ids.indexOf(el.dataset.tab);
      var next = ids[(at + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      e.preventDefault();
      cmSetTab(next);
      return true;
    }
    if (el && el.classList && !e.isComposing && e.key === 'Enter' && !e.shiftKey) {
      // Enter adds the typed I Can statement, or ends an edit to one.
      if (el.classList.contains('cm-ican-new')) {
        e.preventDefault();
        var typed = el.value;
        el.value = ''; // so the blur that follows the redraw adds nothing twice
        cmIcanAdd(el.dataset.secid, typed);
        return true;
      }
      if (el.classList.contains('cm-ican-text')) {
        e.preventDefault();
        el.blur();
        return true;
      }
    }
    if (e.key !== 'Enter' || e.isComposing) return false;
    if (!el || el.tagName !== 'INPUT' || el.type === 'checkbox') return false;
    if (!el.closest || !el.closest('#cm-add-student-form')) return false;
    e.preventDefault();
    cmSaveStudent(true);
    return true;
  }

  function handleBlur(el) {
    if (typeof CmQuestionnaires !== 'undefined' && CmQuestionnaires.handleBlur(el)) return true;
    if (_cmTabShown('student-page', cmSelectedCourse) && CmStudentPage.handleBlur(el)) return true;
    if (el.dataset.actionBlur === 'cmRosterField') {
      cmRosterField(el);
      return true;
    }
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
      cmStdFinishWording(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmIcanAdd') {
      // Typed but never pressed Enter: keep the statement anyway.
      if (el.value.trim()) cmIcanAdd(el.dataset.secid, el.value);
      return true;
    }
    if (el.dataset.actionBlur === 'cmIcanEdit') {
      cmIcanEdit(el.dataset.secid, Number(el.dataset.idx), el.value);
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
    get classManagerOpen() {
      return classManagerOpen;
    },
    set classManagerOpen(v) {
      classManagerOpen = v;
    },
    openClassManager: openClassManager,
    closeClassManager: closeClassManager,
    // The grading scale a new class starts with for its grade (tests).
    defaultGradingScale: _cmDefaultGradingScale,
    renderClassManager: renderClassManager,
    // The copy step behind the Duplicate Class dialog (block '' = none).
    duplicateCourse: _cmDuplicateCourse,
    handleAction: handleAction,
    // The reporting terms draft as the editor holds it (tests).
    // For tests: the import review a CSV file opens.
    cmShowImportPreview: cmShowImportPreview,
    cmStartImport: cmStartImport,
    parseRosterCsv: parseRosterCsv,
    rosterImportTable: rosterImportTable,
    rosterRowsFromTable: rosterRowsFromTable,
    rosterImportReady: rosterImportReady,
    rosterDateOrder: rosterDateOrder,
    rosterDate: _rosterDate,
    cmCompRowsFromCsv: cmCompRowsFromCsv,
    withdrawnRecordRows: _cmWithdrawnRecordRows,
    // The Edit Student dialog's Parent Email and Parent Email 2.
    guardianEmails: _cmGuardianEmails,
    saveGuardianEmail: _cmSetGuardianEmail,
    reportingTermsDraft: function (cid) {
      var st = _cmTermRows(cid || cmSelectedCourse);
      return { rows: st.rows.slice(), dirty: st.dirty, error: _cmTermError(cid || cmSelectedCourse) };
    },
    // The categories as Class Settings holds them, and a drag's move.
    categoriesDraft: function (cid) {
      var st = _cmCatState(cid || cmSelectedCourse);
      return {
        rows: st.rows.slice(),
        dirty: !!st.dirty,
        notice: _cmCatNoticeText(st),
        action: _cmCatNoticeAction(st),
        typed: st.notice && st.notice.kind === 'changed' && st.typed ? st.typed.map(_cmCatTypedLine) : null,
      };
    },
    reorderCategory: function (fromIdx, toIdx) {
      return cmSelectedCourse ? _cmCatReorder(cmSelectedCourse, fromIdx, toIdx) : Promise.resolve();
    },
    handleInput: handleInput,
    handleChange: handleChange,
    handleBlur: handleBlur,
    handleKeydown: handleKeydown,
    initDrag: function () {
      _initCmStdDrag();
      _initCmCatDrag();
      _initCmPtsDrag();
    },
    destroy: _removeAllListeners,
    resetState: function () {
      classManagerOpen = false;
      cmMode = 'edit';
      cmTab = 'details';
      cmSelectedCourse = _activeCourse;
      _activeCourseChanged = false;
      _cmPtsPick = null;
      _cmPtsError = null;
      _cmPtsTyped = null;
      cmEditingStudentId = null;
      cmRosterQuery = '';
      _cmGuardiansLoaded = {};
      _cmGuardiansReady = {};
      _cmGuardiansLoading = {};
      cmPendingImport = null;
      cmImportFormatOpen = false;
      cmImportError = null;
      cmImportDone = null;
      cmRosterOnly = null;
      cmCompSelect = false;
      cmCompSelected = {};
      cmCompReview = null;
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
    },
  };
})();
