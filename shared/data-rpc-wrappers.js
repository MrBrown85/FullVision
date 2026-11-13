/* The v2 server-call wrappers: window.v2.upsertSubject through window.v2.getAssessmentDetail, and their small helpers.
   Moved from shared/data.js on 2026-11-12 (S19 split, move only). Loads just after shared/data.js, which makes window.v2. */

/* Subject: upsert (p_id null for new), delete, reorder. */
window.v2.upsertSubject = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_subject',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
    },
    options,
  );
};
window.v2.deleteSubject = function (id) {
  return _rpcOrNoop('delete_subject', { p_id: id });
};
window.v2.reorderSubjects = function (ids) {
  return _rpcOrNoop('reorder_subjects', { p_ids: (ids || []).filter(_isUuid) });
};

/* CompetencyGroup. */
window.v2.upsertCompetencyGroup = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_competency_group',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
      // Null keeps the folder's saved value.
      p_counts_as_one: typeof params.countsAsOne === 'boolean' ? params.countsAsOne : null,
    },
    options,
  );
};
window.v2.deleteCompetencyGroup = function (id) {
  return _rpcOrNoop('delete_competency_group', { p_id: id });
};
window.v2.reorderCompetencyGroups = function (ids) {
  return _rpcOrNoop('reorder_competency_groups', { p_ids: (ids || []).filter(_isUuid) });
};

/* Section — course_id is auto-inferred from the owning subject. */
window.v2.upsertSection = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_section',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_subject_id: params.subjectId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_competency_group_id: _isSendableId(params.competencyGroupId) ? params.competencyGroupId : null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
    },
    options,
  );
};
window.v2.deleteSection = function (id) {
  return _rpcOrNoop('delete_section', { p_id: id });
};
/* Remove a competency from a class but keep its scores (section.removed_at),
   put one back, and list the removed ones (migrations/20261022_soft_remove_competency.sql). */
window.v2.removeSection = function (id) {
  return _rpcOrNoop('remove_section', { p_id: id });
};
window.v2.restoreSection = function (id) {
  return _rpcOrNoop('restore_section', { p_id: id });
};
window.v2.listRemovedSections = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_removed_sections', { p_course_id: courseId });
};
window.v2.reorderSections = function (ids) {
  return _rpcOrNoop('reorder_sections', { p_ids: (ids || []).filter(_isUuid) });
};

/* Tag. */
window.v2.upsertTag = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_tag',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_section_id: params.sectionId,
      p_label: params.label || '',
      p_code: params.code || null,
      p_i_can_text: params.iCanText || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
      p_i_can_statements: Array.isArray(params.iCanStatements) ? params.iCanStatements : null,
      p_source_text: params.sourceText || null,
      p_bank_id: params.bankId || null,
    },
    options,
  );
};
window.v2.deleteTag = function (id) {
  return _rpcOrNoop('delete_tag', { p_id: id });
};
window.v2.reorderTags = function (ids) {
  return _rpcOrNoop('reorder_tags', { p_ids: (ids || []).filter(_isUuid) });
};

/* Module. */
window.v2.upsertModule = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_module',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_color: params.color || null,
      p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
    },
    options,
  );
};
window.v2.deleteModule = function (id) {
  return _rpcOrNoop('delete_module', { p_id: id });
};
window.v2.reorderModules = function (ids) {
  return _rpcOrNoop('reorder_modules', { p_ids: (ids || []).filter(_isUuid) });
};

/* Category — assessment weighting bucket. Weights must total 100; the
   server checks at commit, so save the whole list with saveCategories.
   upsertCategory is kept for renames that leave weights alone. */
window.v2.upsertCategory = function (params) {
  params = params || {};
  return _rpcOrNoop('upsert_category', {
    p_id: _isUuid(params.id) ? params.id : null,
    p_course_id: params.courseId,
    p_name: params.name || '',
    p_weight: params.weight != null ? Number(params.weight) : 0,
    p_display_order: params.displayOrder != null ? Number(params.displayOrder) : null,
  });
};
window.v2.deleteCategory = function (id) {
  return _rpcOrNoop('delete_category', { p_id: id });
};
window.v2.listCategories = function (courseId) {
  return _rpcOrNoop('list_categories', { p_course_id: courseId });
};
/* The copies of one assessment across the teacher's live classes:
   [{ assessment_id, course_id, course_name, title }]. */
