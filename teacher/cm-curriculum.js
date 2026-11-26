// @ts-check
/* cm-curriculum.js — Class Settings: editing the curriculum. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmCurriculum = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var CM_COLORS,
    CM_GROUP_COLORS,
    renderClassManager,
    state,
    _cmOpenCompReview,
    _cmRemoveMessage,
    _cmStdCode,
    _currentId;
  function configure(h) {
    if ('CM_COLORS' in h) CM_COLORS = h.CM_COLORS;
    if ('CM_GROUP_COLORS' in h) CM_GROUP_COLORS = h.CM_GROUP_COLORS;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_cmOpenCompReview' in h) _cmOpenCompReview = h._cmOpenCompReview;
    if ('_cmRemoveMessage' in h) _cmRemoveMessage = h._cmRemoveMessage;
    if ('_cmStdCode' in h) _cmStdCode = h._cmStdCode;
    if ('_currentId' in h) _currentId = h._currentId;
  }

  /* ── CM Curriculum Editing ──────────────────────────────── */
  function cmAddSubject() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var id = 'subj' + Date.now().toString(36);
    map.subjects.push({ id: id, name: 'New Subject', color: '#6366f1' });
    saveLearningMap(cid, map);
    renderClassManager();
  }

  function cmUpdateSubjectName(subId, val) {
    subId = _currentId('subject', subId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var map = ensureCustomLearningMap(state.cmSelectedCourse);
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
    saveLearningMap(state.cmSelectedCourse, map);
    renderClassManager();
  }

  function cmDeleteSubject(subId) {
    subId = _currentId('subject', subId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    var map = state.cmSelectedCourse && getLearningMap(state.cmSelectedCourse);
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    state._cmOpenStdCards[stdId] = true;
    renderClassManager();
    requestAnimationFrame(function () {
      var id = _currentId('section', stdId);
      var card = document.getElementById('cm-std-' + id);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var title = document.getElementById('cm-std-title-' + id);
      if (title) {
        title.focus({ preventScroll: true });
        if (typeof (/** @type {any} */ (title).select) === 'function') /** @type {any} */ (title).select();
      }
    });
  }

  function cmUpdateStdName(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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

  var CM_COMP_CSV_HEADER = ['Code', 'Title', 'Curricular Competency', 'I Can Statements', 'Folder'];

  function _cmRenderCompToolbar(cid, lm, compGroups) {
    var secs = lm.sections || [];
    if (state.cmCompSelect) {
      var n = secs.filter(function (s) {
        return state.cmCompSelected[s.id];
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
    var on = !!state.cmCompSelected[sec.id];
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
    state.cmCompSelect = true;
    state.cmCompSelected = {};
    renderClassManager();
  }

  function cmCompSelectDone() {
    state.cmCompSelect = false;
    state.cmCompSelected = {};
    renderClassManager();
  }

  function cmCompSelectAll() {
    (getLearningMap(state.cmSelectedCourse).sections || []).forEach(function (s) {
      state.cmCompSelected[s.id] = true;
    });
    _cmRenderAndFocus('[data-action="cmCompSelectAll"]');
  }

  function cmCompToggle(secId, on) {
    if (on) state.cmCompSelected[secId] = true;
    else delete state.cmCompSelected[secId];
    _cmRenderAndFocus('[data-action-change="cmCompToggle"][data-secid=' + _cmAttr(secId) + ']');
  }

  function _cmCompSelectedSections() {
    return (getLearningMap(state.cmSelectedCourse).sections || []).filter(function (s) {
      return state.cmCompSelected[s.id];
    });
  }

  function cmCompMove(groupId) {
    var cid = state.cmSelectedCourse;
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
        state.cmSelectedCourse,
        secs.map(function (s) {
          return s.id;
        }),
        'Remove ' + _cmJoinNames(names, 'competencies') + ' from the class?',
      ),
      'Remove',
      'danger',
      function () {
        removeCompetencies(
          state.cmSelectedCourse,
          secs.map(function (s) {
            return _currentId('section', s.id);
          }),
        );
        state.cmCompSelected = {};
        if (!(getLearningMap(state.cmSelectedCourse).sections || []).length) state.cmCompSelect = false;
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
    var cid = state.cmSelectedCourse;
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
    if (!file || !state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var reader = new FileReader();
    reader.onload = function (e) {
      input.value = '';
      var cands = cmCompRowsFromCsv(/** @type {any} */ (e.target).result);
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

  return {
    configure: configure,
    _cmAttr: _cmAttr,
    _cmCompTitle: _cmCompTitle,
    _cmJoinNames: _cmJoinNames,
    _cmRenderAndFocus: _cmRenderAndFocus,
    _cmRenderCompToolbar: _cmRenderCompToolbar,
    _cmRenderStdSelectRow: _cmRenderStdSelectRow,
    _cmRenderWithScroll: _cmRenderWithScroll,
    cmAddCompGroup: cmAddCompGroup,
    cmAddStd: cmAddStd,
    cmAddSubject: cmAddSubject,
    cmCompCSV: cmCompCSV,
    cmCompExport: cmCompExport,
    cmCompImport: cmCompImport,
    cmCompMove: cmCompMove,
    cmCompRemoveSelected: cmCompRemoveSelected,
    cmCompRowsFromCsv: cmCompRowsFromCsv,
    cmCompSelectAll: cmCompSelectAll,
    cmCompSelectDone: cmCompSelectDone,
    cmCompSelectStart: cmCompSelectStart,
    cmCompToggle: cmCompToggle,
    cmDeleteCompGroup: cmDeleteCompGroup,
    cmDeleteSubject: cmDeleteSubject,
    cmOpenGroupColorPop: cmOpenGroupColorPop,
    cmPickColor: cmPickColor,
    cmToggleColorPalette: cmToggleColorPalette,
    cmUpdateCompGroupName: cmUpdateCompGroupName,
    cmUpdateStdColor: cmUpdateStdColor,
    cmUpdateStdGroup: cmUpdateStdGroup,
    cmUpdateStdName: cmUpdateStdName,
    cmUpdateStdSubject: cmUpdateStdSubject,
    cmUpdateSubjectColor: cmUpdateSubjectColor,
    cmUpdateSubjectName: cmUpdateSubjectName,
  };
})();
