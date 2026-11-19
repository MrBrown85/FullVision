// @ts-check
/* rubric-scale.js — a rubric's own level columns (2026-11-19).
 *
 * A rubric has the four FullVision levels unless it has columns of its
 * own: rubric.scale, 2 to 6 of them, low to high, each
 * { k: its slot 1..6, name, level: 1..4, mod: -1|0|1 }. A teacher adds,
 * renames, inserts and removes them in the rubric editor, as in other
 * gradebooks; the BC English 12 six-point scoring guides are ready-made
 * rubrics with six (BC_SIX). A column's descriptor is the criterion's
 * levels[k] and its checkboxes are checks at level k.
 *
 * A score is stored as the FullVision level and ± its column counts as, so
 * the course %, competencies, reports and the student page read it as any
 * other rubric score and no grade math changes (DECISIONS, "Rubric
 * Levels"). Only rubric screens show the column; they read it back from
 * the stored pair with fromStored (the nearest column, ties to the lower).
 *
 * Plain functions over plain data, no DOM. Loaded by the teacher app, the
 * phone and the student page (which loads neither constants.js nor
 * calc.js), so it depends on nothing.
 */
window.RubricScale = (function () {
  'use strict';

  var MAX = 6;
  var MIN = 2;
  // The levels' names: constants.js's PROF_LABELS where it is loaded; the
  // student page has its own copy of the words (s/student-data.js).
  /** @type {Record<number, string>} */
  var WORDS =
    typeof PROF_LABELS !== 'undefined'
      ? PROF_LABELS
      : /** @type {any} */ (window).FV_LEVEL_WORDS || { 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4' };

  // The ten FullVision steps a column can count as, low to high (no 1− or 4+).
  var STEPS = [
    { level: 1, mod: 0 },
    { level: 1, mod: 1 },
    { level: 2, mod: -1 },
    { level: 2, mod: 0 },
    { level: 2, mod: 1 },
    { level: 3, mod: -1 },
    { level: 3, mod: 0 },
    { level: 3, mod: 1 },
    { level: 4, mod: -1 },
    { level: 4, mod: 0 },
  ];
  function stepValue(s) {
    return Number(s.level) + (Number(s.mod) || 0) / 3;
  }
  function stepIndex(level, mod) {
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].level === Number(level) && STEPS[i].mod === (Number(mod) || 0)) return i;
    }
    return -1;
  }
  // "Proficient +"
  function stepText(level, mod) {
    var m = Number(mod) || 0;
    return (WORDS[level] || '') + (m > 0 ? ' +' : m < 0 ? ' −' : '');
  }

  /* The BC Ministry's six-point scale, as the council mapped it: 6 → 4,
     5 → 3+, 4 → 3, 3 → 2, 2 → 1+, 1 → 1. */
  var BC_SIX = [
    { k: 1, name: 'Unacceptable', level: 1, mod: 0 },
    { k: 2, name: 'Inadequate', level: 1, mod: 1 },
    { k: 3, name: 'Barely Adequate', level: 2, mod: 0 },
    { k: 4, name: 'Competent', level: 3, mod: 0 },
    { k: 5, name: 'Proficient', level: 3, mod: 1 },
    { k: 6, name: 'Superior', level: 4, mod: 0 },
  ];

  function has(rubric) {
    return !!rubric && !rubric.kind && Array.isArray(rubric.scale) && rubric.scale.length >= MIN;
  }
  // The four FullVision levels as columns.
  function fourLevels() {
    return [1, 2, 3, 4].map(function (l) {
      return { k: l, name: WORDS[l], level: l, mod: 0 };
    });
  }
  /* A rubric's columns, low to high: its own, else the four levels. */
  function columns(rubric) {
    if (!has(rubric)) return fourLevels();
    return rubric.scale
      .map(function (c) {
        return { k: Number(c.k), name: String(c.name || ''), level: Number(c.level), mod: Number(c.mod) || 0 };
      })
      .sort(function (a, b) {
        return a.k - b.k;
      });
  }
  function col(rubric, k) {
    return (
      columns(rubric).filter(function (c) {
        return c.k === Number(k);
      })[0] || null
    );
  }
  /* The column slots in the class's Rubric Levels order: `order` is the
     class's four-level order ([4, 3, 2, 1] or [1, 2, 3, 4]). */
  function keys(rubric, order) {
    var ks = columns(rubric).map(function (c) {
      return c.k;
    });
    return order && Number(order[0]) === 1 ? ks : ks.reverse();
  }
  function isKey(rubric, k) {
    return !!col(rubric, k);
  }
  function name(rubric, k) {
    var c = col(rubric, k);
    return c ? c.name || 'Level ' + c.k : '';
  }
  /* "5 Proficient": the column's number and name. */
  function label(rubric, k) {
    var c = col(rubric, k);
    return c ? c.k + ' ' + (c.name || 'Level ' + c.k) : '';
  }
  // The colour step a column is drawn in: the FullVision level it counts as.
  function tone(rubric, k) {
    var c = col(rubric, k);
    return c ? c.level : 0;
  }
  /* A column → { level, mod } to store; null for none. */
  function toStored(rubric, k) {
    var c = col(rubric, k);
    return c ? { level: c.level, mod: c.mod } : null;
  }
  /* "Proficient +": what a column counts as. */
  function countsAs(rubric, k) {
    var c = col(rubric, k);
    return c ? stepText(c.level, c.mod) : '';
  }
  /* A stored level and ± → its column, 0 for no level. */
  function fromStored(rubric, level, mod) {
    var lv = Number(level) || 0;
    if (!(lv >= 1 && lv <= 4)) return 0;
    var m = Number(mod) > 0 ? 1 : Number(mod) < 0 ? -1 : 0;
    if ((lv === 1 && m < 0) || (lv === 4 && m > 0)) m = 0;
    return fromValue(rubric, lv + m / 3);
  }
  /* A value on the 1–4 scale (3.33 for 3+) → the nearest column, ties to
     the lower; 0 for none. */
  function fromValue(rubric, value) {
    var v = Number(value) || 0;
    if (!(v > 0)) return 0;
    var best = 0;
    var gap = Infinity;
    columns(rubric).forEach(function (c) {
      var g = Math.abs(stepValue(c) - v);
      if (g < gap - 1e-9) {
        best = c.k;
        gap = g;
      }
    });
    return best;
  }

  /* ── The editor's column changes ──────────────────────────────
     Each returns nothing and changes the draft rubric in place: its scale,
     and every criterion's descriptors and checkboxes, which move with
     their column. A removal, or an insert with no free step, spreads
     Counts As evenly over the ten steps; the teacher can change any. */
  function _spread(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var at = n === 1 ? 9 : Math.round((i * 9) / (n - 1));
      out.push(STEPS[at]);
    }
    return out;
  }
  // Columns numbered 1.. in order, with the steps given (or their own).
  function _numbered(list, steps) {
    return list.map(function (c, i) {
      var st = steps ? steps[i] : c;
      return { k: i + 1, name: c.name, level: st.level, mod: st.mod };
    });
  }
  // Move every criterion's slot `from` to `to` (descriptors and checks).
  function _remap(rubric, map) {
    rubric.criteria = (rubric.criteria || []).map(function (cr) {
      var old = cr.levels || {};
      var levels = {};
      Object.keys(map).forEach(function (from) {
        var text = old[from];
        if (map[from]) levels[map[from]] = text || '';
      });
      var checks = (cr.checks || [])
        .filter(function (ch) {
          return ch && map[Number(ch.level)];
        })
        .map(function (ch) {
          return Object.assign({}, ch, { level: map[Number(ch.level)] });
        });
      // Point values belong to the four levels only.
      return Object.assign({}, cr, { levels: levels, checks: checks, levelValues: null });
    });
  }
  // A scale that is just the four levels is no scale at all.
  function _tidy(rubric, list) {
    var plain =
      list.length === 4 &&
      list.every(function (c, i) {
        return c.k === i + 1 && c.name === WORDS[i + 1] && c.level === i + 1 && c.mod === 0;
      });
    rubric.scale = plain ? null : list;
  }
  /* A new column at position `at` (0 = lowest), named `newName`. */
  function insertLevel(rubric, at, newName) {
    var s = columns(rubric);
    if (s.length >= MAX) return false;
    at = Math.max(0, Math.min(s.length, at));
    var map = {};
    s.forEach(function (c, i) {
      map[c.k] = i < at ? i + 1 : i + 2;
    });
    _remap(rubric, map);
    // A free step between its neighbours keeps every other column as it
    // was; with none free, the edge column moves in a step, else all of
    // them are spread again.
    var lo = at > 0 ? stepIndex(s[at - 1].level, s[at - 1].mod) : -1;
    var hi = at < s.length ? stepIndex(s[at].level, s[at].mod) : STEPS.length;
    var steps = s.map(function (c) {
      return STEPS[stepIndex(c.level, c.mod)];
    });
    var fresh = hi - lo > 1 ? STEPS[Math.floor((lo + hi) / 2)] : null;
    steps.splice(at, 0, fresh || STEPS[0]);
    var list = s.slice();
    list.splice(at, 0, { k: 0, name: newName || 'New Level', level: 1, mod: 0 });
    if (!fresh) steps = _roomFor(steps, at) || _spread(list.length);
    rubric.scale = _numbered(list, steps);
    return true;
  }
  /* A new top (or bottom) level with no step free: the old top (bottom)
     level moves one step in, if it can, and the new one takes its step.
     Null when there is no room that way either. */
  function _roomFor(steps, at) {
    var idx = steps.map(function (st) {
      return stepIndex(st.level, st.mod);
    });
    var out = steps.slice();
    if (at === steps.length - 1 && at >= 1) {
      var top = idx[at - 1];
      if (top - (at >= 2 ? idx[at - 2] : -1) < 2) return null;
      out[at] = STEPS[top];
      out[at - 1] = STEPS[top - 1];
      return out;
    }
    if (at === 0 && steps.length >= 2) {
      var low = idx[1];
      if ((steps.length >= 3 ? idx[2] : STEPS.length) - low < 2) return null;
      out[0] = STEPS[low];
      out[1] = STEPS[low + 1];
      return out;
    }
    return null;
  }
  function removeLevel(rubric, k) {
    var s = columns(rubric);
    if (s.length <= MIN) return false;
    var at = s.findIndex(function (c) {
      return c.k === Number(k);
    });
    if (at < 0) return false;
    var map = {};
    s.forEach(function (c, i) {
      map[c.k] = i === at ? 0 : i < at ? i + 1 : i;
    });
    _remap(rubric, map);
    var list = s.filter(function (c, i) {
      return i !== at;
    });
    _tidy(rubric, _numbered(list, _spread(list.length)));
    return true;
  }
  function renameLevel(rubric, k, newName) {
    _tidy(
      rubric,
      columns(rubric).map(function (c) {
        return c.k === Number(k) ? Object.assign({}, c, { name: String(newName || '').trim() }) : c;
      }),
    );
  }
  /* Counts As for column k: a step between its neighbours', so a higher
     column always counts for more. */
  function setLevelCounts(rubric, k, level, mod) {
    _tidy(
      rubric,
      columns(rubric).map(function (c) {
        return c.k === Number(k) ? Object.assign({}, c, { level: Number(level), mod: Number(mod) || 0 }) : c;
      }),
    );
  }
  /* The steps column k may count as: above the column below it, below the
     column above it. [{ level, mod, text }] */
  function stepsFor(rubric, k) {
    var s = columns(rubric);
    var at = s.findIndex(function (c) {
      return c.k === Number(k);
    });
    var lo = at > 0 ? stepIndex(s[at - 1].level, s[at - 1].mod) : -1;
    var hi = at >= 0 && at < s.length - 1 ? stepIndex(s[at + 1].level, s[at + 1].mod) : STEPS.length;
    return STEPS.slice(lo + 1, hi).map(function (st) {
      return { level: st.level, mod: st.mod, text: stepText(st.level, st.mod) };
    });
  }

  /* The BC courses whose classes are offered the English 12 scoring guides:
     every English Language Arts and Social Studies course in the curriculum
     bank, grades 8 to 12 (Humanities 8 is ELA 8 + SS 8). Columns of one's
     own are offered everywhere. */
  var COURSE_TAGS = [
    'ELA8',
    'ELA9',
    'COMP10',
    'CW10',
    'EFPLS10',
    'EFPNM10',
    'EFPSL10',
    'EFPW10',
    'LS10',
    'NM10',
    'SL10',
    'COMP11',
    'CW11',
    'EFPLSNM11',
    'EFPLSSL11',
    'EFPLSW11',
    'LS11',
    'NMED11',
    'SPKN11',
    'COMP12',
    'CW12',
    'EFP12',
    'ES12',
    'LS12',
    'NMED12',
    'SPKN12',
    'SS8',
    'SS9',
    'SS10',
    'ESS11',
    'FHC11',
    'ASIA12',
    'BCFP12',
    'CC12',
    'CIS12',
    'ECON12',
    'GEN12',
    'HGEO12',
    'HIST12',
    'LAW12',
    'PGEO12',
    'PHIL12',
    'POL12',
    'REL12',
    'SJ12',
    'URB12',
  ];
  function courseOffersGuides(course) {
    var tags = (course && (course.curriculumTags || course.curriculum_tags)) || [];
    return tags.some(function (t) {
      return COURSE_TAGS.indexOf(String(t).toUpperCase()) >= 0;
    });
  }

  var TEMPLATES = [
    {
      key: 'stand_alone',
      name: 'English 12: Stand-Alone Text',
      help: 'A response to one passage. First draft, scored holistically.',
      criterion: 'Response to the Text',
      levels: {
        6: [
          'Depth of discussion, an effective argument or real insight; an effective style and sophisticated language. Need not be error-free.',
          [
            'Depth of discussion or insight',
            'Effective, convincing argument',
            'Effective writing style',
            'Sophisticated use of language',
          ],
        ],
        5: [
          'A strong grasp of the topic and the text; explicit or implicit references convincingly support a thesis. Well organized, with a strong command of conventions; errors do not distract.',
          [
            'Strong grasp of the topic and the text',
            'References convincingly support a thesis',
            'Well organized',
            'Strong command of conventions',
          ],
        ],
        4: [
          'Assertions tend to be simplistic, with no significant errors in understanding. References are present and appropriate, perhaps to only part of the text. Organized and straightforward; some errors.',
          [
            'No significant errors in understanding',
            'Appropriate references to the text',
            'Organized and straightforward',
            'Conventions usually followed',
          ],
        ],
        3: [
          'Understanding of the topic or text may be partly flawed. Support may be long quotation not tied to a central idea, or thin or repetitive. Some sense of purpose; errors may distract.',
          ['Addresses the topic and the text', 'Some support from the text', 'Some sense of purpose'],
        ],
        2: [
          'Attempts the topic, but understanding of the text or task may be seriously flawed. Errors recur, distract and often impede meaning.',
          ['Attempts to address the topic'],
        ],
        1: [
          'Attempts the question but is too brief, or shows a complete lack of control in the writing.',
          ['Attempts to answer the question'],
        ],
      },
    },
    {
      key: 'synthesis',
      name: 'English 12: Synthesis of Two Texts',
      help: 'An essay that synthesizes two texts. First draft, scored holistically.',
      criterion: 'Synthesis of the Texts',
      levels: {
        6: [
          'An insightful understanding of the texts and a sophisticated approach to synthesis, with pertinent references. An effective style and skillful control of language. Need not be error-free.',
          [
            'Insightful understanding of both texts',
            'Sophisticated synthesis',
            'Pertinent references',
            'Effective style and skillful control of language',
          ],
        ],
        5: [
          'A clear, interpretive understanding of the texts; clearly synthesizes their ideas. Explicit or implicit references convincingly support the analysis. Well organized, with a strong command of conventions.',
          [
            'Clear, interpretive understanding',
            'Clearly synthesizes the texts',
            'References convincingly support the analysis',
            'Well organized, strong conventions',
          ],
        ],
        4: [
          'Understanding tends to be literal and superficial; some synthesis is apparent, and the essay may lean on paraphrase. References are appropriate but may be limited. Organized and straightforward; some errors.',
          [
            'Some synthesis is apparent',
            'Appropriate references to both texts',
            'Organized and straightforward',
            'Conventions usually followed',
          ],
        ],
        3: [
          'Understanding of the texts may be partly flawed; an attempt at synthesis is evident. References are not clearly tied to a central idea or are repetitive; somewhat underdeveloped.',
          ['An attempt at synthesis', 'Refers to both texts', 'Some sense of purpose'],
        ],
        2: [
          'Understanding of the texts or task may be seriously flawed, or one text is referred to only fleetingly. Seriously underdeveloped; errors recur and impede meaning.',
          ['Attempts to address the topic', 'Mentions both texts'],
        ],
        1: [
          'Mentions both texts but is too brief to address the topic, or lacks control of the writing. (A response that uses only one text is not synthesis.)',
          ['Mentions both texts'],
        ],
      },
    },
    {
      key: 'composition',
      name: 'English 12: Composition',
      help: 'Any method of development: exposition, persuasion, description or narration. First draft, scored holistically.',
      criterion: 'Composition',
      levels: {
        6: [
          'Maturity of style, depth of discussion, an effective argument, literary or rhetorical devices, wit or imagination. An effective style and sophisticated language. Need not be error-free.',
          [
            'Maturity of style or depth of discussion',
            'Effective use of devices, wit or imagination',
            'Effective writing style',
            'Sophisticated use of language',
          ],
        ],
        5: [
          'Manipulates language for a desired effect, with a clear sense of voice and audience. Thoughtful and interesting; varied vocabulary and sentences serve the purpose. Errors do not distract.',
          [
            'Manipulates language for effect',
            'Clear sense of voice and audience',
            'Thoughtful and interesting',
            'Varied vocabulary and sentence structure',
          ],
        ],
        4: [
          'Conveys the ideas, but without flair or strong control. Diction and syntax are usually appropriate but lack variety; structure is predictable. A clear sense of purpose; some errors.',
          [
            'Conveys the writer’s ideas',
            'Appropriate diction and syntax',
            'Clear sense of purpose',
            'Conventions usually followed',
          ],
        ],
        3: [
          'Ideas may be underdeveloped or simplistic; transitions weak or absent; support often listed details. Little variety in diction and sentences. Some sense of purpose; errors may distract.',
          ['Ideas are present, if simple', 'Some support for the ideas', 'Some sense of purpose'],
        ],
        2: [
          'Ideas are seriously underdeveloped and awkwardly expressed; may be overly colloquial or weak in conventions. Meaning is apparent, but errors are frequent and basic.',
          ['Meaning is apparent'],
        ],
        1: [
          'Compromised by weak composition, content, diction, syntax, structure, voice or conventions.',
          ['Attempts the topic'],
        ],
      },
    },
  ];

  function templates() {
    return TEMPLATES.map(function (t) {
      return { key: t.key, name: t.name, help: t.help };
    });
  }

  /* A scoring guide as an unsaved Advanced rubric with the six-point
     columns. `newId` makes the client ids. */
  function fromTemplate(key, newId) {
    var t = TEMPLATES.filter(function (x) {
      return x.key === key;
    })[0];
    var make =
      typeof newId === 'function'
        ? newId
        : function () {
            return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          };
    var levels = {};
    var checks = [];
    [6, 5, 4, 3, 2, 1].forEach(function (k) {
      var entry = t ? t.levels[k] : null;
      levels[k] = entry ? entry[0] : '';
      (entry ? entry[1] : []).forEach(function (text, i) {
        checks.push({ id: make(), level: k, label: text, displayOrder: i });
      });
    });
    return {
      id: make(),
      name: t ? t.name : 'New Six-Point Rubric',
      style: 'advanced',
      scale: BC_SIX.map(function (c) {
        return Object.assign({}, c);
      }),
      tagIds: [],
      criteria: [
        { id: make(), name: t ? t.criterion : 'Overall', tagIds: [], levels: levels, weight: 1, checks: checks },
      ],
    };
  }

  return {
    MAX: MAX,
    MIN: MIN,
    BC_SIX: BC_SIX,
    COURSE_TAGS: COURSE_TAGS,
    has: has,
    columns: columns,
    keys: keys,
    isKey: isKey,
    name: name,
    label: label,
    tone: tone,
    toStored: toStored,
    countsAs: countsAs,
    stepText: stepText,
    fromStored: fromStored,
    fromValue: fromValue,
    insertLevel: insertLevel,
    removeLevel: removeLevel,
    renameLevel: renameLevel,
    setLevelCounts: setLevelCounts,
    stepsFor: stepsFor,
    courseOffersGuides: courseOffersGuides,
    templates: templates,
    fromTemplate: fromTemplate,
  };
})();
