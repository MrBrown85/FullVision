// @ts-check
/* cm-students.js — Class Settings: the Students tab. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmStudents = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var _cmGuardians,
    state,
    _cmAddGuardianEmail,
    _cmCloseStdMenus,
    _cmFlushPendingGuardians,
    _cmImportNewIds,
    _cmNoteOpened,
    _cmRosterOnlyIds,
    _isServerPerson,
    renderClassManager,
    withdrawStudentUI;
  function configure(h) {
    if ('_cmGuardians' in h) _cmGuardians = h._cmGuardians;
    if ('state' in h) state = h.state;
    if ('_cmAddGuardianEmail' in h) _cmAddGuardianEmail = h._cmAddGuardianEmail;
    if ('_cmCloseStdMenus' in h) _cmCloseStdMenus = h._cmCloseStdMenus;
    if ('_cmFlushPendingGuardians' in h) _cmFlushPendingGuardians = h._cmFlushPendingGuardians;
    if ('_cmImportNewIds' in h) _cmImportNewIds = h._cmImportNewIds;
    if ('_cmNoteOpened' in h) _cmNoteOpened = h._cmNoteOpened;
    if ('_cmRosterOnlyIds' in h) _cmRosterOnlyIds = h._cmRosterOnlyIds;
    if ('_isServerPerson' in h) _isServerPerson = h._isServerPerson;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('withdrawStudentUI' in h) withdrawStudentUI = h.withdrawStudentUI;
  }

  /* ── Class Manager Student Functions ────────────────────── */
  function cmShowAddStudent(added) {
    var form = document.getElementById('cm-add-student-form');
    if (form) {
      form.style.display = 'block';
      var status = document.getElementById('cm-add-status');
      if (status)
        status.textContent = added ? 'Added ' + added + '. Type the next student, or press Escape to close.' : '';
      var el = document.getElementById('cm-add-first');
      if (el) el.focus();
    }
  }

  // Cancel or Escape closes the form and puts the focus back on Add Student.
  function cmCloseAddStudent() {
    var form = document.getElementById('cm-add-student-form');
    if (!form || form.style.display === 'none') return false;
    cmCancelStudent();
    var btn = document.querySelector('.cm-roster-add');
    if (btn) /** @type {any} */ (btn).focus();
    return true;
  }

  function cmCancelStudent() {
    state.cmEditingStudentId = null;
    var form = document.getElementById('cm-add-student-form');
    if (form) form.style.display = 'none';
    var status = document.getElementById('cm-add-status');
    if (status) status.textContent = '';
    var btn = document.getElementById('cm-save-btn');
    if (btn) btn.textContent = 'Save';
    ['cm-add-first', 'cm-add-last', 'cm-add-pref', 'cm-add-num', 'cm-add-dob', 'cm-add-email'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) /** @type {any} */ (el).value = '';
    });
    var proEl = document.getElementById('cm-add-pro');
    if (proEl) /** @type {any} */ (proEl).value = '';
    document.querySelectorAll('.cm-desig-check').forEach(function (cb) {
      /** @type {any} */ (cb).checked = false;
    });
  }

  /* Save closes the form; Save and Add Another (and Enter in a field) keeps
     it open, empty, with the focus in First Name for the next student. */
  function cmSaveStudent(another) {
    if (!state.cmSelectedCourse) return;
    var firstName = /** @type {any} */ (
      /** @type {any} */ (document.getElementById('cm-add-first'))?.value || ''
    ).trim();
    var lastName = /** @type {any} */ (/** @type {any} */ (document.getElementById('cm-add-last'))?.value || '').trim();
    if (!firstName) {
      var el = document.getElementById('cm-add-first');
      if (el) {
        el.style.border = '2px solid var(--score-1)';
        /** @type {any} */ (el).placeholder = 'First name is required';
        el.oninput = function () {
          /** @type {any} */ (this).style.border = '';
        };
        el.focus();
      }
      return;
    }
    var preferred = /** @type {any} */ (
      /** @type {any} */ (document.getElementById('cm-add-pref'))?.value || ''
    ).trim();
    var pronouns = /** @type {any} */ (/** @type {any} */ (document.getElementById('cm-add-pro'))?.value || '').trim();
    var studentNumber = /** @type {any} */ (
      /** @type {any} */ (document.getElementById('cm-add-num'))?.value || ''
    ).trim();
    var dateOfBirth = /** @type {any} */ (
      /** @type {any} */ (document.getElementById('cm-add-dob'))?.value || ''
    ).trim();
    var email = /** @type {any} */ (/** @type {any} */ (document.getElementById('cm-add-email'))?.value || '').trim();
    var designations = Array.from(document.querySelectorAll('.cm-desig-check:checked')).map(function (cb) {
      return /** @type {any} */ (cb).value;
    });
    var students = getStudents(state.cmSelectedCourse);
    var sortName = ((lastName || '') + ' ' + firstName).trim();
    var adding = !state.cmEditingStudentId;

    if (state.cmEditingStudentId) {
      var st = students.find(function (s) {
        return s.id === state.cmEditingStudentId;
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
      state.cmEditingStudentId = null;
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
        enrolledDate: courseToday(state.cmSelectedCourse),
      });
    }
    saveStudents(state.cmSelectedCourse, students);
    cmCancelStudent();
    renderClassManager();
    // Save and Add Another leaves the form open with the focus in First Name,
    // so a roster can be typed one student after another without the mouse.
    if (adding && another) {
      cmShowAddStudent(((preferred || firstName) + ' ' + lastName).trim());
      return;
    }
    if (adding) {
      var addBtn = document.querySelector('.cm-roster-add');
      if (addBtn) /** @type {any} */ (addBtn).focus();
      return;
    }
    requestAnimationFrame(function () {
      var detail = document.querySelector('.cm-detail');
      if (detail) detail.scrollTop = 0;
    });
  }

  function cmRemoveStudent(sid) {
    if (!state.cmSelectedCourse) return;
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
    return sortStudents(getStudents(cid), state.cmRosterSortMode === 'firstName' ? 'firstName' : 'lastName');
  }

  function _cmGuardiansFor(cid, sid) {
    var byStudent = _cmGuardians[cid] || {};
    return byStudent[sid] || [];
  }

  /* Loads the class's guardians once per visit to the tab, then fills in
     the Parent Email boxes in place, so a box being typed in keeps focus. */
  function _cmLoadGuardians(cid) {
    if (state._cmGuardiansLoaded[cid] || !(window.v2 && window.v2.listCourseGuardians))
      return state._cmGuardiansLoading[cid] || Promise.resolve();
    state._cmGuardiansLoaded[cid] = true;
    return (state._cmGuardiansLoading[cid] = /** @type {any} */ (window.v2.listCourseGuardians)(cid).then(
      function (res) {
        // With no server rows (Demo Mode, a failed read) the emails still
        // waiting on the students are all there is; keep what is in memory.
        var rows = res && res.data;
        if (rows) state._cmGuardiansReady[cid] = true;
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
        if (state.cmSelectedCourse !== cid) return;
        document
          .querySelectorAll('.cm-rs-row input[data-col="g0"], .cm-rs-row input[data-col="g1"]')
          .forEach(function (inp) {
            if (inp === document.activeElement) return;
            var g = _cmGuardiansFor(cid, /** @type {any} */ (inp).dataset.sid)[
              /** @type {any} */ (inp).dataset.col === 'g0' ? 0 : 1
            ];
            /** @type {any} */ (inp).value = (g && g.email) || '';
          });
        var sum = document.getElementById('cm-rs-summary');
        if (sum) sum.textContent = _cmRosterSummary(cid);
      },
    ));
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
        state._cmGuardiansReady[cid] &&
        !_cmGuardiansFor(cid, st.id).some(function (g) {
          return g.email;
        })
      )
        noParent++;
    });
    var parts = [];
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

  function _cmRosterRowHtml(cid, st, i, marks) {
    var g = _cmGuardiansFor(cid, st.id);
    var ell = (st.designations || []).indexOf('ELL') >= 0;
    var name = ((st.firstName || '') + ' ' + (st.lastName || '') + ' ' + (st.preferred || '')).toLowerCase();
    marks = marks || {};
    var isNew = marks.added && marks.added[st.id];
    var out = marks.only && !marks.only[st.id];
    return (
      '<div class="cm-rs-grid cm-rs-row' +
      (i % 2 ? ' cm-rs-alt' : '') +
      (isNew ? ' cm-rs-new' : '') +
      '" data-sid="' +
      esc(st.id) +
      '" data-name="' +
      esc(name) +
      '"' +
      (out || (state.cmRosterQuery && name.indexOf(state.cmRosterQuery) < 0) ? ' hidden' : '') +
      '>' +
      '<span class="cm-rs-stick1">' +
      _cmRosterInput(st, 'last', st.lastName, 'Last name') +
      (isNew ? '<span class="cm-rs-new-tag">New</span>' : '') +
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
      var on = state.cmRosterSortMode === mode;
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
    var marks = { added: _cmImportNewIds(cid), only: _cmRosterOnlyIds() };
    var shown = 0;
    students.forEach(function (st) {
      var hide = marks.only && !marks.only[st.id];
      html += _cmRosterRowHtml(cid, st, hide ? 0 : shown++, marks);
    });
    html += '</div></div>';
    return html;
  }

  function cmRosterSort(mode) {
    state.cmRosterSortMode = mode === 'firstName' ? 'firstName' : 'lastName';
    renderClassManager();
  }

  function cmRosterSearch(q) {
    state.cmRosterQuery = String(q || '')
      .trim()
      .toLowerCase();
    var n = 0;
    document.querySelectorAll('.cm-rs-row').forEach(function (row) {
      var only = _cmRosterOnlyIds();
      var hit =
        (!only || only[/** @type {any} */ (row).dataset.sid]) &&
        (!state.cmRosterQuery ||
          /** @type {any} */ (/** @type {any} */ (row).dataset.name || '').indexOf(state.cmRosterQuery) >= 0);
      /** @type {any} */ (row).hidden = !hit;
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
    var cid = state.cmSelectedCourse;
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

  /* What a roster box holds on record now, or null when it isn't a field. */
  function _cmRosterSavedValue(el) {
    var cid = state.cmSelectedCourse;
    var col = el.dataset.col;
    if (!cid) return null;
    if (col === 'g0' || col === 'g1') {
      var g = _cmGuardiansFor(cid, el.dataset.sid)[col === 'g0' ? 0 : 1];
      return g ? g.email || '' : '';
    }
    var key = ROSTER_FIELD[col];
    if (!key) return null;
    var st = getStudents(cid).find(function (s) {
      return s.id === el.dataset.sid;
    });
    return st ? st[key] || '' : null;
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
      if (g && g.id && window.v2 && window.v2.deleteGuardian) /** @type {any} */ (window.v2.deleteGuardian)(g.id);
      mine.splice(idx, 1);
    } else if (g) {
      g.email = email;
      if (g.id && _isServerPerson(st))
        /** @type {any} */ (window.v2.upsertGuardian)({
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
    var cid = state.cmSelectedCourse;
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
    var cid = state.cmSelectedCourse;
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
    if (add) /** @type {any} */ (add).focus();
  }

  function cmRosterDesigRemove(sid, code) {
    var st = getStudents(state.cmSelectedCourse).find(function (s) {
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
    var st = getStudents(state.cmSelectedCourse).find(function (s) {
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
      var btn = /** @type {any} */ (p.parentElement).querySelector('.cm-rs-add');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      p.remove();
      any = true;
    });
    return any;
  }

  function cmRosterDesigAdd(sid, code) {
    var st = getStudents(state.cmSelectedCourse).find(function (s) {
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
      // Escape cancels, as in the gradebook: the box goes back to what is
      // saved before it loses focus, so the blur has nothing to save.
      if (el.type !== 'checkbox') {
        var saved = _cmRosterSavedValue(el);
        if (saved !== null) el.value = saved;
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
    var box = btn.closest('.cm-rs-scroll, .cm-import-cols-scroll');
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
    /** @type {any} */
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
    var cid = state.cmSelectedCourse;
    if (!cid || !sid) return;
    state.classManagerOpen = false;
    if (typeof StudentPageStudents !== 'undefined') StudentPageStudents.closeAll();
    _cmNoteOpened(cid);
    if (typeof setActiveCourse === 'function') setActiveCourse(cid);
    /** @type {any} */ (/** @type {any} */ (/** @type {any} */ (Router))).navigate(
      '/student?course=' + encodeURIComponent(cid) + '&id=' + encodeURIComponent(sid),
    );
  }

  return {
    configure: configure,
    _cmCloseRosterPicker: _cmCloseRosterPicker,
    _cmFloatOverScroll: _cmFloatOverScroll,
    _cmGuardianEmails: _cmGuardianEmails,
    _cmGuardiansFor: _cmGuardiansFor,
    _cmLoadGuardians: _cmLoadGuardians,
    _cmRosterHtml: _cmRosterHtml,
    _cmRosterKeydown: _cmRosterKeydown,
    _cmRosterSummary: _cmRosterSummary,
    _cmSetGuardianEmail: _cmSetGuardianEmail,
    cmCloseAddStudent: cmCloseAddStudent,
    cmOpenStudentPage: cmOpenStudentPage,
    cmRemoveStudent: cmRemoveStudent,
    cmRosterDesigAdd: cmRosterDesigAdd,
    cmRosterDesigOpen: cmRosterDesigOpen,
    cmRosterDesigRemove: cmRosterDesigRemove,
    cmRosterEll: cmRosterEll,
    cmRosterField: cmRosterField,
    cmRosterSearch: cmRosterSearch,
    cmRosterSort: cmRosterSort,
    cmSaveStudent: cmSaveStudent,
    cmShowAddStudent: cmShowAddStudent,
  };
})();
