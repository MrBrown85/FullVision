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

   An assessment with no rubric of its own prints one too: a Tag Rubric, a
   row per competency it is scored on, or a General Rubric, one Overall row
   when it has none. Their level cells read the teacher's own wording for a
   competency (the descriptor bank) or else the BC proficiency scale's
   general descriptors (GENERAL_LEVELS), never empty boxes.

   Grade math stays in shared/calc.js (getAssessmentOverallScore,
   formatLevel, levelWord). Pure helpers are exposed for tests; the DOM is
   touched only from open() and print(). */
(function () {
  'use strict';

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
      label: 'Full page',
      help: '1 per page',
      orientation: 'portrait',
      margin: 0.25,
      cols: 1,
      rows: 1,
      pageWidth: 8,
      pageHeight: 10.5,
      fontPt: 12.5,
    },
    half: {
      key: 'half',
      label: 'Half sheet',
      help: '2 per landscape page',
      orientation: 'landscape',
      margin: 0.25,
      cols: 2,
      rows: 1,
      pageWidth: 10.5,
      pageHeight: 8,
      fontPt: 10,
    },
    quarter: {
      key: 'quarter',
      label: 'Quarter sheet',
      help: '4 per page',
      orientation: 'portrait',
      margin: 0.25,
      cols: 2,
      rows: 2,
      pageWidth: 8,
      pageHeight: 10.5,
      fontPt: 8,
    },
  };
  var LAYOUT_ORDER = ['full', 'half', 'quarter'];
  var LEVELS = [4, 3, 2, 1];
  var LEVEL_NAMES = { 4: 'Extending', 3: 'Proficient', 2: 'Developing', 1: 'Emerging' };
  var LINE_ROWS = 36; // write-on lines: a full page's height at the line pitch
  // The BC proficiency scale's general descriptors.
  var GENERAL_LEVELS = {
    1: 'The student demonstrates an initial understanding of the concepts and competencies relevant to the expected learning.',
    2: 'The student demonstrates a partial understanding of the concepts and competencies relevant to the expected learning.',
    3: 'The student demonstrates a complete understanding of the concepts and competencies relevant to the expected learning.',
    4: 'The student demonstrates a sophisticated understanding of the concepts and competencies relevant to the expected learning.',
  };

  var DEFAULT_OPTIONS = {
    students: 'scored', // scored | all | pick
    picked: [],
    layout: 'full',
    nameStyle: 'preferred', // preferred | first; the last name always follows
    include: { feedback: true, criterionComments: true, codes: true, overall: true },
  };

  var _state = null; // { cid, aid, opts } while the dialog is open

  /* ── Data ───────────────────────────────────────────────── */

  function _esc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

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
        var own = _ownLevels(tag) || {};
        var levels = {};
        LEVELS.forEach(function (lv) {
          levels[lv] = (own[lv] && String(own[lv]).trim()) || GENERAL_LEVELS[lv];
        });
        return { id: tid, name: tag.label || tag.name || tag.code || '', tagIds: [tid], levels: levels };
      })
      .filter(Boolean);
    return criteria.length ? { id: 'tags', name: 'Tag Rubric', kind: 'tags', criteria: criteria } : null;
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

  /* The feedback printed at the bottom: the assessment comments the teacher
     added from the grid's Comment button, oldest first, then the score
     comment if there is one. */
  function _feedbackText(cid, sid, aid, entries) {
    var parts = [];
    if (typeof getAssignmentObs === 'function') {
      getAssignmentObs(cid, sid, aid)
        .slice()
        .reverse()
        .forEach(function (o) {
          if (o && o.text) parts.push(String(o.text).trim());
        });
    }
    var note = '';
    entries.forEach(function (e) {
      if (e && e.assessmentId === aid && e.note && !note) note = String(e.note).trim();
    });
    if (note && parts.indexOf(note) < 0) parts.push(note);
    return parts.filter(Boolean).join('\n');
  }

  /* The name at the top of a sheet: the preferred name (the first name when
     there is none) or the first name, then always the last name. A
     preferred name that already ends in the last name keeps it once. */
  function printName(student, nameStyle) {
    var first = nameStyle === 'first' ? student.firstName || student.preferred : student.preferred || student.firstName;
    first = String(first || '').trim();
    var last = String(student.lastName || '').trim();
    if (!last) return first || displayName(student);
    var lower = first.toLowerCase();
    if (lower === last.toLowerCase() || lower.slice(-(last.length + 1)) === ' ' + last.toLowerCase()) return first;
    return (first + ' ' + last).trim();
  }

  /* Everything one sheet shows. `scored` is false for a blank rubric.
     `nameStyle` picks the name at the top (printName). */
  function sheetData(cid, aid, sid, nameStyle) {
    var assessment = _assessment(cid, aid);
    var rubric = _rubric(cid, assessment);
    var student = getStudents(cid).find(function (s) {
      return s && s.id === sid;
    });
    if (!assessment || !rubric || !student) return null;
    var entries = (getScores(cid)[sid] || []).filter(function (e) {
      return e && e.assessmentId === aid;
    });
    var status = typeof getAssignmentStatus === 'function' ? getAssignmentStatus(cid, sid, aid) : null;
    var rows = (rubric.criteria || []).map(function (criterion) {
      var lv = criterionLevel(entries, aid, criterion);
      return {
        criterion: criterion,
        level: lv.level,
        mod: lv.mod,
        mixed: lv.mixed,
        // Criterion comments belong to a rubric of the teacher's own.
        comment:
          !rubric.kind && typeof getRubricCriterionComment === 'function'
            ? getRubricCriterionComment(cid, sid, aid, criterion)
            : '',
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
          text: typeof formatLevel === 'function' ? formatLevel(cid, value) : '',
          word: typeof levelWord === 'function' ? levelWord(cid, value) : '',
        };
      }
    }
    return {
      courseName: _courseName(cid),
      assessment: assessment,
      rubric: rubric,
      student: student,
      studentName: printName(student, nameStyle || DEFAULT_OPTIONS.nameStyle),
      date: assessment.date ? formatDate(assessment.date) : '',
      status: status === 'NS' ? 'Not submitted' : status === 'EXC' ? 'Excused' : status === 'LATE' ? 'Late' : '',
      scored: scored,
      rows: rows,
      overall: overall,
      feedback: _feedbackText(cid, sid, aid, entries),
    };
  }

  /* The students to print, in roster order. */
  function selectStudents(cid, aid, opts) {
    var students = getStudents(cid);
    if (opts.students === 'all') return students;
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
    var rubric = _rubric(cid, assessment);
    if (!rubric) return false;
    var entries = getScores(cid)[sid] || [];
    return (rubric.criteria || []).some(function (criterion) {
      return criterionLevel(entries, aid, criterion).level > 0;
    });
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
    return '<span class="rubric-mark" aria-label="' + _esc(LEVEL_NAMES[row.level] || '') + '">' + mark + '</span>';
  }

  function renderSheet(data, opts) {
    var include = opts.include || DEFAULT_OPTIONS.include;
    var html = '<div class="rubric-sheet"><div class="rubric-sheet-inner">';
    html += '<div class="rubric-head"><div class="rubric-head-main">';
    html += '<div class="rubric-student">' + _esc(data.studentName) + '</div>';
    var meta = [data.courseName, data.assessment.title, data.date].filter(Boolean);
    html += '<div class="rubric-meta">' + meta.map(_esc).join(' · ') + '</div>';
    html += '</div>';
    if (include.overall && data.overall) {
      html +=
        '<div class="rubric-overall"><span class="rubric-label">Overall</span><span class="rubric-overall-value">' +
        _esc(data.overall.text) +
        '</span>' +
        (data.overall.word ? '<span class="rubric-overall-word">' + _esc(data.overall.word) + '</span>' : '') +
        '</div>';
    } else if (data.status && data.status !== 'Late') {
      html += '<div class="rubric-overall"><span class="rubric-status">' + _esc(data.status) + '</span></div>';
    }
    html += '</div>';

    html +=
      '<table class="rubric-table"><thead><tr><th class="rubric-crit-head">' +
      _esc(data.rubric.name || 'Criteria') +
      '</th>';
    LEVELS.forEach(function (lv) {
      html += '<th class="rubric-level-head l' + lv + '">' + LEVEL_NAMES[lv] + '</th>';
    });
    html += '</tr></thead><tbody>';
    data.rows.forEach(function (row) {
      var c = row.criterion;
      html +=
        '<tr class="rubric-row"><th class="rubric-crit" scope="row"><div class="rubric-crit-name">' +
        _esc(c.name) +
        '</div>';
      if (include.codes && row.codes.length)
        html += '<div class="rubric-crit-codes">' + _esc(row.codes.join(' · ')) + '</div>';
      html += '</th>';
      LEVELS.forEach(function (lv) {
        var scored = row.level === lv;
        html +=
          '<td class="rubric-cell' +
          (scored ? ' is-scored l' + lv + (row.mixed ? ' is-mixed' : '') : '') +
          '">' +
          (scored ? _markHtml(row) : '') +
          _esc((c.levels && c.levels[lv]) || '') +
          '</td>';
      });
      html += '</tr>';
      if (include.criterionComments && row.comment) {
        html +=
          '<tr class="rubric-comment-row"><td colspan="' +
          (LEVELS.length + 1) +
          '"><span class="rubric-label">Comment</span>' +
          _esc(row.comment) +
          '</td></tr>';
      }
    });
    html += '</tbody></table>';

    if (include.feedback) {
      // Written feedback prints in a box; with none, ruled lines fill the rest
      // of the sheet for the teacher to write on by hand.
      html += data.feedback
        ? '<div class="rubric-feedback"><div class="rubric-label">Feedback</div><div class="rubric-feedback-text">' +
          _esc(data.feedback).replace(/\n/g, '<br>') +
          '</div></div>'
        : '<div class="rubric-feedback is-lines"><div class="rubric-label">Feedback</div><div class="rubric-lines">' +
          // More lines than any sheet holds; the box shows the whole ones
          // that fit. Borders, not a background, so they always print.
          new Array(LINE_ROWS + 1).join('<div class="rubric-line"></div>') +
          '</div></div>';
    }
    html += '</div></div>';
    return html;
  }

  function renderPages(cid, aid, opts) {
    var layout = LAYOUTS[opts.layout] || LAYOUTS.full;
    var perPage = layout.cols * layout.rows;
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

  // Text may shrink this far, in steps, before a sheet counts as overflowing.
  var SHRINK_STEPS = [1, 0.95, 0.9, 0.85, 0.8];

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
     by the same step until all sheets fit, down to SHRINK_STEPS' floor; the
     sheets still too tall are counted so the dialog can warn. */
  function stage(cid, aid, opts) {
    var root = _root();
    var out = renderPages(cid, aid, opts);
    root.innerHTML = out.html;
    root.dataset.layout = opts.layout;
    root.setAttribute('lang', 'en');
    var layout = LAYOUTS[opts.layout] || LAYOUTS.full;
    var pages = root.querySelectorAll ? root.querySelectorAll('.rubric-page') : [];
    var sheets = root.querySelectorAll ? root.querySelectorAll('.rubric-sheet:not(.is-blank)') : [];
    var overflowing = 0;
    var scale = 1;
    for (var s = 0; s < SHRINK_STEPS.length; s++) {
      scale = SHRINK_STEPS[s];
      for (var p = 0; p < pages.length; p++) pages[p].style.fontSize = layout.fontPt * scale + 'pt';
      overflowing = _countOverflowing(sheets);
      if (!overflowing) break;
    }
    out.overflowing = overflowing;
    out.scale = scale;
    return out;
  }

  function _pageStyle(layoutKey) {
    var layout = LAYOUTS[layoutKey] || LAYOUTS.full;
    var size = 'letter ' + layout.orientation;
    var margin = layout.margin + 'in';
    // reports.css sets :left/:right margins for duplex reports; sheets are
    // cut apart, so every page gets the same margin.
    return (
      '@page { size: ' +
      size +
      '; margin: ' +
      margin +
      '; }\n@page :left { margin: ' +
      margin +
      '; }\n@page :right { margin: ' +
      margin +
      '; }'
    );
  }

  function _activatePrintMode(layoutKey) {
    var style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = _pageStyle(layoutKey);
    document.body.classList.add('rubric-print-active');
  }

  function _deactivatePrintMode() {
    document.body.classList.remove('rubric-print-active');
    var style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function print(cid, aid, opts) {
    var out = stage(cid, aid, opts);
    if (!out.sheets) return out;
    _activatePrintMode(opts.layout);
    var finished = false;
    function done() {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', done);
      _deactivatePrintMode();
      var root = document.getElementById(ROOT_ID);
      if (root) root.innerHTML = '';
    }
    window.addEventListener('afterprint', done);
    window.print();
    // Chrome returns from print() when the dialog closes; browsers that
    // return at once fire afterprint later.
    setTimeout(done, 0);
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
      _esc(label) +
      (help ? ' <span class="rp-help">' + _esc(help) + '</span>' : '') +
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
      _esc(label) +
      '</span></label>'
    );
  }

  function _dialogHtml(cid, aid, opts) {
    var assessment = _assessment(cid, aid);
    var rubric = _rubric(cid, assessment);
    var students = getStudents(cid);
    var scoredCount = students.filter(function (s) {
      return isStudentScored(cid, aid, s.id);
    }).length;
    var html = '<div class="confirm-card rubric-print-card">';
    html += '<div class="confirm-title" id="rp-title">Print Rubrics</div>';
    html +=
      '<div class="confirm-message">' +
      _esc(assessment ? assessment.title : '') +
      (rubric ? ' · ' + _esc(rubric.name) : '') +
      '</div>';
    html += '<div class="rp-groups">';
    html += '<fieldset class="rp-group"><legend>Students</legend>';
    html += _radio('rp-students', 'scored', opts.students === 'scored', 'All scored students', '(' + scoredCount + ')');
    html += _radio('rp-students', 'all', opts.students === 'all', 'All students', '(' + students.length + ')');
    html += _radio('rp-students', 'pick', opts.students === 'pick', 'Pick students');
    // Always shown: ticking a name switches to Pick students.
    html += '<div class="rp-pick">';
    students.forEach(function (s) {
      html +=
        '<label class="rp-option rp-pick-option"><input type="checkbox" data-pick="' +
        _esc(s.id) +
        '"' +
        (opts.picked.indexOf(s.id) >= 0 ? ' checked' : '') +
        '><span>' +
        _esc(displayName(s)) +
        (isStudentScored(cid, aid, s.id) ? '' : ' <span class="rp-help">not scored</span>') +
        '</span></label>';
    });
    html += '</div></fieldset>';
    html += '<fieldset class="rp-group"><legend>Layout</legend>';
    LAYOUT_ORDER.forEach(function (key) {
      var layout = LAYOUTS[key];
      html += _radio('rp-layout', key, opts.layout === key, layout.label, layout.help);
    });
    html += '</fieldset>';
    html += '<fieldset class="rp-group"><legend>Name</legend>';
    html += _radio('rp-name', 'preferred', opts.nameStyle !== 'first', 'Preferred Name', '(first name if none)');
    html += _radio('rp-name', 'first', opts.nameStyle === 'first', 'First Name');
    html += '<div class="rp-help">The last name always follows.</div>';
    html += '</fieldset>';
    html += '<fieldset class="rp-group"><legend>Include</legend>';
    html += _check('feedback', opts.include.feedback, 'Feedback comment');
    // A Tag or General Rubric has no criterion comments; a General one no codes.
    if (rubric && !rubric.kind)
      html += _check('criterionComments', opts.include.criterionComments, 'Criterion comments');
    if (!rubric || rubric.kind !== 'general') html += _check('codes', opts.include.codes, 'Competency codes');
    html += _check('overall', opts.include.overall, 'Overall level');
    html += '</fieldset>';
    html += '</div>';
    html += '<div class="rp-status" id="rp-status" aria-live="polite"></div>';
    html +=
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-rp="cancel">Cancel</button>';
    html += '<button type="button" class="confirm-ok primary" data-rp="print">Print</button></div>';
    html += '</div>';
    return html;
  }

  function _statusText(out) {
    if (!out.sheets) return 'No students selected.';
    var sheets = out.sheets === 1 ? '1 sheet' : out.sheets + ' sheets';
    var pages = out.pages === 1 ? '1 page' : out.pages + ' pages';
    var text = sheets + ' on ' + pages + '.';
    if (out.scale < 1) text += ' Text is reduced to ' + Math.round(out.scale * 100) + '% to fit.';
    if (out.overflowing) {
      text +=
        ' ' +
        (out.overflowing === 1 ? '1 sheet does not fit' : out.overflowing + ' sheets do not fit') +
        ' at this size and will be cut off. Try a larger layout or leave something out.';
    }
    return text;
  }

  function _refreshStatus() {
    if (!_state) return;
    var out = stage(_state.cid, _state.aid, _state.opts);
    var status = document.getElementById('rp-status');
    if (status) {
      status.textContent = _statusText(out);
      status.classList.toggle('is-warning', out.overflowing > 0);
    }
    var printBtn = document.querySelector('#' + OVERLAY_ID + ' [data-rp="print"]');
    if (printBtn) printBtn.disabled = !out.sheets;
  }

  function _readOptionsFromDialog(overlay) {
    var opts = _state.opts;
    var studentsRadio = overlay.querySelector('input[name="rp-students"]:checked');
    if (studentsRadio) opts.students = studentsRadio.value;
    var nameRadio = overlay.querySelector('input[name="rp-name"]:checked');
    if (nameRadio) opts.nameStyle = nameRadio.value;
    var layoutRadio = overlay.querySelector('input[name="rp-layout"]:checked');
    if (layoutRadio && LAYOUTS[layoutRadio.value]) opts.layout = layoutRadio.value;
    overlay.querySelectorAll('input[data-include]').forEach(function (box) {
      opts.include[box.dataset.include] = !!box.checked;
    });
    opts.picked = [];
    overlay.querySelectorAll('input[data-pick]:checked').forEach(function (box) {
      opts.picked.push(box.dataset.pick);
    });
  }

  /* A name ticked or unticked. From All or All scored it starts a new pick
     of just that student; under Pick students it adds or removes one. The
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

  /* Open the dialog. With `openOpts.studentId` (the Assignments page is
     grading one student) it starts on that student's rubric, full page;
     otherwise on every student, in the layout last chosen. */
  function open(cid, aid, openOpts) {
    close();
    var assessment = _assessment(cid, aid);
    if (!_rubric(cid, assessment)) return;
    var opts = _loadOptions();
    var userLayout = opts.layout;
    var sid = openOpts && openOpts.studentId;
    var hasStudent =
      sid &&
      getStudents(cid).some(function (s) {
        return s.id === sid;
      });
    if (hasStudent) {
      opts.students = 'pick';
      opts.picked = [sid];
      opts.layout = layoutForCount(1);
    } else {
      opts.students = 'all';
    }
    _state = { cid: cid, aid: aid, opts: opts, userLayout: userLayout, trigger: document.activeElement };
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'confirm-overlay rubric-print-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'rp-title');
    overlay.innerHTML = _dialogHtml(cid, aid, _state.opts);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        close();
        return;
      }
      var btn = e.target.closest ? e.target.closest('[data-rp]') : null;
      if (!btn) return;
      if (btn.dataset.rp === 'cancel') close();
      else if (btn.dataset.rp === 'print') _printFromDialog();
    });
    overlay.addEventListener('change', function (e) {
      var t = e.target;
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
      _saveOptions(_state.opts, _state.userLayout);
      _refreshStatus();
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

  function _printFromDialog() {
    if (!_state) return;
    var cid = _state.cid,
      aid = _state.aid,
      opts = _state.opts;
    close();
    print(cid, aid, opts);
  }

  function close() {
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

  window.RubricPrint = {
    LAYOUTS: LAYOUTS,
    LAYOUT_ORDER: LAYOUT_ORDER,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    criterionLevel: criterionLevel,
    defaultRubric: defaultRubric,
    GENERAL_LEVELS: GENERAL_LEVELS,
    sheetData: sheetData,
    selectStudents: selectStudents,
    isStudentScored: isStudentScored,
    pageCount: pageCount,
    layoutForCount: layoutForCount,
    printName: printName,
    renderSheet: renderSheet,
    renderPages: renderPages,
    stage: stage,
    unstage: function () {
      _deactivatePrintMode();
      var root = document.getElementById(ROOT_ID);
      if (root) root.innerHTML = '';
    },
    activatePrintMode: _activatePrintMode,
    print: print,
    open: open,
    close: close,
    destroy: destroy,
  };
})();
