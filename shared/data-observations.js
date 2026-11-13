// @ts-check
/* Observations: quick observations, sentence starters, custom tags and the tag resolver.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ── Quick Observations — in-the-moment capture ─────────── */
function getQuickObs(cid) {
  if (_cache.observations[cid] !== undefined) return _cache.observations[cid];
  try {
    return JSON.parse(/** @type {string} */ (localStorage.getItem('gb-quick-obs-' + cid))) || {};
  } catch (e) {
    console.warn('Observations parse fallback:', e);
    return {};
  }
}
function saveQuickObs(cid, obj) {
  _saveCourseField('observations', cid, obj);
}

/* The student's list itself, newest first. It is sorted in place, so it is
   sorted once: a list already in order is handed back as it is. */
function getStudentQuickObs(cid, sid) {
  const list = getQuickObs(cid)[sid] || [];
  for (let i = 1; i < list.length; i++) {
    if ((list[i].created || '').localeCompare(list[i - 1].created || '') > 0) {
      return list.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    }
  }
  return list;
}

function getAllQuickObs(cid) {
  const all = getQuickObs(cid);
  const flat = [];
  for (const sid of Object.keys(all)) {
    (all[sid] || []).forEach(ob => flat.push({ ...ob, studentId: sid }));
  }
  return flat.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

/* link: optional { competencyId, level } — one learning-map tag id and a
   1-4 level on it. */
/* templateId: the sentence starter it was written from, if any. */
function addQuickOb(cid, sid, text, dims, sentiment, context, assignmentContext, link, templateId) {
  const all = getQuickObs(cid);
  if (!all[sid]) all[sid] = [];
  const entry = {
    id: 'qo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    text: text.trim(),
    dims: dims || [],
    created: new Date().toISOString(),
    date: getTodayStr(),
  };
  if (sentiment) entry.sentiment = sentiment;
  if (context) entry.context = context;
  if (assignmentContext) entry.assignmentContext = assignmentContext;
  if (link && link.competencyId) {
    entry.competencyId = link.competencyId;
    var level = _observationLevel(link.level);
    if (level) entry.level = level;
  }
  if (templateId) entry.templateId = templateId;
  all[sid].push(entry);
  _cache.observations[cid] = all;
  var lsOk = _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  _markLocalWrite('observations', cid);
  if (_writesEnabled()) {
    _persistObservationCreate(cid, sid, entry);
  }
  if (templateId) noteObservationTemplateUse(templateId);
  _broadcastChange(cid, 'observations');
  return lsOk;
}

/* The current id of an observation a page may still hold by its local id
   (the create may have landed and re-keyed it since). */
function resolveObservationId(cid, id) {
  return _resolveKnownId('observation', id);
}

function deleteQuickOb(cid, sid, obId) {
  const all = getQuickObs(cid);
  if (!all[sid]) return;
  all[sid] = all[sid].filter(o => o.id !== obId);
  _cache.observations[cid] = all;
  _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  _markLocalWrite('observations', cid);
  if (_writesEnabled()) {
    _persistObservationDelete(cid, obId);
  }
  _broadcastChange(cid, 'observations');
}

/* Delete every observation linked to an assessment via assignmentContext.
   Used by the assignment-delete UI flows in both page-assignments.js (full
   inline editor) and page-gradebook.js (context menu). Returns the number
   of removed observations.

   Why this exists: observations reference assessments through a JSON
   `assignmentContext` field (not a real FK), so DB-level FK cascade from
   `assessment` does not reach them. Without this helper, a deleted
   assessment leaves orphaned observation rows on the server with a stale
   assessmentId that reappear on reload (P6.5 audit, 2026-05-01). */
function deleteAssessmentObservations(cid, aid) {
  if (!cid || !aid) return 0;
  const all = getQuickObs(cid);
  const removedIds = [];
  let touched = false;
  Object.keys(all).forEach(function (sid) {
    const before = (all[sid] || []).length;
    all[sid] = (all[sid] || []).filter(function (o) {
      const matches = o && o.assignmentContext && o.assignmentContext.assessmentId === aid;
      if (matches && o.id) removedIds.push(o.id);
      return !matches;
    });
    if (all[sid].length !== before) touched = true;
  });
  if (!touched) return 0;
  // Persist the trimmed blob to LS + cache.
  saveQuickObs(cid, all);
  // Dispatch delete_observation for each removed observation that has a
  // canonical UUID. Locally-created observations not yet synced have local
  // string ids; _persistObservationDelete skips those.
  if (_writesEnabled()) {
    removedIds.forEach(function (obId) {
      _persistObservationDelete(cid, obId);
    });
  }
  return removedIds.length;
}

function updateQuickOb(cid, sid, obId, updates) {
  const all = getQuickObs(cid);
  if (!all[sid]) return false;
  const ob = all[sid].find(o => o.id === obId);
  if (!ob) return false;
  if (updates.text !== undefined) ob.text = updates.text.trim();
  if (updates.dims !== undefined) ob.dims = updates.dims;
  if (updates.sentiment !== undefined) ob.sentiment = updates.sentiment || null;
  // An observation from a reflection keeps that context for good: it is
  // what keeps the student's words out of every report (ruling 110,
  // isReflectionObservation in shared/constants.js). No screen can lift it.
  if (updates.context !== undefined && !isReflectionObservation(ob)) ob.context = updates.context || null;
  var competencyChanged = false;
  if (updates.competencyId !== undefined) {
    var nextComp = updates.competencyId || null;
    competencyChanged = nextComp !== (ob.competencyId || null);
    if (nextComp) ob.competencyId = nextComp;
    else delete ob.competencyId;
  }
  if (updates.level !== undefined) {
    var nextLevel = _observationLevel(updates.level);
    if (nextLevel) ob.level = nextLevel;
    else delete ob.level;
  }
  // A level belongs to a competency.
  if (!ob.competencyId) delete ob.level;
  ob.modified = new Date().toISOString();
  _cache.observations[cid] = all;
  var lsOk = _safeLSSet('gb-quick-obs-' + cid, JSON.stringify(all));
  _markLocalWrite('observations', cid);
  if (_writesEnabled()) {
    _persistObservationUpdate(cid, ob, { competencyChanged: competencyChanged });
  }
  _broadcastChange(cid, 'observations');
  return lsOk;
}

/* v2 create_observation(p_course_id, p_body, p_sentiment, p_context_type,
   p_assessment_id, p_enrollment_ids uuid[], p_tag_ids uuid[],
   p_custom_tag_ids uuid[], p_idempotency_key, p_dims text[],
   p_level smallint, p_template_id uuid) → uuid */
function _persistObservationCreate(cid, sid, entry) {
  if (!_isUuid(cid) || !_isSendableId(sid)) return;
  // The observation's own local id is re-keyed when the create lands, so an
  // edit or delete made before then waits for it instead of being dropped.
  var rec = _registerPendingCreate(cid, 'observation', entry.id, 'create_observation');
  var ctxAsmt =
    entry.assignmentContext && _isUuid(entry.assignmentContext.assessmentId)
      ? entry.assignmentContext.assessmentId
      : null;
  // entry.dims are string keys, not learning-map tag ids, so they go in
  // p_dims (observation.dims). The linked competency is a learning-map tag
  // and goes in p_tag_ids (observation_tag).
  var tagIds = _observationTagIds(entry.competencyId);
  var params = {
    p_course_id: cid,
    p_body: entry.text || '',
    p_sentiment: entry.sentiment || null,
    p_context_type: entry.context || null,
    p_assessment_id: ctxAsmt,
    p_enrollment_ids: [sid],
    p_tag_ids: tagIds,
    p_custom_tag_ids: [],
    p_dims: _observationDims(entry.dims),
    p_level: tagIds.length ? _observationLevel(entry.level) : null,
  };
  // The starter counts toward Times Used once it has a server id; one still
  // waiting for its own create is left out.
  var tplId = entry.templateId ? _resolveKnownId('observationTemplate', entry.templateId) : null;
  if (_isUuid(tplId)) params.p_template_id = tplId;
  _trackPendingSync(
    _writeRpc('create_observation', params, {
      retryKey: 'create_observation:' + entry.id,
      entryId: rec ? rec.entryId : undefined,
    }).then(function (res) {
      if (res.error) {
        if (res.error.handledSessionExpired || res.error.cancelled) return;
        console.warn('create_observation failed:', res.error);
        return;
      }
      if (rec) _onCreateLanded(rec.entryId, res.data);
    }),
  );
}

/* v2 update_observation(p_id, p_patch jsonb, p_enrollment_ids, p_tag_ids,
   p_custom_tag_ids). Null join-array params leave that set alone; empty
   array wipes it. Here we always pass null so we don't disturb membership
   unless the caller explicitly wants to. The dims and level always go in
   the patch, so removing the last tag clears them on the server too. The
   competency (p_tag_ids) is sent only when it changed, so a learning-map
   link made elsewhere is left alone otherwise. */
function _persistObservationUpdate(cid, ob, opts) {
  if (!_isSendableId(ob.id)) return;
  var tagIds = _observationTagIds(ob.competencyId);
  var patch = {
    body: ob.text || '',
    sentiment: ob.sentiment || null,
    context_type: ob.context || null,
    dims: _observationDims(ob.dims),
    level: tagIds.length ? _observationLevel(ob.level) : null,
  };
  if (ob.assignmentContext && _isUuid(ob.assignmentContext.assessmentId)) {
    patch.assessment_id = ob.assignmentContext.assessmentId;
  }
  _trackPendingSync(
    _writeRpc(
      'update_observation',
      {
        p_id: ob.id,
        p_patch: patch,
        p_enrollment_ids: null,
        p_tag_ids: opts && opts.competencyChanged ? tagIds : null,
        p_custom_tag_ids: null,
      },
      {
        retryKey: 'update_observation:' + ob.id,
      },
    ).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('update_observation failed:', res.error);
    }),
  );
}

