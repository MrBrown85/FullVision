/* The student-voice parts of the Learner Profile (docs/STUDENT-VOICE-PLAN.md,
   PR 8; canvas screen 9d): the ID card and private note, About Me, the
   student's own goals, and Reflections. Pure: a StudentVoice.profile()
   model in, HTML out. teacher/page-student.js places them and adds the
   competency goals, the disposition timelines and the Core Competency
   table it already had.

   Rules from the hierarchy audit: section heading, then group heading,
   then the question in grey, then the answer at one size for every answer;
   speech bubbles only for the student's words; "From <name>" or "Set by
   you" wherever student and teacher entries sit together; answers keep
   their line breaks and wrap near 68 characters; nothing shown that says
   nothing. */
var LearnerProfile = (function () {
  'use strict';

  var STEPS = ['Beginning', 'Growing', 'Confident', 'Leading'];
  var CORE_NAMES = {
    COM: 'Communicating',
    COL: 'Collaborating',
    CT: 'Creative Thinking',
    CRT: 'Critical & Reflective Thinking',
    PPI: 'Personal & Cultural Identity',
    PAR: 'Personal Awareness & Responsibility',
    SAR: 'Social Awareness & Responsibility',
  };
  var STATUS_COLORS = {
    'Not Started': 'var(--text-3)',
    'Working On It': 'var(--score-2)',
    'Mostly There': 'var(--score-3)',
    Done: 'var(--score-4)',
  };

  function _esc(s) {
    return typeof esc === 'function'
      ? esc(s)
      : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
  }

  function day(iso) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function text(v) {
    if (!v) return '';
    if (v.text != null && String(v.text).trim()) return String(v.text);
    if (Array.isArray(v.json)) return v.json.join(', ');
    return '';
  }

  function coreName(id) {
    return CORE_NAMES[id] || id;
  }

  /* "HAR-jote": a part written in capitals is the stressed one, in bold. */
  function sayHtml(s) {
    return String(s || '')
      .split(/(\s+|-)/)
      .map(function (part) {
        return /^[A-Z]{2,}$/.test(part) ? '<strong>' + _esc(part) + '</strong>' : _esc(part);
      })
      .join('');
  }

  function bubble(s, lang) {
    return '<blockquote class="qw-b"' + (lang ? ' lang="' + _esc(lang) + '"' : '') + '>' + _esc(s) + '</blockquote>';
  }

  function noAnswer() {
    return '<div class="gl-none">No answer</div>';
  }

  /* A question and the student's answer in a bubble. */
  function qa(question, v, extraHtml, opts) {
    var t = text(v);
    return (
      '<figure class="qw' +
      (opts && opts.cls ? ' ' + opts.cls : '') +
      '"><figcaption class="qw-q">' +
      _esc(question) +
      (extraHtml || '') +
      '</figcaption>' +
      (t ? bubble(t) : noAnswer()) +
      '</figure>'
    );
  }

  var AGAIN = ' <span class="qw-again">↻ Jan · Jun</span>';

  function src(who, first) {
    return who === 'you'
      ? '<span class="src src-you">Set by you</span>'
      : '<span class="src src-them">From ' + _esc(first) + '</span>';
  }

  /* ── ID card and private note ─────────────────────────────── */

  function icon(kind) {
    var paths = {
      globe:
        '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path>',
      people:
        '<circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="9" r="2.5"></circle><path d="M3 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 7 0"></path>',
      lock: '<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
    };
    return '<svg class="lp-ic" viewBox="0 0 24 24" aria-hidden="true">' + paths[kind] + '</svg>';
  }

  function idCardHtml(o) {
    var a = o.model.about;
    var say = a && text(a.say && a.say.v);
    var langs = a && a.languages && a.languages.v && Array.isArray(a.languages.v.json) ? a.languages.v.json : [];
    var learns = a && text(a.learns && a.learns.v);
    var facts = '';
    if (langs.length) {
      facts +=
        '<div><dt>' +
        icon('globe') +
        'Speaks at home</dt><dd>' +
        langs
          .map(function (l) {
            return '<span class="stu-chip lp-static">' + _esc(l) + '</span>';
          })
          .join('') +
        '</dd></div>';
    }
    if (learns)
      facts += '<div><dt>' + icon('people') + 'Learns best</dt><dd><strong>' + _esc(learns) + '</strong></dd></div>';
    var refl = o.model.reflections[0];
    var html =
      '<div class="id-card"><div class="id-band"><span>' +
      _esc(o.classLabel) +
      '</span>' +
      (o.grade ? '<span>Grade ' + _esc(o.grade) + '</span>' : '') +
      '</div><div class="id-top"><div class="id-av" aria-hidden="true">' +
      _esc(o.initials) +
      '</div>' +
      (say ? '<div class="id-say"><span>Say it</span> ' + sayHtml(say) + '</div>' : '') +
      (o.pronouns ? '<span class="id-pron">' + _esc(o.pronouns) + '</span>' : '') +
      '</div>' +
      (facts ? '<dl class="id-facts">' + facts + '</dl>' : '') +
      '<nav class="id-jump" aria-label="On this page">' +
      '<a href="#lp-about" data-action="lpJump" data-target="lp-about">About Me <span>' +
      _esc(a ? day(a.at) : 'Not yet') +
      '</span></a>' +
      '<a href="#lp-goals" data-action="lpJump" data-target="lp-goals">Goals <span>' +
      _esc(o.goalCount + ' set') +
      '</span></a>' +
      '<a href="#lp-refl" data-action="lpJump" data-target="lp-refl">Reflections <span' +
      (o.newReply ? ' class="lp-new-text"' : '') +
      '>' +
      _esc(refl ? (o.newReply ? 'New · ' : '') + day(refl.at) : 'Not yet') +
      '</span></a></nav></div>';
    var note = a && text(a.note && a.note.v);
    if (note) {
      html +=
        '<div class="id-private"><div class="id-private-head">' +
        icon('lock') +
        'Private note to you</div><div class="id-private-text">' +
        _esc(note) +
        '</div><div class="id-private-foot"><span>Only you see this.</span><span>' +
        _esc(day(a.at)) +
        '</span></div></div>';
    }
    return html;
  }

  /* ── About Me ─────────────────────────────────────────────── */

  function aboutHtml(o) {
    var a = o.model.about;
    var head =
      '<div class="qw-head"><h2 id="lp-about-h">About Me</h2>' +
      (a ? '<span>' + _esc(day(a.at)) + '</span>' : '') +
      '</div>';
    if (!a) {
      return (
        '<section class="qw-sec" id="lp-about" aria-labelledby="lp-about-h">' +
        head +
        '<div class="lp-none">' +
        (o.aboutOn
          ? _esc(o.first) + ' hasn’t answered About Me yet.'
          : 'About Me isn’t turned on for this class. Turn it on in Class Management › Questionnaires.') +
        '</div></section>'
      );
    }
    var html = '<section class="qw-sec" id="lp-about" aria-labelledby="lp-about-h">' + head;
    if (a.goodAt || a.hard) {
      html += '<div class="qw-group"><h3>As a Learner</h3><div class="qw-pair">';
      if (a.goodAt) html += qa(a.goodAt.q.prompt, a.goodAt.v, AGAIN);
      if (a.hard) html += qa(a.hard.q.prompt, a.hard.v, AGAIN);
      html += '</div></div>';
    }
    if (a.outside)
      html += '<div class="qw-group"><h3>Outside School</h3>' + qa(a.outside.q.prompt, a.outside.v) + '</div>';
    // Anything else they were asked, in order, so no answer goes unshown.
    var rest = (a.rest || []).filter(function (it) {
      return !it.q.teacher_only;
    });
    if (rest.length) {
      html += '<div class="qw-group"><h3>More About ' + _esc(o.first) + '</h3>';
      rest.forEach(function (it) {
        html += qa(it.q.prompt, it.v);
      });
      html += '</div>';
    }
    return html + '</section>';
  }

  /* ── The student's own goals ──────────────────────────────── */

  /* The goal's next steps, newest first: from a Goal Check-In or from a
     reply to a report. */
  function nextSteps(o) {
    var out = [];
    var c = o.model.checkin;
    var r = o.model.reply;
    if (c && c.next && text(c.next.v)) out.push({ text: text(c.next.v), at: c.at, from: 'Check-in' });
    if (r && r.next && text(r.next.v)) {
      out.push({ text: text(r.next.v), at: r.at, from: 'From the ' + r.title.replace(/^Reply to /, '') + ' reply' });
    }
    return out.sort(function (x, y) {
      return String(y.at || '').localeCompare(String(x.at || ''));
    });
  }

  function courseGoalHtml(o) {
    var a = o.model.about;
    var c = o.model.checkin;
    var r = o.model.reply;
    var steps = nextSteps(o);
    if (!(a && a.goal) && !(c && c.status) && !steps.length) return '';
    var status = c && c.status && c.status.v ? text(c.status.v) : '';
    var choice = r && r.choice && r.choice.v ? text(r.choice.v) : '';
    var kept = choice ? (/change/i.test(choice) ? ' · changed ' : ' · kept ') + day(r.at) : '';
    var html =
      '<div class="qw-group"><h3>' +
      _esc(o.courseName + ' Goal') +
      '</h3><div class="gl-card"><div class="gl-top"><span class="gl-meta">' +
      src('them', o.first) +
      (a ? ' Set ' + _esc(day(a.at)) : '') +
      _esc(kept) +
      (a && a.goal ? AGAIN : '') +
      '</span>' +
      (status
        ? '<span class="st"><span class="st-dot" style="background:' +
          (STATUS_COLORS[status] || 'var(--text-3)') +
          '"></span>' +
          _esc(status) +
          '</span>'
        : '') +
      '</div>';
    if (a && a.goal) html += qa(a.goal.q.prompt.replace(/\bthis class\b/g, o.courseName), a.goal.v);
    if (steps.length) {
      html +=
        '<figure class="qw gl-check"><figcaption class="qw-q">Next step <span class="gl-meta">' +
        _esc(steps[0].from + ' · ' + day(steps[0].at)) +
        '</span></figcaption>' +
        bubble(steps[0].text) +
        '</figure>';
      if (steps[1]) {
        html +=
          '<div class="lp-hist">' +
          _esc('Earlier next step · ' + day(steps[1].at) + ': “' + steps[1].text + '”') +
          '</div>';
      }
    }
    return html + '</div></div>';
  }

  function coreGoalHtml(o) {
    var c = o.model.checkin;
    if (!c || !(c.core || c.coreGoal || c.coreStep)) return '';
    var pick = c.core && c.core.v ? text(c.core.v) : '';
    var html =
      '<div class="qw-group"><h3>Core Competency Goal</h3><div class="gl-card"><div class="gl-top"><div class="gl-title">' +
      _esc(pick ? coreName(pick) : 'No competency chosen') +
      '</div><span class="gl-meta">' +
      src('them', o.first) +
      ' ' +
      _esc(day(c.at)) +
      '</span></div>';
    if (c.coreGoal) html += qa(c.coreGoal.q.prompt, c.coreGoal.v);
    if (c.coreStep) html += qa(c.coreStep.q.prompt, c.coreStep.v, '', { cls: 'gl-check' });
    return html + '</div></div>';
  }

  function goalCount(model) {
    var n = 0;
    if (model.about && model.about.goal && model.about.goal.v) n++;
    if (model.checkin && model.checkin.coreGoal && model.checkin.coreGoal.v) n++;
    return n;
  }

  /* ── Reflections ──────────────────────────────────────────── */

  function steps(level, label) {
    return (
      '<div class="stu-core-steps" role="img" aria-label="' +
      _esc(label) +
      '">' +
      STEPS.map(function (s, i) {
        return '<span class="stu-core-step' + (level === i + 1 ? ' on' : '') + '">' + s + '</span>';
      }).join('') +
      '</div>'
    );
  }

  function reflectionHtml(o, e, first) {
    var html = '';
    var plain = [];
    e.items.forEach(function (it) {
      var q = it.q;
      var v = it.v;
      if (q.kind === 'short_set') {
        var labels = (q.options && q.options.labels) || [];
        var vals = v && Array.isArray(v.json) ? v.json : [];
        html += '<div class="qw-group"><h3>' + _esc(/shield/i.test(q.prompt) ? 'Personal Shield' : q.prompt) + '</h3>';
        html += '<div class="sh-grid">';
        (labels.length ? labels : vals).forEach(function (lab, i) {
          var t = String(vals[i] || '').trim();
          html +=
            '<figure class="qw"><figcaption class="qw-q">' +
            _esc(labels.length ? lab : 'Answer ' + (i + 1)) +
            '</figcaption>' +
            (t ? bubble(t) : noAnswer()) +
            '</figure>';
        });
        html += '</div></div>';
      } else if (q.kind === 'scale4') {
        var j = (v && v.json) || {};
        var levels = j.levels || {};
        var why = j.why;
        var cores = (q.core_ids || []).length ? q.core_ids : [null];
        html += '<div class="qw-group"><h3>Self-Assessment</h3><div class="qw-pair">';
        cores.forEach(function (k) {
          var lv = k ? levels[k] : v && v.num;
          var w = k && why && typeof why === 'object' ? why[k] : typeof why === 'string' ? why : k ? '' : text(v);
          html +=
            '<div class="gl-card">' +
            (k ? '<div class="gl-title">' + _esc(coreName(k)) + '</div>' : '') +
            '<div class="qw-q qw-q-flush">' +
            _esc(q.prompt) +
            '</div>' +
            (lv
              ? steps(lv, first + ' chose ' + STEPS[lv - 1])
              : '<div class="gl-none gl-none-flush">No step chosen</div>') +
            '<figure class="qw"><figcaption class="qw-q">Why?</figcaption>' +
            (w ? bubble(w) : noAnswer()) +
            '</figure></div>';
        });
        html += '</div></div>';
      } else {
        plain.push(it);
      }
    });
    if (plain.length) {
      var pl = '';
      plain.forEach(function (it) {
        pl += qa(it.q.prompt, it.v);
      });
      // Written answers sit with the shield they follow, before the self-assessment.
      var at = html.indexOf('<div class="qw-group"><h3>Self-Assessment');
      var block = '<div class="qw-group">' + pl + '</div>';
      html = at >= 0 ? html.slice(0, at) + block + html.slice(at) : html + block;
    }
    return html;
  }

  /* A reply to a report, as the student wrote it; marked while it's new to you. */
  function replyHtml(o, e) {
    var isNew = o.newReply && o.newReply === e.rid;
    var html =
      '<div class="qw-group lp-reply' +
      (isNew ? ' lp-new' : '') +
      '"><h3>' +
      _esc(e.title) +
      ' <span class="gl-meta">' +
      _esc(day(e.at) + ' · after reading the report on their phone') +
      '</span>' +
      (isNew ? ' <span class="lp-new-tag">New</span>' : '') +
      '</h3><div class="qw-pair">';
    e.items.forEach(function (it) {
      html += qa(it.q.prompt, it.v);
    });
    return html + '</div></div>';
  }

  function reflectionsHtml(o) {
    var list = o.model.reflections;
    var latest = list[0];
    var html =
      '<section class="qw-sec" id="lp-refl" aria-labelledby="lp-refl-h"><div class="qw-head"><h2 id="lp-refl-h">Reflections</h2>' +
      (list.length > 1
        ? '<span>Newest first</span>'
        : latest
          ? '<span>' + _esc(day(latest.at) + (latest.theme ? ' · ' + latest.theme : '')) + '</span>'
          : '') +
      '</div>';
    if (!list.length) {
      return html + '<div class="lp-none">No reflections from ' + _esc(o.first) + ' yet.</div></section>';
    }
    list.forEach(function (e) {
      if (e.kind === 'report_reply') {
        html += replyHtml(o, e);
        return;
      }
      if (list.length > 1) {
        html +=
          '<div class="lp-older"><h3>' +
          _esc(e.title) +
          ' <span class="gl-meta">' +
          _esc(day(e.at) + (e.theme ? ' · ' + e.theme : '')) +
          '</span></h3></div>';
      }
      html += reflectionHtml(o, e, o.first);
    });
    return html + '</section>';
  }

  return {
    idCardHtml: idCardHtml,
    aboutHtml: aboutHtml,
    courseGoalHtml: courseGoalHtml,
    coreGoalHtml: coreGoalHtml,
    reflectionsHtml: reflectionsHtml,
    goalCount: goalCount,
    sayHtml: sayHtml,
    day: day,
    src: src,
    bubble: bubble,
  };
})();
if (typeof window !== 'undefined') window.LearnerProfile = LearnerProfile;
