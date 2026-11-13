/* Assessments: getAssessments and saveAssessments, the save to the server (create, update, delete, collab), window.duplicateAssessment,
   window.saveAssessmentTags, window.saveCollab and _cleanOrphanedScores. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

function getAssessments(cid) {
  if (_cache.assessments[cid] !== undefined) return _cache.assessments[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-assessments-' + cid)) || [];
  } catch (e) {
    console.warn('Assessments parse fallback:', e);
    return [];
  }
}
/* A piece of work loaded from the server carries the server's snake_case
   copies of some fields beside the app's own (score_mode beside scoreMode,
   and so on); the editors change only the camelCase one. Readers take the
   camelCase field and fall back to the snake_case one when it is empty, so
   a field cleared in an edit (work switched from points to proficiency,
   a due date taken off) read as it was at the load. Each snake_case copy a
   row holds is made to agree with its camelCase field; a copy the row does
   not hold is not added, and a row that already agrees is not touched. */
function _assessmentFieldsAgree(list) {
  (list || []).forEach(function (a) {
    if (!a || typeof a !== 'object') return;
    function agree(snake, value, same) {
      if (!(snake in a)) return;
      if (same ? same(a[snake], value) : (a[snake] == null ? null : a[snake]) === value) return;
      a[snake] = value;
    }
    var empty = function (v) {
      return v == null || v === '' ? null : v;
    };
    if ('scoreMode' in a) agree('score_mode', a.scoreMode || 'proficiency');
    if ('maxPoints' in a) {
      agree('max_points', a.maxPoints == null || a.maxPoints === '' ? null : Number(a.maxPoints), function (x, y) {
        return (x == null || x === '' ? null : Number(x)) === y;
      });
    }
    if (Array.isArray(a.tagIds)) {
      agree('tag_ids', a.tagIds, function (x, y) {
        return JSON.stringify(x || []) === JSON.stringify(y);
      });
    }
    if ('categoryId' in a)
      agree('category_id', empty(a.categoryId), function (x, y) {
        return empty(x) === y;
      });
    if ('dueDate' in a)
      agree('due_date', empty(a.dueDate), function (x, y) {
        return empty(x) === y;
      });
    if ('date' in a)
      agree('assigned_at', empty(a.date), function (x, y) {
        return empty(x) === y;
      });
    if ('rubricId' in a) {
      agree('rubric_id', empty(a.rubricId), function (x, y) {
        return empty(x) === y;
      });
      agree('has_rubric', !!a.rubricId);
    }
    if ('collaboration' in a) {
      agree('collab_mode', _canonicalCollabModeFromAssessment(a));
      agree('collab_config', _collabConfigFromAssessment(a), function (x, y) {
        return JSON.stringify(x || null) === JSON.stringify(y || null);
      });
    }
  });
  return list;
}

function saveAssessments(cid, arr) {
  _assessmentFieldsAgree(arr);
  var prev = _loadPersistedCourseFieldSnapshot(
    'assessments',
    cid,
    (_cache.assessments && _cache.assessments[cid]) || [],
  );
  _saveCourseField('assessments', cid, arr);
  if (_writesEnabled() && _isUuid(cid)) _registerLocalRows(cid, 'assessment', arr, 'create_assessment');
  if (arr.length < prev.length) _cleanOrphanedScores(cid, arr);
  // A class that has no server id yet is replayed by
  // _migrateCourseDataLocalToCanonical when it gets one.
  if (!_writesEnabled() || !_isUuid(cid)) return;
  if (!cid || !arr) return;
  _persistAssessmentsToCanonical(cid, prev, arr);
  // Draft and Returned: a change to a piece of work can change its rows on
  // the server with no grade saved (its scoring moved to or from DIBELS,
  // which has no Draft or Returned; the work deleted). Read them once the
  // change has landed. Nothing for a class whose student page is off.
  if (_serverKeepsRows(cid)) _refreshGradeReturnsSoon(cid);
}

/* Per-course save lock for assessments; see _studentSaveQueue for why the
   diff waits for the earlier dispatch, not the earlier answer. */
var _assessmentSaveQueue = {}; // cid → Promise of every save so far landing
var _assessmentDispatchQueue = {}; // cid → Promise of the last diff being dispatched

