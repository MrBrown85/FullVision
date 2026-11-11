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
        return /^[A-Z]{2,}$/.test(part) ? '<strong>' + esc(part) + '</strong>' : esc(part);
      })
      .join('');
  }

  function bubble(s, lang) {
    return '<blockquote class="qw-b"' + (lang ? ' lang="' + esc(lang) + '"' : '') + '>' + esc(s) + '</blockquote>';
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
      esc(question) +
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
      : '<span class="src src-them">From ' + esc(first) + '</span>';
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

  /* The latest reflection's date: a questionnaire reflection, or a
     competency reflection (+ Reflection) when that is newer. */
  function reflectedAt(o) {
    var refl = o.model.reflections[0];
    var comp = o.compRefl || { count: 0, last: null };
    var reflAt = refl ? refl.at : null;
    if (comp.last && (!reflAt || String(comp.last) > String(reflAt))) reflAt = comp.last;
    return reflAt;
  }

  /* The profile's sections, in page order. Each has the id its <section>
     carries, the jump link's label, and what the link says beside the
     label. A new section (Reflections on Feedback, S10-F4) is one more
     entry here. */
  var SECTIONS = [
    {
      id: 'lp-about',
      label: 'About Me',
      sub: function (o) {
        var a = o.model.about;
        return a ? day(a.at) : 'Not yet';
      },
    },
    {
      id: 'lp-goals',
      label: 'Goals',
      sub: function (o) {
        return o.goalCount + ' set';
      },
    },
    {
      id: 'lp-refl',
      label: 'Reflections',
      sub: function (o) {
        var at = reflectedAt(o);
        return at ? day(at) : 'Not yet';
      },
    },
  ];

  function jumpHtml(o) {
    return (
      '<nav class="id-jump" aria-label="On this page">' +
      SECTIONS.map(function (s) {
        return (
          '<a href="#' +
          esc(s.id) +
          '" data-action="lpJump" data-target="' +
          esc(s.id) +
          '">' +
          esc(s.label) +
          ' <span>' +
          esc(s.sub(o)) +
          '</span></a>'
        );
      }).join('') +
      '</nav>'
    );
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
            return '<span class="stu-chip lp-static">' + esc(l) + '</span>';
          })
          .join('') +
        '</dd></div>';
    }
    if (learns)
      facts += '<div><dt>' + icon('people') + 'Learns best</dt><dd><strong>' + esc(learns) + '</strong></dd></div>';
    var html =
      '<div class="id-card"><div class="id-band"><span>' +
      esc(o.classLabel) +
      '</span>' +
      (o.grade ? '<span>Grade ' + esc(o.grade) + '</span>' : '') +
      '</div><div class="id-top"><div class="id-av" aria-hidden="true">' +
      esc(o.initials) +
      '</div>' +
      (say ? '<div class="id-say"><span>Say it</span> ' + sayHtml(say) + '</div>' : '') +
      (o.pronouns ? '<span class="id-pron">' + esc(o.pronouns) + '</span>' : '') +
      '</div>' +
      (facts ? '<dl class="id-facts">' + facts + '</dl>' : '') +
      jumpHtml(o) +
      '</div>';
    var note = a && text(a.note && a.note.v);
    if (note) {
      html +=
        '<div class="id-private"><div class="id-private-head">' +
        icon('lock') +
        'Private note to you</div><div class="id-private-text">' +
        esc(note) +
        '</div><div class="id-private-foot"><span>Only you see this.</span><span>' +
        esc(day(a.at)) +
        '</span></div></div>';
    }
    return html;
  }

  /* ── About Me ─────────────────────────────────────────────── */

  function aboutHtml(o) {
    var a = o.model.about;
    var head =
      '<div class="qw-head"><h2 id="lp-about-h">About Me</h2>' +
      (a ? '<span>' + esc(day(a.at)) + '</span>' : '') +
      '</div>';
    if (!a) {
      return (
        '<section class="qw-sec" id="lp-about" aria-labelledby="lp-about-h">' +
        head +
        '<div class="lp-none">' +
        (o.aboutOn
          ? esc(o.first) + ' hasn’t answered About Me yet.'
          : 'About Me isn’t turned on for this class. Turn it on in ' +
            (o.cid
              ? '<a class="lp-link" role="link" tabindex="0" data-href="/dashboard?course=' +
                esc(encodeURIComponent(o.cid)) +
                '&amp;manage=questionnaires">Class Settings › Questionnaires</a>'
              : 'Class Settings › Questionnaires') +
            '.') +
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
      html += '<div class="qw-group"><h3>More About ' + esc(o.first) + '</h3>';
      rest.forEach(function (it) {
        html += qa(it.q.prompt, it.v);
      });
      html += '</div>';
    }
    return html + '</section>';
  }

  /* ── The student's own goals ──────────────────────────────── */

  function courseGoalHtml(o) {
    var a = o.model.about;
    var c = o.model.checkin;
    // The goal's next step, from the latest Goal Check-In.
    var next = c && c.next && text(c.next.v);
    if (!(a && a.goal) && !(c && c.status) && !next) return '';
    var status = c && c.status && c.status.v ? text(c.status.v) : '';
    var html =
      '<div class="qw-group"><h3>' +
      esc(o.courseName + ' Goal') +
      '</h3><div class="gl-card"><div class="gl-top"><span class="gl-meta">' +
      src('them', o.first) +
      (a ? ' Set ' + esc(day(a.at)) : '') +
      (a && a.goal ? AGAIN : '') +
      '</span>' +
      (status
        ? '<span class="st"><span class="st-dot" style="background:' +
          (STATUS_COLORS[status] || 'var(--text-3)') +
          '"></span>' +
          esc(status) +
          '</span>'
        : '') +
      '</div>';
    if (a && a.goal) html += qa(a.goal.q.prompt.replace(/\bthis class\b/g, o.courseName), a.goal.v);
    if (next) {
      html +=
        '<figure class="qw gl-check"><figcaption class="qw-q">Next step <span class="gl-meta">' +
        esc('Check-in · ' + day(c.at)) +
        '</span></figcaption>' +
        bubble(next) +
        '</figure>';
    }
    return html + '</div></div>';
  }

  function coreGoalHtml(o) {
    var c = o.model.checkin;
    if (!c || !(c.core || c.coreGoal || c.coreStep)) return '';
    var pick = c.core && c.core.v ? text(c.core.v) : '';
    var html =
      '<div class="qw-group"><h3>Core Competency Goal</h3><div class="gl-card"><div class="gl-top"><div class="gl-title">' +
      esc(pick ? coreName(pick) : 'No competency chosen') +
      '</div><span class="gl-meta">' +
      src('them', o.first) +
      ' ' +
      esc(day(c.at)) +
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
      esc(label) +
      '">' +
      STEPS.map(function (s, i) {
        return '<span class="stu-core-step' + (level === i + 1 ? ' on lv-' + level : '') + '">' + s + '</span>';
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
        html += '<div class="qw-group"><h3>' + esc(/shield/i.test(q.prompt) ? 'Personal Shield' : q.prompt) + '</h3>';
        html += '<div class="sh-grid">';
        (labels.length ? labels : vals).forEach(function (lab, i) {
          var t = String(vals[i] || '').trim();
          html +=
            '<figure class="qw"><figcaption class="qw-q">' +
            esc(labels.length ? lab : 'Answer ' + (i + 1)) +
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
            (k ? '<div class="gl-title">' + esc(coreName(k)) + '</div>' : '') +
            '<div class="qw-q qw-q-flush">' +
            esc(q.prompt) +
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

  function reflectionsHtml(o) {
    var list = o.model.reflections;
    var latest = list[0];
    var html =
      '<section class="qw-sec" id="lp-refl" aria-labelledby="lp-refl-h"><div class="qw-head"><h2 id="lp-refl-h">Reflections</h2>' +
      (list.length > 1
        ? '<span>Newest first</span>'
        : latest
          ? '<span>' + esc(day(latest.at) + (latest.theme ? ' · ' + latest.theme : '')) + '</span>'
          : '') +
      '</div>';
    if (!list.length) {
      var comp = (o.compRefl && o.compRefl.count) || 0;
      return (
        html +
        '<div class="lp-none">' +
        (comp
          ? esc(
              'No questionnaire reflections from ' +
                o.first +
                ' yet. ' +
                (comp === 1
                  ? '1 competency reflection is under Competency Goals.'
                  : comp + ' competency reflections are under Competency Goals.'),
            )
          : 'No reflections from ' + esc(o.first) + ' yet.') +
        '</div></section>'
      );
    }
    list.forEach(function (e) {
      if (list.length > 1) {
        html +=
          '<div class="lp-older"><h3>' +
          esc(e.title) +
          ' <span class="gl-meta">' +
          esc(day(e.at) + (e.theme ? ' · ' + e.theme : '')) +
          '</span></h3></div>';
      }
      html += reflectionHtml(o, e, o.first);
    });
    return html + '</section>';
  }

  return {
    SECTIONS: SECTIONS,
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
