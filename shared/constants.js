/* gb-constants.js — Shared constants for FullVision */

/**
 * @typedef {Object} Course
 * @property {string} id - Course identifier (e.g. 'sci8')
 * @property {string} name - Display name (e.g. 'Science 8')
 * @property {'proficiency'|'letter'|'both'} gradingSystem - Grading mode (T-UI-02; 'points' retired 2026-04-21)
 * @property {'mostRecent'|'highest'|'mode'|'decayingAvg'} calcMethod - Proficiency calculation method
 * @property {number} decayWeight - Weight for decaying average (0-1)
 * @property {string[]} curriculumTags - Linked curriculum codes (e.g. ['SCI8'])
 */

/**
 * @typedef {Object} LearningTag
 * @property {string} id - Tag identifier (e.g. 'QAP')
 * @property {string} label - Short display label
 * @property {string} text - Description text
 * @property {string[]} [i_can_statements] - Student-facing learning targets
 * @property {string} [color] - Hex color code (promoted from section in flat format)
 * @property {string} [subject] - Parent subject code (promoted from section in flat format)
 * @property {string} [shortName] - Abbreviated name (promoted from section in flat format)
 * @property {string} [name] - Full display name (promoted from section in flat format)
 * @property {string} [_legacySectionId] - Old section ID for migration tracing
 */

/**
 * @typedef {Object} LearningSection
 * @property {string} id - In flat format, equals the tag ID
 * @property {string} subject - Parent subject code
 * @property {string} name - Full display name
 * @property {string} shortName - Abbreviated name
 * @property {string} color - Hex color code
 * @property {LearningTag[]} tags - Single tag in flat format
 */

/* ── Student Display Helpers ───────────────────────────────── */
const PRONOUNS_OPTIONS = ['he/him', 'she/her', 'they/them', 'prefer not to say'];

/* ── Courses ────────────────────────────────────────────────── */
const DEFAULT_COURSES = {
  sci8: {
    id: 'sci8',
    name: 'Science 8',
    block: 'A',
    // Demo Mode's class: Proficiency, Mean, Emerging First (Colin, 2026-10-26).
    gradingSystem: 'proficiency',
    calcMethod: 'average',
    decayWeight: 0.65,
    levelOrder: 'asc',
    curriculumTags: ['SCI8'],
  },
};

/* ── Learning Map: Learning Standards (flat format) ─────────── */
const LEARNING_MAP = {
  sci8: {
    _flatVersion: 2,
    subjects: [{ id: 'SCI8', name: 'Science 8', color: '#0891b2' }],
    sections: [
      {
        id: 'QAP',
        subject: 'SCI8',
        name: 'Questioning and Predicting',
        shortName: 'Questioning',
        color: '#0891b2',
        tags: [
          {
            id: 'QAP',
            label: 'Question and Predict',
            text: '',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Questioning and Predicting',
            shortName: 'Questioning',
            i_can_statements: [
              'I can identify a scientific question that genuinely interests me and pursue it with curiosity.',
              'I can make careful observations of the natural world and generate questions based on what I notice.',
              'I can formulate a hypothesis and predict what I think will happen in an investigation.',
            ],
          },
        ],
      },
      {
        id: 'PI',
        subject: 'SCI8',
        name: 'Planning and Conducting',
        shortName: 'Planning',
        color: '#0891b2',
        tags: [
          {
            id: 'PI',
            label: 'Plan Investigations',
            text: '',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Planning and Conducting',
            shortName: 'Planning',
            i_can_statements: [
              'I can plan a fair test by identifying and controlling variables.',
              'I can choose the right tools and methods to collect accurate and reliable data.',
              'I can use appropriate SI units and convert between units when needed.',
              'I can follow safety and ethical guidelines during investigations.',
            ],
          },
        ],
      },
      {
        id: 'IP',
        subject: 'SCI8',
        name: 'Processing and Analyzing Data and Information',
        shortName: 'Processing',
        color: '#0891b2',
        tags: [
          {
            id: 'IP',
            label: 'Identify Patterns',
            text: '',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Processing and Analyzing Data and Information',
            shortName: 'Processing',
            i_can_statements: [
              'I can organize data into tables and graphs to reveal patterns.',
              'I can analyze my data to identify trends, patterns, and relationships.',
              'I can apply First Peoples knowledge and perspectives as valid sources of scientific understanding.',
              'I can use scientific understanding to draw conclusions supported by evidence.',
            ],
          },
        ],
      },
      {
        id: 'EM',
        subject: 'SCI8',
        name: 'Evaluating',
        shortName: 'Evaluating',
        color: '#0891b2',
        tags: [
          {
            id: 'EM',
            label: 'Evaluate Methods',
            text: '',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Evaluating',
            shortName: 'Evaluating',
            i_can_statements: [
              'I can identify sources of error in my investigation and suggest specific improvements.',
              'I can evaluate the quality of my data and explain how it could be made more reliable.',
              'I can consider the social, ethical, and environmental implications of a scientific issue.',
              'I can exercise informed skepticism \u2014 questioning claims and demanding evidence.',
            ],
          },
        ],
      },
      {
        id: 'CA',
        subject: 'SCI8',
        name: 'Applying and Innovating',
        shortName: 'Applying',
        color: '#0891b2',
        tags: [
          {
            id: 'CA',
            label: 'Community Applications',
            text: '',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Applying and Innovating',
            shortName: 'Applying',
            i_can_statements: [
              "I can apply what I've learned in science to a new situation or problem.",
              'I can design a project or solution that addresses a real need in my community or the world.',
              'I can generate and refine creative ideas when problem-solving.',
            ],
          },
        ],
      },
      {
        id: 'SC',
        subject: 'SCI8',
        name: 'Communicating',
        shortName: 'Communicating',
        color: '#0891b2',
        tags: [
          {
            id: 'SC',
            label: 'Scientific Communication',
            text: '',
            color: '#0891b2',
            subject: 'SCI8',
            name: 'Communicating',
            shortName: 'Communicating',
            i_can_statements: [
              'I can communicate my scientific findings clearly using appropriate scientific vocabulary.',
              'I can use digital tools to represent and share scientific information.',
              "I can express how my local environment and First Peoples perspectives relate to the science I'm learning.",
            ],
          },
        ],
      },
    ],
  },
};