function _persistAssessmentsToCanonical(cid, prev, arr) {
  var sb = getSupabase();
  if (!sb) return;
  var tail = _assessmentDispatchQueue[cid] || Promise.resolve();
  var landed = null;
  var dispatched = tail.then(function () {
    var before = _serverStateOr('assessments', cid, prev);
    var after = _cache.assessments[cid] || arr;
    var prevById = {};
    before.forEach(function (a) {
      if (a && a.id) prevById[a.id] = a;
    });
    var arrById = {};
    after.forEach(function (a) {
      if (a && a.id) arrById[a.id] = a;
    });

    var ops = [];

    // Adds
    after.forEach(function (a) {
      if (a && a.id && !prevById[a.id]) {
        ops.push(_canonicalCreateAssessment(sb, cid, a));
      } else if (a && a.id) _dropUnqueuedPending('assessment', a.id);
    });
    // Deletes. A row whose create is still queued is simply not created; one
    // already sent is deleted by its server id once that is known.
    before.forEach(function (a) {
      if (!a || !a.id || arrById[a.id]) return;
      var target = _cancelPendingCreateOrResolve(cid, 'assessment', a.id);
      if (target) ops.push(_canonicalDeleteAssessment(sb, cid, target));
    });
    // Updates. An edit to a row whose create is still queued waits behind it.
    // Against a server baseline only the changed fields go, so a stale copy
    // can't revert another device's edits; without one, the whole row.
    var hasBase = _hasServerState('assessments', cid);
    after.forEach(function (a) {
      var p = a && a.id ? prevById[a.id] : null;
      if (!p || !_isSendableId(a.id)) return;
      if (_assessmentChanged(p, a)) {
        ops.push(_canonicalUpdateAssessment(sb, cid, a.id, a, hasBase ? p : null));
      }
    });

    _rememberServerState('assessments', cid, after);
    landed = Promise.all(ops).catch(function (err) {
      console.warn('Assessment sync to canonical RPCs failed for one or more rows:', err);
    });
  });
  _assessmentDispatchQueue[cid] = dispatched;
  var earlier = _assessmentSaveQueue[cid] || Promise.resolve();
  _assessmentSaveQueue[cid] = _trackPendingSync(
    Promise.all([
      earlier,
      dispatched.then(function () {
        return landed;
      }),
    ]).then(function () {}),
  );
  return _assessmentSaveQueue[cid];
}

function _assessmentChanged(a, b) {
  return (
    (a.title || '') !== (b.title || '') ||
    (a.date || '') !== (b.date || '') ||
    (a.dateAssigned || '') !== (b.dateAssigned || '') ||
    (a.dueDate || '') !== (b.dueDate || '') ||
    (a.description || '') !== (b.description || '') ||
    (a.type || '') !== (b.type || '') ||
    (a.categoryId || a.category_id || '') !== (b.categoryId || b.category_id || '') ||
    (a.scoreMode || '') !== (b.scoreMode || '') ||
    (a.collaboration || '') !== (b.collaboration || '') ||
    JSON.stringify(a.pairs || []) !== JSON.stringify(b.pairs || []) ||
    JSON.stringify(a.groups || []) !== JSON.stringify(b.groups || []) ||
    JSON.stringify(a.excludedStudents || []) !== JSON.stringify(b.excludedStudents || []) ||
    (a.groupCount || 0) !== (b.groupCount || 0) ||
    JSON.stringify(a.gradedSeparately || []) !== JSON.stringify(b.gradedSeparately || []) ||
    JSON.stringify(a.groupGradeAside || {}) !== JSON.stringify(b.groupGradeAside || {}) ||
    (a.maxPoints || 0) !== (b.maxPoints || 0) ||
    (a.weight || 1) !== (b.weight || 1) ||
    (a.evidenceType || '') !== (b.evidenceType || '') ||
    (a.notes || '') !== (b.notes || '') ||
    (a.rubricId || '') !== (b.rubricId || '') ||
    (a.moduleId || '') !== (b.moduleId || '') ||
    (a.copyGroup || '') !== (b.copyGroup || '') ||
    _coreCompetencyIdsOf(a.coreCompetencyIds).join() !== _coreCompetencyIdsOf(b.coreCompetencyIds).join() ||
    Number(a.display_order || 0) !== Number(b.display_order || 0) ||
    JSON.stringify(a.tagIds || []) !== JSON.stringify(b.tagIds || [])
  );
}

