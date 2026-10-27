/* competency-evidence.js — The evidence drawer on a student page competency
   card (docs/DECISIONS.md, "Observations (2026-10-18)", Mockup G).

   The card's tag row opens one dated list, newest first, of that
   competency's scores and the observations linked to it (ob.competencyId is
   the learning-map tag id). A line at the top says how the level is worked
   out; "Add observation" at the bottom opens the shared capture strip with
   the student and the competency filled in.

   Nothing here computes a level. Scores come from getTagScores, the same
   list the level badge uses, so a term limits both alike. An observation's
   level is evidence only and never reaches calc.js. */
window.CompetencyEvidence = (function () {
  'use strict';

  /* ── Pure helpers (exported for tests) ──────────────────── */

  function obDay(ob) {
    return (ob && (ob.date || (ob.created || '').slice(0, 10))) || '';
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* "3 scores · 2 observations", "1 score · 0 observations", or
     "No evidence yet" when there is neither. */
  function countLabel(scoreCount, obsCount) {
    if (!scoreCount && !obsCount) return 'No evidence yet';
    return plural(scoreCount, 'score', 'scores') + ' · ' + plural(obsCount, 'observation', 'observations');
  }

  /* Whether an observation is dated inside the term (true with no term). */
  function obsInTerm(ob, term) {
    if (!term || !term.startsOn || !term.endsOn) return true;
    var d = obDay(ob).slice(0, 10);
    return !!d && d >= term.startsOn && d <= term.endsOn;
  }

  /* The observations linked to one competency, limited to the term. */
  function tagObservations(obs, tagId, term) {
    return (obs || []).filter(function (o) {
      return o && o.competencyId === tagId && obsInTerm(o, term);
    });
  }

  /* Scores and observations on one list, newest first. On the same day the
     observations come first (they carry a time), newest of them first.
       scores   getTagScores rows (already scoped to the term), score > 0
       obs      tagObservations(...)
     → [{ kind: 'score', date, score } | { kind: 'obs', date, ob }] */
  function mergeEvidence(scores, obs) {
    var rows = [];
    (scores || []).forEach(function (s) {
      rows.push({ kind: 'score', date: (s.date || '').slice(0, 10), created: '', score: s });
    });
    (obs || []).forEach(function (o) {
      rows.push({ kind: 'obs', date: obDay(o).slice(0, 10), created: o.created || '', ob: o });
    });
    return rows
      .map(function (r, i) {
        r._i = i;
        return r;
      })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        if (a.kind !== b.kind) return a.kind === 'obs' ? -1 : 1;
        if (a.created !== b.created) return a.created < b.created ? 1 : -1;
        return a._i - b._i;
      })
      .map(function (r) {
        delete r._i;
        delete r.created;
        return r;
      });
  }

  /* The drawer's top line, from what the page already shows: the class's
     method ("Most recent score") and the override, if any.
       levelText   the override's level as the class shows it ("Extending") */
  function explainText(methodLabel, override, levelText) {
    var out = 'Competency level: ' + (methodLabel || 'Most recent score') + '.';
    if (override && override.level > 0) {
      var reason = String(override.reason || '').trim();
      out += ' Overridden to ' + (levelText || String(override.level)) + (reason ? ': ' + reason : '') + '.';
    }
    return out;
  }

  function firstLine(text) {
    return String(text || '')
      .split('\n')[0]
      .trim();
  }

  /* ── Data for one card ──────────────────────────────────── */

  function isHidden(ob) {
    return typeof StudentEvidence !== 'undefined' && StudentEvidence.isPending && StudentEvidence.isPending(ob.id);
  }

  /* What the drawer lists for a student's competency, scoped like the badge. */
  function evidenceFor(cid, sid, tagId) {
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;
    var scores = getTagScores(cid, sid, tagId).filter(function (s) {
      return s.score > 0;
    });
    var obs = tagObservations(getStudentQuickObs(cid, sid), tagId, term).filter(function (o) {
      return !isHidden(o);
    });
    return { scores: scores, obs: obs, rows: mergeEvidence(scores, obs) };
  }

  /* ── HTML ───────────────────────────────────────────────── */

  function overrideLevelText(cid, level) {
    var word = typeof levelWord === 'function' ? levelWord(cid, level) : '';
    return word || formatLevel(cid, level);
  }

  function scoreRowHtml(cid, sid, sc, assessMap) {
    var assess = assessMap[sc.assessmentId];
    var sColor = PROF_COLORS[sc.level || sc.score] || PROF_COLORS[0];
    var href = assess ? '/assignments?course=' + cid + '&open=' + assess.id + '&student=' + sid : '';
    var title = assess ? esc(assess.title) : 'Unknown';
    return (
      '<li class="ced-item"><a class="tag-assess-row"' +
      (href ? ' role="link" tabindex="0" data-href="' + href + '"' : '') +
      ' title="Open in Assignments">' +
      '<span class="tag-assess-pip" style="background:' +
      sColor +
      '">' +
      (sc.level ? formatScoreLevel(sc.level, sc.mod) : sc.score || '—') +
      '</span>' +
      '<span class="tag-assess-title">' +
      title +
      '</span>' +
      '<span class="tag-assess-date">' +
      formatDate(sc.date) +
      '</span>' +
      '</a></li>'
    );
  }

  function obsRowHtml(ob) {
    var full = String(ob.text || '').trim();
    var first = firstLine(full);
    var lvl = typeof ObsCapture !== 'undefined' ? ObsCapture.levelLabel(ob.level) : '';
    var s = ob.sentiment && OBS_SENTIMENTS[ob.sentiment];
    var label =
      'Observation, ' +
      formatDate(obDay(ob)) +
      (s ? ', ' + s.label : '') +
      (lvl ? ', looks ' + lvl : '') +
      ': ' +
      full +
      '. Show in Evidence.';
    return (
      '<li class="ced-item"><button type="button" class="tag-assess-row ced-obs-row" data-ced="jump" data-obid="' +
      esc(ob.id) +
      '"' +
      (ob.sentiment ? ' data-sentiment="' + esc(ob.sentiment) + '"' : '') +
      ' title="' +
      esc(full) +
      '" aria-label="' +
      esc(label) +
      '">' +
      '<span class="ced-obs-mark" aria-hidden="true"></span>' +
      '<span class="ced-obs-main">' +
      (typeof ObsCard !== 'undefined' ? ObsCard.typePillHtml(ob.sentiment) : '') +
      '<span class="ced-obs-text"><span class="ced-obs-first">' +
      esc(first) +
      '</span><span class="ced-obs-full">' +
      esc(full) +
      '</span></span>' +
      (lvl
        ? '<span class="obs-pill obsc-pill-level" data-level="' +
          ob.level +
          '" title="Looks like this level. Evidence only, not a grade.">Looks ' +
          esc(lvl) +
          '</span>'
        : '') +
      '</span>' +
      '<span class="tag-assess-date">' +
      formatDate(obDay(ob)) +
      '</span>' +
      '</button></li>'
    );
  }

  function listHtml(cid, sid, ev, assessMap) {
    if (!ev.rows.length) return '<li class="ced-empty">No evidence yet</li>';
    return ev.rows
      .map(function (r) {
        return r.kind === 'score' ? scoreRowHtml(cid, sid, r.score, assessMap) : obsRowHtml(r.ob);
      })
      .join('');
  }

  function assessMapFor(cid) {
    var map = {};
    (getAssessments(cid) || []).forEach(function (a) {
      map[a.id] = a;
    });
    return map;
  }

  /* The drawer under a card's tag row: the explanation, the list, and
     the Add observation slot. `id` ties it to the row's aria-controls. */
  function drawerHtml(cid, sid, sec, tag, id) {
    var ev = evidenceFor(cid, sid, tag.id);
    var override = getSectionOverride(cid, sid, sec.id);
    return (
      '<div class="tag-detail ced" id="' +
      esc(id) +
      '" data-tagid="' +
      esc(tag.id) +
      '" data-secid="' +
      esc(sec.id) +
      '">' +
      '<div class="ced-explain">' +
      esc(
        explainText(
          describeCalcMethod(cid),
          override,
          override && override.level > 0 ? overrideLevelText(cid, override.level) : '',
        ),
      ) +
      '</div>' +
      '<ul class="ced-list" aria-label="Evidence for ' +
      esc(tag.label) +
      ', newest first">' +
      listHtml(cid, sid, ev, assessMapFor(cid)) +
      '</ul>' +
      '<div class="ced-capture" data-ced-slot></div>' +
      '<div class="ced-foot">' +
      '<button type="button" class="ced-add-btn" data-ced="add">Add observation</button>' +
      '<button type="button" class="ced-done-btn" data-ced="done" hidden>Done</button>' +
      '</div>' +
      '</div>'
    );
  }

  /* The count on the tag row. */
  function rowCount(cid, sid, tagId) {
    var ev = evidenceFor(cid, sid, tagId);
    return countLabel(ev.scores.length, ev.obs.length);
  }

  /* ── Live drawers ───────────────────────────────────────── */

  var _cid = null;
  var _sid = null;
  var _root = null;
  var _onAdd = null;
  var _capture = null;
  var _captureTag = null;

  function drawers() {
    return _root ? Array.prototype.slice.call(_root.querySelectorAll('.ced[data-tagid]')) : [];
  }

  function rowFor(drawer) {
    return _root && _root.querySelector('.dash-tag-row[aria-controls="' + drawer.id + '"]');
  }

  /* Redraw every drawer's list and its row's count from the data layer. */
  function refresh() {
    if (!_root) return;
    var assessMap = assessMapFor(_cid);
    drawers().forEach(function (d) {
      var tagId = d.getAttribute('data-tagid');
      var ev = evidenceFor(_cid, _sid, tagId);
      var list = d.querySelector('.ced-list');
      if (list) list.innerHTML = listHtml(_cid, _sid, ev, assessMap);
      var row = rowFor(d);
      var count = row && row.querySelector('.dash-tag-evidence');
      if (count) count.textContent = countLabel(ev.scores.length, ev.obs.length);
    });
  }

  function setCaptureOpen(drawer, open) {
    var add = drawer.querySelector('[data-ced="add"]');
    var done = drawer.querySelector('[data-ced="done"]');
    if (add) add.hidden = open;
    if (done) done.hidden = !open;
  }

  function closeCapture() {
    if (_capture) _capture.destroy();
    _capture = null;
    _captureTag = null;
    drawers().forEach(function (d) {
      setCaptureOpen(d, false);
    });
  }

  function openCapture(drawer) {
    var tagId = drawer.getAttribute('data-tagid');
    if (_capture && _captureTag !== tagId) closeCapture();
    var cid = _cid;
    var sid = _sid;
    if (!_capture) {
      _capture = ObsCapture.create({
        cid: cid,
        idPrefix: 'ced-',
        students: [sid],
        lockStudents: true,
        competencyId: tagId,
        draftKey: 'competency|' + sid + '|' + tagId,
        placeholder: 'What did you notice?',
        onAdd: function () {
          if (_cid !== cid || _sid !== sid) return;
          refresh();
          if (typeof _onAdd === 'function') _onAdd();
        },
      });
      _captureTag = tagId;
    }
    _capture.mount(drawer.querySelector('[data-ced-slot]'));
    setCaptureOpen(drawer, true);
    _capture.focus();
  }

  function onClick(e) {
    var el = e.target.closest && e.target.closest('[data-ced]');
    if (!el || !_root || !_root.contains(el)) return;
    var drawer = el.closest('.ced');
    if (!drawer) return;
    var act = el.getAttribute('data-ced');
    if (act === 'add') {
      e.preventDefault();
      openCapture(drawer);
    } else if (act === 'done') {
      e.preventDefault();
      closeCapture();
      var add = drawer.querySelector('[data-ced="add"]');
      if (add) add.focus();
    } else if (act === 'jump') {
      e.preventDefault();
      if (typeof StudentEvidence !== 'undefined') StudentEvidence.jumpTo(el.getAttribute('data-obid'));
    }
  }

  /* Wire the drawers the page just drew inside `root`. Called after every
     page render; an open capture strip moves into its drawer's new slot,
     keeping its text. opts.onAdd runs after an observation is added. */
  function mount(cid, sid, root, opts) {
    if (_cid !== cid || _sid !== sid) closeCapture();
    if (_root && _root !== root) _root.removeEventListener('click', onClick);
    _cid = cid;
    _sid = sid;
    _onAdd = (opts && opts.onAdd) || null;
    if (!root) return;
    if (_root !== root) root.addEventListener('click', onClick);
    _root = root;
    if (_capture) {
      var d = drawers().find(function (x) {
        return x.getAttribute('data-tagid') === _captureTag;
      });
      if (d) {
        _capture.mount(d.querySelector('[data-ced-slot]'));
        setCaptureOpen(d, true);
      } else closeCapture();
    }
  }

  function destroy() {
    closeCapture();
    if (_root) _root.removeEventListener('click', onClick);
    _root = null;
  }

  return {
    drawerHtml: drawerHtml,
    rowCount: rowCount,
    evidenceFor: evidenceFor,
    mount: mount,
    refresh: refresh,
    openCapture: openCapture,
    closeCapture: closeCapture,
    destroy: destroy,
    _helpers: {
      countLabel: countLabel,
      obsInTerm: obsInTerm,
      tagObservations: tagObservations,
      mergeEvidence: mergeEvidence,
      explainText: explainText,
    },
  };
})();
