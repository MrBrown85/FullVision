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
    gradingSystem: 'proficiency',
    calcMethod: 'mostRecent',
    decayWeight: 0.65,
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

/* A rubric criterion's scores are kept under its competencies, or under the
   criterion's own id when it has none. That key counts toward the
   assessment and the course grade, never toward a competency. */
function rubricCriterionScoreKeys(criterion) {
  if (!criterion) return [];
  var ids = criterion.tagIds || [];
  return ids.length ? ids : [criterion.id];
}

/* The keys an assessment's scores are stored under: its competencies, plus
   the id of each rubric criterion that has none, or the one unlinked key
   when there are neither. Rubric criteria are only found when `cid` is
   given. An assessment graded by criterion ids never uses the unlinked key
   as well, so one score is never counted twice. */
function scoreTagIds(assessment, cid) {
  var ids = (assessment && (assessment.tagIds || assessment.tag_ids)) || [];
  var rubricId = assessment && (assessment.rubricId || assessment.rubric_id);
  var rubric = null;
  if (cid && rubricId && !isPointsScored(assessment) && typeof getRubricById === 'function') {
    rubric = getRubricById(cid, rubricId);
  }
  if (rubric) {
    var criterionIds = (rubric.criteria || [])
      .filter(function (c) {
        return c && c.id && !(c.tagIds && c.tagIds.length) && ids.indexOf(c.id) < 0;
      })
      .map(function (c) {
        return c.id;
      });
    if (criterionIds.length) ids = ids.concat(criterionIds);
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
const DEFAULT_GRADING_SCALE = {
  boundaries: [
    { min: 86, proficiency: 4 },
    { min: 73, proficiency: 3 },
    { min: 50, proficiency: 2 },
    { min: 0, proficiency: 1 },
  ],
  labels: null,
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
const OBS_ICONS = {
  engagement: '🎯',
  curiosity: '🔍',
  selfRegulation: '🧘',
  resilience: '💪',
  belonging: '🤝',
  identity: '🪞',
  collaboration: '👥',
  respect: '🙏',
  responsibility: '🌱',
};
const OBS_LEVEL_LABELS = { 0: 'Not Assessed', 1: 'Needs Support', 2: 'Developing', 3: 'Growing', 4: 'Thriving' };
const OBS_LEVEL_COLORS = {
  0: 'var(--text-3)',
  1: 'var(--score-1)',
  2: 'var(--score-2)',
  3: 'var(--score-3)',
  4: 'var(--score-4)',
};

const OBS_SENTIMENTS = {
  strength: { icon: '✅', label: 'Strength', color: 'var(--score-3)', tint: 'rgba(46,125,50,0.08)', border: '#2e7d32' },
  growth: { icon: '🔄', label: 'Growth', color: 'var(--active)', tint: 'rgba(0,122,255,0.08)', border: '#007AFF' },
  concern: { icon: '⚠️', label: 'Concern', color: 'var(--score-2)', tint: 'rgba(192,122,0,0.08)', border: '#c07a00' },
};

const OBS_CONTEXTS = {
  'whole-class': { icon: '👥', label: 'Whole class' },
  'small-group': { icon: '👫', label: 'Small group' },
  independent: { icon: '🧑‍💻', label: 'Independent' },
  presentation: { icon: '🎤', label: 'Presentation' },
  discussion: { icon: '💬', label: 'Discussion' },
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

/* Observation UI shows type, context and tags as text pills. The icon fields
   above and OBS_ICONS are kept for now but no longer rendered
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
const TB_PAGES = [
  { id: 'dashboard', label: 'Dashboard', href: 'index.html' },
  { id: 'assignments', label: 'Assignments', href: 'settings.html' },
  { id: 'observations', label: 'Observations', href: 'observations.html' },
  { id: 'spreadsheet', label: 'Gradebook', href: 'spreadsheet.html' },
  { id: 'reports', label: 'Reports', href: 'reports.html' },
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
  create_assessment: true,
  create_course: true,
  create_custom_tag: true,
  create_observation: true,
  create_student_and_enroll: true,
  duplicate_assessment: true,
  duplicate_course: true,
  import_json_restore: true,
  import_roster_csv: true,
  import_teams_class: true,
  upsert_category: true,
  upsert_competency_group: true,
  upsert_module: true,
  upsert_note: true,
  upsert_observation_template: true,
  upsert_rubric: true,
  upsert_section: true,
  upsert_subject: true,
  upsert_tag: true,
};

/* Open a class from this device's saved copy and check the server in the
   background (docs/class-loading-plan.md, Phase 4). false loads every class
   from the server first, as before. */
const FV_CACHE_FIRST = true;