/* v2 delete_observation(p_id). FK cascade handles observation_student /
   observation_tag / observation_custom_tag / term_rating_observation. */
function _persistObservationDelete(cid, obId) {
  if (!_isSendableId(obId)) return;
  var sb = getSupabase();
  if (!sb) return;
  _trackPendingSync(
    _writeRpc('delete_observation', { p_id: obId }).then(function (res) {
      if (res.error) console.warn('delete_observation failed:', res.error);
    }),
  );
}

/* ── Public v2 observation helpers (Phase 4.4) ─────────────────── */

/* Richer create that accepts multi-student targeting + tag + custom-tag
   membership, mirroring the Pass B §10.1 capture-bar payload. */
window.createObservationRich = function (params) {
  params = params || {};
  if (!_isUuid(params.courseId)) return Promise.resolve();
  return _trackPendingSync(
    _writeRpc(
      'create_observation',
      {
        p_course_id: params.courseId,
        p_body: params.body || '',
        p_sentiment: params.sentiment || null,
        p_context_type: params.contextType || null,
        p_assessment_id: _isUuid(params.assessmentId) ? params.assessmentId : null,
        p_enrollment_ids: (params.enrollmentIds || []).filter(_isUuid),
        p_tag_ids: (params.tagIds || []).filter(_isUuid),
        p_custom_tag_ids: (params.customTagIds || []).filter(_isUuid),
      },
      {
        retryKey:
          'create_observation:' +
          ((params.localId || params.body || '') + ':' + (params.enrollmentIds || []).join(',')),
      },
    ).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('create_observation failed:', res.error);
      return res;
    }),
  );
};

