// @ts-check
/* student-look.js — the Students card and the profile in the phone's new
   look (docs/plans/phone-look-plan.md, L5 and L6).

   With the phoneLook switch off, on() is false and neither screen asks for
   anything here. On, card-widgets.js draws the card from card() and
   student-detail.js draws the profile from profile(), each handing over
   the pieces it already builds (the To Grade box, the work list, the
   competencies, the observations). Every tap is one the app already
   answers: m-all-students, m-obs-quick-menu, m-student-detail,
   m-assess-grade. The More and All rows are <details>, so opening one
   needs no script. Grades are worded only by calc.js (assessmentCellValue,
   studentGradeSummary, levelWord, formatPoints). */
/** @type {any} */ (window).MStudentLook = (function () {
  'use strict';

  /** @type {any} */
  var W = window;
  var WORK_ROWS = 5;

  function on() {
    return !!(W.BuildFlags && W.BuildFlags.on('phoneLook'));
  }
  /** @param {any} s */
  function esc(s) {
    return W.MComponents.esc(s);
  }
  var CHEVRON =
    '<svg class="m-sl-chev" width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5"/></svg>';

  /* ── The Students card (L5) ──────────────────────────────────── */

  // The overall grade as My Learning shows it: the level's word and four
  // bars up to it; a Letter class shows its letter and no bars.
  // html-safe: the word comes from constants.js or calc.js and goes through esc; the rest is fixed markup
  /** @param {string} cid @param {string} sid */
  function _levelHtml(cid, sid) {
    var grade = studentGradeSummary(cid, sid);
    var letter = courseGradeMode(cid) === 'letter';
    var lv = letter ? 0 : roundLevel(getOverallProficiency(cid, sid));
    var word = letter ? grade.text || '' : levelWord(cid, getOverallProficiency(cid, sid));
    if (!word) return '';
    var bars = '';
    if (lv > 0)
      for (var i = 1; i <= 4; i++)
        bars += '<span class="m-sl-bar' + (i <= lv ? ' is-on' : '') + (i === lv ? ' is-now' : '') + '"></span>';
    return (
      '<div class="m-sl-level l' +
      (grade.level || lv) +
      '"><span class="m-sl-word">' +
      esc(word) +
      '</span>' +
      (bars ? '<span class="m-sl-bars" aria-hidden="true">' + bars + '</span>' : '') +
      '</div>'
    );
  }

  /* A piece's result as a short pill: the class's level wording, the score
     out of its points, Complete, Missing or Excused. '' with none. */
  /** @param {string} cid @param {string} sid @param {any} a */
  function _result(cid, sid, a) {
    var cell = assessmentCellValue(cid, sid, a);
    if (cell.status === 'NS') return { text: 'Missing', tone: 'miss' };
    if (cell.status === 'EXC') return { text: 'Excused', tone: 'none' };
    if (cell.kind === 'complete')
      return { text: cell.mark === 'complete' ? 'Complete' : 'Incomplete', tone: cell.mark === 'complete' ? '3' : '1' };
    if (cell.kind === 'points')
      return {
        text: formatPoints(cell.value) + ' / ' + formatPoints(a.maxPoints || 100),
        tone: String(cell.level || 0),
      };
    if (cell.kind === 'level' || (cell.kind === 'dibels' && cell.text !== '—'))
      return { text: cell.text, tone: String(cell.level || 0) };
    return null;
  }

  /* Returned and not opened since: the student page keeps when a student
     last opened a piece (seen_at). Only in a class whose student page is on. */
  /** @param {string} cid @param {string} sid @param {string} aid */
  function _notOpened(cid, sid, aid) {
    var row = typeof getGradeReturn === 'function' ? getGradeReturn(cid, sid, aid) : null;
    if (!row || !row.returned_at) return false;
    var since = Date.parse(row.updated_at || row.returned_at) || 0;
    return !row.seen_at || Date.parse(row.seen_at) < since;
  }

  /* The card: who it is (a tap for every student), the overall grade, Observe
     and Profile, To Grade and To Return as the card draws them, then the
     newest pieces with a result and All N Pieces. */
  // html-safe: names, titles and results go through esc; ids are ours; the boxes are built by grade-photos.js and card-widgets.js
  /** @param {any} st @param {string} cid @param {string} boxes the To Grade and To Return boxes, as card-widgets.js draws them */
  function card(st, cid, boxes) {
    var pieces = getAssignedAssessments(cid)
      .filter(function (/** @type {any} */ a) {
        return typeof assessmentInYearToDate !== 'function' || assessmentInYearToDate(cid, a);
      })
      .slice()
      .sort(function (/** @type {any} */ a, /** @type {any} */ b) {
        return (b.date || '').localeCompare(a.date || '');
      })
      .map(function (/** @type {any} */ a) {
        return { a: a, r: _result(cid, st.id, a) };
      })
      .filter(function (/** @type {any} */ p) {
        return p.r;
      });
    var page = getReturnSettings(cid).student_page;
    var unopened = page
      ? pieces.filter(function (/** @type {any} */ p) {
          return _notOpened(cid, st.id, p.a.id);
        }).length
      : 0;
    var rows = pieces
      .slice(0, WORK_ROWS)
      .map(function (/** @type {any} */ p) {
        var dot = page && _notOpened(cid, st.id, p.a.id);
        return (
          '<button type="button" class="m-sl-row" data-action="m-assess-grade" data-sid="' +
          esc(st.id) +
          '" data-aid="' +
          esc(p.a.id) +
          '">' +
          (dot ? '<span class="m-sl-dot" aria-label="Not opened"></span>' : '') +
          '<span class="m-sl-row-title">' +
          esc(p.a.title) +
          '</span><span class="m-sl-pill t' +
          p.r.tone +
          '">' +
          esc(p.r.text) +
          '</span>' +
          CHEVRON +
          '</button>'
        );
      })
      .join('');
    return (
      '<div class="m-scard m-sl-card">' +
      '<button type="button" class="m-sl-who" data-action="m-all-students"><span class="m-sl-avatar" style="background:' +
      W.MComponents.avatarColor(st.id) +
      '">' +
      esc(W.MComponents.avatarInitials(st)) +
      '</span><span class="m-sl-name">' +
      esc(displayName(st)) +
      '</span><svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg></button>' +
      _levelHtml(cid, st.id) +
      '<div class="m-sl-acts"><button type="button" class="m-sl-observe" data-action="m-obs-quick-menu" data-sid="' +
      esc(st.id) +
      '">+ Observe</button><button type="button" class="m-sl-profile" data-action="m-student-detail" data-sid="' +
      esc(st.id) +
      '">Profile</button></div>' +
      // To Grade, To Return and the work scroll inside the card, as its widgets did.
      '<div class="m-sl-scroll m-scard-widgets"><div class="m-sl-boxes">' +
      boxes +
      '</div>' +
      (rows
        ? '<div class="m-sl-work">' +
          (unopened
            ? '<span class="m-sl-unopened"><span class="m-sl-dot"></span>' + unopened + ' Not Opened</span>'
            : '') +
          rows +
          (pieces.length > WORK_ROWS
            ? '<button type="button" class="m-sl-row m-sl-all" data-action="m-student-detail" data-sid="' +
              esc(st.id) +
              '"><span class="m-sl-row-title">All ' +
              pieces.length +
              ' Pieces</span>' +
              CHEVRON +
              '</button>'
            : '') +
          '</div>'
        : '') +
      '</div></div>'
    );
  }

  /* ── The profile (L6) ────────────────────────────────────────── */

  // "Nov 7" for a date or a time.
  /** @param {string | null | undefined} iso */
  function _day(iso) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : String(iso));
    return isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  // html-safe: the words go through esc
  /** @param {string} text */
  function _bubble(text) {
    return '<div class="m-sl-bubble">' + esc(text) + '</div>';
  }

  // html-safe: the title and the date go through esc; body is markup the caller built
  /** @param {string} title @param {string} when @param {string} body */
  function _block(title, when, body) {
    return (
      '<section class="m-sl-block"><div class="m-sl-block-head"><h2>' +
      esc(title) +
      '</h2>' +
      (when ? '<span class="m-sl-when">' + esc(when) + '</span>' : '') +
      '</div>' +
      body +
      '</section>'
    );
  }

  // A row that opens in place (<details>), its label, an optional tag, then what it holds.
  // html-safe: the label and the tag go through esc; body is markup the caller built
  /** @param {string} label @param {string} tag @param {string} body @param {string} [cls] */
  function _more(label, tag, body, cls) {
    return (
      '<details class="m-sl-more' +
      (cls ? ' ' + cls : '') +
      '"><summary><span class="m-sl-more-label">' +
      esc(label) +
      '</span>' +
      (tag ? '<span class="m-sl-more-tag">' + esc(tag) + '</span>' : '') +
      CHEVRON +
      '</summary><div class="m-sl-more-body">' +
      body +
      '</div></details>'
    );
  }

  /* The profile, the student's own words first: who they are, the private
     note behind a tap, their goal, About Me, what you have noticed, their
     reflections, then All Work and Competencies, each opening in place.
     `p`: { st, cid, badges, voice (StudentVoice.profile, or null while the
     answers load), answerText, obs (the student's observations this term,
     newest first), obsHtml (an observation's card), toGrade (the work
     waiting, as grade-photos.js draws it), assessHtml, compsHtml }. */
  // html-safe: names, answers, titles and dates go through esc; badges, obsHtml, assessHtml and compsHtml are built escaped by student-detail.js and obs-card
  /** @param {any} p */
  function profile(p) {
    var st = p.st;
    var first = displayNameFirst(st) || displayName(st);
    var v = p.voice || { about: null, checkin: null, reflections: [] };
    var a = v.about;
    var c = v.checkin;
    /** @param {any} it */
    var ans = function (it) {
      return it && it.v ? p.answerText(it.q, it.v) : '';
    };

    // Who they are.
    var say = a ? ans(a.say) : '';
    var line = [say, st.pronouns || ''].filter(Boolean).join(' · ');
    var concerns = (p.allObs || []).filter(function (/** @type {any} */ o) {
      return typeof isOpenConcern === 'function' && isOpenConcern(o);
    }).length;
    var alerts =
      p.badges +
      (typeof isStudentFlagged === 'function' && isStudentFlagged(p.cid, st.id)
        ? '<span class="m-sl-chip m-sl-chip-flag">Flagged</span>'
        : '') +
      (concerns
        ? '<span class="m-sl-chip m-sl-chip-concern">' +
          concerns +
          (concerns === 1 ? ' Open Concern' : ' Open Concerns') +
          '</span>'
        : '');
    var langs = a ? ans(a.languages) : '';
    var learns = a ? ans(a.learns) : '';
    var facts =
      (langs
        ? langs
            .split(/,\s*/)
            .filter(Boolean)
            .map(function (/** @type {string} */ l) {
              return '<span class="m-sl-chip">' + esc(l) + '</span>';
            })
            .join('')
        : '') + (learns ? '<span class="m-sl-chip">' + esc('Learns Best: ' + learns) + '</span>' : '');
    var who =
      '<section class="m-sl-block m-sl-id"><div class="m-sl-id-top"><span class="m-sl-avatar m-sl-avatar-big" style="background:' +
      W.MComponents.avatarColor(st.id) +
      '">' +
      esc(W.MComponents.avatarInitials(st)) +
      '</span><div><div class="m-sl-id-name">' +
      esc(displayName(st)) +
      '</div>' +
      (line ? '<div class="m-sl-id-line">' + esc(line) + '</div>' : '') +
      '</div></div>' +
      (alerts ? '<div class="m-sl-chips">' + alerts + '</div>' : '') +
      (facts ? '<div class="m-sl-chips">' + facts + '</div>' : '') +
      '<button type="button" class="m-sl-observe m-sl-observe-wide" data-action="m-obs-quick-menu" data-sid="' +
      esc(st.id) +
      '">+ Observe</button></section>';

    // The private note, behind a tap.
    var note = a ? ans(a.note) : '';
    var noteHtml = note ? _more('A Private Note From ' + first, '', _bubble(note), 'm-sl-block m-sl-note') : '';

    // Their goal: the course goal and its check-in, then a Core Competency goal.
    var goalBody = '';
    var goalText = a ? ans(a.goal) : '';
    if (goalText) goalBody += _bubble(goalText);
    var status = c ? ans(c.status) : '';
    var next = c ? ans(c.next) : '';
    if (status) goalBody += '<span class="m-sl-chip m-sl-chip-status">' + esc(status) + '</span>';
    if (next) goalBody += _bubble(next);
    var core = c ? ans(c.core) : '';
    var coreGoal = c ? ans(c.coreGoal) : '';
    if (core)
      goalBody +=
        '<div class="m-sl-label">' + esc('Core Competency: ' + core) + '</div>' + (coreGoal ? _bubble(coreGoal) : '');
    var goalHtml = goalBody ? _block(first + '’s Goal', _day((c && c.at) || (a && a.at)), goalBody) : '';

    // About Me: what they are good at, what is hard, outside school, then the rest.
    var aboutBody = '';
    if (a) {
      [
        ['Good At', a.goodAt],
        ['Hard Right Now', a.hard],
        ['Outside School', a.outside],
      ]
        .concat(
          (a.rest || []).map(function (/** @type {any} */ it) {
            return [it.q.prompt || '', it];
          }),
        )
        .forEach(function (pair) {
          var t = ans(pair[1]);
          if (t) aboutBody += '<div class="m-sl-label">' + esc(pair[0]) + '</div>' + _bubble(t);
        });
    }
    var aboutHtml = aboutBody ? _block('About Me', _day(a && a.at), aboutBody) : '';

    // What you have noticed: the newest observation, then all of them.
    var obs = p.obs || [];
    var noticed = obs.length
      ? _block(
          'What You’ve Noticed',
          '',
          p.obsHtml(obs[0]) +
            (obs.length > 1
              ? _more('All ' + obs.length + ' Observations', '', obs.slice(1).map(p.obsHtml).join(''), 'm-sl-inline')
              : ''),
        )
      : '';

    // Their reflections, each opening to what they said.
    var refl = (v.reflections || [])
      .map(function (/** @type {any} */ e) {
        var qa = (e.items || [])
          .map(function (/** @type {any} */ it) {
            var t = ans(it);
            return t ? '<div class="m-sl-label">' + esc(it.q.prompt || '') + '</div>' + _bubble(t) : '';
          })
          .join('');
        return qa ? _more(e.title || 'Reflection', _day(e.at), qa, 'm-sl-inline') : '';
      })
      .join('');
    var reflHtml = refl
      ? _block('Reflections', '', refl)
      : '<section class="m-sl-block m-sl-rows">' +
        '<div class="m-sl-static"><span class="m-sl-more-label">Reflections</span><span class="m-sl-more-tag">None Answered</span></div>';

    var rows =
      _more('All Work', '', p.assessHtml, 'm-sl-inline') + _more('Competencies', '', p.compsHtml, 'm-sl-inline');
    // With no reflections the rows share the Reflections card, as on the board.
    var tail = refl ? '<section class="m-sl-block m-sl-rows">' + rows + '</section>' : reflHtml + rows + '</section>';

    var toGrade = p.toGrade ? '<div class="m-sl-tograde">' + p.toGrade + '</div>' : '';
    return who + toGrade + noteHtml + goalHtml + aboutHtml + noticed + (refl ? reflHtml : '') + tail;
  }

  return { on: on, card: card, profile: profile };
})();
