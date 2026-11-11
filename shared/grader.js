/* grader.js — the one grader.
 *
 * The one module a screen writes a grade through
 * (docs/plans/student-page-build-plan.md, 1.4). Each action is named for
 * what the teacher does. Each is a pass-through: it calls the
 * shared/data.js writer the screen called before, with the same arguments,
 * and returns what the writer returns. data.js runs the Draft and Returned
 * rule on the write (shared/grade-state.js), and a screen reads the state a
 * piece is in from GradeState.stateOf. The other rules that go with the
 * actions (locks, the points
 * limit, the To Grade and To Return counts) move in behind them in later
 * PRs, with Return for Revision and Return N Graded.
 *
 * Clearing is the same action with nothing in it: level 0, points null, a
 * null mark, a null status.
 *
 * Who writes through it: every screen that writes a grade. The desktop
 * grader dialog and the Assignments page (teacher/page-assignments.js: its
 * grids, ledgers, fills and Set Everyone To; S0-T2 and S1-T3); the
 * gradebook (teacher/page-gradebook.js) and Class Results
 * (teacher/class-results.js; S1-T1); the phone's Grade tab
 * (teacher-mobile/tab-grade.js; S1-T2). The actions a screen brought of its
 * own are together under its name below. tests/grader-guard.test.js fails
 * when any other file calls one of the score writers in data.js.
 */
