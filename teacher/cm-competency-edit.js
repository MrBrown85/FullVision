// @ts-check
/* cm-competency-edit.js — Class Settings: editing one competency (wording, levels, I Can, code, tags). Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmCompetencyEdit = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var _cmFloatOverScroll, _cmLevelsEdit, _cmWordingEdit, renderClassManager, state, _cmRemoveMessage, _currentId;
  function configure(h) {
    if ('_cmFloatOverScroll' in h) _cmFloatOverScroll = h._cmFloatOverScroll;
    if ('_cmLevelsEdit' in h) _cmLevelsEdit = h._cmLevelsEdit;
    if ('_cmWordingEdit' in h) _cmWordingEdit = h._cmWordingEdit;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_cmRemoveMessage' in h) _cmRemoveMessage = h._cmRemoveMessage;
    if ('_currentId' in h) _currentId = h._currentId;
  }

  function cmDeleteStd(secId) {
    var current = _currentId('section', secId);
    showConfirm(
      'Remove Competency',
      _cmRemoveMessage(state.cmSelectedCourse, [current], 'Remove this competency from the class?'),
      'Remove',
      'danger',
      function () {
        // Resolved now: the id may have been re-keyed while the dialog was open.
        removeCompetencies(state.cmSelectedCourse, [_currentId('section', secId)]);
        renderClassManager();
      },
    );
  }

  function cmUpdateStdLabel(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    var title = val.trim() || /** @type {any} */ (label).dataset.fallback || '';
    label.textContent = title;
    var menuBtn = card.querySelector('.cm-std-icon-btn');
    if (menuBtn) menuBtn.setAttribute('aria-label', 'More actions for ' + title);
  }

  function cmUpdateStdText(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
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
    if (!state.cmSelectedCourse) return null;
    secId = _currentId('section', secId);
    var map = ensureCustomLearningMap(state.cmSelectedCourse);
    var sec = (map.sections || []).find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return null;
    return { map: map, sec: sec, tag: sec.tags[0] };
  }

  function _cmStdSave(entry, focusSel) {
    saveLearningMap(state.cmSelectedCourse, entry.map);
    renderClassManager();
    if (!focusSel) return;
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + entry.sec.id + ' ' + focusSel);
      if (el) /** @type {any} */ (el).focus();
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
    if (lines[0] && !lines[0].ready && !state._cmLevelsBankAsked && RubricPrint.loadBankLevels) {
      state._cmLevelsBankAsked = true;
      // Only the Competencies tab shows the Levels: on another tab the
      // next draw picks them up, so opening Class Settings draws it once.
      RubricPrint.loadBankLevels().then(function (ok) {
        if (ok && state.classManagerOpen && state.cmMode === 'edit' && state.cmTab === 'competencies')
          renderClassManager();
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
      var el = document.querySelector('#cm-std-' + /** @type {any} */ (entry).sec.id + ' .cm-levels-input');
      if (el) /** @type {any} */ (el).focus();
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
    var key = RubricDraft.competencyKey(/** @type {any} */ (entry).tag);
    var entries = [];
    Object.keys(form.drafts).forEach(function (l) {
      var level = Number(l);
      var text = String(form.drafts[l] || '').trim();
      if (text === String(form.base[l] || '').trim()) return;
      var base = RubricPrint.levelWording(/** @type {any} */ (entry).tag, level, true).text;
      var baseLine = window.CompetencyWording ? CompetencyWording.sentence(base) : base;
      if (text === baseLine || text === base) text = '';
      entries.push({ key: key, level: level, text: text });
    });
    if (key) saveCompetencyDescriptors(entries);
    delete _cmLevelsEdit[/** @type {any} */ (entry).sec.id];
    renderClassManager();
  }

  function cmStdEditWording(secId) {
    var entry = _cmStdEntry(secId);
    if (!entry) return;
    _cmWordingEdit[entry.sec.id] = true;
    renderClassManager();
    requestAnimationFrame(function () {
      var el = document.querySelector('#cm-std-' + /** @type {any} */ (entry).sec.id + ' .cm-std-wording-input');
      if (el) {
        /** @type {any} */ (el).focus();
        /** @type {any} */ (el).setSelectionRange(
          /** @type {any} */ (el).value.length,
          /** @type {any} */ (el).value.length,
        );
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
      /** @type {any} */ (m).hidden = true;
      var btn = /** @type {any} */ (m.parentElement).querySelector('[aria-haspopup="menu"]');
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

  // A competency's code (e.g. "RD1", "ENG10A") is its own column, apart from
  // its id; saveLearningMap sends the changed tag.
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
    var code = _cmCleanCode(val) || /** @type {any} */ (chip).dataset.fallback || '';
    chip.textContent = code;
    /** @type {any} */ (chip).hidden = !code;
  }

  function cmUpdateStdCode(secId, val) {
    secId = _currentId('section', secId);
    if (!state.cmSelectedCourse) return;
    var newCode = _cmCleanCode(val);
    if (!newCode) return;
    var map = ensureCustomLearningMap(state.cmSelectedCourse);
    var sec = map.sections.find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return;
    var tag = sec.tags[0];
    if (newCode === tag.code) return;
    tag.code = newCode;
    saveLearningMap(state.cmSelectedCourse, map);
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

  return {
    configure: configure,
    _cmCloseStdMenus: _cmCloseStdMenus,
    _cmLevelsHtml: _cmLevelsHtml,
    cmAddTag: cmAddTag,
    cmDeleteStd: cmDeleteStd,
    cmDeleteTag: cmDeleteTag,
    cmIcanAdd: cmIcanAdd,
    cmIcanDelete: cmIcanDelete,
    cmIcanEdit: cmIcanEdit,
    cmIcanMove: cmIcanMove,
    cmLevelsCancel: cmLevelsCancel,
    cmLevelsDraft: cmLevelsDraft,
    cmLevelsEdit: cmLevelsEdit,
    cmLevelsSave: cmLevelsSave,
    cmStdCodeLive: cmStdCodeLive,
    cmStdEditWording: cmStdEditWording,
    cmStdFinishWording: cmStdFinishWording,
    cmStdLabelLive: cmStdLabelLive,
    cmStdRestoreWording: cmStdRestoreWording,
    cmStdToggleMenu: cmStdToggleMenu,
    cmUpdateStdCode: cmUpdateStdCode,
    cmUpdateStdLabel: cmUpdateStdLabel,
    cmUpdateTagLabel: cmUpdateTagLabel,
    cmUpdateTagText: cmUpdateTagText,
  };
})();
