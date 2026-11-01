/* Synthetic classes for the simulation (plan PR 13), in the class-file
 * shape the evaluation scripts read: what get_class_bundle returns, its
 * gradebook.course the class's course row. Every name, title, mark, rating
 * and note here is invented; no real student is in them.
 *
 * Each kind is a different class: its subject (so its kind of class and
 * the skills its next step names), its grade (8–9 report proficiency,
 * 10–12 a letter), its grading style (Letter, Both or Proficiency), its
 * size, and a mix of students: strong, steady, climbing, sliding, strong in
 * one skill and weak in another, struggling, with work labelled Missing,
 * with few marks, below 50% (IE), and, in grades 10–12, one assessed on
 * language goals and one on IEP goals. Habits are
 * rated for most students, a few left unrated. The same kind always builds
 * the same class. */

const FIRST = [
  'Amara',
  'Ben',
  'Chloe',
  'Dev',
  'Elena',
  'Farid',
  'Grace',
  'Hugo',
  'Isla',
  'Jonah',
  'Keira',
  'Liam',
  'Maya',
  'Nico',
  'Olivia',
  'Pavel',
  'Quinn',
  'Rosa',
  'Sami',
  'Tara',
  'Umar',
  'Vera',
  'Wes',
  'Xavi',
  'Yara',
  'Zane',
  'Aditi',
  'Bruno',
  'Celia',
  'Dmitri',
  'Esme',
  'Felix',
];
const LAST = [
  'Abbott',
  'Bains',
  'Castillo',
  'Dhillon',
  'Eriksen',
  'Fontaine',
  'Gill',
  'Hartley',
  'Ibarra',
  'Jansen',
  'Kowalski',
  'Lindqvist',
  'Moreau',
  'Nakamura',
  'Osei',
  'Petrov',
  'Quan',
  'Rahimi',
  'Santos',
  'Tremblay',
  'Usman',
  'Vasquez',
  'Whitfield',
  'Xu',
  'Yilmaz',
  'Zhou',
  'Ahn',
  'Brennan',
  'Cardoso',
  'Duarte',
  'Ekwueme',
  'Falk',
];
const PRONOUNS = ['she/her', 'he/him', 'they/them', '', 'he/him', 'she/her'];

/* The kinds of class. sections: competency names the class's kind has
   skills for; titles: its assignments in date order, some sharing the
   words before a colon, some with lesson numbers. points: the assignment
   positions scored in points (out of 20). tagsPer: how many sections each
   assessment is tagged to (2 when left out). lines: the class has a
   closing sentence and support lines set (the others have none, as a
   class with nothing set). */
