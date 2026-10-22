/* obs-capture.js — the one observation capture strip.

   Every surface that writes an observation uses this: the Observations page,
   the Assignments comment popover, the student page, the gradebook cell menu
   and the phone sheet (docs/DECISIONS.md, "Observations (2026-10-18)"). Each
   host pre-fills what it knows and locks what it cannot change.

   The strip (docs/DECISIONS.md, "Observations", item 12): a Student line
   (chips, + Student) with the three type chips beside it (none chosen
   until picked), the note box, then one row:
   + Starter, Tags (+ Add Tag: dispositions, Core Competencies, custom
   tags), the Context menu, + Link (an assessment, or one learning-map
   competency with an optional Level), Keep Tags and Add.
   Shorthand in the box: @name, #tag, !strength|growth|concern|note, /starter.
   Enter sends, Shift+Enter adds a line.

   Starters are the teacher's sentence starters, most used first
   (getObservationTemplatesByUse), the same in every class. Picking one
   puts its text in the box and sets its type and context only where none
   is chosen yet; its tags are added to the ones already picked. The
   observation remembers the starter so Times Used counts it. Save as
   Starter keeps what is in the box as a new one.

   The level is evidence only. Nothing here or in calc.js turns it into a
   grade. */
window.ObsCapture = (function () {
  'use strict';

  var TYPE_KEYS = ['strength', 'growth', 'concern', 'note'];
  var KEEP_TAGS_KEY = 'fv-obs-keep-tags';

  /* Unsent text per host and course, kept for the session so a route change
     inside the app does not lose it. */
  var _drafts = {};

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _focus(el) {
    if (el && typeof el.focus === 'function') el.focus();
  }

  function _norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function _readKeepTags() {
    try {
      return localStorage.getItem(KEEP_TAGS_KEY) === '1';
    } catch (e) {
      return false;
    }
  }
  function _writeKeepTags(on) {
    try {
      localStorage.setItem(KEEP_TAGS_KEY, on ? '1' : '0');
    } catch (e) {
      /* per-device convenience only */
    }
  }

  /* ── Lists the strip offers ─────────────────────────────── */

  function _firstName(st) {
    return (st && (st.preferred || st.preferredName || st.firstName || st.first_name)) || '';
  }
  function _studentName(st) {
    if (!st) return '';
    if (typeof displayName === 'function') return displayName(st);
    return [_firstName(st), st.lastName || ''].join(' ').trim();
  }
  function _studentFirst(st) {
    if (!st) return '';
    if (typeof displayNameFirst === 'function') return displayNameFirst(st);
    return _firstName(st);
  }

  function studentList(cid) {
    var list = (typeof getStudents === 'function' && getStudents(cid)) || [];
    if (typeof sortStudents === 'function') list = sortStudents(list.slice(), 'lastName');
    return list.map(function (st) {
      return {
        id: st.id,
        name: _studentName(st),
        first: _studentFirst(st),
        last: st.lastName || st.last_name || '',
      };
    });
  }

  /* Dispositions, Core Competencies and the class's custom tags, as
     [{ type: 'section', label } | { key, label, color }]. */
  function tagMenuItems(cid) {
    var items = [];
    var color =
      typeof obsTagColor === 'function'
        ? obsTagColor
        : function () {
            return 'var(--text-3)';
          };
    var labels = typeof OBS_LABELS !== 'undefined' ? OBS_LABELS : {};
    if (typeof LEARNING_DIMS !== 'undefined') {
      items.push({ type: 'section', label: 'Learning dispositions' });
      LEARNING_DIMS.forEach(function (d) {
        items.push({ key: d, label: labels[d] || d, color: color(d) });
      });
    }
    if (typeof RELATIONAL_DIMS !== 'undefined') {
      items.push({ type: 'section', label: 'Relational and identity' });
      RELATIONAL_DIMS.forEach(function (d) {
        items.push({ key: d, label: labels[d] || d, color: color(d) });
      });
    }
    if (typeof CORE_COMPETENCIES !== 'undefined') {
      items.push({ type: 'section', label: 'Core competencies' });
      CORE_COMPETENCIES.forEach(function (cc) {
        items.push({ key: 'cc:' + cc.id, label: cc.label, color: color('cc:' + cc.id) });
      });
    }
    var custom = (typeof getCustomTags === 'function' && getCustomTags(cid)) || [];
    if (custom.length) {
      items.push({ type: 'section', label: 'Custom tags' });
      custom.forEach(function (t) {
        items.push({ key: 'tag:' + t, label: t, color: color('tag:' + t) });
      });
    }
    return items;
  }

  function tagLabel(key) {
    if (typeof resolveTag === 'function') return resolveTag(key).label;
    return String(key || '').replace(/^(cc|tag):/, '');
  }

  /* Learning-map competencies, grouped by section:
     [{ type: 'section', label } | { id, label, section }]. */
  function competencyItems(cid) {
    var sections = (typeof getSections === 'function' && getSections(cid)) || [];
    var items = [];
    sections.forEach(function (sec) {
      var tags = sec.tags || (sec.outcome ? [sec.outcome] : []);
      if (!tags.length) return;
      items.push({ type: 'section', label: sec.name || sec.shortName || 'Competencies' });
      tags.forEach(function (t) {
        if (!t || !t.id) return;
        items.push({ id: t.id, label: t.label || t.text || t.code || t.id, section: sec.name || '' });
      });
    });
    return items;
  }

  function competencyLabel(cid, id) {
    if (!id) return '';
    var t = typeof getTagById === 'function' ? getTagById(cid, id) : null;
    return t ? t.label || t.text || t.code || '' : '';
  }

  function levelLabel(level) {
    var labels = typeof PROF_LABELS !== 'undefined' ? PROF_LABELS : {};
    return (level >= 1 && level <= 4 && labels[level]) || '';
  }

  function assessmentList(cid) {
    var list = ((typeof getAssessments === 'function' && getAssessments(cid)) || []).slice();
    function when(a) {
      return a.dueDate || a.due_date || a.date || a.dateAssigned || a.date_assigned || '';
    }
    list.sort(function (a, b) {
      return when(b).localeCompare(when(a));
    });
    return list.map(function (a) {
      return { id: a.id, title: a.title || 'Untitled' };
    });
  }

  function _assessmentTitle(cid, aid) {
    var a = ((typeof getAssessments === 'function' && getAssessments(cid)) || []).find(function (x) {
      return x.id === aid;
    });
    return a ? a.title || '' : '';
  }

  /* The assessment most recently scored in this class today, or null. */
  function defaultAssessmentId(cid) {
    var exists = function (aid) {
      return (
        !!aid &&
        assessmentList(cid).some(function (a) {
          return a.id === aid;
        })
      );
    };
    if (typeof getLastScoredAssessment === 'function') {
      var last = getLastScoredAssessment(cid);
      if (exists(last)) return last;
    }
    var today =
      typeof courseToday === 'function' ? courseToday(cid) : typeof getTodayStr === 'function' ? getTodayStr() : '';
    if (!today || typeof getScores !== 'function') return null;
    var scores = getScores(cid) || {};
    var best = null;
    Object.keys(scores).forEach(function (sid) {
      (scores[sid] || []).forEach(function (e) {
        if (!e || e.date !== today || !e.assessmentId) return;
        if (!best || (e.created || '') > (best.created || '')) best = e;
      });
    });
    return best && exists(best.assessmentId) ? best.assessmentId : null;
  }

  /* ── Sentence starters ──────────────────────────────────── */

  function starterList() {
    return ((typeof getObservationTemplatesByUse === 'function' && getObservationTemplatesByUse()) || []).filter(
      function (t) {
        return t && t.text;
      },
    );
  }

  /* Starters whose text holds the query, the ones with a word starting
     with it first. An empty query keeps them all, most used first. */
  function matchStarters(query, starters) {
    var q = _norm(query);
    if (!q) return starters.slice();
    var lead = [];
    var rest = [];
    starters.forEach(function (t) {
      if (_norm(t.text).indexOf(q) < 0) return;
      var word = String(t.text)
        .split(/\s+/)
        .some(function (w) {
          return _norm(w).indexOf(q) === 0;
        });
      (word ? lead : rest).push(t);
    });
    return lead.concat(rest);
  }

  /* What a picked starter does to the strip's state: type and context only
     where none is chosen, tags merged. Changes `state` in place. */
  function applyStarter(state, starter) {
    if (!starter) return state;
    if (!state.sentiment && starter.sentiment) state.sentiment = starter.sentiment;
    if (!state.context && starter.context) state.context = starter.context;
    (starter.dims || []).forEach(function (k) {
      if (state.dims.indexOf(k) < 0) state.dims.push(k);
    });
    return state;
  }

  /* Put `insert` in `value` over [start, end) (the /token, or the caret when
     start === end), with a space either side where words would touch.
     → { value, caret } */
  function insertText(value, insert, start, end) {
    value = String(value || '');
    var before = value.slice(0, start);
    var after = value.slice(end);
    var text = String(insert || '');
    if (before && !/\s$/.test(before)) text = ' ' + text;
    if (after && !/^\s/.test(after)) text += ' ';
    return { value: before + text + after, caret: before.length + text.length };
  }

  /* ── Shorthand ──────────────────────────────────────────── */

  /* The shorthand token the caret is in: @name, #tag, !type or /starter.
     Null when there is none. A token starts a word (start of text or after
     whitespace). */
  function tokenAt(text, caret) {
    text = String(text || '');
    if (caret == null) caret = text.length;
    var start = caret;
    while (start > 0 && !/\s/.test(text.charAt(start - 1))) start--;
    var word = text.slice(start, caret);
    var m = word.match(/^([@#!/])([^\s@#!/]*)$/);
    if (!m) return null;
    if (m[1] === '!' && start > 0 && !/\s/.test(text.charAt(start - 1))) return null;
    return { kind: m[1], query: m[2], start: start, end: caret };
  }

  function _stripPunct(q) {
    return String(q || '').replace(/[.,;:!?)\]]+$/, '');
  }

  function matchStudents(query, students) {
    var q = _norm(query);
    if (!q) return students.slice(0, 8);
    var exact = students.filter(function (s) {
      return _norm(s.first) === q || _norm(s.name) === q || _norm(s.first + s.last) === q;
    });
    if (exact.length) return exact;
    return students.filter(function (s) {
      return _norm(s.first).indexOf(q) === 0 || _norm(s.last).indexOf(q) === 0 || _norm(s.name).indexOf(q) === 0;
    });
  }

  function matchTags(query, tags) {
    var q = _norm(query);
    var flat = tags.filter(function (t) {
      return t.key;
    });
    if (!q) return flat.slice(0, 8);
    var exact = flat.filter(function (t) {
      return _norm(t.label) === q || _norm(t.key) === q;
    });
    if (exact.length) return exact;
    return flat.filter(function (t) {
      return (
        _norm(t.label).indexOf(q) === 0 ||
        _norm(t.key).indexOf(q) === 0 ||
        t.label
          .toLowerCase()
          .split(/[\s&,/-]+/)
          .some(function (w) {
            return _norm(w).indexOf(q) === 0;
          })
      );
    });
  }

  function matchTypes(query) {
    var q = _norm(query);
    return TYPE_KEYS.filter(function (k) {
      return !q || k.indexOf(q) === 0;
    });
  }

  function _reEscape(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* A starter from what is in the box: no students. @name, #tag and !type
     shorthand come out as they do on Add (the tags and type are kept), and
     the picked students' names are taken out, with any "'s", so the starter
     works for anyone. → { text, dims, sentiment } */
  function starterText(value, lists, studentIds) {
    var parsed = parseShorthand(value, lists);
    var text = parsed.text;
    var ids = (studentIds || []).concat(parsed.studentIds);
    ((lists && lists.students) || []).forEach(function (s) {
      if (ids.indexOf(s.id) < 0) return;
      [s.name, s.first]
        .filter(Boolean)
        .sort(function (a, b) {
          return b.length - a.length;
        })
        .forEach(function (n) {
          text = text.replace(new RegExp('(^|[^\\w])' + _reEscape(n) + "(['\u2019]s)?(?![\\w])", 'gi'), '$1');
        });
    });
    text = text
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^[\s,.;:-]+/, '')
      .trim();
    if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
    return { text: text, dims: parsed.dims, sentiment: parsed.sentiment };
  }

  /* Turn every shorthand token in `text` that names exactly one student,
     tag or type into a pick, and take it out of the text. Tokens that match
     nothing, or more than one thing, stay as typed. '/' tokens always stay:
     a starter is picked from the menu, never on its own.
       lists: { students: [{ id, name, first, last }], tags: [{ key, label }] }
     → { text, studentIds, dims, sentiment } */
  function parseShorthand(text, lists) {
    lists = lists || {};
    var students = lists.students || [];
    var tags = lists.tags || [];
    var out = { text: '', studentIds: [], dims: [], sentiment: null };
    var src = String(text || '');
    var re = /(^|\s)([@#!])([^\s@#!/]+)/g;
    var cleaned = src.replace(re, function (all, lead, sigil, raw) {
      var tail = raw.slice(_stripPunct(raw).length);
      var q = _stripPunct(raw);
      if (!q || !/^[A-Za-zÀ-ɏ]/.test(q)) return all;
      var hit;
      if (sigil === '@') {
        hit = matchStudents(q, students);
        if (hit.length !== 1) return all;
        if (out.studentIds.indexOf(hit[0].id) < 0) out.studentIds.push(hit[0].id);
      } else if (sigil === '#') {
        hit = matchTags(q, tags);
        if (hit.length !== 1) return all;
        if (out.dims.indexOf(hit[0].key) < 0) out.dims.push(hit[0].key);
      } else {
        hit = matchTypes(q);
        if (hit.length !== 1) return all;
        out.sentiment = hit[0];
      }
      return lead + tail;
    });
    out.text = cleaned
      .replace(/[ \t]+([.,;:!?])/g, '$1')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[ \t]+|[ \t]+$/gm, '')
      .trim();
    return out;
  }

  /* ── Pills on observation cards ─────────────────────────── */

  /* Competency and level pills for a card. `pillClass` lets the phone use
     its own pill class. */
  function linkPillsHtml(cid, ob, pillClass) {
    if (!ob || !ob.competencyId) return '';
    var cls = pillClass || 'obs-pill';
    var label = competencyLabel(cid, ob.competencyId) || 'Competency';
    var lvl = levelLabel(ob.level);
    return (
      '<span class="' +
      cls +
      ' obsc-pill-competency" title="Linked competency">' +
      _esc(label) +
      '</span>' +
      (lvl
        ? '<span class="' +
          cls +
          ' obsc-pill-level" data-level="' +
          ob.level +
          '" title="Looks like this level. Evidence only, not a grade.">Looks ' +
          _esc(lvl) +
          '</span>'
        : '')
    );
  }

  /* ── The strip ──────────────────────────────────────────── */

  var _uid = 0;

  /* opts:
       cid                 course id
       idPrefix            prefix for element ids ('' on the Observations page)
       students            pre-selected student ids
       lockStudents        hide the student picker; the students are fixed
       assessmentId        pre-filled assessment
       lockAssessment      the assessment cannot be changed
       defaultAssessment   pre-fill the assessment scored today
       competencyId        pre-filled competency
       draftKey            where unsent text is kept ('obs-page', 'student' …)
       layout              'inline' (menus float) or 'sheet' (menus in flow)
       placeholder         text box placeholder
       onAdd(info)         after an observation is written
       onStudentsChange(ids)  the picked students changed */
  function create(opts) {
    opts = opts || {};
    var cid = opts.cid;
    var p = opts.idPrefix || '';
    var state = {
      students: (opts.students || []).slice(),
      sentiment: null,
      context: null,
      dims: [],
      assessmentId: opts.assessmentId || null,
      competencyId: opts.competencyId || null,
      level: null,
      keepTags: _readKeepTags(),
      menu: null,
      suggest: null,
      flagOffer: [],
      error: '',
      templateId: null, // the starter the text came from
    };
    if (!state.assessmentId && opts.defaultAssessment) state.assessmentId = defaultAssessmentId(cid);
    var draftKey = (opts.draftKey || 'obs') + '|' + cid;
    var root = document.createElement('div');
    root.className = 'obsc' + (opts.layout === 'sheet' ? ' obsc--sheet' : '');
    root.id = p + 'obs-capture';
    root.setAttribute('data-obsc', String(++_uid));
    var _destroyed = false;

    root.innerHTML =
      '<div class="obsc-row obsc-who" data-part="who"></div>' +
      '<div class="obsc-slot" data-slot="who"></div>' +
      '<div class="obsc-input-wrap">' +
      '<textarea class="obsc-input obs-note-box" id="' +
      p +
      'capture-input" rows="2" autocomplete="off" aria-label="Observation note" placeholder="' +
      _esc(opts.placeholder || 'What did you notice?') +
      '"></textarea>' +
      '</div>' +
      '<div class="obsc-slot" data-slot="input"></div>' +
      '<div class="obsc-row obsc-links" data-part="links"></div>' +
      '<div class="obsc-slot" data-slot="links"></div>' +
      '<div class="obsc-flag" data-part="flag" aria-live="polite"></div>';

    var input = root.querySelector('textarea');
    input.value = _drafts[draftKey] || '';

    function lists() {
      return { students: studentList(cid), tags: tagMenuItems(cid) };
    }

    /* ── chip markup ───────────────────────────────────── */
    function chip(action, label, o) {
      o = o || {};
      return (
        '<button type="button" class="obsc-chip' +
        (o.cls ? ' ' + o.cls : '') +
        (o.on ? ' is-on' : '') +
        '" data-obsc="' +
        action +
        '"' +
        (o.value != null ? ' data-value="' + _esc(o.value) + '"' : '') +
        (o.id ? ' id="' + o.id + '"' : '') +
        (o.pressed != null ? ' aria-pressed="' + !!o.pressed + '"' : '') +
        (o.menu ? ' aria-haspopup="listbox" aria-expanded="' + (state.menu === o.menu) + '"' : '') +
        (o.attrs || '') +
        '>' +
        label +
        '</button>'
      );
    }
    function removable(label, removeAction, value, o) {
      o = o || {};
      return (
        '<span class="obsc-chip obsc-chip-picked' +
        (o.cls ? ' ' + o.cls : '') +
        '"' +
        (o.attrs || '') +
        '>' +
        (o.dot ? '<span class="obsc-dot" style="background:' + o.dot + '"></span>' : '') +
        (o.trigger
          ? '<button type="button" class="obsc-chip-label" data-obsc="' + o.trigger + '">' + label + '</button>'
          : '<span class="obsc-chip-label">' + label + '</span>') +
        (o.locked
          ? ''
          : '<button type="button" class="obsc-x" data-obsc="' +
            removeAction +
            '" data-value="' +
            _esc(value) +
            '" aria-label="Remove ' +
            _esc(o.plain || '') +
            '">&times;</button>') +
        '</span>'
      );
    }

    function avatarHtml(s) {
      var color =
        typeof _avatarColor === 'function'
          ? _avatarColor(s.id)
          : typeof MComponents !== 'undefined'
            ? MComponents.avatarColor(s.id)
            : 'var(--text-3)';
      var ini = ((s.first || s.name || '?').charAt(0) + (s.last || '').charAt(0)).toUpperCase();
      return '<i class="obsc-av" style="background:' + color + '" aria-hidden="true">' + _esc(ini) + '</i>';
    }

    /* The Student line, like an email's To line. */
    function renderWho() {
      var h = '<span class="obs-row-label">Student</span>';
      var byId = {};
      studentList(cid).forEach(function (s) {
        byId[s.id] = s;
      });
      state.students.forEach(function (sid) {
        var s = byId[sid];
        if (!s) return;
        h += removable(avatarHtml(s) + _esc(s.name), 'removeStudent', sid, {
          cls: 'obsc-chip-student',
          locked: opts.lockStudents,
          plain: s.name,
          attrs: ' data-sid="' + _esc(sid) + '"',
        });
      });
      if (!opts.lockStudents) {
        h += chip('menu', '+ Student', {
          value: 'students',
          id: p + 'student-btn',
          menu: 'students',
          cls: 'obs-add obsc-chip-add',
          attrs: ' aria-label="' + (state.students.length ? 'Add a student' : 'Select students') + '"',
        });
        h += '<span class="obsc-hint">or type @name</span>';
      }
      h += '<span class="obsc-sep" aria-hidden="true"></span><span class="obsc-group" role="group" aria-label="Type">';
      TYPE_KEYS.forEach(function (k) {
        var info = (typeof OBS_SENTIMENTS !== 'undefined' && OBS_SENTIMENTS[k]) || { label: k };
        h += chip('type', _esc(info.label), {
          value: k,
          on: state.sentiment === k,
          pressed: state.sentiment === k,
          cls: 'obsc-chip-type',
          attrs: ' data-sentiment="' + k + '"',
        });
      });
      h += '</span>';
      return h;
    }

    /* One row: + Starter | Tags | Context, + Link, then Keep Tags and Add. */
    function renderLinks() {
      var h = chip('menu', '+ Starter', {
        value: 'starters',
        menu: 'starters',
        cls: 'obs-add obsc-chip-add obsc-chip-starter',
        id: p + 'starter-btn',
      });
      h += '<span class="obs-row-sep" aria-hidden="true"></span><span class="obs-row-label">Tags</span>';
      state.dims.forEach(function (k) {
        var label = tagLabel(k);
        h += removable(_esc(label), 'removeTag', k, {
          dot: typeof obsTagColor === 'function' ? obsTagColor(k) : '',
          plain: label,
          cls: 'obsc-chip-tag',
        });
      });
      h += chip('menu', '+ Add Tag', { value: 'tags', menu: 'tags', cls: 'obs-add obsc-chip-add', id: p + 'tag-btn' });
      h +=
        '<span class="obs-row-sep" aria-hidden="true"></span><span class="obs-row-label" id="' +
        p +
        'context-label">Context</span>';
      h += ObsCard.contextMenuHtml({
        id: p + 'context',
        value: state.context,
        open: state.menu === 'context',
        labelledBy: p + 'context-label',
        toggleAttrs: 'data-obsc="menu" data-value="context"',
        pickAttrs: function (k) {
          return 'data-obsc="setContext" data-value="' + k + '"';
        },
      });

      if (state.assessmentId) {
        var title = _assessmentTitle(cid, state.assessmentId) || 'Assessment';
        h += removable('Assessment: ' + _esc(title), 'clearAssessment', '', {
          locked: opts.lockAssessment,
          trigger: opts.lockAssessment ? null : 'menuAssessment',
          plain: 'assessment ' + title,
          cls: 'obsc-chip-assessment',
        });
      }
      if (state.competencyId) {
        var cl = competencyLabel(cid, state.competencyId) || 'Competency';
        h += removable('Competency: ' + _esc(cl), 'clearCompetency', '', {
          trigger: 'menuCompetency',
          plain: 'competency ' + cl,
          cls: 'obsc-chip-competency',
        });
        var lv = levelLabel(state.level);
        h += chip('menu', lv ? 'Level: looks ' + _esc(lv) : 'Level', {
          value: 'level',
          menu: 'level',
          on: !!lv,
          cls: 'obsc-chip-level' + (lv ? '' : ' obs-add obsc-chip-add'),
          id: p + 'level-btn',
          attrs: ' title="Evidence only. It never changes a grade."',
        });
      }
      if (linkChoices().length) {
        h += chip('menu', '+ Link<span class="obs-menu-car" aria-hidden="true">▾</span>', {
          value: 'link',
          menu: 'link',
          cls: 'obs-menu-btn empty obsc-link-btn',
          id: p + 'link-btn',
        });
      }

      h += '<span class="obsc-spacer"></span>';
      h +=
        '<label class="obsc-keep"><input type="checkbox" data-obsc="keepTags"' +
        (state.keepTags ? ' checked' : '') +
        '> Keep Tags</label>';
      h += '<span class="obsc-hint">Enter adds</span>';
      h +=
        '<button type="button" class="obsc-save-starter" id="' +
        p +
        'save-starter-btn" data-obsc="saveStarter"' +
        (input.value.trim() ? '' : ' disabled') +
        '>Save as Starter</button>';
      h +=
        '<button type="button" class="obsc-add" id="' +
        p +
        'capture-add-btn" data-obsc="add" aria-label="Add observation">Add</button>';
      return h;
    }

    /* What + Link still offers: an assessment (unless the host fixed it)
       and a competency. */
    function linkChoices() {
      var out = [];
      if (!state.assessmentId && !opts.lockAssessment) out.push('assessment');
      if (!state.competencyId) out.push('competency');
      return out;
    }

    function renderFlag() {
      if (state.error) return '<span class="obsc-error" role="alert">' + _esc(state.error) + '</span>';
      if (!state.flagOffer.length) return '';
      var byId = {};
      studentList(cid).forEach(function (s) {
        byId[s.id] = s;
      });
      var h = '<span class="obsc-flag-text">Concern added.</span>';
      state.flagOffer.forEach(function (sid) {
        var s = byId[sid];
        if (!s) return;
        h +=
          '<button type="button" class="obsc-flag-btn" data-obsc="flag" data-value="' +
          _esc(sid) +
          '">Flag ' +
          _esc(s.first || s.name) +
          '</button>';
      });
      h += '<button type="button" class="obsc-flag-dismiss" data-obsc="notNow">Not Now</button>';
      return h;
    }

    /* ── menus ─────────────────────────────────────────── */
    var MENU_ROW = {
      starters: 'links',
      students: 'who',
      link: 'links',
      tags: 'links',
      assessment: 'links',
      competency: 'links',
      level: 'links',
    };
    var MENU_LABEL = {
      starters: 'Sentence starters',
      students: 'Students',
      link: 'Link',
      tags: 'Tags',
      assessment: 'Assessments',
      competency: 'Competencies',
      level: 'Level',
    };
    var MENU_TRIGGER = {
      starters: 'starter-btn',
      students: 'student-btn',
      context: 'context-btn',
      link: 'link-btn',
      tags: 'tag-btn',
      assessment: 'link-btn',
      competency: 'link-btn',
      level: 'level-btn',
    };

    function item(action, value, label, o) {
      o = o || {};
      return (
        '<div class="obsc-item' +
        (o.on ? ' selected' : '') +
        '" role="option" tabindex="-1" aria-selected="' +
        !!o.on +
        '" data-obsc="' +
        action +
        '" data-value="' +
        _esc(value) +
        '"' +
        (o.search != null ? ' data-search="' + _esc(o.search) + '"' : '') +
        '>' +
        '<span class="obsc-check" aria-hidden="true">' +
        (o.on ? '✓' : '') +
        '</span>' +
        (o.dot ? '<span class="obsc-dot" style="background:' + o.dot + '"></span>' : '') +
        '<span class="obsc-item-label">' +
        _esc(label) +
        '</span>' +
        (o.hint ? '<span class="obsc-item-hint">' + _esc(o.hint) + '</span>' : '') +
        '</div>'
      );
    }
    function section(label) {
      return '<div class="obsc-menu-section" role="presentation" data-section>' + _esc(label) + '</div>';
    }
    function search(placeholder) {
      return (
        '<input class="obsc-menu-search" type="text" autocomplete="off" data-obsc-search placeholder="' +
        _esc(placeholder) +
        '" aria-label="' +
        _esc(placeholder) +
        '">'
      );
    }

    /* Where starters are edited: My Sentence Starters on a computer. A host
       can pass onEditStarters; the phone, which cannot edit them, says so. */
    function canEditStarters() {
      return typeof opts.onEditStarters === 'function' || (typeof Router !== 'undefined' && !!Router.navigate);
    }
    function editStarters() {
      clearMenus();
      if (typeof opts.onEditStarters === 'function') {
        opts.onEditStarters(cid);
        return;
      }
      closeDialog();
      if (typeof Router !== 'undefined' && Router.navigate) Router.navigate('/observations/starters');
    }
    function starterFooterHtml() {
      if (canEditStarters()) {
        return (
          '<div class="obsc-item obsc-item-edit" role="option" tabindex="-1" aria-selected="false" data-obsc="editStarters">' +
          '<span class="obsc-check" aria-hidden="true"></span><span class="obsc-item-label">Edit My Starters…</span></div>'
        );
      }
      return '<div class="obsc-menu-note">Add your own on My Sentence Starters on a computer.</div>';
    }
    function starterHint(t) {
      var info = t.sentiment && typeof OBS_SENTIMENTS !== 'undefined' && OBS_SENTIMENTS[t.sentiment];
      return info ? info.label : '';
    }
    /* What a starter sets besides its text: "Small group · Collaboration". */
    function starterSets(t) {
      var bits = [];
      var c = t.context && typeof OBS_CONTEXTS !== 'undefined' && OBS_CONTEXTS[t.context];
      if (c) bits.push(c.label);
      (t.dims || []).forEach(function (k) {
        bits.push(tagLabel(k));
      });
      return bits.join(' · ');
    }
    /* A starter row: its type block, the text, and under it what it sets. */
    function starterItem(t, attrs, on) {
      var sets = starterSets(t);
      return (
        '<div class="obsc-item obsc-starter' +
        (on ? ' is-active' : '') +
        '" role="option" tabindex="-1" aria-selected="' +
        !!on +
        '" ' +
        attrs +
        ' data-search="' +
        _esc(t.text) +
        '">' +
        ObsCard.typeBlockHtml(t.sentiment).replace('class="obs-type', 'class="obs-type obsc-item-hint') +
        '<span class="obsc-starter-text"><span class="obsc-item-label">' +
        _esc(t.text) +
        '</span>' +
        (sets ? '<small class="obsc-starter-sets">' + _esc(sets) + '</small>' : '') +
        '</span></div>'
      );
    }
    function starterFootHint() {
      return '<div class="obsc-menu-note">A starter fills the type, context and tags you haven’t set.</div>';
    }

    function menuHtml(name) {
      var h = '';
      var id = '';
      if (name === 'starters') {
        id = p + 'starter-dropdown';
        var starters = starterList(cid);
        if (starters.length) h += search('Search starters…');
        h += '<div class="obsc-menu-list">';
        if (!starters.length) h += '<div class="obsc-menu-empty">You have no sentence starters yet.</div>';
        starters.forEach(function (t) {
          h += starterItem(t, 'data-obsc="pickStarter" data-value="' + _esc(t.id) + '"', false);
        });
        h += starterFooterHtml();
        h += '</div>';
        if (starters.length) h += starterFootHint();
      } else if (name === 'students') {
        id = p + 'student-dropdown';
        h += search('Search students…') + '<div class="obsc-menu-list">';
        studentList(cid).forEach(function (s) {
          h += item('toggleStudent', s.id, s.name, { on: state.students.indexOf(s.id) >= 0, search: s.name });
        });
        h += '</div><div class="obsc-menu-note">Shift-click to pick more than one.</div>';
      } else if (name === 'link') {
        id = p + 'link-dropdown';
        h += '<div class="obsc-menu-list">';
        linkChoices().forEach(function (k) {
          h +=
            '<div class="obsc-item" role="option" tabindex="-1" aria-selected="false" data-obsc="menu" data-value="' +
            k +
            '" id="' +
            p +
            k +
            '-btn"><span class="obsc-check" aria-hidden="true"></span><span class="obsc-item-label">' +
            (k === 'assessment' ? '+ Assessment' : '+ Competency') +
            '</span></div>';
        });
        h += '</div>';
      } else if (name === 'tags') {
        id = p + 'tag-dropdown';
        h += search('Search tags…') + '<div class="obsc-menu-list">';
        tagMenuItems(cid).forEach(function (t) {
          if (t.type === 'section') h += section(t.label);
          else
            h += item('toggleTag', t.key, t.label, {
              on: state.dims.indexOf(t.key) >= 0,
              dot: t.color,
              search: t.label,
            });
        });
        h += '</div>';
        h +=
          '<div class="obsc-menu-add"><input class="obsc-menu-add-input" type="text" data-obsc-newtag placeholder="New custom tag…" aria-label="New custom tag"><button type="button" class="obsc-menu-add-btn" data-obsc="newTag">Add tag</button></div>';
      } else if (name === 'assessment') {
        var asm = assessmentList(cid);
        h += search('Search assessments…') + '<div class="obsc-menu-list">';
        if (!asm.length) h += '<div class="obsc-menu-empty">This class has no assessments yet.</div>';
        asm.forEach(function (a) {
          h += item('setAssessment', a.id, a.title, { on: state.assessmentId === a.id, search: a.title });
        });
        h += '</div>';
      } else if (name === 'competency') {
        var comps = competencyItems(cid);
        h += search('Search competencies…') + '<div class="obsc-menu-list">';
        if (!comps.length) h += '<div class="obsc-menu-empty">This class has no learning map yet.</div>';
        comps.forEach(function (c) {
          if (c.type === 'section') h += section(c.label);
          else
            h += item('setCompetency', c.id, c.label, {
              on: state.competencyId === c.id,
              search: c.label + ' ' + c.section,
            });
        });
        h += '</div>';
      } else if (name === 'level') {
        h +=
          '<div class="obsc-menu-note">What level does this look like? Evidence only; it never changes a grade.</div><div class="obsc-menu-list">';
        [1, 2, 3, 4].forEach(function (n) {
          h += item('setLevel', n, levelLabel(n), { on: state.level === n });
        });
        h += item('setLevel', '', 'No level', { on: !state.level });
        h += '</div>';
      }
      var multi = name === 'students' || name === 'tags' ? ' aria-multiselectable="true"' : '';
      h = h.replace(
        '<div class="obsc-menu-list">',
        '<div class="obsc-menu-list" role="listbox" aria-label="' + _esc(MENU_LABEL[name]) + '"' + multi + '>',
      );
      return '<div class="obsc-menu" data-menu="' + name + '"' + (id ? ' id="' + id + '"' : '') + '>' + h + '</div>';
    }

    function suggestHtml() {
      var sg = state.suggest;
      if (!sg) return '';
      var h = '';
      if (sg.kind === '/') {
        if (sg.items.length && !sg.query) h += section('Most Used');
        if (!sg.items.length) {
          h += starterList(cid).length
            ? '<div class="obsc-menu-empty">No starter matches “' + _esc(sg.query) + '”.</div>'
            : '<div class="obsc-menu-empty">You have no sentence starters yet.</div>';
        }
        sg.items.forEach(function (it, i) {
          h += starterItem(it.starter, 'data-obsc="pickSuggest" data-value="' + i + '"', i === sg.index);
        });
        if (canEditStarters()) {
          h +=
            '<div class="obsc-item obsc-item-edit' +
            (sg.index === sg.items.length ? ' is-active' : '') +
            '" role="option" aria-selected="' +
            (sg.index === sg.items.length) +
            '" data-obsc="editStarters"><span class="obsc-item-label">Edit My Starters…</span></div>';
        } else {
          h += '<div class="obsc-menu-note">Add your own on My Sentence Starters on a computer.</div>';
        }
      } else if (!sg.items.length) {
        return '';
      } else {
        sg.items.forEach(function (it, i) {
          h +=
            '<div class="obsc-item' +
            (i === sg.index ? ' is-active' : '') +
            '" role="option" aria-selected="' +
            (i === sg.index) +
            '" data-obsc="pickSuggest" data-value="' +
            i +
            '">' +
            (it.dot ? '<span class="obsc-dot" style="background:' + it.dot + '"></span>' : '') +
            '<span class="obsc-item-label">' +
            _esc(it.label) +
            '</span></div>';
        });
      }
      return (
        '<div class="obsc-menu obsc-suggest' +
        (sg.kind === '/' ? ' obsc-suggest-starters' : '') +
        '" id="' +
        p +
        'capture-suggest"><div class="obsc-menu-list" role="listbox" aria-label="Suggestions">' +
        h +
        '</div></div>'
      );
    }

    /* ── render ────────────────────────────────────────── */
    function render() {
      if (_destroyed) return;
      var openSearch = root.querySelector('.obsc-menu [data-obsc-search]');
      var searchVal = openSearch ? openSearch.value : '';
      var searchFocused = openSearch && document.activeElement === openSearch;
      root.querySelector('[data-part="who"]').innerHTML = renderWho();
      root.querySelector('[data-part="links"]').innerHTML = renderLinks();
      root.querySelector('[data-part="flag"]').innerHTML = renderFlag();
      ['who', 'input', 'links'].forEach(function (slot) {
        var el = root.querySelector('[data-slot="' + slot + '"]');
        var html = '';
        if (slot === 'input') html = suggestHtml();
        else if (state.menu && MENU_ROW[state.menu] === slot) html = menuHtml(state.menu);
        el.innerHTML = html;
      });
      if (state.menu && state.menu !== 'context') {
        placeMenu();
        var s = root.querySelector('.obsc-menu [data-obsc-search]');
        if (s && searchVal) {
          s.value = searchVal;
          filterMenu(searchVal);
        }
        if (s && searchFocused) _focus(s);
      }
      updateAdd();
    }

    function placeMenu() {
      if (opts.layout === 'sheet') return;
      var menu = root.querySelector('.obsc-slot .obsc-menu');
      var trigger = document.getElementById(p + MENU_TRIGGER[state.menu]);
      if (!menu || !trigger || typeof menu.getBoundingClientRect !== 'function') return;
      var slot = menu.parentNode;
      var left = trigger.getBoundingClientRect().left - slot.getBoundingClientRect().left;
      var max = Math.max(0, slot.clientWidth - menu.offsetWidth);
      menu.style.left = Math.max(0, Math.min(left, max)) + 'px';
      // Open upward when there is no room below (popovers near the bottom).
      menu.style.top = '';
      var r = menu.getBoundingClientRect();
      var row = slot.previousElementSibling;
      if (r.bottom > window.innerHeight - 8 && row && r.top - menu.offsetHeight - row.offsetHeight > 8) {
        menu.style.top = -(menu.offsetHeight + row.offsetHeight + 6) + 'px';
      }
    }

    function filterMenu(q) {
      var menu = root.querySelector('.obsc-slot .obsc-menu');
      if (!menu) return;
      var nq = _norm(q);
      var lastSection = null;
      var sectionHasHit = false;
      Array.prototype.forEach.call(menu.querySelectorAll('.obsc-menu-list > *'), function (el) {
        if (el.hasAttribute('data-section')) {
          if (lastSection) lastSection.style.display = sectionHasHit ? '' : 'none';
          lastSection = el;
          sectionHasHit = false;
          return;
        }
        if (!el.classList.contains('obsc-item')) return;
        var hay = _norm(el.getAttribute('data-search') || el.textContent);
        var hit = !nq || hay.indexOf(nq) >= 0;
        el.style.display = hit ? '' : 'none';
        if (hit) sectionHasHit = true;
      });
      if (lastSection) lastSection.style.display = sectionHasHit ? '' : 'none';
    }

    function updateAdd() {
      var btn = root.querySelector('.obsc-add');
      if (btn) btn.disabled = !state.students.length || !input.value.trim();
      var save = root.querySelector('.obsc-save-starter');
      if (save) save.disabled = !input.value.trim();
    }

    /* The starter picked for this note, while its words are still there.
       A note rewritten after picking one doesn't count as written from it. */
    function starterStillUsed(text) {
      if (!state.templateId) return null;
      var t = starterList().find(function (x) {
        return x.id === state.templateId || resolveObservationTemplateId(null, x.id) === state.templateId;
      });
      if (!t || _norm(text).indexOf(_norm(t.text)) < 0) return null;
      return t.id;
    }

    /* Save as Starter: what is in the box, with its type, context and tags,
       becomes one of the teacher's starters. The note itself waits for Add. */
    function openSaveStarter() {
      var from = starterText(input.value, lists(), state.students);
      var text = from.text;
      var sentiment = from.sentiment || state.sentiment;
      if (!input.value.trim()) {
        input.classList.add('obsc-input-empty');
        _focus(input);
        return;
      }
      clearMenus();
      var names = studentList(cid)
        .filter(function (s) {
          return state.students.indexOf(s.id) >= 0;
        })
        .map(function (s) {
          return s.first || s.name;
        });
      var who = names.length === 1 ? ' for ' + names[0] : names.length ? ' for these students' : '';
      var sets = [];
      var info = sentiment && typeof OBS_SENTIMENTS !== 'undefined' && OBS_SENTIMENTS[sentiment];
      if (info)
        sets.push(
          '<span class="obs-pill obs-pill-type" data-sentiment="' + sentiment + '">' + _esc(info.label) + '</span>',
        );
      var ctx = state.context && typeof OBS_CONTEXTS !== 'undefined' && OBS_CONTEXTS[state.context];
      if (ctx) sets.push('<span class="obs-pill obs-pill-context">' + _esc(ctx.label) + '</span>');
      var dims = state.dims.concat(from.dims).filter(function (k, i, all) {
        return !/^tag:/.test(k) && all.indexOf(k) === i;
      });
      dims.forEach(function (k) {
        sets.push(
          '<span class="obs-card-dim"><span class="dim-dot" style="background:' +
            (typeof obsTagColor === 'function' ? obsTagColor(k) : 'var(--text-3)') +
            '"></span>' +
            _esc(tagLabel(k)) +
            '</span>',
        );
      });
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay obsc-save-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', p + 'save-starter-title');
      overlay.innerHTML =
        '<div class="confirm-card obsc-save-card">' +
        '<div class="confirm-title" id="' +
        p +
        'save-starter-title">Save as Starter</div>' +
        '<label class="obsc-save-label" for="' +
        p +
        'save-starter-text">Starter</label>' +
        '<textarea class="obsc-save-text" id="' +
        p +
        'save-starter-text" rows="2">' +
        _esc(text) +
        '</textarea>' +
        '<div class="obsc-save-hint">Leave out student names so it works for anyone.</div>' +
        (sets.length
          ? '<div class="obsc-save-sets"><span class="obsc-save-sets-label">It will set</span>' +
            sets.join('') +
            '</div>'
          : '') +
        '<div class="obsc-save-note">Saves to My Sentence Starters for all your classes. Your observation' +
        _esc(who) +
        ' isn\u2019t added until you press Add.</div>' +
        '<div class="confirm-actions">' +
        '<button type="button" class="confirm-cancel" data-save-starter="cancel">Cancel</button>' +
        '<button type="button" class="confirm-ok primary" data-save-starter="save">Save Starter</button>' +
        '</div></div>';
      var returnFocus = document.activeElement;
      var box = overlay.querySelector('textarea');
      // Keys go to the window first, so Escape closes this dialog alone and
      // not a dialog holding the strip (openDialog listens on the document).
      var keys = document.defaultView || window;
      function close() {
        keys.removeEventListener('keydown', onKey, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
      }
      function save() {
        var body = box.value.trim();
        if (!body) {
          _focus(box);
          return;
        }
        var added = addObservationTemplate(null, {
          text: body,
          sentiment: sentiment,
          context: state.context,
          dims: dims.slice(),
        });
        close();
        if (!added) {
          state.error = "Couldn't save on this device. Its storage is full.";
          render();
          return;
        }
        // The note in the box now counts as written from it.
        if (_norm(input.value).indexOf(_norm(body)) >= 0) state.templateId = added.id;
        _focus(input);
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target === box) {
          e.preventDefault();
          save();
        }
      }
      overlay.addEventListener('click', function (e) {
        var b = e.target.closest('[data-save-starter]');
        if (b) {
          if (b.getAttribute('data-save-starter') === 'save') save();
          else close();
        } else if (e.target === overlay) close();
      });
      overlay.addEventListener('keydown', function (e) {
        e.stopPropagation();
      });
      keys.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      _focus(box);
    }

    function openMenu(name) {
      state.menu = state.menu === name ? null : name;
      state.suggest = null;
      render();
      if (state.menu === 'context') {
        ObsCard.focusContextMenu(root);
      } else if (state.menu) {
        var s = root.querySelector('.obsc-menu [data-obsc-search]');
        var first = root.querySelector('.obsc-slot .obsc-menu .obsc-item');
        if (s) _focus(s);
        else if (first) _focus(first);
      }
    }
    function closeMenu(focusInput) {
      if (!state.menu && !state.suggest) return;
      var trig = state.menu ? document.getElementById(p + MENU_TRIGGER[state.menu]) : null;
      state.menu = null;
      state.suggest = null;
      render();
      if (focusInput) _focus(input);
      else if (trig) {
        var again = document.getElementById(trig.id);
        if (again) _focus(again);
      }
    }

    function studentsChanged() {
      if (typeof opts.onStudentsChange === 'function') opts.onStudentsChange(state.students.slice());
    }

    /* ── shorthand while typing ────────────────────────── */
    function refreshSuggest() {
      var tok = tokenAt(input.value, input.selectionStart);
      if (!tok || (tok.kind === '@' && opts.lockStudents)) {
        if (state.suggest) {
          state.suggest = null;
          render();
        }
        return;
      }
      var items = [];
      if (tok.kind === '@') {
        items = matchStudents(tok.query, studentList(cid))
          .slice(0, 8)
          .map(function (s) {
            return { label: s.name, value: s.id };
          });
      } else if (tok.kind === '#') {
        items = matchTags(tok.query, tagMenuItems(cid))
          .slice(0, 8)
          .map(function (t) {
            return { label: t.label, value: t.key, dot: t.color };
          });
      } else if (tok.kind === '!') {
        items = matchTypes(tok.query).map(function (k) {
          return { label: OBS_SENTIMENTS[k] ? OBS_SENTIMENTS[k].label : k, value: k };
        });
      } else if (tok.kind === '/') {
        items = matchStarters(tok.query, starterList(cid))
          .slice(0, 8)
          .map(function (t) {
            return { label: t.text, value: t.id, hint: starterHint(t), starter: t };
          });
      }
      state.menu = null;
      // With no starter to pick, nothing is highlighted, so Enter still adds
      // the observation instead of leaving for Class Management.
      var index = tok.kind === '/' && !items.length ? -1 : 0;
      state.suggest = { kind: tok.kind, query: tok.query, start: tok.start, end: tok.end, items: items, index: index };
      render();
    }

    /* The starter replaces the /token, or goes in at the caret. */
    function useStarter(starterId, range) {
      var t = starterList(cid).find(function (x) {
        return x.id === starterId;
      });
      if (!t) return;
      applyStarter(state, t);
      state.templateId = t.id;
      var caret = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
      var start = range ? range.start : caret;
      var end = range ? range.end : typeof input.selectionEnd === 'number' ? input.selectionEnd : caret;
      var out = insertText(input.value, t.text, start, end);
      input.value = out.value;
      input.classList.remove('obsc-input-empty');
      input.removeAttribute('aria-invalid');
      state.suggest = null;
      state.menu = null;
      saveDraft();
      render();
      _focus(input);
      try {
        input.setSelectionRange(out.caret, out.caret);
      } catch (e) {
        /* not focusable yet */
      }
    }

    function applyPick(kind, value) {
      if (kind === '@') {
        if (state.students.indexOf(value) < 0) state.students.push(value);
        studentsChanged();
      } else if (kind === '#') {
        if (state.dims.indexOf(value) < 0) state.dims.push(value);
      } else if (kind === '!') {
        state.sentiment = value;
      }
    }

    function pickSuggest(i) {
      var sg = state.suggest;
      if (!sg) return;
      if (sg.kind === '/' && i === sg.items.length && canEditStarters()) {
        editStarters();
        return;
      }
      if (!sg.items[i]) return;
      if (sg.kind === '/') {
        useStarter(sg.items[i].value, { start: sg.start, end: sg.end });
        return;
      }
      applyPick(sg.kind, sg.items[i].value);
      var v = input.value;
      var before = v.slice(0, sg.start);
      var after = v.slice(sg.end).replace(/^[ \t]+/, '');
      input.value = before + after;
      var caret = before.length;
      state.suggest = null;
      saveDraft();
      render();
      _focus(input);
      try {
        input.setSelectionRange(caret, caret);
      } catch (e) {
        /* not focusable yet */
      }
    }

    /* A token finished by a space becomes a chip when it names one thing. */
    function absorbFinishedToken() {
      var caret = input.selectionStart;
      var v = input.value;
      if (caret < 2 || !/\s/.test(v.charAt(caret - 1))) return false;
      var tok = tokenAt(v, caret - 1);
      if (!tok || tok.kind === '/' || !tok.query) return false;
      if (tok.kind === '@' && opts.lockStudents) return false;
      var parsed = parseShorthand(v.slice(tok.start, tok.end), lists());
      var picked = parsed.studentIds.length || parsed.dims.length || parsed.sentiment;
      if (!picked) return false;
      parsed.studentIds.forEach(function (id) {
        applyPick('@', id);
      });
      parsed.dims.forEach(function (k) {
        applyPick('#', k);
      });
      if (parsed.sentiment) applyPick('!', parsed.sentiment);
      input.value = v.slice(0, tok.start) + v.slice(caret);
      try {
        input.setSelectionRange(tok.start, tok.start);
      } catch (e) {
        /* ignore */
      }
      return true;
    }

    function saveDraft() {
      if (input.value) _drafts[draftKey] = input.value;
      else delete _drafts[draftKey];
    }

    /* ── Add ───────────────────────────────────────────── */
    function submit() {
      var parsed = parseShorthand(input.value, lists());
      parsed.studentIds.forEach(function (id) {
        if (!opts.lockStudents) applyPick('@', id);
      });
      parsed.dims.forEach(function (k) {
        applyPick('#', k);
      });
      if (parsed.sentiment) state.sentiment = parsed.sentiment;
      var text = parsed.text;
      if (text !== input.value.trim()) input.value = text;
      state.error = '';
      state.suggest = null;
      if (!state.students.length) {
        render();
        if (!opts.lockStudents) openMenu('students');
        return false;
      }
      if (!text) {
        input.classList.add('obsc-input-empty');
        input.setAttribute('aria-invalid', 'true');
        render();
        _focus(input);
        return false;
      }
      var ac = state.assessmentId
        ? { assessmentId: state.assessmentId, assessmentTitle: _assessmentTitle(cid, state.assessmentId) }
        : null;
      var link = state.competencyId ? { competencyId: state.competencyId, level: state.level } : null;
      var sids = state.students.slice();
      var ok = true;
      var fromStarter = starterStillUsed(text);
      sids.forEach(function (sid) {
        var r = addQuickOb(
          cid,
          sid,
          text,
          state.dims.slice(),
          state.sentiment,
          state.context,
          ac ? Object.assign({}, ac) : null,
          link,
          fromStarter,
        );
        if (r === false) ok = false;
      });
      var sentiment = state.sentiment;
      state.flagOffer =
        sentiment === 'concern' && typeof isStudentFlagged === 'function'
          ? sids.filter(function (sid) {
              return !isStudentFlagged(cid, sid);
            })
          : [];
      if (!ok) state.error = "Couldn't save on this device. Its storage is full.";
      state.templateId = null;
      input.value = '';
      saveDraft();
      if (!state.keepTags) {
        state.dims = [];
        state.sentiment = null;
        state.context = null;
        state.competencyId = opts.competencyId || null;
        state.level = null;
      }
      state.menu = null;
      render();
      _focus(input);
      if (typeof opts.onAdd === 'function') {
        opts.onAdd({ studentIds: sids, text: text, sentiment: sentiment, ok: ok });
      }
      return true;
    }

    /* ── events ────────────────────────────────────────── */
    function onClick(e) {
      var el = e.target.closest('[data-obsc]');
      if (!el || !root.contains(el) || el === root) return;
      var act = el.getAttribute('data-obsc');
      var val = el.getAttribute('data-value');
      if (act === 'keepTags') return; // handled on change
      e.preventDefault();
      e.stopPropagation();
      if (act === 'menu') openMenu(val);
      else if (act === 'menuContext') openMenu('context');
      else if (act === 'menuAssessment') openMenu('assessment');
      else if (act === 'menuCompetency') openMenu('competency');
      else if (act === 'type') {
        state.sentiment = state.sentiment === val ? null : val;
        render();
      } else if (act === 'removeStudent') {
        state.students = state.students.filter(function (s) {
          return s !== val;
        });
        studentsChanged();
        render();
      } else if (act === 'toggleStudent') {
        var i = state.students.indexOf(val);
        if (i >= 0) state.students.splice(i, 1);
        else state.students.push(val);
        studentsChanged();
        // One pick closes the list and goes to the note; Shift-click (Space
        // on the keyboard) keeps it open to pick several.
        if (i < 0 && !(e.shiftKey || e.metaKey || e.ctrlKey)) closeMenu(true);
        else render();
      } else if (act === 'setContext') {
        state.context = val || null;
        closeMenu(false);
      } else if (act === 'clearContext') {
        state.context = null;
        render();
      } else if (act === 'toggleTag') {
        var j = state.dims.indexOf(val);
        if (j >= 0) state.dims.splice(j, 1);
        else state.dims.push(val);
        render();
      } else if (act === 'removeTag') {
        state.dims = state.dims.filter(function (k) {
          return k !== val;
        });
        render();
      } else if (act === 'newTag') addNewTag();
      else if (act === 'setAssessment') {
        state.assessmentId = val;
        closeMenu(true);
      } else if (act === 'clearAssessment') {
        state.assessmentId = null;
        render();
      } else if (act === 'setCompetency') {
        if (state.competencyId !== val) state.level = null;
        state.competencyId = val;
        closeMenu(true);
      } else if (act === 'clearCompetency') {
        state.competencyId = null;
        state.level = null;
        render();
      } else if (act === 'setLevel') {
        state.level = val ? Number(val) : null;
        closeMenu(true);
      } else if (act === 'pickSuggest') pickSuggest(Number(val));
      else if (act === 'pickStarter') useStarter(val, null);
      else if (act === 'saveStarter') openSaveStarter();
      else if (act === 'editStarters') editStarters();
      else if (act === 'add') submit();
      else if (act === 'flag') {
        if (typeof isStudentFlagged === 'function' && !isStudentFlagged(cid, val) && typeof toggleFlag === 'function') {
          toggleFlag(cid, val);
        }
        state.flagOffer = state.flagOffer.filter(function (s) {
          return s !== val;
        });
        render();
        if (typeof opts.onFlag === 'function') opts.onFlag(val);
      } else if (act === 'notNow') {
        state.flagOffer = [];
        render();
        _focus(input);
      }
    }

    function addNewTag() {
      var inp = root.querySelector('[data-obsc-newtag]');
      var label = inp ? inp.value.trim() : '';
      if (!label) return;
      if (typeof addCustomTag === 'function') addCustomTag(cid, label);
      var key = 'tag:' + label;
      if (state.dims.indexOf(key) < 0) state.dims.push(key);
      render();
    }

    function onChange(e) {
      if (e.target.matches('[data-obsc="keepTags"]')) {
        state.keepTags = !!e.target.checked;
        _writeKeepTags(state.keepTags);
      }
    }

    function onInput(e) {
      if (e.target === input) {
        input.classList.remove('obsc-input-empty');
        input.removeAttribute('aria-invalid');
        if (state.error) {
          state.error = '';
        }
        var absorbed = absorbFinishedToken();
        saveDraft();
        if (absorbed) {
          state.suggest = null;
          render();
        } else refreshSuggest();
        updateAdd();
      } else if (e.target.matches('[data-obsc-search]')) {
        filterMenu(e.target.value);
      }
    }

    function moveInMenu(dir) {
      var items = Array.prototype.filter.call(root.querySelectorAll('.obsc-slot .obsc-menu .obsc-item'), function (el) {
        return el.style.display !== 'none';
      });
      if (!items.length) return;
      var at = items.indexOf(document.activeElement);
      var next = at < 0 ? (dir > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, at + dir));
      _focus(items[next]);
    }

    function onKeydown(e) {
      if (e.target === input) {
        var sg = state.suggest;
        // The "/" list ends with "Edit My Starters…", which the arrows reach too.
        var rows = sg ? sg.items.length + (sg.kind === '/' && canEditStarters() ? 1 : 0) : 0;
        if (sg && rows) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            var from = sg.index < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : sg.index;
            sg.index = (from + (e.key === 'ArrowDown' ? 1 : -1) + rows) % rows;
            render();
            return;
          }
          if (((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') && sg.index >= 0) {
            if (!e.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              pickSuggest(sg.index);
              return;
            }
          }
        }
        if (e.key === 'Escape' && (state.suggest || state.menu)) {
          e.preventDefault();
          e.stopPropagation();
          closeMenu(true);
          return;
        }
        // Enter sends (Cmd+Enter too); Shift+Enter adds a line. Not while an
        // IME is composing.
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }
        return;
      }
      if (!state.menu) return;
      if (state.menu === 'context' && ObsCard.contextMenuKey(e, root)) {
        e.stopPropagation();
        return;
      }
      // Keys used inside a menu stay here, so page shortcuts (gradebook cell
      // navigation, for one) do not also act on them.
      if (['Escape', 'Enter', ' ', 'ArrowDown', 'ArrowUp'].indexOf(e.key) >= 0) e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(false);
        return;
      }
      if (e.target.matches('[data-obsc-newtag]') && e.key === 'Enter') {
        e.preventDefault();
        addNewTag();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveInMenu(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('obsc-item')) {
        e.preventDefault();
        // Space toggles and keeps a list open, as Shift-click does; Enter
        // picks like a click.
        if (typeof MouseEvent === 'function') {
          e.target.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: e.shiftKey || e.key === ' ' }),
          );
        } else e.target.click();
        return;
      }
      if (e.key === 'Enter' && e.target.matches('[data-obsc-search]')) {
        e.preventDefault();
        var first = Array.prototype.find.call(root.querySelectorAll('.obsc-slot .obsc-menu .obsc-item'), function (el) {
          return el.style.display !== 'none';
        });
        if (first) first.click();
      }
    }

    /* Close menus without re-rendering the chip rows: a chip replaced
       between mousedown and click would lose the click. */
    function clearMenus() {
      state.menu = null;
      state.suggest = null;
      Array.prototype.forEach.call(root.querySelectorAll('[data-slot]'), function (el) {
        el.innerHTML = '';
      });
      Array.prototype.forEach.call(root.querySelectorAll('.obs-menu'), function (el) {
        el.parentNode.removeChild(el);
      });
      Array.prototype.forEach.call(root.querySelectorAll('[aria-expanded="true"]'), function (el) {
        el.setAttribute('aria-expanded', 'false');
      });
    }

    function onDocMousedown(e) {
      if (!state.menu && !state.suggest) return;
      if (root.contains(e.target)) {
        if (
          state.menu &&
          !e.target.closest('.obsc-menu') &&
          !e.target.closest('.obs-menu') &&
          !e.target.closest('[data-obsc^="menu"]')
        )
          clearMenus();
        return;
      }
      clearMenus();
    }

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKeydown);
    document.addEventListener('mousedown', onDocMousedown, true);

    render();

    return {
      el: root,
      /* Put the strip in `container` (again after a host re-render). */
      mount: function (container) {
        if (container && root.parentNode !== container) container.appendChild(root);
        render();
        return root;
      },
      /* Roster rail: click picks, shift-click adds. */
      pickStudent: function (sid, additive) {
        if (additive) {
          var i = state.students.indexOf(sid);
          if (i >= 0) state.students.splice(i, 1);
          else state.students.push(sid);
        } else state.students = [sid];
        studentsChanged();
        render();
      },
      setStudents: function (ids) {
        state.students = (ids || []).slice();
        render();
      },
      getStudents: function () {
        return state.students.slice();
      },
      getState: function () {
        return JSON.parse(JSON.stringify(Object.assign({}, state, { text: input.value })));
      },
      getText: function () {
        return input.value;
      },
      setText: function (t) {
        input.value = t || '';
        saveDraft();
        updateAdd();
      },
      focus: function () {
        _focus(input);
      },
      submit: submit,
      render: render,
      destroy: function () {
        _destroyed = true;
        document.removeEventListener('mousedown', onDocMousedown, true);
        root.removeEventListener('click', onClick);
        root.removeEventListener('change', onChange);
        root.removeEventListener('input', onInput);
        root.removeEventListener('keydown', onKeydown);
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    };
  }

  /* ── A dialog holding the strip (gradebook cell menu) ───── */
  var _dialog = null;
  function closeDialog() {
    if (!_dialog) return;
    var d = _dialog;
    _dialog = null;
    d.capture.destroy();
    document.removeEventListener('keydown', d.onKey, true);
    if (d.overlay.parentNode) d.overlay.parentNode.removeChild(d.overlay);
    if (d.returnFocus && typeof d.returnFocus.focus === 'function') d.returnFocus.focus();
  }

  /* opts: create() options plus title, subtitle, onClose. */
  function openDialog(opts) {
    closeDialog();
    opts = opts || {};
    var overlay = document.createElement('div');
    overlay.className = 'obsc-dialog-overlay';
    overlay.innerHTML =
      '<div class="obsc-dialog" role="dialog" aria-modal="true" aria-labelledby="obsc-dialog-title">' +
      '<div class="obsc-dialog-head"><div><div class="obsc-dialog-title" id="obsc-dialog-title">' +
      _esc(opts.title || 'Add observation') +
      '</div>' +
      (opts.subtitle ? '<div class="obsc-dialog-sub">' + _esc(opts.subtitle) + '</div>' : '') +
      '</div><button type="button" class="obsc-dialog-close" aria-label="Close">✕</button></div>' +
      '<div class="obsc-dialog-body"></div></div>';
    var userOnAdd = opts.onAdd;
    var userOnFlag = opts.onFlag;
    var capture = create(
      Object.assign({}, opts, {
        idPrefix: opts.idPrefix || 'dlg-',
        onAdd: function (info) {
          if (typeof userOnAdd === 'function') userOnAdd(info);
          // Stay open to offer the flag; otherwise the job is done.
          var st = capture.getState();
          if (!st.flagOffer.length && info.ok) closeDialog();
        },
        onFlag: function (sid) {
          if (typeof userOnFlag === 'function') userOnFlag(sid);
          if (!capture.getState().flagOffer.length) closeDialog();
        },
      }),
    );
    capture.mount(overlay.querySelector('.obsc-dialog-body'));
    var d = {
      overlay: overlay,
      capture: capture,
      returnFocus: document.activeElement,
      onKey: function (e) {
        if (e.key === 'Escape' && !capture.getState().menu && !capture.getState().suggest) {
          e.preventDefault();
          closeDialog();
          if (typeof opts.onClose === 'function') opts.onClose();
        }
      },
    };
    // A modal: keys typed in it are not page shortcuts.
    overlay.addEventListener('keydown', function (e) {
      e.stopPropagation();
    });
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) {
        closeDialog();
        if (typeof opts.onClose === 'function') opts.onClose();
      }
    });
    overlay.querySelector('.obsc-dialog-close').addEventListener('click', function () {
      closeDialog();
      if (typeof opts.onClose === 'function') opts.onClose();
    });
    document.addEventListener('keydown', d.onKey, true);
    document.body.appendChild(overlay);
    _dialog = d;
    capture.focus();
    return capture;
  }

  return {
    create: create,
    openDialog: openDialog,
    closeDialog: closeDialog,
    linkPillsHtml: linkPillsHtml,
    tagMenuItems: tagMenuItems,
    competencyItems: competencyItems,
    competencyLabel: competencyLabel,
    levelLabel: levelLabel,
    starterList: starterList,
    _helpers: {
      starterText: starterText,
      matchStarters: matchStarters,
      applyStarter: applyStarter,
      insertText: insertText,
      parseShorthand: parseShorthand,
      tokenAt: tokenAt,
      matchStudents: matchStudents,
      matchTags: matchTags,
      matchTypes: matchTypes,
      defaultAssessmentId: defaultAssessmentId,
      studentList: studentList,
      drafts: _drafts,
    },
  };
})();
