/* Categories: an assessment's category and its badge, getCategories and saveCategories, the save to the server (_persistCategoriesToCanonical),
   the category write guard and Class Settings' category draft. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

function _getAssessmentCategoryId(assessment) {
  return (assessment && (assessment.categoryId || assessment.category_id)) || null;
}

function getAssessmentCategoryId(assessment) {
  return _getAssessmentCategoryId(assessment);
}

/* Whether an assessment's category badge shows: always when it has a
   category, and "No Category" only in a class that has categories, where
   it is something to fix. A class with none shows no badge at all. */
function showsCategoryBadge(cid, assessment) {
  return !!_getAssessmentCategoryId(assessment) || (getCategories(cid) || []).length > 0;
}

function getAssessmentCategoryName(cid, assessment) {
  var categoryId = _getAssessmentCategoryId(assessment);
  if (!categoryId) return 'No Category';
  var category = getCategoryById(cid, categoryId);
  return category && category.name ? category.name : 'Unknown Category';
}

/* A class with categories needs one on every scored assessment, as Teams
   does once categories are on (docs/DECISIONS.md, "A category on every
   assessment"). DIBELS work counts toward no grade, so it may have none. */
function categoryRequired(cid, assessment) {
  return (getCategories(cid) || []).length > 0 && !isDibelsScored(assessment);
}

// Work that should have a category and has none, or one that's gone.
function assessmentNeedsCategory(cid, assessment) {
  return (
    !!assessment && categoryRequired(cid, assessment) && !getCategoryById(cid, _getAssessmentCategoryId(assessment))
  );
}

var _categorySaveQueue = {};

function _categoryChanged(a, b, idx) {
  return (
    !a ||
    (a.name || '') !== (b.name || '') ||
    Number(a.weight || 0) !== Number(b.weight || 0) ||
    categoryCalcMode(a) !== categoryCalcMode(b) ||
    Number(a.displayOrder ?? a.display_order ?? idx) !== Number(b.displayOrder ?? b.display_order ?? idx)
  );
}

/* Categories go up as one list (save_categories): weights must total 100,
   which a row-at-a-time save can't keep while weights change. */
function _persistCategoriesToCanonical(cid, prev, arr, copy) {
  if (!window.v2 || !window.v2.saveCategories) return;
  var tail = _categorySaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    prev = _serverStateOr('categories', cid, prev);
    arr = (_cache.categories[cid] || arr || []).filter(Boolean);
    var prevById = {};
    (prev || []).forEach(function (category) {
      if (category && category.id) prevById[category.id] = category;
    });
    var prevIds = (prev || [])
      .filter(Boolean)
      .map(function (category) {
        return category.id;
      })
      .join(',');
    var nextIds = arr
      .map(function (category) {
        return category.id;
      })
      .join(',');
    var changed =
      prevIds !== nextIds ||
      arr.some(function (category, idx) {
        return _categoryChanged(prevById[category.id], category, idx);
      });
    if (!changed) return;
    var before = _cloneValue(prev);
    _rememberServerState('categories', cid, arr);
    // One save creates every new row; the server answers with the ids in
    // list order, so each new row's record remembers its position.
    var entryId = null;
    arr.forEach(function (category, idx) {
      if (_isUuid(category.id) || _resolveKnownId('category', category.id) !== category.id) return;
      var rec = _registerPendingCreate(cid, 'category', category.id, 'save_categories', {
        entryId: entryId,
        index: idx,
      });
      if (rec && !entryId) entryId = rec.entryId;
    });
    // Kept with the queued save: the list it was made over. If it has to
    // wait, it is sent only over that list (_guardCategorySave).
    var guard = { expected: _categoryListKept(before) };
    if (_plainObject(copy)) guard.copy = { from: String(copy.from || ''), rest: !!copy.rest };
    var options = {
      entryId: entryId || undefined,
      guard: guard,
      categoriesMadeAt: Date.now(),
    };
    return window.v2.saveCategories(cid, arr, options).then(function (res) {
      // Rejected or refused: the server still has the old list, so the
      // next save sends the whole list again.
      if (res && res.error && !res.error.cancelled) _rememberServerState('categories', cid, before);
      if (res && res.error) throw res.error;
      // Re-keys the rows and the assessments that point at them (already
      // done when the outbox reported success).
      if (entryId) _onCreateLanded(entryId, res && res.data);
      // The server holds this list now: a "not copied" line for the class
      // would no longer be true.
      _clearCategoriesNotCopied(cid);
    });
  });
  _categorySaveQueue[cid] = _trackPendingSync(
    next.catch(function (err) {
      console.warn('Category sync to canonical RPCs failed:', err);
    }),
  );
  return _categorySaveQueue[cid];
}