export const KINDS = {
  history12: {
    lines: true,
    name: 'History 12',
    grade: '12',
    system: 'letter',
    size: 30,
    sections: ['Significance', 'Evidence', 'Continuity and Change', 'Perspective'],
    titles: [
      '1.1 Causes of the Great War',
      'Current Events: Week 1',
      'Current Events: Week 2',
      'Primary Source Analysis',
      'Current Events: Week 3',
      'Lesson 4: Treaty of Versailles Debate',
      'What Does the Poster Show, and What Does It Hide?',
      'Current Events: Week 4',
      'Interwar Timeline',
      'Unit 1 Test',
    ],
    points: [9],
  },
  english10: {
    lines: true,
    name: 'English 10',
    grade: '10',
    system: 'both',
    size: 28,
    sections: ['Comprehend and Connect', 'Thinking Critically', 'Create and Communicate', 'Conventions'],
    titles: [
      'Short Story Response: The Lottery',
      'Vocabulary Check 1',
      'Short Story Response: Harrison Bergeron',
      'Poetry Annotation',
      'Literature Circle: Role Sheet 1',
      'Literature Circle: Role Sheet 2',
      'Literature Circle: Role Sheet 3',
      'Personal Narrative Draft',
      'Personal Narrative Final',
    ],
    points: [1],
  },
  science9: {
    name: 'Science 9',
    grade: '9',
    system: 'proficiency',
    size: 26,
    sections: ['Questioning and Predicting', 'Planning and Conducting', 'Processing and Analyzing', 'Communicating'],
    titles: [
      'Lab: Static Electricity',
      'Cell Division Diagram',
      'Lab: Series and Parallel Circuits',
      'Reproduction Quiz',
      'Lab: Ohm’s Law',
      'Ecosystem Field Notes',
      'Circuit Design Challenge',
      'Unit Review',
    ],
    points: [],
  },
  // The kinds below carry every competency their kind's skill table names
  // (lane H, Nov 1), so each skill is some student's next step and its
  // frames are exercised; with more sections, each assessment is tagged
  // to four (tagsPer) so every section keeps four or more scored
  // pieces, the next step's gate (four tags, so a section at the end of
  // the cycle keeps four or more even where points work carries no tag).
  math11: {
    lines: true,
    name: 'Pre-Calculus 11',
    grade: '11',
    system: 'letter',
    size: 30,
    tagsPer: 4,
    sections: [
      'Reasoning and Modelling',
      'Understanding and Solving',
      'Communicating and Representing',
      'Connecting and Reflecting',
      'Estimating and Mental Math',
      'Sequences and Rules',
      'Graphs and Tables',
      'Notation and Units',
      'Real-World Applications',
      'Procedures and Accuracy',
    ],
    titles: [
      'Quadratics Practice Set',
      'Quiz 1: Factoring',
      'Graphing Investigation',
      'Quiz 2: Radicals',
      'Problem of the Week: Fences',
      'Estimation Challenge',
      'Problem of the Week: Bridges',
      'Quiz 3: Rational Expressions',
      'Pattern Rules Task',
      'Problem of the Week: Ramps',
      'Unit 2 Test',
      'Trigonometry Practice Set',
      'Quiz 4: Trigonometry',
      'Word Problem Set',
      'Quiz 5: Functions',
      'Unit 3 Test',
    ],
    points: [1, 3, 7],
  },
  pe8: {
    name: 'Physical and Health Education 8',
    grade: '8',
    system: 'proficiency',
    size: 30,
    tagsPer: 4,
    sections: [
      'Movement Skills',
      'Fitness',
      'Safety',
      'Leadership',
      'Game Strategy',
      'Eating and Hydration',
      'Relationships and Consent',
      'Substance Use',
      'Endurance and Pacing',
      'Outdoor Education',
      'Managing Stress',
      'Mental Well-being',
    ],
    titles: [
      'Fitness Baseline',
      'Badminton Skills Check',
      'Healthy Choices Reflection',
      'Team Games Leadership',
      'Pacing Run 1',
      'Nutrition Label Task',
      'Friendship and Respect Reflection',
      'Substance Decisions Scenario',
      'Orienteering Day Plan',
      'Stress Toolkit',
      'Fitness Check-In',
      'Pacing Run 2',
      'Game Strategy Quiz',
      'Healthy Eating Plan',
      'Outdoor Skills Check',
      'Safety Plan',
    ],
    points: [],
  },
  art11: {
    name: 'Visual Arts 11',
    grade: '11',
    system: 'both',
    size: 22,
    tagsPer: 4,
    sections: [
      'Explore and Create',
      'Reason and Reflect',
      'Communicate and Document',
      'Technique',
      'Planning a Piece',
      'Using Feedback',
      'Elements and Principles',
      'Camera and Light',
      'Process Journal',
    ],
    titles: [
      'Sketchbook: Week 1',
      'Sketchbook: Week 2',
      'Value Study',
      'Sketchbook: Week 3',
      'Composition Plan',
      'Photo Series: Light',
      'Artist Statement',
      'Still Life Painting',
      'Critique Reflection',
      'Sketchbook: Week 4',
      'Revised Still Life',
      'Portfolio Review',
    ],
    points: [],
  },
  music9: {
    name: 'Concert Band 9',
    grade: '9',
    system: 'proficiency',
    size: 24,
    tagsPer: 4,
    sections: [
      'Ensemble and Stage',
      'Reading Notation',
      'Technique',
      'Explore and Create',
      'Reason and Reflect',
      'Connect and Expand',
      'Elements and Principles',
      'Using Feedback',
    ],
    titles: [
      'Playing Test: Scales',
      'Rhythm Reading Check 1',
      'Listening Journal: Week 1',
      'Sectional Rehearsal Reflection',
      'Playing Test: Chorale',
      'Composition: Eight Bars',
      'Rhythm Reading Check 2',
      'Listening Journal: Week 2',
      'Fall Concert Performance',
      'Concert Reflection',
      'Playing Test: March',
      'Rhythm Reading Check 3',
    ],
    points: [],
  },
  foods10: {
    name: 'Foods 10',
    grade: '10',
    system: 'letter',
    size: 24,
    tagsPer: 4,
    sections: [
      'Safety',
      'Recipes and Kitchen Skills',
      'Material Selection',
      'Teamwork',
      'Designing',
      'Making',
      'Testing',
      'Sharing',
    ],
    titles: [
      'Knife Skills Check',
      'Lab: Muffins',
      'Recipe Plan: Soup',
      'Lab: Soup',
      'Food Safety Quiz',
      'Lab: Stir-Fry',
      'Ingredient Choice Task',
      'Lab: Pasta',
      'Menu Project Plan',
      'Lab: Bread',
      'Menu Project Presentation',
      'Group Meal Reflection',
    ],
    points: [4],
  },
  adst8: {
    name: 'Applied Design, Skills and Technologies 8',
    grade: '8',
    system: 'proficiency',
    size: 26,
    tagsPer: 4,
    sections: [
      'Safety',
      'Sewing and Textiles',
      'Cutting and Joining',
      'Drafting',
      'Coding',
      'Media and Graphics',
      'Business',
      'Tools and Technologies',
      'Designing',
    ],
    titles: [
      'Shop Safety Quiz',
      'Drafting: Orthographic Views',
      'Woodwork: Box Joint Project',
      'Textiles: Drawstring Bag',
      'Coding: Maze Game',
      'Media: Poster Design',
      'Business: Product Pitch',
      'Drafting: Scale Drawing',
      'Woodwork: Cutting Board',
      'Textiles: Pencil Case',
      'Coding: Scoreboard Program',
      'Media: Short Video',
      'Design Journal Check',
      'Rotation Reflection',
    ],
    points: [],
  },
  career10: {
    name: 'Career Life Education 10',
    grade: '10',
    system: 'proficiency',
    size: 26,
    tagsPer: 4,
    sections: [
      'Self-Awareness',
      'Exploring Careers',
      'Planning',
      'Connections',
      'Examining Influences',
      'Résumés and Interviews',
      'Budgeting',
      'Post-Secondary Options',
    ],
    titles: [
      'Strengths Inventory',
      'Career Interview Reflection',
      'Job Posting Analysis',
      'Influences Map',
      'Volunteer Reflection',
      'Résumé Draft',
      'Monthly Budget Task',
      'Goal Setting Worksheet',
      'Mock Interview',
      'Post-Secondary Comparison',
      'Career Research Report',
      'Capstone Plan Check-In',
    ],
    points: [],
  },
  french10: {
    name: 'Core French 10',
    grade: '10',
    system: 'both',
    size: 26,
    tagsPer: 4,
    sections: [
      'Listening',
      'Speaking',
      'Reading',
      'Writing',
      'Vocabulary',
      'Grammar',
      'Culture',
      'Communicating',
      'Understanding',
    ],
    titles: [
      'Unit 1 Vocabulary Quiz',
      'Dialogue: At the Café',
      'Listening Check 1',
      'Reading: Une journée à Montréal',
      'Paragraph: Ma famille',
      'Verb Quiz: Present Tense',
      'Culture Project: Carnaval',
      'Listening Check 2',
      'Dialogue: Shopping',
      'Reading: Le Petit Prince Extract',
      'Unit 2 Vocabulary Quiz',
      'Paragraph: Mes vacances',
      'Oral Presentation: Ma ville',
      'Unit 2 Test',
    ],
    points: [13],
  },
};

