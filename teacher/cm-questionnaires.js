/* Class Management → Questionnaires tab (docs/STUDENT-VOICE-PLAN.md, PR 5;
   canvas screen 6b).

   One card per questionnaire: About Me at the start of the course, and the
   reporting period's Core Competency reflection with its Goal Check-In on
   the same slip. Each card says whether it is open, who has answered, and
   prints the QR slips. Show Questions opens the class's copy for editing;
   every change saves the whole questionnaire (teacher/questionnaires.js).

   DashClassManager renders the panel and hands over every sq* action,
   change and blur. */
var CmQuestionnaires = (function () {
  'use strict';

  var PERIOD_NAMES = { 1: 'November', 2: 'March', 3: 'June' };
  var _open = {}; // qid -> questions shown
  var _dates = {}; // qid -> the date editor's { opens, closes } while it is open
  var _grade = {}; // cid -> grade picked for a class with no single grade
  var _msg = {}; // qid or card key -> a line under the card's buttons
  var _saving = {}; // qid -> the save in flight, so saves go one at a time
  var _draft = {}; // qid -> a new question shown but not saved until it has words

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

  function _addDays(iso, n) {
    var t = new Date(iso + 'T12:00:00');
    t.setDate(t.getDate() + n);
    return (
      t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
    );
  }

  function _fmt(iso) {
    var t = new Date(iso + 'T12:00:00');
    return isNaN(t) ? iso : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
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

  /* How many questionnaires are on, for the tab's count (null until read). */
  function countOn(cid) {
    if (!Questionnaires.loaded(cid)) return null;
    // A report's Reply to Report is counted with the report, not here.
    return Questionnaires.list(cid).filter(function (q) {
      return q.is_on && !q.parent_id && q.kind !== 'report_reply';
    }).length;
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
    return { state: s.state, html: '<span class="sq-dot" style="background:' + color + '"></span>' + esc(s.text) };
  }

  function _fact(label, valueHtml, extra) {
    return '<div><span>' + esc(label) + '</span><strong>' + valueHtml + '</strong>' + (extra || '') + '</div>';
  }

  function _facts(cid, q, child) {
    var st = _status(q);
    var students = getStudents(cid);
    var done = {};
    (q.answered || []).forEach(function (id) {
      done[id] = true;
    });
    var answered = students.filter(function (s) {
      return done[s.id];
    }).length;
    var facts = [_fact('Status', st.html)];
    if (st.state === 'open' || st.state === 'closed') {
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
    } else {
      if (q.opens_on || q.closes_on) {
        facts.push(
          _fact(
            'Open',
            esc(
              q.opens_on && q.closes_on
                ? _fmt(q.opens_on) + ' to ' + _fmt(q.closes_on)
                : q.closes_on
                  ? 'Until ' + _fmt(q.closes_on)
                  : 'From ' + _fmt(q.opens_on),
            ),
          ),
        );
      }
      if (child && child.is_on) facts.push(_fact('On the Same Slip', esc(child.title || 'Goal Check-In')));
    }
    return '<div class="sq-facts">' + facts.join('') + '</div>';
  }

  function _notAnswered(cid, q) {
    var done = {};
    (q.answered || []).forEach(function (id) {
      done[id] = true;
    });
    return getStudents(cid).filter(function (s) {
      return !done[s.id];
    });
  }

  function _actions(cid, q) {
    var shown = !!_open[q.id];
    var left = _notAnswered(cid, q).length;
    var some = (q.answered || []).length > 0;
    var html =
      '<div class="sq-actions">' +
      '<button type="button" class="btn btn-primary" data-action="sqPrint" data-qid="' +
      q.id +
      '">Print QR Slips</button>' +
      (some && left
        ? '<button type="button" class="cm-action-btn" data-action="sqPrint" data-qid="' +
          q.id +
          '" data-missing="1">Print Slips for ' +
          left +
          ' Not Answered</button>'
        : '') +
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
      '">Change Dates</button>' +
      '</div>';
    var d = _dates[q.id];
    if (d) {
      html +=
        '<div class="sq-dates">' +
        '<label class="cm-field"><span class="cm-label">Opens</span><input type="date" class="cm-input" id="sq-opens-' +
        q.id +
        '" value="' +
        esc(d.opens || '') +
        '"></label>' +
        '<label class="cm-field"><span class="cm-label">Closes</span><input type="date" class="cm-input" id="sq-closes-' +
        q.id +
        '" value="' +
        esc(d.closes || '') +
        '"></label>' +
        '<button type="button" class="btn btn-primary" data-action="sqSaveDates" data-qid="' +
        q.id +
        '">Save Dates</button>' +
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
      '</span><span class="sq-type">Goal Check-In · on the same slip</span>' +
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
    var on = !!(q && q.is_on);
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
      '</div></div>' +
      _seg(opts.title, on, 'sqTurn', opts.segAttrs) +
      '</div>';
    if (q && on) {
      html += _facts(opts.cid, q, opts.child) + _actions(opts.cid, q);
      if (_open[q.id]) html += _editorHtml(opts.cid, q, opts.withSlip);
    } else if (_msg[opts.key]) {
      html += '<div class="sq-msg" role="status">' + esc(_msg[opts.key]) + '</div>';
    }
    return html + '</article>';
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
      desc = esc('Grade ' + grade + (theme ? ' theme: ' + theme : '') + ' · for Report ' + period);
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

  function render(cid) {
    if (!Questionnaires.loaded(cid)) {
      Questionnaires.load(cid, function (loadedCid) {
        if (loadedCid === cid) _rerender();
      });
      return '<div class="cm-section"><div class="cm-hint">Loading questionnaires…</div></div>';
    }
    var current = Questionnaires.periodFor(new Date());
    var reflections = Questionnaires.list(cid).filter(function (x) {
      return x.kind === 'core_reflection';
    });
    var periods = {};
    reflections.forEach(function (x) {
      if (x.report_period) periods[x.report_period] = x;
    });
    periods[current] = periods[current] || null;
    var cards = Object.keys(periods)
      .map(Number)
      .sort()
      .map(function (p) {
        return _reflectionCard(cid, p, periods[p]);
      });
    return (
      '<div class="cm-section sq-section" data-cid="' +
      esc(cid) +
      '">' +
      '<div class="sq-section-head"><div class="cm-section-title">Student Questionnaires</div>' +
      '<div class="cm-hint">Students scan their own QR slip and answer on their phone.</div></div>' +
      _aboutMeCard(cid) +
      cards.join('') +
      '</div>'
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
      closes_on: _addDays(today, kind === 'about_me' ? 7 : 13),
    };
    if (!spec.template_id && !spec.id) return;
    delete _msg[key];
    return Questionnaires.turnOn(cid, spec).then(function (q) {
      if (!q) {
        _msg[key] = 'Could not turn this on. Check the connection and try again.';
        _rerender();
        return;
      }
      // A new reflection brings its Goal Check-In, on the same slip.
      if (kind === 'core_reflection' && !spec.id) {
        return Questionnaires.turnOn(cid, {
          kind: 'goal_checkin',
          template_id: 'goal-checkin',
          report_period: period,
          parent_id: q.id,
          opens_on: q.opens_on,
          closes_on: q.closes_on,
        }).then(_rerender);
      }
      _rerender();
    });
  }

  function _print(cid, qid, missingOnly) {
    var q = _find(cid, qid);
    if (!q) return;
    var ids = missingOnly
      ? _notAnswered(cid, q).map(function (s) {
          return s.id;
        })
      : null;
    _msg[qid] = 'Making slips…';
    _rerender();
    return Questionnaires.issueCodes(cid, qid, ids).then(function (res) {
      var codes = (res && res.data) || [];
      if (!codes.length) {
        _msg[qid] =
          res && res.error
            ? 'Could not make the slips. Check the connection and try again.'
            : 'No students to make slips for.';
        _rerender();
        return;
      }
      delete _msg[qid];
      _rerender();
      QrSlips.print(cid, q, codes);
    });
  }

  function handleAction(action, el) {
    var cid = _cid(el);
    if (!cid) return false;
    var qid = el.dataset.qid;
    var q = qid ? _find(cid, qid) : null;
    var idx = el.dataset.idx != null ? Number(el.dataset.idx) : -1;
    switch (action) {
      case 'sqTurn':
        if (el.dataset.on === '1') {
          if (!q || !q.is_on) _turnOn(cid, el);
        } else if (q && q.is_on) {
          Questionnaires.setOn(cid, q.id, false).then(_rerender);
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
      case 'sqPrint':
        _print(cid, qid, el.dataset.missing === '1');
        return true;
      case 'sqToggleQuestions':
        _open[qid] = !_open[qid];
        _rerender();
        return true;
      case 'sqToggleDates':
        if (_dates[qid] || !q) delete _dates[qid];
        else _dates[qid] = { opens: q.opens_on || '', closes: q.closes_on || '' };
        delete _msg[qid];
        _rerender();
        return true;
      case 'sqSaveDates': {
        if (!q) return true;
        var opens = (document.getElementById('sq-opens-' + qid) || {}).value || null;
        var closes = (document.getElementById('sq-closes-' + qid) || {}).value || null;
        // Kept as typed, so a refusal doesn't wipe them.
        _dates[qid] = { opens: opens || '', closes: closes || '' };
        if (opens && closes && closes < opens) {
          _msg[qid] = 'The closing date comes before the opening date.';
          _rerender();
          return true;
        }
        delete _msg[qid];
        delete _dates[qid];
        var dates = { opens_on: opens, closes_on: closes };
        _save(cid, q, dates)
          .then(function () {
            var child = _child(cid, q);
            return child ? _save(cid, child, dates) : null;
          })
          .then(_rerender);
        _rerender();
        return true;
      }
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
        var rest = _questions(q).filter(function (x, i) {
          return i !== idx;
        });
        _save(cid, q, { questions: rest }).then(_rerender);
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
    var cid = _cid(el);
    if (!cid) return false;
    if (el.dataset.actionChange === 'sqGrade') {
      _grade[cid] = el.value ? Number(el.value) : null;
      _rerender();
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
  }

  return {
    render: render,
    countOn: countOn,
    handleAction: handleAction,
    handleChange: handleChange,
    handleBlur: handleBlur,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.CmQuestionnaires = CmQuestionnaires;
