/* Rubrics: getRubrics and saveRubrics, the load and save to the server, Advanced Rubric checkboxes (moveRubricScores), printed rubrics,
   competency descriptors and deleteRubric. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ── Rubrics ───────────────────────────────────────────────── */
function getRubrics(cid) {
  if (_cache.rubrics[cid] !== undefined) return _cache.rubrics[cid];
  try {
    return JSON.parse(localStorage.getItem('gb-rubrics-' + cid)) || [];
  } catch (e) {
    console.warn('Rubrics parse fallback:', e);
    return [];
  }
}
var _rubricSaveQueue = {};
function _rubricName(rubric) {
  return (rubric && (rubric.name || rubric.title)) || '';
}
function _rubricCriteriaPayload(rubric) {
  return (rubric && rubric.criteria ? rubric.criteria : []).map(function (crit, idx) {
    var levels = crit && crit.levels ? crit.levels : {};
    var levelValues = crit && crit.levelValues ? crit.levelValues : {};
    var payload = {
      name: (crit && (crit.name || crit.label)) || '',
      level4Descriptor: levels[4] || levels['4'] || '',
      level3Descriptor: levels[3] || levels['3'] || '',
      level2Descriptor: levels[2] || levels['2'] || '',
      level1Descriptor: levels[1] || levels['1'] || '',
      weight: crit && crit.weight != null && !isNaN(Number(crit.weight)) ? Number(crit.weight) : 1,
      displayOrder:
        crit && crit.displayOrder != null && !isNaN(Number(crit.displayOrder)) ? Number(crit.displayOrder) : idx,
      linkedTagIds: crit && crit.tagIds ? crit.tagIds : [],
    };
    if (levelValues[4] != null || levelValues['4'] != null)
      payload.level4Value = Number(levelValues[4] != null ? levelValues[4] : levelValues['4']);
    if (levelValues[3] != null || levelValues['3'] != null)
      payload.level3Value = Number(levelValues[3] != null ? levelValues[3] : levelValues['3']);
    if (levelValues[2] != null || levelValues['2'] != null)
      payload.level2Value = Number(levelValues[2] != null ? levelValues[2] : levelValues['2']);
    if (levelValues[1] != null || levelValues['1'] != null)
      payload.level1Value = Number(levelValues[1] != null ? levelValues[1] : levelValues['1']);
    if (crit && _isUuid(crit.id)) payload.id = crit.id;
    // Advanced Rubrics: the checkboxes in each level cell, ordered within
    // their level. A Standard rubric sends an empty list, which clears any
    // checkboxes it had.
    var perLevel = {};
    payload.checks = (crit && crit.checks ? crit.checks : [])
      .filter(function (check) {
        return check && Number(check.level) >= 1 && Number(check.level) <= 4;
      })
      .map(function (check) {
        var level = Number(check.level);
        var at = perLevel[level] || 0;
        perLevel[level] = at + 1;
        var row = { level: level, label: String(check.label == null ? '' : check.label), displayOrder: at };
        if (_isUuid(check.id)) row.id = check.id;
        return row;
      });
    return payload;
  });
}
/* 'advanced' or 'single_point' when the rubric says so; anything else, a
   missing field included, is a Standard rubric. */
