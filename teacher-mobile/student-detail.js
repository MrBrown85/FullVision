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
    var allAssessments = getAssignedAssessments(cid);
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
    // A teacher-built reflection's kinds read as the Learner Profile reads them ("4 of 5", a date in words).
    if (/^(rating|date|ranking|likert|section)$/.test(q.kind) && StudentVoice.answerText)
      return StudentVoice.answerText(q, v);
    if (Array.isArray(v.json))
      return v.json
        .filter(function (x) {
          return String(x || '').trim();
        })
        .join(', ');
    if (v.text != null && String(v.text).trim()) return String(v.text);
    return v.num != null ? String(v.num) : '';
  }
  /* ── The profile ─────────────────────────────────────────────────
     The student's own words first (the board "Profile New"): who they are
     with + Observe, the private note behind a tap, their goal, About Me,
     what you have noticed, their reflections, then All Work and
     Competencies, each opening in place (<details>, so a tap needs no
     script). To Grade is not here: it is the Students card's. */
  var CHEVRON =
    '<svg class="m-sp-chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5"/></svg>';
  var LOCK =
    '<svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="8" width="12" height="9" rx="2"/><path d="M5 8V5.5a3 3 0 016 0V8"/></svg>';

  // html-safe: the words go through MC.esc
  function _bubble(text, clamp) {
    // The cut is on the text inside the bubble: padding on the cut box would show a sixth line.
    var bubble =
      '<div class="m-sp-bubble">' +
      (clamp ? '<div class="m-sp-clamp">' + MC.esc(text) + '</div>' : MC.esc(text)) +
      '</div>';
    // More shows only on an answer that is cut (measure below).
    return clamp
      ? '<div class="m-sp-answer">' +
          bubble +
          '<button type="button" class="m-sp-more" data-sp-action="more" aria-expanded="false">More</button></div>'
      : bubble;
  }

  // html-safe: the title and the date go through MC.esc; body is markup the caller built
  function _card(title, when, body) {
    return (
      '<section class="m-sp-card"><div class="m-sp-head"><h2>' +
      MC.esc(title) +
      '</h2>' +
      (when ? '<span class="m-sp-when">' + MC.esc(when) + '</span>' : '') +
      '</div>' +
      body +
      '</section>'
    );
  }

  // A row that opens in place: its label, an optional tag at the right, then what it holds.
  // html-safe: the label and the tag go through MC.esc; body is markup the caller built
  function _row(label, tag, body, cls) {
    return (
      '<details class="m-sp-row' +
      (cls ? ' ' + cls : '') +
      '"><summary><span class="m-sp-row-label">' +
      MC.esc(label) +
      '</span>' +
      (tag ? '<span class="m-sp-tag">' + MC.esc(tag) + '</span>' : '') +
      CHEVRON +
      '</summary><div class="m-sp-row-body">' +
      body +
      '</div></details>'
    );
  }

  // A row with nothing to open: a reflection not answered.
  function _flatRow(label, tag) {
    return (
      '<div class="m-sp-row m-sp-flat"><span class="m-sp-row-label">' +
      MC.esc(label) +
      '</span><span class="m-sp-tag m-sp-tag-warn">' +
      MC.esc(tag) +
      '</span></div>'
    );
  }

  // html-safe: the label and the answer go through MC.esc
  function _qa(label, text, clamp) {
    return '<div class="m-sp-label">' + MC.esc(label) + '</div>' + _bubble(text, clamp);
  }

  /* How to say their name as the student wrote it: a syllable written in
     capitals is the stressed one ("SHAY-oon"), shown bold. */
  // html-safe: every word goes through MC.esc
  function _sayHtml(text) {
    return String(text)
      .split(/([-\s]+)/)
      .map(function (part) {
        var shout = part.length > 1 && /[A-Z]/.test(part) && part === part.toUpperCase();
        return shout ? '<b>' + MC.esc(part) + '</b>' : MC.esc(part);
      })
      .join('');
  }

  // "with a partner" as the board shows it: "With a Partner".
  function _titleCase(text) {
    return String(text).replace(/[A-Za-z']+/g, function (w, at) {
      return at > 0 && /^(a|an|the|of|in|on|to|and|or|at|by|for)$/i.test(w)
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1);
    });
  }

  // One answer as text, '' when there is none.
  function _ans(it) {
    return it && it.v ? _answerText(it.q, it.v) : '';
  }

  /* The student's own words an observation can start from, by priority: what
     is hard right now, what they are good at, what they do outside school.
     { label, day, text } or null. */
  function wordsFor(cid, sid) {
    if (typeof StudentVoice === 'undefined' || !StudentVoice.loaded(cid)) return null;
    var a = StudentVoice.profile(StudentVoice.entries(cid, sid)).about;
    if (!a) return null;
    var picks = [
      ['Hard Right Now', a.hard],
      ['Good At', a.goodAt],
      ['Outside School', a.outside],
    ];
    for (var i = 0; i < picks.length; i++) {
      var t = _ans(picks[i][1]);
      if (t) return { label: picks[i][0], day: _voiceDay(a.at), text: t };
    }
    return null;
  }

  // The reflections a class has on and a student has not answered.
  function _unanswered(cid, answeredIds) {
    if (typeof Questionnaires === 'undefined') return [];
    return Questionnaires.list(cid).filter(function (q) {
      return Questionnaires.status(q).state !== 'off' && answeredIds.indexOf(q.id) < 0;
    });
  }

  // html-safe: titles, dates and answers go through MC.esc
  function _reflectionsHtml(cid, list) {
    var answered = [];
    var rows = '';
    list.forEach(function (e) {
      var qa = e.items
        .map(function (it) {
          var t = it.q.teacher_only ? '' : _ans(it);
          return t ? _qa(it.q.prompt || '', t, false) : '';
        })
        .join('');
      if (!qa) return;
      answered.push(e.qid);
      rows += _row(e.title || 'Reflection', _voiceDay(e.at), qa);
    });
    var missing = _unanswered(cid, answered)
      .map(function (q) {
        return _flatRow(q.title || 'Reflection', 'Not Answered');
      })
      .join('');
    if (rows) return _card('Reflections', '', rows + missing);
    // Nothing answered: one row that says so, opening to what is waiting.
    return (
      '<section class="m-sp-card m-sp-rows">' +
      (missing
        ? _row('Reflections', 'None Answered', missing, 'm-sp-tag-row')
        : _flatRow('Reflections', 'None Answered')) +
      '</section>'
    );
  }

  // html-safe: names, answers, titles and dates go through MC.esc; the badges, the observation cards, the work and the competencies are built escaped above and by MObserve.cardHtml
  function _profileHtml(p) {
    var st = p.st;
    var cid = p.cid;
    var first = displayNameFirst(st) || displayName(st);
    var voice = p.voice || { about: null, checkin: null, reflections: [] };
    var a = voice.about;
    var c = voice.checkin;

    // Who they are.
    var say = a ? _ans(a.say) : '';
    var line = (say ? _sayHtml(say) : '') + (say && st.pronouns ? ' · ' : '') + MC.esc(st.pronouns || '');
    var concerns = (p.allObs || []).filter(function (o) {
      return isOpenConcern(o);
    });
    var flagged = typeof isStudentFlagged === 'function' && isStudentFlagged(cid, st.id);
    var alerts =
      p.badges +
      (flagged ? '<span class="m-sp-chip m-sp-chip-alert">Flagged</span>' : '') +
      (concerns.length
        ? '<button type="button" class="m-sp-hit" data-sp-action="concerns" data-cid="' +
          MC.esc(cid) +
          '" data-sid="' +
          MC.esc(st.id) +
          '"><span class="m-sp-chip m-sp-chip-alert">' +
          concerns.length +
          (concerns.length === 1 ? ' Open Concern' : ' Open Concerns') +
          ' ›</span></button>'
        : '');
    var langs = a ? _ans(a.languages) : '';
    var learns = a ? _ans(a.learns) : '';
    var facts =
      (langs
        ? langs
            .split(/,\s*/)
            .filter(Boolean)
            .map(function (l) {
              return '<span class="m-sp-chip">' + MC.esc(l) + '</span>';
            })
            .join('')
        : '') + (learns ? '<span class="m-sp-chip">' + MC.esc('Learns Best ' + _titleCase(learns)) + '</span>' : '');
    var who =
      '<section class="m-sp-card m-sp-who"><div class="m-sp-who-top"><span class="m-sp-avatar" style="background:' +
      MC.avatarColor(st.id) +
      '">' +
      MC.esc(MC.avatarInitials(st)) +
      '</span><div class="m-sp-who-text"><h1 class="m-sp-name">' +
      MC.esc(displayName(st)) +
      '</h1>' +
      (line ? '<div class="m-sp-line">' + line + '</div>' : '') +
      '</div></div>' +
      (alerts ? '<div class="m-sp-chips">' + alerts + '</div>' : '') +
      (facts ? '<div class="m-sp-chips">' + facts + '</div>' : '') +
      '<button type="button" class="m-sp-observe" data-sp-action="observe" data-cid="' +
      MC.esc(cid) +
      '" data-sid="' +
      MC.esc(st.id) +
      '">+ Observe</button></section>';

    // The private note, behind a tap.
    var note = a ? _ans(a.note) : '';
    var noteHtml = note
      ? '<details class="m-sp-card m-sp-note"><summary>' +
        LOCK +
        '<span class="m-sp-row-label">' +
        MC.esc('A Private Note From ' + first) +
        '</span>' +
        CHEVRON +
        '</summary><div class="m-sp-row-body">' +
        _bubble(note, false) +
        '</div></details>'
      : '';

    // Their goal: the course goal and its check-in, then a Core Competency goal.
    var goalBody = '';
    var goal = a ? _ans(a.goal) : '';
    if (goal) goalBody += _bubble(goal, true);
    var status = c ? _ans(c.status) : '';
    var next = c ? _ans(c.next) : '';
    if (status) goalBody += '<span class="m-sp-chip m-sp-chip-status">' + MC.esc(status) + '</span>';
    if (next) goalBody += _bubble(next, true);
    var core = c ? _ans(c.core) : '';
    var coreGoal = c ? _ans(c.coreGoal) : '';
    if (core)
      goalBody +=
        '<div class="m-sp-label">' +
        MC.esc('Core Competency: ' + core) +
        '</div>' +
        (coreGoal ? _bubble(coreGoal, true) : '');
    var goalHtml = goalBody ? _card(first + '’s Goal', _voiceDay((c && c.at) || (a && a.at)), goalBody) : '';

    // About Me: what they are good at, what is hard, outside school, then the rest.
    var aboutBody = '';
    if (a) {
      [
        ['Good At', _ans(a.goodAt)],
        ['Hard Right Now', _ans(a.hard)],
        ['Outside School', _ans(a.outside)],
      ]
        .concat(
          (a.rest || []).map(function (it) {
            return [it.q.prompt || '', _ans(it)];
          }),
        )
        .forEach(function (pair) {
          if (pair[1]) aboutBody += _qa(pair[0], pair[1], true);
        });
    }
    var aboutHtml = aboutBody ? _card('About Me', _voiceDay(a && a.at), aboutBody) : '';

    // What you have noticed: the newest observation, then all of them.
    var obs = p.obs;
    var noticed = obs.length
      ? _card(
          'What You’ve Noticed',
          '',
          p.obsHtml(obs[0]) +
            (obs.length > 1
              ? _row('All ' + obs.length + ' Observations', '', obs.slice(1).map(p.obsHtml).join(''), 'm-sp-inline')
              : ''),
        )
      : '';

    var reflections = p.voice ? _reflectionsHtml(cid, p.list) : '';
    var tail =
      '<section class="m-sp-card m-sp-rows">' +
      _row('All Work', '', p.assessHtml) +
      _row('Competencies', '', p.compsHtml) +
      '</section>';
    return who + noteHtml + goalHtml + aboutHtml + noticed + reflections + tail;
  }

  // html-safe: names, titles, goals, reflections and observation text go through MC.esc; colours through cssColor or constants; grades come from calc.js; MObserve.cardHtml and obsPrivateLabelHtml are checked.
  function renderDetail(opts) {
    var cid = opts.cid;
    var sid = opts.sid;
    var st = getStudents(cid).find(function (s) {
      return s.id === sid;
    });
    if (!st) return '<div class="m-screen"><div class="m-empty">Student not found</div></div>';

    // The sync dot is where a sync problem shows.
    var nav = MC.navBar({
      id: 'student-detail',
      title: displayName(st),
      backLabel: 'Students',
      rightHTML: MC.syncDot(),
    });
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

    // Everything below follows the class's chosen reporting term.
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var statuses = getAssignmentStatuses(cid);
    var termAssess = getAssignedAssessments(cid)
      .filter(function (a) {
        return typeof assessmentInYearToDate !== 'function' || assessmentInYearToDate(cid, a);
      })
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '') || samePieceDateOrder(cid, b.id, a.id);
      });
    // A deleted one waiting on its Undo is already gone from the list.
    var allObs = getStudentQuickObs(cid, sid);
    var obs = allObs.filter(function (o) {
      return _obsInTerm(o, term) && !(window.MObserve && MObserve.isPending && MObserve.isPending(o.id));
    });

    // All Work: a row for each piece, opening that piece's grading screen on this student.
    var nsN = termAssess.filter(function (a) {
      return statuses[sid + ':' + a.id] === 'NS';
    }).length;
    var assessHtml = '';
    if (nsN) assessHtml += '<div class="m-st-note m-st-note-warn">' + nsN + ' missing</div>';
    if (!termAssess.length) {
      assessHtml +=
        '<div class="m-empty" style="padding:20px"><div class="m-empty-subtitle">No assessments yet</div></div>';
    }
    termAssess.forEach(function (a) {
      var cell = assessmentCellValue(cid, sid, a);
      var badge = _assessmentBadgeData(cid, a);
      var status = statuses[sid + ':' + a.id];
      assessHtml +=
        '<div class="m-assess-compact" role="button" tabindex="0" data-action="m-assess-grade" data-sid="' +
        MC.esc(sid) +
        '" data-aid="' +
        MC.esc(a.id) +
        '" aria-label="Grade ' +
        MC.esc(a.title) +
        '">' +
        '<div class="m-assess-top">' +
        '<span class="m-assess-title">' +
        MC.esc(a.title) +
        (status === 'NS'
          ? ' <span class="m-badge" style="background:var(--priority-light);color:var(--priority)">M</span>'
          : status === 'EXC'
            ? ' <span class="m-badge" style="background:var(--active-light);color:var(--link)">EXC</span>'
            : '') +
        '</span>' +
        '<span class="m-st-score m-st-level-' +
        (cell.level > 0 ? cell.level : 0) +
        '">' +
        MC.esc(_cellText(cell, a)) +
        '</span>' +
        '</div>' +
        '<div class="m-st-assess-sub">' +
        '<span class="m-assess-date">' +
        MC.esc(_shortDay(a.date)) +
        '</span>' +
        (showsCategoryBadge(cid, a)
          ? '<span class="m-type-badge ' + badge.className + '">' + MC.esc(badge.label) + '</span>'
          : '') +
        '</div>' +
        '</div>';
    });

    // Competencies, by folder, each opening in place.
    var grouped = getGroupedSections(cid);
    var sectionCards = '';
    if (grouped.groups.length) {
      grouped.groups.forEach(function (gi) {
        if (!gi.sections.length) return;
        var groupProf = getGroupProficiency(cid, sid, gi.group.id);
        var groupNote = folderAverageNote(cid, gi.group);
        sectionCards +=
          '<div class="m-group-header">' +
          '<span class="m-group-name">' +
          MC.esc(gi.group.label || gi.group.name) +
          (groupNote ? '<span class="m-group-note">' + MC.esc(groupNote) + '</span>' : '') +
          '</span>' +
          '<span class="m-group-prof" style="color:' +
          MC.profBg(roundLevel(groupProf)) +
          '">' +
          formatLevel(cid, groupProf) +
          '</span>' +
          '</div>';
        gi.sections.forEach(function (sec) {
          sectionCards += _renderSectionCard(cid, sid, sec);
        });
      });
      grouped.ungrouped.forEach(function (sec) {
        sectionCards += _renderSectionCard(cid, sid, sec);
      });
    } else {
      getSections(cid).forEach(function (sec) {
        sectionCards += _renderSectionCard(cid, sid, sec);
      });
    }

    // The student's own words from questionnaires: they load once per class and the profile is drawn again when they arrive.
    var list = [];
    if (typeof StudentVoice !== 'undefined') {
      if (!StudentVoice.loaded(cid)) {
        StudentVoice.load(cid, function () {
          refreshPanels(cid);
        });
      }
      if (StudentVoice.loaded(cid)) list = StudentVoice.entries(cid, sid);
    }
    var voice = typeof StudentVoice !== 'undefined' && StudentVoice.loaded(cid) ? StudentVoice.profile(list) : null;

    var obsCtx = ObsCard.context(cid);
    return (
      '<div class="m-screen m-screen-hidden m-sp-screen" id="m-screen-student-detail">' +
      nav +
      '<div class="m-screen-content"><div class="m-sp-page" id="m-st-panel-profile">' +
      _profileHtml({
        st: st,
        cid: cid,
        badges: desPills + opts.renderBadges(st),
        voice: voice,
        list: list,
        obs: obs,
        allObs: allObs,
        obsHtml: function (ob) {
          return MObserve.cardHtml(cid, Object.assign({ studentId: sid }, ob), obsCtx, {
            showStudent: false,
            when: 'date',
          });
        },
        assessHtml: '<div class="m-st-list">' + assessHtml + '</div>',
        compsHtml: sectionCards,
      }) +
      '</div></div></div>'
    );
  }

  /* ── Answers that run long are cut at five lines, with More ───────
     An answer whose words do not fit its five lines gets a More button
     (the class is-long); opened, it keeps its button, now Less. A
     ResizeObserver measures it when it is laid out, and again if the
     width or the text size changes. */
  var _measure = null;
  function _fits(box) {
    var answer = box.closest('.m-sp-answer');
    if (!answer || box.classList.contains('is-open')) return;
    answer.classList.toggle('is-long', box.scrollHeight > box.clientHeight + 1);
  }
  function watchLong(root) {
    if (!root || !root.querySelectorAll || typeof ResizeObserver !== 'function') return;
    if (!_measure)
      _measure = new ResizeObserver(function (entries) {
        entries.forEach(function (e) {
          _fits(e.target);
        });
      });
    root.querySelectorAll('.m-sp-clamp').forEach(function (box) {
      _measure.observe(box);
    });
  }

  /* A screen just pushed: its answers are measured. */
  function opened(screen) {
    watchLong(screen);
  }

  /* After an observation is edited, deleted or put back from the student's
     page, the profile is drawn again in place. */
  function refreshEvidence(cid) {
    refreshPanels(cid);
  }

  /* Draws the open profile again in place, where it is scrolled. */
  function refreshPanels(cid) {
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
    var fresh = tmp.querySelector('#m-st-panel-profile');
    var panel = screen.querySelector('#m-st-panel-profile');
    if (fresh && panel) {
      // A row the teacher has open stays open.
      var open = Array.prototype.map.call(panel.querySelectorAll('details'), function (d) {
        return d.open;
      });
      // html-safe: the panel comes from MStudents.renderDetail above.
      panel.innerHTML = fresh.innerHTML;
      panel.querySelectorAll('details').forEach(function (d, i) {
        if (open[i]) d.open = true;
      });
      watchLong(panel);
    }
  }

  /* ── The profile's own taps ──────────────────────────────────────
     More and Less on a long answer, + Observe (the student's own words
     start it), and an open concern's follow-up. One listener, since a
     concern's buttons sit in a sheet, outside the screen. */

  // + Observe: a new note with a quote of the student's own words, else the quick menu.
  function observeFrom(cid, sid) {
    var words = wordsFor(cid, sid);
    if (words && window.MObserve && MObserve.presentNewObsSheet) MObserve.presentNewObsSheet(cid, sid, words);
    else if (window.MObserve) MObserve.presentQuickMenu(cid, sid);
  }

  // The open concerns, each with its one-tap follow-ups, in a sheet.
  // html-safe: names, dates and the teacher's words go through MC.esc; kinds are constants
  function concernsSheetHtml(cid, sid) {
    var open = getStudentQuickObs(cid, sid).filter(function (o) {
      return isOpenConcern(o);
    });
    var kinds = ['called_home', 'spoke_with_student', 'still_happening', 'resolved'];
    var cards = open
      .map(function (ob) {
        return (
          '<div class="m-sp-concern"><div class="m-sp-concern-top"><span class="m-sp-concern-type">Concern</span><span class="m-sp-when">' +
          MC.esc(_shortDay(_obDay(ob))) +
          '</span><span class="m-sp-chip m-sp-chip-alert m-sp-open">Open</span></div>' +
          '<div class="m-sp-concern-text">' +
          MC.esc(ob.text || '') +
          '</div><div class="m-sp-concern-acts">' +
          kinds
            .map(function (k) {
              return (
                '<button type="button" class="m-sp-concern-btn' +
                (k === 'resolved' ? ' is-resolved' : '') +
                '" data-sp-action="follow-up" data-cid="' +
                MC.esc(cid) +
                '" data-sid="' +
                MC.esc(sid) +
                '" data-obid="' +
                MC.esc(ob.id) +
                '" data-kind="' +
                k +
                '">' +
                MC.esc(OBS_FOLLOW_UP_KINDS[k].label) +
                '</button>'
              );
            })
            .join('') +
          '</div></div>'
        );
      })
      .join('');
    return '<div class="m-sp-concerns">' + cards + '</div>';
  }

  function showConcerns(cid, sid) {
    MC.presentSheet(concernsSheetHtml(cid, sid));
  }

  /* A follow-up from the sheet: the same write the Observe tab's follow-up
     makes (addObservationFollowUp). The sheet closes and the profile is
     drawn again, so the chip's count is right at once. */
  function followUp(cid, sid, obId, kind) {
    var f = addObservationFollowUp(cid, obId, kind, '');
    if (!f) return;
    MC.dismissSheet();
    refreshPanels(cid);
    var label = OBS_FOLLOW_UP_KINDS[kind] ? OBS_FOLLOW_UP_KINDS[kind].label : '';
    MC.showToast(label, {
      onUndo: function () {
        deleteObservationFollowUp(cid, obId, f.id);
        refreshPanels(cid);
      },
    });
  }

  if (typeof document !== 'undefined')
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-sp-action]') : null;
      if (!el) return;
      var action = el.getAttribute('data-sp-action');
      var cid = el.getAttribute('data-cid');
      var sid = el.getAttribute('data-sid');
      if (action === 'more') {
        var box = el.parentNode.querySelector('.m-sp-clamp');
        var openNow = box.classList.toggle('is-open');
        el.setAttribute('aria-expanded', String(openNow));
        el.textContent = openNow ? 'Less' : 'More';
      } else if (action === 'observe') observeFrom(cid, sid);
      else if (action === 'concerns') showConcerns(cid, sid);
      else if (action === 'follow-up') followUp(cid, sid, el.getAttribute('data-obid'), el.getAttribute('data-kind'));
    });

  return {
    renderDetail: renderDetail,
    // One assessment's score as the profile's All Work shows it; the card's To
    // Return list shows the same (teacher-mobile/student-card.js).
    cellText: _cellText,
    opened: opened,
    refreshEvidence: refreshEvidence,
    refreshPanels: refreshPanels,
    wordsFor: wordsFor,
    concernsSheetHtml: concernsSheetHtml,
    followUp: followUp,
  };
})();
