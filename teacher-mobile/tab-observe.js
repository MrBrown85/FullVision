/* m-observe.js — Feature 2: Observations Notepad */

window.MObserve = (function () {
  'use strict';

  var MC = window.MComponents;
  var _activeFilter = 'all'; // 'all', student id, sentiment, or dimension

  /* Deleted observations stay in the data layer until their Undo toast
     times out; until then the feed hides them. obId → timer. */
  var _pendingDeletes = {};
  var UNDO_MS = 6000;

  /* Type, context and tags render as text; tags keep their colour dot. */
  function typePill(sentiment) {
    var s = OBS_SENTIMENTS[sentiment];
    if (!s) return '';
    return '<span class="m-obs-type-pill" data-sentiment="' + sentiment + '">' + MC.esc(s.label) + '</span>';
  }
  /* The card's type: a solid word block in a fixed width so names line
     up. An untyped note is an empty outline. */
  function typeBlock(sentiment) {
    var s = OBS_SENTIMENTS[sentiment];
    if (!s) return '<span class="m-obs-type m-obs-type-none" aria-hidden="true"></span>';
    return '<span class="m-obs-type" data-sentiment="' + sentiment + '">' + MC.esc(s.label) + '</span>';
  }
  function tagChips(dims) {
    return (dims || [])
      .map(function (dim) {
        var label = typeof resolveTag === 'function' ? resolveTag(dim).label : OBS_LABELS[dim] || dim;
        return (
          '<span class="m-obs-tag-chip"><span class="m-obs-tag-dot" style="background:' +
          obsTagColor(dim) +
          '"></span>' +
          MC.esc(label) +
          '</span>'
        );
      })
      .join('');
  }

  /* "Today", "Yesterday", else "Fri, Oct 16". */
  function dayLabel(ymd) {
    var g = MC.dateGroupLabel(ymd);
    if (g === 'Today' || g === 'Yesterday') return g;
    var d = new Date(ymd + 'T12:00:00');
    var o = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('en-CA', o);
  }

  /* One observation card, as the desktop feed draws it (teacher/obs-card.js):
     type block, name, time, the note, and a meta line of context, linked
     assessment or competency, tags, and "Quoted in Report N". The whole
     card opens the edit sheet; the name filters the feed to that student.
     opts: showStudent (default true), when ('time' | 'date'),
           editable (default true: tap opens the sheet, swipe deletes). */
  function cardHtml(cid, ob, ctx, opts) {
    opts = opts || {};
    var p = ObsCard.parts(ob, ctx);
    var st = ctx.studentsById[ob.studentId];
    var editable = opts.editable !== false;
    var when = opts.when === 'date' ? ObsCard.cardWhen(ob) : ObsCard.cardTime(ob);
    var tags = tagChips(ob.dims);
    var meta =
      (p.context ? '<span class="m-obs-context">' + MC.esc(p.context) + '</span>' : '') +
      (p.assessment ? '<span class="m-obs-assessment">' + MC.esc(p.assessment) + '</span>' : '') +
      ObsCapture.linkPillsHtml(cid, ob, 'm-obs-link') +
      (tags ? '<span class="m-obs-tags">' + tags + '</span>' : '') +
      (p.quoted ? '<span class="m-obs-quoted">' + MC.esc(p.quoted) + '</span>' : '');
    var ids = ' data-obid="' + ob.id + '" data-sid="' + ob.studentId + '"';
    return (
      '<div class="m-obs-card"' +
      (editable ? ' data-action="m-obs-edit"' : '') +
      ' data-sentiment="' +
      (ob.sentiment || '') +
      '"' +
      ids +
      '><div class="m-obs-main"><div class="m-obs-header">' +
      typeBlock(ob.sentiment) +
      (opts.showStudent === false
        ? ''
        : '<button type="button" class="m-obs-student-name" data-action="m-obs-filter" data-filter="student:' +
          ob.studentId +
          '">' +
          MC.esc(st ? displayName(st) : 'Unknown') +
          '</button>') +
      (p.withText ? '<span class="m-obs-with">' + MC.esc(p.withText) + '</span>' : '') +
      (when ? '<span class="m-obs-time">' + MC.esc(when) + '</span>' : '') +
      '</div><div class="m-obs-text">' +
      MC.esc(ob.text) +
      '</div>' +
      (meta ? '<div class="m-obs-meta">' + meta + '</div>' : '') +
      '</div>' +
      (editable
        ? '<button type="button" class="m-obs-chev" data-action="m-obs-edit"' +
          ids +
          ' aria-label="Edit observation">\u203a</button>'
        : '') +
      '</div>'
    );
  }

  /* ── Observation Feed Screen ────────────────────────────────── */
  function renderFeed(cid) {
    var nav = MC.navBar({ id: 'obs-feed', title: 'Observations' });

    // Build filter pills
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    var filters =
      '<div class="m-filter-strip">' +
      '<button class="m-filter-pill m-filter-active" data-action="m-obs-filter" data-filter="all">All</button>';
    Object.keys(OBS_SENTIMENTS).forEach(function (key) {
      var s = OBS_SENTIMENTS[key];
      filters +=
        '<button class="m-filter-pill" data-action="m-obs-filter" data-filter="sentiment:' +
        key +
        '">' +
        s.label +
        '</button>';
    });
    filters += '</div>';

    // Quick-post avatar bar
    var quickBar = '<div class="m-quick-bar" id="m-quick-bar">';
    students.forEach(function (st) {
      var color = MC.avatarColor(st.id);
      var inits = MC.avatarInitials(st);
      var firstName = MC.esc(st.preferred || st.firstName || displayName(st));
      quickBar +=
        '<button class="m-quick-avatar" data-action="m-obs-quick-menu" data-sid="' +
        st.id +
        '">' +
        '<div class="m-quick-dot" style="background:' +
        color +
        '">' +
        inits +
        '</div>' +
        '<span class="m-quick-name">' +
        firstName +
        '</span>' +
        '</button>';
    });
    quickBar += '</div>';

    // Render observation cards grouped by date
    var cardHTML = _renderObsCards(cid, getAllQuickObs(cid), 'all');

    // FAB
    var fab =
      '<button class="m-fab" data-action="m-obs-new" aria-label="New observation">' + MC.ICONS.plus + '</button>';

    return (
      '<div class="m-screen" id="m-screen-obs-feed">' +
      nav +
      '<div class="m-screen-content" id="m-obs-feed-content">' +
      MC.largeTitleHTML('Observations') +
      '<div class="m-sweep-start-wrap"><button class="m-sweep-start" data-action="m-sweep-start">Start a sweep</button></div>' +
      quickBar +
      filters +
      '<div id="m-obs-cards">' +
      cardHTML +
      '</div>' +
      '<div style="height:80px"></div>' +
      '</div>' +
      fab +
      '</div>'
    );
  }

  function _renderObsCards(cid, allObs, filter) {
    var filtered = allObs.filter(function (ob) {
      return !_pendingDeletes[ob.id];
    });

    if (filter && filter !== 'all') {
      if (filter.indexOf('student:') === 0) {
        var sid = filter.substring(8);
        filtered = filtered.filter(function (ob) {
          return ob.studentId === sid;
        });
      } else if (filter.indexOf('sentiment:') === 0) {
        var sent = filter.substring(10);
        filtered = filtered.filter(function (ob) {
          return ob.sentiment === sent;
        });
      } else if (filter.indexOf('dim:') === 0) {
        var dim = filter.substring(4);
        filtered = filtered.filter(function (ob) {
          return ob.dims && ob.dims.indexOf(dim) >= 0;
        });
      }
    }

    // Sort newest first
    filtered.sort(function (a, b) {
      return new Date(b.created) - new Date(a.created);
    });

    if (!filtered.length) {
      return '<div class="m-empty"><div class="m-empty-title">No observations</div><div class="m-empty-subtitle">Tap + to record one</div></div>';
    }

    var ctx = ObsCard.context(cid, { hidden: _pendingDeletes });
    var html = '';
    var lastGroup = '';
    filtered.forEach(function (ob) {
      var group = dayLabel(ObsCard.obDay(ob));
      if (group !== lastGroup) {
        html += '<div class="m-obs-date-group">' + MC.esc(group) + '</div>';
        lastGroup = group;
      }
      html += cardHtml(cid, ob, ctx);
    });

    return html;
  }

  /* ── Apply filter ───────────────────────────────────────────── */
  function applyFilter(cid, filter) {
    _activeFilter = filter;
    // Update pill active states
    document.querySelectorAll('.m-filter-pill').forEach(function (pill) {
      pill.classList.toggle('m-filter-active', pill.getAttribute('data-filter') === filter);
    });
    // Re-render cards
    var allObs = getAllQuickObs(cid);
    var container = document.getElementById('m-obs-cards');
    if (container) {
      container.innerHTML = _renderObsCards(cid, allObs, filter);
    }
  }

  /* ── The edit sheet (D3) ──────────────────────────────────────
     An iOS form sheet: Cancel / name / Save in the top bar, the types as
     tabs in a folder band, the note box, a settings-style Context row that
     opens a picker, tags as chips with "+ Add Tag", and Delete Observation
     last. The pickers replace the form inside the same sheet. */
  function shortName(st) {
    if (!st) return 'Student';
    var first = st.preferred || st.firstName || displayName(st);
    return st.lastName ? first + ' ' + st.lastName.charAt(0) + '.' : first;
  }

  function _quotedNoticeHtml(label) {
    if (!label) return '';
    var lead = label === 'Quoted' ? 'Quoted in a report.' : label + '.';
    return (
      '<div class="obs-notice" role="note"><b>' +
      MC.esc(lead) +
      '</b> Changes here show in ' +
      (/Reports /.test(label) ? 'those reports.' : 'that report.') +
      '</div>'
    );
  }

  function _contextRowHtml() {
    var c = _selectedContext && OBS_CONTEXTS[_selectedContext];
    return (
      '<button type="button" class="m-edit-row" id="m-obs-ctx-row" data-action="m-obs-ctx-picker">' +
      '<span class="m-edit-row-k">Context</span><span class="m-edit-row-v' +
      (c ? '' : ' empty') +
      '">' +
      (c ? MC.esc(c.label) : 'None') +
      '<span class="m-edit-row-car" aria-hidden="true">\u203a</span></span></button>'
    );
  }

  function _tagLabel(t) {
    return typeof resolveTag === 'function' ? resolveTag(t).label : OBS_LABELS[t] || t;
  }

  function _tagChipsHtml() {
    return (
      _selectedDims
        .map(function (t) {
          return (
            '<span class="obs-tag-chip m-edit-tag"><span class="dim-dot" style="background:' +
            obsTagColor(t) +
            '"></span>' +
            MC.esc(_tagLabel(t)) +
            '<button type="button" class="obs-tag-chip-x" data-action="m-obs-dim" data-val="' +
            MC.esc(t) +
            '" aria-label="Remove ' +
            MC.esc(_tagLabel(t)) +
            '">&times;</button></span>'
          );
        })
        .join('') + '<button type="button" class="obs-add m-edit-tag" data-action="m-obs-tag-picker">+ Add Tag</button>'
    );
  }

  function _editSheetHtml(cid, ob, st, quoted) {
    return (
      '<div class="m-obs-edit" id="m-obs-edit">' +
      '<div class="m-edit-form">' +
      '<div class="m-edit-top">' +
      '<button type="button" class="m-edit-cancel" data-action="m-obs-edit-cancel">Cancel</button>' +
      '<div class="m-edit-title">' +
      MC.esc(shortName(st)) +
      '</div>' +
      '<button type="button" class="m-edit-save" id="m-obs-submit" data-action="m-obs-save">Save</button>' +
      '</div>' +
      ObsCard.typeBandHtml({
        value: _selectedSentiment,
        tabAttrs: function (k) {
          return 'data-action="m-obs-sentiment" data-val="' + k + '"';
        },
      }) +
      '<div class="m-edit-body">' +
      _quotedNoticeHtml(quoted) +
      '<textarea class="obs-note-box m-edit-text" id="m-obs-text" aria-label="Observation" placeholder="What did you notice?" rows="3">' +
      MC.esc(ob.text || '') +
      '</textarea>' +
      _contextRowHtml() +
      '<div class="m-edit-label" id="m-obs-tags-label">Tags</div>' +
      '<div class="m-edit-tags" id="m-obs-edit-tags" role="group" aria-labelledby="m-obs-tags-label">' +
      _tagChipsHtml() +
      '</div>' +
      '<button type="button" class="m-obs-sheet-delete" data-action="m-obs-delete" data-obid="' +
      ob.id +
      '" data-sid="' +
      ob.studentId +
      '">Delete Observation</button>' +
      '</div></div>' +
      '<div class="m-edit-picker" id="m-obs-edit-picker" hidden></div>' +
      '</div>'
    );
  }

  /* A picker inside the sheet: Context (one choice, None last) or Tags
     (several, in the tag menu's sections). */
  function openPicker(kind) {
    var form = document.querySelector('#m-obs-edit .m-edit-form');
    var pick = document.getElementById('m-obs-edit-picker');
    if (!form || !pick) return;
    var cid = getActiveCourse();
    var rows = '';
    if (kind === 'context') {
      Object.keys(OBS_CONTEXTS)
        .concat([''])
        .forEach(function (k) {
          var on = k ? _selectedContext === k : !_selectedContext;
          rows +=
            '<button type="button" class="m-pick-row' +
            (k ? '' : ' m-pick-none') +
            '" role="menuitemradio" aria-checked="' +
            on +
            '" data-action="m-obs-pick-context" data-val="' +
            k +
            '"><span>' +
            (k ? MC.esc(OBS_CONTEXTS[k].label) : 'None') +
            '</span><span class="m-pick-check" aria-hidden="true">' +
            (on ? '\u2713' : '') +
            '</span></button>';
        });
    } else {
      ObsCapture.tagMenuItems(cid).forEach(function (item) {
        if (item.type === 'section') {
          rows += '<div class="m-pick-section">' + MC.esc(item.label) + '</div>';
          return;
        }
        var on = _selectedDims.indexOf(item.key) >= 0;
        rows +=
          '<button type="button" class="m-pick-row" role="menuitemcheckbox" aria-checked="' +
          on +
          '" data-action="m-obs-pick-tag" data-val="' +
          MC.esc(item.key) +
          '"><span><span class="dim-dot" style="background:' +
          item.color +
          '"></span>' +
          MC.esc(item.label) +
          '</span><span class="m-pick-check" aria-hidden="true">' +
          (on ? '\u2713' : '') +
          '</span></button>';
      });
    }
    pick.innerHTML =
      '<div class="m-edit-top">' +
      '<button type="button" class="m-edit-cancel" data-action="m-obs-picker-back">\u2039 Back</button>' +
      '<div class="m-edit-title">' +
      (kind === 'context' ? 'Context' : 'Tags') +
      '</div>' +
      (kind === 'context'
        ? '<span class="m-edit-top-sp"></span>'
        : '<button type="button" class="m-edit-save" data-action="m-obs-picker-back">Done</button>') +
      '</div><div class="m-pick-list" role="menu">' +
      rows +
      '</div>';
    form.hidden = true;
    pick.hidden = false;
    var first = pick.querySelector('[aria-checked="true"]') || pick.querySelector('.m-pick-row');
    if (first) first.focus();
  }

  function closePicker() {
    var form = document.querySelector('#m-obs-edit .m-edit-form');
    var pick = document.getElementById('m-obs-edit-picker');
    if (!form || !pick) return;
    pick.hidden = true;
    pick.innerHTML = '';
    form.hidden = false;
  }

  function pickContext(val) {
    _selectedContext = val || null;
    var row = document.getElementById('m-obs-ctx-row');
    if (row) row.outerHTML = _contextRowHtml();
    closePicker();
  }

  function _refreshEditTags() {
    var tags = document.getElementById('m-obs-edit-tags');
    if (tags) tags.innerHTML = _tagChipsHtml();
  }

  function pickTag(val, btn) {
    toggleDim(val);
    if (btn) {
      var on = _selectedDims.indexOf(val) >= 0;
      btn.setAttribute('aria-checked', String(on));
      var chk = btn.querySelector('.m-pick-check');
      if (chk) chk.textContent = on ? '\u2713' : '';
    }
  }

  /* The new-observation sheet is the shared capture strip
     (teacher/obs-capture.js) in its sheet layout: students, type, context,
     the full tag menu (dispositions, Core Competencies, custom tags), an
     assessment, a competency and level. */
  var _capture = null;
  function presentNewObsSheet(cid, presetSid) {
    if (_capture) _capture.destroy();
    MC.presentSheet(
      '<div class="m-sheet-title" id="m-obs-sheet-title">New observation</div><div id="m-obs-capture-mount"></div>',
      {
        onClose: function () {
          if (_capture) _capture.destroy();
          _capture = null;
          resetSheetState();
        },
      },
    );
    _capture = ObsCapture.create({
      cid: cid,
      idPrefix: 'm-',
      layout: 'sheet',
      students: presetSid ? [presetSid] : [],
      defaultAssessment: true,
      draftKey: 'phone-sheet',
      onAdd: function (info) {
        MC.haptic();
        _refreshFeed(cid, true);
        if (!info.ok) return;
        // Stay open to offer the flag on a concern; otherwise done.
        if (_capture && _capture.getState().flagOffer.length) return;
        MC.dismissSheet();
        MC.showToast('Observation saved');
      },
      onFlag: function () {
        if (_capture && !_capture.getState().flagOffer.length) {
          MC.dismissSheet();
          MC.showToast('Observation saved and student flagged');
        }
      },
    });
    _capture.mount(document.getElementById('m-obs-capture-mount'));
    setTimeout(function () {
      if (_capture) _capture.focus();
    }, 400);
  }

  /* ── Edit Observation Sheet ──────────────────────────────────── */
  function presentEditObsSheet(cid, sid, obId) {
    var obs = getStudentQuickObs(cid, sid);
    var ob = obs.find(function (o) {
      return o.id === obId;
    });
    if (!ob) {
      MC.showToast('Observation not found');
      return;
    }

    _editingObId = obId;
    _editingSid = sid;
    _selectedStudents = [sid];
    _selectedSentiment = ob.sentiment || null;
    _selectedContext = ob.context || null;
    _selectedDims = (ob.dims || []).slice();

    var full = Object.assign({ studentId: sid }, ob);
    var student = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    var quoted = ObsCard.parts(full, ObsCard.context(cid)).quoted;
    MC.presentSheet(_editSheetHtml(cid, full, student, quoted), { onClose: resetSheetState });
    setTimeout(function () {
      var ta = document.getElementById('m-obs-text');
      if (ta) ta.focus();
    }, 400);
  }

  /* ── Sheet state management ─────────────────────────────────── */
  var _selectedStudents = [];
  var _selectedSentiment = null;
  var _selectedContext = null;
  var _selectedDims = [];

  var _editingObId = null; // non-null = edit mode
  var _editingSid = null;

  function resetSheetState() {
    _selectedStudents = [];
    _selectedSentiment = null;
    _selectedContext = null;
    _selectedDims = [];
    _editingObId = null;
    _editingSid = null;
  }

  function toggleStudentPicker() {
    var wrap = document.getElementById('m-obs-student-list-wrap');
    if (wrap) wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
  }

  function selectStudent(sid) {
    var idx = _selectedStudents.indexOf(sid);
    if (idx >= 0) {
      _selectedStudents.splice(idx, 1);
    } else {
      _selectedStudents.push(sid);
    }
    _updateStudentPicker();
    _updateSubmitState();
  }

  function filterStudentPicker(query) {
    var items = document.querySelectorAll('#m-obs-student-options .m-picker-item');
    var q = (query || '').toLowerCase();
    items.forEach(function (item) {
      var name = item.textContent.toLowerCase();
      item.style.display = name.indexOf(q) >= 0 ? '' : 'none';
    });
  }

  function _updateStudentPicker() {
    var picker = document.getElementById('m-obs-student-picker');
    if (!picker) return;
    var cid = getActiveCourse();
    var students = getStudents(cid);
    if (!_selectedStudents.length) {
      picker.innerHTML = '<span class="m-student-picker-placeholder">Select student...</span>';
    } else {
      picker.innerHTML = _selectedStudents
        .map(function (sid) {
          var st = students.find(function (s) {
            return s.id === sid;
          });
          return (
            '<span class="m-student-chip">' +
            MC.esc(st ? displayName(st) : sid) +
            ' <span class="m-student-chip-remove" data-action="m-obs-remove-student" data-sid="' +
            sid +
            '">✕</span></span>'
          );
        })
        .join('');
    }
    // Update checkmarks
    document.querySelectorAll('#m-obs-student-options .m-picker-item').forEach(function (item) {
      var sid = item.getAttribute('data-sid');
      var selected = _selectedStudents.indexOf(sid) >= 0;
      item.classList.toggle('m-picker-selected', selected);
      item.querySelector('.m-picker-check').textContent = selected ? '✓' : '';
    });
  }

  function setSentiment(val) {
    _selectedSentiment = _selectedSentiment === val ? null : val;
    var sheet = document.getElementById('m-obs-edit');
    if (sheet) ObsCard.syncTypeBand(sheet, _selectedSentiment);
  }

  function setContext(val) {
    _selectedContext = _selectedContext === val ? null : val;
    var row = document.getElementById('m-obs-ctx-row');
    if (row) row.outerHTML = _contextRowHtml();
  }

  function toggleDim(val) {
    var idx = _selectedDims.indexOf(val);
    if (idx >= 0) _selectedDims.splice(idx, 1);
    else _selectedDims.push(val);
    _refreshEditTags();
  }

  function _updateSubmitState() {
    var btn = document.getElementById('m-obs-submit');
    var text = document.getElementById('m-obs-text');
    if (btn) {
      btn.disabled = !_selectedStudents.length || !(text && text.value.trim());
    }
  }

  function saveObservation(cid) {
    var text = (document.getElementById('m-obs-text') || {}).value || '';
    if (!text.trim()) return;
    var isEdit = _editingObId && _editingSid;

    // P7.1: gate the success toast on the underlying persistence result so
    // a silent LS-quota failure can't pretend the observation was saved.
    var allOk = true;
    if (isEdit) {
      var okU = updateQuickOb(cid, _editingSid, _editingObId, {
        text: text.trim(),
        dims: _selectedDims,
        sentiment: _selectedSentiment,
        context: _selectedContext,
      });
      if (okU === false) allOk = false;
    } else {
      if (!_selectedStudents.length) return;
      _selectedStudents.forEach(function (sid) {
        var okA = addQuickOb(cid, sid, text.trim(), _selectedDims, _selectedSentiment, _selectedContext);
        if (okA === false) allOk = false;
      });
    }

    MC.haptic();
    if (!allOk) {
      MC.showToast("Couldn't save — local storage full. Try again after freeing space.");
      return;
    }
    MC.dismissSheet();
    resetSheetState();
    _refreshFeed(cid, !isEdit);
    MC.showToast(isEdit ? 'Observation updated' : 'Observation saved');
  }

  function deleteObservation(cid, sid, obId) {
    deleteQuickOb(cid, sid, obId);
    _refreshFeed(cid, false);
  }

  /* One tap hides the card and offers Undo for six seconds; the delete
     reaches the data layer when that time is up. */
  function holdDelete(cid, sid, obId) {
    if (!obId || !sid || _pendingDeletes[obId]) return;
    MC.haptic();
    _pendingDeletes[obId] = setTimeout(function () {
      delete _pendingDeletes[obId];
      deleteObservation(cid, sid, obId);
    }, UNDO_MS);
    _refreshFeed(cid, false);
    MC.showToast('Observation deleted', {
      duration: UNDO_MS,
      onUndo: function () {
        if (!_pendingDeletes[obId]) return;
        clearTimeout(_pendingDeletes[obId]);
        delete _pendingDeletes[obId];
        _refreshFeed(cid, false);
      },
    });
  }

  /* ── Quick-post starters ───────────────────────────────────── */
  /* The class's sentence starters (edited in Class Management on a
     computer). A class with none gets the six suggestions, which work the
     same way but are never saved as the class's own.
     → { items: [{ key, text, sentiment, context, dims }], suggested } */
  function quickStarters(cid) {
    var own = (typeof getObservationTemplates === 'function' ? getObservationTemplates(cid) : []).filter(function (t) {
      return t && t.text;
    });
    if (own.length) {
      return {
        suggested: false,
        items: own.map(function (t) {
          return { key: t.id, text: t.text, sentiment: t.sentiment, context: t.context, dims: t.dims || [] };
        }),
      };
    }
    var six = typeof OBS_STARTER_SUGGESTIONS !== 'undefined' ? OBS_STARTER_SUGGESTIONS : [];
    return {
      suggested: true,
      items: six.map(function (t, i) {
        return { key: 'suggested-' + i, text: t.text, sentiment: t.sentiment, context: t.context, dims: t.dims || [] };
      }),
    };
  }

  function _findQuickStarter(cid, key) {
    var items = quickStarters(cid).items;
    var want = typeof resolveObservationTemplateId === 'function' ? resolveObservationTemplateId(cid, key) : key;
    return items.find(function (t) {
      return t.key === key || t.key === want;
    });
  }

  function presentQuickMenu(cid, sid) {
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return;

    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);

    var html =
      '<div class="m-quick-sheet-header">' +
      '<div class="m-quick-sheet-avatar" style="background:' +
      color +
      '">' +
      initials +
      '</div>' +
      '<div class="m-quick-sheet-name">' +
      MC.esc(name) +
      '</div>' +
      '</div>';

    var starters = quickStarters(cid);
    starters.items.forEach(function (tmpl) {
      html +=
        '<button class="m-quick-template" data-action="m-obs-quick-post" data-sid="' +
        sid +
        '" data-template="' +
        MC.esc(tmpl.key) +
        '">' +
        '<span>' +
        MC.esc(tmpl.text) +
        '</span>' +
        typePill(tmpl.sentiment) +
        '</button>';
    });
    if (starters.suggested) {
      html += '<div class="m-quick-note">Add your own in Class Management on a computer.</div>';
    }

    html +=
      '<button class="m-quick-compose" data-action="m-obs-quick-compose" data-sid="' +
      sid +
      '">Write full observation\u2026</button>';

    MC.presentSheet(html, { half: true });
  }

  function quickPost(cid, sid, templateKey) {
    var tmpl = _findQuickStarter(cid, templateKey);
    if (!tmpl) return;

    try {
      addQuickOb(cid, sid, tmpl.text, (tmpl.dims || []).slice(), tmpl.sentiment || null, tmpl.context || null);
    } catch (e) {
      MC.dismissSheet();
      MC.showToast('Failed to save \u2014 try again');
      return;
    }
    MC.haptic();
    MC.dismissSheet();
    _refreshFeed(cid, true);
    MC.showToast('Observation added');
  }

  /* Swipe a card left to delete it (with the same Undo toast). A short
     swipe springs back. */
  var _swipe = null;
  var _swipeEndedAt = 0;
  function _swipeStart(e) {
    var card = e.target.closest && e.target.closest('#m-obs-cards .m-obs-card[data-action]');
    if (!card || e.touches.length !== 1) return;
    _swipe = { card: card, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, on: false };
  }
  function _swipeMove(e) {
    if (!_swipe) return;
    var dx = e.touches[0].clientX - _swipe.x;
    var dy = e.touches[0].clientY - _swipe.y;
    if (!_swipe.on) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > Math.abs(dx) || dx > 0) {
        _swipe = null;
        return;
      }
      _swipe.on = true;
      _swipe.card.classList.add('m-obs-swiping');
    }
    _swipe.dx = Math.min(0, dx);
    _swipe.card.style.transform = 'translateX(' + _swipe.dx + 'px)';
  }
  function _swipeEnd() {
    if (!_swipe) return;
    var sw = _swipe;
    _swipe = null;
    if (!sw.on) return;
    _swipeEndedAt = Date.now();
    sw.card.classList.remove('m-obs-swiping');
    if (-sw.dx > sw.card.offsetWidth * 0.35) {
      sw.card.style.transform = 'translateX(-110%)';
      var sid = sw.card.getAttribute('data-sid');
      var obId = sw.card.getAttribute('data-obid');
      setTimeout(function () {
        holdDelete(getActiveCourse(), sid, obId);
      }, 150);
    } else {
      sw.card.style.transform = '';
    }
  }
  // The tap that ends a swipe must not also open the card.
  function _swipeClick(e) {
    if (Date.now() - _swipeEndedAt < 400 && e.target.closest && e.target.closest('#m-obs-cards')) {
      e.stopPropagation();
      e.preventDefault();
    }
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('touchstart', _swipeStart, { passive: true });
    document.addEventListener('touchmove', _swipeMove, { passive: true });
    document.addEventListener('touchend', _swipeEnd);
    document.addEventListener('touchcancel', _swipeEnd);
    document.addEventListener('click', _swipeClick, true);
  }

  function _refreshFeed(cid, highlightFirst) {
    var allObs = getAllQuickObs(cid);
    var container = document.getElementById('m-obs-cards');
    if (container) {
      container.innerHTML = _renderObsCards(cid, allObs, _activeFilter);
      if (highlightFirst) {
        var first = container.querySelector('.m-obs-card');
        if (first) first.classList.add('m-post-new');
      }
    }
  }

  return {
    renderFeed: renderFeed,
    applyFilter: applyFilter,
    presentNewObsSheet: presentNewObsSheet,
    resetSheetState: resetSheetState,
    toggleStudentPicker: toggleStudentPicker,
    selectStudent: selectStudent,
    filterStudentPicker: filterStudentPicker,
    setSentiment: setSentiment,
    setContext: setContext,
    toggleDim: toggleDim,
    updateSubmitState: _updateSubmitState,
    saveObservation: saveObservation,
    deleteObservation: deleteObservation,
    holdDelete: holdDelete,
    presentEditObsSheet: presentEditObsSheet,
    openPicker: openPicker,
    closePicker: closePicker,
    pickContext: pickContext,
    pickTag: pickTag,
    shortName: shortName,
    presentQuickMenu: presentQuickMenu,
    quickPost: quickPost,
    quickStarters: quickStarters,
    typePill: typePill,
    typeBlock: typeBlock,
    tagChips: tagChips,
    cardHtml: cardHtml,
    dayLabel: dayLabel,
    refreshFeed: function (cid) {
      _refreshFeed(cid, false);
    },
  };
})();
