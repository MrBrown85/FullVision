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
  /* The shared capture strip (shared/obs-capture.js). */
  var _capture = null;
  var filterSentiment = []; // the types ticked: any of them
  var filterContext = []; // the contexts ticked: any of them
  var filterDate = null; // 'week' | 'term' | 'custom'
  var filterDateFrom = '';
  var filterDateTo = '';
  // The Open Concerns button: only Concerns with no Resolved follow-up.
  var filterOpenConcerns = false;
  var _alive = false;

  /* Deleted observations stay in the data layer until their Undo toast
     closes; until then the feed hides them. obId → { cid, sid }. */
  var _pendingDeletes = {};
  var UNDO_MS = 6000;

  var _students = [];
  var _studentsById = {};

  // The feed shows the newest 50 that pass the filters; Show More adds 50; a search or filter starts over.
  var FEED_STEP = 50;
  var _feedLimit = FEED_STEP;

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

  var tagColor = obsTagColor;

  var _ymd = DashObservations.ymd;
  var weekRange = DashObservations.weekRange;
  var termRange = DashObservations.termRange;
  function obDay(ob) {
    return ob.date || (ob.created || '').slice(0, 10);
  }

  var Card = window.ObsCard;
  var sameCaptureIndex = Card.sameCaptureIndex;

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
      filterSentiment.length +
      filterContext.length +
      (filterDate ? 1 : 0) +
      (filterOpenConcerns ? 1 : 0)
    );
  }

  function resetFilters() {
    filterStudents = [];
    filterTags = [];
    filterSentiment = [];
    filterContext = [];
    filterDate = null;
    filterDateFrom = '';
    filterDateTo = '';
    filterOpenConcerns = false;
    searchQuery = '';
    _feedLimit = FEED_STEP;
  }

  /* ── The roster and Open Concerns (obs-roster.js) ───────── */
  function syncRoster() {
    if (_alive) ObsRoster.sync({ cid: activeCourse, students: _students, visible: visibleObs, picked: filterStudents });
  }
  function toggleNotObserved() {
    ObsRoster.toggle();
    syncRoster();
    ObsRoster.focusToggle();
  }
  // The bar's Show and the badge on Open Concerns (obs-toolbar.js).
  function syncConcernBtn() {
    ObsToolbar.sync(barState(true));
  }
  function toggleOpenConcerns() {
    filterOpenConcerns = !filterOpenConcerns;
    syncConcernBtn();
    refilter();
  }

  /* ── Course switch ──────────────────────────────────────── */
  async function switchCourse(cid) {
    activeCourse = cid;
    if (!(await switchActiveCourse(cid))) return;
    // The roster's grades are the year so far, as on the Gradebook.
    if (typeof setActiveTerm === 'function') setActiveTerm(cid, null);
    SidebarKeep.draw(renderSidebar(cid));
    refreshStudentCache();
    resetFilters();
    makeCapture([]);
    ObsRoster.reset();
    ObsToolbar.reset();
    render();
    syncRoster();
    overrideSidebarLinks();
  }

  function makeCapture(students) {
    if (_capture) _capture.destroy();
    _capture = ObsCapture.create({
      cid: activeCourse,
      students: students,
      draftKey: 'obs-page',
      onAdd: refreshFeedAndCount,
    });
  }

  // A click on a roster row picks the student; shift-click adds them.
  function overrideSidebarLinks() {
    ObsRoster.wireRows(function (sid, shift) {
      if (!_capture) return null;
      _capture.pickStudent(sid, shift);
      filterStudents = _capture.getStudents();
      refreshFilterStrip();
      refilter();
      syncRoster();
      return filterStudents;
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
    feedChanged();
    var data = feedData();
    var filtered = applyFilters(data.obs);

    // Search, Show and the filter chips, one row (obs-toolbar.js)
    h += ObsToolbar.html(barState(true));

    // Feed
    h += '<div class="obs-feed" id="obs-feed">' + renderFeedHtml(filtered, data) + '</div>';

    // html-safe: ObsToolbar.html escapes the search text and every name; the feed is built by renderFeedHtml.
    document.getElementById('main').innerHTML = h;
    if (_capture) _capture.mount(document.getElementById('obs-capture-host'));
  }

  // html-safe: tag keys and labels are escaped; dot colours come from obsTagColor; ids and actions are fixed.
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

  // After the observations changed (added, edited, deleted, Undo).
  function refreshFeedAndCount() {
    feedChanged();
    showFeed();
    syncConcernBtn();
    syncRoster();
  }
  // After a search or a filter: the same observations, the newest first again.
  function refilter() {
    _feedLimit = FEED_STEP;
    showFeed();
  }
  function showFeed() {
    var data = feedData();
    var filtered = applyFilters(data.obs);
    var feedEl = document.getElementById('obs-feed');
    if (feedEl) feedEl.innerHTML = renderFeedHtml(filtered, data);
  }
  function showMore() {
    var at = _feedLimit;
    _feedLimit += FEED_STEP;
    showFeed();
    var next = document.querySelectorAll('#obs-feed .obs-card')[at];
    if (next && typeof next.focus === 'function') next.focus();
  }

  /* The state the bar and its panel draw (obs-toolbar.js). The open concerns
     are counted only when asked: a tick in the panel does not read them. */
  function barState(withConcerns) {
    return {
      cid: activeCourse,
      search: searchQuery,
      students: _students,
      concerns: withConcerns && typeof getOpenConcerns === 'function' ? getOpenConcerns(activeCourse).length : null,
      f: {
        students: filterStudents,
        tags: filterTags,
        types: filterSentiment,
        contexts: filterContext,
        date: filterDate,
        from: filterDateFrom,
        to: filterDateTo,
        concerns: filterOpenConcerns,
      },
    };
  }
  // Chips, the Filter button, the panel's marks and Clear Filters follow a change in place.
  function refreshFilterStrip() {
    ObsToolbar.sync(barState(false));
  }

  // Date: one choice at a time; the chosen one again lets go (and the range with it).
  function setFilterOption(key, value) {
    if (key !== 'date') return;
    filterDate = filterDate === value ? null : value;
    if (filterDate !== 'custom') {
      filterDateFrom = '';
      filterDateTo = '';
    }
    refreshFilterStrip();
    refilter();
  }

  function setCustomDate(which, value) {
    if (which === 'from') filterDateFrom = value || '';
    else filterDateTo = value || '';
    filterDate = filterDateFrom || filterDateTo ? 'custom' : filterDate;
    refreshFilterStrip();
    refilter();
  }

  /* ── Apply filters ──────────────────────────────────────── */
  function visibleObs(allObs) {
    return allObs.filter(function (o) {
      return !_pendingDeletes[o.id];
    });
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
    if (filterSentiment.length)
      f = f.filter(function (o) {
        return filterSentiment.includes(o.sentiment);
      });
    if (filterContext.length)
      f = f.filter(function (o) {
        return filterContext.includes(o.context);
      });
    var b = dateBounds();
    if (b)
      f = f.filter(function (o) {
        var d = obDay(o);
        return (!b.from || d >= b.from) && (!b.to || d <= b.to);
      });
    if (filterOpenConcerns) f = f.filter(isOpenConcern);
    if (searchQuery) {
      var q = searchQuery.toLowerCase();
      var hay = (_feed && _feed.hay) || {};
      f = f.filter(function (o) {
        var k = o.studentId + '|' + o.id;
        return (hay[k] != null ? hay[k] : (hay[k] = searchText(o))).indexOf(q) >= 0;
      });
    }
    return f;
  }

  /* What a search looks in, lower case, a field to a line (a search holds no
     line break): note, name, tags, context, linked assessment. */
  function searchText(o) {
    var sn = _studentsById[o.studentId] ? displayName(_studentsById[o.studentId]) : '';
    var ctx = o.context && OBS_CONTEXTS[o.context];
    return [o.text || '', sn]
      .concat(
        (o.dims || []).map(function (t) {
          return String(resolveTag(t).label || '');
        }),
        ctx ? ctx.label : '',
        Card.assessmentTitle(activeCourse, o),
      )
      .join('\n')
      .toLowerCase();
  }

  /* ── Feed HTML ──────────────────────────────────────────── */
  /* The observations (less those waiting on Undo, in the order drawn: by
     observed day), the cards' context and the search text, made once per
     change (feedChanged, a re-key, or a new list or length from a sync). */
  var _feed = null;
  function feedChanged() {
    _feed = null;
  }
  function feedData() {
    var byStudent = getQuickObs(activeCourse) || {};
    var n = 0;
    for (var sid in byStudent) n += (byStudent[sid] || []).length;
    if (_feed && _feed.cid === activeCourse && _feed.of === byStudent && _feed.n === n) return _feed;
    var every = getAllQuickObs(activeCourse);
    _feed = {
      cid: activeCourse,
      of: byStudent,
      n: n,
      obs: visibleObs(every).sort(function (a, b) {
        return obDay(b).localeCompare(obDay(a));
      }),
      ctx: Card.context(activeCourse, { hidden: _pendingDeletes, all: every }),
      hay: {},
    };
    return _feed;
  }

  /* An id changed in place (a save landed): drop the kept feed; a card on
     screen, a pending delete and the open editor take the server id. */
  function onRekeyed(e) {
    var d = (e && e.detail) || {};
    if (!_alive || d.cid !== activeCourse) return;
    feedChanged();
    if (d.kind !== 'observation') return;
    var rec = _pendingDeletes[d.from];
    if (rec) ((rec.id = d.to), (_pendingDeletes[d.to] = rec), delete _pendingDeletes[d.from]);
    if (_focusObId === d.from) _focusObId = d.to;
    document.querySelectorAll('#obs-feed [data-obid]').forEach(function (el) {
      if (el.getAttribute('data-obid') === d.from) el.setAttribute('data-obid', d.to);
    });
  }

  // html-safe: day labels go through ObsCard.dayHeaderHtml's esc; ObsCard.html escapes names, text, tags and titles.
  function renderFeedHtml(filtered, data) {
    if (filtered.length === 0) {
      var n = data.obs.length;
      return (
        '<div class="obs-empty"><div class="obs-empty-title">' +
        (n === 0 ? 'No observations yet' : 'No matching observations') +
        '</div><div class="obs-empty-sub">' +
        (n === 0 ? 'Select a student and capture what you notice' : 'Try adjusting your filters') +
        '</div></div>'
      );
    }
    // A day's heading counts all of its observations, shown or not yet.
    var groups = {};
    var shown = {};
    filtered.forEach(function (ob, i) {
      var d = ob.date || ob.created.slice(0, 10);
      (groups[d] = groups[d] || []).push(ob);
      if (i < _feedLimit) (shown[d] = shown[d] || []).push(ob);
    });
    var today = getTodayStr();
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yd = _ymd(y);
    var ctx = data.ctx;
    var out = '';
    Object.keys(shown)
      .sort(function (a, b) {
        return b.localeCompare(a);
      })
      .forEach(function (ds) {
        var lbl =
          ds === today
            ? 'Today'
            : ds === yd
              ? 'Yesterday'
              : Card.dateFormat({ weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(ds + 'T12:00:00'));
        out += '<div class="obs-feed-date-group">' + Card.dayHeaderHtml(lbl, groups[ds].length);
        shown[ds].forEach(function (ob) {
          out += Card.html(ob, ctx, { followUps: true, filters: true });
        });
        out += '</div>';
      });
    if (filtered.length > _feedLimit)
      out +=
        '<div class="obs-feed-more"><span>Showing the newest ' +
        _feedLimit +
        ' of ' +
        filtered.length +
        '.</span> <button type="button" class="btn btn-ghost" data-action="obsShowMore">Show More</button></div>';
    return out;
  }

  /* ── The panel's tags, types and contexts ──────────────── */
  function toggleFilter(kind, value) {
    var list = kind === 'type' ? filterSentiment : kind === 'context' ? filterContext : filterTags;
    var idx = list.indexOf(value);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(value);
    refreshFilterStrip();
    refilter();
  }
  // A chip's ×: that filter goes (the students, the tags, the types, the contexts, the date and its range).
  function dropFilter(kind) {
    if (kind === 'date') return setFilterOption('date', filterDate);
    if (kind === 'students') filterStudents = [];
    else if (kind === 'tags') filterTags = [];
    else if (kind === 'types') filterSentiment = [];
    else filterContext = [];
    refreshFilterStrip();
    refilter();
    if (kind === 'students') syncRoster();
  }

  // Clear Filters: the panel's filters go; the search and Open Concerns stay.
  function clearAllFilters() {
    var keep = [searchQuery, filterOpenConcerns];
    resetFilters();
    searchQuery = keep[0];
    filterOpenConcerns = keep[1];
    refreshFilterStrip();
    refilter();
    syncRoster();
  }

  /* One click hides the card and offers Undo for six seconds. The delete
     reaches the data layer only when the toast closes without Undo (it times
     out, another toast replaces it, or the page is left). */
  function deleteOb(sid, obId) {
    if (!sid || !obId || _pendingDeletes[obId]) return;
    var cid = activeCourse;
    var rec = (_pendingDeletes[obId] = { cid: cid, sid: sid, id: obId });
    refreshFeedAndCount();
    var settled = false;
    showUndoToast(
      'Observation deleted',
      function () {
        if (settled) return;
        settled = true;
        delete _pendingDeletes[rec.id];
        if (_alive && activeCourse === cid) refreshFeedAndCount();
      },
      function () {
        if (settled) return;
        settled = true;
        delete _pendingDeletes[rec.id];
        deleteQuickOb(cid, sid, rec.id);
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

  function _focusFindOb(sid, obId) {
    var ob = ((getQuickObs(activeCourse) || {})[sid] || []).find(function (o) {
      return o.id === obId;
    });
    // Raw entries carry no studentId (the map key does): attach it for the card.
    return ob ? Object.assign({ studentId: sid }, ob) : null;
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
    var host = _focusHost;
    closeFocus();
    if (host && host.onSaved) host.onSaved();
  }

  function focusDelete() {
    var sid = _focusSid;
    var obId = _focusObId;
    var host = _focusHost;
    var cid = activeCourse;
    closeFocus();
    // One with follow-ups asks first. Another page's card deletes the way
    // that page does (with its Undo).
    ObsFollowUps.confirmDelete(cid, obId, function () {
      if (host && host.onDelete) host.onDelete(obId);
      else deleteOb(sid, obId);
    });
  }

  // html-safe: tag labels and keys are escaped; colours come from obsTagColor.
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

  // html-safe: tags from _renderFocusTagsHtml; ObsCard.contextMenuHtml uses fixed OBS_CONTEXTS keys and escaped labels; obsPrivateLabelHtml is constant markup.
  function _focusRowHtml() {
    return (
      '<span class="obs-row-label">Tags</span>' +
      _renderFocusTagsHtml() +
      '<span class="obs-row-sep" aria-hidden="true"></span>' +
      '<span class="obs-row-label" id="focus-ctx-label">Context</span>' +
      (_focusFromReflection()
        ? // An observation from a reflection keeps its context for good
          // (updateQuickOb refuses to change it): no menu, just the label.
          obsPrivateLabelHtml(_focusOriginal)
        : Card.contextMenuHtml({
            id: 'focus-ctx',
            value: _focusDraft.context,
            open: _focusCtxOpen,
            toggleAction: 'focusToggleCtxMenu',
            pickAction: 'focusPickContext',
            labelledBy: 'focus-ctx-label',
          }))
    );
  }

  function _focusFromReflection() {
    return isReflectionObservation(_focusOriginal);
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

  // html-safe: the name, with-text, notice and note text are escaped; the type band uses fixed OBS_SENTIMENTS keys.
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
      ObsFollowUps.panelHtml(activeCourse, ob) +
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

  /* One fade in and out, by CSS (observations.css, "FOCUS CARD"). It used
     to be drawn by Motion One, imported from esm.sh on the first open: the
     card showed at once, then faded in again from nothing when the library
     arrived, a double flash on the first edit of a visit. */
  function _animateFocusOpen() {
    if (!_focusBackdropEl || !_focusEl) return;
    // Take the closed look first, so .open fades from it.
    void _focusBackdropEl.offsetWidth;
    _focusBackdropEl.classList.add('open');
    _focusEl.classList.add('open');
  }

  function _animateFocusClose(done) {
    var bd = _focusBackdropEl;
    var card = _focusEl;
    if (!bd || !card) {
      done();
      return;
    }
    bd.classList.remove('open');
    card.classList.remove('open');
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      done();
    };
    card.addEventListener('transitionend', function (e) {
      if (e.target === card && e.propertyName === 'opacity') finish();
    });
    setTimeout(finish, 200);
  }

  /* The same edit window over another page (the student page's
     Observations tab), while this page isn't open. Its listeners sit on the
     window itself, and the host hears about a save or a delete:
       host: { onSaved(), onDelete(obId) } */
  var _focusHost = null;
  function openEditor(cid, sid, obId, host) {
    if (_alive || _focusBackdropEl) return false;
    activeCourse = cid;
    openFocus(sid, obId);
    if (!_focusBackdropEl) return false;
    _focusHost = host || {};
    var bd = _focusBackdropEl;
    bd.addEventListener('click', _handleClick);
    bd.addEventListener('mousedown', _handleMousedown);
    bd.addEventListener('input', _handleInput);
    bd.addEventListener('keydown', _handleKeydown);
    return true;
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

    // Caret at the end now, not a frame later: a late move would collapse a
    // selection made in the meantime, so typing over it appended instead.
    var ta = document.getElementById('focus-textarea');
    if (ta) {
      ta.focus();
      var len = ta.value.length;
      try {
        ta.setSelectionRange(len, len);
      } catch (e) {}
    }
    requestAnimationFrame(_autosizeFocusTextarea);
  }

  /* Closes without writing; Save writes first. */
  function closeFocus() {
    if (!_focusBackdropEl) return;
    _focusTagPopoverOpen = false;
    _focusCtxOpen = false;
    _focusHost = null;
    if (_alive) refreshFeedAndCount();
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
    if (!_focusDraft || _focusFromReflection()) return;
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
    if (!_focusDraft || _focusFromReflection()) return;
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
  }

  function _handleInput(e) {
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

    var handlers = {
      toggleNotObserved: toggleNotObserved,
      obsShowMore: showMore,
      deleteOb: function () {
        ObsFollowUps.confirmDelete(activeCourse, el.dataset.obid, function () {
          deleteOb(el.dataset.sid, el.dataset.obid);
        });
      },
      popoverToggle: function () {
        toggleFocusDim(el.dataset.value);
      },
      openFocus: function () {
        openFocus(el.dataset.sid, el.dataset.obid);
      },
      closeFocus: closeFocus,
      focusToggleSentiment: function () {
        focusToggleSentiment(el.dataset.value);
      },
      focusToggleCtxMenu: focusToggleCtxMenu,
      focusPickContext: function () {
        focusPickContext(el.dataset.value);
      },
      focusSave: focusSave,
      focusDelete: focusDelete,
      focusRemoveDim: function () {
        focusRemoveDim(el.dataset.value);
      },
      toggleFocusTagPopover: toggleFocusTagPopover,
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
  }

  /* ── init / destroy ─────────────────────────────────────── */
  function init(params) {
    activeCourse = params.course || getActiveCourse();
    setActiveCourse(activeCourse);
    resetFilters();
    // The sticky-note view is gone (2026-10-19); drop its saved setting.
    try {
      localStorage.removeItem('fv-obs-view');
    } catch (e) {}
    _alive = true;

    document.getElementById('sidebar-mount').style.display = '';
    document.getElementById('page-layout').classList.remove('sidebar-hidden');
    if (typeof setActiveTerm === 'function') setActiveTerm(activeCourse, null);
    SidebarKeep.draw(renderSidebar(activeCourse));
    initSidebarToggle();

    window._pageSwitchCourse = switchCourse;

    refreshStudentCache();

    // A link with ?student= opens this page with that student picked.
    var preset = [];
    if (params.student && _studentsById[params.student]) {
      preset = [params.student];
      filterStudents = [params.student];
    }
    makeCapture(preset);
    // A link with ?ob= opens that card with its follow-ups.
    if (params.ob) ObsFollowUps.reveal(params.ob);

    _addDocListener('click', _handleClick);
    _addDocListener('mousedown', _handleMousedown);
    _addDocListener('input', _handleInput);
    _addDocListener('keydown', _handleKeydown);
    _addDocListener('fv:id-rekeyed', onRekeyed);
    // A Resolved follow-up closes a Concern: the Open Concerns count follows.
    _addDocListener('fv:follow-ups-changed', syncConcernBtn);
    ObsToolbar.start({
      search: function (text) {
        searchQuery = text;
        refilter();
      },
      toggle: toggleFilter,
      pick: setFilterOption,
      range: setCustomDate,
      drop: dropFilter,
      clear: clearAllFilters,
      concerns: toggleOpenConcerns,
    });

    render();
    syncRoster();
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
    ObsRoster.stop();
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    ObsToolbar.stop();
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
    if (typeof clearLongFormAuthContext === 'function') clearLongFormAuthContext('observation-capture');
    delete window._pageSwitchCourse;
  }

  /* ── Public API ─────────────────────────────────────────── */
  return {
    init: init,
    destroy: destroy,
    render: render,
    openEditor: openEditor,
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
