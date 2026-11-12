/* Printable graded rubric handouts.

   A teacher scores a rubric assessment once in the grid, then prints a
   student-facing rubric per student: the four level descriptors, the chosen
   level in grey with a heavy border and its ± mark (black and white only:
   the sheets are photocopied), the comment on each criterion, the
   assessment feedback and the overall level. Stapled to the work, it is the
   feedback the student takes home, while the score keeps feeding the
   student profile.

   Three layouts: one sheet per letter page (portrait), two per landscape
   page (half sheets) or four per portrait page (quarter sheets), with a cut
   line between sheets. Descriptors shrink by layout; a sheet whose content
   doesn't fit its box is clipped, and the dialog says so before printing.

   Points and Complete/Incomplete work print a score sheet instead: the
   student's points and percent, or their Complete or Incomplete mark, and
   the feedback, with no rubric grid. Same window, same layouts.

   An assessment with no rubric of its own prints one too: a Tag Rubric, a
   row per competency it is scored on, or a General Rubric, one Overall row
   when it has none. Their level cells read, level by level, the teacher's
   own wording for a competency (the descriptor bank), else the curriculum
   bank's descriptors for a competency imported from it (tag.bank_id,
   shared/bank-proficiency.js, loaded on the first such print), else the BC
   proficiency scale's general descriptors (GENERAL_LEVELS): never empty
   boxes.

   Grade math stays in shared/calc.js (getAssessmentOverallScore,
   formatLevel, levelWord). Pure helpers are exposed for tests; the DOM is
   touched only from open() and print(). */