function getCategories(cid) {
  if (_cache.categories[cid] !== undefined) return _cache.categories[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-categories-' + cid)) || [];
  } catch (e) {
    console.warn('Categories parse fallback:', e);
    return [];
  }
}
/* `options.copy`: { from, rest } when the list is Copy Grading Setup's,
   copied from the class named `from` (`rest`: other groups were copied
   too). If the save has to wait and is then not sent, the class says so
   when next opened (noteCategoriesNotCopied). */
function saveCategories(cid, arr, options) {
  var prev = _loadPersistedCourseFieldSnapshot('categories', cid, (_cache.categories && _cache.categories[cid]) || []);
  var next = arr || [];
  _saveCourseField('categories', cid, next);
  if (!_writesEnabled() || !_isUuid(cid)) return;
  _persistCategoriesToCanonical(cid, prev, next, options && options.copy);
}
/* The class manager writes categories itself (save_categories,
   reorder_categories) and hands the resulting rows here.
   Cache, localStorage and the server baseline take them without sending
   anything a second time. */
/* A category's Calculation (category.calc_mode): 'percent' averages each
   assessment's percent, 'points' (the default, and anything unset) pools
   points earned and possible. Takes a cache row (calcMode) or a server or
   Class Settings row (calc_mode). */
function categoryCalcMode(category) {
  var mode = category && (category.calcMode || category.calc_mode);
  return mode === 'percent' ? 'percent' : 'points';
}
function adoptCategoriesFromServer(cid, rows) {
  _persistLoadedField(cid, 'categories', rows || []);
  if (typeof clearProfCache === 'function') clearProfCache();
}
/* A list of categories as rows to compare: id, name, weight and
   Calculation, in the order a read returns them (display_order; rows that
   tie there, by id, so the order does not hang on how the server breaks a
   tie). Takes cache rows (displayOrder, calcMode) or server and Class
   Settings rows (display_order, calc_mode). */
function _categoryRowsInOrder(rows) {
  var list = (rows || []).filter(Boolean).map(function (r, i) {
    var order = r.displayOrder != null ? r.displayOrder : r.display_order;
    return {
      id: r.id || null,
      name: String(r.name || '').trim(),
      weight: Number(r.weight) || 0,
      mode: categoryCalcMode(r),
      at: i,
      order: order != null && isFinite(Number(order)) ? Number(order) : i,
    };
  });
  list.sort(function (a, b) {
    if (a.order !== b.order) return a.order - b.order;
    if (a.id && b.id && a.id !== b.id) return a.id < b.id ? -1 : 1;
    return a.at - b.at;
  });
  return list;
}
/* Is the server's list the one wanted? A wanted row with no server id yet
   (a new row in a list this device sent) matches whatever id it was given. */
function _categoryListsMatch(serverRows, wanted) {
  var a = _categoryRowsInOrder(serverRows);
  var b = _categoryRowsInOrder(wanted);
  if (a.length !== b.length) return false;
  return b.every(function (w, i) {
    return (
      (!_isUuid(w.id) || w.id === a[i].id) && w.name === a[i].name && w.weight === a[i].weight && w.mode === a[i].mode
    );
  });
}
// A list as kept with a queued save: the least that _categoryListsMatch reads.
function _categoryListKept(rows) {
  return (rows || []).filter(Boolean).map(function (r, i) {
    var order = r.displayOrder != null ? r.displayOrder : r.display_order;
    return {
      id: r.id || null,
      name: String(r.name || '').trim(),
      weight: Number(r.weight) || 0,
      displayOrder: order != null && isFinite(Number(order)) ? Number(order) : i,
      calcMode: categoryCalcMode(r),
    };
  });
}
/* The class's categories as the server holds them now, in cache shape and
   read order; null when they could not be read. Never throws. */