function _localCollabModeFromCanonical(mode) {
  if (mode === 'pairs') return 'pair';
  if (mode === 'groups') return 'group';
  if (mode === 'none') return 'individual';
  return mode || 'individual';
}

function _canonicalCollabModeFromAssessment(a) {
  var mode = a && (a.collaboration || a.collabMode);
  if (mode === 'pair' || mode === 'pairs') return 'pairs';
  if (mode === 'group' || mode === 'groups') return 'groups';
  return 'none';
}

function _collabConfigFromAssessment(a) {
  var config = {};
  if (a && Array.isArray(a.pairs) && a.pairs.length) config.pairs = a.pairs;
  if (a && Array.isArray(a.groups) && a.groups.length) config.groups = a.groups;
  if (a && Array.isArray(a.excludedStudents) && a.excludedStudents.length) {
    config.excludedStudents = a.excludedStudents;
  }
  // The group panel's Number of Groups, kept even before any groups are made.
  if (_canonicalCollabModeFromAssessment(a) === 'groups' && a.groupCount > 0) config.groupCount = a.groupCount;
  if (a && Array.isArray(a.gradedSeparately) && a.gradedSeparately.length) {
    config.gradedSeparately = a.gradedSeparately;
  }
  // The group's grade, kept while every member is Missing or Excused.
  if (a && a.groupGradeAside && Object.keys(a.groupGradeAside).length) config.groupGradeAside = a.groupGradeAside;
  return Object.keys(config).length ? config : null;
}

function _persistAssessmentCollab(sb, assessmentId, a) {
  if (!sb || !_isSendableId(assessmentId)) return Promise.resolve();
  var mode = _canonicalCollabModeFromAssessment(a);
  var config = mode === 'none' ? null : _collabConfigFromAssessment(a);
  return _writeRpc('save_collab', { p_id: assessmentId, p_mode: mode, p_config: config }).then(function (res) {
    if (res.error) console.warn('save_collab failed:', res.error, assessmentId);
    return res;
  });
}

/* v2 create_assessment — explicit positional params.  tagIds passed as uuid[].
   Returns the new assessment id; client patches its cached row to swap in the
   canonical uuid so subsequent saves hit update_assessment, not re-create. */
function _canonicalCreateAssessment(sb, cid, a) {
  var localId = a.id;
  var tagIds = (a.tagIds || []).filter(_isUuid);
  var params = {
    p_course_id: cid,
    p_title: a.title || '',
    p_category_id: _isUuid(a.categoryId) ? a.categoryId : null,
    p_description: a.description || null,
    p_date_assigned: a.dateAssigned || a.date || null,
    p_due_date: a.dueDate || null,
    p_score_mode: a.scoreMode || 'proficiency',
    p_max_points: a.maxPoints != null ? Number(a.maxPoints) : null,
    p_weight: a.weight != null ? Number(a.weight) : 1.0,
    p_evidence_type: a.evidenceType || null,
    p_rubric_id: _isUuid(a.rubricId) ? a.rubricId : null,
    p_module_id: _isUuid(a.moduleId) ? a.moduleId : null,
    p_tag_ids: tagIds,
  };
  // Only sent when set, so a page from before copies existed (and the
  // function before migration 20261018) keeps working unchanged.
  if (_isUuid(a.copyGroup)) params.p_copy_group = a.copyGroup;
  // Likewise only when ticked (migration 20261027).
  var coreIds = _coreCompetencyIdsOf(a.coreCompetencyIds);
  if (coreIds.length) params.p_core_competency_ids = coreIds;
  var rec = _registerPendingCreate(cid, 'assessment', localId, 'create_assessment');
  var created = _writeRpc('create_assessment', params, { entryId: rec ? rec.entryId : undefined }).then(function (res) {
    if (res.error) {
      if (!res.error.cancelled) console.warn('create_assessment failed:', res.error, a);
      return;
    }
    // Re-keys cache, gb-assessments, baseline, scores, statuses… and sends
    // what waited on the local id. Already done when the outbox reported
    // success.
    if (rec) _onCreateLanded(rec.entryId, res.data);
  });
  // Collaboration settings go right behind the create, re-keyed when it
  // lands, so they are not lost with this page. create_assessment defaults
  // to no collaboration, so only a real mode is sent.
  if (_canonicalCollabModeFromAssessment(a) !== 'none' && rec) {
    return Promise.all([created, _persistAssessmentCollab(sb, localId, a)]);
  }
  return created;
}