window.v2.listAssessmentCopies = function (copyGroup) {
  if (!_isUuid(copyGroup)) return Promise.resolve({ data: [], error: null });
  return _rpcOrNoop('list_assessment_copies', { p_copy_group: copyGroup });
};
window.v2.reorderCategories = function (ids) {
  return _rpcOrNoop('reorder_categories', { p_ids: (ids || []).filter(_isUuid) });
};
/* rows: [{ id?, name, weight }] in display order. Rows without a uuid are
   created; the class's other categories are deleted. Resolves with the ids
   in the same order. */
window.v2.saveCategories = function (courseId, rows, options) {
  return _rpcOrNoop('save_categories', _saveCategoriesParams(courseId, rows), options);
};
function _saveCategoriesParams(courseId, rows) {
  return {
    p_course_id: courseId,
    p_categories: (rows || []).map(function (r) {
      var row = {
        name: (r.name || '').trim(),
        weight: r.weight != null ? Number(r.weight) : 0,
        calc_mode: categoryCalcMode(r),
      };
      if (_isUuid(r.id)) row.id = r.id;
      return row;
    }),
  };
}

/* Rubric — composite save: rubric row + criteria diff + criterion_tag replace
   + criterion_check replace, all in one transaction.  criteria payload:
     [{ id?: uuid, name, level_{1..4}_descriptor, level_{1..4}_value?,
        weight?, display_order?, linked_tag_ids?: uuid[],
        checks?: [{ id?: uuid, level 1..4, label, display_order }] }, …]
   Criteria present in the array are upserted; criteria absent are deleted
   (cascades criterion_tag, criterion_check + rubric_score). A criterion's
   checks are replaced the same way (migrations/20261022_advanced_rubric_checks.sql). */
window.v2.upsertRubric = function (params, options) {
  params = params || {};
  var criteria = (params.criteria || []).map(function (c) {
    var payload = {
      name: c.name || '',
      level_4_descriptor: c.level4Descriptor || null,
      level_3_descriptor: c.level3Descriptor || null,
      level_2_descriptor: c.level2Descriptor || null,
      level_1_descriptor: c.level1Descriptor || null,
      weight: c.weight != null ? Number(c.weight) : 1.0,
      display_order: c.displayOrder != null ? Number(c.displayOrder) : 0,
      linked_tag_ids: (c.linkedTagIds || []).filter(_isUuid),
      checks: (c.checks || []).map(function (check) {
        var row = {
          level: Number(check.level),
          label: check.label == null ? '' : String(check.label),
          display_order: check.displayOrder != null ? Number(check.displayOrder) : 0,
        };
        if (_isUuid(check.id)) row.id = check.id;
        return row;
      }),
    };
    if (c.level4Value != null) payload.level_4_value = Number(c.level4Value);
    if (c.level3Value != null) payload.level_3_value = Number(c.level3Value);
    if (c.level2Value != null) payload.level_2_value = Number(c.level2Value);
    if (c.level1Value != null) payload.level_1_value = Number(c.level1Value);
    if (_isUuid(c.id)) payload.id = c.id;
    return payload;
  });
  return _rpcOrNoop(
    'upsert_rubric',
    {
      p_id: _isUuid(params.id) ? params.id : null,
      p_course_id: params.courseId,
      p_name: params.name || '',
      p_criteria: criteria,
      p_copy_group: _isUuid(params.copyGroup) ? params.copyGroup : null,
      p_style: rubricStyle({ style: params.style }),
      // The competencies the whole rubric scores; [] clears them, null keeps them.
      p_linked_tag_ids: Array.isArray(params.linkedTagIds) ? params.linkedTagIds.filter(_isUuid) : null,
    },
    options,
  );
};
window.v2.listRubricCopies = function (copyGroup) {
  if (!_isUuid(copyGroup)) return Promise.resolve({ data: [], error: null });
  return _rpcOrNoop('list_rubric_copies', { p_copy_group: copyGroup });
};
window.v2.deleteRubric = function (id) {
  return _rpcOrNoop('delete_rubric', { p_id: id });
};

