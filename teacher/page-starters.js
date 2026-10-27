/* ── page-starters.js — My Sentence Starters ─────────────────
   The teacher's one list of sentence starters, used in every class
   (migrations/20261022_teacher_sentence_starters.sql). A starter has text,
   an optional type and context, and tags; Times Used counts the
   observations written from it in every class. The ↑ ↓ order is this
   page's; the "/" menu and the phone list the most-used first. One row is
   edited at a time; the edit lives here until Save. Reached from "Edit My
   Starters…" in any observation box. */
window.PageStarters = (function () {
  'use strict';

  var _listeners = [];
  var _edit = null; // { id ('new' or the starter's id), text, sentiment, context, dims }
  var _error = '';
  var _focus = null; // selector to focus after the next render

  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  function _sameId(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return resolveObservationTemplateId(null, a) === resolveObservationTemplateId(null, b);
  }

  function _find(id) {
    return getObservationTemplates().find(function (t) {
      return _sameId(t.id, id);
    });
  }

  function _pillsHtml(t) {
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

  function _editorHtml() {
    var ed = _edit;
    var isNew = ed.id === 'new';
    var h =
      '<div class="cm-starter-editor ms-editor" id="ms-editor">' +
      '<label class="cm-starter-editor-label" for="ms-text">' +
      (isNew ? 'New Starter' : 'Edit Starter') +
      '</label>' +
      '<input class="cm-input" id="ms-text" data-action-input="msText" value="' +
      esc(ed.text) +
      '" placeholder="e.g. Explained their thinking to a partner" autocomplete="off">' +
      '<div class="cm-starter-editor-row">' +
      '<select class="cm-input cm-starter-select" data-action-change="msType" aria-label="Type">' +
      '<option value="">No Type</option>';
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
      '<select class="cm-input cm-starter-select" data-action-change="msContext" aria-label="Context">' +
      '<option value="">No Context</option>';
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
    // No class's custom tags: a starter is used in every class.
    var items = typeof ObsCapture !== 'undefined' ? ObsCapture.tagMenuItems(null) : [];
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
          '" data-action="msTag" data-value="' +
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
      '<button class="btn btn-primary" data-action="msSave" id="ms-save"' +
      (ed.text.trim() ? '' : ' disabled') +
      '>' +
      (isNew ? 'Add Starter' : 'Save') +
      '</button>' +
      '<button class="btn btn-ghost" data-action="msCancel">Cancel</button>' +
      '</div></div>';
    return h;
  }

  function _rowHtml(t, idx, count) {
    var label = esc(t.text);
    return (
      '<div class="ms-row" data-tplid="' +
      esc(t.id) +
      '">' +
      '<div class="ms-row-main"><div class="ms-row-text">' +
      label +
      '</div>' +
      _pillsHtml(t) +
      '</div>' +
      '<span class="ms-row-uses">' +
      (t.uses || 0) +
      '</span>' +
      '<span class="ms-row-actions">' +
      '<button class="cm-starter-btn" data-action="msMove" data-tplid="' +
      esc(t.id) +
      '" data-dir="-1" aria-label="Move up: ' +
      label +
      '"' +
      (idx === 0 ? ' disabled' : '') +
      '>↑</button>' +
      '<button class="cm-starter-btn" data-action="msMove" data-tplid="' +
      esc(t.id) +
      '" data-dir="1" aria-label="Move down: ' +
      label +
      '"' +
      (idx === count - 1 ? ' disabled' : '') +
      '>↓</button>' +
      '<button class="cm-starter-btn cm-starter-edit" data-action="msEdit" data-tplid="' +
      esc(t.id) +
      '" aria-label="Edit: ' +
      label +
      '">Edit</button>' +
      '<button class="cm-delete-mini" data-action="msDelete" data-tplid="' +
      esc(t.id) +
      '" aria-label="Delete: ' +
      label +
      '">✕</button>' +
      '</span></div>'
    );
  }

  function render() {
    var main = document.getElementById('main');
    if (!main) return;
    var list = getObservationTemplates();
    var toolbar = document.getElementById('page-toolbar-mount');
    if (toolbar) {
      toolbar.innerHTML =
        '<div class="dash-toolbar">' +
        renderBreadcrumb('Observations', '/observations', 'My Sentence Starters', 'msBack') +
        '</div>';
    }
    var h =
      '<div class="ms-page">' +
      '<div class="ms-head"><div>' +
      '<h1 class="ms-title">My Sentence Starters</h1>' +
      '<div class="ms-sub">Used in all your classes. Type / in any observation box to use one; on the phone, tap a student.</div>' +
      '</div>' +
      (_edit && _edit.id === 'new'
        ? ''
        : '<button type="button" class="btn btn-primary" data-action="msAdd">Add Starter</button>') +
      '</div>' +
      '<div class="ms-info"><span class="ms-info-icon" aria-hidden="true">i</span><span>The / menu and the phone list your most-used starters first. To add one while you work, write an observation and choose <strong>Save as Starter</strong>.</span></div>';
    if (_edit && _edit.id === 'new') h += _editorHtml();
    if (!list.length) {
      h +=
        '<section class="ms-table ms-empty" aria-label="Sentence starters">' +
        '<div class="cm-hint">No sentence starters yet. Here are six to begin with.</div>' +
        '<div class="cm-starter-list cm-starter-suggestions">';
      (typeof OBS_STARTER_SUGGESTIONS !== 'undefined' ? OBS_STARTER_SUGGESTIONS : []).forEach(function (t) {
        h +=
          '<div class="cm-starter-row is-suggestion"><div class="cm-starter-main"><div class="cm-starter-text">' +
          esc(t.text) +
          '</div>' +
          _pillsHtml(t) +
          '</div></div>';
      });
      h +=
        '</div>' +
        '<div class="cm-starter-empty-actions">' +
        '<button class="btn btn-primary" data-action="msAddSuggested">Add These Starters</button>' +
        '</div></section>';
    } else {
      h +=
        '<section class="ms-table" aria-label="Sentence starters">' +
        '<div class="ms-row ms-row-head"><span>Starter</span><span class="ms-row-uses">Times Used</span><span></span></div>';
      list.forEach(function (t, idx) {
        if (_edit && _sameId(_edit.id, t.id)) h += _editorHtml();
        else h += _rowHtml(t, idx, list.length);
      });
      h +=
        '</section>' +
        '<div class="ms-foot">Times Used counts every class. The ↑ ↓ order is how this list is sorted here; the menus sort by use.</div>';
    }
    if (_error) h += '<div class="cm-starter-error" role="alert">' + esc(_error) + '</div>';
    h += '</div>';
    main.innerHTML = h;
    if (_focus) {
      var sel = _focus;
      _focus = null;
      var el = document.querySelector(sel);
      if (!el || el.disabled) el = document.querySelector('[data-action="msAdd"]');
      if (el && typeof el.focus === 'function') el.focus();
    }
  }

  function _render(focusSel) {
    _focus = focusSel || null;
    render();
  }

  function _saved(ok) {
    _error = ok === false || ok === null ? 'Couldn’t save on this device. Its storage is full.' : '';
  }

  function add() {
    _error = '';
    _edit = { id: 'new', text: '', sentiment: null, context: null, dims: [] };
    _render('#ms-text');
  }

  function edit(id) {
    var t = _find(id);
    if (!t) return;
    _error = '';
    _edit = {
      id: t.id,
      text: t.text,
      sentiment: t.sentiment || null,
      context: t.context || null,
      dims: (t.dims || []).slice(),
    };
    _render('#ms-text');
  }

  function cancel() {
    var id = _edit && _edit.id;
    _edit = null;
    _error = '';
    _render(id && id !== 'new' ? '[data-action="msEdit"][data-tplid="' + id + '"]' : '[data-action="msAdd"]');
  }

  function save() {
    var ed = _edit;
    if (!ed || !ed.text.trim()) return;
    var row = { text: ed.text.trim(), sentiment: ed.sentiment, context: ed.context, dims: ed.dims.slice() };
    var focusId;
    if (ed.id === 'new') {
      var added = addObservationTemplate(null, row);
      _saved(added);
      focusId = added && added.id;
    } else {
      _saved(updateObservationTemplate(null, ed.id, row));
      focusId = ed.id;
    }
    _edit = null;
    _render(focusId ? '[data-action="msEdit"][data-tplid="' + focusId + '"]' : null);
  }

  function remove(id) {
    var t = _find(id);
    if (!t) return;
    showConfirm(
      'Delete Starter',
      'Delete “' + t.text + '” from all your classes? Observations already written with it stay as they are.',
      'Delete',
      'danger',
      function () {
        _saved(removeObservationTemplate(null, t.id));
        if (_edit && _sameId(_edit.id, t.id)) _edit = null;
        _render('[data-action="msAdd"]');
      },
    );
  }

  function move(id, dir) {
    _saved(moveObservationTemplate(null, id, dir));
    var cur = resolveObservationTemplateId(null, id);
    var list = getObservationTemplates();
    var idx = list.findIndex(function (x) {
      return _sameId(x.id, cur);
    });
    // Keep focus on the arrow that moved it, or on the other one at an end.
    var atEnd = dir < 0 ? idx === 0 : idx === list.length - 1;
    var row = '[data-action="msMove"][data-tplid="' + (idx >= 0 ? list[idx].id : cur) + '"]';
    _render(row + '[data-dir="' + (atEnd ? -dir : dir) + '"]');
  }

  function addSuggested() {
    if (typeof OBS_STARTER_SUGGESTIONS === 'undefined') return;
    _saved(addObservationTemplates(null, structuredClone(OBS_STARTER_SUGGESTIONS)));
    _render('[data-action="msAdd"]');
  }

  function toggleTag(key) {
    if (!_edit) return;
    var i = _edit.dims.indexOf(key);
    if (i >= 0) _edit.dims.splice(i, 1);
    else _edit.dims.push(key);
    var sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key;
    _render('[data-action="msTag"][data-value="' + sel + '"]');
  }

  function _handleClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action;
    if (a === 'msBack') {
      e.preventDefault();
      Router.navigate('/observations');
    } else if (a === 'msAdd') add();
    else if (a === 'msEdit') edit(el.dataset.tplid);
    else if (a === 'msCancel') cancel();
    else if (a === 'msSave') save();
    else if (a === 'msDelete') remove(el.dataset.tplid);
    else if (a === 'msMove') move(el.dataset.tplid, parseInt(el.dataset.dir, 10));
    else if (a === 'msAddSuggested') addSuggested();
    else if (a === 'msTag') toggleTag(el.dataset.value);
  }

  function _handleInput(e) {
    var el = e.target;
    if (el && el.dataset && el.dataset.actionInput === 'msText' && _edit) {
      _edit.text = el.value;
      var btn = document.getElementById('ms-save');
      if (btn) btn.disabled = !el.value.trim();
    }
  }

  function _handleChange(e) {
    var el = e.target;
    if (!el || !el.dataset || !_edit) return;
    if (el.dataset.actionChange === 'msType') _edit.sentiment = el.value || null;
    if (el.dataset.actionChange === 'msContext') _edit.context = el.value || null;
  }

  // In the editor Enter saves and Escape cancels.
  function _handleKeydown(e) {
    var el = e.target;
    if (!el || el.id !== 'ms-text' || e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  function init() {
    _edit = null;
    _error = '';
    document.getElementById('page-layout').classList.add('sidebar-hidden');
    document.getElementById('sidebar-mount').style.display = 'none';
    // No class list here, so no button to show it (as on the dashboard). The
    // dock is drawn again on the next page, button and all.
    var sidebarBtn = document.querySelector('.tb-btn');
    if (sidebarBtn) sidebarBtn.style.display = 'none';
    _addDocListener('click', _handleClick);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
    _addDocListener('keydown', _handleKeydown);
    render();
    requestAnimationFrame(function () {
      var main = document.getElementById('main');
      if (main) main.scrollTop = 0;
    });
  }

  function destroy() {
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    _edit = null;
    _error = '';
    var toolbar = document.getElementById('page-toolbar-mount');
    if (toolbar) toolbar.innerHTML = '';
  }

  return { init: init, destroy: destroy, render: render };
})();