window.updateObservationRich = function (obId, patch, joins) {
  if (!_isUuid(obId)) return Promise.resolve();
  joins = joins || {};
  return _trackPendingSync(
    _writeRpc(
      'update_observation',
      {
        p_id: obId,
        p_patch: patch || {},
        p_enrollment_ids: joins.enrollmentIds ? joins.enrollmentIds.filter(_isUuid) : null,
        p_tag_ids: joins.tagIds ? joins.tagIds.filter(_isUuid) : null,
        p_custom_tag_ids: joins.customTagIds ? joins.customTagIds.filter(_isUuid) : null,
      },
      {
        retryKey: 'update_observation:' + obId,
      },
    ).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn('update_observation failed:', res.error);
      return res;
    }),
  );
};

/* ── Sentence starters (observation_template) ─────────────────────────────
   The teacher's one list of starters, used in every class: the capture
   strip's "/" menu and "+ Starter" chip, the phone's quick menu, and My
   Sentence Starters (migrations/20261022_teacher_sentence_starters.sql). A
   row is { id, text, sentiment, context, dims, uses }; the list order is the
   order on My Sentence Starters, and the menus sort by uses (Times Used,
   every class). The list loads with any class bundle and saves like modules:
   it is diffed against the server baseline and each changed row goes out
   through the outbox. A new row has a local id ('ot…') until its upsert
   lands. It is kept under one scope, not a class: the cid arguments below
   are only for callers that still pass one. */
