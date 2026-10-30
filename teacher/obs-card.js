/* obs-card.js — One observation card, as the Observations page and the
   student page's Evidence panel show it.

   ObsCard.context(cid, opts) gathers what a card needs from the whole class
   (which observations a report quotes, which were one capture for several
   students). Build it once per list and pass it to ObsCard.html(ob, ctx). */
window.ObsCard = (function () {
  'use strict';

  var TRASH_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>';

  /* ── Pure helpers (exported for tests) ──────────────────── */

  function obDay(ob) {
    return ob.date || (ob.created || '').slice(0, 10);
  }

  /* sid|obId → sorted term numbers whose rating quotes that observation
     (term ratings are keyed 'term-N'; mentionObs holds observation ids). */
  function quotedIndex(termRatings) {
    var out = {};
    Object.keys(termRatings || {}).forEach(function (sid) {
      var byTerm = termRatings[sid] || {};
      Object.keys(byTerm).forEach(function (termId) {
        var ids = (byTerm[termId] && byTerm[termId].mentionObs) || [];
        var m = String(termId).match(/(\d+)$/);
        var n = m ? Number(m[1]) : null;
        ids.forEach(function (id) {
          var k = sid + '|' + id;
          if (!out[k]) out[k] = [];
          if (n != null && out[k].indexOf(n) < 0) out[k].push(n);
        });
      });
    });
    Object.keys(out).forEach(function (k) {
      out[k].sort(function (a, b) {
        return a - b;
      });
    });
    return out;
  }

  /* "Quoted in Report 1", "Quoted in Reports 1 and 2", or "Quoted" when the
     class has no reporting terms. Null when not quoted. */
  function quotedLabel(termNums, hasTerms) {
    if (!termNums) return null;
    if (!hasTerms || !termNums.length) return 'Quoted';
    if (termNums.length === 1) return 'Quoted in Report ' + termNums[0];
    return 'Quoted in Reports ' + termNums.slice(0, -1).join(', ') + ' and ' + termNums[termNums.length - 1];
  }

  /* A multi-student capture is one row per student with the same text and
     the same minute. Key → student ids, in feed order. */
  function captureKey(ob) {
    return (ob.text || '').trim() + '|' + (ob.created || '').slice(0, 16);
  }
  function sameCaptureIndex(obs) {
    var out = {};
    obs.forEach(function (ob) {
      var k = captureKey(ob);
      if (!out[k]) out[k] = [];
      if (out[k].indexOf(ob.studentId) < 0) out[k].push(ob.studentId);
    });
    return out;
  }

  /* "with Sofia Bianchi", "with Sofia Bianchi and Ines Lamba",
     "with Sofia Bianchi, Ines Lamba and 2 others". */
  function withLabel(names) {
    if (!names.length) return '';
    if (names.length === 1) return 'with ' + names[0];
    if (names.length === 2) return 'with ' + names[0] + ' and ' + names[1];
    if (names.length === 3) return 'with ' + names[0] + ', ' + names[1] + ' and ' + names[2];
    return 'with ' + names[0] + ', ' + names[1] + ' and ' + (names.length - 2) + ' others';
  }

  function isLinked(ob) {
    var ac = ob.assignmentContext;
    return !!(ac && (ac.assessmentId || ac.assessmentTitle));
  }

  function assessmentTitle(cid, ob) {
    var ac = ob.assignmentContext;
    if (!ac) return '';
    if (ac.assessmentTitle) return ac.assessmentTitle;
    if (!ac.assessmentId) return '';
    var a = (getAssessments(cid) || []).find(function (x) {
      return x.id === ac.assessmentId;
    });
    return a ? a.title || '' : '';
  }

  /* ── Card pieces ────────────────────────────────────────── */

  function _date(ob) {
    return new Date(ob.created || obDay(ob) + 'T12:00:00');
  }

  /* "12:00 p.m." The feed's day header carries the date. */
  function cardTime(ob) {
    if (!ob.created) return '';
    return _date(ob).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  }

  /* "Fri, Oct 16 · 12:00 p.m." for lists without day headers. */
  function cardWhen(ob) {
    var d = _date(ob);
    var opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    var day = d.toLocaleDateString('en-CA', opts);
    var t = cardTime(ob);
    return t ? day + ' · ' + t : day;
  }

  /* The type as a solid word block in the proficiency colours, a fixed
     74 px column so names line up. An untyped note is an empty outline. */
  function typeBlockHtml(sentiment) {
    var s = sentiment && OBS_SENTIMENTS[sentiment];
    if (!s) return '<span class="obs-type obs-type-none" aria-hidden="true"></span>';
    return '<span class="obs-type" data-sentiment="' + sentiment + '">' + esc(s.label) + '</span>';
  }

  function typePillHtml(sentiment) {
    var s = sentiment && OBS_SENTIMENTS[sentiment];
    if (!s) return '';
    return '<span class="obs-pill obs-pill-type" data-sentiment="' + sentiment + '">' + esc(s.label) + '</span>';
  }

  /* "Friday, Oct 16" (or Today / Yesterday) and the day's count. */
  function dayHeaderHtml(label, count) {
    return (
      '<div class="obs-feed-date-label"><span>' +
      esc(label) +
      '</span><span class="obs-feed-date-count">' +
      count +
      (count === 1 ? ' observation' : ' observations') +
      '</span></div>'
    );
  }

  /* ── Editor pieces (the edit window and the capture strip) ── */

  /* The folder band: the four types as tabs, the chosen one filled, and
     a note at the right. Clicking the chosen tab again clears it.
     opts: value, action (data-action on each tab), right (text),
           tabAttrs(key) (extra attributes per tab, replacing action). */
  function typeBandHtml(opts) {
    var out = '<div class="obs-band" role="group" aria-label="Type">';
    Object.keys(OBS_SENTIMENTS).forEach(function (k) {
      var on = opts.value === k;
      out +=
        '<button type="button" class="obs-band-tab' +
        (on ? ' on' : '') +
        '" data-sentiment="' +
        k +
        '" aria-pressed="' +
        on +
        '" ' +
        (opts.tabAttrs ? opts.tabAttrs(k) : 'data-action="' + opts.action + '" data-value="' + k + '"') +
        '>' +
        esc(OBS_SENTIMENTS[k].label) +
        '</button>';
    });
    if (opts.right) out += '<span class="obs-band-right">' + esc(opts.right) + '</span>';
    return out + '</div>';
  }

  function syncTypeBand(root, value) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.obs-band-tab').forEach(function (b) {
      var on = b.getAttribute('data-sentiment') === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* The context menu: "Independent ▾" when set, "+ Context ▾" when not;
     open, a short list of the five contexts with None last.
     opts: id, value, open, labelledBy, toggleAction, pickAction,
           toggleAttrs / pickAttrs(key) (replacing the actions). */
  function contextMenuHtml(opts) {
    var info = opts.value && OBS_CONTEXTS[opts.value];
    var out =
      '<div class="obs-menu-wrap"><button type="button" class="obs-menu-btn' +
      (info ? '' : ' empty') +
      '" id="' +
      opts.id +
      '-btn" aria-haspopup="menu" aria-expanded="' +
      !!opts.open +
      '"' +
      (opts.labelledBy ? ' aria-labelledby="' + opts.labelledBy + ' ' + opts.id + '-btn"' : '') +
      ' ' +
      (opts.toggleAttrs || 'data-action="' + opts.toggleAction + '"') +
      '>' +
      (info ? esc(info.label) : '+ Context') +
      '<span class="obs-menu-car" aria-hidden="true">▾</span></button>';
    if (opts.open) {
      out += '<div class="obs-menu" role="menu" id="' + opts.id + '-menu">';
      Object.keys(OBS_CONTEXTS)
        .concat([''])
        .forEach(function (k) {
          var on = k ? opts.value === k : !info;
          out +=
            '<button type="button" role="menuitemradio" class="obs-menu-item' +
            (on ? ' on' : '') +
            (k ? '' : ' obs-menu-none') +
            '" aria-checked="' +
            on +
            '" tabindex="-1" ' +
            (opts.pickAttrs ? opts.pickAttrs(k) : 'data-action="' + opts.pickAction + '" data-value="' + k + '"') +
            '>' +
            (k ? esc(OBS_CONTEXTS[k].label) : 'None') +
            '</button>';
        });
      out += '</div>';
    }
    return out + '</div>';
  }

  function focusContextMenu(root) {
    var menu = root && root.querySelector('.obs-menu');
    if (!menu) return;
    var item = menu.querySelector('.obs-menu-item.on') || menu.querySelector('.obs-menu-item');
    if (item) item.focus();
  }

  /* Arrow keys, Home and End move through an open menu. True if handled. */
  function contextMenuKey(e, root) {
    var menu = root && root.querySelector('.obs-menu');
    if (!menu) return false;
    var items = Array.prototype.slice.call(menu.querySelectorAll('.obs-menu-item'));
    var i = items.indexOf(document.activeElement);
    var next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    if (!next) return false;
    e.preventDefault();
    next.focus();
    return true;
  }

  /* opts.hidden: obId → truthy for observations the list is hiding (a
     delete waiting on its Undo toast); they do not count as "with …". */
  function context(cid, opts) {
    opts = opts || {};
    var hidden = opts.hidden || {};
    var studentsById = {};
    (getStudents(cid) || []).forEach(function (s) {
      studentsById[s.id] = s;
    });
    return {
      cid: cid,
      quoted: quotedIndex(getTermRatings(cid)),
      hasTerms: getReportingTerms(cid).length > 0,
      sameCapture: sameCaptureIndex(
        getAllQuickObs(cid).filter(function (o) {
          return !hidden[o.id];
        }),
      ),
      studentsById: studentsById,
    };
  }

  /* Everything a card shows besides the type block and the note, so the
     desktop and phone cards read the same. */
  function parts(ob, ctx) {
    var byId = ctx.studentsById || {};
    var s = byId[ob.studentId];
    var others = (ctx.sameCapture[captureKey(ob)] || [])
      .filter(function (sid) {
        return sid !== ob.studentId;
      })
      .map(function (sid) {
        return byId[sid] ? displayName(byId[sid]) : null;
      })
      .filter(Boolean);
    var ctxInfo = ob.context && OBS_CONTEXTS[ob.context];
    return {
      name: s ? displayName(s) : ob.studentId,
      withText: withLabel(others),
      quoted: quotedLabel(ctx.quoted[ob.studentId + '|' + ob.id], ctx.hasTerms),
      private: isPrivateObservation(ob),
      context: ctxInfo ? ctxInfo.label : '',
      assessment: isLinked(ob) ? assessmentTitle(ctx.cid, ob) || 'Assessment' : '',
    };
  }

  /* The meta line: context (lightest), a linked assessment, a linked
     competency, the tags with their dots, and "Quoted in Report N" as a
     stamp at the right. Empty when there is nothing to show. */
  function metaHtml(ob, ctx, p) {
    var tags = (ob.dims || [])
      .map(function (t) {
        return (
          '<span class="obs-card-dim"><span class="dim-dot" style="background:' +
          obsTagColor(t) +
          '"></span>' +
          esc(resolveTag(t).label) +
          '</span>'
        );
      })
      .join('');
    var out =
      obsPrivateLabelHtml(ob) +
      (p.context ? '<span class="obs-card-context">' + esc(p.context) + '</span>' : '') +
      (p.assessment ? '<span class="obs-card-assessment">' + esc(p.assessment) + '</span>' : '') +
      ObsCapture.linkPillsHtml(ctx.cid, ob, 'obs-card-link') +
      (tags ? '<span class="obs-card-dims">' + tags + '</span>' : '') +
      (p.quoted ? '<span class="obs-card-quoted">' + esc(p.quoted) + '</span>' : '');
    return out ? '<div class="obs-card-meta">' + out + '</div>' : '';
  }

  /* opts:
       showStudent   the student's name leads the card (default true)
       action        data-action on the card ('openFocus' by default; null for none)
       when          'time' (default; under a day header) or 'date' (date and time) */
  function html(ob, ctx, opts) {
    opts = opts || {};
    var showStudent = opts.showStudent !== false;
    var action = opts.action === undefined ? 'openFocus' : opts.action;
    var p = parts(ob, ctx);
    var when = opts.when === 'date' ? cardWhen(ob) : cardTime(ob);

    return (
      '<div class="obs-card"' +
      (action ? ' data-action="' + action + '" tabindex="0"' : ' tabindex="-1"') +
      ' data-sid="' +
      ob.studentId +
      '" data-obid="' +
      ob.id +
      '"' +
      (ob.sentiment ? ' data-sentiment="' + ob.sentiment + '"' : '') +
      '>' +
      typeBlockHtml(ob.sentiment) +
      '<div class="obs-card-main"><div class="obs-card-header">' +
      (showStudent ? '<span class="obs-card-student">' + esc(p.name) + '</span>' : '') +
      (p.withText ? '<span class="obs-card-with">' + esc(p.withText) + '</span>' : '') +
      (when ? '<span class="obs-card-time">' + esc(when) + '</span>' : '') +
      '</div>' +
      '<div class="obs-card-text">' +
      esc(ob.text) +
      '</div>' +
      metaHtml(ob, ctx, p) +
      '</div>' +
      '<button type="button" class="obs-card-delete" data-action="deleteOb" data-sid="' +
      ob.studentId +
      '" data-obid="' +
      ob.id +
      '" data-stop-prop="true" title="Delete" aria-label="Delete observation">' +
      TRASH_SVG +
      '</button></div>'
    );
  }

  return {
    TRASH_SVG: TRASH_SVG,
    typeBandHtml: typeBandHtml,
    syncTypeBand: syncTypeBand,
    contextMenuHtml: contextMenuHtml,
    focusContextMenu: focusContextMenu,
    contextMenuKey: contextMenuKey,
    html: html,
    context: context,
    typePillHtml: typePillHtml,
    typeBlockHtml: typeBlockHtml,
    dayHeaderHtml: dayHeaderHtml,
    parts: parts,
    metaHtml: metaHtml,
    cardTime: cardTime,
    cardWhen: cardWhen,
    assessmentTitle: assessmentTitle,
    isLinked: isLinked,
    obDay: obDay,
    quotedIndex: quotedIndex,
    quotedLabel: quotedLabel,
    captureKey: captureKey,
    sameCaptureIndex: sameCaptureIndex,
    withLabel: withLabel,
  };
})();
