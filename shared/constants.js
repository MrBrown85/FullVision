/* gb-constants.js — Shared constants for FullVision */

/**
 * @typedef {Object} Course
 * @property {string} id - Course identifier (e.g. 'sci8')
 * @property {string} name - Display name (e.g. 'Science 8')
 * @property {'proficiency'|'points'} gradingSystem - Grading mode
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
const PRONOUNS_OPTIONS = ['he/him','she/her','they/them','prefer not to say'];

/* ── Courses ────────────────────────────────────────────────── */
const DEFAULT_COURSES = {
  sci8:  { id:'sci8',  name:'Science 8',  gradingSystem:'proficiency', calcMethod:'mostRecent', decayWeight:0.65, curriculumTags:['SCI8'] }
};

/* ── Learning Map: Learning Standards (flat format) ─────────── */
const LEARNING_MAP = {
  sci8: {
    _flatVersion: 2,
    subjects: [
      { id: 'SCI8', name: 'Science 8', color: '#0891b2' }
    ],
    sections: [
      {
        id: 'QAP', subject: 'SCI8', name: 'Questioning and Predicting', shortName: 'Questioning', color: '#0891b2',
        tags: [
          { id: 'QAP', label: 'Question and Predict', text: '', color: '#0891b2', subject: 'SCI8', name: 'Questioning and Predicting', shortName: 'Questioning',
            i_can_statements: ['I can identify a scientific question that genuinely interests me and pursue it with curiosity.','I can make careful observations of the natural world and generate questions based on what I notice.','I can formulate a hypothesis and predict what I think will happen in an investigation.'] }
        ]
      },
      {
        id: 'PI', subject: 'SCI8', name: 'Planning and Conducting', shortName: 'Planning', color: '#0891b2',
        tags: [
          { id: 'PI', label: 'Plan Investigations', text: '', color: '#0891b2', subject: 'SCI8', name: 'Planning and Conducting', shortName: 'Planning',
            i_can_statements: ['I can plan a fair test by identifying and controlling variables.','I can choose the right tools and methods to collect accurate and reliable data.','I can use appropriate SI units and convert between units when needed.','I can follow safety and ethical guidelines during investigations.'] }
        ]
      },
      {
        id: 'IP', subject: 'SCI8', name: 'Processing and Analyzing Data and Information', shortName: 'Processing', color: '#0891b2',
        tags: [
          { id: 'IP', label: 'Identify Patterns', text: '', color: '#0891b2', subject: 'SCI8', name: 'Processing and Analyzing Data and Information', shortName: 'Processing',
            i_can_statements: ['I can organize data into tables and graphs to reveal patterns.','I can analyze my data to identify trends, patterns, and relationships.','I can apply First Peoples knowledge and perspectives as valid sources of scientific understanding.','I can use scientific understanding to draw conclusions supported by evidence.'] }
        ]
      },
      {
        id: 'EM', subject: 'SCI8', name: 'Evaluating', shortName: 'Evaluating', color: '#0891b2',
        tags: [
          { id: 'EM', label: 'Evaluate Methods', text: '', color: '#0891b2', subject: 'SCI8', name: 'Evaluating', shortName: 'Evaluating',
            i_can_statements: ['I can identify sources of error in my investigation and suggest specific improvements.','I can evaluate the quality of my data and explain how it could be made more reliable.','I can consider the social, ethical, and environmental implications of a scientific issue.','I can exercise informed skepticism \u2014 questioning claims and demanding evidence.'] }
        ]
      },
      {
        id: 'CA', subject: 'SCI8', name: 'Applying and Innovating', shortName: 'Applying', color: '#0891b2',
        tags: [
          { id: 'CA', label: 'Community Applications', text: '', color: '#0891b2', subject: 'SCI8', name: 'Applying and Innovating', shortName: 'Applying',
            i_can_statements: ['I can apply what I\'ve learned in science to a new situation or problem.','I can design a project or solution that addresses a real need in my community or the world.','I can generate and refine creative ideas when problem-solving.'] }
        ]
      },
      {
        id: 'SC', subject: 'SCI8', name: 'Communicating', shortName: 'Communicating', color: '#0891b2',
        tags: [
          { id: 'SC', label: 'Scientific Communication', text: '', color: '#0891b2', subject: 'SCI8', name: 'Communicating', shortName: 'Communicating',
            i_can_statements: ['I can communicate my scientific findings clearly using appropriate scientific vocabulary.','I can use digital tools to represent and share scientific information.','I can express how my local environment and First Peoples perspectives relate to the science I\'m learning.'] }
        ]
      }
    ]
  }
};

