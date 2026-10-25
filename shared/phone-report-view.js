/* A report as a student reads it on their phone (docs/STUDENT-VOICE-PLAN.md,
   PR 9; canvas R2). One renderer for both sides: the student's /s/ page
   draws it from the copy the teacher sent, and Sent to Phones shows the
   teacher the same thing. Pure: the copy in, HTML out (shared/
   phone-report.css styles it).

   The copy is built by teacher/phone-reports.js (snapshot) and kept fixed on
   the server until the teacher updates it:
     { v, name, initials, first, course, report, issued,
       overall {mode, text, level, word},
       skills [{name, line, text, word, level}],
       comment [paragraph], goal {text, status, at} | null,
       self {at, items [{name, step, why}]} | null,
       attendance {absent, late} | null }
   Nothing that shouldn't be on a fridge: no designations, notes,
   observations or private answers. */
var PhoneReportView = (function () {
  'use strict';

  var WORDS = ['', 'Emerging', 'Developing', 'Proficient', 'Extending'];
  var MEANS = [
    '',
    'Emerging means you are starting to show the learning, with support.',
    'Developing means you show some of the learning and are working toward doing it on your own.',
    "Proficient means you understand the learning and can do what's expected on your own.",
    'Extending means you understand the learning deeply and can take it further on your own.',
  ];
  var STEPS = ['Beginning', 'Growing', 'Confident', 'Leading'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function day(iso, withYear) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(t)) return '';
    return t.toLocaleDateString(
      'en-CA',
      withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' },
    );
  }

  function lvl(level) {
    var n = Math.max(0, Math.min(4, Math.round(Number(level) || 0)));
    return n;
  }

  function pill(text, level) {
    return '<span class="pr-lvl pr-lvl-' + lvl(level) + '">' + esc(text) + '</span>';
  }

  function header(d) {
    return (
      '<header class="pr-head"><div class="pr-av" aria-hidden="true">' +
      esc(d.initials || (d.first || '?').charAt(0)) +
      '</div><div class="pr-who"><div class="pr-name">' +
      esc(d.name || d.first || '') +
      '</div><div class="pr-meta">' +
      esc([d.course, d.report, d.issued ? 'Issued ' + day(d.issued, true) : ''].filter(Boolean).join(' · ')) +
      '</div></div></header>'
    );
  }

  function overall(d) {
    var o = d.overall;
    if (!o || !(o.text || o.word)) return '';
    var n = lvl(o.level);
    var html = '<section class="pr-card" aria-labelledby="pr-ov"><h2 id="pr-ov" class="pr-h">Overall</h2>';
    if (o.mode === 'letter' || !o.word) {
      return html + '<div class="pr-big pr-big-' + n + '">' + esc(o.text) + '</div></section>';
    }
    html += '<div class="pr-big pr-big-' + n + '">' + esc(o.word) + '</div>';
    html +=
      '<div class="pr-scale" role="img" aria-label="' +
      esc(o.word + ', the ' + ['', 'first', 'second', 'third', 'fourth'][n] + ' of four levels') +
      '">';
    for (var i = 1; i <= 4; i++) html += '<span' + (i === n ? ' class="on pr-on-' + n + '"' : '') + '></span>';
    html += '</div><div class="pr-scale-words" aria-hidden="true">';
    for (var j = 1; j <= 4; j++) html += '<span' + (j === n ? ' class="on"' : '') + '>' + WORDS[j] + '</span>';
    html += '</div>';
    if (o.mode === 'both' && o.text) html += '<div class="pr-also">' + esc(o.text) + '</div>';
    return html + '<p class="pr-note">' + esc(MEANS[n]) + '</p></section>';
  }

  function skills(d) {
    var list = d.skills || [];
    if (!list.length) return '';
    return (
      '<section class="pr-card pr-rows" aria-labelledby="pr-sk"><h2 id="pr-sk" class="pr-h">' +
      esc('Your Skills in ' + (d.course || 'This Class')) +
      '</h2>' +
      list
        .map(function (s) {
          return (
            '<div class="pr-row"><div><div class="pr-rname">' +
            esc(s.name) +
            '</div>' +
            (s.line ? '<div class="pr-rsub">' + esc(s.line) + '</div>' : '') +
            '</div>' +
            (s.word || s.text ? pill(s.word || s.text, s.level) : '<span class="pr-lvl pr-lvl-0">Not yet</span>') +
            '</div>'
          );
        })
        .join('') +
      '</section>'
    );
  }

  function comment(d) {
    var ps = (d.comment || []).filter(function (p) {
      return String(p || '').trim();
    });
    if (!ps.length) return '';
    return (
      '<section class="pr-card" aria-labelledby="pr-tc"><h2 id="pr-tc" class="pr-h">From Your Teacher</h2>' +
      ps
        .map(function (p) {
          return '<p class="pr-p">' + esc(p) + '</p>';
        })
        .join('') +
      '</section>'
    );
  }

  function goal(d) {
    var g = d.goal;
    if (!g || !g.text) return '';
    return (
      '<section class="pr-card" aria-labelledby="pr-yg"><h2 id="pr-yg" class="pr-h">Your Goal</h2><div class="pr-goal">' +
      esc(g.text) +
      '</div>' +
      (g.status
        ? '<div class="pr-said"><span class="pr-dot" aria-hidden="true"></span>You said: <strong>' +
          esc(g.status) +
          '</strong>' +
          (g.at ? ' · ' + esc(day(g.at)) : '') +
          '</div>'
        : '') +
      '</section>'
    );
  }

  function self(d) {
    var s = d.self;
    if (!s || !(s.items || []).length) return '';
    return (
      '<section class="pr-card pr-rows" aria-labelledby="pr-ys"><h2 id="pr-ys" class="pr-h">' +
      esc('How You Rated Yourself' + (s.at ? ' · ' + day(s.at) : '')) +
      '</h2>' +
      s.items
        .map(function (it) {
          return (
            '<div class="pr-row"><div><div class="pr-rname">' +
            esc(it.name) +
            '</div>' +
            (it.why ? '<div class="pr-rsub">“' + esc(it.why) + '”</div>' : '') +
            '</div>' +
            (it.step ? pill(STEPS[it.step - 1] || '', it.step) : '') +
            '</div>'
          );
        })
        .join('') +
      '</section>'
    );
  }

  function attendance(d) {
    var a = d.attendance;
    if (!a || (a.absent == null && a.late == null)) return '';
    var n = function (v) {
      return v == null ? '—' : String(v);
    };
    return (
      '<section class="pr-card pr-att" aria-labelledby="pr-at"><h2 id="pr-at" class="pr-h">Attendance This Year</h2><div class="pr-att-n"><div><strong>' +
      esc(n(a.absent)) +
      '</strong><span>Absent</span></div><div><strong>' +
      esc(n(a.late)) +
      '</strong><span>Late</span></div></div></section>'
    );
  }

  /* The report's body: the sticky header and every card that has
     something to say. `foot` is HTML the caller adds after the cards (the
     Reply button on the phone). */
  function html(d, foot) {
    d = d || {};
    return (
      header(d) +
      '<main class="pr-main">' +
      overall(d) +
      skills(d) +
      comment(d) +
      goal(d) +
      self(d) +
      attendance(d) +
      (foot || '') +
      '<p class="pr-fine">Show this to your family. Your official report card is in MyEd.</p></main>'
    );
  }

  return { html: html, day: day, WORDS: WORDS, STEPS: STEPS };
})();
if (typeof window !== 'undefined') window.PhoneReportView = PhoneReportView;