var _TEMPLATE_SENTIMENTS = { strength: true, growth: true, concern: true, note: true };
var _STARTER_SCOPE = 'teacher';

function _cleanObservationTemplate(row) {
  row = row || {};
  var dims = [];
  (Array.isArray(row.dims) ? row.dims : []).forEach(function (k) {
    if (k && typeof k === 'string' && dims.indexOf(k) < 0) dims.push(k);
  });
  return {
    id: row.id,
    text: String(row.text || '').trim(),
    sentiment: _TEMPLATE_SENTIMENTS[row.sentiment] ? row.sentiment : null,
    context: row.context || null,
    dims: dims,
    uses: Math.max(0, Number(row.uses) || 0),
  };
}

/* A class's custom tags ('tag:<label>') don't exist in the teacher's other
   classes, so a starter doesn't keep them. */
function _starterDims(dims) {
  return (dims || []).filter(function (k) {
    return !/^tag:/.test(k);
  });
}

function _observationTemplatesFromServer(rows) {
  return (rows || [])
    .filter(function (r) {
      return r && r.id;
    })
    .map(function (r) {
      return _cleanObservationTemplate({
        id: r.id,
        text: r.body,
        sentiment: r.default_sentiment,
        context: r.default_context_type,
        dims: r.default_dims,
        uses: r.use_count,
      });
    });
}

/* This device's list. Before starters belonged to the teacher, each class
   kept its own (gb-obs-templates-<cid>); the first read folds those into
   one, one row per wording, without custom tags. A signed-in teacher's list
   then comes from the server with the next class bundle. */
function _foldClassStarters() {
  var out = [];
  var seen = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf('gb-obs-templates-') !== 0 || key === 'gb-obs-templates-' + _STARTER_SCOPE) continue;
      (_safeParseLS(key, []) || []).forEach(function (t) {
        var norm = String((t && t.text) || '')
          .trim()
          .toLowerCase();
        if (!norm || seen[norm]) return;
        seen[norm] = true;
        out.push(_cleanObservationTemplate(Object.assign({}, t, { dims: _starterDims(t.dims) })));
      });
    }
  } catch (e) {
    /* storage unavailable: start empty */
  }
  return out;
}

function getObservationTemplates() {
  var scope = _STARTER_SCOPE;
  if (_cache.observationTemplates[scope] !== undefined) return _cache.observationTemplates[scope] || [];
  var list = _safeParseLS('gb-obs-templates-' + scope, null);
  if (!Array.isArray(list)) {
    list = _foldClassStarters();
    if (list.length) _safeLSSet('gb-obs-templates-' + scope, JSON.stringify(list));
  }
  _cache.observationTemplates[scope] = list;
  return list;
}