/* ── BC Ministry of Education — Special Education Designations ── */
const BC_DESIGNATIONS = {
  A: { name:'Physically Dependent', desc:'Completely dependent on others for daily living needs (feeding, dressing, toileting, mobility)', level:1, iep:true, modified:true },
  B: { name:'Deafblind', desc:'Combined visual and auditory impairment causing significant communication and education difficulties', level:1, iep:true, modified:true },
  C: { name:'Moderate–Profound Intellectual Disability', desc:'IQ 3+ standard deviations below mean with similar adaptive functioning delays', level:2, iep:true, modified:true },
  D: { name:'Physical Disability / Chronic Health', desc:'Nervous system impairments, musculoskeletal conditions, or chronic health issues significantly impacting education', level:2, iep:true, modified:false },
  E: { name:'Visual Impairment', desc:'Vision insufficient for independent participation in daily activities', level:2, iep:true, modified:false },
  F: { name:'Deaf or Hard of Hearing', desc:'Medically diagnosed hearing loss creating substantial educational difficulty', level:2, iep:true, modified:false },
  G: { name:'Autism Spectrum Disorder', desc:'Neurodevelopmental disability affecting social relationships, communication, interests, and sensory responsiveness', level:2, iep:true, modified:false },
  H: { name:'Intensive Behaviour / Serious Mental Illness', desc:'Severe behavioural or mental health needs requiring intensive intervention', level:3, iep:true, modified:false },
  K: { name:'Mild Intellectual Disability', desc:'IQ 2+ standard deviations below mean (typically 55–69)', level:0, iep:true, modified:true },
  P: { name:'Gifted', desc:'Exceptionally high capability in intellect, creativity, or discipline-specific skills', level:0, iep:true, modified:false },
  Q: { name:'Learning Disability', desc:'Difficulties acquiring, organizing, or using verbal/nonverbal information despite average intellect', level:0, iep:true, modified:false },
  R: { name:'Moderate Behaviour Support / Mental Illness', desc:'Moderate-level behavioural disorders or mental illness affecting school functioning', level:0, iep:true, modified:false },
};

const PROF_LABELS = { 0:'No Evidence', 1:'Emerging', 2:'Developing', 3:'Proficient', 4:'Extending' };
const PROF_COLORS = { 0:'#bbb', 1:'var(--score-1)', 2:'var(--score-2)', 3:'var(--score-3)', 4:'var(--score-4)' };
const PROF_TINT = { 0:'rgba(187,187,187,0.12)', 1:'rgba(211,47,47,0.10)', 2:'rgba(192,122,0,0.10)', 3:'rgba(46,125,50,0.10)', 4:'rgba(21,101,192,0.12)' };
const CORE_COMPETENCIES = [
  { id:'COM', label:'Communicating', group:'Communication', color:'#e67700' },
  { id:'COL', label:'Collaborating', group:'Communication', color:'#e67700' },
  { id:'CT',  label:'Creative Thinking', group:'Thinking', color:'var(--score-4)' },
  { id:'CRT', label:'Critical & Reflective Thinking', group:'Thinking', color:'var(--score-4)' },
  { id:'PPI', label:'Personal & Cultural Identity', group:'Personal & Social', color:'var(--score-3)' },
  { id:'PAR', label:'Personal Awareness & Responsibility', group:'Personal & Social', color:'var(--score-3)' },
  { id:'SAR', label:'Social Awareness & Responsibility', group:'Personal & Social', color:'var(--score-3)' }
];
function getCoreCompetency(id) { return CORE_COMPETENCIES.find(c => c.id === id); }

