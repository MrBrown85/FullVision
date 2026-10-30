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
  var cmTab = 'details'; // details | students | questionnaires | grading | terms | competencies

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

  // Relink
  var cmRelinkCid = null;
  var cmRelinkStep = 0;

  // Standard folder collapse state
  var _cmCollapsedStdFolders = {};
  var _cmOpenStdCards = {};

  // Card state that lives outside the learning map: which cards are editing
  // their wording, and the I Can statement being dragged.
  var _cmWordingEdit = {};
  var _cmIcanDrag = null;

  // The same code the gradebook heads the column with.
  function _cmStdCode(tag) {
    if (!tag) return '';
    return tag.code || (tag.id && !_UUID_RE_CM.test(tag.id) ? tag.id : '') || tag.shortName || '';
  }

  function _cmStdIsEdited(tag) {
    return !!(tag && tag.source_text && (tag.text || '').trim() !== tag.source_text.trim());
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
      '<span class="cm-std-label" data-fallback="' +
      esc(sec.shortName || sec.name || '') +
      '">' +
      esc(title) +
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
          (tag.source_text ? 'BC Curriculum' : 'Category') +
          (sec.name ? ' · ' + esc(sec.name) : '') +
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
      // Where the statements print today: reports show the first one.
      '<div class="cm-std-shown"><span class="cm-std-shown-label">Shown in:</span>' +
      '<span class="cm-std-shown-chip">Printed Reports \u00B7 first statement</span>' +
      '<span class="cm-std-shown-chip">Rubric Drafts</span>' +
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

  /* ── Where These Appear: one picture per field, drawn with the app's own
     gradebook and report styles and this competency's own words. ── */
  function _cmHelpSiblings(lm, sec) {
    var out = [];
    (lm.sections || []).forEach(function (s) {
      if (s.id === sec.id || out.length >= 3) return;
      if ((sec.groupId || null) !== (s.groupId || null)) return;
      if (s.tags && s.tags[0]) out.push(s.tags[0]);
    });
    return out;
  }

  function _cmHelpGradebook(cid, sec, tag, siblings, withTip) {
    var color = sec.color || 'var(--active)';
    var cols = [tag].concat(siblings).slice(0, 4);
    var levels = [3, 2, 4, 3];
    var head = cols
      .map(function (t, i) {
        var c = (i === 0 ? sec.color : null) || color;
        return (
          '<div class="gb-grid-tag-header cm-help-col' +
          (i === 0 ? ' cm-help-hl' : '') +
          '" style="border-bottom-color:' +
          c +
          ';color:' +
          c +
          '">' +
          esc(_cmStdCode(t)) +
          '</div>'
        );
      })
      .join('');
    var row = cols
      .map(function (t, i) {
        return '<div class="cm-help-cell"><span class="gb-score-val s' + levels[i] + '">' + levels[i] + '</span></div>';
      })
      .join('');
    return (
      '<div class="cm-help-gb">' +
      '<div class="cm-help-gb-row"><div class="cm-help-gb-name cm-help-gb-th">Student</div>' +
      head +
      '</div>' +
      '<div class="cm-help-gb-row"><div class="cm-help-gb-name">' +
      'Student 1' +
      '</div>' +
      row +
      '</div>' +
      (withTip ? '<div class="cm-help-tip cm-help-hl">' + esc(tag.text || 'Recognize and explain…') + '</div>' : '') +
      '</div>'
    );
  }

  // A sample level worded the way this class's report card words it.
  function _cmHelpLevel(cid, n) {
    try {
      if (courseGradeMode(cid) === 'letter') return formatLevel(cid, n);
    } catch (e) {
      /* fall through to the scale name */
    }
    return PROF_LABELS[n] || '';
  }

  function _cmHelpReportTable(cid, sec, tag, siblings) {
    var rows = [tag].concat(siblings).slice(0, 3);
    return (
      '<div class="report-block-box report-competency-table cm-help-report">' +
      '<div class="report-block-title">Curricular Competencies</div>' +
      '<table class="report-ct"><thead><tr><th>Competency</th><th>Level</th></tr></thead><tbody>' +
      rows
        .map(function (t, i) {
          var n = [3, 2, 3][i];
          return (
            '<tr' +
            (i === 0 ? ' class="cm-help-hl"' : '') +
            '><td class="report-ct-name">' +
            esc(t.label || t.name || '') +
            '</td><td class="report-ct-level" data-prof="' +
            n +
            '"><span class="report-dots" aria-hidden="true">' +
            '●'.repeat(n) +
            '○'.repeat(4 - n) +
            '</span>' +
            esc(_cmHelpLevel(cid, n)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>'
    );
  }

  function _cmHelpNextSteps(cid, sec, tag) {
    var icans = tag.i_can_statements || [];
    if (!icans.length) {
      return '<p class="cm-help-empty">Add an I Can statement on the card and it appears here.</p>';
    }
    return (
      '<div class="report-block-box cm-help-report">' +
      '<div class="report-block-title">Suggested Next Steps</div>' +
      '<div class="report-next-step-item">' +
      '<div class="report-next-step-bullet" style="background:var(--score-2)">1</div>' +
      '<div><strong>' +
      esc(tag.label || '') +
      '</strong> — ' +
      esc(_cmHelpLevel(cid, 2)) +
      '. <span style="color:var(--text-2)">Focus areas:</span>' +
      '<ul class="report-ican-list cm-help-hl">' +
      icans
        .slice(0, 2)
        .map(function (s) {
          return '<li class="report-ican-item">' + esc(s) + '</li>';
        })
        .join('') +
      '</ul></div></div></div>'
    );
  }

  function cmShowStdHelp(secId) {
    secId = _currentId('section', secId);
    var cid = cmSelectedCourse;
    if (!cid) return;
    var lm = getLearningMap(cid);
    var sec = (lm.sections || []).find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return;
    var tag = sec.tags[0];
    var siblings = _cmHelpSiblings(lm, sec);
    var parts = [
      {
        name: 'Title',
        where: 'Report card',
        text: 'The competency’s name on report cards and throughout FullVision.',
        picture: _cmHelpReportTable(cid, sec, tag, siblings),
      },
      {
        name: 'Code',
        where: 'Gradebook',
        text: 'Labels the competency’s column in the gradebook.',
        picture: _cmHelpGradebook(cid, sec, tag, siblings, false),
      },
      {
        name: 'Curricular Competency',
        where: 'Gradebook',
        text: 'Appears when you point at the column’s code.',
        picture: _cmHelpGradebook(cid, sec, tag, siblings, true),
      },
      {
        name: 'I Can Statements',
        where: 'Report card',
        text: 'Print as next steps on report cards.',
        picture: _cmHelpNextSteps(cid, sec, tag),
      },
    ];
    var triggerEl = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay cm-help-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cm-help-title');
    overlay.innerHTML =
      '<div class="cm-help-card">' +
      '<div class="cm-help-head">' +
      '<h2 class="cm-help-title" id="cm-help-title">Where These Appear</h2>' +
      '<button type="button" class="cm-help-close" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="cm-help-body">' +
      '<div class="cm-help-tabs" role="tablist" aria-orientation="vertical">' +
      parts
        .map(function (p, i) {
          return (
            '<button type="button" class="cm-help-tab" role="tab" id="cm-help-tab-' +
            i +
            '" aria-controls="cm-help-panel" aria-selected="' +
            (i === 0 ? 'true' : 'false') +
            '" tabindex="' +
            (i === 0 ? '0' : '-1') +
            '" data-idx="' +
            i +
            '"><span class="cm-help-tab-name">' +
            esc(p.name) +
            '</span><span class="cm-help-tab-where">' +
            esc(p.where) +
            '</span></button>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="cm-help-panel" id="cm-help-panel" role="tabpanel" aria-labelledby="cm-help-tab-0"></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var panel = overlay.querySelector('.cm-help-panel');
    var tabs = overlay.querySelectorAll('.cm-help-tab');
    function show(i) {
      tabs.forEach(function (t, j) {
        t.setAttribute('aria-selected', j === i ? 'true' : 'false');
        t.tabIndex = j === i ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', 'cm-help-tab-' + i);
      panel.innerHTML =
        '<div class="cm-help-picture" aria-hidden="true">' +
        parts[i].picture +
        '</div>' +
        '<div class="cm-help-caption"><span class="cm-help-caption-name">' +
        esc(parts[i].name) +
        '</span><span class="cm-help-caption-text">' +
        esc(parts[i].text) +
        '</span></div>';
    }
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      try {
        if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
      } catch (e) {
        /* trigger may be gone after a re-render */
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      var cur = Array.prototype.indexOf.call(tabs, document.activeElement);
      if (cur >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        var next = (cur + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length;
        show(next);
        tabs[next].focus();
        return;
      }
      if (e.key === 'Tab') {
        var focusable = [overlay.querySelector('.cm-help-close')].concat(
          Array.prototype.filter.call(tabs, function (t) {
            return t.tabIndex === 0;
          }),
        );
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        show(Number(t.dataset.idx));
      });
    });
    overlay.querySelector('.cm-help-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    show(0);
    tabs[0].focus();
  }

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
    var name = fullName(entry.student);
    showConfirm(
      'Delete ' + name + ' Permanently?',
      'Their scores, observations, goals, reflections and reports in this class are deleted. This cannot be undone.',
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
      '.</span></span>' +
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

  function _cmRosterRowHtml(cid, st, i) {
    var g = _cmGuardiansFor(cid, st.id);
    var ell = (st.designations || []).indexOf('ELL') >= 0;
    var name = ((st.firstName || '') + ' ' + (st.lastName || '') + ' ' + (st.preferred || '')).toLowerCase();
    return (
      '<div class="cm-rs-grid cm-rs-row' +
      (i % 2 ? ' cm-rs-alt' : '') +
      '" data-sid="' +
      esc(st.id) +
      '" data-name="' +
      esc(name) +
      '"' +
      (cmRosterQuery && name.indexOf(cmRosterQuery) < 0 ? ' hidden' : '') +
      '>' +
      '<span class="cm-rs-stick1">' +
      _cmRosterInput(st, 'last', st.lastName, 'Last name') +
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
    students.forEach(function (st, i) {
      html += _cmRosterRowHtml(cid, st, i);
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
      var hit = !cmRosterQuery || (row.dataset.name || '').indexOf(cmRosterQuery) >= 0;
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
    var box = btn.closest('.cm-rs-scroll');
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

  function cmImportRoster() {
    var el = document.getElementById('cm-csv-input');
    if (el) el.click();
  }

  /* ── Import Roster: reading the file ────────────────────────
     Columns are read by their header, so a MyEd export or a spreadsheet in
     any column order lands in the right fields. Quoted cells may hold commas
     ("Okafor, Cecilia"). A file with no header the importer knows is read in
     the old fixed order: First, Last, Preferred, Pronouns, Student Number,
     Date of Birth, Email; or Name, Preferred, Pronouns with fewer than four
     columns. The review lets the teacher change what each column means. */
  var ROSTER_IMPORT_FIELDS = [
    ['', 'Ignore'],
    ['lastName', 'Last Name'],
    ['firstName', 'First Name'],
    ['fullName', 'Full Name'],
    ['preferred', 'Preferred Name'],
    ['pronouns', 'Pronouns'],
    ['studentNumber', 'Student Number'],
    ['dateOfBirth', 'Date of Birth'],
    ['email', 'Student Email'],
    ['parentEmail', 'Parent Email'],
    ['parentEmail2', 'Parent Email 2'],
    ['designations', 'Designations'],
    ['ell', 'ELL'],
  ];
  var ROSTER_HEADER_ALIASES = {
    lastName: ['last', 'last name', 'lastname', 'surname', 'legal surname', 'legal last name', 'family name'],
    firstName: ['first', 'first name', 'firstname', 'given name', 'legal first name', 'legal given name'],
    fullName: ['name', 'student name', 'full name', 'student'],
    preferred: ['preferred', 'preferred name', 'usual first name', 'usual name', 'nickname', 'goes by'],
    pronouns: ['pronouns', 'pronoun'],
    studentNumber: [
      'student number',
      'studentnumber',
      'student #',
      'student no',
      'student id',
      'pupil #',
      'pupil number',
      'pupil no',
      'local id',
    ],
    dateOfBirth: ['dob', 'date of birth', 'birth date', 'birthdate', 'birthday'],
    email: ['email', 'student email', 'school email', 'e-mail', 'email address'],
    parentEmail: [
      'parent email',
      'guardian email',
      'parent 1 email',
      'guardian 1 email',
      'parent/guardian email',
      'contact email',
      'family email',
    ],
    parentEmail2: ['parent email 2', 'guardian email 2', 'parent 2 email', 'guardian 2 email', 'second parent email'],
    designations: ['designation', 'designations', 'special ed', 'special education', 'special ed category'],
    ell: ['ell', 'esl', 'ell status', 'esl status', 'english language learner'],
  };

  function rosterFieldFor(header) {
    var k = String(header || '')
      .trim()
      .toLowerCase()
      .replace(/[_.]+/g, ' ')
      .replace(/\s+/g, ' ');
    var found = '';
    Object.keys(ROSTER_HEADER_ALIASES).some(function (field) {
      if (ROSTER_HEADER_ALIASES[field].indexOf(k) >= 0) found = field;
      return !!found;
    });
    return found;
  }

  /* Rows of cells. Commas or tabs (whichever the first line has more of),
     "quoted, cells", "" for a quote inside one, CRLF or LF, a leading BOM. */
  function parseRosterCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = first.split('\t').length > first.split(',').length ? '\t' : ',';
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && !cell.trim()) {
        quoted = true;
        cell = '';
      } else if (c === delim) {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows
      .map(function (r) {
        return r.map(function (s) {
          return s.trim();
        });
      })
      .filter(function (r) {
        return r.some(Boolean);
      });
  }

  /* The file as { headers, body, map }: map[i] is the field column i fills. */
  function rosterImportTable(text) {
    var rows = parseRosterCsv(text);
    if (!rows.length) return { headers: [], body: [], map: [] };
    var map = rows[0].map(rosterFieldFor);
    if (map.some(Boolean)) return { headers: rows[0], body: rows.slice(1), map: map };
    var width = Math.max.apply(
      null,
      rows.map(function (r) {
        return r.length;
      }),
    );
    var order =
      width >= 4
        ? ['firstName', 'lastName', 'preferred', 'pronouns', 'studentNumber', 'dateOfBirth', 'email']
        : ['fullName', 'preferred', 'pronouns'];
    return {
      headers: order.slice(0, width).map(function () {
        return '';
      }),
      body: rows,
      map: order.slice(0, width),
    };
  }

  function _rosterEmailOk(v) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  }

  /* 2012-05-15, 2012/5/15, or a written date like May 15, 2012. A
     day-first or month-first number date can't be told apart, so it's
     left out rather than guessed. */
  function _rosterDate(v) {
    var m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
    var pad = function (n) {
      return (n < 10 ? '0' : '') + n;
    };
    if (m) {
      var y = +m[1],
        mo = +m[2],
        d = +m[3];
      return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? y + '-' + pad(mo) + '-' + pad(d) : '';
    }
    if (!/[a-z]/i.test(v)) return '';
    var t = new Date(v + ' 12:00');
    return isNaN(t) ? '' : t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  }

  function _rosterSplitName(v) {
    if (v.indexOf(',') >= 0) {
      var parts = v.split(',');
      return { first: parts.slice(1).join(',').trim(), last: parts[0].trim() };
    }
    var words = v.split(/\s+/);
    return { first: words[0] || '', last: words.slice(1).join(' ') };
  }

  /* The table's rows as students, and what couldn't be read. A blank cell
     never clears anything; codes that aren't BC designations are left out. */
  function rosterRowsFromTable(table) {
    var out = [];
    var skipped = { dates: 0, emails: 0, codes: 0 };
    var addCode = function (p, code) {
      p.designations = p.designations || [];
      if (p.designations.indexOf(code) < 0) p.designations.push(code);
    };
    table.body.forEach(function (r) {
      var p = { parentEmails: [] };
      table.map.forEach(function (field, i) {
        var v = (r[i] || '').trim();
        if (!field || !v) return;
        if (field === 'fullName') {
          var nm = _rosterSplitName(v);
          if (!p.firstName) p.firstName = nm.first;
          if (!p.lastName) p.lastName = nm.last;
        } else if (field === 'dateOfBirth') {
          var d = _rosterDate(v);
          if (d) p.dateOfBirth = d;
          else skipped.dates++;
        } else if (field === 'email') {
          if (_rosterEmailOk(v)) p.email = v;
          else skipped.emails++;
        } else if (field === 'parentEmail' || field === 'parentEmail2') {
          v.split(/[;,\s]+/)
            .filter(Boolean)
            .forEach(function (e) {
              if (!_rosterEmailOk(e)) skipped.emails++;
              else if (p.parentEmails.indexOf(e) < 0) p.parentEmails.push(e);
            });
        } else if (field === 'designations') {
          v.toUpperCase()
            .split(/[\s,;/]+/)
            .filter(Boolean)
            .forEach(function (code) {
              if (BC_DESIGNATIONS[code] || SUPPORT_FLAGS[code]) addCode(p, code);
              else skipped.codes++;
            });
        } else if (field === 'ell') {
          if (/^(y|yes|true|1|x|ell|esl)$/i.test(v)) addCode(p, 'ELL');
        } else p[field] = v;
      });
      if (p.firstName || p.lastName) out.push(p);
    });
    return { rows: out, skipped: skipped };
  }

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
    var reader = new FileReader();
    reader.onload = function (e) {
      var table = rosterImportTable(e.target.result);
      var read = rosterRowsFromTable(table);
      cmShowImportPreview(read.rows, file.name, table, read.skipped);
    };
    reader.readAsText(file);
    input.value = '';
  }

  /* A column's meaning changed in the review: read the file again. */
  function cmImportMap(col, field) {
    var plan = cmPendingImport;
    if (!plan || !plan.table) return;
    plan.table.map[Number(col)] = field;
    var read = rosterRowsFromTable(plan.table);
    cmShowImportPreview(read.rows, plan.fileName, plan.table, read.skipped);
  }

  /* Import review. Rows are matched to the roster by student number, then
     by name: a matched number with a different name is a name change, and a
     student the file leaves out is offered for withdrawal (off by default).
     Nothing changes until Import. */
  function _cmImportKey(v) {
    return String(v || '')
      .trim()
      .toLowerCase();
  }

  function cmShowImportPreview(parsed, fileName, table, skipped) {
    var cid = cmSelectedCourse;
    if (!cid) return;
    var roster = getStudents(cid);
    var byNum = {};
    var byName = {};
    roster.forEach(function (s) {
      if (_cmImportKey(s.studentNumber)) byNum[_cmImportKey(s.studentNumber)] = s;
      byName[_cmImportKey(fullName(s))] = s;
    });
    var matched = {};
    var plan = {
      fileName: fileName || '',
      total: parsed.length,
      added: [],
      renamed: [],
      updated: [],
      missing: [],
      same: 0,
      table: table || null,
      skipped: skipped || null,
    };
    parsed.forEach(function (p) {
      var name = _cmImportKey((p.firstName || '') + ' ' + (p.lastName || ''));
      var hit = (_cmImportKey(p.studentNumber) && byNum[_cmImportKey(p.studentNumber)]) || byName[name];
      if (!hit || matched[hit.id]) {
        if (!hit) plan.added.push({ row: p, on: true });
        return;
      }
      matched[hit.id] = true;
      var sameName =
        _cmImportKey(hit.firstName) === _cmImportKey(p.firstName) &&
        _cmImportKey(hit.lastName) === _cmImportKey(p.lastName);
      if (!sameName && p.firstName) plan.renamed.push({ sid: hit.id, row: p, on: true });
      var fields = _cmImportChanges(cid, hit, p);
      if (fields.length) plan.updated.push({ sid: hit.id, row: p, fields: fields, on: true });
      else if (sameName || !p.firstName) plan.same++;
    });
    sortStudents(roster, 'lastName').forEach(function (s) {
      if (!matched[s.id]) plan.missing.push({ sid: s.id, on: false });
    });
    cmPendingImport = plan;
    renderClassManager();
  }

  /* What a matched row would change: a field the file fills and the roster
     has differently, a designation the student doesn't have yet, a parent
     email not on file. Blank cells change nothing. */
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
      if (p[k] && String(p[k]) !== String(st[k] || '')) out.push(IMPORT_FIELD_LABELS[k]);
    });
    var have = st.designations || [];
    var newCodes = (p.designations || []).filter(function (c) {
      return have.indexOf(c) < 0;
    });
    if (newCodes.length) out.push(newCodes.join(', '));
    var known = _cmGuardiansFor(cid, st.id).map(function (g) {
      return (g.email || '').toLowerCase();
    });
    var newParents = (p.parentEmails || []).filter(function (e) {
      return known.indexOf(e.toLowerCase()) < 0;
    });
    if (newParents.length) out.push(newParents.length === 1 ? 'Parent Email' : newParents.length + ' Parent Emails');
    return out;
  }

  function _cmRenderImportReview(cid) {
    var plan = cmPendingImport;
    if (!plan) return '';
    var byId = {};
    getStudents(cid).forEach(function (s) {
      byId[s.id] = s;
    });
    function group(title, items, render, note) {
      if (!items.length) return '';
      return (
        '<div class="cm-import-group"><div class="cm-import-group-head"><h3>' +
        title +
        '</h3><span>' +
        items.length +
        '</span></div>' +
        items.map(render).join('') +
        (note ? '<div class="cm-hint">' + note + '</div>' : '') +
        '</div>'
      );
    }
    function check(kind, i, on, body) {
      return (
        '<label class="cm-import-row"><input type="checkbox"' +
        (on ? ' checked' : '') +
        ' data-action-change="cmImportToggle" data-kind="' +
        kind +
        '" data-idx="' +
        i +
        '">' +
        body +
        '</label>'
      );
    }
    var added = plan.added.filter(function (a) {
      return a.on;
    }).length;
    var renamed = plan.renamed.filter(function (r) {
      return r.on;
    }).length;
    var withdrawn = plan.missing.filter(function (m) {
      return m.on;
    }).length;
    var updated = (plan.updated || []).filter(function (u) {
      return u.on;
    }).length;
    var summary = [];
    if (added) summary.push('Add ' + added);
    if (renamed) summary.push('rename ' + renamed);
    if (updated) summary.push('update ' + updated);
    if (withdrawn) summary.push('withdraw ' + withdrawn);
    if (summary.length) summary[0] = summary[0].charAt(0).toUpperCase() + summary[0].slice(1);
    var columns = '';
    if (plan.table && plan.table.headers.some(Boolean)) {
      columns =
        '<div class="cm-import-group cm-import-columns"><div class="cm-import-group-head"><h3>Columns in This File</h3></div>' +
        '<div class="cm-import-col-grid">' +
        plan.table.headers
          .map(function (h, i) {
            var field = plan.table.map[i] || '';
            return (
              '<label class="cm-import-col"><span class="cm-import-col-name">' +
              esc(h || 'Column ' + (i + 1)) +
              '</span><select class="cm-input" data-action-change="cmImportMap" data-col="' +
              i +
              '" aria-label="What ' +
              esc(h || 'column ' + (i + 1)) +
              ' holds">' +
              ROSTER_IMPORT_FIELDS.map(function (f) {
                return '<option value="' + f[0] + '"' + (f[0] === field ? ' selected' : '') + '>' + f[1] + '</option>';
              }).join('') +
              '</select></label>'
            );
          })
          .join('') +
        '</div>' +
        '<div class="cm-hint">Change a column if it was matched to the wrong field. Ignored columns aren\'t imported.</div>' +
        '</div>';
    }
    var sk = plan.skipped || {};
    var skippedParts = [];
    if (sk.dates) skippedParts.push(sk.dates + (sk.dates === 1 ? ' date' : ' dates'));
    if (sk.emails) skippedParts.push(sk.emails + (sk.emails === 1 ? ' email' : ' emails'));
    if (sk.codes) skippedParts.push(sk.codes + (sk.codes === 1 ? ' designation code' : ' designation codes'));
    var skippedNote = skippedParts.length
      ? '<div class="cm-hint cm-import-skipped">' +
        esc(skippedParts.join(', ')) +
        " couldn't be read and will be left out. Dates need to look like 2012-05-15.</div>"
      : '';
    return (
      '<div class="cm-section cm-import-review">' +
      '<h2 class="cm-grade-title">Import Roster: Review Changes</h2>' +
      '<div class="cm-hint">' +
      (plan.fileName ? '<strong>' + esc(plan.fileName) + '</strong> · ' : '') +
      plan.total +
      (plan.total === 1 ? ' student' : ' students') +
      '. Students are matched by student number, then by name. Nothing changes until you press Import.</div>' +
      skippedNote +
      columns +
      group('New to This Class', plan.added, function (a, i) {
        var r = a.row;
        return check(
          'added',
          i,
          a.on,
          '<span class="cm-import-name">' +
            esc(((r.firstName || '') + ' ' + (r.lastName || '')).trim()) +
            '</span><span class="cm-student-pronouns">' +
            esc(r.pronouns || '') +
            '</span><span class="cm-roster-num">' +
            esc(r.studentNumber || '') +
            '</span>',
        );
      }) +
      group(
        'Name Changed',
        plan.renamed,
        function (r, i) {
          var st = byId[r.sid] || {};
          return check(
            'renamed',
            i,
            r.on,
            '<span class="cm-import-name"><span class="cm-import-old">' +
              esc(fullName(st)) +
              '</span> → <strong>' +
              esc(((r.row.firstName || '') + ' ' + (r.row.lastName || '')).trim()) +
              '</strong></span><span class="cm-roster-num">' +
              esc(st.studentNumber || '') +
              '</span>',
          );
        },
        'Same student number, so their scores and observations stay with them.',
      ) +
      group(
        'Details Updated',
        plan.updated || [],
        function (u, i) {
          var st = byId[u.sid] || {};
          return check(
            'updated',
            i,
            u.on,
            '<span class="cm-import-name"><strong>' +
              esc(fullName(st)) +
              '</strong> · ' +
              esc(u.fields.join(', ')) +
              '</span><span class="cm-roster-num">' +
              esc(st.studentNumber || '') +
              '</span>',
          );
        },
        'Only filled-in cells change anything. Designations and parent emails are added, never removed.',
      ) +
      group(
        'In Your Class, Not in This File',
        plan.missing,
        function (m, i) {
          var st = byId[m.sid] || {};
          return check(
            'missing',
            i,
            m.on,
            '<span class="cm-import-name"><strong>' +
              esc(fullName(st)) +
              '</strong> · Withdraw from this class</span><span class="cm-roster-num">' +
              esc(st.studentNumber || '') +
              '</span>',
          );
        },
        'Left unticked, they stay enrolled. Withdrawn students keep their scores.',
      ) +
      (plan.same
        ? '<div class="cm-import-group cm-import-same"><h3>Already in Your Class</h3><span>' +
          plan.same +
          ' · no changes</span></div>'
        : '') +
      '<div class="cm-import-foot"><span>' +
      (summary.length ? '<strong>' + esc(summary.join(', ')) + '.</strong>' : 'Nothing to change.') +
      (withdrawn ? '' : ' No one is withdrawn.') +
      '</span>' +
      '<span class="cm-import-buttons"><button type="button" class="cm-action-btn" data-action="cmCancelImport">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmConfirmImport"' +
      (summary.length ? '' : ' disabled') +
      '>Import</button></span></div>' +
      '</div>'
    );
  }

  function cmImportToggle(kind, idx, on) {
    var list = cmPendingImport && cmPendingImport[kind];
    if (!list || !list[idx]) return;
    list[idx].on = !!on;
    _cmRenderAndFocus(
      '[data-action-change="cmImportToggle"][data-kind=' + _cmAttr(kind) + '][data-idx=' + _cmAttr(idx) + ']',
    );
  }

  function cmConfirmImport() {
    var plan = cmPendingImport;
    var cid = cmSelectedCourse;
    if (!plan || !cid) return;
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
    renderClassManager();
  }

  function cmCancelImport() {
    cmPendingImport = null;
    renderClassManager();
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
  function openClassManager(tab) {
    classManagerOpen = true;
    cmSelectedCourse = _activeCourse;
    cmMode = 'edit';
    if (
      CM_TABS.some(function (t) {
        return t.id === tab;
      })
    )
      cmTab = tab;
    renderClassManager();
    _cmFollowLoads();
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
        '<div class="page-toolbar dash-toolbar cm-toolbar">' +
        renderBreadcrumb('Dashboard', '/dashboard', 'Class Management', 'closeClassManager') +
        '<span class="dash-toolbar-spacer"></span>' +
        // The tabbed view names the class in its own header.
        (cmMode === 'create' || cmRelinkStep > 0
          ? '<span class="cm-toolbar-detail">' + esc(detailTitle) + '</span>'
          : '') +
        '</div>';
    }

    // The class list takes the student list's place beside the page; the
    // dashboard puts the roster back when Class Management closes.
    var sideMount = document.getElementById('sidebar-mount');
    if (sideMount) {
      sideMount.removeAttribute('data-cid');
      sideMount.style.display = courseIds.length === 0 && cmMode !== 'create' ? 'none' : '';
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

  function renderCmSidebar(courseIds) {
    var html =
      '<aside class="cm-sidebar" aria-label="Classes">' +
      '<div class="cm-sidebar-header">' +
      '<span class="cm-sidebar-title">Classes</span>' +
      '<span class="cm-sidebar-count">' +
      courseIds.length +
      ' class' +
      (courseIds.length !== 1 ? 'es' : '') +
      '</span>' +
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
      '<button type="button" class="cm-new-btn" data-action="cmStartCreate">' +
      '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="2" x2="6" y2="10"/><line x1="2" y1="6" x2="10" y2="6"/></svg>' +
      'New Class</button>' +
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
    html +=
      '<div class="cm-roster-bar">' +
      '<div class="cm-rs-tools">' +
      (students.length
        ? '<label class="cm-rs-search"><span class="cm-rs-sr">Find a student</span>' +
          '<input class="cm-input" type="search" placeholder="Find a student" data-action-input="cmRosterSearch" value="' +
          esc(cmRosterQuery) +
          '"></label>' +
          '<span class="cm-hint cm-rs-summary">Click any field to edit. Enter or ↓ moves down a column, Tab moves across.</span>' +
          '<span class="cm-hint cm-rs-summary" id="cm-rs-summary">' +
          esc(_cmRosterSummary(cid)) +
          '</span>'
        : '<span class="cm-hint">No students yet. Add students one at a time or import a CSV roster.</span>') +
      '</div>' +
      '<div class="cm-roster-buttons">' +
      '<button type="button" class="cm-action-btn" data-action="cmImportRoster">Import Roster</button>' +
      '<button type="button" class="btn btn-primary cm-roster-add" data-action="cmShowAddStudent">Add Student</button>' +
      '<input type="file" id="cm-csv-input" accept=".csv,.txt" style="display:none" data-action-change="cmCSV">' +
      '</div>' +
      '</div>' +
      '<div id="cm-import-preview">' +
      (cmPendingImport ? _cmRenderImportReview(cid) : '') +
      '</div>';
    var rosterHtml = students.length ? _cmRosterHtml(cid) : '';
    // Add/Edit student form
    html +=
      '<div id="cm-add-student-form" style="display:none" class="cm-add-student-form">' +
      '<div class="cm-student-form">' +
      '<div class="cm-field"><label class="cm-label">First Name *</label><input class="cm-input" id="cm-add-first" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Last Name</label><input class="cm-input" id="cm-add-last" placeholder="e.g. Osei" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Preferred Name</label><input class="cm-input" id="cm-add-pref" placeholder="e.g. Amara" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Pronouns</label>' +
      pronounsSelect('cm-add-pro', '') +
      '</div>' +
      '<div class="cm-field"><label class="cm-label">Student Number</label><input class="cm-input" id="cm-add-num" placeholder="e.g. STU-101" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Email</label><input class="cm-input" id="cm-add-email" type="email" placeholder="student@school.edu" style="font-size:0.875rem;padding:6px 10px"></div>' +
      '<div class="cm-field"><label class="cm-label">Date of Birth</label><input class="cm-input" id="cm-add-dob" type="date" style="font-size:0.875rem;padding:6px 10px"></div>' +
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
      '<button class="btn btn-ghost" data-action="cmCancelStudent" style="padding:6px 10px;font-size:0.8125rem">Cancel</button>' +
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
        (secs.length !== 1 ? ' Competencies' : ' Competency') +
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
          '<div class="mod-folder-empty">Drag competencies here, or choose this folder on a competency\u2019s card.</div>';
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

  var CM_TABS = [
    { id: 'details', label: 'Details' },
    { id: 'students', label: 'Students' },
    { id: 'questionnaires', label: 'Questionnaires' },
    { id: 'grading', label: 'Grading' },
    { id: 'terms', label: 'Reporting Terms' },
    { id: 'competencies', label: 'Competencies' },
  ];

  function _cmRenderTabs(active, studentCount, tagCount) {
    var counts = { students: studentCount, competencies: tagCount };
    if (typeof CmQuestionnaires !== 'undefined') counts.questionnaires = CmQuestionnaires.countOn(cmSelectedCourse);
    return (
      '<div class="cm-tabs" role="tablist" aria-label="Class settings">' +
      CM_TABS.map(function (t) {
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
    if (
      !CM_TABS.some(function (t) {
        return t.id === tab;
      })
    )
      return;
    cmTab = tab;
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

  /* Points and Proficiency, both ways. Points to Proficiency: the percent a
     points score needs for each proficiency; the lowest takes everything
     below the one above it. Counts As: the percent each step (1 to 4, with
     + and −) is worth in the course % (docs/DECISIONS.md, "Proficiency
     percents"). A step with no value of its own sits a third of the way
     between its whole levels and is shown that way. */
  var _cmPtsError = null;
  var CM_PTS_LOCKED_HINT = 'A student at this level on every assessment would show as ';
  // Each level's Counts As boxes: −, the level, + (no 4+ or 1−).
  var CM_STEP_SLOTS = { 4: ['4-', '4', null], 3: ['3-', '3', '3+'], 2: ['2-', '2', '2+'], 1: [null, '1', '1+'] };

  function _cmStepId(key) {
    return key.replace('+', 'p').replace('-', 'm');
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
  // One decimal at most: 91.7, 86.
  function _cmPctText(v) {
    return String(Math.round(v * 10) / 10);
  }

  function _cmRenderPointsScale(cid) {
    var scale = getGradingScale(cid);
    var b = scale.boundaries;
    var steps = _cmStepValues(scale);
    var rows = b
      .map(function (row, i) {
        var name = PROF_LABELS[row.proficiency];
        var input =
          i === b.length - 1
            ? '<span class="cm-pts-below">Below ' + b[i - 1].min + '%</span>'
            : '<input class="cm-input cm-pts-min" type="number" min="1" max="99" id="cm-pts-min-' +
              i +
              '" data-idx="' +
              i +
              '" value="' +
              row.min +
              '" data-action-change="cmPointsScale" aria-label="' +
              name +
              ' starts at this percent"><span class="cm-pts-unit">% and up</span>';
        // The level a student at this level everywhere would read back as.
        var readsAs = pointsToProf(steps[String(row.proficiency)], 100, scale);
        var warn =
          readsAs !== row.proficiency
            ? '<span class="cm-pts-warn" title="' +
              CM_PTS_LOCKED_HINT +
              PROF_LABELS[readsAs] +
              '.">Shows as ' +
              PROF_LABELS[readsAs] +
              '</span>'
            : '';
        var counts = CM_STEP_SLOTS[row.proficiency]
          .map(function (key) {
            if (!key) return '<span class="cm-pts-slot"></span>';
            var text = _cmPctText(steps[key]);
            var sign = key.slice(-1) === '+' ? ' Plus' : key.slice(-1) === '-' ? ' Minus' : '';
            return (
              '<input class="cm-input cm-pts-pct cm-pts-slot" type="number" min="0" max="100" step="0.1" id="cm-pts-pct-' +
              _cmStepId(key) +
              '" value="' +
              text +
              '"' +
              (_cmHasOwnStep(scale, key) ? '' : ' data-derived="' + text + '"') +
              ' data-action-change="cmPointsScale" aria-label="' +
              name +
              sign +
              ' counts as this percent">'
            );
          })
          .join('');
        return (
          '<div class="cm-pts-row"><span class="cm-pts-name">' +
          name +
          '</span><span class="cm-pts-cell">' +
          input +
          '</span><span class="cm-pts-cell">' +
          counts +
          warn +
          '</span></div>'
        );
      })
      .join('');
    return (
      '<div class="cm-pts-scale">' +
      '<div class="cm-recent-text"><span class="cm-label">Points and Proficiency</span>' +
      '<span class="cm-hint">A points score becomes a proficiency by its percent. Each proficiency, with its + and −, counts as a percent in the course %.</span></div>' +
      '<div class="cm-pts-rows">' +
      '<div class="cm-pts-row cm-pts-head"><span class="cm-pts-name"></span>' +
      '<span class="cm-pts-cell">Points to Proficiency</span><span class="cm-pts-cell">Counts As (%)</span></div>' +
      '<div class="cm-pts-row cm-pts-head cm-pts-subhead"><span class="cm-pts-name"></span><span class="cm-pts-cell"></span>' +
      '<span class="cm-pts-cell"><span class="cm-pts-slot">−</span><span class="cm-pts-slot">Level</span><span class="cm-pts-slot">+</span></span></div>' +
      rows +
      '</div>' +
      (_cmPtsError ? '<div class="cm-pts-error" role="alert">' + esc(_cmPtsError) + '</div>' : '') +
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

  function cmSavePointsScale() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var scale = getGradingScale(cid);
    var saved = _cmStepValues(scale);
    var boundaries = DEFAULT_GRADING_SCALE.boundaries.map(function (db, i) {
      var inp = document.getElementById('cm-pts-min-' + i);
      return {
        min: inp ? Math.max(0, Math.min(99, parseInt(inp.value, 10) || 0)) : 0,
        proficiency: db.proficiency,
      };
    });
    // A whole level always has a value. A + or − keeps its own value, or is
    // left out (a third of the way between its levels) while it still shows
    // that in-between value or is cleared.
    var percents = {};
    COUNTS_AS_STEPS.forEach(function (step) {
      var key = step.key;
      var whole = key.length === 1;
      var inp = document.getElementById('cm-pts-pct-' + _cmStepId(key));
      if (!inp) {
        if (whole || _cmHasOwnStep(scale, key)) percents[key] = saved[key];
        return;
      }
      var raw = String(inp.value == null ? '' : inp.value).trim();
      if (!whole && (raw === '' || (inp.dataset && raw === inp.dataset.derived))) return;
      var v = parseFloat(raw);
      if (isFinite(v)) percents[key] = Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;
      else if (whole) percents[key] = saved[key];
    });
    var ladder = countsAsStepPercents(percents);
    if (
      !ladder.every(function (v, i) {
        return i === 0 || v > ladder[i - 1];
      })
    ) {
      _cmPtsError = 'Each step must count for more than the one below it.';
      renderClassManager();
      return;
    }
    _cmPtsError = null;
    // Labels saved before the scale moved here are kept as they were.
    _cmApplyPointsScale(cid, { boundaries: boundaries, percents: percents, labels: scale.labels || null });
  }

  function cmMatchPointsScale() {
    if (!cmSelectedCourse) return;
    var cid = cmSelectedCourse;
    var scale = getGradingScale(cid);
    _cmPtsError = null;
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
    _cmApplyPointsScale(cid, {
      boundaries: scale.boundaries,
      percents: Object.assign({}, BC_LETTER_BAND_PERCENTS),
      labels: scale.labels || null,
    });
  }

  function cmResetPointsScale() {
    if (!cmSelectedCourse) return;
    _cmPtsError = null;
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
     scores. */
  function _cmRenderCheckStudent(cid, gs, method) {
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
            ' Categories \u00B7 ' +
            compCount +
            ' Standards</span>' +
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
    var calc = cwStep2Calc || _cmDefaultCalcMethod();

    var html = '<div class="cm-detail-inner" style="display:block">';
    html += renderCwStepBar();

    html +=
      '<div class="cm-section"><div class="cm-section-title">Class Details</div>' +
      '<div class="cm-field"><label class="cm-label">Class Name</label><input class="cm-input" id="cm-new-name" value="' +
      esc(preName) +
      '" placeholder="e.g. English 10" autofocus></div>' +
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
      '<div style="display:flex;gap:16px"><div class="cm-field" style="flex:1"><label class="cm-label">Grade Level</label><input class="cm-input" id="cm-new-grade" value="' +
      esc(preGrade) +
      '" placeholder="e.g. 8, 10-12" data-action-input="cwGradeInput"></div></div>' +
      '<div class="cm-field"><label class="cm-label">Description</label><textarea class="cm-textarea" id="cm-new-desc" placeholder="Optional">' +
      esc(cwStep2Desc) +
      '</textarea></div></div>';

    html +=
      '<div class="cm-section"><div class="cm-section-title">Grading &amp; Calculation</div>' +
      '<div class="cm-field"><label class="cm-label">Grading System</label>' +
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
      '<div class="cm-field"><label class="cm-label">Calculation Method</label>' +
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
      '"><label class="cm-label">Decay Weight</label>' +
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
            ' Standard' +
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
      (document.querySelector('#cm-cg-calc .cm-seg-btn.active') || {}).dataset?.val || _cmDefaultCalcMethod();
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
    cc.levelOrder = _cmDefaultLevelOrder(course.gradeLevel);
    var startScale = _cmDefaultGradingScale(course.gradeLevel);
    if (startScale) cc.gradingScale = startScale;
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
    if (cid !== cmSelectedCourse) {
      // A review or a selection belongs to its class.
      cmPendingImport = null;
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
        'Students receive letter grades (A, B, C+, C, C\u2013, F) using BC Ministry of Education percentage cutoffs and conversion tables. All calculations follow the official BC grading scale, so report cards are generated correctly without manual conversion.',
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
          calc_mode: categoryCalcMode(c),
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
                calc_mode: categoryCalcMode(r),
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
    var st = _cmCatState(cid);
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
      '<label class="cm-term-school-label" for="cm-term-school-' +
      cid +
      '">School</label>' +
      '<select class="cm-input cm-term-school-select" id="cm-term-school-' +
      cid +
      '" data-action-change="cmTermSchool">' +
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
        (hasRows ? 'Replace With This School’s Dates' : 'Use This School’s Dates') +
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

  var _cmTermEditing = {}; // cid -> true while Edit Dates is open

  /* Saved terms as tiles: each term's name, dates and report. Edit Dates,
     a change of span or a new school's dates open the editor below. */
  function _cmTermDay(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _cmRenderTermTiles(cid) {
    var st = _cmTermRows(cid);
    var rows = normalizeTermOrdinals(st.rows);
    var match = typeof reportingTermsSchoolMatch === 'function' ? reportingTermsSchoolMatch(rows) : null;
    var reports = typeof reportingTermReportNames === 'function' ? reportingTermReportNames(rows) : null;
    var chosen = _cmTermSchoolId();
    // The school menu offers another school's dates only once a different
    // school is picked.
    var preset = _cmRenderSchoolPreset(cid, true);
    if (match && match.school.id === chosen)
      preset = preset.replace(/<button[^>]*cm-term-school-btn[\s\S]*?<\/button>/, '');
    return (
      '<div class="cm-term-view">' +
      '<div class="cm-hint">The gradebook, dashboard and student pages can show one term at a time. A term counts the assessments dated inside it.</div>' +
      '<div class="cm-term-view-top">' +
      preset +
      _cmRenderTermSpan(cid) +
      '</div>' +
      '<div class="cm-term-tiles">' +
      rows
        .map(function (t, i) {
          return (
            '<div class="cm-term-tile">' +
            '<div class="cm-term-tile-name">' +
            esc(t.label || 'Term ' + t.ordinal) +
            '</div>' +
            '<div class="cm-term-tile-dates">' +
            esc(_cmTermDay(t.starts_on)) +
            ' \u2013 ' +
            esc(_cmTermDay(t.ends_on)) +
            '</div>' +
            (reports && reports[i] ? '<div class="cm-term-tile-report">' + esc(reports[i]) + '</div>' : '') +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="cm-term-view-foot">' +
      '<div class="cm-hint">' +
      (match ? 'Each term ends the day its report is published. ' : '') +
      _cmTermFooterHtml(cid).replace(/<[^>]+>/g, '') +
      '</div>' +
      '<button type="button" class="cm-action-btn" data-action="cmTermEdit">Edit Dates</button>' +
      '</div>' +
      '</div>'
    );
  }

  function _cmRenderReportingTermsField(cid) {
    if (!cid) return '';
    var st = _cmTermRows(cid);
    var rows = st.rows;
    if (rows.length && !st.dirty && !_cmTermEditing[cid]) return _cmRenderTermTiles(cid);
    var html =
      '<div class="cm-field cm-cat-field">' +
      '<label class="cm-label">Reporting Terms</label>' +
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
        ? '<button class="cm-add-link" data-action="cmTermAdd">+ Add Term</button>'
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
      '>Save Terms</button>' +
      '</div>' +
      (getReportingTerms(cid).length
        ? '<button type="button" class="cm-add-link cm-term-cancel" data-action="cmTermCancel">Cancel</button>'
        : '') +
      '</div>';
    return html;
  }

  function cmTermEdit() {
    if (!cmSelectedCourse) return;
    _cmTermEditing[cmSelectedCourse] = true;
    renderClassManager();
  }

  // Cancel drops unsaved edits and goes back to the tiles.
  function cmTermCancel() {
    if (!cmSelectedCourse) return;
    delete _cmTermState[cmSelectedCourse];
    _cmTermEditing[cmSelectedCourse] = false;
    renderClassManager();
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
      '">This Class Runs</span>' +
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
    _cmTermEditing[cid] = false;
    renderClassManager();
  }

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
                ' Categories \u00B7 ' +
                compCount +
                ' Standards</span>' +
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
  /* Everything the class holds, as one JSON file the teacher keeps. */
  function cmDownloadBackup(cid) {
    if (!COURSES[cid]) return;
    var data = {
      course: cid,
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
  function _cmMatch(cands, secs, keys) {
    var pairs = {};
    var used = {};
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
    var live = _cmMatch(cands, secs, CM_MATCH_KEYS);
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
      onlyMine: [],
      same: [],
      showSame: false,
    };
    cands.forEach(function (c, ci) {
      var si = live.pairs[ci];
      if (si == null) {
        var ri = back.pairs[rest.indexOf(ci)];
        review.add.push({ cand: c, removed: ri != null ? removed[ri].section : null, on: true });
        return;
      }
      var sec = secs[si];
      var tag = sec.tags[0];
      var same =
        _cmNorm(_cmCompTitle(sec)) === _cmNorm(c.label) &&
        // A competency with no wording yet differs only if the rest does.
        (!_cmNorm(tag.text) || _cmNorm(tag.text) === _cmNorm(c.text)) &&
        _cmSameList(tag.i_can_statements, c.icans);
      if (same) review.same.push({ sec: sec });
      else review.changed.push({ sec: sec, cand: c, pick: 'mine' });
    });
    secs.forEach(function (sec, i) {
      if (!live.used[i]) review.onlyMine.push({ sec: sec, pick: 'keep' });
    });
    return review;
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
      return {
        code: tag.code || '',
        label: tag.label || '',
        text: tag.text || '',
        source_text: tag.source_text || '',
        icans: (tag.i_can_statements || []).slice(),
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
        return (c ? c.course_name : t) + ' (' + t + ')';
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
          '</span><span class="cm-cr-note">' +
          (a.removed ? 'You removed this from the class earlier. ' : '') +
          _cmIcanNote(n) +
          '.</span></span>' +
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
      remove: r.onlyMine.filter(function (o) {
        return o.pick === 'remove';
      }),
      versionOf: file ? 'use the file\u2019s version of ' : 'use the curriculum version of ',
    };
  }

  function _cmCompReviewCount(r) {
    var p = _cmCompReviewParts(r);
    return p.back.length + p.add.length + p.theirs.length + p.remove.length;
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
      p.theirs.length || p.remove.length
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

  function cmCompReviewApply() {
    var r = cmCompReview;
    if (!r) return;
    var cid = r.cid;
    var p = _cmCompReviewParts(r);

    // Put removed competencies back first: each brings its scores with it.
    p.back.forEach(function (a) {
      restoreCompetency(cid, a.removed.id);
    });

    if (p.add.length || p.theirs.length) {
      var map = ensureCustomLearningMap(cid);
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
      p.add.forEach(function (a) {
        var c = a.cand;
        var sec;
        if (c.section) {
          // From the curriculum: its subject comes along if the class lacks it.
          if (
            c.subject &&
            !map.subjects.some(function (s) {
              return s.id === c.subject.id;
            })
          ) {
            map.subjects.push(structuredClone(c.subject));
          }
          sec = structuredClone(c.section);
          sec.id = freshId(c.section.id);
          sec.tags[0].id = sec.id;
        } else {
          if (!map.subjects.length) map.subjects.push({ id: 'subj1', name: 'General', color: '#6366f1' });
          var sub = map.subjects[0];
          var id = freshId('');
          var label = c.label || c.text.slice(0, 40);
          var short = label.split(' ')[0];
          sec = {
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
          if (c.folder) {
            var grp = map.competencyGroups.find(function (g) {
              return _cmNorm(g.name) === _cmNorm(c.folder);
            });
            if (!grp) {
              var gi = map.competencyGroups.length;
              grp = {
                id: 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                name: c.folder,
                color: '#6366f1',
                sortOrder: gi,
              };
              map.competencyGroups.push(grp);
            }
            sec.groupId = grp.id;
          }
        }
        map.sections.push(sec);
      });
      p.theirs.forEach(function (ch) {
        var sec = map.sections.find(function (s) {
          return s.id === _currentId('section', ch.sec.id);
        });
        if (!sec || !sec.tags[0]) return;
        var tag = sec.tags[0];
        if (ch.cand.label) tag.label = ch.cand.label;
        tag.text = ch.cand.text;
        tag.i_can_statements = ch.cand.icans.slice();
        if (ch.cand.source_text) tag.source_text = ch.cand.source_text;
      });
      map._flatVersion = 2;
      saveLearningMap(cid, map);
    }

    if (p.remove.length) {
      removeCompetencies(
        cid,
        p.remove.map(function (o) {
          return _currentId('section', o.sec.id);
        }),
      );
    }

    if (r.kind !== 'file' && _cmCompReviewLinkChanges(r)) updateCourse(cid, { curriculumTags: r.tags.slice() });

    _cmCloseCompReview();
    cmTab = 'competencies';
    renderClassManager();
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
      var first = menu.querySelector('.cm-std-menu-item');
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
    // Any click other than on a card's More button closes its open menu.
    if (action !== 'cmStdMenu') _cmCloseStdMenus();
    if (action !== 'cmRosterDesigOpen') _cmCloseRosterPicker();
    if (/^sq[A-Z]/.test(action) && typeof CmQuestionnaires !== 'undefined')
      return CmQuestionnaires.handleAction(action, el);
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
      cmDownloadBackup: function () {
        cmDownloadBackup(el.dataset.cid);
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
      cmStdRestoreWording: function () {
        cmStdRestoreWording(el.dataset.secid);
      },
      cmIcanDelete: function () {
        cmIcanDelete(el.dataset.secid, Number(el.dataset.idx));
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
    if (handlers[action]) {
      if (el.tagName !== 'SELECT' && e) e.preventDefault();
      handlers[action]();
      return true;
    }
    return false;
  }

  function handleInput(el) {
    if (el.dataset.actionInput === 'cmRosterSearch') {
      cmRosterSearch(el.value);
      return true;
    }
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
    if (el.dataset.actionInput === 'cmStdCodeLive') {
      cmStdCodeLive(el.dataset.secid, el.value);
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

  function handleChange(el) {
    if (typeof CmQuestionnaires !== 'undefined' && CmQuestionnaires.handleChange(el)) return true;
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
    if (el.dataset.actionChange === 'cmCompGroupColor') {
      cmUpdateCompGroupColor(el.dataset.grpid, el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmRecentLimit') {
      cmSetRecentLimit(el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmCatMode') {
      cmCatMode(parseInt(el.dataset.idx, 10), el.value);
      return true;
    }
    if (el.dataset.actionChange === 'cmPointsScale') {
      cmSavePointsScale();
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
    if (_cmRosterKeydown(e)) return true;
    // Arrow keys move between the class tabs, as in any tab list.
    if (el && el.classList && el.classList.contains('cm-tab') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      var ids = CM_TABS.map(function (t) {
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
    cmSaveStudent();
    return true;
  }

  function handleBlur(el) {
    if (typeof CmQuestionnaires !== 'undefined' && CmQuestionnaires.handleBlur(el)) return true;
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
    // The grading scale a new class starts with for its grade (tests).
    defaultGradingScale: _cmDefaultGradingScale,
    renderClassManager: renderClassManager,
    // The copy step behind the Duplicate Class dialog (block '' = none).
    duplicateCourse: _cmDuplicateCourse,
    handleAction: handleAction,
    // The reporting terms draft as the editor holds it (tests).
    // For tests: the import review a CSV file opens.
    cmShowImportPreview: cmShowImportPreview,
    parseRosterCsv: parseRosterCsv,
    rosterImportTable: rosterImportTable,
    rosterRowsFromTable: rosterRowsFromTable,
    cmCompRowsFromCsv: cmCompRowsFromCsv,
    withdrawnRecordRows: _cmWithdrawnRecordRows,
    // The Edit Student dialog's Parent Email and Parent Email 2.
    guardianEmails: _cmGuardianEmails,
    saveGuardianEmail: _cmSetGuardianEmail,
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
      cmTab = 'details';
      cmSelectedCourse = _activeCourse;
      _activeCourseChanged = false;
      cmEditingStudentId = null;
      cmRosterQuery = '';
      _cmGuardiansLoaded = {};
      _cmGuardiansReady = {};
      _cmGuardiansLoading = {};
      cmPendingImport = null;
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