/* ── BC Ministry of Education — Special Education Designations ── */
const BC_DESIGNATIONS = {
  A: {
    name: 'Physically Dependent',
    desc: 'Completely dependent on others for daily living needs (feeding, dressing, toileting, mobility)',
    level: 1,
    iep: true,
    modified: true,
  },
  B: {
    name: 'Deafblind',
    desc: 'Combined visual and auditory impairment causing significant communication and education difficulties',
    level: 1,
    iep: true,
    modified: true,
  },
  C: {
    name: 'Moderate–Profound Intellectual Disability',
    desc: 'IQ 3+ standard deviations below mean with similar adaptive functioning delays',
    level: 2,
    iep: true,
    modified: true,
  },
  D: {
    name: 'Physical Disability / Chronic Health',
    desc: 'Nervous system impairments, musculoskeletal conditions, or chronic health issues significantly impacting education',
    level: 2,
    iep: true,
    modified: false,
  },
  E: {
    name: 'Visual Impairment',
    desc: 'Vision insufficient for independent participation in daily activities',
    level: 2,
    iep: true,
    modified: false,
  },
  F: {
    name: 'Deaf or Hard of Hearing',
    desc: 'Medically diagnosed hearing loss creating substantial educational difficulty',
    level: 2,
    iep: true,
    modified: false,
  },
  G: {
    name: 'Autism Spectrum Disorder',
    desc: 'Neurodevelopmental disability affecting social relationships, communication, interests, and sensory responsiveness',
    level: 2,
    iep: true,
    modified: false,
  },
  H: {
    name: 'Intensive Behaviour / Serious Mental Illness',
    desc: 'Severe behavioural or mental health needs requiring intensive intervention',
    level: 3,
    iep: true,
    modified: false,
  },
  K: {
    name: 'Mild Intellectual Disability',
    desc: 'IQ 2+ standard deviations below mean (typically 55–69)',
    level: 0,
    iep: true,
    modified: true,
  },
  P: {
    name: 'Gifted',
    desc: 'Exceptionally high capability in intellect, creativity, or discipline-specific skills',
    level: 0,
    iep: true,
    modified: false,
  },
  Q: {
    name: 'Learning Disability',
    desc: 'Difficulties acquiring, organizing, or using verbal/nonverbal information despite average intellect',
    level: 0,
    iep: true,
    modified: false,
  },
  R: {
    name: 'Moderate Behaviour Support / Mental Illness',
    desc: 'Moderate-level behavioural disorders or mental illness affecting school functioning',
    level: 0,
    iep: true,
    modified: false,
  },
};

/* ── Support flags ──────────────────────────────────────────────
   Supports that aren't ministry special-ed designations. They're stored in
   the same enrollment.designations array (as 'ELL'), but kept out of
   BC_DESIGNATIONS so they never count toward IEP or Modified. */
const SUPPORT_FLAGS = {
  ELL: {
    name: 'English Language Learner',
    desc: 'Receives English language learning support',
    level: 0,
    iep: false,
    modified: false,
  },
};

// Lookup for any code in student.designations, designation or support flag.
function designationInfo(code) {
  return BC_DESIGNATIONS[code] || SUPPORT_FLAGS[code] || null;
}

const PROF_LABELS = { 0: 'No Evidence', 1: 'Emerging', 2: 'Developing', 3: 'Proficient', 4: 'Extending' };
// A level's short code, as the roster beside the names shows it. 0 is
// Incomplete: nothing scored yet.
const PROF_CODES = { 0: 'IC', 1: 'EMG', 2: 'DEV', 3: 'PRF', 4: 'EXT' };

/* Rubric Levels: the order a class draws the four levels, wherever it draws
   them (scoring cards, the rubric editor, printed rubrics, reports, the
   phone). 'desc' puts Extending first (left or top), the default; 'asc'
   puts Emerging first. Per class: course.level_order on the server,
   `levelOrder` in the class's course config here. Math in calc.js and the
   stored shape of a rubric never follow it; only what is drawn does.
   Keyboard shortcuts stay tied to the level: 1 is always Emerging and 4
   always Extending, wherever the button sits. */