/* The keys of `patch` whose value differs from `basePatch`'s. */
function _changedPatch(patch, basePatch) {
  var out = {};
  Object.keys(patch).forEach(function (k) {
    if (JSON.stringify(patch[k]) !== JSON.stringify(basePatch[k])) out[k] = patch[k];
  });
  return out;
}

/* v2 update_assessment(p_id, p_patch jsonb, p_tag_ids uuid[]).
   The server leaves alone every patch key left out, and the tag set when
   p_tag_ids is left out. With `base` (the server baseline row) only what
   differs from it is sent: changed patch keys, the tag list if it changed,
   and save_collab if collaboration changed. Nothing changed, nothing sent.
   Without `base`, everything. */
function _canonicalUpdateAssessment(sb, cid, assessmentId, a, base) {
  var tagIds = (a.tagIds || []).filter(_isUuid);
  var patch = _assessmentPatchOf(a);
  var sendTags = true;
  var sendCollab = true;
  if (base) {
    patch = _changedPatch(patch, _assessmentPatchOf(base));
    sendTags = JSON.stringify(tagIds) !== JSON.stringify((base.tagIds || []).filter(_isUuid));
    sendCollab =
      _canonicalCollabModeFromAssessment(a) !== _canonicalCollabModeFromAssessment(base) ||
      JSON.stringify(_collabConfigFromAssessment(a)) !== JSON.stringify(_collabConfigFromAssessment(base));
  }
  var ops = [];
  if (Object.keys(patch).length || sendTags) {
    var params = { p_id: assessmentId, p_patch: patch };
    if (sendTags) params.p_tag_ids = tagIds;
    var updated = _writeRpc('update_assessment', params).then(function (res) {
      if (res.error) console.warn('update_assessment failed:', res.error, assessmentId);
      return res;
    });
    ops.push(updated);
  }
  // Sent alongside, not after the update lands: it sets other columns, and a
  // reload before the update landed would lose it.
  if (sendCollab) ops.push(_persistAssessmentCollab(sb, assessmentId, a));
  return Promise.all(ops);
}

function _assessmentPatchOf(a) {
  var patch = _assessmentFieldsPatchOf(a);
  // Never sent as null: a stale copy of a row from before it was linked
  // must not unlink it.
  if (_isUuid(a.copyGroup)) patch.copy_group = a.copyGroup;
  return patch;
}

function _assessmentFieldsPatchOf(a) {
  return {
    title: a.title || '',
    description: a.description || '',
    category_id: _isUuid(a.categoryId) ? a.categoryId : null,
    date_assigned: a.dateAssigned || a.date || null,
    due_date: a.dueDate || null,
    score_mode: a.scoreMode || 'proficiency',
    max_points: a.maxPoints != null ? String(a.maxPoints) : null,
    weight: a.weight != null ? String(a.weight) : '1',
    evidence_type: a.evidenceType || null,
    rubric_id: _isUuid(a.rubricId) ? a.rubricId : null,
    module_id: _isUuid(a.moduleId) ? a.moduleId : null,
    display_order: Number(a.display_order || 0),
    core_competency_ids: _coreCompetencyIdsOf(a.coreCompetencyIds),
  };
}

/* An assessment's Core Competency codes in CORE_COMPETENCIES order, each
   once, unknown codes dropped. The server refuses an unknown code. */
function _coreCompetencyIdsOf(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  return CORE_COMPETENCIES.map(function (cc) {
    return cc.id;
  }).filter(function (id) {
    return ids.indexOf(id) >= 0;
  });
}

