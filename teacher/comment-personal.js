/* comment-personal.js — the teacher's own comment sentences (plan PR 10,
   "The personal bank"; migrations/20261031_comment_template.sql).

   After a comment is approved on the Term Questionnaire, each sentence the
   teacher wrote or changed is split out, the student's details are swapped
   for the bank's slots (the name and pronouns, an assignment title, a
   competency, the proficiency word, a count), and the template is bound to
   the condition that was true for that student: the part of the comment it
   sat in, the bank sentence it replaced (its `when`, `needs` and claims),
   the competencies that sentence was about, and the kind of class.

   A sentence is left out when it names another student, has a word on the
   health and designation list, a date, a quotation, a one-time marker
   ("on Tuesday"), or a capitalised word FullVision does not know; when it
   is under six or over 20 words; when the vocabulary lint
   (teacher/comment-lint.js) flags it; or when it is nearly a sentence the
   shared bank, the teacher's bank or another suggestion already has.

   Nothing enters the bank until the teacher keeps it in "Suggested for Your
   Bank", shown once after a class's last comment is approved. The bank
   fills only from comments approved in FullVision; there is no import of
   past comments. Kept sentences are installed into COMMENT_BANK marked
   `mine`, so Generate ranks them above the shared bank when their condition
   holds (CommentBank.draft), verify() checks them like any bank sentence,
   and Browse Sentences marks them "Yours".

   Storage: the device copy (gb-comment-templates) and the server table
   through window.v2 (save and delete go through the outbox with an
   idempotency key). In Demo Mode everything stays on this computer. A
   failed list (no table yet, offline, signed out) leaves the device copy,
   which is empty until something is kept. */
