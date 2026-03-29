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

  /* ── Public API ──────────────────────────────────────────────── */
  return {
    render: render,
    renderFallbackHero: renderFallbackHero,
  };
})();
