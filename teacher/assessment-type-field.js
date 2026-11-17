// @ts-check
/* The assessment form's Type (Colin, Nov 17; mockup
   https://claude.ai/artifact/KUUNY4mHPuxc9igNJPzL75).

   A select of ASSESSMENT_TYPES (shared/constants.js), then This Class: the
   types a teacher added on this class's assessments, then Add a Type….
   Add a Type… puts a box where the select was: Enter, Add or leaving the
   box adds the word; Escape or Cancel puts the select back as it was. A
   word that is already there, whatever its case (oral, Oral), is chosen
   instead of added. An added type is saved only on the assessment, so it
   needs no setting: it stays in the class's list while an assessment uses
   it, and goes with an assessment copied to another class.

   The select keeps the id af-evidence, so the form reads and saves it as
   before (evidenceType). */
/** @type {any} */ (window).AssessmentTypeField = (function () {
  'use strict';

  var G = /** @type {any} */ (window);

  var ADD = '__add__';

  /** @param {string} value @param {boolean} selected */
  function _option(value, selected) {
    return (
      '<option value="' +
      esc(value) +
      '"' +
      (selected ? ' selected' : '') +
      '>' +
      esc(assessmentTypeLabel(value)) +
      '</option>'
    );
  }

  /** @param {string[]} added @param {string} current */
  function _addedGroupHtml(added, current) {
    return (
      '<optgroup label="This Class" id="af-type-added">' +
      added
        .map(function (t) {
          return _option(t, t === current);
        })
        .join('') +
      '</optgroup>'
    );
  }

  /* The Type field. `stored` is the assessment's evidenceType, or
     undefined for a new assessment (Written). */
  // html-safe: every word goes through esc; the rest is fixed markup
  /** @param {string} cid @param {string | undefined} stored */
  function fieldHtml(cid, stored) {
    var current = stored === undefined ? 'written' : assessmentTypeKey(stored);
    var added = addedAssessmentTypes(typeof G.getAssessments === 'function' ? G.getAssessments(cid) || [] : []);
    if (isAddedAssessmentType(current) && added.indexOf(current) < 0) added = added.concat([current]).sort();
    var list = ASSESSMENT_TYPES.concat(ASSESSMENT_TYPES_RETIRED.indexOf(current) >= 0 ? [current] : []);
    return (
      '<div class="af-field">' +
      '<label class="af-label" for="af-evidence">Type</label>' +
      '<select class="af-input" id="af-evidence" data-value="' +
      esc(current) +
      '">' +
      list
        .map(function (t) {
          return _option(t, t === current);
        })
        .join('') +
      (added.length ? _addedGroupHtml(added, current) : '') +
      '<hr><option value="' +
      ADD +
      '">Add a Type…</option>' +
      '</select>' +
      '<div class="af-type-add" id="af-type-add" hidden>' +
      '<input class="af-input" id="af-type-new" type="text" maxlength="' +
      ASSESSMENT_TYPE_MAX_LENGTH +
      '" placeholder="e.g. Debate" aria-label="New Type" autocomplete="off">' +
      '<div class="af-type-add-btns">' +
      '<button type="button" class="af-link-btn" id="af-type-add-btn">Add</button>' +
      '<button type="button" class="af-link-btn" id="af-type-cancel">Cancel</button>' +
      '</div></div>' +
      '</div>'
    );
  }

  function _els() {
    return {
      sel: /** @type {HTMLSelectElement|null} */ (document.getElementById('af-evidence')),
      row: document.getElementById('af-type-add'),
      input: /** @type {HTMLInputElement|null} */ (document.getElementById('af-type-new')),
    };
  }

  function _open() {
    var e = _els();
    if (!e.sel || !e.row || !e.input) return;
    // The select keeps its last real choice while the box is open, so a
    // save never sends "Add a Type…".
    e.sel.value = e.sel.dataset.value || 'written';
    e.sel.hidden = true;
    e.row.hidden = false;
    e.input.value = '';
    e.input.focus();
  }

  function _close() {
    var e = _els();
    if (!e.sel || !e.row || e.row.hidden) return;
    e.row.hidden = true;
    e.sel.hidden = false;
    if (e.input) e.input.value = '';
    e.sel.focus();
  }

  // The typed word, chosen if it is there already, otherwise added under This Class.
  function _commit() {
    var e = _els();
    if (!e.sel || !e.row || e.row.hidden || !e.input) return;
    var key = assessmentTypeKey(e.input.value);
    if (!key) return _close();
    var low = key.toLowerCase();
    var match = Array.prototype.find.call(e.sel.options, function (/** @type {HTMLOptionElement} */ o) {
      return o.value !== ADD && o.value.toLowerCase() === low;
    });
    if (!match) {
      var group = document.getElementById('af-type-added');
      if (!group) {
        group = document.createElement('optgroup');
        group.id = 'af-type-added';
        group.setAttribute('label', 'This Class');
        var addOpt = Array.prototype.find.call(e.sel.options, function (/** @type {HTMLOptionElement} */ o) {
          return o.value === ADD;
        });
        var before =
          addOpt && addOpt.previousElementSibling && addOpt.previousElementSibling.tagName === 'HR'
            ? addOpt.previousElementSibling
            : addOpt;
        e.sel.insertBefore(group, before || null);
      }
      match = document.createElement('option');
      match.value = key;
      match.textContent = assessmentTypeLabel(key);
      var next = Array.prototype.find.call(group.children, function (/** @type {HTMLOptionElement} */ o) {
        return o.value.localeCompare(key) > 0;
      });
      group.insertBefore(match, next || null);
    }
    e.sel.value = match.value;
    e.sel.dataset.value = match.value;
    _close();
    e.sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function _onChange(/** @type {Event} */ ev) {
    var t = /** @type {any} */ (ev.target);
    if (!t) return;
    if (t.id === 'af-evidence') {
      if (t.value === ADD) _open();
      else t.dataset.value = t.value;
    } else if (t.id === 'af-type-new') {
      // Leaving the box with a word in it adds it (Create clicked straight after typing).
      _commit();
    }
  }

  function _onClick(/** @type {MouseEvent} */ ev) {
    var t = /** @type {any} */ (ev.target);
    if (!t || !t.closest) return;
    if (t.closest('#af-type-add-btn')) _commit();
    else if (t.closest('#af-type-cancel')) _close();
  }

  // Cancel keeps the focus in the box, so leaving it doesn't add the word first.
  function _onMouseDown(/** @type {MouseEvent} */ ev) {
    var t = /** @type {any} */ (ev.target);
    if (t && t.closest && t.closest('#af-type-cancel')) ev.preventDefault();
  }

  // Enter adds; Escape closes the box, not the form.
  function _onKeyDown(/** @type {KeyboardEvent} */ ev) {
    var t = /** @type {any} */ (ev.target);
    if (!t || t.id !== 'af-type-new' || ev.isComposing) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      _commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      _close();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('change', _onChange);
    document.addEventListener('click', _onClick);
    document.addEventListener('mousedown', _onMouseDown);
    document.addEventListener('keydown', _onKeyDown, true);
  }

  return { fieldHtml: fieldHtml, ADD: ADD };
})();
