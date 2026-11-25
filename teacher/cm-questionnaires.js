/* Class Settings → Reflect tab (docs/STUDENT-VOICE-PLAN.md, PR 5;
   docs/plans/reflect-plan.md, board 1). Code names keep "questionnaire".

   One card per reflection: About Me at the start of the course, the
   reporting period's Core Competency reflection with its Goal Check-In,
   and the reflections a teacher builds (kind custom). The switch is the
   gate: On puts a reflection in every student's Reflect tab until it is
   turned off or reaches its closing date, if it has one. Each card says
   who has answered and opens See Answers (teacher/cm-reflect-answers.js).
   Show Questions opens a ready-made one's questions for editing, where
   every change saves the whole questionnaire (shared/questionnaires.js);
   New Reflection and a teacher-built one open the builder
   (teacher/cm-reflect-builder.js).

   DashClassManager renders the panel and hands over every sq* action,
   change and blur; sqAns… go on to See Answers and sqB… to the builder. */
var CmQuestionnaires = (function () {
  'use strict';

  var PERIOD_NAMES = { 1: 'November', 2: 'March', 3: 'June' };
  var FRESH_MS = 15000;
  var _open = {}; // qid -> questions shown
  var _dates = {}; // qid -> the date editor's { opens, closes } while it is open
  var _grade = {}; // cid -> grade picked for a class with no single grade
  var _msg = {}; // qid or card key -> a line under the card's buttons
  var _saving = {}; // qid -> the save in flight, so saves go one at a time
  var _draft = {}; // qid -> a new question shown but not saved until it has words
  var _turning = {}; // card key -> true while a first turn-on saves, so the switch shows On at once
  var _answers = {}; // cid -> the reflection whose answers are shown in place of the list

  function _rerender() {
    if (typeof DashClassManager !== 'undefined' && DashClassManager.renderClassManager) {
      DashClassManager.renderClassManager();
    }
  }

  function _cid(el) {
    var box = el && el.closest ? el.closest('[data-cid]') : null;
    return box ? box.dataset.cid : null;
  }

  function _today() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function _builder() {
    return typeof CmReflectBuilder !== 'undefined' ? CmReflectBuilder : null;
  }

  function _answersView() {
    var a = typeof window !== 'undefined' ? window.CmReflectAnswers : null;
    return a && typeof a.render === 'function' ? a : null;
  }

  function _shortName(st) {
    var first = (st.preferred || st.firstName || '').trim();
    var last = (st.lastName || '').trim();
    return (first + (last ? ' ' + last.charAt(0) + '.' : '')).trim();
  }

  function _questions(q) {
    return ((q && q.questions) || []).filter(function (x) {
      return !x.archived;
    });
  }

  function _child(cid, q) {
    if (!q) return null;
    return Questionnaires.find(cid, function (x) {
      return x.kind === 'goal_checkin' && x.parent_id === q.id;
    });
  }

  /* How many reflections students can see now (null until
     read). Asks for the class's reflections when they have not been read:
     the Dashboard's old Core card used to read them first (removed in #1740).
     The tab no longer shows it. */
  function countOn(cid) {
    if (!cid) return null;
    if (!Questionnaires.loaded(cid)) {
      Questionnaires.load(cid, function (loadedCid) {
        if (loadedCid === cid) _arrived(cid);
      });
      // Demo Mode reads them at once.
      if (!Questionnaires.loaded(cid)) return null;
    }
    var today = _today();
    return Questionnaires.list(cid).filter(function (q) {
      return !q.parent_id && Questionnaires.visible(q, today);
    }).length;
  }

  /* The class's reflections arrived after Class Settings was drawn. On the
     Reflect tab the panel is drawn again, since it was showing Loading (or
     who has answered changed). On any other tab nothing is drawn: drawing
     all of Class Settings again there closed a menu the teacher had just
     opened (Class Actions, a student's row menu) a moment after they opened
     it. */
  function _arrived(cid) {
    var tab = typeof document !== 'undefined' ? document.getElementById('cm-tab-questionnaires') : null;
    if (!tab || tab.classList.contains('active')) _rerender();
  }

  /* On, as the switch shows it: on and not past its closing date. */
  function _isOn(q) {
    return !!q && !!q.is_on && Questionnaires.status(q, _today()).state !== 'closed';
  }

  /* ── Rendering ─────────────────────────────────────────────── */

  function _seg(label, on, action, attrs) {
    return (
      '<div class="seg seg-sm" role="radiogroup" aria-label="' +
      esc(label) +
      '">' +
      '<button type="button" class="seg-btn' +
      (on ? '' : ' active') +
      '" role="radio" aria-checked="' +
      !on +
      '" data-action="' +
      action +
      '" data-on="0"' +
      attrs +
      '>Off</button>' +
      '<button type="button" class="seg-btn' +
      (on ? ' active' : '') +
      '" role="radio" aria-checked="' +
      on +
      '" data-action="' +
      action +
      '" data-on="1"' +
      attrs +
      '>On</button></div>'
    );
  }

  function _status(q) {
    var s = Questionnaires.status(q, _today());
    var color = { open: 'var(--score-3)', upcoming: 'var(--score-2)', closed: 'var(--text-3)', off: 'var(--text-3)' }[
      s.state
    ];
    return {
      state: s.state,
      html: '<span class="sq-dot" style="background:' + color + '"></span>' + esc(s.text),
      until: s.until || '',
    };
  }

  function _fact(label, valueHtml, extra) {
    return '<div><span>' + esc(label) + '</span><strong>' + valueHtml + '</strong>' + (extra || '') + '</div>';
  }

  function _facts(cid, q) {
    var st = _status(q);
    var students = getStudents(cid);
    var done = {};
    (q.answered || []).forEach(function (id) {
      done[id] = true;
    });
    var answered = students.filter(function (s) {
      return done[s.id];
    }).length;
    var facts = [_fact('Status', st.html, st.until ? '<span class="sq-until">' + esc(st.until) + '</span>' : '')];
    var pct = students.length ? Math.round((answered / students.length) * 100) : 0;
    facts.push(
      _fact(
        'Answered',
        esc(answered + ' of ' + students.length),
        '<span class="sq-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></span>',
      ),
    );
    var missing = students
      .filter(function (s) {
        return !done[s.id];
      })
      .map(_shortName);
    // A few names to chase; past six, the count.
    var who = !missing.length
      ? 'No one'
      : !answered
        ? 'All ' + missing.length + ' students'
        : missing.length > 6
          ? missing.slice(0, 6).join(', ') + ' and ' + (missing.length - 6) + ' more'
          : missing.join(', ');
    facts.push(_fact('Not Answered', esc(who)));
    return '<div class="sq-facts">' + facts.join('') + '</div>';
  }

  /* The teacher's other classes, for Copy to Another Class. */
  function _otherClasses(cid) {
    if (typeof COURSES === 'undefined') return [];
    return Object.keys(COURSES)
      .filter(function (id) {
        return id !== cid && COURSES[id] && !COURSES[id].archived;
      })
      .map(function (id) {
        return COURSES[id];
      })
      .sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }

  // html-safe: class names are escaped; ids are the teacher's class ids, escaped too
  function _copyHtml(cid, q) {
    var others = _otherClasses(cid);
    if (!others.length) return '';
    return (
      '<select class="cm-input sq-copy" data-action-change="sqCopyTo" data-qid="' +
      q.id +
      '" aria-label="Copy to Another Class">' +
      '<option value="">Copy to Another Class…</option>' +
      others
        .map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.name || 'Class') + '</option>';
        })
        .join('') +
      '</select>'
    );
  }

  var ANSWERED_NO_DELETE =
    'Students have answered this, so it can\u2019t be deleted. Turn it off to take it out of their Reflect tab.';

  /* A teacher-built reflection's own buttons: edit, copy and Delete. Delete
     on one students have answered says why it can't be (the server keeps
     answers: it refuses). */
  function _customButtons(cid, q, withEdit) {
    return (
      (withEdit
        ? '<button type="button" class="cm-action-btn" data-action="sqEdit" data-qid="' +
          q.id +
          '">Edit Questions</button>'
        : '') +
      _copyHtml(cid, q) +
      '<button type="button" class="cm-action-btn" data-action="sqDelete" data-qid="' +
      q.id +
      '">Delete</button>'
    );
  }

  // See Answers, on any reflection the answers view can show.
  function _seeAnswersBtn(q) {
    return _answersView()
      ? '<button type="button" class="btn btn-primary" data-action="sqSeeAnswers" data-qid="' +
          q.id +
          '">See Answers</button>'
      : '';
  }

  function _actions(cid, q) {
    var shown = !!_open[q.id];
    var html =
      '<div class="sq-actions">' +
      _seeAnswersBtn(q) +
      '<button type="button" class="cm-action-btn" data-action="sqToggleQuestions" data-qid="' +
      q.id +
      '" aria-expanded="' +
      shown +
      '">' +
      (shown ? 'Hide Questions' : 'Show Questions') +
      '</button>' +
      '<button type="button" class="cm-action-btn" data-action="sqToggleDates" data-qid="' +
      q.id +
      '" aria-expanded="' +
      !!_dates[q.id] +
      '">' +
      (q.closes_on ? 'Change Closing Date' : 'Set a Closing Date') +
      '</button>' +
      (q.kind === 'custom' ? _customButtons(cid, q, false) : '') +
      '</div>';
    var d = _dates[q.id];
    if (d) {
      html +=
        '<div class="sq-dates">' +
        '<label class="cm-field"><span class="cm-label">Closes</span><input type="date" class="cm-input" id="sq-closes-' +
        q.id +
        '" value="' +
        esc(d.closes || '') +
        '"></label>' +
        '<button type="button" class="btn btn-primary" data-action="sqSaveDates" data-qid="' +
        q.id +
        '">Save Closing Date</button>' +
        (q.closes_on
          ? '<button type="button" class="cm-action-btn" data-action="sqClearDates" data-qid="' +
            q.id +
            '">No Closing Date</button>'
          : '') +
        '<button type="button" class="btn btn-ghost" data-action="sqToggleDates" data-qid="' +
        q.id +
        '">Cancel</button>' +
        '</div>';
    }
    if (_msg[q.id]) html += '<div class="sq-msg" role="status">' + esc(_msg[q.id]) + '</div>';
    return html;
  }

  var TYPE_LABELS = {
    text: 'Written answer',
    scale4: 'Self-assessment · Beginning to Leading, plus why',
    goal_status: 'Goal status · Not Started to Done',
    core_pick: 'Pick a Core Competency',
  };

  function _typeLabel(x) {
    var o = x.options || {};
    if (x.kind === 'short_set') return ((o.labels || []).length || 'Several') + ' short answers';
    if (x.kind === 'choice') return o.multiple === false ? 'Pick one' : 'Pick any';
    return TYPE_LABELS[x.kind] || 'Question';
  }

  function _coreChips(qid, idx, x) {
    var ids = x.core_ids || [];
    var chips = ids
      .map(function (id) {
        var c = getCoreCompetency(id);
        return (
          '<button type="button" class="stu-chip sq-chip" data-action="sqCoreRemove" data-qid="' +
          qid +
          '" data-idx="' +
          idx +
          '" data-core="' +
          esc(id) +
          '" aria-label="Remove ' +
          esc(c ? c.label : id) +
          '">' +
          esc(c ? c.label : id) +
          ' ×</button>'
        );
      })
      .join('');
    var left = CORE_COMPETENCIES.filter(function (c) {
      return ids.indexOf(c.id) < 0;
    });
    var add = left.length
      ? '<select class="cm-input sq-core-add" aria-label="Add a Core Competency" data-action-change="sqCoreAdd" data-qid="' +
        qid +
        '" data-idx="' +
        idx +
        '"><option value="">+ Add</option>' +
        left
          .map(function (c) {
            return '<option value="' + c.id + '">' + esc(c.label) + '</option>';
          })
          .join('') +
        '</select>'
      : '';
    return '<div class="sq-sub">Core Competencies: ' + chips + add + '</div>';
  }

  function _sub(qid, idx, x) {
    var o = x.options || {};
    if (x.kind === 'short_set' && (o.labels || []).length) {
      return '<div class="sq-sub">' + esc(o.labels.join(' · ')) + '</div>';
    }
    if (x.kind === 'choice' && (o.choices || []).length) {
      return '<div class="sq-sub">' + esc(o.choices.join(' · ')) + '</div>';
    }
    if (x.kind === 'scale4') return _coreChips(qid, idx, x);
    if (x.teacher_only) return '<div class="sq-sub">Only you see the answer.</div>';
    return '';
  }

  function _questionHtml(q, x, idx) {
    var id = 'sq-q-' + q.id + '-' + idx;
    return (
      '<li class="sq-q">' +
      '<div class="sq-q-head"><span class="sq-num">' +
      (idx + 1) +
      '</span><span class="sq-type">' +
      esc(_typeLabel(x)) +
      '</span><button type="button" class="cm-add-link sq-remove" data-action="sqRemoveQuestion" data-qid="' +
      q.id +
      '" data-idx="' +
      idx +
      '" aria-label="Remove question ' +
      (idx + 1) +
      '">Remove</button></div>' +
      '<label class="sq-vh" for="' +
      id +
      '">Question ' +
      (idx + 1) +
      '</label>' +
      '<textarea class="cm-input sq-text" id="' +
      id +
      '" rows="1" data-action-blur="sqPrompt" data-qid="' +
      q.id +
      '" data-idx="' +
      idx +
      '">' +
      esc(x.prompt || '') +
      '</textarea>' +
      _sub(q.id, idx, x) +
      '</li>'
    );
  }

  function _slipItemHtml(cid, q, child, n) {
    var on = !!(child && child.is_on);
    var tpl = Questionnaires.template('goal-checkin');
    var qs = child ? _questions(child) : tpl ? tpl.questions : [];
    return (
      '<li class="sq-q sq-q-slip">' +
      '<div class="sq-q-head"><span class="sq-num">' +
      n +
      '</span><span class="sq-type">Goal Check-In · asked with this reflection</span>' +
      '<span class="sq-slip-seg">' +
      _seg('Goal Check-In', on, 'sqGoalOn', ' data-qid="' + q.id + '"') +
      '</span></div>' +
      '<div class="sq-sub sq-sub-flat">' +
      esc(
        qs
          .map(function (x) {
            return x.prompt;
          })
          .join(' · '),
      ) +
      '</div>' +
      '</li>'
    );
  }

  function _draftHtml(q, idx) {
    var id = 'sq-q-' + q.id + '-' + idx;
    return (
      '<li class="sq-q">' +
      '<div class="sq-q-head"><span class="sq-num">' +
      (idx + 1) +
      '</span><span class="sq-type">Written answer</span>' +
      '<button type="button" class="cm-add-link sq-remove" data-action="sqRemoveDraft" data-qid="' +
      q.id +
      '">Remove</button></div>' +
      '<label class="sq-vh" for="' +
      id +
      '">Question ' +
      (idx + 1) +
      '</label>' +
      '<textarea class="cm-input sq-text" id="' +
      id +
      '" rows="1" data-action-blur="sqDraft" data-qid="' +
      q.id +
      '"></textarea>' +
      '</li>'
    );
  }

  function _editorHtml(cid, q, withSlip) {
    var qs = _questions(q);
    var n = qs.length + (_draft[q.id] ? 1 : 0);
    var html =
      '<div class="sq-qs"><ol class="sq-list">' +
      qs
        .map(function (x, i) {
          return _questionHtml(q, x, i);
        })
        .join('') +
      (_draft[q.id] ? _draftHtml(q, qs.length) : '') +
      (withSlip ? _slipItemHtml(cid, q, _child(cid, q), n + 1) : '') +
      '</ol>' +
      '<div><button type="button" class="cm-action-btn" data-action="sqAddQuestion" data-qid="' +
      q.id +
      '">+ Add Question</button></div>';
    if (q.kind === 'core_reflection') {
      html +=
        '<div class="cm-field"><label class="cm-label" for="sq-myed-' +
        q.id +
        '">MyEd Comment for Families</label>' +
        '<textarea class="cm-input sq-text" id="sq-myed-' +
        q.id +
        '" rows="4" data-action-blur="sqMyed" data-qid="' +
        q.id +
        '">' +
        esc(q.myed_comment || '') +
        '</textarea></div>';
    }
    return html + '<div class="cm-hint sq-hint">Changes apply to this class only.</div></div>';
  }

  function _card(opts) {
    var q = opts.q;
    var on = _isOn(q) || (!q && !!_turning[opts.key]);
    var st = q ? Questionnaires.status(q, _today()) : null;
    var closed = st && st.state === 'closed';
    var html =
      '<article class="sq-card' +
      (on ? '' : ' sq-off') +
      '" data-card="' +
      esc(opts.key) +
      '">' +
      '<div class="sq-head"><div class="sq-titles"><h3 class="sq-name">' +
      esc(opts.title) +
      '</h3><div class="sq-desc">' +
      opts.descHtml +
      (on ? '' : '<span class="sq-offnote"> · Students do not see this while it is off</span>') +
      '</div>' +
      (closed ? '<div class="sq-closed">' + esc(st.text) + '</div>' : '') +
      '</div>' +
      _seg(opts.title, on, 'sqTurn', opts.segAttrs) +
      '</div>';
    if (q && on) {
      html += _facts(opts.cid, q) + _actions(opts.cid, q);
      if (_open[q.id]) html += q.kind === 'custom' ? _customQuestionsHtml(q) : _editorHtml(opts.cid, q, opts.withSlip);
    } else {
      // Off or closed, what students wrote can still be read; a teacher's own can still be changed.
      var seen = q && (q.answered || []).length ? _seeAnswersBtn(q) : '';
      var own = q && q.kind === 'custom' ? _customButtons(opts.cid, q, true) : '';
      if (seen || own) html += '<div class="sq-actions">' + seen + own + '</div>';
      var m = _msg[opts.key] || (q && _msg[q.id]);
      if (m) html += '<div class="sq-msg" role="status">' + esc(m) + '</div>';
    }
    return html + '</article>';
  }

  /* A teacher-built reflection's questions as students see them; they
     change in the builder. */
  function _customQuestionsHtml(q) {
    var b = _builder();
    if (!b) return '';
    return (
      '<div class="sq-qs">' +
      b.previewHtml(q.questions) +
      '<div><button type="button" class="cm-action-btn" data-action="sqEdit" data-qid="' +
      q.id +
      '">Edit Questions</button></div></div>'
    );
  }

  function _customCard(cid, q) {
    var n = _questions(q).filter(function (x) {
      return x.kind !== 'section';
    }).length;
    return _card({
      cid: cid,
      key: 'custom-' + q.id,
      q: q,
      title: q.title || 'Reflection',
      descHtml: esc((q.theme ? q.theme + ' · ' : 'Your own · ') + n + ' question' + (n === 1 ? '' : 's')),
      segAttrs: ' data-kind="custom" data-qid="' + q.id + '"',
    });
  }

  function _aboutMeCard(cid) {
    var q = Questionnaires.find(cid, function (x) {
      return x.kind === 'about_me';
    });
    var qs = q ? _questions(q) : (Questionnaires.template('about-me') || {}).questions || [];
    var asked = qs.filter(function (x) {
      return !x.teacher_only;
    }).length;
    var note = qs.some(function (x) {
      return x.teacher_only;
    });
    return _card({
      cid: cid,
      key: 'about-me',
      q: q,
      title: (q && q.title) || 'About Me',
      descHtml: esc(
        'Start of course · ' +
          asked +
          ' question' +
          (asked === 1 ? '' : 's') +
          (note ? ' and a private note to you' : ''),
      ),
      segAttrs: ' data-kind="about_me" data-template="about-me"' + (q ? ' data-qid="' + q.id + '"' : ''),
    });
  }

  function _gradeFor(cid) {
    return Questionnaires.courseGrade(COURSES[cid]) || _grade[cid] || null;
  }

  function _reflectionCard(cid, period, q) {
    var grade = q && q.template_id ? Number((/^core-(\d+)-/.exec(q.template_id) || [])[1]) || null : _gradeFor(cid);
    var tpl = grade ? Questionnaires.reflectionTemplate(grade, period) : null;
    var theme = (q && q.theme) || (tpl && tpl.theme) || '';
    var desc;
    if (!grade) {
      desc =
        '<label class="sq-grade">Grade for the theme <select class="cm-input" data-action-change="sqGrade" aria-label="Grade for the theme">' +
        '<option value="">Choose</option>' +
        [8, 9, 10, 11, 12]
          .map(function (g) {
            return '<option value="' + g + '">Grade ' + g + '</option>';
          })
          .join('') +
        '</select></label>';
    } else {
      var child = _child(cid, q);
      desc = esc(
        'Grade ' +
          grade +
          (theme ? ' theme: ' + theme : '') +
          ' · for Report ' +
          period +
          (child && child.is_on ? ' · with Goal Check-In' : ''),
      );
    }
    var title = (q && q.title) || PERIOD_NAMES[period] + ' Reflection';
    return _card({
      cid: cid,
      key: 'core-' + period,
      q: q,
      child: _child(cid, q),
      withSlip: true,
      title: title,
      descHtml: desc,
      segAttrs:
        ' data-kind="core_reflection" data-period="' +
        period +
        '"' +
        (tpl ? ' data-template="' + tpl.id + '"' : '') +
        (q ? ' data-qid="' + q.id + '"' : '') +
        (grade ? '' : ' disabled'),
    });
  }

  /* What every draw of Class Settings asks for, on this tab or another:
     the class's questionnaires (the tab's count), and once read, a fresh
     read when they are old. False while they are not read yet. */
  function prepare(cid) {
    if (!Questionnaires.loaded(cid)) {
      Questionnaires.load(cid, function (loadedCid) {
        if (loadedCid === cid) _arrived(cid);
      });
      // Demo Mode reads the class's own copy at once, without a callback:
      // draw it now. (It used to be read already by the Dashboard's old Core
      // card, so the tab never waited; since #1740 nothing reads it first,
      // and the tab stayed on Loading.)
      if (!Questionnaires.loaded(cid)) return false;
    }
    // Answers sent since the last read show when the tab opens again,
    // redrawn only when who has answered changed.
    var answeredSig = function () {
      return Questionnaires.list(cid)
        .map(function (x) {
          return x.id + ':' + (x.answered || []).length + ':' + !!x.is_on;
        })
        .join('|');
    };
    var was = answeredSig();
    Questionnaires.refreshIfStale(cid, FRESH_MS, function (loadedCid) {
      if (loadedCid === cid && answeredSig() !== was) _arrived(cid);
    });
    return true;
  }

  function _section(cid, inner) {
    return '<div class="cm-section sq-section" data-cid="' + esc(cid) + '">' + inner + '</div>';
  }

  function render(cid) {
    if (!prepare(cid)) return '<div class="cm-section"><div class="cm-hint">Loading reflections…</div></div>';
    var b = _builder();
    if (b && b.isOpen(cid)) return _section(cid, b.render(cid));
    var ans = _answersView();
    var shown = _answers[cid] ? _find(cid, _answers[cid]) : null;
    if (ans && shown) {
      return _section(
        cid,
        // The view's own "‹ Reflections" (sqAnsBack) is the way back.
        '<div class="sq-answers">' + ans.render(cid, shown.id) + '</div>',
      );
    }
    delete _answers[cid];
    var current = Questionnaires.periodFor(new Date());
    var all = Questionnaires.list(cid);
    var periods = {};
    all.forEach(function (x) {
      if (x.kind === 'core_reflection' && x.report_period) periods[x.report_period] = x;
    });
    periods[current] = periods[current] || null;
    var cards = Object.keys(periods)
      .map(Number)
      .sort()
      .map(function (p) {
        return _reflectionCard(cid, p, periods[p]);
      });
    var custom = all
      .filter(function (x) {
        return x.kind === 'custom';
      })
      .sort(function (a, b) {
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      })
      .map(function (q) {
        return _customCard(cid, q);
      });
    return _section(
      cid,
      '<div class="sq-section-head"><div class="sq-section-titles"><div class="cm-section-title">Reflections</div>' +
        '<div class="cm-hint">Students open these from the Reflect tab after they sign in with their card. Turn one on to show it.</div></div>' +
        (b ? '<button type="button" class="btn btn-primary sq-new" data-action="sqNew">New Reflection</button>' : '') +
        '</div>' +
        _aboutMeCard(cid) +
        cards.join('') +
        custom.join(''),
    );
  }

  /* ── Changes ───────────────────────────────────────────────── */

  /* Saves the whole questionnaire after any save already going, so a new
     question is never sent twice. */
  function _save(cid, q, changes) {
    var prev = _saving[q.id] || Promise.resolve();
    var run = prev.then(function () {
      var cur =
        Questionnaires.find(cid, function (x) {
          return x.id === q.id;
        }) || q;
      return Questionnaires.save(cid, Object.assign({}, cur, { questions: _questions(cur) }, changes));
    });
    _saving[q.id] = run.catch(function () {});
    return run;
  }

  function _find(cid, qid) {
    return Questionnaires.find(cid, function (x) {
      return x.id === qid;
    });
  }

  /* On: today, with no closing date; one past its closing date opens
     again with none (Questionnaires.turnOn). A reflection's Goal Check-In
     keeps its dates. */
  function _turnOn(cid, el) {
    var key = el.closest('[data-card]') ? el.closest('[data-card]').dataset.card : '';
    var today = _today();
    var kind = el.dataset.kind;
    var period = el.dataset.period ? Number(el.dataset.period) : null;
    var spec = {
      id: el.dataset.qid || null,
      kind: kind,
      template_id: el.dataset.template,
      report_period: period,
      opens_on: today,
      closes_on: null,
    };
    if (!spec.template_id && !spec.id) return;
    delete _msg[key];
    if (spec.id) delete _msg[spec.id];
    // The switch shows On while it saves (the sync dot shows the save).
    _turning[key] = true;
    var saving = Questionnaires.turnOn(cid, spec, today);
    _rerender();
    return saving.then(function (q) {
      delete _turning[key];
      if (!q) {
        _msg[key] = 'Could not turn this on. Check the connection and try again.';
        _rerender();
        return;
      }
      var child = _child(cid, q);
      // A new reflection brings its Goal Check-In.
      if (kind === 'core_reflection' && !child) {
        return Questionnaires.turnOn(cid, {
          kind: 'goal_checkin',
          template_id: 'goal-checkin',
          report_period: period,
          parent_id: q.id,
          opens_on: q.opens_on,
          closes_on: q.closes_on,
        }).then(_rerender);
      }
      if (child && (child.closes_on || null) !== (q.closes_on || null)) {
        return _save(cid, child, { opens_on: q.opens_on, closes_on: q.closes_on || null }).then(_rerender);
      }
      _rerender();
    });
  }

  function _saveCloses(cid, q, closes) {
    delete _msg[q.id];
    delete _dates[q.id];
    var dates = { closes_on: closes || null };
    _save(cid, q, dates)
      .then(function () {
        var child = _child(cid, q);
        return child ? _save(cid, child, dates) : null;
      })
      .then(_rerender);
    _rerender();
  }

  function _delete(cid, q) {
    if ((q.answered || []).length) {
      _msg[q.id] = ANSWERED_NO_DELETE;
      _rerender();
      return;
    }
    var go = function () {
      delete _msg[q.id];
      Questionnaires.remove(cid, q.id).then(function (res) {
        if (res && res.deleted) delete _open[q.id];
        else if (res && res.refused) _msg[q.id] = ANSWERED_NO_DELETE;
        else _msg[q.id] = 'Could not delete this. Check the connection and try again.';
        _rerender();
      });
    };
    if (typeof showConfirm !== 'function') return go();
    showConfirm(
      'Delete This Reflection?',
      '\u201c' + (q.title || 'Reflection') + '\u201d is deleted from this class. This cannot be undone.',
      'Delete',
      'danger',
      go,
    );
  }

  function handleAction(action, el) {
    if (action === 'sqAnsBack') {
      var back = _cid(el);
      if (back) delete _answers[back];
      _rerender();
      return true;
    }
    if (/^sqAns/.test(action)) {
      var ans = _answersView();
      return ans && ans.handleAction ? ans.handleAction(action, el) !== false : false;
    }
    var b = _builder();
    if (/^sqB[A-Z]/.test(action)) return b ? b.handleAction(action, el) : false;
    var cid = _cid(el);
    if (!cid) return false;
    var qid = el.dataset.qid;
    var q = qid ? _find(cid, qid) : null;
    var idx = el.dataset.idx != null ? Number(el.dataset.idx) : -1;
    switch (action) {
      case 'sqTurn':
        if (el.dataset.on === '1') {
          if (!_isOn(q)) _turnOn(cid, el);
        } else if (_isOn(q)) {
          // setOn changes the copy at once; draw it now, not after the save.
          Questionnaires.setOn(cid, q.id, false).then(_rerender);
          _rerender();
        }
        return true;
      case 'sqGoalOn': {
        var child = _child(cid, q);
        var want = el.dataset.on === '1';
        if (child) {
          if (!!child.is_on !== want) Questionnaires.setOn(cid, child.id, want).then(_rerender);
        } else if (want && q) {
          Questionnaires.turnOn(cid, {
            kind: 'goal_checkin',
            template_id: 'goal-checkin',
            report_period: q.report_period,
            parent_id: q.id,
            opens_on: q.opens_on,
            closes_on: q.closes_on,
          }).then(_rerender);
        }
        return true;
      }
      case 'sqNew':
        if (!b) return true;
        b.open(cid, null);
        _rerender();
        return true;
      case 'sqEdit':
        if (!b || !q) return true;
        b.open(cid, q);
        _rerender();
        return true;
      case 'sqSeeAnswers':
        if (!q) return true;
        _answers[cid] = q.id;
        _rerender();
        return true;
      case 'sqDelete':
        if (q) _delete(cid, q);
        return true;
      case 'sqToggleQuestions':
        _open[qid] = !_open[qid];
        _rerender();
        return true;
      case 'sqToggleDates':
        if (_dates[qid] || !q) delete _dates[qid];
        else _dates[qid] = { closes: q.closes_on || '' };
        delete _msg[qid];
        _rerender();
        return true;
      case 'sqSaveDates': {
        if (!q) return true;
        var closes = (document.getElementById('sq-closes-' + qid) || {}).value || null;
        // Kept as typed, so a refusal doesn't wipe it.
        _dates[qid] = { closes: closes || '' };
        if (closes && closes < _today()) {
          _msg[qid] = 'That day has passed. Pick today or a later day.';
          _rerender();
          return true;
        }
        _saveCloses(cid, q, closes);
        return true;
      }
      case 'sqClearDates':
        if (q) _saveCloses(cid, q, null);
        return true;
      case 'sqAddQuestion': {
        if (!q) return true;
        _open[qid] = true;
        _draft[qid] = true;
        _rerender();
        var box = document.getElementById('sq-q-' + qid + '-' + _questions(q).length);
        if (box) box.focus();
        return true;
      }
      case 'sqRemoveDraft':
        delete _draft[qid];
        _rerender();
        return true;
      case 'sqRemoveQuestion': {
        if (!q || idx < 0) return true;
        var gone = _questions(q)[idx];
        if (!gone) return true;
        var rest = _questions(q).filter(function (x, i) {
          return i !== idx;
        });
        _save(cid, q, { questions: rest }).then(_rerender);
        // Undo puts it back in its place, with its id, so any answers to it
        // show under it again.
        if (typeof showUndoToast === 'function') {
          showUndoToast('Question ' + (idx + 1) + ' removed', function () {
            var cur = _find(cid, q.id);
            if (!cur) return;
            var back = _questions(cur).slice();
            back.splice(Math.min(idx, back.length), 0, gone);
            _save(cid, cur, { questions: back }).then(_rerender);
          });
        }
        return true;
      }
      case 'sqCoreRemove': {
        if (!q || idx < 0) return true;
        var list = _questions(q).map(function (x, i) {
          if (i !== idx) return x;
          return Object.assign({}, x, {
            core_ids: (x.core_ids || []).filter(function (c) {
              return c !== el.dataset.core;
            }),
          });
        });
        _save(cid, q, { questions: list }).then(_rerender);
        return true;
      }
    }
    return false;
  }

  function handleChange(el) {
    var ans = _answersView();
    var a = (el.dataset && el.dataset.actionChange) || '';
    if (
      ans &&
      ans.handleChange &&
      (/^sqAns/.test(a) || (el.closest && el.closest('.sq-answers'))) &&
      ans.handleChange(el)
    )
      return true;
    var b = _builder();
    if (b && /^sqB[A-Z]/.test(a)) return b.handleChange(el);
    var cid = _cid(el);
    if (!cid) return false;
    if (el.dataset.actionChange === 'sqGrade') {
      _grade[cid] = el.value ? Number(el.value) : null;
      _rerender();
      return true;
    }
    if (el.dataset.actionChange === 'sqCopyTo') {
      var to = el.value;
      el.selectedIndex = 0;
      var src = _find(cid, el.dataset.qid);
      if (!to || !src) return true;
      var name = (COURSES[to] && COURSES[to].name) || 'the other class';
      Questionnaires.copyTo(cid, src.id, to).then(function (row) {
        _msg[src.id] = row
          ? 'Copied to ' + name + '. It is off there until you turn it on.'
          : 'Could not copy this. Check the connection and try again.';
        _rerender();
      });
      return true;
    }
    if (el.dataset.actionChange === 'sqCoreAdd') {
      var q = _find(cid, el.dataset.qid);
      var idx = Number(el.dataset.idx);
      if (!q || !el.value) return true;
      var add = el.value;
      var list = _questions(q).map(function (x, i) {
        return i === idx ? Object.assign({}, x, { core_ids: (x.core_ids || []).concat([add]) }) : x;
      });
      _save(cid, q, { questions: list }).then(_rerender);
      return true;
    }
    return false;
  }

  /* A prompt or the MyEd comment saves when the box is left, without
     redrawing, so Tab moves on to the next box. A prompt left empty goes
     back to what it was; Remove takes a question out. */
  function handleBlur(el) {
    var kind = el.dataset.actionBlur;
    var b = _builder();
    if (b && kind === 'sqBField') return b.handleBlur(el);
    var ans = _answersView();
    if (ans && ans.handleBlur && /^sqAns/.test(kind || '')) return ans.handleBlur(el) !== false;
    if (kind !== 'sqPrompt' && kind !== 'sqMyed' && kind !== 'sqDraft') return false;
    var cid = _cid(el);
    var q = cid ? _find(cid, el.dataset.qid) : null;
    if (!q) return true;
    if (kind === 'sqDraft') {
      var words = el.value.trim();
      if (!words) return true;
      delete _draft[q.id];
      _save(cid, q, {
        questions: _questions(q).concat([
          { kind: 'text', prompt: words, options: {}, core_ids: [], teacher_only: false, prompt_translations: {} },
        ]),
      }).then(_rerender);
      return true;
    }
    if (kind === 'sqMyed') {
      if ((q.myed_comment || '') !== el.value) _save(cid, q, { myed_comment: el.value });
      return true;
    }
    var idx = Number(el.dataset.idx);
    var qs = _questions(q);
    if (!qs[idx] || (qs[idx].prompt || '') === el.value) return true;
    if (!el.value.trim()) {
      el.value = qs[idx].prompt || '';
      return true;
    }
    var next = qs.map(function (x, i) {
      return i === idx ? Object.assign({}, x, { prompt: el.value }) : x;
    });
    _save(cid, q, { questions: next });
    return true;
  }

  function _reset() {
    _open = {};
    _dates = {};
    _grade = {};
    _msg = {};
    _saving = {};
    _draft = {};
    _turning = {};
    _answers = {};
    if (_builder()) _builder()._reset();
  }

  return {
    prepare: prepare,
    render: render,
    countOn: countOn,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.CmQuestionnaires = CmQuestionnaires;
