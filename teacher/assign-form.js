// @ts-check
/* assign-form.js — Assignments: the assessment form. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignForm = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var AC,
    COMPETENCIES_NEED_TAG_HINT,
    DUE_BEFORE_ASSIGNED_HINT,
    SCORE_MODE_CARDS,
    _afGroupBox,
    pageState,
    _compPickerHtml,
    _compView,
    _dueBeforeAssigned,
    _formModeOf,
    _formResFor,
    _formResHtml,
    _formResOffered,
    _formWorkCardHtml,
    _formWorkFor,
    _formWorkOffered,
    _getAssessmentCategoryId,
    _getSortedCategories,
    _lastScoreMode,
    _scoredStudentCount,
    _storedScoreMode,
    _studentPageOn,
    _untaggedNote;
  function configure(h) {
    if ('AC' in h) AC = h.AC;
    if ('COMPETENCIES_NEED_TAG_HINT' in h) COMPETENCIES_NEED_TAG_HINT = h.COMPETENCIES_NEED_TAG_HINT;
    if ('DUE_BEFORE_ASSIGNED_HINT' in h) DUE_BEFORE_ASSIGNED_HINT = h.DUE_BEFORE_ASSIGNED_HINT;
    if ('SCORE_MODE_CARDS' in h) SCORE_MODE_CARDS = h.SCORE_MODE_CARDS;
    if ('_afGroupBox' in h) _afGroupBox = h._afGroupBox;
    if ('pageState' in h) pageState = h.pageState;
    if ('_compPickerHtml' in h) _compPickerHtml = h._compPickerHtml;
    if ('_compView' in h) _compView = h._compView;
    if ('_dueBeforeAssigned' in h) _dueBeforeAssigned = h._dueBeforeAssigned;
    if ('_formModeOf' in h) _formModeOf = h._formModeOf;
    if ('_formResFor' in h) _formResFor = h._formResFor;
    if ('_formResHtml' in h) _formResHtml = h._formResHtml;
    if ('_formResOffered' in h) _formResOffered = h._formResOffered;
    if ('_formWorkCardHtml' in h) _formWorkCardHtml = h._formWorkCardHtml;
    if ('_formWorkFor' in h) _formWorkFor = h._formWorkFor;
    if ('_formWorkOffered' in h) _formWorkOffered = h._formWorkOffered;
    if ('_getAssessmentCategoryId' in h) _getAssessmentCategoryId = h._getAssessmentCategoryId;
    if ('_getSortedCategories' in h) _getSortedCategories = h._getSortedCategories;
    if ('_lastScoreMode' in h) _lastScoreMode = h._lastScoreMode;
    if ('_scoredStudentCount' in h) _scoredStudentCount = h._scoredStudentCount;
    if ('_storedScoreMode' in h) _storedScoreMode = h._storedScoreMode;
    if ('_studentPageOn' in h) _studentPageOn = h._studentPageOn;
    if ('_untaggedNote' in h) _untaggedNote = h._untaggedNote;
  }

  function _afTagRow(sec, selTags) {
    var tag = sec.tags[0];
    if (!tag) return '';
    var checked = selTags.includes(tag.id);
    var wording = tag.text || tag.source_text || sec.name;
    // The competency's I Can statements, behind a toggle beside the row
    // (Nov 2 mockup, batch 2): outside the label, so it never ticks the box.
    var icans = (tag.i_can_statements || []).filter(function (x) {
      return String(x || '').trim();
    });
    // Unique per drawing, so two open forms never share a list.
    var listId = 'af-icans-' + sec.id + '-' + ++pageState._afIcanSeq;
    return (
      '<div class="af-tag-row">' +
      '<label class="af-tag-item' +
      (checked ? ' checked' : '') +
      '" data-section="' +
      sec.id +
      '" style="border-left:3px solid ' +
      cssColor(sec.color) +
      ';padding-left:8px;margin-bottom:4px">' +
      '<input type="checkbox" value="' +
      tag.id +
      '" class="af-tag-cb" data-section="' +
      sec.id +
      '"' +
      (checked ? ' checked' : '') +
      ' data-action-change="tagCheckbox">' +
      '<span class="af-tag-id" style="color:' +
      cssColor(sec.color) +
      '">' +
      esc(tag.code || tag.shortName || '') +
      '</span>' +
      (tag.label ? '<span class="af-tag-short">' + esc(tag.label) + '</span>' : '') +
      '<span class="af-tag-name">' +
      esc(wording) +
      '</span>' +
      '</label>' +
      (icans.length
        ? '<button type="button" class="af-tag-ican-toggle" data-action="afToggleIcans" aria-expanded="false" aria-controls="' +
          esc(listId) +
          '"><span class="af-tag-ican-caret" aria-hidden="true">\u25B8</span>' +
          icans.length +
          ' I Can</button>'
        : '') +
      '</div>' +
      (icans.length
        ? '<ul class="af-tag-icans" id="' +
          esc(listId) +
          '" hidden>' +
          icans
            .map(function (x) {
              return '<li>' + esc(x) + '</li>';
            })
            .join('') +
          '</ul>'
        : '')
    );
  }

  // html-safe: titles, descriptions, names and dates through esc; colours through cssColor or constants; ids are ours
  function renderAssessForm(cid, assess) {
    // Blank Rubric is open on a new assessment (Colin, Nov 2).
    pageState._startOpen = assess ? null : 'blank';
    pageState._blank = null;
    pageState._categoryTried = false;
    var sections = getSections(cid);
    var isEdit = !!assess;
    var title = assess ? assess.title : '';
    var dateAssigned = assess ? assess.dateAssigned || assess.date || '' : courseToday(cid);
    var dateDue = assess ? assess.date || '' : courseToday(cid);
    var dueDate = assess ? assess.dueDate || '' : '';
    var categoryId = _getAssessmentCategoryId(assess);
    var selTags = assess ? assess.tagIds || [] : [];
    var description = assess ? assess.description || '' : '';
    var moduleId = assess ? assess.moduleId || '' : '';
    var collaboration = assess ? assess.collaboration || 'individual' : 'individual';
    AC.collaboration = collaboration;
    pageState.newCollaboration = collaboration;
    var allModules = getModules(cid);
    var categories = _getSortedCategories(cid);
    var needsPick =
      categories.length > 0 &&
      !categories.some(function (c) {
        return c.id === categoryId;
      });
    // A new assessment starts on the scoring the last one used (Colin, Nov 11).
    var lastMode = assess ? null : _lastScoreMode(cid);
    var scoreMode = assess ? _formModeOf(assess) : lastMode || 'proficiency';
    if (!assess && scoreMode !== 'proficiency') pageState._startOpen = null;
    var maxPoints = assess ? assess.maxPoints || 100 : 100;
    var weight = getAssessmentWeight(assess);

    // Students with a score or feedback here: editing the scoring or rubric
    // of scored work asks first (redesign PR 9).
    var scoredCount = isEdit ? _scoredStudentCount(cid, assess.id) : 0;
    var html = '';

    // A heading only when editing, where it carries the scored note; a new
    // assessment needs none (Colin, Nov 2). The blue ring stays either way.
    if (isEdit)
      html +=
        '<div class="af-heading"><h3 class="af-heading-title">Edit Assessment</h3>' +
        (scoredCount
          ? '<span class="af-heading-note">' +
            esc(
              scoredCount +
                (scoredCount === 1 ? ' student scored.' : ' students scored.') +
                ' Changing the scoring or the rubric asks first.',
            ) +
            '</span>'
          : '') +
        '</div>';

    // What it is: title, classes, category, module and dates.
    html += '<section class="af-card af-card-what">';
    // Title
    html +=
      '<div class="af-field">' +
      '<div class="af-title-label-row"><label class="af-label" for="af-title">Assignment Title</label>' +
      // Start From a Past Assessment (redesign PR 12): new work only.
      (isEdit
        ? ''
        : '<button type="button" class="af-link-btn" data-action="startFromPast" aria-haspopup="dialog">Start From a Past Assessment</button>') +
      '</div>' +
      '<input class="af-input" id="af-title" type="text" value="' +
      esc(title) +
      '" placeholder="e.g. Persuasive Essay \u2014 Rights & Freedoms">' +
      '</div>';
    // Description, right under the title (teachers preferred it there to
    // More Options, Colin, Nov 2).
    html +=
      '<div class="af-field">' +
      '<label class="af-label" for="af-desc">Description</label>' +
      '<textarea class="af-textarea" id="af-desc" rows="1"' +
      (_studentPageOn(cid) ? ' aria-describedby="af-desc-hint"' : '') +
      ' placeholder="Describe the assignment, expectations, and criteria\u2026">' +
      esc(description) +
      '</textarea>' +
      // A student reads the Description on their page once the class's
      // Student Page is on (S4-W1; Colin's ruling 111 and his words).
      (_studentPageOn(cid)
        ? '<p class="af-category-hint" id="af-desc-hint">Students see this on their page.</p>'
        : '') +
      '</div>';
    // Handouts and Links, right under the Description: what students open
    // from the card (board 3a). Only where students read the page.
    pageState._formRes = _formResOffered(cid) ? _formResFor(cid, assess) : null;
    if (pageState._formRes) html += _formResHtml();

    // Which classes this assessment goes to (Teams' "Assign to"), right
    // under the title so it is seen before the details are filled in.
    if (window.AssessmentCopy) html += AssessmentCopy.renderClassesField(cid, assess);

    // Dates. Today is the class's calendar day: toISOString() is UTC, which
    // is already tomorrow after 4 pm in BC.
    var today = courseToday(cid);
    // A new assessment is due a week after it's assigned; editing shows the
    // due date it has, blank when none.
    var defaultDue = isEdit
      ? dueDate
      : (function () {
          var d = new Date((dateAssigned || today) + 'T12:00:00');
          d.setDate(d.getDate() + 7);
          return d.toISOString().slice(0, 10);
        })();
    html +=
      '<div class="af-row af-row-what">' +
      '<div class="af-field">' +
      '<label class="af-label">Category</label>' +
      '<select class="af-input" id="af-category" aria-describedby="af-category-hint">' +
      // A class with categories needs one on every scored assessment, as
      // Teams does; the teacher picks it, nothing is chosen for them.
      (categories.length === 0
        ? '<option value="">No Category</option>'
        : needsPick
          ? '<option value="" selected>Choose a Category</option>'
          : '') +
      categories
        .map(function (category) {
          return (
            '<option value="' +
            category.id +
            '"' +
            (category.id === categoryId ? ' selected' : '') +
            '>' +
            esc(category.name) +
            '</option>'
          );
        })
        .join('') +
      '</select>' +
      (categories.length === 0
        ? '<div class="af-rubric-info">This class has no grading categories yet. ' +
          '<button type="button" class="af-link-btn" data-action="afAddCategories">Add Categories</button></div>'
        : // The footer says a category is needed; this line shows only after a
          // save stopped for one (grey text audit, Colin, Nov 11).
          '<p class="af-category-hint" id="af-category-hint" hidden>' + esc(CATEGORY_REQUIRED_HINT) + '</p>') +
      '</div>' +
      // Type beside Category, where Evidence Type was (Colin, Nov 4 and 17).
      AssessmentTypeField.fieldHtml(cid, assess ? assess.evidenceType : undefined) +
      '<div class="af-field">' +
      '<label class="af-label">Module</label>' +
      '<select class="af-input" id="af-module">' +
      '<option value="">No Module</option>' +
      allModules
        .map(function (u) {
          return (
            '<option value="' + u.id + '"' + (u.id === moduleId ? ' selected' : '') + '>' + esc(u.name) + '</option>'
          );
        })
        .join('') +
      '</select>' +
      '</div>' +
      '<div class="af-field">' +
      '<label class="af-label">Date Assigned</label>' +
      '<input class="af-input" id="af-date-assigned" type="date" value="' +
      esc(dateAssigned) +
      '" data-action-change="autoSetDueDate">' +
      '</div>' +
      '<div class="af-field">' +
      '<label class="af-label">Due Date (optional)</label>' +
      '<input class="af-input" id="af-due" type="date" aria-describedby="af-due-hint" value="' +
      esc(defaultDue) +
      '">' +
      '<p class="af-category-hint" id="af-due-hint"' +
      (_dueBeforeAssigned(dateAssigned, defaultDue) ? '' : ' hidden') +
      '>' +
      DUE_BEFORE_ASSIGNED_HINT +
      '</p>' +
      '</div>' +
      '</div>';
    // Who does it, in the top box with what it is (Colin, Nov 11; board
    // "Assessment Form" 2a to 2d).
    html += _studentsRowHtml(collaboration);
    html += '</section>';

    // Competencies above Scoring, as a short field: the chosen ones as chips
    // and Choose Competencies, which opens the list in a window. Every way
    // to score tags them, and the field stays small and in one place
    // whichever scoring is chosen (Colin, Nov 4).
    var lm = getLearningMap(cid);
    var compGroups = (lm && lm.competencyGroups) || [];
    html +=
      '<section class="af-card af-card-competencies" data-view="' +
      _compView() +
      '">' +
      '<div class="af-card-head">' +
      '<span class="af-card-title">Competencies</span>' +
      '</div>' +
      '<div class="af-comp-summary">' +
      '<span class="af-comp-chosen" id="af-comp-chosen"></span>' +
      (sections.length
        ? '<button type="button" class="af-comp-choose" id="af-comp-choose" data-action="openCompPicker" aria-haspopup="dialog">+ Choose Competencies</button>'
        : '') +
      '</div>' +
      '<p class="af-comp-rubric-note" id="af-comp-rubric-note" hidden>From the rubric\u2019s criteria. To change them, edit the rubric.</p>' +
      // The list, in a window over the form while choosing.
      '<div class="af-comp-overlay" id="af-comp-dialog" hidden>' +
      '<div class="af-comp-dialog" role="dialog" aria-modal="true" aria-labelledby="af-comp-dialog-title">' +
      '<div class="af-comp-dialog-head">' +
      '<h3 class="af-comp-dialog-title" id="af-comp-dialog-title">Choose Competencies</h3>' +
      '<span class="af-comp-count" id="af-comp-count"></span>' +
      (sections.length
        ? '<span class="af-comp-tools">' +
          '<input class="af-input af-comp-find" id="af-comp-find" type="search" autocomplete="off" placeholder="Type a code or words" aria-label="Find a competency">' +
          '<span class="seg af-comp-view" role="group" aria-label="Show competencies as">' +
          '<button type="button" class="seg-btn" data-action="setCompView" data-view="codes">Codes</button>' +
          '<button type="button" class="seg-btn" data-action="setCompView" data-view="list">List</button>' +
          '</span></span>'
        : '') +
      '</div>' +
      '<div class="af-comp-dialog-body">' +
      _compPickerHtml(cid, assess, sections, compGroups) +
      '<div class="af-field af-comp-list">' +
      '<div class="af-tags-container">';
    if (compGroups.length > 0) {
      // Build grouped + ungrouped lists
      var _afGroupMap = {};
      compGroups.forEach(function (g) {
        _afGroupMap[g.id] = { group: g, secs: [] };
      });
      var _afUngrouped = [];
      sections.forEach(function (sec) {
        if (sec.groupId && _afGroupMap[sec.groupId]) _afGroupMap[sec.groupId].secs.push(sec);
        else _afUngrouped.push(sec);
      });
      compGroups.forEach(function (g) {
        var gi = _afGroupMap[g.id];
        if (gi.secs.length === 0) return;
        html +=
          '<div class="af-list-group"><label class="af-list-group-head">' +
          _afGroupBox(gi.secs, g.name) +
          '<span class="af-list-group-name">' +
          esc(g.name) +
          '</span></label>';
        gi.secs.forEach(function (sec) {
          html += _afTagRow(sec, selTags);
        });
        html += '</div>';
      });
      _afUngrouped.forEach(function (sec) {
        html += _afTagRow(sec, selTags);
      });
    } else {
      // No groups — flat list
      sections.forEach(function (sec) {
        html += _afTagRow(sec, selTags);
      });
    }
    html +=
      '</div></div></div>' +
      '<div class="af-comp-dialog-foot">' +
      '<button type="button" class="btn btn-ghost" data-action="cancelCompPicker">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="closeCompPicker">Done</button>' +
      '</div>' +
      '</div></div>' +
      _untaggedNote(cid, selTags.length > 0);

    // Core Competencies
    var selCC = assess ? assess.coreCompetencyIds || [] : [];
    html +=
      '<div class="af-field">' + '<label class="af-label">Core Competencies</label>' + '<div class="af-cc-chips">';
    CORE_COMPETENCIES.forEach(function (cc) {
      var sel = selCC.includes(cc.id);
      html +=
        '<button type="button" class="af-cc-chip' +
        (sel ? ' active' : '') +
        '" data-cc="' +
        cc.id +
        '" aria-pressed="' +
        sel +
        '"' +
        ' style="--cc-color:' +
        cc.color +
        '" data-af-tip="core" data-action="toggleActive">' +
        '<span class="af-cc-dot" style="background:' +
        cc.color +
        '"></span>' +
        esc(cc.label) +
        '</button>';
    });
    html += '</div></div></section>';

    // Scoring mode, then its settings
    html +=
      '<section class="af-card af-card-scoring">' +
      '<div class="af-card-head">' +
      '<span class="af-card-title" id="af-scoremode-label">Scoring</span>' +
      '<input type="hidden" id="af-scoremode" value="' +
      esc(scoreMode) +
      '">' +
      '<div class="af-mode-cards" role="radiogroup" aria-labelledby="af-scoremode-label">' +
      SCORE_MODE_CARDS.filter(function (m) {
        // DIBELS only in ELA and Social Studies 8 classes; work that is
        // already DIBELS keeps its card wherever it is.
        if (m.mode === 'competencies') return scoreMode === 'competencies' || getSections(cid).length > 0;
        return m.mode !== 'dibels' || scoreMode === 'dibels' || courseOffersDibels(COURSES[cid]);
      })
        .map(function (m) {
          return (
            '<div class="af-mode-item">' +
            '<button type="button" class="af-mode-card af-scoremode-btn" role="radio" aria-checked="' +
            (scoreMode === m.mode) +
            '" data-mode="' +
            m.mode +
            '" data-action="setScoreMode">' +
            m.icon +
            '<span>' +
            m.label +
            '</span></button>' +
            '</div>'
          );
        })
        .join('') +
      '</div>' +
      // Factor at the end of the row; DIBELS counts toward no grade, so none.
      '<div class="af-field af-weight-field" id="af-weight-wrap"' +
      (scoreMode === 'dibels' ? ' hidden' : '') +
      '>' +
      '<label class="af-label" for="af-weight">Factor</label>' +
      FactorField.fieldHtml(weight) +
      '</div>' +
      '</div>' +
      (lastMode
        ? '<p class="af-category-hint af-score-last" id="af-score-last">The same as your last assessment.</p>'
        : '') +
      '<p class="af-dibels-note" id="af-dibels-note"' +
      (scoreMode === 'dibels' ? '' : ' hidden') +
      '>Words Correct, Errors and Maze are entered at the Beginning, Middle and End of Year, and their levels are worked out on the Grade 8 goals. It counts toward no grade and needs no category.</p>' +
      '<p class="af-dibels-note" id="af-comp-note"' +
      (scoreMode === 'competencies' ? '' : ' hidden') +
      '>Each competency you tag above is scored Emerging to Extending, with + and \u2212. No rubric is needed.</p>' +
      '<p class="af-category-hint" id="af-comp-hint"' +
      (scoreMode === 'competencies' && !(assess && (assess.tagIds || []).length) ? '' : ' hidden') +
      '>' +
      COMPETENCIES_NEED_TAG_HINT +
      '</p>';
    // Rubric (redesign PR 6): a chosen rubric shows as a card with its
    // wording; with none, four ways to start one. The select stays the
    // form's record of the rubric; it shows only while choosing.
    var rubricsList = getRubrics(cid);
    var selRubricId = assess ? assess.rubricId || '' : '';
    html +=
      // The Competency Rubric: how the tagged competencies are scored, the
      // Competencies tab's own grid, above the rubric starts (Colin, Nov 4).
      '<div id="af-tag-rubric"></div>' +
      '<div class="af-field af-rubric-field" id="af-rubric-wrap"' +
      (scoreMode === 'proficiency' ? '' : ' hidden') +
      '>' +
      // Named for screen readers only: the Rubric card above says it.
      '<div class="af-label af-visually-hidden" id="af-rubric-label">Rubric</div>' +
      '<div class="af-rubric-view" id="af-rubric-view"></div>' +
      '<div class="af-rubric-pick" id="af-rubric-pick" hidden>' +
      '<select class="af-rubric-select af-input" id="af-rubric" data-action-change="onRubricSelect" aria-labelledby="af-rubric-label">' +
      '<option value="">None</option>' +
      rubricsList
        .map(function (r) {
          return (
            '<option value="' +
            r.id +
            '"' +
            (r.id === selRubricId ? ' selected' : '') +
            '>' +
            esc(r.name) +
            ' (' +
            r.criteria.length +
            ' criteria)</option>'
          );
        })
        .join('') +
      '</select>' +
      '<button type="button" class="btn btn-ghost" data-action="cancelRubricPick">Cancel</button>' +
      '</div>' +
      '</div>';

    html +=
      '<div class="af-row af-score-settings">' +
      '<div class="af-field af-maxpoints-field" id="af-maxpoints-wrap"' +
      (scoreMode === 'points' ? '' : ' hidden') +
      '>' +
      '<label class="af-label" for="af-maxpoints">Max Points</label>' +
      '<div class="af-maxpoints-controls">' +
      '<input class="af-input" id="af-maxpoints" type="number" min="0" max="9999" step="any" value="' +
      esc(maxPoints) +
      '">' +
      '<div class="seg" id="af-maxpoints-picks" role="group" aria-label="Common maximums">' +
      [10, 25, 50, 100]
        .map(function (v) {
          return (
            '<button type="button" class="seg-btn"' +
            segAttr(maxPoints === v) +
            ' data-action="setMaxPoints" data-value="' +
            v +
            '">' +
            v +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="af-counts-as" id="af-counts-as" aria-live="polite">' +
      FactorField.barHtml(
        needsPick && categoryRequired(cid, { scoreMode: _storedScoreMode(scoreMode) })
          ? null
          : assessmentCategoryShare(cid, {
              id: assess ? assess.id : null,
              title: assess ? assess.title || '' : '',
              categoryId: needsPick ? '' : categoryId,
              rubricId: assess && scoreMode === 'proficiency' ? assess.rubricId || '' : '',
              scoreMode: _storedScoreMode(scoreMode),
              maxPoints: maxPoints,
              weight: weight,
            }),
        assess ? assess.title || '' : '',
      ) +
      '</div>' +
      FactorField.factoredHtml(scoreMode, maxPoints, weight, !!(assess && assess.studentsSeeFactored)) +
      '</section>';

    // Student Work (S5-F1): only in a class with Send Work on.
    pageState._formWork = _formWorkOffered(cid) ? _formWorkFor(cid, assess) : null;
    pageState._formSeedDue = defaultDue;
    // The Quiz card under it (teacher/quiz-builder.js): '' with the quizzes switch off.
    var quizMount = window.QuizBuilder ? QuizBuilder.mountHtml(cid, assess, !!pageState._formWork) : '';
    if (pageState._formWork) html += _formWorkCardHtml(cid);
    html += quizMount;

    // Actions, in a footer that stays at the bottom of the window while the
    // form is in view, with what the work counts toward beside them.
    html +=
      '<div class="af-actions">' +
      // Create and Add Another says what it saved, until the next edit.
      '<p class="af-saved-note" id="af-saved-note" role="status" hidden></p>' +
      '<p class="af-counts-toward" id="af-counts-toward" aria-live="polite"></p>' +
      // Cancel, Save as Draft, Create and Add Another, Create Assessment; a Draft's edit form ends with Assign.
      AssignDraft.footerHtml(isEdit, assess) +
      '</div>';

    return html;
  }

  /* The Students row in the top box: a button naming who it's for, which
     opens Choose Students, and Individual, Pair or Group. Pairs and groups
     open their builder under it (teacher/assign-collab.js). */
  // html-safe: fixed labels; the summary is filled by AssignCollab
  function _studentsRowHtml(collaboration) {
    var btn = function (mode, label) {
      return (
        '<button type="button" class="seg-btn af-type-btn af-collab-btn' +
        (collaboration === mode ? ' active' : '') +
        '"' +
        segAttr(collaboration === mode) +
        ' data-collab="' +
        mode +
        '" data-action="setCollaboration">' +
        label +
        '</button>'
      );
    };
    return (
      '<div class="af-students-row" role="group" aria-labelledby="af-students-label">' +
      '<span class="af-label" id="af-students-label">Students</span>' +
      '<div class="af-students-controls">' +
      '<button type="button" class="af-students-btn" id="af-choose-students" data-action="toggleChooseStudents" aria-controls="collab-panel-mount" aria-expanded="false">' +
      '<span class="af-students-summary" id="af-students-summary"></span>' +
      '<svg class="af-students-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="seg af-type-toggle af-collab-toggle" role="group" aria-label="How students work">' +
      btn('individual', 'Individual') +
      btn('pair', 'Pair') +
      btn('group', 'Group') +
      '</div>' +
      '</div>' +
      '<p class="af-category-hint af-students-names" id="af-students-names" hidden></p>' +
      '<div id="collab-panel-mount"></div>' +
      '</div>'
    );
  }

  return {
    configure: configure,
    renderAssessForm: renderAssessForm,
  };
})();
