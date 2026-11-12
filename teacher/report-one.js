/* report-one.js — One Report: a class's progress report as one list of parts.
   The teacher switches parts on and off and puts them in order; the parts
   flow down the page and on to the next, a table carrying on between its
   rows under "(continued)". It replaces the choice between the Quick
   Report and a built (Custom) report (Colin, 2026-11-12; docs/plans/
   one-report-build-plan.md, docs/DECISIONS.md "One Report").

   This file holds the model, the Setups, the readers that turn a class's
   Quick Report choices or built form into a model, and the layout. Every
   part is drawn by the code that draws it today: a block by
   ReportBlocks.renderReportBlock, the Assessments table, the Categories
   summary, the grade line and the Feedback Pages by GradeReport. The cells
   are placed by ReportSheets.pack. Nothing here computes a grade, and
   nothing a teacher leaves off the page changes one.

   The model, saved as reportConfig.one:
     { v, setup, parts: [key], feedback: { rubrics, comments, observations },
       options: { key: { option: value } }, lines: { key: n },
       removed: { key: [rowKey] }, titles: { key: text },
       wording: { key: {…} }, perStudent: { sid: { on, off, removed } } }
   parts is the print order of the parts that are on. A part's key is its
   block's id where a block draws it. removed.assessments and removed.fb
   hold assessment ids; a block's removed rows are the row's name as it
   prints. perStudent holds what was changed for one student only. */
