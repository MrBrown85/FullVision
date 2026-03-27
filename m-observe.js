/* m-observe.js — Feature 2: Observations Notepad */

window.MObserve = (function() {
  'use strict';

  var MC = window.MComponents;
  var _activeFilter = 'all'; // 'all', student id, sentiment, or dimension

  /* ── Observation Feed Screen ────────────────────────────────── */
  function renderFeed(cid) {
    var nav = MC.navBar({ id: 'obs-feed', title: 'Observations' });

    // Build filter pills
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');
    var filters = '<div class="m-filter-strip">' +
      '<button class="m-filter-pill m-filter-active" data-action="m-obs-filter" data-filter="all">All</button>';
    // Sentiment filters
    Object.keys(OBS_SENTIMENTS).forEach(function(key) {
      var s = OBS_SENTIMENTS[key];
      filters += '<button class="m-filter-pill" data-action="m-obs-filter" data-filter="sentiment:' + key + '">' + s.icon + ' ' + s.label + '</button>';
    });
    // Student name filters (top 6 by recent obs)
    var allObs = getAllQuickObs(cid);
    var studentObsCounts = {};
    allObs.forEach(function(ob) {
      studentObsCounts[ob.studentId] = (studentObsCounts[ob.studentId] || 0) + 1;
    });
    var topStudents = students.filter(function(st) { return studentObsCounts[st.id]; })
      .sort(function(a, b) { return (studentObsCounts[b.id] || 0) - (studentObsCounts[a.id] || 0); })
      .slice(0, 6);
    topStudents.forEach(function(st) {
      filters += '<button class="m-filter-pill" data-action="m-obs-filter" data-filter="student:' + st.id + '">' + MC.esc(displayName(st)) + '</button>';
    });
    filters += '</div>';

    // Render observation cards grouped by date
    var cardHTML = _renderObsCards(cid, allObs, 'all');

    // FAB
    var fab = '<button class="m-fab" data-action="m-obs-new" aria-label="New observation">' + MC.ICONS.plus + '</button>';

    return '<div class="m-screen" id="m-screen-obs-feed">' +
      nav +
      '<div class="m-screen-content" id="m-obs-feed-content">' +
        MC.largeTitleHTML('Observations') +
        filters + '<div id="m-obs-cards">' + cardHTML + '</div>' +
        '<div style="height:80px"></div>' +
      '</div>' + fab + '</div>';
  }

  function _renderObsCards(cid, allObs, filter) {
    var students = getStudents(cid);
    var filtered = allObs;

    if (filter && filter !== 'all') {
      if (filter.indexOf('student:') === 0) {
        var sid = filter.substring(8);
        filtered = allObs.filter(function(ob) { return ob.studentId === sid; });
      } else if (filter.indexOf('sentiment:') === 0) {
        var sent = filter.substring(10);
        filtered = allObs.filter(function(ob) { return ob.sentiment === sent; });
      } else if (filter.indexOf('dim:') === 0) {
        var dim = filter.substring(4);
        filtered = allObs.filter(function(ob) { return ob.dims && ob.dims.indexOf(dim) >= 0; });
      }
    }

    // Sort newest first
    filtered.sort(function(a, b) { return new Date(b.created) - new Date(a.created); });

    if (!filtered.length) {
      return '<div class="m-empty"><div class="m-empty-icon">📝</div><div class="m-empty-title">No Observations</div><div class="m-empty-subtitle">Tap + to record one</div></div>';
    }

    var html = '';
    var lastGroup = '';
    filtered.forEach(function(ob) {
      var dateStr = ob.created ? ob.created.substring(0, 10) : '';
      var group = MC.dateGroupLabel(dateStr);
      if (group !== lastGroup) {
        html += '<div class="m-obs-date-group">' + group + '</div>';
        lastGroup = group;
      }

      var st = students.find(function(s) { return s.id === ob.studentId; });
      var stName = st ? displayName(st) : 'Unknown';
      var sentiment = OBS_SENTIMENTS[ob.sentiment] || {};
      var context = OBS_CONTEXTS[ob.context] || {};

      // Dimension tags
      var tagChips = '';
      if (ob.dims && ob.dims.length) {
        ob.dims.forEach(function(dim) {
          var label = OBS_LABELS[dim] || dim;
          var icon = OBS_ICONS[dim] || '';
          tagChips += '<span class="m-obs-tag-chip">' + icon + ' ' + MC.esc(label) + '</span>';
        });
      }

      html += '<div class="m-obs-card" data-sentiment="' + (ob.sentiment || '') + '" data-obid="' + ob.id + '" data-sid="' + ob.studentId + '">' +
        '<div class="m-obs-header">' +
          '<span class="m-obs-sentiment-icon">' + (sentiment.icon || '') + '</span>' +
          '<span class="m-obs-student-name">' + MC.esc(stName) + '</span>' +
          (context.label ? '<span class="m-obs-context">' + (context.icon || '') + ' ' + context.label + '</span>' : '') +
          '<span class="m-obs-time">' + MC.relativeTime(ob.created) + '</span>' +
        '</div>' +
        '<div class="m-obs-text">' + MC.esc(ob.text) + '</div>' +
        (tagChips ? '<div class="m-obs-tags">' + tagChips + '</div>' : '') +
      '</div>';
    });

    return html;
  }

  /* ── Apply filter ───────────────────────────────────────────── */
  function applyFilter(cid, filter) {
    _activeFilter = filter;
    // Update pill active states
    document.querySelectorAll('.m-filter-pill').forEach(function(pill) {
      pill.classList.toggle('m-filter-active', pill.getAttribute('data-filter') === filter);
    });
    // Re-render cards
    var allObs = getAllQuickObs(cid);
    var container = document.getElementById('m-obs-cards');
    if (container) {
      container.innerHTML = _renderObsCards(cid, allObs, filter);
    }
  }

  /* ── New Observation Sheet ──────────────────────────────────── */
  function presentNewObsSheet(cid) {
    var students = getStudents(cid);
    students = sortStudents(students.slice(), 'alpha');

    var html = '<div id="m-obs-form">' +
      // Student picker
      '<div class="m-sheet-label">Student</div>' +
      '<div class="m-student-picker" data-action="m-obs-pick-student" id="m-obs-student-picker">' +
        '<span class="m-student-picker-placeholder">Select student...</span>' +
      '</div>' +
      '<div id="m-obs-student-list-wrap" style="display:none">' +
        '<div class="m-picker-list">' +
          '<input class="m-picker-search" type="search" placeholder="Search..." data-action="m-obs-student-search">' +
          '<div id="m-obs-student-options">' +
            students.map(function(st) {
              return '<div class="m-picker-item" data-action="m-obs-select-student" data-sid="' + st.id + '">' +
                '<span class="m-picker-check"></span>' +
                '<span>' + MC.esc(displayName(st)) + '</span>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>' +

      // Text
      '<label class="m-sheet-label" for="m-obs-text">Observation</label>' +
      '<textarea class="m-sheet-textarea" id="m-obs-text" placeholder="What did you notice?" rows="3"></textarea>' +

      // Sentiment
      '<div class="m-sheet-label">Type</div>' +
      '<div class="m-sentiment-row" role="radiogroup" aria-label="Observation type">' +
        '<button class="m-sentiment-btn" role="radio" aria-checked="false" data-action="m-obs-sentiment" data-val="strength">✅ Strength</button>' +
        '<button class="m-sentiment-btn" role="radio" aria-checked="false" data-action="m-obs-sentiment" data-val="growth">🔄 Growth</button>' +
        '<button class="m-sentiment-btn" role="radio" aria-checked="false" data-action="m-obs-sentiment" data-val="concern">⚠️ Concern</button>' +
      '</div>' +

      // Context
      '<div class="m-sheet-label">Context</div>' +
      '<div class="m-context-row" style="flex-wrap:wrap">' +
        Object.keys(OBS_CONTEXTS).map(function(key) {
          var ctx = OBS_CONTEXTS[key];
          return '<button class="m-context-btn" data-action="m-obs-context" data-val="' + key + '">' + ctx.icon + ' ' + ctx.label + '</button>';
        }).join('') +
      '</div>' +

      // Dimension tags
      '<div class="m-sheet-label">Tags</div>' +
      '<div class="m-dim-strip">' +
        OBS_DIMS.map(function(dim) {
          return '<button class="m-dim-chip" data-action="m-obs-dim" data-val="' + dim + '">' + (OBS_ICONS[dim] || '') + ' ' + (OBS_LABELS[dim] || dim) + '</button>';
        }).join('') +
      '</div>' +

      // Submit
      '<button class="m-btn-primary" id="m-obs-submit" data-action="m-obs-save" disabled>Add Observation</button>' +
    '</div>';

    MC.presentSheet(html, { onClose: resetSheetState });

    // Auto-focus textarea
    setTimeout(function() {
      var ta = document.getElementById('m-obs-text');
      if (ta) ta.focus();
    }, 400);
  }

  /* ── Sheet state management ─────────────────────────────────── */
  var _selectedStudents = [];
  var _selectedSentiment = null;
  var _selectedContext = null;
  var _selectedDims = [];

  function resetSheetState() {
    _selectedStudents = [];
    _selectedSentiment = null;
    _selectedContext = null;
    _selectedDims = [];
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
    items.forEach(function(item) {
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
      picker.innerHTML = _selectedStudents.map(function(sid) {
        var st = students.find(function(s) { return s.id === sid; });
        return '<span class="m-student-chip">' + MC.esc(st ? displayName(st) : sid) +
          ' <span class="m-student-chip-remove" data-action="m-obs-remove-student" data-sid="' + sid + '">✕</span></span>';
      }).join('');
    }
    // Update checkmarks
    document.querySelectorAll('#m-obs-student-options .m-picker-item').forEach(function(item) {
      var sid = item.getAttribute('data-sid');
      var selected = _selectedStudents.indexOf(sid) >= 0;
      item.classList.toggle('m-picker-selected', selected);
      item.querySelector('.m-picker-check').textContent = selected ? '✓' : '';
    });
  }

  function setSentiment(val) {
    _selectedSentiment = _selectedSentiment === val ? null : val;
    document.querySelectorAll('.m-sentiment-btn').forEach(function(btn) {
      var isSelected = btn.getAttribute('data-val') === _selectedSentiment;
      btn.classList.toggle('m-selected', isSelected);
      btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
  }

  function setContext(val) {
    _selectedContext = _selectedContext === val ? null : val;
    document.querySelectorAll('.m-context-btn').forEach(function(btn) {
      btn.classList.toggle('m-selected', btn.getAttribute('data-val') === _selectedContext);
    });
  }

  function toggleDim(val) {
    var idx = _selectedDims.indexOf(val);
    if (idx >= 0) _selectedDims.splice(idx, 1);
    else _selectedDims.push(val);
    document.querySelectorAll('.m-dim-chip').forEach(function(chip) {
      chip.classList.toggle('m-selected', _selectedDims.indexOf(chip.getAttribute('data-val')) >= 0);
    });
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
    if (!text.trim() || !_selectedStudents.length) return;

    _selectedStudents.forEach(function(sid) {
      addQuickOb(cid, sid, text.trim(), _selectedDims, _selectedSentiment, _selectedContext);
    });

    MC.haptic();
    MC.dismissSheet();
    resetSheetState();

    // Refresh feed
    var allObs = getAllQuickObs(cid);
    var container = document.getElementById('m-obs-cards');
    if (container) {
      container.innerHTML = _renderObsCards(cid, allObs, _activeFilter);
      // Highlight first new card
      var first = container.querySelector('.m-obs-card');
      if (first) first.classList.add('m-highlight');
    }

    MC.showToast('Observation saved');
  }

  function deleteObservation(cid, sid, obId) {
    deleteQuickOb(cid, sid, obId);
    MC.haptic();
    // Refresh feed
    var allObs = getAllQuickObs(cid);
    var container = document.getElementById('m-obs-cards');
    if (container) {
      container.innerHTML = _renderObsCards(cid, allObs, _activeFilter);
    }
    MC.showToast('Observation deleted');
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
    deleteObservation: deleteObservation
  };
})();
