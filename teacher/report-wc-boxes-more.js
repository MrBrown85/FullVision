// @ts-check
/* report-wc-boxes-more.js — Write Comments: what the other boxes hold
   (Attendance, the student's Voice, Observations, Missing Work, Next Step,
   For the Class and Your Sentences). The first boxes, and how a box is
   built, are in report-wc-boxes.js. */
window.ReportWcBoxesMore = (function () {
  'use strict';

  var fact = function (o) {
    return ReportWcBoxes.fact(o);
  };
  var btn = function (a, b, c, d) {
    return ReportWcBoxes.btn(a, b, c, d);
  };
  var takeLines = function (a, b, c, d, e) {
    return ReportWcBoxes.takeLines(a, b, c, d, e);
  };

  function att(env, mine) {
    var f = fact({
      id: 'att',
      name: 'Classes Absent So Far This Year',
      val: env.attCount,
      html: 'att',
      lines: mine.map(env.line),
    });
    if (!mine.length && env.attEntered) f.sayData = { box: 'att', fact: '' };
    return { facts: [f], head: env.attHead, foot: [], top: [] };
  }

  /* Whether the comment quotes this answer, as a sentence from it or typed. */
  function said(env, a, lines) {
    var t = String(a.text || '')
      .replace(/[“”"]/g, '')
      .replace(/[.\s]+$/, '');
    if (!t || a.priv) return false;
    return (
      lines.length > 0 ||
      env.rows.some(function (r) {
        return String(r.text).indexOf(t) >= 0;
      })
    );
  }

  function voice(env, mine) {
    var taken = {};
    var facts = env.voice.map(function (a) {
      var lines = takeLines(env, mine, taken, '', function (r) {
        return r.words === a.key;
      });
      var f = fact({
        id: 'voice:' + a.key,
        name: a.label,
        quote: a.text ? '“' + a.text.replace(/[“”"]/g, '') + '”' : a.empty,
        chip: a.priv ? 'Private' : said(env, a, lines) ? 'In the Comment' : '',
        lines: lines,
      });
      if (a.say && !lines.length) {
        f.sayLabel = 'Quote This';
        f.sayData = { box: 'voice', fact: a.say };
      }
      return f;
    });
    var left = mine.filter(function (x) {
      return !taken[x.ri];
    });
    var link = {
      label: 'Questionnaires ›',
      href: '/dashboard?course=' + env.cid + '&manage=questionnaires',
      title:
        'Opens this class’s Questionnaires in Class Settings, where you choose and send the questions students answer.',
    };
    return { facts: facts, head: env.voiceHead, foot: [link], top: left.map(env.line) };
  }

  function obs(env) {
    var n = env.obsList.length;
    return {
      facts: [fact({ id: 'obs', html: 'obs' })],
      head: n ? n + ' So Far This Year' : 'None Yet',
      only: 'Only You',
      foot: [],
      top: [],
    };
  }

  function missing(env, mine) {
    if (!env.missing.length && !mine.length) return { facts: [], head: 'None Missing', foot: [], top: [] };
    var n = env.missing.filter(function (m) {
      return m.missing;
    }).length;
    var f = fact({
      id: 'missing',
      name: 'Not Handed In',
      chip: n + ' of ' + env.recordTotal,
      bar: env.recordTotal ? n / env.recordTotal : 0,
      lines: mine.map(env.line),
    });
    if (!mine.length && n > 0) f.sayData = { box: 'missing', fact: '' };
    if (env.missing.length)
      f.extra = [btn(env.seeMissing ? 'Hide Them' : 'See the ' + env.missing.length, 'wcSee', {}, env.seeMissing)];
    if (env.seeMissing)
      f.subs = env.missing.map(function (m) {
        return { name: m.title || 'Untitled', chip: m.missing ? '' : 'Late', aid: m.id };
      });
    return { facts: [f], head: n ? n + ' Missing' : 'None Missing', foot: [], top: [] };
  }

  function next(env, mine) {
    var taken = {};
    var facts = [];
    env.habitsLow.forEach(function (h) {
      var lines = takeLines(env, mine, taken, 'habit:' + h.key);
      facts.push(fact({ id: 'nh:' + h.key, name: h.name, chip: 'Work Habit', val: h.word, lines: lines }));
    });
    env.nextComps.forEach(function (c) {
      var lines = takeLines(env, mine, taken, 'comp:' + c.id);
      var f = fact({
        id: 'nc:' + c.id,
        name: c.name,
        chip: env.pieces(c),
        bar: env.barOf(c.level),
        val: formatLevel(env.cid, c.level),
        lines: lines,
      });
      if (!lines.length) f.sayData = { box: 'next', fact: 'comp:' + c.id, comp: c.id };
      facts.push(f);
    });
    var left = mine.filter(function (x) {
      return !taken[x.ri];
    });
    var said = mine.length ? env.nextHead(mine) : env.nextDefault;
    return { facts: facts, head: said, foot: [], top: left.map(env.line) };
  }

  function cls(env, mine) {
    return { facts: env.classFacts(mine), head: '', foot: [], top: [] };
  }
  function yours(env, mine) {
    return { facts: [], head: '', foot: [], top: mine.map(env.line) };
  }

  return { att: att, voice: voice, obs: obs, missing: missing, next: next, cls: cls, yours: yours };
})();