const LEVEL_ORDER_DEFAULT = 'desc';
function levelOrder(course) {
  var v = course && (course.levelOrder || course.level_order);
  return v === 'asc' ? [1, 2, 3, 4] : [4, 3, 2, 1];
}
/* The order for a class by id: its course config, else the course row. */
function levelOrderFor(cid) {
  var cfg = cid && typeof getCourseConfig === 'function' ? getCourseConfig(cid) : null;
  if (cfg && (cfg.levelOrder === 'asc' || cfg.levelOrder === 'desc')) return levelOrder(cfg);
  var course = cid && typeof COURSES !== 'undefined' && COURSES ? COURSES[cid] : null;
  return levelOrder(course);
}

/* ── + and − on proficiency levels ───────────────────────────────────────
   A score entry keeps its whole-number level in `score` and its + or − in
   `mod` (1 or −1). A + or − is worth a third of a level (3+ = 3.33); 1− and
   4+ don't exist, so values stay within 1–4. */
const SCORE_MOD_STEP = 1 / 3;

// The modifier a level can actually carry: −1, 0 or 1, never on 0, 1− or 4+.
function normalizeScoreMod(level, mod) {
  var m = Number(mod) > 0 ? 1 : Number(mod) < 0 ? -1 : 0;
  var lv = Number(level);
  if (!m || !(lv >= 1 && lv <= 4)) return 0;
  if ((lv === 1 && m < 0) || (lv === 4 && m > 0)) return 0;
  return m;
}

// The value an entry counts as in averages. Entries from getTagScores already
// carry it in `score` (with the whole level in `level`).
function scoreModValue(entry) {
  if (!entry) return 0;
  if (entry.level != null) return Number(entry.score) || 0;
  var level = Number(entry.score) || 0;
  return level + normalizeScoreMod(level, entry.mod) * SCORE_MOD_STEP;
}

function scoreModSuffix(mod) {
  return mod > 0 ? '+' : mod < 0 ? '\u2212' : '';
}

// "3+", "2−", "4" — the level as teachers write it.
function formatScoreLevel(level, mod) {
  if (!(level > 0)) return '';
  return String(level) + scoreModSuffix(normalizeScoreMod(level, mod));
}

/* Complete/Incomplete assessments are scored like a 1-point assessment:
   Complete = 1 (100%), Incomplete = 0 (0%), unmarked = no score. Every
   calculation that handles points handles them through isPointsScored. */
const COMPLETE_MAX_POINTS = 1;

function isCompletionScored(assessment) {
  return !!assessment && (assessment.scoreMode || assessment.score_mode) === 'complete';
}

/* A DIBELS 8 benchmark: raw reading scores in three windows (dibels_score),
   kept for the reading record and counted toward no grade. */
function isDibelsScored(assessment) {
  return !!assessment && (assessment.scoreMode || assessment.score_mode) === 'dibels';
}

/* DIBELS 8th Edition Grade 8 benchmark goals (University of Oregon, goals
   updated July 2020, reformatted October 2025): the lowest score in each
   support level, per window. Above = Blue (core support, negligible risk),
   Core = Green (core support, minimal risk), Strategic = Yellow (some risk);
   anything lower is Intensive = Red (at risk). Maze is the adjusted score. */
var DIBELS_CUTS = {
  orf: {
    boy: { above: 142, core: 125, strategic: 110 },
    moy: { above: 156, core: 131, strategic: 116 },
    eoy: { above: 159, core: 135, strategic: 121 },
  },
  maze: {
    boy: { above: 24.5, core: 20, strategic: 16.5 },
    moy: { above: 32, core: 26, strategic: 19.5 },
    eoy: { above: 38, core: 28, strategic: 24.5 },
  },
};
var DIBELS_PERIOD_NAMES = { boy: 'Beginning of Year', moy: 'Middle of Year', eoy: 'End of Year' };
var DIBELS_LEVELS = {
  above: { label: 'Above', tone: 'l4' },
  core: { label: 'Core', tone: 'l3' },
  strategic: { label: 'Strategic', tone: 'l2' },
  intensive: { label: 'Intensive', tone: 'l1' },
};

/* Words read correctly as a percent of words attempted, to one decimal. */
function dibelsAccuracy(wordsCorrect, errors) {
  if (wordsCorrect == null || errors == null) return null;
  var total = Number(wordsCorrect) + Number(errors);
  return total > 0 ? Math.round((Number(wordsCorrect) / total) * 1000) / 10 : null;
}
/* The Maze score the goals use: correct − incorrect ÷ 2, never below 0. */
function dibelsMazeAdjusted(correct, incorrect) {
  if (correct == null) return null;
  return Math.max(0, Number(correct) - Number(incorrect || 0) / 2);
}
/* The support level for an ORF words-correct or adjusted Maze score in a
   window: 'above' | 'core' | 'strategic' | 'intensive', or null. */