/* The student mixes, cycled through the roster. Each picks marks per
   assignment (by position in the term, 0–1) and per competency, plus how
   habits are rated. */
const PROFILES = [
  'strong',
  'steady',
  'climb',
  'strong',
  'struggling',
  'missing',
  'steady',
  'split',
  'slide',
  'thin',
  'steady',
  'strong',
  'failing',
  'steady',
  'climb',
  'missing',
];
/* Attendance entered at Report 1 as [absences, lates], cycled through the
   roster; null for a student with none entered. */
const ATTENDANCE_SETS = [null, [3, 0], null, [0, 2], [4, 1], null, [1, 0], null, [0, 1], [12, 3], null, [2, 2]];
const HABIT_SETS = [
  'excellent',
  'good',
  'excellent',
  'buildOne',
  'buildTwo',
  'buildTwo',
  'good',
  'buildOne',
  'excellent',
  'none',
  'good',
  'excellent',
  'buildTwo',
  'good',
  'buildOne',
  'buildTwo',
];
const HABIT_KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
const NOTES = [
  'linked each cause to a clear effect',
  'explained the evidence in their own words',
  'organised the ideas in a clear order',
  'tested two ideas before choosing one',
  'used a labelled diagram to explain the result',
  'revised the draft after feedback',
];

