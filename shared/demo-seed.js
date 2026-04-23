/* shared/demo-seed.js — v2 demo seed generator (Phase 5.1)
 *
 * Builds a payload compatible with the import_json_restore(p_payload) RPC,
 * matching DECISIONS.md Q43:
 *   • Grade 8 Humanities (proficiency-focused)
 *   • 25 students (full secondary class)
 *   • 8 assessments, mix of rubric + direct-scored, varied completion
 *   • Realistic bell curve of scores
 *   • Observations + 1 completed term rating
 *
 * Per DECISIONS.md Q47 the same seed is used for Demo Mode and the Welcome
 * Class. The buildDemoSeedPayload() function accepts a target courseId so
 * the caller can stitch the seed to an existing course row (bootstrap_teacher
 * created the Welcome Class; we populate it in one pass).
 *
 * Usage:
 *   // Welcome Class (server-backed, first sign-in):
 *   var payload = buildDemoSeedPayload({ courseId: welcomeClassId });
 *   await window.v2.importJsonRestore(payload);
 *
 *   // Demo Mode (client-only): feed the same payload through a local
 *   // projector that writes into _cache + localStorage. (Left as a follow-up
 *   // — existing shared/seed-data.js covers demo mode today.)
 */
(function () {
  'use strict';

  /* RFC4122 v4 uuid — crypto.randomUUID when available, else Math.random. */
  function _uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map
      .call(b, function (x) {
        return (x < 16 ? '0' : '') + x.toString(16);
      })
      .join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* Box–Muller — normal-distributed random number, mean 0, stddev 1. */
  function _rand_normal() {
    var u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* Bell-curve proficiency value — clamped to 1..4, mean ~2.8 stddev ~0.6.
     Returns a number rounded to one decimal. */
  function _bellValue(mean, stddev) {
    mean = mean == null ? 2.8 : mean;
    stddev = stddev == null ? 0.6 : stddev;
    var v = mean + _rand_normal() * stddev;
    if (v < 1) v = 1;
    if (v > 4) v = 4;
    return Math.round(v * 10) / 10;
  }
  function _bellLevel(mean, stddev) {
    var v = Math.round(mean + _rand_normal() * (stddev == null ? 0.8 : stddev));
    if (v < 1) v = 1;
    if (v > 4) v = 4;
    return v;
  }

  /* Deterministic-ish pseudo-random picker for sprinkling attributes. */
  function _pickSeed(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* ── Reference data ───────────────────────────────────────────────── */
  var ROSTER = [
    { first: 'Cece', last: 'Adeyemi', pronouns: 'she/her' },
    { first: 'Noor', last: 'Al-Rashid', pronouns: 'she/her' },
    { first: 'Sam', last: 'Blackwood', pronouns: 'they/them' },
    { first: 'Liam', last: 'Chen', pronouns: 'he/him' },
    { first: 'Mateo', last: 'Cruz', pronouns: 'he/him' },
    { first: 'Ethan', last: 'Dubois', pronouns: 'he/him' },
    { first: 'Jasper', last: 'Gill', pronouns: 'he/him' },
    { first: 'Fatima', last: 'Hassan', pronouns: 'she/her' },
    { first: 'Priya', last: 'Kaur', pronouns: 'she/her' },
    { first: 'Jordan', last: 'Kim', pronouns: 'he/him' },
    { first: 'Ines', last: 'Larsen', pronouns: 'she/her' },
    { first: 'Marcus', last: 'Lee', pronouns: 'he/him' },
    { first: 'Amara', last: 'Osei', pronouns: 'she/her' },
    { first: 'Sofia', last: 'Petrov', pronouns: 'she/her' },
    { first: 'Tyler', last: 'Rowe', pronouns: 'he/him' },
    { first: 'Aiden', last: 'Singh', pronouns: 'he/him' },
    { first: 'Olivia', last: 'Tam', pronouns: 'she/her' },
    { first: 'Raj', last: 'Venkatesh', pronouns: 'he/him' },
    { first: 'Maya', last: 'Wilson', pronouns: 'she/her' },
    { first: 'Liv', last: 'Zhao', pronouns: 'she/her' },
    { first: 'Hannah', last: 'Berg', pronouns: 'she/her' },
    { first: 'Darius', last: 'Thompson', pronouns: 'he/him' },
    { first: 'Mei', last: 'Wong', pronouns: 'she/her' },
    { first: 'Caleb', last: 'Firth', pronouns: 'he/him' },
    { first: 'Anisa', last: 'Jama', pronouns: 'she/her' },
  ];

  // Humanities Grade 8 learning map: 4 subjects × 2–3 sections × ~3 tags.
  var SUBJECT_SPECS = [
    {
      name: 'Reading',
      sections: [
        {
          name: 'Comprehension',
          tags: [
            { label: 'Identifies main ideas', code: 'R1', iCan: 'I can find the main ideas in a text.' },
            { label: 'Infers meaning from context', code: 'R2', iCan: 'I can infer meaning from context clues.' },
            { label: 'Summarizes accurately', code: 'R3', iCan: 'I can summarize a passage accurately.' },
          ],
        },
        {
          name: 'Literary analysis',
          tags: [
            { label: "Identifies author's purpose", code: 'R4', iCan: "I can explain the author's purpose." },
            { label: 'Analyzes themes', code: 'R5', iCan: 'I can analyze a theme across a text.' },
          ],
        },
      ],
    },
    {
      name: 'Writing',
      sections: [
        {
          name: 'Organization',
          tags: [
            {
              label: 'Structures an essay logically',
              code: 'W1',
              iCan: 'I can organize an essay with clear structure.',
            },
            { label: 'Develops paragraphs with evidence', code: 'W2', iCan: 'I can develop paragraphs with evidence.' },
          ],
        },
        {
          name: 'Voice + style',
          tags: [
            { label: 'Uses varied sentence structure', code: 'W3', iCan: 'I can vary my sentences for effect.' },
            { label: 'Conveys a clear voice', code: 'W4', iCan: 'I can write in a clear voice.' },
          ],
        },
      ],
    },
    {
      name: 'Speaking & Listening',
      sections: [
        {
          name: 'Discussion',
          tags: [
            {
              label: 'Contributes to class discussion',
              code: 'S1',
              iCan: 'I can contribute meaningfully to discussions.',
            },
            { label: 'Listens actively', code: 'S2', iCan: 'I can listen actively and respond thoughtfully.' },
          ],
        },
      ],
    },
    {
      name: 'Social Studies',
      sections: [
        {
          name: 'Historical thinking',
          tags: [
            { label: 'Analyzes primary sources', code: 'H1', iCan: 'I can analyze a primary source.' },
            { label: 'Evaluates cause + effect', code: 'H2', iCan: 'I can trace cause and effect.' },
          ],
        },
        {
          name: 'Civics',
          tags: [
            {
              label: 'Explains governance structures',
              code: 'H3',
              iCan: 'I can describe how a government is structured.',
            },
          ],
        },
      ],
    },
  ];

  // 8 assessments — mix of rubric + direct-scored + modules (units) + categories.
  // Each has `type`: 'rubric' uses the Writing rubric (below). 'direct' uses
  // per-tag proficiency entry. 'points' uses a raw max_points scale.
  var ASSESSMENT_SPECS = [
    {
      title: 'Summer reading reflection',
      module: 0,
      category: 'Written',
      type: 'direct',
      evidenceType: 'written',
      tagSelectors: ['R1', 'R2', 'R3'],
      assigned: '-70d',
      due: '-65d',
    },
    {
      title: 'Poetry analysis (Langston Hughes)',
      module: 0,
      category: 'Written',
      type: 'direct',
      evidenceType: 'written',
      tagSelectors: ['R4', 'R5', 'W4'],
      assigned: '-55d',
      due: '-50d',
    },
    {
      title: 'Persuasive essay: Should students have homework?',
      module: 1,
      category: 'Written',
      type: 'rubric',
      evidenceType: 'written',
      tagSelectors: ['W1', 'W2', 'W3', 'W4'],
      assigned: '-40d',
      due: '-33d',
    },
    {
      title: 'Socratic seminar: The Outsiders',
      module: 1,
      category: 'Oral',
      type: 'direct',
      evidenceType: 'observation',
      tagSelectors: ['S1', 'S2', 'R5'],
      assigned: '-30d',
      due: '-30d',
    },
    {
      title: 'Primary source analysis: Confederation',
      module: 2,
      category: 'Written',
      type: 'direct',
      evidenceType: 'written',
      tagSelectors: ['H1', 'H2'],
      assigned: '-22d',
      due: '-17d',
    },
    {
      title: 'Quiz: Branches of government',
      module: 2,
      category: 'Quizzes',
      type: 'points',
      evidenceType: 'quiz',
      maxPoints: 20,
      tagSelectors: ['H3'],
      assigned: '-14d',
      due: '-14d',
    },
    {
      title: 'Short story workshop',
      module: 3,
      category: 'Written',
      type: 'rubric',
      evidenceType: 'written',
      tagSelectors: ['W1', 'W2', 'W3', 'W4', 'R4'],
      assigned: '-8d',
      due: '-3d',
    },
    {
      title: 'Book talk presentation',
      module: 3,
      category: 'Oral',
      type: 'direct',
      evidenceType: 'presentation',
      tagSelectors: ['S1', 'S2', 'R4', 'R5'],
      assigned: '-2d',
      due: '+4d',
    },
  ];

  var RUBRIC_CRITERIA = [
    {
      name: 'Ideas + content',
      level_4_descriptor: 'Insightful, original, fully supported.',
      level_3_descriptor: 'Clear and well-supported.',
      level_2_descriptor: 'Relevant but thin.',
      level_1_descriptor: 'Unclear or unsupported.',
      weight: 2.0,
    },
    {
      name: 'Organization',
      level_4_descriptor: 'Elegant structure; transitions fluid.',
      level_3_descriptor: 'Logical structure; transitions work.',
      level_2_descriptor: 'Some structure; transitions abrupt.',
      level_1_descriptor: 'No clear structure.',
      weight: 1.5,
    },
    {
      name: 'Voice + style',
      level_4_descriptor: 'Distinct voice; varied precise language.',
      level_3_descriptor: 'Clear voice; varied language.',
      level_2_descriptor: 'Voice emerging; repetitive language.',
      level_1_descriptor: 'No voice; basic language.',
      weight: 1.0,
    },
    {
      name: 'Conventions',
      level_4_descriptor: 'Near-flawless; enhances meaning.',
      level_3_descriptor: 'Minor errors; does not distract.',
      level_2_descriptor: 'Noticeable errors; occasionally distracts.',
      level_1_descriptor: 'Frequent errors; obscures meaning.',
      weight: 1.0,
    },
  ];

  var CATEGORY_SPECS = [
    { name: 'Written', weight: 50 },
    { name: 'Oral', weight: 30 },
    { name: 'Quizzes', weight: 20 },
  ];

  var MODULE_SPECS = [
    { name: 'Unit 1: Narrative foundations', color: '#4F8EF7' },
    { name: 'Unit 2: Argument + evidence', color: '#F77B4F' },
    { name: 'Unit 3: Civic life', color: '#4FB37A' },
    { name: 'Unit 4: Creative expression', color: '#B24FF7' },
  ];

  var OBSERVATION_TEMPLATES_NOT_SEED = [
    // Teacher-added custom templates (not the six curated seeds which come from
    // a separate migration). Left empty for the Welcome Class — one or two
    // observations are inserted directly as Observation rows, see below.
  ];

  function _dateDaysFromNow(spec) {
    if (!spec) return null;
    var m = /^([+-])(\d+)d$/.exec(spec);
    if (!m) return null;
    var sign = m[1] === '-' ? -1 : 1;
    var days = parseInt(m[2], 10);
    var d = new Date(Date.now() + sign * days * 86400000);
    return d.toISOString().slice(0, 10);
  }

  /* Build an import_json_restore-compatible payload for the Welcome Class.
     `courseId` is the id of the Course row bootstrap_teacher created; this
     function fills it with the full Grade 8 Humanities seed. */
  function buildDemoSeedPayload(opts) {
    opts = opts || {};
    var courseId = opts.courseId || _uuid();

    var subjects = [];
    var sections = [];
    var tagsByCode = {};
    var tags = [];

    SUBJECT_SPECS.forEach(function (sp, si) {
      var subjId = _uuid();
      subjects.push({ id: subjId, course_id: courseId, name: sp.name, display_order: si });
      sp.sections.forEach(function (se, sei) {
        var sectId = _uuid();
        sections.push({
          id: sectId,
          course_id: courseId,
          subject_id: subjId,
          name: se.name,
          display_order: sei,
        });
        se.tags.forEach(function (tg, tgi) {
          var tagId = _uuid();
          var row = {
            id: tagId,
            section_id: sectId,
            code: tg.code,
            label: tg.label,
            i_can_text: tg.iCan,
            display_order: tgi,
          };
          tags.push(row);
          tagsByCode[tg.code] = tagId;
        });
      });
    });

    var modules = MODULE_SPECS.map(function (m, i) {
      return { id: _uuid(), course_id: courseId, name: m.name, color: m.color, display_order: i };
    });

    var categories = CATEGORY_SPECS.map(function (c, i) {
      return { id: _uuid(), course_id: courseId, name: c.name, weight: c.weight, display_order: i };
    });
    var categoryByName = {};
    categories.forEach(function (c) {
      categoryByName[c.name] = c.id;
    });

    // Writing rubric — used by the persuasive essay + short story assessments.
    var rubricId = _uuid();
    var rubrics = [{ id: rubricId, course_id: courseId, name: 'Writing rubric' }];
    var criteria = RUBRIC_CRITERIA.map(function (c, i) {
      return Object.assign({ id: _uuid(), rubric_id: rubricId, display_order: i }, c);
    });
    // Link rubric criteria to Writing tags so per-tag proficiency can be derived.
    var writingTagCodes = ['W1', 'W2', 'W3', 'W4'];
    var criterion_tags = [];
    criteria.forEach(function (c, i) {
      var tagCode = writingTagCodes[i % writingTagCodes.length];
      if (tagsByCode[tagCode]) {
        criterion_tags.push({ criterion_id: c.id, tag_id: tagsByCode[tagCode] });
      }
    });

    var students = ROSTER.map(function (s, i) {
      return {
        id: _uuid(),
        first_name: s.first,
        last_name: s.last,
        preferred_name: null,
        pronouns: s.pronouns,
        student_number: 'STU-' + (201 + i),
        email: null,
        date_of_birth: null,
      };
    });

    var enrollments = students.map(function (s, i) {
      return {
        id: _uuid(),
        student_id: s.id,
        course_id: courseId,
        designations: i === 4 ? ['IEP'] : i === 12 ? ['ELL'] : [],
        roster_position: i,
        is_flagged: false,
      };
    });

    // Assessments + per-tag + per-criterion scores.
    var assessments = [];
    var assessment_tags = [];
    var scores = [];
    var tag_scores = [];
    var rubric_scores = [];

    ASSESSMENT_SPECS.forEach(function (as, ai) {
      var asmtId = _uuid();
      var modId = modules[as.module || 0].id;
      var catId = categoryByName[as.category] || null;
      var useRubric = as.type === 'rubric';
      assessments.push({
        id: asmtId,
        course_id: courseId,
        category_id: catId,
        title: as.title,
        description: null,
        date_assigned: _dateDaysFromNow(as.assigned),
        due_date: _dateDaysFromNow(as.due),
        score_mode: as.type === 'points' ? 'points' : 'proficiency',
        max_points: as.maxPoints || null,
        weight: 1.0,
        evidence_type: as.evidenceType || null,
        rubric_id: useRubric ? rubricId : null,
        module_id: modId,
        display_order: ai,
      });
      (as.tagSelectors || []).forEach(function (code) {
        if (tagsByCode[code]) {
          assessment_tags.push({ assessment_id: asmtId, tag_id: tagsByCode[code] });
        }
      });

      // Generate per-student scores — skew later assessments to have a few
      // not-yet-graded + a LATE + an EXC to show varied completion.
      enrollments.forEach(function (enr, si) {
        var isRecent = ai >= 6;
        // Leave the last assessment ungraded for ~40% of students, next-last for ~10%.
        if (ai === 7 && Math.random() < 0.4) return;
        if (ai === 6 && Math.random() < 0.1) return;

        var status = null;
        if (Math.random() < 0.03)
          status = 'NS'; // ~3% not submitted
        else if (Math.random() < 0.02)
          status = 'EXC'; // ~2% excused
        else if (isRecent && Math.random() < 0.05) status = 'LATE';

        if (useRubric) {
          // Per-criterion scores 1..4 with a bell curve.
          criteria.forEach(function (c) {
            rubric_scores.push({
              id: _uuid(),
              enrollment_id: enr.id,
              assessment_id: asmtId,
              criterion_id: c.id,
              value: _bellLevel(3, 0.8),
            });
          });
          // Overall Score row too (status or comment only).
          scores.push({
            id: _uuid(),
            enrollment_id: enr.id,
            assessment_id: asmtId,
            value: null,
            status: status,
            comment: null,
            scored_at: new Date().toISOString(),
          });
        } else if (as.type === 'points') {
          // Raw points — bell curve on percent, scale to max_points.
          var pct = _bellValue(2.8, 0.6) / 4;
          var pts = Math.round(pct * as.maxPoints);
          scores.push({
            id: _uuid(),
            enrollment_id: enr.id,
            assessment_id: asmtId,
            value: pts,
            status: status,
            comment: null,
            scored_at: new Date().toISOString(),
          });
        } else {
          // Direct proficiency — per-tag tag_scores + an overall Score row.
          (as.tagSelectors || []).forEach(function (code) {
            if (!tagsByCode[code]) return;
            tag_scores.push({
              id: _uuid(),
              enrollment_id: enr.id,
              assessment_id: asmtId,
              tag_id: tagsByCode[code],
              value: _bellLevel(3, 0.8),
            });
          });
          scores.push({
            id: _uuid(),
            enrollment_id: enr.id,
            assessment_id: asmtId,
            value: _bellValue(2.8, 0.6),
            status: status,
            comment: null,
            scored_at: new Date().toISOString(),
          });
        }
      });
    });

    // 3–5 observations sprinkled across students.
    var obsBodies = [
      'Strong insight during discussion — connected the reading to a current event.',
      'Needs a nudge on organization; outlines help.',
      'Excellent peer support during the seminar.',
      'Consistent growth over the last two weeks of writing.',
    ];
    var observations = [];
    var observation_student = []; // n/a in the payload schema — created via import inline
    // import_json_restore doesn't accept observation/student_join rows in its
    // current schema; observations + joins can be added once that section is
    // extended. Leaving the observations out of the restore payload for now;
    // Demo Mode can seed them via v2.createObservationRich after import.

    // 1 completed term rating for student #0 (Cece Adeyemi).
    // Also not currently imported by import_json_restore; the client should
    // call v2.saveTermRating after restoring, to land the audit trail too.

    var notes = [
      {
        id: _uuid(),
        enrollment_id: enrollments[3].id,
        body: 'Parent meeting 2026-03-02 — Liam struggling with argument structure; committed to weekly check-ins.',
        created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
      },
      {
        id: _uuid(),
        enrollment_id: enrollments[12].id,
        body: 'Amara has been an excellent peer editor — consider pairing with Liam.',
        created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
      },
    ];

    var goals = [];
    var reflections = [];
    sections.slice(0, 2).forEach(function (sect) {
      enrollments.slice(0, 5).forEach(function (enr) {
        goals.push({
          id: _uuid(),
          enrollment_id: enr.id,
          section_id: sect.id,
          body: 'I will re-read with a purpose and take margin notes.',
        });
        reflections.push({
          id: _uuid(),
          enrollment_id: enr.id,
          section_id: sect.id,
          body: 'Noticing I can summarize better when I pause halfway through.',
          confidence: _bellLevel(3, 0.8),
        });
      });
    });

    var report_configs = [
      {
        course_id: courseId,
        preset: 'standard',
        blocks_config: {
          header: true,
          narrative: true,
          grades: true,
          competencies: true,
          goals: true,
          attendance: false,
        },
      },
    ];

    return {
      // NB: we deliberately omit the course row from the payload — the caller
      // has already created the Welcome Class via bootstrap_teacher and just
      // wants to fill it. If a fresh course is desired, include one here.
      report_configs: report_configs,
      subjects: subjects,
      sections: sections,
      tags: tags,
      modules: modules,
      rubrics: rubrics,
      criteria: criteria,
      criterion_tags: criterion_tags,
      students: students,
      enrollments: enrollments,
      assessments: assessments,
      assessment_tags: assessment_tags,
      scores: scores,
      rubric_scores: rubric_scores,
      tag_scores: tag_scores,
      notes: notes,
      goals: goals,
      reflections: reflections,
      categories: categories,
    };
  }

  /* Apply the demo seed to the currently-signed-in teacher's Welcome Class
     (or any existing target course). Thin wrapper over v2.importJsonRestore.
     Returns the RPC response. */
  function applyDemoSeed(courseId) {
    if (!courseId) {
      console.warn('applyDemoSeed: courseId required');
      return Promise.resolve(null);
    }
    if (!window.v2 || !window.v2.importJsonRestore) {
      console.warn('applyDemoSeed: window.v2.importJsonRestore unavailable');
      return Promise.resolve(null);
    }
    var payload = buildDemoSeedPayload({ courseId: courseId });
    return window.v2.importJsonRestore(payload);
  }

  window.buildDemoSeedPayload = buildDemoSeedPayload;
  window.applyDemoSeed = applyDemoSeed;
})();