/* Returns false when this device's storage refused the list. */
function saveObservationTemplates(cid, arr) {
  var scope = _STARTER_SCOPE;
  arr = (arr || []).map(function (t) {
    return _cleanObservationTemplate(Object.assign({}, t, { dims: _starterDims(t && t.dims) }));
  });
  var prev = _loadPersistedCourseFieldSnapshot(
    'observationTemplates',
    scope,
    (_cache.observationTemplates && _cache.observationTemplates[scope]) || [],
  );
  var lsOk = _saveCourseField('observationTemplates', scope, arr);
  if (!_writesEnabled()) return lsOk;
  arr.forEach(function (t) {
    if (!t.id || _isUuid(t.id) || _resolveKnownId('observationTemplate', t.id) !== t.id) return;
    _registerPendingCreate(scope, 'observationTemplate', t.id, 'upsert_observation_template');
  });
  _persistObservationTemplatesToCanonical(scope, prev, arr);
  return lsOk;
}

/* An observation was written from this starter: count it here until the
   next bundle brings the server's count (observation.template_id). */
function noteObservationTemplateUse(id) {
  var list = getObservationTemplates();
  var i = _templateIndex(list, null, id);
  if (i < 0) return;
  list = list.slice();
  list[i] = Object.assign({}, list[i], { uses: (list[i].uses || 0) + 1 });
  _saveCourseField('observationTemplates', _STARTER_SCOPE, list);
  if (_hasServerState('observationTemplates', _STARTER_SCOPE)) {
    var base = _serverStateOr('observationTemplates', _STARTER_SCOPE, []).slice();
    var bi = _templateIndex(base, null, id);
    if (bi >= 0) base[bi] = Object.assign({}, base[bi], { uses: list[i].uses });
    _rememberServerState('observationTemplates', _STARTER_SCOPE, base);
  }
}

/* The menus' order: most used first, then the list order. */
function getObservationTemplatesByUse() {
  return getObservationTemplates()
    .map(function (t, i) {
      return { t: t, i: i };
    })
    .sort(function (a, b) {
      return (b.t.uses || 0) - (a.t.uses || 0) || a.i - b.i;
    })
    .map(function (x) {
      return x.t;
    });
}

var _templateSaveQueue = {};

function _observationTemplateChanged(before, after, beforeIdx, afterIdx) {
  return (
    (before.text || '') !== (after.text || '') ||
    (before.sentiment || null) !== (after.sentiment || null) ||
    (before.context || null) !== (after.context || null) ||
    JSON.stringify(before.dims || []) !== JSON.stringify(after.dims || []) ||
    beforeIdx !== afterIdx
  );
}