/* ── v2 student-profile read + student-record writes ─────────────────────
   Reader: get_student_profile(p_enrollment_id) returns enrollment + student +
   course rows, overall proficiency, letter grade, status counts, notes /
   goals / reflections, and a competency_tree (subjects → sections → tags
   with per-section proficiency and per-tag latest_value + coverage_count). */
window.v2.getStudentProfile = function (enrollmentId) {
  // Demo Mode and not-yet-saved students have local ids the server can't read.
  if (!_isUuid(enrollmentId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('get_student_profile', { p_enrollment_id: enrollmentId });
};

window.v2.listCourseStudentProfiles = function (courseId) {
  return _rpcOrNoop('list_course_student_profiles', { p_course_id: courseId });
};

/* Notes: immutable add + delete (per ERD). Note body cannot be edited;
   corrections mean delete + add. */
window.v2.addNote = function (enrollmentId, body) {
  return _rpcOrNoop('upsert_note', {
    p_enrollment_id: enrollmentId,
    p_body: body || '',
  });
};
window.v2.deleteNote = function (noteId) {
  return _rpcOrNoop('delete_note', { p_id: noteId });
};

/* Goal: one per (enrollment, section). Upsert replaces body. */
window.v2.saveGoal = function (enrollmentId, sectionId, body) {
  return _rpcOrNoop('upsert_goal', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
    p_body: body || '',
  });
};

/* When each goal in a class was last saved: {enrollment_id: {section_id: ISO}}. */
window.v2.listCourseGoalDates = function (courseId) {
  return _rpcOrNoop('list_course_goal_dates', { p_course_id: courseId });
};

/* Attendance totals to date on each report (term_rating.absences / lates). */
window.v2.listCourseTermAttendance = function (courseId) {
  return _rpcOrNoop('list_course_term_attendance', { p_course_id: courseId });
};
window.v2.saveTermAttendance = function (enrollmentId, term, absences, lates) {
  return _rpcOrNoop('save_term_attendance', {
    p_enrollment_id: enrollmentId,
    p_term: term,
    p_absences: absences,
    p_lates: lates,
  });
};

/* Core Competency self-assessments: one per (enrollment, competency, term). */
window.v2.listCourseCoreSelfAssessments = function (courseId) {
  return _rpcOrNoop('list_course_core_self_assessments', { p_course_id: courseId });
};
window.v2.saveCoreSelfAssessment = function (enrollmentId, coreId, termKey, level, text, goal) {
  return _rpcOrNoop('upsert_core_self_assessment', {
    p_enrollment_id: enrollmentId,
    p_core_id: coreId,
    p_term_key: termKey || '',
    p_level: level != null ? Number(level) : null,
    p_body: text || null,
    p_goal: goal || null,
  });
};

/* Reflection: one per (enrollment, section). confidence ∈ 1..5 or null. */
window.v2.saveReflection = function (enrollmentId, sectionId, body, confidence) {
  return _rpcOrNoop('upsert_reflection', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
    p_body: body || '',
    p_confidence: confidence != null ? Number(confidence) : null,
  });
};

/* SectionOverride: teacher-judgment level override per (enrollment, section).
   level ∈ 1..4; reason is optional free text. */
window.v2.saveSectionOverride = function (enrollmentId, sectionId, level, reason) {
  return _rpcOrNoop('upsert_section_override', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
    p_level: Number(level),
    p_reason: reason || null,
  });
};
window.v2.clearSectionOverride = function (enrollmentId, sectionId) {
  return _rpcOrNoop('clear_section_override', {
    p_enrollment_id: enrollmentId,
    p_section_id: sectionId,
  });
};

/* Bulk attendance: apply one status to many students on one date. Status is
   free text (matches client "Present"/"Absent"/"Late" convention). */
window.v2.bulkAttendance = function (enrollmentIds, date, status) {
  return _rpcOrNoop('bulk_attendance', {
    p_enrollment_ids: (enrollmentIds || []).filter(_isUuid),
    p_date: date,
    p_status: status || '',
  });
};