/* v2 delete_assessment(p_id).  FK cascade handles scores/rubric_scores/
   tag_scores/assessment_tag/term_rating_assessment; observation.assessment_id
   is ON DELETE SET NULL so observations survive. */
function _canonicalDeleteAssessment(sb, cid, assessmentId) {
  return _writeRpc('delete_assessment', { p_id: assessmentId }).then(function (res) {
    if (res.error) console.warn('delete_assessment failed:', res.error, assessmentId);
  });
}

/* ── Public v2 assessment helpers (Phase 4.2) ─────────────────── */

window.duplicateAssessment = function (srcAssessmentId) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(srcAssessmentId)) return Promise.resolve();
  return _writeRpc(
    'duplicate_assessment',
    _stampIdempotencyKey('duplicate_assessment', { p_src_id: srcAssessmentId }),
  ).then(function (res) {
    if (res.error) console.warn('duplicate_assessment failed:', res.error);
    return res;
  });
};

window.saveAssessmentTags = function (assessmentId, tagIds) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(assessmentId)) return Promise.resolve();
  var ids = (tagIds || []).filter(_isUuid);
  return _writeRpc('save_assessment_tags', { p_id: assessmentId, p_tag_ids: ids }).then(function (res) {
    if (res.error) console.warn('save_assessment_tags failed:', res.error);
    return res;
  });
};

/* Collaboration panel save (§8.5). mode ∈ {none, pairs, groups}; config is
   a client-computed jsonb blob (excluded ids, random pairs, manual groups,
   etc.) — server stores it verbatim, nulled when mode='none'. */
window.saveCollab = function (assessmentId, mode, config) {
  var sb = getSupabase();
  if (!sb) return Promise.resolve();
  if (!_isUuid(assessmentId)) return Promise.resolve();
  var canonicalMode = _canonicalCollabModeFromAssessment({ collaboration: mode });
  return _writeRpc('save_collab', {
    p_id: assessmentId,
    p_mode: canonicalMode,
    p_config: canonicalMode === 'none' ? null : config || null,
  }).then(function (res) {
    if (res.error) console.warn('save_collab failed:', res.error);
    return res;
  });
};

/* Drop the scores and statuses of assessments that are gone. The server
   removes them with the assessment (delete_assessment cascades), so nothing
   is sent: one clear per student would only race the delete and fail on the
   foreign key. The local copy and the baseline both lose the rows, so the
   next save sees no difference. */
function _cleanOrphanedScores(cid, validArr) {
  var validIds = new Set(
    validArr.map(function (a) {
      return a.id;
    }),
  );
  function dropScores(blob) {
    var changed = false;
    Object.keys(blob || {}).forEach(function (sid) {
      if (!Array.isArray(blob[sid])) return;
      var before = blob[sid].length;
      blob[sid] = blob[sid].filter(function (e) {
        return validIds.has(e.assessmentId);
      });
      if (blob[sid].length !== before) changed = true;
    });
    return changed;
  }
  function dropStatuses(blob) {
    var changed = false;
    Object.keys(blob || {}).forEach(function (key) {
      var aid = key.split(':').slice(1).join(':');
      if (aid && !validIds.has(aid)) {
        delete blob[key];
        changed = true;
      }
    });
    return changed;
  }
  var scores = getScores(cid);
  if (dropScores(scores)) _saveCourseField('scores', cid, scores);
  var statuses = getAssignmentStatuses(cid);
  if (dropStatuses(statuses)) _saveCourseField('statuses', cid, statuses);
  // Ticked checkboxes and printed rubrics are keyed 'sid:aid' like statuses.
  var checks = getRubricChecks(cid);
  if (dropStatuses(checks)) _saveCourseField('rubricChecks', cid, checks);
  var prints = getRubricPrints(cid);
  if (dropStatuses(prints)) _saveCourseField('rubricPrints', cid, prints);
  var dibels = getDibelsScores(cid);
  if (dropStatuses(dibels)) _saveCourseField('dibels', cid, dibels);
  _dropGradeReturnsNotIn(cid, validIds);
  if (_hasServerState('scores', cid)) dropScores(_serverState.scores[cid]);
  if (_hasServerState('statuses', cid)) dropStatuses(_serverState.statuses[cid]);
}
