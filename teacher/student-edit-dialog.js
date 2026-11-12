/* student-edit-dialog.js — the Edit Student dialog (name, school record,
   contact, language support, designations). Moved from teacher/page-student.js
   on 2026-11-12. PageStudent hands over its class, student and redraw through
   configure() whenever they change. */
window.StudentEditDialog = (function () {
  'use strict';

  /* Handed over by PageStudent (configure). */
  var activeCourse;
  var studentId;
  var _render = null;
  function configure(opts) {
    activeCourse = opts.activeCourse;
    studentId = opts.studentId;
    _render = opts.render;
  }
  function render() {
    return _render();
  }

  /* ── Edit Student Modal ─────────────────────────────────── */
  /* The dialog for this page's student, or for another page's (the Term
     Questionnaire's Edit Student icon): `cid` and `sid` name the student
     and `onSaved` runs after a save in place of this page's redraw. The
     dialog handles its own buttons, so it works on any page. */
  function openEditStudent(cidArg, sidArg, onSaved) {
    var cid = cidArg || activeCourse;
    var sid = sidArg || studentId;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;

    var overlay = document.createElement('div');
    overlay.className = 'edit-modal-overlay';
    overlay.id = 'edit-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'edit-modal-heading');
    overlay.dataset.cid = cid;
    overlay.dataset.sid = sid;
    overlay._onSaved = typeof onSaved === 'function' ? onSaved : null;
    // Focus goes back where it came from when the dialog closes.
    overlay._opener = document.activeElement;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) return _dismissEditStudent();
      var el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!el) return;
      var action = el.dataset.action;
      if (action === 'closeEditStudent') closeEditStudent();
      else if (action === 'saveEditStudent') saveEditStudent();
      else if (action === 'toggleEditDesig') {
        el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true'));
        overlay._dirty = true;
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });

    // A field: label over a 44 px box; `extra` is the input's other attributes.
    function field(id, label, value, extra, tail) {
      return (
        '<div class="es-field"><label class="es-label" for="' +
        id +
        '">' +
        label +
        '</label><input class="es-input" id="' +
        id +
        '" value="' +
        esc(value || '') +
        '"' +
        (extra || '') +
        '>' +
        (tail || '') +
        '</div>'
      );
    }
    // A designation or support flag as a row that turns blue when chosen.
    function toggles(map) {
      return Object.entries(map)
        .map(function (e) {
          var on = (st.designations || []).indexOf(e[0]) >= 0;
          return (
            '<button type="button" class="es-toggle" data-action="toggleEditDesig" data-code="' +
            e[0] +
            '" aria-pressed="' +
            on +
            '" title="' +
            esc(e[1].desc || '') +
            '"><span class="es-code">' +
            e[0] +
            '</span><span>' +
            esc(e[1].name) +
            '</span></button>'
          );
        })
        .join('');
    }
    var emailHint = ' type="email" placeholder="No email on file"';
    var errLine = function (id, text) {
      return '<div class="es-err" id="' + id + '-err" hidden>' + text + '</div>';
    };
    var badEmail = 'Enter an email address, or leave it blank.';

    // html-safe: student fields and descriptions are escaped; labels, codes and SUPPORT_FLAGS / BC_DESIGNATIONS keys are fixed.
    overlay.innerHTML =
      '<div class="edit-modal es-modal">' +
      '<div class="es-head"><h2 class="edit-modal-title" id="edit-modal-heading">Edit Student</h2>' +
      '<div class="es-sub">' +
      esc(fullName(st)) +
      '</div></div>' +
      '<div class="es-cols"><div class="es-col">' +
      '<section class="es-sec"><h3 class="es-h">Name</h3>' +
      field(
        'edit-first',
        'First Name <span class="es-req">(Required)</span>',
        st.firstName,
        ' aria-required="true" aria-describedby="edit-first-err"',
        errLine('edit-first', 'Enter a first name.'),
      ) +
      field('edit-last', 'Last Name', st.lastName) +
      '<div class="es-row">' +
      field('edit-pref', 'Preferred Name', st.preferred) +
      '<div class="es-field"><label class="es-label" for="edit-pro">Pronouns</label><select class="es-input" id="edit-pro">' +
      '<option value="">Not Set</option>' +
      PRONOUNS_OPTIONS.map(function (pr) {
        return '<option' + (pr === st.pronouns ? ' selected' : '') + '>' + esc(pr) + '</option>';
      }).join('') +
      '</select></div></div></section>' +
      '<section class="es-sec"><h3 class="es-h">School Record</h3><div class="es-row">' +
      field('edit-num', 'Student Number', st.studentNumber) +
      field('edit-dob', 'Date of Birth', st.dateOfBirth, ' type="date"') +
      '</div></section>' +
      '<section class="es-sec"><h3 class="es-h">Contact</h3>' +
      field(
        'edit-email',
        'Student Email',
        st.email,
        emailHint + ' aria-describedby="edit-email-err"',
        errLine('edit-email', badEmail),
      ) +
      field(
        'edit-g0',
        'Parent Email',
        '',
        emailHint + ' aria-describedby="edit-g0-err"',
        errLine('edit-g0', badEmail),
      ) +
      field(
        'edit-g1',
        'Parent Email 2',
        '',
        emailHint + ' aria-describedby="edit-g1-err"',
        errLine('edit-g1', badEmail),
      ) +
      '</section>' +
      '<section class="es-sec"><h3 class="es-h">Language Support</h3><div class="es-list" role="group" aria-label="Language Support">' +
      toggles(SUPPORT_FLAGS) +
      '</div></section>' +
      '</div>' +
      '<section class="es-sec"><h3 class="es-h">Designations</h3><div class="es-hint">Ministry designations. Tap each that applies.</div>' +
      '<div class="es-list" role="group" aria-label="Designations">' +
      toggles(BC_DESIGNATIONS) +
      '</div></section>' +
      '</div>' +
      '<div class="edit-modal-actions">' +
      '<button class="es-cancel" data-action="closeEditStudent">Cancel</button>' +
      '<button class="btn-primary" data-action="saveEditStudent">Save</button>' +
      '</div>' +
      '</div>';

    // Parent emails come from the class's guardians, loaded once per class.
    overlay._guardianEmails = ['', ''];
    if (window.DashClassManager && DashClassManager.guardianEmails) {
      DashClassManager.guardianEmails(cid, st.id).then(function (emails) {
        // A dialog closed before the load came back must not fill the
        // next student's boxes (they share the same ids).
        if (!overlay.isConnected) return;
        overlay._guardianEmails = emails;
        ['edit-g0', 'edit-g1'].forEach(function (id, i) {
          var inp = overlay.querySelector('#' + id);
          if (inp && !inp.value && document.activeElement !== inp) inp.value = emails[i];
        });
      });
    }

    // Anything typed or picked counts as a change Escape mustn't lose.
    overlay._dirty = false;
    var markDirty = function () {
      overlay._dirty = true;
    };
    overlay.addEventListener('input', markDirty);
    overlay.addEventListener('change', markDirty);

    document.body.appendChild(overlay);
    document.getElementById('edit-first').focus();
    overlay._escHandler = function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        return _dismissEditStudent();
      }
      // Enter in a box saves, as in any form.
      if (
        e.key === 'Enter' &&
        !e.isComposing &&
        e.target &&
        e.target.tagName === 'INPUT' &&
        overlay.contains(e.target)
      ) {
        e.preventDefault();
        return saveEditStudent();
      }
      // Focus stays inside the dialog while it is open.
      if (e.key === 'Tab') return _trapEditFocus(overlay, e);
    };
    document.addEventListener('keydown', overlay._escHandler);
  }

  function _trapEditFocus(overlay, e) {
    var boxes = Array.from(overlay.querySelectorAll('input, select, textarea, button')).filter(function (el) {
      return !el.disabled && el.getAttribute('tabindex') !== '-1';
    });
    if (!boxes.length) return;
    var first = boxes[0];
    var last = boxes[boxes.length - 1];
    var inside = overlay.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  // Marks a field as needing a fix: a red edge and the line under it, until
  // it is typed in.
  function _editFieldError(el) {
    var msg = document.getElementById(el.id + '-err');
    el.classList.add('es-bad');
    el.setAttribute('aria-invalid', 'true');
    if (msg) msg.hidden = false;
    el.oninput = function () {
      el.classList.remove('es-bad');
      el.removeAttribute('aria-invalid');
      if (msg) msg.hidden = true;
    };
    el.focus();
  }

  /* Escape or a click outside: closes, and changes not saved can be got
     back with Undo, which opens the dialog again as it was. */
  function _dismissEditStudent() {
    var overlay = document.getElementById('edit-modal-overlay');
    if (!overlay) return;
    var changed = overlay._dirty;
    closeEditStudent();
    if (!changed || typeof showUndoToast !== 'function') return;
    var st = getStudents(overlay.dataset.cid).find(function (s) {
      return s.id === overlay.dataset.sid;
    });
    showUndoToast('Changes to ' + (st ? displayNameFirst(st) : 'the student') + ' not saved', function () {
      if (document.getElementById('edit-modal-overlay')) return;
      overlay._opener = document.activeElement;
      document.body.appendChild(overlay);
      document.addEventListener('keydown', overlay._escHandler);
      var first = overlay.querySelector('#edit-first');
      if (first) first.focus();
    });
  }

  function closeEditStudent() {
    var overlay = document.getElementById('edit-modal-overlay');
    if (overlay) {
      if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
      overlay.remove();
      _focusEditOpener(overlay._opener);
    }
  }

  // The button that opened the dialog, or this page's Edit Student after a
  // redraw replaced it.
  function _focusEditOpener(opener) {
    var target =
      opener && opener.isConnected && opener !== document.body
        ? opener
        : document.querySelector('[data-action="openEditStudent"]');
    if (target && target.focus) target.focus();
  }

  function saveEditStudent() {
    var overlay = document.getElementById('edit-modal-overlay');
    if (!overlay) return;
    var cid = overlay.dataset.cid || activeCourse;
    var sid = overlay.dataset.sid || studentId;
    var firstEl = document.getElementById('edit-first');
    var firstName = (firstEl.value || '').trim();
    if (!firstName) return _editFieldError(firstEl);
    var bad = ['edit-email', 'edit-g0', 'edit-g1']
      .map(function (id) {
        return document.getElementById(id);
      })
      .find(function (el) {
        return el.value.trim() && !el.checkValidity();
      });
    if (bad) return _editFieldError(bad);
    var lastName = (document.getElementById('edit-last').value || '').trim();
    var preferred = (document.getElementById('edit-pref').value || '').trim();
    var pronouns = (document.getElementById('edit-pro').value || '').trim();
    var studentNumber = (document.getElementById('edit-num').value || '').trim();
    var email = (document.getElementById('edit-email').value || '').trim();
    var dateOfBirth = (document.getElementById('edit-dob').value || '').trim();
    var designations = Array.from(document.querySelectorAll('#edit-modal-overlay .es-toggle[aria-pressed="true"]')).map(
      function (btn) {
        return btn.dataset.code;
      },
    );
    var parentEmails = ['edit-g0', 'edit-g1'].map(function (id) {
      return document.getElementById(id).value.trim();
    });

    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;

    st.firstName = firstName;
    st.lastName = lastName;
    st.preferred = preferred;
    st.pronouns = pronouns;
    st.studentNumber = studentNumber;
    st.email = email;
    st.dateOfBirth = dateOfBirth;
    st.designations = designations;
    delete st.designation;
    st.sortName = ((lastName || '') + ' ' + firstName).trim();

    saveStudents(cid, students);
    // Second first: clearing the first parent moves the second up a place.
    if (window.DashClassManager && DashClassManager.saveGuardianEmail) {
      [1, 0].forEach(function (i) {
        if (parentEmails[i] !== overlay._guardianEmails[i])
          DashClassManager.saveGuardianEmail(cid, sid, i, parentEmails[i]);
      });
    }
    var onSaved = overlay._onSaved;
    var opener = overlay._opener;
    closeEditStudent();
    if (onSaved) {
      onSaved();
      return _focusEditOpener(opener);
    }
    // Re-render sidebar with updated name
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(
      activeCourse,
      studentId,
      'PageStudent.switchStudent',
    );
    render();
    _focusEditOpener(opener);
  }

  return {
    configure: configure,
    openEditStudent: openEditStudent,
    closeEditStudent: closeEditStudent,
  };
})();