/* ── v2 term rating composite save (Phase 4.7) ──────────────────────────
   Mirrors the §13 capture form: one RPC saves the TermRating row plus all
   five dependent sets (dimensions, strength/growth tag memberships,
   assessment mentions, observation mentions), with per-field audit rows
   written inside the same transaction (Q28).

   payload (camelCase client → snake_case wire): any key may be omitted to
   leave that field / set alone. Passing empty [] for a set wipes it.
     narrativeHtml        → narrative_html
     workHabitsRating     → work_habits_rating    (1..4 or null)
     participationRating  → participation_rating  (1..4 or null)
     socialTraits         → social_traits         (string[])
     dimensions           → dimensions: [{ sectionId, rating 1..4 }]
     strengthTagIds       → strength_tags[]
     growthTagIds         → growth_tags[]
     mentionAssessmentIds → mention_assessments[]
     mentionObservationIds→ mention_observations[] */
/* ── v2 ReportConfig + TeacherPreference (Phase 4.8 + 1.11 wire-up) ──── */

window.v2.applyReportPreset = function (courseId, preset) {
  return _rpcOrNoop('apply_report_preset', {
    p_course_id: courseId,
    p_preset: preset, // 'brief' | 'standard' | 'detailed'
  });
};

/* Full replace. If blocks_config diverges from a named preset's defaults,
   pass p_preset='custom' (or leave preset null — RPC defaults to 'custom'). */
window.v2.saveReportConfig = function (courseId, blocksConfig, preset) {
  return _rpcOrNoop('save_report_config', {
    p_course_id: courseId,
    p_blocks_config: blocksConfig || {},
    p_preset: preset || null,
  });
};

/* Flip a single block; server auto-sets preset='custom'. */
window.v2.toggleReportBlock = function (courseId, blockKey, enabled) {
  return _rpcOrNoop('toggle_report_block', {
    p_course_id: courseId,
    p_block_key: blockKey,
    p_enabled: !!enabled,
  });
};

/* ── Report forms: the library, issued copies and guardians ─────────────
   migrations/20261020_report_template.sql, 20261020_report_issue.sql,
   20261020_guardian.sql; docs/report-forms-plan.md. Every write is
   idempotent (shared/constants.js FV_IDEMPOTENT_RPCS). The library and
   Issue Reports still keep their device copies (gb-report-templates,
   IndexedDB fv-report-issues); these are the server calls they move to. */

/* A list read's { data, error }: data is the rows, or null when nothing was
   read (Demo Mode, signed out, or an error), so a caller keeps its device
   copy rather than mistaking "no server" for "no rows". */
function _listResult(res) {
  var error = (res && res.error) || null;
  var data = res && res.data != null && !error ? _rpcRows(res.data) : null;
  return { data: data, error: error };
}

/* A saved form: { id?, name, form }. Same name (case-insensitive) updates
   that row; an id renames. Resolves with the row as the server has it. */
window.v2.saveReportTemplate = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'save_report_template',
    {
      p_name: String(params.name == null ? '' : params.name).trim(),
      p_form: params.form && typeof params.form === 'object' ? params.form : {},
      p_id: _isUuid(params.id) ? params.id : null,
    },
    options,
  );
};
/* A withdrawn student's scores and observations from the server, for the
   copy offered before a permanent delete. Read-only; null in Demo Mode. */
window.v2.getWithdrawnStudentRecords = function (enrollmentId) {
  if (!_isUuid(enrollmentId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('get_withdrawn_student_records', { p_enrollment_id: enrollmentId });
};
window.v2.listReportTemplates = function () {
  return _rpcOrNoop('list_report_templates', {}).then(_listResult);
};
window.v2.deleteReportTemplate = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_report_template', { p_id: id });
};

/* ── The personal comment bank (migrations/20261031_comment_template.sql) ──
   A teacher's own comment sentences, kept from "Suggested for Your Bank"
   (teacher/comment-personal.js, plan PR 10). Saves and deletes go through
   the outbox with an idempotency key; the list is one small read on the
   Term Questionnaire. In Demo Mode, signed out, offline or before the
   table exists, the list comes back null and the device copy stands. */
window.v2.saveCommentTemplate = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'save_comment_template',
    {
      p_text: String(params.text == null ? '' : params.text).trim(),
      p_slots: Array.isArray(params.slots) ? params.slots : [],
      p_condition: params.condition && typeof params.condition === 'object' ? params.condition : {},
      p_id: _isUuid(params.id) ? params.id : null,
      p_uses: params.uses != null && Number(params.uses) >= 0 ? Math.floor(Number(params.uses)) : null,
    },
    options,
  );
};
window.v2.listCommentTemplates = function () {
  return _rpcOrNoop('list_comment_templates', {}).then(_listResult);
};
window.v2.deleteCommentTemplate = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_comment_template', { p_id: id });
};

