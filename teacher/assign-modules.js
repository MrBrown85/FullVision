// @ts-check
/* assign-modules.js — Assignments: folders, and dragging them. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignModules = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var MODULE_COLORS, pageState, render, _saveClosedModules, sortAssessmentsForList;
  function configure(h) {
    if ('MODULE_COLORS' in h) MODULE_COLORS = h.MODULE_COLORS;
    if ('pageState' in h) pageState = h.pageState;
    if ('render' in h) render = h.render;
    if ('_saveClosedModules' in h) _saveClosedModules = h._saveClosedModules;
    if ('sortAssessmentsForList' in h) sortAssessmentsForList = h.sortAssessmentsForList;
  }

  /* ── Module management ──────────────────────────────────── */
  function updateModuleName(moduleId, name) {
    var cid = pageState.activeCourse;
    var modules = getModules(cid);
    var u = modules.find(function (x) {
      return x.id === moduleId;
    });
    if (u && name.trim() && name.trim() !== u.name) {
      u.name = name.trim();
      saveModules(cid, modules);
    }
    return u ? u.name : name;
  }
  function _moduleNameSaved(input) {
    var u = getModules(pageState.activeCourse).find(function (x) {
      return x.id === input.dataset.moduleid;
    });
    return u ? u.name : input.value;
  }
  /* A folder moves only from its grip (AssignDragEvents._handlePointerDown), so editing its name never makes
     the folder draggable: turning it back on here made the whole folder draggable again after a rename. */
  function _setModuleDraggable(input, on) {
    var folder = input.closest('.mod-folder');
    if (folder && !on) folder.draggable = false;
  }
  function updateModuleColor(moduleId, color) {
    var cid = pageState.activeCourse;
    var modules = getModules(cid);
    var u = modules.find(function (x) {
      return x.id === moduleId;
    });
    if (u) {
      u.color = color;
      saveModules(cid, modules);
      render();
    }
  }
  /* Module colour: the swatch opens the shared colour popover (ui.js). */
  function openModuleColorPop(swatch) {
    var moduleId = swatch.dataset.moduleid;
    var u = getModules(pageState.activeCourse).find(function (x) {
      return x.id === moduleId;
    });
    if (!u) return;
    openColorPop(swatch, {
      key: 'module:' + moduleId,
      colors: MODULE_COLORS,
      current: u.color || '#6366f1',
      label: 'Module colour',
      findSwatch: function () {
        return document.querySelector('.mod-folder-color[data-moduleid="' + moduleId + '"]');
      },
      onPick: function (color) {
        updateModuleColor(moduleId, color);
      },
    });
  }
  function deleteModule(moduleId, assessCount) {
    var msg =
      assessCount > 0
        ? assessCount + ' assessment(s) use this module. They will move to Ungrouped Assignments. Delete anyway?'
        : 'Delete this module?';
    showConfirm('Delete Module', msg, 'Delete', 'danger', function () {
      var cid = pageState.activeCourse;
      saveModules(
        cid,
        getModules(cid).filter(function (u) {
          return u.id !== moduleId;
        }),
      );
      var assessments = getAssessments(cid);
      assessments.forEach(function (a) {
        if (a.moduleId === moduleId) delete a.moduleId;
      });
      saveAssessments(cid, assessments);
      render();
    });
  }
  // A folder opened or closed by its header, with its motion (teacher/expand-motion.js).
  function _showFolderOpen(folder, open) {
    if (window.ExpandMotion) ExpandMotion.toggle(folder, folder.querySelector('.mod-folder-body'), open, 'is-closing');
    else folder.classList.toggle('open', open);
  }
  function toggleModuleFolder(moduleId) {
    var folder = document.querySelector('.mod-folder[data-module-id="' + moduleId + '"]');
    // The header acts on what the teacher sees: a module shown open closes,
    // even one open only because it holds an open card or a search is on.
    var shownOpen = folder ? folder.classList.contains('open') : !pageState.collapsedModules[moduleId];
    if (pageState.filterCategories.length > 0 || pageState.showUngraded || !!pageState.assessSearch) {
      // A search or filter's open/closed is for now; the saved state stays.
      pageState._filterClosedModules[moduleId] = shownOpen;
      if (folder) _showFolderOpen(folder, !shownOpen);
      return;
    }
    pageState.collapsedModules[moduleId] = shownOpen;
    _saveClosedModules();
    // Closing a module closes the cards in it, so the next redraw doesn't
    // open it again to show them.
    var closedCards = false;
    if (shownOpen && folder) {
      folder.querySelectorAll('.assess-card.open').forEach(function (card) {
        if (pageState.openAssessIds.delete(card.id.replace(/^ac-/, ''))) closedCards = true;
      });
    }
    if (closedCards) render();
    else if (folder) _showFolderOpen(folder, !shownOpen);
  }

  function addModuleInline() {
    var cid = pageState.activeCourse;
    var modules = getModules(cid);
    var idx = modules.length;
    var color = MODULE_COLORS[idx % MODULE_COLORS.length];
    var newModule = {
      id: uid(),
      name: 'Module ' + (idx + 1),
      color: color,
      sortOrder: idx,
      created: new Date().toISOString(),
    };
    modules.push(newModule);
    saveModules(cid, modules);
    pageState.collapsedModules[newModule.id] = false;
    render();
    setTimeout(function () {
      var input = /** @type {any} */ (
        document.querySelector('.mod-folder[data-module-id="' + newModule.id + '"] .mod-folder-name-input')
      );
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  /* ── Drag & Drop — modules and assessments ──────────────── */
  function onModuleDragStart(event, moduleId) {
    pageState._dragModuleId = moduleId;
    pageState._dragAssessId = null;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/module-id', moduleId);
    setTimeout(function () {
      var el = document.querySelector('.mod-folder[data-module-id="' + moduleId + '"]');
      if (el) el.classList.add('dragging');
    }, 0);
  }
  function onModuleDragEnd() {
    pageState._dragModuleId = null;
    document.querySelectorAll('.mod-folder.dragging').forEach(function (el) {
      el.classList.remove('dragging');
    });
    document.querySelectorAll('.mod-drop-zone.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
  }
  function onModuleDropZoneDrop(event, targetIndex) {
    event.preventDefault();
    // The drop listener is on the document, so the event's own target element is not the zone.
    document.querySelectorAll('.mod-drop-zone.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
    var moduleId = pageState._dragModuleId || event.dataTransfer.getData('application/module-id');
    if (!moduleId) return;
    var cid = pageState.activeCourse;
    var modules = getModules(cid);
    var fromIndex = modules.findIndex(function (u) {
      return u.id === moduleId;
    });
    if (fromIndex < 0) return;
    var moved = modules.splice(fromIndex, 1)[0];
    var insertAt = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
    modules.splice(insertAt, 0, moved);
    // The saved order is sortOrder, not the array position: renumber so the
    // move is written and the class reloads in this order.
    modules.forEach(function (u, i) {
      u.sortOrder = i;
    });
    saveModules(cid, modules);
    pageState._dragModuleId = null;
    render();
  }
  function onAssessDragStart(event, assessId) {
    event.stopPropagation();
    pageState._dragAssessId = assessId;
    pageState._dragModuleId = null;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', assessId);
    setTimeout(function () {
      var el = document.getElementById('ac-' + assessId);
      if (el) el.classList.add('dragging');
    }, 0);
  }
  function onAssessDragEnd() {
    pageState._dragAssessId = null;
    _clearDropMarker();
    _clearMergeState();
    document.querySelectorAll('.assess-card.dragging').forEach(function (el) {
      el.classList.remove('dragging');
    });
    document.querySelectorAll('.mod-folder.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
  }
  function onFolderDrop(event, targetModuleId) {
    if (pageState._dragModuleId) return;
    event.preventDefault();
    var assessId = event.dataTransfer.getData('text/plain') || pageState._dragAssessId;
    if (!assessId) return;
    var cid = pageState.activeCourse;
    var assessments = getAssessments(cid);
    var a = assessments.find(function (x) {
      return x.id === assessId;
    });
    if (!a) return;
    if (targetModuleId === '__none__') delete a.moduleId;
    else a.moduleId = targetModuleId;
    saveAssessments(cid, assessments);
    pageState._dragAssessId = null;
    render();
  }
  function _clearMergeState() {
    if (pageState._mergeHoverTimer) {
      clearTimeout(pageState._mergeHoverTimer);
      pageState._mergeHoverTimer = null;
    }
    if (pageState._mergeTargetId) {
      var el = document.getElementById('ac-' + pageState._mergeTargetId);
      if (el) el.classList.remove('merge-target');
    }
    pageState._mergeTargetId = null;
    pageState._mergeAnimating = false;
  }
  function mergeToNewModule(draggedId, targetId) {
    var cid = pageState.activeCourse;
    var modules = getModules(cid);
    var idx = modules.length;
    var color = MODULE_COLORS[idx % MODULE_COLORS.length];
    var newModule = {
      id: uid(),
      name: 'Module ' + (idx + 1),
      color: color,
      sortOrder: idx,
      created: new Date().toISOString(),
    };
    modules.push(newModule);
    saveModules(cid, modules);
    var assessments = getAssessments(cid);
    [draggedId, targetId].forEach(function (aid) {
      var a = assessments.find(function (x) {
        return x.id === aid;
      });
      if (a) a.moduleId = newModule.id;
    });
    saveAssessments(cid, assessments);
    pageState.collapsedModules[newModule.id] = false;
    render();
    setTimeout(function () {
      var input = /** @type {any} */ (
        document.querySelector('.mod-folder[data-module-id="' + newModule.id + '"] .mod-folder-name-input')
      );
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  }

  /* ── Reordering by drag ─────────────────────────────────────
     Over a card's top or bottom third, a blue line shows where the dragged
     card will land, before or after it. Held over the middle third of an
     unfiled card, the two stack into a new module instead. */
  // Stacking makes a new module, so it only joins two cards that are not in one.
  function _canStack(dragId, targetId) {
    var assessments = getAssessments(pageState.activeCourse);
    var a = assessments.find(function (x) {
      return x.id === dragId;
    });
    var b = assessments.find(function (x) {
      return x.id === targetId;
    });
    return !!(a && b && !a.moduleId && !b.moduleId);
  }
  function _clearDropMarker() {
    document.querySelectorAll('.assess-card.drop-before, .assess-card.drop-after').forEach(function (el) {
      el.classList.remove('drop-before', 'drop-after');
    });
  }
  function _setDropMarker(card, after) {
    var want = after ? 'drop-after' : 'drop-before';
    if (card.classList.contains(want)) return;
    _clearDropMarker();
    card.classList.add(want);
  }
  // Moves the dragged assessment before or after the target and numbers the
  // whole list 1..n. Dropped beside a card in another module, it joins that module.
  function reorderAssessment(dragId, targetId, after) {
    var cid = pageState.activeCourse;
    var assessments = getAssessments(cid);
    var ordered = sortAssessmentsForList(assessments);
    var dragged = ordered.find(function (x) {
      return x.id === dragId;
    });
    var target = ordered.find(function (x) {
      return x.id === targetId;
    });
    if (!dragged || !target || dragged === target) return;
    ordered = ordered.filter(function (x) {
      return x !== dragged;
    });
    ordered.splice(ordered.indexOf(target) + (after ? 1 : 0), 0, dragged);
    if ((dragged.moduleId || '') !== (target.moduleId || '')) {
      if (target.moduleId) dragged.moduleId = target.moduleId;
      else delete dragged.moduleId;
    }
    ordered.forEach(function (x, i) {
      x.display_order = i + 1;
    });
    saveAssessments(cid, assessments);
    render();
  }

  return {
    configure: configure,
    _canStack: _canStack,
    _clearDropMarker: _clearDropMarker,
    _clearMergeState: _clearMergeState,
    _moduleNameSaved: _moduleNameSaved,
    _setDropMarker: _setDropMarker,
    _setModuleDraggable: _setModuleDraggable,
    addModuleInline: addModuleInline,
    deleteModule: deleteModule,
    mergeToNewModule: mergeToNewModule,
    onAssessDragEnd: onAssessDragEnd,
    onAssessDragStart: onAssessDragStart,
    onFolderDrop: onFolderDrop,
    onModuleDragEnd: onModuleDragEnd,
    onModuleDragStart: onModuleDragStart,
    onModuleDropZoneDrop: onModuleDropZoneDrop,
    openModuleColorPop: openModuleColorPop,
    reorderAssessment: reorderAssessment,
    toggleModuleFolder: toggleModuleFolder,
    updateModuleName: updateModuleName,
  };
})();
