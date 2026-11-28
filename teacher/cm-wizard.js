// @ts-check
/* cm-wizard.js — The New Class wizard. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmWizard = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var CALC_METHODS,
    CW_PRESETS,
    GRADING_SYSTEMS,
    _cwCourseRow,
    _cwSeg,
    _cwSetRow,
    blockPickerHtml,
    readBlockPicker,
    renderClassManager,
    state,
    _awaitCanonicalCourse,
    _cmCalcMethodDescription,
    _cmDefaultCalcMethod,
    _cmDefaultGradingScale,
    _cmDefaultGradingSystem,
    _cmDefaultLevelOrder,
    _cmGradingSystemDescription,
    _resolvesTrueWithin;
  function configure(h) {
    if ('CALC_METHODS' in h) CALC_METHODS = h.CALC_METHODS;
    if ('CW_PRESETS' in h) CW_PRESETS = h.CW_PRESETS;
    if ('GRADING_SYSTEMS' in h) GRADING_SYSTEMS = h.GRADING_SYSTEMS;
    if ('_cwCourseRow' in h) _cwCourseRow = h._cwCourseRow;
    if ('_cwSeg' in h) _cwSeg = h._cwSeg;
    if ('_cwSetRow' in h) _cwSetRow = h._cwSetRow;
    if ('blockPickerHtml' in h) blockPickerHtml = h.blockPickerHtml;
    if ('readBlockPicker' in h) readBlockPicker = h.readBlockPicker;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_awaitCanonicalCourse' in h) _awaitCanonicalCourse = h._awaitCanonicalCourse;
    if ('_cmCalcMethodDescription' in h) _cmCalcMethodDescription = h._cmCalcMethodDescription;
    if ('_cmDefaultCalcMethod' in h) _cmDefaultCalcMethod = h._cmDefaultCalcMethod;
    if ('_cmDefaultGradingScale' in h) _cmDefaultGradingScale = h._cmDefaultGradingScale;
    if ('_cmDefaultGradingSystem' in h) _cmDefaultGradingSystem = h._cmDefaultGradingSystem;
    if ('_cmDefaultLevelOrder' in h) _cmDefaultLevelOrder = h._cmDefaultLevelOrder;
    if ('_cmGradingSystemDescription' in h) _cmGradingSystemDescription = h._cmGradingSystemDescription;
    if ('_resolvesTrueWithin' in h) _resolvesTrueWithin = h._resolvesTrueWithin;
  }

  /* ── Curriculum Wizard ──────────────────────────────────── */
  /* Two steps (Colin, 2026-11-25, the Course Tabs Board): 1 Choose Courses,
     "What Do You Teach in This Class?", with every course of the grade in one
     list; 2 Name Your Class, with what Create Class sets on its own under
     Already Set for You, each behind Change. A Your Class panel beside both
     shows the class as it is made. A custom class (no courses) goes straight
     to step 2. */
  function renderCmCreateForm() {
    return state.cwStep === 2 ? renderCwDetails() : renderCwCourses();
  }

  function renderCwStepBar() {
    return (
      '<div class="cw-steps">' +
      ['Choose Courses', 'Name Your Class']
        .map(function (label, i) {
          var n = i + 1;
          var cls = n < state.cwStep ? 'done' : n === state.cwStep ? 'active' : '';
          return (
            (i > 0 ? '<span class="cw-step-arrow">›</span>' : '') +
            '<div class="cw-step ' +
            cls +
            '"' +
            (n === state.cwStep ? ' aria-current="step"' : '') +
            '><span class="cw-step-num">' +
            (n < state.cwStep ? '✓' : n) +
            '</span><span>' +
            label +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // A step's page: the step bar, the step beside Your Class, then the footer.
  function _cwPage(main, footer) {
    return (
      '<div class="cm-detail-inner cw-wizard">' +
      renderCwStepBar() +
      '<div class="cw-body"><div class="cw-main">' +
      main +
      '</div>' +
      _cwRailHtml() +
      '</div><div class="cw-footer">' +
      footer +
      '</div></div>'
    );
  }

  function renderCwCourses() {
    if (!state.cwCurriculumLoaded && !state.cwLoadError)
      return (
        '<div class="cm-detail-inner cw-wizard">' +
        renderCwStepBar() +
        '<div class="cm-section"><div class="cw-empty-msg">Loading BC Curriculum data…</div></div>' +
        '<div class="cw-footer">' +
        _cwCancelBtn() +
        '</div></div>'
      );
    if (state.cwLoadError)
      return (
        '<div class="cm-detail-inner cw-wizard">' +
        renderCwStepBar() +
        '<div class="cm-section"><div class="cw-empty-msg">Could not load BC Curriculum data.<br>You can still create a class with a custom learning map.</div></div>' +
        '<div class="cw-footer">' +
        _cwCancelBtn() +
        '<button class="btn btn-primary" data-action="cwSkipToCustom">Custom Class</button></div></div>'
      );

    var courses = state.cwSelectedGrade !== null ? getCoursesByGrade(state.cwSelectedGrade).slice() : [];
    courses.sort(function (a, b) {
      return (
        String(a.subject).localeCompare(String(b.subject)) ||
        String(a.course_name).localeCompare(String(b.course_name), undefined, { numeric: true })
      );
    });
    // A long grade (10 to 12 hold 45 to 96 courses) gets a find box and a heading a subject.
    var long = courses.length > 12;
    var html =
      '<div class="cm-section cw-courses"><h2 class="cw-title">What Do You Teach in This Class?</h2>' +
      '<div class="cw-grade-line"><span class="cw-label" id="cw-grade-label">Grade</span>' +
      '<div class="seg cm-seg cw-grade-seg" role="radiogroup" aria-labelledby="cw-grade-label">' +
      [8, 9, 10, 11, 12]
        .map(function (g) {
          var on = state.cwSelectedGrade === g;
          return (
            '<button type="button" class="seg-btn cm-seg-btn' +
            (on ? ' active' : '') +
            '"' +
            segAttr(on, 'radio') +
            ' aria-label="Grade ' +
            g +
            '" data-action="cwSelectGrade" data-grade="' +
            g +
            '">' +
            g +
            '</button>'
          );
        })
        .join('') +
      '</div>' +
      (long
        ? '<input type="search" class="cm-input cw-find" placeholder="Find a course" aria-label="Find a course" value="' +
          esc(state.cwFindText) +
          '" data-action-input="cwFind">'
        : '') +
      '</div>';

    if (state.cwSelectedGrade === null) html += '<p class="cw-lead">Pick a grade to see its courses.</p>';
    else {
      var q = long ? state.cwFindText.trim().toLowerCase() : '';
      var presets = _cwPresetsFor(state.cwSelectedGrade, courses);
      var preset = _cwActivePreset();
      var list = '';
      presets.forEach(function (p) {
        list += _cwCourseRow({
          action: 'cwTogglePreset',
          key: p.id,
          on: !!preset && preset.id === p.id,
          name: p.name,
          sub:
            p.tags
              .map(function (tag) {
                return /** @type {any} */ (CURRICULUM_INDEX)[tag].course_name;
              })
              .join(' and ') + ', taught together',
          counts: _cwCourseCounts(p.tags),
          q: q,
        });
      });
      if (presets.length) list += '<div class="cw-course-sep" role="presentation"' + (q ? ' hidden' : '') + '></div>';
      // What the find box leaves showing: in each subject, and in all.
      var shows = function (name) {
        return !q || String(name).toLowerCase().indexOf(q) >= 0;
      };
      var anyShown = presets.some(function (p) {
        return shows(p.name);
      });
      var group = null;
      var rows = '';
      var groupShown = false;
      var shut = function () {
        if (group === null) return;
        list += long
          ? '<div class="cw-course-group" role="group" aria-label="' +
            esc(group) +
            '"' +
            (groupShown ? '' : ' hidden') +
            '><div class="cw-course-head">' +
            esc(group) +
            '</div>' +
            rows +
            '</div>'
          : rows;
        rows = '';
        groupShown = false;
      };
      courses.forEach(function (c) {
        // The old bank's own HUM8 course gives way to the preset.
        if (
          presets.some(function (p) {
            return p.id === c.short_tag;
          })
        )
          return;
        if (c.subject !== group) {
          shut();
          group = c.subject;
        }
        if (shows(c.course_name)) groupShown = anyShown = true;
        rows += _cwCourseRow({
          action: 'cwToggleCourse',
          key: c.short_tag,
          on: state.cwSelectedTags.indexOf(c.short_tag) >= 0,
          name: c.course_name,
          counts: _cwCourseCounts([c.short_tag]),
          q: q,
        });
      });
      shut();
      html +=
        '<p class="cw-lead">Tick every course you teach in this class.</p>' +
        '<div class="cw-course-list">' +
        list +
        '<p class="cw-find-none" id="cw-find-none"' +
        (anyShown ? ' hidden' : '') +
        '>No course by that name in this grade.</p></div>';
    }
    html +=
      '<button type="button" class="cw-custom-link" data-action="cwSkipToCustom">Not in the BC Curriculum? Make Your Own Class</button></div>';

    return _cwPage(
      html,
      _cwCancelBtn() +
        '<button class="btn btn-primary" data-action="cwGoToStep2"' +
        (state.cwSelectedTags.length ? '' : ' disabled') +
        '>Next</button>',
    );
  }

  /* Competencies and Ministry folders in these courses (the old bank has
     no folders). */
  function _cwCourseCounts(tags) {
    var out = { competencies: 0, folders: 0 };
    tags.forEach(function (tag) {
      var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
      (course ? course.categories || [] : []).forEach(function (cat) {
        var n = (cat.competencies || []).length;
        out.competencies += n;
        if (cat.folder === true && n) out.folders++;
      });
    });
    return out;
  }

  // A course's competencies still ticked, and all of them.
  function _cwKept(tag) {
    var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
    var out = { on: 0, all: 0 };
    (course ? course.categories || [] : []).forEach(function (cat) {
      (cat.competencies || []).forEach(function (comp) {
        out.all++;
        if (!state.cwSkipped[curriculumCompKey(tag, comp)]) out.on++;
      });
    });
    return out;
  }

  /* The presets for this grade whose courses are all in the bank and one of
     which is in the grade's list. */
  function _cwPresetsFor(grade, courses) {
    var here = courses.map(function (c) {
      return c.short_tag;
    });
    return CW_PRESETS.filter(function (p) {
      return (
        p.grade === grade &&
        p.tags.every(function (tag) {
          return CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
        }) &&
        p.tags.some(function (tag) {
          return here.indexOf(tag) >= 0;
        })
      );
    });
  }

  /* The ticked preset, while all its courses are still ticked. */
  function _cwActivePreset() {
    var p = CW_PRESETS.find(function (x) {
      return x.id === state.cwPreset;
    });
    if (!p) return null;
    return p.tags.every(function (tag) {
      return state.cwSelectedTags.indexOf(tag) >= 0;
    })
      ? p
      : null;
  }

  /* ── Your Class: the class as it is made, beside both steps ── */
  function _cwRailName() {
    var name = state.cwStep2Name != null ? state.cwStep2Name : _cwDefaultName();
    return name.trim() || 'New Class';
  }
  function _cwRailSubText() {
    var grade = _cwGradeLevel();
    var bits = [];
    if (grade && _cwRailName() !== 'Grade ' + grade) bits.push('Grade ' + grade);
    var block = courseBlockLabel({ block: state.cwStep2Block });
    if (block) bits.push(/^[A-EX]$/.test(block) ? 'Block ' + block : block);
    if (state.cwStep === 2)
      bits.push(
        (
          TERM_SPANS.find(function (o) {
            return o.value === state.cwStep2Span;
          }) || TERM_SPANS[0]
        ).label,
      );
    return bits.join(' · ');
  }
  // The rail's name and line under it, as the teacher types or picks.
  function _cwRailSync() {
    var name = document.getElementById('cw-rail-name');
    if (name) name.textContent = _cwRailName();
    var sub = document.getElementById('cw-rail-sub');
    if (sub) sub.textContent = _cwRailSubText();
  }
  function _cwRailHtml() {
    var rows = state.cwSelectedTags
      .map(function (tag) {
        var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
        if (!course) return '';
        var k = _cwKept(tag);
        return (
          '<div class="cw-rail-course"><span class="cw-rail-dot" style="background:' +
          (SUBJECT_COLOURS[course.subject] || '#6366f1') +
          '" aria-hidden="true"></span><span class="cw-rail-text"><span class="cw-rail-cname">' +
          esc(course.course_name) +
          '</span><span class="cw-rail-count">' +
          (k.on === k.all ? k.all : k.on + ' of ' + k.all) +
          (k.all === 1 ? ' Competency' : ' Competencies') +
          '</span></span>' +
          (state.cwStep === 1
            ? '<button type="button" class="cw-rail-x" data-action="cwToggleCourse" data-tag="' +
              esc(tag) +
              '" aria-label="Take Out ' +
              esc(course.course_name) +
              '">×</button>'
            : '') +
          '</div>'
        );
      })
      .join('');
    var note = '';
    if (state.cwSelectedTags.length > 1) {
      var names = state.cwSelectedTags.map(function (tag) {
        return /** @type {any} */ (CURRICULUM_INDEX)[tag]
          ? /** @type {any} */ (CURRICULUM_INDEX)[tag].course_name
          : tag;
      });
      note = _cwGrading().coursesCountEqually
        ? names.length === 2
          ? names[0] + ' and ' + names[1] + ' each make up half of the overall.'
          : 'Each of the ' + names.length + ' courses makes up an equal share of the overall.'
        : 'A course with more competencies or folders counts for more in the overall.';
    } else if (!state.cwSelectedTags.length)
      note =
        state.cwStep === 2
          ? 'No courses from the BC curriculum. Add competencies in the Competencies tab once the class is made.'
          : 'Tick a course and it shows here.';
    return (
      '<aside class="cw-rail" aria-labelledby="cw-rail-title"><h2 class="cw-rail-title" id="cw-rail-title">Your Class</h2>' +
      '<div class="cw-rail-page"><div class="cw-rail-name" id="cw-rail-name">' +
      esc(_cwRailName()) +
      '</div><div class="cw-rail-sub" id="cw-rail-sub">' +
      esc(_cwRailSubText()) +
      '</div>' +
      rows +
      '</div>' +
      (note ? '<p class="cw-rail-note">' + esc(note) + '</p>' : '') +
      '</aside>'
    );
  }

  /* ── Step 2: Name Your Class ─────────────────────────────── */
  // The class's grade: typed for a custom class, else the grade picked.
  function _cwGradeLevel() {
    if (state.cwStep2Grade) return state.cwStep2Grade.trim();
    return state.cwSelectedGrade ? String(state.cwSelectedGrade) : '';
  }

  /* What the teacher has typed or picked on this step, kept before the step
     draws again (Change, a competency ticked, Back, Create Class), so nothing is lost. A
     name left as the one the courses give follows the courses. */
  function _cwReadDetails() {
    var nameEl = document.getElementById('cm-new-name');
    if (!nameEl || typeof (/** @type {any} */ (nameEl).value) !== 'string') return;
    var typed = /** @type {any} */ (nameEl).value;
    state.cwStep2Name = typed === _cwDefaultName() ? null : typed;
    if (document.getElementById('cm-new-block')) state.cwStep2Block = readBlockPicker('cm-new-block');
    var span = document.querySelector('#cm-cg-span .cm-seg-btn.active');
    if (span && /** @type {any} */ (span).dataset) state.cwStep2Span = /** @type {any} */ (span).dataset.val || 'full';
    var grade = document.getElementById('cm-new-grade');
    if (grade) state.cwStep2Grade = /** @type {any} */ (grade).value || '';
    var decay = document.getElementById('cm-cg-decay-slider');
    if (decay) state.cwStep2Decay = /** @type {any} */ (decay).value || '65';
  }

  function renderCwDetails() {
    var custom = !state.cwSelectedTags.length;
    var name = state.cwStep2Name != null ? state.cwStep2Name : _cwDefaultName();
    var gradeLevel = _cwGradeLevel();
    var grading = state.cwStep2Grading || _cmDefaultGradingSystem({ gradeLevel: gradeLevel });
    var calc = state.cwStep2Calc || _cmDefaultCalcMethod();

    var html =
      '<div class="cm-section"><h2 class="cw-title">Name Your Class</h2>' +
      '<div class="cm-field"><label class="cm-label" for="cm-new-name">Class Name</label><input class="cm-input cw-name" id="cm-new-name" value="' +
      esc(name) +
      '" placeholder="e.g. English 10" required aria-describedby="cm-new-name-hint" data-action-input="cwNameInput" autofocus>' +
      // Create Class waits for a name, so a slip can't make a class called Untitled.
      '<div class="cm-hint" id="cm-new-name-hint"' +
      (name.trim() ? ' hidden' : '') +
      '>Enter a Class Name to continue.</div></div>' +
      '<div class="cw-detail-row"><div class="cm-field"><label class="cm-label" id="cm-new-block-label">Block</label>' +
      blockPickerHtml('cm-new-block', state.cwStep2Block) +
      '</div><div class="cm-field"><label class="cm-label" id="cm-cg-span-label">This Class Runs</label>' +
      _cwSeg('cm-cg-span', 'cm-cg-span-label', TERM_SPANS, state.cwStep2Span, 'cmCreateToggle') +
      '</div>' +
      // A custom class has no grade from a course: its grade level is typed.
      (custom
        ? '<div class="cm-field"><label class="cm-label" for="cm-new-grade">Grade Level</label><input class="cm-input cw-grade-input" id="cm-new-grade" value="' +
          esc(gradeLevel) +
          '" placeholder="e.g. 8, 10-12" data-action-input="cwGradeInput"></div>'
        : '') +
      '</div></div>';

    html +=
      '<div class="cm-section"><h2 class="cw-subtitle" id="cm-cg-grading-label">Grades Show As</h2>' +
      _cwSeg('cm-cg-grading', 'cm-cg-grading-label', GRADING_SYSTEMS, grading, 'cmCreateToggle') +
      '<p class="cw-desc" id="cm-cg-grading-desc">' +
      _cmGradingSystemDescription(grading) +
      '</p></div>';

    var rows = '';
    if (custom) rows += _cwSetRow(state.cwOpen, 'comps', 'Competencies', 'None yet. Add them in the Competencies tab.');
    else {
      var on = 0;
      var all = 0;
      state.cwSelectedTags.forEach(function (tag) {
        var k = _cwKept(tag);
        on += k.on;
        all += k.all;
      });
      rows += _cwSetRow(
        state.cwOpen,
        'comps',
        'Competencies',
        (on === all ? 'All ' + all : on + ' of ' + all) + ' from the BC curriculum',
        _cwCompsHtml,
      );
    }
    var calcLabel = (
      CALC_METHODS.find(function (m) {
        return m.value === calc;
      }) || CALC_METHODS[0]
    ).label;
    rows += _cwSetRow(
      state.cwOpen,
      'calc',
      'Calculation',
      esc(calcLabel) + (calc === 'decayingAvg' ? ' · ' + esc(state.cwStep2Decay) + '% decay weight' : ''),
      function () {
        return (
          '<span class="help-sr-only" id="cm-cg-calc-label">Calculation Method</span>' +
          _cwSeg('cm-cg-calc', 'cm-cg-calc-label', CALC_METHODS, calc, function (m) {
            return m.value === 'decayingAvg' ? 'cmCreateToggleDecay' : 'cmCreateToggle';
          }) +
          '<p class="cw-desc" id="cm-cg-calc-desc">' +
          _cmCalcMethodDescription(calc) +
          '</p><div id="cm-cg-decay" class="cm-field"' +
          (calc === 'decayingAvg' ? '' : ' style="display:none"') +
          '><label class="cm-label" for="cm-cg-decay-slider">Decay Weight</label>' +
          '<div class="cm-slider-row"><input type="range" min="10" max="95" value="' +
          esc(state.cwStep2Decay) +
          '" id="cm-cg-decay-slider" data-action-input="cmCreateDecaySlider" style="flex:1"><span class="cm-slider-label" id="cm-cg-decay-val">' +
          esc(state.cwStep2Decay) +
          '%</span></div><div class="cm-hint">Higher values weight recent scores more heavily.</div></div>'
        );
      },
    );
    rows += _cwTermsRows(gradeLevel);

    html += '<div class="cm-section"><h2 class="cw-subtitle">Already Set for You</h2>' + rows + '</div>';

    return _cwPage(
      html,
      _cwCancelBtn() +
        '<button class="btn btn-ghost" data-action="cwGoBack">Back</button><button class="btn btn-primary" data-action="cwFinishCreate"' +
        (name.trim() && !CmTermsStart.error() ? '' : ' disabled') +
        '>Create Class</button>',
    );
  }

  /* The competencies of each ticked course, all ticked to start, in Ministry
     order with their full wording. A Ministry folder is a heading with its
     figure and Select All / Clear. */
  function _cwCompsHtml() {
    var html =
      '<p class="cw-cc-intro">The BC curriculum expects every competency to be taught. Untick only what you won’t assess in this class.</p>';
    state.cwSelectedTags.forEach(function (tag) {
      var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
      if (!course) return;
      var color = SUBJECT_COLOURS[course.subject] || '#6366f1';
      var cats = (course.categories || []).filter(function (cat) {
        return (cat.competencies || []).length;
      });
      var body = '';
      cats.forEach(function (cat, ci) {
        var rows = /** @type {any} */ (cat.competencies)
          .map(function (comp) {
            var key = curriculumCompKey(tag, comp);
            var ticked = !state.cwSkipped[key];
            return (
              '<label class="cw-cc-row' +
              (ticked ? '' : ' off') +
              '"><input type="checkbox" class="cw-cc-check"' +
              (ticked ? ' checked' : '') +
              ' data-action-change="cwCompToggle" data-key="' +
              esc(key) +
              '"><span class="cm-std-code" style="--chip:' +
              color +
              '">' +
              esc(comp.tag || '') +
              '</span><span class="cw-cc-text"><span class="cw-cc-name">' +
              esc(comp.short_label || comp.tag || '') +
              '</span><span class="cw-cc-wording">' +
              esc(comp.raw || '') +
              '</span></span></label>'
            );
          })
          .join('');
        if (cat.folder !== true) {
          body += '<div class="cw-cc-loose"><div class="cw-cc-rows">' + rows + '</div></div>';
          return;
        }
        var fOn = /** @type {any} */ (cat.competencies).filter(function (comp) {
          return !state.cwSkipped[curriculumCompKey(tag, comp)];
        }).length;
        body +=
          '<div class="cw-cc-folder" role="group" aria-label="' +
          esc(cat.name) +
          '"><div class="cw-cc-folder-head"><span class="cw-cc-folder-name">' +
          esc(cat.name) +
          '</span><span class="cw-cc-folder-fig">' +
          fOn +
          ' of ' +
          /** @type {any} */ (cat.competencies).length +
          '</span><span class="cw-cc-folder-acts">' +
          '<button type="button" class="cw-cc-btn" data-action="cwFolderAll" data-tag="' +
          esc(tag) +
          '" data-idx="' +
          ci +
          '">Select All</button><button type="button" class="cw-cc-btn" data-action="cwFolderNone" data-tag="' +
          esc(tag) +
          '" data-idx="' +
          ci +
          '">Clear</button></span></div><div class="cw-cc-rows">' +
          rows +
          '</div></div>';
      });
      var k = _cwKept(tag);
      html +=
        '<div class="cw-cc-course"><div class="cw-cc-course-head"><span class="cw-cc-course-name">' +
        esc(course.course_name) +
        '</span><span class="cw-cc-course-fig">' +
        k.on +
        ' of ' +
        k.all +
        ' Competencies</span></div>' +
        body +
        '</div>';
    });
    return html;
  }

  /* Reporting Terms, which opens Class Settings' own Reporting Terms
     section for the class being made (teacher/cm-terms-start.js), and, for
     a grade that reports a letter, Counts As. */
  function _cwTermsRows(gradeLevel) {
    var html = _cwSetRow(state.cwOpen, 'terms', 'Reporting Terms', esc(CmTermsStart.summary()), CmTermsStart.html);
    if (_cmDefaultGradingScale(gradeLevel))
      html += _cwSetRow(
        state.cwOpen,
        'counts',
        'Counts As',
        'BC Letter Bands',
        function () {
          return '<p class="cw-desc">Each proficiency counts as a percent in the course % from the BC letter bands. You can change this later in Grading.</p>';
        },
        true,
      );
    return html;
  }

  /* ── Wizard navigation ──────────────────────────────────── */
  function cwSelectGrade(g) {
    state.cwSelectedGrade = g;
    state.cwStep2Grade = '';
    state.cwStep2Grading = '';
    state.cwStep2Calc = '';
    state.cwSelectedTags = [];
    state.cwSkipped = {};
    state.cwPreset = null;
    state.cwFindText = '';
    // Another grade is another class: a name typed for the last one goes.
    state.cwStep2Name = null;
    renderClassManager();
  }

  function cwToggleCourse(tag) {
    var idx = state.cwSelectedTags.indexOf(tag);
    if (idx >= 0) state.cwSelectedTags.splice(idx, 1);
    else state.cwSelectedTags.push(tag);
    _cwRedraw();
  }

  // A preset ticks its courses together and unticks them together.
  function cwTogglePreset(id) {
    var p = CW_PRESETS.find(function (x) {
      return x.id === id;
    });
    if (!p) return;
    var on = !!_cwActivePreset() && state.cwPreset === id;
    state.cwSelectedTags = state.cwSelectedTags.filter(function (tag) {
      return p.tags.indexOf(tag) < 0;
    });
    if (on) state.cwPreset = null;
    else {
      state.cwPreset = id;
      state.cwSelectedTags = p.tags.concat(state.cwSelectedTags);
    }
    _cwRedraw();
  }

  // The find box hides the courses whose names don't hold what is typed.
  function cwFindInput(value) {
    state.cwFindText = value || '';
    var q = state.cwFindText.trim().toLowerCase();
    var list = document.querySelector('.cw-course-list');
    if (!list) return;
    list.querySelectorAll('[data-find]').forEach(function (row) {
      /** @type {any} */ (row).hidden = !!q && /** @type {any} */ (row).dataset.find.indexOf(q) < 0;
    });
    list.querySelectorAll('.cw-course-group').forEach(function (g) {
      /** @type {any} */ (g).hidden = !g.querySelector('[data-find]:not([hidden])');
    });
    list.querySelectorAll('.cw-course-sep').forEach(function (s) {
      /** @type {any} */ (s).hidden = !!q;
    });
    var none = document.getElementById('cw-find-none');
    if (none) none.hidden = !q || !!list.querySelector('[data-find]:not([hidden])');
  }

  function cwCompToggle(key, ticked) {
    if (ticked) delete state.cwSkipped[key];
    else state.cwSkipped[key] = true;
    _cwRedraw();
  }

  // Select All / Clear for one Ministry folder.
  function cwFolderSet(tag, idx, ticked) {
    var course = CURRICULUM_INDEX && CURRICULUM_INDEX[tag];
    var cat =
      course &&
      (course.categories || []).filter(function (c) {
        return (c.competencies || []).length;
      })[idx];
    if (!cat) return;
    /** @type {any} */ (cat.competencies).forEach(function (comp) {
      var key = curriculumCompKey(tag, comp);
      if (ticked) delete state.cwSkipped[key];
      else state.cwSkipped[key] = true;
    });
    _cwRedraw();
  }

  // Change (or Done) on a row of Already Set for You.
  function cwOpenRow(key) {
    state.cwOpen = state.cwOpen === key ? '' : key;
    _cwRedraw();
  }

  // The step drawn again where it was scrolled to.
  function _cwRedraw() {
    if (state.cwStep === 2) _cwReadDetails();
    var pane = document.querySelector('.cm-detail');
    var top = pane ? pane.scrollTop : 0;
    renderClassManager();
    pane = document.querySelector('.cm-detail');
    if (pane) pane.scrollTop = top;
  }

  // Cancel on both steps.
  function _cwCancelBtn() {
    return '<button class="btn btn-ghost cw-cancel" data-action="cmCancelCreate">Cancel</button>';
  }

  /* A new step opens at its top, with the step bar in view, whatever the
     last step was scrolled to (the Class Name box's autofocus included). */
  function _cwShowStep(step) {
    if (state.cwStep === 2) _cwReadDetails();
    state.cwStep = step;
    state.cwOpen = '';
    renderClassManager();
    var top = function () {
      var detail = document.querySelector('.cm-detail');
      if (detail) detail.scrollTop = 0;
    };
    top();
    requestAnimationFrame(top);
  }

  function cwSkipToCustom() {
    state.cwSelectedTags = [];
    state.cwPreset = null;
    _cwShowStep(2);
  }

  function cwGoToStep2() {
    if (state.cwSelectedTags.length === 0) return;
    _cwShowStep(2);
  }

  /* How the overall counts, which New Class no longer asks (Colin,
     2026-11-27): one course counts its folders as one, a combined class
     counts each course equally. Both change later in Grading. */
  function _cwGrading() {
    var d = curriculumGradingDefaults(state.cwSelectedTags);
    return { foldersCountAsOne: d.foldersCountAsOne, coursesCountEqually: d.coursesCountEqually };
  }

  // Create Class comes on once the class has a name; Your Class follows it.
  function cwNameInput(el) {
    var typed = el.value || '';
    state.cwStep2Name = typed === _cwDefaultName() ? null : typed;
    cwSyncCreate();
    var hint = document.getElementById('cm-new-name-hint');
    if (hint) hint.hidden = !!typed.trim();
    _cwRailSync();
  }

  // Create Class is on once the class has a name and its terms have no problem.
  function cwSyncCreate() {
    var next = document.querySelector('[data-action="cwFinishCreate"]');
    if (next) /** @type {any} */ (next).disabled = !cwGetPreName().trim() || !!CmTermsStart.error();
  }

  // This Class Runs: Your Class and Reporting Terms follow it.
  function cwSpanChanged() {
    _cwRailSync();
    CmTermsStart.spanChanged();
  }

  function cwGoBack() {
    _cwShowStep(1);
  }

  function cwGetPreName() {
    if (state.cwStep2Name != null) return state.cwStep2Name;
    return _cwDefaultName();
  }

  /* A new class's name: the preset's (Humanities 8) while only its courses
     are ticked, else the course names. */
  function _cwDefaultName() {
    var p = _cwActivePreset();
    if (p && state.cwSelectedTags.length === p.tags.length) return p.name;
    if (!CURRICULUM_INDEX) return '';
    return state.cwSelectedTags
      .map(function (tag) {
        return /** @type {any} */ (CURRICULUM_INDEX)[tag];
      })
      .filter(Boolean)
      .map(function (c) {
        return c.course_name;
      })
      .join(' / ');
  }

  async function cwFinishCreate() {
    _cwReadDetails();
    if (CmTermsStart.error()) return;
    var name = cwGetPreName();
    if (!name.trim()) {
      // Back to Name Your Class, where the name is typed.
      state.cwStep = 2;
      renderClassManager();
      requestAnimationFrame(function () {
        var el = document.getElementById('cm-new-name');
        if (el) {
          el.style.border = '2px solid var(--score-1)';
          /** @type {any} */ (el).placeholder = 'Class name is required';
          el.oninput = function () {
            /** @type {any} */ (this).style.border = '';
          };
          el.focus();
        }
      });
      return;
    }

    var finishBtn = document.querySelector('[data-action="cwFinishCreate"]');
    if (finishBtn) {
      /** @type {any} */ (finishBtn).disabled = true;
      finishBtn.textContent = 'Creating…';
    }

    var course = createCourse({
      name: name.trim(),
      block: state.cwStep2Block,
      gradeLevel: _cwGradeLevel(),
      // Description and Late Work Policy are left to Class Settings (Colin, 2026-11-25).
      description: '',
      gradingSystem: state.cwStep2Grading || _cmDefaultGradingSystem({ gradeLevel: _cwGradeLevel() }),
      calcMethod: state.cwStep2Calc || _cmDefaultCalcMethod(),
      decayWeight: parseInt(state.cwStep2Decay, 10) / 100,
      lateWorkPolicy: null,
    });

    // createCourse fires create_course asynchronously and returns a course
    // object carrying a local placeholder id; the rekey to the canonical UUID
    // lands when the RPC resolves. Everything below needs the real id — the
    // course-config write, the learning-map dispatch, the class-manager
    // selection and the active-course pointer — so resolve it once, here,
    // before any of them run. Resolving outside the curriculum branch matters:
    // a class created with no curriculum tags used to skip the wait entirely
    // and carry the placeholder all the way to setActiveCourse.
    var canonicalCid = await _awaitCanonicalCourse(course.id, 10000);
    if (canonicalCid && canonicalCid !== course.id) course.id = canonicalCid;

    var cc = getCourseConfig(course.id);
    cc.calcMethod = state.cwStep2Calc || _cmDefaultCalcMethod();
    cc.decayWeight = parseInt(state.cwStep2Decay, 10) / 100;
    cc.levelOrder = _cmDefaultLevelOrder(course.gradeLevel);
    var startScale = _cmDefaultGradingScale(course.gradeLevel);
    if (startScale) cc.gradingScale = startScale;
    // Exactly the terms Reporting Terms shows, none included.
    cc.reportingTerms = CmTermsStart.terms();
    // The grading switches: by default one course counts its
    // folders as one, and a combined class counts each course equally.
    if (state.cwSelectedTags.length > 0) Object.assign(cc, _cwGrading());
    saveCourseConfig(course.id, cc);

    var dispatchOk = true;
    if (state.cwSelectedTags.length > 0 && CURRICULUM_INDEX) {
      // Fresh local ids: the built map names rows after the course and its
      // codes, the same for every class, and a second class made from the
      // same course in this sitting would otherwise save onto the first's.
      var map = withFreshLearningMapIds(
        buildLearningMapFromTags(state.cwSelectedTags, { skip: Object.keys(state.cwSkipped) }),
      );
      if (map) {
        var mapSaved = saveLearningMap(course.id, map);
        updateCourse(course.id, { curriculumTags: state.cwSelectedTags.slice() });
        // A class whose create never landed has no server id, so its
        // curriculum can't be sent yet. Otherwise wait for the map to reach
        // the server, within reason: offline, the outbox keeps it for later.
        // Demo Mode has no server, so its map is saved once it's cached.
        var localOnly = typeof _writesEnabled === 'function' && !_writesEnabled();
        dispatchOk = canonicalCid || localOnly ? await _resolvesTrueWithin(mapSaved, 15000) : false;
      }
    }

    state.cmSelectedCourse = course.id;
    state.cmMode = 'edit';
    // A new class has no students yet, so it opens where they are added.
    state.cmTab = 'students';
    state._activeCourse = course.id;
    state._activeCourseChanged = true;
    setActiveCourse(course.id);
    renderClassManager();

    if (!dispatchOk) {
      alert(
        'Class created, but curriculum competencies failed to sync. You can re-add them from the curriculum panel.',
      );
    }
  }

  return {
    configure: configure,
    _cwCourseCounts: _cwCourseCounts,
    _cwRailSync: _cwRailSync,
    cwCompToggle: cwCompToggle,
    cwFindInput: cwFindInput,
    cwFinishCreate: cwFinishCreate,
    cwFolderSet: cwFolderSet,
    cwGoBack: cwGoBack,
    cwGoToStep2: cwGoToStep2,
    cwNameInput: cwNameInput,
    cwOpenRow: cwOpenRow,
    cwSelectGrade: cwSelectGrade,
    cwSpanChanged: cwSpanChanged,
    cwSyncCreate: cwSyncCreate,
    redraw: _cwRedraw,
    cwSkipToCustom: cwSkipToCustom,
    cwToggleCourse: cwToggleCourse,
    cwTogglePreset: cwTogglePreset,
    renderCmCreateForm: renderCmCreateForm,
  };
})();
