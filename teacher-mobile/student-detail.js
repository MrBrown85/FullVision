/* student-detail.js — Mobile student detail rendering helpers */
window.MStudentDetail = (function () {
  'use strict';

  var MC = window.MComponents;

  function _assessmentBadgeData(cid, assessment) {
    var categoryId = getAssessmentCategoryId(assessment);
    return {
      label: getAssessmentCategoryName(cid, assessment),
      className:
        categoryId || (assessment && assessment.type === 'summative') ? 'm-type-summative' : 'm-type-formative',
    };
  }

  function _renderSectionCard(cid, sid, sec) {
    var prof = getSectionProficiency(cid, sid, sec.id);
    var profRounded = roundLevel(prof);
    // The arrow and the Improving / Dropped line read the same change: the
    // counted evidence's first and last levels (calc.js evidenceChange).
    var change = evidenceChange(sectionCountedEvidence(cid, sid, sec.id));
    var trend = change && change.dir > 0 ? 'up' : change && change.dir < 0 ? 'down' : 'flat';
    var trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—';
    var trendColor = trend === 'up' ? 'var(--score-3)' : trend === 'down' ? 'var(--score-1)' : 'var(--text-3)';
    // The last five points, as the timeline below lists the last five
    // scores: a whole sparkline fits the header at phone width.
    var growthData = getSectionGrowthData(cid, sid, sec.id);
    var sparkline = renderGrowthSparkline((growthData || []).slice(-5));
    var allAssessments = getAssessments(cid);
    var allEvidenceScores = [];
    sec.tags.forEach(function (tag) {
      getTagScores(cid, sid, tag.id).forEach(function (s) {
        if (s.score > 0) allEvidenceScores.push(s);
      });
    });
    allEvidenceScores.sort(function (a, b) {
      return (a.date || '').localeCompare(b.date || '') || samePieceDateOrder(cid, a.assessmentId, b.assessmentId);
    });
    var recentScores = allEvidenceScores.slice(-5);

    var timelineHtml = '';
    if (recentScores.length === 0) {
      timelineHtml = '<div class="m-sec-empty">No evidence scored yet</div>';
    } else {
      timelineHtml = '<div class="m-sec-timeline">';
      recentScores.forEach(function (s) {
        var assess = allAssessments.find(function (a) {
          return a.id === s.assessmentId;
        });
        var assessName = assess ? MC.esc(assess.title) : '';
        var shortDate = new Date(s.date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        timelineHtml +=
          '<div class="m-sec-tl-item">' +
          '<div class="m-sec-tl-dot" style="background:' +
          MC.profBg(s.level || s.score) +
          '">' +
          (s.level ? formatScoreLevel(s.level, s.mod) : s.score) +
          '</div>' +
          '<div class="m-sec-tl-info">' +
          '<div class="m-sec-tl-name">' +
          assessName +
          '</div>' +
          '<div class="m-sec-tl-date">' +
          shortDate +
          ' · ' +
          PROF_LABELS[roundLevel(s.score)] +
          '</div>' +
          '</div>' +
          '</div>';
      });
      timelineHtml += '</div>';
    }

    var insightHtml = '';
    if (change) {
      if (change.same) {
        insightHtml =
          '<div class="m-sec-insight">Consistently <strong>' +
          PROF_LABELS[change.first] +
          '</strong> across ' +
          change.count +
          ' assessments</div>';
      } else if (change.dir > 0) {
        insightHtml =
          '<div class="m-sec-insight m-sec-insight-up">Improving from <strong>' +
          PROF_LABELS[change.first] +
          '</strong> → <strong>' +
          PROF_LABELS[change.last] +
          '</strong></div>';
      } else if (change.dir < 0) {
        insightHtml =
          '<div class="m-sec-insight m-sec-insight-down">Dropped from <strong>' +
          PROF_LABELS[change.first] +
          '</strong> → <strong>' +
          PROF_LABELS[change.last] +
          '</strong></div>';
      }
    } else if (allEvidenceScores.length === 0) {
      var secTagIds = new Set(
        sec.tags.map(function (t) {
          return t.id;
        }),
      );
      var secAssessments = allAssessments.filter(function (a) {
        return (a.tagIds || []).some(function (tid) {
          return secTagIds.has(tid);
        });
      });
      // Work the teacher marked Missing or Excused says so; only the rest
      // is "not yet scored".
      var statuses = getAssignmentStatuses(cid);
      var by = { NS: 0, EXC: 0, open: 0 };
      secAssessments.forEach(function (a) {
        var st = statuses[sid + ':' + a.id];
        by[st === 'NS' || st === 'EXC' ? st : 'open']++;
      });
      var lines = [];
      var n = function (k) {
        return by[k] + (by[k] === 1 ? ' assessment' : ' assessments');
      };
      if (by.NS) lines.push(n('NS') + ' marked Missing');
      if (by.EXC) lines.push(n('EXC') + ' marked Excused');
      if (by.open) lines.push(n('open') + ' assigned but not yet scored');
      if (lines.length) {
        insightHtml = '<div class="m-sec-insight m-sec-insight-alert">' + lines.join('<br>') + '</div>';
      }
    }

    return (
      '<div class="m-section-card" role="button" tabindex="0" aria-expanded="false" data-action="m-toggle-section" data-sec="' +
      sec.id +
      '">' +
      '<div class="m-section-header">' +
      '<div class="m-section-dot" style="background:' +
      cssColor(sec.color || '#888') +
      '"></div>' +
      '<div class="m-section-name">' +
      MC.esc(sec.shortName || sec.name) +
      '</div>' +
      sparkline +
      '<span class="m-section-trend" style="color:' +
      trendColor +
      '">' +
      trendIcon +
      '</span>' +
      '<span class="m-section-prof" style="color:' +
      MC.profBg(profRounded) +
      '">' +
      formatLevel(cid, prof) +
      '</span>' +
      '</div>' +
      '<div class="m-section-detail">' +
      _secNowHtml(cid, sid, sec, prof) +
      timelineHtml +
      insightHtml +
      '</div>' +
      '</div>'
    );
  }

  /* Where the student is now and the next step (Nov 2 mockup, batch 2), at
     the top of an opened competency, as the desktop student page has it:
     the level's descriptor and the next step toward the level above
     (CompetencyWording). The level word follows the class's grading style.
     A bank competency's wording loads the first time and fills in place. */
  var _bankAsked = false;
  // The class last drawn, for the refresh once the bank's wording lands.
  var _nowCid = null;
  function _secNowHtml(cid, sid, sec, prof) {
    _nowCid = cid;
    var tag = sec && sec.tags ? sec.tags[0] : null;
    if (!(prof > 0) || !tag || !window.CompetencyWording) return '';
    var l = CompetencyWording.lines(tag, Math.max(1, Math.min(4, roundLevel(prof))));
    if (!l || (!l.descriptor && !l.next)) return '';
    if (!l.ready && !_bankAsked) {
      _bankAsked = true;
      CompetencyWording.loadBank().then(function (ok) {
        if (!ok) {
          _bankAsked = false;
          return;
        }
        var at = _nowCid;
        document.querySelectorAll('.m-section-card[data-sec] .m-sec-now').forEach(function (box) {
          var card = box.closest('.m-section-card');
          var s = (getSections(at) || []).find(function (x) {
            return x.id === card.getAttribute('data-sec');
          });
          var sid = box.getAttribute('data-sid');
          if (!s || !sid) return;
          // html-safe: _secNowHtml escapes the level word, descriptor and step (MC.esc)
          box.outerHTML = _secNowHtml(at, sid, s, getSectionProficiency(at, sid, s.id));
        });
      });
    }
    var word = typeof levelWord === 'function' ? levelWord(cid, prof) : '';
    return (
      '<div class="m-sec-now" data-sid="' +
      MC.esc(sid) +
      '">' +
      (l.descriptor
        ? '<div><b>Now' + (word ? ' \u00b7 ' + MC.esc(word) : '') + ':</b> ' + MC.esc(l.descriptor) + '</div>'
        : '') +
      (l.next ? '<div><b>Next step:</b> ' + MC.esc(l.next) + '</div>' : '') +
      '</div>'
    );
  }

  /* ── Tabs: as on the desktop student page, where Goals is part of the
     Learner Profile. (Evidence is the phone's name for Observations,
     Observations decision 6; the desktop's Grade Breakdown stays there.) */
  var TABS = [
    { id: 'comps', label: 'Competencies' },
    { id: 'assess', label: 'Assessments' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'profile', label: 'Learner Profile' },
  ];
  // Shared with the desktop page: the tab last opened on this device.
  var TAB_KEY = 'gb-student-tab';

  function _isTab(id) {
    return TABS.some(function (t) {
      return t.id === id;
    });
  }

  function savedTab() {
    try {
      var t = localStorage.getItem(TAB_KEY);
      // The old Goals tab, and the desktop's Goals and Reflections, are in
      // the Learner Profile now.
      if (t === 'goals' || t === 'reflections') t = 'profile';
      return _isTab(t) ? t : 'comps';
    } catch (e) {
      return 'comps';
    }
  }

  function _obDay(ob) {
    return (ob && (ob.date || (ob.created || '').slice(0, 10))) || '';
  }

  function _obsInTerm(ob, term) {
    if (!term || !term.startsOn || !term.endsOn) return true;
    var d = _obDay(ob).slice(0, 10);
    return !!d && d >= term.startsOn && d <= term.endsOn;
  }

  function _shortDay(dateStr) {
    if (!dateStr) return '';
    var d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  /* One assessment's score as the gradebook shows it: 65/80 · 81%, 3.3. */
  function _cellText(cell, a) {
    if (cell.kind === 'points') {
      var max = a.maxPoints || 100;
      return formatPoints(cell.value) + '/' + formatPoints(max) + ' · ' + formatPointsPercent(cell.value, max);
    }
    return cell.text;
  }

  function _tabBar(tabs, active) {
    return (
      '<div class="m-st-tabs" role="tablist" aria-label="Student details">' +
      tabs
        .map(function (t) {
          var on = t.id === active;
          return (
            '<button type="button" role="tab" class="m-st-tab' +
            (on ? ' active' : '') +
            '" data-action="m-student-tab" data-tab="' +
            t.id +
            '" aria-selected="' +
            on +
            '" aria-controls="m-st-panel-' +
            t.id +
            '"><span class="m-st-tab-label">' +
            MC.esc(t.label) +
            '</span><span class="m-st-tab-stat">' +
            MC.esc(t.stat) +
            '</span></button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function _panel(id, active, html) {
    return (
      '<div class="m-st-panel" id="m-st-panel-' +
      id +
      '" role="tabpanel" data-tab="' +
      id +
      '"' +
      (id === active ? '' : ' hidden') +
      '>' +
      html +
      '</div>'
    );
  }

  /* The strip scrolls sideways on a narrow phone: keep the open tab in view. */
  function scrollActiveTab(root) {
    var strip = root && root.querySelector ? root.querySelector('.m-st-tabs') : null;
    var on = strip && strip.querySelector('.m-st-tab.active');
    if (!on || strip.scrollWidth <= strip.clientWidth) return;
    var left = on.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + on.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = left - (strip.clientWidth - on.offsetWidth) / 2;
    }
  }

  /* ── The student's own words (questionnaires) ─────────────── */
  function _voiceDay(iso) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }
  function _coreLabel(id) {
    var c = typeof getCoreCompetency === 'function' ? getCoreCompetency(id) : null;
    return c ? c.label : id;
  }
  // An answer as plain text: the words, a list, or each competency's step.
  function _answerText(q, v) {
    if (!v) return '';
    if (q.kind === 'scale4') {
      var j = v.json || {};
      var levels = j.levels || {};
      var why = j.why && typeof j.why === 'object' ? j.why : {};
      var steps = typeof CONFIDENCE_LABELS !== 'undefined' ? CONFIDENCE_LABELS : {};
      var ids = (q.core_ids || []).length ? q.core_ids : Object.keys(levels);
      return ids
        .filter(function (k) {
          return levels[k] || why[k];
        })
        .map(function (k) {
          return _coreLabel(k) + ': ' + (steps[levels[k]] || 'No step') + (why[k] ? '. ' + why[k] : '');
        })
        .join('\n');
    }
    if (q.kind === 'core_pick' && v.text) return _coreLabel(String(v.text).trim());
    if (Array.isArray(v.json))
      return v.json
        .filter(function (x) {
          return String(x || '').trim();
        })
        .join(', ');
    if (v.text != null && String(v.text).trim()) return String(v.text);
    return v.num != null ? String(v.num) : '';
  }
  function _qaHtml(items) {
    return items
      .map(function (it) {
        var t = _answerText(it.q, it.v);
        if (!t) return '';
        return (
          '<div class="m-st-goal-label">' +
          MC.esc(it.q.prompt || '') +
          '</div><div class="m-st-goal-text m-st-voice-text">' +
          MC.esc(t) +
          '</div>'
        );
      })
      .join('');
  }

  /* { goals, words }: the student's own goals (course goal with its
     check-in, Core Competency goal), and About Me with each reflection.
     The answers load once per class; the panels redraw when they arrive. */
  // html-safe: prompts, answers, names and titles go through MC.esc.
  function _voiceHtml(cid, sid, firstName) {
    var out = { goals: '', words: '' };
    if (typeof StudentVoice === 'undefined') return out;
    if (!StudentVoice.loaded(cid)) {
      StudentVoice.load(cid, function () {
        refreshPanels(cid, ['profile']);
      });
      if (!StudentVoice.loaded(cid)) return out;
    }
    var list = StudentVoice.entries(cid, sid);
    var model = StudentVoice.profile(list);
    var first = MC.esc(firstName);
    var from = function (at) {
      return 'From ' + first + (at ? ' · ' + MC.esc(_voiceDay(at)) : '');
    };
    var a = model.about;
    var c = model.checkin;
    var course = (COURSES[cid] && COURSES[cid].name) || 'Course';
    var goals = '';
    if ((a && a.goal && a.goal.v) || (c && c.status && c.status.v)) {
      goals +=
        '<div class="m-st-goal"><div class="m-st-goal-name">' +
        MC.esc(course + ' Goal') +
        '</div>' +
        (a && a.goal && a.goal.v
          ? '<div class="m-st-goal-label">' +
            from(a.at) +
            '</div><div class="m-st-goal-text m-st-voice-text">' +
            MC.esc(_answerText(a.goal.q, a.goal.v)) +
            '</div>'
          : '') +
        (c && c.status && c.status.v
          ? '<div class="m-st-goal-label">Check-In · ' +
            MC.esc(_voiceDay(c.at)) +
            '</div><div class="m-st-goal-text">' +
            MC.esc(_answerText(c.status.q, c.status.v)) +
            (c.next && c.next.v ? ' · ' + MC.esc(_answerText(c.next.q, c.next.v)) : '') +
            '</div>'
          : '') +
        '</div>';
    }
    if (c && c.core && c.core.v) {
      goals +=
        '<div class="m-st-goal"><div class="m-st-goal-name">Core Competency Goal · ' +
        MC.esc(_answerText(c.core.q, c.core.v)) +
        '</div><div class="m-st-goal-label">' +
        from(c.at) +
        '</div><div class="m-st-goal-text m-st-voice-text">' +
        (c.coreGoal && c.coreGoal.v
          ? MC.esc(_answerText(c.coreGoal.q, c.coreGoal.v))
          : '<span class="m-st-muted">No answer</span>') +
        '</div></div>';
    }
    if (goals)
      out.goals =
        '<div class="m-list-inset-header">' + first + '’s Own Goals</div><div class="m-st-list">' + goals + '</div>';

    var words = '';
    if (a) {
      var aboutQa = _qaHtml(
        [a.say, a.languages, a.learns, a.goodAt, a.hard, a.outside]
          .concat(a.rest || [], [a.note])
          .filter(function (it) {
            return it && it.v;
          }),
      );
      if (aboutQa)
        words +=
          '<div class="m-st-goal"><div class="m-st-goal-name">About Me</div><div class="m-st-goal-label">' +
          from(a.at) +
          '</div>' +
          aboutQa +
          '</div>';
    }
    model.reflections.forEach(function (e) {
      var qa = _qaHtml(e.items);
      if (!qa) return;
      words +=
        '<div class="m-st-goal"><div class="m-st-goal-name">' +
        MC.esc(e.title || 'Reflection') +
        '</div><div class="m-st-goal-label">' +
        from(e.at) +
        '</div>' +
        qa +
        '</div>';
    });
    out.words =
      '<div class="m-list-inset-header">In ' +
      first +
      '’s Words</div><div class="m-st-list">' +
      (words || '<div class="m-st-goal"><div class="m-st-muted">No answers from ' + first + ' yet.</div></div>') +
      '</div>';
    return out;
  }

  /* Show one tab of the student screen that holds `el`. */
  function selectTab(el, id) {
    if (!_isTab(id)) return;
    var screen = el && el.closest ? el.closest('.m-screen') : null;
    if (!screen) return;
    screen.querySelectorAll('.m-st-tab').forEach(function (b) {
      var on = b.getAttribute('data-tab') === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    screen.querySelectorAll('.m-st-panel').forEach(function (p) {
      p.hidden = p.getAttribute('data-tab') !== id;
    });
    scrollActiveTab(screen);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch (e) {
      /* not remembered */
    }
  }

  // html-safe: names, titles, goals, reflections and observation text go through MC.esc; colours through cssColor or constants; grades come from calc.js; MObserve.cardHtml and obsPrivateLabelHtml are checked.
  function renderDetail(opts) {
    var cid = opts.cid;
    var sid = opts.sid;
    var renderBadges = opts.renderBadges;
    var students = getStudents(cid);
    var st = students.find(function (s) {
      return s.id === sid;
    });
    if (!st) return '<div class="m-screen"><div class="m-empty">Student not found</div></div>';

    var name = displayName(st);
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var overall = getOverallProficiency(cid, sid);
    var rounded = roundLevel(overall);
    // The overall grade as the class is set to grade (level, letter, or both).
    var grade = studentGradeSummary(cid, sid);
    var gradeText = grade.text || '—';
    var nav = MC.navBar({ id: 'student-detail', title: name, backLabel: 'Students' });
    // Each designation by its code and name ("P Gifted"), as the desktop
    // header shows them, then the IEP / MOD / ELL badges.
    var desPills = (st.designations || [])
      .filter(function (code) {
        return typeof BC_DESIGNATIONS !== 'undefined' && BC_DESIGNATIONS[code];
      })
      .map(function (code) {
        return '<span class="m-badge m-badge-des">' + MC.esc(code + ' ' + BC_DESIGNATIONS[code].name) + '</span>';
      })
      .join('');
    var badges = desPills + renderBadges(st);

    var hero =
      '<div class="m-hero">' +
      '<div class="m-hero-avatar" style="background:' +
      color +
      '">' +
      MC.esc(initials) +
      '</div>' +
      '<div class="m-hero-name">' +
      MC.esc(name) +
      '</div>' +
      (st.pronouns ? '<div class="m-hero-pronouns">' + MC.esc(st.pronouns) + '</div>' : '') +
      (badges ? '<div class="m-hero-badges">' + badges + '</div>' : '') +
      '<div class="m-hero-prof' +
      (gradeText.length > 4 ? ' m-hero-grade-pill' : '') +
      '" style="background:' +
      MC.profBg(grade.level) +
      '">' +
      MC.esc(gradeText) +
      '</div>' +
      '<div class="m-hero-prof-label">' +
      (courseGradeMode(cid) === 'letter' ? 'Course grade' : PROF_LABELS[rounded] || 'No Evidence') +
      '</div>' +
      '</div>';

    // The assessed competencies below Proficient, weakest first.
    var focusAreas = getFocusAreas(cid, sid, 3).filter(function (f) {
      return f.prof > 0 && printedLevel(f.prof) < 3;
    });
    var focusHTML = '';
    if (focusAreas.length) {
      focusHTML = '<div class="m-list-inset-header">Focus Areas</div>';
      focusAreas.forEach(function (f) {
        var secColor = f.section ? f.section.color : '#888';
        var label = f.tag.label || f.tag.name || f.tag.shortName || f.tag.code || '';
        focusHTML +=
          '<div class="m-focus-row">' +
          '<span class="m-section-dot" style="background:' +
          cssColor(secColor) +
          '"></span>' +
          '<span class="m-focus-name">' +
          MC.esc(label) +
          '</span>' +
          '<span class="m-focus-prof" style="color:' +
          MC.profBg(roundLevel(f.prof)) +
          '">' +
          formatLevel(cid, f.prof, 'No evidence') +
          '</span>' +
          '</div>';
      });
    }

    var grouped = getGroupedSections(cid);
    var sectionCards = '';
    if (grouped.groups.length) {
      grouped.groups.forEach(function (gi) {
        if (!gi.sections.length) return;
        var groupProf = getGroupProficiency(cid, sid, gi.group.id);
        var groupRounded = roundLevel(groupProf);
        var groupNote = folderAverageNote(cid, gi.group);
        sectionCards +=
          '<div class="m-group-header">' +
          '<span class="m-group-name">' +
          MC.esc(gi.group.label || gi.group.name) +
          (groupNote ? '<span class="m-group-note">' + MC.esc(groupNote) + '</span>' : '') +
          '</span>' +
          '<span class="m-group-prof" style="color:' +
          MC.profBg(groupRounded) +
          '">' +
          formatLevel(cid, groupProf) +
          '</span>' +
          '</div>';
        gi.sections.forEach(function (sec) {
          sectionCards += _renderSectionCard(cid, sid, sec);
        });
      });
      if (grouped.ungrouped.length) {
        grouped.ungrouped.forEach(function (sec) {
          sectionCards += _renderSectionCard(cid, sid, sec);
        });
      }
    } else {
      getSections(cid).forEach(function (sec) {
        sectionCards += _renderSectionCard(cid, sid, sec);
      });
    }

    // Everything below follows the class's chosen reporting term.
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var inTerm = function (a) {
      return typeof assessmentInYearToDate !== 'function' || assessmentInYearToDate(cid, a);
    };
    var sections = getSections(cid);
    var statuses = getAssignmentStatuses(cid);
    var termAssess = getAssessments(cid)
      .filter(inTerm)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    var cells = termAssess.map(function (a) {
      return { a: a, cell: assessmentCellValue(cid, sid, a) };
    });
    // A deleted one waiting on its Undo is already gone from the list.
    var obs = getStudentQuickObs(cid, sid).filter(function (o) {
      return _obsInTerm(o, term) && !(window.MObserve && MObserve.isPending && MObserve.isPending(o.id));
    });

    // Assessments
    var scoredN = MC.scoredAssessmentCount(cid, sid);
    var nsN = termAssess.filter(function (a) {
      return statuses[sid + ':' + a.id] === 'NS';
    }).length;
    var assessHtml = '';
    if (nsN) assessHtml += '<div class="m-st-note m-st-note-warn">' + nsN + ' missing</div>';
    if (!cells.length) {
      assessHtml +=
        '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No assessments yet</div></div>';
    }
    cells.forEach(function (c) {
      var a = c.a;
      var badge = _assessmentBadgeData(cid, a);
      var status = statuses[sid + ':' + a.id];
      var toward = [];
      (a.tagIds || []).forEach(function (tid) {
        var tag = getTagById(cid, tid);
        var name = tag ? tag.label || tag.shortName || tag.code || '' : '';
        if (name && toward.indexOf(name) < 0) toward.push(name);
      });
      // Tapping a row opens that assessment's grading screen on this student.
      assessHtml +=
        '<div class="m-assess-compact" role="button" tabindex="0" data-action="m-assess-grade" data-sid="' +
        MC.esc(sid) +
        '" data-aid="' +
        MC.esc(a.id) +
        '" aria-label="Grade ' +
        MC.esc(a.title) +
        '">' +
        '<div class="m-assess-top">' +
        '<span class="m-assess-date">' +
        MC.esc(_shortDay(a.date)) +
        '</span>' +
        '<span class="m-assess-title">' +
        MC.esc(a.title) +
        (status === 'NS'
          ? ' <span class="m-badge" style="background:var(--priority-light);color:var(--priority)">M</span>'
          : status === 'EXC'
            ? ' <span class="m-badge" style="background:var(--active-light);color:var(--link)">EXC</span>'
            : '') +
        '</span>' +
        '<span class="m-st-score m-st-level-' +
        (c.cell.level > 0 ? c.cell.level : 0) +
        '">' +
        MC.esc(_cellText(c.cell, a)) +
        '</span>' +
        '</div>' +
        '<div class="m-st-assess-sub">' +
        (showsCategoryBadge(cid, a)
          ? '<span class="m-type-badge ' + badge.className + '">' + MC.esc(badge.label) + '</span>'
          : '') +
        (toward.length ? '<span class="m-st-toward">' + MC.esc(toward.join(', ')) + '</span>' : '') +
        '</div>' +
        '</div>';
    });

    // Evidence
    var evidenceHtml =
      '<div class="m-scard-actions" style="padding:12px 16px 4px"><button class="m-scard-btn m-scard-btn-observe" data-action="m-obs-quick-menu" data-sid="' +
      sid +
      '">Observe</button></div>';
    if (!obs.length) {
      evidenceHtml +=
        '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No observations yet</div></div>';
    } else {
      var obsCtx = ObsCard.context(cid);
      obs.forEach(function (ob) {
        evidenceHtml += MObserve.cardHtml(cid, Object.assign({ studentId: sid }, ob), obsCtx, {
          showStudent: false,
          when: 'date',
        });
      });
    }

    // Goals and Reflections
    var goals = (typeof getGoals === 'function' && getGoals(cid)[sid]) || {};
    var refl = (typeof getReflections === 'function' && getReflections(cid)[sid]) || {};
    var goalCount = 0;
    var first = MC.esc(displayNameFirst(st));
    var goalsHtml = '';
    sections.forEach(function (sec) {
      var g = (goals[sec.id] || '').trim();
      var r = refl[sec.id] || {};
      if (g) goalCount++;
      var conf = r.confidence && typeof CONFIDENCE_LABELS !== 'undefined' ? CONFIDENCE_LABELS[r.confidence] : '';
      goalsHtml +=
        '<div class="m-st-goal">' +
        '<div class="m-st-goal-name">' +
        MC.esc(sec.name) +
        '</div>' +
        '<div class="m-st-goal-label">Goal</div>' +
        '<div class="m-st-goal-text">' +
        (g ? MC.esc(g) : '<span class="m-st-muted">No goal set.</span>') +
        '</div>' +
        '<div class="m-st-goal-label">In ' +
        first +
        '’s Words' +
        (conf ? ' · ' + MC.esc(conf) : '') +
        '</div>' +
        '<div class="m-st-goal-text">' +
        (r.text ? MC.esc(r.text) : '<span class="m-st-muted">No self-reflection yet.</span>') +
        '</div>' +
        '</div>';
    });

    // The student's own words from questionnaires: their goals on Goals,
    // About Me and reflections on Learner Profile, as on the desktop page.
    var voice = _voiceHtml(cid, sid, displayNameFirst(st));
    goalsHtml = voice.goals + goalsHtml;

    // Learner Profile
    var dimGroups = [
      { name: 'Learning Dispositions', dims: typeof LEARNING_DIMS !== 'undefined' ? LEARNING_DIMS : [] },
      { name: 'Relational and Identity', dims: typeof RELATIONAL_DIMS !== 'undefined' ? RELATIONAL_DIMS : [] },
    ];
    var seen = 0;
    var allDims = 0;
    var profileHtml = voice.words + '<div class="m-list-inset-header m-st-profile-h">Seen in Observations</div>';
    dimGroups.forEach(function (gp) {
      profileHtml += '<div class="m-list-inset-header">' + MC.esc(gp.name) + '</div><div class="m-st-list">';
      gp.dims.forEach(function (d) {
        allDims++;
        var tagged = obs.filter(function (o) {
          return (o.dims || []).indexOf(d) >= 0;
        });
        if (tagged.length) seen++;
        var latest = tagged[0];
        profileHtml +=
          '<div class="m-st-dim' +
          (tagged.length ? '' : ' unseen') +
          '"><div class="m-st-dim-text"><span class="m-st-dim-name">' +
          MC.esc(OBS_LABELS[d] || d) +
          '</span><span class="m-st-dim-latest">' +
          (latest
            ? MC.esc(_shortDay(_obDay(latest)) + ', ') +
              (isPrivateObservation(latest) ? obsPrivateLabelHtml(latest) + ' ' : '') +
              MC.esc(String(latest.text || '').split('\n')[0])
            : 'Not Seen Yet') +
          '</span></div><span class="m-st-dim-count">' +
          tagged.length +
          '</span></div>';
      });
      profileHtml += '</div>';
    });

    var profs = sections
      .map(function (sec) {
        return getSectionProficiency(cid, sid, sec.id);
      })
      .filter(function (v) {
        return v > 0;
      });
    var atProf = profs.filter(function (v) {
      return roundLevel(v) >= 3;
    }).length;
    var tabs = [
      {
        id: 'comps',
        label: 'Competencies',
        stat: !profs.length
          ? 'Not Scored'
          : courseGradeMode(cid) === 'letter'
            ? profs.length + ' of ' + sections.length + ' Scored'
            : atProf + ' of ' + sections.length + ' Proficient',
      },
      { id: 'assess', label: 'Assessments', stat: scoredN + ' Scored' },
      { id: 'evidence', label: 'Evidence', stat: obs.length + (obs.length === 1 ? ' Observation' : ' Observations') },
      { id: 'profile', label: 'Learner Profile', stat: goalCount + (goalCount === 1 ? ' Goal' : ' Goals') },
    ];
    var activeTab = savedTab();
    var tabsBlock =
      _tabBar(tabs, activeTab) +
      _panel('comps', activeTab, focusHTML + '<div class="m-list-inset-header">Competencies</div>' + sectionCards) +
      _panel('assess', activeTab, '<div class="m-st-list">' + assessHtml + '</div>') +
      _panel('evidence', activeTab, evidenceHtml) +
      _panel(
        'profile',
        activeTab,
        '<div class="m-list-inset-header m-st-profile-h">Goals and Reflections</div><div class="m-st-list">' +
          goalsHtml +
          '</div>' +
          profileHtml,
      );

    return (
      '<div class="m-screen m-screen-hidden" id="m-screen-student-detail">' +
      nav +
      '<div class="m-screen-content">' +
      hero +
      // The work waiting, above the tabs (S7-F4).
      (window.MGradePhotos ? MGradePhotos.studentListHtml(cid, st) : '') +
      tabsBlock +
      '<div class="m-scard-actions" style="padding:16px">' +
      (getAssessments(cid).length
        ? '<button class="m-scard-btn m-scard-btn-view" data-action="m-student-grade" data-sid="' +
          sid +
          '">Grade Newest: ' +
          MC.esc(
            getAssessments(cid)
              .slice()
              .sort(function (a, b) {
                return (b.date || '').localeCompare(a.date || '') || samePieceDateOrder(cid, b.id, a.id);
              })[0].title,
          ) +
          '</button>'
        : '') +
      '</div>' +
      '<div style="height:32px"></div>' +
      '</div></div>'
    );
  }

  /* After an observation is edited, deleted or put back from the student's
     page, its Evidence list and count are drawn again in place. */
  function refreshEvidence(cid) {
    refreshPanels(cid, ['evidence']);
  }

  /* Draws some of the open student screen's panels (and their tab stats)
     again in place, keeping the tab strip and where it is scrolled. */
  function refreshPanels(cid, ids) {
    var screen = document.getElementById('m-screen-student-detail');
    if (!screen) return;
    var desc = null;
    try {
      desc = JSON.parse(screen.getAttribute('data-restore') || 'null');
    } catch (e) {
      desc = null;
    }
    if (!desc || !desc.sid) return;
    var tmp = document.createElement('div');
    if (!window.MStudents || !MStudents.renderDetail) return;
    // html-safe: MStudents.renderDetail escapes its text (checked where the shell places it).
    tmp.innerHTML = MStudents.renderDetail(cid, desc.sid);
    ids.forEach(function (id) {
      var fresh = tmp.querySelector('#m-st-panel-' + id);
      var panel = screen.querySelector('#m-st-panel-' + id);
      // html-safe: the panel comes from MStudents.renderDetail above.
      if (fresh && panel) panel.innerHTML = fresh.innerHTML;
      var freshStat = tmp.querySelector('.m-st-tab[data-tab="' + id + '"] .m-st-tab-stat');
      var stat = screen.querySelector('.m-st-tab[data-tab="' + id + '"] .m-st-tab-stat');
      if (freshStat && stat) stat.textContent = freshStat.textContent;
    });
  }

  return {
    renderDetail: renderDetail,
    // One assessment's score as this screen's list shows it; the card's To
    // Return list shows the same (teacher-mobile/card-widgets.js).
    cellText: _cellText,
    selectTab: selectTab,
    scrollActiveTab: scrollActiveTab,
    refreshEvidence: refreshEvidence,
  };
})();
