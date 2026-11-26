// @ts-check
/* cm-competency-cards.js — Class Settings: a competency's card, and dragging one onto another. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmCompetencyCards = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var CM_GROUP_COLORS,
    _UUID_RE_CM,
    _cmCloseStdMenus,
    _cmLevelsHtml,
    _cmRenderStdSelectRow,
    _cmRenderWithScroll,
    _cmWordingEdit,
    cmHandleCSV,
    cmIcanMove,
    renderClassManager,
    state,
    _addDocListener,
    _currentId;
  function configure(h) {
    if ('CM_GROUP_COLORS' in h) CM_GROUP_COLORS = h.CM_GROUP_COLORS;
    if ('_UUID_RE_CM' in h) _UUID_RE_CM = h._UUID_RE_CM;
    if ('_cmCloseStdMenus' in h) _cmCloseStdMenus = h._cmCloseStdMenus;
    if ('_cmLevelsHtml' in h) _cmLevelsHtml = h._cmLevelsHtml;
    if ('_cmRenderStdSelectRow' in h) _cmRenderStdSelectRow = h._cmRenderStdSelectRow;
    if ('_cmRenderWithScroll' in h) _cmRenderWithScroll = h._cmRenderWithScroll;
    if ('_cmWordingEdit' in h) _cmWordingEdit = h._cmWordingEdit;
    if ('cmHandleCSV' in h) cmHandleCSV = h.cmHandleCSV;
    if ('cmIcanMove' in h) cmIcanMove = h.cmIcanMove;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_addDocListener' in h) _addDocListener = h._addDocListener;
    if ('_currentId' in h) _currentId = h._currentId;
  }

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

  function _cmBankPlace(bankId) {
    if (!CURRICULUM_INDEX) {
      if (!state._cmBankLoading && typeof loadCurriculumIndex === 'function') {
        state._cmBankLoading = true;
        loadCurriculumIndex().then(function (idx) {
          state._cmBankLoading = false;
          if (idx && state.classManagerOpen && state.cmMode === 'edit') _cmRenderWithScroll();
        });
      }
      return null;
    }
    if (!state._cmBankPlaces || state._cmBankPlacesOf !== CURRICULUM_INDEX) {
      state._cmBankPlaces = {};
      state._cmBankPlacesOf = CURRICULUM_INDEX;
      Object.keys(CURRICULUM_INDEX).forEach(function (key) {
        var course = /** @type {any} */ (CURRICULUM_INDEX)[key];
        (course.categories || []).forEach(function (cat) {
          var path = Array.isArray(cat.path) ? cat.path : cat.folder ? [cat.name] : [];
          (cat.competencies || []).forEach(function (comp) {
            if (comp.id) state._cmBankPlaces[comp.id] = { course: course.course_name, path: path };
          });
        });
      });
    }
    return state._cmBankPlaces[bankId] || null;
  }

  function _cmRenderStdCard(sec, lm, compGroups) {
    if (state.cmCompSelect) return _cmRenderStdSelectRow(sec);
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

  function _cmStdCardOpen(secId) {
    return (
      !!state._cmOpenStdCards[secId] ||
      Object.keys(state._cmOpenStdCards).some(function (k) {
        return state._cmOpenStdCards[k] && k !== secId && _currentId('section', k) === secId;
      })
    );
  }

  function cmToggleStdCard(secId) {
    var open = !_cmStdCardOpen(secId);
    // Forget the key it was opened under before its id was re-keyed.
    Object.keys(state._cmOpenStdCards).forEach(function (k) {
      if (_currentId('section', k) === secId) delete state._cmOpenStdCards[k];
    });
    state._cmOpenStdCards[secId] = open;
    var card = document.getElementById('cm-std-' + secId);
    if (card) card.classList.toggle('open', open);
  }

  function cmToggleStdFolder(uid) {
    state._cmCollapsedStdFolders[uid] = !state._cmCollapsedStdFolders[uid];
    var folder = document.querySelector('.mod-folder[data-module-id="' + uid + '"]');
    if (folder) folder.classList.toggle('open', !state._cmCollapsedStdFolders[uid]);
  }

  function _cmClearMerge() {
    if (state._cmMergeHoverTimer) {
      clearTimeout(state._cmMergeHoverTimer);
      state._cmMergeHoverTimer = null;
    }
    if (state._cmMergeTargetId) {
      var el = document.getElementById('cm-std-' + state._cmMergeTargetId);
      if (el) el.classList.remove('merge-target');
    }
    state._cmMergeTargetId = null;
    state._cmMergeAnimating = false;
  }

  function _cmMergeToNewGroup(draggedId, targetId) {
    draggedId = _currentId('section', draggedId);
    targetId = _currentId('section', targetId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
        /** @type {any} */ (input).focus();
        /** @type {any} */ (input).select();
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
        state._cmIcanDrag = { secId: grip.dataset.secid, idx: Number(grip.dataset.idx) };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'ican');
        var row = grip.closest('.cm-ican-row');
        if (row) row.classList.add('dragging');
        return;
      }
      var card = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (!card) return;
      state._cmDragStdId = card.dataset.stdDrag;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', state._cmDragStdId);
    });
    _addDocListener('dragover', function (e) {
      if (state._cmIcanDrag) {
        var over = e.target.closest && e.target.closest('.cm-ican-row[data-idx]');
        var list = over && over.closest('.cm-ican-list');
        document.querySelectorAll('.cm-ican-row.drop-target').forEach(function (r) {
          if (r !== over) r.classList.remove('drop-target');
        });
        if (over && list && list.dataset.secid === state._cmIcanDrag.secId) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          over.classList.add('drop-target');
        }
        return;
      }
      if (!state._cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard) {
        var targetId = targetCard.dataset.stdDrag;
        if (targetId !== state._cmDragStdId) {
          var map = state.cmSelectedCourse ? getLearningMap(state.cmSelectedCourse) : null;
          var targetSec =
            map &&
            (map.sections || []).find(function (s) {
              return s.id === targetId;
            });
          if (targetSec && !targetSec.groupId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (state._cmMergeTargetId === targetId) return;
            _cmClearMerge();
            state._cmMergeTargetId = targetId;
            state._cmMergeHoverTimer = setTimeout(function () {
              state._cmMergeAnimating = true;
              var el = document.getElementById('cm-std-' + targetId);
              if (el) el.classList.add('merge-target');
            }, 300);
            return;
          }
        }
      } else {
        if (state._cmMergeTargetId) _cmClearMerge();
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
      if (!state._cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && !targetCard.contains(e.relatedTarget)) {
        if (state._cmMergeTargetId === targetCard.dataset.stdDrag) _cmClearMerge();
        return;
      }
      var folder = e.target.closest && e.target.closest('.mod-folder[data-folder-drop]');
      if (folder && !folder.contains(e.relatedTarget)) folder.classList.remove('drag-over');
    });
    _addDocListener('drop', function (e) {
      if (state._cmIcanDrag) {
        var onto = e.target.closest && e.target.closest('.cm-ican-row[data-idx]');
        var drag = state._cmIcanDrag;
        state._cmIcanDrag = null;
        if (!onto) return;
        e.preventDefault();
        cmIcanMove(drag.secId, drag.idx, Number(onto.dataset.idx));
        return;
      }
      if (!state._cmDragStdId) return;
      var targetCard = e.target.closest && e.target.closest('.cm-std-card[data-std-drag]');
      if (targetCard && state._cmMergeAnimating && state._cmMergeTargetId === targetCard.dataset.stdDrag) {
        e.preventDefault();
        e.stopPropagation();
        _cmMergeToNewGroup(state._cmDragStdId, targetCard.dataset.stdDrag);
        _cmClearMerge();
        state._cmDragStdId = null;
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
      if (state.cmSelectedCourse) {
        var map = ensureCustomLearningMap(state.cmSelectedCourse);
        var dragId = _currentId('section', state._cmDragStdId);
        if (targetGroupId) targetGroupId = _currentId('group', targetGroupId);
        var sec = (map.sections || []).find(function (s) {
          return s.id === dragId;
        });
        if (sec) {
          if (targetGroupId) sec.groupId = targetGroupId;
          else delete sec.groupId;
          saveLearningMap(state.cmSelectedCourse, map);
          renderClassManager();
        }
      }
      state._cmDragStdId = null;
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
        c.classList.remove('dragging');
      });
    });
    _addDocListener('dragend', function () {
      state._cmIcanDrag = null;
      document.querySelectorAll('.cm-ican-row.dragging, .cm-ican-row.drop-target').forEach(function (r) {
        r.classList.remove('dragging', 'drop-target');
      });
      state._cmDragStdId = null;
      _cmClearMerge();
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (f) {
        f.classList.remove('drag-over');
      });
      document.querySelectorAll('.cm-std-card.dragging').forEach(function (c) {
        c.classList.remove('dragging');
      });
    });
  }

  return {
    configure: configure,
    _cmRenderStdCard: _cmRenderStdCard,
    _cmStdCode: _cmStdCode,
    _initCmStdDrag: _initCmStdDrag,
    cmToggleStdCard: cmToggleStdCard,
    cmToggleStdFolder: cmToggleStdFolder,
  };
})();