window.Grader = (function () {
  'use strict';

  /* Every action ends here: GradeState hears of the save, and the writer's
     answer goes back to the screen. */
  function _saved(cid, sid, aid, what, out) {
    GradeState.afterSave(cid, sid, aid, what);
    return out;
  }

  /* A level under one score key (a competency, a rubric criterion or
     'overall'), dated and typed from the assessment. */
  function _writeLevel(cid, sid, aid, key, level, mod) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    return upsertScore(cid, sid, aid, key, level, assess ? assess.date : '', scoreTypeFor(assess), '', mod);
  }

  /* A level, 1 to 4, under `key`. 0 clears it. */
  function setLevel(cid, sid, aid, key, level, mod) {
    return _saved(cid, sid, aid, 'level', _writeLevel(cid, sid, aid, key, level, mod));
  }

  /* + or − on the level `key` holds: `mod` is 1, -1, or 0 to take it off. */
  function setPlusMinus(cid, sid, aid, key, level, mod) {
    return _saved(cid, sid, aid, 'plusMinus', _writeLevel(cid, sid, aid, key, level, mod));
  }

  /* Points for the whole piece. null clears; 0 is a score. */
  function setPoints(cid, sid, aid, points) {
    return _saved(cid, sid, aid, 'points', setPointsScore(cid, sid, aid, points));
  }

  /* 'complete' or 'incomplete'. null clears. */
  function setMark(cid, sid, aid, mark) {
    return _saved(cid, sid, aid, 'mark', setCompletionMark(cid, sid, aid, mark));
  }

  /* Missing ('NS'), Excused ('EXC') or Late ('LATE'). null takes it off. */
  function setStatus(cid, sid, aid, status) {
    return _saved(cid, sid, aid, 'status', applyAssignmentStatus(cid, sid, aid, status));
  }

  /* One box of an Advanced Rubric's checklist. Returns the ticked ids. */
  function setTick(cid, sid, aid, checkId, on) {
    return _saved(cid, sid, aid, 'tick', setRubricCheck(cid, sid, aid, checkId, on));
  }

  /* The comment under one rubric criterion (Work On, on a single-point
     rubric). */
  function setCriterionComment(cid, sid, aid, criterionId, text) {
    return _saved(cid, sid, aid, 'comment', saveRubricCriterionComment(cid, sid, aid, criterionId, text));
  }

  /* A single-point rubric's Went Beyond note for one criterion. */
  function setWentBeyond(cid, sid, aid, criterionId, text) {
    return _saved(cid, sid, aid, 'comment', saveRubricCriterionBeyond(cid, sid, aid, criterionId, text));
  }

  /* The comment under one competency, on work with no rubric. */
  function setCompetencyComment(cid, sid, aid, tagId, text) {
    return _saved(cid, sid, aid, 'comment', saveTagComment(cid, sid, aid, tagId, text));
  }

  function setOverallComment(cid, sid, aid, text) {
    return _saved(cid, sid, aid, 'comment', saveScoreComment(cid, sid, aid, text));
  }

  /* One window of a DIBELS benchmark: its four numbers. */
  function setDibels(cid, sid, aid, period, values) {
    return _saved(cid, sid, aid, 'dibels', saveDibelsScore(cid, sid, aid, period, values));
  }

  /* Group work: grade `sid` on their own from here on. */
  function gradeSeparately(cid, aid, sid) {
    return _saved(cid, sid, aid, 'gradeSeparately', setGradedSeparately(cid, aid, sid, true));
  }

  /* Group work: `sid` takes the group's grade again, in place of their own. */
  function backToGroupGrade(cid, aid, sid) {
    return _saved(cid, sid, aid, 'backToGroupGrade', setGradedSeparately(cid, aid, sid, false));
  }

  /* ── The gradebook and Class Results (S1-T1) ─────────────────────────
     What the gradebook's cells, keys and menus write, and Class Results'
     Mark Missing. A click on a gradebook cell opens the grader dialog,
     which writes through the actions above; so do the gradebook's points,
     Complete / Incomplete marks, statuses and ticks (setPoints, setMark,
     setStatus, setTick). The actions here are the rest. Each passes on
     what the screen passed to data.js before, in the same order, so some
     take a whole list the screen has built. */

  /* A level typed into a gradebook cell: a digit, or 0 for a cleared cell.
     The gradebook dates and types the score itself and passes its own
     note, as it did before it wrote through here. Its two views differ on
     work with no date: Edit Score in the Scores view passes today's date,
     a key in the Competencies view passes none. */
  function typeLevel(cid, sid, aid, key, level, date, type, note) {
    return _saved(cid, sid, aid, 'level', upsertScore(cid, sid, aid, key, level, date, type, note));
  }

  /* + or − typed on a gradebook cell: `mod` is 1, -1, or 0 to take it
     off. `note` is the comment the cell's entry holds, which goes up
     again with the level. */
  function typePlusMinus(cid, sid, aid, key, level, date, type, note, mod) {
    return _saved(cid, sid, aid, 'plusMinus', upsertScore(cid, sid, aid, key, level, date, type, note, mod));
  }

  /* Clear Score, in the gradebook's cell menu: `keys` come off `sid`'s
     entries for the assessment in `scores` (the class's score list), an
     Overall Comment or Note for the Report staying on one entry, and the
     list is saved. The ticks come off first, through setTick. */
  function clearScore(cid, scores, sid, assessment, keys) {
    clearScoreEntries(cid, scores, sid, assessment, keys);
    return _saved(cid, sid, assessment.id, 'clear', saveScores(cid, scores));
  }

  /* Clear Score's last step: the server clears the cell as well
     (clear_score). The gradebook asks once it has redrawn, as before, so
     it is an action of its own. */
  function clearScoreOnServer(cid, sid, aid) {
    return _saved(cid, sid, aid, 'clear', window.clearScore(sid, aid));
  }

  /* Undo for one gradebook cell (Cmd+Z, or the Score Cleared toast):
     `scores` is the class's score list with the cell's old entries put
     back; it is saved, then what changed since `before` is sent. Saving
     the list sends the change too, so it goes up twice, as before. The
     ticks Clear Score took off go back through setTick. */
  function undoCell(cid, sid, aid, before, scores) {
    var out = saveScores(cid, scores);
    persistScoreDiffToCanonical(cid, before, scores);
    return _saved(cid, sid, aid, 'undo', out);
  }

  /* Mark Blank Cells Missing or Excused, in the gradebook's column menu
     and on Class Results' Unmarked list: `statuses` is the class's whole
     status list with the blank cells of `aid` marked. */
  function markBlankCells(cid, aid, statuses) {
    return _saved(cid, null, aid, 'status', saveAssignmentStatuses(cid, statuses));
  }

  /* Its undo (the toast, Cmd+Z, or Undo Marking Blank Cells): the list
     with those marks taken off. */
  function undoMarkBlankCells(cid, aid, statuses) {
    return _saved(cid, null, aid, 'undo', saveAssignmentStatuses(cid, statuses));
  }

  /* Delete Assessment, in the gradebook's column menu: `scores` is the
     class's score list with the work's scores taken out. The gradebook
     deletes the work itself. */
  function deleteAssessmentScores(cid, aid, scores) {
    return _saved(cid, null, aid, 'delete', saveScores(cid, scores));
  }

  /* And `statuses`, the class's status list with the work's taken out. */
  function deleteAssessmentStatuses(cid, aid, statuses) {
    return _saved(cid, null, aid, 'delete', saveAssignmentStatuses(cid, statuses));
  }

  /* ── The Assignments page (S1-T3) ───────────────────────────────────
     The page's grids and ledgers write through the actions at the top: a
     level, a + or −, points, a mark, a status, a tick and the comments
     pass data.js what the dialog's do. So do its fills (Set Everyone To,
     a row's fill and Clear, Set Unmarked to …), a cell at a time: the page
     looks at each cell just before it writes it, because on pair work the
     first member's mark reaches the partner, who is then passed over. A
     score fill's Undo is undo, below. The actions here are the rest. */

  /* Undo for Set Unmarked to Missing: the status comes off one student.
     setStatus with null does the same and answers false; this answers
     what saving the status list does. */
  function undoMissing(cid, sid, aid) {
    return _saved(cid, sid, aid, 'undo', setAssignmentStatus(cid, sid, aid, null));
  }

  /* An Overall level carried onto a competency ticked later, in the edit
     form: `overall` is the student's Overall entry on the work. Its level,
     + or −, date and type go under `key`; its comment does not. setLevel
     would date and type the copy from the work. */
  function carryOverall(cid, sid, aid, key, overall) {
    return _saved(
      cid,
      sid,
      aid,
      'level',
      upsertScore(cid, sid, aid, key, overall.score, overall.date, overall.type, '', overall.mod),
    );
  }

  /* Edit a Copy on scored work: the work's scores and ticks follow it to
     the copy's criteria and boxes. `maps` is { rubricId, criteria, checks },
     each old id to its new one. */
  function moveToRubric(cid, aid, maps) {
    return _saved(cid, null, aid, 'move', moveRubricScores(cid, aid, maps));
  }

  /* The Note for the Report, in the grader dialog: one line about what
     the student did, for the term comment. It is no part of the grade, so
     it never makes a draft. data.js tidies the text. */
  function setReportNote(cid, sid, aid, text) {
    return _saved(cid, sid, aid, 'reportNote', saveScoreReportNote(cid, sid, aid, text));
  }

  /* ── The phone's Grade tab (S1-T2) ──────────────────────────────────
     The phone's points, marks, statuses, ticks, comments and group
     actions go through the actions above. Its levels and its Undo pass
     data.js something different from the desktop's, so they have actions
     of their own here, kept as the phone had them: the move changed
     nothing that is saved or sent (tests/pin-phone-grade-writes.test.js).
     Each says how it differs. Making them the same changes what a
     teacher's tap saves, so that is a decision, not tidying. */

  /* A level under one score key, as the phone dates and notes it. Work
     with no date of its own is dated today, on every change of the level;
     _writeLevel passes no date for it, so data.js dates a first level today
     and leaves a later one's date alone. */
  function _writeLevelOnPhone(cid, sid, aid, key, level, note, mod) {
    var assess = getAssessments(cid).find(function (a) {
      return a.id === aid;
    });
    return upsertScore(
      cid,
      sid,
      aid,
      key,
      level,
      (assess && assess.date) || courseToday(cid),
      scoreTypeFor(assess),
      note,
      mod,
    );
  }

  /* A level, 1 to 4, under `key`. 0 clears it. */
  function setLevelOnPhone(cid, sid, aid, key, level, mod) {
    return _saved(cid, sid, aid, 'level', _writeLevelOnPhone(cid, sid, aid, key, level, '', mod));
  }

  /* + or − on the level `key` holds. `note` is the Overall Comment the
     phone passes with a competency's + or − ('' on a rubric criterion):
     data.js sends a comment it is given again, which setPlusMinus never
     does. */
  function setPlusMinusOnPhone(cid, sid, aid, key, level, mod, note) {
    return _saved(cid, sid, aid, 'plusMinus', _writeLevelOnPhone(cid, sid, aid, key, level, note, mod));
  }

  /* The phone's Undo. The phone works out the class's scores with the
     undone cells as they were (`after`; `before` is a copy from before it
     did) and saves that list, then sends what changed between the two.
     undo, below, hands both copies to data.js, which puts back only the
     cells that still hold what was undone. */
  function undoOnPhone(cid, sid, aid, before, after) {
    var out = saveScores(cid, after);
    persistScoreDiffToCanonical(cid, before, after);
    return _saved(cid, sid, aid, 'undo', out);
  }

  /* Undo: put back the cells that changed between `before` and `after`
     (copies of the class's scores) and still hold what `after` has. */
  function undo(cid, before, after) {
    return _saved(cid, null, null, 'undo', restoreScoreCells(cid, before, after));
  }

  /* Return: the students in `studentIds` (one id or a list) are given
     their grade on `aid`, and the marks on their pages (S9-F1): data.js's
     returnWork is returnGrades, then each student is given the working
     Mark Up. Only drafts are returned; marks made since the last Return
     are given even on a grade already returned. Answers
     { returned, enrollment_ids, returned_at, marks_given,
     marks_enrollment_ids }. Every screen's Return comes here, so no Return
     leaves marks behind. */
  function returnTo(cid, aid, studentIds) {
    var ids = Array.isArray(studentIds) ? studentIds : [studentIds];
    // Only where Mark Up can be on (Demo Mode, the build switch and Send
    // Work): everywhere else, a signed-in class above all, Return is
    // returnGrades exactly as it was.
    var marks = typeof returnWork === 'function' && typeof isDemoMode === 'function' && isDemoMode();
    var out = marks && workOnInClass(cid) ? returnWork(cid, aid, ids) : returnGrades(cid, aid, ids);
    return _saved(cid, ids.length === 1 ? ids[0] : null, aid, 'return', out);
  }

  /* ── Student work: what is in, and the counts (S6-F3) ──────────────
     The one place the To Grade, To Return, Returned and Not In counts are
     worked out (window.GraderWork). The grader dialog's Show bar, the
     Assignments page, the gradebook's To Grade cells and the dashboard's
     To Grade cell all call GraderWork.workCounts or classWorkCounts, so
     they cannot disagree.

     Each student is in at most one of the four, in this order:
     - toreturn: the piece is a draft (GradeState.stateOf);
     - returned: the student has their grade (GradeState.stateOf);
     - tograde: work is in (sent, added by the teacher or handed in on
       paper) and grading has not started (studentWorkGradingStarted:
       a draft or returned grade or an Overall Comment);
     - notin: nothing is in and the piece is not Excused (Missing counts).
     An Excused student with nothing in is in none, only in All. To Grade
     and Not In exist only while workOn: the class's student page (the
     build switch) and Send Work are on and the piece's Students Send is not
     Nothing. Elsewhere both are 0 and the rest is as GradeState says.

     Counts are students, except To Grade on pair and group work: a pair or
     group still graded together is one piece of work to grade, so it
     counts once (the Dashboard board's "A group counts once"). Its members
     are all listed in ids.tograde. */
  function _piece(cid, aid) {
    return (
      (getAssessments(cid) || []).find(function (a) {
        return a && a.id === aid;
      }) || null
    );
  }

  /* The build switch and Send Work, both on for the class. */
  function workOnInClass(cid) {
    if (!cid || typeof getReturnSettings !== 'function' || typeof getCourseSendWork !== 'function') return false;
    return !!getReturnSettings(cid).student_page && !!getCourseSendWork(cid).send_work;
  }

  /* ...and the piece takes work (Students Send is not Nothing). A DIBELS
     benchmark never does. */
  function workOn(cid, a) {
    if (!a || isDibelsScored(a) || !workOnInClass(cid)) return false;
    return getAssessmentStudentWork(cid, a.id).students_send !== 'nothing';
  }

  /* 'toreturn', 'returned', 'tograde', 'notin' or null, for one student. */
  function workStateOf(cid, aid, sid) {
    var state = GradeState.stateOf(cid, sid, aid);
    if (state === GradeState.DRAFT) return 'toreturn';
    if (state === GradeState.RETURNED) return 'returned';
    if (!workOn(cid, _piece(cid, aid))) return null;
    if (getStudentSubmission(cid, sid, aid)) return studentWorkGradingStarted(cid, sid, aid) ? null : 'tograde';
    var status = getAssignmentStatus(cid, sid, aid);
    // One per Group (S12-F2): a group-mate's work is the group's. A member
    // marked Missing or Excused is left out, as group grading leaves them.
    if (_groupIn(cid, sid, aid)) {
      if (status === 'NS' || status === 'EXC') return null;
      return studentWorkGradingStarted(cid, sid, aid) ? null : 'tograde';
    }
    return status === 'EXC' ? null : 'notin';
  }

  // Work is in for `sid` through their group on a One per Group piece.
  function _groupIn(cid, sid, aid) {
    return typeof groupWorkIn === 'function' && groupWorkIn(cid, sid, aid);
  }
  // The submissions that make up `sid`'s work: the group's, or their own.
  function _workOf(cid, sid, aid) {
    if (typeof getGroupSubmissions === 'function') return getGroupSubmissions(cid, sid, aid);
    var own = getStudentSubmission(cid, sid, aid);
    return own ? [own] : [];
  }

  /* The four counts and All for `aid`, over `studentIds` (the whole class,
     last-name order, when left out):
     { tograde, toreturn, returned, notin, all, ids: { tograde, toreturn,
       returned, notin } }, each list in the order given. */
  function workCounts(cid, aid, studentIds) {
    var ids = studentIds
      ? studentIds.slice()
      : sortStudents(getStudents(cid) || [], 'lastName').map(function (s) {
          return s.id;
        });
    var lists = { tograde: [], toreturn: [], returned: [], notin: [] };
    ids.forEach(function (sid) {
      var k = workStateOf(cid, aid, sid);
      if (k) lists[k].push(sid);
    });
    // A pair or group still graded together counts once in To Grade.
    var units = lists.tograde.length ? groupGradingUnits(cid, _piece(cid, aid), ids) : null;
    var tograde = lists.tograde.length;
    var groups = 0;
    if (units) {
      var waiting = units.filter(function (u) {
        return (u.linked || [u.sid]).some(function (sid) {
          return lists.tograde.indexOf(sid) >= 0;
        });
      });
      tograde = waiting.length;
      groups = waiting.filter(function (u) {
        return !!u.linked;
      }).length;
    }
    // When the longest-waiting work to grade came in (an ISO time), or null.
    var oldest = null;
    lists.tograde.forEach(function (sid) {
      _workOf(cid, sid, aid).forEach(function (sub) {
        var at = sub && (sub.sent_at || sub.created_at);
        if (at && (!oldest || at < oldest)) oldest = at;
      });
    });
    return {
      tograde: tograde,
      toreturn: lists.toreturn.length,
      returned: lists.returned.length,
      notin: lists.notin.length,
      all: ids.length,
      groups: groups,
      oldest: oldest,
      ids: lists,
    };
  }

  /* The class's totals over every piece (or the pieces in `aids`):
     { tograde, toreturn, notin, groups, oldest, pieces: [{ aid, tograde,
     toreturn, notin }] } (only pieces with one of them), for the
     gradebook's bar and the dashboard's To Grade cell. groups: how many of
     the To Grade are pairs or groups; oldest: when the longest-waiting work
     came in. To Grade is 0 in a class whose work is off. */
  function classWorkCounts(cid, studentIds, aids) {
    var out = { tograde: 0, toreturn: 0, notin: 0, groups: 0, oldest: null, pieces: [] };
    (getAssessments(cid) || []).forEach(function (a) {
      if (!a || !a.id || isDibelsScored(a)) return;
      if (aids && aids.indexOf(a.id) < 0) return;
      var c = workCounts(cid, a.id, studentIds);
      out.tograde += c.tograde;
      out.toreturn += c.toreturn;
      out.notin += c.notin;
      out.groups += c.groups;
      if (c.oldest && (!out.oldest || c.oldest < out.oldest)) out.oldest = c.oldest;
      if (c.tograde || c.toreturn || c.notin)
        out.pieces.push({ aid: a.id, tograde: c.tograde, toreturn: c.toreturn, notin: c.notin });
    });
    return out;
  }

  /* How many grades on the class's pieces were returned in the 7 days to
     `today` (the class's own date when left out): the dashboard's "27
     Returned This Week". A student's grade on a piece counts once. */
  function returnedThisWeek(cid, today) {
    var day = today || courseToday(cid);
    var since = new Date(Date.parse(day) - 6 * 86400000).toISOString().slice(0, 10);
    var n = 0;
    var students = getStudents(cid) || [];
    (getAssessments(cid) || []).forEach(function (a) {
      if (!a || !a.id || isDibelsScored(a)) return;
      students.forEach(function (st) {
        if (GradeState.stateOf(cid, st.id, a.id) !== GradeState.RETURNED) return;
        var row = typeof getGradeReturn === 'function' ? getGradeReturn(cid, st.id, a.id) : null;
        var on = row && row.returned_at ? String(row.returned_at).slice(0, 10) : '';
        if (on && on >= since && on <= day) n++;
      });
    });
    return n;
  }

  /* The other students on `aid` whose work holds a page that is the same
     photo as one of `sid`'s, byte for byte (the page's sha256): the
     "Same photo as" note. Only an exact match; a photo of the same page
     taken twice is not one. In the order given (the class's last-name
     order when left out). */
  function samePhotoAs(cid, aid, sid, studentIds) {
    var hashes = {};
    _workOf(cid, sid, aid).forEach(function (mine) {
      ((mine && mine.files) || []).forEach(function (f) {
        if (f && f.sha256) hashes[f.sha256] = true;
      });
    });
    if (!Object.keys(hashes).length) return [];
    var ids = studentIds
      ? studentIds
      : sortStudents(getStudents(cid) || [], 'lastName').map(function (s) {
          return s.id;
        });
    // The group's own pages are the same photos by design (S12-F2).
    var mates = {};
    var group = typeof getStudentWorkGroup === 'function' ? getStudentWorkGroup(cid, sid, aid) : null;
    ((group && group.members) || []).forEach(function (m) {
      mates[m] = true;
    });
    return ids.filter(function (other) {
      if (other === sid || mates[other]) return false;
      var sub = getStudentSubmission(cid, other, aid);
      return ((sub && sub.files) || []).some(function (f) {
        return f && f.sha256 && hashes[f.sha256];
      });
    });
  }

  /* Delete Work: one student's work on `aid` and its photos go for good
     (Colin's ruling 87). Grades and comments stay. A Promise of
     data.js deleteStudentWork's answer. */
  function deleteWork(cid, sid, aid) {
    return deleteStudentWork(cid, sid, aid);
  }

  /* Grade From Paper's Set Logan To (S6-F2), for the desktop grader and the
     phone's not-in card: every criterion (or competency) `sid` has no level
     for on `aid` is set to `level`, as Set Everyone To does for a class,
     and the work is recorded as handed in on paper (markStudentWorkOnPaper).
     Nothing is set on points or Complete/Incomplete work, or for a student
     marked Missing or Excused. Answers { set, paper }: how many levels were
     written, and the Promise of markStudentWorkOnPaper's answer. */
  function setToFromPaper(cid, aid, sid, level) {
    var a = _piece(cid, aid);
    var none = { set: 0, paper: Promise.resolve({ result: 'not_set', marked: 0, submissions: [] }) };
    if (!a || !(level >= 1 && level <= 4) || isPointsScored(a) || isCompletionScored(a) || isDibelsScored(a))
      return none;
    if (isScoreLocked(cid, sid, aid)) return none;
    var groups;
    if (a.rubricId) {
      var rubric = getRubricById(cid, a.rubricId);
      groups = rubric ? (rubric.criteria || []).map(rubricCriterionScoreKeys) : [];
    } else {
      groups = scoreTagIds(a, cid).map(function (tid) {
        return [tid];
      });
    }
    var entries = (getScores(cid)[sid] || []).filter(function (e) {
      return e && e.assessmentId === aid;
    });
    var set = 0;
    groups.forEach(function (keys) {
      var scored = keys.some(function (k) {
        return isScoreEntered(
          a,
          entries.find(function (e) {
            return e.tagId === k;
          }),
        );
      });
      if (scored) return;
      keys.forEach(function (k) {
        setLevel(cid, sid, aid, k, level);
        set++;
      });
    });
    return { set: set, paper: markStudentWorkOnPaper(cid, aid, [sid]) };
  }

  /* Reads, and Delete Work, which writes no grade, so they sit apart from
     the grade actions (tests/grader.test.js holds Grader to those). */
  window.GraderWork = {
    workOnInClass: workOnInClass,
    workOn: workOn,
    workStateOf: workStateOf,
    workCounts: workCounts,
    classWorkCounts: classWorkCounts,
    returnedThisWeek: returnedThisWeek,
    samePhotoAs: samePhotoAs,
    setToFromPaper: setToFromPaper,
    deleteWork: deleteWork,
  };

  return {
    setLevel: setLevel,
    setPlusMinus: setPlusMinus,
    setPoints: setPoints,
    setMark: setMark,
    setStatus: setStatus,
    setTick: setTick,
    setCriterionComment: setCriterionComment,
    setWentBeyond: setWentBeyond,
    setCompetencyComment: setCompetencyComment,
    setOverallComment: setOverallComment,
    setDibels: setDibels,
    gradeSeparately: gradeSeparately,
    backToGroupGrade: backToGroupGrade,
    // The gradebook and Class Results (S1-T1)
    typeLevel: typeLevel,
    typePlusMinus: typePlusMinus,
    clearScore: clearScore,
    clearScoreOnServer: clearScoreOnServer,
    undoCell: undoCell,
    markBlankCells: markBlankCells,
    undoMarkBlankCells: undoMarkBlankCells,
    deleteAssessmentScores: deleteAssessmentScores,
    deleteAssessmentStatuses: deleteAssessmentStatuses,
    // The Assignments page (S1-T3)
    undoMissing: undoMissing,
    carryOverall: carryOverall,
    moveToRubric: moveToRubric,
    setReportNote: setReportNote,
    // The phone's Grade tab (S1-T2)
    setLevelOnPhone: setLevelOnPhone,
    setPlusMinusOnPhone: setPlusMinusOnPhone,
    undoOnPhone: undoOnPhone,
    undo: undo,
    returnGrades: returnTo,
  };
})();