/* ── Traditional Gradebook — grading scale, points, weights ── */
const DEFAULT_GRADING_SCALE = {
  boundaries: [
    { min: 86, proficiency: 4 },
    { min: 73, proficiency: 3 },
    { min: 50, proficiency: 2 },
    { min: 0,  proficiency: 1 }
  ],
  labels: null
};

const SUBJECT_COLOURS = {
  'Applied Design, Skills and Technologies': '#6366f1',
  'Arts Education': '#db2777',
  'Career Education': '#d97706',
  'English Language Arts': '#2563eb',
  'Mathematics': '#7c3aed',
  'Physical and Health Education': '#059669',
  'Science': '#0891b2',
  'Social Studies': '#dc2626'
};

// Stable avatar colors — hash student ID to a color
const _AVATAR_COLORS = ['#2e7d32','#1565c0','#7b1fa2','#c62828','#e65100','#283593','#00695c','#ad1457','#4e342e','#00838f','#558b2f','#6a1b9a','#bf360c','#1a237e','#004d40'];

const CONFIDENCE_LABELS = { 1:'Beginning', 2:'Growing', 3:'Confident', 4:'Leading' };
const CONFIDENCE_COLORS = { 1:'var(--score-1)', 2:'var(--score-2)', 3:'var(--score-3)', 4:'var(--score-4)' };

/* ── Learner Profile: Observation dimensions & constants ──── */
/* Two groups: Learning Dispositions (how they learn) + Relational & Identity (who they are) */
const LEARNING_DIMS = ['engagement','curiosity','selfRegulation','resilience'];
const RELATIONAL_DIMS = ['belonging','identity','collaboration','respect','responsibility'];
const OBS_DIMS = LEARNING_DIMS.concat(RELATIONAL_DIMS);
const OBS_LABELS = {
  engagement:'Engagement', curiosity:'Curiosity & Exploration',
  selfRegulation:'Self-Regulation & Reflection', resilience:'Resilience',
  belonging:'Belonging & Connection', identity:'Identity & Self-Knowledge',
  collaboration:'Collaboration', respect:'Respect',
  responsibility:'Responsibility & Reciprocity'
};
const OBS_SHORT = {
  engagement:'Eng', curiosity:'Curious', selfRegulation:'Self-Reg', resilience:'Resil',
  belonging:'Belong', identity:'Identity', collaboration:'Collab', respect:'Respect', responsibility:'Respons.'
};
const OBS_ICONS = {
  engagement:'🎯', curiosity:'🔍', selfRegulation:'🧘', resilience:'💪',
  belonging:'🤝', identity:'🪞', collaboration:'👥', respect:'🙏', responsibility:'🌱'
};
const OBS_LEVEL_LABELS = { 0:'Not Assessed', 1:'Needs Support', 2:'Developing', 3:'Growing', 4:'Thriving' };
const OBS_LEVEL_COLORS = { 0:'var(--text-3)', 1:'var(--score-1)', 2:'var(--score-2)', 3:'var(--score-3)', 4:'var(--score-4)' };

const OBS_SENTIMENTS = {
  strength: { icon:'✅', label:'Strength', color:'var(--score-3)', tint:'rgba(46,125,50,0.08)', border:'#2e7d32' },
  growth:   { icon:'🔄', label:'Growth',   color:'var(--active)',  tint:'rgba(0,122,255,0.08)', border:'#007AFF' },
  concern:  { icon:'⚠️', label:'Concern',  color:'var(--score-2)', tint:'rgba(192,122,0,0.08)', border:'#c07a00' }
};

const OBS_CONTEXTS = {
  'whole-class':   { icon:'👥', label:'Whole Class' },
  'small-group':   { icon:'👫', label:'Small Group' },
  'independent':   { icon:'🧑‍💻', label:'Independent' },
  'presentation':  { icon:'🎤', label:'Presentation' },
  'discussion':    { icon:'💬', label:'Discussion' }
};