/* One Issue: { courseId, term, termLabel, paper, form, students } where
   students is [{ enrollmentId, sheets, hash, html }]. The HTML of a whole
   class can run past the outbox's 5 MB cap, so this goes straight to the
   server rather than through the queue; the Issue dialog reports a failure
   and keeps its own copy. Only students with a server id are sent. */
window.v2.createReportIssue = function (params) {
  params = params || {};
  var students = (params.students || [])
    .filter(function (s) {
      return s && _isUuid(s.enrollmentId);
    })
    .map(function (s) {
      return {
        enrollment_id: s.enrollmentId,
        sheets: Math.max(1, Math.min(20, Number(s.sheets) || 1)),
        hash: String(s.hash == null ? '' : s.hash),
        html: String(s.html == null ? '' : s.html),
      };
    });
  var rpcParams = {
    p_course_id: params.courseId,
    p_term: Number(params.term) || 1,
    p_term_label: params.termLabel || null,
    p_paper: params.paper === 'legal' ? 'legal' : 'letter',
    p_form: params.form && typeof params.form === 'object' ? params.form : null,
    p_students: students,
  };
  if (!_isUuid(params.courseId) || !students.length) {
    return Promise.resolve({ data: null, error: { message: 'nothing to issue', blocked: true } });
  }
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return Promise.resolve({ data: null, error: null });
  _stampIdempotencyKey('create_report_issue', rpcParams);
  return _trackWriteSync(
    'create_report_issue',
    _callRpcWithAuthGuard('create_report_issue', rpcParams).then(function (res) {
      if (res && res.error && !res.error.handledSessionExpired) {
        if (_isMissingRpcError(res.error)) _reportMissingRpc('create_report_issue', res.error);
        else console.warn('create_report_issue failed:', res.error);
      }
      return { data: _rpcObject(res && res.data), error: (res && res.error) || null };
    }),
  );
};
/* Issues for a class (one term, or every term when term is null), newest
   first, each with hashes { enrollmentId: hash } and no HTML. */
window.v2.listReportIssues = function (courseId, term) {
  var params = { p_course_id: courseId };
  if (term != null) params.p_term = Number(term);
  return _rpcOrNoop('list_report_issues', params).then(_listResult);
};
/* One issue with every student's HTML, in roster order. */
window.v2.getReportIssue = function (issueId) {
  return _rpcOrNoop('get_report_issue', { p_issue_id: issueId }).then(function (res) {
    return { data: _rpcObject(res && res.data), error: (res && res.error) || null };
  });
};
window.v2.deleteReportIssue = function (issueId) {
  if (!_isUuid(issueId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_report_issue', { p_issue_id: issueId });
};

/* A guardian: { id?, studentId, name, relationship, email, phone, language,
   consentAt, consentSource }. Consent is sent only when both consentAt and
   consentSource are given; the server refuses one without the other.
   The Students tab stores parent emails here; nothing sends to them until
   the district's position on teacher-to-family email is known. */
window.v2.upsertGuardian = function (params, options) {
  params = params || {};
  var consent = params.consentAt && params.consentSource;
  return _rpcOrNoop(
    'upsert_guardian',
    {
      p_student_id: params.studentId,
      p_name: String(params.name == null ? '' : params.name).trim(),
      p_relationship: params.relationship || null,
      p_email: params.email || null,
      p_phone: params.phone || null,
      p_language: params.language || 'en',
      p_consent_at: consent ? params.consentAt : null,
      p_consent_source: consent ? params.consentSource : null,
      p_id: _isUuid(params.id) ? params.id : null,
    },
    options,
  );
};
window.v2.deleteGuardian = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_guardian', { p_id: id });
};
/* Every guardian of every enrolled student, each row carrying enrollment_id. */
window.v2.listCourseGuardians = function (courseId) {
  return _rpcOrNoop('list_course_guardians', { p_course_id: courseId }).then(_listResult);
};

/* ── Student questionnaires ─────────────────────────────────────────────
   migrations/20261025_questionnaires_tables_and_functions.sql;
   docs/STUDENT-VOICE-PLAN.md. Reads return { data, error } with data null
   when nothing was read (Demo Mode, signed out, an error). */
window.v2.listQuestionnaireTemplates = function () {
  return _rpcOrNoop('list_questionnaire_templates', {}).then(_listResult);
};
window.v2.listCourseQuestionnaires = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_course_questionnaires', { p_course_id: courseId }).then(_listResult);
};
/* { questionnaire_id: { enrollment_id: [{ id, submitted_at, via, answers }] } } */
window.v2.listCourseResponses = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_course_responses', { p_course_id: courseId }).then(function (res) {
    var error = (res && res.error) || null;
    return { data: res && res.data && !error ? res.data : null, error: error };
  });
};
/* A questionnaire: { id?, courseId, kind, title, templateId, theme,
   reportPeriod, parentId, opensOn, closesOn, isOn, myedComment, questions }.
   questions is the whole list in order, or null to keep them (or, for a new
   one from a template, to copy the template's). */
