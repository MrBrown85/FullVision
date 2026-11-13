/* The learning map: getLearningMap and saveLearningMap, the flat-map migration, removed sections, the save to the server (_persistLearningMapToCanonical),
   and competency groups, sections and tags. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* ══════════════════════════════════════════════════════════════════
   Learning Map — cache-through
   ══════════════════════════════════════════════════════════════════ */
/* ── Learning Map Migration — flatten section/tag hierarchy ── */
function _backupBeforeMigration(cid, field) {
  var current = _cache[field] && _cache[field][cid];
  if (current) {
    _safeLSSet('gb-mig-bak-' + field + '-' + cid, JSON.stringify({ data: current, ts: Date.now() }));
  }
}

function migrateLearningMap(map) {
  if (!map || !map.sections || map._flatVersion >= 2) return map;
  // Build sectionId → tagId mapping for override/goal/reflection migration
  var sectionToTag = {};
  map.sections.forEach(function (sec) {
    if (!sec.tags || sec.tags.length === 0) return;
    var tag = sec.tags[0];
    // Promote section properties onto the tag
    tag.color = sec.color;
    tag.subject = sec.subject;
    tag.shortName = sec.shortName;
    tag.name = sec.name;
    tag._legacySectionId = sec.id;
    // Record mapping before changing section ID
    sectionToTag[sec.id] = tag.id;
    // Section ID becomes tag ID
    sec.id = tag.id;
  });
  map._flatVersion = 2;
  map._sectionToTagMap = sectionToTag;
  return map;
}

function migrateOverridesForFlatMap(cid, sectionToTag) {
  if (!sectionToTag || Object.keys(sectionToTag).length === 0) return;
  var overrides = getOverrides(cid);
  var changed = false;
  Object.keys(overrides).forEach(function (studentId) {
    var studentOverrides = overrides[studentId];
    if (!studentOverrides) return;
    Object.keys(studentOverrides).forEach(function (key) {
      if (sectionToTag[key] && key !== sectionToTag[key]) {
        studentOverrides[sectionToTag[key]] = studentOverrides[key];
        delete studentOverrides[key];
        changed = true;
      }
    });
  });
  if (changed) saveOverrides(cid, overrides);
}

function migrateGoalsForFlatMap(cid, sectionToTag) {
  if (!sectionToTag || Object.keys(sectionToTag).length === 0) return;
  var goals = getGoals(cid);
  var changed = false;
  Object.keys(goals).forEach(function (studentId) {
    var studentGoals = goals[studentId];
    if (!studentGoals || typeof studentGoals !== 'object') return;
    Object.keys(studentGoals).forEach(function (key) {
      if (sectionToTag[key] && key !== sectionToTag[key]) {
        studentGoals[sectionToTag[key]] = studentGoals[key];
        delete studentGoals[key];
        changed = true;
      }
    });
  });
  if (changed) saveGoals(cid, goals);
}

function migrateReflectionsForFlatMap(cid, sectionToTag) {
  if (!sectionToTag || Object.keys(sectionToTag).length === 0) return;
  var reflections = getReflections(cid);
  var changed = false;
  Object.keys(reflections).forEach(function (studentId) {
    var studentRefs = reflections[studentId];
    if (!studentRefs || typeof studentRefs !== 'object') return;
    Object.keys(studentRefs).forEach(function (key) {
      if (sectionToTag[key] && key !== sectionToTag[key]) {
        studentRefs[sectionToTag[key]] = studentRefs[key];
        delete studentRefs[key];
        changed = true;
      }
    });
  });
  if (changed) saveReflections(cid, reflections);
}

