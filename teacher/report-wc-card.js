// @ts-check
/* report-wc-card.js — Write Comments: the pieces of the page that stand
   beside the boxes (docs/plans/write-comments-plan.md): the student's name
   and the search, a habit's slider, the attendance boxes, the observations
   and the parts of the Teacher Comment card that the main file keeps. Each
   returns markup drawn with esc(). */
window.ReportWcCard = (function () {
  'use strict';

  /* ── The head of the page ────────────────────────────────── */

  // html-safe: name, initials, pronouns, designations and ids esc()'d; the avatar colour is from a fixed palette
  function header(rq, student, f, q) {
    var sid = student.id;
    var cid = rq.cid();
    var first = student.firstName || displayNameFirst(student);
    var des = CommentBank.goalsOffered(f).map(function (b) {
      return b === 'language_goals' ? 'ELL' : 'IEP';
    });
    var link = `<a role="link" tabindex="0" data-href="/student?id=${esc(sid)}&course=${esc(cid)}" class="qn-head-link" title="${esc('Opens ' + first + '’s Student Dashboard. Its Term Questionnaire button returns here, to the same student.')}">Student Dashboard ›</a>`;
    return `<div class="qn-head wc-head-card">
      <span class="qn-avatar" style="background:${_avatarColor(sid)}" aria-hidden="true">${esc(initials(student))}</span>
      <div class="qn-who">
        <span class="qn-name">${esc(displayName(student))}</span>
        <span class="qn-head-sub">${student.pronouns ? esc(student.pronouns) + ' · ' : ''}${des
          .map(function (d) {
            return esc(d) + ' · ';
          })
          .join('')}${link}</span>
      </div>
      <input type="search" id="wc-search" class="wc-search" aria-label="Search what happened and the sentences" placeholder="Search" value="${esc(q || '')}">
    </div>`;
  }

  /* ── Work Habits and Attendance ──────────────────────────── */

  /* One habit's slider with four stops, drawn at its saved rating. */
  // html-safe: the habit's key and name are fixed words, esc()'d
  function slider(rq, key) {
    var h = CommentBank.HABITS.find(function (x) {
      return x.key === key;
    });
    var cur = rq.habitValue(key);
    var dots = '';
    var stops = '';
    for (var i = 0; i < 4; i++) {
      dots += `<span class="qn-hs-dot" style="--i:${i}"></span>`;
      stops += `<span class="qn-hs-stop" style="--i:${i}" data-habit="${key}" data-value="${i + 1}"></span>`;
    }
    return `<div class="qn-hs${cur ? ' set' : ''}" role="slider" tabindex="0" data-habit="${key}" data-value="${cur}" style="--at:${Math.max(0, cur - 1)}" aria-label="${esc(h ? h.name : key)}" aria-valuemin="1" aria-valuemax="4"${cur ? ` aria-valuenow="${cur}"` : ''} aria-valuetext="${esc(cur ? CommentBank.SCALE[cur - 1] : 'Not rated')}">
      <div class="qn-hs-track" aria-hidden="true"><span class="qn-hs-rail"></span>${dots}<span class="qn-hs-fill"></span><span class="qn-hs-thumb"></span>${stops}</div>
    </div>`;
  }

  // html-safe: totals are whole numbers or empty; the note is drawn by the main file with esc()
  function attendance(rq, student, f, box) {
    var att = getTermAttendance(rq.cid(), student.id, rq.termId());
    var warn = function (k, p) {
      return att[k] != null && att[p] != null && att[k] < att[p] ? ' warn' : '';
    };
    var field = function (id, key, label, prev, v) {
      return `<label class="qn-att-field">${label}<input type="number" min="0" max="200" step="1" inputmode="numeric" class="qn-att-input${warn(key, prev)}" id="${id}" data-tq-att="${key}" data-sid="${student.id}" aria-label="${label}" title="${label} so far this year, as a total to date. Optional." value="${v == null ? '' : v}"></label>`;
    };
    return (
      field('tq-att-absences', 'absences', 'Classes Absent', 'prevAbsences', att.absences) +
      field('tq-att-lates', 'lates', 'Times Late', 'prevLates', att.lates) +
      `<span class="qn-att-note" id="tq-att-note" aria-live="polite">${rq.attendanceNoteHtml(att)}</span>`
    );
  }

  /* ── Observations: for reading only ──────────────────────── */

  // html-safe: the observation cards come from ObsCard.html, which escapes every value
  function observations(rq, student, f) {
    return /** @type {any} */ (window).ReportQnVoiceObservations._obsBody(rq.cid(), student, f);
  }

  /* ── The parts of the Teacher Comment card the main file keeps ── */

  function tabs(rq, cid, sid, termId) {
    var earlier = rq.earlierReports(cid, sid, termId);
    var tab = rq.commentTab();
    if (!earlier.length) return [];
    var all = [['this', 'This Report']].concat(
      earlier.map(function (k) {
        return [k, rq.reportLabel(k)];
      }),
    );
    return all.map(function (t) {
      return {
        key: t[0],
        label: t[1],
        on: tab === t[0],
        tip:
          t[0] === 'this' ? 'The comment for this report.' : 'The comment that went home in ' + t[1] + '. Read only.',
      };
    });
  }

  function parts(rq, cid, student, f) {
    var sid = student.id;
    var termId = rq.termId();
    var rating = getStudentTermRating(cid, sid, termId) || {};
    var text = rq.shownText(rating);
    var thisTab = rq.commentTab() === 'this';
    var stale = thisTab ? rq.staleFor(cid, student) : null;
    var old = thisTab ? '' : (getStudentTermRating(cid, sid, rq.commentTab()) || {}).narrative;
    return {
      cid: cid,
      sid: sid,
      termId: termId,
      thisTab: thisTab,
      text: text,
      rows: thisTab ? rq.rowsFor(student, f) : [],
      tabs: tabs(rq, cid, sid, termId),
      earlierLabel: thisTab ? '' : rq.reportLabel(rq.commentTab()),
      earlierParas: thisTab
        ? []
        : rq
            .plainComment(old)
            .split(/\n\s*\n/)
            .map(function (t) {
              return t.trim();
            }),
      approved:
        thisTab && rating.approvedAt
          ? `<span class="qn-approved-chip" id="tq-approved-chip" title="You approved this comment. Changing it takes the approval off until you approve it again.">Approved ${esc(rq.shortDay(rating.approvedAt))}</span>`
          : '',
      stale: stale ? rq.staleHtml(cid, student, rating, stale) : '',
      pronoun: thisTab ? rq.pronounNoticeHtml(rating, f) : '',
      basis: thisTab ? rq.basisHtml(cid, student, f) : '',
      warn: thisTab ? rq.warnHtml(cid, student, text) : '',
      noDraft: thisTab ? rq.noDraftHtml(student, f) : '',
      empty: thisTab ? rq.emptyHtml(cid, student, text) : '',
      count: thisTab ? rq.countHtml(cid, text) : '',
      copyIcon: rq.copyIcon,
    };
  }

  /* The amber note when a habit sentence says the student hands in work on
     time and the gradebook has work labelled Missing: Rate It a step lower,
     or Keep It. */
  function habitNote(rq, st, rows) {
    var f = rq.facts(st);
    var v = rq.habitsOf(rq.cid(), st, f).completes;
    var nh = f.notHandedIn;
    if (!(v >= 3 && v <= 4) || !nh || !(nh.count > 0) || rq.habitKept(st)) return null;
    var said = rows.find(function (r) {
      return (
        /^(habits|habitsMore|habitsBuild|strongHabits)$/.test(r.step || '') &&
        ((r.prov && r.prov.factKeys) || []).indexOf('habit:completes') >= 0
      );
    });
    if (!said) return null;
    return {
      text: rq.habitNoteText(said.text, ReportBlocks.getPronouns(st), nh),
      buttons: [
        { label: 'Rate It ' + CommentBank.SCALE[v - 2], act: 'habitNoteRate', data: { to: v - 1 } },
        { label: 'Keep It', act: 'habitNoteKeep', data: {} },
      ],
    };
  }

  return {
    header: header,
    slider: slider,
    attendance: attendance,
    observations: observations,
    parts: parts,
    habitNote: habitNote,
  };
})();