window.PersonalBank = (function () {
  'use strict';

  var MIN_WORDS = 6;
  var MAX_WORDS = 20;
  var SHOWN = 3;
  var NEAR = 0.8;

  function _R() {
    return window.CommentRealiser;
  }
  function _demo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }
  function _storeKey() {
    return 'gb-comment-templates' + (_demo() ? '-demo' : '');
  }
  /* Texts removed before their save reached the server (no server id yet):
     the row is deleted once the server has it. */
  function _removedKey() {
    return 'gb-comment-templates-removed' + (_demo() ? '-demo' : '');
  }
  function _suggestKey(cid, termId) {
    return 'gb-bank-suggest' + (_demo() ? '-demo' : '') + ':' + cid + ':' + termId;
  }
  function _read(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function _write(key, v) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch (e) {
      /* the device copy is a convenience; the server row is the record */
    }
  }
  function _isUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
  }
  function _v2(name) {
    return window.v2 && typeof window.v2[name] === 'function' ? window.v2[name] : null;
  }
  function _reEsc(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ── What is left out ──────────────────────────────────────────────── */

  // Health, designation and support-service words: private to the student,
  // never in a sentence offered for others. With the BC designations' names
  // (shared/constants.js) added below.
  var PRIVATE = [
    'counsellor',
    'counselor',
    'counselling',
    'counseling',
    'IEP',
    'designation',
    'designated',
    'diagnosis',
    'diagnosed',
    'ADHD',
    'autism',
    'autistic',
    'ASD',
    'anxiety',
    'anxious',
    'depression',
    'depressed',
    'mental health',
    'mental illness',
    'medication',
    'medicine',
    'medical',
    'doctor',
    'nurse',
    'hospital',
    'illness',
    'sick',
    'surgery',
    'injury',
    'injured',
    'concussion',
    'therapy',
    'therapist',
    'psychologist',
    'psychiatrist',
    'psycho-educational',
    'psychoeducational',
    'learning disability',
    'dyslexia',
    'dyslexic',
    'dysgraphia',
    'dyscalculia',
    'special education',
    'special needs',
    'ELL',
    'ESL',
    'EAL',
    'English language learner',
    'gifted',
    'disorder',
    'disability',
    'disabled',
    'deaf',
    'hard of hearing',
    'blind',
    'visual impairment',
    'wheelchair',
    'seizure',
    'epilepsy',
    'diabetes',
    'asthma',
    'allergy',
    'allergies',
    'pregnant',
    'pregnancy',
    'behaviour plan',
    'behavior plan',
    'education assistant',
    'learning support',
    'resource room',
    'social worker',
  ];
  function _privateWords() {
    var out = PRIVATE.slice();
    if (typeof BC_DESIGNATIONS !== 'undefined') {
      Object.keys(BC_DESIGNATIONS).forEach(function (k) {
        String(BC_DESIGNATIONS[k].name || '')
          .split(/\s*[/–-]\s*/)
          .forEach(function (n) {
            n = n.trim();
            if (n && out.indexOf(n) < 0) out.push(n);
          });
      });
    }
    return out;
  }
  // Codes and short forms match as written (ADHD, ELL); words in any case.
  function _privateHit(text) {
    var words = _privateWords();
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var flags = /^[A-Z]{2,5}$/.test(w) ? '' : 'i';
      var m = String(text).match(new RegExp('(^|[^A-Za-zÀ-ɏ])(' + _reEsc(w) + ')(?![A-Za-zÀ-ɏ])', flags));
      if (m) return m[2];
    }
    return '';
  }

  var MONTHS = 'January|February|March|April|June|July|August|September|October|November|December';
  var MONTHS_SHORT = 'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec';
  var WEEKDAYS = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
  // One day or one week, not the term: "on Tuesday", "yesterday", "the
  // field trip", "on October 21".
  var ONE_TIME = [
    new RegExp('\\b(?:' + WEEKDAYS + ')s?\\b'),
    new RegExp('\\bon (?:the )?(?:' + MONTHS + '|May|' + MONTHS_SHORT + ')\\b'),
    /\b(?:yesterday|today|tomorrow|tonight)\b/i,
    /\b(?:this|last|next|that) (?:morning|afternoon|evening|week|weekend|month)\b/i,
    /\b(?:the other day|that day|field trip)\b/i,
  ];
  var DATES = [
    new RegExp('\\b(?:' + MONTHS + ')\\b'),
    /\bMay\.? \d/,
    new RegExp('\\b(?:' + MONTHS_SHORT + ')\\.? \\d{1,2}\\b'),
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
    /\b\d{4}-\d{1,2}-\d{1,2}\b/,
    /\b(?:19|20)\d{2}\b/,
  ];
  function _oneTime(text) {
    return ONE_TIME.some(function (re) {
      return re.test(text);
    });
  }
  function _date(text) {
    return DATES.some(function (re) {
      return re.test(text);
    });
  }

  /* The first of a set of names the text holds as a whole word, as written
     (with its capital). One-letter entries are left to _initialIn: from a
     flat list there is no telling a first name "J" from a last initial. */
  function _nameIn(text, names) {
    for (var i = 0; i < names.length; i++) {
      var n = String(names[i] || '').trim();
      if (n.length < 2) continue;
      var re = new RegExp('(^|[^A-Za-zÀ-ɏ])' + _reEsc(n) + '(?![A-Za-zÀ-ɏ])');
      if (re.test(text)) return n;
    }
    return '';
  }

  /* A classmate with a one-letter name, from the class roster (the class's
     real names, never the flat list): a one-letter first or preferred name
     as a capital standing alone ("J", "J’s"; not "O’Brien"), or a one-letter
     last name written as an initial with a period after their first name
     ("Sam B."). A last initial alone never counts, so "Part B", "an A" and a
     sentence that starts with "A" are not blocked. own: the student's own
     names. */
  function _initialIn(text, classmates, own) {
    var letter = function (n) {
      return n.length === 1 && /^[A-ZÀ-Þ]$/.test(n) && own.indexOf(n) < 0;
    };
    var alone = "(?![A-Za-zÀ-ɏ])(?![-'’](?!s(?![A-Za-zÀ-ɏ]))[A-Za-zÀ-ɏ])";
    for (var i = 0; i < classmates.length; i++) {
      var s = classmates[i] || {};
      var firsts = [s.preferred, s.preferredName, s.firstName]
        .map(function (n) {
          return String(n || '').trim();
        })
        .filter(Boolean);
      var last = String(s.lastName || '').trim();
      for (var k = 0; k < firsts.length; k++) {
        var n = firsts[k];
        if (letter(n) && new RegExp("(^|[^A-Za-zÀ-ɏ'’-])" + _reEsc(n) + alone).test(text)) return n;
        if (n.length > 1 && letter(last)) {
          var re = new RegExp('(^|[^A-Za-zÀ-ɏ])' + _reEsc(n) + '\\s+' + _reEsc(last) + '\\.');
          if (re.test(text)) return n + ' ' + last + '.';
        }
      }
    }
    return '';
  }

  /* The student's classmates on the roster: opts.classmates, else the
     class's students other than this one. */
  function _classmates(f, student, opts) {
    if (Array.isArray(opts.classmates)) return opts.classmates;
    var cid = f && f.cid;
    if (!cid || typeof getStudents !== 'function') return [];
    var sid = student && student.id;
    return (getStudents(cid) || []).filter(function (s) {
      return s && s.id !== sid;
    });
  }

  /* The classmate a sentence names, or ''. */
  function _classmateIn(text, own, f, student, opts) {
    var others = (opts.others || []).filter(function (n) {
      return own.indexOf(n) < 0;
    });
    return _nameIn(text, others) || _initialIn(text, _classmates(f, student, opts), own);
  }

  /* ── The student's details as slots ────────────────────────────────── */

  // What each slot becomes for another student, on the chips.
  var SLOT_LABEL = {
    assignment: 'best piece',
    assignment2: 'lower-marked piece',
    seeWork: 'piece to show',
    aboutWork: 'piece to ask about',
    strengths: 'strongest competency',
    growthAreas: 'competency to grow',
    rise: 'competency that improved',
    fall: 'competency that slipped',
    focus: 'Focus Area',
    focusLow: 'Focus Area',
    nextSkill: 'next step',
    course: 'class name',
    standingWord: 'overall proficiency',
    missingCount: 'how many',
    absentCount: 'how many',
  };
  var ROLE_LABEL = {
    subj: 'he, she or they',
    obj: 'him, her or them',
    poss: 'his, her or their',
    refl: 'himself, herself or themselves',
  };
  var ROLE_SLOT = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
  // What each slot claims, for verify() (shared/comment-bank.js `claims`).
  var SLOT_CLAIMS = {
    assignment: 'bestPiece',
    assignment2: 'weakPiece',
    seeWork: 'focusWork',
    aboutWork: 'focusWork',
    strengths: 'strength',
    growthAreas: 'growthArea',
    focusLow: 'growthArea',
    rise: 'improved',
    fall: 'slipped',
    focus: 'nextStep',
    nextStep: 'nextStep',
    nextSkill: 'nextStep',
    standingWord: 'grade',
    missingCount: 'notHandedIn',
    absentCount: 'attendance',
  };
  var TITLE_SLOTS = ['assignment', 'assignment2', 'seeWork', 'aboutWork'];
  var COMP_SLOTS = ['strengths', 'growthAreas', 'focusLow', 'rise', 'fall', 'focus', 'nextSkill'];
  var PROFICIENCY = [1, 2, 3, 4].map(function (l) {
    return PROF_LABELS[l];
  });
  var NUMBER_WORDS = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
  ];
  var COUNT_NOUNS = {
    missingCount: 'assignments?|pieces? of work|pieces?|tasks?|projects?',
    absentCount: 'class(?:es)?|days?',
  };

  // Words before the name that make it the subject ("and Gabriel explains").
  var SUBJ_BEFORE = [
    'and',
    'but',
    'so',
    'when',
    'because',
    'while',
    'that',
    'if',
    'as',
    'since',
    'where',
    'how',
    'why',
    'what',
    'until',
    'before',
    'after',
    'then',
    'although',
    'though',
    'once',
    'whether',
  ];
  // Words after "her" that make it him, not his ("ask her what", "her to").
  var OBJ_NEXT = [
    'what',
    'how',
    'why',
    'when',
    'where',
    'if',
    'that',
    'to',
    'and',
    'or',
    'but',
    'a',
    'an',
    'the',
    'about',
    'with',
    'for',
    'in',
    'on',
    'at',
    'by',
    'from',
    'this',
    'these',
    'those',
    'some',
    'more',
    'time',
    'which',
    'who',
    'whether',
    'again',
    'too',
    'also',
    'so',
    'as',
    'each',
    'every',
  ];
  // Verbs before "her" that take a person and a verb ("help her improve"),
  // and the verbs that follow there ("help her brother" stays his).
  var OBJ_BEFORE = [
    'help',
    'helps',
    'let',
    'lets',
    'make',
    'makes',
    'watch',
    'watches',
    'see',
    'sees',
    'hear',
    'hears',
  ];
  var BASE_VERBS = [
    'improve',
    'learn',
    'grow',
    'understand',
    'practise',
    'practice',
    'read',
    'write',
    'plan',
    'prepare',
    'choose',
    'finish',
    'start',
    'find',
    'see',
    'keep',
    'stay',
    'focus',
    'remember',
    'organize',
    'organise',
    'explain',
    'check',
    'think',
    'review',
    'study',
    'try',
    'use',
    'show',
    'take',
    'set',
    'share',
    'speak',
    'connect',
    'compare',
  ];
  var MODALS = ['can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall'];
  var NOT_VERBS = [
    'and',
    'or',
    'but',
    'who',
    'which',
    'that',
    'to',
    'in',
    'on',
    'at',
    'with',
    'for',
    'of',
    'the',
    'a',
    'an',
    'his',
    'her',
    'their',
    'its',
    'too',
    'not',
    'as',
    'so',
  ];
  var ONE_TO_MANY = { is: 'are', was: 'were', has: 'have', does: 'do', goes: 'go' };
  var MANY_TO_ONE = { are: 'is', were: 'was', have: 'has', do: 'does', go: 'goes' };
  var PAST = [
    'made',
    'wrote',
    'took',
    'gave',
    'found',
    'brought',
    'built',
    'came',
    'went',
    'got',
    'kept',
    'held',
    'chose',
    'began',
    'led',
    'read',
    'saw',
    'thought',
    'taught',
    'knew',
    'drew',
    'spoke',
    'did',
    'had',
    'showed',
    'put',
    'set',
    'met',
    'won',
    'ran',
    'sat',
  ];

  /* The verb after a subject in the form for one person and for they:
     [explains|explain]. null when the word is not a verb that changes
     (a modal, the past, or not a verb at all). */
  function verbPair(word, they) {
    var w = String(word || '');
    var lw = w.toLowerCase();
    if (!/^[a-z]+$/.test(lw) || NOT_VERBS.indexOf(lw) >= 0 || MODALS.indexOf(lw) >= 0) return null;
    if (/ed$/.test(lw) || PAST.indexOf(lw) >= 0) return null;
    if (!they) {
      if (ONE_TO_MANY[lw]) return [w, ONE_TO_MANY[lw]];
      if (!/[^s]s$/.test(lw) || lw.length < 3) return null;
      var many = /ies$/.test(lw)
        ? lw.slice(0, -3) + 'y'
        : /(ches|shes|sses|xes|zes|oes)$/.test(lw)
          ? lw.slice(0, -2)
          : lw.slice(0, -1);
      return [w, many];
    }
    if (MANY_TO_ONE[lw]) return [MANY_TO_ONE[lw], w];
    if (/s$/.test(lw)) return null;
    var one = /[^aeiou]y$/.test(lw) ? lw.slice(0, -1) + 'ies' : /(ch|sh|ss|x|z|o)$/.test(lw) ? lw + 'es' : lw + 's';
    return [one, w];
  }

  /* The student's details found in a sentence and swapped for slots.
     e: { names: the student's names, longest first; p: their pronouns
     { subj, obj, poss, refl } or null; values: { slot: value } from the
     context (titles, competencies, the next step, the proficiency word,
     counts, the class name) }. Returns { text, slots, chips, counts }:
     the template, the slots it uses, the chips ("Gabriel → student’s
     name") and, per count slot, 'one' or 'many'. */
  function slotify(text, e) {
    var marks = [];
    var chips = [];
    var counts = {};
    var chip = function (from, to) {
      if (
        !chips.some(function (c) {
          return c.from === from && c.to === to;
        })
      )
        chips.push({ from: from, to: to });
    };
    var mark = function (out) {
      marks.push(out);
      return '\u0001' + (marks.length - 1) + '\u0002';
    };
    var s = String(text);
    var v = e.values || {};
    var R = _R();

    // Assignment titles, as the realiser quotes them.
    TITLE_SLOTS.forEach(function (k) {
      if (!v[k]) return;
      var t = R.workTitle(v[k]).replace(/\.+$/, '');
      var full = String(v[k]).trim();
      [t, full].forEach(function (title) {
        if (!title) return;
        var re = new RegExp('[“"]' + _reEsc(title) + '(\\.?)[”"]', 'g');
        s = s.replace(re, function (m, dot) {
          chip('“' + t + '”', SLOT_LABEL[k]);
          return mark({ slot: k, text: '{' + k + '}' }) + dot;
        });
      });
      // A sentence typed for the bank (e.loose) may name the title without
      // quotes, with or without its lesson number; the realiser quotes the
      // slot.
      if (e.loose)
        [full, t].forEach(function (title) {
          if (!title || title.length < 4) return;
          var bare = new RegExp('(^|[^A-Za-zÀ-ɏ0-9“"])' + _reEsc(title) + '(?![A-Za-zÀ-ɏ0-9”"])', 'g');
          s = s.replace(bare, function (m, lead) {
            chip(title, SLOT_LABEL[k]);
            return lead + mark({ slot: k, text: '{' + k + '}' });
          });
        });
    });
    // The class name, the competencies, the next step and the proficiency
    // word, exactly as the context has them.
    ['course']
      .concat(COMP_SLOTS)
      .concat(['standingWord'])
      .forEach(function (k) {
        var val = String(v[k] || '').trim();
        if (val.length < 2) return;
        var re = new RegExp('(^|[^A-Za-zÀ-ɏ])' + _reEsc(val) + '(?![A-Za-zÀ-ɏ])', 'g');
        s = s.replace(re, function (m, lead) {
          chip(val, SLOT_LABEL[k]);
          return lead + mark({ slot: k, text: '{' + k + '}' });
        });
      });
    // The strongest competencies by their labels, as {strengths} too.
    Object.keys(e.labels || {}).forEach(function (k) {
      e.labels[k].forEach(function (val) {
        val = String(val || '').trim();
        if (val.length < 2) return;
        var re = new RegExp('(^|[^A-Za-zÀ-ɏ])' + _reEsc(val) + '(?![A-Za-zÀ-ɏ])', 'g');
        s = s.replace(re, function (m, lead) {
          chip(val, SLOT_LABEL[k]);
          return lead + mark({ slot: k, text: '{' + k + '}' });
        });
      });
    });
    // Counts: "One assignment", "three classes".
    Object.keys(COUNT_NOUNS).forEach(function (k) {
      var n = Math.floor(Number(v[k])) || 0;
      if (n <= 0) return;
      var re = new RegExp('(^|[^A-Za-zÀ-ɏ0-9])([A-Za-z]+|\\d+)(\\s+)(' + COUNT_NOUNS[k] + ')(?![A-Za-zÀ-ɏ])', 'g');
      s = s.replace(re, function (m, lead, num, sp, noun) {
        var said = /^\d+$/.test(num) ? Number(num) : NUMBER_WORDS.indexOf(num.toLowerCase());
        if (said !== n) return m;
        chip(num + ' ' + noun, SLOT_LABEL[k]);
        counts[k] = n === 1 ? 'one' : 'many';
        return lead + mark({ slot: k, text: '{' + k + '}' }) + sp + noun;
      });
    });

    // The student: the name, then the pronouns.
    var subjects = [];
    var role = function (at, possessive) {
      if (possessive) return 'poss';
      var before = s
        .slice(0, at)
        .replace(/\u0001\d+\u0002/g, ' X ')
        .trim();
      if (!before || /[,;:]$/.test(before)) return 'subj';
      var prev = (before.match(/([A-Za-z’']+)$/) || ['', ''])[1].toLowerCase();
      return SUBJ_BEFORE.indexOf(prev) >= 0 ? 'subj' : 'obj';
    };
    var startsAt = function (str, at) {
      return !/[A-Za-z0-9\u0001]/.test(str.slice(0, at));
    };
    (e.names || []).forEach(function (name) {
      if (!name || name.length < 2) return;
      var re = new RegExp('(^|[^A-Za-zÀ-ɏ])(' + _reEsc(name) + ")(’s|'s)?(?![A-Za-zÀ-ɏ])", 'g');
      s = s.replace(re, function (m, lead, nm, poss, at, str) {
        var r = role(at + lead.length, !!poss);
        var cap = startsAt(str, at + lead.length);
        var slot = ROLE_SLOT[r];
        chip(nm, 'student’s name');
        var mk = mark({
          slot: cap ? slot.charAt(0).toUpperCase() + slot.slice(1) : slot,
          text: null,
          role: r,
          cap: cap,
        });
        if (r === 'subj') subjects.push({ id: marks.length - 1, they: false });
        return lead + mk;
      });
    });
    var p = e.p;
    if (p && p.subj) {
      var they = p.subj === 'they';
      var forms = [];
      ['subj', 'obj', 'poss', 'refl'].forEach(function (r) {
        if (p[r] && !forms.some(f => f.w === p[r])) forms.push({ w: p[r], r: r });
      });
      // "her" is both him and his: decided by the words around it.
      var both = forms.filter(function (f) {
        return f.w === 'her';
      }).length
        ? 'her'
        : '';
      var words = forms
        .map(function (f) {
          return f.w;
        })
        .filter(function (w, i, xs) {
          return xs.indexOf(w) === i;
        })
        .sort(function (a, b) {
          return b.length - a.length;
        });
      if (words.length) {
        var re = new RegExp("(^|[^A-Za-zÀ-ɏ’'])(" + words.map(_reEsc).join('|') + ")(?![A-Za-zÀ-ɏ’'])", 'gi');
        s = s.replace(re, function (m, lead, w, at, str) {
          var lw = w.toLowerCase();
          var r;
          if (lw === both) {
            var after = str.slice(at + m.length);
            var next = (after.match(/^\s+([A-Za-z]+)/) || ['', ''])[1].toLowerCase();
            var prevWord = (str.slice(0, at + lead.length).match(/([A-Za-z]+)\s*$/) || ['', ''])[1].toLowerCase();
            r =
              !next ||
              /^\s*[.,;:!?)”]/.test(after) ||
              OBJ_NEXT.indexOf(next) >= 0 ||
              (OBJ_BEFORE.indexOf(prevWord) >= 0 && BASE_VERBS.indexOf(next) >= 0)
                ? 'obj'
                : 'poss';
          } else {
            r = forms.find(function (f) {
              return f.w === lw;
            }).r;
          }
          var cap = startsAt(str, at + lead.length);
          var slot = ROLE_SLOT[r];
          chip(w, ROLE_LABEL[r]);
          var mk = mark({ slot: cap ? slot.charAt(0).toUpperCase() + slot.slice(1) : slot, text: null, role: r });
          if (r === 'subj') subjects.push({ id: marks.length - 1, they: they });
          return lead + mk;
        });
      }
    }
    // The verb after each subject agrees for one person and for they.
    subjects.forEach(function (sub) {
      var tag = '\u0001' + sub.id + '\u0002';
      var at = s.indexOf(tag);
      if (at < 0) return;
      var rest = s.slice(at + tag.length);
      var m = rest.match(
        /^(\s+)((?:(?:[a-z]+ly|always|often|also|still|now|never|sometimes|already|just|even)\s+)*)([A-Za-z]+)/,
      );
      if (!m) return;
      var pair = verbPair(m[3], sub.they);
      if (!pair) return;
      var verb = '[' + pair[0] + '|' + pair[1] + ']';
      s = s.slice(0, at + tag.length) + m[1] + m[2] + verb + rest.slice(m[0].length);
    });

    var slots = [];
    var out = s.replace(/\u0001(\d+)\u0002/g, function (m, i) {
      var x = marks[Number(i)];
      if (slots.indexOf(x.slot) < 0) slots.push(x.slot);
      return x.text || '{' + x.slot + '}';
    });
    return { text: out, slots: slots, chips: chips, counts: counts };
  }

  /* What is left in a template that only fits one student: a quotation,
     a capitalised word FullVision does not know, or a number. '' when
     nothing. */
  function _leftover(template) {
    var t = String(template)
      .replace(/\{\w+\}/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ');
    if (/[“”"]|‘[^’]+’/.test(t)) return 'a quotation';
    var first = true;
    var re = /[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ’'-]*/g;
    var m;
    var lead = String(template).replace(/^[\s“"(‘]+/, '');
    var starts = /^\{/.test(lead);
    while ((m = re.exec(t))) {
      var w = m[0];
      if (first && !starts) {
        first = false;
        continue;
      }
      first = false;
      if (/^[A-ZÀ-Þ]/.test(w) && !/^I(?:’[a-z]+|'[a-z]+)?$/.test(w)) return 'unknown word: ' + w;
    }
    if (/\d/.test(t)) return 'a number';
    return '';
  }

  /* The lint's finding in a few plain words. */
  function _lintReason(finding) {
    if (/^idiom/.test(finding)) return 'an idiom';
    if (/^comparison/.test(finding)) return 'a comparison with classmates';
    return finding;
  }

  /* ── One sentence ──────────────────────────────────────────────────── */

  function _stepDef(step) {
    return (
      (window.CommentBank &&
        CommentBank.DRAFT_STEPS.find(function (x) {
          return x.key === step;
        })) ||
      null
    );
  }
  /* The steps a sentence of the teacher's own can stand in: not the grade,
     not a class line (support, closing, late work), not the IE comment's
     Required parts. */
  function stepAllowed(step) {
    var def = _stepDef(step);
    return !!def && !def.line && !def.ie && def.key !== 'grade';
  }

  function _union(a, b) {
    var out = (a || []).slice();
    (b || []).forEach(function (x) {
      if (out.indexOf(x) < 0) out.push(x);
    });
    return out;
  }

  /* The student's details the slots can take: their names, pronouns when
     on file (else the set the sentence uses, when it uses only one), and
     the context's values. */
  function entities(ctx, f, student, text) {
    var names = [];
    var add = function (n) {
      n = String(n || '').trim();
      if (n && names.indexOf(n) < 0) names.push(n);
    };
    var st = student || {};
    var first = st.preferred || st.preferredName || st.firstName || (f && f.name) || '';
    if (first && st.lastName) add(first + ' ' + st.lastName);
    if (st.firstName && st.lastName) add(st.firstName + ' ' + st.lastName);
    add(f && f.name);
    add(st.preferred);
    add(st.preferredName);
    add(st.firstName);
    names.sort(function (a, b) {
      return b.length - a.length;
    });
    var p = null;
    if (f && f.pronounsOnFile && f.pronouns) p = f.pronouns;
    else {
      var t = String(text || '');
      var he = /\b(?:he|him|his|himself)\b/i.test(t);
      var she = /\b(?:she|her|hers|herself)\b/i.test(t);
      if (he && !she) p = { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' };
      else if (she && !he) p = { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' };
    }
    var values = {};
    TITLE_SLOTS.concat(COMP_SLOTS, ['course', 'standingWord', 'missingCount', 'absentCount']).forEach(function (k) {
      if (ctx && ctx[k]) values[k] = ctx[k];
    });
    // {strengths} fills with the strongest competencies' skills (the plan's
    // part 3), but the teacher may have named the competency itself; its
    // label is slotted the same way, from the facts behind the slot.
    var labels = { strengths: [] };
    ((ctx && ctx._facts && ctx._facts.strengths) || []).forEach(function (key) {
      var c = ((f && f.comps) || []).find(function (x) {
        return 'comp:' + x.id === key;
      });
      if (c && c.name) labels.strengths.push(String(c.name));
    });
    return { names: names, p: p, values: values, labels: labels };
  }

  /* One sentence of an approved comment, checked and made a template.
     row: its row on the Sentences card ({ step, s: the bank sentence it
     replaced, prov }); opts: { others: classmates' names, classmates: roster rows (default: the class's), family }.
     Returns { text, template: { text, slots, condition }, chips, offered }
     or { text, reason }. */
  function suggest(text, row, ctx, f, student, opts) {
    opts = opts || {};
    var R = _R();
    text = String(text || '').trim();
    var out = { text: text };
    var hit = _privateHit(text);
    if (hit) return Object.assign(out, { reason: 'private: ' + hit });
    var own = entities(ctx, f, student, text).names;
    var other = _classmateIn(text, own, f, student, opts);
    if (other) return Object.assign(out, { reason: 'another student: ' + other });
    if (_oneTime(text)) return Object.assign(out, { reason: 'about one day' });
    if (_date(text)) return Object.assign(out, { reason: 'a date' });
    var n = R.wordCount(text);
    if (n < MIN_WORDS) return Object.assign(out, { reason: 'under six words' });
    if (n > MAX_WORDS) return Object.assign(out, { reason: 'over 20 words' });
    var sl = slotify(text, entities(ctx, f, student, text));
    var left = _leftover(sl.text);
    if (left) return Object.assign(out, { reason: left });
    var lint = window.CommentLint ? CommentLint.findings(sl.text) : [];
    if (lint.length) return Object.assign(out, { reason: _lintReason(lint[0]) });

    var condition = _condition(sl, { row: row }, ctx, f, opts);
    var template = { text: sl.text, slots: sl.slots, condition: condition };
    return Object.assign(out, {
      template: template,
      chips: sl.chips,
      offered: offeredWhen(condition),
    });
  }

  /* The condition a template is bound to. bind: { row } for a sentence
     that sat in a row of the Sentences card (its step, the bank sentence
     it replaced with its `when`, `needs` and claims, the competencies that
     sentence was about); or { step, when, needs, claims, group } for a
     sentence the teacher wrote for a part and, when they chose one, a
     case. A part with no case is `general`: it claims nothing, so
     Generate picks it only when nothing more specific fits. Always the
     kind of class. */
  function _condition(sl, bind, ctx, f, opts) {
    opts = opts || {};
    var row = bind.row || null;
    var def = _stepDef(row ? row.step : bind.step);
    var base = row ? row.s || null : null;
    var dataSlots = sl.slots.filter(function (k) {
      return !/^(he|He|him|his|His|himself)$/.test(k);
    });
    var comps = {};
    if (row) {
      var was = (row.prov && row.prov.values) || {};
      var baseSlots = Object.keys(was).filter(function (k) {
        return !/^when\./.test(k);
      });
      COMP_SLOTS.forEach(function (k) {
        if (baseSlots.indexOf(k) < 0 || dataSlots.indexOf(k) >= 0) return;
        var names = ((ctx && ctx._compNames) || {})[k] || [];
        if (names.length) comps[k] = names.slice();
      });
    }
    var caseNeeds = row ? (base ? base.needs : []) : bind.needs || [];
    var needs = _union(caseNeeds, dataSlots);
    needs = _union(needs, Object.keys(comps));
    var claims = (row ? base && base.claims : bind.claims) || [];
    dataSlots.concat(Object.keys(comps)).forEach(function (k) {
      if (SLOT_CLAIMS[k]) claims = _union(claims, [SLOT_CLAIMS[k]]);
    });
    var when = Object.assign({}, (row ? base && base.when : bind.when) || {});
    var condition = {
      step: def.key,
      part: def.part,
      group: (row ? base && base.group : bind.group) || def.groups[0],
      family: opts.family || (f && f.family) || '',
      when: when,
      needs: needs,
      claims: claims,
    };
    if (Object.keys(comps).length) condition.comps = comps;
    if (Object.keys(sl.counts).length) condition.counts = sl.counts;
    if (!row && !Object.keys(when).length && !(bind.needs || []).length) condition.general = true;
    return condition;
  }

  /* ── A sentence the teacher writes for the bank (Colin, Nov 1) ────────
     "+ Write Your Own" and "Add to My Bank" on the Term Questionnaire: one
     line, written for the student on screen, slotted the same way as a
     suggestion and bound to a row's case or to a part (and a case the
     teacher picked). The teacher's text is theirs: the lint, the 6–20-word
     rule, a date, a one-day marker, a quotation, a number and an unknown
     capitalised word are advice under the box, each in plain words; only
     a health or designation word and another student's name block the
     save, since the sentence would be used for other students. */

  // A plain one-word verb for a few phrasal verbs the lint flags.
  var TRY = {
    'keep up': 'continue',
    'find out': 'learn',
    'figure out': 'solve',
    'work out': 'solve',
    'give up': 'stop',
    'point out': 'show',
    'carry out': 'do',
    'set up': 'prepare',
    'hand in': 'submit',
    'build on': 'extend',
    'back up': 'support',
  };
  function _q(w) {
    return '“' + w + '”';
  }
  function _reOf(str) {
    var m = /^\/([\s\S]*)\/([a-z]*)$/.exec(String(str || ''));
    try {
      return m ? new RegExp(m[1], m[2]) : null;
    } catch (e) {
      return null;
    }
  }
  function _matchOf(reStr, text) {
    var re = _reOf(reStr);
    var m = re && String(text).match(re);
    return m ? m[0].trim() : '';
  }
  /* One lint finding as advice. */
  function _adviceFor(finding, text) {
    var m = /^([a-z ]+): ([\s\S]*)$/.exec(finding);
    var kind = m ? m[1] : finding;
    var what = m ? m[2] : '';
    switch (kind) {
      case 'phrasal verb':
        return (
          _q(what) +
          ' is a phrase families may not know; try ' +
          (TRY[what] ? _q(TRY[what]) : 'a plain one-word verb') +
          '.'
        );
      case 'idiom': {
        var hit = _matchOf(what, text);
        return (hit ? _q(hit) + ' is a saying' : 'This has a saying') + ' families may not know; try plain words.';
      }
      case 'person praise':
        return _q(what) + ' praises the person; say what the work or the habit showed instead.';
      case 'comparison': {
        var c = _matchOf(what, text);
        return (c ? _q(c) + ' compares' : 'This compares') + ' with classmates; a report describes only this student.';
      }
      case 'evaluative word':
        return _q(what) + ' is a judging word the bank leaves out; say what the student did instead.';
      default:
        return finding;
    }
  }
  function _leftoverAdvice(left) {
    if (left === 'a quotation') return 'A quotation fits this student only; leave it out of a bank sentence.';
    if (left === 'a number') return 'A number fits this student only, so every student’s comment would say it.';
    var w = left.replace(/^unknown word: /, '');
    return _q(w) + ' is a name FullVision cannot turn into a slot, so every student’s comment would say it.';
  }

  /* A template in plain words for the preview under the box ("Saved as:
     [Name] uses feedback on one piece before the final version."): a
     name or pronoun slot in brackets, a data slot by its label, a verb in
     its one-person form. No slot syntax is shown. */
  var PLAIN = {
    He: '[Name]',
    His: '[Name]’s',
    he: '[he/she/they]',
    him: '[him/her/them]',
    his: '[his/her/their]',
    himself: '[himself/herself/themselves]',
    name: '[Name]',
  };
  function plainWords(template) {
    return String(template || '')
      .replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$1')
      .replace(/\{(\w+)\}/g, function (m, k) {
        return PLAIN[k] || '[' + (SLOT_LABEL[k] || k) + ']';
      });
  }

  /* One sentence the teacher wrote, as a template with advice. bind: see
     _condition. opts: { others: classmates' names, classmates: roster rows (default: the class's), family }. Returns
     { text, template, chips, preview, offered, advice: [plain sentences],
       blocked: '' or why it cannot be saved }; no template for an empty
     line. */
  function compose(text, bind, ctx, f, student, opts) {
    opts = opts || {};
    var R = _R();
    text = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    var out = { text: text, template: null, chips: [], preview: '', offered: '', advice: [], blocked: '' };
    if (!text) return out;
    var hit = _privateHit(text);
    if (hit) out.blocked = _q(hit) + ' is a health or designation word; a bank sentence cannot hold one.';
    var e = entities(ctx, f, student, text);
    var other = _classmateIn(text, e.names, f, student, opts);
    if (!out.blocked && other)
      out.blocked = _q(other) + ' is a classmate’s name; a bank sentence cannot name another student.';
    var n = R.wordCount(text);
    if (n < MIN_WORDS)
      out.advice.push('This is ' + _plural(n, 'word', 'words') + '; a bank sentence needs six or more.');
    else if (n > MAX_WORDS) out.advice.push('This is ' + n + ' words; a report sentence has 20 or fewer.');
    var oneDay = _oneTime(text);
    var date = _date(text);
    if (oneDay) out.advice.push('This is about one day; a bank sentence is used every term.');
    if (date) out.advice.push('A date fits one report only; a bank sentence is used every term.');
    e.loose = true;
    var sl = slotify(text, e);
    var left = _leftover(sl.text);
    // A weekday or month is already the one-day or date advice.
    if (left && !((oneDay || date) && /^unknown word/.test(left))) out.advice.push(_leftoverAdvice(left));
    (window.CommentLint ? CommentLint.findings(sl.text) : []).forEach(function (fd) {
      if (/^over 20 words/.test(fd)) return;
      out.advice.push(_adviceFor(fd, text));
    });
    var condition = _condition(sl, bind || {}, ctx, f, opts);
    condition.own = true;
    out.template = { text: sl.text, slots: sl.slots, condition: condition };
    out.chips = sl.chips;
    out.preview = plainWords(sl.text);
    out.offered = offeredWhen(condition);
    return out;
  }

  /* An approved comment's sentences that the teacher wrote or changed,
     each checked (suggest()). rows: the Sentences card's rows. */
  function fromRows(rows, ctx, f, student, opts) {
    var out = [];
    (rows || []).forEach(function (row) {
      if (!row || !row.edited || row.classLine || !stepAllowed(row.step)) return;
      var parts =
        window.ReportQuestionnaire && ReportQuestionnaire.sentencesOf
          ? ReportQuestionnaire.sentencesOf(row.text)
          : [row.text];
      parts.forEach(function (t) {
        out.push(suggest(t, row, ctx, f, student, opts));
      });
    });
    return out;
  }

  /* ── "Offered when …" ──────────────────────────────────────────────── */

  var FAMILY_LABEL = {
    adst: 'ADST',
    arts: 'Arts',
    career: 'Career Education',
    ela: 'English',
    languages: 'Languages',
    math: 'Math',
    pe: 'PE',
    science: 'Science',
    socials: 'Socials',
  };
  var COMP_SAYS = {
    strengths: ['is a strength'],
    growthAreas: ['is an area to grow'],
    focusLow: ['is an area to grow'],
    rise: ['improved'],
    fall: ['slipped'],
    focus: ['the next step is'],
    nextSkill: ['the next step is'],
  };
  function _or(xs) {
    xs = xs || [];
    return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' or ' + xs[xs.length - 1];
  }
  function _habitName(k) {
    var h = window.CommentBank && CommentBank.HABITS.find(x => x.key === k);
    return k === 'ready' ? 'Comes Ready, Uses Class Time' : h ? h.name : k;
  }
  /* When a template is offered, in plain words: "Offered when Evidence is
     a strength, in Socials classes". */
  function offeredWhen(c) {
    c = c || {};
    var bits = [];
    var comps = c.comps || {};
    Object.keys(comps).forEach(function (k) {
      var says = (COMP_SAYS[k] || ['is a competency'])[0];
      var who = _or(comps[k]);
      bits.push(/^the /.test(says) ? says + ' ' + who : who + ' ' + says);
    });
    var counts = c.counts || {};
    var needs = c.needs || [];
    if (counts.missingCount === 'one') bits.push('one assignment is not handed in');
    else if (counts.missingCount === 'many') bits.push('two or more assignments are not handed in');
    else if (needs.indexOf('missingWork') >= 0) bits.push('work is not handed in');
    if (counts.absentCount === 'one') bits.push('one class was missed');
    else if (counts.absentCount === 'many') bits.push('two or more classes were missed');
    if (needs.indexOf('habitsExcellent') >= 0) bits.push('every habit is rated Consistently');
    if (needs.indexOf('habitsGood') >= 0) bits.push('every habit is rated Usually or Consistently');
    if (needs.indexOf('habitToBuild') >= 0) bits.push('one habit is rated Sometimes or Rarely');
    if (needs.indexOf('habitsToBuild') >= 0) bits.push('two habits are rated Sometimes or Rarely');
    var when = c.when || {};
    var scale = (window.CommentBank && CommentBank.SCALE) || [];
    Object.keys(when).forEach(function (k) {
      if (k === 'picture') bits.push('the term’s picture is ' + when[k]);
      else if (k === 'standing') bits.push('overall is ' + when[k]);
      else if (['grade', 'path', 'ieProblem'].indexOf(k) < 0 && scale[when[k] - 1])
        bits.push(_habitName(k) + ' is rated ' + scale[when[k] - 1]);
    });
    var fam = FAMILY_LABEL[c.family] || '';
    var list = _R().list(bits);
    if (list) return 'Offered when ' + list + (fam ? ', in ' + fam + ' classes' : '');
    return fam ? 'Offered in ' + fam + ' classes' : 'Offered for every student';
  }

  /* ── Near-duplicates ───────────────────────────────────────────────── */

  function _wordSet(text) {
    var ws = window.CommentLint ? CommentLint.words(text) : String(text).toLowerCase().split(/\W+/);
    var out = {};
    ws.forEach(function (w) {
      if (w) out[w] = true;
    });
    return out;
  }
  /* Two templates are near-duplicates when most of their words are the same
     (a slot counts as one word): shared words over the longer one's, 0.8 or
     more. */
  function near(a, b) {
    var x = _wordSet(a);
    var y = _wordSet(b);
    var kx = Object.keys(x);
    var ky = Object.keys(y);
    if (!kx.length || !ky.length) return false;
    var both = kx.filter(function (w) {
      return y[w];
    }).length;
    return both / Math.max(kx.length, ky.length) >= NEAR;
  }

  /* ── The bank: device copy, server, COMMENT_BANK ───────────────────── */

  var _list = null;
  function list() {
    if (!_list) {
      var x = _read(_storeKey(), []);
      _list = Array.isArray(x) ? x : [];
    }
    return _list;
  }
  function _save(xs) {
    _list = xs;
    _write(_storeKey(), xs);
    install();
  }
  function _same(a, b) {
    return (
      String(a || '')
        .trim()
        .toLowerCase() ===
      String(b || '')
        .trim()
        .toLowerCase()
    );
  }

  /* A kept template as a bank sentence, or null when it no longer reads
     as one (no step, or the lint flags it). A sentence the teacher wrote
     for the bank themselves (`own`) is theirs: the lint was advice when
     they saved it, so it stays. One bound to a part with no case is
     `general`. */
  function toSentence(row) {
    if (!row || !row.text) return null;
    var c = row.condition || {};
    var s = {
      id: 'mine:' + row.id,
      part: c.part,
      group: c.group,
      text: String(row.text),
      needs: (c.needs || []).slice(),
      when: Object.assign({}, c.when || {}),
      claims: (c.claims || []).slice(),
      mine: true,
      src: 'yours',
    };
    if (c.family) s.subjects = [c.family];
    if (c.comps && Object.keys(c.comps).length) s.comps = c.comps;
    if (c.counts && Object.keys(c.counts).length) s.counts = c.counts;
    if (c.general) s.general = true;
    if (!window.CommentBank || !CommentBank.stepOf(s) || !stepAllowed(CommentBank.stepOf(s))) return null;
    if (!c.own && window.CommentLint && CommentLint.findings(s.text).length) return null;
    return s;
  }
  function sentences() {
    return list().map(toSentence).filter(Boolean);
  }
  function count() {
    return sentences().length;
  }

  /* The kept sentences in COMMENT_BANK, marked `mine`, in place of any put
     there before. */
  function install(bank) {
    bank = bank || (typeof COMMENT_BANK !== 'undefined' ? COMMENT_BANK : null);
    if (!bank || !Array.isArray(bank.sentences)) return;
    for (var i = bank.sentences.length - 1; i >= 0; i--) if (bank.sentences[i].mine) bank.sentences.splice(i, 1);
    sentences().forEach(function (s) {
      bank.sentences.push(s);
    });
  }

  /* The list from the server, once per page. A template kept here that
     the server has not confirmed yet (no server id) stays in front. A
     failed read keeps the device copy. Resolves true when the bank
     changed. */
  var _loaded = null;
  function load(force) {
    install();
    if (_loaded && !force) return _loaded;
    var read = _v2('listCommentTemplates');
    if (!read) return (_loaded = Promise.resolve(false));
    _loaded = read().then(
      function (res) {
        if (!res || !Array.isArray(res.data)) return false;
        var before = JSON.stringify(list());
        var rows = res.data
          .filter(function (r) {
            return !_deleteIfRemoved(r);
          })
          .map(function (r) {
            return { id: r.id, text: r.text, slots: r.slots || [], condition: r.condition || {}, uses: r.uses || 0 };
          });
        var pending = list().filter(function (t) {
          return (
            !_isUuid(t.id) &&
            !rows.some(function (r) {
              return _same(r.text, t.text);
            })
          );
        });
        _save(pending.concat(rows));
        return JSON.stringify(list()) !== before;
      },
      function () {
        return false;
      },
    );
    return _loaded;
  }

  /* Keep a template: in the bank now, and to the server through the
     outbox. The same text replaces the earlier one's condition, as the
     server does. Returns the entry. */
  function keep(t) {
    if (!t || !t.text) return null;
    _unmarkRemoved(t.text);
    var existing = list().find(function (x) {
      return _same(x.text, t.text);
    });
    var entry = {
      id:
        existing && _isUuid(existing.id)
          ? existing.id
          : 'ct-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      text: String(t.text).trim(),
      slots: (t.slots || []).slice(),
      condition: t.condition || {},
      uses: existing ? existing.uses || 0 : 0,
    };
    _save(
      [entry].concat(
        list().filter(function (x) {
          return x !== existing;
        }),
      ),
    );
    var save = _v2('saveCommentTemplate');
    if (save) {
      var localId = entry.id;
      save({ text: entry.text, slots: entry.slots, condition: entry.condition }).then(
        function (res) {
          var row = res && res.data && res.data.id ? res.data : null;
          if (!row || _isUuid(localId)) return;
          if (_deleteIfRemoved({ id: row.id, text: entry.text })) return;
          _save(
            list().map(function (x) {
              return x.id === localId ? Object.assign({}, x, { id: row.id }) : x;
            }),
          );
        },
        function () {
          /* the device copy stands; the outbox retries the write */
        },
      );
    }
    return entry;
  }

  /* Take a kept template out of the bank on this device, for an undo
     toast: the entry comes back, and the server is told only when the
     toast closes without Undo (purge). */
  function forget(id) {
    var key = String(id || '').replace(/^mine:/, '');
    var t = list().find(function (x) {
      return x.id === key;
    });
    if (!t) return null;
    _save(
      list().filter(function (x) {
        return x !== t;
      }),
    );
    return t;
  }
  /* Put a forgotten entry back, in front. */
  function restore(entry) {
    if (!entry || !entry.text) return false;
    _save(
      [entry].concat(
        list().filter(function (x) {
          return x.id !== entry.id;
        }),
      ),
    );
    return true;
  }
  /* Delete a forgotten entry on the server (through the outbox). One whose
     save has not reached the server yet is deleted when it does. */
  function purge(entry) {
    var del = _v2('deleteCommentTemplate');
    if (entry && del && _isUuid(entry.id)) del(entry.id);
    else if (entry && entry.text) _write(_removedKey(), _read(_removedKey(), []).concat([String(entry.text).trim()]));
  }
  function _unmarkRemoved(text) {
    var removed = _read(_removedKey(), []);
    var keepTexts = removed.filter(function (x) {
      return !_same(x, text);
    });
    if (keepTexts.length !== removed.length) _write(_removedKey(), keepTexts);
  }
  /* A server row the teacher removed before it was saved: delete it.
     Returns true when it was one. */
  function _deleteIfRemoved(row) {
    var del = _v2('deleteCommentTemplate');
    if (!del || !row || !_isUuid(row.id)) return false;
    var removed = _read(_removedKey(), []);
    if (
      !removed.some(function (x) {
        return _same(x, row.text);
      })
    )
      return false;
    _unmarkRemoved(row.text);
    del(row.id);
    return true;
  }
  /* Remove a kept template, here and on the server. */
  function remove(id) {
    var t = forget(id);
    if (!t) return false;
    purge(t);
    return true;
  }

  /* ── Suggestions per class and report ──────────────────────────────── */

  function _state(cid, termId) {
    var st = _read(_suggestKey(cid, termId), null);
    if (!st || typeof st !== 'object') st = {};
    st.by = st.by || {};
    st.decided = st.decided || {};
    return st;
  }
  function _saveState(cid, termId, st) {
    _write(_suggestKey(cid, termId), st);
  }

  /* After a comment is approved: its sentences as suggestions, kept on this
     device until the class's last comment is approved. name: the
     student's name for "From Gabriel Wong’s comment". */
  function noteApproved(cid, termId, sid, name, items) {
    var st = _state(cid, termId);
    st.by[String(sid)] = { name: String(name || ''), items: items || [] };
    _saveState(cid, termId, st);
  }
  function hasNote(cid, termId, sid) {
    return !!_state(cid, termId).by[String(sid)];
  }

  /* What the sheet shows: the suggestions not yet kept or skipped, in
     roster order (order: student ids), each near-duplicate of the shared
     bank, the teacher's bank or an earlier suggestion left out; and every
     sentence left out, with why. */
  function review(cid, termId, order) {
    var st = _state(cid, termId);
    var sids = (order || []).map(String).filter(function (sid) {
      return !!st.by[sid];
    });
    Object.keys(st.by).forEach(function (sid) {
      if (sids.indexOf(sid) < 0) sids.push(sid);
    });
    var shared = (typeof COMMENT_BANK !== 'undefined' ? COMMENT_BANK.sentences : []).filter(function (s) {
      return !s.mine;
    });
    var mine = sentences();
    var pending = [];
    var left = [];
    sids.forEach(function (sid) {
      var by = st.by[sid];
      (by.items || []).forEach(function (it, i) {
        var key = sid + ':' + i;
        if (!it.template) {
          left.push({ text: it.text, reason: it.reason });
          return;
        }
        if (st.decided[key]) return;
        var t = it.template.text;
        if (
          shared.some(function (s) {
            return near(s.text, t);
          })
        ) {
          left.push({ text: it.text, reason: 'already in the bank' });
          return;
        }
        if (
          mine.some(function (s) {
            return near(s.text, t);
          })
        ) {
          left.push({ text: it.text, reason: 'already in your bank' });
          return;
        }
        if (
          pending.some(function (x) {
            return near(x.template.text, t);
          })
        )
          return;
        pending.push(Object.assign({ key: key, sid: sid, name: by.name }, it));
      });
    });
    return { pending: pending, left: left, done: !!st.done, status: st.status || '' };
  }

  function decide(cid, termId, key, what) {
    var st = _state(cid, termId);
    st.decided[key] = what;
    _saveState(cid, termId, st);
  }
  function setStatus(cid, termId, status) {
    var st = _state(cid, termId);
    st.status = status;
    if (status === 'done') st.done = true;
    _saveState(cid, termId, st);
  }

  /* ── The sheet ─────────────────────────────────────────────────────── */

  var SHEET_ID = 'tq-bank-overlay';
  var _sheet = null; // { cid, termId, order, course, total }
  var _shownNow = {};

  function isOpen() {
    return !!_sheet && !!document.getElementById(SHEET_ID);
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  // html-safe: sentence, student name, chips, offer line and key all esc()'d
  function _cardHtml(it) {
    var chips = (it.chips || [])
      .map(function (c) {
        return `<span class="qn-bank-chip">${esc(c.from)} → ${esc(c.to)}</span>`;
      })
      .join('');
    return `<div class="qn-bank-card" data-key="${esc(it.key)}">
      <span class="qn-bank-from">From ${esc(it.name)}’s comment</span>
      <span class="qn-bank-sentence">${esc(it.text)}</span>
      ${chips ? `<div class="qn-bank-chips"><span class="qn-bank-dim">For other students:</span>${chips}</div>` : ''}
      <div class="qn-bank-row">
        <span class="qn-bank-dim">${esc(it.offered)}</span>
        <span class="qn-bank-gap"></span>
        <button type="button" class="qn-btn" data-bank="skip" data-key="${esc(it.key)}" title="Leaves this sentence out of your bank.">Skip</button>
        <button type="button" class="qn-generate" data-bank="keep" data-key="${esc(it.key)}" title="Adds this sentence to your bank. Generate offers it first for students it fits.">Keep</button>
      </div>
    </div>`;
  }

  // html-safe: course, counts, tally and left-out sentences esc()'d or numbers; cards from _cardHtml
  function _sheetHtml() {
    var b = _sheet;
    var r = review(b.cid, b.termId, b.order);
    var shown = r.pending.slice(0, SHOWN);
    var left = r.left.length
      ? `<div class="qn-bank-out"><span class="qn-bank-out-title">Left out (${r.left.length})</span>${r.left
          .map(function (x) {
            return `<span>“${esc(x.text)}” · ${esc(x.reason)}</span>`;
          })
          .join('')}</div>`
      : '';
    var bank = 'your bank has ' + _plural(count(), 'sentence', 'sentences');
    var tally = r.pending.length ? shown.length + ' of ' + r.pending.length + ' shown · ' + bank : bank;
    return `<div class="qn-bank" role="document">
      <div class="qn-bank-head">
        <div class="qn-bank-top"><span class="qn-bank-title" id="tq-bank-title">Suggested for Your Bank</span><span class="qn-bank-dim">${esc(b.course)} · all ${esc(String(b.total))} comments approved</span></div>
        <span class="qn-bank-dim">Sentences you wrote or changed in this class. Keep the ones you would use again, and Generate will offer them first for students they fit. Nothing is kept unless you choose Keep.</span>
      </div>
      <div class="qn-bank-list">${shown.map(_cardHtml).join('')}${left}</div>
      <div class="qn-bank-foot">
        <span class="qn-bank-dim" id="tq-bank-count">${esc(tally)}</span>
        <span class="qn-bank-gap"></span>
        <button type="button" class="qn-btn" data-bank="later" title="Closes this for now. It opens again the next time you open the Term Questionnaire for this class.">Later</button>
        <button type="button" class="qn-generate" data-bank="done" title="Closes this. Sentences you did not keep stay out of your bank.">Done</button>
      </div>
    </div>`;
  }

  /* The sheet's HTML for a class's report, as open() draws it. */
  function sheetHtml(o) {
    var prev = _sheet;
    _sheet = { cid: o.cid, termId: o.termId, order: o.order || [], course: o.course || '', total: o.total || 0 };
    var h = _sheetHtml();
    _sheet = prev;
    return h;
  }

  function _redraw(focusKey) {
    var o = document.getElementById(SHEET_ID);
    if (!o || !_sheet) return;
    o.innerHTML = _sheetHtml();
    var btn =
      (focusKey && o.querySelector('[data-bank="keep"][data-key="' + focusKey + '"]')) ||
      o.querySelector('[data-bank="keep"]') ||
      o.querySelector('[data-bank="done"]');
    if (btn) btn.focus();
  }

  function close(status) {
    var o = document.getElementById(SHEET_ID);
    if (_sheet && status) setStatus(_sheet.cid, _sheet.termId, status);
    _sheet = null;
    if (o) o.remove();
  }

  function _act(what, key) {
    var b = _sheet;
    if (!b) return;
    if (what === 'later') return close('later');
    if (what === 'done') return close('done');
    var r = review(b.cid, b.termId, b.order);
    var at = r.pending.findIndex(function (x) {
      return x.key === key;
    });
    if (at < 0) return;
    var it = r.pending[at];
    if (what === 'keep') keep(it.template);
    decide(b.cid, b.termId, key, what === 'keep' ? 'kept' : 'skipped');
    var next = review(b.cid, b.termId, b.order).pending.slice(0, SHOWN);
    _redraw(next[Math.min(at, next.length - 1)] && next[Math.min(at, next.length - 1)].key);
  }

  /* Open the sheet for a class's report: { cid, termId, order (student ids
     in roster order), course, total }. Nothing opens when there is nothing
     to keep. Returns whether it opened. */
  function open(o) {
    if (!o || o.cid == null || o.termId == null) return false;
    if (!review(o.cid, o.termId, o.order).pending.length) return false;
    close();
    _sheet = { cid: o.cid, termId: o.termId, order: o.order || [], course: o.course || '', total: o.total || 0 };
    _shownNow[o.cid + '|' + o.termId] = true;
    var overlay = document.createElement('div');
    overlay.id = SHEET_ID;
    overlay.className = 'confirm-overlay qn-info-overlay qn-bank-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tq-bank-title');
    overlay.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-bank]');
      if (btn) _act(btn.dataset.bank, btn.dataset.key);
    });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close('later');
      }
    });
    document.body.appendChild(overlay);
    _redraw();
    return true;
  }

  /* Whether the sheet should open now for a class's report. after: the
     class's last comment was just approved (it opens unless the teacher
     chose Done); otherwise only when the teacher chose Later before, once
     a page. */
  function shouldOffer(cid, termId, after) {
    var st = _state(cid, termId);
    if (st.done) return false;
    if (after) return true;
    return st.status === 'later' && !_shownNow[cid + '|' + termId];
  }

  return {
    MIN_WORDS: MIN_WORDS,
    MAX_WORDS: MAX_WORDS,
    PRIVATE: PRIVATE,
    stepAllowed: stepAllowed,
    verbPair: verbPair,
    slotify: slotify,
    entities: entities,
    suggest: suggest,
    compose: compose,
    plainWords: plainWords,
    fromRows: fromRows,
    offeredWhen: offeredWhen,
    near: near,
    list: list,
    load: load,
    keep: keep,
    remove: remove,
    forget: forget,
    restore: restore,
    purge: purge,
    sentences: sentences,
    toSentence: toSentence,
    count: count,
    install: install,
    noteApproved: noteApproved,
    hasNote: hasNote,
    review: review,
    decide: decide,
    setStatus: setStatus,
    shouldOffer: shouldOffer,
    open: open,
    close: close,
    sheetHtml: sheetHtml,
    isOpen: isOpen,
    _reset: function () {
      _list = null;
      _loaded = null;
      _shownNow = {};
      _sheet = null;
    },
  };
})();