function getLearningMap(cid) {
  if (_cache.learningMaps[cid]) return _cache.learningMaps[cid];
  // Not yet loaded into cache — read from localStorage as fallback
  var map;
  try {
    const custom = JSON.parse(localStorage.getItem('gb-learningmap-' + cid));
    if (custom && custom._customized) map = custom;
  } catch (e) {
    console.warn('LearningMap parse error:', e);
  }
  if (!map) map = structuredClone(_builtInLearningMap(cid));
  // Migrate old nested section/tag format to flat format
  if (!map._flatVersion || map._flatVersion < 2) {
    var sectionToTag = {};
    if (map.sections) {
      map.sections.forEach(function (sec) {
        if (sec.tags && sec.tags.length > 0) sectionToTag[sec.id] = sec.tags[0].id;
      });
    }
    if (!map._flatVersion || map._flatVersion < 2) _backupBeforeMigration(cid, 'learningMaps');
    migrateLearningMap(map);
    _cache.learningMaps[cid] = map;
    if (map._customized) saveLearningMap(cid, map);
    // Migrate overrides, goals, reflections keyed by old section IDs
    if (Object.keys(sectionToTag).length > 0) {
      migrateOverridesForFlatMap(cid, sectionToTag);
      migrateGoalsForFlatMap(cid, sectionToTag);
      migrateReflectionsForFlatMap(cid, sectionToTag);
    }
  }
  return map;
}
function saveLearningMap(cid, map) {
  var prev = _loadPersistedCourseFieldSnapshot(
    'learningMaps',
    cid,
    (_cache.learningMaps && _cache.learningMaps[cid]) || { subjects: [], sections: [] },
  );
  map._customized = true;
  map._version = (map._version || 0) + 1;
  _saveCourseField('learningMaps', cid, map);
  // The derived tag and section caches key on the map object, and a map
  // edited in place (removeCompetencies) is the same object, so drop them:
  // otherwise counts kept a removed competency.
  delete _allTagsCache[cid];
  delete _tagToSectionCache[cid];
  if (!_writesEnabled() || !_isUuid(cid)) return Promise.resolve(true);
  _registerLearningMapRows(cid, map);
  return _persistLearningMapToCanonical(cid, prev, map);
}
/* A copy of a learning map with every subject, group, section and tag given a
   new local id (references follow), so saving it inserts new rows instead of
   updating the original's. Used when duplicating a class. */
function withFreshLearningMapIds(map) {
  var copy = structuredClone(map || { subjects: [], sections: [] });
  var fresh = { subject: {}, group: {}, section: {}, tag: {} };
  function next(kind, id) {
    if (!id) return id;
    if (!fresh[kind][id]) fresh[kind][id] = uid();
    return fresh[kind][id];
  }
  (copy.subjects || []).forEach(function (sub) {
    sub.id = next('subject', sub.id);
  });
  (copy.competencyGroups || []).forEach(function (g) {
    g.id = next('group', g.id);
  });
  (copy.sections || []).forEach(function (sec) {
    sec.id = next('section', sec.id);
    if (sec.subject) sec.subject = next('subject', sec.subject);
    if (sec.groupId) sec.groupId = next('group', sec.groupId);
    if (sec.competencyGroupId) sec.competencyGroupId = next('group', sec.competencyGroupId);
    (sec.tags || []).forEach(function (tag) {
      tag.id = next('tag', tag.id);
      if (tag.subject) tag.subject = next('subject', tag.subject);
    });
    if (sec.outcome && sec.outcome.id) sec.outcome.id = next('tag', sec.outcome.id);
  });
  return copy;
}

function resetLearningMap(cid) {
  _cache.learningMaps[cid] = _builtInLearningMap(cid); // ref change auto-busts tag/section caches
  // v2: local-only reset. The legacy config_learning_maps table was dropped;
  // the structural learning-map RPCs (upsert_subject / delete_section / etc.)
  // now live under window.v2.* and are called from the UI directly.
  localStorage.removeItem('gb-learningmap-' + cid);
}
function ensureCustomLearningMap(cid) {
  // getLearningMap handles migration, so use it as the source
  var map = getLearningMap(cid);
  if (map._customized) return map;
  const clone = structuredClone(map);
  clone._customized = true;
  clone._version = 1;
  migrateLearningMap(clone);
  _saveCourseField('learningMaps', cid, clone);
  return clone;
}

/* ── Removed competencies ───────────────────────────────────
   Removing a competency takes its section out of the learning map but keeps
   it, and every score tied to it, on the server (section.removed_at). This
   device keeps the removed sections it knows of, so Re-link can say "you
   removed this earlier" and put one back; listRemovedSections fills in the
   ones removed on another device.
   [{ section, removedAt }], newest first. */
function getRemovedSections(cid) {
  var list = _safeParseLS('gb-removed-sections-' + cid, []);
  return Array.isArray(list) ? list : [];
}

function _saveRemovedSections(cid, list) {
  try {
    localStorage.setItem('gb-removed-sections-' + cid, JSON.stringify(list || []));
  } catch (e) {
    /* storage full: the server still has them */
  }
}