function dibelsLevel(measure, period, value) {
  var cut = DIBELS_CUTS[measure] && DIBELS_CUTS[measure][period];
  if (!cut || value == null || !isFinite(Number(value))) return null;
  var v = Number(value);
  if (v >= cut.above) return 'above';
  if (v >= cut.core) return 'core';
  if (v >= cut.strategic) return 'strategic';
  return 'intensive';
}
/* The window a date falls in: Aug–Nov Beginning, Dec–Mar Middle, Apr–Jul End. */
function dibelsPeriodFor(isoDate) {
  var m = Number(String(isoDate || '').slice(5, 7));
  if (m >= 8 && m <= 11) return 'boy';
  if (m === 12 || m <= 3) return 'moy';
  return 'eoy';
}

function isPointsScored(assessment) {
  var mode = assessment && (assessment.scoreMode || assessment.score_mode);
  return mode === 'points' || mode === 'complete';
}

// Whether an entry counts as graded. On points and Complete/Incomplete work
// a 0 is a score (Incomplete is stored as 0); on proficiency work 0 means no
// score.
function isScoreEntered(assessment, entry) {
  if (!entry) return false;
  if (isPointsScored(assessment)) return entry.score != null && entry.score !== '' && isFinite(Number(entry.score));
  return Number(entry.score) > 0;
}

/* An assessment linked to no competency keeps its score under this key in
   place of a competency id (the server stores it as the assessment's single
   score). It counts toward the assessment and the course grade, never toward
   a competency. Scores hydrated before this key existed used ''. */
const UNLINKED_TAG_ID = 'overall';

function isUnlinkedTag(tagId) {
  return tagId === UNLINKED_TAG_ID || tagId === '';
}

/* A rubric criterion's score is kept under the criterion's own id, whatever
   competencies it feeds, so two criteria on one competency each keep their
   own level. The score rolls up to each of the criterion's competencies in
   getTagScores (docs/DECISIONS.md, "Rubric criteria score on their own"). */
function rubricCriterionScoreKeys(criterion) {
  return criterion && criterion.id ? [criterion.id] : [];
}

/* The keys an assessment's scores are stored under: its competencies, plus
   the id of each rubric criterion that has none, or the one unlinked key
   when there are neither. Rubric criteria are only found when `cid` is
   given. An assessment graded by criterion ids never uses the unlinked key
   as well, so one score is never counted twice. */
function scoreTagIds(assessment, cid) {
  var ids = (assessment && (assessment.tagIds || assessment.tag_ids)) || [];
  // A competency removed from the class keeps its link to the assessment
  // (so Re-link can put it back) but is no longer scored or counted
  // (Colin, 2026-10-22). Only the class's own competencies are listed.
  // Points work keeps its one score under its first competency, and a
  // rubric scores through its criteria, so both keep the full list.
  var rubricLinked = !!(assessment && (assessment.rubricId || assessment.rubric_id));
  if (
    cid &&
    ids.length &&
    !isPointsScored(assessment) &&
    !rubricLinked &&
    typeof getSectionForTag === 'function' &&
    typeof getAllTags === 'function'
  ) {
    if (getAllTags(cid).length > 0) {
      ids = ids.filter(function (id) {
        return !!getSectionForTag(cid, id);
      });
    }
  }
  var rubricId = assessment && (assessment.rubricId || assessment.rubric_id);
  var rubric = null;
  if (cid && rubricId && !isPointsScored(assessment) && typeof getRubricById === 'function') {
    rubric = getRubricById(cid, rubricId);
  }
  if (rubric) {
    // Rubric work is scored by criterion: its keys are the criterion ids.
    var criterionIds = (rubric.criteria || [])
      .filter(function (c) {
        return c && c.id;
      })
      .map(function (c) {
        return c.id;
      });
    if (criterionIds.length) ids = criterionIds;
  }
  return ids.length ? ids : [UNLINKED_TAG_ID];
}

/* A rubric assessment's criteria as gradebook columns, one per criterion:
   { criterion, keys } where keys are the score keys the criterion stores
   under (its competencies, or its own id when it has none). The first key
   is the one a cell shows. Empty for a points assessment or one with no
   rubric, so the caller falls back to one column per competency. */
function rubricCriterionColumns(assessment, cid) {
  var rubricId = assessment && (assessment.rubricId || assessment.rubric_id);
  if (!cid || !rubricId || isPointsScored(assessment) || typeof getRubricById !== 'function') return [];
  var rubric = getRubricById(cid, rubricId);
  var criteria = (rubric && rubric.criteria) || [];
  var out = [];
  criteria.forEach(function (criterion) {
    if (!criterion || !criterion.id) return;
    var keys = rubricCriterionScoreKeys(criterion);
    if (!keys.length) return;
    out.push({ criterion: criterion, keys: keys });
  });
  return out;
}

/* Extra credit: a points score can go up to twice the maximum (12/10), as
   Schoology allows. The course % can then pass 100. */
const POINTS_EXTRA_CREDIT_FACTOR = 2;

/* Points scores take decimals (33.5 / 40). A typed value is kept to two
   decimal places and held between 0 and twice the assessment's maximum. A
   typed 0 is a score of 0; blank or unreadable input is null, no score. A
   comma works as the decimal point too. */