var RUBRIC_STYLES = ['standard', 'advanced', 'single_point'];
function rubricStyle(rubric) {
  return rubric && RUBRIC_STYLES.indexOf(rubric.style) > 0 ? rubric.style : 'standard';
}
async function _loadCanonicalRubrics(cid) {
  var sb = getSupabase();
  if (!sb || !_isUuid(cid) || typeof sb.from !== 'function') return [];

  var rubricsQuery = sb.from('rubric').select('id,name,created_at,copy_group,style');
  if (typeof rubricsQuery.eq === 'function') rubricsQuery = rubricsQuery.eq('course_id', cid);
  var rubricsRes = await rubricsQuery;
  if (rubricsRes.error) throw rubricsRes.error;

  var rubricRows = (rubricsRes.data || []).slice().sort(function (a, b) {
    var aKey = a.created_at || a.id || '';
    var bKey = b.created_at || b.id || '';
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  if (rubricRows.length === 0) return [];

  var rubricIds = rubricRows.map(function (r) {
    return r.id;
  });
  var criteriaQuery = sb
    .from('criterion')
    .select(
      'id,rubric_id,name,level_4_descriptor,level_3_descriptor,level_2_descriptor,level_1_descriptor,' +
        'level_4_value,level_3_value,level_2_value,level_1_value,weight,display_order',
    );
  if (typeof criteriaQuery.in === 'function') criteriaQuery = criteriaQuery.in('rubric_id', rubricIds);
  var criteriaRes = await criteriaQuery;
  if (criteriaRes.error) throw criteriaRes.error;

  var criterionRows = (criteriaRes.data || []).slice().sort(function (a, b) {
    var ao = Number(a.display_order || 0);
    var bo = Number(b.display_order || 0);
    if (ao !== bo) return ao - bo;
    return (a.id || '') < (b.id || '') ? -1 : 1;
  });
  var criterionIds = criterionRows.map(function (c) {
    return c.id;
  });

  var criterionTagRows = [];
  var criterionCheckRows = [];
  if (criterionIds.length > 0) {
    var tagsQuery = sb.from('criterion_tag').select('criterion_id,tag_id');
    if (typeof tagsQuery.in === 'function') tagsQuery = tagsQuery.in('criterion_id', criterionIds);
    var tagsRes = await tagsQuery;
    if (tagsRes.error) throw tagsRes.error;
    criterionTagRows = tagsRes.data || [];

    var checksQuery = sb.from('criterion_check').select('id,criterion_id,level,label,display_order');
    if (typeof checksQuery.in === 'function') checksQuery = checksQuery.in('criterion_id', criterionIds);
    var checksRes = await checksQuery;
    if (checksRes.error) throw checksRes.error;
    criterionCheckRows = checksRes.data || [];
  }

  // Competencies the whole rubric scores.
  var rubricTagQuery = sb.from('rubric_tag').select('rubric_id,tag_id');
  if (typeof rubricTagQuery.in === 'function') rubricTagQuery = rubricTagQuery.in('rubric_id', rubricIds);
  var rubricTagRes = await rubricTagQuery;
  if (rubricTagRes.error) throw rubricTagRes.error;

  return _canonicalRubricRowsToCache(
    rubricRows,
    criterionRows,
    criterionTagRows,
    criterionCheckRows,
    rubricTagRes.data || [],
  );
}

/* rubric, criterion, criterion_tag, criterion_check and rubric_tag rows →
   the client's rubric list. Used by the table reads above and by
   get_class_bundle. A rubric row without `style` (a bundle from before
   Advanced Rubrics) is Standard. rubric_tag rows are the competencies the
   whole rubric scores (`tagIds`); a bundle from before them has none. */
function _canonicalRubricRowsToCache(rubricRows, criterionRows, criterionTagRows, criterionCheckRows, rubricTagRows) {
  rubricRows = (rubricRows || []).slice().sort(function (a, b) {
    var aKey = a.created_at || a.id || '';
    var bKey = b.created_at || b.id || '';
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  criterionRows = (criterionRows || []).slice().sort(function (a, b) {
    var ao = Number(a.display_order || 0);
    var bo = Number(b.display_order || 0);
    if (ao !== bo) return ao - bo;
    return (a.id || '') < (b.id || '') ? -1 : 1;
  });
  criterionTagRows = criterionTagRows || [];
  var tagsByCriterion = {};
  criterionTagRows.forEach(function (row) {
    if (!row || !row.criterion_id || !row.tag_id) return;
    if (!tagsByCriterion[row.criterion_id]) tagsByCriterion[row.criterion_id] = [];
    tagsByCriterion[row.criterion_id].push(row.tag_id);
  });
  // Checkboxes in display order within their level, then by id, the order
  // _resolveRubricCriteria pairs new ones by.
  var checksByCriterion = {};
  (criterionCheckRows || [])
    .slice()
    .sort(function (a, b) {
      var ao = Number(a.display_order || 0);
      var bo = Number(b.display_order || 0);
      if (ao !== bo) return ao - bo;
      return (a.id || '') < (b.id || '') ? -1 : 1;
    })
    .forEach(function (row) {
      if (!row || !row.criterion_id || !row.id) return;
      if (!checksByCriterion[row.criterion_id]) checksByCriterion[row.criterion_id] = [];
      checksByCriterion[row.criterion_id].push({
        id: row.id,
        level: Number(row.level),
        label: row.label || '',
        displayOrder: Number(row.display_order || 0),
      });
    });

  var tagsByRubric = {};
  (rubricTagRows || []).forEach(function (row) {
    if (!row || !row.rubric_id || !row.tag_id) return;
    if (!tagsByRubric[row.rubric_id]) tagsByRubric[row.rubric_id] = [];
    tagsByRubric[row.rubric_id].push(row.tag_id);
  });

  var criteriaByRubric = {};
  criterionRows.forEach(function (row) {
    if (!row || !row.rubric_id) return;
    var levelValues = {};
    var level4Value = Number(row.level_4_value);
    var level3Value = Number(row.level_3_value);
    var level2Value = Number(row.level_2_value);
    var level1Value = Number(row.level_1_value);
    if (!isNaN(level4Value) && level4Value !== 4) levelValues[4] = level4Value;
    if (!isNaN(level3Value) && level3Value !== 3) levelValues[3] = level3Value;
    if (!isNaN(level2Value) && level2Value !== 2) levelValues[2] = level2Value;
    if (!isNaN(level1Value) && level1Value !== 1) levelValues[1] = level1Value;
    if (!criteriaByRubric[row.rubric_id]) criteriaByRubric[row.rubric_id] = [];
    criteriaByRubric[row.rubric_id].push({
      id: row.id,
      name: row.name || '',
      label: row.name || '',
      tagIds: (tagsByCriterion[row.id] || []).slice(),
      levels: {
        4: row.level_4_descriptor || '',
        3: row.level_3_descriptor || '',
        2: row.level_2_descriptor || '',
        1: row.level_1_descriptor || '',
      },
      weight: row.weight != null && !isNaN(Number(row.weight)) ? Number(row.weight) : 1,
      displayOrder: Number(row.display_order || 0),
      levelValues: Object.keys(levelValues).length ? levelValues : null,
      checks: checksByCriterion[row.id] || [],
    });
  });

  return rubricRows.map(function (row) {
    var rubric = {
      id: row.id,
      name: row.name || '',
      title: row.name || '',
      style: rubricStyle(row),
      tagIds: (tagsByRubric[row.id] || []).slice(),
      criteria: criteriaByRubric[row.id] || [],
    };
    if (row.copy_group) rubric.copyGroup = row.copy_group;
    return rubric;
  });
}

function _reconcileCanonicalRubrics(localArr, canonicalArr, idMap) {
  localArr = localArr || [];
  canonicalArr = canonicalArr || [];
  idMap = idMap || {};
  var canonicalById = {};
  canonicalArr.forEach(function (rubric) {
    if (rubric && rubric.id) canonicalById[rubric.id] = rubric;
  });
  var used = {};
  var merged = [];

  localArr.forEach(function (rubric) {
    if (!rubric) return;
    var canonicalId = idMap[rubric.id] || (_isUuid(rubric.id) ? rubric.id : null);
    var canonical = canonicalId ? canonicalById[canonicalId] : null;
    if (!canonical) {
      var matches = canonicalArr.filter(function (candidate) {
        return (
          candidate &&
          !used[candidate.id] &&
          _rubricName(candidate) === _rubricName(rubric) &&
          (candidate.criteria || []).length === (rubric.criteria || []).length
        );
      });
      if (matches.length === 1) canonical = matches[0];
    }
    if (canonical) {
      used[canonical.id] = true;
      merged.push(canonical);
    } else {
      merged.push(rubric);
    }
  });

  canonicalArr.forEach(function (rubric) {
    if (rubric && !used[rubric.id]) merged.push(rubric);
  });
  return merged;
}
/* The fields a rubric is saved with; equal signatures need no write. */
function _rubricSignature(rubric) {
  return JSON.stringify([
    _rubricName(rubric),
    _rubricCriteriaPayload(rubric),
    (rubric && rubric.copyGroup) || null,
    rubricStyle(rubric),
    _rubricWholeTagIds(rubric),
  ]);
}
/* The competencies a whole rubric scores, as saved: server ids only. */
function _rubricWholeTagIds(rubric) {
  return ((rubric && rubric.tagIds) || []).filter(_isUuid);
}
/* What the teacher typed, ids left out: a save in progress re-keys ids. */
function _rubricsContentSignature(rubrics) {
  return JSON.stringify(
    (rubrics || []).map(function (rubric) {
      return [
        _rubricName(rubric),
        _rubricCriteriaPayload(rubric).map(function (c) {
          var copy = Object.assign({}, c);
          delete copy.id;
          return copy;
        }),
      ];
    }),
  );
}

function _persistRubricsToCanonical(cid, prev, arr) {
  var tail = _rubricSaveQueue[cid] || Promise.resolve({ rubrics: arr || [], idMap: {} });
  var next = tail
    .then(async function () {
      var target = Array.isArray(arr) ? arr : [];
      // Against a confirmed baseline only changed rubrics are sent; without
      // one, every rubric is sent as before.
      var hasBaseline = _hasServerState('rubrics', cid);
      var previous = _serverStateOr('rubrics', cid, Array.isArray(prev) ? prev : []) || [];
      var sentById = {};
      previous.forEach(function (r) {
        if (r && _isUuid(r.id)) sentById[r.id] = _rubricSignature(r);
      });
      var startedWith = _rubricsContentSignature(target);
      var idMap = {};
      var keptCanonicalIds = {};
      var insertedRows = false;
      // Every upsert is pushed before any is awaited, so an offline save
      // leaves them all in the outbox.
      var ops = [];
      var landed = [];

      target.forEach(function (rubric) {
        if (!rubric) return;
        if (_isUuid(rubric.id)) keptCanonicalIds[rubric.id] = true;
        if (hasBaseline && _isUuid(rubric.id) && sentById[rubric.id] === _rubricSignature(rubric)) return;
        if (
          !_isUuid(rubric.id) ||
          (rubric.criteria || []).some(function (c) {
            return (
              !(c && _isUuid(c.id)) ||
              (c.checks || []).some(function (check) {
                return !(check && _isUuid(check.id));
              })
            );
          })
        ) {
          insertedRows = true;
        }
        // The rubric's own record, or a new criterion's or checkbox's inside
        // an existing rubric: any of them names the entry this upsert is.
        var rec = _isUuid(rubric.id) ? null : _pendingCreateFor('rubric', rubric.id);
        if (!rec) {
          (rubric.criteria || []).some(function (c) {
            if (!c) return false;
            rec = !_isUuid(c.id) ? _pendingCreateFor('criterion', c.id) : null;
            if (!rec) {
              (c.checks || []).some(function (check) {
                rec = check && !_isUuid(check.id) ? _pendingCreateFor('check', check.id) : null;
                return !!rec;
              });
            }
            return !!rec;
          });
        }
        ops.push(
          window.v2
            .upsertRubric(
              {
                id: rubric.id,
                courseId: cid,
                name: _rubricName(rubric),
                style: rubricStyle(rubric),
                criteria: _rubricCriteriaPayload(rubric),
                copyGroup: rubric.copyGroup || null,
                // null when this copy never loaded them: the server keeps its own.
                linkedTagIds: rubric && Array.isArray(rubric.tagIds) ? _rubricWholeTagIds(rubric) : null,
              },
              { entryId: rec ? rec.entryId : undefined },
            )
            .then(function (res) {
              if (res && res.error) {
                if (res.error.cancelled) return;
                throw res.error;
              }
              var canonicalId = res && res.data ? res.data : _isUuid(rubric.id) ? rubric.id : null;
              if (canonicalId) {
                keptCanonicalIds[canonicalId] = true;
                if (rubric.id && rubric.id !== canonicalId) idMap[rubric.id] = canonicalId;
              }
              // Re-keys the rubric, then reads the criteria ids back
              // (already done when the outbox reported success).
              if (rec) landed.push(_onCreateLanded(rec.entryId, res && res.data));
            }),
        );
      });

      // A rubric removed while its insert is still queued is simply not
      // inserted; one whose insert was sent is deleted by its server id.
      previous.forEach(function (oldRubric) {
        if (!oldRubric || !oldRubric.id || keptCanonicalIds[oldRubric.id]) return;
        var gone = _cancelPendingCreateOrResolve(cid, 'rubric', oldRubric.id);
        if (!gone) return;
        ops.push(
          window.v2.deleteRubric(gone).then(function (res) {
            if (res && res.error) throw res.error;
          }),
        );
      });
      await Promise.all(ops);
      await Promise.all(landed);

      if (!insertedRows) {
        // Nothing new was created, so every id the cache holds is already the
        // server's: no reload needed.
        _rememberServerState('rubrics', cid, target);
        return { rubrics: target, idMap: idMap };
      }

      var canonicalArr = await _loadCanonicalRubrics(cid);
      var reconciled = _reconcileCanonicalRubrics(target, canonicalArr, idMap);
      _rememberServerState('rubrics', cid, reconciled);
      // Only adopt the server's copy if nothing was edited while this ran; a
      // newer edit has its own save queued, which reconciles after it.
      // _rekey already swapped the new ids into the live copy, so compare
      // with those applied.
      var live = _cache.rubrics[cid];
      if (live === target && _rubricsContentSignature(live) === startedWith) {
        _saveCourseField('rubrics', cid, reconciled);
      }
      return { rubrics: reconciled, idMap: idMap };
    })
    .catch(function (err) {
      console.warn('Rubric sync to canonical RPCs failed:', err);
      if (typeof showSyncToast === 'function') {
        showSyncToast('Rubric saved locally. Cloud sync needs attention.', 'error');
      }
      return { rubrics: arr || [], idMap: {} };
    });
  _rubricSaveQueue[cid] = _trackPendingSync(next);
  return _rubricSaveQueue[cid];
}
/* Re-send a class's rubrics once, after the competencies they link to get
   their server ids (see the 'tag' re-key). Several competencies landing
   together send one save. */
var _rubricLinkResend = {};
function _resendRubricLinks(cid) {
  if (_rubricLinkResend[cid]) return;
  _rubricLinkResend[cid] = setTimeout(function () {
    delete _rubricLinkResend[cid];
    if (_isUuid(cid)) saveRubrics(cid, getRubrics(cid));
  }, 0);
}
function saveRubrics(cid, arr) {
  var nextArr = Array.isArray(arr) ? arr : [];
  var prev = _safeParseLS('gb-rubrics-' + cid, []);
  _saveCourseField('rubrics', cid, nextArr);
  if (!_writesEnabled() || !_isUuid(cid)) {
    return Promise.resolve({ rubrics: nextArr, idMap: {} });
  }
  _registerRubricRows(cid, nextArr);
  return _persistRubricsToCanonical(cid, prev, nextArr);
}
function getRubricById(cid, rubricId) {
  return getRubrics(cid).find(r => r.id === rubricId);
}

/* ── Advanced Rubric checkboxes (migrations/20261022_advanced_rubric_checks.sql)
   A tick is a rubric_check_score row: (enrollment, assessment, check). In
   the cache they are { 'sid:aid': [checkId, …] }, in localStorage under
   gb-rubric-checks-<cid>, written through the outbox with set_rubric_check
   so a tick made offline lands later. The level a tick suggests is the
   client's business (shared/rubric-checks.js); nothing here changes a score. */
function getRubricChecks(cid) {
  if (_cache.rubricChecks[cid] !== undefined) return _cache.rubricChecks[cid];
  var stored = _safeParseLS('gb-rubric-checks-' + cid, {});
  _cache.rubricChecks[cid] = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return _cache.rubricChecks[cid];
}
/* Replace every tick in a class at once, cache and localStorage only.
   Demo Mode's seed uses it; nothing is sent to the server. */
function saveRubricChecks(cid, checks) {
  checks = checks && typeof checks === 'object' && !Array.isArray(checks) ? checks : {};
  var gradesWere = _gradeBefore(cid, 'rubricChecks');
  _saveCourseField('rubricChecks', cid, checks);
  _gradeAfter(cid, gradesWere, checks);
}
/* Edit a Copy on scored work (assessment form redesign PR 10): the copy's
   criteria and checkboxes have new ids, so this assessment's rubric scores
   (with their ± and comments) and ticked checkboxes move to them. On this
   device at once, in the cache and its saved copy, so a later save sends
   nothing for the move; on the server in one transaction
   (move_rubric_scores, migrations/20261102_move_rubric_scores.sql, which checks every target is on the copied rubric
   and that rubric is in the assessment's class). Other assessments are
   untouched. maps: { rubricId, criteria: { old: new }, checks: { old: new } } */
function moveRubricScores(cid, aid, maps) {
  var crit = (maps && maps.criteria) || {};
  var chk = (maps && maps.checks) || {};
  if (!aid || !Object.keys(crit).length) return Promise.resolve({ data: 0, error: null });
  var scores = getScores(cid) || {};
  var next = {};
  Object.keys(scores).forEach(function (sid) {
    var list = scores[sid];
    next[sid] = Array.isArray(list)
      ? list.map(function (e) {
          if (!e || e.assessmentId !== aid || !crit[e.tagId]) return e;
          var to = crit[e.tagId];
          return Object.assign({}, e, { tagId: to, id: aid + ':' + to });
        })
      : list;
  });
  _saveCourseField('scores', cid, next);
  var checks = Object.assign({}, getRubricChecks(cid));
  Object.keys(checks).forEach(function (key) {
    if (key.split(':')[1] !== aid || !Array.isArray(checks[key])) return;
    checks[key] = checks[key].map(function (id) {
      return chk[id] || id;
    });
  });
  _saveCourseField('rubricChecks', cid, checks);
  _repointGradeReturns(cid, aid, crit, chk);
  if (typeof clearProfCache === 'function') clearProfCache();
  return _writeRpc('move_rubric_scores', {
    p_assessment_id: aid,
    p_rubric_id: maps.rubricId || null,
    p_criterion_map: crit,
    p_check_map: chk,
  });
}
/* The ids of the checkboxes ticked for one student on one assessment. */
function getRubricCheckIds(cid, sid, aid) {
  var list = getRubricChecks(cid)[sid + ':' + aid];
  return Array.isArray(list) ? list.slice() : [];
}
function isRubricCheckOn(cid, sid, aid, checkId) {
  return getRubricCheckIds(cid, sid, aid).indexOf(checkId) >= 0;
}
/* Tick (on) or clear (off) one checkbox. The cache changes at once; the
   server row follows when both ids can be sent. Returns the ticked ids. */
function _setRubricCheckOne(cid, sid, aid, checkId, on) {
  if (!cid || !sid || !aid || !checkId) return getRubricCheckIds(cid, sid, aid);
  var checks = getRubricChecks(cid);
  var key = sid + ':' + aid;
  var list = Array.isArray(checks[key]) ? checks[key].slice() : [];
  var i = list.indexOf(checkId);
  var changed = false;
  if (on && i < 0) {
    list.push(checkId);
    changed = true;
  } else if (!on && i >= 0) {
    list.splice(i, 1);
    changed = true;
  }
  if (!changed) return list;
  if (list.length) checks[key] = list;
  else delete checks[key];
  var gradesWere = _gradeBefore(cid, 'rubricChecks');
  _saveCourseField('rubricChecks', cid, checks);
  _gradeAfter(cid, gradesWere, checks);
  if (_writesEnabled() && _isSendableId(sid) && _isSendableId(aid) && _isSendableId(checkId)) {
    _trackPendingSync(
      _writeRpc('set_rubric_check', {
        p_enrollment_id: sid,
        p_assessment_id: aid,
        p_check_id: checkId,
        p_on: !!on,
      }).then(function (res) {
        if (res && res.error) _reportScoreWriteFailure('set_rubric_check', res.error);
      }),
    );
  }
  return list;
}

/* ── Printed rubrics (migrations/20261102_rubric_print.sql) ──────────────
   Print Rubrics records each scored student it prints: a rubric_print row
   (enrollment, assessment) with the time and a fingerprint of what the sheet
   showed (RubricPrint.fingerprint in teacher/rubric-print.js). In the cache
   they are { 'sid:aid': { at, hash } }, in localStorage under
   gb-rubric-prints-<cid>, written through the outbox with set_rubric_printed
   so a print made offline is recorded later. Nothing here changes a score. */
function getRubricPrints(cid) {
  if (_cache.rubricPrints[cid] !== undefined) return _cache.rubricPrints[cid];
  var stored = _safeParseLS('gb-rubric-prints-' + cid, {});
  _cache.rubricPrints[cid] = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return _cache.rubricPrints[cid];
}
/* One student's print of one assessment's rubric, or null. */
function getRubricPrint(cid, sid, aid) {
  var p = getRubricPrints(cid)[sid + ':' + aid];
  return p && p.at && p.hash ? { at: String(p.at), hash: String(p.hash) } : null;
}
/* Record prints, or clear them, for several students at once. `marks` is
   [{ sid, hash, at? }]; a mark with no hash clears that student's print.
   The cache changes at once; each row goes up as its own write. */
function setRubricPrints(cid, aid, marks) {
  if (!cid || !aid || !Array.isArray(marks) || !marks.length) return;
  var prints = getRubricPrints(cid);
  var sent = [];
  marks.forEach(function (m) {
    if (!m || !m.sid) return;
    var key = m.sid + ':' + aid;
    var hash = m.hash ? String(m.hash).slice(0, 64) : '';
    if (hash) {
      var at = m.at || new Date().toISOString();
      var prev = prints[key];
      if (prev && prev.at === at && prev.hash === hash) return;
      prints[key] = { at: at, hash: hash };
      sent.push({ sid: m.sid, hash: hash, at: at });
    } else {
      if (!prints[key]) return;
      delete prints[key];
      sent.push({ sid: m.sid, hash: null, at: null });
    }
  });
  if (!sent.length) return;
  _saveCourseField('rubricPrints', cid, prints);
  if (!_writesEnabled() || !_isSendableId(aid)) return;
  sent.forEach(function (m) {
    if (!_isSendableId(m.sid)) return;
    _trackPendingSync(
      _writeRpc('set_rubric_printed', {
        p_enrollment_id: m.sid,
        p_assessment_id: aid,
        p_hash: m.hash,
        p_printed_at: m.at,
      }).then(function (res) {
        if (res && res.error) _reportScoreWriteFailure('set_rubric_printed', res.error);
      }),
    );
  });
}

/* ── Competency descriptors (one teacher's own wording) ──────────────
   { competencyKey: { 1: text, 2: text, 3: text, 4: text } }, the start of a
   "From competency" draft (RubricDraft.competencyKey makes the keys). Per
   teacher, not per class: loaded once a session, kept in localStorage so
   it works offline and in Demo Mode, written through the outbox. */
var _competencyDescriptors = null;
var _competencyDescriptorsLoad = null;
function getCompetencyDescriptors() {
  if (!_competencyDescriptors) {
    var stored = _safeParseLS('gb-competency-descriptors', {});
    _competencyDescriptors = stored && typeof stored === 'object' ? stored : {};
  }
  return _competencyDescriptors;
}
function getCompetencyDescriptor(key) {
  return (key && getCompetencyDescriptors()[key]) || null;
}
/* entries: [{ key, level, text }]; an empty text forgets that level. Only
   real changes are kept and sent. */
function saveCompetencyDescriptors(entries) {
  var bank = getCompetencyDescriptors();
  var sent = [];
  (entries || []).forEach(function (e) {
    var level = e ? Number(e.level) : 0;
    if (!e || !e.key || !(level >= 1 && level <= 4)) return;
    var text = String(e.text == null ? '' : e.text)
      .trim()
      .slice(0, 2000);
    var row = bank[e.key] || {};
    if ((row[level] || '') === text) return;
    if (text) row[level] = text;
    else delete row[level];
    if (Object.keys(row).length) bank[e.key] = row;
    else delete bank[e.key];
    sent.push({ key: e.key, level: level, text: text });
  });
  if (!sent.length) return Promise.resolve({ data: 0, error: null });
  _safeLSSet('gb-competency-descriptors', JSON.stringify(bank));
  if (!_writesEnabled()) return Promise.resolve({ data: sent.length, error: null });
  return _writeRpc('save_competency_descriptors', { p_entries: sent });
}
/* The texts in saves still waiting in the outbox, which a load must not
   overwrite with the server's older copy. */
function _pendingCompetencyDescriptors() {
  var out = {};
  try {
    var q = JSON.parse(localStorage.getItem('fv-sync-queue-v1') || '{}');
    (q.entries || []).forEach(function (entry) {
      if (!entry || entry.endpoint !== 'save_competency_descriptors') return;
      ((entry.payload && entry.payload.p_entries) || []).forEach(function (e) {
        if (e && e.key) out[e.key + '|' + e.level] = e;
      });
    });
  } catch (err) {
    /* an unreadable queue only means nothing is known to be pending */
  }
  return out;
}
/* Fetch the signed-in teacher's descriptors once a session. Resolves to the
   bank either way; offline or in Demo Mode it is the stored copy. */
function loadCompetencyDescriptors() {
  if (_competencyDescriptorsLoad) return _competencyDescriptorsLoad;
  if (!_writesEnabled() || typeof getSupabase !== 'function' || !getSupabase()) {
    _competencyDescriptorsLoad = Promise.resolve(getCompetencyDescriptors());
    return _competencyDescriptorsLoad;
  }
  _competencyDescriptorsLoad = _rpcOrNoop('list_competency_descriptors', {}).then(function (res) {
    if (!res || res.error || !Array.isArray(res.data)) {
      _competencyDescriptorsLoad = null; // try again next time
      return getCompetencyDescriptors();
    }
    var bank = {};
    res.data.forEach(function (r) {
      if (!r || !r.competency_key || !r.text) return;
      if (!bank[r.competency_key]) bank[r.competency_key] = {};
      bank[r.competency_key][Number(r.level)] = r.text;
    });
    var pending = _pendingCompetencyDescriptors();
    Object.keys(pending).forEach(function (k) {
      var e = pending[k];
      var row = bank[e.key] || {};
      if (e.text) row[e.level] = e.text;
      else delete row[e.level];
      if (Object.keys(row).length) bank[e.key] = row;
      else delete bank[e.key];
    });
    _competencyDescriptors = bank;
    _safeLSSet('gb-competency-descriptors', JSON.stringify(bank));
    return bank;
  });
  return _competencyDescriptorsLoad;
}
function deleteRubric(cid, rubricId) {
  var savePromise = saveRubrics(
    cid,
    getRubrics(cid).filter(r => r.id !== rubricId),
  );
  const assessments = structuredClone(getAssessments(cid) || []);
  let changed = false;
  assessments.forEach(a => {
    if (a.rubricId === rubricId) {
      delete a.rubricId;
      changed = true;
    }
  });
  if (changed) saveAssessments(cid, assessments);
  return savePromise;
}