window.v2.upsertQuestionnaire = function (params, options) {
  params = params || {};
  return _rpcOrNoop(
    'upsert_questionnaire',
    {
      p_course_id: params.courseId,
      p_kind: params.kind,
      p_title: String(params.title == null ? '' : params.title).trim(),
      p_template_id: params.templateId || null,
      p_theme: params.theme || null,
      p_report_period: params.reportPeriod == null ? null : Number(params.reportPeriod),
      p_parent_id: _isUuid(params.parentId) ? params.parentId : null,
      p_opens_on: params.opensOn || null,
      p_closes_on: params.closesOn || null,
      p_is_on: params.isOn !== false,
      p_myed_comment: params.myedComment || null,
      p_questions: Array.isArray(params.questions) ? params.questions : null,
      p_id: _isUuid(params.id) ? params.id : null,
    },
    options,
  );
};
window.v2.setQuestionnaireOn = function (id, isOn) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('set_questionnaire_on', { p_id: id, p_is_on: !!isOn });
};
window.v2.deleteQuestionnaire = function (id) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('delete_questionnaire', { p_id: id });
};
/* New slips: [{ enrollment_id, code, password? }], every enrolled student
   when enrollmentIds is empty. teacher-cards makes them (plan S3-S1): it
   draws each code (and, for a student with no birthday or student number,
   a password), and the database keeps only their keyed tags. Online only
   and never through the outbox: the codes come back once, and nothing here
   keeps them. A reply lost on the way (a replay, which carries no codes)
   is asked for once more under a new request id: those slips are made
   again, which takes back the ones nobody printed. A reprint always has a
   new code, and a new password where there is one. */
function _issueSlips(kind, id, enrollmentIds) {
  if (!_isUuid(id)) return Promise.resolve({ data: null, error: null });
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return Promise.resolve({ data: null, error: null });
  var ids = (enrollmentIds || []).filter(_isUuid);
  var ask = function () {
    return _teacherCardsAsk({
      route: 'slips',
      kind: kind,
      id: id,
      enrollment_ids: ids.length ? ids : null,
      request_id: _newEntryId(),
    });
  };
  return _trackPendingSync(
    (async function () {
      var got = await ask();
      if (got.data && got.data.replayed) got = await ask();
      if (!got.data) return { data: null, error: got.error };
      var rows = [];
      got.data.results.forEach(function (r) {
        if (!r || r.result !== 'made' || typeof r.code !== 'string') return;
        var row = { enrollment_id: r.enrollment_id, code: r.code };
        if (typeof r.password === 'string') row.password = r.password;
        rows.push(row);
      });
      return { data: rows, error: null };
    })(),
  );
}
window.v2.issueAccessCodes = function (questionnaireId, enrollmentIds) {
  return _issueSlips('questionnaire', questionnaireId, enrollmentIds);
};

/* Reports on students' phones (migrations/20261025_phone_reports.sql).
   Every write is online only and never queued: the teacher is waiting on
   the result (the new report, the slip codes), and a failed call is simply
   made again. Each carries an idempotency key. */
