/* cm-block-picker.js — Class Settings: the block picker (None, A–E, X or Other) and the first screen for a teacher with no classes.
   Moved from teacher/dash-class-manager.js on 2026-11-12; DashClassManager uses it through CmBlockPicker. */
var CmBlockPicker = (function () {
  'use strict';

  /* ── Block picker ──────────────────────────────────────────────
     None, A–E, X, or "Other" text. Used in Details, the new-class wizard
     and Duplicate Class. */
  // html-safe: ids are fixed by the callers, blocks come from COURSE_BLOCK_CHOICES, an Other value is escaped.
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

  function _cmIsDemo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }

  /* The first screen for a teacher with no classes: create one, or try
     Demo Mode. Demo Mode already has a class, so a demo teacher
     who deletes every class sees only Create a Class. */
  function _cmEmptyStateHtml() {
    var create =
      '<section class="cm-empty-card" aria-labelledby="cm-empty-create">' +
      '<h2 class="cm-empty-card-title" id="cm-empty-create">Create a Class</h2>' +
      '<p class="cm-empty-card-text">Build a class from BC curriculum courses, then add students.</p>' +
      '<button type="button" class="btn btn-primary cm-empty-card-btn" data-action="cmStartCreate">Create a Class</button>' +
      '</section>';
    var demo = _cmIsDemo()
      ? ''
      : '<section class="cm-empty-card" aria-labelledby="cm-empty-demo">' +
        '<h2 class="cm-empty-card-title" id="cm-empty-demo">Try Demo Mode</h2>' +
        '<p class="cm-empty-card-text">A sample Science 8 class with 27 students. Nothing is saved to your account.</p>' +
        '<button type="button" class="btn btn-ghost cm-empty-card-btn" data-action="cmOpenDemoMode">Open Demo Mode</button>' +
        '</section>';
    return (
      '<div class="cm-empty cm-first-run">' +
      '<h1 class="cm-empty-title">No classes yet</h1>' +
      '<div class="cm-empty-cards">' +
      create +
      demo +
      '</div>' +
      '<a class="cm-empty-help" href="/help/create-a-class">Getting Started Guide</a>' +
      '</div>'
    );
  }

  /* Demo Mode runs on this device only. Entering it from the login page
     clears this device's FullVision data (login-auth.js), so say what happens
     first, including any change not yet sent to the account. */
  function cmOpenDemoMode() {
    var unsent = 0;
    try {
      var q = window.v2Queue;
      if (q && typeof q.stats === 'function') {
        var s = q.stats();
        unsent = Number(s.queued || 0) + Number(s.deadLettered || 0);
      }
    } catch (e) {
      unsent = 0;
    }
    var message =
      'Demo Mode opens a sample Science 8 class on this device and clears the FullVision data stored on it. ' +
      'Classes saved to your account are not changed. ' +
      'To return to your account, choose Sign Out in the account menu, then sign in.';
    if (unsent > 0)
      message +=
        ' ' +
        unsent +
        (unsent === 1 ? ' change on this device has' : ' changes on this device have') +
        ' not been sent to your account and will be lost.';
    showConfirm('Open Demo Mode', message, 'Open Demo Mode', 'primary', function () {
      window.location.href = '/login.html?demo=1';
    });
  }

  return {
    blockPickerHtml: blockPickerHtml,
    readBlockPicker: readBlockPicker,
    blockChipSelect: blockChipSelect,
    blockOtherInput: blockOtherInput,
    _cmEmptyStateHtml: _cmEmptyStateHtml,
    cmOpenDemoMode: cmOpenDemoMode,
  };
})();
if (typeof window !== 'undefined') window.CmBlockPicker = CmBlockPicker;