/* Merge the server's removed sections into this device's list. */
function mergeRemovedSectionsFromServer(cid, rows) {
  if (!Array.isArray(rows)) return getRemovedSections(cid);
  var list = getRemovedSections(cid);
  var have = {};
  list.forEach(function (r) {
    if (r && r.section) have[r.section.id] = true;
  });
  rows.forEach(function (r) {
    if (!r || have[r.id]) return;
    list.push({
      section: {
        id: r.id,
        name: r.name,
        subject: r.subject_id,
        groupId: r.competency_group_id || null,
        tags: (r.tags || []).map(function (t) {
          return {
            id: t.id,
            code: t.code,
            label: t.label,
            text: t.i_can_text || '',
            i_can_statements: t.i_can_statements || [],
            source_text: t.source_text || null,
            bank_id: t.bank_id || null,
          };
        }),
      },
      removedAt: r.removed_at,
    });
  });
  _saveRemovedSections(cid, list);
  return list;
}

/* Remove competencies (section ids) from the class. Their scores stay. */
function removeCompetencies(cid, sectionIds) {
  var ids = {};
  (sectionIds || []).forEach(function (id) {
    ids[resolveLearningMapId(cid, 'section', id)] = true;
  });
  var map = ensureCustomLearningMap(cid);
  var all = map.sections || [];
  var taken = all.filter(function (s) {
    return ids[s.id];
  });
  if (!taken.length) return 0;
  // Where each one sat: the competencies that came after it (removed with
  // it or not) and its index, so putting it back returns it to its place.
  var place = {};
  all.forEach(function (s, i) {
    if (!ids[s.id]) return;
    place[s.id] = {
      index: i,
      beforeIds: all.slice(i + 1, i + 31).map(function (x) {
        return x.id;
      }),
    };
  });
  map.sections = all.filter(function (s) {
    return !ids[s.id];
  });
  var now = new Date().toISOString();
  var list = getRemovedSections(cid).filter(function (r) {
    return !(r && r.section && ids[r.section.id]);
  });
  _saveRemovedSections(
    cid,
    taken
      .map(function (s) {
        return {
          section: structuredClone(s),
          removedAt: now,
          index: place[s.id].index,
          beforeIds: place[s.id].beforeIds,
        };
      })
      .concat(list),
  );
  saveLearningMap(cid, map);
  return taken.length;
}

/* Put a removed competency back, with its scores. */
function restoreCompetency(cid, sectionId) {
  var list = getRemovedSections(cid);
  var entry = list.find(function (r) {
    return r && r.section && r.section.id === sectionId;
  });
  if (!entry) return false;
  var map = ensureCustomLearningMap(cid);
  var secs = map.sections || [];
  if (
    !secs.some(function (s) {
      return s.id === sectionId;
    })
  ) {
    // Back in its place: before the first competency that followed it and
    // is still there, else at its old position, else at the end (removed
    // before places were kept).
    var at = -1;
    (entry.beforeIds || []).some(function (id) {
      var before = resolveLearningMapId(cid, 'section', id);
      at = secs.findIndex(function (s) {
        return s.id === before;
      });
      return at >= 0;
    });
    if (at < 0 && typeof entry.index === 'number') at = Math.min(entry.index, secs.length);
    if (at < 0) at = secs.length;
    map.sections = secs.slice(0, at).concat([structuredClone(entry.section)], secs.slice(at));
  }
  _saveRemovedSections(
    cid,
    list.filter(function (r) {
      return r !== entry;
    }),
  );
  if (_writesEnabled() && _isUuid(sectionId) && window.v2 && window.v2.restoreSection)
    window.v2.restoreSection(sectionId);
  saveLearningMap(cid, map);
  return true;
}

var _learningMapSaveQueue = {};
// Local id -> server UUID re-keys learned by earlier learning-map saves, per
// course. A save queued before an earlier one resolved still holds the local
// ids; without applying these it inserts a second copy of every row.
var _learningMapIdRemap = {};

/* The current id of a learning-map row the page may still know by its local
   id: the class manager renders a new subject, group or standard before its
   server id comes back, and its inputs keep the old id until the next render. */
function resolveLearningMapId(cid, kind, id) {
  var known = _learningMapIdRemap[cid];
  return (known && known[kind] && known[kind][id]) || id;
}