/* ── Card Widget Registry ─────────────────────────────────── */
const WIDGET_REGISTRY = [
  { key: 'hero',         label: 'Name & Proficiency',         defaultOn: true },
  { key: 'sectionBars',  label: 'Section Progress',           defaultOn: true },
  { key: 'completion',   label: 'Completion',                 defaultOn: true },
  { key: 'missingWork',  label: 'Missing Work',               defaultOn: false },
  { key: 'growth',       label: 'Growth Journey',             defaultOn: true },
  { key: 'obsSnippet',   label: 'Latest Observation',         defaultOn: true },
  { key: 'obsSummary',   label: 'Observation Insights',       defaultOn: false },
  { key: 'flagStatus',   label: 'Flag',                       defaultOn: false },
  { key: 'reflection',   label: 'Student Voice',              defaultOn: false },
  { key: 'dispositions', label: 'Learner Dispositions',       defaultOn: true },
  { key: 'traits',       label: 'Character Strengths',        defaultOn: false },
  { key: 'concerns',     label: 'Concerns',                   defaultOn: false },
  { key: 'workHabits',   label: 'Work Habits & Participation',defaultOn: false },
  { key: 'growthAreas',  label: 'Growth Areas',               defaultOn: false },
  { key: 'narrative',    label: 'Teacher Narrative',           defaultOn: false },
  { key: 'actions',      label: 'Action Buttons',             defaultOn: true },
];
const WIDGET_KEYS = WIDGET_REGISTRY.map(function(w) { return w.key; });

/* ── Social / Character Traits ────────────────────────────── */
const SOCIAL_TRAITS_POSITIVE = [
  {id:'leader', label:'Leader'}, {id:'collaborative', label:'Collaborative'},
  {id:'independent', label:'Independent'}, {id:'peer-mentor', label:'Peer Mentor'},
  {id:'risk-taker', label:'Risk Taker'}, {id:'reflective', label:'Reflective'},
  {id:'creative', label:'Creative Thinker'}, {id:'persistent', label:'Persistent'},
  {id:'organized', label:'Organized'}, {id:'empathetic', label:'Empathetic'},
  {id:'curious', label:'Curious'}, {id:'respectful', label:'Respectful'},
  {id:'positive-attitude', label:'Positive Attitude'}, {id:'detail-oriented', label:'Detail-Oriented'},
  {id:'advocate', label:'Self-Advocate'}
];
const SOCIAL_TRAITS_CONCERN = [
  {id:'needs-support', label:'Needs Support'}, {id:'often-late', label:'Often Late'},
  {id:'device-issue', label:'Device Issue'}, {id:'reminders-focus', label:'Reminders to Focus'},
  {id:'often-absent', label:'Often Absent'}, {id:'incomplete-work', label:'Incomplete Work'},
  {id:'disorganized', label:'Disorganized'}, {id:'off-task', label:'Off-Task Behaviour'},
  {id:'social-conflicts', label:'Social Conflicts'}, {id:'low-confidence', label:'Low Confidence'},
  {id:'avoids-challenges', label:'Avoids Challenges'}, {id:'rushed-work', label:'Rushes Work'}
];
const SOCIAL_TRAITS_POSITIVE_IDS = new Set(SOCIAL_TRAITS_POSITIVE.map(function(t) { return t.id; }));
const SOCIAL_TRAITS_CONCERN_IDS = new Set(SOCIAL_TRAITS_CONCERN.map(function(t) { return t.id; }));

/* ── Shared HTML: Unified Toolbar ──────────────────────────── */
const TB_SIDEBAR_SVG = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="2.5" width="13" height="11" rx="2"/><line x1="5.5" y1="2.5" x2="5.5" y2="13.5"/></svg>`;
const TB_PAGES = [
  { id:'dashboard', label:'Dashboard', href:'index.html' },
  { id:'assignments', label:'Assignments', href:'settings.html' },
  { id:'observations', label:'Observations', href:'observations.html' },
  { id:'spreadsheet', label:'Gradebook', href:'spreadsheet.html' },
  { id:'reports', label:'Reports', href:'reports.html' }
];