function parsePointsInput(text, max) {
  var str = String(text == null ? '' : text).trim();
  if (str === '') return null;
  var n = parseFloat(str.replace(',', '.'));
  if (!isFinite(n)) return null;
  n = Math.max(0, n);
  if (max > 0) n = Math.min(max * POINTS_EXTRA_CREDIT_FACTOR, n);
  return Math.round(n * 100) / 100;
}

/* The % beside a points input, marked "bonus" above the maximum. `digits`
   is the decimal places (0 rounds to a whole %). Returns HTML; empty when
   there is no score. */
function pointsPctHtml(v, max, digits) {
  if (v == null || !(max > 0)) return '';
  var pct = (v / max) * 100;
  var html = (digits ? pct.toFixed(digits) : String(Math.round(pct))) + '%';
  return v > max ? html + '<span class="gb-pts-bonus">bonus</span>' : html;
}

/* A points score as people write it: 33.5, 8, 12.25 — never 33.50 or 8.00. */
function formatPoints(n) {
  var v = Number(n);
  if (!isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

/* Category pill tint — soft pastel chip palette assigned by index.
   Categories rotate through CATEGORY_PALETTE in the order they were created
   (1st category → palette[0], 2nd → palette[1], …, 11th → palette[0] again).
   Same category id → same color forever. Teachers don't pick colors — the
   palette is fixed.

   Used by Gradebook (`.gb-assess-type-pill`), Assignments (`.type-badge`),
   and Reports questionnaire (`.tq-assignment-type`).

   Caller passes the category's index in its course's category list (or -1
   for "No Category"). Returns { bg, fg } for inline style.

   Helper categoryTintByIndex(idx, name?) is the canonical entry point.
   Name fallback (hash → index) is used when the caller has only a label,
   not its position — keeps the API forgiving. */
const CATEGORY_PALETTE = [
  { bg: 'hsl(220, 75%, 95%)', fg: 'hsl(220, 55%, 32%)' }, // blue
  { bg: 'hsl(160, 60%, 93%)', fg: 'hsl(160, 50%, 26%)' }, // green
  { bg: 'hsl(280, 70%, 95%)', fg: 'hsl(280, 45%, 36%)' }, // purple
  { bg: 'hsl( 25, 80%, 94%)', fg: 'hsl( 25, 65%, 35%)' }, // orange
  { bg: 'hsl(335, 75%, 95%)', fg: 'hsl(335, 50%, 38%)' }, // pink
  { bg: 'hsl(195, 70%, 93%)', fg: 'hsl(195, 55%, 28%)' }, // cyan
  { bg: 'hsl( 50, 75%, 92%)', fg: 'hsl( 45, 55%, 30%)' }, // gold
  { bg: 'hsl(245, 70%, 95%)', fg: 'hsl(245, 50%, 40%)' }, // indigo
  { bg: 'hsl(  5, 75%, 95%)', fg: 'hsl(  5, 55%, 38%)' }, // red
  { bg: 'hsl(115, 55%, 92%)', fg: 'hsl(115, 45%, 26%)' }, // lime
];
const _CATEGORY_TINT_NEUTRAL = { bg: 'var(--surface-2)', fg: 'var(--text-2)' };

function categoryTintByIndex(idx, fallbackName) {
  if (typeof idx === 'number' && idx >= 0) {
    return CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length];
  }
  // Fallback: caller passed only a label (no known position). Hash the
  // string to a palette slot so the same label always lands on the same
  // color, even if no course context is available.
  var label = (fallbackName || '').trim();
  if (!label || /^no category$/i.test(label)) return _CATEGORY_TINT_NEUTRAL;
  var h = 0;
  for (var i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return CATEGORY_PALETTE[((h % CATEGORY_PALETTE.length) + CATEGORY_PALETTE.length) % CATEGORY_PALETTE.length];
}
if (typeof window !== 'undefined') {
  window.CATEGORY_PALETTE = CATEGORY_PALETTE;
  window.categoryTintByIndex = categoryTintByIndex;
}
const PROF_COLORS = { 0: '#bbb', 1: 'var(--score-1)', 2: 'var(--score-2)', 3: 'var(--score-3)', 4: 'var(--score-4)' };

// A section, subject or competency colour used as text: the same hue mixed
// with the text colour, so small labels stay readable in light and dark mode.
function tintText(color) {
  return 'color-mix(in srgb, ' + color + ' 65%, var(--text))';
}
const PROF_TINT = {
  0: 'rgba(187,187,187,0.12)',
  1: 'rgba(211,47,47,0.10)',
  2: 'rgba(192,122,0,0.10)',
  3: 'rgba(46,125,50,0.10)',
  4: 'rgba(21,101,192,0.12)',
};
const CORE_COMPETENCIES = [
  { id: 'COM', label: 'Communicating', group: 'Communication', color: '#e67700' },
  { id: 'COL', label: 'Collaborating', group: 'Communication', color: '#e67700' },
  { id: 'CT', label: 'Creative Thinking', group: 'Thinking', color: 'var(--score-4)' },
  { id: 'CRT', label: 'Critical & Reflective Thinking', group: 'Thinking', color: 'var(--score-4)' },
  { id: 'PPI', label: 'Personal & Cultural Identity', group: 'Personal & Social', color: 'var(--score-3)' },
  { id: 'PAR', label: 'Personal Awareness & Responsibility', group: 'Personal & Social', color: 'var(--score-3)' },
  { id: 'SAR', label: 'Social Awareness & Responsibility', group: 'Personal & Social', color: 'var(--score-3)' },
];
function getCoreCompetency(id) {
  return CORE_COMPETENCIES.find(c => c.id === id);
}

/* ── Traditional Gradebook — grading scale, points, weights ── */
/* boundaries: the percent a points score needs for each proficiency.
   percents: the percent each proficiency counts as in the course % (Counts
   As). The default is level ÷ 4, so 3 is 75% (docs/DECISIONS.md,
   "Proficiency percents"). */
const DEFAULT_GRADING_SCALE = {
  boundaries: [
    { min: 86, proficiency: 4 },
    { min: 73, proficiency: 3 },
    { min: 50, proficiency: 2 },
    { min: 0, proficiency: 1 },
  ],
  percents: { 4: 100, 3: 75, 2: 50, 1: 25 },
  labels: null,
};

/* The steps a level can be scored at (no 1− or 4+, DECISIONS D8), lowest
   first, and where each sits on the 0–4 scale: a + or − is a third of a
   level, so 3+ is 3.33. Counts As can give each its own percent
   (grading_scale.percents, keyed as here); a step left out sits a third of
   the way between its whole levels. */
const COUNTS_AS_STEPS = [
  { key: '1', at: 1 },
  { key: '1+', at: 4 / 3 },
  { key: '2-', at: 5 / 3 },
  { key: '2', at: 2 },
  { key: '2+', at: 7 / 3 },
  { key: '3-', at: 8 / 3 },
  { key: '3', at: 3 },
  { key: '3+', at: 10 / 3 },
  { key: '4-', at: 11 / 3 },
  { key: '4', at: 4 },
];

/* Counts As preset: each step on a BC letter band (A 86, B 73, C+ 67, C 60,
   C- 50). Extending is an A, Proficient a B that reaches A with a +,
   Developing a passing C range, and only plain Emerging fails (Colin,
   2026-10-29: 3+ is 86, Emerging 45). */
const BC_LETTER_BAND_PERCENTS = {
  4: 100,
  '4-': 92,
  '3+': 86,
  3: 80,
  '3-': 73,
  '2+': 67,
  2: 63,
  '2-': 55,
  '1+': 50,
  1: 45,
};

const SUBJECT_COLOURS = {
  'Applied Design, Skills and Technologies': '#6366f1',
  'Arts Education': '#db2777',
  'Career Education': '#d97706',
  'English Language Arts': '#2563eb',
  Mathematics: '#7c3aed',
  'Physical and Health Education': '#059669',
  Science: '#0891b2',
  'Social Studies': '#dc2626',
};

// Stable avatar colors — hash student ID to a color. Each passes 4.5:1 with
// the white initials drawn on it.
const _AVATAR_COLORS = [
  '#2e7d32',
  '#1565c0',
  '#7b1fa2',
  '#c62828',
  '#c54600',
  '#283593',
  '#00695c',
  '#ad1457',
  '#4e342e',
  '#00838f',
  '#4a7c2a',
  '#6a1b9a',
  '#bf360c',
  '#1a237e',
  '#004d40',
];

const CONFIDENCE_LABELS = { 1: 'Beginning', 2: 'Growing', 3: 'Confident', 4: 'Leading' };
const CONFIDENCE_COLORS = { 1: 'var(--score-1)', 2: 'var(--score-2)', 3: 'var(--score-3)', 4: 'var(--score-4)' };

/* ── Learner Profile: Observation dimensions & constants ──── */
/* Two groups: Learning Dispositions (how they learn) + Relational & Identity (who they are) */
const LEARNING_DIMS = ['engagement', 'curiosity', 'selfRegulation', 'resilience'];
const RELATIONAL_DIMS = ['belonging', 'identity', 'collaboration', 'respect', 'responsibility'];
const OBS_DIMS = LEARNING_DIMS.concat(RELATIONAL_DIMS);
const OBS_LABELS = {
  engagement: 'Engagement',
  curiosity: 'Curiosity & Exploration',
  selfRegulation: 'Self-Regulation & Reflection',
  resilience: 'Resilience',
  belonging: 'Belonging & Connection',
  identity: 'Identity & Self-Knowledge',
  collaboration: 'Collaboration',
  respect: 'Respect',
  responsibility: 'Responsibility & Reciprocity',
};
const OBS_SHORT = {
  engagement: 'Eng',
  curiosity: 'Curious',
  selfRegulation: 'Self-Reg',
  resilience: 'Resil',
  belonging: 'Belong',
  identity: 'Identity',
  collaboration: 'Collab',
  respect: 'Respect',
  responsibility: 'Respons.',
};
/* How often a student shows a disposition: one scale, used by the Term
   Questionnaire's pills and the printed report. Developing means proficiency
   only (DECISIONS "Report forms" 12). */
const OBS_LEVEL_LABELS = { 0: 'Not Rated', 1: 'Rarely', 2: 'Sometimes', 3: 'Usually', 4: 'Consistently' };
const OBS_LEVEL_COLORS = {
  0: 'var(--text-3)',
  1: 'var(--score-1)',
  2: 'var(--score-2)',
  3: 'var(--score-3)',
  4: 'var(--score-4)',
};

const OBS_SENTIMENTS = {
  strength: { label: 'Strength', color: 'var(--score-3)', tint: 'rgba(46,125,50,0.08)', border: '#2e7d32' },
  growth: { label: 'Growth', color: 'var(--active)', tint: 'rgba(0,122,255,0.08)', border: '#007AFF' },
  concern: { label: 'Concern', color: 'var(--score-2)', tint: 'rgba(192,122,0,0.08)', border: '#c07a00' },
  // A neutral note: never counted as a strength. Yellow, with dark text on
  // the solid block (white on yellow fails contrast).
  note: { label: 'Note', color: 'var(--obs-note)', tint: 'rgba(242,194,0,0.14)', border: '#f2c200' },
};

const OBS_CONTEXTS = {
  'whole-class': { label: 'Whole class' },
  'small-group': { label: 'Small group' },
  independent: { label: 'Independent' },
  presentation: { label: 'Presentation' },
  discussion: { label: 'Discussion' },
};

/* The six sentence starters offered to a class that has none, and Demo
   Mode's Science 8 bank. They reach a teacher's class only when the teacher
   presses "Add these to this class" (docs/DECISIONS.md, "Observations
   (2026-10-18)"). Copy before changing. */
const OBS_STARTER_SUGGESTIONS = [
  { text: 'Strong collaboration with peers', sentiment: 'strength', context: null, dims: ['collaboration'] },
  { text: 'Asked a great question in class', sentiment: 'strength', context: null, dims: ['curiosity'] },
  {
    text: 'Focused and on-task during independent work',
    sentiment: 'strength',
    context: null,
    dims: ['selfRegulation'],
  },
  { text: 'Needed additional support to stay on task', sentiment: 'growth', context: null, dims: ['selfRegulation'] },
  { text: 'Showed resilience working through a challenge', sentiment: 'strength', context: null, dims: ['resilience'] },
  { text: 'Demonstrated respect for diverse perspectives', sentiment: 'strength', context: null, dims: ['respect'] },
];

/* Observation UI shows type, context and tags as text pills, with no emoji
   (docs/DECISIONS.md, "Observations (2026-10-18)"). Tag pills keep a colour
   dot: one colour per disposition, one for Core Competencies, one for custom
   tags. */
const OBS_TAG_COLORS = {
  engagement: '#3b82f6',
  curiosity: '#9333ea',
  selfRegulation: '#f59e0b',
  resilience: '#ef4444',
  belonging: '#0ea5e9',
  identity: '#d946ef',
  collaboration: '#22c55e',
  respect: '#059669',
  responsibility: '#84cc16',
};
const OBS_CC_COLOR = '#e67700';
const OBS_CUSTOM_COLOR = '#8b5cf6';
function obsTagColor(key) {
  var k = String(key || '');
  if (k.indexOf('cc:') === 0) return OBS_CC_COLOR;
  if (k.indexOf('tag:') === 0) return OBS_CUSTOM_COLOR;
  return OBS_TAG_COLORS[k] || '#999';
}

/* ── Card Widget Registry ─────────────────────────────────── */
const WIDGET_REGISTRY = [
  { key: 'hero', label: 'Name & Proficiency', defaultOn: true },
  { key: 'sectionBars', label: 'Section Progress', defaultOn: true },
  { key: 'completion', label: 'Completion', defaultOn: true },
  { key: 'missingWork', label: 'Missing Work', defaultOn: false },
  { key: 'growth', label: 'Growth Journey', defaultOn: true },
  { key: 'obsSnippet', label: 'Latest Observation', defaultOn: true },
  { key: 'obsSummary', label: 'Observation Insights', defaultOn: false },
  { key: 'flagStatus', label: 'Flag', defaultOn: false },
  { key: 'reflection', label: 'Student Voice', defaultOn: false },
  { key: 'dispositions', label: 'Learner Dispositions', defaultOn: true },
  { key: 'traits', label: 'Character Strengths', defaultOn: false },
  { key: 'concerns', label: 'Concerns', defaultOn: false },
  { key: 'workHabits', label: 'Work Habits & Participation', defaultOn: false },
  { key: 'growthAreas', label: 'Growth Areas', defaultOn: false },
  { key: 'narrative', label: 'Teacher Narrative', defaultOn: false },
  { key: 'actions', label: 'Action Buttons', defaultOn: true },
];
const WIDGET_KEYS = WIDGET_REGISTRY.map(function (w) {
  return w.key;
});

/* ── Social / Character Traits ────────────────────────────── */
const SOCIAL_TRAITS_POSITIVE = [
  { id: 'leader', label: 'Leader' },
  { id: 'collaborative', label: 'Collaborative' },
  { id: 'independent', label: 'Independent' },
  { id: 'peer-mentor', label: 'Peer Mentor' },
  { id: 'risk-taker', label: 'Risk Taker' },
  { id: 'reflective', label: 'Reflective' },
  { id: 'creative', label: 'Creative Thinker' },
  { id: 'persistent', label: 'Persistent' },
  { id: 'organized', label: 'Organized' },
  { id: 'empathetic', label: 'Empathetic' },
  { id: 'curious', label: 'Curious' },
  { id: 'respectful', label: 'Respectful' },
  { id: 'positive-attitude', label: 'Positive Attitude' },
  { id: 'detail-oriented', label: 'Detail-Oriented' },
  { id: 'advocate', label: 'Self-Advocate' },
];
const SOCIAL_TRAITS_CONCERN = [
  { id: 'needs-support', label: 'Needs Support' },
  { id: 'often-late', label: 'Often Late' },
  { id: 'device-issue', label: 'Device Issue' },
  { id: 'reminders-focus', label: 'Reminders to Focus' },
  { id: 'often-absent', label: 'Often Absent' },
  { id: 'incomplete-work', label: 'Incomplete Work' },
  { id: 'disorganized', label: 'Disorganized' },
  { id: 'off-task', label: 'Off-Task Behaviour' },
  { id: 'social-conflicts', label: 'Social Conflicts' },
  { id: 'low-confidence', label: 'Low Confidence' },
  { id: 'avoids-challenges', label: 'Avoids Challenges' },
  { id: 'rushed-work', label: 'Rushes Work' },
];
const SOCIAL_TRAITS_POSITIVE_IDS = new Set(
  SOCIAL_TRAITS_POSITIVE.map(function (t) {
    return t.id;
  }),
);
const SOCIAL_TRAITS_CONCERN_IDS = new Set(
  SOCIAL_TRAITS_CONCERN.map(function (t) {
    return t.id;
  }),
);

/* ── Shared HTML: Unified Toolbar ──────────────────────────── */
const TB_SIDEBAR_SVG = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><line x1="5.5" y1="2.5" x2="5.5" y2="13.5"/></svg>`;
/* Line icons for buttons and search fields. The app uses no emoji: text
   labels first, these where a control needs a glyph. */
const _LINE_SVG =
  '<svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
const LINE_ICONS = {
  search: _LINE_SVG + '<circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>',
  edit: _LINE_SVG + '<path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>',
  copy:
    _LINE_SVG +
    '<rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5"/></svg>',
  trash: _LINE_SVG + '<path d="M2 4h12"/><path d="M5.5 4V2.5h5V4"/><path d="M3.5 4l.8 9.5h7.4l.8-9.5"/></svg>',
  lock: _LINE_SVG + '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
};
const TB_PAGES = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  { id: 'assignments', label: 'Assignments', href: '/assignments' },
  { id: 'observations', label: 'Observations', href: '/observations' },
  { id: 'spreadsheet', label: 'Gradebook', href: '/gradebook' },
  { id: 'reports', label: 'Reports', href: '/reports' },
];

/* ── Idempotent write RPCs ──────────────────────────────────── */
/* Server-side write paths that accept an optional `p_idempotency_key uuid`
   (migration 20260423_write_path_idempotency). Each caches its result per
   (key, teacher, endpoint) through fv_idem_check / fv_idem_store, so a retry
   of a call that committed server-side but whose response never reached the
   client returns the original row instead of inserting a duplicate.

   IMPORTANT: this list must stay in lockstep with the server. Naming an
   endpoint here that has not had the parameter added makes every call to it
   fail with "function … does not exist", because PostgREST resolves overloads
   by argument name. Verify against the database before adding one:

     select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and exists (select 1 from unnest(p.proargnames) a where a = 'p_idempotency_key');

   Read by shared/data.js (direct online writes) and shared/offline-queue.js
   (queued writes replayed on reconnect). */
const FV_IDEMPOTENT_RPCS = {
  close_phone_report: true,
  create_assessment: true,
  create_course: true,
  create_custom_tag: true,
  create_observation: true,
  create_phone_report: true,
  create_report_issue: true,
  create_student_and_enroll: true,
  delete_guardian: true,
  delete_questionnaire: true,
  delete_report_issue: true,
  delete_report_template: true,
  delete_withdrawn_student: true,
  duplicate_assessment: true,
  duplicate_course: true,
  import_json_restore: true,
  import_roster_csv: true,
  import_teams_class: true,
  issue_access_codes: true,
  issue_report_codes: true,
  reenrol_student: true,
  remove_section: true,
  restore_section: true,
  save_report_template: true,
  set_questionnaire_on: true,
  update_phone_report: true,
  upsert_category: true,
  upsert_competency_group: true,
  upsert_guardian: true,
  upsert_module: true,
  upsert_note: true,
  upsert_observation_template: true,
  upsert_questionnaire: true,
  upsert_rubric: true,
  upsert_section: true,
  upsert_subject: true,
  upsert_tag: true,
  withdraw_student: true,
};

/* Open a class from this device's saved copy and check the server in the
   background (docs/class-loading-plan.md, Phase 4). false loads every class
   from the server first, as before. */
const FV_CACHE_FIRST = true;