function _mapItemsById(items) {
  var out = {};
  (items || []).forEach(function (item) {
    if (item && item.id) out[item.id] = item;
  });
  return out;
}

function _learningMapTags(map) {
  var out = [];
  (map && map.sections ? map.sections : []).forEach(function (section) {
    (section.tags || (section.outcome ? [section.outcome] : [])).forEach(function (tag, idx) {
      if (!tag) return;
      out.push({ tag: tag, section: section, displayOrder: idx });
    });
  });
  return out;
}

/* Swap one id of one kind inside a learning map. Returns whether anything
   changed. Kind matters: in the flat map a section and its tag share an id. */
function _patchLearningMapEntityId(map, kind, oldId, newId) {
  if (!map || !oldId || !newId || oldId === newId) return false;
  var changed = false;
  function swap(obj, prop) {
    if (obj && obj[prop] === oldId) {
      obj[prop] = newId;
      changed = true;
    }
  }
  if (kind === 'subject') {
    (map.subjects || []).forEach(function (subject) {
      swap(subject, 'id');
    });
    (map.sections || []).forEach(function (section) {
      swap(section, 'subject');
      (section.tags || []).forEach(function (tag) {
        swap(tag, 'subject');
      });
    });
  } else if (kind === 'group') {
    (map.competencyGroups || []).forEach(function (group) {
      swap(group, 'id');
    });
    (map.sections || []).forEach(function (section) {
      swap(section, 'groupId');
      swap(section, 'competencyGroupId');
    });
  } else if (kind === 'section') {
    (map.sections || []).forEach(function (section) {
      swap(section, 'id');
    });
  } else if (kind === 'tag') {
    (map.sections || []).forEach(function (section) {
      swap(section.outcome, 'id');
      (section.tags || []).forEach(function (tag) {
        swap(tag, 'id');
      });
    });
  }
  return changed;
}

/* A competency's I Can statements as a clean list: trimmed, no blanks. */
function _iCanStatementsOf(tag) {
  var list = (tag && (tag.i_can_statements || tag.iCanStatements)) || [];
  return Array.isArray(list)
    ? list
        .map(function (s) {
          return String(s || '').trim();
        })
        .filter(Boolean)
    : [];
}

function _stringifyICanText(tag) {
  if (!tag) return '';
  if (typeof tag.text === 'string') return tag.text;
  if (typeof tag.iCanText === 'string') return tag.iCanText;
  if (typeof tag.i_can_text === 'string') return tag.i_can_text;
  if (Array.isArray(tag.i_can_statements)) return tag.i_can_statements.join('\n');
  if (Array.isArray(tag.iCanStatements)) return tag.iCanStatements.join('\n');
  return '';
}

/* The fields each learning-map row is saved with, as sent to the upsert RPCs,
   keyed by row id. Two maps with the same signature for a row need no write. */
function _learningMapSignatures(map) {
  var out = { group: {}, subject: {}, section: {}, tag: {} };
  if (!map) return out;
  (map.competencyGroups || []).forEach(function (g, gi) {
    if (!g) return;
    out.group[g.id] = JSON.stringify([
      g.name || '',
      g.color || null,
      g.displayOrder != null ? Number(g.displayOrder) : gi,
      g.countsAsOne !== false,
    ]);
  });
  (map.subjects || []).forEach(function (sub, si) {
    if (!sub) return;
    out.subject[sub.id] = JSON.stringify([
      sub.name || '',
      sub.color || null,
      sub.displayOrder != null ? Number(sub.displayOrder) : Number(sub.sortOrder || si),
    ]);
  });
  (map.sections || []).forEach(function (sec, xi) {
    if (!sec) return;
    out.section[sec.id] = JSON.stringify([
      sec.subject,
      sec.name || sec.shortName || '',
      sec.color || null,
      sec.groupId || sec.competencyGroupId || null,
      sec.displayOrder != null ? Number(sec.displayOrder) : Number(sec.sortOrder || xi),
    ]);
    (sec.tags || (sec.outcome ? [sec.outcome] : [])).forEach(function (tag, ti) {
      if (!tag) return;
      out.tag[tag.id] = JSON.stringify([
        sec.id,
        tag.label || tag.name || sec.name || '',
        tag.code || tag.shortName || '',
        _stringifyICanText(tag),
        _iCanStatementsOf(tag),
        tag.source_text || null,
        tag.bank_id || null,
        tag.displayOrder != null ? Number(tag.displayOrder) : Number(tag.sortOrder || ti),
      ]);
    });
  });
  return out;
}