function _persistObservationTemplatesToCanonical(cid, prev, arr) {
  if (!getSupabase()) return;
  var tail = _templateSaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    var hasBaseline = _hasServerState('observationTemplates', cid);
    prev = _serverStateOr('observationTemplates', cid, prev) || [];
    arr = _cache.observationTemplates[cid] || arr;
    var prevIdx = {};
    prev.forEach(function (t, i) {
      if (t && t.id) prevIdx[_resolveKnownId('observationTemplate', t.id)] = i;
    });
    var kept = {};
    var ops = [];
    arr.forEach(function (t, idx) {
      if (!t || !t.id) return;
      var id = _resolveKnownId('observationTemplate', t.id);
      kept[id] = true;
      var pi = prevIdx[id];
      var p = pi != null ? prev[pi] : null;
      var rec = _isUuid(id)
        ? null
        : _registerPendingCreate(cid, 'observationTemplate', id, 'upsert_observation_template');
      var landedOrQueued = !rec || rec.queued;
      // Against a confirmed baseline, an unchanged starter needs no write.
      if (hasBaseline && p && landedOrQueued && !_observationTemplateChanged(p, t, pi, idx)) return;
      var payload = {
        id: id,
        body: t.text,
        defaultSentiment: t.sentiment,
        defaultContextType: t.context,
        defaultDims: t.dims || [],
        displayOrder: idx,
      };
      if (rec && !rec.queued) {
        // The create. Edits made before it lands go out as updates naming the
        // local id; they wait behind it and are re-keyed when it lands.
        payload.id = null;
        ops.push(
          window.upsertObservationTemplate(cid, payload, { entryId: rec.entryId }).then(function (res) {
            if (res && !res.error) _onCreateLanded(rec.entryId, res.data);
          }),
        );
      } else {
        ops.push(window.upsertObservationTemplate(cid, payload));
      }
    });
    prev.forEach(function (t) {
      if (!t || !t.id) return;
      var id = _resolveKnownId('observationTemplate', t.id);
      if (kept[id]) return;
      if (_isUuid(id)) {
        ops.push(window.deleteObservationTemplate(id));
        return;
      }
      var rec = _pendingCreateFor('observationTemplate', id);
      if (rec && rec.queued) ops.push(window.deleteObservationTemplate(id));
    });
    // A starter removed before its create was sent: nothing to undo on the
    // server, so forget its local id.
    /** @typedef {Record<string, Record<string, { kind?: string; queued?: boolean; localId?: string }>>} PendingCreates */
    var pending = /** @type {PendingCreates} */ (/** @type {unknown} */ (_idmap()))[cid] || {};
    Object.keys(pending).forEach(function (key) {
      var rec = pending[key];
      if (rec && rec.kind === 'observationTemplate' && !rec.queued && !kept[rec.localId]) _unregisterPendingCreate(rec);
    });
    _rememberServerState('observationTemplates', cid, arr);
    return Promise.all(ops).catch(function (err) {
      console.warn('Sentence starter sync failed for one or more rows:', err);
    });
  });
  _templateSaveQueue[cid] = _trackPendingSync(next);
  return _templateSaveQueue[cid];
}

function _newObservationTemplateId() {
  return 'ot' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* Add starters at the end of the class's list. rows: [{ text, sentiment,
   context, dims }]. Returns the new rows, or null when storage refused. */
function addObservationTemplates(cid, rows) {
  var added = (rows || [])
    .map(function (r) {
      return _cleanObservationTemplate(Object.assign({}, r, { id: _newObservationTemplateId() }));
    })
    .filter(function (t) {
      return t.text;
    });
  if (!added.length) return [];
  var ok = saveObservationTemplates(
    cid,
    /** @type {(cid: string) => ReturnType<typeof getObservationTemplates>} */ (getObservationTemplates)(cid).concat(
      added,
    ),
  );
  return ok === false ? null : added;
}

function addObservationTemplate(cid, row) {
  var added = addObservationTemplates(cid, [row]);
  return added && added.length ? added[0] : null;
}

function _templateIndex(list, cid, id) {
  var want = _resolveKnownId('observationTemplate', id);
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id || list[i].id === want || _resolveKnownId('observationTemplate', list[i].id) === want)
      return i;
  }
  return -1;
}

function updateObservationTemplate(cid, id, patch) {
  var list = /** @type {(cid: string) => ReturnType<typeof getObservationTemplates>} */ (getObservationTemplates)(
    cid,
  ).slice();
  var i = _templateIndex(list, cid, id);
  if (i < 0) return false;
  list[i] = _cleanObservationTemplate(Object.assign({}, list[i], patch || {}, { id: list[i].id }));
  return saveObservationTemplates(cid, list);
}

function removeObservationTemplate(cid, id) {
  var list = /** @type {(cid: string) => ReturnType<typeof getObservationTemplates>} */ (getObservationTemplates)(
    cid,
  ).slice();
  var i = _templateIndex(list, cid, id);
  if (i < 0) return false;
  list.splice(i, 1);
  return saveObservationTemplates(cid, list);
}

/* dir -1 moves the starter up one place, +1 down. */
function moveObservationTemplate(cid, id, dir) {
  var list = /** @type {(cid: string) => ReturnType<typeof getObservationTemplates>} */ (getObservationTemplates)(
    cid,
  ).slice();
  var i = _templateIndex(list, cid, id);
  var j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return false;
  var t = list[i];
  list[i] = list[j];
  list[j] = t;
  return saveObservationTemplates(cid, list);
}

