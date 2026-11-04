/* comment-pipeline.js — the Generate pipeline's small pieces of math (Nov 4
   2026; plan ~/reports/generate-ideal-comments-plan-v2.md). A comment bank
   that varies only its wording reads as one skeleton across a class; the
   data-to-text pipeline (Reiter and Dale, 1997) varies what is said, its
   order and how facts join. teacher/comment-bank.js runs the stages; this
   file holds the parts that are plain functions of their inputs:

   - salience(): how worth saying each optional fact is for one student;
   - shapes: which facts lead (grade-led, strength-led, growth-led,
     piece-led; IE has its own), fitted to the student and rotated along the
     roster so neighbours never share one (rosterShapes);
   - joins: when two adjacent sentences about the student may become one,
     and with which connective (joinable, joined);
   - distance: word-level edit distance and shared openings, for the
     diverse selection that keeps the best of a handful of candidates
     (score).

   Everything is deterministic: the same inputs give the same draft. No
   model, no network. */
window.CommentPipeline = (function () {
  'use strict';

  /* ── Shapes ────────────────────────────────────────────────────────── */

  // The order shapes rotate in; IE comments keep their Required parts.
  var SHAPES = ['grade', 'strength', 'piece', 'growth'];
  // The draft step each shape opens on.
  var LEAD = { grade: 'grade', strength: 'overall', growth: 'overall', piece: 'example' };

  /* The shapes a student's facts allow: { grade, strength, growth, piece }
     booleans in, shape ids out (grade-led whenever there is a grade). */
  function shapesFor(p) {
    if (!p) return [];
    if (p.ie) return ['ie'];
    var out = [];
    if (p.grade) out.push('grade');
    if (p.strength) out.push('strength');
    if (p.piece) out.push('piece');
    if (p.growth) out.push('growth');
    return out;
  }
  function rotate(list, k) {
    var n = list.length;
    if (!n) return [];
    var s = ((k % n) + n) % n;
    return list.slice(s).concat(list.slice(0, s));
  }
  /* The shape for each student in roster order at one press: the shapes
     tried in a rotation that moves one place per student and per press, the
     first that fits and differs from the student before. profiles: [{
     grade, strength, growth, piece, ie }] in roster order. */
  function rosterShapes(profiles, press) {
    var out = [];
    (profiles || []).forEach(function (p, i) {
      var fit = shapesFor(p);
      if (!fit.length) return out.push(null);
      if (fit[0] === 'ie') return out.push('ie');
      var order = rotate(SHAPES, i + (press || 0)).filter(function (s) {
        return fit.indexOf(s) >= 0;
      });
      var prev = i > 0 ? out[i - 1] : null;
      var pick =
        order.find(function (s) {
          return s !== prev;
        }) || order[0];
      out.push(pick);
    });
    return out;
  }

  /* ── Salience ──────────────────────────────────────────────────────── */

  /* How worth saying each optional fact is, 0 to 1 (0: not said): growth
     since the last report, or marks that climbed over the term; a strength (past the "strongest" gate scores
     higher than the highest-marked skill); the best piece (a teacher's
     note on it is the teacher's pick; a quiz says less when a strength is
     said); a habit only when notable (the lowest at Sometimes or below, or
     a Consistently habit fewer than half the class shares). A fact the earlier report already said counts less.
     p: { growth, climb, strength, strongest, piece, pieceNote, pieceScored,
     habitInvite, habitNews, said: { step: true } }. Attendance the teacher
     entered is always said, as the missing work is (draft()). */
  function salience(p) {
    var s = {
      overall: p.growth ? 0.9 : p.climb ? 0.85 : p.strength ? (p.strongest ? 0.8 : 0.5) : 0,
      example: p.piece ? (p.pieceNote ? 0.9 : p.pieceScored && p.strength ? 0.3 : 0.6) : 0,
      habits: p.habitInvite ? 0.7 : p.habitNews ? 0.6 : 0,
    };
    Object.keys(s).forEach(function (k) {
      if (s[k] && p.said && p.said[k]) s[k] = Math.max(0.05, s[k] - 0.3);
    });
    return s;
  }
  /* The optional steps to say: the highest-salience ones, up to `room`,
     best first; none at 0. */
  function chosen(sal, room) {
    return Object.keys(sal)
      .filter(function (k) {
        return sal[k] > 0;
      })
      .sort(function (a, b) {
        return sal[b] - sal[a] || a.localeCompare(b);
      })
      .slice(0, room);
  }

  /* ── Joins ─────────────────────────────────────────────────────────── */

  // Pairs of steps whose sentences may join, with the connective by
  // relation: the grade and what shows it, the piece and the skill, the
  // skill and where it goes next.
  var JOINS = {
    'grade>overall': 'and',
    'grade>example': 'and',
    'example>overall': 'and',
    'overall>example': 'and',
    'overall>nextStep': 'and',
    'example>nextStep': 'and',
  };
  /* The connective two adjacent bank frames join with, or '' when they may
     not: one claim each and different ones; the first a plain sentence
     ending in a period (no clause of its own after a colon or semicolon);
     the second about the student from its first word ({He} or {His}). */
  function joinable(a, b) {
    if (!a || !b || a.v !== 2 || b.v !== 2) return '';
    var conn = JOINS[(a.step || '') + '>' + (b.step || '')];
    if (!conn) return '';
    if ((a.claims || []).length !== 1 || (b.claims || []).length !== 1 || a.claims[0] === b.claims[0]) return '';
    var at = String(a.text);
    if (!/[^.]\.$/.test(at) || /[;:]/.test(at) || /, (and|where|which)\b/.test(at)) return '';
    if (!/^\{(He|His)\} /.test(String(b.text)) || /[;:]/.test(String(b.text))) return '';
    return conn;
  }
  /* The id a joined sentence goes by: both frames' ids and the connective. */
  function joinId(a, b, conn) {
    return 'j:' + a.id + '+' + b.id + ':' + conn;
  }
  /* [first id, second id, connective] from a joined id, or null. */
  function parseJoin(id) {
    var m = String(id || '').match(/^j:([^+]+)\+([^:]+):(\w+)$/);
    return m ? [m[1], m[2], m[3]] : null;
  }
  /* Two frames as one: the first without its period, a comma, the
     connective, the second with its first slot in lower case. Its claims,
     needs and slots are both frames'; `join` keeps the two ids, so
     verify() can check it claim by claim. */
  function joined(a, b, conn) {
    var second = String(b.text)
      .replace(/^\{He\}/, '{he}')
      .replace(/^\{His\}/, '{his}');
    var uniq = function (xs) {
      return xs.filter(function (x, i) {
        return xs.indexOf(x) === i;
      });
    };
    return {
      id: joinId(a, b, conn),
      part: a.part,
      group: a.group,
      step: a.step,
      steps: [a.step, b.step],
      text: String(a.text).replace(/\.$/, '') + ', ' + conn + ' ' + second,
      needs: uniq((a.needs || []).concat(b.needs || [])),
      when: Object.assign({}, a.when || {}, b.when || {}),
      claims: uniq((a.claims || []).concat(b.claims || [])),
      join: [a.id, b.id],
      v: 2,
      src: 'join',
    };
  }

  /* ── Distance ──────────────────────────────────────────────────────── */

  var PRONOUN = /^(he|she|they|his|her|their|him|them)$/i;
  /* A text's words, lower case, the name and pronouns as one word each. */
  function words(text, name) {
    return String(text || '')
      .replace(/[“”"]/g, '')
      .split(/\s+/)
      .map(function (w) {
        return w.replace(/^[^A-Za-z0-9’'+-]+|[^A-Za-z0-9’'+-]+$/g, '');
      })
      .filter(Boolean)
      .map(function (w) {
        var bare = w.replace(/[’']s$/, '');
        if (name && bare === name) return 'NAME';
        if (PRONOUN.test(w)) return 'PRON';
        return w.toLowerCase();
      });
  }
  /* Word-level edit distance over the longer text's length (0 the same, 1
     nothing in place). */
  function distance(a, b, name) {
    var x = words(a, name);
    var y = words(b, name);
    var m = x.length;
    var n = y.length;
    if (!m || !n) return m || n ? 1 : 0;
    var prev = [];
    var cur = [];
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n] / Math.max(m, n);
  }
  /* A text's first n words, normalised. */
  function opening(text, name, n) {
    return words(text, name)
      .slice(0, n || 3)
      .join(' ');
  }
  function firstWord(text) {
    var m = String(text || '')
      .replace(/^[“"‘(]+/, '')
      .match(/^[A-Za-z’'-]+/);
    return m ? m[0].toLowerCase() : '';
  }
  function count(text, phrase) {
    var re = new RegExp('\\b' + phrase.replace(/\s+/g, '\\s+') + '\\b', 'gi');
    return (String(text || '').match(re) || []).length;
  }

  /* A candidate draft's score; the highest is kept. c: { sentences: [{
     text }], joins }; o: { name, previous (the text on screen), neighbours
     (the last roster neighbours' drafts as { text, name }, nearest first), wordCap }.
     Ruled out (−100 each): two sentences in a row opening on the same word,
     "so far" twice, the scale named twice, a sentence over the cap. Then:
     5–7 sentences; a mean near 15 words; far from the previous press and
     the neighbours, never opening as they do; one or two joins. */
  function score(c, o) {
    o = o || {};
    var texts = (c.sentences || []).map(function (s) {
      return s.text;
    });
    var all = texts.join(' ');
    var sc = 0;
    for (var i = 1; i < texts.length; i++)
      if (firstWord(texts[i]) && firstWord(texts[i]) === firstWord(texts[i - 1])) sc -= 100;
    if (count(all, 'so far') > 1) sc -= 100;
    if (count(all, 'proficiency scale') > 1) sc -= 100;
    var lens = texts.map(function (t) {
      return words(t).length;
    });
    lens.forEach(function (l) {
      if (l > (o.wordCap || 24)) sc -= 100;
    });
    var n = texts.length;
    if (n < 5) sc -= 3 * (5 - n);
    if (n > 7) sc -= 3 * (n - 7);
    var mean = lens.length
      ? lens.reduce(function (a, b) {
          return a + b;
        }, 0) / lens.length
      : 0;
    sc -= Math.abs(mean - 15) * 0.2;
    var prev = String(o.previous || '').trim();
    if (prev) {
      sc += 4 * distance(prev, all, o.name);
      if (opening(prev, o.name) === opening(all, o.name)) sc -= 3;
      var was = {};
      var R = window.CommentRealiser;
      (R ? R.sentences(prev) : [prev]).forEach(function (t) {
        was[words(t, o.name).join(' ')] = true;
      });
      texts.forEach(function (t) {
        if (was[words(t, o.name).join(' ')]) sc -= 2;
      });
    }
    (o.neighbours || []).slice(0, 3).forEach(function (nb, k) {
      if (!nb || !nb.text) return;
      sc += (2 / (k + 1)) * distance(nb.text, all);
      if (k === 0 && opening(nb.text, nb.name, 3) === opening(all, o.name, 3)) sc -= 3;
    });
    if (c.joins === 1) sc += 1;
    else if (c.joins === 2) sc += 0.5;
    return sc;
  }

  /* A small string hash, for offsets that are repeatable per student. */
  function hash(text) {
    var h = 2166136261;
    var t = String(text || '');
    for (var i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
    return h;
  }

  return {
    SHAPES: SHAPES,
    LEAD: LEAD,
    shapesFor: shapesFor,
    rosterShapes: rosterShapes,
    rotate: rotate,
    salience: salience,
    chosen: chosen,
    JOINS: JOINS,
    joinable: joinable,
    joinId: joinId,
    parseJoin: parseJoin,
    joined: joined,
    words: words,
    distance: distance,
    opening: opening,
    firstWord: firstWord,
    count: count,
    score: score,
    hash: hash,
  };
})();