/* A small repeatable random from a string. */
function rng(text) {
  let x = 2166136261;
  for (const ch of String(text)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = v => Math.max(1, Math.min(4, Math.round(v)));

/* A level for a profile on an assignment at `at` (0–1 through the term) and
   a competency (0–3); null for no mark, 'NS' for labelled Missing. */
function levelFor(profile, at, comp, r) {
  const wobble = r() < 0.25 ? (r() < 0.5 ? -1 : 1) : 0;
  switch (profile) {
    case 'strong':
      return clamp(4 - (r() < 0.25 ? 1 : 0));
    case 'steady':
      return clamp(3 + wobble * 0.6);
    case 'climb':
      return clamp(1.6 + at * 2.6);
    case 'slide':
      return clamp(4 - at * 2.6);
    case 'split':
      return comp === 0 ? 4 : comp === 1 ? clamp(1.6 + (r() < 0.3 ? 1 : 0)) : 3;
    case 'struggling':
      return clamp(2.5 + wobble * 0.6);
    case 'missing':
      return r() < 0.4 ? 'NS' : clamp(3.4 + wobble * 0.6);
    case 'thin':
      return r() < 0.75 ? null : clamp(3 + wobble);
    case 'failing':
      return r() < 0.5 ? 'NS' : 1;
    default:
      return 3;
  }
}

function habitsFor(set, r) {
  const out = {};
  if (set === 'none') return out;
  HABIT_KEYS.forEach(k => {
    out[k] = set === 'excellent' ? 4 : r() < 0.5 ? 3 : 4;
  });
  if (set === 'buildOne') out[HABIT_KEYS[Math.floor(r() * 6)]] = 2;
  if (set === 'buildTwo') {
    const a = Math.floor(r() * 6);
    out[HABIT_KEYS[a]] = 2;
    out[HABIT_KEYS[(a + 1 + Math.floor(r() * 5)) % 6]] = r() < 0.5 ? 1 : 2;
  }
  return out;
}

/* A class-file id: a UUID made from the kind and a number. */
function idFor(kindIndex, n) {
  return 'f' + String(kindIndex).padStart(7, '0') + '-0000-4000-8000-' + String(n).padStart(12, '0');
}

/* One synthetic class of a kind (a KINDS key). opts: { size } to change
   the roster's size. */
export function syntheticClass(kind, opts) {
  const k = KINDS[kind];
  if (!k) throw new Error('No synthetic class "' + kind + '". Kinds: ' + Object.keys(KINDS).join(', '));
  const ki = Object.keys(KINDS).indexOf(kind) + 1;
  const id = n => idFor(ki, n);
  const size = (opts && opts.size) || k.size;
  const r = rng(kind);
  const students = Array.from({ length: size }, (_, i) => {
    const first = FIRST[(i * 7 + ki * 3) % FIRST.length];
    const last = LAST[(i * 5 + ki) % LAST.length];
    return {
      enrollment_id: id(1000 + i),
      student_id: id(2000 + i),
      first_name: first,
      last_name: last,
      pronouns: PRONOUNS[(i + ki) % PRONOUNS.length],
      roster_position: i + 1,
      // In a class that reports a letter, one English language learner
      // and one student with an IEP, each assessed on their goals.
      designations: Number(k.grade) >= 10 ? (i === 6 ? ['ELL'] : i === 11 ? ['Q'] : []) : [],
      // One student joined the class five weeks in (the newcomer story).
      enrolled_at: i === 17 ? '2026-10-13' : '2026-09-03',
    };
  });
  const tagIds = k.sections.map((_, i) => id(4000 + i));
  const start = Date.UTC(2026, 8, 8);
  const assessments = k.titles.map((title, i) => {
    const date = new Date(start + Math.round((i * 70 * 86400000) / k.titles.length)).toISOString().slice(0, 10);
    const points = k.points.indexOf(i) >= 0;
    return {
      id: id(3000 + i),
      title,
      description: '',
      category_id: id(5000),
      score_mode: points ? 'points' : 'proficiency',
      max_points: points ? 20 : null,
      weight: 1,
      evidence_type: '',
      rubric_id: null,
      module_id: null,
      collab_mode: null,
      collab_config: {},
      has_rubric: false,
      date_assigned: date,
      due_date: date,
      display_order: i,
      tag_ids: points ? [] : Array.from({ length: k.tagsPer || 2 }, (_, n) => tagIds[(i + n) % tagIds.length]),
    };
  });
  const scoreRows = [];
  const tagRows = [];
  const ratings = [];
  const attendance = [];
  // The competency each student is weakest in, cycling through the
  // sections over the students whose profile scores every piece (lane H,
  // Nov 1), so in a kind with its whole skill table as sections every
  // skill is some student's next step and its frames are exercised.
  const FULL = ['strong', 'steady', 'climb', 'struggling'];
  let fullSeen = 0;
  students.forEach((st, si) => {
    const profile = PROFILES[si % PROFILES.length];
    const focus = k.tagsPer && FULL.indexOf(profile) >= 0 ? fullSeen++ % tagIds.length : -1;
    let best = null;
    assessments.forEach((a, ai) => {
      const at = assessments.length > 1 ? ai / (assessments.length - 1) : 0;
      const tags = a.tag_ids.map(t => tagIds.indexOf(t));
      const v = levelFor(profile, at, tags[0] || 0, r);
      if (v === 'NS') {
        scoreRows.push([si, ai, null, 'NS', '']);
        return;
      }
      if (v == null) return;
      if (a.score_mode === 'points') {
        scoreRows.push([si, ai, Math.min(20, Math.round(v * 5 - r() * 3)), null, '']);
        return;
      }
      const row = [si, ai, v, null, '', 0, null];
      scoreRows.push(row);
      tags.forEach((t, n) => {
        // A focus student's other competencies keep the assessment's own
        // level and the focus one sits two below it, so the weakest is
        // decided (the level now reads the latest pieces, where a one
        // level dip can tie), not left to the wobble.
        let tv =
          profile === 'split' ? levelFor('split', at, t, r) : n && focus < 0 ? clamp(v + (r() < 0.3 ? -1 : 0)) : v;
        if (t === focus) tv = clamp(tv - 2);
        tagRows.push([si, ai, t, tv, 0]);
      });
      if (!best || v >= best[2]) best = row;
    });
    // A Note for the Report on the best piece for about a third.
    if (best && si % 3 === 0) best[6] = NOTES[si % NOTES.length];
    const habits = habitsFor(HABIT_SETS[si % HABIT_SETS.length], r);
    const goals = st.designations.indexOf('ELL') >= 0 ? 'language_goals' : st.designations.length ? 'iep_goals' : '';
    // In a class that reports a letter, the first student with few marks
    // (the 'thin' profile) is one the teacher chose IE for, so the IE
    // comment's marks problem and plan are drafted.
    const basis = goals || (Number(k.grade) >= 10 && si === PROFILES.indexOf('thin') ? 'ie' : '');
    if (Object.keys(habits).length || basis) {
      ratings.push(
        Object.assign(
          { enrollment_id: st.enrollment_id, term: 1, habits, narrative_html: '' },
          basis ? { reporting_basis: basis } : {},
        ),
      );
    }
    // Attendance entered for about half the roster, cycling through
    // absences only, lates only and both (the rest have none entered), so
    // the attendance frames are exercised (loadClass applies it as the
    // Reports page's attendance card does).
    const att = ATTENDANCE_SETS[si % ATTENDANCE_SETS.length];
    if (att) attendance.push({ enrollment_id: st.enrollment_id, term: 1, absences: att[0], lates: att[1] });
  });
  const course = {
    id: id(1),
    name: k.name,
    grade_level: k.grade,
    grading_system: k.system,
    calc_method: 'average',
    late_work_policy: 'Late work is accepted until the end of the unit.',
    // Report 1 is not the course's last term, so a mark under 50% is IE.
    reporting_terms: [
      { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-20' },
      { ordinal: 2, label: 'Term 2', starts_on: '2026-11-21', ends_on: '2027-01-29' },
    ],
  };
  return {
    bundle_schema: 2,
    version: 1,
    gradebook: {
      course,
      students,
      assessments,
      categories: [{ id: id(5000), name: 'Assignments', weight: 100, display_order: 0 }],
      modules: [],
      tag_index: tagIds,
      criterion_index: [],
      score_rows: scoreRows,
      tag_rows: tagRows,
      criterion_rows: [],
    },
    learning_map: {
      competency_groups: [],
      subjects: [
        {
          id: id(6000),
          name: k.name,
          display_order: 0,
          sections: k.sections.map((name, i) => ({
            id: id(7000 + i),
            name,
            display_order: i,
            competency_group_id: null,
            tags: [{ id: tagIds[i], code: 'C' + (i + 1), label: name, i_can_text: '', display_order: 0 }],
          })),
        },
      ],
    },
    rubrics: { rubrics: [], criteria: [], criterion_tags: [] },
    observations: { observations: [], total: 0 },
    profiles: [],
    term_ratings: ratings,
    eval_term_attendance: attendance,
    report_config: k.lines
      ? {
          blocks_config: {
            commentSettings: {
              supportChosen: ['sl-missing', 'sl-revise', 'sl-checklist'],
              closing: 'It has been a pleasure to teach this class this term.',
            },
          },
        }
      : null,
    custom_tags: [],
    course_config: { reporting_terms: course.reporting_terms },
  };
}