window.ReportOne = (function () {
  'use strict';

  /* One Report is drawn in the set of scores Progress Reports use
     (teacher/report-scores.js): each function named here runs inside
     ReportScores.withReportScores every time it is called. */
  var _inReportScores = function (fn) {
    return ReportScores.scoped('progress', fn);
  };
  partHtml = _inReportScores(partHtml);
  rowsOf = _inReportScores(rowsOf);
  layoutStudent = _inReportScores(layoutStudent);

  function S() {
    return window.ReportSheets;
  }
  function G() {
    return window.GradeReport;
  }
  function _clone(x) {
    return JSON.parse(JSON.stringify(x));
  }
  function _mode(cid) {
    return typeof courseGradeMode === 'function' ? courseGradeMode(cid) : 'proficiency';
  }

  var GROUPS = ['Top of the Page', 'Grades', 'Comments and Student Voice', 'For Home'];

  /* Every part. label: its name in the panel, the heading it prints under
     where it prints one. own: drawn here from GradeReport's pieces, not by
     a block. fixed: options the block always gets in One Report. title: the
     heading it prints under when that is not the block's own. split: how
     the part is cut between pages ('gr' rows of the Assessments table,
     'table' rows of the block's one table, 'grades' Assignment Grades).
     rows: the selector of a row a teacher can remove and of its name. */
  var PARTS = {
    header: { label: 'Letterhead', group: 0, locked: true },
    proficiency: {
      label: 'Proficiency',
      group: 1,
      fixed: { family: true },
      split: 'table',
      rows: {
        sel: 'table.report-prof tbody tr:not(.report-ct-group):not(.report-prof-overall)',
        name: '.report-ct-name',
      },
    },
    legend: { label: 'Proficiency Legend', group: 1, fixed: { descriptors: true }, notIn: ['letter'] },
    assessments: {
      label: 'Assessments',
      group: 1,
      own: true,
      split: 'gr',
      options: [
        { key: 'ungraded', label: 'Work Not Yet Assessed', def: true },
        { key: 'numbers', label: 'Numbers', def: false },
        { key: 'date', label: 'Date', def: true },
        { key: 'category', label: 'Category', def: true },
        {
          key: 'order',
          label: 'Order',
          def: 'oldest',
          choices: [
            { v: 'oldest', label: 'Oldest First' },
            { v: 'newest', label: 'Newest First' },
          ],
        },
      ],
    },
    'category-summary': { label: 'Categories', group: 1, own: true },
    'course-grade': {
      label: 'Overall Proficiency',
      labelIn: { letter: 'Course Grade', both: 'Course Grade' },
      group: 1,
      own: true,
    },
    'grade-table': { label: 'Assignment Grades', group: 1, split: 'grades' },
    'missing-work': { label: 'Missing Work', group: 1, half: true },
    'term-attendance': { label: 'Attendance', group: 1, half: true },
    progress: { label: 'Progress in One Area', group: 1 },
    'next-steps': { label: 'Next Steps', group: 2 },
    'teacher-narrative': { label: 'Teacher Comment', group: 2 },
    // The student's own words, or a blank form the student fills in. The
    // teacher never rates a Core Competency (Colin, 2026-11-12).
    'self-assessment': {
      label: 'Core Competency Self-Assessment',
      group: 2,
      title: 'Core Competency Self-Assessment',
      fixed: { strength: false },
      hide: ['strength', 'core'],
      options: [
        {
          key: 'blank',
          label: 'Print',
          def: false,
          choices: [
            { v: false, label: 'Student’s Words' },
            { v: true, label: 'Blank to Fill In' },
          ],
        },
      ],
    },
    'learner-dimensions': {
      label: 'Work Habits',
      group: 2,
      title: 'Work Habits',
      rows: { sel: '.report-disp-row', name: 'span' },
    },
    'student-reflection-learning': { label: 'Reflection: My Learning', group: 2, wording: true },
    'student-reflection-habits': { label: 'Reflection: My Habits', group: 2, wording: true, split: 'table' },
    'support-home': { label: 'Ways to Support at Home', group: 3 },
    'text-block': { label: 'Your Own Text', group: 3 },
    'parent-response': { label: 'Parent / Guardian Response', group: 3, pinned: true, wording: true },
  };
  var ORDER = Object.keys(PARTS);
  var PINNED = 'parent-response';
  var FEEDBACK = [
    { key: 'fb-rubrics', opt: 'rubrics', label: 'Rubrics' },
    { key: 'fb-comments', opt: 'comments', label: 'Assessment Comments' },
    { key: 'fb-observations', opt: 'observations', label: 'Observations' },
  ];

  var SETUPS = [
    {
      id: 'grades',
      name: 'Grades',
      blurb: 'Assessments, categories and feedback pages',
      parts: ['header', 'assessments', 'category-summary', 'course-grade', 'missing-work'],
      feedback: { rubrics: true, comments: true, observations: false },
    },
    {
      id: 'report-card',
      name: 'Report Card',
      blurb: 'Proficiency, comment, self-assessment, response',
      parts: [
        'header',
        'proficiency',
        'legend',
        'teacher-narrative',
        'self-assessment',
        'term-attendance',
        'missing-work',
        'assessments',
        'parent-response',
      ],
      feedback: { rubrics: true, comments: true, observations: false },
    },
    {
      id: 'interim-update',
      name: 'Interim Update',
      blurb: 'Proficiency, comment and attendance, one side',
      parts: ['header', 'proficiency', 'teacher-narrative', 'term-attendance', 'legend'],
      feedback: { rubrics: false, comments: false, observations: false },
    },
    {
      id: 'conference-pack',
      name: 'Conference Pack',
      blurb: 'Adds next steps and work habits',
      parts: [
        'header',
        'proficiency',
        'legend',
        'teacher-narrative',
        'self-assessment',
        'next-steps',
        'learner-dimensions',
        'assessments',
        'parent-response',
      ],
      feedback: { rubrics: true, comments: true, observations: false },
    },
  ];

  /* ── The model ──────────────────────────────────────────────── */

  /* A part the registry or the form engine knows. A block retired from the
     old palette is still a part of a report that was built with it. */
  function _def(key) {
    if (PARTS[key]) return PARTS[key];
    var b = S() && S().BLOCKS[key];
    return b ? { label: b.label, group: 1, legacy: true } : null;
  }
  function _blockOf(key) {
    var d = _def(key);
    return d && !d.own && S().BLOCKS[key] ? S().BLOCKS[key] : null;
  }

  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var seen = {};
    var parts = (Array.isArray(raw.parts) ? raw.parts : []).filter(function (k) {
      if (typeof k !== 'string' || seen[k] || !_def(k)) return false;
      seen[k] = true;
      return true;
    });
    // The letterhead is always on, and first.
    parts = ['header'].concat(
      parts.filter(function (k) {
        return k !== 'header';
      }),
    );
    var obj = function (x) {
      return x && typeof x === 'object' && !Array.isArray(x) ? _clone(x) : {};
    };
    var fb = obj(raw.feedback);
    var per = obj(raw.perStudent);
    Object.keys(per).forEach(function (sid) {
      var p = obj(per[sid]);
      per[sid] = {
        on: Array.isArray(p.on) ? p.on.filter(_def) : [],
        off: Array.isArray(p.off) ? p.off.filter(_def) : [],
        removed: obj(p.removed),
      };
      if (!per[sid].on.length && !per[sid].off.length && !Object.keys(per[sid].removed).length) delete per[sid];
    });
    return {
      v: 1,
      setup: typeof raw.setup === 'string' ? raw.setup : '',
      parts: parts,
      feedback: { rubrics: !!fb.rubrics, comments: !!fb.comments, observations: !!fb.observations },
      options: obj(raw.options),
      lines: obj(raw.lines),
      removed: obj(raw.removed),
      titles: obj(raw.titles),
      wording: obj(raw.wording),
      perStudent: per,
    };
  }

  function setup(id) {
    return SETUPS.filter(function (s) {
      return s.id === id;
    })[0];
  }
  function fromSetup(id) {
    var s = setup(id) || setup('report-card');
    return normalize({ setup: s.id, parts: s.parts, feedback: s.feedback });
  }

  /* A class's Quick Report choices (reportConfig.gradeReport) as a model. */
  function fromGrade(saved) {
    var o = G().options(saved);
    var parts = ['header', 'assessments'];
    if (o.summary) parts.push('category-summary');
    parts.push('course-grade', 'missing-work');
    if (o.feedback && o.termComment) parts.push('teacher-narrative');
    return normalize({
      setup: 'grades',
      parts: parts,
      feedback: {
        rubrics: o.feedback && o.rubrics,
        comments: o.feedback && o.comments,
        observations: o.feedback && o.observations,
      },
      options: {
        header: { name: o.name },
        assessments: { ungraded: o.ungraded, numbers: o.numbers, order: o.order },
      },
    });
  }

  /* A built form (ReportSheets, v6) as a model: its blocks in the order
     they print, side by side, row by row, with their options, lines and
     the blocks left off one student. The form itself is not changed. */
  function fromForm(form) {
    var f = S().normalizeForm(form);
    var parts = [];
    var options = {};
    var lines = {};
    f.sides.forEach(function (sd) {
      sd.rows.forEach(function (row) {
        row.cells.forEach(function (c) {
          parts.push(c.block);
          var o = Object.assign({}, c.options || {});
          if (c.noEvidence) o.noEvidence = c.noEvidence;
          if (Object.keys(o).length) options[c.block] = o;
          if (c.lines != null) lines[c.block] = c.lines;
        });
      });
    });
    // The docked block prints last.
    if (f.pinned && parts.indexOf(f.pinned) >= 0) {
      parts = parts
        .filter(function (k) {
          return k !== f.pinned;
        })
        .concat([f.pinned]);
    }
    var per = {};
    Object.keys(f.perStudent || {}).forEach(function (sid) {
      var off = S().hiddenFor(f, sid);
      if (off.length) per[sid] = { off: off.slice() };
    });
    return normalize({ setup: f.id || '', parts: parts, options: options, lines: lines, perStudent: per });
  }

  /* The class's model: the one it saved, else what it has today read as
     one (a built form for a class on Build Your Own, else its Quick Report
     choices). */
  function modelFor(reportConfig) {
    var rc = reportConfig || {};
    if (rc.one && typeof rc.one === 'object') return normalize(rc.one);
    if (rc.progressMode === 'build' && rc.form) return fromForm(rc.form);
    if (rc.progressMode !== 'grade' && rc.form && !rc.gradeReport) return fromForm(rc.form);
    return fromGrade(rc.gradeReport);
  }

  /* ── Reading the model ──────────────────────────────────────── */

  function _per(m, sid) {
    return (sid && m.perStudent[sid]) || null;
  }
  function available(key, cid) {
    var d = _def(key);
    return !!d && !(d.notIn && d.notIn.indexOf(_mode(cid)) >= 0);
  }
  /* Is the part on: for the class, or with sid for that student. */
  function isOn(m, key, sid) {
    var fb = _fb(key);
    if (fb) return !!m.feedback[fb.opt];
    var p = _per(m, sid);
    if (p && p.off.indexOf(key) >= 0) return false;
    if (p && p.on.indexOf(key) >= 0) return true;
    return m.parts.indexOf(key) >= 0;
  }
  function _fb(key) {
    return FEEDBACK.filter(function (f) {
      return f.key === key;
    })[0];
  }
  /* Where a part switched on goes: after the last part that comes before
     it in the registry's order. */
  function _insert(list, key) {
    var idx = ORDER.indexOf(key);
    if (idx < 0) idx = ORDER.length;
    var at = 0;
    list.forEach(function (k, i) {
      var j = ORDER.indexOf(k);
      if (j >= 0 && j < idx) at = i + 1;
    });
    list.splice(at, 0, key);
  }
  /* The parts that print for the class or for one student, in order. The
     docked response is last. */
  function order(m, sid) {
    var p = _per(m, sid);
    var list = m.parts.filter(function (k) {
      return !(p && p.off.indexOf(k) >= 0);
    });
    if (p)
      p.on.forEach(function (k) {
        if (list.indexOf(k) < 0) _insert(list, k);
      });
    if (list.indexOf(PINNED) >= 0)
      list = list
        .filter(function (k) {
          return k !== PINNED;
        })
        .concat([PINNED]);
    return list;
  }
  /* The parts not on the report, by group, for Add a Part. */
  function offParts(m, cid, sid) {
    var on = order(m, sid);
    return ORDER.filter(function (k) {
      return on.indexOf(k) < 0 && available(k, cid);
    });
  }
  function label(key, cid) {
    var fb = _fb(key);
    if (fb) return fb.label;
    var d = _def(key);
    if (!d) return key;
    return (d.labelIn && d.labelIn[_mode(cid)]) || d.label;
  }
  /* What was changed for one student only, counted. */
  function exceptions(m, sid) {
    var p = _per(m, sid);
    if (!p) return 0;
    return (
      p.on.length +
      p.off.length +
      Object.keys(p.removed).reduce(function (n, k) {
        return n + p.removed[k].length;
      }, 0)
    );
  }
  /* The rows left off a part: the class's, and with sid that student's too. */
  function removedOf(m, key, sid) {
    var out = (m.removed[key] || []).slice();
    var p = _per(m, sid);
    if (p && p.removed[key])
      p.removed[key].forEach(function (r) {
        if (out.indexOf(r) < 0) out.push(r);
      });
    return out;
  }
  function wordingOf(m, key) {
    if (m.wording[key]) return _clone(m.wording[key]);
    return window.ReportBlocks && ReportBlocks.wordingOf ? ReportBlocks.wordingOf(key) : null;
  }

  /* A part's choices for the panel, with the class's values: [{ key, label,
     kind: 'toggle' | 'choice' | 'text' | 'lines', value, choices? }]. A
     block's come from the form engine's registry; an option another class
     style hides is left out. */
  function optionsFor(m, key, cid) {
    var d = _def(key);
    if (!d) return [];
    var mode = _mode(cid);
    var saved = m.options[key] || {};
    var b = _blockOf(key);
    var defs = (b && b.options ? b.options : [])
      .filter(function (o) {
        if (d.hide && d.hide.indexOf(o.key) >= 0) return false;
        if (o.hideIn && o.hideIn.indexOf(mode) >= 0) return false;
        if (o.showIf && (saved[o.showIf.key] != null ? saved[o.showIf.key] : _defOf(b, o.showIf.key)) !== o.showIf.v)
          return false;
        // Overall prints once: on its own line when that part is on.
        if (key === 'proficiency' && o.key === 'overall' && isOn(m, 'course-grade')) return false;
        return true;
      })
      .concat(d.options || []);
    var out = defs.map(function (o) {
      var def = o.def === 'auto' ? _auto(key, o.key, cid) : o.def;
      var value = saved[o.key] != null ? saved[o.key] : def;
      var name = (o.labelIn && o.labelIn[mode]) || o.label;
      if (o.choices)
        return {
          key: o.key,
          label: name,
          kind: 'choice',
          value: value,
          choices: o.choices.map(function (c) {
            return typeof c === 'object' ? c : { v: c, label: String(c) };
          }),
        };
      if (o.text) return { key: o.key, label: name, kind: 'text', value: value || '' };
      return { key: o.key, label: name, kind: 'toggle', value: !!value };
    });
    if (b && b.fill && b.lines)
      out.push({
        key: 'lines',
        label: b.linesLabel || 'Lines When Empty',
        kind: 'lines',
        value: m.lines[key] != null ? m.lines[key] : b.lines,
        min: b.minLines,
        max: b.maxLines,
      });
    if (key === 'text-block') {
      out.push({ key: 'title', label: 'Heading', kind: 'text', value: saved.title || '' });
      out.push({ key: 'text', label: 'Text', kind: 'text', long: true, value: saved.text || '' });
    }
    return out;
  }
  function _defOf(b, optKey) {
    var o = (b.options || []).filter(function (x) {
      return x.key === optKey;
    })[0];
    return o ? o.def : undefined;
  }
  /* An option the class's grading style decides until the teacher does. */
  function _auto(key, optKey, cid) {
    var show = window.ReportBlocks && ReportBlocks.showDefaults ? ReportBlocks.showDefaults(cid) : null;
    return show && optKey in show ? show[optKey] : false;
  }

  /* ── Changing the model (each returns a new model) ──────────── */

  function _edit(m, fn) {
    var next = _clone(m);
    fn(next);
    return normalize(next);
  }
  function _perOf(next, sid) {
    if (!next.perStudent[sid]) next.perStudent[sid] = { on: [], off: [], removed: {} };
    return next.perStudent[sid];
  }
  function _without(list, k) {
    return list.filter(function (x) {
      return x !== k;
    });
  }
  /* Switches a part on or off: for the class, or with sid for that student
     only (kept as a difference from the class). */
  function setOn(m, key, on, sid) {
    var d = _def(key);
    var fb = _fb(key);
    if (!d && !fb) return m;
    if (d && d.locked) return m;
    return _edit(m, function (next) {
      if (fb) {
        next.feedback[fb.opt] = !!on;
        return;
      }
      if (sid) {
        var p = _perOf(next, sid);
        p.on = _without(p.on, key);
        p.off = _without(p.off, key);
        var classOn = next.parts.indexOf(key) >= 0;
        if (on && !classOn) p.on.push(key);
        if (!on && classOn) p.off.push(key);
        return;
      }
      next.parts = _without(next.parts, key);
      if (on) _insert(next.parts, key);
      next.setup = '';
    });
  }
  /* Moves a part to position `to` among the parts on the report. The
     letterhead stays first and the response last. */
  function move(m, key, to) {
    if (key === 'header' || key === PINNED || m.parts.indexOf(key) < 0) return m;
    return _edit(m, function (next) {
      var list = _without(next.parts, key);
      var lo = 1;
      var hi = list.indexOf(PINNED) >= 0 ? list.indexOf(PINNED) : list.length;
      list.splice(Math.max(lo, Math.min(hi, to)), 0, key);
      next.parts = list;
      next.setup = '';
    });
  }
  function setOption(m, key, optKey, value) {
    return _edit(m, function (next) {
      if (optKey === 'lines') {
        next.lines[key] = Number(value) || 0;
        return;
      }
      if (!next.options[key]) next.options[key] = {};
      next.options[key][optKey] = value;
    });
  }
  /* Leaves a row off a part, or puts it back: for the class, or with sid
     for that student only. */
  function setRemoved(m, key, rowKey, removed, sid) {
    return _edit(m, function (next) {
      var bag = sid ? _perOf(next, sid).removed : next.removed;
      var list = _without(bag[key] || [], rowKey);
      if (removed) list.push(rowKey);
      if (list.length) bag[key] = list;
      else delete bag[key];
      // Putting a row back for the class puts it back for a student who
      // had it off only because the class did; a student's own stays.
    });
  }
  /* Sets which rows are left off a part, all at once (the class's). */
  function setRemovedAll(m, key, rowKeys, sid) {
    return _edit(m, function (next) {
      var bag = sid ? _perOf(next, sid).removed : next.removed;
      if (rowKeys && rowKeys.length) bag[key] = rowKeys.slice();
      else delete bag[key];
    });
  }
  function setTitle(m, key, text) {
    return _edit(m, function (next) {
      var t = String(text || '').trim();
      if (t && t !== _defaultTitle(key)) next.titles[key] = t;
      else delete next.titles[key];
    });
  }
  /* The class's wording for a reflection or the response; null puts the
     original back. */
  function setWording(m, key, wording) {
    return _edit(m, function (next) {
      if (wording) next.wording[key] = wording;
      else delete next.wording[key];
    });
  }
  function clearStudent(m, sid) {
    return _edit(m, function (next) {
      delete next.perStudent[sid];
    });
  }
  function _defaultTitle(key) {
    var d = _def(key);
    return (d && d.title) || '';
  }

  /* ── Drawing a part ─────────────────────────────────────────── */

  function _text(el) {
    return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  }
  /* A row's name as it prints: its first cell, without the small count a
     folder's row carries. */
  function _rowName(row, nameSel) {
    var el = row.querySelector(nameSel) || row.firstElementChild || row;
    var copy = el.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll('.report-prof-count'), function (x) {
      x.remove();
    });
    return _text(copy);
  }
  function _titleEl(root) {
    return root.querySelector('.report-block-title') || root.querySelector('.report-strip-head b');
  }

  /* The options a block gets: the class's, the registry's fixed ones, its
     lines and its wording. */
  function _cellOf(m, key) {
    var d = _def(key);
    var o = Object.assign({}, m.options[key] || {}, d.fixed || {});
    var noEvidence = o.noEvidence;
    delete o.noEvidence;
    if (key === 'proficiency' && isOn(m, 'course-grade')) o.overall = false;
    if (d.wording && m.wording[key]) o.wording = m.wording[key];
    var cell = { block: key, size: 'row', options: o };
    if (noEvidence) cell.noEvidence = noEvidence;
    if (m.lines[key] != null) cell.lines = m.lines[key];
    return cell;
  }

  /* One part's HTML for one student, '' when it prints nothing. Rows the
     teacher left off are taken out, each row that can be is named
     (data-row), and the heading is the class's. */
  function partHtml(m, key, cid, student, ctx, stage) {
    var d = _def(key);
    if (!d) return '';
    var sid = student.id;
    var html = '';
    if (key === 'assessments') {
      var part = G().listPart(cid, student, _listOpts(m, sid), stage);
      html = part.html
        ? '<div class="one-part one-assessments"><div class="report-block-title">Assessments</div>' +
          part.html +
          '</div>'
        : '';
    } else if (key === 'category-summary') {
      var sum = G().summaryHtml(cid, student, _listOpts(m, sid), stage);
      html = sum ? '<div class="one-part one-summary">' + sum + '</div>' : '';
    } else if (key === 'course-grade') {
      html = '<div class="one-part one-grade">' + G().termHtml(cid, student, ctx) + '</div>';
    } else {
      html = S().one.cellHtml(_cellOf(m, key), cid, student, ctx) || '';
    }
    if (!html) return '';
    var title = m.titles[key] || d.title || '';
    var gone = d.rows ? removedOf(m, key, sid) : [];
    if (!title && !d.rows) return html;
    var tpl = document.createElement('div');
    // html-safe: html is this part's own render above (a ReportBlocks block or GradeReport's table, both escaped), parsed in a detached div
    tpl.innerHTML = html;
    if (title) {
      var t = key === 'course-grade' ? tpl.querySelector('.gr-term span') : _titleEl(tpl);
      if (t) t.textContent = title;
    }
    if (d.rows) {
      Array.prototype.forEach.call(tpl.querySelectorAll(d.rows.sel), function (row) {
        var name = _rowName(row, d.rows.name);
        if (gone.indexOf(name) >= 0) row.remove();
        else row.setAttribute('data-row', name);
      });
    }
    return tpl.innerHTML;
  }

  /* The Assessments part's choices as GradeReport reads them, with the
     assessments left off the list. */
  function _listOpts(m, sid) {
    var o = Object.assign(
      { ungraded: true, numbers: false, order: 'oldest', date: true, category: true },
      m.options.assessments || {},
    );
    var omit = {};
    removedOf(m, 'assessments', sid).forEach(function (id) {
      omit[id] = true;
    });
    var hide = {};
    if (o.date === false) hide.date = true;
    if (o.category === false) hide.category = true;
    return {
      summary: true,
      ungraded: o.ungraded !== false,
      numbers: !!o.numbers,
      order: o.order === 'newest' ? 'newest' : 'oldest',
      name: (m.options.header || {}).name === 'first' ? 'first' : 'preferred',
      omit: omit,
      hide: hide,
    };
  }

  /* The rows a teacher can leave off a part, for one student, whether or
     not they are off now: [{ key, label, sub?, result?, removed }]. For the
     Assessments part, every assessment the list can show. */
  function rowsOf(m, key, cid, student, ctx) {
    var d = _def(key);
    if (!d) return [];
    var gone = removedOf(m, key, student.id);
    if (key === 'assessments') {
      var o = _listOpts(m, student.id);
      o.omit = {};
      return G()
        .rows(cid, student, o)
        .map(function (r) {
          return {
            key: r.id,
            label: r.title,
            sub: [r.date, r.category].filter(Boolean).join(' · '),
            result: G().resultText(r) || (r.score ? r.score : ''),
            missing: r.note === 'Missing',
            removed: gone.indexOf(r.id) >= 0,
          };
        });
    }
    if (!d.rows) return [];
    var bare = _clone(m);
    delete bare.removed[key];
    if (bare.perStudent[student.id]) delete bare.perStudent[student.id].removed[key];
    var stage = document.createElement('div');
    // html-safe: partHtml's own render, parsed in a detached div to read its rows' names
    stage.innerHTML = partHtml(bare, key, cid, student, ctx, null);
    return Array.prototype.map.call(stage.querySelectorAll('[data-row]'), function (row) {
      var name = row.getAttribute('data-row');
      return { key: name, label: name, removed: gone.indexOf(name) >= 0 };
    });
  }

  /* ── The layout ─────────────────────────────────────────────── */

  var SPLIT_SEL = {
    gr: '.gr-table > .gr-row:not(.gr-head)',
    table: 'table > tbody > tr',
  };

  /* Each cell at its width in the stage: px, and for a part that can be
     cut between its rows, each row's height and the rest (chrome). */
  function _measure(stage, cells) {
    // html-safe: each c.html is partHtml's render (escaped blocks and tables); keys are registry keys; widths are numbers
    stage.innerHTML = cells
      .map(function (c) {
        return _cellTag(c.key, c.size, c.html, 0);
      })
      .join('');
    Array.prototype.forEach.call(stage.children, function (el, i) {
      var c = cells[i];
      c.px = el.offsetHeight;
      var split = (_def(c.key) || {}).split;
      if (!split || c.size === 'half') return;
      if (split === 'grades') {
        c.cell = { block: c.key };
        S().one.measureGradeRows(el, c);
        return;
      }
      // One table only: a block that lays its rows out in two tables is
      // not cut.
      if (split === 'table' && el.querySelectorAll('table').length !== 1) return;
      var rows = el.querySelectorAll(SPLIT_SEL[split]);
      if (rows.length < 2) return;
      var tops = Array.prototype.map.call(rows, function (r) {
        return r.getBoundingClientRect().top;
      });
      var bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
      c.rows = tops.map(function (t, j) {
        return (j + 1 < tops.length ? tops[j + 1] : bottom) - t;
      });
      c.chrome = Math.max(0, c.px - (bottom - tops[0]));
    });
  }

  /* A part with only rows [start, end); a later piece's heading ends
     "(continued)". */
  function _pieceHtml(key, html, part) {
    var split = (_def(key) || {}).split;
    if (split === 'grades') return S().one.gradesPartHtml(html, part.start, part.end);
    var tpl = document.createElement('div');
    // html-safe: html is this part's own render (partHtml), parsed in a detached div
    tpl.innerHTML = html;
    Array.prototype.forEach.call(tpl.querySelectorAll(SPLIT_SEL[split] || 'table > tbody > tr'), function (r, i) {
      if (i < part.start || i >= part.end) r.remove();
    });
    if (part.start > 0) {
      var t = _titleEl(tpl);
      if (t) t.textContent = t.textContent.replace(/\s*\(continued\)$/, '') + ' (continued)';
    }
    return tpl.innerHTML;
  }

  function _cellTag(key, size, html, minH) {
    var b = _blockOf(key);
    return (
      '<div class="sheet-cell' +
      (b && b.fill ? ' sheet-fill' : '') +
      '" data-block="' +
      esc(key) +
      '" data-part="' +
      esc(key) +
      '" data-size="' +
      size +
      '" style="width:' +
      S().cellWidth(size) +
      'px;min-height:' +
      minH +
      'px">' +
      html +
      '</div>'
    );
  }
  function _rowTag(row, htmlOf, extra) {
    return (
      '<div class="sheet-row' +
      (extra || '') +
      (row.carried ? ' sheet-row-carried' : '') +
      '" style="min-height:' +
      row.h +
      'px">' +
      row.cells
        .map(function (c) {
          var html = htmlOf[c.id] || '';
          if (c.part) html = _pieceHtml(c.id, html, c.part);
          return _cellTag(c.id, c.size, html, row.h);
        })
        .join('') +
      '</div>'
    );
  }

  /* What a side is called above it on screen. */
  function _sideLabel(i, sheets, what) {
    var side = i % 2 ? 'Back' : 'Front';
    return (sheets > 1 ? 'Sheet ' + (Math.floor(i / 2) + 1) + ' · ' : '') + side + (what ? ' · ' + what : '');
  }

  /* Lays one student's report out. opts: { paper, stage }. Returns what
     ReportSheets.layoutStudent returns (the preview, the fit line, Everyone,
     Print Reports and the printed copies read it), plus cards and
     feedbackSides, and parts: the keys that printed something. */
  function layoutStudent(m, cid, student, ctx, opts) {
    opts = opts || {};
    var sheetsApi = S();
    var paper = sheetsApi.one.PAPER[opts.paper] ? opts.paper : 'letter';
    var H = sheetsApi.sideHeight(paper);
    var GAP = sheetsApi.GAP;
    var stage = opts.stage;
    var sid = student.id;
    var keys = order(m, sid).filter(function (k) {
      return available(k, cid);
    });
    var htmlOf = {};
    var cells = [];
    keys.forEach(function (k) {
      var html = partHtml(m, k, cid, student, ctx, stage);
      htmlOf[k] = html;
      if (html) cells.push({ key: k, size: 'row', html: html });
    });
    // Attendance and Missing Work sit side by side when they are next to
    // each other and both print.
    var rows = [];
    var body = cells.filter(function (c) {
      return c.key !== PINNED;
    });
    for (var i = 0; i < body.length; i++) {
      var a = body[i];
      var b = body[i + 1];
      if (b && (_def(a.key) || {}).half && (_def(b.key) || {}).half) {
        a.size = b.size = 'half';
        rows.push([a, b]);
        i++;
      } else rows.push([a]);
    }
    var slip = cells.filter(function (c) {
      return c.key === PINNED;
    })[0];
    _measure(stage, cells);
    var headLine = ReportBlocks.renderContinuedLine(cid, student, sheetsApi.optionsFor(_cellOf(m, 'header')));
    // html-safe: headLine is ReportBlocks.renderContinuedLine, its text esc()'d
    stage.innerHTML = headLine;
    var headPx = stage.firstChild ? stage.firstChild.offsetHeight : 0;
    var packRows = [
      rows.map(function (row) {
        return row.map(function (c) {
          return { id: c.key, size: c.size, px: c.px, rows: c.rows, chrome: c.chrome };
        });
      }),
    ];
    var run = function (caps) {
      return sheetsApi.pack(packRows, { H: H, gap: GAP, head: headPx, caps: caps });
    };
    var r = run(null);
    var sides = r.sides;
    // The response slip docks at the foot of the last side of the report.
    // When that side is a back, the foot of the front before it is kept
    // blank, so tearing the slip off takes nothing from the report.
    var slipAt = -1;
    var reserve = {};
    if (slip) {
      var ph = Math.min(slip.px, H - headPx - GAP);
      var where = function (list) {
        var n = list.length;
        while (n > 0 && list[n - 1].kind === 'after') n--;
        if (!n) return 0;
        var last = list[n - 1];
        var bottom = last.rows.reduce(
          function (y, row) {
            return Math.max(y, row.y + row.h);
          },
          last.head ? headPx : 0,
        );
        return bottom + GAP + ph <= H ? n - 1 : n;
      };
      slipAt = where(sides);
      if (slipAt % 2 === 1) {
        var caps = {};
        caps[slipAt - 1] = ph + GAP;
        var capped = run(caps);
        if (where(capped.sides) === slipAt) {
          r = capped;
          sides = r.sides;
          reserve[slipAt - 1] = ph;
        } else {
          // Keeping the front clear moved the slip: it starts the next sheet.
          slipAt = where(sides);
          slipAt += slipAt % 2;
        }
      }
      var afters = sides.filter(function (sd) {
        return sd.kind === 'after';
      });
      sides = sides.filter(function (sd) {
        return sd.kind !== 'after';
      });
      while (sides.length <= slipAt) sides.push({ rows: [], kind: 'continued', from: 0, head: sides.length > 0 });
      sides[slipAt].pinned = { id: PINNED, size: 'row', h: ph, y: H - ph };
      sides = sides.concat(afters);
    }
    sides.forEach(function (sd) {
      sd.over = sd.rows.some(function (row) {
        return row.y + row.h > H;
      });
    });
    // Feedback Pages, after the report.
    var fb = null;
    if (m.feedback.rubrics || m.feedback.comments || m.feedback.observations) {
      var lo = _listOpts(m, sid);
      removedOf(m, 'fb', sid).forEach(function (id) {
        lo.omit[id] = true;
      });
      fb = G().feedbackPages(
        cid,
        student,
        ctx,
        {
          rubrics: m.feedback.rubrics,
          comments: m.feedback.comments,
          observations: m.feedback.observations,
          termComment: false,
          numbers: false,
          order: lo.order,
          name: lo.name,
          omit: lo.omit,
        },
        [],
        stage,
        H,
      );
    }
    var bodySides = sides.length;
    var fbBodies = fb ? fb.body(bodySides + 1, bodySides + fb.count) : [];
    var sideCount = bodySides + fbBodies.length;
    var sheetCount = Math.max(1, Math.ceil(sideCount / 2));
    var comment = cells.filter(function (c) {
      return c.key === 'teacher-narrative';
    })[0];
    var noComment = !!comment && /report-ruled-empty/.test(comment.html);
    var noAttendance = keys.indexOf('term-attendance') >= 0 && !htmlOf['term-attendance'];
    var over = r.over || !!(fb && fb.over);
    var badge = over
      ? 'Too long'
      : noComment && sheetCount === 1
        ? 'No comment'
        : sheetCount === 1
          ? '1 sheet'
          : sheetCount + ' sheets';
    var html =
      '<div class="sheet-student one-student" data-action="fitMapPick" data-sid="' +
      esc(sid) +
      '" data-sheets="' +
      sheetCount +
      '" data-continued="' +
      r.continued.length +
      '" data-after="' +
      r.after.length +
      '"><div class="sheet-student-head no-print"><span class="sheet-student-name">' +
      esc(fullName(student)) +
      '</span><span class="sheet-badge ' +
      (over || sheetCount > 1 ? 'over' : noComment ? 'none' : 'ok') +
      '">' +
      badge +
      '</span></div>';
    for (var s = 0; s < sheetCount * 2; s++) {
      var side = sides[s] || null;
      var fbHtml = s >= bodySides ? fbBodies[s - bodySides] : null;
      html += '<div class="sheet-zoom" data-side="' + s + '"><div class="sheet-label no-print">';
      if (fbHtml) {
        html += _sideLabel(s, sheetCount, 'Feedback') + '</div>' + G().sideHtml(fbHtml, paper, 'side', s, 'fb-sheet');
      } else if (side) {
        var prints =
          side.pinned ||
          side.rows.some(function (row) {
            return !row.empty;
          });
        html +=
          _sideLabel(s, sheetCount, side.kind === 'after' ? 'After the Report' : '') +
          '</div><div class="report-sheet one-sheet' +
          (side.over ? ' sheet-overflow' : '') +
          '" data-paper="' +
          paper +
          '" data-kind="' +
          side.kind +
          '"><div class="sheet-body">' +
          (side.head && prints ? headLine : '') +
          side.rows
            .map(function (row) {
              return _rowTag(row, htmlOf, '');
            })
            .join('') +
          (reserve[s]
            ? '<div class="one-reserve no-print" style="height:' +
              reserve[s] +
              'px">Kept blank: the back of the response slip</div>'
            : '') +
          (side.pinned
            ? _rowTag(
                { h: side.pinned.h, cells: [{ id: PINNED, size: 'row', h: side.pinned.h }] },
                htmlOf,
                ' sheet-pinned',
              )
            : '') +
          '</div></div>';
      } else {
        html +=
          'Blank</div><div class="report-sheet sheet-blank-side" data-paper="' +
          paper +
          '"><div class="sheet-body"><div class="sheet-blank">This side is left blank.</div></div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return {
      html: html,
      sheets: sheetCount,
      sides: sideCount,
      continued: r.continued,
      after: r.after.map(function (k) {
        return label(k, cid);
      }),
      over: over,
      feedbackOver: !!(fb && fb.over),
      used: cells.reduce(function (n, c) {
        return n + (c.px || 0);
      }, 0),
      free: [],
      commentLines: 0,
      room: 0,
      noComment: noComment,
      noAttendance: noAttendance,
      badge: badge,
      cards: fb ? fb.cards : 0,
      feedbackSides: fbBodies.length,
      parts: cells.map(function (c) {
        return c.key;
      }),
    };
  }

  /* A layout function for ReportSheets.renderPreview and classSummary. */
  function layoutWith(m) {
    var model = normalize(m);
    return function (cid, student, ctx, opts) {
      return layoutStudent(model, cid, student, ctx, opts);
    };
  }

  return {
    GROUPS: GROUPS,
    PARTS: PARTS,
    FEEDBACK: FEEDBACK,
    SETUPS: SETUPS,
    PINNED: PINNED,
    normalize: normalize,
    fromSetup: fromSetup,
    fromGrade: fromGrade,
    fromForm: fromForm,
    modelFor: modelFor,
    available: available,
    isOn: isOn,
    order: order,
    offParts: offParts,
    label: label,
    groupOf: function (key) {
      var d = _def(key);
      return d ? d.group : 1;
    },
    canMove: function (key) {
      return key !== 'header' && key !== PINNED;
    },
    exceptions: exceptions,
    removedOf: removedOf,
    wordingOf: wordingOf,
    optionsFor: optionsFor,
    setOn: setOn,
    move: move,
    setOption: setOption,
    setRemoved: setRemoved,
    setRemovedAll: setRemovedAll,
    setTitle: setTitle,
    setWording: setWording,
    clearStudent: clearStudent,
    partHtml: partHtml,
    rowsOf: rowsOf,
    layoutStudent: layoutStudent,
    layoutWith: layoutWith,
  };
})();
