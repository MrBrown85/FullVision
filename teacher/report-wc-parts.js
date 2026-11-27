// @ts-check
/* report-wc-parts.js — Write Comments: the page's parts and the plain
   functions about a comment that need no page (docs/plans/write-comments-plan.md).
   It keeps no state and reads no marks. Which box a sentence belongs to, the
   fact a sentence rests on, how a typed comment reads back, the checks
   under the comment and the reading grade are all here, so each can be
   tested on its own. */
window.ReportWcParts = (function () {
  'use strict';

  /* The boxes, in the order they sit on the page and in the comment. Each:
     its name, tile colour and glyph (a 16 by 16 box, stroke 2, round caps,
     no fill), from the approved artboard. */
  var BOXES = [
    { key: 'grade', label: 'Grade', tint: '#0066cc', icon: 'M3.5 13V9.5M8 13V6M12.5 13V3' },
    {
      key: 'best',
      label: 'Best Piece',
      tint: '#a8690a',
      icon: 'M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z',
    },
    { key: 'strength', label: 'Strength', tint: '#2e7d4f', icon: 'M3 8.5l3.2 3.2L13 4.8' },
    {
      key: 'habits',
      label: 'Work Habits',
      tint: '#6b4fbb',
      icon: 'M8 2.4a5.6 5.6 0 1 0 0 11.2 5.6 5.6 0 1 0 0-11.2M8 4.8V8l2.2 1.6',
    },
    { key: 'att', label: 'Attendance', tint: '#3f6fb5', icon: 'M3 4h10v9H3zM3 7h10M5.5 2.5v3M10.5 2.5v3' },
    { key: 'voice', label: 'Voice', tint: '#b83a72', icon: 'M2.8 3.5h10.4v7H7.4L4.4 13v-2.5H2.8z' },
    {
      key: 'obs',
      label: 'Observations',
      tint: '#44546a',
      icon: 'M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2',
    },
    { key: 'missing', label: 'Missing Work', tint: '#a35f00', icon: 'M4 2.5h5.5l3 3v8H4zM9.5 2.5v3h3' },
    { key: 'next', label: 'Next Step', tint: '#0f7b83', icon: 'M3 8h10M9 4l4 4-4 4' },
    { key: 'cls', label: 'For the Class', tint: '#5b5b60', icon: 'M4 14V2.5M4 3h8l-2 3 2 3H4' },
    { key: 'yours', label: 'Your Sentences', tint: '#44546a', icon: 'M3 13l.6-2.8L10.8 3 13 5.2l-7.2 7.2z' },
  ];
  var ORDER = BOXES.map(function (b) {
    return b.key;
  });
  function box(key) {
    return (
      BOXES.find(function (b) {
        return b.key === key;
      }) || BOXES[BOXES.length - 1]
    );
  }
  function rank(key) {
    var i = ORDER.indexOf(key);
    return i < 0 ? ORDER.length : i;
  }

  /* The draft steps each box holds (CommentBank.DRAFT_STEPS). */
  var STEP_BOX = {
    grade: 'grade',
    ieProblem: 'grade',
    example: 'best',
    spread: 'strength',
    growth: 'strength',
    overall: 'strength',
    opening: 'strength',
    habits: 'habits',
    habitsMore: 'habits',
    habitsBuild: 'habits',
    strongHabits: 'habits',
    attendance: 'att',
    notHandedIn: 'missing',
    nextStep: 'next',
    goWords: 'next',
    home: 'next',
    iePlan: 'next',
    ieDeadline: 'next',
    ieMeeting: 'next',
    support: 'cls',
    closer: 'cls',
    lateWork: 'cls',
    languageGoals: 'cls',
  };
  /* The steps a Say This in a box may write, in the order tried. */
  var BOX_STEPS = {
    grade: ['grade'],
    best: ['example'],
    strength: ['overall', 'growth', 'spread'],
    habits: ['habits', 'habitsMore', 'habitsBuild'],
    att: ['attendance'],
    missing: ['notHandedIn'],
    next: ['nextStep', 'home'],
  };

  /* The box a row of the comment sits in. isBest: whether its sentence is
     the best-piece one; voiceQuote: whether it quotes the student's words
     (the bank's In the Student's Words group, or a row from their answers). */
  function boxOf(row, isBest) {
    if (!row) return 'yours';
    if (row.words) return 'voice';
    if (!row.step) return row.inBox || 'yours';
    if (row.step === 'example') {
      if (isBest) return 'best';
      return row.s && row.s.group === "In the Student's Words" ? 'voice' : 'best';
    }
    return STEP_BOX[row.step] || 'yours';
  }

  /* The facts a row rests on: from the slots the sentence was filled with
     when the record has them (a sentence about a skill the teacher chose),
     else from its provenance. */
  function factKeys(row) {
    var p = row && row.prov;
    if (!p) return [];
    var out = [];
    var add = function (k) {
      if (k && out.indexOf(k) < 0) out.push(k);
    };
    var src = p.sources || {};
    Object.keys(src).forEach(function (slot) {
      (src[slot] || []).forEach(add);
    });
    (p.factKeys || []).forEach(function (k) {
      // The sentence's own record names its skill; today's context does not.
      if (/^comp:/.test(k) && out.some(isComp)) return;
      add(k);
    });
    return out;
  }
  function isComp(k) {
    return /^comp:/.test(k);
  }
  function has(row, key) {
    return factKeys(row).indexOf(key) >= 0;
  }

  /* ── The comment read back from what was typed ─────────────── */

  function words(t) {
    return String(t || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }
  /* The share of words two sentences have in common, 0 to 1. */
  function overlap(a, b) {
    var x = words(a);
    var y = words(b);
    if (!x.length || !y.length) return 0;
    var hit = x.filter(function (w) {
      return y.indexOf(w) >= 0;
    }).length;
    return hit / Math.max(x.length, y.length);
  }
  /* A sentence typed in place of an old one stays that sentence's (marked
     Yours) when half or more of its words are the old one's. */
  function isReword(next, old) {
    return overlap(next, old) >= 0.5;
  }

  /* ── The checks under the comment ──────────────────────────── */

  var NUMBER_WORDS = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  function firstWord(t) {
    var m = /^[“"(]*([A-Za-z’']+)/.exec(String(t || '').trim());
    return m ? m[1].toLowerCase() : '';
  }
  /* The longest run of sentences in a row that start with the same word,
     and where it begins: { word, from, n }, or null under three. The
     student's name starts one only when the sentences start with it. */
  function sameOpening(texts) {
    var best = /** @type {{ word: string, from: number, n: number } | null} */ (null);
    var from = 0;
    for (var i = 1; i <= texts.length; i++) {
      if (i < texts.length && firstWord(texts[i]) && firstWord(texts[i]) === firstWord(texts[from])) continue;
      var n = i - from;
      if (n >= 3 && (!best || n > best.n)) best = { word: firstWord(texts[from]), from: from, n: n };
      from = i;
    }
    return best;
  }
  function openingNote(run) {
    var shown = run.word.charAt(0).toUpperCase() + run.word.slice(1);
    return (NUMBER_WORDS[Math.min(run.n, 10)] || String(run.n)) + ' sentences in a row start with ' + shown + '.';
  }

  /* Flesch-Kincaid grade of a text, rounded and kept between 3 and 12. */
  function syllables(w) {
    var m = String(w || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .match(/[aeiouy]+/g);
    return Math.max(1, m ? m.length : 0);
  }
  function readingGrade(text, sentenceCount) {
    var ws = String(text || '')
      .split(/\s+/)
      .filter(Boolean);
    if (!ws.length) return 0;
    var n = Math.max(1, sentenceCount || 1);
    var syl = ws.reduce(function (t, w) {
      return t + syllables(w);
    }, 0);
    var g = 0.39 * (ws.length / n) + 11.8 * (syl / ws.length) - 15.59;
    return Math.max(3, Math.min(12, Math.round(g)));
  }

  /* ── Where a new sentence goes ─────────────────────────────── */

  /* The place in the comment for a new sentence of a box: after the last
     sentence of its box or an earlier one, so it never takes another's
     place (decision 5). boxes: each row's box key, in order. */
  function insertAt(boxes, key) {
    var at = -1;
    var r = rank(key);
    boxes.forEach(function (b, i) {
      if (rank(b) <= r) at = i;
    });
    return at + 1;
  }

  return {
    BOXES: BOXES,
    ORDER: ORDER,
    BOX_STEPS: BOX_STEPS,
    box: box,
    rank: rank,
    boxOf: boxOf,
    factKeys: factKeys,
    has: has,
    overlap: overlap,
    isReword: isReword,
    firstWord: firstWord,
    sameOpening: sameOpening,
    openingNote: openingNote,
    readingGrade: readingGrade,
    insertAt: insertAt,
  };
})();
