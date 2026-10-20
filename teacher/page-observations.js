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
  var filterStudents = [];
  var filterTags = [];
  var searchQuery = '';
  /* The shared capture strip (teacher/obs-capture.js). */
  var _capture = null;
  var filterSentiment = null;
  var filterContext = null;
  var filterDate = null; // 'week' | 'term' | 'custom'
  var filterDateFrom = '';
  var filterDateTo = '';
  var filterAssessment = null; // 'linked' | 'unlinked'
  var filterQuoted = null; // 'quoted' | 'unquoted'
  var _openPopover = null;
  var _searchDebounce = null;
  var _alive = false;

  /* Deleted observations stay in the data layer until their Undo toast
     closes; until then the feed hides them. obId → { cid, sid }. */
  var _pendingDeletes = {};
  var UNDO_MS = 6000;

  var _students = [];
  var _studentsById = {};

  /* ── Focus card state ───────────────────────────────────── */
  var _focusObId = null;
  var _focusSid = null;
  var _focusEl = null;
  var _focusBackdropEl = null;
  var _focusDraft = null;
  var _focusOriginal = null;
  var _focusTagPopoverOpen = false;
  var _focusCtxOpen = false;
  var _focusFocusables = null;
  var _focusLastActiveEl = null;
  var _motion = null;

  var SEARCH_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  var tagColor = obsTagColor;

  /* ── Pure helpers (exported for tests) ──────────────────── */
  function _pad2(n) {
    return String(n).padStart(2, '0');
  }
  function _ymd(d) {
    return d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-' + _pad2(d.getDate());
  }
  function obDay(ob) {
    return ob.date || (ob.created || '').slice(0, 10);
  }

  /* Monday of the week holding todayStr (YYYY-MM-DD), through todayStr. */
  function weekRange(todayStr) {
    var d = new Date(todayStr + 'T12:00:00');
    var back = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - back);
    return { from: _ymd(d), to: todayStr };
  }

  /* The reporting term holding todayStr, else the latest one that has
     started, else null. */
  function termRange(terms, todayStr) {
    var started = (terms || []).filter(function (t) {
      return t.starts_on && t.starts_on <= todayStr;
    });
    if (!started.length) return null;
    var inside = started.filter(function (t) {
      return !t.ends_on || t.ends_on >= todayStr;
    });
    var t = (inside.length ? inside : started).sort(function (a, b) {
      return a.starts_on < b.starts_on ? 1 : -1;
    })[0];
    return { from: t.starts_on, to: t.ends_on || todayStr };
  }

  var Card = window.ObsCard;
  var quotedIndex = Card.quotedIndex;
  var sameCaptureIndex = Card.sameCaptureIndex;
  var isLinked = Card.isLinked;

  function refreshStudentCache() {
    _students = sortStudents(getStudents(activeCourse), 'lastName');
    _studentsById = {};
    _students.forEach(function (s) {
      _studentsById[s.id] = s;
    });
  }

  function activeFilterCount() {
    return (
      filterStudents.length +
      filterTags.length +
      (filterSentiment ? 1 : 0) +
      (filterContext ? 1 : 0) +
      (filterDate ? 1 : 0) +
      (filterAssessment ? 1 : 0) +
      (filterQuoted ? 1 : 0)
    );
  }

  function resetFilters() {
    filterStudents = [];
    filterTags = [];
    filterSentiment = null;
    filterContext = null;
    filterDate = null;
    filterDateFrom = '';
    filterDateTo = '';
    filterAssessment = null;
    filterQuoted = null;
    searchQuery = '';
  }

  /* ── Course switch ──────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(cid);
    refreshStudentCache();
    resetFilters();
    makeCapture([]);
    render();
    overrideSidebarLinks();
  }

  function makeCapture(students) {
    if (_capture) _capture.destroy();
    _capture = ObsCapture.create({
      cid: activeCourse,
      students: students,
      defaultAssessment: true,
      draftKey: 'obs-page',
      onAdd: function () {
        refreshFeedAndCount();
      },
    });
  }

  function overrideSidebarLinks() {
    requestAnimationFrame(function () {
      document.querySelectorAll('#gb-roster-list .student-row').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var sid = new URLSearchParams((a.getAttribute('href') || '').split('?')[1] || '').get('id');
          if (sid && _capture) {
            // Click picks the student; shift-click adds them to the group.
            _capture.pickStudent(sid, e.shiftKey);
            filterStudents = _capture.getStudents();
            render();
            document.querySelectorAll('.student-row').forEach(function (r) {
              var rid = new URLSearchParams((r.getAttribute('href') || '').split('?')[1] || '').get('id');
              r.classList.toggle('selected', filterStudents.indexOf(rid) >= 0);
            });
          }
        });
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */
  function render() {
    var h = '';

    // Capture strip, mounted after the page markup is in place
    h += '<div class="obs-capture-host" id="obs-capture-host"></div>';

    // Toolbar
    var allObs = visibleObs(getAllQuickObs(activeCourse));
    var filtered = applyFilters(allObs);

    h +=
      '<div class="obs-toolbar" id="obs-toolbar">' +
      '<div class="obs-search-wrap"><span class="obs-search-icon">' +
      SEARCH_SVG +
      '</span><input class="obs-search-input" type="text" placeholder="Search\u2026" id="obs-search-input" value="' +
      esc(searchQuery) +
      '" aria-label="Search observations"></div>' +
      '<span class="obs-toolbar-count" id="obs-count">' +
      countText(filtered.length, allObs.length) +
      '</span>' +
      '</div>';

    // Filter chips, one row
    h +=
      '<div class="obs-filter-strip" id="obs-filter-strip" role="toolbar" aria-label="Filter observations">' +
      renderFilterRow() +
      '</div>';

    // Feed
    h += '<div class="obs-feed" id="obs-feed">' + renderFeedHtml(filtered) + '</div>';

    document.getElementById('main').innerHTML = h;
    if (_capture) _capture.mount(document.getElementById('obs-capture-host'));
    wireSearch();
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

  function renderTagPopover(id, selectedArr, toggleFn) {
    var items = ObsCapture.tagMenuItems(activeCourse);
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

  /* ── Filter chips ───────────────────────────────────────── */
  var TYPE_OPTIONS = Object.keys(OBS_SENTIMENTS).map(function (k) {
    return { value: k, label: OBS_SENTIMENTS[k].label };
  });
  var CONTEXT_OPTIONS = Object.keys(OBS_CONTEXTS).map(function (k) {
    return { value: k, label: OBS_CONTEXTS[k].label };
  });
  var ASSESSMENT_OPTIONS = [
    { value: 'linked', label: 'Linked to an assessment' },
    { value: 'unlinked', label: 'Not linked' },
  ];
  var QUOTED_OPTIONS = [
    { value: 'quoted', label: 'Quoted in a report' },
    { value: 'unquoted', label: 'Not yet quoted' },
  ];
  function dateOptions() {
    var opts = [{ value: 'week', label: 'This week' }];
    if (getReportingTerms(activeCourse).length) opts.push({ value: 'term', label: 'This term' });
    opts.push({ value: 'custom', label: 'Custom dates' });
    return opts;
  }

  function _optionLabel(options, value) {
    for (var i = 0; i < options.length; i++) if (options[i].value === value) return options[i].label;
    return value;
  }
  function _shortDate(ymd) {
    return new Date(ymd + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  var FILTER_CHIPS = {
    filterStudents: { id: 'filter-student-btn', name: 'Student' },
    filterTags: { id: 'filter-tag-btn', name: 'Tag' },
    filterType: { id: 'filter-type-btn', name: 'Type', key: 'type' },
    filterContext: { id: 'filter-context-btn', name: 'Context', key: 'context' },
    filterDate: { id: 'filter-date-btn', name: 'Date', key: 'date' },
    filterAssessment: { id: 'filter-assessment-btn', name: 'Assessment', key: 'assessment' },
    filterQuoted: { id: 'filter-quoted-btn', name: 'Quoted', key: 'quoted' },
  };

  function chipState(popoverName) {
    switch (popoverName) {
      case 'filterStudents':
        if (!filterStudents.length) return null;
        if (filterStudents.length > 1) return filterStudents.length + ' students';
        return _studentsById[filterStudents[0]] ? displayName(_studentsById[filterStudents[0]]) : '1 student';
      case 'filterTags':
        if (!filterTags.length) return null;
        return filterTags.length === 1 ? resolveTag(filterTags[0]).label : filterTags.length + ' tags';
      case 'filterType':
        return filterSentiment ? _optionLabel(TYPE_OPTIONS, filterSentiment) : null;
      case 'filterContext':
        return filterContext ? _optionLabel(CONTEXT_OPTIONS, filterContext) : null;
      case 'filterDate':
        if (!filterDate) return null;
        if (filterDate !== 'custom') return _optionLabel(dateOptions(), filterDate);
        if (filterDateFrom && filterDateTo) return _shortDate(filterDateFrom) + ' – ' + _shortDate(filterDateTo);
        if (filterDateFrom) return 'From ' + _shortDate(filterDateFrom);
        if (filterDateTo) return 'Until ' + _shortDate(filterDateTo);
        return 'Custom dates';
      case 'filterAssessment':
        return filterAssessment ? _optionLabel(ASSESSMENT_OPTIONS, filterAssessment) : null;
      case 'filterQuoted':
        return filterQuoted ? _optionLabel(QUOTED_OPTIONS, filterQuoted) : null;
    }
    return null;
  }

  function chipInnerHtml(popoverName) {
    var st = chipState(popoverName);
    return esc(st || FILTER_CHIPS[popoverName].name) + ' <span class="obs-btn-arrow" aria-hidden="true"></span>';
  }

  function renderChip(popoverName, popoverHtml) {
    var chip = FILTER_CHIPS[popoverName];
    var st = chipState(popoverName);
    return (
      '<div class="obs-strip-popover-wrap"><button type="button" class="obs-filter-chip' +
      (st ? ' active' : '') +
      '" data-action="openPopover" data-popover="' +
      popoverName +
      '" id="' +
      chip.id +
      '" aria-haspopup="true" aria-expanded="false" aria-label="' +
      esc(chip.name + (st ? ': ' + st : '')) +
      '">' +
      chipInnerHtml(popoverName) +
      '</button>' +
      popoverHtml +
      '</div>'
    );
  }

  function renderOptionPopover(popoverName, options, current, extraHtml) {
    var key = FILTER_CHIPS[popoverName].key;
    var h = '<div class="obs-popover obs-option-popover" id="' + POPOVER_IDS[popoverName] + '" role="listbox">';
    h += '<div class="obs-popover-list">';
    options.forEach(function (o) {
      var sel = current === o.value;
      h +=
        '<div class="obs-popover-item' +
        (sel ? ' selected' : '') +
        '" role="option" aria-selected="' +
        sel +
        '" data-action="setFilterOption" data-filter="' +
        key +
        '" data-value="' +
        o.value +
        '"><span class="obs-popover-check">' +
        (sel ? '✓' : '') +
        '</span>' +
        esc(o.label) +
        '</div>';
    });
    h += '</div>' + (extraHtml || '') + '</div>';
    return h;
  }

  function renderDateInputs() {
    return (
      '<div class="obs-popover-date-row">' +
      '<label>From <input type="date" id="filter-date-from" value="' +
      esc(filterDateFrom) +
      '"></label>' +
      '<label>To <input type="date" id="filter-date-to" value="' +
      esc(filterDateTo) +
      '"></label>' +
      '</div>'
    );
  }

  function renderFilterRow() {
    var h =
      renderChip(
        'filterStudents',
        renderStudentPopover('filter-student-dropdown', filterStudents, 'toggleFilterStudent', 'filterFilterStudents'),
      ) +
      renderChip('filterTags', renderTagPopover('filter-tag-dropdown', filterTags, 'toggleFilterTag')) +
      renderChip('filterType', renderOptionPopover('filterType', TYPE_OPTIONS, filterSentiment)) +
      renderChip('filterContext', renderOptionPopover('filterContext', CONTEXT_OPTIONS, filterContext)) +
      renderChip('filterDate', renderOptionPopover('filterDate', dateOptions(), filterDate, renderDateInputs())) +
      renderChip('filterAssessment', renderOptionPopover('filterAssessment', ASSESSMENT_OPTIONS, filterAssessment)) +
      renderChip('filterQuoted', renderOptionPopover('filterQuoted', QUOTED_OPTIONS, filterQuoted));
    if (activeFilterCount() > 0)
      h += '<button type="button" class="obs-filter-clear" data-action="clearAllFilters">Clear all</button>';
    return h;
  }

  /* ── Partial updates ────────────────────────────────────── */
  function countText(shown, total) {
    if (shown !== total) return shown + ' of ' + total + ' observation' + (total === 1 ? '' : 's');
    return total + ' observation' + (total === 1 ? '' : 's');
  }

  function refreshFeedAndCount() {
    var allObs = visibleObs(getAllQuickObs(activeCourse));
    var filtered = applyFilters(allObs);
    var feedEl = document.getElementById('obs-feed');
    if (feedEl) feedEl.innerHTML = renderFeedHtml(filtered);
    var countEl = document.getElementById('obs-count');
    if (countEl) countEl.textContent = countText(filtered.length, allObs.length);
  }

  /* Updates chip labels, option checks and the Clear button in place, so an
     open multi-select popover stays open with its search text. */
  function refreshFilterStrip() {
    Object.keys(FILTER_CHIPS).forEach(function (name) {
      var chip = FILTER_CHIPS[name];
      var btn = document.getElementById(chip.id);
      if (!btn) return;
      var st = chipState(name);
      btn.classList.toggle('active', !!st);
      btn.innerHTML = chipInnerHtml(name);
      btn.setAttribute('aria-label', chip.name + (st ? ': ' + st : ''));
      if (!chip.key) return;
      var current = filterValue(chip.key);
      document.querySelectorAll('#' + POPOVER_IDS[name] + ' .obs-popover-item').forEach(function (el) {
        var sel = el.dataset.value === current;
        el.classList.toggle('selected', sel);
        el.setAttribute('aria-selected', String(sel));
        var chk = el.querySelector('.obs-popover-check');
        if (chk) chk.textContent = sel ? '✓' : '';
      });
    });
    var strip = document.getElementById('obs-filter-strip');
    if (!strip) return;
    var clear = strip.querySelector('.obs-filter-clear');
    if (activeFilterCount() > 0 && !clear) {
      strip.insertAdjacentHTML(
        'beforeend',
        '<button type="button" class="obs-filter-clear" data-action="clearAllFilters">Clear all</button>',
      );
    } else if (activeFilterCount() === 0 && clear) {
      clear.remove();
    }
  }

  function filterValue(key) {
    return {
      type: filterSentiment,
      context: filterContext,
      date: filterDate,
      assessment: filterAssessment,
      quoted: filterQuoted,
    }[key];
  }

  function setFilterOption(key, value) {
    var next = filterValue(key) === value ? null : value;
    if (key === 'type') filterSentiment = next;
    else if (key === 'context') filterContext = next;
    else if (key === 'assessment') filterAssessment = next;
    else if (key === 'quoted') filterQuoted = next;
    else if (key === 'date') {
      filterDate = next;
      if (next !== 'custom') {
        filterDateFrom = '';
        filterDateTo = '';
        var f = document.getElementById('filter-date-from');
        var t = document.getElementById('filter-date-to');
        if (f) f.value = '';
        if (t) t.value = '';
      }
      if (next === 'custom') {
        refreshFilterStrip();
        refreshFeedAndCount();
        var from = document.getElementById('filter-date-from');
        if (from) from.focus();
        return;
      }
    }
    closeAllPopovers();
    refreshFilterStrip();
    refreshFeedAndCount();
  }

  function setCustomDate(which, value) {
    if (which === 'from') filterDateFrom = value || '';
    else filterDateTo = value || '';
    filterDate = filterDateFrom || filterDateTo ? 'custom' : filterDate;
    refreshFilterStrip();
    refreshFeedAndCount();
  }

  /* ── Apply filters ──────────────────────────────────────── */
  function visibleObs(allObs) {
    return allObs.filter(function (o) {
      return !_pendingDeletes[o.id];
    });
  }

  function assessmentTitle(ob) {
    return Card.assessmentTitle(activeCourse, ob);
  }

  function dateBounds() {
    if (filterDate === 'week') return weekRange(getTodayStr());
    if (filterDate === 'term') return termRange(getReportingTerms(activeCourse), getTodayStr());
    if (filterDate === 'custom') return { from: filterDateFrom || '', to: filterDateTo || '' };
    return null;
  }

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
    if (filterContext)
      f = f.filter(function (o) {
        return o.context === filterContext;
      });
    var b = dateBounds();
    if (b)
      f = f.filter(function (o) {
        var d = obDay(o);
        return (!b.from || d >= b.from) && (!b.to || d <= b.to);
      });
    if (filterAssessment)
      f = f.filter(function (o) {
        return isLinked(o) === (filterAssessment === 'linked');
      });
    if (filterQuoted) {
      var qi = quotedIndex(getTermRatings(activeCourse));
      f = f.filter(function (o) {
        return !!qi[o.studentId + '|' + o.id] === (filterQuoted === 'quoted');
      });
    }
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      f = f.filter(function (o) {
        var sn = _studentsById[o.studentId] ? displayName(_studentsById[o.studentId]) : '';
        if ((o.text || '').toLowerCase().includes(q) || sn.toLowerCase().includes(q)) return true;
        var tagHit = (o.dims || []).some(function (t) {
          return String(resolveTag(t).label || '')
            .toLowerCase()
            .includes(q);
        });
        if (tagHit) return true;
        var ctx = o.context && OBS_CONTEXTS[o.context];
        if (ctx && ctx.label.toLowerCase().includes(q)) return true;
        return assessmentTitle(o).toLowerCase().includes(q);
      });
    }
    return f;
  }

  /* ── Feed HTML ──────────────────────────────────────────── */
  function feedContext() {
    return Card.context(activeCourse, { hidden: _pendingDeletes });
  }

  function renderObsCardHtml(ob, ctx) {
    return Card.html(ob, ctx || feedContext());
  }

  function renderFeedHtml(filtered) {
    if (filtered.length === 0) {
      var n = visibleObs(getAllQuickObs(activeCourse)).length;
      return (
        '<div class="obs-empty"><div class="obs-empty-title">' +
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
    var ctx = feedContext();
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
        out += '<div class="obs-feed-date-group">' + Card.dayHeaderHtml(lbl, groups[ds].length);
        groups[ds].forEach(function (ob) {
          out += renderObsCardHtml(ob, ctx);
        });
        out += '</div>';
      });
    return out;
  }

  /* ── Popover management ─────────────────────────────────── */
  var POPOVER_IDS = {
    filterStudents: 'filter-student-dropdown',
    filterTags: 'filter-tag-dropdown',
    filterType: 'filter-type-dropdown',
    filterContext: 'filter-context-dropdown',
    filterDate: 'filter-date-dropdown',
    filterAssessment: 'filter-assessment-dropdown',
    filterQuoted: 'filter-quoted-dropdown',
  };
  function openPopover(name) {
    if (_openPopover === name) {
      closeAllPopovers();
      return;
    }
    closeAllPopovers();
    _openPopover = name;
    var trig = document.querySelector('[data-action="openPopover"][data-popover="' + name + '"]');
    if (trig) trig.setAttribute('aria-expanded', 'true');
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
    document.querySelectorAll('[data-action="openPopover"][aria-expanded="true"]').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
    });
    Object.values(POPOVER_IDS).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('open');
    });
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

  /* ── Filter strip: tags ─────────────────────────────────── */
  function toggleFilterTag(key) {
    var idx = filterTags.indexOf(key);
    if (idx >= 0) filterTags.splice(idx, 1);
    else filterTags.push(key);
    syncPopoverChecks('filter-tag-dropdown', filterTags, 'data-tag');
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
  function clearAllFilters() {
    resetFilters();
    var searchEl = document.getElementById('obs-search-input');
    if (searchEl) searchEl.value = '';
    document.querySelectorAll('.student-row').forEach(function (r) {
      r.classList.remove('selected');
    });
    closeAllPopovers();
    var strip = document.getElementById('obs-filter-strip');
    if (strip) strip.innerHTML = renderFilterRow();
    refreshFeedAndCount();
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

  /* One click hides the card and offers Undo for six seconds. The delete
     reaches the data layer only when the toast closes without Undo (it times
     out, another toast replaces it, or the page is left). */
  function deleteOb(sid, obId) {
    if (!sid || !obId || _pendingDeletes[obId]) return;
    var cid = activeCourse;
    _pendingDeletes[obId] = { cid: cid, sid: sid };
    refreshFeedAndCount();
    var settled = false;
    showUndoToast(
      'Observation deleted',
      function () {
        if (settled) return;
        settled = true;
        delete _pendingDeletes[obId];
        if (_alive && activeCourse === cid) refreshFeedAndCount();
      },
      function () {
        if (settled) return;
        settled = true;
        delete _pendingDeletes[obId];
        deleteQuickOb(cid, sid, obId);
        if (_alive && activeCourse === cid) refreshFeedAndCount();
      },
      UNDO_MS,
    );
  }

  // Closing the tab inside the undo window still deletes.
  if (typeof window.addEventListener === 'function')
    window.addEventListener('pagehide', function () {
      if (Object.keys(_pendingDeletes).length && typeof dismissUndoToast === 'function') dismissUndoToast();
    });

  /* ══════════════════════════════════════════════════════════
     FOCUS CARD — click-to-expand inline editor
     ══════════════════════════════════════════════════════════ */

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

  /* The editor keeps a draft; nothing is written until Save (or Enter).
     Cancel and Esc leave the observation as it was. */
  function _focusDirty() {
    if (!_focusDraft || !_focusOriginal) return false;
    return (
      _focusDraft.text !== _focusOriginal.text ||
      _focusDraft.sentiment !== _focusOriginal.sentiment ||
      _focusDraft.context !== _focusOriginal.context ||
      _focusDraft.dims.join('|') !== _focusOriginal.dims.join('|')
    );
  }

  function focusSave() {
    if (!_focusDraft || !_focusSid || !_focusObId) return;
    if (!_focusDraft.text.trim()) {
      var ta = document.getElementById('focus-textarea');
      if (ta) ta.focus();
      return;
    }
    if (_focusDirty()) {
      updateQuickOb(activeCourse, _focusSid, _focusObId, {
        text: _focusDraft.text.trim(),
        sentiment: _focusDraft.sentiment,
        context: _focusDraft.context,
        dims: _focusDraft.dims.slice(),
      });
    }
    closeFocus();
  }

  function focusDelete() {
    var sid = _focusSid;
    var obId = _focusObId;
    closeFocus();
    deleteOb(sid, obId);
  }

  function _renderFocusTagsHtml() {
    var h = '';
    _focusDraft.dims.forEach(function (t) {
      var info = resolveTag(t);
      h +=
        '<span class="obs-tag-chip"><span class="dim-dot" style="background:' +
        tagColor(t) +
        '"></span>' +
        esc(info.label) +
        '<button type="button" class="obs-tag-chip-x" aria-label="Remove ' +
        esc(info.label) +
        '" data-action="focusRemoveDim" data-value="' +
        esc(t) +
        '">&times;</button></span>';
    });
    h +=
      '<div class="obs-focus-tag-popover-wrap">' +
      '<button type="button" class="obs-add obs-focus-add-tag" data-action="toggleFocusTagPopover">+ Add Tag</button>' +
      renderTagPopover('focus-tag-dropdown', _focusDraft.dims, 'toggleFocusDim') +
      '</div>';
    return h;
  }

  function _focusRowHtml() {
    return (
      '<span class="obs-row-label">Tags</span>' +
      _renderFocusTagsHtml() +
      '<span class="obs-row-sep" aria-hidden="true"></span>' +
      '<span class="obs-row-label" id="focus-ctx-label">Context</span>' +
      Card.contextMenuHtml({
        id: 'focus-ctx',
        value: _focusDraft.context,
        open: _focusCtxOpen,
        toggleAction: 'focusToggleCtxMenu',
        pickAction: 'focusPickContext',
        labelledBy: 'focus-ctx-label',
      })
    );
  }

  function _refreshFocusRow() {
    if (!_focusEl) return;
    var row = _focusEl.querySelector('.obs-focus-row');
    if (!row) return;
    row.innerHTML = _focusRowHtml();
    _focusFocusables = null;
    if (_focusTagPopoverOpen) {
      var pop = document.getElementById('focus-tag-dropdown');
      if (pop) pop.classList.add('open');
    }
  }

  /* "Quoted in Report 1. Changes here show in that report." */
  function _quotedNotice(label) {
    if (!label) return '';
    var several = /Reports /.test(label);
    var lead = label === 'Quoted' ? 'Quoted in a report.' : label + '.';
    return (
      '<div class="obs-notice" role="note"><b>' +
      esc(lead) +
      '</b> Changes here show in ' +
      (several ? 'those reports.' : 'that report.') +
      '</div>'
    );
  }

  function _renderFocusCardHtml(ob) {
    var p = Card.parts(ob, Card.context(activeCourse, { hidden: _pendingDeletes }));
    return (
      '<div class="obs-focus-card" id="obs-focus-card" role="dialog" aria-modal="true" aria-label="Edit observation for ' +
      esc(p.name) +
      '" tabindex="-1">' +
      Card.typeBandHtml({
        value: _focusDraft.sentiment,
        action: 'focusToggleSentiment',
        right: Card.cardWhen(ob),
      }) +
      '<div class="obs-focus-body">' +
      '<div class="obs-focus-header"><span class="obs-focus-student">' +
      esc(p.name) +
      '</span>' +
      (p.withText ? '<span class="obs-focus-with">' + esc(p.withText) + '</span>' : '') +
      '</div>' +
      _quotedNotice(p.quoted) +
      '<textarea class="obs-note-box obs-focus-textarea" id="focus-textarea" aria-label="Observation text" data-action-input="focusText">' +
      esc(_focusDraft.text) +
      '</textarea>' +
      '<div class="obs-row obs-focus-row">' +
      _focusRowHtml() +
      '</div>' +
      '<div class="obs-focus-foot">' +
      '<button type="button" class="obs-focus-delete" data-action="focusDelete">' +
      Card.TRASH_SVG +
      'Delete</button>' +
      '<span class="obs-focus-hint">Enter saves · Shift+Enter new line · Esc cancels</span>' +
      '<span class="obs-focus-spacer"></span>' +
      '<button type="button" class="btn btn-ghost" data-action="closeFocus">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="focusSave">Save</button>' +
      '</div></div></div>'
    );
  }

  function _autosizeFocusTextarea() {
    var ta = document.getElementById('focus-textarea');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(280, Math.max(104, ta.scrollHeight)) + 'px';
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
    _focusOriginal = Object.assign({}, _focusDraft, { dims: _focusDraft.dims.slice() });
    _focusTagPopoverOpen = false;
    _focusCtxOpen = false;
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

  /* Closes without writing; Save writes first. */
  function closeFocus() {
    if (!_focusBackdropEl) return;
    _focusTagPopoverOpen = false;
    _focusCtxOpen = false;
    refreshFeedAndCount();
    var bd = _focusBackdropEl;
    _animateFocusClose(function () {
      if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
      _focusBackdropEl = null;
      _focusEl = null;
      _focusObId = null;
      _focusSid = null;
      _focusDraft = null;
      _focusOriginal = null;
      _focusFocusables = null;
      if (_focusLastActiveEl && document.body.contains(_focusLastActiveEl)) {
        try {
          _focusLastActiveEl.focus();
        } catch (e) {}
      }
      _focusLastActiveEl = null;
    });
  }

  /* A type tab picks the type; the chosen tab again clears it. */
  function focusToggleSentiment(val) {
    if (!_focusDraft) return;
    _focusDraft.sentiment = _focusDraft.sentiment === val ? null : val;
    if (_focusEl) Card.syncTypeBand(_focusEl, _focusDraft.sentiment);
  }

  function focusToggleCtxMenu() {
    if (!_focusDraft) return;
    _focusCtxOpen = !_focusCtxOpen;
    _focusTagPopoverOpen = false;
    _refreshFocusRow();
    if (_focusCtxOpen) Card.focusContextMenu(_focusEl);
    else {
      var btn = _focusEl && _focusEl.querySelector('.obs-menu-btn');
      if (btn) btn.focus();
    }
  }

  function focusPickContext(val) {
    if (!_focusDraft) return;
    _focusDraft.context = val || null;
    _focusCtxOpen = false;
    _refreshFocusRow();
    var btn = _focusEl && _focusEl.querySelector('.obs-menu-btn');
    if (btn) btn.focus();
  }

  function focusRemoveDim(t) {
    if (!_focusDraft) return;
    _focusDraft.dims = _focusDraft.dims.filter(function (d) {
      return d !== t;
    });
    _refreshFocusRow();
  }

  function toggleFocusDim(t) {
    if (!_focusDraft) return;
    var idx = _focusDraft.dims.indexOf(t);
    if (idx >= 0) _focusDraft.dims.splice(idx, 1);
    else _focusDraft.dims.push(t);
    _refreshFocusRow();
  }

  function toggleFocusTagPopover() {
    var pop = document.getElementById('focus-tag-dropdown');
    if (!pop) return;
    _focusTagPopoverOpen = !_focusTagPopoverOpen;
    if (_focusTagPopoverOpen && _focusCtxOpen) {
      _focusCtxOpen = false;
      _refreshFocusRow();
      pop = document.getElementById('focus-tag-dropdown');
    }
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
      // A click outside leaves only when there is nothing to lose.
      if (!_focusDirty()) closeFocus();
      return;
    }
    if (_focusCtxOpen && !e.target.closest('.obs-menu-wrap')) {
      _focusCtxOpen = false;
      _refreshFocusRow();
    }
    if (_focusTagPopoverOpen && !e.target.closest('#focus-tag-dropdown') && !e.target.closest('.obs-focus-add-tag')) {
      _focusTagPopoverOpen = false;
      var pop = document.getElementById('focus-tag-dropdown');
      if (pop) pop.classList.remove('open');
    }
    if (_openPopover && !e.target.closest('.obs-popover') && !e.target.closest('.obs-filter-chip')) {
      closeAllPopovers();
    }
  }

  function _handleChange(e) {
    if (e.target.id === 'filter-date-from') setCustomDate('from', e.target.value);
    else if (e.target.id === 'filter-date-to') setCustomDate('to', e.target.value);
  }

  function _handleInput(e) {
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
      toggleFilterStudent: toggleFilterStudent,
      toggleFilterTag: toggleFilterTag,
      toggleFocusDim: toggleFocusDim,
    };

    var handlers = {
      openPopover: function () {
        openPopover(el.dataset.popover);
      },
      setFilterOption: function () {
        setFilterOption(el.dataset.filter, el.dataset.value);
      },
      clearAllFilters: function () {
        clearAllFilters();
      },
      deleteOb: function () {
        deleteOb(el.dataset.sid, el.dataset.obid);
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
      focusToggleCtxMenu: function () {
        focusToggleCtxMenu();
      },
      focusPickContext: function () {
        focusPickContext(el.dataset.value);
      },
      focusSave: function () {
        focusSave();
      },
      focusDelete: function () {
        focusDelete();
      },
      focusRemoveDim: function () {
        focusRemoveDim(el.dataset.value);
      },
      toggleFocusTagPopover: function () {
        toggleFocusTagPopover();
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
        if (_focusCtxOpen) {
          focusToggleCtxMenu();
        } else if (_focusTagPopoverOpen) {
          toggleFocusTagPopover();
          var addTag = _focusEl && _focusEl.querySelector('.obs-focus-add-tag');
          if (addTag) addTag.focus();
        } else {
          closeFocus();
        }
        return;
      }
      if (_focusCtxOpen && Card.contextMenuKey(e, _focusEl)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.id === 'focus-textarea') {
        e.preventDefault();
        focusSave();
        return;
      }
      if (e.key === 'Tab') {
        _focusHandleTab(e);
        return;
      }
    }
    // A focused card opens with Enter or Space, like a button.
    if (
      !_focusBackdropEl &&
      e.target.classList &&
      e.target.classList.contains('obs-card') &&
      (e.key === 'Enter' || e.key === ' ')
    ) {
      e.preventDefault();
      openFocus(e.target.dataset.sid, e.target.dataset.obid);
      return;
    }
    if (e.key === 'Escape' && _openPopover) {
      closeAllPopovers();
      return;
    }
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    resetFilters();
    _openPopover = null;
    // The sticky-note view is gone (2026-10-19); drop its saved setting.
    try {
      localStorage.removeItem('fv-obs-view');
    } catch (e) {}
    _alive = true;

    // Show sidebar
    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');
    document.getElementById('sidebar-mount').innerHTML = renderSidebar(activeCourse);
    initSidebarToggle();

    window._pageSwitchCourse = switchCourse;

    refreshStudentCache();

    // The dashboard's coverage grid opens this page with one student selected.
    var preset = [];
    if (params.student && _studentsById[params.student]) {
      preset = [params.student];
      filterStudents = [params.student];
    }
    makeCapture(preset);

    _addDocListener('click', _handleClick);
    _addDocListener('mousedown', _handleMousedown);
    _addDocListener('input', _handleInput);
    _addDocListener('change', _handleChange);
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
    if (_focusBackdropEl && _focusBackdropEl.parentNode) {
      _focusBackdropEl.parentNode.removeChild(_focusBackdropEl);
    }
    _focusBackdropEl = null;
    _focusEl = null;
    _focusObId = null;
    _focusSid = null;
    _focusDraft = null;
    _focusOriginal = null;
    _focusFocusables = null;
    _focusLastActiveEl = null;
    _focusTagPopoverOpen = false;
    _focusCtxOpen = false;
    _alive = false;
    _students = [];
    _studentsById = {};
    if (_capture) _capture.destroy();
    _capture = null;
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
    _helpers: {
      weekRange: weekRange,
      termRange: termRange,
      quotedIndex: Card.quotedIndex,
      quotedLabel: Card.quotedLabel,
      sameCaptureIndex: Card.sameCaptureIndex,
      captureKey: Card.captureKey,
      withLabel: Card.withLabel,
      isLinked: Card.isLinked,
    },
  };
})();
