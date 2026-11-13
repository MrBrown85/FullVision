// @ts-check
/* The teacher's hand-set levels (section overrides) and the reason with each: getOverrides and saveOverrides, and the calculated level
   shown beside one after a class loads (_fillOverrideCalculated). Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

/* get_class_bundle doesn't compute grades, including the "calculated" level
   shown beside a teacher override. Work it out here, as setting an override
   does (calc.js). */
function _fillOverrideCalculated(cid) {
  var overrides = _cache.overrides[cid];
  if (!overrides || typeof getSectionProficiencyRaw !== 'function' || !COURSES[cid]) return;
  if (typeof clearProfCache === 'function') clearProfCache();
  var changed = false;
  Object.keys(overrides).forEach(function (sid) {
    Object.keys(overrides[sid] || {}).forEach(function (sectionId) {
      var o = overrides[sid][sectionId];
      if (!o || o.calculated != null) return;
      try {
        // As calc.js saves it (setSectionOverride): the printed figure.
        o.calculated = printedLevel(getSectionProficiencyRaw(cid, sid, sectionId));
        changed = true;
      } catch (e) {
        console.warn('Could not work out the calculated level for an override:', e);
      }
    });
  });
  if (changed) _persistLoadedField(cid, 'overrides', overrides);
}

function getOverrides(cid) {
  if (_cache.overrides[cid] !== undefined) return _cache.overrides[cid];
  try {
    return JSON.parse(/** @type {string} */ (localStorage.getItem('gb-overrides-' + cid))) || {};
  } catch (e) {
    console.warn('Overrides parse fallback:', e);
    return {};
  }
}
function saveOverrides(cid, obj) {
  _saveCourseField('overrides', cid, obj);
}