async function _readServerCategories(cid) {
  try {
    var res = await window.v2.listCategories(cid);
    if (!res || res.error || !Array.isArray(res.data)) return null;
    return res.data
      .map(function (r, i) {
        return {
          id: r.id,
          name: r.name || '',
          weight: Number(r.weight) || 0,
          displayOrder: r.display_order != null ? Number(r.display_order) : i,
          calcMode: categoryCalcMode(r),
        };
      })
      .map(function (r, i) {
        return { r: r, i: i };
      })
      .sort(function (a, b) {
        return a.r.displayOrder - b.r.displayOrder || a.i - b.i;
      })
      .map(function (x) {
        return x.r;
      });
  } catch (e) {
    console.warn('The categories could not be read:', e);
    return null;
  }
}

/* Before a whole list of categories is saved over a class the server has:
   is the server's list still the one this screen was opened with?
   save_categories replaces the class's list, so a list opened before a
   change made on another device would delete a category added there and
   put old weights back. Copy Grading Setup asks this before it copies;
   Class Settings asks and saves in one step (saveCategoriesNow).

   `opened` is the list the screen was filled from. Answers a promise of
     { ok: true }                          the same list: save
     { ok: true, local: true }             no server holds this class (Demo
                                           Mode, a class not created yet)
     { ok: false, why: 'changed', rows }   it changed on another device;
                                           rows is the server's list now
     { ok: false, why: 'offline' }         it could not be read: do not save
   On 'changed' the cache takes the server's list, so grades follow it at
   once. Never throws. */
function categoriesStillCurrent(cid, opened) {
  if (!cid || !_writesEnabled() || !_isUuid(cid)) return Promise.resolve({ ok: true, local: true });
  var check = (async function () {
    try {
      if (_isOffline()) return { ok: false, why: 'offline' };
      // A list this device is still sending is part of what it opened with.
      await _categorySaveQueue[cid];
      if (_isOffline()) return { ok: false, why: 'offline' };
      var rows = await _readServerCategories(cid);
      if (!rows) return { ok: false, why: 'offline' };
      if (_categoryListsMatch(rows, opened)) return { ok: true };
      adoptCategoriesFromServer(cid, rows);
      return { ok: false, why: 'changed', rows: rows };
    } catch (e) {
      console.warn('The categories could not be checked before saving:', e);
      return { ok: false, why: 'offline' };
    }
  })();
  // Part of a save: the sync dot and sign-out wait for it.
  return _trackPendingSync(check);
}

var CATEGORY_WRITE_WAIT_MS = 8000; // how long a category save waits for this device's other writes to go first
var CATEGORY_WRITE_ASK_MS = 15000; // how long it waits for the server's answer
var CATEGORY_SAME_MOMENT_MS = 10000; // a queued list sent within this of being made is sent as made

/* Class Settings' Save Categories and its drag to reorder: the server's
   list is read, compared with the list the form was opened with, and the
   save sent, in one online moment or not at all. The save is asked of the
   server directly, never left in the outbox: a list that waited there
   would go out later over whatever another device had done meanwhile.

   `tried` is a list this form sent before and never heard back about (the
   connection went as it left). If that is what the server holds now, it
   landed: nothing is sent again.

   Answers a promise of
     { ok: true, ids }                     saved; the rows' ids, in order
     { ok: true, landed: true, rows }      the earlier try had landed
     { ok: false, why: 'changed', rows }   changed on another device; rows
                                           is the server's list (the cache
                                           has taken it)
     { ok: false, why: 'offline' }         not saved: no connection.
                                           `unknown`: it was sent and no
                                           answer came.
     { ok: false, why: 'waiting' }         not saved: online, but this
                                           device's other changes did not go
                                           first
     { ok: false, why: 'refused', error }  the server said no
   A class no server holds (Demo Mode, one not created yet) saves as it
   always did. Never throws. */
