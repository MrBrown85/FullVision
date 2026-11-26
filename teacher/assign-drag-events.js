// @ts-check
/* assign-drag-events.js — Assignments: drag and hover handlers. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignDragEvents = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var AC,
    _canStack,
    _clearDropMarker,
    _clearMergeState,
    _hasNameTip,
    _hideChipTip,
    _queueNameTip,
    _setDropMarker,
    _showChipTip,
    mergeToNewModule,
    onAssessDragEnd,
    onAssessDragStart,
    onFolderDrop,
    onModuleDragEnd,
    onModuleDragStart,
    onModuleDropZoneDrop,
    pageState,
    reorderAssessment,
    collabDragStart,
    collabDrop;
  function configure(h) {
    if ('AC' in h) AC = h.AC;
    if ('_canStack' in h) _canStack = h._canStack;
    if ('_clearDropMarker' in h) _clearDropMarker = h._clearDropMarker;
    if ('_clearMergeState' in h) _clearMergeState = h._clearMergeState;
    if ('_hasNameTip' in h) _hasNameTip = h._hasNameTip;
    if ('_hideChipTip' in h) _hideChipTip = h._hideChipTip;
    if ('_queueNameTip' in h) _queueNameTip = h._queueNameTip;
    if ('_setDropMarker' in h) _setDropMarker = h._setDropMarker;
    if ('_showChipTip' in h) _showChipTip = h._showChipTip;
    if ('mergeToNewModule' in h) mergeToNewModule = h.mergeToNewModule;
    if ('onAssessDragEnd' in h) onAssessDragEnd = h.onAssessDragEnd;
    if ('onAssessDragStart' in h) onAssessDragStart = h.onAssessDragStart;
    if ('onFolderDrop' in h) onFolderDrop = h.onFolderDrop;
    if ('onModuleDragEnd' in h) onModuleDragEnd = h.onModuleDragEnd;
    if ('onModuleDragStart' in h) onModuleDragStart = h.onModuleDragStart;
    if ('onModuleDropZoneDrop' in h) onModuleDropZoneDrop = h.onModuleDropZoneDrop;
    if ('pageState' in h) pageState = h.pageState;
    if ('reorderAssessment' in h) reorderAssessment = h.reorderAssessment;
    if ('collabDragStart' in h) collabDragStart = h.collabDragStart;
    if ('collabDrop' in h) collabDrop = h.collabDrop;
  }

  /* ── Drag event handlers (delegated) ────────────────────── */
  function _handleDragStart(e) {
    // Collab drag must be checked FIRST — members are nested inside assess cards
    var collabDrag = e.target.closest('[data-collab-drag-sid]');
    if (collabDrag) {
      collabDragStart(e, collabDrag.dataset.collabDragSid, parseInt(collabDrag.dataset.collabDragGroup, 10));
      return;
    }
    var assessDrag = e.target.closest('[data-assess-drag]');
    if (assessDrag) {
      onAssessDragStart(e, assessDrag.dataset.assessDrag);
      return;
    }
    var moduleDrag = e.target.closest('[data-module-drag]');
    if (moduleDrag) {
      onModuleDragStart(e, moduleDrag.dataset.moduleDrag);
      return;
    }
  }
  function _handleDragEnd(e) {
    // A student dropped nowhere, or back where they were, comes back into view.
    AC.collabDragEnd();
    if (pageState._dragAssessId) {
      onAssessDragEnd();
      return;
    }
    if (pageState._dragModuleId) {
      onModuleDragEnd();
      return;
    }
    pageState._dragSid = null;
    pageState._dragFromGroup = null;
  }
  function _handleDragOver(e) {
    // Module drop zone
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone && pageState._dragModuleId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      dropZone.classList.add('drag-over');
      return;
    }
    // Over a card: reorder (check BEFORE folder drop — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop && pageState._dragAssessId && !pageState._dragModuleId) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.mod-folder.drag-over').forEach(function (el) {
        el.classList.remove('drag-over');
      });
      var targetId = cardDrop.dataset.assessCardDrop;
      if (targetId === pageState._dragAssessId) {
        _clearDropMarker();
        _clearMergeState();
        return;
      }
      var rect = cardDrop.getBoundingClientRect();
      var y = e.clientY - rect.top;
      if (y > rect.height / 3 && y < (rect.height * 2) / 3 && _canStack(pageState._dragAssessId, targetId)) {
        // Middle third: hold to stack the two into a new module.
        _clearDropMarker();
        if (pageState._mergeTargetId === targetId) return;
        _clearMergeState();
        pageState._mergeTargetId = targetId;
        pageState._mergeHoverTimer = setTimeout(function () {
          pageState._mergeAnimating = true;
          var el = document.getElementById('ac-' + targetId);
          if (el) el.classList.add('merge-target');
        }, 300);
        return;
      }
      // Top or bottom: reorder.
      if (pageState._mergeTargetId) _clearMergeState();
      _setDropMarker(cardDrop, y > rect.height / 2);
      return;
    }
    // Folder drop
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && !pageState._dragModuleId && pageState._dragAssessId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!folderDrop.classList.contains('drag-over')) folderDrop.classList.add('drag-over');
      return;
    }
    // Collab group drop
    var collabDrop = e.target.closest('[data-collab-drop]');
    if (collabDrop) {
      e.preventDefault();
      collabDrop.classList.add('drag-over');
      return;
    }
  }
  function _handleDragLeave(e) {
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone) {
      dropZone.classList.remove('drag-over');
      return;
    }
    // Card leave (check before folder — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop) {
      if (cardDrop.contains(e.relatedTarget)) return;
      cardDrop.classList.remove('drop-before', 'drop-after');
      if (pageState._mergeTargetId === cardDrop.dataset.assessCardDrop) _clearMergeState();
      return;
    }
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && !folderDrop.contains(e.relatedTarget)) {
      folderDrop.classList.remove('drag-over');
      return;
    }
    var collabDrop = e.target.closest('[data-collab-drop]');
    if (collabDrop) {
      collabDrop.classList.remove('drag-over');
      return;
    }
  }
  function _handleDrop(e) {
    // Module drop zone
    var dropZone = e.target.closest('[data-mod-drop-zone]');
    if (dropZone && pageState._dragModuleId) {
      onModuleDropZoneDrop(e, parseInt(dropZone.dataset.dropIndex, 10));
      return;
    }
    // Card drop: reorder (check before folder — cards are inside folders)
    var cardDrop = e.target.closest('[data-assess-card-drop]');
    if (cardDrop && pageState._dragAssessId && !pageState._dragModuleId) {
      e.preventDefault();
      e.stopPropagation();
      var dragId = pageState._dragAssessId;
      var stackOn = pageState._mergeAnimating && pageState._mergeTargetId === cardDrop.dataset.assessCardDrop;
      var after = cardDrop.classList.contains('drop-after');
      var placed = after || cardDrop.classList.contains('drop-before');
      _clearDropMarker();
      _clearMergeState();
      pageState._dragAssessId = null;
      if (stackOn && dragId !== cardDrop.dataset.assessCardDrop) {
        mergeToNewModule(dragId, cardDrop.dataset.assessCardDrop);
        return;
      }
      if (placed && dragId !== cardDrop.dataset.assessCardDrop)
        reorderAssessment(dragId, cardDrop.dataset.assessCardDrop, after);
      return;
    }
    // Folder drop
    var folderDrop = e.target.closest('[data-folder-drop]');
    if (folderDrop && pageState._dragAssessId) {
      folderDrop.classList.remove('drag-over');
      onFolderDrop(e, folderDrop.dataset.folderDrop);
      return;
    }
    // Collab drop
    var collabDropEl = e.target.closest('[data-collab-drop]');
    if (collabDropEl) {
      collabDrop(e, parseInt(collabDropEl.dataset.collabDrop, 10));
      return;
    }
  }

  /* ── Mouseenter/mouseleave for rubric tooltips ──────────── */
  function _handleMouseOver(e) {
    var chip = e.target.closest('[data-chip-tip]');
    if (chip && chip !== pageState._chipTipSource) _showChipTip(chip);
    var nameLabel = e.target.closest('.rsg-criterion-label');
    if (nameLabel && nameLabel !== pageState._chipTipSource && Date.now() - pageState._lastTouch > 800)
      _queueNameTip(nameLabel);
  }
  function _handleMouseOut(e) {
    var chip = e.target.closest('[data-chip-tip]');
    if (chip && chip === pageState._chipTipSource && !(e.relatedTarget && chip.contains(e.relatedTarget)))
      _hideChipTip();
    var nameLabel = e.target.closest('.rsg-criterion-label');
    if (nameLabel && !(e.relatedTarget && nameLabel.contains(e.relatedTarget))) {
      clearTimeout(pageState._nameTipTimer);
      // A tap's emulated mouseout (a mouse pointer left elsewhere) is not
      // the finger leaving: the tip a tap showed stays until the next tap.
      if (nameLabel === pageState._chipTipSource && Date.now() - pageState._lastTouch > 800) _hideChipTip();
    }
  }

  /* "New Rubric" and "Criterion 2" are real names, so a rubric or criterion
     saved untouched still has one. Typing used to go in front of them ("Lab
     Report RubricNew Rubric"); the default name is now selected when its box
     gets the focus, so typing replaces it (Nov 3 sweep). */
  var DEFAULT_NAME_RE = /^(New Rubric|Criterion \d+)$/;
  function _selectDefaultName(e) {
    var t = e.target;
    if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') || !DEFAULT_NAME_RE.test(t.value)) return;
    if (!t.closest('#rubric-modal, #new-assess-form')) return;
    t.select();
    // A click that gave the focus would put the caret back on mouseup.
    var keep = function (ev) {
      if (ev.target === t) ev.preventDefault();
    };
    t.addEventListener('mouseup', keep, { once: true });
    setTimeout(function () {
      t.removeEventListener('mouseup', keep);
    }, 500);
  }

  function _handlePointerDown(e) {
    var nameLabel = e.target.closest && e.target.closest('.rsg-criterion-label');
    if (pageState._chipTipSource && pageState._chipTipSource.classList.contains('rsg-criterion-label')) _hideChipTip();
    else if (nameLabel && e.pointerType === 'touch' && _hasNameTip(nameLabel)) _showChipTip(nameLabel);
    if (e.pointerType === 'touch') pageState._lastTouch = Date.now();
  }

  return {
    configure: configure,
    _handleDragEnd: _handleDragEnd,
    _handleDragLeave: _handleDragLeave,
    _handleDragOver: _handleDragOver,
    _handleDragStart: _handleDragStart,
    _handleDrop: _handleDrop,
    _handleMouseOut: _handleMouseOut,
    _handleMouseOver: _handleMouseOver,
    _handlePointerDown: _handlePointerDown,
    _selectDefaultName: _selectDefaultName,
  };
})();
