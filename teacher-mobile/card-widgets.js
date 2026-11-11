/* card-widgets.js — Pluggable widget render functions for student cards */

window.MCardWidgets = (function () {
  'use strict';

  var MC = window.MComponents;
  var MAX_PROF = 4;
  var _renderers = {};

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _trunc(str, n) {
    return str.length > n ? str.substring(0, n) + '\u2026' : str;
  }

  function _renderBadges(st) {
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function (code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += '<span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += '<span class="m-badge m-badge-mod">MOD</span>';
        if (code === 'ELL') badges += '<span class="m-badge m-badge-ell">ELL</span>';
      });
    }
    return badges;
  }

  function _renderSocialChips(rating, filterIds, labelList, cssClass) {
    var matched = (rating.socialTraits || []).filter(function (t) {
      return filterIds.has(t);
    });
    if (!matched.length) return '';
    var shown = matched.slice(0, 4);
    var overflow = matched.length - shown.length;
    var chips = shown
      .map(function (tid) {
        var trait = labelList.find(function (t) {
          return t.id === tid;
        });
        var label = trait ? trait.label : tid;
        return '<span class="m-wdg-chip ' + cssClass + '">' + MC.esc(label) + '</span>';
      })
      .join('');
    if (overflow > 0) chips += '<span class="m-wdg-chip m-wdg-chip-more">+' + overflow + '</span>';
    return chips;
  }

  /* ── Public dispatch ──────────────────────────────────────────── */
  function render(key, st, cid, data) {
    var fn = _renderers[key];
    if (!fn) return '';
    return fn(st, cid, data);
  }

  /* ── hero ────────────────────────────────────────────────────── */
  _renderers.hero = function (st, cid, data) {
    var overall = getOverallProficiency(cid, st.id);
    var rounded = Math.round(overall);
    // The overall grade as the class is set to grade (level, letter, or both).
    var grade = studentGradeSummary(cid, st.id);
    var gradeText = grade.text || '\u2014';
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    var badges = _renderBadges(st);

    // Flag icon: only when flagStatus widget is enabled AND student is flagged
    var flagHTML = '';
    var config = data.widgetConfig;
    if (config.order.indexOf('flagStatus') >= 0 && isStudentFlagged(cid, st.id)) {
      flagHTML = '<span class="m-scard-flag" title="Flagged" aria-label="Flagged">\u2691</span>';
    }

    return (
      '<div class="m-scard-hero">' +
      '<div class="m-scard-avatar" style="background:' +
      color +
      '">' +
      MC.esc(initials) +
      '</div>' +
      '<div class="m-scard-info">' +
      '<div class="m-scard-name">' +
      MC.esc(name) +
      flagHTML +
      '</div>' +
      (badges ? '<div class="m-scard-badges">' + badges + '</div>' : '') +
      '</div>' +
      '<div class="m-scard-prof">' +
      '<div class="m-scard-prof-val' +
      (gradeText.length > 4 ? ' m-scard-prof-long' : '') +
      '" style="color:' +
      MC.profBg(grade.level) +
      '">' +
      MC.esc(gradeText) +
      '</div>' +
      '<div class="m-scard-prof-label">' +
      (courseGradeMode(cid) === 'letter' ? 'Course grade' : PROF_LABELS[rounded] || 'No Evidence') +
      '</div>' +
      '</div>' +
      '</div>'
    );
  };

  /* ── renderFallbackHero (used when hero widget is disabled) ──── */
  function renderFallbackHero(st) {
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    return (
      '<div class="m-scard-hero-min">' +
      '<div class="m-scard-avatar-min" style="background:' +
      color +
      '">' +
      MC.esc(initials) +
      '</div>' +
      '<div class="m-scard-name-min">' +
      MC.esc(name) +
      '</div>' +
      '</div>'
    );
  }

  /* ── sectionBars ─────────────────────────────────────────────── */
  // Grouped by folder as on the student screen: each folder's average,
  // "Each competency counts on its own." under a folder that doesn't count
  // as one, then its competencies; every row carries its figure.
  function _secRowHtml(cid, name, color, value, cls) {
    var pct = Math.round(levelBarPercent(cid, value));
    return (
      '<div class="m-scard-sec-row' +
      (cls ? ' ' + cls : '') +
      '">' +
      (color ? '<div class="m-scard-sec-dot" style="background:' + cssColor(color) + '"></div>' : '') +
      '<div class="m-scard-sec-name">' +
      MC.esc(name) +
      '</div>' +
      '<div class="m-scard-sec-bar"><div class="m-scard-sec-fill" style="width:' +
      pct +
      '%;background:' +
      MC.profBg(Math.round(value)) +
      '"></div></div>' +
      '<div class="m-scard-sec-val">' +
      MC.esc(value > 0 ? formatLevel(cid, value) : '—') +
      '</div>' +
      '</div>'
    );
  }

  _renderers.sectionBars = function (st, cid, data) {
    var sections = data.sections;
    if (!sections || !sections.length) return '';
    var secRow = function (sec) {
      return _secRowHtml(
        cid,
        sec.shortName || sec.name,
        sec.color || '#888',
        getSectionProficiency(cid, st.id, sec.id),
        '',
      );
    };

    var grouped = typeof getGroupedSections === 'function' ? getGroupedSections(cid) : null;
    var html = '';
    if (grouped && grouped.groups && grouped.groups.length) {
      grouped.groups.forEach(function (gi) {
        if (!gi.sections.length) return;
        var note = typeof folderAverageNote === 'function' ? folderAverageNote(cid, gi.group) : '';
        html +=
          '<div class="m-scard-folder">' +
          _secRowHtml(
            cid,
            gi.group.label || gi.group.name,
            null,
            getGroupProficiency(cid, st.id, gi.group.id),
            'm-scard-folder-row',
          ) +
          (note ? '<div class="m-scard-folder-note">' + MC.esc(note) + '</div>' : '') +
          gi.sections.map(secRow).join('') +
          '</div>';
      });
      (grouped.ungrouped || []).forEach(function (sec) {
        html += secRow(sec);
      });
    } else {
      html = sections.map(secRow).join('');
    }
    return '<div class="m-scard-sections">' + html + '</div>';
  };

  /* ── obsSnippet ──────────────────────────────────────────────── */
  _renderers.obsSnippet = function (st, cid, data) {
    var obs = data.obs;
    if (!obs.length) {
      return '<div class="m-scard-obs-empty"><em>No observations yet</em></div>';
    }
    var latest = obs[0];
    var sent = OBS_SENTIMENTS[latest.sentiment];
    return (
      '<div class="m-scard-obs">' +
      (sent
        ? '<span class="m-obs-type-pill" data-sentiment="' + latest.sentiment + '">' + MC.esc(sent.label) + '</span> '
        : '') +
      '<span style="color:var(--text-3);font-size:12px">' +
      MC.relativeTime(latest.created) +
      '</span> ' +
      (isPrivateObservation(latest) ? obsPrivateLabelHtml(latest) + ' ' : '') +
      MC.esc(_trunc(latest.text || '', 80)) +
      '</div>'
    );
  };

  /* ── actions ─────────────────────────────────────────────────── */
  _renderers.actions = function (st) {
    return (
      '<div class="m-scard-actions">' +
      '<button class="m-scard-btn m-scard-btn-observe" data-action="m-obs-quick-menu" data-sid="' +
      st.id +
      '">Observe</button>' +
      '<button class="m-scard-btn m-scard-btn-view" data-action="m-student-detail" data-sid="' +
      st.id +
      '">View Profile</button>' +
      '</div>'
    );
  };

  /* ── completion (arc ring metric tile) ───────────────────────── */
  // Evidence coverage, as the desktop dashboard and student cards call it:
  // a % with that name, not a bare number over "Complete".
  _renderers.completion = function (st, cid) {
    var pct = getCompletionPct(cid, st.id);
    var color = pct >= 80 ? 'var(--score-3)' : pct >= 50 ? 'var(--score-2)' : 'var(--score-1)';
    // Room inside the ring for "100%".
    var r = 19,
      cx = 22,
      cy = 22,
      circ = 2 * Math.PI * r;
    var offset = circ * (1 - pct / 100);
    var svg =
      '<svg class="m-wdg-arc" width="44" height="44" viewBox="0 0 44 44">' +
      '<circle cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="' +
      r +
      '" fill="none" stroke="var(--bg-secondary)" stroke-width="3"/>' +
      '<circle cx="' +
      cx +
      '" cy="' +
      cy +
      '" r="' +
      r +
      '" fill="none" stroke="' +
      color +
      '" stroke-width="3" ' +
      'stroke-dasharray="' +
      circ +
      '" stroke-dashoffset="' +
      offset +
      '" stroke-linecap="round" transform="rotate(-90 ' +
      cx +
      ' ' +
      cy +
      ')"/>' +
      '<text x="' +
      cx +
      '" y="' +
      cy +
      '" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="700" fill="' +
      color +
      '">' +
      Math.round(pct) +
      '%</text>' +
      '</svg>';
    return '<div class="m-wdg-tile">' + svg + '<div class="m-wdg-tile-label">Evidence Coverage</div></div>';
  };

  /* ── missingWork (alert metric tile) ─────────────────────────── */
  _renderers.missingWork = function (st, cid, data) {
    var statuses = data.statuses || getAssignmentStatuses(cid);
    var assessments = data.assessments || getAssessments(cid);
    var count = assessments.filter(function (a) {
      return statuses[st.id + ':' + a.id] === 'NS';
    }).length;
    if (count === 0) return '';
    return (
      '<div class="m-wdg-tile m-wdg-alert">' +
      '<div class="m-wdg-alert-val">' +
      count +
      '</div>' +
      '<div class="m-wdg-tile-label">Missing</div>' +
      '</div>'
    );
  };

  /* ── growth (journey pill) ────────────────────────────────────── */
  // Where the student's work started and where it is now, in the grade the
  // class shows first (studentGrowthLine): a % in a Letter class, the level
  // and its word otherwise. The means of the first and last weeks, so one
  // early or late score doesn't decide it.
  _renderers.growth = function (st, cid, data) {
    var tagIds = [];
    (data.sections || []).forEach(function (sec) {
      (sec.tags || []).forEach(function (tag) {
        tagIds.push(tag.id);
      });
    });
    var g = studentGrowthLine(cid, st.id, tagIds);
    if (!g) return '';
    // The same count as the student screen's "N Scored".
    var n = MC.scoredAssessmentCount(cid, st.id);
    var countText = n + ' scored';

    if (!g.startText) {
      // Under two weeks of work: where it is now.
      return (
        '<div class="m-wdg-growth">' +
        '<span class="m-wdg-growth-label">' +
        MC.esc(g.nowText) +
        '</span>' +
        '<span class="m-wdg-growth-meta"> \u2014 ' +
        countText +
        '</span>' +
        '</div>'
      );
    }

    var arrowColor = g.dir > 0 ? 'var(--score-3)' : g.dir < 0 ? 'var(--score-1)' : 'var(--text-3)';
    var arrowChar = g.dir > 0 ? '\u2191' : g.dir < 0 ? '\u2193' : '\u2192';
    return (
      '<div class="m-wdg-growth" title="Start is the first weeks of work; Now is the last weeks.">' +
      '<span class="m-wdg-growth-label">Start ' +
      MC.esc(g.startText) +
      '</span>' +
      '<span class="m-wdg-growth-arrow" style="color:' +
      arrowColor +
      '">' +
      arrowChar +
      '</span>' +
      '<span class="m-wdg-growth-label">Now ' +
      MC.esc(g.nowText) +
      '</span>' +
      '<span class="m-wdg-growth-meta"> (' +
      (g.change ? MC.esc(g.change) + ', ' : '') +
      countText +
      ')</span>' +
      '</div>'
    );
  };

  /* ── obsSummary ──────────────────────────────────────────────── */
  _renderers.obsSummary = function (st, cid, data) {
    var obs = data.obs;
    if (obs.length === 0) return '';
    var ctxCounts = {};
    obs.forEach(function (o) {
      var c = o.context || 'unknown';
      ctxCounts[c] = (ctxCounts[c] || 0) + 1;
    });
    var topCtx = null,
      topCount = 0,
      allSame = true,
      firstCount = null;
    Object.keys(ctxCounts).forEach(function (c) {
      if (firstCount === null) firstCount = ctxCounts[c];
      else if (ctxCounts[c] !== firstCount) allSame = false;
      if (ctxCounts[c] > topCount) {
        topCtx = c;
        topCount = ctxCounts[c];
      }
    });
    var contextLabel = OBS_CONTEXTS[topCtx] ? OBS_CONTEXTS[topCtx].label.toLowerCase() : topCtx;
    var text = obs.length + ' observation' + (obs.length !== 1 ? 's' : '');
    if (allSame && Object.keys(ctxCounts).length > 1) {
      text += ' \u00b7 across settings';
    } else if (topCtx && topCtx !== 'unknown') {
      text += ' \u00b7 strongest in ' + contextLabel;
    }
    return '<div class="m-wdg-obs-summary">' + MC.esc(text) + '</div>';
  };

  /* ── reflection ──────────────────────────────────────────────── */
  _renderers.reflection = function (st, cid) {
    var reflections = getReflections(cid);
    var goals = getGoals(cid);
    var entry =
      reflections[st.id] && reflections[st.id].text
        ? reflections[st.id]
        : goals[st.id] && goals[st.id].text
          ? goals[st.id]
          : null;
    if (!entry) return '';
    return (
      '<div class="m-wdg-reflection">' +
      '<div class="m-wdg-reflection-label">Student Voice</div>' +
      '<div class="m-wdg-reflection-text">' +
      MC.esc(_trunc(entry.text, 60)) +
      '</div>' +
      '</div>'
    );
  };

  /* ── _petalPath helper ───────────────────────────────────────── */
  function _petalPath(sides, r, cx, cy, fill, stroke) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var angle = (2 * Math.PI * i) / sides - Math.PI / 2;
      pts.push((cx + r * Math.cos(angle)).toFixed(2) + ',' + (cy + r * Math.sin(angle)).toFixed(2));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="' + fill + '" stroke="' + stroke + '"/>';
  }

  /* ── dispositions ────────────────────────────────────────────── */
  _renderers.dispositions = function (st, cid, data) {
    var rating = data.termRating;
    if (!rating || !rating.dims) return '';
    var dims = rating.dims;
    var vals = OBS_DIMS.map(function (d) {
      return dims[d] || 0;
    });
    if (
      vals.every(function (v) {
        return v === 0;
      })
    )
      return '';

    var n = OBS_DIMS.length;
    var cx = 24,
      cy = 24,
      maxR = 20;
    var bgHex = _petalPath(n, maxR, cx, cy, 'var(--bg-secondary)', 'none');

    var dataPts = OBS_DIMS.map(function (d, i) {
      var angle = (2 * Math.PI * i) / n - Math.PI / 2;
      var r = (vals[i] / MAX_PROF) * maxR;
      return (cx + r * Math.cos(angle)).toFixed(2) + ',' + (cy + r * Math.sin(angle)).toFixed(2);
    });
    var dataShape =
      '<polygon points="' +
      dataPts.join(' ') +
      '" fill="var(--active-light)" stroke="var(--active)" stroke-width="1.5"/>';

    var svg = '<svg class="m-wdg-petal" width="48" height="48" viewBox="0 0 48 48">' + bgHex + dataShape + '</svg>';

    var sorted = OBS_DIMS.slice().sort(function (a, b) {
      return (dims[b] || 0) - (dims[a] || 0);
    });
    var topTwo = sorted.slice(0, 2).filter(function (d) {
      return (dims[d] || 0) > 0;
    });
    var summary = topTwo.length
      ? 'Strong in ' +
        topTwo
          .map(function (d) {
            return OBS_LABELS[d];
          })
          .join(', ')
      : '';

    return (
      '<div class="m-wdg-dispositions">' + svg + '<div class="m-wdg-disp-text">' + MC.esc(summary) + '</div>' + '</div>'
    );
  };

  /* ── traits ──────────────────────────────────────────────────── */
  _renderers.traits = function (st, cid, data) {
    var rating = data.termRating;
    if (!rating) return '';
    var chips = _renderSocialChips(rating, SOCIAL_TRAITS_POSITIVE_IDS, SOCIAL_TRAITS_POSITIVE, 'm-wdg-chip-positive');
    if (!chips) return '';
    return '<div class="m-wdg-traits">' + chips + '</div>';
  };

  /* ── concerns ────────────────────────────────────────────────── */
  _renderers.concerns = function (st, cid, data) {
    var rating = data.termRating;
    if (!rating) return '';
    var chips = _renderSocialChips(rating, SOCIAL_TRAITS_CONCERN_IDS, SOCIAL_TRAITS_CONCERN, 'm-wdg-chip-concern');
    if (!chips) return '';
    return '<div class="m-wdg-concerns">' + chips + '</div>';
  };

  /* ── workHabits ──────────────────────────────────────────────── */
  _renderers.workHabits = function (st, cid, data) {
    var rating = data.termRating;
    if (!rating) return '';
    var wh = rating.workHabits || 0;
    var part = rating.participation || 0;
    if (wh === 0 && part === 0) return '';

    function renderPips(val) {
      var pips = '';
      for (var i = 1; i <= 4; i++) {
        if (i <= val) {
          pips += '<div class="m-wdg-pip m-wdg-pip-filled" style="background:' + MC.profBg(val) + '"></div>';
        } else {
          pips += '<div class="m-wdg-pip" style="background:var(--bg-secondary)"></div>';
        }
      }
      return pips;
    }

    return (
      '<div class="m-wdg-habits">' +
      '<div class="m-wdg-habit-col">' +
      '<div class="m-wdg-pips">' +
      renderPips(wh) +
      '</div>' +
      '<div class="m-wdg-tile-label">Work Habits</div>' +
      '</div>' +
      '<div class="m-wdg-habit-col">' +
      '<div class="m-wdg-pips">' +
      renderPips(part) +
      '</div>' +
      '<div class="m-wdg-tile-label">Participation</div>' +
      '</div>' +
      '</div>'
    );
  };

  /* ── growthAreas ─────────────────────────────────────────────── */
  _renderers.growthAreas = function (st, cid, data) {
    var rating = data.termRating;
    if (!rating || !rating.growthAreas || !rating.growthAreas.length) return '';
    // A competency removed from the learning map has no name to show.
    var areas = rating.growthAreas.filter(function (tid) {
      return !!getTagById(cid, tid);
    });
    if (!areas.length) return '';
    var sections = data.sections;
    var shown = areas.slice(0, 3);
    var overflow = areas.length - shown.length;
    var chips = shown
      .map(function (tid) {
        var tag = getTagById(cid, tid);
        var label = tag.shortName || tag.label || tag.name || tag.code || '';
        var dotColor = '';
        if (tag && tag.sectionId) {
          var sec = sections.find(function (s) {
            return s.id === tag.sectionId;
          });
          if (sec) dotColor = sec.color || '';
        }
        var dot = dotColor ? '<span class="m-wdg-chip-dot" style="background:' + cssColor(dotColor) + '"></span>' : '';
        return '<span class="m-wdg-chip m-wdg-chip-neutral">' + dot + MC.esc(label) + '</span>';
      })
      .join('');
    if (overflow > 0) chips += '<span class="m-wdg-chip m-wdg-chip-more">+' + overflow + '</span>';
    return (
      '<div class="m-wdg-growth-areas">' +
      '<div class="m-wdg-section-label">Growth Areas</div>' +
      '<div class="m-wdg-chips">' +
      chips +
      '</div>' +
      '</div>'
    );
  };

  /* ── narrative ───────────────────────────────────────────────── */
  // The Teacher Comment, as desktop calls it: the first lines on the card,
  // the whole comment in a sheet on a tap. A comment that calls the student
  // by a name they no longer go by says so.
  _renderers.narrative = function (st, cid, data) {
    var rating = data.termRating;
    if (!rating || !rating.narrative) return '';
    var raw = (rating.narrative || '').replace(/<[^>]+>/g, '').trim();
    if (!raw) return '';
    var note = staleNameNote(st, raw);
    return (
      '<button type="button" class="m-wdg-narrative" data-action="m-comment-full" data-sid="' +
      MC.esc(st.id) +
      '" data-term="' +
      MC.esc(data.termId == null ? '' : String(data.termId)) +
      '" aria-label="Teacher Comment. Read all of it">' +
      '<span class="m-wdg-section-label">Teacher Comment</span>' +
      '<span class="m-wdg-narrative-text">' +
      MC.esc(raw) +
      '</span>' +
      (note ? '<span class="m-wdg-narrative-note">' + MC.esc(note) + '</span>' : '') +
      '<span class="m-wdg-narrative-more">Read All</span>' +
      '</button>'
    );
  };

  /* "Written as Liam. Lee is the name now." when the comment uses the
     student's legal first name and not the preferred name they now go by. */
  function _hasWord(text, name) {
    var esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^A-Za-z\\u00C0-\\u024F])' + esc + '(?![A-Za-z\\u00C0-\\u024F])').test(text);
  }
  function staleNameNote(st, text) {
    var now = displayNameFirst(st);
    var old = st.firstName;
    if (!old || !now || old === now) return '';
    if (!_hasWord(text, old) || _hasWord(text, now)) return '';
    return 'Written as ' + old + '. ' + now + ' is the name now.';
  }

  /* The whole Teacher Comment, for its sheet. */
  function commentSheetHtml(st, cid, termId) {
    var rating = getStudentTermRating(cid, st.id, termId);
    var raw = ((rating && rating.narrative) || '').replace(/<[^>]+>/g, '').trim();
    var note = staleNameNote(st, raw);
    return (
      '<div class="m-sheet-title">Teacher Comment</div>' +
      '<div class="m-comment-sheet">' +
      '<div class="m-comment-sheet-name">' +
      MC.esc(displayNameWithLast(st)) +
      '</div>' +
      (note ? '<div class="m-wdg-narrative-note">' + MC.esc(note) + '</div>' : '') +
      raw
        .split(/\n+/)
        .filter(function (p) {
          return p.trim();
        })
        .map(function (p) {
          return '<p>' + MC.esc(p) + '</p>';
        })
        .join('') +
      '</div>'
    );
  }

  /* ── flagStatus — no own output; flag icon is co-rendered by hero ── */
  _renderers.flagStatus = function () {
    return '';
  };

  /* ── To Return (S1-F3) ───────────────────────────────────────────
     In a class that holds grades until they are returned, the card lists
     the student's drafts under the name, above the widgets: the work, the
     Draft mark, the grade and "Cece can’t see it yet", and Return. It is
     not a widget: it shows whenever there is a draft, whatever Customize
     Card has on. MGrade.studentDrafts is empty in any other class, so the
     card is then what it was. The grade is the piece's cell
     (assessmentCellValue), as the student screen's list shows it. */
  function _draftGradeText(cid, sid, a) {
    var cell = assessmentCellValue(cid, sid, a);
    if (cell.kind === 'complete') return cell.mark === 'complete' ? 'Complete' : 'Incomplete';
    if (cell.kind === 'points' || cell.kind === 'level') return window.MStudentDetail.cellText(cell, a);
    return '';
  }

  // html-safe: the title, the grade and the name go through MC.esc; ids are ours
  function _toReturnHtml(st, cid) {
    var drafts = window.MGrade && MGrade.studentDrafts ? MGrade.studentDrafts(cid, st.id) : [];
    if (!drafts.length) return '';
    var cant = displayNameFirst(st) + ' can\u2019t see it yet';
    return (
      '<div class="m-scard-return"><div class="m-scard-return-head">To Return</div>' +
      drafts
        .map(function (a) {
          var grade = _draftGradeText(cid, st.id, a);
          return (
            '<div class="m-scard-return-row"><div class="m-scard-return-body">' +
            '<div class="m-scard-return-title">' +
            MC.esc(a.title) +
            '</div>' +
            '<div class="m-scard-return-sub"><span class="m-draft-mark">Draft</span><span class="m-scard-return-text">' +
            MC.esc((grade ? grade + ' \u00b7 ' : '') + cant) +
            '</span></div></div>' +
            '<button type="button" class="m-return-btn" data-action="m-card-return" data-sid="' +
            st.id +
            '" data-aid="' +
            a.id +
            '" aria-label="' +
            MC.esc('Return, ' + a.title) +
            '"><span>Return</span></button></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* ── assembleCard ────────────────────────────────────────────── */
  // html-safe: every widget renderer escapes its text with MC.esc and passes colours through cssColor or constants.
  function assembleCard(st, cid, data) {
    var config = data.widgetConfig;
    var order = config.order;

    // Pre-fetch per-student data once for all renderers
    data.obs = getStudentQuickObs(cid, st.id);
    data.termRating = getStudentTermRating(cid, st.id, data.termId);

    // Hero: pinned top (or fallback if disabled)
    var heroIdx = order.indexOf('hero');
    var heroHtml = heroIdx >= 0 ? render('hero', st, cid, data) : renderFallbackHero(st);

    // Actions: pinned bottom
    var actionsIdx = order.indexOf('actions');
    var actionsHtml = actionsIdx >= 0 ? render('actions', st, cid, data) : '';

    // To Grade (S7-F4): pinned under the name, like the board; the editor can turn it off.
    var toGradeHtml = order.indexOf('toGrade') >= 0 && window.MGradePhotos ? MGradePhotos.studentListHtml(cid, st) : '';

    // Middle widgets: everything except hero, actions, flagStatus, toGrade
    var skip = new Set(['hero', 'actions', 'flagStatus', 'toGrade']);
    var middleHtml = '';

    // Check for completion+missingWork 2-up pairing
    var hasCompletion = order.indexOf('completion') >= 0;
    var hasMissing = order.indexOf('missingWork') >= 0;
    var paired = hasCompletion && hasMissing;
    var pairedRendered = false;

    for (var i = 0; i < order.length; i++) {
      var key = order[i];
      if (skip.has(key)) continue;

      if (paired && (key === 'completion' || key === 'missingWork')) {
        if (pairedRendered) continue;
        pairedRendered = true;
        var compHtml = render('completion', st, cid, data);
        var missHtml = render('missingWork', st, cid, data);
        if (compHtml || missHtml) {
          middleHtml += '<div class="m-wdg-2up">' + compHtml + missHtml + '</div>';
        }
        continue;
      }

      middleHtml += render(key, st, cid, data);
    }

    return (
      '<div class="m-scard">' +
      heroHtml +
      '<div class="m-scard-widgets">' +
      toGradeHtml +
      _toReturnHtml(st, cid) +
      middleHtml +
      '</div>' +
      actionsHtml +
      '</div>'
    );
  }

  /* ── Public API ──────────────────────────────────────────────── */
  return {
    render: render,
    renderFallbackHero: renderFallbackHero,
    assembleCard: assembleCard,
    commentSheetHtml: commentSheetHtml,
    staleNameNote: staleNameNote,
  };
})();