function _persistLearningMapToCanonical(cid, prevMap, nextMap) {
  if (!window.v2 || !window.v2.upsertSubject || !window.v2.upsertSection || !window.v2.upsertTag) return;
  var tail = _learningMapSaveQueue[cid] || Promise.resolve();
  var next = tail.then(async function () {
    var map = structuredClone(nextMap || { subjects: [], sections: [] });
    // Against a confirmed baseline, rows whose saved fields haven't changed
    // are skipped; without one, every row is sent as before.
    var hasBaseline = _hasServerState('learningMaps', cid);
    var baseline = _serverStateOr('learningMaps', cid, prevMap);
    var sent = hasBaseline ? _learningMapSignatures(baseline) : null;
    var current = hasBaseline ? _learningMapSignatures(map) : null;
    function unchanged(kind, id) {
      return !!(sent && _isUuid(id) && sent[kind][id] !== undefined && sent[kind][id] === current[kind][id]);
    }
    if (!_learningMapIdRemap[cid]) _learningMapIdRemap[cid] = { subject: {}, group: {}, section: {}, tag: {} };
    var known = _learningMapIdRemap[cid];
    function applyKnown(target) {
      ['group', 'subject', 'section', 'tag'].forEach(function (kind) {
        Object.keys(known[kind]).forEach(function (oldId) {
          _patchLearningMapEntityId(target, kind, oldId, known[kind][oldId]);
        });
      });
    }
    applyKnown(map);
    // Every row is pushed before any is awaited, so an offline save leaves
    // the whole map in the outbox, not just its first row. A row that names
    // a parent still on a local id (a section under a new subject, a tag
    // under a new section) waits in the outbox behind that parent's insert
    // and is re-keyed when it lands; nothing here threads ids by hand.
    var ops = [];
    function upsert(kind, localId, send) {
      var rec = _isUuid(localId) ? null : _pendingCreateFor(kind, localId);
      ops.push(
        send({ entryId: rec ? rec.entryId : undefined }).then(function (res) {
          if (res && res.error) {
            if (res.error.cancelled) return;
            throw res.error;
          }
          if (rec) _onCreateLanded(rec.entryId, res && res.data);
        }),
      );
    }

    var groups = map.competencyGroups || [];
    if (window.v2.upsertCompetencyGroup) {
      groups.forEach(function (group, gi) {
        if (!group || unchanged('group', group.id)) return;
        upsert('group', group.id, function (options) {
          return window.v2.upsertCompetencyGroup(
            {
              id: _isUuid(group.id) ? group.id : null,
              courseId: cid,
              name: group.name || '',
              color: group.color || null,
              displayOrder: group.displayOrder != null ? Number(group.displayOrder) : gi,
              countsAsOne: group.countsAsOne !== false,
            },
            options,
          );
        });
      });
    }

    (map.subjects || []).forEach(function (subject, si) {
      if (!subject || unchanged('subject', subject.id)) return;
      upsert('subject', subject.id, function (options) {
        return window.v2.upsertSubject(
          {
            id: _isUuid(subject.id) ? subject.id : null,
            courseId: cid,
            name: subject.name || '',
            color: subject.color || null,
            displayOrder: subject.displayOrder != null ? Number(subject.displayOrder) : Number(subject.sortOrder || si),
          },
          options,
        );
      });
    });

    (map.sections || []).forEach(function (section, xi) {
      if (!section) return;
      if (!unchanged('section', section.id)) {
        upsert('section', section.id, function (options) {
          return window.v2.upsertSection(
            {
              id: _isUuid(section.id) ? section.id : null,
              subjectId: section.subject,
              name: section.name || section.shortName || '',
              color: section.color || null,
              competencyGroupId: section.groupId || section.competencyGroupId || null,
              displayOrder:
                section.displayOrder != null ? Number(section.displayOrder) : Number(section.sortOrder || xi),
            },
            options,
          );
        });
      }
      var tags = section.tags || (section.outcome ? [section.outcome] : []);
      tags.forEach(function (tag, ti) {
        if (!tag || unchanged('tag', tag.id)) return;
        upsert('tag', tag.id, function (options) {
          return window.v2.upsertTag(
            {
              id: _isUuid(tag.id) ? tag.id : null,
              sectionId: section.id,
              label: tag.label || tag.name || section.name || '',
              code: tag.code || tag.shortName || '',
              iCanText: _stringifyICanText(tag),
              iCanStatements: _iCanStatementsOf(tag),
              sourceText: tag.source_text || null,
              bankId: tag.bank_id || null,
              displayOrder: tag.displayOrder != null ? Number(tag.displayOrder) : Number(tag.sortOrder || ti),
            },
            options,
          );
        });
      });
    });

    var opsToDelete = [];
    var nextSubjects = _mapItemsById(map.subjects || []);
    var nextGroups = _mapItemsById(map.competencyGroups || []);
    var nextSections = _mapItemsById(map.sections || []);
    var nextTags = _mapItemsById(
      _learningMapTags(map).map(function (entry) {
        return entry.tag;
      }),
    );
    var prevSubjects = _mapItemsById((baseline && baseline.subjects) || []);
    var prevGroups = _mapItemsById((baseline && baseline.competencyGroups) || []);
    var prevSections = _mapItemsById((baseline && baseline.sections) || []);
    var prevTags = _mapItemsById(
      _learningMapTags(baseline || {}).map(function (entry) {
        return entry.tag;
      }),
    );

    // A removed competency (getRemovedSections) is kept on the server with
    // its scores: its section is marked removed, and its tags stay.
    var softRemoved = {};
    getRemovedSections(cid).forEach(function (r) {
      if (r && r.section) softRemoved[r.section.id] = true;
    });
    var keptTags = {};
    ((baseline && baseline.sections) || []).forEach(function (sec) {
      if (!softRemoved[sec.id]) return;
      (sec.tags || []).forEach(function (t) {
        if (t) keptTags[t.id] = true;
      });
    });
    // A row removed while its insert is still queued is simply not inserted;
    // one whose insert was sent is deleted by its server id.
    [
      ['tag', prevTags, nextTags, window.v2.deleteTag],
      ['section', prevSections, nextSections, window.v2.deleteSection],
      ['group', prevGroups, nextGroups, window.v2.deleteCompetencyGroup],
      ['subject', prevSubjects, nextSubjects, window.v2.deleteSubject],
    ].forEach(function (pair) {
      Object.keys(pair[1]).forEach(function (id) {
        if (pair[2][id]) return;
        if (pair[0] === 'tag' && keptTags[id]) return;
        var gone = _cancelPendingCreateOrResolve(cid, pair[0], id);
        if (!gone) return;
        if (pair[0] === 'section' && softRemoved[id]) {
          if (window.v2.removeSection) opsToDelete.push(window.v2.removeSection(gone));
          return;
        }
        if (pair[3]) opsToDelete.push(pair[3](gone));
      });
    });
    opsToDelete.forEach(function (op) {
      ops.push(
        op.then(function (res) {
          if (res && res.error) throw res.error;
        }),
      );
    });
    await Promise.all(ops);

    // Inserts re-keyed the live map as they landed (_rekey). The baseline is
    // this save's copy with those ids, not the live map: replacing it with
    // the live one would hide anything edited while the sync was running.
    applyKnown(map);
    _rememberServerState('learningMaps', cid, map);
    return true;
  });
  // Resolves true once the map reached the server, false if it failed.
  _learningMapSaveQueue[cid] = _trackPendingSync(
    next.catch(function (err) {
      console.warn('Learning map sync to canonical RPCs failed:', err);
      if (typeof showSyncToast === 'function') {
        showSyncToast('Learning map saved locally. Cloud sync needs attention.', 'error');
      }
      return false;
    }),
  );
  return _learningMapSaveQueue[cid];
}