function saveCategoriesNow(cid, rows, opened, tried) {
  if (!cid || !_writesEnabled() || !_isUuid(cid)) {
    return Promise.resolve(window.v2.saveCategories(cid, rows)).then(function (res) {
      if (res && res.error) return { ok: false, why: 'refused', error: res.error };
      return { ok: true, local: true, ids: (res && Array.isArray(res.data) && res.data) || [] };
    });
  }
  return _categoryWriteNow(cid, 'save_categories', _saveCategoriesParams(cid, rows), opened, tried);
}
function reorderCategoriesNow(cid, ids, opened) {
  if (!cid || !_writesEnabled() || !_isUuid(cid)) {
    return Promise.resolve(window.v2.reorderCategories(ids)).then(function (res) {
      if (res && res.error) return { ok: false, why: 'refused', error: res.error };
      return { ok: true, local: true };
    });
  }
  return _categoryWriteNow(cid, 'reorder_categories', { p_ids: (ids || []).filter(_isUuid) }, opened, null);
}
async function _categoryWriteNow(cid, name, params, opened, tried) {
  var noAnswer = { ok: false, why: 'offline' };
  try {
    if (_isOffline()) return noAnswer;
    // Work moved out of a category must reach the server before the list
    // that deletes it, and nothing this device still has to send may land
    // after the list it was made over.
    var gone = await _unsentWritesGone(CATEGORY_WRITE_WAIT_MS);
    if (_isOffline()) return noAnswer;
    // Online, and this device's other writes are still waiting to go.
    if (!gone) return { ok: false, why: 'waiting' };
  } catch (e) {
    return noAnswer;
  }
  // From here it is a save: the sync dot and sign-out wait for it.
  return _trackPendingSync(
    (async function () {
      try {
        var rows = await _readServerCategories(cid);
        if (!rows) return noAnswer;
        if (!_categoryListsMatch(rows, opened)) {
          adoptCategoriesFromServer(cid, rows);
          if (tried && _categoryListsMatch(rows, tried)) return { ok: true, landed: true, rows: rows };
          return { ok: false, why: 'changed', rows: rows };
        }
        // Not this page's own echo: the class is read when realtime says so.
        _echoNeedsReload = true;
        var res = await _withTimeout(
          _callRpcWithAuthGuard(name, params, { suppressSessionExpiredModal: true }),
          CATEGORY_WRITE_ASK_MS,
          'the category save',
        );
        if (res && !res.error) {
          if (name === 'save_categories') _clearCategoriesNotCopied(cid);
          return { ok: true, ids: Array.isArray(res.data) ? res.data : [] };
        }
        if (_noAnswerFromServer(res)) return { ok: false, why: 'offline', unknown: true };
        return { ok: false, why: 'refused', error: res.error };
      } catch (e) {
        console.warn('The category save failed:', e);
        return { ok: false, why: 'offline', unknown: true };
      }
    })(),
  );
}
// No answer, or none that says what the server did: a dropped connection, a
// timeout, a server error, a session that ran out.
function _noAnswerFromServer(res) {
  if (!res || !res.error) return !res;
  var err = res.error;
  var status = Number(res.status || err.status || err.statusCode || 0);
  if (status >= 500 || status === 401 || status === 408 || status === 429 || err.handledSessionExpired) return true;
  var text = [err.code, err.message, err.name, typeof err === 'string' ? err : ''].join(' ');
  return /network|fetch|failed to connect|ECONNREFUSED|timed? ?out|load failed|no_supabase|jwt expired|PGRST301/i.test(
    text,
  );
}

var OLD_CATEGORY_SAVE_NOT_SENT = 'An older category save that could not be checked was not sent';
var WAITED_CATEGORY_SAVE_NOT_SENT = 'A category save that waited was not sent: the list had changed';
/* A save_categories the outbox is about to send. Null to send it as it is;
   else a promise of { answer }: what the outbox hears instead.

   A list sent at once, in the page that made it, goes as made: its maker
   had just checked (Copy Grading Setup) or the class is new. One that
   waited (a retry, a later page, a connection that went) is never sent
   blind. The server's list is read first:
   - it is already this list: there is nothing to send;
   - it is the list this save was made over (kept with the entry as its
     guard): send;
   - anything else: never sent (_discardWrite). That is also every save an
     older build left waiting: it kept no word of what its device had
     loaded, so it goes only when the server already holds its list. */
