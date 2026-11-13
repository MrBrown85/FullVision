// @ts-check
/* Student profile summaries: getStudentProfileSummaries and loadStudentProfileSummaries, the rows they are read from, and how a summary
   fills the roster, flags, goals, reflections, hand-set levels and notes. Moved from shared/data.js on 2026-11-12 (S19 split, move only). */

function _normalizeProfileObservations(observations) {
  return (observations || [])
    .map(function (ob) {
      return {
        id: ob.id || ob.observation_id || uid(),
        text: ob.text || '',
        dims: ob.dims || [],
        sentiment: ob.sentiment || null,
        context: ob.context || null,
        created: ob.created || ob.created_at || ob.observed_at || new Date().toISOString(),
        date: _localDayOf(ob.date || ob.observed_at || ob.created || ob.created_at),
      };
    })
    .filter(function (ob) {
      return !!ob.text;
    });
}

function _normalizeStudentProfileSummary(row) {
  row = row || {};
  var student = row.student || {};
  var enrollment = row.enrollment || {};
  var enrollmentId =
    enrollment.id ||
    enrollment.enrollment_id ||
    row.enrollment_id ||
    student.id ||
    student.enrollment_id ||
    row.id ||
    null;
  var personId = student.student_id || student.id || row.student_id || null;
  return {
    id: enrollmentId,
    student: {
      id: enrollmentId,
      personId: personId,
      firstName: student.first_name || student.firstName || '',
      lastName: student.last_name || student.lastName || '',
      preferred:
        student.preferred_name || student.preferred || student.preferred_first_name || student.preferredFirstName || '',
      pronouns: student.pronouns || '',
      studentNumber: student.student_number || student.studentNumber || '',
      email: student.email || '',
      dateOfBirth: student.date_of_birth || student.dateOfBirth || '',
      designations: student.designations || enrollment.designations || [],
      sortName:
        student.sort_name ||
        ((student.last_name || student.lastName || '') + ' ' + (student.first_name || student.firstName || '')).trim(),
    },
    enrollment: {
      id: enrollmentId,
      rosterPosition: Number(enrollment.roster_position || enrollment.rosterPosition || 0),
      isFlagged: !!(row.is_flagged ?? row.isFlagged ?? enrollment.is_flagged ?? enrollment.isFlagged),
    },
    overallProficiency:
      row.overall_proficiency != null
        ? Number(row.overall_proficiency)
        : row.overallProficiency != null
          ? Number(row.overallProficiency)
          : null,
    letter: row.letter || null,
    counts: row.counts || {},
    goals: row.goals || {},
    reflections: row.reflections || {},
    sectionOverrides: row.section_overrides || row.sectionOverrides || {},
    notes: row.notes || [],
    isFlagged: !!(row.is_flagged ?? row.isFlagged ?? enrollment.is_flagged ?? enrollment.isFlagged),
    recentObservations: _normalizeProfileObservations(row.recent_observations || row.recentObservations),
  };
}

function _applyStudentProfileSummaries(cid, rows) {
  var summaries = {};
  var flags = {};
  var goals = {};
  var reflections = {};
  var overrides = {};
  var notes = {};
  /** @type {Record<string, unknown> | null} */
  var noteIds = null;

  (rows || []).forEach(function (row) {
    var summary = _normalizeStudentProfileSummary(row);
    if (!summary.id) return;
    // get_student_profile returns note rows with ids; list_course_student_profiles
    // has no notes at all and must not wipe ids learned earlier.
    if (row && row.notes !== undefined) {
      if (!noteIds) noteIds = {};
      noteIds[summary.id] = (summary.notes || [])
        .map(function (note) {
          return note && note.id;
        })
        .filter(_isUuid);
    }
    summaries[summary.id] = summary;
    if (summary.isFlagged) flags[summary.id] = true;
    if (summary.goals && Object.keys(summary.goals).length > 0) goals[summary.id] = summary.goals;
    if (summary.reflections && Object.keys(summary.reflections).length > 0)
      reflections[summary.id] = summary.reflections;
    if (summary.sectionOverrides && Object.keys(summary.sectionOverrides).length > 0) {
      overrides[summary.id] = summary.sectionOverrides;
    }
    if (Array.isArray(summary.notes) && summary.notes.length > 0) {
      notes[summary.id] = summary.notes
        .map(function (note) {
          return note.body || note.text || '';
        })
        .filter(Boolean)
        .join('\n\n');
    }
  });

  var students = (_cache.students[cid] || []).map(function (student) {
    var summary = summaries[student.id];
    if (!summary || !summary.student) return student;
    return Object.assign({}, student, {
      personId: summary.student.personId || student.personId || null,
      firstName: summary.student.firstName || student.firstName || '',
      lastName: summary.student.lastName || student.lastName || '',
      preferred: summary.student.preferred || student.preferred || '',
      pronouns: summary.student.pronouns || student.pronouns || '',
      studentNumber: summary.student.studentNumber || student.studentNumber || '',
      email: summary.student.email || student.email || '',
      dateOfBirth: summary.student.dateOfBirth || student.dateOfBirth || '',
      designations: summary.student.designations || student.designations || [],
      sortName: summary.student.sortName || student.sortName || '',
      rosterPosition:
        summary.enrollment && summary.enrollment.rosterPosition != null
          ? summary.enrollment.rosterPosition
          : student.rosterPosition,
      isFlagged: summary.isFlagged,
    });
  });
  if (students.length > 0) _persistLoadedField(cid, 'students', students);
  _persistLoadedField(cid, 'studentProfileSummaries', summaries);
  _persistLoadedField(cid, 'flags', flags);
  _persistLoadedField(cid, 'goals', goals);
  _persistLoadedField(cid, 'reflections', reflections);
  _persistLoadedField(cid, 'overrides', overrides);
  if (Object.keys(notes).length > 0) _persistLoadedField(cid, 'notes', notes);
  if (noteIds) _noteIds[cid] = Object.assign(_noteIds[cid] || {}, noteIds);
  return summaries;
}

