/* ── page-observations.js — Observations page module ──────── */
window.PageObservations = (function () {
  'use strict';

  /* ── Listener tracking for cleanup ──────────────────────── */
  var _listeners = [];
  function _addDocListener(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /* ── State variables ────────────────────────────────────── */
  var activeCourse;
  var selectedStudents = [];
  var filterStudents = [];
  var filterTags = [];
  var searchQuery = '';
  var activeTags = [];
  var activeSentiment = null;
  var activeContext = null;
  var filterSentiment = null;
  var _openPopover = null;
  var _filterStripOpen = false;
  var _searchDebounce = null;
  var _deleteTimers = {};

  var _students = [];
  var _studentsById = {};

  var VIEW_MODES = ['list', 'sticky', 'waveform'];

  /* ── Focus card state ───────────────────────────────────── */
  var _focusObId = null;
  var _focusSid = null;
  var _focusEl = null;
  var _focusBackdropEl = null;
  var _focusDebounce = null;
  var _focusDraft = null;
  var _focusTagPopoverOpen = false;
  var _focusFocusables = null;
  var _focusLastActiveEl = null;
  var _motion = null;
  var _viewMode = 'list';

  var SEARCH_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var TAG_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';

  var DIM_COLORS = {
    engagement: '#3b82f6',
    curiosity: '#9333ea',
    selfRegulation: '#f59e0b',
    resilience: '#ef4444',
    belonging: '#0ea5e9',
    identity: '#d946ef',
    collaboration: '#22c55e',
    respect: '#059669',
    responsibility: '#84cc16',
  };
  var CC_COLOR = '#e67700';
  var CUSTOM_COLOR = '#8b5cf6';
  function tagColor(t) {
    return t.startsWith('cc:') ? CC_COLOR : t.startsWith('tag:') ? CUSTOM_COLOR : DIM_COLORS[t] || '#999';
  }

  function buildTagMenuItems() {
    var items = [];
    items.push({ type: 'section', label: 'Learning Dispositions' });
    LEARNING_DIMS.forEach(function (d) {
      items.push({ key: d, label: OBS_LABELS[d], color: DIM_COLORS[d] || '#999' });
    });
    items.push({ type: 'section', label: 'Relational & Identity' });
    RELATIONAL_DIMS.forEach(function (d) {
      items.push({ key: d, label: OBS_LABELS[d], color: DIM_COLORS[d] || '#999' });
    });
    items.push({ type: 'section', label: 'Core Competencies' });
    CORE_COMPETENCIES.forEach(function (cc) {
      items.push({ key: 'cc:' + cc.id, label: cc.label, color: CC_COLOR });
    });
    var custom = getCustomTags(activeCourse);
    if (custom.length > 0) {
      items.push({ type: 'section', label: 'Custom Tags' });
      custom.forEach(function (t) {
        items.push({ key: 'tag:' + t, label: t, color: CUSTOM_COLOR });
      });
    }
    return items;
  }

  function refreshStudentCache() {
    _students = sortStudents(getStudents(activeCourse), 'lastName');
    _studentsById = {};
    _students.forEach(function (s) {
      _studentsById[s.id] = s;
    });
  }

  function activeFilterCount() {
    return filterStudents.length + filterTags.length + (filterSentiment ? 1 : 0);
  }

  /* ── Course switch ──────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    setActiveCourse(cid);
    await initData(cid);
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(cid);
    refreshStudentCache();
    selectedStudents = [];
    filterStudents = [];
    filterTags = [];
    searchQuery = '';
    activeTags = [];
    render();
    overrideSidebarLinks();
  }

  function overrideSidebarLinks() {
    requestAnimationFrame(function () {
      document.querySelectorAll('#gb-roster-list .student-row').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var sid = new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '').get('id');
          if (sid) {
            selectedStudents = [sid];
            filterStudents = [sid];
            if (!_filterStripOpen) _filterStripOpen = true;
            render();
            document.querySelectorAll('.student-row').forEach(function (r) {
              r.classList.remove('selected');
            });
            a.classList.add('selected');
          }
        });
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */
  function render() {
    var btnLabel = 'Select students\u2026';
    if (selectedStudents.length === 1) {
      var s = _studentsById[selectedStudents[0]];
      btnLabel = s ? displayName(s) : btnLabel;
    } else if (selectedStudents.length > 1) btnLabel = selectedStudents.length + ' students';
    var hasSel = selectedStudents.length > 0;

    var h = '';

    // Capture bar
    h +=
      '<div class="obs-capture" id="obs-capture"><div class="obs-capture-row">' +
      '<div class="obs-capture-student"><button class="obs-capture-student-btn' +
      (hasSel ? ' has-selection' : '') +
      '" data-action="openPopover" data-popover="students" id="student-btn" aria-label="Select student" aria-expanded="false" aria-haspopup="listbox">' +
      esc(btnLabel) +
      ' <span class="obs-btn-arrow" aria-hidden="true"></span></button>' +
      renderStudentPopover('student-dropdown', selectedStudents, 'toggleCaptureStudent', 'filterCaptureStudents') +
      '</div>' +
      '<div class="obs-tag-trigger-wrap"><button class="obs-tag-trigger' +
      (activeTags.length > 0 || activeSentiment || activeContext ? ' has-tags' : '') +
      '" data-action="openPopover" data-popover="tags" id="tag-btn" aria-label="Select tags" aria-expanded="false" aria-haspopup="true"><span class="tag-icon">' +
      TAG_SVG +
      '</span>Tags' +
      (activeTags.length + (activeSentiment ? 1 : 0) + (activeContext ? 1 : 0) > 0
        ? ' <span class="obs-badge">' +
          (activeTags.length + (activeSentiment ? 1 : 0) + (activeContext ? 1 : 0)) +
          '</span>'
        : '') +
      '</button>' +
      renderTagPopoverWithEnrichments('tag-dropdown', activeTags, 'toggleCaptureTag') +
      '</div>' +
      '<textarea class="obs-capture-input" id="capture-input" rows="2" placeholder="What did you notice?" autocomplete="off" aria-label="Observation note"></textarea>' +
      '<button class="obs-capture-add" id="capture-add-btn" data-action="submitOb" ' +
      (!hasSel ? 'disabled' : '') +
      ' aria-label="Add observation">+ Add</button>' +
      '</div>' +
      renderCaptureSecondary() +
      '</div>';

    // Toolbar
    var afc = activeFilterCount();
    var allObs = getAllQuickObs(activeCourse);
    var filtered = applyFilters(allObs);

    h +=
      '<div class="obs-toolbar" id="obs-toolbar">' +
      '<button class="obs-filter-trigger' +
      (afc > 0 ? ' has-filters' : '') +
      '" data-action="toggleFilterStrip" id="filter-trigger-btn" aria-expanded="' +
      _filterStripOpen +
      '" aria-label="Toggle filters' +
      (afc > 0 ? ', ' + afc + ' active' : '') +
      '"><span class="filter-icon" aria-hidden="true">☰</span> Filters' +
      (afc > 0 ? ' <span class="obs-badge">' + afc + '</span>' : '') +
      '</button>' +
      '<div class="obs-search-wrap"><span class="obs-search-icon">' +
      SEARCH_SVG +
      '</span><input class="obs-search-input" type="text" placeholder="Search\u2026" id="obs-search-input" value="' +
      esc(searchQuery) +
      '" aria-label="Search observations"></div>' +
      '<div class="obs-view-toggle" role="tablist" aria-label="View mode">' +
      VIEW_MODES.map(function (m) {
        var label = m === 'list' ? 'List' : m === 'sticky' ? 'Sticky' : 'Voice';
        return (
          '<button type="button" data-action="setView" data-view="' +
          m +
          '" class="' +
          (_viewMode === m ? 'active' : '') +
          '" role="tab" aria-selected="' +
          (_viewMode === m) +
          '">' +
          label +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<span class="obs-toolbar-count" id="obs-count">' +
      filtered.length +
      (filtered.length !== allObs.length ? ' of ' + allObs.length : '') +
      ' observations</span>' +
      '</div>';

    // Filter strip
    h +=
      '<div class="obs-filter-strip' +
      (_filterStripOpen ? ' open' : '') +
      '" id="obs-filter-strip">' +
      '<span class="obs-filter-strip-label">Student</span>' +
      '<div class="obs-strip-popover-wrap"><button class="obs-strip-trigger' +
      (filterStudents.length > 0 ? ' active' : '') +
      '" data-action="openPopover" data-popover="filterStudents" id="filter-student-btn">' +
      (filterStudents.length === 0
        ? 'All Students'
        : filterStudents.length === 1
          ? esc(_studentsById[filterStudents[0]] ? displayName(_studentsById[filterStudents[0]]) : '1 student')
          : filterStudents.length + ' students') +
      ' <span class="obs-btn-arrow"></span></button>' +
      renderStudentPopover('filter-student-dropdown', filterStudents, 'toggleFilterStudent', 'filterFilterStudents') +
      '</div>' +
      '<div class="obs-filter-strip-divider"></div><span class="obs-filter-strip-label">Tags</span>' +
      '<div class="obs-strip-popover-wrap"><button class="obs-strip-trigger' +
      (filterTags.length > 0 ? ' active' : '') +
      '" data-action="openPopover" data-popover="filterTags" id="filter-tag-btn">' +
      (filterTags.length === 0 ? 'All Tags' : filterTags.length + ' tag' + (filterTags.length > 1 ? 's' : '')) +
      ' <span class="obs-btn-arrow"></span></button>' +
      renderTagPopover('filter-tag-dropdown', filterTags, 'toggleFilterTag') +
      '</div>' +
      '<div class="obs-filter-strip-divider"></div><span class="obs-filter-strip-label">Sentiment</span>' +
      '<div style="display:flex;gap:4px">' +
      Object.entries(OBS_SENTIMENTS)
        .map(function (entry) {
          var key = entry[0],
            s = entry[1];
          return (
            '<button class="obs-sentiment-pill' +
            (filterSentiment === key ? ' active' : '') +
            '" style="' +
            (filterSentiment === key
              ? 'background:' + s.tint + ';border-color:' + s.border + ';color:' + s.border
              : '') +
            '" data-action="setFilterSentiment" data-sentiment="' +
            key +
            '">' +
            s.icon +
            ' ' +
            s.label +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      (afc > 0 ? renderFilterPills() : '') +
      (afc > 0 ? '<button class="obs-filter-clear" data-action="clearAllFilters">Clear all</button>' : '') +
      '</div>';

    // Feed
    h += '<div class="obs-feed view-' + _viewMode + '" id="obs-feed">' + renderFeedHtml(filtered) + '</div>';

    document.getElementById('main').innerHTML = h;
    wireSearch();
    updateAddBtn();
  }

  /* ── Popover builders ───────────────────────────────────── */
  function renderStudentPopover(id, selectedArr, toggleFn, filterFn) {
    var h =
      '<div class="obs-popover" id="' +
      id +
      '" style="width:240px;max-height:340px" data-filter-fn="' +
      filterFn +
      '">' +
      '<input class="obs-popover-search" type="text" placeholder="Search\u2026" data-action-input="popoverSearch" data-popover-id="' +
      id +
      '" data-filter-fn="' +
      filterFn +
      '" autocomplete="off">' +
      '<div class="obs-popover-list">';
    _students.forEach(function (s) {
      var isSel = selectedArr.includes(s.id);
      h +=
        '<div class="obs-popover-item' +
        (isSel ? ' selected' : '') +
        '" data-sid="' +
        s.id +
        '" data-action="popoverToggle" data-toggle-fn="' +
        toggleFn +
        '" data-value="' +
        s.id +
        '"><span class="obs-popover-check">' +
        (isSel ? '✓' : '') +
        '</span>' +
        esc(displayName(s)) +
        '</div>';
    });
    h += '</div></div>';
    return h;
  }

  function renderTagPopoverWithEnrichments(id, selectedArr, toggleFn) {
    var items = buildTagMenuItems();
    var h =
      '<div class="obs-popover" id="' +
      id +
      '" style="width:280px">' +
      '<input class="obs-popover-search" type="text" placeholder="Search tags\u2026" data-action-input="tagPopoverSearch" data-popover-id="' +
      id +
      '" autocomplete="off">' +
      '<div class="obs-popover-list">';

    h += '<div class="obs-popover-section" data-section>Type</div>';
    Object.entries(OBS_SENTIMENTS).forEach(function (entry) {
      var key = entry[0],
        s = entry[1];
      var active = activeSentiment === key;
      h +=
        '<div class="obs-popover-item' +
        (active ? ' selected' : '') +
        '" data-tag="' +
        key +
        '" data-action="toggleSentiment" data-value="' +
        key +
        '"><span class="obs-popover-check">' +
        (active ? '✓' : '') +
        '</span><span style="font-size:var(--text-sm)">' +
        s.icon +
        '</span>' +
        s.label +
        '</div>';
    });

    h += '<div class="obs-popover-section" data-section>Context</div>';
    Object.entries(OBS_CONTEXTS).forEach(function (entry) {
      var key = entry[0],
        c = entry[1];
      var active = activeContext === key;
      h +=
        '<div class="obs-popover-item' +
        (active ? ' selected' : '') +
        '" data-tag="' +
        key +
        '" data-action="toggleContext" data-value="' +
        key +
        '"><span class="obs-popover-check">' +
        (active ? '✓' : '') +
        '</span><span style="font-size:var(--text-sm)">' +
        c.icon +
        '</span>' +
        c.label +
        '</div>';
    });

    items.forEach(function (item) {
      if (item.type === 'section') {
        h += '<div class="obs-popover-section" data-section>' + esc(item.label) + '</div>';
      } else {
        var isSel = selectedArr.includes(item.key);
        h +=
          '<div class="obs-popover-item' +
          (isSel ? ' selected' : '') +
          '" data-tag="' +
          esc(item.key) +
          '" data-action="popoverToggle" data-toggle-fn="' +
          toggleFn +
          '" data-value="' +
          esc(item.key) +
          '"><span class="obs-popover-check">' +
          (isSel ? '✓' : '') +
          '</span><span class="obs-tag-dot" style="background:' +
          item.color +
          '"></span>' +
          esc(item.label) +
          '</div>';
      }
    });
    h += '</div>';
    h +=
      '<div class="obs-popover-add-row"><input class="obs-popover-add-input" id="custom-tag-input" type="text" placeholder="New custom tag\u2026"><button class="obs-popover-add-btn" data-action="addNewCustomTag">+ Add</button></div>';
    h += '</div>';
    return h;
  }

  function renderTagPopover(id, selectedArr, toggleFn) {
    var items = buildTagMenuItems();
    var h =
      '<div class="obs-popover right-align" id="' +
      id +
      '" style="width:260px">' +
      '<input class="obs-popover-search" type="text" placeholder="Search tags\u2026" data-action-input="tagPopoverSearch" data-popover-id="' +
      id +
      '" autocomplete="off">' +
      '<div class="obs-popover-list">';
    items.forEach(function (item) {
      if (item.type === 'section') {
        h += '<div class="obs-popover-section" data-section>' + esc(item.label) + '</div>';
      } else {
        var isSel = selectedArr.includes(item.key);
        h +=
          '<div class="obs-popover-item' +
          (isSel ? ' selected' : '') +
          '" data-tag="' +
          esc(item.key) +
          '" data-action="popoverToggle" data-toggle-fn="' +
          toggleFn +
          '" data-value="' +
          esc(item.key) +
          '"><span class="obs-popover-check">' +
          (isSel ? '✓' : '') +
          '</span><span class="obs-tag-dot" style="background:' +
          item.color +
          '"></span>' +
          esc(item.label) +
          '</div>';
      }
    });
    h += '</div></div>';
    return h;
  }

  function renderCaptureSecondary() {
    var hasTokens = selectedStudents.length > 1 || activeTags.length > 0;
    var h = '<div class="obs-capture-secondary">';
    if (hasTokens) {
      h += '<div class="obs-capture-tokens">';
      if (selectedStudents.length > 1) {
        selectedStudents.forEach(function (sid) {
          var s = _studentsById[sid];
          if (!s) return;
          h +=
            '<span class="obs-token">' +
            esc(displayNameFirst(s)) +
            '<span class="obs-token-x" data-action="removeCaptureStudent" data-sid="' +
            sid +
            '">&times;</span></span>';
        });
      }
      activeTags.forEach(function (t) {
        var info = resolveTag(t);
        h +=
          '<span class="obs-tag-pill"><span class="pill-dot" style="background:' +
          tagColor(t) +
          '"></span>' +
          esc(info.label) +
          '<span class="obs-tag-pill-x" data-action="removeCaptureTag" data-value="' +
          esc(t) +
          '">&times;</span></span>';
      });
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function renderFilterPills() {
    var h = '<div class="obs-filter-pills" id="filter-pills">';
    filterStudents.forEach(function (sid) {
      var s = _studentsById[sid];
      if (!s) return;
      h +=
        '<span class="obs-filter-pill" data-action="removeFilterStudent" data-sid="' +
        sid +
        '">' +
        esc(displayNameFirst(s)) +
        '<span class="obs-filter-pill-x">&times;</span></span>';
    });
    filterTags.forEach(function (t) {
      var info = resolveTag(t);
      h +=
        '<span class="obs-filter-pill" data-action="removeFilterTag" data-value="' +
        esc(t) +
        '"><span class="pill-dot" style="background:' +
        tagColor(t) +
        '"></span>' +
        esc(info.label) +
        '<span class="obs-filter-pill-x">&times;</span></span>';
    });
    h += '</div>';
    return h;
  }

  /* ── Partial updates ────────────────────────────────────── */
  function refreshFeedAndCount() {
    var allObs = getAllQuickObs(activeCourse);
    var filtered = applyFilters(allObs);
    var feedEl = document.getElementById('obs-feed');
    if (feedEl) feedEl.innerHTML = renderFeedHtml(filtered);
    var countEl = document.getElementById('obs-count');
    if (countEl)
      countEl.textContent =
        filtered.length + (filtered.length !== allObs.length ? ' of ' + allObs.length : '') + ' observations';
    var afc = activeFilterCount();
    var trigBtn = document.getElementById('filter-trigger-btn');
    if (trigBtn) {
      trigBtn.classList.toggle('has-filters', afc > 0);
      trigBtn.innerHTML =
        '<span class="filter-icon">☰</span> Filters' + (afc > 0 ? ' <span class="obs-badge">' + afc + '</span>' : '');
    }
  }

  function refreshFilterStrip() {
    var afc = activeFilterCount();
    var sb = document.getElementById('filter-student-btn');
    if (sb) {
      sb.classList.toggle('active', filterStudents.length > 0);
      sb.innerHTML =
        (filterStudents.length === 0
          ? 'All Students'
          : filterStudents.length === 1
            ? esc(_studentsById[filterStudents[0]] ? displayName(_studentsById[filterStudents[0]]) : '1 student')
            : filterStudents.length + ' students') + ' <span class="obs-btn-arrow"></span>';
    }
    var tb = document.getElementById('filter-tag-btn');
    if (tb) {
      tb.classList.toggle('active', filterTags.length > 0);
      tb.innerHTML =
        (filterTags.length === 0 ? 'All Tags' : filterTags.length + ' tag' + (filterTags.length > 1 ? 's' : '')) +
        ' <span class="obs-btn-arrow"></span>';
    }
    var strip = document.getElementById('obs-filter-strip');
    if (strip) {
      var oldPills = document.getElementById('filter-pills');
      var oldClear = strip.querySelector('.obs-filter-clear');
      if (oldPills) oldPills.remove();
      if (oldClear) oldClear.remove();
      if (afc > 0) {
        strip.insertAdjacentHTML('beforeend', renderFilterPills());
        strip.insertAdjacentHTML(
          'beforeend',
          '<button class="obs-filter-clear" data-action="clearAllFilters">Clear all</button>',
        );
      }
    }
  }

  /* ── Apply filters ──────────────────────────────────────── */
  function applyFilters(allObs) {
    var f = allObs;
    if (filterStudents.length > 0)
      f = f.filter(function (o) {
        return filterStudents.includes(o.studentId);
      });
    if (filterTags.length > 0)
      f = f.filter(function (o) {
        return filterTags.some(function (t) {
          return (o.dims || []).includes(t);
        });
      });
    if (filterSentiment)
      f = f.filter(function (o) {
        return o.sentiment === filterSentiment;
      });
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      f = f.filter(function (o) {
        var sn = _studentsById[o.studentId] ? displayName(_studentsById[o.studentId]) : '';
        return o.text.toLowerCase().includes(q) || sn.toLowerCase().includes(q);
      });
    }
    return f;
  }

  /* ── Feed HTML ──────────────────────────────────────────── */
  function renderObsCardHtml(ob) {
    var s = _studentsById[ob.studentId];
    var sn = s ? displayName(s) : ob.studentId;
    var tm = new Date(ob.created).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
    var ft = (ob.dims && ob.dims[0]) || null;
    var sent = ob.sentiment && OBS_SENTIMENTS[ob.sentiment];
    var bc = sent ? sent.border : ft ? tagColor(ft) : 'var(--border)';
    var out =
      '<div class="obs-card" data-action="openFocus" data-sid="' +
      ob.studentId +
      '" data-obid="' +
      ob.id +
      '"' +
      (ob.sentiment ? ' data-sentiment="' + ob.sentiment + '"' : '') +
      ' style="border-left-color:' +
      bc +
      '">' +
      '<div class="obs-card-header"><span>' +
      (sent ? '<span class="obs-card-sentiment">' + sent.icon + '</span>' : '') +
      '<span class="obs-card-student">' +
      esc(sn) +
      '</span><span class="obs-card-time">' +
      tm +
      '</span>' +
      (ob.context && OBS_CONTEXTS[ob.context]
        ? '<span class="obs-card-context">' +
          OBS_CONTEXTS[ob.context].icon +
          ' ' +
          OBS_CONTEXTS[ob.context].label +
          '</span>'
        : '') +
      '</span>' +
      '<span class="obs-card-header-actions">' +
      '<button class="obs-card-delete" data-action="deleteOb" data-sid="' +
      ob.studentId +
      '" data-obid="' +
      ob.id +
      '" data-stop-prop="true" title="Delete">🗑</button></span></div>' +
      '<div class="obs-card-text">' +
      esc(ob.text) +
      '</div>';
    if (ob.dims && ob.dims.length > 0) {
      out += '<div class="obs-card-dims">';
      ob.dims.forEach(function (t) {
        var info = resolveTag(t);
        out +=
          '<span class="obs-card-dim"><span class="dim-dot" style="background:' +
          tagColor(t) +
          '"></span>' +
          esc(info.label) +
          '</span>';
      });
      out += '</div>';
    }
    out += '</div>';
    return out;
  }

  function renderFeedHtml(filtered) {
    if (filtered.length === 0) {
      var n = getAllQuickObs(activeCourse).length;
      return (
        '<div class="obs-empty"><div class="obs-empty-icon">👁</div><div class="obs-empty-title">' +
        (n === 0 ? 'No observations yet' : 'No matching observations') +
        '</div><div class="obs-empty-sub">' +
        (n === 0 ? 'Select a student and capture what you notice' : 'Try adjusting your filters') +
        '</div></div>'
      );
    }
    var groups = {};
    filtered.forEach(function (ob) {
      var d = ob.date || ob.created.slice(0, 10);
      (groups[d] = groups[d] || []).push(ob);
    });
    var today = getTodayStr();
    var yd = (function () {
      var d = new Date();
      d.setDate(d.getDate() - 1);
      return (
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      );
    })();
    var out = '';
    Object.keys(groups)
      .sort(function (a, b) {
        return b.localeCompare(a);
      })
      .forEach(function (ds) {
        var lbl =
          ds === today
            ? 'Today'
            : ds === yd
              ? 'Yesterday'
              : new Date(ds + 'T12:00:00').toLocaleDateString('en-CA', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                });
        out += '<div class="obs-feed-date-group"><div class="obs-feed-date-label">' + lbl + '</div>';
        groups[ds].forEach(function (ob) {
          out += renderObsCardHtml(ob);
        });
        out += '</div>';
      });
    return out;
  }

  /* ── Popover management ─────────────────────────────────── */
  var POPOVER_IDS = {
    students: 'student-dropdown',
    tags: 'tag-dropdown',
    filterStudents: 'filter-student-dropdown',
    filterTags: 'filter-tag-dropdown',
  };
  function openPopover(name) {
    if (_openPopover === name) {
      closeAllPopovers();
      return;
    }
    closeAllPopovers();
    _openPopover = name;
    var el = document.getElementById(POPOVER_IDS[name]);
    if (el) {
      el.classList.add('open');
      var s = el.querySelector('.obs-popover-search');
      if (s) {
        s.value = '';
        s.focus();
      }
    }
  }
  function closeAllPopovers() {
    _openPopover = null;
    Object.values(POPOVER_IDS).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('open');
    });
  }

  /* ── Capture bar: students ──────────────────────────────── */
  function toggleCaptureStudent(sid) {
    var idx = selectedStudents.indexOf(sid);
    if (idx >= 0) selectedStudents.splice(idx, 1);
    else selectedStudents.push(sid);
    syncPopoverChecks('student-dropdown', selectedStudents, 'data-sid');
    updateCaptureStudentBtn();
    updateCaptureSecondary();
    updateAddBtn();
  }
  function removeCaptureStudent(sid) {
    selectedStudents = selectedStudents.filter(function (s) {
      return s !== sid;
    });
    updateCaptureStudentBtn();
    updateCaptureSecondary();
    updateAddBtn();
  }
  function updateCaptureStudentBtn() {
    var btn = document.getElementById('student-btn');
    if (!btn) return;
    var label = 'Select students\u2026';
    if (selectedStudents.length === 1) {
      var s = _studentsById[selectedStudents[0]];
      label = s ? displayName(s) : label;
    } else if (selectedStudents.length > 1) label = selectedStudents.length + ' students';
    btn.innerHTML = esc(label) + ' <span class="obs-btn-arrow"></span>';
    btn.classList.toggle('has-selection', selectedStudents.length > 0);
  }

  /* ── Capture bar: tags ──────────────────────────────────── */
  function toggleCaptureTag(key) {
    var idx = activeTags.indexOf(key);
    if (idx >= 0) activeTags.splice(idx, 1);
    else activeTags.push(key);
    syncPopoverChecks('tag-dropdown', activeTags, 'data-tag');
    var btn = document.getElementById('tag-btn');
    var totalCount = activeTags.length + (activeSentiment ? 1 : 0) + (activeContext ? 1 : 0);
    if (btn) {
      btn.classList.toggle('has-tags', totalCount > 0);
      btn.innerHTML =
        '<span class="tag-icon">' +
        TAG_SVG +
        '</span>Tags' +
        (totalCount > 0 ? ' <span class="obs-badge">' + totalCount + '</span>' : '');
    }
    updateCaptureSecondary();
  }
  function removeCaptureTag(key) {
    activeTags = activeTags.filter(function (t) {
      return t !== key;
    });
    updateCaptureSecondary();
    var btn = document.getElementById('tag-btn');
    var totalCount = activeTags.length + (activeSentiment ? 1 : 0) + (activeContext ? 1 : 0);
    if (btn) {
      btn.classList.toggle('has-tags', totalCount > 0);
      btn.innerHTML =
        '<span class="tag-icon">' +
        TAG_SVG +
        '</span>Tags' +
        (totalCount > 0 ? ' <span class="obs-badge">' + totalCount + '</span>' : '');
    }
  }
  function updateCaptureSecondary() {
    var cap = document.getElementById('obs-capture');
    if (!cap) return;
    var sec = cap.querySelector('.obs-capture-secondary');
    var html = renderCaptureSecondary();
    if (sec) sec.outerHTML = html;
    else cap.querySelector('.obs-capture-row').insertAdjacentHTML('afterend', html);
  }

  /* ── Filter strip: students ─────────────────────────────── */
  function toggleFilterStudent(sid) {
    var idx = filterStudents.indexOf(sid);
    if (idx >= 0) filterStudents.splice(idx, 1);
    else filterStudents.push(sid);
    syncPopoverChecks('filter-student-dropdown', filterStudents, 'data-sid');
    refreshFilterStrip();
    refreshFeedAndCount();
  }
  function removeFilterStudent(sid) {
    filterStudents = filterStudents.filter(function (s) {
      return s !== sid;
    });
    refreshFilterStrip();
    refreshFeedAndCount();
  }

  /* ── Filter strip: tags ─────────────────────────────────── */
  function toggleFilterTag(key) {
    var idx = filterTags.indexOf(key);
    if (idx >= 0) filterTags.splice(idx, 1);
    else filterTags.push(key);
    syncPopoverChecks('filter-tag-dropdown', filterTags, 'data-tag');
    refreshFilterStrip();
    refreshFeedAndCount();
  }
  function removeFilterTag(key) {
    filterTags = filterTags.filter(function (t) {
      return t !== key;
    });
    refreshFilterStrip();
    refreshFeedAndCount();
  }

  /* ── Shared popover helpers ─────────────────────────────── */
  function syncPopoverChecks(popoverId, selectedArr, attrName) {
    document.querySelectorAll('#' + popoverId + ' .obs-popover-item').forEach(function (el) {
      var val = el.getAttribute(attrName);
      var isSel = selectedArr.includes(val);
      el.classList.toggle('selected', isSel);
      var chk = el.querySelector('.obs-popover-check');
      if (chk) chk.textContent = isSel ? '✓' : '';
    });
  }
  function filterPopoverItems(popoverId, q) {
    var lower = q.toLowerCase();
    document.querySelectorAll('#' + popoverId + ' .obs-popover-item').forEach(function (el) {
      el.style.display = !lower || el.textContent.toLowerCase().includes(lower) ? '' : 'none';
    });
    document.querySelectorAll('#' + popoverId + ' .obs-popover-section').forEach(function (sec) {
      var next = sec.nextElementSibling;
      var anyVisible = false;
      while (next && !next.classList.contains('obs-popover-section')) {
        if (next.classList.contains('obs-popover-item') && next.style.display !== 'none') anyVisible = true;
        next = next.nextElementSibling;
      }
      sec.style.display = !lower || anyVisible ? '' : 'none';
    });
  }

  /* ── Other actions ──────────────────────────────────────── */
  function toggleFilterStrip() {
    _filterStripOpen = !_filterStripOpen;
    var strip = document.getElementById('obs-filter-strip');
    if (strip) strip.classList.toggle('open', _filterStripOpen);
  }

  function clearAllFilters() {
    filterStudents = [];
    filterTags = [];
    filterSentiment = null;
    searchQuery = '';
    var searchEl = document.getElementById('obs-search-input');
    if (searchEl) searchEl.value = '';
    document.querySelectorAll('.student-row').forEach(function (r) {
      r.classList.remove('selected');
    });
    refreshFilterStrip();
    refreshFeedAndCount();
  }

  function submitOb() {
    var input = document.getElementById('capture-input');
    if (!input) return;
    var text = input.value.trim();
    if (selectedStudents.length === 0) return;
    if (!text) {
      input.style.border = '2px solid var(--score-1)';
      input.placeholder = 'Enter an observation';
      input.oninput = function () {
        this.style.border = '';
      };
      input.focus();
      return;
    }
    selectedStudents.forEach(function (sid) {
      addQuickOb(activeCourse, sid, text, activeTags.slice(), activeSentiment, activeContext);
    });
    input.value = '';
    activeTags = [];
    activeSentiment = null;
    activeContext = null;
    render();
    requestAnimationFrame(function () {
      var inp = document.getElementById('capture-input');
      if (inp) inp.focus();
    });
  }

  function toggleSentiment(val) {
    activeSentiment = activeSentiment === val ? null : val;
    var wasOpen = _openPopover;
    var captureVal = (document.getElementById('capture-input') || {}).value || '';
    render();
    var inp2 = document.getElementById('capture-input');
    if (inp2 && captureVal) inp2.value = captureVal;
    if (wasOpen === 'tags')
      requestAnimationFrame(function () {
        openPopover('tags');
      });
    else
      requestAnimationFrame(function () {
        var inp = document.getElementById('capture-input');
        if (inp) inp.focus();
      });
  }

  function toggleContext(val) {
    activeContext = activeContext === val ? null : val;
    var wasOpen = _openPopover;
    var captureVal = (document.getElementById('capture-input') || {}).value || '';
    render();
    var inp2 = document.getElementById('capture-input');
    if (inp2 && captureVal) inp2.value = captureVal;
    if (wasOpen === 'tags')
      requestAnimationFrame(function () {
        openPopover('tags');
      });
    else
      requestAnimationFrame(function () {
        var inp = document.getElementById('capture-input');
        if (inp) inp.focus();
      });
  }

  function setFilterSentiment(val) {
    filterSentiment = filterSentiment === val ? null : val;
    var captureVal = (document.getElementById('capture-input') || {}).value || '';
    render();
    var inp2 = document.getElementById('capture-input');
    if (inp2 && captureVal) inp2.value = captureVal;
  }

  function updateAddBtn() {
    var btn = document.getElementById('capture-add-btn');
    var input = document.getElementById('capture-input');
    if (btn && input) btn.disabled = selectedStudents.length === 0 || !input.value.trim();
  }

  function addNewCustomTag() {
    var input = document.getElementById('custom-tag-input');
    if (!input) return;
    var label = input.value.trim();
    if (!label) return;
    addCustomTag(activeCourse, label);
    var key = 'tag:' + label;
    if (!activeTags.includes(key)) activeTags.push(key);
    render();
    requestAnimationFrame(function () {
      openPopover('tags');
    });
  }

  function wireSearch() {
    var el = document.getElementById('obs-search-input');
    if (el)
      el.addEventListener('input', function (e) {
        clearTimeout(_searchDebounce);
        var val = e.target.value;
        _searchDebounce = setTimeout(function () {
          searchQuery = val;
          refreshFeedAndCount();
        }, 120);
      });
  }

  function deleteOb(sid, obId, btn) {
    var key = sid + '-' + obId;
    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming');
      btn.textContent = 'Delete?';
      _deleteTimers[key] = setTimeout(function () {
        btn.classList.remove('confirming');
        btn.textContent = '🗑';
      }, 3000);
    } else {
      clearTimeout(_deleteTimers[key]);
      deleteQuickOb(activeCourse, sid, obId);
      refreshFeedAndCount();
    }
  }

  /* ══════════════════════════════════════════════════════════
     FOCUS CARD — click-to-expand inline editor
     ══════════════════════════════════════════════════════════ */

  function setView(v) {
    if (VIEW_MODES.indexOf(v) === -1) return;
    if (_viewMode === v) return;
    _viewMode = v;
    try {
      localStorage.setItem('obs-view-mode', v);
    } catch (e) {}
    var feedEl = document.getElementById('obs-feed');
    if (feedEl) feedEl.className = 'obs-feed view-' + _viewMode;
    document.querySelectorAll('.obs-view-toggle button').forEach(function (b) {
      var isActive = b.dataset.view === _viewMode;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', isActive);
    });
  }

  async function _ensureMotion() {
    if (_motion) return _motion;
    try {
      _motion = await import('https://esm.sh/motion@10.18.0');
    } catch (err) {
      console.warn('Motion One unavailable; falling back to CSS transitions', err);
      _motion = { animate: null };
    }
    return _motion;
  }

  function _focusFindOb(sid, obId) {
    var byStudent = getQuickObs(activeCourse) || {};
    var arr = byStudent[sid] || [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === obId) {
        // Raw entries in the by-student map don't carry studentId — only the
        // map key does. Attach it so the focus card can resolve the student.
        return Object.assign({ studentId: sid }, arr[i]);
      }
    }
    return null;
  }

  function _focusDoSave(patch) {
    if (!_focusSid || !_focusObId) return;
    updateQuickOb(activeCourse, _focusSid, _focusObId, patch);
    // Patch only the affected card, not the whole feed — saving on every
    // keystroke (after debounce) would otherwise rebuild ~117 cards each time.
    // The closing path calls refreshFeedAndCount() once to reconcile filters.
    var card = document.querySelector('.obs-card[data-sid="' + _focusSid + '"][data-obid="' + _focusObId + '"]');
    if (card) {
      var fresh = _focusFindOb(_focusSid, _focusObId);
      if (fresh) card.outerHTML = renderObsCardHtml(fresh);
    }
  }

  function _focusScheduleSave(patch) {
    if (_focusDebounce) clearTimeout(_focusDebounce);
    _focusDebounce = setTimeout(function () {
      _focusDebounce = null;
      _focusDoSave(patch);
    }, 500);
  }

  function _focusFlush(patch) {
    if (_focusDebounce) {
      clearTimeout(_focusDebounce);
      _focusDebounce = null;
    }
    var merged = patch;
    if (patch && _focusDraft && !('text' in patch)) {
      merged = Object.assign({}, patch, { text: _focusDraft.text });
    }
    _focusDoSave(merged);
  }

  function _focusFlushAll() {
    if (!_focusDebounce || !_focusDraft) return;
    clearTimeout(_focusDebounce);
    _focusDebounce = null;
    _focusDoSave({
      text: _focusDraft.text,
      sentiment: _focusDraft.sentiment,
      context: _focusDraft.context,
      dims: _focusDraft.dims,
    });
  }

  function _renderFocusDimsRow() {
    var h = '';
    _focusDraft.dims.forEach(function (t) {
      var info = resolveTag(t);
      h +=
        '<span class="obs-focus-dim"><span class="dim-dot" style="background:' +
        tagColor(t) +
        '"></span>' +
        esc(info.label) +
        '<button type="button" class="obs-focus-dim-remove" aria-label="Remove ' +
        esc(info.label) +
        '" data-action="focusRemoveDim" data-value="' +
        esc(t) +
        '">&times;</button></span>';
    });
    h +=
      '<div class="obs-focus-tag-popover-wrap">' +
      '<button type="button" class="obs-focus-add-tag" data-action="toggleFocusTagPopover">+ Tag</button>' +
      renderTagPopover('focus-tag-dropdown', _focusDraft.dims, 'toggleFocusDim') +
      '</div>';
    return h;
  }

  function _refreshFocusDimsRow() {
    if (!_focusEl) return;
    var row = _focusEl.querySelector('.obs-focus-dims');
    if (!row) return;
    row.innerHTML = _renderFocusDimsRow();
    _focusFocusables = null;
    if (_focusTagPopoverOpen) {
      var pop = document.getElementById('focus-tag-dropdown');
      if (pop) pop.classList.add('open');
    }
  }

  function _renderFocusCardHtml(ob) {
    var s = _studentsById[ob.studentId];
    var sn = s ? displayName(s) : ob.studentId;
    var tm = new Date(ob.created).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
    var sentAttr = _focusDraft.sentiment ? ' data-sentiment="' + _focusDraft.sentiment + '"' : '';

    var sentimentPills = Object.entries(OBS_SENTIMENTS)
      .map(function (entry) {
        var key = entry[0];
        var v = entry[1];
        var active = _focusDraft.sentiment === key;
        return (
          '<button type="button" class="obs-focus-pill' +
          (active ? ' active' : '') +
          '" data-sentiment="' +
          key +
          '" data-action="focusToggleSentiment" data-value="' +
          key +
          '">' +
          v.icon +
          ' ' +
          esc(v.label) +
          '</button>'
        );
      })
      .join('');

    var contextPills = Object.entries(OBS_CONTEXTS)
      .map(function (entry) {
        var key = entry[0];
        var v = entry[1];
        var active = _focusDraft.context === key;
        return (
          '<button type="button" class="obs-focus-pill' +
          (active ? ' active' : '') +
          '" data-action="focusToggleContext" data-value="' +
          key +
          '">' +
          v.icon +
          ' ' +
          esc(v.label) +
          '</button>'
        );
      })
      .join('');

    return (
      '<div class="obs-focus-card" id="obs-focus-card"' +
      sentAttr +
      ' role="dialog" aria-modal="true" aria-label="Observation focus" tabindex="-1">' +
      '<div class="obs-focus-header"><span><span class="obs-focus-student">' +
      esc(sn) +
      '</span><span class="obs-focus-time">' +
      tm +
      '</span></span>' +
      '<button type="button" class="obs-focus-close" aria-label="Close" data-action="closeFocus">&times;</button>' +
      '</div>' +
      '<div class="obs-focus-sentiments">' +
      sentimentPills +
      '</div>' +
      '<textarea class="obs-focus-textarea" id="focus-textarea" aria-label="Observation text" data-action-input="focusText">' +
      esc(_focusDraft.text) +
      '</textarea>' +
      '<div class="obs-focus-contexts">' +
      contextPills +
      '</div>' +
      '<div class="obs-focus-dims">' +
      _renderFocusDimsRow() +
      '</div>' +
      '</div>'
    );
  }

  function _autosizeFocusTextarea() {
    var ta = document.getElementById('focus-textarea');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(280, Math.max(140, ta.scrollHeight)) + 'px';
  }

  async function _animateFocusOpen() {
    if (!_focusBackdropEl || !_focusEl) return;
    // Add `.open` so the underlying resting state is fully visible — Motion One
    // and the CSS fallback both end up here; Motion One simply paints a spring
    // transition on top before settling to the underlying style.
    _focusBackdropEl.classList.add('open');
    _focusEl.classList.add('open');
    var m = await _ensureMotion();
    if (!_focusBackdropEl || !_focusEl || !m.animate) return;
    // Suppress the CSS transition so Motion One owns the timing.
    _focusBackdropEl.style.transition = 'none';
    _focusEl.style.transition = 'none';
    m.animate(_focusBackdropEl, { opacity: [0, 1] }, { duration: 0.2 });
    m.animate(
      _focusEl,
      { opacity: [0, 1], transform: ['scale(0.96)', 'scale(1)'] },
      { type: 'spring', stiffness: 300, damping: 30 },
    );
  }

  async function _animateFocusClose(done) {
    var bd = _focusBackdropEl;
    var card = _focusEl;
    if (!bd || !card) {
      done();
      return;
    }
    var m = await _ensureMotion();
    if (!bd || !card) {
      done();
      return;
    }
    // Remove `.open` so the underlying resting state is hidden; the animation
    // (Motion One or CSS) interpolates from current → that resting state.
    bd.classList.remove('open');
    card.classList.remove('open');
    if (!m.animate) {
      setTimeout(done, 200);
      return;
    }
    bd.style.transition = 'none';
    card.style.transition = 'none';
    m.animate(bd, { opacity: [1, 0] }, { duration: 0.15 });
    var anim = m.animate(card, { opacity: [1, 0], transform: ['scale(1)', 'scale(0.96)'] }, { duration: 0.15 });
    if (anim && anim.finished && typeof anim.finished.then === 'function') {
      anim.finished.then(done, done);
    } else {
      setTimeout(done, 160);
    }
  }

  function openFocus(sid, obId) {
    if (_focusBackdropEl) return; // already open
    var ob = _focusFindOb(sid, obId);
    if (!ob) return;
    _focusSid = sid;
    _focusObId = obId;
    _focusDraft = {
      text: ob.text || '',
      sentiment: ob.sentiment || null,
      context: ob.context || null,
      dims: (ob.dims || []).slice(),
    };
    _focusTagPopoverOpen = false;
    _focusLastActiveEl = document.activeElement;

    _focusBackdropEl = document.createElement('div');
    _focusBackdropEl.className = 'obs-focus-backdrop';
    _focusBackdropEl.id = 'obs-focus-backdrop';
    _focusBackdropEl.innerHTML = _renderFocusCardHtml(ob);
    document.body.appendChild(_focusBackdropEl);
    _focusEl = _focusBackdropEl.querySelector('.obs-focus-card');

    _animateFocusOpen();

    requestAnimationFrame(function () {
      _autosizeFocusTextarea();
      var ta = document.getElementById('focus-textarea');
      if (ta) {
        ta.focus();
        var len = ta.value.length;
        try {
          ta.setSelectionRange(len, len);
        } catch (e) {}
      }
    });
  }

  function closeFocus() {
    if (!_focusBackdropEl) return;
    _focusFlushAll();
    _focusTagPopoverOpen = false;
    // Reconcile filters/count once on close — per-keystroke saves only patched
    // the single edited card.
    refreshFeedAndCount();
    var bd = _focusBackdropEl;
    _animateFocusClose(function () {
      if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
      _focusBackdropEl = null;
      _focusEl = null;
      _focusObId = null;
      _focusSid = null;
      _focusDraft = null;
      _focusFocusables = null;
      if (_focusLastActiveEl && document.body.contains(_focusLastActiveEl)) {
        try {
          _focusLastActiveEl.focus();
        } catch (e) {}
      }
      _focusLastActiveEl = null;
    });
  }

  function focusToggleSentiment(val) {
    if (!_focusDraft) return;
    _focusDraft.sentiment = _focusDraft.sentiment === val ? null : val;
    if (_focusEl) {
      if (_focusDraft.sentiment) _focusEl.setAttribute('data-sentiment', _focusDraft.sentiment);
      else _focusEl.removeAttribute('data-sentiment');
      _focusEl.querySelectorAll('.obs-focus-sentiments .obs-focus-pill').forEach(function (b) {
        b.classList.toggle('active', b.dataset.value === _focusDraft.sentiment);
      });
    }
    _focusFlush({ sentiment: _focusDraft.sentiment });
  }

  function focusToggleContext(val) {
    if (!_focusDraft) return;
    _focusDraft.context = _focusDraft.context === val ? null : val;
    if (_focusEl) {
      _focusEl.querySelectorAll('.obs-focus-contexts .obs-focus-pill').forEach(function (b) {
        b.classList.toggle('active', b.dataset.value === _focusDraft.context);
      });
    }
    _focusFlush({ context: _focusDraft.context });
  }

  function focusRemoveDim(t) {
    if (!_focusDraft) return;
    _focusDraft.dims = _focusDraft.dims.filter(function (d) {
      return d !== t;
    });
    _refreshFocusDimsRow();
    _focusFlush({ dims: _focusDraft.dims });
  }

  function toggleFocusDim(t) {
    if (!_focusDraft) return;
    var idx = _focusDraft.dims.indexOf(t);
    if (idx >= 0) _focusDraft.dims.splice(idx, 1);
    else _focusDraft.dims.push(t);
    _refreshFocusDimsRow();
    _focusFlush({ dims: _focusDraft.dims });
  }

  function toggleFocusTagPopover() {
    var pop = document.getElementById('focus-tag-dropdown');
    if (!pop) return;
    _focusTagPopoverOpen = !_focusTagPopoverOpen;
    pop.classList.toggle('open', _focusTagPopoverOpen);
    if (_focusTagPopoverOpen) {
      var s = pop.querySelector('.obs-popover-search');
      if (s) {
        s.value = '';
        s.focus();
      }
    }
  }

  function _focusGetFocusables() {
    if (!_focusEl) return [];
    if (_focusFocusables) return _focusFocusables;
    _focusFocusables = Array.from(
      _focusEl.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter(function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
    return _focusFocusables;
  }

  function _focusHandleTab(e) {
    var focusables = _focusGetFocusables();
    if (focusables.length === 0) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ── Click-away for popovers ────────────────────────────── */
  function _handleMousedown(e) {
    if (_focusBackdropEl && e.target === _focusBackdropEl) {
      closeFocus();
      return;
    }
    if (_focusTagPopoverOpen && !e.target.closest('#focus-tag-dropdown') && !e.target.closest('.obs-focus-add-tag')) {
      _focusTagPopoverOpen = false;
      var pop = document.getElementById('focus-tag-dropdown');
      if (pop) pop.classList.remove('open');
    }
    if (
      _openPopover &&
      !e.target.closest('.obs-popover') &&
      !e.target.closest('.obs-capture-student-btn') &&
      !e.target.closest('.obs-tag-trigger') &&
      !e.target.closest('.obs-strip-trigger')
    ) {
      closeAllPopovers();
    }
  }

  function _handleInput(e) {
    if (e.target.id === 'capture-input') updateAddBtn();
    // Popover search inputs
    if (e.target.matches('[data-action-input="popoverSearch"]')) {
      filterPopoverItems(e.target.dataset.popoverId, e.target.value);
    }
    if (e.target.matches('[data-action-input="tagPopoverSearch"]')) {
      filterPopoverItems(e.target.dataset.popoverId, e.target.value);
    }
    if (e.target.matches('[data-action-input="focusText"]')) {
      if (_focusDraft) {
        _focusDraft.text = e.target.value;
        _autosizeFocusTextarea();
        _focusScheduleSave({ text: e.target.value });
      }
    }
  }

  /* ── Delegated click handler ──────────────────────────────── */
  function _handleClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.dataset.action;
    if (el.dataset.stopProp === 'true') e.stopPropagation();

    // Map toggle function names to actual functions
    var toggleFns = {
      toggleCaptureStudent: toggleCaptureStudent,
      toggleCaptureTag: toggleCaptureTag,
      toggleFilterStudent: toggleFilterStudent,
      toggleFilterTag: toggleFilterTag,
      toggleFocusDim: toggleFocusDim,
    };

    var handlers = {
      openPopover: function () {
        openPopover(el.dataset.popover);
      },
      submitOb: function () {
        submitOb();
      },
      toggleFilterStrip: function () {
        toggleFilterStrip();
      },
      setFilterSentiment: function () {
        setFilterSentiment(el.dataset.sentiment);
      },
      clearAllFilters: function () {
        clearAllFilters();
      },
      addNewCustomTag: function () {
        addNewCustomTag();
      },
      removeCaptureStudent: function () {
        removeCaptureStudent(el.dataset.sid);
      },
      removeCaptureTag: function () {
        removeCaptureTag(el.dataset.value);
      },
      removeFilterStudent: function () {
        removeFilterStudent(el.dataset.sid);
      },
      removeFilterTag: function () {
        removeFilterTag(el.dataset.value);
      },
      toggleSentiment: function () {
        toggleSentiment(el.dataset.value);
      },
      toggleContext: function () {
        toggleContext(el.dataset.value);
      },
      deleteOb: function () {
        deleteOb(el.dataset.sid, el.dataset.obid, el);
      },
      popoverToggle: function () {
        var fn = toggleFns[el.dataset.toggleFn];
        if (fn) fn(el.dataset.value);
      },
      openFocus: function () {
        openFocus(el.dataset.sid, el.dataset.obid);
      },
      closeFocus: function () {
        closeFocus();
      },
      focusToggleSentiment: function () {
        focusToggleSentiment(el.dataset.value);
      },
      focusToggleContext: function () {
        focusToggleContext(el.dataset.value);
      },
      focusRemoveDim: function () {
        focusRemoveDim(el.dataset.value);
      },
      toggleFocusTagPopover: function () {
        toggleFocusTagPopover();
      },
      setView: function () {
        setView(el.dataset.view);
      },
    };
    if (handlers[action]) {
      if (el.tagName !== 'SELECT') e.preventDefault();
      handlers[action]();
    }
  }

  /* ── Capture input keydown ──────────────────────────────── */
  function _handleKeydown(e) {
    if (_focusBackdropEl) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeFocus();
        return;
      }
      if (e.key === 'Tab') {
        _focusHandleTab(e);
        return;
      }
    }
    if (e.target.id === 'capture-input' && e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      submitOb();
    }
    // Custom tag input Enter
    if (e.target.id === 'custom-tag-input' && e.key === 'Enter') {
      e.preventDefault();
      addNewCustomTag();
    }
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    selectedStudents = [];
    filterStudents = [];
    filterTags = [];
    searchQuery = '';
    activeTags = [];
    activeSentiment = null;
    activeContext = null;
    filterSentiment = null;
    _openPopover = null;
    _filterStripOpen = false;
    try {
      var stored = localStorage.getItem('obs-view-mode');
      if (VIEW_MODES.indexOf(stored) !== -1) _viewMode = stored;
    } catch (e) {}

    // Show sidebar
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(activeCourse);
    initSidebarToggle();

    window._pageSwitchCourse = switchCourse;

    refreshStudentCache();

    _addDocListener('click', _handleClick);
    _addDocListener('mousedown', _handleMousedown);
    _addDocListener('input', _handleInput);
    _addDocListener('keydown', _handleKeydown);

    render();
    if (typeof setLongFormAuthContext === 'function') {
      setLongFormAuthContext({
        kind: 'observation-capture',
        getDraftText: function () {
          var input = document.getElementById('capture-input');
          return input ? input.value || '' : '';
        },
      });
    }
    overrideSidebarLinks();

    requestAnimationFrame(function () {
      document.getElementById('main').scrollTop = 0;
    });
  }

  function destroy() {
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    if (_searchDebounce) clearTimeout(_searchDebounce);
    _searchDebounce = null;
    if (_focusDebounce) clearTimeout(_focusDebounce);
    _focusDebounce = null;
    if (_focusBackdropEl && _focusBackdropEl.parentNode) {
      _focusBackdropEl.parentNode.removeChild(_focusBackdropEl);
    }
    _focusBackdropEl = null;
    _focusEl = null;
    _focusObId = null;
    _focusSid = null;
    _focusDraft = null;
    _focusFocusables = null;
    _focusLastActiveEl = null;
    _focusTagPopoverOpen = false;
    Object.keys(_deleteTimers).forEach(function (k) {
      clearTimeout(_deleteTimers[k]);
    });
    _deleteTimers = {};
    _students = [];
    _studentsById = {};
    closeAllPopovers();
    if (typeof clearLongFormAuthContext === 'function') clearLongFormAuthContext('observation-capture');
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
    switchCourse: switchCourse,
  };
})();