/* The current id of a starter a page may still hold by its local id. */
function resolveObservationTemplateId(cid, id) {
  return _resolveKnownId('observationTemplate', id);
}

/* The RPCs. p_default_dims null leaves a starter's tags alone on update. */
/* p_course_id is unused by the server since starters became the teacher's. */
window.upsertObservationTemplate = function (cid, payload, options) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  payload = payload || {};
  return _writeRpc(
    'upsert_observation_template',
    _stampIdempotencyKey('upsert_observation_template', {
      p_id: _isSendableId(payload.id) ? payload.id : null,
      p_course_id: _isUuid(cid) ? cid : null,
      p_body: payload.body || '',
      p_default_sentiment: payload.defaultSentiment || null,
      p_default_context_type: payload.defaultContextType || null,
      p_display_order: payload.displayOrder != null ? Number(payload.displayOrder) : null,
      p_default_dims: Array.isArray(payload.defaultDims) ? payload.defaultDims.slice() : null,
    }),
    options,
  ).then(function (res) {
    if (res && res.error && !res.error.handledSessionExpired)
      console.warn('upsert_observation_template failed:', res.error);
    return res;
  });
};

window.deleteObservationTemplate = function (tplId) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isSendableId(tplId)) return Promise.resolve();
  return _writeRpc('delete_observation_template', { p_id: tplId }).then(function (res) {
    if (res && res.error && !res.error.handledSessionExpired)
      console.warn('delete_observation_template failed:', res.error);
    return res;
  });
};

/* Custom tag direct RPC wrappers. Used by addCustomTag/removeCustomTag-driven
   flows via _persistCustomTagsToCanonical, and exposed for direct callers. */
window.createCustomTag = function (cid, label) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(cid)) return Promise.resolve();
  return _writeRpc(
    'create_custom_tag',
    _stampIdempotencyKey('create_custom_tag', { p_course_id: cid, p_label: label || '' }),
  ).then(function (res) {
    if (res.error) console.warn('create_custom_tag failed:', res.error);
    var id = res && res.data;
    if (id && label) {
      if (!_customTagIds[cid]) _customTagIds[cid] = {};
      _customTagIds[cid][label] = id;
    }
    return res;
  });
};

function getQuickObsByDim(cid, sid, dim) {
  return getStudentQuickObs(cid, sid).filter(o => (o.dims || []).includes(dim));
}

function getAssignmentObs(cid, sid, assessId) {
  return getStudentQuickObs(cid, sid).filter(o => o.assignmentContext && o.assignmentContext.assessmentId === assessId);
}
function getStudentAssignmentFeedback(cid, sid) {
  return getStudentQuickObs(cid, sid).filter(o => !!o.assignmentContext);
}
function hasAssignmentFeedback(cid, sid, assessId) {
  return getAssignmentObs(cid, sid, assessId).length > 0;
}

/* ── Custom Tags — user-defined observation tags ─────────── */
function getCustomTags(cid) {
  if (_cache.customTags[cid] !== undefined) return _cache.customTags[cid];
  try {
    return JSON.parse(/** @type {string} */ (localStorage.getItem('gb-custom-tags-' + cid))) || [];
  } catch (e) {
    console.warn('CustomTags parse fallback:', e);
    return [];
  }
}
var _customTagSaveQueue = {};
/* Per-course label→uuid cache, populated from create_custom_tag responses.
   Lets removeCustomTag dispatch a delete_custom_tag(p_id) for tags created
   in the current session. Tags that pre-existed (loaded from server) won't
   have an entry here; those fall through to delete_custom_tag_by_label. */
var _customTagIds = {};

function saveCustomTags(cid, arr) {
  var prev = _loadPersistedCourseFieldSnapshot('customTags', cid, (_cache.customTags && _cache.customTags[cid]) || []);
  _saveCourseField('customTags', cid, arr);
  if (!_writesEnabled() || !_isUuid(cid)) return;
  if (!arr) return;
  _persistCustomTagsToCanonical(cid, prev, arr);
}

