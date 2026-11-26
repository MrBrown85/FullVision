// @ts-check
/* cm-guardians.js — Class Settings: guardian addresses. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmGuardians = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var ROSTER_FIELD_MENU,
    ROSTER_SKIPPED_HEADERS,
    _ROSTER_NUM_DATE,
    _cmFocus,
    _cmGuardians,
    _cmGuardiansFor,
    _rosterCodes,
    _rosterColumn,
    _rosterDate,
    _rosterHeaderKey,
    rosterDateOrder,
    rosterImportReady,
    rosterImportTable,
    rosterRowsFromTable,
    state,
    _cmAttr,
    _cmRenderAndFocus,
    renderClassManager;
  function configure(h) {
    if ('ROSTER_FIELD_MENU' in h) ROSTER_FIELD_MENU = h.ROSTER_FIELD_MENU;
    if ('ROSTER_SKIPPED_HEADERS' in h) ROSTER_SKIPPED_HEADERS = h.ROSTER_SKIPPED_HEADERS;
    if ('_ROSTER_NUM_DATE' in h) _ROSTER_NUM_DATE = h._ROSTER_NUM_DATE;
    if ('_cmFocus' in h) _cmFocus = h._cmFocus;
    if ('_cmGuardians' in h) _cmGuardians = h._cmGuardians;
    if ('_cmGuardiansFor' in h) _cmGuardiansFor = h._cmGuardiansFor;
    if ('_rosterCodes' in h) _rosterCodes = h._rosterCodes;
    if ('_rosterColumn' in h) _rosterColumn = h._rosterColumn;
    if ('_rosterDate' in h) _rosterDate = h._rosterDate;
    if ('_rosterHeaderKey' in h) _rosterHeaderKey = h._rosterHeaderKey;
    if ('rosterDateOrder' in h) rosterDateOrder = h.rosterDateOrder;
    if ('rosterImportReady' in h) rosterImportReady = h.rosterImportReady;
    if ('rosterImportTable' in h) rosterImportTable = h.rosterImportTable;
    if ('rosterRowsFromTable' in h) rosterRowsFromTable = h.rosterRowsFromTable;
    if ('state' in h) state = h.state;
    if ('_cmAttr' in h) _cmAttr = h._cmAttr;
    if ('_cmRenderAndFocus' in h) _cmRenderAndFocus = h._cmRenderAndFocus;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
  }

  /* ── Guardian addresses from the roster and the import ──────
     Stored on the server's guardian table; nothing is emailed from
     FullVision (families are emailed from the teacher's Outlook). A student
     the server hasn't created yet has no person id to attach a guardian to,
     so the address is kept on the student record and saved to the guardian
     table once the id arrives. */
  function _cmAddGuardianEmail(cid, st, email) {
    var list = (_cmGuardians[cid] = _cmGuardians[cid] || {});
    var mine = (list[st.id] = list[st.id] || []);
    if (
      mine.some(function (g) {
        return (g.email || '').toLowerCase() === email.toLowerCase();
      })
    )
      return;
    var fresh = { name: 'Parent / Guardian', email: email };
    mine.push(fresh);
    if (_isServerPerson(st)) _cmSendGuardian(st, fresh);
    else st.pendingGuardianEmails = (st.pendingGuardianEmails || []).concat([email]);
  }

  function _isServerPerson(st) {
    return !!(st && /^[0-9a-f-]{36}$/i.test(st.personId || '') && window.v2 && window.v2.upsertGuardian);
  }

  function _cmSendGuardian(st, g) {
    return /** @type {any} */ (window.v2.upsertGuardian)({ studentId: st.personId, name: g.name, email: g.email }).then(
      function (res) {
        var row = res && res.data;
        if (row && row.id) g.id = row.id;
      },
    );
  }

  function _cmFlushPendingGuardians(cid) {
    var students = getStudents(cid);
    var changed = false;
    students.forEach(function (st) {
      if (!st.pendingGuardianEmails || !st.pendingGuardianEmails.length || !_isServerPerson(st)) return;
      var mine = _cmGuardiansFor(cid, st.id);
      st.pendingGuardianEmails.forEach(function (email) {
        var g = mine.find(function (x) {
          return x.email === email && !x.id;
        }) || { name: 'Parent / Guardian', email: email };
        _cmSendGuardian(st, g);
      });
      delete st.pendingGuardianEmails;
      changed = true;
    });
    if (changed) saveStudents(cid, students);
  }

  function cmHandleCSV(input) {
    var file = input.files[0];
    if (!file) return;
    var name = file.name || 'the file';
    state.cmImportDone = null;
    state.cmRosterOnly = null;
    if (/\.(xlsx|xlsm|xls|ods|numbers)$/i.test(name)) {
      input.value = '';
      _cmImportFail('excel', name);
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var text = String(/** @type {any} */ (e.target).result || '');
      if (/^PK\u0003\u0004/.test(text) || text.indexOf('\u0000') >= 0) {
        _cmImportFail('excel', name);
        return;
      }
      var table = rosterImportTable(text);
      if (!table.body.length) {
        _cmImportFail('empty', name);
        return;
      }
      state.cmImportFormatOpen = false;
      state.cmImportError = null;
      cmStartImport(table, name);
    };
    reader.readAsText(file);
    input.value = '';
  }

  function _cmImportFail(kind, fileName) {
    state.cmPendingImport = null;
    state.cmImportFormatOpen = false;
    state.cmImportError = { kind: kind, fileName: fileName };
    renderClassManager();
    var btn = document.querySelector('.cm-import-card [data-action="cmChooseRosterFile"]');
    _cmFocus(btn);
  }

  /* A file read: plan it. A file with no column of names asks first. */
  function cmStartImport(table, fileName) {
    state.cmImportError = null;
    state.cmImportFormatOpen = false;
    var plan = { fileName: fileName || '', table: table, fixes: {}, keep: {}, showColumns: false, showAll: false };
    plan.nonames = !table.map.some(_cmIsNameField);
    _cmPlanImport(plan);
    var head = document.getElementById('cm-import-title');
    _cmFocus(head);
  }

  function _cmIsNameField(f) {
    return f === 'firstName' || f === 'lastName' || f === 'fullName';
  }

  /* For tests and callers with rows already read. */
  function cmShowImportPreview(parsed, fileName, table, skipped) {
    var plan = { fileName: fileName || '', table: table || null, fixes: {}, keep: {}, showColumns: false };
    if (!table) plan.parsed = { rows: parsed || [], problems: [], unnamed: [], waiting: {}, skipped: skipped || {} };
    _cmPlanImport(plan);
  }

  /* Import review. Rows are matched to the roster by student number, then
     by name: a matched number with a different name is a name change, and a
     student the file leaves out is offered for withdrawal (off by default).
     What the teacher ticked stays ticked when the file is read again. */
  function _cmImportKey(v) {
    return String(v || '')
      .trim()
      .toLowerCase();
  }

  function _cmPlanImport(plan) {
    var cid = state.cmSelectedCourse;
    if (!cid) return;
    var read = plan.table ? rosterRowsFromTable(plan.table, plan.fixes) : plan.parsed;
    var roster = getStudents(cid);
    var byNum = {};
    var byName = {};
    roster.forEach(function (s) {
      if (_cmImportKey(s.studentNumber)) byNum[_cmImportKey(s.studentNumber)] = s;
      byName[_cmImportKey(fullName(s))] = s;
    });
    var on = function (key, dflt) {
      return plan.keep[key] === undefined ? dflt : plan.keep[key];
    };
    var matched = {};
    plan.read = read;
    plan.total = read.rows.length;
    plan.added = [];
    plan.renamed = [];
    plan.updated = [];
    plan.missing = [];
    plan.same = 0;
    read.rows.forEach(function (p, i) {
      var name = _cmImportKey((p.firstName || '') + ' ' + (p.lastName || ''));
      var hit = (_cmImportKey(p.studentNumber) && byNum[_cmImportKey(p.studentNumber)]) || byName[name];
      if (!hit || matched[hit.id]) {
        if (!hit) {
          var key = 'a' + (p.line || 'i' + i);
          plan.added.push({ row: p, key: key, on: on(key, true) });
        }
        return;
      }
      matched[hit.id] = true;
      var sameName =
        _cmImportKey(hit.firstName) === _cmImportKey(p.firstName) &&
        _cmImportKey(hit.lastName) === _cmImportKey(p.lastName);
      if (!sameName && p.firstName)
        plan.renamed.push({ sid: hit.id, row: p, key: 'r' + hit.id, on: on('r' + hit.id, true) });
      var fields = _cmImportChanges(cid, hit, p);
      if (fields.length)
        plan.updated.push({ sid: hit.id, row: p, fields: fields, key: 'u' + hit.id, on: on('u' + hit.id, true) });
      else if (sameName || !p.firstName) plan.same++;
    });
    sortStudents(roster, 'lastName').forEach(function (s) {
      if (!matched[s.id]) plan.missing.push({ sid: s.id, key: 'm' + s.id, on: on('m' + s.id, false) });
    });
    state.cmPendingImport = plan;
    renderClassManager();
  }

  /* What a matched row would change, as [{ label, from, to }]: a field the
     file fills and the roster has differently, a designation the student
     doesn't have yet, a parent email not on file. Blank cells change
     nothing. */
  var IMPORT_FIELD_LABELS = {
    preferred: 'Preferred Name',
    pronouns: 'Pronouns',
    studentNumber: 'Student Number',
    dateOfBirth: 'Date of Birth',
    email: 'Student Email',
  };
  function _cmImportChanges(cid, st, p) {
    var out = [];
    Object.keys(IMPORT_FIELD_LABELS).forEach(function (k) {
      if (p[k] && String(p[k]) !== String(st[k] || ''))
        out.push({ label: IMPORT_FIELD_LABELS[k], from: st[k] || '', to: String(p[k]) });
    });
    var have = st.designations || [];
    var newCodes = (p.designations || []).filter(function (c) {
      return have.indexOf(c) < 0;
    });
    if (newCodes.length) out.push({ label: 'Designations', from: '', to: '+ ' + newCodes.join(', '), add: true });
    var known = _cmGuardiansFor(cid, st.id).map(function (g) {
      return (g.email || '').toLowerCase();
    });
    var newParents = (p.parentEmails || []).filter(function (e) {
      return known.indexOf(e.toLowerCase()) < 0;
    });
    if (newParents.length)
      out.push({
        label: newParents.length === 1 ? 'Parent Email' : 'Parent Emails',
        from: '',
        to: '+ ' + newParents.join(', '),
        add: true,
      });
    return out;
  }

  var _CM_FIELD_LABEL = {};

  function _cmRowName(p) {
    return ((p.firstName || '') + ' ' + (p.lastName || '')).trim();
  }

  function _cmJoinWords(list) {
    if (list.length < 2) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  function _cmPlural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* What a column holds, in a line under its choice. */
  function _cmColumnNote(t, i) {
    var f = t.map[i];
    var vals = _rosterColumn(t, i);
    var header = _rosterHeaderKey(t.headers[i]);
    if (!f) {
      if (t.suggest[i] === 'designations') {
        var codes = {};
        vals.forEach(function (v) {
          _rosterCodes(v).forEach(function (c) {
            codes[c] = true;
          });
        });
        return (
          'Looks like designations (' + _cmJoinWords(Object.keys(codes).slice(0, 3)) + '). Left out unless you choose.'
        );
      }
      if (!vals.length) return 'Empty.';
      if (ROSTER_SKIPPED_HEADERS.indexOf(header) >= 0) return "FullVision doesn't keep this.";
      if (/note|comment/.test(header)) return 'FullVision has no place for notes. Add them as observations.';
      var distinct = {};
      vals.forEach(function (v) {
        distinct[v] = true;
      });
      var one = Object.keys(distinct);
      if (one.length === 1 && vals.length > 1) return one[0] + ' in every row.';
      return 'FullVision leaves this column out.';
    }
    if (f === 'fullName') {
      var commas = vals.filter(function (v) {
        return v.indexOf(',') >= 0;
      }).length;
      return commas >= vals.length / 2 ? 'Read as Last, First.' : 'Read as First Last.';
    }
    if (f === 'dateOfBirth') {
      var order = t.dateOrder[i];
      var sample = vals.find(function (v) {
        var m = _ROSTER_NUM_DATE.exec(v);
        return m && (order === 'mdy' ? +m[2] > 12 : +m[1] > 12);
      });
      if (order === 'mdy')
        return (
          'Read as month/day/year' + (sample ? ': ' + sample + ' can only be ' + _cmSayDate(sample, 'mdy') + '.' : '.')
        );
      if (order === 'dmy')
        return (
          'Read as day/month/year' + (sample ? ': ' + sample + ' can only be ' + _cmSayDate(sample, 'dmy') + '.' : '.')
        );
      if (order === 'ask') return '';
      return 'Year first, or written out.';
    }
    if (t.how[i] !== 'guess') return '';
    if (f === 'studentNumber') {
      var lens = {};
      vals.forEach(function (v) {
        lens[v.replace(/\D/g, '').length] = true;
      });
      var k = Object.keys(lens);
      return (k.length === 1 ? k[0] + '-digit numbers' : 'Numbers') + ", like MyEd's Pupil #.";
    }
    if (f === 'parentEmail' || f === 'parentEmail2')
      return 'Every cell is an email address. Kept for you; FullVision never emails families.';
    if (f === 'email') return 'Every cell is an address at ' + (vals[0] || '').split('@')[1] + '.';
    if (f === 'pronouns') return 'Every cell is pronouns.';
    return '';
  }

  function _cmSayDate(v, order) {
    var d = _rosterDate(v, order);
    if (!d) return v;
    var p = d.split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[+p[1] - 1] + ' ' + +p[2];
  }

  /* A column's problems, said once on the column. */
  function _cmColumnIssue(plan, i) {
    var t = plan.table;
    var f = t.map[i];
    var read = plan.read;
    var count = function (kind) {
      return read.problems.filter(function (pr) {
        return pr.kind === kind;
      }).length;
    };
    if (_cmIsNameField(f) && read.unnamed.length)
      return _cmPlural(read.unnamed.length, 'row has', 'rows have') + ' no name';
    if (f === 'studentNumber' && count('number'))
      return _cmPlural(count('number'), 'number is', 'numbers are') + ' used twice';
    if (f === 'dateOfBirth' && count('date')) return _cmPlural(count('date'), "date isn't real", "dates can't be read");
    if ((f === 'email' || f === 'parentEmail' || f === 'parentEmail2') && count('email'))
      return _cmPlural(count('email'), "cell isn't an email address", "cells aren't email addresses");
    if (f === 'designations' && count('code'))
      return _cmPlural(count('code'), "code isn't a BC code", "codes aren't BC codes");
    return '';
  }

  /* The column menu, on the column's button: each choice says what it takes
     and which column already uses it (choosing it swaps the two). */
  function _cmFieldMenuHtml(t, i) {
    var cur = t.map[i] || '';
    var usedBy = {};
    t.map.forEach(function (f, j) {
      if (f && j !== i && !usedBy[f]) usedBy[f] = t.headers[j] || 'Column ' + (j + 1);
    });
    var item = function (field, hint) {
      var on = field === cur;
      return (
        '<button type="button" role="menuitemradio" aria-checked="' +
        on +
        '" class="cm-std-menu-item cm-import-field-item' +
        (on ? ' is-on' : '') +
        '" data-action="cmImportPick" data-col="' +
        i +
        '" data-field="' +
        field +
        '"><span class="cm-import-item-top"><span>' +
        (on ? '✓ ' : '') +
        esc(field ? _CM_FIELD_LABEL[field] : "Don't Import") +
        '</span>' +
        (on && t.how[i] === 'guess'
          ? '<span class="cm-import-item-guess">Best Guess</span>'
          : usedBy[field]
            ? '<span class="cm-import-item-used">Used by ' + esc(usedBy[field]) + '</span>'
            : '') +
        '</span><span class="cm-import-item-hint">' +
        esc(hint) +
        '</span></button>'
      );
    };
    return (
      '<div class="cm-std-menu cm-import-field-menu" role="menu" aria-label="' +
      esc('What ' + (t.headers[i] || 'column ' + (i + 1)) + ' holds') +
      '" hidden>' +
      ROSTER_FIELD_MENU.map(function (g) {
        return (
          '<div role="group" aria-label="' +
          esc(g[0]) +
          '"><div class="cm-import-menu-group" aria-hidden="true">' +
          esc(g[0]) +
          '</div>' +
          g[1]
            .map(function (it) {
              return item(it[0], it[1]);
            })
            .join('') +
          '</div>'
        );
      }).join('') +
      '<div role="group" aria-label="Leave Out">' +
      item('', 'FullVision leaves this column out.') +
      '</div></div>'
    );
  }

  /* The columns, each with FullVision's choice above the first rows. */
  function _cmImportColumnsHtml(plan) {
    var t = plan.table;
    var cols = t.headers.map(function (h, i) {
      return i;
    });
    var tracks = cols
      .map(function (i) {
        return t.map[i] ? 'minmax(150px, 1.4fr)' : 'minmax(132px, 0.9fr)';
      })
      .join(' ');
    var head = cols
      .map(function (i) {
        var f = t.map[i] || '';
        var label = t.headers[i] || 'Column ' + (i + 1);
        var tag =
          t.how[i] === 'header'
            ? '<span class="cm-import-tag is-read">Read</span>'
            : t.how[i] === 'guess' || t.how[i] === 'order'
              ? '<span class="cm-import-tag is-guess">Best Guess</span>'
              : '';
        var note = _cmColumnNote(t, i);
        var issue = _cmColumnIssue(plan, i);
        var ask =
          t.dateOrder[i] === 'ask'
            ? '<div class="cm-import-ask" role="group" aria-label="' +
              esc('Which comes first in ' + label) +
              '"><span>Which comes first? Every date here could be either.</span>' +
              '<span class="cm-import-ask-btns"><button type="button" class="cm-action-btn" data-action="cmImportDateOrder" data-col="' +
              i +
              '" data-order="mdy">Month</button><button type="button" class="cm-action-btn" data-action="cmImportDateOrder" data-col="' +
              i +
              '" data-order="dmy">Day</button></span></div>'
            : '';
        var suggest =
          !f && t.suggest[i]
            ? '<button type="button" class="cm-import-suggest" data-action="cmImportPick" data-col="' +
              i +
              '" data-field="' +
              t.suggest[i] +
              '">Import as ' +
              esc(_CM_FIELD_LABEL[t.suggest[i]]) +
              '</button>'
            : '';
        return (
          '<div class="cm-import-col-head' +
          (f ? '' : ' is-out') +
          '"><strong class="cm-import-col-name">' +
          esc(label) +
          '</strong>' +
          '<span class="cm-std-menu-wrap cm-import-field-wrap">' +
          '<button type="button" class="cm-import-field-btn" data-action="cmStdMenu" data-col="' +
          i +
          '" aria-haspopup="menu" aria-expanded="false" aria-label="' +
          esc('What ' + label + ' holds: ' + (f ? _CM_FIELD_LABEL[f] : "Don't Import")) +
          '">' +
          esc(f ? _CM_FIELD_LABEL[f] : "Don't Import") +
          '<span aria-hidden="true">▾</span></button>' +
          _cmFieldMenuHtml(t, i) +
          '</span>' +
          tag +
          (note ? '<span class="cm-import-col-note">' + esc(note) + '</span>' : '') +
          ask +
          (issue ? '<span class="cm-import-col-issue">' + esc(issue) + '</span>' : '') +
          suggest +
          '</div>'
        );
      })
      .join('');
    var rows = t.body
      .slice(0, 4)
      .map(function (r) {
        return cols
          .map(function (i) {
            return '<span class="cm-import-cell' + (t.map[i] ? '' : ' is-out') + '">' + esc(r[i] || '') + '</span>';
          })
          .join('');
      })
      .join('');
    var more =
      t.body.length > 4
        ? '<div class="cm-import-more">and ' + _cmPlural(t.body.length - 4, 'more row', 'more rows') + '</div>'
        : '';
    return (
      '<div class="cm-import-cols-scroll">' +
      '<div class="cm-import-cols" style="grid-template-columns:' +
      tracks +
      '">' +
      head +
      rows +
      '</div>' +
      more +
      '</div>'
    );
  }

  /* What FullVision needs from the file: names, and student numbers so a
     second import updates instead of adding everyone again. */
  function _cmImportNeedsHtml(t) {
    var from = function (test) {
      return t.headers
        .map(function (h, i) {
          return test(t.map[i]) ? h || 'Column ' + (i + 1) : '';
        })
        .filter(Boolean);
    };
    var names = from(_cmIsNameField);
    var nums = from(function (f) {
      return f === 'studentNumber';
    });
    return (
      '<div class="cm-import-needs">' +
      (names.length
        ? '<span class="cm-import-need is-ok"><strong>✓ Names</strong> from ' +
          esc(_cmJoinWords(names)) +
          ' · needed</span>'
        : '<span class="cm-import-need is-missing"><strong>Names</strong> · choose the column that holds them</span>') +
      (nums.length
        ? '<span class="cm-import-need is-ok"><strong>✓ Student Numbers</strong> from ' +
          esc(_cmJoinWords(nums)) +
          ' · so importing again updates students instead of adding them twice</span>'
        : '<span class="cm-import-need"><strong>No Student Numbers</strong> · importing again will match students by name</span>') +
      '</div>'
    );
  }

  /* The rows that need a look, each with what will happen and a box to fix
     it. Nothing here stops the import. */
  function _cmImportProblemsHtml(plan) {
    var read = plan.read;
    var addedRows = plan.added.map(function (a) {
      return a.row;
    });
    var items = read.problems
      .map(function (pr) {
        return { line: pr.line, pr: pr };
      })
      .concat(
        read.unnamed.map(function (u) {
          return { line: u.line, unnamed: u };
        }),
      )
      .sort(function (a, b) {
        return a.line - b.line;
      });
    if (!items.length) return '';
    var lines = {};
    items.forEach(function (it) {
      lines[it.line] = true;
    });
    var count = Object.keys(lines).length;
    var fix = function (line, field, label, placeholder, value) {
      return (
        '<label class="cm-import-fix"><span>' +
        esc(label) +
        '</span><input class="cm-input" type="text" data-action-change="cmImportFix" data-line="' +
        line +
        '" data-field="' +
        field +
        '" placeholder="' +
        esc(placeholder) +
        '" value="' +
        esc(value || '') +
        '"></label>'
      );
    };
    var html = items
      .map(function (it) {
        var line = it.line;
        var typed = plan.fixes[line] || {};
        var label = '<span class="cm-import-rownum">Row ' + line + '</span>';
        if (it.unnamed) {
          return (
            '<div class="cm-import-problem">' +
            label +
            '<strong class="cm-import-problem-name is-missing">No name</strong>' +
            '<span>This row has no name, so it will be left out. <span class="cm-hint">' +
            esc(it.unnamed.cells.join(' · ')) +
            '</span></span>' +
            fix(line, 'name', 'Type a name to add them', 'Last, First', typed.name) +
            '</div>'
          );
        }
        var pr = it.pr;
        var p = pr.p;
        var first = p.preferred || p.firstName || _cmRowName(p);
        var isNew = addedRows.indexOf(p) >= 0;
        var text, then, box;
        if (pr.kind === 'date') {
          text = _rosterYmdLike(pr.value)
            ? 'Birthday “' + pr.value + "” isn't a real date."
            : 'Birthday “' + pr.value + "” can't be read.";
          then = isNew ? first + ' will be added without a birthday.' : first + "'s birthday isn't changed.";
          box = fix(line, 'dateOfBirth', 'Birthday', 'Like 2012-09-30', typed.dateOfBirth);
        } else if (pr.kind === 'number') {
          text =
            'Student number ' + pr.value + ' is also ' + _cmRowName(pr.other) + "'s, in row " + pr.other.line + '.';
          then = isNew
            ? first + ' will be added without one. MyEd has the right number.'
            : first + "'s number isn't changed.";
          box = fix(line, 'studentNumber', 'Student Number', 'Their number', typed.studentNumber);
        } else if (pr.kind === 'email') {
          text = '“' + pr.value + "” isn't an email address, so it's left out.";
          then = '';
          box = '';
        } else {
          text = '“' + pr.value + "” isn't a BC designation code, so it's left out.";
          then = '';
          box = '';
        }
        return (
          '<div class="cm-import-problem">' +
          label +
          '<strong class="cm-import-problem-name">' +
          esc(_cmRowName(p)) +
          '</strong><span>' +
          esc(text) +
          (then ? ' <span class="cm-hint">' + esc(then) + '</span>' : '') +
          '</span>' +
          box +
          '</div>'
        );
      })
      .join('');
    return (
      '<div class="cm-import-problems-head"><h3>' +
      (count === 1 ? '1 Row Needs a Look' : count + ' Rows Need a Look') +
      '</h3><span class="cm-hint">Nothing here stops the import. Fix what you can now, or later in the student table.</span></div>' +
      '<div class="cm-import-problems">' +
      html +
      '</div>'
    );
  }

  function _rosterYmdLike(v) {
    return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v) || _ROSTER_NUM_DATE.test(v) || /[a-z]{3}/i.test(v);
  }

  /* The students a first import adds, under FullVision's column names. */
  function _cmImportStudentListHtml(plan) {
    var t = plan.table;
    var cols = [
      ['lastName', 'Last Name'],
      ['firstName', 'First Name'],
    ];
    ['preferred', 'pronouns', 'studentNumber', 'dateOfBirth', 'email'].forEach(function (f) {
      if (
        !t ||
        plan.added.some(function (a) {
          return a.row[f];
        })
      )
        cols.push([f, f === 'preferred' ? 'Preferred' : _CM_FIELD_LABEL[f]]);
    });
    var shown = plan.showAll ? plan.added : plan.added.slice(0, 10);
    var allOn = plan.added.every(function (a) {
      return a.on;
    });
    var tracks =
      '36px ' +
      cols
        .map(function (c) {
          return c[0] === 'email' ? 'minmax(0, 2fr)' : 'minmax(0, 1fr)';
        })
        .join(' ');
    return (
      '<div class="cm-import-list" style="--cm-import-cols:' +
      tracks +
      '">' +
      '<div class="cm-import-list-row is-head"><input type="checkbox" data-action-change="cmImportToggleAll"' +
      (allOn ? ' checked' : '') +
      ' aria-label="All students in the file">' +
      cols
        .map(function (c) {
          return '<span>' + esc(c[1]) + '</span>';
        })
        .join('') +
      '</div>' +
      shown
        .map(function (a, i) {
          return (
            '<label class="cm-import-list-row"><input type="checkbox" data-action-change="cmImportToggle" data-kind="added" data-idx="' +
            i +
            '"' +
            (a.on ? ' checked' : '') +
            ' aria-label="' +
            esc('Add ' + _cmRowName(a.row)) +
            '">' +
            cols
              .map(function (c) {
                return (
                  '<span' +
                  (c[0] === 'lastName' || c[0] === 'firstName' ? ' class="is-name"' : '') +
                  '>' +
                  esc(a.row[c[0]] || '') +
                  '</span>'
                );
              })
              .join('') +
            '</label>'
          );
        })
        .join('') +
      '</div>' +
      (plan.added.length > shown.length
        ? '<button type="button" class="cm-import-link" data-action="cmImportShowAll">Show All ' +
          plan.added.length +
          '</button>'
        : '')
    );
  }

  /* A class with students: what the file will change, in groups. */
  function _cmImportGroupsHtml(cid, plan) {
    var byId = {};
    getStudents(cid).forEach(function (s) {
      byId[s.id] = s;
    });
    function group(title, kind, items, render, note) {
      if (!items.length) return '';
      return (
        '<div class="cm-import-group"><div class="cm-import-group-head"><h3>' +
        title +
        '</h3><span>' +
        items.length +
        '</span></div>' +
        items
          .map(function (it, i) {
            return (
              '<label class="cm-import-row"><input type="checkbox"' +
              (it.on ? ' checked' : '') +
              ' data-action-change="cmImportToggle" data-kind="' +
              kind +
              '" data-idx="' +
              i +
              '">' +
              render(it) +
              '</label>'
            );
          })
          .join('') +
        (note ? '<div class="cm-hint">' + note + '</div>' : '') +
        '</div>'
      );
    }
    var num = function (n) {
      return '<span class="cm-roster-num">' + esc(n || '') + '</span>';
    };
    var left =
      group('New to This Class', 'added', plan.added, function (a) {
        return (
          '<span class="cm-import-name"><strong>' +
          esc(_cmRowName(a.row)) +
          '</strong></span>' +
          num(a.row.studentNumber)
        );
      }) +
      group(
        'Name Changed',
        'renamed',
        plan.renamed,
        function (r) {
          var st = byId[r.sid] || {};
          return (
            '<span class="cm-import-name"><span class="cm-import-old">' +
            esc(fullName(st)) +
            '</span> → <strong>' +
            esc(_cmRowName(r.row)) +
            '</strong></span>' +
            num(st.studentNumber)
          );
        },
        'Same student number, so their scores and observations stay with them.',
      ) +
      group(
        'In Your Class, Not in This File',
        'missing',
        plan.missing,
        function (m) {
          var st = byId[m.sid] || {};
          return (
            '<span class="cm-import-name"><strong>' +
            esc(fullName(st)) +
            '</strong> · Withdraw from this class</span>' +
            num(st.studentNumber)
          );
        },
        'Left unticked, they stay. A withdrawn student keeps their scores and can be enrolled again.',
      );
    var right =
      group(
        'Details Updated',
        'updated',
        plan.updated,
        function (u) {
          var st = byId[u.sid] || {};
          return (
            '<span class="cm-import-name"><strong>' +
            esc(fullName(st)) +
            '</strong></span><span class="cm-import-changes">' +
            u.fields
              .map(function (c) {
                return (
                  '<span>' +
                  esc(c.label) +
                  ' ' +
                  (c.add
                    ? esc(c.to)
                    : '<span class="cm-import-old">' + esc(c.from || 'blank') + ' →</span> ' + esc(c.to)) +
                  '</span>'
                );
              })
              .join('') +
            '</span>'
          );
        },
        'A blank cell never clears anything. Designations and parent emails are added, never removed.',
      ) +
      (plan.same
        ? '<div class="cm-import-group cm-import-same"><h3>Already Up to Date</h3><span>' +
          _cmPlural(plan.same, 'student', 'students') +
          ', no changes</span></div>'
        : '');
    return '<div class="cm-import-groups"><div>' + left + '</div><div>' + right + '</div></div>';
  }

  function _cmImportCounts(plan) {
    var n = function (list) {
      return list.filter(function (x) {
        return x.on;
      }).length;
    };
    return { added: n(plan.added), renamed: n(plan.renamed), updated: n(plan.updated), withdrawn: n(plan.missing) };
  }

  /* Rows added with a blank to fill in: a date or number that needs a look. */
  function _cmImportBlanks(plan) {
    var rows = plan.added
      .filter(function (a) {
        return a.on;
      })
      .map(function (a) {
        return a.row;
      });
    return plan.read.problems.filter(function (pr) {
      return (pr.kind === 'date' || pr.kind === 'number') && rows.indexOf(pr.p) >= 0;
    });
  }

  function _cmRenderImportReview(cid) {
    var plan = state.cmPendingImport;
    if (!plan) return '';
    var t = plan.table;
    if (plan.nonames && t) {
      var heads = t.headers.filter(Boolean);
      return (
        '<div class="cm-section cm-import-card" role="region" aria-labelledby="cm-import-title">' +
        '<div class="cm-import-card-head"><span class="cm-import-card-mark" aria-hidden="true">!</span><h2 id="cm-import-title" tabindex="-1">No Names Found</h2></div>' +
        '<p class="cm-import-card-text">FullVision couldn\'t find a column of student names in <strong>' +
        esc(plan.fileName) +
        '</strong>.' +
        (heads.length ? ' Its columns are ' + esc(_cmJoinWords(heads)) + '.' : '') +
        '</p><p class="cm-hint">If one of them holds the names, choose it. If this is the wrong file, choose another.</p>' +
        '<div class="cm-import-buttons"><button type="button" class="btn btn-primary" data-action="cmImportChooseNames">Choose the Name Column</button>' +
        '<button type="button" class="cm-action-btn" data-action="cmChooseRosterFile">Choose Another File</button>' +
        '<button type="button" class="cm-action-btn" data-action="cmCancelImport">Cancel</button></div>' +
        '</div>'
      );
    }
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var className = course.name || 'this class';
    var first = !getStudents(cid).length;
    var ready = !plan.showColumns && (!t || rosterImportReady(t));
    var counts = _cmImportCounts(plan);
    var left = t
      ? t.headers.filter(function (h, i) {
          return h && !t.map[i] && _rosterColumn(t, i).length;
        })
      : [];
    var title, sub;
    if (first) {
      title = ready
        ? 'Ready to Add ' + _cmPlural(plan.added.length, 'Student', 'Students')
        : 'Check How Your File Was Read';
      sub = ready
        ? 'From <strong>' + esc(plan.fileName) + '</strong>'
        : '<strong>' +
          esc(plan.fileName) +
          '</strong> · ' +
          _cmPlural(t ? t.body.length : plan.total, 'row', 'rows') +
          ". Above each of your columns is what FullVision will do with it. Change any that's wrong.";
    } else {
      title = 'What This File Will Change';
      var said = [];
      if (plan.added.length) said.push(_cmPlural(plan.added.length, 'new student', 'new students'));
      if (plan.renamed.length) said.push(_cmPlural(plan.renamed.length, 'new name', 'new names'));
      if (plan.updated.length) said.push(_cmPlural(plan.updated.length, 'updated detail', 'updated details'));
      sub =
        '<strong>' +
        esc(said.length ? _cmJoinWords(said) + '.' : 'No changes.') +
        '</strong>' +
        (plan.missing.length
          ? ' ' +
            esc(
              _cmPlural(plan.missing.length, 'student', 'students') +
                " in your class aren't in the file; they stay unless you tick them.",
            )
          : '') +
        '<span class="cm-import-file-line"><strong>' +
        esc(plan.fileName) +
        '</strong>' +
        (ready && t && t.myEd
          ? ' · a MyEducation BC class list, every column read'
          : ready && t
            ? ' · every column read'
            : '') +
        ' · matched by student number, then by name</span>';
    }
    var band =
      ready && t && first
        ? '<div class="cm-import-band"><span class="cm-import-band-mark" aria-hidden="true">✓</span><div><strong>' +
          (t.myEd
            ? "This is a class list from MyEducation BC. Every column was read, so there's nothing to match."
            : "Every column was read, so there's nothing to match.") +
          '</strong><span>' +
          (left.length ? esc('Left out: ' + _cmJoinWords(left) + ". FullVision doesn't keep them.") + ' ' : '') +
          '<button type="button" class="cm-import-link" data-action="cmImportShowColumns">Change What\'s Kept</button></span></div></div>'
        : '';
    var columns = !ready && t ? _cmImportNeedsHtml(t) + _cmImportColumnsHtml(plan) : '';
    var named = !t || t.map.some(_cmIsNameField);
    var body = first ? (ready ? _cmImportStudentListHtml(plan) : '') : _cmImportGroupsHtml(cid, plan);
    var foot, button, canGo;
    if (first) {
      var blanks = _cmImportBlanks(plan).length;
      var unnamed = plan.read.unnamed.length;
      foot =
        '<strong>' +
        esc(_cmPlural(counts.added, 'student', 'students') + ' will be added to ' + className + '.') +
        '</strong>' +
        (blanks
          ? ' ' + esc(_cmPlural(blanks, 'with a blank birthday or number.', 'with a blank birthday or number.'))
          : '') +
        (unnamed
          ? ' ' +
            esc(
              unnamed === 1
                ? 'Row ' + plan.read.unnamed[0].line + ' is left out until it has a name.'
                : unnamed + ' rows are left out until they have names.',
            )
          : '') +
        (ready && counts.added ? ' <span class="cm-hint">Untick anyone who isn\'t in this class.</span>' : '');
      button = 'Add ' + _cmPlural(counts.added, 'Student', 'Students');
      canGo = counts.added > 0 && named;
    } else {
      var parts = [];
      if (counts.added) parts.push('add ' + counts.added);
      if (counts.renamed) parts.push('rename ' + counts.renamed);
      if (counts.updated) parts.push('update ' + counts.updated);
      if (counts.withdrawn) parts.push('withdraw ' + counts.withdrawn);
      var sentence = parts.join(', ');
      foot = parts.length
        ? '<strong>' +
          esc(sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.') +
          '</strong>' +
          (counts.withdrawn ? '' : ' No one is withdrawn.') +
          ' Nothing changes until you choose Save Changes.'
        : 'Nothing to change.';
      button = 'Save Changes';
      canGo = parts.length > 0 && named;
    }
    return (
      '<div class="cm-section cm-import-review" role="region" aria-labelledby="cm-import-title">' +
      '<div class="cm-import-head"><div><h2 class="cm-grade-title" id="cm-import-title" tabindex="-1">' +
      esc(title) +
      '</h2><div class="cm-import-sub">' +
      sub +
      '</div></div>' +
      '<button type="button" class="cm-import-link" data-action="cmChooseRosterFile">Choose a Different File</button></div>' +
      band +
      columns +
      _cmImportProblemsHtml(plan) +
      body +
      '<div class="cm-import-foot"><span>' +
      foot +
      '</span>' +
      '<span class="cm-import-buttons"><button type="button" class="cm-action-btn" data-action="cmCancelImport">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmConfirmImport"' +
      (canGo ? '' : ' disabled') +
      '>' +
      esc(button) +
      '</button></span></div>' +
      '</div>'
    );
  }

  function cmImportToggle(kind, idx, on) {
    var plan = state.cmPendingImport;
    var list = plan && plan[kind];
    if (!list || !list[idx]) return;
    list[idx].on = !!on;
    plan.keep[list[idx].key] = !!on;
    _cmRenderAndFocus(
      '[data-action-change="cmImportToggle"][data-kind=' + _cmAttr(kind) + '][data-idx=' + _cmAttr(idx) + ']',
    );
  }

  function cmImportToggleAll(on) {
    var plan = state.cmPendingImport;
    if (!plan) return;
    plan.added.forEach(function (a) {
      a.on = !!on;
      plan.keep[a.key] = !!on;
    });
    _cmRenderAndFocus('[data-action-change="cmImportToggleAll"]');
  }

  /* A column's choice changed: read the file again. Choosing a field
     another column has swaps the two. */
  function cmImportPick(col, field) {
    var plan = state.cmPendingImport;
    if (!plan || !plan.table) return;
    var t = plan.table;
    col = Number(col);
    field = field || '';
    var old = t.map[col] || '';
    if (field) {
      t.map.forEach(function (f, j) {
        if (j === col || f !== field) return;
        t.map[j] = old;
        t.how[j] = old ? 'chosen' : '';
        t.dateOrder[j] = old === 'dateOfBirth' ? rosterDateOrder(_rosterColumn(t, j)) : '';
      });
      t.suggest[col] = '';
    }
    t.map[col] = field;
    t.how[col] = field ? 'chosen' : '';
    t.dateOrder[col] = field === 'dateOfBirth' ? rosterDateOrder(_rosterColumn(t, col)) : '';
    plan.showColumns = true;
    _cmPlanImport(plan);
    var btn = document.querySelector('.cm-import-field-btn[data-col="' + col + '"]');
    _cmFocus(btn);
  }

  function cmImportMap(col, field) {
    cmImportPick(col, field);
  }

  function cmImportDateOrder(col, order) {
    var plan = state.cmPendingImport;
    if (!plan || !plan.table) return;
    plan.table.dateOrder[Number(col)] = order === 'dmy' ? 'dmy' : 'mdy';
    plan.showColumns = true;
    _cmPlanImport(plan);
    var btn = document.querySelector('.cm-import-field-btn[data-col="' + Number(col) + '"]');
    _cmFocus(btn);
  }

  /* A fix typed on a row: read the file again with it. Focus goes to the
     next row's box. */
  function cmImportFix(line, field, value) {
    var plan = state.cmPendingImport;
    if (!plan || !plan.table || ['dateOfBirth', 'studentNumber', 'name'].indexOf(field) < 0) return;
    line = Number(line);
    var fix = (plan.fixes[line] = plan.fixes[line] || {});
    var v = String(value || '').trim();
    if (v) fix[field] = v;
    else delete fix[field];
    _cmPlanImport(plan);
    var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-action-change="cmImportFix"]'));
    var next = boxes.find(function (b) {
      return Number(b.dataset.line) > line || (Number(b.dataset.line) === line && b.dataset.field !== field);
    });
    var target = next || document.querySelector('[data-action="cmConfirmImport"]');
    _cmFocus(target);
  }

  function cmImportShowColumns() {
    if (!state.cmPendingImport) return;
    state.cmPendingImport.showColumns = true;
    _cmRenderAndFocus('.cm-import-field-btn');
  }

  function cmImportShowAll() {
    if (!state.cmPendingImport) return;
    state.cmPendingImport.showAll = true;
    _cmRenderAndFocus('.cm-import-list-row:nth-child(12) input');
  }

  function cmImportChooseNames() {
    if (!state.cmPendingImport) return;
    state.cmPendingImport.nonames = false;
    state.cmPendingImport.showColumns = true;
    _cmRenderAndFocus('.cm-import-field-btn');
  }

  function cmConfirmImport() {
    var plan = state.cmPendingImport;
    var cid = state.cmSelectedCourse;
    if (!plan || !cid) return;
    var counts = _cmImportCounts(plan);
    var blanks = plan.read ? _cmImportBlanks(plan) : [];
    var students = getStudents(cid);
    plan.renamed.forEach(function (r) {
      if (!r.on) return;
      var st = students.find(function (s) {
        return s.id === r.sid;
      });
      if (!st) return;
      st.firstName = r.row.firstName || st.firstName;
      st.lastName = r.row.lastName || '';
      st.sortName = (st.lastName + ' ' + st.firstName).trim();
    });
    (plan.updated || []).forEach(function (u) {
      if (!u.on) return;
      var st = students.find(function (s) {
        return s.id === u.sid;
      });
      if (!st) return;
      Object.keys(IMPORT_FIELD_LABELS).forEach(function (k) {
        if (u.row[k]) st[k] = u.row[k];
      });
      (u.row.designations || []).forEach(function (c) {
        st.designations = st.designations || [];
        if (st.designations.indexOf(c) < 0) st.designations.push(c);
      });
      (u.row.parentEmails || []).forEach(function (e) {
        _cmAddGuardianEmail(cid, st, e);
      });
    });
    var newGuardians = [];
    var addedIds = [];
    var blankIds = [];
    plan.added.forEach(function (a) {
      if (!a.on) return;
      var p = a.row;
      var fresh = {
        id: uid(),
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        preferred: p.preferred || '',
        pronouns: p.pronouns || '',
        studentNumber: p.studentNumber || '',
        dateOfBirth: p.dateOfBirth || '',
        email: p.email || '',
        designations: (p.designations || []).slice(),
        attendance: [],
        sortName: ((p.lastName || '') + ' ' + (p.firstName || '')).trim(),
        enrolledDate: courseToday(cid),
      };
      students.push(fresh);
      addedIds.push(fresh.id);
      blanks.forEach(function (pr) {
        if (pr.p === p)
          blankIds.push({
            sid: fresh.id,
            name: _cmRowName(p),
            what: pr.kind === 'date' ? 'birthday' : 'student number',
          });
      });
      (p.parentEmails || []).forEach(function (e) {
        newGuardians.push([fresh, e]);
      });
    });
    newGuardians.forEach(function (pair) {
      _cmAddGuardianEmail(cid, pair[0], pair[1]);
    });
    saveStudents(cid, students);
    // New students get their person id when their create lands; their
    // parent addresses are saved to the guardian table then.
    if (newGuardians.length)
      [4000, 15000].forEach(function (ms) {
        setTimeout(function () {
          _cmFlushPendingGuardians(cid);
        }, ms);
      });
    plan.missing.forEach(function (m) {
      if (m.on) withdrawStudent(cid, m.sid);
    });
    state.cmPendingImport = null;
    state.cmImportDone = { cid: cid, added: addedIds, blanks: blankIds, counts: counts, undone: null };
    state.cmRosterOnly = null;
    renderClassManager();
    var head = document.getElementById('cm-import-done-title');
    _cmFocus(head);
  }

  function cmCancelImport() {
    state.cmPendingImport = null;
    state.cmImportError = null;
    renderClassManager();
    var btn = document.querySelector(
      '[data-action="cmImportRoster"], .cm-import-empty [data-action="cmChooseRosterFile"]',
    );
    _cmFocus(btn);
  }

  return {
    configure: configure,
    _CM_FIELD_LABEL: _CM_FIELD_LABEL,
    _cmAddGuardianEmail: _cmAddGuardianEmail,
    _cmFlushPendingGuardians: _cmFlushPendingGuardians,
    _cmJoinWords: _cmJoinWords,
    _cmPlural: _cmPlural,
    _cmRenderImportReview: _cmRenderImportReview,
    _isServerPerson: _isServerPerson,
    cmCancelImport: cmCancelImport,
    cmConfirmImport: cmConfirmImport,
    cmHandleCSV: cmHandleCSV,
    cmImportChooseNames: cmImportChooseNames,
    cmImportDateOrder: cmImportDateOrder,
    cmImportFix: cmImportFix,
    cmImportMap: cmImportMap,
    cmImportPick: cmImportPick,
    cmImportShowAll: cmImportShowAll,
    cmImportShowColumns: cmImportShowColumns,
    cmImportToggle: cmImportToggle,
    cmImportToggleAll: cmImportToggleAll,
    cmShowImportPreview: cmShowImportPreview,
    cmStartImport: cmStartImport,
  };
})();
