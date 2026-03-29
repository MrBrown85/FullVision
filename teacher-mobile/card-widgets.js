/* card-widgets.js — Pluggable widget render functions for student cards */

window.MCardWidgets = (function() {
  'use strict';

  var MC = window.MComponents;
  var MAX_PROF = 4;
  var _renderers = {};

  /* ── Public dispatch ──────────────────────────────────────────── */
  function render(key, st, cid, data) {
    var fn = _renderers[key];
    if (!fn) return '';
    return fn(st, cid, data);
  }

  /* ── Shared badge helper ─────────────────────────────────────── */
  function _renderBadges(st) {
    var badges = '';
    if (st.designations && st.designations.length) {
      st.designations.forEach(function(code) {
        var des = BC_DESIGNATIONS[code];
        if (des && des.iep) badges += '<span class="m-badge m-badge-iep">IEP</span>';
        if (des && des.modified) badges += '<span class="m-badge m-badge-mod">MOD</span>';
      });
    }
    return badges;
  }

  /* ── hero ────────────────────────────────────────────────────── */
  _renderers.hero = function(st, cid) {
    var overall = getOverallProficiency(cid, st.id);
    var rounded = Math.round(overall);
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    var badges = _renderBadges(st);

    // Flag icon: only when flagStatus widget is in order AND student is flagged
    var flagHTML = '';
    var cfg = getCardWidgetConfig();
    if (cfg.order.indexOf('flagStatus') >= 0 && isStudentFlagged(cid, st.id)) {
      flagHTML = '<span class="m-scard-flag" title="Flagged" aria-label="Flagged">&#x1F6A9;</span>';
    }

    return '<div class="m-scard-hero">' +
      '<div class="m-scard-avatar" style="background:' + color + '">' + initials + '</div>' +
      '<div class="m-scard-info">' +
        '<div class="m-scard-name">' + MC.esc(name) + flagHTML + '</div>' +
        (st.pronouns ? '<div class="m-scard-sub">' + MC.esc(st.pronouns) + '</div>' : '') +
        (badges ? '<div class="m-scard-badges">' + badges + '</div>' : '') +
      '</div>' +
      '<div class="m-scard-prof">' +
        '<div class="m-scard-prof-val" style="color:' + MC.profBg(rounded) + '">' + (overall > 0 ? overall.toFixed(1) : '—') + '</div>' +
        '<div class="m-scard-prof-label">' + (PROF_LABELS[rounded] || 'No Evidence') + '</div>' +
      '</div>' +
    '</div>';
  };

  /* ── renderFallbackHero (used when hero widget is disabled) ──── */
  function renderFallbackHero(st) {
    var color = MC.avatarColor(st.id);
    var initials = MC.avatarInitials(st);
    var name = displayName(st);
    return '<div class="m-scard-hero-min">' +
      '<div class="m-scard-avatar-min" style="background:' + color + '">' + initials + '</div>' +
      '<div class="m-scard-name-min">' + MC.esc(name) + '</div>' +
    '</div>';
  }

  /* ── sectionBars ─────────────────────────────────────────────── */
  _renderers.sectionBars = function(st, cid, data) {
    var sections = data.sections;
    if (!sections || !sections.length) return '';

    var secBars = '';
    sections.forEach(function(sec) {
      var secProf = getSectionProficiency(cid, st.id, sec.id);
      var pct = Math.min(100, Math.round(secProf / MAX_PROF * 100));
      secBars += '<div class="m-scard-sec-row">' +
        '<div class="m-scard-sec-dot" style="background:' + (sec.color || '#888') + '"></div>' +
        '<div class="m-scard-sec-name">' + MC.esc(sec.shortName || sec.name) + '</div>' +
        '<div class="m-scard-sec-bar"><div class="m-scard-sec-fill" style="width:' + pct + '%;background:' + MC.profBg(Math.round(secProf)) + '"></div></div>' +
      '</div>';
    });

    return '<div class="m-scard-sections">' + secBars + '</div>';
  };

  /* ── obsSnippet ──────────────────────────────────────────────── */
  _renderers.obsSnippet = function(st, cid) {
    var obs = getStudentQuickObs(cid, st.id);
    if (!obs.length) {
      return '<div class="m-scard-obs-empty"><em>No observations yet</em></div>';
    }
    var latest = obs[0];
    var text = (latest.text || '').substring(0, 80);
    if (latest.text && latest.text.length > 80) text += '…';
    return '<div class="m-scard-obs">' +
      '<span style="color:var(--text-3);font-size:12px">' + MC.relativeTime(latest.created) + '</span> ' +
      MC.esc(text) +
    '</div>';
  };

  /* ── actions ─────────────────────────────────────────────────── */
  _renderers.actions = function(st) {
    return '<div class="m-scard-actions">' +
      '<button class="m-scard-btn m-scard-btn-observe" data-action="m-obs-quick-menu" data-sid="' + st.id + '">Observe</button>' +
      '<button class="m-scard-btn m-scard-btn-view" data-action="m-student-detail" data-sid="' + st.id + '">View Profile</button>' +
    '</div>';
  };

  /* ── completion (arc ring metric tile) ───────────────────────── */
  _renderers.completion = function(st, cid) {
    var pct = getCompletionPct(cid, st.id);
    var color = pct >= 80 ? 'var(--score-3)' : pct >= 50 ? 'var(--score-2)' : 'var(--score-1)';
    var r = 11, cx = 14, cy = 14, circ = 2 * Math.PI * r;
    var offset = circ * (1 - pct / 100);
    var svg = '<svg class="m-wdg-arc" width="28" height="28" viewBox="0 0 28 28">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--bg-secondary)" stroke-width="3"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="3" ' +
        'stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="round" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' +
      '<text x="' + cx + '" y="' + cy + '" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill="' + color + '">' + Math.round(pct) + '</text>' +
    '</svg>';
    return '<div class="m-wdg-tile">' + svg + '<div class="m-wdg-tile-label">Complete</div></div>';
  };

  /* ── missingWork (alert metric tile) ─────────────────────────── */
  _renderers.missingWork = function(st, cid, data) {
    var statuses = (data && data.statuses) || getAssignmentStatuses(cid);
    var assessments = getAssessments(cid);
    var count = assessments.filter(function(a) {
      return statuses[st.id + ':' + a.id] === 'NS';
    }).length;
    if (count === 0) return '';
    return '<div class="m-wdg-tile m-wdg-alert">' +
      '<div class="m-wdg-alert-val">' + count + '</div>' +
      '<div class="m-wdg-tile-label">Missing</div>' +
    '</div>';
  };

  /* ── growth (journey pill) ────────────────────────────────────── */
  _renderers.growth = function(st, cid, data) {
    // Collect all summative scores across all sections/tags
    var allSummScores = [];
    var sections = (data && data.sections) || [];
    sections.forEach(function(sec) {
      (sec.tags || []).forEach(function(tag) {
        getTagScores(cid, st.id, tag.id).forEach(function(s) {
          if (s.type === 'summative' && s.score > 0) allSummScores.push(s);
        });
      });
    });

    if (!allSummScores.length) return '';

    // Sort ascending by date
    allSummScores.sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });

    if (allSummScores.length === 1) {
      var onlyScore = allSummScores[0].score;
      return '<div class="m-wdg-growth">' +
        '<span class="m-wdg-growth-label">' + (PROF_LABELS[onlyScore] || 'No Evidence') + '</span>' +
        '<span class="m-wdg-growth-meta"> — 1 assessment</span>' +
      '</div>';
    }

    var firstScore = allSummScores[0].score;
    var lastScore = allSummScores[allSummScores.length - 1].score;
    var arrowColor, arrowChar;
    if (lastScore > firstScore) {
      arrowColor = 'var(--score-3)';
      arrowChar = '↑';
    } else if (lastScore < firstScore) {
      arrowColor = 'var(--score-1)';
      arrowChar = '↓';
    } else {
      arrowColor = 'var(--text-3)';
      arrowChar = '→';
    }

    return '<div class="m-wdg-growth">' +
      '<span class="m-wdg-growth-label">' + (PROF_LABELS[firstScore] || 'No Evidence') + '</span>' +
      '<span class="m-wdg-growth-arrow" style="color:' + arrowColor + '">' + arrowChar + '</span>' +
      '<span class="m-wdg-growth-label">' + (PROF_LABELS[lastScore] || 'No Evidence') + '</span>' +
      '<span class="m-wdg-growth-meta"> (' + allSummScores.length + ' assessments)</span>' +
    '</div>';
  };

  /* ── Public API ──────────────────────────────────────────────── */
  return {
    render: render,
    renderFallbackHero: renderFallbackHero,
  };
})();