function _persistCustomTagsToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb) return;
  var tail = _customTagSaveQueue[cid] || Promise.resolve();
  var next = tail.then(function () {
    prev = _serverStateOr('customTags', cid, prev);
    arr = _cache.customTags[cid] || arr;
    _rememberServerState('customTags', cid, arr);
    var prevSet = {};
    (prev || []).forEach(function (l) {
      prevSet[l] = true;
    });
    var nextSet = {};
    (arr || []).forEach(function (l) {
      nextSet[l] = true;
    });
    var ops = [];
    // Adds — labels in next that weren't in prev.
    (arr || []).forEach(function (label) {
      if (!label || prevSet[label]) return;
      ops.push(
        _writeRpc('create_custom_tag', _stampIdempotencyKey('create_custom_tag', { p_course_id: cid, p_label: label }))
          .then(function (res) {
            if (res.error) {
              console.warn('create_custom_tag failed:', res.error);
              return;
            }
            // Cache the canonical uuid so a later remove can dispatch a
            // by-id delete rather than the label-fallback variant.
            var id = res && res.data;
            if (id) {
              if (!_customTagIds[cid]) _customTagIds[cid] = {};
              _customTagIds[cid][label] = id;
            }
          })
          .catch(function (err) {
            console.warn('Custom tag sync failed for label', label, ':', err);
          }),
      );
    });
    // Deletes — labels in prev that aren't in next.
    (prev || []).forEach(function (label) {
      if (!label || nextSet[label]) return;
      var knownId = _customTagIds[cid] && _customTagIds[cid][label];
      if (knownId && _isUuid(knownId)) {
        ops.push(
          _writeRpc('delete_custom_tag', { p_id: knownId })
            .then(function (res) {
              if (res.error) console.warn('delete_custom_tag failed:', res.error);
              else if (_customTagIds[cid]) delete _customTagIds[cid][label];
            })
            .catch(function (err) {
              console.warn('Custom tag delete sync failed for label', label, ':', err);
            }),
        );
      } else {
        // Cross-session delete: uuid not cached locally. Use the label
        // fallback so the canonical row is still removed.
        ops.push(
          _writeRpc('delete_custom_tag_by_label', { p_course_id: cid, p_label: label })
            .then(function (res) {
              if (res.error) console.warn('delete_custom_tag_by_label failed:', res.error);
            })
            .catch(function (err) {
              console.warn('Custom tag label-delete sync failed for label', label, ':', err);
            }),
        );
      }
    });
    return Promise.all(ops);
  });
  _customTagSaveQueue[cid] = _trackPendingSync(next);
  return _customTagSaveQueue[cid];
}
function addCustomTag(cid, label) {
  const tags = getCustomTags(cid);
  const norm = label.trim();
  if (!norm || tags.includes(norm)) return norm;
  tags.push(norm);
  tags.sort((a, b) => a.localeCompare(b));
  saveCustomTags(cid, tags);
  return norm;
}
function removeCustomTag(cid, label) {
  saveCustomTags(
    cid,
    getCustomTags(cid).filter(t => t !== label),
  );
}

/* ── Tag resolver — unified display info for any tag type ── */
function resolveTag(tagStr) {
  if (tagStr.startsWith('cc:')) {
    const cc = getCoreCompetency(tagStr.slice(3));
    if (cc) return { key: tagStr, label: cc.label, group: cc.group, color: cc.color, type: 'cc' };
    return { key: tagStr, label: tagStr.slice(3), group: '', color: 'var(--text-3)', type: 'cc' };
  }
  if (tagStr.startsWith('tag:')) {
    return { key: tagStr, label: tagStr.slice(4), group: 'Custom', color: '#8b5cf6', type: 'custom' };
  }
  if (OBS_LABELS[tagStr]) {
    return { key: tagStr, label: OBS_LABELS[tagStr], color: 'var(--text-2)', type: 'dim' };
  }
  return { key: tagStr, label: tagStr, group: '', color: 'var(--text-3)', type: 'unknown' };
}