function _guardCategorySave(params, options) {
  if (!options.viaOutbox || !params || !_isUuid(params.p_course_id)) return null;
  var guard = options.guard;
  var made = Number(options.categoriesMadeAt) || 0;
  var sameMoment = made > 0 && Date.now() - made < CATEGORY_SAME_MOMENT_MS && !options.attempts && !options.lastTry;
  if (sameMoment) return null;
  var cid = params.p_course_id;
  return (async function () {
    var rows = await _readServerCategories(cid);
    if (!rows) {
      return { answer: { data: null, error: { message: 'network: the categories could not be read' } } };
    }
    var mine = (Array.isArray(params.p_categories) ? params.p_categories : []).map(function (c, i) {
      return Object.assign({}, c, { display_order: i });
    });
    if (_categoryListsMatch(rows, mine)) {
      return {
        answer: {
          data: rows.map(function (r) {
            return r.id;
          }),
          error: null,
        },
      };
    }
    if (guard && Array.isArray(guard.expected) && _categoryListsMatch(rows, guard.expected)) return null;
    adoptCategoriesFromServer(cid, rows);
    // Copy Grading Setup's list: its message said "copied", so the class
    // says it was not, above its categories, when next opened.
    if (guard && _plainObject(guard.copy)) {
      noteCategoriesNotCopied(cid, { why: 'changed', from: guard.copy.from, rest: guard.copy.rest });
    }
    return { answer: _discardWrite(cid, guard ? WAITED_CATEGORY_SAVE_NOT_SENT : OLD_CATEGORY_SAVE_NOT_SENT) };
  })();
}

/* What Class Settings keeps on this device for a class's categories when a
   save was not made (gb-category-draft-<cid>), so nothing the teacher typed
   is lost with the tab:
     rows, opened   the edits that could not be saved (no connection), and
                    the list they were made over
     typed          what the teacher had typed when the list turned out to
                    have changed on another device: shown beside the
                    current list to copy from
     tried          a list this computer sent whose answer never came: if
                    the server holds it, it was this computer's own save
                    that landed, not a change made on another device
     note           { why, from, rest }: Copy Grading Setup left this
                    class's categories alone, and why
   Not class data: never sent, not in a backup, gone with the class. */
function getCategoryDraft(cid) {
  var draft = cid ? _safeParseLS('gb-category-draft-' + cid, null) : null;
  return _plainObject(draft) ? draft : null;
}
function saveCategoryDraft(cid, draft) {
  if (!cid) return;
  var keep = {};
  if (_plainObject(draft)) {
    ['rows', 'opened', 'typed', 'tried'].forEach(function (k) {
      if (Array.isArray(draft[k])) keep[k] = draft[k];
    });
    if (_plainObject(draft.note)) keep.note = draft.note;
  }
  try {
    if (Object.keys(keep).length) _safeLSSet('gb-category-draft-' + cid, JSON.stringify(keep));
    else localStorage.removeItem('gb-category-draft-' + cid);
  } catch (e) {
    /* storage full or closed: the form still holds it while it is open */
  }
}
/* Copy Grading Setup did not copy this class's categories: say so when the
   class is next opened in Class Settings. */
/* A list of categories reached the server for this class: the note above
   says nothing true any more. */
function _clearCategoriesNotCopied(cid) {
  var draft = getCategoryDraft(cid);
  if (!draft || !draft.note) return;
  delete draft.note;
  saveCategoryDraft(cid, draft);
}
function noteCategoriesNotCopied(cid, note) {
  var draft = getCategoryDraft(cid) || {};
  draft.note = {
    why: note && note.why === 'changed' ? 'changed' : 'offline',
    from: (note && note.from) || '',
    rest: !!(note && note.rest),
  };
  saveCategoryDraft(cid, draft);
}
function getCategoryById(cid, categoryId) {
  if (!categoryId) return null;
  return (
    getCategories(cid).find(function (c) {
      return c.id === categoryId;
    }) || null
  );
}
