// @ts-check
/* report-qn-voice-observations.js — the Term Questionnaire's Observations
   card, the student's Voice card, and the class's report parts. Moved from
   teacher/report-questionnaire.js on 2026-11-13 (move only; the split plan
   is docs/plans/questionnaire-file-map.md). It keeps no state of its own and
   reads no marks. It needs one thing from the main file, the comment box,
   which main hands over through configure. */
window.ReportQnVoiceObservations = (function () {
  'use strict';

  /* What the main file hands in (see configure). */
  var host = /** @type {{ box: () => HTMLTextAreaElement | null }} */ (/** @type {unknown} */ ({ box: null }));
  function configure(opts) {
    host = opts;
  }
  function _box() {
    return host.box();
  }

  /* ── Observations (Questionnaire glance plan, step 4) ────────
     For reading only: nothing here feeds Generate. */

  /* The four types in order (OBS_SENTIMENTS), then All: [{ key, label, title }]. */
  function _obsTypes() {
    var plural = { strength: 'strengths', growth: 'growth', concern: 'concerns', note: 'notes' };
    return Object.keys(OBS_SENTIMENTS)
      .map(function (k) {
        return { key: k, label: OBS_SENTIMENTS[k].label, title: 'Show ' + (plural[k] || k) };
      })
      .concat([{ key: 'all', label: 'All', title: 'Show all observations' }]);
  }

  /* The student's observations, newest first, each with its studentId (the
     store keys them by student), as the student page lists them. */
  function studentObs(cid, sid) {
    return (getStudentQuickObs(cid, sid) || [])
      .map(function (o) {
        return Object.assign({}, o, { studentId: sid });
      })
      .sort(function (a, b) {
        return (
          String(ObsCard.obDay(b)).localeCompare(String(ObsCard.obDay(a))) ||
          String(b.created || '').localeCompare(String(a.created || ''))
        );
      });
  }

  /* How many of each type, and all: { strength, growth, concern, note, all }. */
  function obsCounts(list) {
    var out = { all: list.length };
    Object.keys(OBS_SENTIMENTS).forEach(function (k) {
      out[k] = 0;
    });
    list.forEach(function (ob) {
      if (out[ob.sentiment] != null) out[ob.sentiment]++;
    });
    return out;
  }

  /* The observations dated after the earlier report's last day, or null
     with no earlier report. */
  function obsSinceReport(list, f) {
    if (!f.lastReport) return null;
    return list.filter(function (ob) {
      return ObsCard.obDay(ob) > f.lastReport.endsOn;
    }).length;
  }

  /* The strip's five segments. On the card each opens the drawer on its
     type; in the drawer (`on`, the chosen type) each filters the list. */
  // html-safe: counts are numbers, type keys and labels are OBS_SENTIMENTS' own, labels esc()'d
  function _obsStripHtml(counts, on) {
    var inDrawer = on != null;
    return _obsTypes()
      .map(function (t) {
        var chosen = on === t.key;
        return `<button type="button" class="qno-seg${chosen ? ' on' : ''}" data-sentiment="${t.key}" data-action="${inDrawer ? 'tqObsFilter' : 'tqOpenObs'}" data-filter="${t.key}"${inDrawer ? ` aria-pressed="${chosen}"` : ` title="${esc(t.title)}"`}><span class="qno-seg-n">${counts[t.key] || 0}</span><span class="qno-seg-word">${esc(t.label)}</span></button>`;
      })
      .join('');
  }

  // html-safe: observation cards from ObsCard.html (escapes every value); names, pronouns and the sub-line esc()'d
  function _obsHtml(cid, student, f) {
    var first = student.firstName || displayNameFirst(student);
    var list = studentObs(cid, student.id);
    var since = obsSinceReport(list, f);
    var sub =
      list.length && since != null
        ? 'So far this year · ' + since + ' since the ' + f.lastReport.label + ' report'
        : 'So far this year';
    var top = `<div class="qn-card-top"><span class="qn-card-title">Observations</span><span class="qn-sub">${esc(sub)}</span></div>`;
    if (!list.length) {
      var her = (f.pronouns && f.pronouns.obj) || 'them';
      return `<div class="qn-card qn-obs">${top}
        <div class="qno-empty">No observations for ${esc(first)} yet. Observations you record for ${esc(her)} this year show here.</div>
      </div>`;
    }
    var ctx = ObsCard.context(cid);
    var cards = list
      .slice(0, 3)
      .map(function (ob) {
        return ObsCard.html(ob, ctx, {
          showStudent: false,
          when: 'day',
          readOnly: true,
          action: 'tqOpenObsAt',
          title: 'Opens this observation in full',
        });
      })
      .join('');
    return `<div class="qn-card qn-obs">${top}
      <div class="qno-strip" role="group" aria-label="Open observations by type">${_obsStripHtml(obsCounts(list))}</div>
      <div class="qno-recent">${cards}</div>
      <div class="qno-foot">
        <button type="button" class="qn-card-link qno-view-all" data-action="tqOpenObs" data-filter="all" aria-haspopup="dialog">View All ${list.length}</button>
        <span class="qno-foot-note">Newest first</span>
      </div>
    </div>`;
  }

  /* ── The student's Voice ─────────────────────────────────── */

  function _answer(it) {
    return it && it.v && it.v.text ? String(it.v.text).trim() : '';
  }

  /* The rows: the goal from the Goal Check-In, then the About Me answers
     with the mockup's labels; the "To you only" answer is marked Private.
     An answer the comment quotes is marked "In the comment". */
  function voiceRows(f) {
    var prof = f.voice && f.voice.profile;
    var about = prof && prof.about;
    var ck = prof && prof.checkin;
    var rows = [];
    var goal = ck ? _answer(ck.coreGoal) : '';
    rows.push({
      label: 'Goal',
      text: goal ? '“' + goal.replace(/[“”"]/g, '') + '”' + (f.voice.goalStatus ? ' · ' + f.voice.goalStatus : '') : '',
      empty: 'Not set yet',
    });
    var add = function (label, it, extra) {
      var a = _answer(it);
      if (!a) return;
      rows.push(Object.assign({ label: label, text: a, quote: true }, extra || {}));
    };
    add('Good at', about && about.goodAt);
    add('Hard right now', about && about.hard);
    add('Wants to get better at', about && about.goal);
    add('Learns best', about && about.learns, { quote: false });
    add('To you only', about && about.note, { quote: false, priv: true });
    return rows;
  }

  // html-safe: student answers, goal, labels and name esc()'d, in attributes too
  function _voiceHtml(cid, student, f, comment) {
    var first = student.firstName || displayNameFirst(student);
    var rows = voiceRows(f)
      .map(function (r) {
        var quoted = r.quote && r.text && _quotes(comment, r.text);
        var chip = r.priv
          ? '<span class="qn-chip-private" title="Only you see this. It is never printed and never used in the comment.">Private</span>'
          : r.quote
            ? `<span class="qn-chip-quoted" data-answer="${esc(r.text)}" title="Generate can quote this in the comment."${quoted ? '' : ' hidden'}>In the comment</span>`
            : '';
        return `<div class="qn-voice-row">
          <span class="qn-fact-label">${esc(r.label)}</span>
          <span class="qn-voice-text${r.text ? '' : ' qn-muted'}">${esc(r.text || r.empty)}</span>
          ${chip}
        </div>`;
      })
      .join('');
    return `<div class="qn-card qn-voice">
      <div class="qn-card-top">
        <span class="qn-card-title">${esc(first)}’s Voice</span>
        <a role="link" tabindex="0" data-href="/dashboard?course=${esc(cid)}&manage=questionnaires" class="qn-card-link" title="Opens this class’s Questionnaires in Class Settings, where you choose and send the questions students answer.">Questionnaires ›</a>
      </div>
      ${rows}
    </div>`;
  }

  /* Whether the comment quotes an answer (its words, without a closing
     full stop). */
  function _quotes(comment, text) {
    var t = String(text || '')
      .replace(/[“”"]/g, '')
      .replace(/[.\s]+$/, '');
    return !!t && String(comment || '').indexOf(t) >= 0;
  }

  /* After the comment changes: which answers it quotes. */
  function _syncQuoted() {
    var el = _box();
    if (!el) return;
    var comment = el.value;
    document.querySelectorAll('.qn-chip-quoted[data-answer]').forEach(function (/** @type {HTMLElement} */ chip) {
      chip.hidden = !_quotes(comment, chip.dataset.answer);
    });
  }

  /* ── The class's report ─────────────────────────────────── */

  /* What Progress Reports prints for the class: One Report's model, read
     from what the class saved (ReportOne.modelFor). */
  function _model(cid) {
    return ReportOne.modelFor((typeof getReportConfig === 'function' && getReportConfig(cid)) || {});
  }
  /* A part's name as it prints: the teacher's heading when they renamed it. */
  function _partLabel(model, key, cid) {
    return (model.titles && model.titles[key]) || ReportOne.label(key, cid);
  }
  /* The parts on the class's report, in the order they print, then the
     Feedback Pages that are on; and the parts the class could add. */
  function _parts(cid) {
    var model = _model(cid);
    var on = ReportOne.order(model).filter(function (k) {
      return ReportOne.available(k, cid);
    });
    var fb = ReportOne.FEEDBACK.map(function (f) {
      return f.key;
    });
    var off = ReportOne.offParts(model, cid).filter(function (k) {
      return k !== 'header';
    });
    fb.forEach(function (k) {
      (ReportOne.isOn(model, k) ? on : off).push(k);
    });
    return { model: model, on: on, off: off };
  }

  return {
    configure: configure,
    _obsTypes: _obsTypes,
    studentObs: studentObs,
    obsCounts: obsCounts,
    obsSinceReport: obsSinceReport,
    _obsStripHtml: _obsStripHtml,
    _obsHtml: _obsHtml,
    _answer: _answer,
    voiceRows: voiceRows,
    _voiceHtml: _voiceHtml,
    _quotes: _quotes,
    _syncQuoted: _syncQuoted,
    _model: _model,
    _partLabel: _partLabel,
    _parts: _parts,
  };
})();
