// @ts-check
/* cm-edit-actions.js — Class Settings: edit actions. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmEditActions = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var CM_METHOD_TEXT,
    _cmEndedTerm,
    _cmMethodRule,
    _cmRefreshSidebar,
    _cmTermState,
    renderClassManager,
    state,
    _addDocListener,
    _cmRenderWithScroll,
    _currentId;
  function configure(h) {
    if ('CM_METHOD_TEXT' in h) CM_METHOD_TEXT = h.CM_METHOD_TEXT;
    if ('_cmEndedTerm' in h) _cmEndedTerm = h._cmEndedTerm;
    if ('_cmMethodRule' in h) _cmMethodRule = h._cmMethodRule;
    if ('_cmRefreshSidebar' in h) _cmRefreshSidebar = h._cmRefreshSidebar;
    if ('_cmTermState' in h) _cmTermState = h._cmTermState;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_addDocListener' in h) _addDocListener = h._addDocListener;
    if ('_cmRenderWithScroll' in h) _cmRenderWithScroll = h._cmRenderWithScroll;
    if ('_currentId' in h) _currentId = h._currentId;
  }

  /* ── CM Edit Actions ────────────────────────────────────── */
  function cmUpdateField(field, value, inputEl) {
    if (!state.cmSelectedCourse) return;
    if (field === 'name' && !value.trim()) {
      if (inputEl) {
        inputEl.style.border = '2px solid var(--score-1)';
        inputEl.placeholder = 'Class name is required';
        inputEl.oninput = function () {
          this.style.border = '';
        };
        inputEl.focus();
      }
      return;
    }
    // A cleared optional field (Late Work Policy) arrives as null.
    var clean = field === 'block' ? normalizeCourseBlock(value) : value == null ? null : String(value).trim();
    updateCourse(state.cmSelectedCourse, { [field]: clean });
    if (field === 'name' || field === 'block') _cmRefreshSidebar();
  }

  // Default grading_system by grade level: 8–9 → proficiency, 10–12 → letter.
  // Every new class defaults to Mean (_cmDefaultCalcMethod).
  // Falls back to proficiency when the grade isn't a number we recognize.
  function _cmDefaultGradingSystem(course) {
    var gl = parseInt((course && course.gradeLevel) || '', 10);
    if (!isNaN(gl) && gl >= 10 && gl <= 12) return 'letter';
    return 'proficiency';
  }

  // A new class always calculates competencies by Mean.
  function _cmDefaultCalcMethod() {
    return 'average';
  }

  // Default Rubric Levels: Emerging First where the class grades by
  // proficiency (grades 8–9), Extending First otherwise.
  // Grades 10–12 report a %, so their Counts As starts on the BC Letter
  // Bands (Colin, 2026-10-29); other grades keep the default scale (null).
  function _cmDefaultGradingScale(gradeLevel) {
    if (_cmDefaultGradingSystem({ gradeLevel: gradeLevel }) !== 'letter') return null;
    return {
      boundaries: structuredClone(DEFAULT_GRADING_SCALE.boundaries),
      percents: Object.assign({}, BC_LETTER_BAND_PERCENTS),
      labels: null,
    };
  }

  function _cmDefaultLevelOrder(gradeLevel) {
    return _cmDefaultGradingSystem({ gradeLevel: gradeLevel }) === 'proficiency' ? 'asc' : 'desc';
  }

  // Calculation-method descriptions (verbatim from Project Phoneox React build
  // `src/components/courses/grading-config.tsx:100-115`). Keep these two copies
  // in sync — changes to one should land in the other.
  function _cmCalcMethodDescription(method) {
    // Mean / Median copy matches Phoneox src/components/courses/grading-config.tsx:107-109
    // (Phoneox labels the value 'mean'; we persist 'average' to match the backend CHECK
    // constraint — same concept, different internal string).
    var map = {
      mostRecent:
        'Only the latest score counts. If a student scores 2, then 3, then 4, their grade is 4. Earlier scores are ignored entirely. It answers "where is the student now?" rather than "how did they do on average?"',
      highest:
        'Only the best score counts. If a student scores 2, then 4, then 3, their grade is 4. This rewards students who demonstrate mastery at any point and removes the penalty for early struggles while learning new material.',
      average:
        'All scores are added up and divided equally. If a student scores 2, 3, and 4, their grade is 3. This is the traditional average \u2014 every assignment carries the same weight, so a low early score pulls the final grade down even after improvement.',
      median:
        'Scores are sorted and the middle value is used. If a student scores 1, 3, and 4, their grade is 3 (not 2.7 like the mean). This protects against one unusually low or high score skewing the result.',
      mode: 'The most repeated score is used. If a student scores 3, 3, 4, and 2, their grade is 3 because it appeared most often. This reflects the level a student performs at most consistently, filtering out one-off results.',
      decayingAvg:
        'A weighted average where recent scores count more than older ones. If a student scores 2, then 3, then 4, the grade will be closer to 4 than a simple average. Use the slider below to control how much more recent work matters.',
    };
    return esc(map[method] || map.mostRecent);
  }

  // Grading-system descriptions — proficiency + letter copy adapted from
  // Project Phoneox (grading-config.tsx:58-62). 'both' is original (FullVision
  // v2-only; INSTRUCTIONS.md:15 states it runs both pipelines side by side).
  function _cmGradingSystemDescription(gs) {
    var map = {
      proficiency:
        'Students are scored on the BC proficiency scale: 1 Emerging, 2 Developing, 3 Proficient, 4 Extending.',
      letter:
        'A letter grade and % on the BC scale: A, B, C+, C and C\u2013. Under 50% shows IE (Insufficient Evidence) until the course ends, then F.',
      both: 'Proficiency day to day, and a letter grade and % on reports. Useful in grades 10\u201312, where report cards need a letter and %.',
    };
    return esc(map[gs] || map.proficiency);
  }

  function _cmCatState(cid) {
    if (!state._cmCategoryState[cid]) state._cmCategoryState[cid] = { rows: [], loaded: false, loading: null };
    return state._cmCategoryState[cid];
  }

  /* The list as the server gave it or last took it: what this form was
     opened with. Before anything is saved over the class's whole list, the
     server's list is read again and compared with this (saveCategoriesNow
     in shared/data.js). A copy, since the rows on screen change as the
     teacher types. `inOrder`: the rows were just saved in this order, so
     their place in the list is their display order; otherwise each keeps
     the display order the server gave it (two rows can share one). */
  function _cmCatSnapshot(rows, inOrder) {
    return (rows || []).map(function (r, i) {
      var row = {
        id: r.id || null,
        name: r.name || '',
        weight: Number(r.weight) || 0,
        display_order: inOrder || r.display_order == null ? i : Number(r.display_order) || 0,
        calc_mode: categoryCalcMode(r),
      };
      // A new row in a list sent with no answer: which row it is, so the id
      // the server gave it can be found again after the tab is closed.
      if (!row.id && r.key) row.key = r.key;
      return row;
    });
  }
  function _cmCatRemember(st, rows, inOrder) {
    st.opened = _cmCatSnapshot(rows, inOrder);
  }
  // Rows for the form from a list in cache shape (the server's, as read).
  function _cmCatRowsFrom(list) {
    return (list || []).map(function (r, i) {
      var order = r.displayOrder != null ? r.displayOrder : r.display_order;
      return {
        id: r.id || null,
        name: r.name || '',
        weight: Number(r.weight) || 0,
        display_order: order != null ? Number(order) || 0 : i,
        calc_mode: categoryCalcMode(r),
      };
    });
  }

  /* The one line shown above the categories when a save was not made, or
     when something was kept for the teacher. With `typed`, what the teacher
     had typed is listed under it to copy from. */
  var CM_CAT_NOTICES = {
    changed: 'The categories changed on another device, so nothing was saved. These are the current ones.',
    changedTyped:
      'The categories changed on another device, so nothing was saved. These are the current ones. What you typed is below.',
    offline:
      'Categories need a connection to save. Your changes are kept on this computer. Save again when you are online.',
    offlineOrder: 'Categories need a connection to save. Nothing was saved. Try again when you are online.',
    kept: 'Your unsaved category changes were kept on this computer. Save Categories to send them.',
    // After Discard My Changes: a save whose answer never came had landed.
    landed: 'Your earlier save went through after all. These are the saved categories.',
    // Online, but other changes from this computer had not gone yet.
    waiting:
      'Other changes from this computer are still being sent, so nothing was saved. Your changes are kept on this computer. Save again in a moment.',
    waitingOrder: 'Other changes from this computer are still being sent, so nothing was saved. Try again in a moment.',
    // The same, while the sign-in has expired, or another tab holds the outbox.
    waitingSignIn:
      'Your sign-in has expired, so other changes from this computer are waiting and nothing was saved. Your changes are kept on this computer. Save again after you sign in.',
    waitingOrderSignIn:
      'Your sign-in has expired, so other changes from this computer are waiting and nothing was saved. Try again after you sign in.',
    waitingOtherTab:
      'Other changes from this computer are waiting for another FullVision tab to send them, so nothing was saved. Your changes are kept on this computer. Save again once that tab has sent them.',
    waitingOrderOtherTab:
      'Other changes from this computer are waiting for another FullVision tab to send them, so nothing was saved. Try again once that tab has sent them.',
  };
  var CM_CAT_WAITING_ON = { signIn: 'SignIn', otherTab: 'OtherTab' };
  var CM_CAT_REST = ' Everything else was copied.';
  function _cmCatNoticeText(st) {
    var n = st.notice;
    if (!n) return null;
    if (n.kind === 'copyChanged') {
      return (
        'The categories were not copied from ' +
        (n.from || 'the other class') +
        ': they changed on another device first. These are the current ones.' +
        (n.rest ? CM_CAT_REST : '')
      );
    }
    if (n.kind === 'copyOffline') {
      return (
        'The categories were not copied from ' +
        (n.from || 'the other class') +
        ': there was no connection.' +
        (n.rest ? CM_CAT_REST : '')
      );
    }
    if (n.kind === 'changed') return st.typed && st.typed.length ? CM_CAT_NOTICES.changedTyped : CM_CAT_NOTICES.changed;
    return CM_CAT_NOTICES[n.kind + (CM_CAT_WAITING_ON[n.on] || '')] || null;
  }
  // The button beside the line: what it does, and its label.
  function _cmCatNoticeAction(st) {
    var n = st.notice;
    if (!n) return null;
    if (n.kind === 'offline' || n.kind === 'kept' || n.kind === 'waiting') return 'Discard My Changes';
    if (n.kind === 'offlineOrder' || n.kind === 'waitingOrder') return null;
    return 'Dismiss';
  }
  var CM_CAT_MODE_LABELS = { points: 'Total Points', percent: 'Average of Percentages' };
  function _cmCatTypedLine(r) {
    return (r.name || 'Unnamed') + ' · ' + (Number(r.weight) || 0) + '% · ' + CM_CAT_MODE_LABELS[categoryCalcMode(r)];
  }
  // html-safe: the line and each typed row through esc; the label is a constant
  function _cmCatNoticeHtml(st) {
    var text = _cmCatNoticeText(st);
    if (!text) return '';
    var action = _cmCatNoticeAction(st);
    var typed = st.notice.kind === 'changed' && st.typed && st.typed.length ? st.typed : null;
    return (
      '<div class="cm-cat-notice" role="status">' +
      '<div class="cm-cat-notice-text">' +
      esc(text) +
      '</div>' +
      (typed
        ? '<div class="cm-cat-typed"><div class="cm-cat-typed-label">What You Typed</div><ul>' +
          typed
            .map(function (r) {
              return '<li>' + esc(_cmCatTypedLine(r)) + '</li>';
            })
            .join('') +
          '</ul></div>'
        : '') +
      (action ? '<button class="cm-add-link" data-action="cmCatNoticeDone">' + action + '</button>' : '') +
      '</div>'
    );
  }

  /* What is kept on this device for the class's categories while a save
     has not been made (shared/data.js getCategoryDraft): the edits that
     could not be saved, or what was typed when the list turned out to have
     changed. Written when a save is refused and after every edit from
     then on; removed when a save is made or the teacher discards it. */
  function _cmCatKeep(cid) {
    var st = _cmCatState(cid);
    if (typeof saveCategoryDraft !== 'function') return;
    var draft = {};
    if (st.keeping) {
      draft.rows = _cmCatSnapshot(st.rows, true);
      draft.opened = st.opened || [];
      if (st.tried) draft.tried = st.tried.snap;
    }
    if (st.typed && st.typed.length) draft.typed = st.typed;
    if (st.notice && (st.notice.kind === 'copyChanged' || st.notice.kind === 'copyOffline')) {
      draft.note = {
        why: st.notice.kind === 'copyChanged' ? 'changed' : 'offline',
        from: st.notice.from,
        rest: st.notice.rest,
      };
    }
    saveCategoryDraft(cid, draft);
  }
  // After an edit: the kept copy follows what is on screen.
  function _cmCatEdited(cid) {
    var st = _cmCatState(cid);
    st.dirty = true;
    if (st.keeping) _cmCatKeep(cid);
  }
  /* The form has just been filled with the class's list (`opened` set).
     Lay over it what this device kept from before. */
  function _cmCatApplyKept(cid, st) {
    var draft = typeof getCategoryDraft === 'function' ? getCategoryDraft(cid) : null;
    if (!draft) return;
    if (draft.note) {
      st.notice = {
        kind: draft.note.why === 'changed' ? 'copyChanged' : 'copyOffline',
        from: draft.note.from,
        rest: !!draft.note.rest,
      };
    }
    if (Array.isArray(draft.typed) && draft.typed.length) {
      st.typed = draft.typed;
      st.notice = { kind: 'changed' };
    }
    if (!Array.isArray(draft.rows)) return;
    var same = function (a, b) {
      return typeof _categoryListsMatch === 'function' && _categoryListsMatch(a, b);
    };
    if (same(st.opened, draft.rows)) {
      // The save had landed after all (its answer never came): nothing is unsaved.
      saveCategoryDraft(cid, draft.note ? { note: draft.note } : null);
      return;
    }
    if (Array.isArray(draft.tried) && same(st.opened, draft.tried) && !same(st.opened, draft.opened || [])) {
      // The server holds the list this computer sent and never heard back
      // about: its own save landed, not a change made on another device.
      // What was typed after it is unsaved, made over that list.
      var rows = _cmCatWithLandedIds(draft.rows, draft.tried, st.opened);
      if (same(st.opened, rows)) {
        saveCategoryDraft(cid, draft.note ? { note: draft.note } : null);
        return;
      }
      st.rows = _cmCatRowsFrom(rows);
      st.dirty = true;
      st.keeping = true;
      st.notice = { kind: 'kept' };
      _cmCatKeep(cid);
      return;
    }
    if (same(st.opened, draft.opened || [])) {
      st.rows = _cmCatRowsFrom(draft.rows);
      st.dirty = true;
      st.keeping = true;
      st.notice = { kind: 'kept' };
      return;
    }
    // The list changed on another device while the edits waited here.
    st.typed = draft.rows;
    st.keeping = false;
    st.notice = { kind: 'changed' };
    _cmCatKeep(cid);
  }
  /* Kept rows typed over a list that was sent with no answer and then
     found on the server (`landed`, in its order): a new row of that list
     takes the id the server gave it, found by its key. */
  function _cmCatWithLandedIds(rows, tried, landed) {
    var byOrder = function (list) {
      return (list || [])
        .map(function (r, i) {
          return { r: r, i: i };
        })
        .sort(function (a, b) {
          return (Number(a.r.display_order) || 0) - (Number(b.r.display_order) || 0) || a.i - b.i;
        })
        .map(function (x) {
          return x.r;
        });
    };
    var sent = byOrder(tried);
    var there = byOrder(landed);
    var idOf = {};
    sent.forEach(function (r, i) {
      if (!r.id && r.key && there[i] && there[i].id) idOf[r.key] = there[i].id;
    });
    return (rows || []).map(function (r) {
      if (r.id || !r.key || !idOf[r.key]) return r;
      var row = Object.assign({}, r, { id: idOf[r.key] });
      delete row.key;
      return row;
    });
  }
  /* The button beside the line. Discard My Changes puts the form back to
     the class's list as the server has it; Dismiss takes the line away. */
  function cmCatNoticeDone() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var st = _cmCatState(cid);
    var discard =
      st.notice && (st.notice.kind === 'offline' || st.notice.kind === 'kept' || st.notice.kind === 'waiting');
    if (typeof saveCategoryDraft === 'function') saveCategoryDraft(cid, null);
    if (discard) {
      // Back to the list the changes were made over: the server's, as this
      // form last had it. The next save checks it again in any case.
      st.rows = _cmCatRowsFrom(st.opened || []).sort(function (a, b) {
        return a.display_order - b.display_order;
      });
      st.dirty = false;
      st.keeping = false;
      st.moving = null;
      // st.tried stays: a list sent with no answer may still be what the
      // server holds, and the next save must know it for this computer's own.
    }
    st.notice = null;
    st.typed = null;
    renderClassManager();
    // A save's answer never came: the opened list may not be the server's
    // any more. The form shows what the server holds, read now, or once it
    // can be read (_cmCatFollowServer).
    if (discard && st.tried) _cmCatFollowServer(cid);
  }

  /* After Discard My Changes with a save whose answer never came: read the
     server's list and show it. If it is the list that save sent, the save
     had landed ('landed'); if it is neither that nor the opened list, it
     changed on another device ('changed'). With no connection, or with new
     edits typed meanwhile, it waits for the next time Class Settings draws
     the categories (st.followServer). */
  function _cmCatFollowServer(cid) {
    var st = _cmCatState(cid);
    st.followServer = false;
    if (!st.tried || typeof _readServerCategories !== 'function') return Promise.resolve();
    if (typeof _isOffline === 'function' && _isOffline()) {
      st.followServer = true;
      return Promise.resolve();
    }
    var same = function (a, b) {
      return typeof _categoryListsMatch === 'function' && _categoryListsMatch(a, b);
    };
    return _cmCatInTurn(cid, function () {
      if (!st.tried) return;
      var tried = st.tried.snap;
      return Promise.resolve(_readServerCategories(cid)).then(function (rows) {
        if (!rows || st.dirty || !st.tried) {
          if (st.tried) st.followServer = true;
          return;
        }
        st.tried = null;
        if (same(rows, st.opened || [])) return; // it never landed: the form is right
        st.rows = _cmCatRowsFrom(rows);
        _cmCatRemember(st, st.rows);
        st.typed = null;
        st.notice = { kind: same(rows, tried) ? 'landed' : 'changed' };
        _cmMirrorCategoriesToCache(cid);
        _cmCatRedraw(cid);
      });
    });
  }

  /* A redraw after something the category code waited for (a read, a
     save's or a drag's answer, a copy). Only while Class Settings is still
     open on that class: drawn after the teacher left, it would put Class
     Settings back over the page they went to, or show this class's line on
     another class. The state is updated either way, so the class shows the
     right list and line when it is next opened. */
  function _cmCatRedraw(cid) {
    if (state.classManagerOpen && state.cmMode === 'edit' && state.cmSelectedCourse === cid) renderClassManager();
  }

  /* One save of the list at a time, in the order asked: each one's check
     reads the list the one before it left. */
  function _cmCatInTurn(cid, fn) {
    var st = _cmCatState(cid);
    var next = Promise.resolve(st.saving).then(fn, fn);
    st.saving = next.catch(function (e) {
      console.warn('Category save failed:', e);
    });
    return st.saving;
  }

  // Push the class-manager's private category state into the shared
  // _cache.categories that getCategories / getCategoryById / page-assignments /
  // page-gradebook / shared/calc.js all read from. Without this, a category
  // added or deleted in the same session is invisible to those readers
  // until the next sign-in (which re-hydrates via get_gradebook).
  // The class manager is the one writer for its category edits; this only
  // brings the cache in line with what it already sent.
  function _cmMirrorCategoriesToCache(cid) {
    if (!cid || typeof adoptCategoriesFromServer !== 'function') return;
    var st = _cmCatState(cid);
    var camelRows = (st.rows || []).map(function (r) {
      return {
        id: r.id,
        name: r.name || '',
        weight: Number(r.weight) || 0,
        displayOrder: Number(r.display_order) || 0,
        calcMode: categoryCalcMode(r),
      };
    });
    adoptCategoriesFromServer(cid, camelRows);
  }

  // Without a server (Demo Mode) the class's categories are the cached ones.
  function _cmCatsLocalOnly() {
    return !window.v2 || !window.v2.listCategories || !_useSupabase;
  }
  function _cmCatFillLocal(cid, st) {
    st.loaded = true;
    st.rows = (getCategories(cid) || []).map(function (c, i) {
      return {
        id: c.id,
        name: c.name || '',
        weight: Number(c.weight) || 0,
        display_order: c.displayOrder != null ? Number(c.displayOrder) : i,
        calc_mode: categoryCalcMode(c),
      };
    });
    _cmCatRemember(st, st.rows);
    _cmCatApplyKept(cid, st);
  }

  function _cmLoadCategories(cid) {
    if (!cid) return;
    var st = _cmCatState(cid);
    if (st.loaded || st.loading) return;
    if (_cmCatsLocalOnly()) {
      _cmCatFillLocal(cid, st);
      if (st.rows.length) _cmCatRedraw(cid);
      return;
    }
    st.loading = window.v2
      .listCategories(cid)
      .then(function (res) {
        st.loading = null;
        st.loaded = true;
        if (res && !res.error && Array.isArray(res.data)) {
          st.rows = res.data
            .map(function (r) {
              return {
                id: r.id,
                name: r.name || '',
                weight: Number(r.weight) || 0,
                display_order: Number(r.display_order) || 0,
                calc_mode: categoryCalcMode(r),
              };
            })
            .sort(function (a, b) {
              return a.display_order - b.display_order;
            });
          _cmCatRemember(st, st.rows);
          _cmMirrorCategoriesToCache(cid);
          _cmCatApplyKept(cid, st);
          _cmCatRedraw(cid);
        }
      })
      .catch(function () {
        st.loading = null;
        st.loaded = true;
      });
  }

  function _cmCatSum(cid) {
    var rows = _cmCatState(cid).rows;
    var s = 0;
    for (var i = 0; i < rows.length; i++) s += Number(rows[i].weight) || 0;
    return s;
  }

  // Weights must total exactly 100, as in Teams (a class with no categories
  // counts all work by total points). Edits stay on this screen until Save
  // sends the whole list at once: going from 50/50 to 60/40 one row at a time
  // would pass through 110 or 90, which the server refuses.
  function _cmCatSumOk(cid) {
    var rows = _cmCatState(cid).rows;
    return rows.length === 0 || Math.abs(_cmCatSum(cid) - 100) < 1e-9;
  }

  function _cmCatNamesOk(cid) {
    return _cmCatState(cid).rows.every(function (r) {
      return (r.name || '').trim() !== '';
    });
  }

  function _cmCatCanSave(cid) {
    return !!_cmCatState(cid).dirty && _cmCatSumOk(cid) && _cmCatNamesOk(cid);
  }

  function _cmCatSumClass(cid) {
    return _cmCatSumOk(cid) ? 'cm-cat-sum' : 'cm-cat-sum cm-cat-sum-over';
  }

  function _cmCatSumHtml(cid) {
    var html = 'Total: <strong>' + _cmCatSum(cid) + '</strong> / 100%';
    if (!_cmCatSumOk(cid)) html += ' <span class="cm-cat-sum-warn">(weights must total 100)</span>';
    else if (!_cmCatNamesOk(cid)) html += ' <span class="cm-cat-sum-warn">(every category needs a name)</span>';
    return html;
  }

  // Update the total and the Save button without re-rendering, so typing
  // keeps focus.
  function _cmCatRefreshFooter(cid) {
    var sumEl = document.getElementById('cm-cat-sum-' + cid);
    if (sumEl) {
      sumEl.className = _cmCatSumClass(cid);
      sumEl.innerHTML = _cmCatSumHtml(cid);
    }
    var saveEl = document.getElementById('cm-cat-save-' + cid);
    if (saveEl) /** @type {any} */ (saveEl).disabled = !_cmCatCanSave(cid);
  }

  /* On every draw, any tab: cached categories are read now and the server's
     asked for (its answer redraws). Discarded with a save's answer outstanding
     and no connection then: the server's list is read now. */
  function _cmCatPrepare(cid, st) {
    if (!cid) return;
    if (!st.loaded && !st.loading && _cmCatsLocalOnly()) _cmCatFillLocal(cid, st);
    if (!st.loaded && !st.loading)
      setTimeout(function () {
        _cmLoadCategories(cid);
      }, 0);
    if (st.loaded && st.followServer && !st.dirty) {
      st.followServer = false;
      setTimeout(function () {
        _cmCatFollowServer(cid);
      }, 0);
    }
  }

  function _cmRenderCategoriesField(cid) {
    if (!cid) return '';
    var st = _cmCatState(cid);
    _cmCatPrepare(cid, st);
    var rows = st.rows || [];
    var html =
      '<div class="cm-field cm-cat-field">' +
      '<label class="cm-label">Categories</label>' +
      _cmCatNoticeHtml(st) +
      '<div class="cm-cat-list">';
    if (rows.length === 0) {
      html +=
        '<div class="cm-hint" style="padding:6px 0">No categories yet. Letter grades use total points earned out of total points possible. Add categories to weight groups of assessments.</div>';
    }
    rows.forEach(function (row, idx) {
      if (st.moving && st.moving.idx === idx) {
        html += _cmRenderCatMove(cid, row, idx);
        return;
      }
      html +=
        '<div class="cm-cat-row"' +
        (row.id ? ' draggable="true" data-cat-drag="' + row.id + '"' : '') +
        '>' +
        '<span class="cm-cat-handle" aria-hidden="true">\u22EE\u22EE</span>' +
        '<input class="cm-input cm-cat-name" value="' +
        esc(row.name) +
        '" placeholder="Category name" data-action-input="cmCatNameLive" data-idx="' +
        idx +
        '">' +
        '<input class="cm-input cm-cat-weight" type="number" min="0" max="100" step="1" value="' +
        (row.weight != null ? row.weight : '') +
        '" data-action-input="cmCatWeightLive" data-idx="' +
        idx +
        '" aria-label="Weight percent">' +
        '<span class="cm-cat-pct">%</span>' +
        _cmCatModeSelect(row, idx) +
        '<button class="cm-delete-mini" data-action="cmCatDelete" data-idx="' +
        idx +
        '" title="Delete category" aria-label="Delete category">\u2715</button>' +
        '</div>';
    });
    html +=
      '</div>' +
      (rows.length
        ? '<div class="cm-hint cm-cat-mode-hint">Total Points adds up every assessment’s points, so a rubric with more criteria counts more. Average of Percentages makes each assessment count the same. Factor still counts an assessment more than once.</div>'
        : '') +
      _cmRenderUncategorized(cid) +
      '<div class="cm-cat-footer">' +
      '<button class="cm-add-link" data-action="cmCatAdd">+ Add Category</button>' +
      '<button class="cm-add-link" data-action="cmCatCopyFrom">Copy From Another Class</button>' +
      '<div class="' +
      _cmCatSumClass(cid) +
      '" id="cm-cat-sum-' +
      cid +
      '">' +
      _cmCatSumHtml(cid) +
      '</div>' +
      '<button class="btn btn-primary cm-cat-save" id="cm-cat-save-' +
      cid +
      '" data-action="cmCatSave"' +
      (_cmCatCanSave(cid) ? '' : ' disabled') +
      '>Save Categories</button>' +
      '</div>' +
      '</div>';
    return html;
  }

  function cmCatAdd() {
    if (!state.cmSelectedCourse) return;
    var st = _cmCatState(state.cmSelectedCourse);
    st.rows.push({ id: null, name: '', weight: 0, display_order: st.rows.length });
    _cmCatEdited(state.cmSelectedCourse);
    renderClassManager();
  }

  function cmCatNameLive(idx, value) {
    if (!state.cmSelectedCourse) return;
    var st = _cmCatState(state.cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    row.name = value || '';
    _cmCatEdited(state.cmSelectedCourse);
    _cmCatRefreshFooter(state.cmSelectedCourse);
  }

  /* A category's Calculation: Total Points or Average of Percentages
     (category.calc_mode, docs/DECISIONS.md "Category calculation"). */
  var CM_CAT_MODES = [
    ['points', 'Total Points'],
    ['percent', 'Average of Percentages'],
  ];
  function _cmCatModeSelect(row, idx) {
    var mode = categoryCalcMode(row);
    return (
      '<select class="cm-input cm-cat-mode" data-action-change="cmCatMode" data-idx="' +
      idx +
      '" aria-label="' +
      esc((row.name || 'Category') + ' calculation') +
      '">' +
      CM_CAT_MODES.map(function (m) {
        return '<option value="' + m[0] + '"' + (mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
      }).join('') +
      '</select>'
    );
  }

  function cmCatMode(idx, value) {
    if (!state.cmSelectedCourse) return;
    var st = _cmCatState(state.cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    row.calc_mode = value === 'percent' ? 'percent' : 'points';
    _cmCatEdited(state.cmSelectedCourse);
    _cmCatRefreshFooter(state.cmSelectedCourse);
  }

  function cmCatWeightLive(idx, value) {
    if (!state.cmSelectedCourse) return;
    var st = _cmCatState(state.cmSelectedCourse);
    var row = st.rows[idx];
    if (!row) return;
    var v = parseFloat(value);
    row.weight = isNaN(v) ? 0 : Math.max(0, v);
    _cmCatEdited(state.cmSelectedCourse);
    _cmCatRefreshFooter(state.cmSelectedCourse);
    CmGradingBars.syncWeightBar(state.cmSelectedCourse);
  }

  function _cmAssessmentCategoryId(a) {
    return (a && (a.categoryId || a.category_id)) || '';
  }

  function _cmAssessmentsInCategory(cid, categoryId) {
    return getAssessments(cid).filter(function (a) {
      return _cmAssessmentCategoryId(a) === categoryId;
    });
  }

  // Assessments that count toward no letter grade: no category, or one that
  // no longer exists, in a class that has categories.
  function _cmUncategorizedAssessments(cid) {
    var ids = _cmCatState(cid)
      .rows.filter(function (r) {
        return r.id;
      })
      .map(function (r) {
        return r.id;
      });
    if (ids.length === 0) return [];
    return getAssessments(cid).filter(function (a) {
      return ids.indexOf(_cmAssessmentCategoryId(a)) < 0;
    });
  }

  function _cmCategoryOptions(cid, exceptId) {
    return _cmCatState(cid)
      .rows.filter(function (r) {
        return r.id && r.id !== exceptId;
      })
      .map(function (r) {
        return '<option value="' + r.id + '">' + esc(r.name || 'Unnamed') + '</option>';
      })
      .join('');
  }

  function _cmRenderCatMove(cid, row, idx) {
    var n = _cmAssessmentsInCategory(cid, row.id).length;
    return (
      '<div class="cm-cat-row cm-cat-move">' +
      '<span class="cm-hint">Move ' +
      n +
      (n === 1 ? ' assessment' : ' assessments') +
      ' in ' +
      esc(row.name || 'this category') +
      ' to</span>' +
      '<select class="cm-input" id="cm-cat-move-target" aria-label="Move to category">' +
      _cmCategoryOptions(cid, row.id) +
      '</select>' +
      '<button class="btn btn-ghost" data-action="cmCatMoveCancel">Cancel</button>' +
      '<button class="btn btn-primary" data-action="cmCatMoveDelete" data-idx="' +
      idx +
      '">Move and delete</button>' +
      '</div>'
    );
  }

  function _cmRenderUncategorized(cid) {
    var n = _cmUncategorizedAssessments(cid).length;
    if (n === 0) return '';
    return (
      '<div class="cm-cat-row cm-cat-move">' +
      '<span class="cm-hint">' +
      n +
      (n === 1 ? ' assessment has' : ' assessments have') +
      ' no category, so ' +
      (n === 1 ? 'it doesn\u2019t' : 'they don\u2019t') +
      ' count toward the letter grade. Move to</span>' +
      // Nothing is chosen for the teacher (docs/DECISIONS.md, "A category on
      // every assessment"). This row appears where Save Categories was, so a
      // second click on Save would otherwise move the work to the first one.
      '<select class="cm-input" id="cm-cat-uncat-target" aria-label="Move to category">' +
      '<option value="" selected>Choose a Category</option>' +
      _cmCategoryOptions(cid, null) +
      '</select>' +
      '<button class="btn btn-primary" data-action="cmCatAssignUncategorized">Move</button>' +
      '</div>'
    );
  }

  // Give assessments a category and wait until the server has the change.
  function _cmMoveAssessments(cid, moving, categoryId) {
    var ids = moving.map(function (a) {
      return a.id;
    });
    var arr = getAssessments(cid).map(function (a) {
      if (ids.indexOf(a.id) < 0) return a;
      return Object.assign({}, a, { categoryId: categoryId, category_id: categoryId });
    });
    saveAssessments(cid, arr);
    if (typeof clearProfCache === 'function') clearProfCache();
    var pending = typeof _assessmentSaveQueue !== 'undefined' && _assessmentSaveQueue[cid];
    return Promise.resolve(pending);
  }

  // The row leaves the list; Save deletes it on the server.
  function _cmDeleteCategoryRow(cid, row) {
    var st = _cmCatState(cid);
    var i = st.rows.indexOf(row);
    if (i >= 0) st.rows.splice(i, 1);
    _cmCatEdited(cid);
    renderClassManager();
  }

  // A category whose work would be left with no category is moved first, as
  // Schoology requires. The last category can go: with none, the letter grade
  // counts all work by total points.
  function cmCatDelete(idx) {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var st = _cmCatState(cid);
    var row = st.rows[idx];
    if (!row) return;
    var inUse = row.id ? _cmAssessmentsInCategory(cid, row.id).length : 0;
    var others = st.rows.filter(function (r) {
      return r !== row && r.id;
    });
    if (inUse > 0 && others.length > 0) {
      st.moving = { idx: idx };
      renderClassManager();
      return;
    }
    _cmDeleteCategoryRow(cid, row);
  }

  function cmCatMoveCancel() {
    if (!state.cmSelectedCourse) return;
    _cmCatState(state.cmSelectedCourse).moving = null;
    renderClassManager();
  }

  function cmCatMoveDelete(idx) {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var st = _cmCatState(cid);
    var row = st.rows[idx];
    var target = /** @type {any} */ (document.getElementById('cm-cat-move-target') || {}).value;
    st.moving = null;
    if (!row || !target) {
      renderClassManager();
      return;
    }
    _cmMoveAssessments(cid, _cmAssessmentsInCategory(cid, row.id), target);
    _cmDeleteCategoryRow(cid, row);
  }

  function cmCatAssignUncategorized() {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var sel = document.getElementById('cm-cat-uncat-target');
    var target = /** @type {any} */ (sel || {}).value;
    if (!target) {
      if (sel && typeof sel.focus === 'function') sel.focus();
      return;
    }
    _cmMoveAssessments(cid, _cmUncategorizedAssessments(cid), target);
    renderClassManager();
  }

  // Send the whole list in one call. Work moved out of a deleted category
  // must reach the server first, or the delete is refused.
  function cmCatSave() {
    if (!state.cmSelectedCourse) return Promise.resolve();
    var cid = state.cmSelectedCourse;
    var st = _cmCatState(cid);
    if (!_cmCatCanSave(cid)) {
      if (typeof showSyncToast === 'function' && !_cmCatSumOk(cid))
        showSyncToast('Category weights must total 100% to save.', 'info');
      return Promise.resolve();
    }
    var rows = st.rows.slice();
    rows.forEach(function (r, i) {
      r.name = (r.name || '').trim();
      r.display_order = i;
    });
    // A changed Calculation moves the course % of every term, so with a
    // term already ended the teacher confirms first.
    var savedModes = {};
    (getCategories(cid) || []).forEach(function (c) {
      savedModes[c.id] = categoryCalcMode(c);
    });
    var modeChanged = rows.some(function (r) {
      return r.id && savedModes[r.id] && savedModes[r.id] !== categoryCalcMode(r);
    });
    var ended = modeChanged ? _cmEndedTerm(cid) : null;
    if (ended) {
      showConfirm(
        'Change the Course %?',
        'This changes the course % for every term, including ' +
          (ended.label || 'Term ' + ended.ordinal) +
          ', which has already ended. Report cards printed before today won’t match.',
        'Change',
        'primary',
        function () {
          _cmCatSaveRows(cid, rows);
        },
      );
      return Promise.resolve();
    }
    return _cmCatSaveRows(cid, rows);
  }

  function _cmCatSaveRows(cid, rows) {
    return _cmCatInTurn(cid, function () {
      return _cmCatSaveNow(cid, rows, 0);
    });
  }
  /* The server's list is read, compared with the one this form was opened
     with, and the save sent, in one online moment or not at all
     (saveCategoriesNow in shared/data.js). Nothing is left in the outbox
     to go out later over a change made elsewhere. */
  function _cmCatSaveNow(cid, rows, again) {
    var st = _cmCatState(cid);
    var tried = st.tried ? st.tried.snap : null;
    return Promise.resolve(saveCategoriesNow(cid, rows, st.opened || [], tried)).then(function (res) {
      res = res || { ok: false, why: 'offline' };
      if (res.ok && res.landed) {
        // An earlier try had reached the server; its answer never came.
        var landed = _cmCatRowsFrom(res.rows);
        (st.tried ? st.tried.rows : []).forEach(function (r, i) {
          if (landed[i] && !r.id) r.id = landed[i].id;
        });
        _cmCatRemember(st, landed);
        var same = typeof _categoryListsMatch === 'function' && _categoryListsMatch(landed, _cmCatSnapshot(rows, true));
        st.tried = null;
        if (!same && !again) return _cmCatSaveNow(cid, rows, 1);
        res = {
          ok: true,
          ids: landed.map(function (r) {
            return r.id;
          }),
        };
      }
      if (res.ok) {
        var ids = res.ids || [];
        rows.forEach(function (r, i) {
          // Without a server (Demo Mode) a new row keeps a local id.
          r.id = ids[i] || r.id || uid();
        });
        st.dirty = false;
        st.notice = null;
        st.typed = null;
        st.tried = null;
        st.keeping = false;
        _cmCatRemember(st, rows, true);
        _cmCatKeep(cid);
        _cmMirrorCategoriesToCache(cid);
        _cmCatRedraw(cid);
        return;
      }
      if (res.why === 'changed') {
        // Nothing was saved. The current list shows; what the teacher had
        // typed is kept beside it, on this device too.
        st.typed = _cmCatSnapshot(rows, true);
        st.rows = _cmCatRowsFrom(res.rows);
        _cmCatRemember(st, st.rows);
        st.dirty = false;
        st.moving = null;
        st.tried = null;
        st.keeping = false;
        st.notice = { kind: 'changed' };
        _cmCatKeep(cid);
        _cmMirrorCategoriesToCache(cid);
        _cmCatRedraw(cid);
        return;
      }
      if (res.why === 'refused') {
        if (typeof showSyncToast === 'function')
          showSyncToast('Categories not saved: ' + ((res.error && res.error.message) || 'server error'), 'error');
        return;
      }
      // No connection, or this computer's other changes had not gone:
      // nothing was saved, and what was typed stays, on screen and on this
      // device. Sent with no answer: it may have landed, and the next check
      // knows it for this computer's own if it did.
      if (res.unknown) _cmCatTried(st, rows);
      st.keeping = true;
      st.notice = res.why === 'waiting' ? { kind: 'waiting', on: res.waitingOn || null } : { kind: 'offline' };
      _cmCatKeep(cid);
      _cmCatRedraw(cid);
    });
  }
  /* A list sent whose answer never came. Its new rows get a key, kept with
     them on this device, so the ids the server gave them can be found again
     after the tab is closed (_cmCatWithLandedIds). */
  function _cmCatTried(st, rows) {
    rows.forEach(function (r) {
      if (!r.id && !r.key) r.key = uid();
    });
    st.tried = { rows: rows.slice(), snap: _cmCatSnapshot(rows, true) };
  }

  // Grading setup copied to or from another class (teacher/grading-setup-copy.js).
  // Unsaved category or term edits would be lost under the copy, so they
  // are saved or undone first.
  // grading-setup-copy.js loads the first time this is pressed (router.js _onDemand).
  function cmOpenSetupCopy(opts) {
    window.Router.withScripts('gradingSetupCopy', function () {
      if (!state.cmSelectedCourse || !(/** @type {any} */ (window).GradingSetupCopy)) return;
      var cid = state.cmSelectedCourse;
      if (_cmCatState(cid).dirty || (_cmTermState[cid] && _cmTermState[cid].dirty)) {
        if (typeof showSyncToast === 'function')
          showSyncToast('Save or undo your changes to categories and terms first.', 'info');
        return;
      }
      /** @type {any} */ (window).GradingSetupCopy.openDialog(
        cid,
        Object.assign({}, opts, {
          onDone: function (cids) {
            // A class whose categories were left as they were says so above
            // them when it is next shown here (noteCategoriesNotCopied).
            (cids || []).forEach(function (c) {
              delete state._cmCategoryState[c];
              delete _cmTermState[c];
            });
            _cmCatRedraw(cid);
          },
        }),
      );
    });
  }

  /* A row dragged to a new place. It moves on screen at once. With nothing
     else unsaved, the new order is checked and sent in one online moment
     (reorderCategoriesNow in shared/data.js): the list changed elsewhere,
     the current one shows; no connection, the row goes back where it was;
     sent with no answer, it stays, as a change not yet saved. */
  function _cmCatReorder(cid, fromIdx, toIdx) {
    var st = _cmCatState(cid);
    var before = st.rows.slice();
    var moved = st.rows.splice(fromIdx, 1)[0];
    st.rows.splice(toIdx, 0, moved);
    st.rows.forEach(function (r, i) {
      r.display_order = i;
    });
    // With other changes not yet saved (a row deleted or added here, a
    // weight typed), the new order goes up with Save Categories, which
    // numbers the whole list. reorder_categories numbers only the rows it
    // is sent: sent without a row deleted on screen, it would leave that
    // row tied with another on the server, in an order this form cannot
    // know, and the next save would take it for a change made elsewhere.
    var unsaved =
      st.dirty ||
      st.rows.some(function (r) {
        return !r.id;
      });
    if (unsaved) _cmCatEdited(cid);
    renderClassManager();
    if (unsaved || !window.v2 || !window.v2.reorderCategories) return Promise.resolve();
    var ids = st.rows.map(function (r) {
      return r.id;
    });
    function undo() {
      // Only if the list on screen is still the dragged one.
      if (st.rows.length !== before.length || st.rows.some(r => before.indexOf(r) < 0)) return;
      st.rows = before;
      st.rows.forEach(function (r, i) {
        r.display_order = i;
      });
    }
    return _cmCatInTurn(cid, function () {
      return Promise.resolve(reorderCategoriesNow(cid, ids, st.opened || [])).then(function (res) {
        res = res || { ok: false, why: 'offline' };
        if (res.ok) {
          // Every row was sent, so the server holds them in this order.
          if (!res.local) _cmCatRemember(st, st.rows, true);
          return;
        }
        if (res.why === 'changed') {
          st.rows = _cmCatRowsFrom(res.rows);
          _cmCatRemember(st, st.rows);
          st.dirty = false;
          st.moving = null;
          st.typed = null;
          st.notice = { kind: 'changed' };
          _cmMirrorCategoriesToCache(cid);
        } else if (res.why === 'refused') {
          undo();
        } else if (res.unknown) {
          // Sent, and no answer came: the new order may be on the server or
          // not. The row stays where it was put, as a change not yet saved,
          // kept like any other; the next Save sends it, or finds it landed.
          _cmCatTried(st, st.rows);
          st.dirty = true;
          st.keeping = true;
          st.notice = { kind: 'offline' };
          _cmCatKeep(cid);
        } else {
          // Not sent: the row goes back where it was.
          undo();
          st.notice =
            res.why === 'waiting' ? { kind: 'waitingOrder', on: res.waitingOn || null } : { kind: 'offlineOrder' };
        }
        _cmCatRedraw(cid);
      });
    });
  }

  function _initCmCatDrag() {
    _addDocListener('dragstart', function (e) {
      var row = e.target.closest && e.target.closest('.cm-cat-row[data-cat-drag]');
      if (!row) return;
      state._cmCatDragId = row.dataset.catDrag;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    _addDocListener('dragover', function (e) {
      if (!state._cmCatDragId) return;
      var row = e.target.closest && e.target.closest('.cm-cat-row[data-cat-drag]');
      if (row && row.dataset.catDrag !== state._cmCatDragId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    _addDocListener('drop', function (e) {
      if (!state._cmCatDragId || !state.cmSelectedCourse) return;
      var row = e.target.closest && e.target.closest('.cm-cat-row[data-cat-drag]');
      if (!row) return;
      e.preventDefault();
      var st = _cmCatState(state.cmSelectedCourse);
      var fromIdx = st.rows.findIndex(function (r) {
        return r.id === state._cmCatDragId;
      });
      var toIdx = st.rows.findIndex(function (r) {
        return r.id === row.dataset.catDrag;
      });
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
        state._cmCatDragId = null;
        return;
      }
      state._cmCatDragId = null;
      _cmCatReorder(state.cmSelectedCourse, fromIdx, toIdx);
    });
    _addDocListener('dragend', function () {
      document.querySelectorAll('.cm-cat-row.dragging').forEach(function (el) {
        el.classList.remove('dragging');
      });
      state._cmCatDragId = null;
    });
  }

  function cmSetGradingSystem(val) {
    if (!state.cmSelectedCourse) return;
    updateCourse(state.cmSelectedCourse, { gradingSystem: val });
    renderClassManager();
  }

  // Rubric Levels: the order the class draws the four levels, everywhere
  // (levelOrderFor in shared/constants.js). A new class starts Emerging First
  // in grades 8–9, Extending First in 10–12 (_cmDefaultLevelOrder).
  var CM_LEVEL_ORDERS = [
    { value: 'asc', label: 'Emerging First' },
    { value: 'desc', label: 'Extending First' },
  ];
  function _cmRenderLevelOrderField(cid) {
    var current = levelOrderFor(cid)[0] === 1 ? 'asc' : 'desc';
    return (
      '<div class="cm-field" style="margin-top:14px">' +
      '<label class="cm-label" id="cm-level-order-label">Rubric Levels</label>' +
      '<div class="seg cm-seg" id="cm-level-order" role="radiogroup" aria-labelledby="cm-level-order-label">' +
      CM_LEVEL_ORDERS.map(function (o) {
        var on = o.value === current;
        return (
          '<button type="button" class="seg-btn cm-seg-btn' +
          (on ? ' active' : '') +
          '" role="radio" aria-checked="' +
          on +
          '" data-action="cmSetLevelOrder" data-value="' +
          o.value +
          '">' +
          o.label +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="cm-hint" style="margin-top:6px">Decides the order of the four levels on scoring cards, rubrics, printouts and reports in this class.</div>' +
      '</div>'
    );
  }
  function cmSetLevelOrder(val) {
    if (!state.cmSelectedCourse) return;
    var cc = getCourseConfig(state.cmSelectedCourse);
    cc.levelOrder = val === 'asc' ? 'asc' : 'desc';
    saveCourseConfig(state.cmSelectedCourse, cc);
    renderClassManager();
  }

  function cmSetRoundPercent(val) {
    if (!state.cmSelectedCourse) return;
    var cc = getCourseConfig(state.cmSelectedCourse);
    cc.roundPercent = val === 'whole';
    saveCourseConfig(state.cmSelectedCourse, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
    renderClassManager();
  }

  // A new method moves grades that already exist, so the change says how
  // many students it moves before it is made.
  function cmSetCalcMethod(val) {
    if (!state.cmSelectedCourse || !CM_METHOD_TEXT[val]) return;
    var cid = state.cmSelectedCourse;
    var course = COURSES[cid];
    var current = getCourseConfig(cid).calcMethod || course.calcMethod || 'average';
    if (!CM_METHOD_TEXT[current]) current = 'mostRecent';
    if (val === current) return;
    var preview = previewCalcMethodChange(cid, val);
    if (!preview.changed) return _cmApplyCalcMethod(val);
    showConfirm(
      'Change Calculation Method to ' + CM_METHOD_TEXT[val].label + '?',
      _cmGradeChangeMessage(cid, preview),
      'Change Method',
      'primary',
      function () {
        _cmApplyCalcMethod(val);
      },
    );
  }

  /* What a grading change does to the class, for its confirm. */
  function _cmGradeChangeMessage(cid, preview) {
    var letterOnly = courseGradeMode(cid) === 'letter';
    return (
      'This changes the ' +
      (letterOnly ? 'competency proficiency' : 'overall proficiency') +
      ' for ' +
      preview.changed +
      ' of your ' +
      preview.total +
      ' students.' +
      (preview.example
        ? ' For example, ' +
          preview.example.name +
          ' goes from ' +
          preview.example.before +
          ' to ' +
          preview.example.after +
          '.'
        : '') +
      (letterOnly ? ' It does not change the %.' : '') +
      ' Marks you\u2019ve already copied into MyEd won\u2019t change there.'
    );
  }

  // Like a new method, a new limit moves existing grades, so it says how
  // many students first. The menu shows the saved choice until confirmed.
  function cmSetRecentLimit(val) {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var next = parseInt(val, 10) >= 1 ? parseInt(val, 10) : null;
    if (next === getRecentScoreLimit(cid)) return;
    var course = COURSES[cid];
    var method = getCourseConfig(cid).calcMethod || course.calcMethod || 'average';
    var preview = previewCalcMethodChange(cid, method, undefined, next);
    if (!preview.changed) return _cmApplyRecentLimit(next);
    renderClassManager();
    showConfirm(
      next ? 'Count Only the Most Recent ' + next + ' Scores?' : 'Count All Scores?',
      _cmGradeChangeMessage(cid, preview),
      'Change',
      'primary',
      function () {
        _cmApplyRecentLimit(next);
      },
    );
  }

  // Folders Count as One moves the overall, so like a new method it says
  // how many students first. The switch shows the saved value until confirmed.
  function cmSetFoldersCountAsOne(on) {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    on = !!on;
    if (on === getFoldersCountAsOne(cid)) return;
    var preview = previewFolderCountChange(cid, { on: on });
    if (!preview.changed) return _cmApplyFoldersCountAsOne(on);
    renderClassManager();
    showConfirm(
      on ? 'Count Each Folder as One?' : 'Count Every Competency the Same?',
      _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
      'Change',
      'primary',
      function () {
        _cmApplyFoldersCountAsOne(on);
      },
    );
  }

  var CM_FOLDER_COUNT_SENT = ' Reports already printed or sent and approved comments keep what they say.';

  function _cmApplyFoldersCountAsOne(on) {
    if (!state.cmSelectedCourse) return;
    var cc = getCourseConfig(state.cmSelectedCourse);
    cc.foldersCountAsOne = on;
    saveCourseConfig(state.cmSelectedCourse, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
    renderClassManager();
  }

  // Each Course Counts Equally moves the overall too, so it asks the same way.
  function cmSetCoursesCountEqually(on) {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    on = !!on;
    if (on === getCoursesCountEqually(cid)) return;
    var preview = previewCoursesEqualChange(cid, on);
    if (!preview.changed) return _cmApplyCoursesCountEqually(on);
    renderClassManager();
    showConfirm(
      on ? 'Count Each Course Equally?' : 'Count Courses by Their Competencies?',
      _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
      'Change',
      'primary',
      function () {
        _cmApplyCoursesCountEqually(on);
      },
    );
  }

  function _cmApplyCoursesCountEqually(on) {
    if (!state.cmSelectedCourse) return;
    var cc = getCourseConfig(state.cmSelectedCourse);
    cc.coursesCountEqually = on;
    saveCourseConfig(state.cmSelectedCourse, cc);
    if (typeof clearProfCache === 'function') clearProfCache();
    renderClassManager();
  }

  // One folder's Counts as One, from its header in Competencies.
  function cmSetFolderCountsAsOne(grpId, on) {
    grpId = _currentId('group', grpId);
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    on = !!on;
    var current = getCompetencyGroupById(cid, grpId);
    if (!current || (current.countsAsOne !== false) === on) return;
    var preview = previewFolderCountChange(cid, { groupId: grpId, on: on });
    if (!preview.changed) return _cmApplyFolderCountsAsOne(grpId, on);
    _cmRenderWithScroll();
    showConfirm(
      on ? 'Count ' + current.name + ' as One?' : 'Count Each Competency in ' + current.name + '?',
      _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
      'Change',
      'primary',
      function () {
        _cmApplyFolderCountsAsOne(grpId, on);
      },
    );
  }

  function _cmApplyFolderCountsAsOne(grpId, on) {
    if (!state.cmSelectedCourse) return;
    var cid = state.cmSelectedCourse;
    var map = ensureCustomLearningMap(cid);
    var g = (map.competencyGroups || []).find(function (x) {
      return x.id === grpId;
    });
    if (!g) return;
    g.countsAsOne = on;
    saveLearningMap(cid, map);
    if (typeof clearProfCache === 'function') clearProfCache();
    _cmRenderWithScroll();
  }

  function _cmApplyRecentLimit(n) {
    if (!state.cmSelectedCourse) return;
    var cc = getCourseConfig(state.cmSelectedCourse);
    cc.recentScoreLimit = n;
    saveCourseConfig(state.cmSelectedCourse, cc);
    renderClassManager();
  }

  function _cmApplyCalcMethod(val) {
    if (!state.cmSelectedCourse) return;
    var cc = getCourseConfig(state.cmSelectedCourse);
    cc.calcMethod = val;
    saveCourseConfig(state.cmSelectedCourse, cc);
    updateCourse(state.cmSelectedCourse, { calcMethod: val });
    renderClassManager();
  }

  /* While the slider moves, only its words follow it; letting it go saves
     (cmSaveDecay): a save clears the grade caches and goes to the server. */
  function cmUpdateDecay(val) {
    if (!state.cmSelectedCourse) return;
    /** @type {any} */ (document.getElementById('cm-decay-val')).textContent = val + '%';
    var rule = document.getElementById('cm-method-rule');
    if (rule) rule.textContent = _cmMethodRule('decayingAvg', parseInt(val, 10) / 100);
  }
  function cmSaveDecay(val) {
    if (!state.cmSelectedCourse) return;
    var cc = getCourseConfig(state.cmSelectedCourse);
    cc.decayWeight = parseInt(val, 10) / 100;
    saveCourseConfig(state.cmSelectedCourse, cc);
    updateCourse(state.cmSelectedCourse, { decayWeight: parseInt(val, 10) / 100 });
  }

  return {
    configure: configure,
    CM_FOLDER_COUNT_SENT: CM_FOLDER_COUNT_SENT,
    _cmCalcMethodDescription: _cmCalcMethodDescription,
    _cmCatNoticeAction: _cmCatNoticeAction,
    _cmCatNoticeText: _cmCatNoticeText,
    _cmCatPrepare: _cmCatPrepare,
    _cmCatReorder: _cmCatReorder,
    _cmCatState: _cmCatState,
    _cmCatTypedLine: _cmCatTypedLine,
    _cmDefaultCalcMethod: _cmDefaultCalcMethod,
    _cmDefaultGradingScale: _cmDefaultGradingScale,
    _cmDefaultGradingSystem: _cmDefaultGradingSystem,
    _cmDefaultLevelOrder: _cmDefaultLevelOrder,
    _cmGradeChangeMessage: _cmGradeChangeMessage,
    _cmGradingSystemDescription: _cmGradingSystemDescription,
    _cmRenderCategoriesField: _cmRenderCategoriesField,
    _cmRenderLevelOrderField: _cmRenderLevelOrderField,
    _initCmCatDrag: _initCmCatDrag,
    cmCatAdd: cmCatAdd,
    cmCatAssignUncategorized: cmCatAssignUncategorized,
    cmCatDelete: cmCatDelete,
    cmCatMode: cmCatMode,
    cmCatMoveCancel: cmCatMoveCancel,
    cmCatMoveDelete: cmCatMoveDelete,
    cmCatNameLive: cmCatNameLive,
    cmCatNoticeDone: cmCatNoticeDone,
    cmCatSave: cmCatSave,
    cmCatWeightLive: cmCatWeightLive,
    cmOpenSetupCopy: cmOpenSetupCopy,
    cmSaveDecay: cmSaveDecay,
    cmSetCalcMethod: cmSetCalcMethod,
    cmSetCoursesCountEqually: cmSetCoursesCountEqually,
    cmSetFolderCountsAsOne: cmSetFolderCountsAsOne,
    cmSetFoldersCountAsOne: cmSetFoldersCountAsOne,
    cmSetGradingSystem: cmSetGradingSystem,
    cmSetLevelOrder: cmSetLevelOrder,
    cmSetRecentLimit: cmSetRecentLimit,
    cmSetRoundPercent: cmSetRoundPercent,
    cmUpdateDecay: cmUpdateDecay,
    cmUpdateField: cmUpdateField,
  };
})();
