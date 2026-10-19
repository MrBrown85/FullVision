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

  function cardWhen(ob) {
    var d = new Date(ob.created || obDay(ob) + 'T12:00:00');
    var opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return (
      d.toLocaleDateString('en-CA', opts) +
      ' · ' +
      d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })
    );
  }

  function typePillHtml(sentiment) {
    var s = sentiment && OBS_SENTIMENTS[sentiment];
    if (!s) return '';
    return '<span class="obs-pill obs-pill-type" data-sentiment="' + sentiment + '">' + esc(s.label) + '</span>';
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

  /* opts:
       showStudent   the student's name leads the card (default true)
       action        data-action on the card ('openFocus' by default; null for none) */
  function html(ob, ctx, opts) {
    opts = opts || {};
    var showStudent = opts.showStudent !== false;
    var action = opts.action === undefined ? 'openFocus' : opts.action;
    var cid = ctx.cid;
    var byId = ctx.studentsById || {};
    var s = byId[ob.studentId];
    var sn = s ? displayName(s) : ob.studentId;
    var others = (ctx.sameCapture[captureKey(ob)] || [])
      .filter(function (sid) {
        return sid !== ob.studentId;
      })
      .map(function (sid) {
        return byId[sid] ? displayName(byId[sid]) : null;
      })
      .filter(Boolean);
    var quoted = quotedLabel(ctx.quoted[ob.studentId + '|' + ob.id], ctx.hasTerms);
    var ctxInfo = ob.context && OBS_CONTEXTS[ob.context];
    var aTitle = isLinked(ob) ? assessmentTitle(cid, ob) || 'Assessment' : '';

    var out =
      '<div class="obs-card"' +
      (action ? ' data-action="' + action + '" tabindex="0"' : ' tabindex="-1"') +
      ' data-sid="' +
      ob.studentId +
      '" data-obid="' +
      ob.id +
      '"' +
      (ob.sentiment ? ' data-sentiment="' + ob.sentiment + '"' : '') +
      '>' +
      '<div class="obs-card-header"><div class="obs-card-meta">' +
      (showStudent ? '<span class="obs-card-student">' + esc(sn) + '</span>' : '') +
      (others.length ? '<span class="obs-card-with">' + esc(withLabel(others)) + '</span>' : '') +
      '<span class="obs-card-time">' +
      esc(cardWhen(ob)) +
      '</span>' +
      typePillHtml(ob.sentiment) +
      (ctxInfo ? '<span class="obs-pill obs-pill-context">' + esc(ctxInfo.label) + '</span>' : '') +
      (aTitle ? '<span class="obs-pill obs-pill-assessment">' + esc(aTitle) + '</span>' : '') +
      ObsCapture.linkPillsHtml(cid, ob) +
      '</div>' +
      '<span class="obs-card-header-actions">' +
      (quoted ? '<span class="obs-card-quoted">' + esc(quoted) + '</span>' : '') +
      '<button type="button" class="obs-card-delete" data-action="deleteOb" data-sid="' +
      ob.studentId +
      '" data-obid="' +
      ob.id +
      '" data-stop-prop="true" title="Delete" aria-label="Delete observation">' +
      TRASH_SVG +
      '</button></span></div>' +
      '<div class="obs-card-text">' +
      esc(ob.text) +
      '</div>';
    if (ob.dims && ob.dims.length > 0) {
      out += '<div class="obs-card-dims">';
      ob.dims.forEach(function (t) {
        var info = resolveTag(t);
        out +=
          '<span class="obs-card-dim"><span class="dim-dot" style="background:' +
          obsTagColor(t) +
          '"></span>' +
          esc(info.label) +
          '</span>';
      });
      out += '</div>';
    }
    out += '</div>';
    return out;
  }

  return {
    html: html,
    context: context,
    typePillHtml: typePillHtml,
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