function getStudentProfileSummaries(cid) {
  if (_cache.studentProfileSummaries[cid] !== undefined) return _cache.studentProfileSummaries[cid];
  try {
    return JSON.parse(/** @type {string} */ (localStorage.getItem('gb-student-profile-summaries-' + cid))) || {};
  } catch (e) {
    console.warn('Student profile summaries parse fallback:', e);
    return {};
  }
}

function _goalRowsToSummaryMap(rows) {
  var out = {};
  (rows || []).forEach(function (row) {
    var sectionId = row.section_id || row.sectionId;
    if (sectionId) out[sectionId] = row.body || row.text || '';
  });
  return out;
}

function _reflectionRowsToSummaryMap(rows) {
  var out = {};
  (rows || []).forEach(function (row) {
    var sectionId = row.section_id || row.sectionId;
    if (!sectionId) return;
    out[sectionId] = {
      confidence: row.confidence || 0,
      text: row.body || row.text || '',
      date: row.updated_at || row.date || '',
    };
  });
  return out;
}

function _overrideMapFromCompetencyTree(tree) {
  var out = {};
  ((tree && tree.subjects) || []).forEach(function (subject) {
    (subject.sections || []).forEach(function (section) {
      var override = section.override;
      if (!override || !section.id) return;
      out[section.id] = {
        level: override.level || 0,
        reason: override.reason || '',
        date: override.updated_at || override.date || '',
        // Worked out on the client (_fillOverrideCalculated); the server no
        // longer calculates levels.
        calculated: null,
      };
    });
  });
  return out;
}

function _studentProfileToSummaryRow(profile) {
  profile = _rpcObject(profile) || profile || {};
  var enrollment = profile.enrollment || {};
  return {
    student: profile.student || {},
    enrollment: enrollment,
    overall_proficiency: profile.overall_proficiency,
    letter: profile.letter,
    counts: profile.counts || {},
    goals: _goalRowsToSummaryMap(profile.goals),
    reflections: _reflectionRowsToSummaryMap(profile.reflections),
    section_overrides: _overrideMapFromCompetencyTree(profile.competency_tree),
    notes: profile.notes || [],
    is_flagged: !!(enrollment.is_flagged || enrollment.isFlagged),
    recent_observations: profile.recent_observations || [],
  };
}

async function _loadStudentProfileSummariesIndividually(cid) {
  var students = _cache.students[cid] || [];
  var rows = [];
  var batchSize = 6;
  // Each per-student fetch is bounded by a 30s timeout so a single hung
  // get_student_profile call cannot stall sign-in indefinitely. Timed-out
  // entries surface as { error: ... } below, same as the .catch() branch.
  var perCallTimeoutMs = 30_000;
  for (var i = 0; i < students.length; i += batchSize) {
    var batch = students.slice(i, i + batchSize);
    var results = await Promise.all(
      batch.map(function (student) {
        if (!student || !_isUuid(student.id)) {
          return Promise.resolve(null);
        }
        return _withTimeout(
          window.v2.getStudentProfile(student.id).catch(function (e) {
            return { error: e };
          }),
          perCallTimeoutMs,
          'get_student_profile(' + student.id + ')',
        );
      }),
    );
    results.forEach(function (res) {
      if (!res || res.error) {
        if (res && res.error && !_isMissingRpcError(res.error)) console.warn('get_student_profile failed:', res.error);
        return;
      }
      rows.push(_studentProfileToSummaryRow(res.data !== undefined ? res.data : res));
    });
  }
  return _applyStudentProfileSummaries(cid, rows);
}

async function loadStudentProfileSummaries(cid) {
  if (!cid) return {};
  if (!_useSupabase) {
    var localSummaries = _safeParseLS('gb-student-profile-summaries-' + cid, {});
    _cache.studentProfileSummaries[cid] = localSummaries || {};
    return _cache.studentProfileSummaries[cid];
  }
  // Goal dates and Core Competency self-assessments load beside the
  // profiles; the student page draws without them until they arrive.
  _loadGoalDates(cid);
  _loadCoreSelf(cid);
  try {
    var res = await window.v2.listCourseStudentProfiles(cid);
    if (res && res.error) throw res.error;
    var rows = _rpcRows(res && res.data !== undefined ? res.data : res);
    return _applyStudentProfileSummaries(cid, rows);
  } catch (e) {
    if (_isMissingRpcError(e)) {
      return _loadStudentProfileSummariesIndividually(cid);
    }
    console.warn('list_course_student_profiles failed for ' + cid + '; keeping existing summaries:', e);
    if (_cache.studentProfileSummaries[cid] === undefined) _persistLoadedField(cid, 'studentProfileSummaries', {});
    return _cache.studentProfileSummaries[cid] || {};
  }
}