/* ── Competency Groups ─────────────────────────────────────── */
function getCompetencyGroups(cid) {
  return getLearningMap(cid).competencyGroups || [];
}
function saveCompetencyGroups(cid, groups) {
  var map = ensureCustomLearningMap(cid);
  map.competencyGroups = groups;
  saveLearningMap(cid, map);
}
function getCompetencyGroupById(cid, gid) {
  return getCompetencyGroups(cid).find(g => g.id === gid);
}
function setSectionGroup(cid, sectionId, groupId) {
  var map = ensureCustomLearningMap(cid);
  var sec = (map.sections || []).find(s => s.id === sectionId);
  if (!sec) return;
  if (groupId) sec.groupId = groupId;
  else delete sec.groupId;
  saveLearningMap(cid, map);
}
function getGroupedSections(cid) {
  var groups = getCompetencyGroups(cid)
    .slice()
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  var sections = getSections(cid);
  var groupMap = {};
  groups.forEach(g => {
    groupMap[g.id] = { group: g, sections: [] };
  });
  var ungrouped = [];
  sections.forEach(sec => {
    if (sec.groupId && groupMap[sec.groupId]) groupMap[sec.groupId].sections.push(sec);
    else ungrouped.push(sec);
  });
  return { groups: groups.map(g => groupMap[g.id]), ungrouped: ungrouped };
}
function addCustomSection(cid, opts) {
  var map = ensureCustomLearningMap(cid);
  var id = 'custom_' + uid();
  var sub = map.subjects && map.subjects[0] ? map.subjects[0].id : '';
  var color = map.subjects && map.subjects[0] ? map.subjects[0].color : '#6366f1';
  var sec = {
    id: id,
    subject: opts.subject || sub,
    name: opts.label || 'Custom Standard',
    shortName: opts.label || 'Custom',
    color: opts.color || color,
    _custom: true,
    tags: [
      {
        id: id,
        label: opts.label || 'Custom Standard',
        text: opts.text || '',
        color: opts.color || color,
        subject: opts.subject || sub,
        name: opts.label || 'Custom Standard',
        shortName: opts.label || 'Custom',
        i_can_statements: opts.i_can_statements || [],
      },
    ],
  };
  if (opts.groupId) sec.groupId = opts.groupId;
  if (!map.sections) map.sections = [];
  map.sections.push(sec);
  saveLearningMap(cid, map);
  return sec;
}
function removeSection(cid, sectionId) {
  var map = ensureCustomLearningMap(cid);
  var sec = (map.sections || []).find(s => s.id === sectionId);
  if (!sec || !sec._custom) return false;
  map.sections = map.sections.filter(s => s.id !== sectionId);
  saveLearningMap(cid, map);
  return true;
}

