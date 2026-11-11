/* Restore Class from Backup (docs/DECISIONS.md, "Class backups").

   Download Class Backup (cmDownloadBackup in teacher/dash-class-manager.js)
   writes a class as this device caches it: learningMap.sections[].tags[],
   scores keyed by student, and so on. import_json_restore takes flat server
   rows. This turns one into the other.

   A restore is always a new class. Every id in the backup is replaced with a
   fresh one first (remapBackup), so nothing is written over a class the
   teacher still has, and the same file restores in another account. The
   server reuses a student the teacher already has, matched on student
   number, else on the backup's own student id
   (migrations/20261103_import_json_restore_full_class.sql).

   restoreClassFromBackup writes the new class to this device at once and
   sends one import_json_restore through the outbox, keyed for idempotency,
   so it survives going offline and is applied once. Demo Mode keeps it on
   this device only. */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
  var SENTIMENTS = ['strength', 'growth', 'concern', 'note'];
  var REPORTING_BASES = ['grade', 'ie', 'language_goals', 'iep_goals'];
  var CORE_IDS = ['COM', 'COL', 'CT', 'CRT', 'PPI', 'PAR', 'SAR'];
  var HABIT_KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];

  function newUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function str(v) {
    return v == null ? '' : String(v);
  }
  function orNull(v) {
    return v == null || v === '' ? null : v;
  }
  function num(v, fallback) {
    var n = Number(v);
    return v != null && v !== '' && isFinite(n) ? n : fallback;
  }
  function level14(v) {
    var n = Number(v);
    return n >= 1 && n <= 4 && Math.floor(n) === n ? n : null;
  }
  function modifierFor(value, mod) {
    if (typeof normalizeScoreMod === 'function') return normalizeScoreMod(value, mod);
    var m = Number(mod) > 0 ? 1 : Number(mod) < 0 ? -1 : 0;
    if (!m || !level14(value) || (value === 1 && m < 0) || (value === 4 && m > 0)) return 0;
    return m;
  }
  function pointsScored(a) {
    var mode = a && (a.scoreMode || a.score_mode);
    return mode === 'points' || mode === 'complete';
  }
  function unlinkedKey(key) {
    return key === 'overall' || key === '';
  }

  /* The file as read: a backup has a course id, a roster and a learning map. */
  function parseBackup(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("This file isn't a class backup. Choose the .json file Download Class Backup saved.");
    }
    if (!data || typeof data !== 'object' || !data.course || !Array.isArray(data.students) || !data.learningMap) {
      throw new Error("This file isn't a class backup. Choose the .json file Download Class Backup saved.");
    }
    return data;
  }

  /* Every record id the backup holds, in the order found. */
  function collectIds(backup) {
    var ids = [];
    function add(id) {
      if (typeof id === 'string' && id) ids.push(id);
    }
    add(backup.course);
    var lm = obj(backup.learningMap);
    arr(lm.subjects).forEach(function (s) {
      add(s && s.id);
    });
    arr(lm.competencyGroups).forEach(function (g) {
      add(g && g.id);
    });
    arr(lm.sections).forEach(function (sec) {
      add(sec && sec.id);
      arr(sec && sec.tags).forEach(function (t) {
        add(t && t.id);
      });
    });
    arr(backup.students).forEach(function (s) {
      add(s && s.id);
      add(s && s.personId);
    });
    arr(backup.categories).forEach(function (c) {
      add(c && c.id);
    });
    arr(backup.assessments).forEach(function (a) {
      add(a && a.id);
    });
    arr(backup.modules).forEach(function (m) {
      add(m && m.id);
    });
    arr(backup.rubrics).forEach(function (r) {
      add(r && r.id);
      arr(r && r.criteria).forEach(function (c) {
        add(c && c.id);
        arr(c && c.checks).forEach(function (k) {
          add(k && k.id);
        });
      });
    });
    Object.keys(obj(backup.observations)).forEach(function (sid) {
      arr(backup.observations[sid]).forEach(function (ob) {
        add(ob && ob.id);
      });
    });
    return ids;
  }

  /* The backup with every record id replaced by a fresh UUID, wherever it
     appears: as a value, as an object key, or inside a composite key such
     as 'enrollment:assessment'. Returns { backup, ids } where ids maps old
     to new. The assessment and rubric copy links point into other classes,
     so a restored class starts without them. */
  function remapBackup(backup, makeId) {
    makeId = makeId || newUuid;
    var ids = {};
    collectIds(backup).forEach(function (id) {
      if (!ids[id]) ids[id] = makeId();
    });
    function mapString(s) {
      if (ids[s]) return ids[s];
      if (s.indexOf(':') < 0) return s;
      var parts = s.split(':');
      var changed = false;
      var out = parts.map(function (p) {
        if (ids[p]) {
          changed = true;
          return ids[p];
        }
        return p;
      });
      return changed ? out.join(':') : s;
    }
    function walk(v) {
      if (typeof v === 'string') return mapString(v);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        var out = {};
        Object.keys(v).forEach(function (k) {
          out[mapString(k)] = walk(v[k]);
        });
        return out;
      }
      return v;
    }
    var next = walk(backup);
    arr(next.assessments).forEach(function (a) {
      if (a) delete a.copyGroup;
    });
    arr(next.rubrics).forEach(function (r) {
      if (r) delete r.copyGroup;
    });
    return { backup: next, ids: ids };
  }

  /* The class row a restore makes, in COURSES shape. A backup from before
     Nov 2026 has no `courseInfo`: the class takes the given name and the
     defaults, and the teacher sets its grade and grading style after.

     The calculation method and decay weight are the ones the backup's
     settings hold (`config`), when it holds them: those are what the class
     was graded with on the computer that made the backup (shared/calc.js
     reads the settings first), and what this device grades the restored
     class with. The row took them from `courseInfo` alone, so a backup
     with none sent the server Average 65% while the device showed the real
     method; nothing sends it later, and the class's first load from the
     server moved every grade. */
  function restoredCourse(backup, cid, name) {
    var info = obj(backup.courseInfo);
    var config = obj(backup.config);
    var method = str(config.calcMethod) || str(info.calcMethod) || 'average';
    var decay = [config.decayWeight, info.decayWeight]
      .map(function (v) {
        return v == null || v === '' ? NaN : Number(v);
      })
      .filter(function (v) {
        return isFinite(v);
      })[0];
    return {
      id: cid,
      name: str(name).trim() || str(info.name).trim() || 'Restored Class',
      description: str(info.description),
      gradeLevel: str(info.gradeLevel),
      color: HEX_COLOR_RE.test(str(info.color)) ? info.color : '',
      archived: false,
      displayOrder: 0,
      gradingSystem:
        ['proficiency', 'letter', 'both'].indexOf(info.gradingSystem) >= 0 ? info.gradingSystem : 'proficiency',
      calcMethod: method,
      decayWeight: decay != null ? decay : 0.65,
      timezone: info.timezone || 'America/Vancouver',
      lateWorkPolicy: info.lateWorkPolicy || null,
      block: str(info.block).trim().slice(0, 24),
      curriculumTags: arr(info.curriculumTags).slice(),
    };
  }

  /* import_json_restore's payload for a remapped backup and its course row.
     Rows that point at something the backup doesn't hold (a competency
     removed before the backup, a deleted assessment) are left out rather
     than failing the whole restore. */
  function backupToPayload(backup, course) {
    var cid = course.id;
    var config = obj(backup.config);
    var lm = obj(backup.learningMap);
    var p = {
      courses: [],
      report_configs: [],
      categories: [],
      subjects: [],
      competency_groups: [],
      sections: [],
      tags: [],
      modules: [],
      rubrics: [],
      criteria: [],
      criterion_tags: [],
      criterion_checks: [],
      rubric_tags: [],
      students: [],
      enrollments: [],
      assessments: [],
      assessment_tags: [],
      scores: [],
      tag_scores: [],
      rubric_scores: [],
      rubric_check_scores: [],
      notes: [],
      goals: [],
      reflections: [],
      section_overrides: [],
      custom_tags: [],
      observations: [],
      term_ratings: [],
    };

    var recent = num(config.recentScoreLimit, null);
    p.courses.push({
      id: cid,
      name: course.name,
      grade_level: orNull(course.gradeLevel),
      description: orNull(course.description),
      color: orNull(course.color),
      is_archived: false,
      grading_system: course.gradingSystem,
      calc_method: course.calcMethod,
      decay_weight: course.decayWeight,
      timezone: course.timezone,
      late_work_policy: course.lateWorkPolicy,
      block: orNull(course.block),
      curriculum_tags: course.curriculumTags && course.curriculumTags.length ? course.curriculumTags : null,
      grading_scale: config.gradingScale && typeof config.gradingScale === 'object' ? config.gradingScale : null,
      category_weights:
        config.categoryWeights && typeof config.categoryWeights === 'object' ? config.categoryWeights : null,
      reporting_terms:
        config.reportingTerms && typeof config.reportingTerms === 'object' ? config.reportingTerms : null,
      round_percent: typeof config.roundPercent === 'boolean' ? config.roundPercent : null,
      recent_score_limit: recent >= 1 && recent <= 20 ? Math.floor(recent) : null,
      level_order: config.levelOrder === 'asc' ? 'asc' : 'desc',
      folders_count_as_one: config.foldersCountAsOne !== false,
      courses_count_equally: config.coursesCountEqually === true,
      // The student page (docs/plans/student-page-build-plan.md): a restored
      // class starts with it off, whatever the backup's class had, as a
      // duplicated class does; its Return Grades choice comes along.
      student_page_enabled: false,
      return_grades:
        config.return_grades === 'on_return' || config.return_grades === 'on_save' ? config.return_grades : null,
    });

    var rc = backup.reportConfig;
    if (rc && typeof rc === 'object' && !Array.isArray(rc)) {
      var blocks = Object.assign({}, rc);
      var preset = blocks._preset || 'standard';
      delete blocks._preset;
      if (Object.keys(blocks).length) p.report_configs.push({ course_id: cid, preset: preset, blocks_config: blocks });
    }

    var categoryIds = {};
    arr(backup.categories).forEach(function (c, i) {
      if (!c || !c.id) return;
      categoryIds[c.id] = true;
      p.categories.push({
        id: c.id,
        course_id: cid,
        name: str(c.name),
        weight: Math.min(100, Math.max(0, num(c.weight, 0))),
        display_order: num(c.displayOrder, i),
        calc_mode: (c.calcMode || c.calc_mode) === 'percent' ? 'percent' : 'points',
      });
    });

    // Learning map: subjects, folders, sections, competencies.
    var subjectIds = {};
    arr(lm.subjects).forEach(function (s, i) {
      if (!s || !s.id) return;
      subjectIds[s.id] = true;
      p.subjects.push({
        id: s.id,
        course_id: cid,
        name: str(s.name),
        display_order: num(s.sortOrder != null ? s.sortOrder : s.displayOrder, i),
        color: orNull(s.color),
      });
    });
    var groupIds = {};
    arr(lm.competencyGroups).forEach(function (g, i) {
      if (!g || !g.id) return;
      groupIds[g.id] = true;
      p.competency_groups.push({
        id: g.id,
        course_id: cid,
        name: str(g.name),
        color: HEX_COLOR_RE.test(str(g.color)) ? g.color : null,
        display_order: num(g.sortOrder != null ? g.sortOrder : g.displayOrder, i),
        counts_as_one: g.countsAsOne !== false,
      });
    });
    // A map with sections but no subject (an old local class) gets one.
    var sections = arr(lm.sections).filter(function (sec) {
      return sec && sec.id;
    });
    var fallbackSubject = null;
    sections.forEach(function (sec) {
      if (subjectIds[sec.subject]) return;
      if (!fallbackSubject) {
        fallbackSubject = newUuid();
        subjectIds[fallbackSubject] = true;
        p.subjects.push({ id: fallbackSubject, course_id: cid, name: course.name, display_order: p.subjects.length });
      }
    });
    var sectionIds = {};
    var tagIds = {};
    sections.forEach(function (sec, i) {
      sectionIds[sec.id] = true;
      var groupId = sec.groupId || sec.competencyGroupId || null;
      p.sections.push({
        id: sec.id,
        course_id: cid,
        subject_id: subjectIds[sec.subject] ? sec.subject : fallbackSubject,
        competency_group_id: groupIds[groupId] ? groupId : null,
        name: str(sec.name),
        display_order: num(sec.sortOrder != null ? sec.sortOrder : sec.displayOrder, i),
        color: orNull(sec.color),
      });
      arr(sec.tags).forEach(function (t, j) {
        if (!t || !t.id || tagIds[t.id]) return;
        tagIds[t.id] = true;
        p.tags.push({
          id: t.id,
          section_id: sec.id,
          code: orNull(t.code),
          label: str(t.label || t.code || sec.name),
          i_can_text: orNull(t.text),
          i_can_statements: arr(t.i_can_statements).map(str),
          source_text: orNull(t.source_text),
          bank_id: orNull(t.bank_id),
          display_order: num(t.sortOrder != null ? t.sortOrder : t.displayOrder, j),
        });
      });
    });

    var moduleIds = {};
    arr(backup.modules).forEach(function (m, i) {
      if (!m || !m.id) return;
      moduleIds[m.id] = true;
      p.modules.push({
        id: m.id,
        course_id: cid,
        name: str(m.name),
        color: orNull(m.color),
        display_order: num(m.sortOrder, i),
      });
    });

    var rubricsById = {};
    var checkIds = {};
    arr(backup.rubrics).forEach(function (r) {
      if (!r || !r.id) return;
      var criteria = {};
      rubricsById[r.id] = criteria;
      p.rubrics.push({
        id: r.id,
        course_id: cid,
        name: str(r.name || r.title),
        style: ['advanced', 'single_point'].indexOf(r.style) >= 0 ? r.style : 'standard',
      });
      arr(r.tagIds).forEach(function (tid) {
        if (tagIds[tid]) p.rubric_tags.push({ rubric_id: r.id, tag_id: tid });
      });
      arr(r.criteria).forEach(function (c, i) {
        if (!c || !c.id) return;
        criteria[c.id] = true;
        var levels = obj(c.levels);
        var values = obj(c.levelValues);
        p.criteria.push({
          id: c.id,
          rubric_id: r.id,
          name: str(c.name || c.label),
          level_4_descriptor: orNull(levels[4]),
          level_3_descriptor: orNull(levels[3]),
          level_2_descriptor: orNull(levels[2]),
          level_1_descriptor: orNull(levels[1]),
          level_4_value: num(values[4], 4),
          level_3_value: num(values[3], 3),
          level_2_value: num(values[2], 2),
          level_1_value: num(values[1], 1),
          weight: num(c.weight, 1),
          display_order: num(c.displayOrder, i),
        });
        arr(c.tagIds).forEach(function (tid) {
          if (tagIds[tid]) p.criterion_tags.push({ criterion_id: c.id, tag_id: tid });
        });
        arr(c.checks).forEach(function (k, j) {
          if (!k || !k.id || !level14(k.level)) return;
          checkIds[k.id] = true;
          p.criterion_checks.push({
            id: k.id,
            criterion_id: c.id,
            level: level14(k.level),
            label: str(k.label),
            display_order: num(k.displayOrder, j),
          });
        });
      });
    });

    // Students and their enrolments. `match_id` is the backup's own student
    // record, which the server reuses when it is still the teacher's.
    var enrollmentIds = {};
    var flags = obj(backup.flags);
    arr(backup.students).forEach(function (s, i) {
      if (!s || !s.id) return;
      enrollmentIds[s.id] = true;
      var personId = s.personId || newUuid();
      p.students.push({
        id: personId,
        match_id: s.originalPersonId || null,
        first_name: str(s.firstName),
        last_name: orNull(s.lastName),
        preferred_name: orNull(s.preferred),
        pronouns: orNull(s.pronouns),
        student_number: orNull(str(s.studentNumber).trim()),
        email: orNull(s.email),
        date_of_birth: /^\d{4}-\d{2}-\d{2}/.test(str(s.dateOfBirth)) ? str(s.dateOfBirth).slice(0, 10) : null,
      });
      p.enrollments.push({
        id: s.id,
        student_id: personId,
        course_id: cid,
        designations: arr(s.designations).map(str),
        roster_position: num(s.rosterPosition, i + 1),
        is_flagged: !!(flags[s.id] || s.isFlagged),
        enrolled_at: /^\d{4}-\d{2}-\d{2}/.test(str(s.enrolledDate)) ? str(s.enrolledDate).slice(0, 10) : null,
      });
    });

    var assessmentsById = {};
    arr(backup.assessments).forEach(function (a, i) {
      if (!a || !a.id) return;
      assessmentsById[a.id] = a;
      var mode = a.scoreMode || a.score_mode || 'proficiency';
      var categoryId = a.categoryId || a.category_id || null;
      var rubricId = a.rubricId || a.rubric_id || null;
      var moduleId = a.moduleId || null;
      var maxPoints = mode === 'points' ? num(a.maxPoints != null ? a.maxPoints : a.max_points, null) : null;
      p.assessments.push({
        id: a.id,
        course_id: cid,
        category_id: categoryIds[categoryId] ? categoryId : null,
        title: str(a.title),
        description: orNull(a.description),
        date_assigned: orNull(a.date || a.assigned_at),
        due_date: orNull(a.dueDate || a.due_date),
        score_mode: mode,
        max_points: maxPoints > 0 ? maxPoints : null,
        weight: Math.max(0, num(a.weight, 1)),
        evidence_type: orNull(a.evidenceType),
        rubric_id: rubricsById[rubricId] ? rubricId : null,
        module_id: moduleIds[moduleId] ? moduleId : null,
        display_order: num(a.display_order, i),
        collab_mode:
          typeof _canonicalCollabModeFromAssessment === 'function' ? _canonicalCollabModeFromAssessment(a) : 'none',
        collab_config: typeof _collabConfigFromAssessment === 'function' ? _collabConfigFromAssessment(a) : null,
        core_competency_ids: arr(a.coreCompetencyIds).filter(function (id) {
          return CORE_IDS.indexOf(id) >= 0;
        }),
      });
      arr(a.tagIds || a.tag_ids).forEach(function (tid) {
        if (tagIds[tid]) p.assessment_tags.push({ assessment_id: a.id, tag_id: tid });
      });
    });

    // Scores. One cache entry per score key: a competency (tag_score), a
    // rubric criterion (rubric_score), or the whole piece (score). The
    // overall comment, Note for the Report and status sit on the score row.
    var statuses = obj(backup.statuses);
    var statusCells = {};
    Object.keys(statuses).forEach(function (key) {
      var parts = key.split(':');
      if (['NS', 'EXC', 'LATE'].indexOf(statuses[key]) >= 0 && parts.length === 2) statusCells[key] = statuses[key];
    });
    var cells = {};
    Object.keys(obj(backup.scores)).forEach(function (sid) {
      if (!enrollmentIds[sid]) return;
      arr(backup.scores[sid]).forEach(function (e) {
        if (!e || !assessmentsById[e.assessmentId]) return;
        var key = sid + ':' + e.assessmentId;
        (cells[key] = cells[key] || []).push(e);
      });
    });
    Object.keys(statusCells).forEach(function (key) {
      var parts = key.split(':');
      if (enrollmentIds[parts[0]] && assessmentsById[parts[1]] && !cells[key]) cells[key] = [];
    });
    Object.keys(cells).forEach(function (key) {
      var parts = key.split(':');
      var sid = parts[0];
      var a = assessmentsById[parts[1]];
      var entries = cells[key];
      var linked = arr(a.tagIds || a.tag_ids);
      var criteria = rubricsById[a.rubricId || a.rubric_id] || null;
      var isPoints = pointsScored(a);
      var cellValue = null;
      var cellMod = 0;
      var comment = '';
      var reportNote = '';
      entries.forEach(function (e) {
        if (!comment && e.note) comment = str(e.note);
        if (!reportNote && e.reportNote) reportNote = str(e.reportNote).trim().slice(0, 300);
        var value = e.score == null || e.score === '' ? null : Number(e.score);
        if (isPoints) {
          if (cellValue == null && value != null && isFinite(value)) cellValue = value;
          return;
        }
        var lv = level14(value);
        if (criteria) {
          if (!criteria[e.tagId] || !lv) return;
          p.rubric_scores.push({
            enrollment_id: sid,
            assessment_id: a.id,
            criterion_id: e.tagId,
            value: lv,
            modifier: modifierFor(lv, e.mod),
            comment: orNull(e.critNote),
            beyond: orNull(e.critBeyond),
          });
        } else if (linked.indexOf(e.tagId) >= 0 && tagIds[e.tagId]) {
          if (!lv) return;
          p.tag_scores.push({
            enrollment_id: sid,
            assessment_id: a.id,
            tag_id: e.tagId,
            value: lv,
            modifier: modifierFor(lv, e.mod),
            comment: orNull(e.critNote),
          });
        } else if ((unlinkedKey(e.tagId) || !linked.length) && lv && cellValue == null) {
          cellValue = lv;
          cellMod = modifierFor(lv, e.mod);
        }
      });
      var status = statusCells[key] || null;
      if (cellValue == null && !comment && !reportNote && !status) return;
      p.scores.push({
        enrollment_id: sid,
        assessment_id: a.id,
        value: cellValue,
        status: status,
        comment: orNull(comment),
        modifier: isPoints ? 0 : cellMod,
        report_note: orNull(reportNote),
      });
    });

    var ticks = obj(backup.rubricChecks);
    Object.keys(ticks).forEach(function (key) {
      var parts = key.split(':');
      if (!enrollmentIds[parts[0]] || !assessmentsById[parts[1]]) return;
      arr(ticks[key]).forEach(function (checkId) {
        if (checkIds[checkId])
          p.rubric_check_scores.push({ enrollment_id: parts[0], assessment_id: parts[1], check_id: checkId });
      });
    });

    Object.keys(obj(backup.notes)).forEach(function (sid) {
      var body = str(backup.notes[sid]).trim();
      if (enrollmentIds[sid] && body) p.notes.push({ enrollment_id: sid, body: body });
    });
    Object.keys(obj(backup.goals)).forEach(function (sid) {
      if (!enrollmentIds[sid]) return;
      Object.keys(obj(backup.goals[sid])).forEach(function (sectionId) {
        var body = str(backup.goals[sid][sectionId]).trim();
        if (sectionIds[sectionId] && body) p.goals.push({ enrollment_id: sid, section_id: sectionId, body: body });
      });
    });
    Object.keys(obj(backup.reflections)).forEach(function (sid) {
      if (!enrollmentIds[sid]) return;
      Object.keys(obj(backup.reflections[sid])).forEach(function (sectionId) {
        var r = obj(backup.reflections[sid][sectionId]);
        var confidence = num(r.confidence, 0);
        if (!sectionIds[sectionId] || (!r.text && !confidence)) return;
        p.reflections.push({
          enrollment_id: sid,
          section_id: sectionId,
          body: str(r.text),
          confidence: confidence >= 1 && confidence <= 5 ? Math.floor(confidence) : null,
        });
      });
    });
    Object.keys(obj(backup.overrides)).forEach(function (sid) {
      if (!enrollmentIds[sid]) return;
      Object.keys(obj(backup.overrides[sid])).forEach(function (sectionId) {
        var o = obj(backup.overrides[sid][sectionId]);
        var lv = level14(o.level);
        if (sectionIds[sectionId] && lv)
          p.section_overrides.push({ enrollment_id: sid, section_id: sectionId, level: lv, reason: orNull(o.reason) });
      });
    });
    var labels = {};
    arr(backup.customTags).forEach(function (label) {
      label = str(label).trim();
      if (label && !labels[label]) {
        labels[label] = true;
        p.custom_tags.push({ course_id: cid, label: label });
      }
    });

    // Observations: one per id, with every student it names.
    var observations = {};
    var observationOrder = [];
    Object.keys(obj(backup.observations)).forEach(function (sid) {
      if (!enrollmentIds[sid]) return;
      arr(backup.observations[sid]).forEach(function (ob) {
        if (!ob || !ob.id || !UUID_RE.test(ob.id)) return;
        var row = observations[ob.id];
        if (!row) {
          var ctx = obj(ob.assignmentContext);
          row = observations[ob.id] = {
            id: ob.id,
            course_id: cid,
            body: str(ob.text),
            sentiment: SENTIMENTS.indexOf(ob.sentiment) >= 0 ? ob.sentiment : null,
            context_type: orNull(ob.context),
            assessment_id: assessmentsById[ctx.assessmentId] ? ctx.assessmentId : null,
            created_at: orNull(ob.created),
            dims: arr(ob.dims).map(str),
            level: level14(ob.level),
            template_id: UUID_RE.test(str(ob.templateId)) ? ob.templateId : null,
            enrollment_ids: [],
            tag_ids: tagIds[ob.competencyId] ? [ob.competencyId] : [],
          };
          observationOrder.push(ob.id);
        }
        if (row.enrollment_ids.indexOf(sid) < 0) row.enrollment_ids.push(sid);
      });
    });
    observationOrder.forEach(function (id) {
      p.observations.push(observations[id]);
    });

    // Term ratings: { sid: { 'term-N': {…} } }.
    Object.keys(obj(backup.termRatings)).forEach(function (sid) {
      if (!enrollmentIds[sid]) return;
      Object.keys(obj(backup.termRatings[sid])).forEach(function (termId) {
        var m = /^term-(\d+)$/.exec(termId);
        var term = m ? Number(m[1]) : 0;
        if (term < 1 || term > 6) return;
        var t = obj(backup.termRatings[sid][termId]);
        var habits = {};
        HABIT_KEYS.forEach(function (k) {
          var v = Number(obj(t.habits)[k]);
          if (v >= 1 && v <= 5 && Math.floor(v) === v) habits[k] = v;
        });
        var basis = REPORTING_BASES.indexOf(t.reportingBasis) >= 0 ? t.reportingBasis : 'grade';
        var deadline = /^\d{4}-\d{2}-\d{2}/.test(str(t.ieDeadline)) ? str(t.ieDeadline).slice(0, 10) : null;
        if (basis === 'ie' && !deadline) basis = 'grade';
        var row = {
          enrollment_id: sid,
          term: term,
          narrative_html: orNull(t.narrative),
          work_habits_rating: level14(t.workHabits),
          participation_rating: level14(t.participation),
          social_traits: arr(t.socialTraits).map(str),
          habits: habits,
          approved_at: orNull(t.approvedAt),
          reporting_basis: basis,
          ie_deadline: deadline,
          draft_meta: t.draftMeta && typeof t.draftMeta === 'object' ? t.draftMeta : null,
          strength_tag_ids: arr(t.strengths).filter(function (id) {
            return tagIds[id];
          }),
          growth_tag_ids: arr(t.growthAreas).filter(function (id) {
            return tagIds[id];
          }),
          mention_assessment_ids: arr(t.mentionAssessments).filter(function (id) {
            return assessmentsById[id];
          }),
          mention_observation_ids: arr(t.mentionObs).filter(function (id) {
            return observations[id];
          }),
        };
        var hasContent =
          row.narrative_html ||
          row.work_habits_rating ||
          row.participation_rating ||
          row.social_traits.length ||
          Object.keys(habits).length ||
          row.approved_at ||
          basis !== 'grade' ||
          row.draft_meta ||
          row.strength_tag_ids.length ||
          row.growth_tag_ids.length ||
          row.mention_assessment_ids.length ||
          row.mention_observation_ids.length;
        if (hasContent) p.term_ratings.push(row);
      });
    });

    Object.keys(p).forEach(function (k) {
      if (!p[k].length) delete p[k];
    });
    return p;
  }

  /* The cache fields a backup's sections fill, by backup key. */
  var CACHE_FIELDS = {
    students: 'students',
    categories: 'categories',
    assessments: 'assessments',
    scores: 'scores',
    overrides: 'overrides',
    notes: 'notes',
    config: 'courseConfigs',
    learningMap: 'learningMaps',
    modules: 'modules',
    rubrics: 'rubrics',
    rubricChecks: 'rubricChecks',
    statuses: 'statuses',
    flags: 'flags',
    goals: 'goals',
    reflections: 'reflections',
    observations: 'observations',
    termRatings: 'termRatings',
    customTags: 'customTags',
    reportConfig: 'reportConfig',
  };

  /* Everything a restore makes, before anything is written: the new class
     row, its cache fields and the server payload. */
  function planRestore(backup, opts) {
    opts = opts || {};
    // Each student's own record id, kept for the server to match on.
    var withOriginals = Object.assign({}, backup, {
      students: arr(backup.students).map(function (s) {
        return Object.assign({}, s, { originalPersonId: s && UUID_RE.test(str(s.personId)) ? s.personId : null });
      }),
    });
    var remap = remapBackup(withOriginals, opts.makeId);
    var remapped = remap.backup;
    // remapBackup also rewrote originalPersonId; put the originals back.
    remapped.students.forEach(function (s, i) {
      s.originalPersonId = withOriginals.students[i].originalPersonId;
    });
    var cid = remapped.course;
    var course = restoredCourse(remapped, cid, opts.name);
    var payload = backupToPayload(remapped, course);
    var cache = {};
    Object.keys(CACHE_FIELDS).forEach(function (key) {
      if (remapped[key] === undefined || remapped[key] === null) return;
      cache[CACHE_FIELDS[key]] = key === 'students' ? remapped.students.map(stripOriginal) : remapped[key];
    });
    // The restored class's student page is off on this device as well (see
    // backupToPayload): the backup's switch is not carried into its settings.
    if (cache.courseConfigs && typeof cache.courseConfigs === 'object' && !Array.isArray(cache.courseConfigs)) {
      cache.courseConfigs = Object.assign({}, cache.courseConfigs);
      delete cache.courseConfigs.student_page_enabled;
    }
    return { cid: cid, course: course, cache: cache, payload: payload, ids: remap.ids };
  }

  function stripOriginal(s) {
    var out = Object.assign({}, s);
    delete out.originalPersonId;
    return out;
  }

  /* Write the restored class to this device and send it to the server.
     Returns { cid, course, sent } at once; `sent` resolves with the
     server's counts when the restore lands (null in Demo Mode) and rejects
     if the server refuses it, after the class is taken off this device
     again. Offline, the write waits in the outbox and the class is already
     here. */
  function restoreClassFromBackup(backup, opts) {
    var plan = planRestore(backup, opts);
    var cid = plan.cid;
    var courses = Object.assign({}, typeof COURSES !== 'undefined' ? COURSES : {});
    courses[cid] = plan.course;
    saveCourses(courses);
    Object.keys(plan.cache).forEach(function (field) {
      _persistLoadedField(cid, field, plan.cache[field]);
    });
    if (typeof clearProfCache === 'function') clearProfCache();
    var local = (typeof _isDemoSession === 'function' && _isDemoSession()) || !_writesEnabled();
    var sent = local
      ? Promise.resolve(null)
      : _writeRpc('import_json_restore', { p_payload: plan.payload }).then(function (res) {
          if (res && res.error) {
            _clearCourseLocalState(cid);
            throw res.error;
          }
          return res ? res.data : null;
        });
    return { cid: cid, course: plan.course, sent: sent };
  }

  /* Photos of student work are never in a class backup, and nor are the
     records of what was sent (Colin, Q22; S8-F2): the backup is built from
     the class's own records, and student work is not one of them. Where a
     class could hold any (its student page is on and it takes work, Send
     Work), the file says so, in its `photos` field. Otherwise undefined,
     which leaves the file as it always was. A restore reads nothing from
     the field. */
  var PHOTOS_NOTE = 'Photos of student work are not in this file.';

  function photosNote(cid) {
    var settings = typeof getReturnSettings === 'function' ? getReturnSettings(cid) : null;
    var send = typeof getCourseSendWork === 'function' ? getCourseSendWork(cid) : null;
    return settings && settings.student_page && send && send.send_work ? PHOTOS_NOTE : undefined;
  }

  // Restore Class from Backup says the same, once any class takes work.
  var PHOTOS_NOT_IN_BACKUP = 'Photos of student work are not in a backup.';

  function anyClassTakesWork() {
    return Object.keys(typeof COURSES !== 'undefined' && COURSES ? COURSES : {}).some(function (cid) {
      return !!photosNote(cid);
    });
  }

  window.FVBackupRestore = {
    PHOTOS_NOTE: PHOTOS_NOTE,
    PHOTOS_NOT_IN_BACKUP: PHOTOS_NOT_IN_BACKUP,
    anyClassTakesWork: anyClassTakesWork,
    photosNote: photosNote,
    parseBackup: parseBackup,
    collectIds: collectIds,
    remapBackup: remapBackup,
    restoredCourse: restoredCourse,
    backupToPayload: backupToPayload,
    planRestore: planRestore,
    restoreClassFromBackup: restoreClassFromBackup,
  };
})();