(function () {
  'use strict';

  /* Every score, comment, tick and status a sheet shows is read through
     ReportScores (teacher/report-scores.js), never from the data layer
     here. The helpers that read one sheet (sheetData, scoreSheetData,
     feedbackItems, isStudentScored) read in whatever set their caller is
     in: a Feedback Page's sheet takes its report's set, and the Rubric
     Bank's Delete Rubric counts the teacher's own scores (all work).

     The handout is a report surface of its own ('handout'): it is handed
     to students, so in a class that holds grades it shows returned grades
     only (DECISIONS, "Student page build rulings (2026-11-10)" 6), and
     Print asks first when a student in the print has a draft on the piece
     (_printFromDialog). The functions below are its doors, each run inside
     ReportScores.withReportScores every time it is called, from whichever
     page opened the dialog: what prints and its preview (renderPages), who
     prints (selectStudents), the dialog's list of students and its Already
     Printed box, who the question asks about (_mayPrint), what a print
     records (markPrinted), and the Printed and Changed Since Printed marks
     beside a name (_markState), which compare what the handout would print
     now with what was printed. */
  var _inReportScores = function (fn) {
    return ReportScores.scoped('handout', fn);
  };
  renderPages = _inReportScores(renderPages);
  selectStudents = _inReportScores(selectStudents);
  _studentsGroupHtml = _inReportScores(_studentsGroupHtml);
  _printedSummaryText = _inReportScores(_printedSummaryText);
  _mayPrint = _inReportScores(_mayPrint);
  markPrinted = _inReportScores(markPrinted);
  _markState = _inReportScores(_markState);

  var ROOT_ID = 'rubric-print-root';
  var STYLE_ID = 'rubric-print-page';
  var OVERLAY_ID = 'rubric-print-overlay';
  var OPTIONS_KEY = 'rubric-print-options';

  // Letter paper: 8.5in × 11in. Sheet boxes are the printable area split
  // into equal parts. Margins are a quarter inch, inside what most printers
  // can reach, so the rubric prints as large as the paper allows (Colin,
  // 2026-10-22).
  var LAYOUTS = {
    full: {
      key: 'full',
      label: 'Full Page',
      help: '1 per page',
      tile: '1 per Page',
      tileHelp: 'Full page',
      orientation: 'portrait',
      margin: 0.25,
      cols: 1,
      rows: 1,
      pageWidth: 8,
      pageHeight: 10.5,
      fontPt: 12.5,
      minPt: 9,
    },
    half: {
      key: 'half',
      label: 'Half Sheet',
      help: '2 per landscape page',
      tile: '2 per Page',
      tileHelp: 'Half sheets, landscape',
      orientation: 'landscape',
      margin: 0.25,
      cols: 2,
      rows: 1,
      pageWidth: 10.5,
      pageHeight: 8,
      fontPt: 10,
      minPt: 6.5,
    },
    quarter: {
      key: 'quarter',
      label: 'Quarter Sheet',
      help: '4 per page',
      tile: '4 per Page',
      tileHelp: 'Quarter sheets',
      orientation: 'portrait',
      margin: 0.25,
      cols: 2,
      rows: 2,
      pageWidth: 8,
      pageHeight: 10.5,
      fontPt: 8,
      minPt: 5.5,
    },
  };
  var LAYOUT_ORDER = ['full', 'half', 'quarter'];
  var LEVELS = [4, 3, 2, 1];
  var LEVEL_NAMES = PROF_LABELS;
  var LINE_ROWS = 36; // write-on lines: a full page's height at the line pitch
  // The BC proficiency scale's general descriptors.
  var GENERAL_LEVELS = {
    1: 'The student demonstrates an initial understanding of the concepts and competencies relevant to the expected learning.',
    2: 'The student demonstrates a partial understanding of the concepts and competencies relevant to the expected learning.',
    3: 'The student demonstrates a complete understanding of the concepts and competencies relevant to the expected learning.',
    4: 'The student demonstrates a sophisticated understanding of the concepts and competencies relevant to the expected learning.',
  };

  var MAX_COPIES = 40;

  var DEFAULT_OPTIONS = {
    mode: 'completed', // completed | blank
    copies: 1, // blank copies
    students: 'scored', // unprinted | changed | scored | all | pick
    picked: [],
    layout: 'full',
    nameStyle: 'preferred', // preferred | first; the last name always follows
    include: {
      feedback: true,
      criterionComments: true,
      codes: true,
      overall: true,
      checks: true,
      nextSteps: false,
    },
  };
  // The Next Steps Reflection's question (Colin, Oct 29).
  var NEXT_STEPS_PROMPT = 'What will you work on next, and how will you do it?';

  // { cid, aid, rubricId, uses, opts, userLayout, trigger } while the dialog is open
  var _state = null;

  /* ── Data ───────────────────────────────────────────────── */

  function _courseName(cid) {
    var course = typeof COURSES !== 'undefined' && COURSES ? COURSES[cid] : null;
    if (!course && typeof loadCourses === 'function') course = (loadCourses() || {})[cid];
    if (!course) return '';
    return typeof courseDisplayName === 'function' ? courseDisplayName(course) : course.name || '';
  }

  function _assessment(cid, aid) {
    return (
      getAssessments(cid).find(function (a) {
        return a && a.id === aid;
      }) || null
    );
  }

  function _customRubric(cid, assessment) {
    if (!assessment || !assessment.rubricId) return null;
    return getRubricById(cid, assessment.rubricId) || null;
  }

  // A competency's own level wording, where the teacher saved it.
  function _ownLevels(tag) {
    if (!tag || typeof getCompetencyDescriptor !== 'function' || typeof RubricDraft === 'undefined') return null;
    return getCompetencyDescriptor(RubricDraft.competencyKey(tag));
  }

  /* The curriculum bank's four descriptors for a competency imported from it
     (tag.bank_id), keyed 1 (Emerging) to 4 (Extending), from
     shared/bank-proficiency.js. Null until that file has loaded, and for
     competencies with no bank id. */
  function _bankLevels(tag) {
    var bank = window.BANK_PROFICIENCY;
    var id = tag && tag.bank_id;
    if (!bank || !id || bank.ids[id] == null) return null;
    var set = bank.levels[bank.ids[id]];
    return set ? { 1: set[0], 2: set[1], 3: set[2], 4: set[3] } : null;
  }

  /* One competency's wording at a level (1–4), by the printed rubric's
     rule: the teacher's own, else the bank's, else the BC scale's general
     wording. { text, ready }: ready is false while a bank competency's
     wording hasn't loaded (loadBankLevels), so a caller can ask again. */
  function levelWording(tag, level, skipOwn) {
    // skipOwn: the wording the teacher's own replaces (Class Settings' Write Your Own).
    // The one rule lives in CompetencyWording, which the hovers and the phone read too.
    if (window.CompetencyWording) return CompetencyWording.levelWording(tag, level, skipOwn);
    var own = (!skipOwn && _ownLevels(tag)) || {};
    var bank = _bankLevels(tag) || {};
    var text = (own[level] && String(own[level]).trim()) || bank[level] || GENERAL_LEVELS[level] || '';
    return { text: text, ready: !(tag && tag.bank_id && !window.BANK_PROFICIENCY) };
  }

  /* Load shared/bank-proficiency.js (about 80 KB compressed) the first time a
     rubric with bank competencies is printed, not on every page. Resolves
     true when it is there; on a failed load the rubric prints the general
     wording instead. */
  var _bankLoading = null;
  function loadBankLevels() {
    if (window.BANK_PROFICIENCY) return Promise.resolve(true);
    // One loader for the bank's files, so a page never fetches them twice.
    if (window.CompetencyWording) return CompetencyWording.loadBank();
    if (_bankLoading) return _bankLoading;
    // No page to load into (a test, a worker): the other wording stays.
    if (typeof document === 'undefined' || !document.head) return Promise.resolve(false);
    _bankLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = '/shared/bank-proficiency.js';
      s.onload = function () {
        resolve(!!window.BANK_PROFICIENCY);
      };
      s.onerror = function () {
        _bankLoading = null;
        resolve(false);
      };
      document.head.appendChild(s);
    });
    return _bankLoading;
  }

  // Whether a class has competencies from the bank and their wording hasn't
  // loaded yet (Reports' Feedback Pages print its Tag Rubrics too).
  function classUsesBankLevels(cid) {
    if (window.BANK_PROFICIENCY || typeof getLearningMap !== 'function') return false;
    var map = getLearningMap(cid) || {};
    return (map.sections || []).some(function (sec) {
      return (sec.tags || []).some(function (t) {
        return !!(t && t.bank_id);
      });
    });
  }

  // Whether an assessment's Tag Rubric would use the bank's wording.
  function _needsBankLevels(cid, assessment) {
    if (window.BANK_PROFICIENCY || !assessment || assessment.rubricId || isPointsScored(assessment)) return false;
    return scoreTagIds(assessment, cid).some(function (tid) {
      var tag = getTagById(cid, tid);
      return !!(tag && tag.bank_id);
    });
  }

  /* The rubric a proficiency assessment without one prints: a Tag Rubric
     (a row per competency it is scored on) or a General Rubric (one Overall
     row). Null for points and Complete/Incomplete work. */
  function defaultRubric(cid, assessment) {
    if (!assessment || isPointsScored(assessment)) return null;
    var ids = scoreTagIds(assessment, cid);
    if (!ids.length || (ids.length === 1 && isUnlinkedTag(ids[0]))) {
      return {
        id: 'general',
        name: 'General Rubric',
        kind: 'general',
        criteria: [{ id: UNLINKED_TAG_ID, name: 'Overall', tagIds: [], levels: GENERAL_LEVELS }],
      };
    }
    var criteria = ids
      .map(function (tid) {
        var tag = getTagById(cid, tid);
        if (!tag) return null;
        // The teacher's own wording, else the bank's for this competency,
        // else the BC scale's general wording, level by level.
        var own = _ownLevels(tag) || {};
        var bank = _bankLevels(tag) || {};
        var levels = {};
        LEVELS.forEach(function (lv) {
          levels[lv] = (own[lv] && String(own[lv]).trim()) || bank[lv] || GENERAL_LEVELS[lv];
        });
        return { id: tid, name: tag.label || tag.name || tag.code || '', tagIds: [tid], levels: levels };
      })
      .filter(Boolean);
    return criteria.length ? { id: 'tags', name: 'Competency Rubric', kind: 'tags', criteria: criteria } : null;
  }

  // The assessment's own rubric, else its Tag or General Rubric.
  function _rubric(cid, assessment) {
    return _customRubric(cid, assessment) || defaultRubric(cid, assessment);
  }

  /* The level shown for one criterion: the grid's rule. All of the
     criterion's competencies at one level give that level and its ±;
     disagreeing competencies give the lowest, marked mixed, with no ±. */
  function criterionLevel(entries, aid, criterion) {
    var mods = [];
    var levels = rubricCriterionScoreKeys(criterion)
      .map(function (tid) {
        var entry = entries.find(function (e) {
          return e && e.assessmentId === aid && e.tagId === tid;
        });
        var score = entry ? Number(entry.score) || 0 : 0;
        if (score > 0) mods.push(normalizeScoreMod(score, entry.mod));
        return score;
      })
      .filter(function (s) {
        return s > 0;
      });
    if (levels.length === 0) return { level: 0, mod: 0, mixed: false };
    var same = levels.every(function (s) {
      return s === levels[0];
    });
    var modsAgree = mods.every(function (m) {
      return m === mods[0];
    });
    if (same) return { level: levels[0], mod: modsAgree ? mods[0] : 0, mixed: false };
    return { level: Math.min.apply(null, levels), mod: 0, mixed: true };
  }

  /* The codes under a criterion. A Tag Rubric's row is named for its
     competency, so only a real code shows there, never the name again. */
  function _criterionCodes(cid, criterion, tagRubric) {
    return (criterion.tagIds || [])
      .map(function (tid) {
        var tag = getTagById(cid, tid);
        if (!tag) return '';
        if (tag.code) return tag.code;
        var idCode = tag.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(tag.id) ? tag.id : '';
        return idCode || (tagRubric ? '' : tag.label || '');
      })
      .filter(Boolean);
  }

  /* The feedback printed at the bottom: the Overall Comment (score.comment,
     the teacher's comment on the work; docs/DECISIONS.md "Assignment
     feedback"), one item per paragraph, with no day of its own. Observations
     linked to the work are a separate record and never print here.
     [{ text, date: '' }]. */
  function feedbackItems(cid, sid, aid, entries) {
    var note = '';
    (entries || ReportScores.entries(cid, sid)).forEach(function (e) {
      if (e && e.assessmentId === aid && e.note && !note) note = String(e.note).trim();
    });
    return note
      .split(/\n+/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean)
      .map(function (line) {
        return { text: line, date: '' };
      });
  }

  function _feedbackText(cid, sid, aid, entries) {
    return feedbackItems(cid, sid, aid, entries)
      .map(function (i) {
        return i.text;
      })
      .join('\n');
  }

  /* The name at the top of a sheet (printedStudentName in shared/data.js). */
  function printName(student, nameStyle) {
    return printedStudentName(student, nameStyle);
  }

  /* Everything one sheet shows. `scored` is false for a blank rubric.
     `nameStyle` picks the name at the top (printName). */
  function sheetData(cid, aid, sid, nameStyle) {
    var assessment = _assessment(cid, aid);
    if (assessment && isPointsScored(assessment)) return scoreSheetData(cid, aid, sid, nameStyle);
    var rubric = _rubric(cid, assessment);
    var student = getStudents(cid).find(function (s) {
      return s && s.id === sid;
    });
    if (!assessment || !rubric || !student) return null;
    var entries = ReportScores.entries(cid, sid).filter(function (e) {
      return e && e.assessmentId === aid;
    });
    var status = ReportScores.getAssignmentStatus(cid, sid, aid);
    var rows = (rubric.criteria || []).map(function (criterion) {
      var lv = criterionLevel(entries, aid, criterion);
      return {
        criterion: criterion,
        level: lv.level,
        mod: lv.mod,
        mixed: lv.mixed,
        // Comments belong to a rubric of the teacher's own (on a criterion)
        // or a Tag Rubric (on a competency); a General Rubric has none.
        comment: !rubric.kind
          ? ReportScores.getRubricCriterionComment(cid, sid, aid, criterion)
          : rubric.kind === 'tags'
            ? ReportScores.getTagComment(cid, sid, aid, criterion.id)
            : '',
        // A single-point rubric's Went Beyond; its Work On is the comment.
        beyond: !rubric.kind ? ReportScores.getRubricCriterionBeyond(cid, sid, aid, criterion) : '',
        codes: _criterionCodes(cid, criterion, rubric.kind === 'tags'),
      };
    });
    var scored = rows.some(function (r) {
      return r.level > 0;
    });
    var overall = null;
    if (scored && typeof getAssessmentOverallScore === 'function') {
      var value = getAssessmentOverallScore(cid, sid, aid);
      if (value > 0) {
        overall = {
          value: value,
          // As the gradebook cell shows it: in a Letter or Both class, the %
          // the piece counts as in its category (Colin, 2026-11-03).
          text: typeof assessmentCellValue === 'function' ? assessmentCellValue(cid, sid, assessment).text : '',
          word: typeof levelWord === 'function' ? levelWord(cid, value) : '',
        };
      }
    }
    return {
      cid: cid,
      courseName: _courseName(cid),
      assessment: assessment,
      rubric: rubric,
      student: student,
      studentName: printName(student, nameStyle || DEFAULT_OPTIONS.nameStyle),
      date: assessment.date ? formatDate(assessment.date) : '',
      status: status === 'NS' ? 'Missing' : status === 'EXC' ? 'Excused' : status === 'LATE' ? 'Late' : '',
      scored: scored,
      rows: rows,
      overall: overall,
      feedback: _feedbackText(cid, sid, aid, entries),
      // An Advanced Rubric's ticked checkboxes for this student.
      ticked: ReportScores.getRubricCheckIds(cid, sid, aid),
    };
  }

  /* The score a points or Complete/Incomplete sheet shows: "18 / 20" and
     "90%", or "Complete" / "Incomplete". Null when there is no score. */
  function _scoreOverall(cid, sid, assessment) {
    if (isCompletionScored(assessment)) {
      var mark = ReportScores.getCompletionMark(cid, sid, assessment.id);
      if (!mark) return null;
      return { value: mark === 'complete' ? 1 : 0, text: mark === 'complete' ? 'Complete' : 'Incomplete', word: '' };
    }
    var points = ReportScores.getPointsScore(cid, sid, assessment.id);
    if (points == null) return null;
    var max = Number(assessment.maxPoints) || 0;
    return {
      value: points,
      text: formatPoints(points) + (max > 0 ? ' / ' + formatPoints(max) : ''),
      word: max > 0 ? formatPointsPercent(points, max) : '',
    };
  }

  /* One student's score sheet on points or Complete/Incomplete work. */
  function scoreSheetData(cid, aid, sid, nameStyle) {
    var assessment = _assessment(cid, aid);
    var student = getStudents(cid).find(function (s) {
      return s && s.id === sid;
    });
    if (!assessment || !student) return null;
    var entries = ReportScores.entries(cid, sid).filter(function (e) {
      return e && e.assessmentId === aid;
    });
    var status = ReportScores.getAssignmentStatus(cid, sid, aid);
    var overall = _scoreOverall(cid, sid, assessment);
    return {
      cid: cid,
      scoreOnly: true,
      courseName: _courseName(cid),
      assessment: assessment,
      rubric: null,
      student: student,
      studentName: printName(student, nameStyle || DEFAULT_OPTIONS.nameStyle),
      date: assessment.date ? formatDate(assessment.date) : '',
      status: status === 'NS' ? 'Missing' : status === 'EXC' ? 'Excused' : status === 'LATE' ? 'Late' : '',
      scored: !!overall,
      rows: [],
      overall: overall,
      feedback: _feedbackText(cid, sid, aid, entries),
      ticked: [],
    };
  }

  /* A blank sheet: the rubric with no student, no levels marked and a Name
     line to write on. `assessment` is optional; it adds the title and date. */
  function blankSheetData(cid, rubric, assessment) {
    if (!rubric) return null;
    return {
      cid: cid,
      blank: true,
      courseName: _courseName(cid),
      assessment: assessment || null,
      rubric: rubric,
      student: null,
      studentName: '',
      date: assessment && assessment.date ? formatDate(assessment.date) : '',
      status: '',
      scored: false,
      rows: (rubric.criteria || []).map(function (criterion) {
        return {
          criterion: criterion,
          level: 0,
          mod: 0,
          mixed: false,
          comment: '',
          beyond: '',
          codes: _criterionCodes(cid, criterion, rubric.kind === 'tags'),
        };
      }),
      overall: null,
      feedback: '',
      ticked: [],
    };
  }

  /* The assessments that use a rubric of the teacher's own, newest first. */
  function usesOf(cid, rubricId) {
    return (getAssessments(cid) || [])
      .filter(function (a) {
        return a && a.rubricId === rubricId;
      })
      .sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      });
  }

  /* The rubric a print job draws: the assessment's, else the one named. */
  function _jobRubric(cid, aid, opts) {
    if (aid) return _rubric(cid, _assessment(cid, aid));
    return opts && opts.rubricId ? getRubricById(cid, opts.rubricId) || null : null;
  }

  function _copies(n) {
    n = Math.round(Number(n));
    if (!(n >= 1)) return 1;
    return Math.min(MAX_COPIES, n);
  }

  /* The class by last name, as the roster and gradebook list it. */
  function _rosterOrder(cid) {
    return sortStudents(getStudents(cid), 'lastName');
  }

  /* The students to print, by last name. */
  function selectStudents(cid, aid, opts) {
    var students = _rosterOrder(cid);
    if (opts.students === 'all') return students;
    if (opts.students === 'unprinted' || opts.students === 'changed') {
      var want = opts.students === 'unprinted' ? 'unprinted' : 'changed';
      return students.filter(function (s) {
        return printState(cid, aid, s.id).kind === want;
      });
    }
    if (opts.students === 'pick') {
      var picked = opts.picked || [];
      return students.filter(function (s) {
        return picked.indexOf(s.id) >= 0;
      });
    }
    return students.filter(function (s) {
      return isStudentScored(cid, aid, s.id);
    });
  }

  function isStudentScored(cid, aid, sid) {
    var assessment = _assessment(cid, aid);
    if (assessment && isPointsScored(assessment)) {
      return ReportScores.entries(cid, sid).some(function (e) {
        return e && e.assessmentId === aid && isScoreEntered(assessment, e);
      });
    }
    var rubric = _rubric(cid, assessment);
    if (!rubric) return false;
    var entries = ReportScores.entries(cid, sid);
    return (rubric.criteria || []).some(function (criterion) {
      return criterionLevel(entries, aid, criterion).level > 0;
    });
  }

  /* ── Printed rubrics ────────────────────────────────────────
     Print Rubrics records each scored student it prints (setRubricPrints in
     shared/data.js, migrations/20261102_rubric_print.sql). A print keeps a
     fingerprint of what the sheet showed; when the sheet would show
     something else now, the rubric has changed since it was printed. */

  // A 53-bit string hash (cyrb53), as 14 hex digits. Not for security: it
  // only tells one sheet's content from another's.
  function _hash(str) {
    var h1 = 0xdeadbeef,
      h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return ('00000000000000' + n.toString(16)).slice(-14);
  }

  /* What a student's completed rubric shows, as a fingerprint: each
     criterion's level, ± and comments, the overall level, the feedback, the
     ticked checkboxes and the status. Not the name or what is included,
     which the dialog sets each time. '' when there is nothing scored. */
  function fingerprint(cid, aid, sid) {
    var assessment = _assessment(cid, aid);
    if (!assessment || isPointsScored(assessment)) return '';
    var data = sheetData(cid, aid, sid);
    if (!data || !data.scored) return '';
    var parts = {
      rows: data.rows.map(function (r) {
        return [r.criterion.id, r.level || 0, r.mod || 0, r.mixed ? 1 : 0, r.comment || '', r.beyond || ''];
      }),
      overall: data.overall ? data.overall.value : null,
      feedback: data.feedback || '',
      ticked: (data.ticked || []).slice().sort(),
      status: data.status || '',
    };
    return _hash(JSON.stringify(parts));
  }

  /* Where one student's completed rubric stands:
       { kind: 'unscored' }            nothing to print
       { kind: 'unprinted' }           scored, never printed
       { kind: 'printed', at }         printed, and the same now
       { kind: 'changed', at }         printed, and different now
     `at` is the ISO time of the last print. */
  function printState(cid, aid, sid) {
    var print = typeof getRubricPrint === 'function' ? getRubricPrint(cid, sid, aid) : null;
    var now = fingerprint(cid, aid, sid);
    if (!now) return { kind: 'unscored', at: print ? print.at : null };
    if (!print) return { kind: 'unprinted', at: null };
    return { kind: print.hash === now ? 'printed' : 'changed', at: print.at };
  }

  /* Whether any student's rubric for this assessment has been printed. */
  function hasPrints(cid, aid) {
    if (!aid || typeof getRubricPrints !== 'function') return false;
    var prints = getRubricPrints(cid);
    var suffix = ':' + aid;
    return Object.keys(prints).some(function (k) {
      return k.slice(-suffix.length) === suffix;
    });
  }

  // "Oct 30", in the teacher's own time zone.
  function _printDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  var _PRINTER_ICON =
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6V2h7v4"/><rect x="2" y="6" width="12" height="5.5" rx="1.2"/><path d="M4.5 9.5h7V14h-7z"/></svg>';

  /* The small Printed / Changed Since Printed marker beside a student's name
     on the Assignments page and in the grader. Empty and hidden when the
     rubric has not been printed. refreshMarks keeps it current. */
  function _markInner(state) {
    if (state.kind === 'printed') return _PRINTER_ICON + 'Printed ' + esc(_printDate(state.at));
    if (state.kind === 'changed') return _PRINTER_ICON + 'Changed Since Printed';
    return '';
  }
  function _markClass(state) {
    return 'rp-mark' + (state.kind === 'changed' ? ' is-changed' : '');
  }
  // Only a printed rubric needs its fingerprint worked out: the marker is
  // drawn for every student row on the page.
  function _markState(cid, aid, sid) {
    var printed = typeof getRubricPrint === 'function' && getRubricPrint(cid, sid, aid);
    return printed ? printState(cid, aid, sid) : { kind: 'unprinted', at: null };
  }
  /* The mark's state, or null while it cannot be worked out: in a class
     that holds grades whose Draft and Returned rows have not loaded (the
     first draw of a session, or offline), what the handout would print
     now is not known (ReportScores.ready). Then there is no mark. The page
     is drawn again when the rows load (the data layer's redraw), and the
     marks with it. Any other fault in working it out is reported (the
     console and Sentry, once for the page) and leaves no mark. A mark
     never stops a page drawing. */
  function _markStateOrNone(cid, aid, sid) {
    try {
      return ReportScores.ready(cid) ? _markState(cid, aid, sid) : null;
    } catch (e) {
      _reportFault('The Printed marks could not be worked out', e);
      return null;
    }
  }

  /* A fault on the handout's side, reported without taking down the page
     that asked: to the console and to Sentry, once for each kind of fault
     until the page is drawn again. */
  var _faultsReported = {};
  function _reportFault(what, e) {
    var key = what + ': ' + (e && e.message);
    if (_faultsReported[key]) return;
    _faultsReported[key] = true;
    setTimeout(function () {
      delete _faultsReported[key];
    }, 0);
    console.error(what + ':', e);
    if (window.Sentry && typeof window.Sentry.captureException === 'function') window.Sentry.captureException(e);
  }
  function markHtml(cid, aid, sid) {
    var state = _markStateOrNone(cid, aid, sid) || { kind: 'unprinted', at: null };
    var on = state.kind === 'printed' || state.kind === 'changed';
    return (
      '<span class="' +
      _markClass(state) +
      '" data-rp-mark-sid="' +
      esc(sid) +
      '" data-rp-mark-aid="' +
      esc(aid) +
      '"' +
      (on ? '' : ' hidden') +
      '>' +
      (on ? _markInner(state) : '') +
      '</span>'
    );
  }
  function refreshMarks(cid, root) {
    (root || document).querySelectorAll('[data-rp-mark-sid]').forEach(function (el) {
      var state = _markStateOrNone(cid, el.dataset.rpMarkAid, el.dataset.rpMarkSid) || { kind: 'unprinted', at: null };
      var on = state.kind === 'printed' || state.kind === 'changed';
      var html = on ? _markInner(state) : '';
      var cls = _markClass(state);
      if (el.className !== cls) el.className = cls;
      el.hidden = !on;
      // html-safe: _markInner is a constant icon plus esc()'d date text
      if (el.innerHTML !== html) el.innerHTML = html;
    });
  }

  function _notifyPrintsChanged(cid, aid) {
    try {
      document.dispatchEvent(new CustomEvent('fv:rubric-prints-changed', { detail: { cid: cid, aid: aid } }));
    } catch (e) {
      /* no listeners is fine */
    }
  }

  /* Record the completed rubrics a print job holds: every scored student in
     it. Returns what Undo puts back: each student's print before this one. */
  function markPrinted(cid, aid, sids) {
    var at = new Date().toISOString();
    var marks = [];
    var before = [];
    sids.forEach(function (sid) {
      var hash = fingerprint(cid, aid, sid);
      if (!hash) return;
      var prev = getRubricPrint(cid, sid, aid);
      before.push(prev ? { sid: sid, hash: prev.hash, at: prev.at } : { sid: sid, hash: null });
      marks.push({ sid: sid, hash: hash, at: at });
    });
    if (marks.length) {
      setRubricPrints(cid, aid, marks);
      _notifyPrintsChanged(cid, aid);
    }
    return before;
  }

  function unmarkPrinted(cid, aid, sid) {
    setRubricPrints(cid, aid, [{ sid: sid, hash: null }]);
    _notifyPrintsChanged(cid, aid);
  }

  /* The layout for a number of picked students: one on a full page, two
     two to a page, three or more four to a page. */
  function layoutForCount(n) {
    return n >= 3 ? 'quarter' : n === 2 ? 'half' : 'full';
  }

  function pageCount(sheets, layoutKey) {
    var layout = LAYOUTS[layoutKey] || LAYOUTS.full;
    var perPage = layout.cols * layout.rows;
    return Math.ceil(sheets / perPage);
  }

  /* ── Rendering ──────────────────────────────────────────── */

  function _markHtml(row) {
    var mark = '✓';
    if (row.mod > 0) mark += '+';
    else if (row.mod < 0) mark += '−';
    return '<span class="rubric-mark" aria-label="' + esc(LEVEL_NAMES[row.level] || '') + '">' + mark + '</span>';
  }

  /* An Advanced Rubric's checkboxes for one level: an empty square, or a
     black one with a white tick when ticked. Black and white only. */
  function _checksHtml(criterion, level, ticked) {
    if (typeof RubricChecks === 'undefined') return '';
    var boxes = RubricChecks.checksAt(criterion, level);
    if (!boxes.length) return '';
    var on = ticked || [];
    return (
      '<div class="rubric-checks">' +
      boxes
        .map(function (check) {
          var isOn = on.indexOf(check.id) >= 0;
          return (
            '<div class="rubric-check' +
            (isOn ? ' is-on' : '') +
            '"><span class="rubric-box" aria-label="' +
            (isOn ? 'Ticked' : 'Not ticked') +
            '">' +
            (isOn ? '✓' : '') +
            '</span><span>' +
            esc(check.label) +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function _isAdvancedRubric(rubric) {
    return !!rubric && !rubric.kind && typeof rubricStyle === 'function' && rubricStyle(rubric) === 'advanced';
  }

  function _isSinglePoint(rubric) {
    return !!rubric && !rubric.kind && typeof rubricStyle === 'function' && rubricStyle(rubric) === 'single_point';
  }

  /* A single-point rubric: Criterion | Work On | Proficient Standard | Went
     Beyond. The standard's cell names the student's level. On a graded
     sheet the two note columns print only when some criterion has one; a
     blank copy keeps them empty to write in. */
  function _singlePointTableHtml(data, include) {
    var notes = include.criterionComments !== false;
    var showWork =
      data.blank ||
      (notes &&
        data.rows.some(function (r) {
          return r.comment;
        }));
    var showBeyond =
      data.blank ||
      (notes &&
        data.rows.some(function (r) {
          return r.beyond;
        }));
    var html =
      '<table class="rubric-table is-single-point"><thead><tr><th class="rubric-crit-head">' +
      esc(data.rubric.name || 'Criteria') +
      '</th>' +
      (showWork ? '<th class="rubric-level-head rubric-sp-note-head">Work On</th>' : '') +
      '<th class="rubric-level-head rubric-sp-standard-head">Proficient Standard</th>' +
      (showBeyond ? '<th class="rubric-level-head rubric-sp-note-head">Went Beyond</th>' : '') +
      '</tr></thead><tbody>';
    data.rows.forEach(function (row) {
      var c = row.criterion;
      var scored = row.level > 0;
      html +=
        '<tr class="rubric-row"><th class="rubric-crit" scope="row"><div class="rubric-crit-name">' +
        esc(c.name) +
        '</div>';
      if (include.codes && row.codes.length)
        html += '<div class="rubric-crit-codes">' + esc(row.codes.join(' · ')) + '</div>';
      html += '</th>';
      if (showWork) html += '<td class="rubric-cell rubric-sp-note">' + esc(row.comment || '') + '</td>';
      html +=
        '<td class="rubric-cell rubric-sp-standard' +
        (scored ? ' is-scored l' + row.level + (row.mixed ? ' is-mixed' : '') : '') +
        '">' +
        (scored
          ? '<span class="rubric-sp-level">' +
            esc(LEVEL_NAMES[row.level] || '') +
            (row.mod > 0 ? ' +' : row.mod < 0 ? ' −' : '') +
            '</span>'
          : '') +
        esc((c.levels && (c.levels[3] || c.levels['3'])) || '') +
        '</td>';
      if (showBeyond) html += '<td class="rubric-cell rubric-sp-note">' + esc(row.beyond || '') + '</td>';
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  function renderSheet(data, opts) {
    var include = opts.include || DEFAULT_OPTIONS.include;
    // The level columns run in the class's Rubric Levels order.
    var levels = levelOrderFor(data.cid);
    var html = '<div class="rubric-sheet"><div class="rubric-sheet-inner">';
    html += '<div class="rubric-head"><div class="rubric-head-main">';
    html += data.blank
      ? '<div class="rubric-student rubric-name-line"><span class="rubric-label">Name</span><span class="rubric-name-rule"></span></div>'
      : '<div class="rubric-student">' + esc(data.studentName) + '</div>';
    var meta = [data.courseName, data.assessment && data.assessment.title, data.date].filter(Boolean);
    html += '<div class="rubric-meta">' + meta.map(esc).join(' · ') + '</div>';
    html += '</div>';
    if (include.overall && data.overall) {
      html +=
        '<div class="rubric-overall"><span class="rubric-label">' +
        (data.scoreOnly ? (isCompletionScored(data.assessment) ? 'Mark' : 'Score') : 'Overall') +
        '</span><span class="rubric-overall-value">' +
        esc(data.overall.text) +
        '</span>' +
        (data.overall.word ? '<span class="rubric-overall-word">' + esc(data.overall.word) + '</span>' : '') +
        '</div>';
    } else if (data.status && data.status !== 'Late') {
      html += '<div class="rubric-overall"><span class="rubric-status">' + esc(data.status) + '</span></div>';
    }
    html += '</div>';

    if (data.scoreOnly) return html + _feedbackHtml(data, include) + '</div></div>';
    if (_isSinglePoint(data.rubric)) {
      html += _singlePointTableHtml(data, include);
      return html + _feedbackHtml(data, include) + _nextStepsHtml(include) + '</div></div>';
    }
    html +=
      '<table class="rubric-table"><thead><tr><th class="rubric-crit-head">' +
      esc(data.rubric.name || 'Criteria') +
      '</th>';
    levels.forEach(function (lv) {
      html += '<th class="rubric-level-head l' + lv + '">' + LEVEL_NAMES[lv] + '</th>';
    });
    html += '</tr></thead><tbody>';
    data.rows.forEach(function (row) {
      var c = row.criterion;
      html +=
        '<tr class="rubric-row"><th class="rubric-crit" scope="row"><div class="rubric-crit-name">' +
        esc(c.name) +
        '</div>';
      if (include.codes && row.codes.length)
        html += '<div class="rubric-crit-codes">' + esc(row.codes.join(' · ')) + '</div>';
      html += '</th>';
      levels.forEach(function (lv) {
        var scored = row.level === lv;
        html +=
          '<td class="rubric-cell' +
          (scored ? ' is-scored l' + lv + (row.mixed ? ' is-mixed' : '') : '') +
          '">' +
          (scored ? _markHtml(row) : '') +
          esc((c.levels && c.levels[lv]) || '') +
          (include.checks ? _checksHtml(c, lv, data.ticked) : '') +
          '</td>';
      });
      html += '</tr>';
      if (include.criterionComments && row.comment) {
        html +=
          '<tr class="rubric-comment-row"><td colspan="' +
          (levels.length + 1) +
          '"><span class="rubric-label">Comment</span>' +
          esc(row.comment) +
          '</td></tr>';
      }
    });
    html += '</tbody></table>';
    html += _feedbackHtml(data, include);
    html += _nextStepsHtml(include);
    html += '</div></div>';
    return html;
  }

  /* Next Steps Reflection: a question for the student at the foot of the
     rubric, with ruled lines to answer on. Like the feedback lines, it
     takes the rest of the sheet (sharing it with them), never fewer than
     its minimum lines. */
  function _nextStepsHtml(include) {
    if (!include.nextSteps) return '';
    return (
      '<div class="rubric-feedback is-lines rubric-reflect"><div class="rubric-label">Next Steps</div>' +
      '<div class="rubric-reflect-q">' +
      esc(NEXT_STEPS_PROMPT) +
      '</div><div class="rubric-lines">' +
      new Array(LINE_ROWS + 1).join('<div class="rubric-line"></div>') +
      '</div></div>'
    );
  }

  function _feedbackHtml(data, include) {
    if (!include.feedback) return '';
    // Written feedback prints in a box; with none, ruled lines fill the rest
    // of the sheet for the teacher to write on by hand.
    return data.feedback
      ? '<div class="rubric-feedback"><div class="rubric-label">Feedback</div><div class="rubric-feedback-text">' +
          esc(data.feedback).replace(/\n/g, '<br>') +
          '</div></div>'
      : '<div class="rubric-feedback is-lines"><div class="rubric-label">Feedback</div><div class="rubric-lines">' +
          // More lines than any sheet holds; the box shows the whole ones
          // that fit. Borders, not a background, so they always print.
          new Array(LINE_ROWS + 1).join('<div class="rubric-line"></div>') +
          '</div></div>';
  }

  function renderPages(cid, aid, opts) {
    var layout = LAYOUTS[opts.layout] || LAYOUTS.full;
    var perPage = layout.cols * layout.rows;
    if (opts.mode === 'blank') return _renderBlankPages(cid, aid, opts, layout, perPage);
    var students = selectStudents(cid, aid, opts);
    var html = '';
    for (var i = 0; i < students.length; i += perPage) {
      html += '<div class="rubric-page layout-' + layout.key + '" style="font-size:' + layout.fontPt + 'pt">';
      for (var j = i; j < i + perPage; j++) {
        if (j < students.length) {
          var data = sheetData(cid, aid, students[j].id, opts.nameStyle);
          html += data ? renderSheet(data, opts) : '<div class="rubric-sheet"></div>';
        } else {
          html += '<div class="rubric-sheet is-blank"></div>';
        }
      }
      html += '</div>';
    }
    return { html: html, sheets: students.length, pages: Math.ceil(students.length / perPage) };
  }

  /* Blank copies of the rubric. Only competency codes can be added: there is
     no student, level, comment or feedback to print. */
  function _renderBlankPages(cid, aid, opts, layout, perPage) {
    var data = blankSheetData(cid, _jobRubric(cid, aid, opts), aid ? _assessment(cid, aid) : null);
    var count = data ? _copies(opts.copies) : 0;
    var sheetOpts = {
      include: {
        codes: !!(opts.include && opts.include.codes),
        checks: !!(opts.include && opts.include.checks),
        nextSteps: !!(opts.include && opts.include.nextSteps),
      },
    };
    var sheet = data ? renderSheet(data, sheetOpts) : '';
    var html = '';
    for (var i = 0; i < count; i += perPage) {
      html += '<div class="rubric-page layout-' + layout.key + '" style="font-size:' + layout.fontPt + 'pt">';
      for (var j = i; j < i + perPage; j++) html += j < count ? sheet : '<div class="rubric-sheet is-blank"></div>';
      html += '</div>';
    }
    return { html: html, sheets: count, pages: Math.ceil(count / perPage) };
  }

  /* ── DOM: print root, measuring, printing ───────────────── */

  function _root() {
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('aria-hidden', 'true');
      document.body.appendChild(root);
    }
    return root;
  }

  /* How far the text may shrink, in 5% steps, before a sheet counts as
     overflowing: down to the layout's minPt, the smallest that still reads
     on paper. A long rubric on a half or quarter sheet goes smaller than a
     short one so its cells and writing lines fit (Colin, Oct 29). */
  function shrinkSteps(layout) {
    var floor = (layout.minPt || layout.fontPt) / layout.fontPt;
    var steps = [];
    for (var f = 1; f > floor + 1e-9; f = Math.round((f - 0.05) * 100) / 100) steps.push(f);
    steps.push(Math.round(floor * 1000) / 1000);
    return steps;
  }

  function _countOverflowing(sheets) {
    var n = 0;
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      var over = sheet.scrollHeight > sheet.clientHeight + 1 || sheet.scrollWidth > sheet.clientWidth + 1;
      sheet.classList.toggle('is-overflowing', over);
      if (over) n++;
    }
    return n;
  }

  /* Render into the off-screen root and measure. Every page's text shrinks
     by the same step until all sheets fit, down to the layout's minPt; the
     sheets still too tall are counted so the dialog can warn. */
  function stage(cid, aid, opts) {
    var root = _root();
    var out = renderPages(cid, aid, opts);
    // html-safe: out.html is built by renderPages and renderSheet; student, course, rubric, criterion and assessment text and comments through esc; layouts and levels are constants
    root.innerHTML = out.html;
    root.dataset.layout = opts.layout;
    root.setAttribute('lang', 'en');
    var layout = LAYOUTS[opts.layout] || LAYOUTS.full;
    var pages = root.querySelectorAll ? root.querySelectorAll('.rubric-page') : [];
    var sheets = root.querySelectorAll ? root.querySelectorAll('.rubric-sheet:not(.is-blank)') : [];
    var overflowing = 0;
    var scale = 1;
    var steps = shrinkSteps(layout);
    for (var s = 0; s < steps.length; s++) {
      scale = steps[s];
      for (var p = 0; p < pages.length; p++) pages[p].style.fontSize = layout.fontPt * scale + 'pt';
      overflowing = _countOverflowing(sheets);
      if (!overflowing) break;
    }
    out.overflowing = overflowing;
    out.scale = scale;
    return out;
  }

  // Sheets are cut apart, so every page gets the same margin (ui.js setPrintMode).
  function _activatePrintMode(layoutKey) {
    var layout = LAYOUTS[layoutKey] || LAYOUTS.full;
    setPrintMode(STYLE_ID, 'rubric-print-active', 'letter ' + layout.orientation, layout.margin + 'in');
  }

  function _deactivatePrintMode() {
    clearPrintMode(STYLE_ID, 'rubric-print-active');
  }

  function print(cid, aid, opts) {
    var out = stage(cid, aid, opts);
    if (!out.sheets) return out;
    _activatePrintMode(opts.layout);
    printThen(function () {
      _deactivatePrintMode();
      var root = document.getElementById(ROOT_ID);
      if (root) root.innerHTML = '';
    });
    return out;
  }

  /* ── Options dialog ─────────────────────────────────────── */

  function _loadOptions() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    var opts = {
      mode: DEFAULT_OPTIONS.mode,
      copies: DEFAULT_OPTIONS.copies,
      students: DEFAULT_OPTIONS.students,
      picked: [],
      layout: DEFAULT_OPTIONS.layout,
      nameStyle: DEFAULT_OPTIONS.nameStyle,
      include: Object.assign({}, DEFAULT_OPTIONS.include),
    };
    if (saved && typeof saved === 'object') {
      if (LAYOUTS[saved.layout]) opts.layout = saved.layout;
      if (saved.nameStyle === 'first' || saved.nameStyle === 'preferred') opts.nameStyle = saved.nameStyle;
      if (saved.include && typeof saved.include === 'object') {
        Object.keys(opts.include).forEach(function (k) {
          if (typeof saved.include[k] === 'boolean') opts.include[k] = saved.include[k];
        });
      }
    }
    return opts;
  }

  // The layout saved is the one the teacher last chose, not one picked for
  // them by how many students are ticked.
  function _saveOptions(opts, layout) {
    try {
      localStorage.setItem(
        OPTIONS_KEY,
        JSON.stringify({ layout: layout || opts.layout, nameStyle: opts.nameStyle, include: opts.include }),
      );
    } catch (e) {
      /* storage full or blocked: the defaults are fine */
    }
  }

  function _radio(name, value, checked, label, help) {
    return (
      '<label class="rp-option"><input type="radio" name="' +
      name +
      '" value="' +
      value +
      '"' +
      (checked ? ' checked' : '') +
      '><span>' +
      esc(label) +
      (help ? ' <span class="rp-help">' + esc(help) + '</span>' : '') +
      '</span></label>'
    );
  }

  function _check(key, checked, label) {
    return (
      '<label class="rp-option"><input type="checkbox" data-include="' +
      key +
      '"' +
      (checked ? ' checked' : '') +
      '><span>' +
      esc(label) +
      '</span></label>'
    );
  }

  /* A choice drawn as a tile: a real radio, so arrows and Space work. */
  function _tile(name, value, checked, title, help, drawing, disabled) {
    return (
      '<label class="rp-tile' +
      (checked ? ' is-on' : '') +
      (disabled ? ' is-disabled' : '') +
      '"><input type="radio" name="' +
      name +
      '" value="' +
      value +
      '"' +
      (checked ? ' checked' : '') +
      (disabled ? ' disabled' : '') +
      '>' +
      (drawing || '') +
      '<span class="rp-tile-title">' +
      esc(title) +
      '</span><span class="rp-tile-help">' +
      esc(help) +
      '</span></label>'
    );
  }

  /* A small page with its sheets, for the Rubrics per Page tiles. */
  function _pageDrawing(layout) {
    var cells = '';
    for (var i = 0; i < layout.cols * layout.rows; i++) cells += '<span></span>';
    return (
      '<span class="rp-page-icon is-' +
      layout.orientation +
      '" style="grid-template-columns:repeat(' +
      layout.cols +
      ',1fr);grid-template-rows:repeat(' +
      layout.rows +
      ',1fr)" aria-hidden="true">' +
      cells +
      '</span>'
    );
  }

  /* A criterion with a competency code, so Competency Codes has something
     to print. */
  function _hasCodes(cid, rubric) {
    if (!rubric || rubric.kind === 'general') return false;
    return (rubric.criteria || []).some(function (c) {
      return _criterionCodes(cid, c, rubric.kind === 'tags').length > 0;
    });
  }

  function _dialogHtml() {
    var cid = _state.cid;
    var aid = _state.aid;
    var opts = _state.opts;
    var blank = opts.mode === 'blank';
    var rubric = _jobRubric(cid, aid, opts);
    var students = _rosterOrder(cid);
    if (_state.scoreOnly) return _scoreDialogHtml(cid, aid, opts, students);
    var html = '<div class="confirm-card rubric-print-card">';
    html += '<div class="confirm-title" id="rp-title">Print Rubrics</div>';
    html +=
      '<div class="confirm-message">' +
      esc(rubric ? rubric.name : '') +
      (rubric
        ? ' · ' + esc((rubric.criteria || []).length === 1 ? '1 Criterion' : rubric.criteria.length + ' Criteria')
        : '') +
      '</div>';
    html += '<div class="rp-body"><div class="rp-groups">';

    html += '<fieldset class="rp-group"><legend>What to Print</legend><div class="rp-tiles">';
    html += _tile(
      'rp-mode',
      'completed',
      !blank,
      'Completed Rubrics',
      _state.uses.length ? 'One per student, with their scores' : 'No assessment uses this rubric yet',
      '',
      !_state.uses.length,
    );
    html += _tile('rp-mode', 'blank', blank, 'Blank Rubric', 'No names or scores, for handing out');
    html += '</div></fieldset>';

    if (!blank && _state.uses.length > 1) {
      html +=
        '<label class="rp-group rp-field"><span class="rp-legend">Assessment</span><select class="rp-select" id="rp-assessment">' +
        _state.uses
          .map(function (a) {
            return (
              '<option value="' +
              esc(a.id) +
              '"' +
              (a.id === aid ? ' selected' : '') +
              '>' +
              esc(a.title || 'Untitled') +
              (a.date ? ' · ' + esc(formatDate(a.date)) : '') +
              '</option>'
            );
          })
          .join('') +
        '</select></label>';
    }

    if (blank) {
      html +=
        '<label class="rp-group rp-field"><span class="rp-legend">Copies</span><input type="number" class="rp-copies" id="rp-copies" min="1" max="' +
        MAX_COPIES +
        '" step="1" value="' +
        _copies(opts.copies) +
        '"></label>';
    } else {
      html += _studentsGroupHtml(cid, aid, opts, students);
    }

    html += '<fieldset class="rp-group"><legend>Rubrics per Page</legend><div class="rp-tiles is-three">';
    LAYOUT_ORDER.forEach(function (key) {
      var layout = LAYOUTS[key];
      html += _tile('rp-layout', key, opts.layout === key, layout.tile, layout.tileHelp, _pageDrawing(layout));
    });
    html += '</div></fieldset>';

    if (!blank) html += _nameGroupHtml(opts);

    var includes = '';
    if (!blank) {
      includes += _check('overall', opts.include.overall, 'Overall Level');
      includes += _check('feedback', opts.include.feedback, 'Feedback Comment');
      // A General Rubric has no row comments; a Tag Rubric's are on its competencies.
      if (rubric && !rubric.kind)
        includes += _check(
          'criterionComments',
          opts.include.criterionComments,
          _isSinglePoint(rubric) ? 'Work On and Went Beyond' : 'Criterion Comments',
        );
      else if (rubric && rubric.kind === 'tags')
        includes += _check('criterionComments', opts.include.criterionComments, 'Competency Comments');
    }
    if (_hasCodes(cid, rubric)) includes += _check('codes', opts.include.codes, 'Competency Codes');
    if (_isAdvancedRubric(rubric)) includes += _check('checks', opts.include.checks, 'Checkboxes');
    if (rubric) includes += _check('nextSteps', opts.include.nextSteps, 'Next Steps Reflection');
    if (includes) html += '<fieldset class="rp-group"><legend>Include</legend>' + includes + '</fieldset>';
    html += '</div>';
    html += _sideAndActionsHtml();
    return html;
  }

  /* Who to print: all scored, everyone, or the students ticked. */
  function _studentsGroupHtml(cid, aid, opts, students) {
    var html = '';
    var scoredCount = students.filter(function (s) {
      return isStudentScored(cid, aid, s.id);
    }).length;
    // Once any of this work's rubrics are printed, the window offers what is
    // left to print and what has changed since, and says which is which.
    var printed = hasPrints(cid, aid);
    var states = {};
    var counts = { unprinted: 0, changed: 0 };
    if (printed) {
      students.forEach(function (s) {
        states[s.id] = printState(cid, aid, s.id);
        if (counts[states[s.id].kind] !== undefined) counts[states[s.id].kind]++;
      });
    }
    html += '<fieldset class="rp-group"><legend>Students</legend>';
    if (printed) {
      html += _radio(
        'rp-students',
        'unprinted',
        opts.students === 'unprinted',
        'Not Yet Printed',
        '(' + counts.unprinted + ')',
      );
      html += _radio(
        'rp-students',
        'changed',
        opts.students === 'changed',
        'Changed Since Printed',
        '(' + counts.changed + ')',
      );
    }
    html += _radio('rp-students', 'scored', opts.students === 'scored', 'All Scored Students', '(' + scoredCount + ')');
    html += _radio('rp-students', 'all', opts.students === 'all', 'All Students', '(' + students.length + ')');
    html += _radio('rp-students', 'pick', opts.students === 'pick', 'Pick Students');
    // Always shown: ticking a name switches to Pick Students.
    html += '<div class="rp-pick">';
    students.forEach(function (s) {
      var state = states[s.id];
      var tag = '';
      if (!isStudentScored(cid, aid, s.id)) tag = '<span class="rp-help">not scored</span>';
      else if (state && state.kind === 'printed')
        tag = '<span class="rp-help">printed ' + esc(_printDate(state.at)) + '</span>';
      else if (state && state.kind === 'changed')
        tag = '<span class="rp-tag is-changed">changed since ' + esc(_printDate(state.at)) + '</span>';
      else if (state && state.kind === 'unprinted') tag = '<span class="rp-tag is-new">not printed</span>';
      var canUnmark = state && (state.kind === 'printed' || state.kind === 'changed');
      html +=
        '<div class="rp-pick-row' +
        (canUnmark ? ' can-unmark' : '') +
        '"><label class="rp-option rp-pick-option"><input type="checkbox" data-pick="' +
        esc(s.id) +
        '"' +
        (opts.picked.indexOf(s.id) >= 0 ? ' checked' : '') +
        '><span>' +
        esc(displayNameWithLast(s)) +
        (tag ? ' ' + tag : '') +
        '</span></label>' +
        (canUnmark
          ? '<button type="button" class="rp-unmark" data-rp="unmark" data-sid="' +
            esc(s.id) +
            '">Mark Not Printed</button>'
          : '') +
        '</div>';
    });
    html += '</div></fieldset>';
    return html;
  }

  /* The Already Printed box under the status: how many of this work's
     rubrics were printed and when, and who has changed since. */
  function _printedSummaryText(cid, aid) {
    if (!hasPrints(cid, aid)) return null;
    var printed = [];
    var changed = [];
    _rosterOrder(cid).forEach(function (s) {
      var state = printState(cid, aid, s.id);
      if (state.kind === 'printed' || state.kind === 'changed') printed.push(state.at);
      if (state.kind === 'changed') changed.push(displayNameWithLast(s));
    });
    if (!printed.length) return null;
    var days = {};
    printed.forEach(function (at) {
      days[_printDate(at)] = true;
    });
    var latest = printed.slice().sort().pop();
    var n = printed.length;
    var first =
      (n === 1 ? '1 rubric printed' : n + ' rubrics printed') +
      (Object.keys(days).length === 1 ? ' ' + _printDate(latest) : ', most recently ' + _printDate(latest)) +
      '.';
    var second = '';
    if (changed.length) {
      var c = changed.length;
      second =
        (c === 1 ? '1 has changed since then' : c + ' have changed since then') +
        (c <= 4 ? ': ' + changed.join(', ') : '') +
        '.';
    }
    return { first: first, second: second };
  }

  function _nameGroupHtml(opts) {
    var html = '<fieldset class="rp-group"><legend>Name</legend>';
    html += _radio('rp-name', 'preferred', opts.nameStyle !== 'first', 'Preferred Name', '(first name if none)');
    html += _radio('rp-name', 'first', opts.nameStyle === 'first', 'First Name');
    html += '<div class="rp-help">The last name always follows.</div>';
    return html + '</fieldset>';
  }

  function _sideAndActionsHtml() {
    var html =
      '<div class="rp-side"><div class="rp-legend">Preview</div>' +
      '<div class="rp-preview" id="rp-preview" aria-hidden="true"></div>' +
      '<div class="rp-preview-count" id="rp-preview-count"></div>' +
      '<div class="rp-status" id="rp-status" aria-live="polite"></div>' +
      '<div class="rp-status rp-printed" id="rp-printed" hidden></div></div>';
    html += '</div>';
    html +=
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-rp="cancel">Cancel</button>';
    html += '<button type="button" class="confirm-ok primary" data-rp="print">Print</button></div>';
    return html + '</div>';
  }

  /* The window for points and Complete/Incomplete work: students, sheets
     per page, name and what to include. No blank copies: a score sheet
     without a score is empty. */
  function _scoreDialogHtml(cid, aid, opts, students) {
    var assessment = _assessment(cid, aid);
    var complete = isCompletionScored(assessment);
    var html = '<div class="confirm-card rubric-print-card">';
    html += '<div class="confirm-title" id="rp-title">Print Scores</div>';
    html +=
      '<div class="confirm-message">' +
      esc((assessment && assessment.title) || 'Untitled') +
      ' · ' +
      (complete ? 'Complete or Incomplete' : 'Out of ' + esc(formatPoints(Number(assessment.maxPoints) || 0))) +
      '</div>';
    html += '<div class="rp-body"><div class="rp-groups">';
    html += _studentsGroupHtml(cid, aid, opts, students);
    html += '<fieldset class="rp-group"><legend>Sheets per Page</legend><div class="rp-tiles is-three">';
    LAYOUT_ORDER.forEach(function (key) {
      var layout = LAYOUTS[key];
      html += _tile('rp-layout', key, opts.layout === key, layout.tile, layout.tileHelp, _pageDrawing(layout));
    });
    html += '</div></fieldset>';
    html += _nameGroupHtml(opts);
    html +=
      '<fieldset class="rp-group"><legend>Include</legend>' +
      _check('overall', opts.include.overall, complete ? 'Mark' : 'Score') +
      _check('feedback', opts.include.feedback, 'Feedback Comment') +
      '</fieldset>';
    html += '</div>';
    html += _sideAndActionsHtml();
    return html;
  }

  function _statusText(out, blank, scoreOnly) {
    if (!out.sheets) return blank ? 'Nothing to print.' : 'No students selected.';
    var noun = scoreOnly ? 'score sheet' : 'rubric';
    var sheets = blank
      ? out.sheets === 1
        ? '1 blank rubric'
        : out.sheets + ' blank rubrics'
      : out.sheets === 1
        ? '1 ' + noun
        : out.sheets + ' ' + noun + 's';
    var pages = out.pages === 1 ? '1 page' : out.pages + ' pages';
    var text = sheets + ' on ' + pages + '. Black and white, ready for the photocopier.';
    if (out.scale < 1) text += ' Text is reduced to ' + Math.round(out.scale * 100) + '% to fit.';
    if (out.overflowing) {
      text +=
        ' ' +
        (out.overflowing === 1 ? '1 sheet does not fit' : out.overflowing + ' sheets do not fit') +
        ' at this size and will be cut off. Try a larger layout or leave something out.';
    }
    return text;
  }

  /* Page 1 of the staged job, scaled into the preview box. */
  function _drawPreview(out) {
    var box = document.getElementById('rp-preview');
    var count = document.getElementById('rp-preview-count');
    if (!box) return;
    box.innerHTML = '';
    var page = document.querySelector('#' + ROOT_ID + ' .rubric-page');
    if (count) count.textContent = out.pages ? 'Page 1 of ' + out.pages : '';
    if (!page) return;
    var w = page.offsetWidth;
    var h = page.offsetHeight;
    if (!w || !h) return;
    // The whole sheet of paper, with the print margins round the sheets,
    // so the preview shows the page as the print preview does.
    var layout = LAYOUTS[_state && _state.opts.layout] || LAYOUTS.full;
    var m = (w / layout.pageWidth) * layout.margin;
    var paperW = w + 2 * m;
    var paperH = h + 2 * m;
    var room = box.clientWidth - 24;
    var roomH = 240;
    var scale = Math.min(room / paperW, roomH / paperH);
    var frame = document.createElement('div');
    frame.className = 'rp-preview-frame';
    frame.style.width = Math.round(paperW * scale) + 'px';
    frame.style.height = Math.round(paperH * scale) + 'px';
    var clone = page.cloneNode(true);
    clone.style.width = w + 'px';
    clone.style.height = h + 'px';
    clone.style.position = 'absolute';
    clone.style.left = m * scale + 'px';
    clone.style.top = m * scale + 'px';
    clone.style.transform = 'scale(' + scale + ')';
    clone.style.transformOrigin = '0 0';
    frame.appendChild(clone);
    box.appendChild(frame);
  }

  function _refreshStatus() {
    if (!_state) return;
    var blank = _state.opts.mode === 'blank';
    var out = stage(_state.cid, _state.aid, _state.opts);
    var status = document.getElementById('rp-status');
    if (status) {
      status.textContent = _statusText(out, blank, !!_state.scoreOnly);
      status.classList.toggle('is-warning', out.overflowing > 0);
    }
    _drawPreview(out);
    var printedBox = document.getElementById('rp-printed');
    if (printedBox) {
      var summary = !blank && !_state.scoreOnly ? _printedSummaryText(_state.cid, _state.aid) : null;
      printedBox.hidden = !summary;
      // html-safe: both lines go through esc(); the heading is a constant
      printedBox.innerHTML = summary
        ? '<span class="rp-printed-title">Already Printed</span><span>' +
          esc(summary.first) +
          '</span>' +
          (summary.second ? '<span>' + esc(summary.second) + '</span>' : '')
        : '';
    }
    var printBtn = document.querySelector('#' + OVERLAY_ID + ' [data-rp="print"]');
    if (printBtn) {
      printBtn.disabled = !out.sheets;
      printBtn.textContent = !out.pages ? 'Print' : out.pages === 1 ? 'Print 1 Page' : 'Print ' + out.pages + ' Pages';
    }
  }

  function _readOptionsFromDialog(overlay) {
    var opts = _state.opts;
    var studentsRadio = overlay.querySelector('input[name="rp-students"]:checked');
    if (studentsRadio) opts.students = studentsRadio.value;
    var nameRadio = overlay.querySelector('input[name="rp-name"]:checked');
    if (nameRadio) opts.nameStyle = nameRadio.value;
    var layoutRadio = overlay.querySelector('input[name="rp-layout"]:checked');
    if (layoutRadio && LAYOUTS[layoutRadio.value]) opts.layout = layoutRadio.value;
    var copies = overlay.querySelector('#rp-copies');
    if (copies) opts.copies = _copies(copies.value);
    overlay.querySelectorAll('input[data-include]').forEach(function (box) {
      opts.include[box.dataset.include] = !!box.checked;
    });
    if (opts.mode !== 'blank') {
      opts.picked = [];
      overlay.querySelectorAll('input[data-pick]:checked').forEach(function (box) {
        opts.picked.push(box.dataset.pick);
      });
    }
  }

  /* A name ticked or unticked. From All or All Scored it starts a new pick
     of just that student; under Pick Students it adds or removes one. The
     layout follows how many are picked (layoutForCount). */
  function _onPick(overlay, box) {
    var pickRadio = overlay.querySelector('input[name="rp-students"][value="pick"]');
    if (pickRadio && !pickRadio.checked) {
      overlay.querySelectorAll('input[data-pick]').forEach(function (b) {
        b.checked = b === box;
      });
      pickRadio.checked = true;
    }
    var n = overlay.querySelectorAll('input[data-pick]:checked').length;
    if (!n) return;
    var layoutRadio = overlay.querySelector('input[name="rp-layout"][value="' + layoutForCount(n) + '"]');
    if (layoutRadio) layoutRadio.checked = true;
  }

  /* Redraw the dialog after a choice that changes which groups it shows
     (what to print, the assessment), keeping focus on that control. */
  function _redraw(overlay, focusSelector) {
    // Swap the card's contents, not the card, so its opening animation
    // doesn't play again.
    var card = overlay.querySelector('.rubric-print-card');
    var next = document.createElement('div');
    // html-safe: this file's _dialogHtml escapes rubric, assessment and student names; options are constants. The two copies below re-serialise that parsed markup
    next.innerHTML = _dialogHtml();
    if (card && next.firstChild) card.innerHTML = next.firstChild.innerHTML;
    else overlay.innerHTML = next.innerHTML; // html-safe: re-serialised markup from _dialogHtml above
    _refreshStatus();
    var el = focusSelector && overlay.querySelector(focusSelector);
    if (el && el.focus) el.focus();
  }

  function _syncTiles(overlay) {
    overlay.querySelectorAll('.rp-tile').forEach(function (tile) {
      var input = tile.querySelector('input');
      tile.classList.toggle('is-on', !!(input && input.checked));
    });
  }

  /* Open the window.
     From an assessment card: open(cid, aid, { studentId }) starts on its
     completed rubrics (that one student, full page, when grading one).
     From the Rubric Bank: open(cid, null, { rubricId, mode }) starts on the
     newest assessment that uses the rubric, or on a blank rubric when none
     does or `mode` is 'blank'. `blankOnly` offers nothing else (another
     class's rubric). */
  function open(cid, aid, openOpts) {
    // A Tag Rubric with bank competencies waits for the bank's wording (a
    // moment on the first print only); everything else opens at once.
    var assessment = aid ? _assessment(cid, aid) : null;
    if (_needsBankLevels(cid, assessment)) {
      loadBankLevels().then(function () {
        _openSafely(cid, aid, openOpts);
      });
      return;
    }
    _openSafely(cid, aid, openOpts);
  }

  /* In a class that holds grades whose Draft and Returned rows have not
     loaded, what the handout would print is not known: the dialog does not
     open (no draft is printed), and the page it was opened from is left as
     it was. A fault in opening it stops that one action: it is reported
     (the console and Sentry), the dialog is closed, and the page it was
     opened from (Assignments, the gradebook, Class Results, the Rubric
     Bank) goes on. */
  function _openSafely(cid, aid, openOpts) {
    try {
      if (!ReportScores.ready(cid)) return;
      _openNow(cid, aid, openOpts);
    } catch (e) {
      close();
      _reportFault('Print Rubrics could not open', e);
    }
  }

  function _openNow(cid, aid, openOpts) {
    openOpts = openOpts || {};
    close();
    var assessment = aid ? _assessment(cid, aid) : null;
    var rubricId = openOpts.rubricId || (assessment && assessment.rubricId) || null;
    var scoreOnly = !!assessment && isPointsScored(assessment);
    var rubric = assessment ? _rubric(cid, assessment) : rubricId ? getRubricById(cid, rubricId) : null;
    if (!rubric && !scoreOnly) return;
    // A rubric of the teacher's own can be printed for any assessment that
    // uses it; a Tag or General Rubric belongs to its one assessment.
    var uses = openOpts.blankOnly ? [] : rubricId ? usesOf(cid, rubricId) : assessment ? [assessment] : [];
    if (!aid && uses.length && openOpts.mode !== 'blank') aid = uses[0].id;
    var opts = _loadOptions();
    var userLayout = opts.layout;
    opts.rubricId = rubricId;
    opts.mode = openOpts.mode === 'blank' || !aid ? 'blank' : 'completed';
    opts.copies = _copies(getStudents(cid).length || 1);
    var sid = openOpts.studentId;
    var hasStudent =
      sid &&
      getStudents(cid).some(function (s) {
        return s.id === sid;
      });
    if (hasStudent && opts.mode === 'completed') {
      opts.students = 'pick';
      opts.picked = [sid];
      opts.layout = layoutForCount(1);
    } else if (opts.mode === 'completed' && !scoreOnly && hasPrints(cid, aid)) {
      // Some are printed already: start on the ones that are not.
      opts.students = 'unprinted';
    } else {
      opts.students = 'all';
    }
    _state = {
      cid: cid,
      aid: aid,
      rubricId: rubricId,
      uses: uses,
      scoreOnly: scoreOnly,
      opts: opts,
      userLayout: userLayout,
      trigger: document.activeElement,
    };
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'confirm-overlay rubric-print-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'rp-title');
    // html-safe: this file's _dialogHtml escapes rubric, assessment and student names; options are constants
    overlay.innerHTML = _dialogHtml();
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        close();
        return;
      }
      var btn = e.target.closest ? e.target.closest('[data-rp]') : null;
      if (!btn) return;
      if (btn.dataset.rp === 'cancel') close();
      else if (btn.dataset.rp === 'print') _printFromDialog();
      else if (btn.dataset.rp === 'unmark') _unmarkFromDialog(overlay, btn.dataset.sid);
    });
    overlay.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.name === 'rp-mode') {
        _readOptionsFromDialog(overlay);
        _state.opts.mode = t.value;
        return _redraw(overlay, 'input[name="rp-mode"]:checked');
      }
      if (t && t.id === 'rp-assessment') {
        _state.aid = t.value;
        _state.opts.picked = [];
        if (_state.opts.students === 'pick') _state.opts.students = 'all';
        var tracked = _state.opts.students === 'unprinted' || _state.opts.students === 'changed';
        if (tracked && !hasPrints(_state.cid, _state.aid)) _state.opts.students = 'all';
        return _redraw(overlay, '#rp-assessment');
      }
      if (t && t.dataset && t.dataset.pick !== undefined) _onPick(overlay, t);
      else if (t && t.name === 'rp-students' && t.value !== 'pick') {
        // Back to every student: no picks, and the layout last chosen.
        overlay.querySelectorAll('input[data-pick]').forEach(function (b) {
          b.checked = false;
        });
        var saved = overlay.querySelector('input[name="rp-layout"][value="' + _state.userLayout + '"]');
        if (saved) saved.checked = true;
      }
      _readOptionsFromDialog(overlay);
      if (t && t.name === 'rp-layout') _state.userLayout = _state.opts.layout;
      _syncTiles(overlay);
      _saveOptions(_state.opts, _state.userLayout);
      _refreshStatus();
    });
    overlay.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'rp-copies') {
        _readOptionsFromDialog(overlay);
        _refreshStatus();
      }
    });
    _state.keyHandler = function (e) {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', _state.keyHandler);
    document.body.appendChild(overlay);
    // The graded student may be far down the list: show their tick.
    var picked = overlay.querySelector('input[data-pick]:checked');
    if (picked && picked.scrollIntoView) picked.scrollIntoView({ block: 'nearest' });
    _refreshStatus();
    var first = overlay.querySelector('input[name="rp-layout"]:checked') || overlay.querySelector('input');
    if (first && first.focus) first.focus();
  }

  /* Mark Not Printed on a name in the list (a student who was away when
     the sheets went back): their rubric counts as not printed again. */
  function _unmarkFromDialog(overlay, sid) {
    if (!_state || !sid) return;
    _readOptionsFromDialog(overlay);
    unmarkPrinted(_state.cid, _state.aid, sid);
    // Nothing printed any more: the two print choices go with it.
    var tracked = _state.opts.students === 'unprinted' || _state.opts.students === 'changed';
    if (tracked && !hasPrints(_state.cid, _state.aid)) _state.opts.students = 'all';
    _redraw(overlay, 'input[data-pick="' + sid + '"]');
  }

  /* The students this print could hold once their grades are returned:
     the ones picked; everyone; with Not Printed Yet, everyone not printed
     (a student whose only grade is a draft has nothing printed); with
     Changed Since Printed, everyone printed before. Their drafts on the
     piece are what Print asks about. */
  function _mayPrint(cid, aid, opts) {
    var students = _rosterOrder(cid);
    if (opts.students === 'pick') {
      var picked = opts.picked || [];
      students = students.filter(function (s) {
        return picked.indexOf(s.id) >= 0;
      });
    } else if (opts.students === 'unprinted' || opts.students === 'changed') {
      var kinds = opts.students === 'unprinted' ? ['unprinted', 'unscored'] : ['changed', 'printed'];
      students = students.filter(function (s) {
        return kinds.indexOf(printState(cid, aid, s.id).kind) >= 0;
      });
    }
    return students.map(function (s) {
      return s.id;
    });
  }

  /* Print in the dialog. In a class that holds grades the handout shows
     returned grades only; when a student in the print has a draft on the
     piece it asks first (DECISIONS, "Student page build rulings
     (2026-11-10)" 6; teacher/drafts-before-print.js): Return It, Then
     Print returns exactly those drafts and prints with them in; Print
     Without It prints the returned grades; Cancel goes back to this
     dialog and does nothing. */
  function _printFromDialog() {
    if (!_state) return;
    var cid = _state.cid,
      aid = _state.aid,
      opts = _state.opts;
    var found = aid && opts.mode === 'completed' ? DraftsBeforePrint.find(cid, [aid], _mayPrint(cid, aid, opts)) : null;
    if (!found) return _printAndMark();
    // The question belongs to this Print Rubrics dialog, for this class and piece.
    var state = _state;
    var overlay = document.getElementById(OVERLAY_ID);
    var owner = {
      el: overlay,
      still: function () {
        return _state === state;
      },
    };
    DraftsBeforePrint.ask(
      found,
      'handout',
      function (choice) {
        if (choice === 'cancel') return;
        // Every draft it named is returned, or nothing prints and nothing is marked printed.
        if (choice === 'return' && !DraftsBeforePrint.returnAll(found).all) {
          DraftsBeforePrint.showFailed(overlay);
          return;
        }
        _printAndMark();
      },
      owner,
    );
  }

  function _printAndMark() {
    var cid = _state.cid,
      aid = _state.aid,
      opts = _state.opts,
      scoreOnly = _state.scoreOnly;
    close();
    var out = print(cid, aid, opts);
    if (scoreOnly || opts.mode !== 'completed' || !aid || !out.sheets) return;
    var sids = selectStudents(cid, aid, opts).map(function (s) {
      return s.id;
    });
    var before = markPrinted(cid, aid, sids);
    if (!before.length || typeof showUndoToast !== 'function') return;
    var n = before.length;
    showUndoToast(
      'Marked ' + (n === 1 ? '1 rubric' : n + ' rubrics') + ' as printed.',
      function () {
        setRubricPrints(cid, aid, before);
        _notifyPrintsChanged(cid, aid);
      },
      null,
      8000,
    );
  }

  function close() {
    // A question over this dialog goes with it.
    if (window.DraftsBeforePrint) DraftsBeforePrint.close();
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.remove) overlay.remove();
    if (_state) {
      if (_state.keyHandler) document.removeEventListener('keydown', _state.keyHandler);
      var trigger = _state.trigger;
      _state = null;
      try {
        if (trigger && typeof trigger.focus === 'function') trigger.focus();
      } catch (e) {
        /* the button may be gone */
      }
    }
    var root = document.getElementById(ROOT_ID);
    if (root && !document.body.classList.contains('rubric-print-active')) root.innerHTML = '';
  }

  function destroy() {
    close();
    _deactivatePrintMode();
    var root = document.getElementById(ROOT_ID);
    if (root && root.remove) root.remove();
  }

  /* What a print button for this assessment says: Print Rubrics on rubric
     and competency-level work (a graded rubric), Print Scores on points and
     Complete/Incomplete work with no rubric, '' on DIBELS (its class sheet
     prints from the Assignments page). */
  function printLabel(cid, a) {
    if (!a || isDibelsScored(a)) return '';
    var hasRubric = a.rubricId && getRubricById(cid, a.rubricId);
    return !hasRubric && isPointsScored(a) ? 'Print Scores' : 'Print Rubrics';
  }

  window.RubricPrint = {
    printLabel: printLabel,
    LAYOUTS: LAYOUTS,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    criterionLevel: criterionLevel,
    defaultRubric: defaultRubric,
    loadBankLevels: loadBankLevels,
    levelWording: levelWording,
    classUsesBankLevels: classUsesBankLevels,
    GENERAL_LEVELS: GENERAL_LEVELS,
    sheetData: sheetData,
    feedbackItems: feedbackItems,
    scoreSheetData: scoreSheetData,
    blankSheetData: blankSheetData,
    usesOf: usesOf,
    MAX_COPIES: MAX_COPIES,
    selectStudents: selectStudents,
    isStudentScored: isStudentScored,
    fingerprint: fingerprint,
    printState: printState,
    hasPrints: hasPrints,
    markHtml: markHtml,
    refreshMarks: refreshMarks,
    markPrinted: markPrinted,
    unmarkPrinted: unmarkPrinted,
    pageCount: pageCount,
    layoutForCount: layoutForCount,
    printName: printName,
    renderSheet: renderSheet,
    shrinkSteps: shrinkSteps,
    renderPages: renderPages,
    open: open,
    close: close,
    destroy: destroy,
  };
})();