/* ── Helpers: get sections/tags for a course ─────────────────── */
function getSections(cid) {
  var map = getLearningMap(cid);
  if (map.sections && map.sections.length) return map.sections;
  if (map.outcomes && map.outcomes.length) {
    return map.outcomes.map(function (tag) {
      return {
        id: tag.id,
        subject: tag.subject,
        name: tag.name || tag.label || tag.id,
        shortName: tag.shortName || tag.label || tag.id,
        color: tag.color,
        tags: [tag],
        outcome: tag,
      };
    });
  }
  return [];
}
function getSubjects(cid) {
  var map = getLearningMap(cid);
  return map.subjects || [];
}

// Cached flat tag list — keyed by learning map object reference so any direct
// write to _cache.learningMaps[cid] (including test setup) naturally busts the cache.
var _allTagsCache = {}; // cid → { mapRef, tags }
function getAllTags(cid) {
  const map = getLearningMap(cid);
  const c = _allTagsCache[cid];
  if (c && c.mapRef === map) return c.tags;
  const sections = getSections(cid);
  const tags = sections.flatMap(function (s) {
    return s.tags || (s.outcome ? [s.outcome] : []);
  });
  _allTagsCache[cid] = { mapRef: map, tags };
  return tags;
}
function getTagById(cid, tagId) {
  return getAllTags(cid).find(t => t.id === tagId);
}

// Cached tag→section index — O(1) lookup vs O(sections × tags) find() per call.
// getFocusAreas() calls this once per tag; without the index it was O(tags² × sections).
// Same reference-based invalidation as _allTagsCache.
var _tagToSectionCache = {}; // cid → { mapRef, index: { tagId: section } }
function getSectionForTag(cid, tagId) {
  const map = getLearningMap(cid);
  const c = _tagToSectionCache[cid];
  if (!c || c.mapRef !== map) {
    const index = {};
    getSections(cid).forEach(function (s) {
      (s.tags || (s.outcome ? [s.outcome] : [])).forEach(function (t) {
        index[t.id] = s;
      });
    });
    _tagToSectionCache[cid] = { mapRef: map, index };
  }
  return _tagToSectionCache[cid].index[tagId];
}