function _phoneReportCall(name, params, shape) {
  var sb = getSupabase();
  if (!sb || _isDemoSession()) return Promise.resolve({ data: null, error: null });
  _stampIdempotencyKey(name, params);
  return _trackWriteSync(
    name,
    _callRpcWithAuthGuard(name, params).then(function (res) {
      if (res.error && !res.error.handledSessionExpired) console.warn(name + ' failed:', res.error);
      return { data: res && !res.error ? shape(res.data) : null, error: res.error || null };
    }),
  );
}
function _phoneReportObject(d) {
  return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
}
/* students: [{ enrollment_id, data }] */
window.v2.createPhoneReport = function (courseId, term, termLabel, expiresOn, students) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _phoneReportCall(
    'create_phone_report',
    {
      p_course_id: courseId,
      p_term: term,
      p_term_label: termLabel || null,
      p_expires_on: expiresOn,
      p_students: (students || []).filter(function (s) {
        return _isUuid(s.enrollment_id);
      }),
    },
    _phoneReportObject,
  );
};
window.v2.updatePhoneReport = function (reportId, students, expiresOn) {
  if (!_isUuid(reportId)) return Promise.resolve({ data: null, error: null });
  return _phoneReportCall(
    'update_phone_report',
    {
      p_id: reportId,
      p_students: (students || []).filter(function (s) {
        return _isUuid(s.enrollment_id);
      }),
      p_expires_on: expiresOn || null,
    },
    _phoneReportObject,
  );
};
window.v2.closePhoneReport = function (reportId) {
  if (!_isUuid(reportId)) return Promise.resolve({ data: null, error: null });
  return _phoneReportCall('close_phone_report', { p_id: reportId }, _phoneReportObject);
};
/* [{ enrollment_id, code }]: the codes come back once, from teacher-cards (_issueSlips). */
window.v2.issueReportCodes = function (reportId, enrollmentIds) {
  return _issueSlips('report', reportId, enrollmentIds);
};
window.v2.listPhoneReports = function (courseId) {
  if (!_isUuid(courseId)) return Promise.resolve({ data: null, error: null });
  return _rpcOrNoop('list_phone_reports', { p_course_id: courseId }).then(_listResult);
};

/* Teacher preferences — jsonb patch; omitted keys unchanged. */
window.v2.saveTeacherPreferences = function (patch) {
  return _rpcOrNoop('save_teacher_preferences', { p_patch: patch || {} });
};

/* Soft-delete / restore for account-level lifecycle (Pass C §5). */
window.v2.softDeleteTeacher = function () {
  return _rpcOrNoop('soft_delete_teacher', {});
};
window.v2.restoreTeacher = function () {
  return _rpcOrNoop('restore_teacher', {});
};

/* ── v2 Imports (Phase 4.9) ───────────────────────────────────────────
   Three flows share this surface; each returns per-section row counts. */

/* CSV roster — alias the Phase 4.1 helper under v2 for naming consistency. */
window.v2.importRosterCsv = function (courseId, rows) {
  return _rpcOrNoop('import_roster_csv', {
    p_course_id: courseId,
    p_rows: rows || [],
  });
};

/* JSON full-data restore (§15.3). Replays every entity in FK-safe
   topological order; UPSERT semantics mean re-importing the same payload
   is idempotent. Payload sections are all optional:
     courses, report_configs, subjects, competency_groups, sections, tags,
     modules, rubrics, criteria, criterion_tags, students, enrollments,
     assessments, assessment_tags, scores, rubric_scores, tag_scores,
     notes, goals, reflections.
   Returns per-section row counts. */
window.v2.importJsonRestore = function (payload) {
  return _rpcOrNoop('import_json_restore', { p_payload: payload || {} });
};

/* ── v2 read RPCs from Phase 5.4 ──────────────────────────────────────── */

window.v2.getLearningMap = function (courseId) {
  return _rpcOrNoop('get_learning_map', { p_course_id: courseId });
};

window.v2.getObservations = function (courseId, opts) {
  opts = opts || {};
  return _rpcOrNoop('get_observations', {
    p_course_id: courseId,
    p_filters: opts.filters || {},
    p_page: opts.page || 1,
    p_page_size: opts.pageSize || 50,
  });
};

window.v2.getAssessmentDetail = function (assessmentId) {
  return _rpcOrNoop('get_assessment_detail', { p_assessment_id: assessmentId });
};
